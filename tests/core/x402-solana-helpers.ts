import { address, createKeyPairSignerFromPrivateKeyBytes, getBase58Decoder, getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder,
  getTransactionDecoder, partiallySignTransaction } from "@solana/kit";
import { getMintEncoder, getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { sha256 } from "../../src/canonical.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { SOLANA_GENESIS, SOLANA_USDC } from "../../src/chain-policy.js";
import { associatedToken } from "../../src/solana/accounts.js";
import type { SolanaBatchRead, SolanaMethod, SolanaRpcPort } from "../../src/solana/rpc.js";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "../../src/x402-codec.js";
import type { HttpGetRequest, HttpObservation, HttpPort } from "../../src/x402-model.js";
import { X402_SOLANA_MECHANISM, X402_SOLANA_NETWORK } from "../../src/x402-solana/constants.js";
import { SOLANA_CHAIN, activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { SolanaWrapping } from "./solana-helpers.js";
import { challengeObservation, paidObservation } from "./x402-helpers.js";
import { X402_URL } from "./x402-vectors.js";

export const SOL_PAYEE = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const FEE_PAYER_SEED = Buffer.alloc(32, 9), PAYER_SEED = Buffer.alloc(32, 47);
const base58 = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);
export const OLD_SIGNATURE = base58(Buffer.alloc(64, 3));
export const feePayerAddress = async () => (await createKeyPairSignerFromPrivateKeyBytes(FEE_PAYER_SEED)).address as string;

export function solanaOffer(feePayer: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { scheme: "exact", network: X402_SOLANA_NETWORK, amount: "10000", asset: SOLANA_USDC, payTo: SOL_PAYEE, maxTimeoutSeconds: 60,
    extra: { feePayer }, ...overrides };
}

/** A synthetic Solana mainnet: the mint and both token accounts, heights per commitment, and one landed transaction. */
export class X402SolanaTestRpc implements SolanaRpcPort {
  readonly originHash = sha256("synthetic_x402_solana_rpc");
  readonly calls: SolanaMethod[] = [];
  payer = ""; source = ""; destination = "";
  mintOwner: string = TOKEN_PROGRAM_ADDRESS; decimals = 6; balance = 50_000_000n; destinationExists = true;
  heights: Record<"confirmed" | "finalized", bigint> = { confirmed: 900n, finalized: 880n };
  contextSlot = 5_000n; blockhash = base58(Buffer.alloc(32, 5));
  index: { signature: string; slot: bigint }[] = [{ signature: OLD_SIGNATURE, slot: 4_000n }];
  landed: { readonly signature: string; readonly slot: bigint; readonly wire: string; readonly success: boolean } | null = null;
  async bind(payer: string): Promise<void> {
    this.payer = payer; this.source = await associatedToken(payer, SOLANA_USDC); this.destination = await associatedToken(SOL_PAYEE, SOLANA_USDC);
  }
  async call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown> { this.calls.push(method); return this.respond(method, params); }
  async batch(reads: readonly SolanaBatchRead[]): Promise<readonly unknown[]> {
    return await Promise.all(reads.map((read) => { this.calls.push(read.method); return this.respond(read.method, read.params); }));
  }
  /** The facilitator co-signs as fee payer and lands exactly the bytes it received. */
  async land(rawPayload: string, success = true, slot = 5_100n): Promise<string> {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(FEE_PAYER_SEED);
    const decoded = getTransactionDecoder().decode(Buffer.from(rawPayload, "base64")) as unknown as Parameters<typeof partiallySignTransaction>[1];
    const signed = await partiallySignTransaction([signer.keyPair], decoded);
    const signature = base58((signed.signatures as Record<string, Uint8Array>)[signer.address]!);
    this.landed = { signature, slot, wire: getBase64EncodedWireTransaction(signed), success };
    this.index.unshift({ signature, slot });
    return signature;
  }
  private respond(method: SolanaMethod, params: readonly unknown[]): unknown {
    const commitment = ((params[0] ?? {}) as { commitment?: "confirmed" | "finalized" }).commitment ?? "finalized";
    switch (method) {
      case "getGenesisHash": return SOLANA_GENESIS;
      case "getBlockHeight": return this.heights[commitment];
      case "getLatestBlockhash": return { context: { slot: this.contextSlot },
        value: { blockhash: this.blockhash, lastValidBlockHeight: this.heights[commitment] + 150n } };
      case "getMultipleAccounts": return { context: { slot: this.contextSlot }, value: (params[0] as string[]).map((key) => this.account(key)) };
      case "simulateTransaction": return { context: { slot: this.contextSlot }, value: { err: null, unitsConsumed: 6_000n, logs: [] } };
      case "getSignaturesForAddress": return this.index.map((entry) => ({ signature: entry.signature, slot: entry.slot, err: null, memo: null,
        blockTime: 1_760_000_000n, confirmationStatus: "finalized" }));
      case "getSignatureStatuses": {
        const [signature] = params[0] as string[];
        const found = this.landed?.signature === signature ? this.landed : null;
        return { context: { slot: 6_000n }, value: [found === null ? null : { slot: found.slot, confirmations: null, err: this.error(found.success),
          confirmationStatus: "finalized" }] };
      }
      case "getTransaction": { const landed = this.landed; return landed !== null && landed.signature === params[0] ? this.transaction(landed) : null; }
      default: throw new Error(`unexpected ${method}`);
    }
  }
  private error(success: boolean): unknown { return success ? null : { InstructionError: [2n, { Custom: 1n }] }; }
  private transaction(landed: NonNullable<X402SolanaTestRpc["landed"]>): unknown {
    const keys = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(landed.wire, "base64")).messageBytes).staticAccounts.map(String);
    const row = (account: string, owner: string, amount: bigint) => ({ accountIndex: BigInt(keys.indexOf(account)), mint: SOLANA_USDC, owner,
      programId: TOKEN_PROGRAM_ADDRESS, uiTokenAmount: { amount: amount.toString(), decimals: 6n, uiAmount: null, uiAmountString: "0" } });
    const moved = landed.success ? 10_000n : 0n;
    return { slot: landed.slot, blockTime: 1_760_000_000n, version: 0n, transaction: [landed.wire, "base64"], meta: { err: this.error(landed.success),
      fee: 5_000n, preBalances: [], postBalances: [], preTokenBalances: [row(this.source, this.payer, this.balance), row(this.destination, SOL_PAYEE, 0n)],
      postTokenBalances: [row(this.source, this.payer, this.balance - moved), row(this.destination, SOL_PAYEE, moved)] } };
  }
  private account(key: string): unknown {
    const info = (owner: string, encoded: unknown) => { const data = Buffer.from(encoded as Uint8Array); return { owner, data: [data.toString("base64"), "base64"], executable: false,
      lamports: 2_039_280n, rentEpoch: 0n, space: BigInt(data.length) }; };
    if (key === SOLANA_USDC) return info(this.mintOwner, getMintEncoder().encode({ mintAuthority: null, supply: 10n ** 15n, decimals: this.decimals,
      isInitialized: true, freezeAuthority: null }));
    if (key === this.source || (key === this.destination && this.destinationExists)) return info(TOKEN_PROGRAM_ADDRESS, getTokenEncoder().encode({
      mint: address(SOLANA_USDC), owner: address(key === this.source ? this.payer : SOL_PAYEE), amount: key === this.source ? this.balance : 0n,
      delegate: null, state: 1, isNative: null, delegatedAmount: 0n, closeAuthority: null }));
    return null;
  }
}

