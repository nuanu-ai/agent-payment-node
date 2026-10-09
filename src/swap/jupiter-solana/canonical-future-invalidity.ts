import { getCompiledTransactionMessageDecoder, getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";
import { hashObject, isPlainRecord, sha256 } from "../../canonical.js";
import { SOLANA_GENESIS } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import type { SolanaRpcPort } from "../../solana/rpc.js";
import { canonicalAddress, canonicalBase64, SYSTEM_PROGRAM } from "./catalog.js";

/**
 * This module emits only a read-only future-invalidity witness. It is not settlement or financial authority.
 * Solana's Transactions and Constants references list MAX_PROCESSING_AGE=150, while the confirmation
 * cookbook describes 151 recent hashes and an additional processing-boundary nuance. We therefore
 * require H+152 only as a conservative safety bound; this field does not claim an exact protocol expiry height.
 * https://solana.com/docs/core/transactions
 * https://solana.com/docs/core/constants-reference
 * https://solana.com/uk/developers/cookbook/transactions/confirmation
 */
export const JUPITER_NON_DURABLE_MAX_PROCESSING_AGE = 150 as const;
const JUPITER_NON_DURABLE_CONSERVATIVE_HEIGHT_OFFSET = 152n;
export const JUPITER_FUTURE_INVALIDITY_MAX_READS_PER_PROVIDER = 72 as const;
export const JUPITER_FUTURE_INVALIDITY_MAX_WINDOW_SLOTS = 65 as const;
const SCHEMA = "apn.jupiter-canonical-future-invalidity.v1" as const;
const DEFAULT_DEADLINE_MS = 90_000;
const MAX_DEADLINE_MS = 120_000;
const BLOCK_CONFIG = Object.freeze({
  commitment: "finalized",
  encoding: "json",
  transactionDetails: "none",
  maxSupportedTransactionVersion: 0,
  rewards: false,
});

export type JupiterFutureInvalidityReadMethod =
  | "getGenesisHash"
  | "getBlocks"
  | "getBlock"
  | "getSlot"
  | "getBlockHeight"
  | "isBlockhashValid"
  | "getSignatureStatuses";

/** Narrow, read-only port. Production callers must bind exactly two independent configured RPCs. */
export interface JupiterFutureInvalidityReadPort {
  readonly originHash: string;
  read(method: JupiterFutureInvalidityReadMethod, params: readonly unknown[], signal: AbortSignal): Promise<unknown>;
  /** Logical getBlock reads may be multiplexed through the existing bounded JSON-RPC batch gateway. */
  readBlockBatch?(reads: readonly { readonly method: "getBlock"; readonly params: readonly unknown[] }[], signal: AbortSignal): Promise<readonly unknown[]>;
}

export type JupiterFutureInvalidityExtendedMethod = "getBlocks" | "getSlot" | "isBlockhashValid";

/** Reuse the existing typed read gateway for common calls; keep the three extra RPCs on a narrow internal read port. */
export function adaptJupiterFutureInvalidityReadPort(
  rpc: Pick<SolanaRpcPort, "originHash" | "call" | "batch">,
): JupiterFutureInvalidityReadPort {
  // SolanaRpc.call currently transports fixed read-only methods without a call-time allowlist;
  // this cast is private to the three additional standard reads and cannot represent a send.
  const extendedCall = rpc.call as unknown as (method: JupiterFutureInvalidityExtendedMethod, params: readonly unknown[]) => Promise<unknown>;
  return Object.freeze({
    originHash: rpc.originHash,
    async read(method: JupiterFutureInvalidityReadMethod, params: readonly unknown[], signal: AbortSignal): Promise<unknown> {
      if (signal.aborted) throw new Refusal("caller_aborted");
      if (method === "getBlocks" || method === "getSlot" || method === "isBlockhashValid") {
        return await extendedCall.call(rpc, method, params);
      }
      // The helper races this call against the single absolute deadline. SolanaRpcPort already
      // applies its own bounded transport deadline and accepts only this fixed read-method set.
      return await rpc.call(method, params);
    },
    async readBlockBatch(reads: readonly { readonly method: "getBlock"; readonly params: readonly unknown[] }[], signal: AbortSignal): Promise<readonly unknown[]> {
      if (rpc.batch === undefined || reads.length < 1 || reads.length > JUPITER_FUTURE_INVALIDITY_MAX_WINDOW_SLOTS) throw new Refusal("rpc_proof_failed");
      const results: unknown[] = [];
      for (let offset = 0; offset < reads.length; offset += 8) {
        if (signal.aborted) throw new Refusal("caller_aborted");
        let batch: readonly unknown[];
        try { batch = await rpc.batch.call(rpc, reads.slice(offset, offset + 8)); }
        catch (error) { throw rpcRefusal(error); }
        if (batch.length !== Math.min(8, reads.length - offset)) throw new Refusal("malformed_rpc_result");
        results.push(...batch);
      }
      return Object.freeze(results);
    },
  });
}

export interface JupiterFutureInvalidityOriginalLifetime {
  readonly contextSlot: string;
  readonly blockhash: string;
  /** Authenticated quote context may provide this additional conservative bound. */
  readonly lastValidBlockHeight?: string | null;
}

export interface JupiterFutureInvalidityInput {
  /** Caller must supply authenticated in-memory operation material; parsing here does not establish signer authority. */
  readonly signedTransactionBase64: string;
  /** Must be the matching original authenticated quote RPC lifetime context. */
  readonly originalQuoteRpcLifetime: JupiterFutureInvalidityOriginalLifetime;
  /** Full ALT account-key order from authenticated material; omit to refuse an ALT first program. */
  readonly resolvedLookupAddresses?: {
    readonly loadedWritable: readonly string[];
    readonly loadedReadonly: readonly string[];
  };
}

export type JupiterFutureInvalidityReason =
  | "invalid_input"
  | "invalid_signed_wire"
  | "unsupported_message_version"
  | "unsigned_wire"
  | "unresolved_alt_program"
  | "durable_nonce"
  | "ambiguous_nonce_instruction"
  | "quote_lifetime_mismatch"
  | "rpc_identity_invalid"
  | "rpc_proof_failed"
  | "read_budget_exhausted"
  | "deadline_exceeded"
  | "caller_aborted"
  | "wrong_genesis"
  | "empty_or_missing_history"
  | "archive_data_missing"
  | "birth_not_found"
  | "duplicate_birth_match"
  | "finalized_history_mismatch"
  | "malformed_rpc_result"
  | "reanchor_failed"
  | "processing_age_not_exceeded"
  | "quote_lifetime_not_exceeded"
  | "blockhash_still_valid"
  | "signature_status_reported";

export interface JupiterFutureInvalidityInconclusive {
  readonly schemaVersion: typeof SCHEMA;
  readonly scope: "blockhash_future_invalidity_only";
  readonly outcome: "inconclusive";
  readonly reason: JupiterFutureInvalidityReason;
  readonly inputHash: string;
  readonly resultHash: string;
}

export interface JupiterFutureInvalidityWitness {
  readonly schemaVersion: typeof SCHEMA;
  readonly scope: "blockhash_future_invalidity_only";
  readonly outcome: "future_invalidity_witness";
  readonly inputHash: string;
  readonly transactionHash: string;
  readonly messageHash: string;
  readonly signatureHash: string;
  readonly blockhash: string;
  readonly quoteContextSlot: string;
  readonly searchedStartSlot: string;
  readonly birth: { readonly slot: string; readonly blockHeight: string; readonly blockhash: string };
  readonly finalizedAnchor: { readonly slot: string; readonly blockHeight: string; readonly blockhash: string };
  readonly processingAge: {
    readonly documentedMaximumProcessingAge: typeof JUPITER_NON_DURABLE_MAX_PROCESSING_AGE;
    readonly requiredConservativeFinalizedHeight: string;
  };
  readonly quoteLastValidBlockHeight: string | null;
  readonly providers: readonly {
    readonly originHash: string;
    readonly finalizedSlot: string;
    readonly finalizedBlockHeight: string;
    readonly isBlockhashValid: false;
    /** Null status is only "not reported"; it is never a historical absence claim. */
    readonly signatureStatusObservation: "not_reported";
    readonly readCount: number;
  }[];
  readonly resultHash: string;
}

export type JupiterFutureInvalidityResult = JupiterFutureInvalidityInconclusive | JupiterFutureInvalidityWitness;

export interface JupiterFutureInvalidityOptions {
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
  readonly monotonicNow?: () => number;
}

interface WireFacts {
  readonly transactionHash: string;
  readonly messageHash: string;
  readonly signatureHash: string;
  readonly signature: string;
  readonly blockhash: string;
}
interface BlockHeader {
  readonly slot: bigint;
  readonly blockHeight: bigint;
  readonly blockhash: string;
  readonly parentSlot: bigint;
  readonly previousBlockhash: string;
}
interface ProviderState {
  readonly port: JupiterFutureInvalidityReadPort;
  reads: number;
}
class Refusal extends Error {
  constructor(readonly reason: JupiterFutureInvalidityReason) { super(reason); }
}

/**
 * Require a positive, exact finalized birth block, independent-provider agreement and a common
 * finalized reanchor. A null historical status is recorded only as "not reported".
 */
export async function verifyJupiterCanonicalFutureInvalidity(
  input: JupiterFutureInvalidityInput,
  providers: readonly JupiterFutureInvalidityReadPort[],
  options: JupiterFutureInvalidityOptions = {},
): Promise<JupiterFutureInvalidityResult> {
  const inputHash = safeInputHash(input);
  let controller: AbortController | undefined;
  let timer: NodeJS.Timeout | undefined;
  let externalAbort: (() => void) | undefined;
  let abortReason: JupiterFutureInvalidityReason | undefined;
  const states: ProviderState[] = [];
  try {
    if (!validInputShape(input) || providers.length !== 2) throw new Refusal("invalid_input");
    const originHashes = providers.map(provider => provider.originHash);
    if (originHashes.some(hash => typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash)) || originHashes[0] === originHashes[1]) {
      throw new Refusal("rpc_identity_invalid");
    }
    const wire = parseSignedWire(input);
    const lifetime = parseLifetime(input.originalQuoteRpcLifetime);
    if (wire.blockhash !== lifetime.blockhash) throw new Refusal("quote_lifetime_mismatch");
    const startSlot = lifetime.contextSlot > 64n ? lifetime.contextSlot - 64n : 0n;
    const windowSize = lifetime.contextSlot - startSlot + 1n;
    if (windowSize < 1n || windowSize > BigInt(JUPITER_FUTURE_INVALIDITY_MAX_WINDOW_SLOTS) || lifetime.contextSlot > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Refusal("invalid_input");
    }

    const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > MAX_DEADLINE_MS) throw new Refusal("invalid_input");
    const now = options.monotonicNow ?? (() => performance.now());
    const deadlineAt = now() + deadlineMs;
    controller = new AbortController();
    const rejectOnAbort = new Promise<never>((_, reject) => {
      controller!.signal.addEventListener("abort", () => reject(new Refusal(abortReason ?? "caller_aborted")), { once: true });
    });
    // Keep the single shared abort promise handled if the operation exits before aborting.
    void rejectOnAbort.catch(() => {});
    if (options.signal !== undefined) {
      externalAbort = () => { abortReason ??= "caller_aborted"; controller!.abort(); };
      if (options.signal.aborted) externalAbort();
      else options.signal.addEventListener("abort", externalAbort, { once: true });
    }
    timer = setTimeout(() => { abortReason ??= "deadline_exceeded"; controller!.abort(); }, deadlineMs);
    if (controller.signal.aborted) throw new Refusal(abortReason ?? "caller_aborted");
    for (const port of providers) states.push({ port, reads: 0 });

    const scans = await Promise.all(states.map(state => scanProvider(state, startSlot, lifetime.contextSlot, lifetime.contextSlot, wire.blockhash, controller!.signal, rejectOnAbort, deadlineAt, now)));
    if (!sameSlots(scans[0]!.slots, scans[1]!.slots) || !sameHeaders(scans[0]!.headers, scans[1]!.headers)) throw new Refusal("finalized_history_mismatch");
    if (scans.some(scan => scan.birth === null)) throw new Refusal("birth_not_found");
    const births = scans.map(scan => scan.birth!);
    if (births[0]!.slot !== births[1]!.slot || births[0]!.blockHeight !== births[1]!.blockHeight || births[0]!.blockhash !== births[1]!.blockhash) {
      throw new Refusal("finalized_history_mismatch");
    }
    const birth = births[0]!;

    const tips = await Promise.all(states.map(state => read(state, "getSlot", [{ commitment: "finalized" }], controller!.signal, rejectOnAbort, deadlineAt, now)));
    const finalizedSlots = tips.map(parseUnsignedRpc).sort(compareBigint);
    const anchorSlot = finalizedSlots[0]!;
    if (anchorSlot < birth.slot) throw new Refusal("reanchor_failed");
    const anchorValues = await Promise.all(states.map(state => read(state, "getBlock", [toSafeNumber(anchorSlot), BLOCK_CONFIG], controller!.signal, rejectOnAbort, deadlineAt, now)));
    const anchors = anchorValues.map(value => parseHeader(value, anchorSlot));
    if (!sameHeader(anchors[0]!, anchors[1]!) || anchors[0]!.blockHeight <= birth.blockHeight || anchors[0]!.slot < birth.slot) {
      throw new Refusal("reanchor_failed");
    }
    const heights = await Promise.all(states.map(state => read(state, "getBlockHeight", [{ commitment: "finalized" }], controller!.signal, rejectOnAbort, deadlineAt, now)));
    const finalizedHeights = heights.map(parseUnsignedRpc);
    const requiredConservativeFinalizedHeight = birth.blockHeight + JUPITER_NON_DURABLE_CONSERVATIVE_HEIGHT_OFFSET;
    if (finalizedHeights.some(height => height < anchors[0]!.blockHeight || height < requiredConservativeFinalizedHeight)) throw new Refusal("processing_age_not_exceeded");
    if (lifetime.lastValidBlockHeight !== null && finalizedHeights.some(height => height <= lifetime.lastValidBlockHeight!)) {
      throw new Refusal("quote_lifetime_not_exceeded");
    }

    const validity = await Promise.all(states.map(state => read(state, "isBlockhashValid", [wire.blockhash, {
      commitment: "finalized", minContextSlot: toSafeNumber(anchorSlot),
    }], controller!.signal, rejectOnAbort, deadlineAt, now)));
    const validityValues = validity.map(value => parseContextualBoolean(value, anchorSlot));
    if (validityValues.some(value => value)) throw new Refusal("blockhash_still_valid");

    const statusResponses = await Promise.all(states.map(state => read(state, "getSignatureStatuses", [[wire.signature], {
      searchTransactionHistory: true,
    }], controller!.signal, rejectOnAbort, deadlineAt, now)));
    for (const response of statusResponses) {
      const status = parseSignatureStatusObservation(response, anchorSlot);
      if (status !== "not_reported") throw new Refusal("signature_status_reported");
    }
    const providerEvidence = states.map((state, index) => Object.freeze({
      originHash: state.port.originHash,
      finalizedSlot: finalizedSlots[index]!.toString(),
      finalizedBlockHeight: finalizedHeights[index]!.toString(),
      isBlockhashValid: false as const,
      signatureStatusObservation: "not_reported" as const,
      readCount: state.reads,
    })).sort((a, b) => a.originHash.localeCompare(b.originHash));
    if (providerEvidence.some(provider => provider.readCount > JUPITER_FUTURE_INVALIDITY_MAX_READS_PER_PROVIDER)) {
      throw new Refusal("read_budget_exhausted");
    }
    const body = {
      schemaVersion: SCHEMA,
      scope: "blockhash_future_invalidity_only" as const,
      outcome: "future_invalidity_witness" as const,
      inputHash,
      transactionHash: wire.transactionHash,
      messageHash: wire.messageHash,
      signatureHash: wire.signatureHash,
      blockhash: wire.blockhash,
      quoteContextSlot: lifetime.contextSlot.toString(),
      searchedStartSlot: startSlot.toString(),
      birth: { slot: birth.slot.toString(), blockHeight: birth.blockHeight.toString(), blockhash: birth.blockhash },
      finalizedAnchor: { slot: anchorSlot.toString(), blockHeight: anchors[0]!.blockHeight.toString(), blockhash: anchors[0]!.blockhash },
      processingAge: { documentedMaximumProcessingAge: JUPITER_NON_DURABLE_MAX_PROCESSING_AGE,
        requiredConservativeFinalizedHeight: requiredConservativeFinalizedHeight.toString() },
      quoteLastValidBlockHeight: lifetime.lastValidBlockHeight?.toString() ?? null,
      providers: Object.freeze(providerEvidence),
    };
    return Object.freeze({ ...body, resultHash: hashObject(body) });
  } catch (error) {
    const reason = error instanceof Refusal ? error.reason : "rpc_proof_failed";
    if (controller !== undefined && !controller.signal.aborted) { abortReason ??= reason; controller.abort(); }
    return inconclusive(inputHash, reason);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (externalAbort !== undefined) options.signal?.removeEventListener("abort", externalAbort);
  }
}

