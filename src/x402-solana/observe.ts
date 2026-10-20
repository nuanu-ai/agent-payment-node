import { address, getBase58Decoder, getCompiledTransactionMessageDecoder, getPublicKeyFromAddress, getTransactionDecoder, verifySignature } from "@solana/kit";
import { protocolFailure, readSolanaBlockHeight, rpcArray, rpcAtomic, rpcRecord, solanaSignature, type SolanaRpcPort } from "../solana/rpc.js";
import { X402_SOLANA_SCAN_LIMIT, X402_SOLANA_SCAN_OPEN_LIMIT } from "./constants.js";

export interface X402SolanaObservationInput {
  readonly payer: string;
  readonly payee: string;
  readonly feePayer: string;
  readonly mint: string;
  readonly sourceTokenAccount: string;
  readonly destinationTokenAccount: string;
  readonly amountAtomic: string;
  readonly messageBase64: string;
  /** Base64 of the payer's signature over the message, as signed. */
  readonly payerSignature: string;
  readonly lastValidBlockHeight: string;
  readonly floorSlot: string;
  /** The seller's PAYMENT-RESPONSE transaction, a hint only: it counts once the chain shows these exact bytes. */
  readonly hint?: string;
  readonly now: Date;
}
export interface X402SolanaSettlementEvidence {
  readonly signature: string; readonly slot: string; readonly success: boolean; readonly errorCanonicalJson: string | null;
  readonly source: "payment_response" | "signature_index"; readonly observedAt: string; readonly rpcOriginHash: string;
}
export interface X402SolanaUnlandedEvidence {
  readonly finalizedBlockHeight: string; readonly lastValidBlockHeight: string; readonly floorSlot: string; readonly coverageSlot: string;
  readonly openedSignatures: number; readonly observedAt: string; readonly rpcOriginHash: string;
}
export type X402SolanaObservation =
  | { readonly outcome: "landed"; readonly settlement: X402SolanaSettlementEvidence }
  | { readonly outcome: "expired_unlanded"; readonly unlanded: X402SolanaUnlandedEvidence }
  | { readonly outcome: "pending"; readonly reason: string };
type Check = { readonly kind: "ours"; readonly slot: bigint; readonly success: boolean; readonly error: string | null } | { readonly kind: "other" | "unknown" | "not_final" };

/**
 * The facilitator signs as fee payer, so the transaction id is not known before it lands. The finalized height is read
 * first; then the seller's hint (if any) and every finalized signature on the payer's token account newer than the
 * binding's floor slot are opened and compared byte for byte with the frozen message. A match settles the payment (or
 * proves it failed on chain). No match proves it never landed only when the finalized height is past the blockhash's
 * lastValidBlockHeight and the same signature page reaches back to the floor slot, so the index covers the whole window.
 */
export async function observeX402SolanaPayment(rpc: SolanaRpcPort, input: X402SolanaObservationInput): Promise<X402SolanaObservation> {
  const height = await readSolanaBlockHeight(rpc, "finalized");
  const evidence = (signature: string, check: Extract<Check, { kind: "ours" }>, source: X402SolanaSettlementEvidence["source"]) =>
    ({ outcome: "landed" as const, settlement: { signature, slot: check.slot.toString(), success: check.success, errorCanonicalJson: check.error, source,
      observedAt: input.now.toISOString(), rpcOriginHash: rpc.originHash } });
  // Only a hint the chain shows to be other bytes is skipped below; an unknown one is opened again from the index.
  let disproven: string | undefined;
  if (input.hint !== undefined) {
    const check = await checkSignature(rpc, input.hint, input);
    if (check.kind === "ours") return evidence(input.hint, check, "payment_response");
    if (check.kind === "not_final") return { outcome: "pending", reason: "settlement_not_finalized" };
    if (check.kind === "other") disproven = input.hint;
  }
  const floor = BigInt(input.floorSlot);
  const entries = rpcArray(await rpc.call("getSignaturesForAddress", [input.sourceTokenAccount, { commitment: "finalized", limit: X402_SOLANA_SCAN_LIMIT }]),
    X402_SOLANA_SCAN_LIMIT).map((value) => {
    const entry = rpcRecord(value);
    return { signature: solanaSignature(entry.signature), slot: rpcAtomic(entry.slot) };
  });
  entries.forEach((entry, index) => { if (index > 0 && entry.slot > entries[index - 1]!.slot) protocolFailure(); });
  const newer = entries.filter((entry) => entry.slot > floor && entry.signature !== disproven);
  if (newer.length > X402_SOLANA_SCAN_OPEN_LIMIT) return { outcome: "pending", reason: "signature_index_crowded" };
  for (const entry of newer) {
    const check = await checkSignature(rpc, entry.signature, input);
    if (check.kind === "ours") return evidence(entry.signature, check, "signature_index");
    if (check.kind === "not_final" || check.kind === "unknown") return { outcome: "pending", reason: "signature_index_inconsistent" };
  }
  const covering = entries.filter((entry) => entry.slot <= floor);
  if (height <= BigInt(input.lastValidBlockHeight)) return { outcome: "pending", reason: "lifetime_open" };
  if (covering.length === 0) return { outcome: "pending", reason: "signature_index_not_covering" };
  return { outcome: "expired_unlanded", unlanded: { finalizedBlockHeight: height.toString(), lastValidBlockHeight: input.lastValidBlockHeight,
    floorSlot: input.floorSlot, coverageSlot: covering[0]!.slot.toString(), openedSignatures: newer.length, observedAt: input.now.toISOString(),
    rpcOriginHash: rpc.originHash } };
}