/** A seller whose facilitator lands what it receives; it may omit its PAYMENT-RESPONSE or refuse the payment. */
export class SolanaSeller implements HttpPort {
  readonly calls: HttpGetRequest[] = [];
  mode: "settle_with_hint" | "settle_without_hint" | "refuse" = "settle_with_hint";
  offers: readonly unknown[] = [];
  received: string | undefined;
  constructor(private readonly rpc: X402SolanaTestRpc) {}
  async get(request: HttpGetRequest): Promise<HttpObservation> {
    this.calls.push(request);
    if (request.paymentSignature === undefined) return challengeObservation({ header: encodePaymentRequiredHeader({ x402Version: 2,
      resource: { url: X402_URL, description: "Bounded JSON result", mimeType: "application/json" }, accepts: this.offers } as never) });
    this.received = (decodePaymentSignatureHeader(request.paymentSignature).payload as { readonly transaction: string }).transaction;
    if (this.mode === "refuse") return paidObservation({ status: 402, bodyText: "{}" });
    const signature = await this.rpc.land(this.received);
    const header = Buffer.from(JSON.stringify({ success: true, transaction: signature, network: X402_SOLANA_NETWORK, payer: await feePayerAddress() })).toString("base64");
    return paidObservation(this.mode === "settle_with_hint" ? { paymentResponseHeader: header } : {});
  }
}

