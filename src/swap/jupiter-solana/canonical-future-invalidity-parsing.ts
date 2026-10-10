import { getCompiledTransactionMessageDecoder, getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";
import { hashObject, isPlainRecord, sha256 } from "../../canonical.js";
import { canonicalAddress, canonicalBase64, SYSTEM_PROGRAM } from "./catalog.js";
import type { JupiterFutureInvalidityInput, JupiterFutureInvalidityOriginalLifetime,
  JupiterFutureInvalidityReason } from "./canonical-future-invalidity.js";

/** Internal parsing only; no RPC or financial authority. */
export interface WireFacts {
  readonly transactionHash: string;
  readonly messageHash: string;
  readonly signatureHash: string;
  readonly signature: string;
  readonly blockhash: string;
}
export interface BlockHeader {
  readonly slot: bigint;
  readonly blockHeight: bigint;
  readonly blockhash: string;
  readonly parentSlot: bigint;
  readonly previousBlockhash: string;
}
export class Refusal extends Error {
  constructor(readonly reason: JupiterFutureInvalidityReason) { super(reason); }
}

export function parseSignedWire(input: JupiterFutureInvalidityInput): WireFacts {
  let bytes: Uint8Array;
  try { bytes = canonicalBase64(input.signedTransactionBase64, 1232); } catch { throw new Refusal("invalid_signed_wire"); }
  let transaction: ReturnType<ReturnType<typeof getTransactionDecoder>["decode"]>;
  let message: ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>["decode"]>;
  try {
    transaction = getTransactionDecoder().decode(bytes);
    message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  } catch { throw new Refusal("invalid_signed_wire"); }
  if (message.version !== 0) throw new Refusal("unsupported_message_version");
  const staticAccounts = message.staticAccounts.map(String);
  const signers = Object.keys(transaction.signatures);
  const signatures = Object.values(transaction.signatures);
  if (message.header.numSignerAccounts !== 1 || signers.length !== 1 || signers[0] !== staticAccounts[0] ||
      signatures.length !== 1 || signatures.some(signature => signature === null || signature.length !== 64 || signature.every(byte => byte === 0))) {
    throw new Refusal("unsigned_wire");
  }
  const blockhash = String(message.lifetimeToken);
  try { canonicalAddress(blockhash); } catch { throw new Refusal("invalid_signed_wire"); }
  if (!Array.isArray(message.instructions) || message.instructions.length === 0) throw new Refusal("invalid_signed_wire");
  const first = message.instructions[0]!;
  const programIndex = first.programAddressIndex;
  if (!Number.isSafeInteger(programIndex) || programIndex < 0) throw new Refusal("invalid_signed_wire");
  const lookupRows = message.addressTableLookups ?? [];
  const writableCount = lookupRows.reduce((sum, lookup) => sum + lookup.writableIndexes.length, 0);
  const readonlyCount = lookupRows.reduce((sum, lookup) => sum + lookup.readonlyIndexes.length, 0);
  let firstProgramId: string | undefined;
  if (programIndex < staticAccounts.length) firstProgramId = staticAccounts[programIndex];
  else {
    if (programIndex >= staticAccounts.length + writableCount + readonlyCount) throw new Refusal("invalid_signed_wire");
    const loadedIndex = programIndex - staticAccounts.length;
    const loaded = input.resolvedLookupAddresses;
    if (loaded === undefined) throw new Refusal("unresolved_alt_program");
    if (!Array.isArray(loaded.loadedWritable) || !Array.isArray(loaded.loadedReadonly) ||
      loaded.loadedWritable.length !== writableCount || loaded.loadedReadonly.length !== readonlyCount) throw new Refusal("unresolved_alt_program");
    const allLoaded = [...loaded.loadedWritable, ...loaded.loadedReadonly];
    if (allLoaded.some(address => typeof address !== "string")) throw new Refusal("unresolved_alt_program");
    try { allLoaded.forEach(canonicalAddress); } catch { throw new Refusal("unresolved_alt_program"); }
    firstProgramId = allLoaded[loadedIndex];
    if (firstProgramId === undefined) throw new Refusal("invalid_signed_wire");
  }
  if (firstProgramId === SYSTEM_PROGRAM) {
    const data = first.data === undefined ? new Uint8Array() : new Uint8Array(first.data);
    if (data.length < 4 && data[0] === 4) throw new Refusal("ambiguous_nonce_instruction");
    if (data.length >= 4 && Buffer.from(data).readUInt32LE(0) === 4) throw new Refusal("durable_nonce");
  }
  let signature: string;
  try { signature = getSignatureFromTransaction(transaction); } catch { throw new Refusal("invalid_signed_wire"); }
  if (typeof signature !== "string" || signature.length === 0) throw new Refusal("invalid_signed_wire");
  return Object.freeze({ transactionHash: sha256(bytes), messageHash: sha256(new Uint8Array(transaction.messageBytes)), signatureHash: sha256(signature), signature, blockhash });
}

export function parseLifetime(value: JupiterFutureInvalidityOriginalLifetime): { readonly contextSlot: bigint; readonly blockhash: string; readonly lastValidBlockHeight: bigint | null } {
  if (!isPlainRecord(value) || typeof value.contextSlot !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value.contextSlot) ||
      typeof value.blockhash !== "string" || (value.lastValidBlockHeight !== undefined && value.lastValidBlockHeight !== null &&
        (typeof value.lastValidBlockHeight !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value.lastValidBlockHeight))) ||
      Object.keys(value).some(key => !["contextSlot", "blockhash", "lastValidBlockHeight"].includes(key))) {
    throw new Refusal("invalid_input");
  }
  try { canonicalAddress(value.blockhash); } catch { throw new Refusal("invalid_input"); }
  return Object.freeze({
    contextSlot: BigInt(value.contextSlot),
    blockhash: value.blockhash,
    lastValidBlockHeight: value.lastValidBlockHeight === undefined || value.lastValidBlockHeight === null ? null : BigInt(value.lastValidBlockHeight),
  });
}

