import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountRole, address, appendTransactionMessageInstructions, blockhash, compileTransaction, createNoopSigner,
  createTransactionMessage, getBase64EncodedWireTransaction, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, type Instruction,
} from "@solana/kit";
import { sha256 } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { associatedUsdc } from "../../src/solana/accounts.js";
import {
  ADDRESS_LOOKUP_TABLE_PROGRAM, COMPUTE_BUDGET_PROGRAM, EMPTY_PROGRAM_SNAPSHOT, JUPITER_V6_PROGRAM, SOLANA_USDC_MINT, SYSTEM_PROGRAM,
  WRAPPED_SOL_MINT, assertJupiterSignable, createProgramSnapshot, decodeBuildResponse, decodeOrderResponse, decodeQuoteResponse,
  guardJupiterTransaction, parseJupiterV0Envelope, proveJupiterSimulation, validateProgramSnapshot,
  validateFinalizedJupiterReceipt,
  type JupiterGuardPolicy, type SolanaAccountDescriptor, type SolanaAccountResolverPort, type SolanaAddressTableDescriptor,
} from "../../src/swap/jupiter-solana/index.js";

const TAKER = WRAPPED_SOL_MINT;
const RECIPIENT = TAKER;
const RECIPIENT_ATA = await associatedUsdc(RECIPIENT);
const AMM = "675kPX9MHTjS2zt1qfr1NYHuzeLsM4vQKhBXmaQ5aqUJ";
const BPF_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const ZERO_HASH = "0".repeat(64);

function quoteWire(): Record<string, unknown> {
  return { inputMint: WRAPPED_SOL_MINT, inAmount: "1000000", outputMint: SOLANA_USDC_MINT, outAmount: "150000",
    otherAmountThreshold: "148500", swapMode: "ExactIn", slippageBps: 100, priceImpactPct: "0.01",
    routePlan: [{ percent: 100, swapInfo: { ammKey: AMM, label: "Raydium", inputMint: WRAPPED_SOL_MINT,
      outputMint: SOLANA_USDC_MINT, inAmount: "1000000", outAmount: "150000", feeAmount: "10", feeMint: WRAPPED_SOL_MINT } }],
    contextSlot: 123, timeTaken: 0.02 };
}

