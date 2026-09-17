import { getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { associatedUsdc } from "../../solana/accounts.js";
import { atomic, canonicalAddress, invalid, sha256Bytes, SOLANA_USDC_MINT } from "./catalog.js";
import type { SolanaProofReaderPort } from "./ports.js";
import type { JupiterV0Envelope } from "./transaction.js";

export interface JupiterSimulationProof { readonly requestHash: string; readonly resultHash: string; readonly unitsConsumed: string; readonly success: true }
export async function proveJupiterSimulation(reader: SolanaProofReaderPort, envelope: JupiterV0Envelope, minimumContextSlot: number): Promise<JupiterSimulationProof> {
  if (!Number.isSafeInteger(minimumContextSlot) || minimumContextSlot < 1) invalid("Jupiter simulation context slot is invalid.");
  const params = [envelope.transactionBase64, { encoding: "base64", commitment: "processed", sigVerify: false,
    replaceRecentBlockhash: false, minContextSlot: minimumContextSlot }] as const;
  const response = record(await reader.call("simulateTransaction", params), "Jupiter simulation response");
  if (!exactKeys(response, ["context", "value"])) invalid("Jupiter simulation response schema is invalid.");
  const context = record(response.context, "Jupiter simulation context"); const value = record(response.value, "Jupiter simulation value");
  if (!exactKeys(context, ["slot"]) || integer(context.slot) < minimumContextSlot ||
      !exactKeys(value, ["err", "logs", "unitsConsumed", "accounts", "returnData"]) || value.err !== null || !Array.isArray(value.logs) ||
      value.logs.length > 256 || value.logs.some((line) => typeof line !== "string" || line.length > 1024) || value.accounts !== null || value.returnData !== null) {
    invalid("Jupiter simulation did not return exact successful proof.");
  }
  const units = integer(value.unitsConsumed); if (units < 1 || units > 1_400_000) invalid("Jupiter simulation compute evidence is invalid.");
  return Object.freeze({ requestHash: domainHash("apn.jupiter-simulation-request.v1", canonicalJson(params)),
    resultHash: domainHash("apn.jupiter-simulation-result.v1", canonicalJson(response)), unitsConsumed: String(units), success: true });
}

export interface JupiterReceiptExpectation {
  readonly signature: string; readonly taker: string; readonly recipient: string; readonly recipientTokenAccount: string; readonly minimumOutputAtomic: string;
  readonly maximumTotalNativeSpendLamports: string; readonly maximumNetworkFeeLamports: string;
}
export interface JupiterFinalizedReceipt { readonly signature: string; readonly slot: string; readonly feeLamports: string; readonly nativeSpendLamports: string; readonly recipientOutputAtomic: string; readonly receiptHash: string }

export async function validateFinalizedJupiterReceipt(reader: SolanaProofReaderPort, envelope: JupiterV0Envelope,
  expected: JupiterReceiptExpectation): Promise<JupiterFinalizedReceipt> {
  signature(expected.signature); canonicalAddress(expected.taker); canonicalAddress(expected.recipientTokenAccount);
  if (await associatedUsdc(expected.recipient) !== expected.recipientTokenAccount) invalid("Jupiter receipt recipient ATA derivation changed.");
  const minimum = atomic(expected.minimumOutputAtomic); const maxSpend = atomic(expected.maximumTotalNativeSpendLamports);
  const maxFee = atomic(expected.maximumNetworkFeeLamports, true);
  const statusParams = [[expected.signature], { searchTransactionHistory: true }] as const;
  const statusResponse = record(await reader.call("getSignatureStatuses", statusParams), "Jupiter status response");
  if (!exactKeys(statusResponse, ["context", "value"])) invalid("Jupiter status response schema is invalid.");
  const statusContext = record(statusResponse.context, "Jupiter status context");
  if (!exactKeys(statusContext, ["slot"])) invalid("Jupiter status context schema is invalid.");
  const statusValues = array(statusResponse.value, 1);
  if (statusValues.length !== 1 || statusValues[0] === null) invalid("Jupiter finalized signature status is unavailable.");
  const status = record(statusValues[0], "Jupiter signature status");
  if (status.confirmationStatus !== "finalized" || status.confirmations !== null || status.err !== null) invalid("Jupiter signature is not finalized successfully.");
  const slot = integer(status.slot);
  if (integer(statusContext.slot) < slot) invalid("Jupiter status context is older than the finalized transaction.");
  const transactionParams = [expected.signature, { encoding: "base64", commitment: "finalized", maxSupportedTransactionVersion: 0 }] as const;
  const response = record(await reader.call("getTransaction", transactionParams), "Jupiter finalized transaction");
  if (integer(response.slot) !== slot || response.version !== 0) invalid("Jupiter finalized transaction slot or version changed.");
  const meta = record(response.meta, "Jupiter transaction meta");
  if (meta.err !== null) invalid("Jupiter finalized transaction failed.");
  const encoded = array(response.transaction, 2);
  if (encoded.length !== 2 || encoded[1] !== "base64" || typeof encoded[0] !== "string") invalid("Jupiter finalized transaction encoding changed.");
  const transactionBytes = Buffer.from(encoded[0], "base64"); let wire: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  try { wire = getTransactionDecoder().decode(transactionBytes); } catch { return invalid("Jupiter finalized transaction cannot be decoded."); }
  if (Object.keys(wire.signatures)[0] !== expected.taker || getSignatureFromTransaction(wire) !== expected.signature ||
      sha256Bytes(new Uint8Array(wire.messageBytes)) !== envelope.messageHash) {
    invalid("Jupiter finalized transaction signer or message changed.");
  }
  const loaded = record(meta.loadedAddresses, "Jupiter loaded addresses");
  const loadedWritable = addressArray(loaded.writable); const loadedReadonly = addressArray(loaded.readonly);
  if (canonicalJson(loadedWritable) !== canonicalJson(envelope.loadedWritable) || canonicalJson(loadedReadonly) !== canonicalJson(envelope.loadedReadonly)) {
    invalid("Jupiter finalized loaded addresses changed.");
  }
  const accountKeys = envelope.accounts.map((account) => account.address);
  if (new Set(accountKeys).size !== accountKeys.length || accountKeys[0] !== expected.taker) invalid("Jupiter finalized account keys are invalid.");
  const preBalances = atomicArray(meta.preBalances, accountKeys.length); const postBalances = atomicArray(meta.postBalances, accountKeys.length);
  const takerIndex = accountKeys.indexOf(expected.taker); if (takerIndex < 0) invalid("Jupiter taker is absent from finalized balances.");
  const nativeSpend = preBalances[takerIndex]! - postBalances[takerIndex]!;
  const fee = rpcAtomic(meta.fee); if (fee > maxFee || nativeSpend < fee || nativeSpend > maxSpend) invalid("Jupiter finalized native spend or fee exceeds policy.");
  const recipientIndex = accountKeys.indexOf(expected.recipientTokenAccount); if (recipientIndex < 0) invalid("Jupiter recipient account is absent.");
  const before = tokenAmount(meta.preTokenBalances, recipientIndex, expected.recipient, true);
  const after = tokenAmount(meta.postTokenBalances, recipientIndex, expected.recipient, false);
  const output = after - before; if (output < minimum) invalid("Jupiter finalized recipient output is below minimum.");
  const body = { signature: expected.signature, slot: String(slot), feeLamports: fee.toString(), nativeSpendLamports: nativeSpend.toString(),
    recipientOutputAtomic: output.toString(), blockhash: envelope.blockhash, transactionHash: envelope.transactionHash,
    loadedWritable, loadedReadonly, statusRequestHash: domainHash("apn.jupiter-status-request.v1", canonicalJson(statusParams)),
    transactionRequestHash: domainHash("apn.jupiter-transaction-request.v1", canonicalJson(transactionParams)) };
  return Object.freeze({ signature: body.signature, slot: body.slot, feeLamports: body.feeLamports, nativeSpendLamports: body.nativeSpendLamports,
    recipientOutputAtomic: body.recipientOutputAtomic, receiptHash: domainHash("apn.jupiter-finalized-receipt.v1", canonicalJson(body)) });
}

function tokenAmount(value: unknown, accountIndex: number, owner: string, allowMissing: boolean): bigint {
  let found: bigint | undefined;
  for (const item of array(value ?? [], 256)) {
    const balance = record(item, "Jupiter token balance");
    if (integer(balance.accountIndex) !== accountIndex) continue;
    if (balance.mint !== SOLANA_USDC_MINT || balance.owner !== owner) invalid("Jupiter recipient token identity changed.");
    canonicalAddress(balance.owner); const ui = record(balance.uiTokenAmount, "Jupiter token amount");
    if (integer(ui.decimals) !== 6 || typeof ui.amount !== "string" || found !== undefined) invalid("Jupiter recipient token balance is invalid.");
    found = atomic(ui.amount, true);
  }
  if (found === undefined && !allowMissing) invalid(`Jupiter recipient token balance is absent for ${owner}.`); return found ?? 0n;
}
function atomicArray(value: unknown, length: number): bigint[] { const items = array(value, 256); if (items.length !== length) invalid("Jupiter native balance vector length changed."); return items.map(rpcAtomic); }
function addressArray(value: unknown): string[] { return array(value, 256).map((item) => { if (typeof item !== "string") invalid("Jupiter loaded address is invalid."); return canonicalAddress(item); }); }
function array(value: unknown, maximum: number): unknown[] { if (!Array.isArray(value) || value.length > maximum) invalid("Jupiter RPC array is invalid."); return value; }
function record(value: unknown, label: string): Record<string, unknown> { if (!isPlainRecord(value)) invalid(`${label} is invalid.`); return value; }
function integer(value: unknown): number { if (typeof value === "bigint") { if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid("Jupiter RPC integer is invalid."); return Number(value); } if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid("Jupiter RPC integer is invalid."); return value; }
function rpcAtomic(value: unknown): bigint { if (typeof value === "bigint") return atomic(value.toString(), true); if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value); return invalid("Jupiter RPC atomic amount is invalid."); }
function signature(value: unknown): string { if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/u.test(value)) throw new ApnError("APN_RPC_PROTOCOL", "Jupiter signature is invalid."); return value; }