export async function solanaX402Fixture(root: string) {
  const accounts = new ChainAccountStore(root, new SolanaWrapping());
  const account = await accounts.ensureLocal({ profile: "default", rail: "solana", create: async () => {
    const seed = Buffer.from(PAYER_SEED); const signer = await createKeyPairSignerFromPrivateKeyBytes(seed); return { seed, address: signer.address };
  } });
  const rpc = new X402SolanaTestRpc(); await rpc.bind(account.address);
  const seller = new SolanaSeller(rpc); seller.offers = [solanaOffer(await feePayerAddress())];
  const screens: string[] = [];
  let refuse = false;
  const tty = { isTerminal: () => true, openTerminal: async () => {
    let phrase = "";
    return { fd: 1, write: async (text: string) => { screens.push(text); phrase = /Type ([a-f0-9]{6})/u.exec(text)?.[1] ?? phrase; },
      read: async function* () { yield Buffer.from(`${refuse ? "000000" : phrase}\n`); }, close: async () => {} };
  } };
  const options = { stateRoot: root, chainAccounts: accounts, http: seller, solanaRpcUrl: "https://solana.example", x402SolanaRpc: rpc,
    x402SolanaTtyOptions: tty, clock: { now: () => new Date() } };
  return { accounts, payer: account.address, rpc, seller, options, screens, refuseConsent: () => { refuse = true; } };
}

export async function admitSolanaX402(root: string, payer: string, input: { readonly maximumPerTransferAtomic?: string; readonly dailyLimitAtomic?: string;
  readonly mechanism?: { readonly provider: string; readonly reference: string }; readonly recipients?: readonly string[] } = {}): Promise<void> {
  await activateDirectPolicy(root, "default", { accounts: { solana: payer }, admissions: [{ chain: SOLANA_CHAIN, kind: "token", identifier: SOLANA_USDC,
    rail: "x402", maximumPerTransferAtomic: input.maximumPerTransferAtomic ?? "1000000", dailyLimitAtomic: input.dailyLimitAtomic ?? "5000000",
    mechanism: input.mechanism ?? X402_SOLANA_MECHANISM,
    ...(input.recipients === undefined ? {} : { recipients: input.recipients }) } as never] });
}

export const PAY_ARGS = ["x402", "solana", "pay", "--profile", "default", "--url", X402_URL, "--asset", SOLANA_USDC, "--max-amount", "20000"];

/** A prepared payment written straight to its store, for the generic operation commands (no chain, seller or custody). */
export async function preparedSolanaRecord(root: string): Promise<string> {
  const { canonicalJson, domainHash } = await import("../../src/canonical.js");
  const { newX402SolanaRecord } = await import("../../src/x402-solana/model.js");
  const { X402SolanaRepository } = await import("../../src/x402-solana/repository.js");
  const { X402_SOLANA_ALLOWLIST_CHAIN } = await import("../../src/x402-solana/constants.js");
  const records = new X402SolanaRepository(root), payer = (await createKeyPairSignerFromPrivateKeyBytes(PAYER_SEED)).address as string;
  const profileHash = records.profileHash("default"), now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const operationId = domainHash("apn.x402-solana.operation-id.v1", canonicalJson({ profileHash, key: "generic-0001" }));
  const offer = solanaOffer(await feePayerAddress());
  await records.ready();
  await records.withLocks([`operation:${operationId}`], async () => await records.persistLocked(newX402SolanaRecord({ operationId, profile: "default", profileHash,
    idempotencyHash: sha256("generic-idempotency"), requestHash: sha256("generic-request"), terms: {
      url: X402_URL, origin: new URL(X402_URL).origin, urlHash: sha256(X402_URL), challengeHash: sha256("challenge"),
      resourceCanonicalJson: canonicalJson({ url: X402_URL }), offerIndex: 0, offerCanonicalJson: canonicalJson(offer),
      offerHash: domainHash("apn.x402.offer.v1", canonicalJson(offer)), network: X402_SOLANA_NETWORK, chain: X402_SOLANA_ALLOWLIST_CHAIN,
      payer, mint: SOLANA_USDC, symbol: "USDC", decimals: 6, sourceTokenAccount: await associatedToken(payer, SOLANA_USDC), payee: SOL_PAYEE,
      destinationTokenAccount: await associatedToken(SOL_PAYEE, SOLANA_USDC), feePayer: await feePayerAddress(), amountAtomic: "10000",
      maxAmountAtomic: "20000", computeUnitLimit: 20_000, computeUnitPriceMicroLamports: "1",
      admission: { policyDigest: sha256("policy"), policyRevision: 1, registryVersion: "test.1", activationDigest: sha256("activation"),
        maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "5000000" },
      preparedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 240_000).toISOString() } })));
  return operationId;
}