function computeLimit(units = 200_000): Instruction {
  const data = Buffer.alloc(5); data[0] = 2; data.writeUInt32LE(units, 1);
  return { programAddress: address(COMPUTE_BUDGET_PROGRAM), data };
}
function jupiterInstruction(program: string = JUPITER_V6_PROGRAM): Instruction {
  return { programAddress: address(program), accounts: [
    { address: address(TAKER), role: AccountRole.READONLY_SIGNER },
    { address: address(RECIPIENT_ATA), role: AccountRole.WRITABLE },
  ], data: new Uint8Array([1, 2, 3]) };
}
function jupiterLookupInstruction(tableAddress: string): Instruction {
  return { programAddress: address(JUPITER_V6_PROGRAM), accounts: [
    { address: address(TAKER), role: AccountRole.READONLY_SIGNER },
    { address: address(RECIPIENT_ATA), role: AccountRole.WRITABLE, addressIndex: 0, lookupTableAddress: address(tableAddress) },
  ], data: new Uint8Array([1, 2, 3]) } as Instruction;
}
function transaction(instructions: readonly Instruction[] = [computeLimit(), jupiterInstruction()]): string {
  const payer = createNoopSigner(address(TAKER));
  const message = appendTransactionMessageInstructions(instructions,
    setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(SYSTEM_PROGRAM), lastValidBlockHeight: 999n },
      setTransactionMessageFeePayerSigner(payer, createTransactionMessage({ version: 0 }))));
  return getBase64EncodedWireTransaction(compileTransaction(message));
}
class Resolver implements SolanaAccountResolverPort {
  constructor(private readonly mutate?: (descriptor: SolanaAccountDescriptor) => SolanaAccountDescriptor) {}
  async resolveAddressTables(_addresses: readonly string[]): Promise<readonly SolanaAddressTableDescriptor[]> { return []; }
  async resolveAccounts(addresses: readonly string[]): Promise<readonly SolanaAccountDescriptor[]> {
    return addresses.map((item) => this.mutate?.(descriptor(item)) ?? descriptor(item));
  }
}
class AltResolver extends Resolver {
  constructor(private readonly tableAddress: string, private readonly tableDataHash = sha256("table"), private readonly tableOwner: string = ADDRESS_LOOKUP_TABLE_PROGRAM) { super(); }
  override async resolveAddressTables(addresses: readonly string[]): Promise<readonly SolanaAddressTableDescriptor[]> { assert.deepEqual(addresses, [this.tableAddress]);
    return [{ address: this.tableAddress, owner: this.tableOwner, executable: false, dataHash: this.tableDataHash, addresses: [RECIPIENT_ATA] }]; }
}
function descriptor(item: string): SolanaAccountDescriptor {
  const executable = item === COMPUTE_BUDGET_PROGRAM || item === JUPITER_V6_PROGRAM || item === AMM;
  return { address: item, owner: executable ? BPF_LOADER : SYSTEM_PROGRAM, executable, dataHash: sha256(item) };
}
function policy(overrides: Partial<JupiterGuardPolicy> = {}): JupiterGuardPolicy {
  return { taker: TAKER, recipient: RECIPIENT, recipientTokenAccount: RECIPIENT_ATA, requestId: "request_12345678", blockhash: SYSTEM_PROGRAM,
    now: "2026-09-17T00:00:00.000Z",
    lastValidBlockHeight: "999", maximumComputeUnits: 300_000, maximumComputeUnitPriceMicroLamports: "0",
    maximumPriorityFeeLamports: "0", maximumTipLamports: "0", allowedTipAccounts: [], maximumPlatformFeeAtomic: "0",
    maximumReferralFeeAtomic: "0", maximumRentLamports: "3000000", maximumWrappedSolSpendLamports: "1000000", ...overrides };
}
function buildWire(raw = transaction(), overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { requestId: "request_12345678", swapTransaction: raw, lastValidBlockHeight: "999", rfqExpiresAt: null,
    prioritizationFeeLamports: "0", tipLamports: "0", rentFeeLamports: "0", platformFeeAtomic: "0", referralFeeAtomic: "0", ...overrides };
}