async function scanProvider(
  state: ProviderState,
  startSlot: bigint,
  endSlot: bigint,
  minContextSlot: bigint,
  expectedBlockhash: string,
  signal: AbortSignal,
  aborted: Promise<never>,
  deadlineAt: number,
  now: () => number,
): Promise<{ readonly slots: readonly bigint[]; readonly headers: readonly BlockHeader[]; readonly birth: BlockHeader | null }> {
  const genesis = await read(state, "getGenesisHash", [], signal, aborted, deadlineAt, now);
  if (genesis !== SOLANA_GENESIS) throw new Refusal("wrong_genesis");
  const slotsResponse = await read(state, "getBlocks", [toSafeNumber(startSlot), toSafeNumber(endSlot), {
    commitment: "finalized", minContextSlot: toSafeNumber(minContextSlot),
  }], signal, aborted, deadlineAt, now);
  if (!Array.isArray(slotsResponse) || slotsResponse.length > Number(JUPITER_FUTURE_INVALIDITY_MAX_WINDOW_SLOTS)) throw new Refusal("malformed_rpc_result");
  const slots = slotsResponse.map(parseUnsignedRpc);
  if (slots.some(slot => slot < startSlot || slot > endSlot) || slots.some((slot, index) => index > 0 && slots[index - 1]! >= slot)) {
    throw new Refusal("malformed_rpc_result");
  }
  if (slots.length === 0) throw new Refusal("empty_or_missing_history");
  const descending = [...slots].reverse();
  const headers: BlockHeader[] = [];
  let birth: BlockHeader | null = null;
  for (let offset = 0; offset < descending.length; offset += 8) {
    const candidateSlots = descending.slice(offset, offset + 8);
    const blockReads = candidateSlots.map(slot => ({ method: "getBlock" as const, params: [toSafeNumber(slot), BLOCK_CONFIG] }));
    const blockResponses = await readBlockBatch(state, blockReads, signal, aborted, deadlineAt, now);
    const batchHeaders = blockResponses.map((response, index) => {
      if (response === null) throw new Refusal("archive_data_missing");
      return parseHeader(response, candidateSlots[index]!);
    });
    for (let index = 0; index < batchHeaders.length; index += 1) {
      const older = batchHeaders[index]!;
      const newer = index === 0 ? headers.at(-1) : batchHeaders[index - 1];
      if (newer !== undefined && (newer.parentSlot !== older.slot || newer.previousBlockhash !== older.blockhash)) {
        throw new Refusal("finalized_history_mismatch");
      }
    }
    const matches = batchHeaders.filter(header => header.blockhash === expectedBlockhash);
    if (matches.length > 1) throw new Refusal("duplicate_birth_match");
    headers.push(...batchHeaders);
    if (matches.length === 1) { birth = matches[0]!; break; }
  }
  return Object.freeze({ slots: Object.freeze(slots), headers: Object.freeze(headers), birth });
}

