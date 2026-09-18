import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PERMIT2_ADDRESS as X402_PERMIT2, permit2WitnessTypes, x402ExactPermit2ProxyAddress } from "@x402/evm";
import { hashDomain, hashTypedData, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadAllowlistInventory } from "../../src/allowlist-inventory.js";
import { ApnError } from "../../src/errors.js";
import type { Address, Hex } from "../../src/model.js";
import { TtyPermit2Approval, permit2ApprovalScreen } from "../../src/x402-permit2/approval.js";
import {
  EIP2612_PERMIT_TYPES, PERMIT2_WITNESS_TYPES, assemblePermit2Payment, planPermit2Authorization, type Permit2SignerPort, type Permit2TypedData,
} from "../../src/x402-permit2/authorization.js";
import { selectPermit2Offer, validatePermit2Selection, type Permit2OfferSelection } from "../../src/x402-permit2/offer.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS } from "../../src/x402-permit2/registry.js";
import { permit2NonceBitmapCall, permit2NonceConsumed, verifyPermit2SettlementReceipt } from "../../src/x402-permit2/settlement.js";

const ACCEPTS = (JSON.parse(readFileSync("tests/fixtures/x402-permit2/payment-required-accepts.json", "utf8")) as { accepts: Record<string, unknown>[] }).accepts;
const RECEIPT = JSON.parse(readFileSync("tests/fixtures/x402-permit2/settlement-receipt-with-permit.json", "utf8")) as {
  payer: Address; payTo: Address; amountAtomic: string; receipt: Record<string, unknown> & { logs: Record<string, unknown>[] } };
const AVAX = X402_PERMIT2_ASSETS[0]!;
const NOW_SECONDS = 1_789_720_000;
const offer = (index: number, patch: Record<string, unknown> = {}) => ({ ...structuredClone(ACCEPTS[index]!), ...patch });
const reason = (expected: string) => (error: unknown) => error instanceof ApnError && error.details?.reason === expected;

class LocalTestSigner implements Permit2SignerPort {
  readonly calls: Permit2TypedData[] = [];
  constructor(private readonly key: Hex) {}
  async signPermit2Material(_address: Address, typedData: Permit2TypedData): Promise<Hex> {
    this.calls.push(typedData);
    return await privateKeyToAccount(this.key).signTypedData(typedData as never);
  }
}

async function recover(typedData: Permit2TypedData, signature: Hex): Promise<string> {
  return await recoverTypedDataAddress({ ...typedData, signature } as unknown as Parameters<typeof recoverTypedDataAddress>[0]);
}
function selectionFor(payer: Address): Permit2OfferSelection { return selectPermit2Offer(ACCEPTS, payer); }