test("program snapshots are sorted, immutable in shape, and default deny", () => {
  assert.equal(EMPTY_PROGRAM_SNAPSHOT.entries.length, 0);
  const snapshot = createProgramSnapshot([{ programId: AMM, label: "Raydium" }]);
  assert.equal(validateProgramSnapshot(snapshot).digest, snapshot.digest);
  assert.throws(() => validateProgramSnapshot({ ...snapshot, digest: ZERO_HASH }), (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_CORRUPT");
  assert.throws(() => createProgramSnapshot([{ programId: JUPITER_V6_PROGRAM, label: "shadow" }]));
});

test("quote/build codecs bind exact pair, exact-input mode, requestId, and canonical bytes", () => {
  const quote = decodeQuoteResponse(quoteWire()); assert.equal(quote.inputMint, WRAPPED_SOL_MINT); assert.match(quote.responseHash, /^[a-f0-9]{64}$/u);
  assert.throws(() => decodeQuoteResponse({ ...quoteWire(), unexpected: true }));
  assert.throws(() => decodeQuoteResponse({ ...quoteWire(), swapMode: "ExactOut" }));
  const built = decodeBuildResponse(buildWire());
  assert.match(built.responseHash, /^[a-f0-9]{64}$/u);
  const ordered = decodeOrderResponse({ requestId: "request_12345678", transaction: transaction(), lastValidBlockHeight: "999", rfqExpiresAt: null, quote: quoteWire() });
  assert.equal(ordered.quote.responseHash, quote.responseHash);
  assert.throws(() => decodeBuildResponse(buildWire(`${transaction()}=`)));
});

test("V0 address tables bind owner, data digest, index order, and loaded account roles", async () => {
  const table = AMM; const raw = transaction([computeLimit(), jupiterLookupInstruction(table)]);
  const first = await parseJupiterV0Envelope(raw, new AltResolver(table));
  const second = await parseJupiterV0Envelope(raw, new AltResolver(table, sha256("different table bytes")));
  assert.notEqual(first.lookupBindingDigest, second.lookupBindingDigest);
  assert.equal(first.accounts.find((item) => item.address === RECIPIENT_ATA)?.source, "lookup");
  const build = decodeBuildResponse(buildWire(raw)); const quote = decodeQuoteResponse(quoteWire());
  const refusal = await guardJupiterTransaction(first, quote, build, policy(), EMPTY_PROGRAM_SNAPSHOT); assert.equal(refusal.signable, false);
  const wrongOwner = await parseJupiterV0Envelope(raw, new AltResolver(table, sha256("table"), SYSTEM_PROGRAM));
  await assert.rejects(guardJupiterTransaction(wrongOwner, quote, build, policy(), EMPTY_PROGRAM_SNAPSHOT), /lookup table owner/u);
});

test("V0 envelope is fully bound but JUP6 remains stably non-signable", async () => {
  const envelope = await parseJupiterV0Envelope(transaction(), new Resolver());
  assert.equal(envelope.signerCount, 1); assert.equal(envelope.feePayer, TAKER); assert.equal(envelope.addressTables.length, 0);
  const refusal = await guardJupiterTransaction(envelope, decodeQuoteResponse(quoteWire()), decodeBuildResponse(buildWire(envelope.transactionBase64)), policy(), EMPTY_PROGRAM_SNAPSHOT);
  assert.equal(refusal.signable, false); assert.equal(refusal.code, "JUPITER_V6_INSTRUCTION_UNVERIFIED");
  assert.throws(() => assertJupiterSignable(refusal), (error: unknown) => error instanceof ApnError && error.code === "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
});

test("unknown programs, writable executables, compute inflation, and owner drift fail closed", async () => {
  const unknown = await parseJupiterV0Envelope(transaction([computeLimit(), jupiterInstruction(AMM)]), new Resolver());
  await assert.rejects(guardJupiterTransaction(unknown, decodeQuoteResponse(quoteWire()), decodeBuildResponse(buildWire(unknown.transactionBase64)), policy(), EMPTY_PROGRAM_SNAPSHOT), /unpinned program/u);
  const inflated = await parseJupiterV0Envelope(transaction([computeLimit(400_000), jupiterInstruction()]), new Resolver());
  await assert.rejects(guardJupiterTransaction(inflated, decodeQuoteResponse(quoteWire()), decodeBuildResponse(buildWire(inflated.transactionBase64)), policy(), EMPTY_PROGRAM_SNAPSHOT), /exceeds policy/u);
  await assert.rejects(parseJupiterV0Envelope(transaction(), new Resolver((item) => item.address === RECIPIENT_ATA ? { ...item, executable: true } : item)), /executable account writable/u);
  await assert.rejects(parseJupiterV0Envelope(transaction(), new Resolver((item) => item.address === JUPITER_V6_PROGRAM ? { ...item, executable: false } : item)), /program account is invalid/u);
});

test("request, RFQ expiry, fee reports, and recipient ATA drift fail closed", async () => {
  const envelope = await parseJupiterV0Envelope(transaction(), new Resolver()); const quote = decodeQuoteResponse(quoteWire());
  await assert.rejects(guardJupiterTransaction(envelope, quote, decodeBuildResponse(buildWire(envelope.transactionBase64,
    { requestId: "different_123456" })), policy(), EMPTY_PROGRAM_SNAPSHOT), /requestId/u);
  await assert.rejects(guardJupiterTransaction(envelope, quote, decodeBuildResponse(buildWire(envelope.transactionBase64,
    { rfqExpiresAt: "2026-09-16T23:59:59.000Z" })), policy(), EMPTY_PROGRAM_SNAPSHOT), /expired/u);
  await assert.rejects(guardJupiterTransaction(envelope, quote, decodeBuildResponse(buildWire(envelope.transactionBase64,
    { rentFeeLamports: "3000001" })), policy(), EMPTY_PROGRAM_SNAPSHOT), /fee fields/u);
  await assert.rejects(guardJupiterTransaction(envelope, quote, decodeBuildResponse(buildWire(envelope.transactionBase64)),
    policy({ recipientTokenAccount: SOLANA_USDC_MINT }), EMPTY_PROGRAM_SNAPSHOT), /ATA derivation/u);
});

test("simulation proof uses exact non-replacing unsigned request and rejects chain errors", async () => {
  const envelope = await parseJupiterV0Envelope(transaction(), new Resolver()); let captured: readonly unknown[] | undefined;
  const proof = await proveJupiterSimulation({ call: async (method, params) => { assert.equal(method, "simulateTransaction"); captured = params;
    return { context: { slot: 123 }, value: { err: null, logs: ["Program log: ok"], unitsConsumed: 20_000, accounts: null, returnData: null } }; } }, envelope, 100);
  assert.equal(proof.success, true); assert.deepEqual((captured?.[1] as Record<string, unknown>),
    { encoding: "base64", commitment: "processed", sigVerify: false, replaceRecentBlockhash: false, minContextSlot: 100 });
  await assert.rejects(proveJupiterSimulation({ call: async () => ({ context: { slot: 123 }, value: {
    err: "BlockhashNotFound", logs: [], unitsConsumed: 0, accounts: null, returnData: null } }) }, envelope, 100), /exact successful proof/u);
});

test("finalized receipt binds status, v0 loaded addresses, spend, fee, and recipient output", async () => {
  const envelope = await parseJupiterV0Envelope(transaction(), new Resolver()); const signature = "2".repeat(88);
  const keys = envelope.accounts.map((item) => item.address); const takerIndex = keys.indexOf(TAKER); const recipientIndex = keys.indexOf(RECIPIENT_ATA);
  const preBalances = keys.map(() => 0); const postBalances = keys.map(() => 0); preBalances[takerIndex] = 2_000_000; postBalances[takerIndex] = 995_000;
  const transactionResult = { slot: 500, blockTime: 1_790_000_000, version: 0, meta: { err: null, fee: 5_000,
    loadedAddresses: { writable: [], readonly: [] }, preBalances, postBalances, preTokenBalances: [],
    postTokenBalances: [{ accountIndex: recipientIndex, mint: SOLANA_USDC_MINT, owner: RECIPIENT,
      uiTokenAmount: { amount: "148500", decimals: 6 } }] },
    transaction: { signatures: [signature], message: { recentBlockhash: SYSTEM_PROGRAM, accountKeys: keys } } };
  const reader = { call: async (method: string) => method === "getSignatureStatuses"
    ? { context: { slot: 501 }, value: [{ slot: 500, confirmationStatus: "finalized", confirmations: null, err: null }] }
    : transactionResult };
  const receipt = await validateFinalizedJupiterReceipt(reader, envelope, { signature, taker: TAKER, recipient: RECIPIENT,
    recipientTokenAccount: RECIPIENT_ATA, minimumOutputAtomic: "148500", maximumTotalNativeSpendLamports: "1005000",
    maximumNetworkFeeLamports: "5000", expectedLoadedWritable: [], expectedLoadedReadonly: [] });
  assert.equal(receipt.recipientOutputAtomic, "148500"); assert.equal(receipt.nativeSpendLamports, "1005000");
  await assert.rejects(validateFinalizedJupiterReceipt(reader, envelope, { signature, taker: TAKER, recipient: RECIPIENT,
    recipientTokenAccount: RECIPIENT_ATA, minimumOutputAtomic: "148501", maximumTotalNativeSpendLamports: "1005000",
    maximumNetworkFeeLamports: "5000", expectedLoadedWritable: [], expectedLoadedReadonly: [] }), /below minimum/u);
});