async function read(
  state: ProviderState,
  method: JupiterFutureInvalidityReadMethod,
  params: readonly unknown[],
  signal: AbortSignal,
  aborted: Promise<never>,
  deadlineAt: number,
  now: () => number,
): Promise<unknown> {
  if (signal.aborted) throw new Refusal("caller_aborted");
  if (now() >= deadlineAt) throw new Refusal("deadline_exceeded");
  if (state.reads >= JUPITER_FUTURE_INVALIDITY_MAX_READS_PER_PROVIDER) throw new Refusal("read_budget_exhausted");
  state.reads += 1;
  let pending: Promise<unknown>;
  try { pending = state.port.read(method, params, signal); }
  catch { throw new Refusal("rpc_proof_failed"); }
  try { return await Promise.race([pending, aborted]); }
  catch (error) {
    if (error instanceof Refusal) throw error;
    throw rpcRefusal(error);
  }
}

async function readBlockBatch(
  state: ProviderState,
  reads: readonly { readonly method: "getBlock"; readonly params: readonly unknown[] }[],
  signal: AbortSignal,
  aborted: Promise<never>,
  deadlineAt: number,
  now: () => number,
): Promise<readonly unknown[]> {
  if (signal.aborted) throw new Refusal("caller_aborted");
  if (now() >= deadlineAt) throw new Refusal("deadline_exceeded");
  if (reads.length < 1 || reads.length > JUPITER_FUTURE_INVALIDITY_MAX_WINDOW_SLOTS ||
    state.reads + reads.length > JUPITER_FUTURE_INVALIDITY_MAX_READS_PER_PROVIDER) throw new Refusal("read_budget_exhausted");
  state.reads += reads.length;
  let pending: Promise<readonly unknown[]>;
  try {
    pending = state.port.readBlockBatch === undefined
      ? Promise.all(reads.map(item => state.port.read(item.method, item.params, signal)))
      : state.port.readBlockBatch(reads, signal);
  } catch { throw new Refusal("rpc_proof_failed"); }
  try {
    const result = await Promise.race([pending, aborted]);
    if (!Array.isArray(result) || result.length !== reads.length) throw new Refusal("malformed_rpc_result");
    return result;
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw rpcRefusal(error);
  }
}

