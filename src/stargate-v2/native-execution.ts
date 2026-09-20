import { lstat, mkdir, open, readFile, realpath, rename, rmdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  decodeAbiParameters, decodeEventLog, decodeFunctionResult, encodeFunctionData, getAddress, keccak256, pad, parseTransaction,
  recoverTransactionAddress,
  zeroAddress, type Hex, type TransactionSerialized,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { ApnError } from "../errors.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { Address } from "../model.js";
import type { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { STARGATE_QUOTE_ABI, STARGATE_QUOTE_SEND_OUTPUT, STARGATE_SEND_ABI } from "./abi.js";
import { quoteStargateV2Direct, type StargateV2QuoteEvidence } from "./quote.js";

const SOURCE_CHAIN = 1 as const;
const DESTINATION_CHAIN = 130 as const;
const SOURCE_EID = 30101 as const;
const DESTINATION_EID = 30320 as const;
const SOURCE_POOL = getAddress("0x77b2043768d28E9C9aB44E1aBfC95944bcE57931");
const DESTINATION_POOL = getAddress("0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7");
const UINT = /^(?:0|[1-9][0-9]{0,77})$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const CODE = /^0x(?:[0-9a-f]{2})+$/u;
const MAX_TTL_MS = 120_000;

function fail(code: "APN_INVALID_INPUT" | "APN_OPERATION_BLOCKED" | "APN_RPC_PROTOCOL" | "APN_RPC_AMBIGUOUS" |
  "APN_CHAIN_MISMATCH" | "APN_REPREPARE_REQUIRED" | "APN_STATE_CORRUPT", reason: string): never {
  throw new ApnError(code, `Direct Stargate V2 native execution failed closed: ${reason}.`, { reason });
}
function uint(value: unknown, positive = false): bigint {
  if (typeof value !== "string" || !UINT.test(value)) return fail("APN_INVALID_INPUT", "noncanonical_uint");
  const n = BigInt(value); if (n >= 1n << 256n || (positive && n === 0n)) return fail("APN_INVALID_INPUT", "uint_range"); return n;
}
function address(value: unknown): Address {
  try { const result = getAddress(value as string); if (result === zeroAddress) throw new Error("zero"); return result; }
  catch { return fail("APN_INVALID_INPUT", "address"); }
}
function hex32(value: unknown): Hex {
  if (typeof value !== "string" || !HASH.test(value)) return fail("APN_RPC_PROTOCOL", "hash"); return value as Hex;
}
function rpcQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)) return fail("APN_RPC_PROTOCOL", "quantity");
  return BigInt(value);
}

export type StargateNativePhase = "prepared" | "approved" | "submission_started" | "submitted" | "observed" | "unknown_finality";
export interface StargateNativeTransition { readonly phase: StargateNativePhase; readonly at: string; readonly reason: string }
export interface StargateNativeEnvelope {
  readonly chainId: 1; readonly from: Address; readonly to: Address; readonly data: Hex; readonly valueAtomic: string;
  readonly nonceAtomic: string; readonly gasLimitAtomic: string; readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
}
export interface StargateNativeOperation {
  readonly schemaVersion: "apn.stargate-v2-native-operation.v1";
  readonly operationId: string; readonly profile: string; readonly profileHash: string; readonly idempotencyHash: string;
  readonly owner: Address; readonly recipient: Address; readonly amountAtomic: string; readonly maxNativeDebitAtomic: string;
  readonly sourcePool: Address; readonly destinationPool: Address; readonly sourceEid: 30101; readonly destinationEid: 30320;
  readonly quote: StargateV2QuoteEvidence; readonly sourceCodeHash: Hex; readonly destinationBalanceBeforeAtomic: string;
  readonly destinationCodeHash: Hex;
  readonly destinationBalanceBlock: { readonly numberAtomic: string; readonly hash: Hex };
  readonly envelope: StargateNativeEnvelope; readonly totalValueAtomic: string; readonly maximumDebitAtomic: string;
  readonly preparedAt: string; readonly expiresAt: string; readonly phase: StargateNativePhase;
  readonly transitions: readonly StargateNativeTransition[]; readonly transactionHash?: Hex; readonly guid?: Hex;
  readonly sourceReceipt?: StargateSourceReceipt; readonly destinationEvidence?: StargateDestinationEvidence;
  readonly integrityHash: string;
}
export interface StargateSourceReceipt {
  readonly transactionHash: Hex; readonly blockNumberAtomic: string; readonly blockHash: Hex; readonly finality: "safe";
  readonly guid: Hex; readonly amountSentAtomic: string; readonly amountReceivedAtomic: string;
}
export type StargateDestinationEvidence = Readonly<{
  mode: "oft_received"; emitter: Address; sourceTransactionHash: Hex; guid: Hex; sourceEid: 30101;
  destinationTransactionHash: Hex; logIndexAtomic: string; blockNumberAtomic: string; blockHash: Hex; finality: "safe";
  recipient: Address; amountReceivedAtomic: string;
}> | Readonly<{
  mode: "balance_delta"; blockNumberAtomic: string; blockHash: Hex; finality: "safe"; recipient: Address;
  balanceBeforeAtomic: string; balanceAfterAtomic: string; deltaAtomic: string;
}>;