async function checkSignature(rpc: SolanaRpcPort, signature: string, input: X402SolanaObservationInput): Promise<Check> {
  const statuses = rpcArray(rpcRecord(await rpc.call("getSignatureStatuses", [[signature], { searchTransactionHistory: true }])).value, 1);
  if (statuses.length !== 1) protocolFailure();
  if (statuses[0] === null) return { kind: "unknown" };
  const status = rpcRecord(statuses[0]);
  if (status.confirmationStatus !== "finalized") return { kind: "not_final" };
  const value = await rpc.call("getTransaction", [signature, { encoding: "base64", commitment: "finalized", maxSupportedTransactionVersion: 0 }]);
  if (value === null) return { kind: "unknown" };
  const response = rpcRecord(value), meta = rpcRecord(response.meta), wire = rpcArray(response.transaction, 2);
  if (wire.length !== 2 || wire[1] !== "base64" || typeof wire[0] !== "string" || wire[0].length > 2048) protocolFailure();
  const bytes = Buffer.from(wire[0], "base64");
  if (bytes.toString("base64") !== wire[0]) protocolFailure();
  let transaction: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  try { transaction = getTransactionDecoder().decode(bytes); } catch { return protocolFailure(); }
  if (Buffer.from(transaction.messageBytes).toString("base64") !== input.messageBase64) return { kind: "other" };
  // These bytes are this payment: the payer's signature is the one APN made and the fee payer's verifies and names the id.
  const signatures = transaction.signatures as Readonly<Record<string, Uint8Array | null>>;
  const feePayerSignature = signatures[input.feePayer], payerSignature = signatures[input.payer];
  if (Object.keys(signatures).length !== 2 || feePayerSignature === null || feePayerSignature === undefined || payerSignature === null ||
      payerSignature === undefined || Buffer.from(payerSignature).toString("base64") !== input.payerSignature ||
      getBase58Decoder().decode(feePayerSignature) !== signature ||
      !await verifySignature(await getPublicKeyFromAddress(address(input.feePayer)), feePayerSignature as never, transaction.messageBytes)) protocolFailure();
  const slot = rpcAtomic(response.slot);
  if (slot !== rpcAtomic(status.slot) || stringify(meta.err) !== stringify(status.err)) protocolFailure();
  const success = meta.err === null;
  const error = success ? null : stringify(meta.err);
  if (error !== null && error.length > 1024) protocolFailure();
  verifyTokenDeltas(meta, input, success);
  return { kind: "ours", slot, success, error };
}

/** The token balances must show exactly the price moved from the payer's account to the payee's, or nothing on failure. */
function verifyTokenDeltas(meta: Record<string, unknown>, input: X402SolanaObservationInput, success: boolean): void {
  const amount = (list: unknown, account: string, owner: string): bigint | null => {
    let found: bigint | null = null;
    for (const raw of rpcArray(list ?? [], 8)) {
      const row = rpcRecord(raw), ui = rpcRecord(row.uiTokenAmount);
      if (row.mint !== input.mint || row.owner !== owner || typeof ui.amount !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(ui.amount)) continue;
      if (accountOf(row.accountIndex) !== account) continue;
      if (found !== null) protocolFailure();
      found = BigInt(ui.amount);
    }
    return found;
  };
  const keys = staticKeys(input);
  const accountOf = (index: unknown): string | undefined => keys[Number(rpcAtomic(index))];
  const delta = (account: string, owner: string): bigint => {
    const before = amount(meta.preTokenBalances, account, owner), after = amount(meta.postTokenBalances, account, owner);
    if (before === null || after === null) protocolFailure();
    return after - before;
  };
  const price = BigInt(input.amountAtomic);
  if (delta(input.sourceTokenAccount, input.payer) !== (success ? -price : 0n) ||
      delta(input.destinationTokenAccount, input.payee) !== (success ? price : 0n)) protocolFailure();
}

/** The message's static account keys in order, decoded from the frozen message bytes themselves. */
function staticKeys(input: X402SolanaObservationInput): readonly string[] {
  return getCompiledTransactionMessageDecoder().decode(Buffer.from(input.messageBase64, "base64")).staticAccounts.map(String);
}
function stringify(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item);
}