function rpcRefusal(error: unknown): Refusal {
  return error instanceof ApnError && error.code === "APN_RPC_BUDGET_EXCEEDED"
    ? new Refusal("read_budget_exhausted") : new Refusal("rpc_proof_failed");
}

function parseSignedWire(input: JupiterFutureInvalidityInput): WireFacts {
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

function parseLifetime(value: JupiterFutureInvalidityOriginalLifetime): { readonly contextSlot: bigint; readonly blockhash: string; readonly lastValidBlockHeight: bigint | null } {
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

function parseHeader(value: unknown, slot: bigint): BlockHeader {
  if (!isPlainRecord(value) || typeof value.blockhash !== "string" || typeof value.previousBlockhash !== "string") throw new Refusal("malformed_rpc_result");
  const blockHeight = parseUnsignedRpc(value.blockHeight);
  const parentSlot = parseUnsignedRpc(value.parentSlot);
  try { canonicalAddress(value.blockhash); canonicalAddress(value.previousBlockhash); } catch { throw new Refusal("malformed_rpc_result"); }
  return Object.freeze({ slot, blockHeight, blockhash: value.blockhash, parentSlot, previousBlockhash: value.previousBlockhash });
}

function parseContextualBoolean(value: unknown, minimumSlot: bigint): boolean {
  if (!isPlainRecord(value) || !isPlainRecord(value.context) || typeof value.value !== "boolean") throw new Refusal("malformed_rpc_result");
  if (parseUnsignedRpc(value.context.slot) < minimumSlot) throw new Refusal("reanchor_failed");
  return value.value;
}

function parseSignatureStatusObservation(value: unknown, minimumSlot: bigint): "not_reported" | "reported" {
  if (!isPlainRecord(value) || !isPlainRecord(value.context) || !Array.isArray(value.value) || value.value.length !== 1) throw new Refusal("malformed_rpc_result");
  if (parseUnsignedRpc(value.context.slot) < minimumSlot) throw new Refusal("reanchor_failed");
  const status = value.value[0];
  if (status === null) return "not_reported";
  if (!isPlainRecord(status)) throw new Refusal("malformed_rpc_result");
  return "reported";
}

function parseUnsignedRpc(value: unknown): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new Refusal("malformed_rpc_result");
}
function toSafeNumber(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || BigInt(number) !== value) throw new Refusal("invalid_input");
  return number;
}
function validInputShape(value: unknown): value is JupiterFutureInvalidityInput {
  if (!isPlainRecord(value) || typeof value.signedTransactionBase64 !== "string" || !isPlainRecord(value.originalQuoteRpcLifetime)) return false;
  const allowed = ["signedTransactionBase64", "originalQuoteRpcLifetime", "resolvedLookupAddresses"];
  if (Object.keys(value).some(key => !allowed.includes(key))) return false;
  if (value.resolvedLookupAddresses !== undefined && (!isPlainRecord(value.resolvedLookupAddresses) ||
      Object.keys(value.resolvedLookupAddresses).some(key => !["loadedWritable", "loadedReadonly"].includes(key)) ||
      !Array.isArray(value.resolvedLookupAddresses.loadedWritable) || !Array.isArray(value.resolvedLookupAddresses.loadedReadonly))) return false;
  return true;
}
function safeInputHash(value: unknown): string {
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
function inconclusive(inputHash: string, reason: JupiterFutureInvalidityReason): JupiterFutureInvalidityInconclusive {
  const body = { schemaVersion: SCHEMA, scope: "blockhash_future_invalidity_only" as const, outcome: "inconclusive" as const, reason, inputHash };
  return Object.freeze({ ...body, resultHash: hashObject(body) });
}
function sameSlots(left: readonly bigint[], right: readonly bigint[]): boolean { return left.length === right.length && left.every((slot, index) => slot === right[index]); }
function sameHeaders(left: readonly BlockHeader[], right: readonly BlockHeader[]): boolean { return left.length === right.length && left.every((header, index) => sameHeader(header, right[index]!)); }
function sameHeader(left: BlockHeader, right: BlockHeader): boolean {
  return left.slot === right.slot && left.blockHeight === right.blockHeight && left.blockhash === right.blockhash &&
    left.parentSlot === right.parentSlot && left.previousBlockhash === right.previousBlockhash;
}
function compareBigint(left: bigint, right: bigint): number { return left < right ? -1 : left > right ? 1 : 0; }