export interface StargateNativePreparationRequest {
  readonly profile: string; readonly owner: Address; readonly recipient: Address; readonly amountAtomic: string;
  readonly maxNativeDebitAtomic: string; readonly idempotencyKey: string; readonly ttlMs?: number;
}
export interface StargatePreparedEnvelopeEvidence {
  readonly nonceAtomic: string; readonly gasLimitAtomic: string; readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string; readonly nativeBalanceAtomic: string;
}
export interface StargateRawLog { readonly address: Address; readonly topics: readonly Hex[]; readonly data: Hex }
export interface StargateConfirmedReceipt {
  readonly transactionHash: Hex; readonly status: "success" | "reverted"; readonly blockNumberAtomic: string;
  readonly blockHash: Hex; readonly finality: "safe"; readonly logs: readonly StargateRawLog[];
}
export interface StargateNativeExecutionPorts {
  readonly sourceCall: EvmRpcCall;
  readonly destinationCall: EvmRpcCall;
  readonly destinationBalance: (recipient: Address) => Promise<Readonly<{ balanceAtomic: string; blockNumberAtomic: string; blockHash: Hex }>>;
  readonly prepareEnvelope: (transaction: Readonly<{ chainId: 1; from: Address; to: Address; data: Hex; valueAtomic: string }>) => Promise<StargatePreparedEnvelopeEvidence>;
  readonly signer: Readonly<{ kind: "imported_evm_signer"; address: Address; signTransaction: (tx: StargateNativeEnvelope) => Promise<Hex> }>;
  readonly signerIdentity: () => Promise<Readonly<{ profile: string; address: Address }>>;
  readonly approve: (operation: StargateNativeOperation) => Promise<void>;
  readonly sendRawTransaction: (raw: Hex) => Promise<Hex>;
  readonly waitSourceReceipt: (transactionHash: Hex) => Promise<StargateConfirmedReceipt | null>;
  readonly observeDestination: (input: Readonly<{ sourceTransactionHash: Hex; guid: Hex; recipient: Address; sourceEid: 30101; destinationPool: Address;
    minimumAmountAtomic: string; balanceBeforeAtomic: string; fromBlockNumberAtomic: string }>) => Promise<StargateDestinationEvidence | null>;
  readonly now?: () => number;
}

export interface StargateNativeJournal {
  load(operationId: string): Promise<StargateNativeOperation | null>; save(next: StargateNativeOperation): Promise<void>;
  withLock<T>(operationId: string, work: () => Promise<T>): Promise<T>;
}