test("pins match the x402 packages, the frozen allowlist and the on-chain token domain", () => {
  assert.equal(PERMIT2_ADDRESS, X402_PERMIT2);
  assert.equal(X402_EXACT_PERMIT2_PROXY, x402ExactPermit2ProxyAddress);
  assert.deepEqual(PERMIT2_WITNESS_TYPES, permit2WitnessTypes);
  const listed = loadAllowlistInventory().assets.find((row) => row.chain === AVAX.chain && row.identifier === AVAX.token);
  assert.equal(listed?.symbol, "USDT");
  assert.equal(listed?.decimals, AVAX.decimals);
  assert.equal(hashDomain({ domain: { ...AVAX.tokenDomain, chainId: BigInt(AVAX.chainId), verifyingContract: AVAX.token },
    types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" }] } }), AVAX.tokenDomainSeparator);
});

test("selection keeps the seller's original index and exact requirement and skips unsupported offers", () => {
  const payer = privateKeyToAccount(generatePrivateKey()).address;
  const selected = selectionFor(payer);
  assert.equal(selected.index, 1);
  assert.deepEqual(selected.requirement, ACCEPTS[1]);
  assert.equal(selected.amountAtomic, "10000");
  assert.equal(selected.listAsset.chain, "eip155:43114");
  assert.match(selected.offerHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(validatePermit2Selection(selected, payer), selected);
  assert.throws(() => validatePermit2Selection({ ...selected, requirement: { ...selected.requirement, amount: "10001" } }, payer),
    (error: unknown) => error instanceof ApnError && error.code === "APN_STATE_CORRUPT");
  const minimalExtra = selectPermit2Offer([offer(1, { extra: { assetTransferMethod: "permit2" } })], payer);
  assert.equal(minimalExtra.index, 0);
});

test("selection refuses every deviation from the pinned Permit2 offer", () => {
  const payer = privateKeyToAccount(generatePrivateKey()).address;
  const invalid = [
    offer(1, { extra: { name: "TetherToken", version: "1" } }),
    offer(1, { extra: { assetTransferMethod: "eip3009", name: "TetherToken", version: "1" } }),
    offer(1, { extra: { assetTransferMethod: "permit2", name: "Tether USD", version: "1" } }),
    offer(1, { extra: { assetTransferMethod: "permit2", name: "TetherToken", version: "1", facilitator: "x" } }),
    offer(1, { resource: "https://seller.example/r" }),
    offer(1, { scheme: "upto" }),
    offer(1, { maxTimeoutSeconds: 301 }),
    offer(1, { maxTimeoutSeconds: 0 }),
    offer(1, { amount: "0" }),
    offer(1, { amount: "010" }),
    offer(1, { amount: (1n << 256n).toString() }),
    offer(1, { payTo: payer }),
    offer(1, { payTo: X402_EXACT_PERMIT2_PROXY }),
    offer(1, { payTo: PERMIT2_ADDRESS }),
    offer(1, { payTo: "0x0000000000000000000000000000000000000000" }),
  ];
  for (const candidate of invalid) assert.throws(() => selectPermit2Offer([candidate], payer), reason("x402_permit2_offer_invalid"), JSON.stringify(candidate));
  assert.throws(() => selectPermit2Offer([offer(2)], payer), reason("x402_permit2_facilitator_unavailable"));
  assert.throws(() => selectPermit2Offer([offer(0), offer(3)], payer), reason("x402_permit2_no_listed_offer"));
  assert.throws(() => selectPermit2Offer([], payer), reason("x402_permit2_no_listed_offer"));
  const badChecksum = offer(1, { asset: "0x9702230a8Ea53601f5cD2dc00fDBc13d4dF4A8c7" });
  assert.throws(() => selectPermit2Offer([badChecksum], payer), reason("x402_permit2_no_listed_offer"));
  assert.equal(selectPermit2Offer([offer(1, { asset: AVAX.token.toLowerCase() })], payer).listAsset.token, AVAX.token);
});

test("an allowance-covered payment signs one Permit2 witness transfer equal to the x402 package's digest", async () => {
  const key = generatePrivateKey(), payer = privateKeyToAccount(key).address, selection = selectionFor(payer);
  const plan = planPermit2Authorization(selection, { payer, nowSeconds: NOW_SECONDS, nonce: 12345678901234567890n,
    permit2AllowanceAtomic: "10000", eip2612Nonce: null, sellerSponsorsEip2612: false });
  assert.equal(plan.eip2612, null);
  assert.deepEqual(plan.authorization, { from: payer, permitted: { token: AVAX.token, amount: "10000" }, spender: X402_EXACT_PERMIT2_PROXY,
    nonce: "12345678901234567890", deadline: String(NOW_SECONDS + 60), witness: { to: selection.payTo, validAfter: "0" } });
  const packageDigest = hashTypedData({ domain: { name: "Permit2", chainId: 43114, verifyingContract: X402_PERMIT2 }, types: permit2WitnessTypes,
    primaryType: "PermitWitnessTransferFrom", message: { permitted: { token: AVAX.token, amount: 10000n }, spender: x402ExactPermit2ProxyAddress,
      nonce: 12345678901234567890n, deadline: BigInt(NOW_SECONDS + 60), witness: { to: selection.payTo, validAfter: 0n } } });
  assert.equal(hashTypedData(plan.permit2 as never), packageDigest);
  const signer = new LocalTestSigner(key);
  const payment = await assemblePermit2Payment(plan, signer) as Record<string, any>;
  assert.equal(signer.calls.length, 1);
  assert.deepEqual(Object.keys(payment).sort(), ["accepted", "payload", "x402Version"]);
  assert.deepEqual(payment.accepted, ACCEPTS[1]);
  assert.deepEqual(payment.payload.permit2Authorization, plan.authorization);
  assert.equal(await recover(plan.permit2, payment.payload.signature), payer);
});

test("a short allowance adds one exact-amount EIP-2612 permit only when the seller sponsors it", async () => {
  const key = generatePrivateKey(), payer = privateKeyToAccount(key).address, selection = selectionFor(payer);
  const input = { payer, nowSeconds: NOW_SECONDS, nonce: 7n, permit2AllowanceAtomic: "9999", eip2612Nonce: 3n, sellerSponsorsEip2612: true };
  const plan = planPermit2Authorization(selection, input);
  assert.deepEqual(plan.eip2612?.info, { from: payer, asset: AVAX.token, spender: PERMIT2_ADDRESS, amount: "10000", nonce: "3",
    deadline: String(NOW_SECONDS + 60), version: "1" });
  assert.deepEqual(plan.eip2612?.typedData.types, EIP2612_PERMIT_TYPES);
  const payment = await assemblePermit2Payment(plan, new LocalTestSigner(key)) as Record<string, any>;
  const info = payment.extensions.eip2612GasSponsoring.info;
  assert.deepEqual(Object.keys(payment.extensions), ["eip2612GasSponsoring"]);
  assert.equal(await recover(plan.eip2612!.typedData, info.signature), payer);
  assert.notEqual(planPermit2Authorization(selection, { ...input, nonce: 8n }).planHash, plan.planHash);
  assert.throws(() => planPermit2Authorization(selection, { ...input, sellerSponsorsEip2612: false }), reason("x402_permit2_allowance_required"));
  assert.throws(() => planPermit2Authorization(selection, { ...input, eip2612Nonce: null }),
    (error: unknown) => error instanceof ApnError && error.code === "APN_INVALID_INPUT");
  assert.throws(() => planPermit2Authorization(selection, { ...input, payer: selection.payTo }),
    (error: unknown) => error instanceof ApnError && error.code === "APN_INVALID_INPUT");
});

test("a signature that is not the frozen payer's never leaves APN", async () => {
  const payer = privateKeyToAccount(generatePrivateKey()).address, selection = selectionFor(payer);
  const plan = planPermit2Authorization(selection, { payer, nowSeconds: NOW_SECONDS, nonce: 1n, permit2AllowanceAtomic: "10000",
    eip2612Nonce: null, sellerSponsorsEip2612: false });
  await assert.rejects(assemblePermit2Payment(plan, new LocalTestSigner(generatePrivateKey())),
    (error: unknown) => error instanceof ApnError && error.code === "APN_WALLET_MISMATCH");
  await assert.rejects(assemblePermit2Payment(plan, { signPermit2Material: async () => "0x1234" as Hex }),
    (error: unknown) => error instanceof ApnError && error.code === "APN_NATIVE_PROTOCOL");
});

test("settlement is proven only by one exact token transfer and one matching proxy event", () => {
  const expected = { listAsset: AVAX, payer: RECEIPT.payer, payTo: RECEIPT.payTo, amountAtomic: RECEIPT.amountAtomic,
    transactionHash: RECEIPT.receipt.transactionHash as Hex, withPermit: true };
  const proof = verifyPermit2SettlementReceipt(RECEIPT.receipt, expected);
  assert.deepEqual(proof, { transactionHash: RECEIPT.receipt.transactionHash, blockHash: RECEIPT.receipt.blockHash,
    blockNumber: BigInt(RECEIPT.receipt.blockNumber as string).toString(), transferLogIndex: "17", settledEvent: "SettledWithPermit" });
  const invalid = (patch: (receipt: Record<string, any>) => void, overrides: Record<string, unknown> = {}) => {
    const receipt = structuredClone(RECEIPT.receipt) as Record<string, any>;
    patch(receipt);
    assert.throws(() => verifyPermit2SettlementReceipt(receipt, { ...expected, ...overrides }),
      (error: unknown) => error instanceof ApnError && error.code === "APN_X402_SETTLEMENT_INVALID");
  };
  invalid((r) => { r.status = "0x0"; });
  invalid(() => undefined, { withPermit: false });
  invalid(() => undefined, { amountAtomic: "10001" });
  invalid(() => undefined, { transactionHash: `0x${"ef".repeat(32)}` });
  invalid((r) => { r.logs.push(structuredClone(r.logs[1])); });
  invalid((r) => { r.logs.splice(2, 1); });
  invalid((r) => { r.logs[1].removed = true; });
  invalid((r) => { r.logs[1].address = "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e"; });
  invalid((r) => { r.logs[1].topics[2] = `0x${"0".repeat(24)}${"11".repeat(20)}`; });
  invalid((r) => { r.logs[2].address = "0x4020a4f3b7b90cca423b9fabcc0ce57c6c240002"; });
  invalid((r) => { r.logs = "none"; });
});

test("the Permit2 nonce word is read exactly and a consumed bit is detected", () => {
  const owner = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as Address;
  const call = permit2NonceBitmapCall(owner, ((5n << 8n) | 3n).toString());
  assert.equal(call.to, PERMIT2_ADDRESS);
  assert.equal(call.data, `0x4fe02b44${"0".repeat(24)}5b38da6a701c568545dcfcb03fcb875f56beddc4${"0".repeat(63)}5`);
  assert.equal(permit2NonceConsumed(`0x${"0".repeat(63)}8`, "3"), true);
  assert.equal(permit2NonceConsumed(`0x${"0".repeat(63)}8`, "2"), false);
  assert.throws(() => permit2NonceConsumed("0x08", "3"), (error: unknown) => error instanceof ApnError && error.code === "APN_RPC_PROTOCOL");
  assert.throws(() => permit2NonceBitmapCall(owner, "-1"), (error: unknown) => error instanceof ApnError && error.code === "APN_INVALID_INPUT");
});

test("the foreground screen binds every signed field and needs the exact typed code", async () => {
  const payer = privateKeyToAccount(generatePrivateKey()).address, selection = selectionFor(payer);
  const plan = planPermit2Authorization(selection, { payer, nowSeconds: NOW_SECONDS, nonce: 9n, permit2AllowanceAtomic: "0",
    eip2612Nonce: 0n, sellerSponsorsEip2612: true });
  const summary = { profile: "avalanche-local", operationId: "op-1", resourceOrigin: "https://seller.example", plan,
    binding: { schemaVersion: "apn.x402-permit2-allowlist.v1" as const, policyDigest: "a".repeat(64), policyRevision: 2 },
    caps: { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "10000000" }, dailyUsageAtomic: "0",
    approveBefore: new Date(Date.now() + 60_000).toISOString() };
  const screen = permit2ApprovalScreen(summary);
  const text = screen.lines.join("\n");
  for (const needle of ["0.01 USDT (10000 atomic)", selection.payTo, X402_EXACT_PERMIT2_PROXY, PERMIT2_ADDRESS, "never an unlimited approval",
    "eip155:43114", "Owner policy revision 2", screen.fingerprint]) assert.ok(text.includes(needle), needle);
  const other = planPermit2Authorization(selectPermit2Offer([offer(1, { amount: "10001" })], payer), { payer, nowSeconds: NOW_SECONDS, nonce: 9n,
    permit2AllowanceAtomic: "0", eip2612Nonce: 0n, sellerSponsorsEip2612: true });
  assert.notEqual(permit2ApprovalScreen({ ...summary, plan: other }).fingerprint, screen.fingerprint);
  const terminal = (answer: string) => new TtyPermit2Approval({ isTerminal: () => true, openTerminal: async () => ({ fd: 11,
    write: async () => undefined, read: async function* () { yield Buffer.from(`${answer}\n`); }, close: async () => undefined }) });
  assert.equal(await terminal(screen.code).confirm(screen, summary.approveBefore), true);
  assert.equal(await terminal("000000").confirm(screen, summary.approveBefore), false);
  await assert.rejects(new TtyPermit2Approval({ openTerminal: async () => { throw new Error("no tty"); } }).confirm(screen, summary.approveBefore));
});