export function parseHeader(value: unknown, slot: bigint): BlockHeader {
  if (!isPlainRecord(value) || typeof value.blockhash !== "string" || typeof value.previousBlockhash !== "string") throw new Refusal("malformed_rpc_result");
  const blockHeight = parseUnsignedRpc(value.blockHeight);
  const parentSlot = parseUnsignedRpc(value.parentSlot);
  try { canonicalAddress(value.blockhash); canonicalAddress(value.previousBlockhash); } catch { throw new Refusal("malformed_rpc_result"); }
  return Object.freeze({ slot, blockHeight, blockhash: value.blockhash, parentSlot, previousBlockhash: value.previousBlockhash });
}

export function parseContextualBoolean(value: unknown, minimumSlot: bigint): boolean {
  if (!isPlainRecord(value) || !isPlainRecord(value.context) || typeof value.value !== "boolean") throw new Refusal("malformed_rpc_result");
  if (parseUnsignedRpc(value.context.slot) < minimumSlot) throw new Refusal("reanchor_failed");
  return value.value;
}

export function parseSignatureStatusObservation(value: unknown, minimumSlot: bigint): "not_reported" | "reported" {
  if (!isPlainRecord(value) || !isPlainRecord(value.context) || !Array.isArray(value.value) || value.value.length !== 1) throw new Refusal("malformed_rpc_result");
  if (parseUnsignedRpc(value.context.slot) < minimumSlot) throw new Refusal("reanchor_failed");
  const status = value.value[0];
  if (status === null) return "not_reported";
  if (!isPlainRecord(status)) throw new Refusal("malformed_rpc_result");
  return "reported";
}

export function parseUnsignedRpc(value: unknown): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new Refusal("malformed_rpc_result");
}
export function toSafeNumber(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || BigInt(number) !== value) throw new Refusal("invalid_input");
  return number;
}
export function validInputShape(value: unknown): value is JupiterFutureInvalidityInput {
  if (!isPlainRecord(value) || typeof value.signedTransactionBase64 !== "string" || !isPlainRecord(value.originalQuoteRpcLifetime)) return false;
  const allowed = ["signedTransactionBase64", "originalQuoteRpcLifetime", "resolvedLookupAddresses"];
  if (Object.keys(value).some(key => !allowed.includes(key))) return false;
  if (value.resolvedLookupAddresses !== undefined && (!isPlainRecord(value.resolvedLookupAddresses) ||
      Object.keys(value.resolvedLookupAddresses).some(key => !["loadedWritable", "loadedReadonly"].includes(key)) ||
      !Array.isArray(value.resolvedLookupAddresses.loadedWritable) || !Array.isArray(value.resolvedLookupAddresses.loadedReadonly))) return false;
  return true;
}
export function safeInputHash(value: unknown): string {
  const transactionHash = isPlainRecord(value) && typeof value.signedTransactionBase64 === "string" ? sha256(value.signedTransactionBase64) : sha256("invalid-wire");
  const lifetime = isPlainRecord(value) && isPlainRecord(value.originalQuoteRpcLifetime) ? value.originalQuoteRpcLifetime : {};
  const resolution = isPlainRecord(value) && isPlainRecord(value.resolvedLookupAddresses) ? value.resolvedLookupAddresses : null;
  let resolutionHash: string | null = null;
  if (resolution !== null) {
    try { resolutionHash = hashObject(resolution); } catch { resolutionHash = sha256("invalid-resolution"); }
  }
  const publicString = (item: unknown): string | null => typeof item === "string" ? item : null;
  return hashObject({ transactionHash, contextSlot: publicString(lifetime.contextSlot), blockhash: publicString(lifetime.blockhash),
    lastValidBlockHeight: publicString(lifetime.lastValidBlockHeight), resolutionHash });
}