export class FileStargateNativeJournal implements StargateNativeJournal {
  constructor(private readonly root: string) {}
  private path(id: string): string {
    if (!/^[a-f0-9]{64}$/u.test(id)) fail("APN_STATE_CORRUPT", "operation_id");
    return join(this.root, "stargate-v2-native", `${id}.json`);
  }
  async withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const path = this.path(id), directory = dirname(path); await secureDirectory(directory);
    const lock = `${path}.lock`;
    try { await mkdir(lock, { mode: 0o700 }); } catch { return fail("APN_OPERATION_BLOCKED", "operation_locked"); }
    try { return await work(); } finally { await rmdir(lock); }
  }
  async load(id: string): Promise<StargateNativeOperation | null> {
    try {
      const path = this.path(id); await secureDirectory(dirname(path)); const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("APN_STATE_CORRUPT", "journal_file_mode");
      return validateRecord(JSON.parse(await readFile(path, "utf8")));
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async save(nextInput: StargateNativeOperation): Promise<void> {
    const next = validateRecord(nextInput), path = this.path(next.operationId), previous = await this.load(next.operationId);
    validateAdvance(previous, next); const directory = dirname(path); await secureDirectory(directory);
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`, handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(`${canonicalJson(next)}\n`); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, path); const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); }
  }
}

async function secureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 }); const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("APN_STATE_CORRUPT", "journal_directory_mode");
  const resolved = await realpath(directory), parent = await realpath(dirname(directory));
  if (relative(parent, resolved).startsWith("..")) fail("APN_STATE_CORRUPT", "journal_path");
}

export class LocalStargateNativeSigner {
  private readonly wallets: EncryptedWalletStore;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort) { this.wallets = new EncryptedWalletStore(state, wrapping); }
  async identity(profileInput: string, expectedOwner?: Address): Promise<Readonly<{ profile: string; address: Address }>> {
    const profile = canonicalProfile(profileInput), wallet = await this.wallets.describe(profile);
    if (wallet === null) fail("APN_OPERATION_BLOCKED", "wallet_missing");
    try {
      const derived = privateKeyToAccount(wallet.secret.privateKey).address;
      if (wallet.identity.profile !== profile || wallet.identity.address !== derived ||
        (expectedOwner !== undefined && derived !== address(expectedOwner))) fail("APN_OPERATION_BLOCKED", "wallet_owner");
      return { profile, address: derived };
    } finally { this.wallets.clear(wallet.secret); }
  }
  async port(profileInput: string, expectedOwner: Address): Promise<StargateNativeExecutionPorts["signer"]> {
    const profile = canonicalProfile(profileInput), owner = address(expectedOwner), profileHash = this.state.profileHash(profile);
      return { kind: "imported_evm_signer", address: owner, signTransaction: async tx => await this.state.withLocks([`custody:${profileHash}`], async () => {
      const wallet = await this.wallets.describe(profile); if (wallet === null) fail("APN_OPERATION_BLOCKED", "wallet_missing");
      try {
      if (wallet.identity.profile !== profile || wallet.identity.address !== owner ||
        privateKeyToAccount(wallet.secret.privateKey).address !== owner) fail("APN_OPERATION_BLOCKED", "wallet_owner");
        return await privateKeyToAccount(wallet.secret.privateKey).signTransaction({ type: "eip1559", chainId: tx.chainId, to: tx.to, data: tx.data,
          value: BigInt(tx.valueAtomic), nonce: Number(uint(tx.nonceAtomic)), gas: uint(tx.gasLimitAtomic, true),
          maxFeePerGas: uint(tx.maxFeePerGasAtomic, true), maxPriorityFeePerGas: uint(tx.maxPriorityFeePerGasAtomic), accessList: [] });
      } finally { this.wallets.clear(wallet.secret); }
    }) };
  }
}

export async function prepareStargateV2NativeEth(request: StargateNativePreparationRequest, ports: StargateNativeExecutionPorts,
  journal: StargateNativeJournal): Promise<StargateNativeOperation> {
  const now = ports.now ?? Date.now, profile = canonicalProfile(request.profile), owner = address(request.owner), recipient = address(request.recipient);
  if (owner !== recipient) fail("APN_OPERATION_BLOCKED", "first_lane_requires_self_recipient");
  if (ports.signer.kind !== "imported_evm_signer" || address(ports.signer.address) !== owner) fail("APN_OPERATION_BLOCKED", "signer_owner");
  const amount = uint(request.amountAtomic, true), cap = uint(request.maxNativeDebitAtomic, true);
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(request.idempotencyKey)) fail("APN_INVALID_INPUT", "idempotency_key");
  const ttl = request.ttlMs ?? 60_000; if (!Number.isSafeInteger(ttl) || ttl < 15_000 || ttl > MAX_TTL_MS) fail("APN_INVALID_INPUT", "ttl");
  const profileHash = hashObject({ profile }), idempotencyHash = hashObject({ idempotencyKey: request.idempotencyKey });
  const operationId = hashObject({ family: "stargate_v2_native", profileHash, idempotencyHash });
  const existing = await journal.load(operationId);
  if (existing !== null) {
    if (existing.profile !== profile || existing.owner !== owner || existing.recipient !== recipient ||
      existing.amountAtomic !== amount.toString() || existing.maxNativeDebitAtomic !== cap.toString()) {
      fail("APN_OPERATION_BLOCKED", "idempotency_conflict");
    }
    return existing;
  }
  const quote = await quoteStargateV2Direct({ sourceChainId: SOURCE_CHAIN, destinationChainId: DESTINATION_CHAIN,
    sourceToken: "native", destinationToken: "native", recipient, amountAtomic: amount.toString() }, ports.sourceCall);
  assertLane(quote);
  if (quote.quote.amountSentAtomic !== amount.toString()) fail("APN_OPERATION_BLOCKED", "dust_amount_not_supported");
  const quoteTag = `0x${BigInt(quote.block.numberAtomic).toString(16)}`;
  const config = await readSourceConfig(ports.sourceCall, quoteTag);
  const destinationConfig = await readPoolConfig(ports.destinationCall, DESTINATION_CHAIN, DESTINATION_POOL, DESTINATION_EID, "latest");
  const sendParam = { dstEid: DESTINATION_EID, to: pad(recipient, { size: 32 }), amountLD: amount,
    minAmountLD: BigInt(quote.quote.minimumOutputAtomic), extraOptions: "0x" as Hex, composeMsg: "0x" as Hex, oftCmd: "0x" as Hex };
  const finalFee = await requoteFinalSend(ports.sourceCall, sendParam, quoteTag);
  if (finalFee !== BigInt(quote.quote.nativeMessageFeeAtomic)) fail("APN_REPREPARE_REQUIRED", "final_send_fee_differs");
  const value = amount + finalFee;
  const data = encodeFunctionData({ abi: STARGATE_SEND_ABI, functionName: "sendToken",
    args: [sendParam, { nativeFee: finalFee, lzTokenFee: 0n }, owner] });
  const prepared = await ports.prepareEnvelope({ chainId: SOURCE_CHAIN, from: owner, to: SOURCE_POOL, data, valueAtomic: value.toString() });
  const gasUpper = uint(prepared.gasLimitAtomic, true) * uint(prepared.maxFeePerGasAtomic, true), maximumDebit = value + gasUpper;
  if (uint(prepared.maxPriorityFeePerGasAtomic) > uint(prepared.maxFeePerGasAtomic, true)) fail("APN_RPC_PROTOCOL", "priority_fee");
  if (maximumDebit > cap) fail("APN_OPERATION_BLOCKED", "max_native_debit_exceeded");
  if (uint(prepared.nativeBalanceAtomic) < maximumDebit) fail("APN_OPERATION_BLOCKED", "insufficient_native_balance");
  const destination = await ports.destinationBalance(recipient); uint(destination.balanceAtomic); uint(destination.blockNumberAtomic); hex32(destination.blockHash);
  const preparedAt = new Date(now()).toISOString(), expiresAt = new Date(now() + ttl).toISOString();
  const body = {
    schemaVersion: "apn.stargate-v2-native-operation.v1" as const, operationId, profile, profileHash, idempotencyHash,
    owner, recipient, amountAtomic: amount.toString(), maxNativeDebitAtomic: cap.toString(), sourcePool: SOURCE_POOL,
    destinationPool: DESTINATION_POOL, sourceEid: SOURCE_EID, destinationEid: DESTINATION_EID, quote, sourceCodeHash: config.codeHash,
    destinationCodeHash: destinationConfig.codeHash,
    destinationBalanceBeforeAtomic: destination.balanceAtomic, destinationBalanceBlock: { numberAtomic: destination.blockNumberAtomic, hash: destination.blockHash },
    envelope: { chainId: SOURCE_CHAIN, from: owner, to: SOURCE_POOL, data, valueAtomic: value.toString(), nonceAtomic: uint(prepared.nonceAtomic).toString(),
      gasLimitAtomic: uint(prepared.gasLimitAtomic, true).toString(), maxFeePerGasAtomic: uint(prepared.maxFeePerGasAtomic, true).toString(),
      maxPriorityFeePerGasAtomic: uint(prepared.maxPriorityFeePerGasAtomic).toString() },
    totalValueAtomic: value.toString(), maximumDebitAtomic: maximumDebit.toString(), preparedAt, expiresAt,
    phase: "prepared" as const, transitions: [{ phase: "prepared" as const, at: preparedAt, reason: "fresh_quote_and_envelope_frozen" }],
  };
  const operation = seal(body); await journal.save(operation); return operation;
}

export async function executeStargateV2NativeEth(operationId: string, ports: StargateNativeExecutionPorts,
  journal: StargateNativeJournal): Promise<StargateNativeOperation> {
  return await journal.withLock(operationId, async () => await executeLocked(operationId, ports, journal));
}

async function executeLocked(operationId: string, ports: StargateNativeExecutionPorts,
  journal: StargateNativeJournal): Promise<StargateNativeOperation> {
  let operation = await journal.load(operationId); if (operation === null) fail("APN_OPERATION_BLOCKED", "operation_missing");
  if (["submission_started", "submitted", "unknown_finality"].includes(operation.phase)) return await observeOnly(operation, ports, journal);
  if (operation.phase === "observed") return operation;
  const now = ports.now ?? Date.now;
  if (Date.parse(operation.expiresAt) <= now()) fail("APN_REPREPARE_REQUIRED", "expired");
  if (operation.phase === "prepared") {
    await ports.approve(operation);
    operation = transition(operation, "approved", "foreground_owner_confirmation", now()); await journal.save(operation);
  }
  if (Date.parse(operation.expiresAt) <= now()) fail("APN_REPREPARE_REQUIRED", "expired_after_approval");
  const fresh = await quoteStargateV2Direct({ sourceChainId: 1, destinationChainId: 130, sourceToken: "native", destinationToken: "native",
    recipient: operation.recipient, amountAtomic: operation.amountAtomic }, ports.sourceCall);
  assertLane(fresh);
  if (fresh.quote.amountSentAtomic !== operation.quote.quote.amountSentAtomic ||
    fresh.quote.minimumOutputAtomic !== operation.quote.quote.minimumOutputAtomic ||
    fresh.quote.nativeMessageFeeAtomic !== operation.quote.quote.nativeMessageFeeAtomic) {
    fail("APN_REPREPARE_REQUIRED", "quote_changed_after_approval");
  }
  if (fresh.quote.amountSentAtomic !== operation.amountAtomic) fail("APN_REPREPARE_REQUIRED", "dust_amount_changed");
  const config = await readSourceConfig(ports.sourceCall, "latest", operation);
  if (config.codeHash !== operation.sourceCodeHash) fail("APN_REPREPARE_REQUIRED", "source_code_changed");
  const destination = await readPoolConfig(ports.destinationCall, DESTINATION_CHAIN, DESTINATION_POOL, DESTINATION_EID, "latest");
  if (destination.codeHash !== operation.destinationCodeHash) fail("APN_REPREPARE_REQUIRED", "destination_code_changed");
  // Re-read the encrypted profile after every network preflight and immediately before signing.
  const identity = await ports.signerIdentity();
  if (canonicalProfile(identity.profile) !== operation.profile || address(identity.address) !== operation.owner ||
    address(ports.signer.address) !== operation.owner) fail("APN_REPREPARE_REQUIRED", "signer_identity_changed");
  const raw = await ports.signer.signTransaction(operation.envelope); await verifySignedEnvelope(raw, operation);
  const transactionHash = keccak256(raw);
  operation = seal({ ...operation, phase: "submission_started" as const, transactionHash,
    transitions: [...operation.transitions, { phase: "submission_started" as const, at: new Date(now()).toISOString(), reason: "attempt_marked_before_send" }] });
  await journal.save(operation);
  try {
    const returned = await ports.sendRawTransaction(raw);
    if (returned.toLowerCase() !== transactionHash.toLowerCase()) fail("APN_RPC_AMBIGUOUS", "returned_transaction_hash");
    operation = transition(operation, "submitted", "broadcast_returned_exact_hash", now()); await journal.save(operation);
  } catch {
    operation = transition(operation, "unknown_finality", "broadcast_result_ambiguous_no_resend", now()); await journal.save(operation); return operation;
  }
  return await observeOnly(operation, ports, journal);
}

async function observeOnly(input: StargateNativeOperation, ports: StargateNativeExecutionPorts,
  journal: StargateNativeJournal): Promise<StargateNativeOperation> {
  let operation = input;
  if (operation.transactionHash === undefined) fail("APN_STATE_CORRUPT", "attempt_without_hash");
  const receipt = await ports.waitSourceReceipt(operation.transactionHash);
  if (receipt === null) {
    if (operation.phase !== "unknown_finality") { operation = transition(operation, "unknown_finality", "source_receipt_not_safe", (ports.now ?? Date.now)()); await journal.save(operation); }
    return operation;
  }
  const source = sourceReceipt(operation, receipt);
  const destination = await ports.observeDestination({ sourceTransactionHash: source.transactionHash, guid: source.guid,
    recipient: operation.recipient, sourceEid: SOURCE_EID,
    destinationPool: DESTINATION_POOL, minimumAmountAtomic: source.amountReceivedAtomic,
    balanceBeforeAtomic: operation.destinationBalanceBeforeAtomic, fromBlockNumberAtomic: operation.destinationBalanceBlock.numberAtomic });
  if (destination === null) {
    if (operation.sourceReceipt === undefined) {
      const transitions = operation.phase === "submitted" ? operation.transitions : [...operation.transitions,
        { phase: "submitted" as const, at: new Date((ports.now ?? Date.now)()).toISOString(), reason: "source_safe_destination_pending" }];
      operation = seal({ ...operation, phase: "submitted" as const, sourceReceipt: source, transitions }); await journal.save(operation);
    }
    return operation;
  }
  if (destination.mode === "balance_delta") return operation;
  validateDestination(operation, source, destination);
  operation = seal({ ...operation, phase: "observed" as const, guid: source.guid, sourceReceipt: source, destinationEvidence: destination,
    transitions: [...operation.transitions, { phase: "observed" as const, at: new Date((ports.now ?? Date.now)()).toISOString(), reason: "destination_delivery_safe" }] });
  await journal.save(operation); return operation;
}

function sourceReceipt(operation: StargateNativeOperation, receipt: StargateConfirmedReceipt): StargateSourceReceipt {
  if (receipt.status !== "success" || receipt.finality !== "safe" || receipt.transactionHash !== operation.transactionHash) fail("APN_RPC_PROTOCOL", "source_receipt");
  const events = receipt.logs.flatMap(log => {
    if (address(log.address) !== SOURCE_POOL) return [];
    try { const event = decodeEventLog({ abi: STARGATE_SEND_ABI, eventName: "OFTSent", topics: log.topics as [Hex, ...Hex[]], data: log.data }); return [event.args]; }
    catch { return []; }
  });
  if (events.length !== 1) fail("APN_RPC_PROTOCOL", "source_oft_sent_count");
  const event = events[0]!;
  if (event.dstEid !== DESTINATION_EID || address(event.fromAddress) !== operation.owner ||
    event.amountSentLD.toString() !== operation.quote.quote.amountSentAtomic ||
    event.amountReceivedLD.toString() !== operation.quote.quote.minimumOutputAtomic) fail("APN_RPC_PROTOCOL", "source_oft_sent_binding");
  return { transactionHash: operation.transactionHash!, blockNumberAtomic: uint(receipt.blockNumberAtomic).toString(), blockHash: hex32(receipt.blockHash),
    finality: "safe", guid: hex32(event.guid), amountSentAtomic: event.amountSentLD.toString(), amountReceivedAtomic: event.amountReceivedLD.toString() };
}
function validateDestination(operation: StargateNativeOperation, source: StargateSourceReceipt, evidence: StargateDestinationEvidence): void {
  if (evidence.finality !== "safe" || address(evidence.recipient) !== operation.recipient) fail("APN_RPC_PROTOCOL", "destination_binding");
  uint(evidence.blockNumberAtomic); hex32(evidence.blockHash);
  if (evidence.mode === "oft_received") {
    hex32(evidence.destinationTransactionHash); uint(evidence.logIndexAtomic);
    if (evidence.emitter !== DESTINATION_POOL || evidence.sourceTransactionHash !== source.transactionHash ||
      evidence.sourceEid !== SOURCE_EID || evidence.guid !== source.guid ||
      uint(evidence.amountReceivedAtomic) !== uint(source.amountReceivedAtomic)) fail("APN_RPC_PROTOCOL", "destination_event");
  } else {
    if (evidence.balanceBeforeAtomic !== operation.destinationBalanceBeforeAtomic ||
      uint(evidence.balanceAfterAtomic) - uint(evidence.balanceBeforeAtomic) !== uint(evidence.deltaAtomic) ||
      uint(evidence.deltaAtomic) < uint(source.amountReceivedAtomic)) fail("APN_RPC_PROTOCOL", "destination_balance_delta");
  }
}

async function readSourceConfig(call: EvmRpcCall, tag: string, operation?: StargateNativeOperation): Promise<{ codeHash: Hex }> {
  const result = await readPoolConfig(call, SOURCE_CHAIN, SOURCE_POOL, SOURCE_EID, tag);
  const read = async (name: "status" | "paths") => decodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: name,
    data: await call("eth_call", [{ to: SOURCE_POOL, data: encodeFunctionData({ abi: STARGATE_SEND_ABI, functionName: name,
      ...(name === "paths" ? { args: [DESTINATION_EID] } : {}) }) }, tag]) as Hex });
  const [status, credit] = await Promise.all([read("status"), read("paths")]);
  if (status !== 1 || (operation !== undefined && BigInt(credit) < BigInt(operation.amountAtomic) / 1_000_000_000_000n)) fail("APN_REPREPARE_REQUIRED", "source_status_or_credit");
  if (operation !== undefined) {
    const [balance, nonce, simulation] = await Promise.all([
      call("eth_getBalance", [operation.owner, "pending"]), call("eth_getTransactionCount", [operation.owner, "pending"]),
      call("eth_call", [{ from: operation.owner, to: operation.envelope.to, data: operation.envelope.data,
        value: `0x${BigInt(operation.envelope.valueAtomic).toString(16)}` }, "pending"]),
    ]);
    if (rpcQuantity(balance) < BigInt(operation.maximumDebitAtomic) || rpcQuantity(nonce).toString() !== operation.envelope.nonceAtomic) fail("APN_REPREPARE_REQUIRED", "source_balance_or_nonce");
    try {
      const decoded = decodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "sendToken", data: simulation as Hex });
      if (decoded[1].amountSentLD.toString() !== operation.amountAtomic ||
        decoded[1].amountReceivedLD.toString() !== operation.quote.quote.minimumOutputAtomic) throw new Error("amount");
    } catch { fail("APN_REPREPARE_REQUIRED", "source_simulation"); }
  }
  return result;
}
async function readPoolConfig(call: EvmRpcCall, chainId: number, pool: Address, eid: number, tag: string): Promise<{ codeHash: Hex }> {
  if (rpcQuantity(await call("eth_chainId", [])) !== BigInt(chainId)) fail("APN_CHAIN_MISMATCH", "pool_chain_id");
  const code = await call("eth_getCode", [pool, tag]);
  if (typeof code !== "string" || !CODE.test(code) || code === "0x") fail("APN_RPC_PROTOCOL", "source_code");
  const read = async (name: "token" | "localEid" | "sharedDecimals" | "status" | "stargateType") => decodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: name,
    data: await call("eth_call", [{ to: pool, data: encodeFunctionData({ abi: STARGATE_SEND_ABI, functionName: name }) }, tag]) as Hex });
  const [token, actualEid, decimals, status, stargateType] = await Promise.all([read("token"), read("localEid"), read("sharedDecimals"), read("status"), read("stargateType")]);
  let configuredToken: Address; try { configuredToken = getAddress(token as string); } catch { return fail("APN_RPC_PROTOCOL", "source_contract_config"); }
  if (configuredToken !== zeroAddress || actualEid !== eid || decimals !== 6 || status !== 1 || stargateType !== 0) fail("APN_RPC_PROTOCOL", "pool_contract_config");
  if (rpcQuantity(await call("eth_chainId", [])) !== BigInt(chainId)) fail("APN_CHAIN_MISMATCH", "pool_chain_drift");
  return { codeHash: keccak256(code as Hex) };
}

async function verifySignedEnvelope(raw: Hex, operation: StargateNativeOperation): Promise<void> {
  let tx: ReturnType<typeof parseTransaction>, signer: Address;
  try { tx = parseTransaction(raw); signer = getAddress(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })); }
  catch { return fail("APN_RPC_PROTOCOL", "signed_transaction_decode"); }
  const e = operation.envelope;
  if (signer !== operation.owner) fail("APN_RPC_PROTOCOL", "signed_transaction_signer");
  if (tx.chainId !== e.chainId) fail("APN_RPC_PROTOCOL", "signed_transaction_chain");
  if (tx.to?.toLowerCase() !== e.to.toLowerCase()) fail("APN_RPC_PROTOCOL", "signed_transaction_to");
  if ((tx.data ?? "0x").toLowerCase() !== e.data.toLowerCase()) fail("APN_RPC_PROTOCOL", "signed_transaction_data");
  if ((tx.value ?? 0n) !== BigInt(e.valueAtomic)) fail("APN_RPC_PROTOCOL", "signed_transaction_value");
  if (tx.nonce !== Number(e.nonceAtomic)) fail("APN_RPC_PROTOCOL", "signed_transaction_nonce");
  if (tx.gas !== BigInt(e.gasLimitAtomic)) fail("APN_RPC_PROTOCOL", "signed_transaction_gas");
  if (tx.maxFeePerGas !== BigInt(e.maxFeePerGasAtomic)) fail("APN_RPC_PROTOCOL", "signed_transaction_max_fee");
  if (tx.maxPriorityFeePerGas !== BigInt(e.maxPriorityFeePerGasAtomic)) fail("APN_RPC_PROTOCOL", "signed_transaction_priority_fee");
}
async function requoteFinalSend(call: EvmRpcCall, sendParam: Readonly<Record<string, unknown>>, tag: string): Promise<bigint> {
  const data = encodeFunctionData({ abi: STARGATE_QUOTE_ABI, functionName: "quoteSend", args: [sendParam as never, false] });
  const raw = await call("eth_call", [{ to: SOURCE_POOL, data }, tag]);
  if (typeof raw !== "string") fail("APN_RPC_PROTOCOL", "final_quote_send");
  const [fee] = decodeAbiParameters(STARGATE_QUOTE_SEND_OUTPUT, raw as Hex);
  if (fee.lzTokenFee !== 0n) fail("APN_RPC_PROTOCOL", "lz_token_fee"); return fee.nativeFee;
}
function assertLane(quote: StargateV2QuoteEvidence): void {
  const r = quote.route;
  if (r.sourceChainId !== SOURCE_CHAIN || r.destinationChainId !== DESTINATION_CHAIN || r.sourceEid !== SOURCE_EID ||
    r.destinationEid !== DESTINATION_EID || r.sourcePool !== SOURCE_POOL || r.destinationPool !== DESTINATION_POOL || r.asset !== "ETH") {
    fail("APN_OPERATION_BLOCKED", "lane");
  }
}
function transition(operation: StargateNativeOperation, phase: StargateNativePhase, reason: string, at: number): StargateNativeOperation {
  return seal({ ...operation, phase, transitions: [...operation.transitions, { phase, at: new Date(at).toISOString(), reason }] });
}
function seal<T extends Omit<StargateNativeOperation, "integrityHash"> & { integrityHash?: never } | StargateNativeOperation>(value: T): StargateNativeOperation {
  const { integrityHash: _old, ...body } = value as StargateNativeOperation; return Object.freeze({ ...body, integrityHash: hashObject(body) }) as StargateNativeOperation;
}
function validateRecord(value: unknown): StargateNativeOperation {
  if (!isPlainRecord(value) || value.schemaVersion !== "apn.stargate-v2-native-operation.v1") fail("APN_STATE_CORRUPT", "schema");
  const record = value as unknown as StargateNativeOperation, { integrityHash, ...body } = record;
  if (hashObject(body) !== integrityHash || record.transitions.at(-1)?.phase !== record.phase || record.operationId.length !== 64) fail("APN_STATE_CORRUPT", "integrity");
  const order: StargateNativePhase[] = ["prepared", "approved", "submission_started", "submitted", "observed"];
  for (let i = 1; i < record.transitions.length; i++) {
    const a = record.transitions[i - 1]!.phase, b = record.transitions[i]!.phase;
    if (b === "unknown_finality") { if (!["submission_started", "submitted"].includes(a)) fail("APN_STATE_CORRUPT", "transition"); }
    else if (a === "unknown_finality") { if (!["submitted", "observed"].includes(b)) fail("APN_STATE_CORRUPT", "transition"); }
    else if (order.indexOf(b) < order.indexOf(a) || order.indexOf(b) > order.indexOf(a) + 1) fail("APN_STATE_CORRUPT", "transition");
  }
  return record;
}
function validateAdvance(previous: StargateNativeOperation | null, next: StargateNativeOperation): void {
  if (previous === null) { if (next.phase !== "prepared" || next.transitions.length !== 1) fail("APN_STATE_CORRUPT", "initial_state"); return; }
  const frozen = (x: StargateNativeOperation) => { const { phase: _p, transitions: _t, integrityHash: _i, transactionHash: _h, guid: _g,
    sourceReceipt: _s, destinationEvidence: _d, ...rest } = x; return rest; };
  if (canonicalJson(frozen(previous)) !== canonicalJson(frozen(next)) || next.transitions.length < previous.transitions.length ||
    canonicalJson(next.transitions.slice(0, previous.transitions.length)) !== canonicalJson(previous.transitions) ||
    (previous.transactionHash !== undefined && previous.transactionHash !== next.transactionHash)) fail("APN_STATE_CORRUPT", "journal_rewrite");
}

export interface StargateNativeCanonicalReceipt {
  readonly schemaVersion: "apn.stargate-v2-native-receipt.v1"; readonly operationId: string; readonly profile: string;
  readonly route: Readonly<{ sourceChainId: 1; sourceEid: 30101; sourcePool: Address; destinationChainId: 130;
    destinationEid: 30320; destinationPool: Address }>;
  readonly owner: Address; readonly recipient: Address; readonly principalAtomic: string; readonly nativeMessageFeeAtomic: string;
  readonly totalValueAtomic: string; readonly maximumDebitAtomic: string; readonly quoteHash: string;
  readonly source: StargateSourceReceipt; readonly destination: StargateDestinationEvidence; readonly evidenceHash: string;
}

export function stargateV2NativeCanonicalReceipt(operationInput: StargateNativeOperation): StargateNativeCanonicalReceipt {
  const operation = validateRecord(operationInput);
  if (operation.phase !== "observed" || operation.sourceReceipt === undefined || operation.destinationEvidence === undefined) {
    fail("APN_OPERATION_BLOCKED", "receipt_not_observed");
  }
  const body = { schemaVersion: "apn.stargate-v2-native-receipt.v1" as const, operationId: operation.operationId,
    profile: operation.profile, route: { sourceChainId: SOURCE_CHAIN, sourceEid: SOURCE_EID, sourcePool: SOURCE_POOL,
      destinationChainId: DESTINATION_CHAIN, destinationEid: DESTINATION_EID, destinationPool: DESTINATION_POOL },
    owner: operation.owner, recipient: operation.recipient, principalAtomic: operation.amountAtomic,
    nativeMessageFeeAtomic: operation.quote.quote.nativeMessageFeeAtomic, totalValueAtomic: operation.totalValueAtomic,
    maximumDebitAtomic: operation.maximumDebitAtomic, quoteHash: operation.quote.quoteHash,
    source: operation.sourceReceipt, destination: operation.destinationEvidence };
  return Object.freeze({ ...body, evidenceHash: hashObject(body) });
}
