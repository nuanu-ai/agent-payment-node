import { lstat, mkdir, open, readFile, realpath, rename } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeFunctionData, getAddress, keccak256, pad, parseTransaction,
  recoverTransactionAddress, zeroAddress, type Hex, type TransactionSerialized,
} from "viem";
import { canonicalJson, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { EvmRpcCall } from "../evm-ports.js";
import type { Address } from "../model.js";
import { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { LAYERZERO_EXECUTOR_ABI, STARGATE_ERC20_ABI, STARGATE_QUOTE_ABI, STARGATE_SEND_ABI } from "./abi.js";
import { assertStargateV2RouteFinalityPolicy, stargateV2RouteFinalityPolicy, type StargateV2FinalityTag,
  type StargateV2RouteFinalityPolicy } from "./finality-policy.js";
import { quoteStargateV2Direct, type StargateV2QuoteEvidence } from "./quote.js";
export const STARGATE_TOKEN_SOURCE_CHAIN = 10 as const;
export const STARGATE_TOKEN_DESTINATION_CHAIN = 137 as const;
export const STARGATE_TOKEN_SOURCE_EID = 30111 as const;
export const STARGATE_TOKEN_DESTINATION_EID = 30109 as const;
export const STARGATE_TOKEN_SOURCE_TOKEN = getAddress("0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85");
export const STARGATE_TOKEN_DESTINATION_TOKEN = getAddress("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359");
export const STARGATE_TOKEN_SOURCE_POOL = getAddress("0xcE8CcA271Ebc0533920C83d39F417ED6A0abB7D0");
export const STARGATE_TOKEN_DESTINATION_POOL = getAddress("0x9Aa02D4Fae7F58b8E8f34c66E756cC734DAc7fe4");
/** Official LayerZero Optimism mainnet Executor at lz-address-book commit 7c800d6. */
export const STARGATE_TOKEN_SOURCE_EXECUTOR = getAddress("0x2D2ea0697bdbede3F01553D2Ae4B8d0c486B666e");
export const STARGATE_TOKEN_DESTINATION_EXECUTOR = getAddress("0xCd3F213AD101472e1713C72B1697E727C803885b");
export const STARGATE_TOKEN_MECHANISM = Object.freeze({ provider: "stargate-v2", reference:
  `eip155:10:${STARGATE_TOKEN_SOURCE_POOL}/eip155:137:${STARGATE_TOKEN_DESTINATION_POOL}` });
const UINT = /^(?:0|[1-9][0-9]{0,77})$/u, HASH = /^0x[0-9a-f]{64}$/u, CODE = /^0x(?:[0-9a-f]{2})+$/u;
const MAX_TTL_MS = 120_000;
function fail(code: "APN_INVALID_INPUT" | "APN_OPERATION_BLOCKED" | "APN_RPC_PROTOCOL" | "APN_RPC_AMBIGUOUS" |
  "APN_CHAIN_MISMATCH" | "APN_REPREPARE_REQUIRED" | "APN_STATE_CORRUPT", reason: string): never {
  throw new ApnError(code, `Direct Stargate V2 token execution failed closed: ${reason}.`, { reason });
}
function uint(value: unknown, positive = false): bigint {
  if (typeof value !== "string" || !UINT.test(value)) return fail("APN_INVALID_INPUT", "noncanonical_uint");
  const n = BigInt(value); if (n >= 1n << 256n || (positive && n === 0n)) return fail("APN_INVALID_INPUT", "uint_range"); return n;
}
function address(value: unknown): Address { try { const a = getAddress(value as string); if (a === zeroAddress) throw 0; return a; } catch { return fail("APN_INVALID_INPUT", "address"); } }
function hex32(value: unknown): Hex { if (typeof value !== "string" || !HASH.test(value)) return fail("APN_RPC_PROTOCOL", "hash"); return value as Hex; }
function quantity(value: unknown): bigint { if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)) return fail("APN_RPC_PROTOCOL", "quantity"); return BigInt(value); }
/** Exact OptionsBuilder.addExecutorNativeDropOption Type-3 wire encoding. */
export function encodeStargateNativeDrop(amountInput: string, recipientInput: Address): Hex {
  const amount = uint(amountInput, true), recipient = address(recipientInput);
  if (amount >= 1n << 128n) fail("APN_INVALID_INPUT", "native_drop_uint128");
  return (`0x0003` + `01` + `0031` + `02` + amount.toString(16).padStart(32, "0") + recipient.slice(2).toLowerCase().padStart(64, "0")) as Hex;
}
export type StargateTokenPhase = "prepared" | "approved" | "allowance_submission_started" | "allowance_unknown_finality" |
  "allowance_submitted" | "allowance_observed" | "submission_started" | "unknown_finality" | "submitted" | "observed" |
  "cleanup_required" | "cleanup_submission_started" | "cleanup_submitted" | "cleanup_unknown_finality" | "cleaned";
export type StargateTokenUsageState = "reserved" | "submitted" | "unknown_finality" | "finalized" |
  "failed_before_effect" | "failed_confirmed_revert";
export interface StargateTokenTransition { readonly phase: StargateTokenPhase; readonly at: string; readonly reason: string }
export interface StargateTokenEnvelope { readonly chainId: 10; readonly from: Address; readonly to: Address; readonly data: Hex;
  readonly valueAtomic: string; readonly nonceAtomic: string; readonly gasLimitAtomic: string; readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string }
export interface StargateTokenSourceReceipt { readonly transactionHash: Hex; readonly blockNumberAtomic: string; readonly blockHash: Hex;
  readonly finality: StargateV2FinalityTag; readonly guid: Hex; readonly amountSentAtomic: string; readonly amountReceivedAtomic: string }
export interface StargateTokenDestinationEvidence { readonly emitter: Address; readonly sourceTransactionHash: Hex; readonly guid: Hex;
  readonly sourceEid: 30111; readonly destinationTransactionHash: Hex; readonly logIndexAtomic: string; readonly blockNumberAtomic: string;
  readonly blockHash: Hex; readonly finality: StargateV2FinalityTag; readonly recipient: Address; readonly amountReceivedAtomic: string;
  readonly tokenBalanceBeforeAtomic: string; readonly tokenBalanceAfterAtomic: string; readonly tokenDeltaAtomic: string;
  readonly nativeBalanceBeforeAtomic: string; readonly nativeBalanceAfterAtomic: string; readonly nativeDeltaAtomic: string;
  readonly nativeDrop?: Readonly<{ readonly executor: Address; readonly nonceAtomic: string; readonly success: true }> }
export interface StargateTokenPolicyBinding { readonly policyDigest: string; readonly policyRevision: number;
  readonly mechanism: Readonly<{ readonly provider: string; readonly reference: string }> }
export interface StargateTokenOperation {
  readonly schemaVersion: "apn.stargate-v2-token-operation.v1"; readonly operationId: string; readonly profile: string;
  readonly profileHash: string; readonly idempotencyHash: string; readonly owner: Address; readonly recipient: Address;
  readonly finalityPolicy: StargateV2RouteFinalityPolicy;
  readonly amountAtomic: string; readonly nativeDropAtomic: string; readonly maxNativeDebitAtomic: string; readonly minOutputAtomic: string;
  readonly sourceToken: Address; readonly destinationToken: Address; readonly sourcePool: Address; readonly destinationPool: Address;
  readonly sourceEid: 30111; readonly destinationEid: 30109; readonly executor: Address; readonly executorNativeCapAtomic: string;
  readonly options: Hex; readonly quote: StargateV2QuoteEvidence; readonly sourceCodeHash: Hex; readonly destinationCodeHash: Hex;
  readonly sourceTokenCodeHash: Hex; readonly destinationTokenCodeHash: Hex; readonly policy: StargateTokenPolicyBinding;
  readonly destinationTokenBalanceBeforeAtomic: string; readonly destinationNativeBalanceBeforeAtomic: string;
  readonly destinationBalanceBlock: { readonly numberAtomic: string; readonly hash: Hex };
  readonly initialAllowanceAtomic: string; readonly allowanceRequired: boolean; readonly approvalEnvelope?: StargateTokenEnvelope;
  readonly sendEnvelope: StargateTokenEnvelope; readonly maximumDebitAtomic: string; readonly preparedAt: string; readonly expiresAt: string;
  readonly phase: StargateTokenPhase; readonly transitions: readonly StargateTokenTransition[]; readonly approvalTransactionHash?: Hex;
  readonly transactionHash?: Hex; readonly residualAllowanceAtomic?: string; readonly sourceReceipt?: StargateTokenSourceReceipt;
  readonly destinationEvidence?: StargateTokenDestinationEvidence; readonly cleanupEnvelope?: StargateTokenEnvelope;
  readonly cleanupTransactionHash?: Hex; readonly cleanupReason?: string; readonly usageState?: StargateTokenUsageState;
  /** Durable desired ledger transition. Presence means the idempotent ledger call still needs reconciliation. */
  readonly usageTarget?: StargateTokenUsageState; readonly integrityHash: string;
}
export interface StargateTokenPreparationRequest { readonly profile: string; readonly owner: Address; readonly recipient: Address;
  readonly amountAtomic: string; readonly nativeDropAtomic: string; readonly minOutputAtomic: string; readonly maxNativeDebitAtomic: string;
  readonly idempotencyKey: string; readonly ttlMs?: number }
export interface StargateTokenPreparedEnvelope { readonly nonceAtomic: string; readonly gasLimitAtomic: string; readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string; readonly nativeBalanceAtomic: string }
export interface StargateTokenRawLog { readonly address: Address; readonly topics: readonly Hex[]; readonly data: Hex }
export interface StargateTokenConfirmedReceipt { readonly transactionHash: Hex; readonly status: "success" | "reverted";
  readonly blockNumberAtomic: string; readonly blockHash: Hex; readonly finality: StargateV2FinalityTag; readonly logs: readonly StargateTokenRawLog[] }
export interface StargateTokenExecutionPorts {
  readonly sourceCall: EvmRpcCall; readonly destinationCall: EvmRpcCall;
  readonly destinationBalances: (recipient: Address, finalityTag: StargateV2FinalityTag) => Promise<Readonly<{ tokenAtomic: string; nativeAtomic: string; blockNumberAtomic: string; blockHash: Hex }>>;
  readonly prepareEnvelope: (transaction: Readonly<{ chainId: 10; from: Address; to: Address; data: Hex; valueAtomic: string; nonceAtomic?: string }>) => Promise<StargateTokenPreparedEnvelope>;
  readonly signer: Readonly<{ kind: "imported_evm_signer"; address: Address; signTransaction: (tx: StargateTokenEnvelope) => Promise<Hex> }>;
  readonly signerIdentity: () => Promise<Readonly<{ profile: string; address: Address }>>; readonly approve: (operation: StargateTokenOperation) => Promise<void>;
  readonly approveCleanup: (operation: StargateTokenOperation) => Promise<void>;
  readonly admitPolicy: (input: Readonly<{ profile: string; owner: Address; amountAtomic: string; operationId: string }>) => Promise<StargateTokenPolicyBinding>;
  readonly confirmPolicy: (operation: StargateTokenOperation) => Promise<void>;
  readonly reserveUsage: (operation: StargateTokenOperation) => Promise<StargateTokenUsageState>;
  readonly followUsage: (operation: StargateTokenOperation, state: Exclude<StargateTokenUsageState, "reserved">) => Promise<StargateTokenUsageState>;
  readonly sendRawTransaction: (raw: Hex) => Promise<Hex>;
  readonly waitSourceReceipt: (transactionHash: Hex, finalityTag: StargateV2FinalityTag) => Promise<StargateTokenConfirmedReceipt | null>;
  readonly observeDestination: (input: Readonly<{ sourceTransactionHash: Hex; guid: Hex; recipient: Address; sourceEid: 30111;
    destinationPool: Address; minimumAmountAtomic: string; tokenBalanceBeforeAtomic: string; nativeBalanceBeforeAtomic: string;
    nativeDropAtomic: string; fromBlockNumberAtomic: string; fromBlockHash: Hex;
    finalityTag: StargateV2FinalityTag }>) => Promise<StargateTokenDestinationEvidence | null>;
  readonly now?: () => number;
}
export interface StargateTokenJournal { load(id: string): Promise<StargateTokenOperation | null>; save(op: StargateTokenOperation): Promise<void>;
  withLock<T>(id: string, work: () => Promise<T>): Promise<T>;
  withOwnerChainLock<T>(owner: Address, chainId: number, work: () => Promise<T>): Promise<T> }
export class FileStargateTokenJournal implements StargateTokenJournal {
  private readonly locks: Pick<StateStore, "initialize" | "withLocks">;
  constructor(private readonly root: string, locks?: Pick<StateStore, "initialize" | "withLocks">) { this.locks = locks ?? new StateStore(root, { lockWaitMs: 0 }); }
  private path(id: string) { if (!/^[a-f0-9]{64}$/u.test(id)) fail("APN_STATE_CORRUPT", "operation_id"); return join(this.root, "stargate-v2-token", `${id}.json`); }
  async withLock<T>(id: string, work: () => Promise<T>) { await this.locks.initialize(); return await this.locks.withLocks([`stargate-token:${id}`], work, { waitMs: 30_000 }); }
  async withOwnerChainLock<T>(owner: Address, chainId: number, work: () => Promise<T>) { await this.locks.initialize();
    return await this.locks.withLocks([`stargate-source:${chainId}:${address(owner).toLowerCase()}`], work, { waitMs: 30_000 }); }
  async load(id: string) { try { const path = this.path(id); await secureDirectory(dirname(path), false); const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("APN_STATE_CORRUPT", "journal_file_mode");
    return validateRecord(JSON.parse(await readFile(path, "utf8"))); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; } }
  async save(nextInput: StargateTokenOperation) { const next = validateRecord(nextInput), path = this.path(next.operationId), previous = await this.load(next.operationId);
    validateAdvance(previous, next); const directory = dirname(path); await secureDirectory(directory); const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
    const handle = await open(temp, "wx", 0o600); try { await handle.writeFile(`${canonicalJson(next)}\n`); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, path); const dir = await open(directory, "r"); try { await dir.sync(); } finally { await dir.close(); } }
}
async function secureDirectory(directory: string, create = true) { if (create) await mkdir(directory, { recursive: true, mode: 0o700 }); const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) fail("APN_STATE_CORRUPT", "journal_directory_mode");
  if (relative(await realpath(dirname(directory)), await realpath(directory)).startsWith("..")) fail("APN_STATE_CORRUPT", "journal_path"); }
export async function prepareStargateV2Token(request: StargateTokenPreparationRequest, ports: StargateTokenExecutionPorts,
  journal: StargateTokenJournal): Promise<StargateTokenOperation> {
  const now = ports.now ?? Date.now, profile = canonicalProfile(request.profile), owner = address(request.owner), recipient = address(request.recipient);
  if (owner !== recipient) fail("APN_OPERATION_BLOCKED", "first_lane_requires_self_recipient");
  if (ports.signer.kind !== "imported_evm_signer" || address(ports.signer.address) !== owner) fail("APN_OPERATION_BLOCKED", "signer_owner");
  const amount = uint(request.amountAtomic, true), drop = uint(request.nativeDropAtomic), minOut = uint(request.minOutputAtomic, true), cap = uint(request.maxNativeDebitAtomic, true);
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(request.idempotencyKey)) fail("APN_INVALID_INPUT", "idempotency_key");
  const ttl = request.ttlMs ?? 60_000; if (!Number.isSafeInteger(ttl) || ttl < 15_000 || ttl > MAX_TTL_MS) fail("APN_INVALID_INPUT", "ttl");
  const profileHash = hashObject({ profile }), idempotencyHash = hashObject({ idempotencyKey: request.idempotencyKey });
  const operationId = hashObject({ family: "stargate_v2_token", profileHash, idempotencyHash });
  const existing = await journal.load(operationId); if (existing !== null) {
    if (existing.profile !== profile || existing.owner !== owner || existing.recipient !== recipient || existing.amountAtomic !== amount.toString() ||
      existing.nativeDropAtomic !== drop.toString() || existing.minOutputAtomic !== minOut.toString() || existing.maxNativeDebitAtomic !== cap.toString()) fail("APN_OPERATION_BLOCKED", "idempotency_conflict");
    return existing;
  }
  const options = drop === 0n ? "0x" as Hex : encodeStargateNativeDrop(drop.toString(), recipient);
  const nativeCap = await readExecutorCap(ports.sourceCall, "latest"); if (drop > nativeCap) fail("APN_OPERATION_BLOCKED", "native_drop_cap_exceeded");
  const quote = await quoteStargateV2Direct({ sourceChainId: 10, destinationChainId: 137, sourceToken: STARGATE_TOKEN_SOURCE_TOKEN,
    destinationToken: STARGATE_TOKEN_DESTINATION_TOKEN, recipient, amountAtomic: amount.toString(), extraOptions: options }, ports.sourceCall);
  assertLane(quote); if (quote.quote.amountSentAtomic !== amount.toString()) fail("APN_OPERATION_BLOCKED", "dust_amount_not_supported");
  if (BigInt(quote.quote.minimumOutputAtomic) < minOut) fail("APN_OPERATION_BLOCKED", "minimum_output_not_met");
  const source = await readPoolConfig(ports.sourceCall, 10, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, 30111, "latest");
  const destination = await readPoolConfig(ports.destinationCall, 137, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, 30109, "latest");
  const finalityPolicy = stargateV2RouteFinalityPolicy(STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_DESTINATION_CHAIN);
  const [allowance, tokenBalance, dest] = await Promise.all([readAllowance(ports.sourceCall, owner, "pending"), readTokenBalance(ports.sourceCall, STARGATE_TOKEN_SOURCE_TOKEN, owner, "pending"),
    ports.destinationBalances(recipient, finalityPolicy.destination.blockTag)]);
  if (tokenBalance < amount) fail("APN_OPERATION_BLOCKED", "insufficient_token_balance");
  if (allowance !== 0n && allowance !== amount) fail("APN_OPERATION_BLOCKED", "residual_allowance_cleanup_required");
  const sendParam = { dstEid: 30109, to: pad(recipient, { size: 32 }), amountLD: amount, minAmountLD: BigInt(quote.quote.minimumOutputAtomic),
    extraOptions: options, composeMsg: "0x" as Hex, oftCmd: "0x" as Hex };
  const exactFee = await requoteSend(ports.sourceCall, sendParam, `0x${BigInt(quote.block.numberAtomic).toString(16)}`);
  if (exactFee !== BigInt(quote.quote.nativeMessageFeeAtomic)) fail("APN_REPREPARE_REQUIRED", "exact_send_fee_changed");
  const sendData = encodeFunctionData({ abi: STARGATE_SEND_ABI, functionName: "sendToken", args: [sendParam,
    { nativeFee: BigInt(quote.quote.nativeMessageFeeAtomic), lzTokenFee: 0n }, owner] });
  const approvalRequired = allowance === 0n;
  const approvalData = encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "approve", args: [STARGATE_TOKEN_SOURCE_POOL, amount] });
  const approvalPrepared = approvalRequired ? await ports.prepareEnvelope({ chainId: 10, from: owner, to: STARGATE_TOKEN_SOURCE_TOKEN, data: approvalData, valueAtomic: "0" }) : undefined;
  const baseNonce = approvalPrepared?.nonceAtomic;
  const sendPrepared = await ports.prepareEnvelope({ chainId: 10, from: owner, to: STARGATE_TOKEN_SOURCE_POOL, data: sendData,
    valueAtomic: quote.quote.nativeMessageFeeAtomic, ...(baseNonce === undefined ? {} : { nonceAtomic: (BigInt(baseNonce) + 1n).toString() }) });
  const envelope = (to: Address, data: Hex, value: string, p: StargateTokenPreparedEnvelope): StargateTokenEnvelope => ({ chainId: 10, from: owner, to, data,
    valueAtomic: value, nonceAtomic: uint(p.nonceAtomic).toString(), gasLimitAtomic: uint(p.gasLimitAtomic, true).toString(),
    maxFeePerGasAtomic: uint(p.maxFeePerGasAtomic, true).toString(), maxPriorityFeePerGasAtomic: uint(p.maxPriorityFeePerGasAtomic).toString() });
  const approvalEnvelope = approvalPrepared === undefined ? undefined : envelope(STARGATE_TOKEN_SOURCE_TOKEN, approvalData, "0", approvalPrepared);
  const sendEnvelope = envelope(STARGATE_TOKEN_SOURCE_POOL, sendData, quote.quote.nativeMessageFeeAtomic, sendPrepared);
  for (const e of [approvalEnvelope, sendEnvelope].filter((x): x is StargateTokenEnvelope => x !== undefined)) if (BigInt(e.maxPriorityFeePerGasAtomic) > BigInt(e.maxFeePerGasAtomic)) fail("APN_RPC_PROTOCOL", "priority_fee");
  const gasDebit = [approvalEnvelope, sendEnvelope].filter((x): x is StargateTokenEnvelope => x !== undefined)
    .reduce((sum, e) => sum + BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic), 0n);
  const maximumDebit = BigInt(quote.quote.nativeMessageFeeAtomic) + gasDebit;
  if (maximumDebit > cap) fail("APN_OPERATION_BLOCKED", "max_native_debit_exceeded");
  if (BigInt(sendPrepared.nativeBalanceAtomic) < maximumDebit) fail("APN_OPERATION_BLOCKED", "insufficient_native_balance");
  const policy = await ports.admitPolicy({ profile, owner, amountAtomic: amount.toString(), operationId });
  const preparedAt = new Date(now()).toISOString(), expiresAt = new Date(now() + ttl).toISOString();
  const body = { schemaVersion: "apn.stargate-v2-token-operation.v1" as const, operationId, profile, profileHash, idempotencyHash, owner, recipient, finalityPolicy,
    amountAtomic: amount.toString(), nativeDropAtomic: drop.toString(), maxNativeDebitAtomic: cap.toString(), minOutputAtomic: minOut.toString(),
    sourceToken: STARGATE_TOKEN_SOURCE_TOKEN, destinationToken: STARGATE_TOKEN_DESTINATION_TOKEN, sourcePool: STARGATE_TOKEN_SOURCE_POOL,
    destinationPool: STARGATE_TOKEN_DESTINATION_POOL, sourceEid: 30111 as const, destinationEid: 30109 as const,
    executor: STARGATE_TOKEN_SOURCE_EXECUTOR, executorNativeCapAtomic: nativeCap.toString(), options, quote,
    sourceCodeHash: source.poolCodeHash, destinationCodeHash: destination.poolCodeHash, sourceTokenCodeHash: source.tokenCodeHash,
    destinationTokenCodeHash: destination.tokenCodeHash, policy, destinationTokenBalanceBeforeAtomic: dest.tokenAtomic,
    destinationNativeBalanceBeforeAtomic: dest.nativeAtomic, destinationBalanceBlock: { numberAtomic: dest.blockNumberAtomic, hash: dest.blockHash },
    initialAllowanceAtomic: allowance.toString(), allowanceRequired: approvalRequired, ...(approvalEnvelope === undefined ? {} : { approvalEnvelope }), sendEnvelope,
    maximumDebitAtomic: maximumDebit.toString(), preparedAt, expiresAt, phase: "prepared" as const,
    transitions: [{ phase: "prepared" as const, at: preparedAt, reason: "fresh_quote_caps_allowance_and_envelopes_frozen" }],
  };
  const operation = seal(body); await journal.save(operation); return operation;
}
export async function executeStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  const initial = await journal.load(id); if (initial === null) fail("APN_OPERATION_BLOCKED", "operation_missing");
  return await journal.withOwnerChainLock(initial.owner, 10, async () =>
    await journal.withLock(id, async () => await executeLocked(id, ports, journal)));
}
/** Network observation only: it may advance an attempted effect and can never sign or broadcast. */
export async function observeStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  return await journal.withLock(id, async () => {
    let op = await journal.load(id); if (op === null) fail("APN_OPERATION_BLOCKED", "operation_missing");
    op = await reconcileUsageOrCleanup(op, ports, journal);
    if (["allowance_submission_started", "allowance_unknown_finality", "allowance_submitted"].includes(op.phase)) {
      return await observeAllowance(op, ports, journal);
    }
    if (["submission_started", "unknown_finality", "submitted"].includes(op.phase)) return await observeBridge(op, ports, journal);
    if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase)) return await observeCleanup(op, ports, journal);
    if (op.phase === "observed" || op.phase === "cleaned" || op.phase === "cleanup_required") return op;
    fail("APN_OPERATION_BLOCKED", "operation_not_attempted");
  });
}
async function executeLocked(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal): Promise<StargateTokenOperation> {
  let op = await journal.load(id); if (op === null) fail("APN_OPERATION_BLOCKED", "operation_missing"); const now = ports.now ?? Date.now;
  op = await reconcileUsageOrCleanup(op, ports, journal);
  if (op.phase === "observed" || op.phase === "cleaned" || op.phase === "cleanup_required") return op;
  if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase)) {
    fail("APN_OPERATION_BLOCKED", "cleanup_command_required");
  }
  if (["allowance_submission_started", "allowance_unknown_finality", "allowance_submitted"].includes(op.phase)) {
    op = await observeAllowance(op, ports, journal); if (op.phase !== "allowance_observed") return op;
  }
  if (["submission_started", "unknown_finality", "submitted"].includes(op.phase)) return await observeBridge(op, ports, journal);
  if (Date.parse(op.expiresAt) <= now()) {
    if (op.phase === "allowance_observed") return await requireCleanup(op, ports, journal, "expired_after_allowance");
    fail("APN_REPREPARE_REQUIRED", "expired");
  }
  if (op.phase === "prepared") { await ports.approve(op); op = transition(op, "approved", "foreground_owner_confirmation", now()); await journal.save(op); }
  if (op.allowanceRequired && op.phase === "approved") {
    await freshPreflight(op, ports, "before_approval"); await ports.confirmPolicy(op);
    const raw = await ports.signer.signTransaction(op.approvalEnvelope!); await verifySignedEnvelope(raw, op.owner, op.approvalEnvelope!);
    const hash = keccak256(raw); op = transition({ ...op, approvalTransactionHash: hash }, "allowance_submission_started", "approval_attempt_marked_before_send", now()); await journal.save(op);
    try { if ((await ports.sendRawTransaction(raw)).toLowerCase() !== hash.toLowerCase()) fail("APN_RPC_AMBIGUOUS", "approval_hash");
      op = transition(op, "allowance_submitted", "approval_broadcast_returned_exact_hash", now()); await journal.save(op);
    } catch { op = transition(op, "allowance_unknown_finality", "approval_broadcast_ambiguous_no_resend", now()); await journal.save(op); return op; }
    op = await observeAllowance(op, ports, journal); if (op.phase !== "allowance_observed") return op;
  }
  try {
    await freshPreflight(op, ports, "before_send"); await ports.confirmPolicy(op);
    const identity = await ports.signerIdentity(); if (canonicalProfile(identity.profile) !== op.profile || address(identity.address) !== op.owner || address(ports.signer.address) !== op.owner) fail("APN_REPREPARE_REQUIRED", "signer_identity_changed");
  } catch (error) { return await requireCleanup(op, ports, journal, error instanceof ApnError ? String(error.details?.reason ?? error.code) : "bridge_preflight_failed"); }
  op = await markUsageTarget(op, "reserved", journal);
  try { op = await reconcileUsage(op, ports, journal); }
  catch (error) {
    op = await requireCleanup(op, ports, journal, error instanceof ApnError ? `usage_reservation_${String(error.code).toLowerCase()}` : "usage_reservation_failed");
    op = await markUsageTarget(op, "failed_before_effect", journal); try { op = await reconcileUsage(op, ports, journal); } catch { /* durable target retries */ }
    return op;
  }
  let raw: Hex;
  try { raw = await ports.signer.signTransaction(op.sendEnvelope); await verifySignedEnvelope(raw, op.owner, op.sendEnvelope); }
  catch (error) { op = await requireCleanup(op, ports, journal, "bridge_signing_failed"); op = await markUsageTarget(op, "failed_before_effect", journal);
    try { await reconcileUsage(op, ports, journal); } catch { /* durable target retries */ } throw error; }
  const hash = keccak256(raw);
  op = transition({ ...op, transactionHash: hash }, "submission_started", "bridge_attempt_marked_before_send", now()); await journal.save(op);
  try { if ((await ports.sendRawTransaction(raw)).toLowerCase() !== hash.toLowerCase()) fail("APN_RPC_AMBIGUOUS", "send_hash"); }
  catch { op = transition(op, "unknown_finality", "bridge_broadcast_ambiguous_no_resend", now()); await journal.save(op); op = await markUsageTarget(op, "unknown_finality", journal);
    try { op = await reconcileUsage(op, ports, journal); } catch { /* durable target retries */ } return op; }
  op = transition(op, "submitted", "bridge_broadcast_returned_exact_hash", now()); await journal.save(op); op = await markUsageTarget(op, "submitted", journal); op = await reconcileUsage(op, ports, journal);
  return await observeBridge(op, ports, journal);
}
async function observeAllowance(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  if (op.approvalTransactionHash === undefined) fail("APN_STATE_CORRUPT", "approval_hash_missing"); const receipt = await ports.waitSourceReceipt(op.approvalTransactionHash, op.finalityPolicy.source.blockTag);
  if (receipt === null) { if (op.phase !== "allowance_unknown_finality") { op = transition(op, "allowance_unknown_finality", "approval_receipt_not_safe", (ports.now ?? Date.now)()); await journal.save(op); } return op; }
  if (receipt.status !== "success" || receipt.finality !== op.finalityPolicy.source.blockTag || receipt.transactionHash !== op.approvalTransactionHash) fail("APN_OPERATION_BLOCKED", "approval_failed_or_mismatched");
  const allowance = await readAllowance(ports.sourceCall, op.owner, op.finalityPolicy.source.blockTag); if (allowance !== BigInt(op.amountAtomic)) fail("APN_RPC_PROTOCOL", "approval_allowance_not_exact");
  op = transition(op, "allowance_observed", "exact_allowance_safe", (ports.now ?? Date.now)()); await journal.save(op); return op;
}
async function observeBridge(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  if (op.transactionHash === undefined) fail("APN_STATE_CORRUPT", "bridge_hash_missing"); const receipt = await ports.waitSourceReceipt(op.transactionHash, op.finalityPolicy.source.blockTag);
  if (receipt === null) { if (op.phase !== "unknown_finality") { op = transition(op, "unknown_finality", "source_receipt_not_safe", (ports.now ?? Date.now)()); await journal.save(op); }
    op = await markUsageTarget(op, "unknown_finality", journal); return await reconcileUsage(op, ports, journal); }
  if (receipt.status === "reverted") { if (receipt.transactionHash !== op.transactionHash || receipt.finality !== op.finalityPolicy.source.blockTag) fail("APN_RPC_PROTOCOL", "source_revert_receipt");
    op = await requireCleanup(op, ports, journal, "bridge_confirmed_revert"); op = await markUsageTarget(op, "failed_confirmed_revert", journal); return await reconcileUsage(op, ports, journal); }
  const source = sourceReceipt(op, receipt); const residual = await readAllowance(ports.sourceCall, op.owner, op.finalityPolicy.source.blockTag);
  const destination = await ports.observeDestination({ sourceTransactionHash: source.transactionHash, guid: source.guid, recipient: op.recipient,
    sourceEid: 30111, destinationPool: STARGATE_TOKEN_DESTINATION_POOL, minimumAmountAtomic: source.amountReceivedAtomic,
    tokenBalanceBeforeAtomic: op.destinationTokenBalanceBeforeAtomic, nativeBalanceBeforeAtomic: op.destinationNativeBalanceBeforeAtomic,
    nativeDropAtomic: op.nativeDropAtomic, fromBlockNumberAtomic: op.destinationBalanceBlock.numberAtomic, fromBlockHash: op.destinationBalanceBlock.hash,
    finalityTag: op.finalityPolicy.destination.blockTag });
  if (destination === null) { if (op.sourceReceipt === undefined || op.residualAllowanceAtomic === undefined) {
    const evidence = { ...op, sourceReceipt: source, residualAllowanceAtomic: residual.toString() };
    op = op.phase === "submitted" ? seal(evidence) : transition(evidence, "submitted", "source_safe_destination_pending", (ports.now ?? Date.now)());
    await journal.save(op); } op = await markUsageTarget(op, "submitted", journal); return await reconcileUsage(op, ports, journal); }
  validateDestination(op, source, destination);
  if (residual !== 0n) return await requireCleanup({ ...op, sourceReceipt: source, destinationEvidence: destination } as StargateTokenOperation,
    ports, journal, "residual_allowance_after_delivery");
  op = transition({ ...op, sourceReceipt: source, residualAllowanceAtomic: "0", destinationEvidence: destination }, "observed", "destination_token_and_native_drop_safe", (ports.now ?? Date.now)());
  await journal.save(op); op = await markUsageTarget(op, "finalized", journal); return await reconcileUsage(op, ports, journal);
}
async function requireCleanup(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal, reason: string) {
  const residual = await readAllowance(ports.sourceCall, op.owner, "pending");
  if (residual !== 0n && residual !== BigInt(op.amountAtomic)) fail("APN_OPERATION_BLOCKED", "unexpected_residual_allowance");
  op = transition({ ...op, residualAllowanceAtomic: residual.toString(), cleanupReason: reason }, "cleanup_required",
    residual === 0n ? "cleanup_not_needed_allowance_already_zero" : "explicit_cleanup_required", (ports.now ?? Date.now)());
  await journal.save(op);
  if (residual === 0n) {
    op = await finishCleanup(op, ports, journal, "zero_residual_allowance_proven");
  }
  return op;
}
/** Explicit foreground cleanup. Observation remains separate and never invokes this signer path. */
export async function cleanupStargateV2Token(id: string, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  const initial = await journal.load(id); if (initial === null) fail("APN_OPERATION_BLOCKED", "operation_missing");
  return await journal.withOwnerChainLock(initial.owner, 10, async () => await journal.withLock(id, async () => {
    let op = await journal.load(id); if (op === null) fail("APN_OPERATION_BLOCKED", "operation_missing"); op = await reconcileUsageOrCleanup(op, ports, journal);
    if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(op.phase)) return await observeCleanup(op, ports, journal);
    if (op.phase === "cleaned" || op.phase === "observed") return op;
    if (op.phase !== "cleanup_required") fail("APN_OPERATION_BLOCKED", "cleanup_not_required");
    const allowance = await readAllowance(ports.sourceCall, op.owner, "pending");
    if (allowance === 0n) return await finishCleanup({ ...op, residualAllowanceAtomic: "0" } as StargateTokenOperation, ports, journal, "zero_residual_allowance_proven");
    if (allowance !== BigInt(op.amountAtomic)) fail("APN_OPERATION_BLOCKED", "unexpected_residual_allowance");
    const data = encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "approve", args: [STARGATE_TOKEN_SOURCE_POOL, 0n] });
    const prepared = await ports.prepareEnvelope({ chainId: 10, from: op.owner, to: STARGATE_TOKEN_SOURCE_TOKEN, data, valueAtomic: "0" });
    const cleanupEnvelope: StargateTokenEnvelope = { chainId: 10, from: op.owner, to: STARGATE_TOKEN_SOURCE_TOKEN, data, valueAtomic: "0",
      nonceAtomic: uint(prepared.nonceAtomic).toString(), gasLimitAtomic: uint(prepared.gasLimitAtomic, true).toString(),
      maxFeePerGasAtomic: uint(prepared.maxFeePerGasAtomic, true).toString(), maxPriorityFeePerGasAtomic: uint(prepared.maxPriorityFeePerGasAtomic).toString() };
    const tx = { from: op.owner, to: cleanupEnvelope.to, data, value: "0x0", gas: `0x${BigInt(cleanupEnvelope.gasLimitAtomic).toString(16)}`,
      maxFeePerGas: `0x${BigInt(cleanupEnvelope.maxFeePerGasAtomic).toString(16)}`, maxPriorityFeePerGas: `0x${BigInt(cleanupEnvelope.maxPriorityFeePerGasAtomic).toString(16)}` };
    const simulation = await ports.sourceCall("eth_call", [tx, "pending"]);
    if (decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "approve", data: simulation as Hex }) !== true) fail("APN_REPREPARE_REQUIRED", "cleanup_simulation");
    const identity = await ports.signerIdentity(); if (canonicalProfile(identity.profile) !== op.profile || address(identity.address) !== op.owner) fail("APN_REPREPARE_REQUIRED", "signer_identity_changed");
    op = seal({ ...op, cleanupEnvelope }); await journal.save(op); await ports.approveCleanup(op);
    const raw = await ports.signer.signTransaction(cleanupEnvelope); await verifySignedEnvelope(raw, op.owner, cleanupEnvelope); const hash = keccak256(raw);
    op = transition({ ...op, cleanupTransactionHash: hash }, "cleanup_submission_started", "cleanup_attempt_marked_before_send", (ports.now ?? Date.now)()); await journal.save(op);
    try { if ((await ports.sendRawTransaction(raw)).toLowerCase() !== hash.toLowerCase()) fail("APN_RPC_AMBIGUOUS", "cleanup_hash");
      op = transition(op, "cleanup_submitted", "cleanup_broadcast_returned_exact_hash", (ports.now ?? Date.now)()); await journal.save(op);
    } catch { op = transition(op, "cleanup_unknown_finality", "cleanup_broadcast_ambiguous_no_resend", (ports.now ?? Date.now)()); await journal.save(op); return op; }
    return await observeCleanup(op, ports, journal);
  }));
}
async function observeCleanup(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  if (op.cleanupTransactionHash === undefined) fail("APN_STATE_CORRUPT", "cleanup_hash_missing");
  const receipt = await ports.waitSourceReceipt(op.cleanupTransactionHash, op.finalityPolicy.source.blockTag);
  if (receipt === null) { if (op.phase !== "cleanup_unknown_finality") { op = transition(op, "cleanup_unknown_finality", "cleanup_receipt_not_safe", (ports.now ?? Date.now)()); await journal.save(op); } return op; }
  if (receipt.status !== "success" || receipt.finality !== op.finalityPolicy.source.blockTag || receipt.transactionHash !== op.cleanupTransactionHash) fail("APN_OPERATION_BLOCKED", "cleanup_failed_or_mismatched");
  if (await readAllowance(ports.sourceCall, op.owner, op.finalityPolicy.source.blockTag) !== 0n) fail("APN_OPERATION_BLOCKED", "cleanup_allowance_not_zero");
  return await finishCleanup({ ...op, residualAllowanceAtomic: "0" } as StargateTokenOperation, ports, journal, "cleanup_safe_zero_allowance");
}
async function finishCleanup(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal, reason: string) {
  const delivered = op.sourceReceipt !== undefined && op.destinationEvidence !== undefined;
  op = transition(op, delivered ? "observed" : "cleaned", reason, (ports.now ?? Date.now)()); await journal.save(op);
  if (delivered) { op = await markUsageTarget(op, "finalized", journal); op = await reconcileUsage(op, ports, journal); }
  return op;
}
async function markUsageTarget(op: StargateTokenOperation, target: StargateTokenUsageState, journal: StargateTokenJournal) {
  op = seal({ ...op, usageTarget: target }); await journal.save(op); return op;
}
async function reconcileUsage(op: StargateTokenOperation, ports: Pick<StargateTokenExecutionPorts, "reserveUsage" | "followUsage">, journal: StargateTokenJournal) {
  if (op.usageTarget === undefined) return op;
  const state = op.usageTarget === "reserved" ? await ports.reserveUsage(op) : await ports.followUsage(op, op.usageTarget);
  const { usageTarget: _target, ...settled } = op; op = seal({ ...settled, usageState: state }); await journal.save(op); return op;
}
async function reconcileUsageOrCleanup(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, journal: StargateTokenJournal) {
  try { return await reconcileUsage(op, ports, journal); }
  catch (error) {
    if (op.usageTarget !== "reserved") throw error;
    op = await requireCleanup(op, ports, journal, error instanceof ApnError ? `usage_reservation_${String(error.code).toLowerCase()}` : "usage_reservation_failed");
    op = await markUsageTarget(op, "failed_before_effect", journal); try { return await reconcileUsage(op, ports, journal); } catch { return op; }
  }
}
/** Local ledger reconciliation for status/recovery callers; this never signs, broadcasts, or performs RPC. */
export async function reconcileStargateV2TokenUsage(id: string, ports: Pick<StargateTokenExecutionPorts, "reserveUsage" | "followUsage">,
  journal: StargateTokenJournal) { return await journal.withLock(id, async () => { const op = await journal.load(id);
    if (op === null) fail("APN_OPERATION_BLOCKED", "operation_missing"); return await reconcileUsage(op, ports, journal); }); }
async function freshPreflight(op: StargateTokenOperation, ports: StargateTokenExecutionPorts, stage: "before_approval" | "before_send") {
  if (Date.parse(op.expiresAt) <= (ports.now ?? Date.now)()) fail("APN_REPREPARE_REQUIRED", "expired");
  const cap = await readExecutorCap(ports.sourceCall, "latest"); if (cap !== BigInt(op.executorNativeCapAtomic) || BigInt(op.nativeDropAtomic) > cap) fail("APN_REPREPARE_REQUIRED", "native_drop_cap_changed");
  const fresh = await quoteStargateV2Direct({ sourceChainId: 10, destinationChainId: 137, sourceToken: STARGATE_TOKEN_SOURCE_TOKEN,
    destinationToken: STARGATE_TOKEN_DESTINATION_TOKEN, recipient: op.recipient, amountAtomic: op.amountAtomic, extraOptions: op.options }, ports.sourceCall);
  if (fresh.quote.amountSentAtomic !== op.quote.quote.amountSentAtomic || fresh.quote.minimumOutputAtomic !== op.quote.quote.minimumOutputAtomic || fresh.quote.nativeMessageFeeAtomic !== op.quote.quote.nativeMessageFeeAtomic) fail("APN_REPREPARE_REQUIRED", "quote_changed");
  const decodedSend = decodeFunctionData({ abi: STARGATE_SEND_ABI, data: op.sendEnvelope.data });
  if (decodedSend.functionName !== "sendToken") fail("APN_STATE_CORRUPT", "send_calldata");
  if (await requoteSend(ports.sourceCall, decodedSend.args[0], "latest") !== BigInt(op.quote.quote.nativeMessageFeeAtomic)) fail("APN_REPREPARE_REQUIRED", "exact_send_fee_changed");
  const [source, destination, balance, nativeBalance, allowance, nonce] = await Promise.all([
    readPoolConfig(ports.sourceCall, 10, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN, 30111, "latest"),
    readPoolConfig(ports.destinationCall, 137, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, 30109, "latest"),
    readTokenBalance(ports.sourceCall, STARGATE_TOKEN_SOURCE_TOKEN, op.owner, "pending"), ports.sourceCall("eth_getBalance", [op.owner, "pending"]),
    readAllowance(ports.sourceCall, op.owner, "pending"),
    ports.sourceCall("eth_getTransactionCount", [op.owner, "pending"]),
  ]);
  if (source.poolCodeHash !== op.sourceCodeHash || source.tokenCodeHash !== op.sourceTokenCodeHash || destination.poolCodeHash !== op.destinationCodeHash || destination.tokenCodeHash !== op.destinationTokenCodeHash) fail("APN_REPREPARE_REQUIRED", "code_changed");
  if (balance < BigInt(op.amountAtomic)) fail("APN_REPREPARE_REQUIRED", "token_balance");
  const expectedAllowance = stage === "before_approval" ? BigInt(op.initialAllowanceAtomic) : BigInt(op.amountAtomic);
  if (allowance !== expectedAllowance) fail("APN_REPREPARE_REQUIRED", "allowance_changed");
  const envelope = stage === "before_approval" ? op.approvalEnvelope! : op.sendEnvelope;
  if (quantity(nonce).toString() !== envelope.nonceAtomic) fail("APN_REPREPARE_REQUIRED", "nonce_changed");
  const remainingDebit = stage === "before_approval" ? BigInt(op.maximumDebitAtomic)
    : BigInt(envelope.valueAtomic) + BigInt(envelope.gasLimitAtomic) * BigInt(envelope.maxFeePerGasAtomic);
  if (quantity(nativeBalance) < remainingDebit) fail("APN_REPREPARE_REQUIRED", "native_balance");
  const tx = { from: op.owner, to: envelope.to, data: envelope.data, value: `0x${BigInt(envelope.valueAtomic).toString(16)}`,
    gas: `0x${BigInt(envelope.gasLimitAtomic).toString(16)}`, maxFeePerGas: `0x${BigInt(envelope.maxFeePerGasAtomic).toString(16)}`,
    maxPriorityFeePerGas: `0x${BigInt(envelope.maxPriorityFeePerGasAtomic).toString(16)}` };
  const [simulation, estimate] = await Promise.all([ports.sourceCall("eth_call", [tx, "pending"]), ports.sourceCall("eth_estimateGas", [tx, "pending"])]);
  if (quantity(estimate) > BigInt(envelope.gasLimitAtomic)) fail("APN_REPREPARE_REQUIRED", "gas_limit");
  if (stage === "before_approval") { try { if (decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "approve", data: simulation as Hex }) !== true) throw 0; } catch { fail("APN_REPREPARE_REQUIRED", "approval_simulation"); } }
  else { try { const decoded = decodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: "sendToken", data: simulation as Hex }); if (decoded[1].amountSentLD.toString() !== op.amountAtomic || decoded[1].amountReceivedLD.toString() !== op.quote.quote.minimumOutputAtomic) throw 0; } catch { fail("APN_REPREPARE_REQUIRED", "send_simulation"); } }
}
function sourceReceipt(op: StargateTokenOperation, receipt: StargateTokenConfirmedReceipt): StargateTokenSourceReceipt {
  if (receipt.status !== "success" || receipt.finality !== op.finalityPolicy.source.blockTag || receipt.transactionHash !== op.transactionHash) fail("APN_RPC_PROTOCOL", "source_receipt");
  const events = receipt.logs.flatMap(log => { if (address(log.address) !== STARGATE_TOKEN_SOURCE_POOL) return []; try { return [decodeEventLog({ abi: STARGATE_SEND_ABI, eventName: "OFTSent", topics: log.topics as [Hex, ...Hex[]], data: log.data }).args]; } catch { return []; } });
  if (events.length !== 1) fail("APN_RPC_PROTOCOL", "source_oft_sent_count"); const event = events[0]!;
  if (event.dstEid !== 30109 || address(event.fromAddress) !== op.owner || event.amountSentLD.toString() !== op.amountAtomic || event.amountReceivedLD.toString() !== op.quote.quote.minimumOutputAtomic) fail("APN_RPC_PROTOCOL", "source_oft_sent_binding");
  return { transactionHash: op.transactionHash!, blockNumberAtomic: uint(receipt.blockNumberAtomic).toString(), blockHash: hex32(receipt.blockHash), finality: op.finalityPolicy.source.blockTag, guid: hex32(event.guid), amountSentAtomic: event.amountSentLD.toString(), amountReceivedAtomic: event.amountReceivedLD.toString() };
}
function validateDestination(op: StargateTokenOperation, source: StargateTokenSourceReceipt, e: StargateTokenDestinationEvidence) {
  if (e.finality !== op.finalityPolicy.destination.blockTag || e.emitter !== STARGATE_TOKEN_DESTINATION_POOL || e.sourceTransactionHash !== source.transactionHash || e.sourceEid !== 30111 || e.guid !== source.guid || address(e.recipient) !== op.recipient || e.amountReceivedAtomic !== source.amountReceivedAtomic) fail("APN_RPC_PROTOCOL", "destination_event");
  if (BigInt(e.tokenBalanceAfterAtomic) - BigInt(e.tokenBalanceBeforeAtomic) !== BigInt(e.tokenDeltaAtomic) || BigInt(e.tokenDeltaAtomic) < BigInt(source.amountReceivedAtomic)) fail("APN_RPC_PROTOCOL", "destination_token_delta");
  if (BigInt(e.nativeBalanceAfterAtomic) - BigInt(e.nativeBalanceBeforeAtomic) !== BigInt(e.nativeDeltaAtomic) || BigInt(e.nativeDeltaAtomic) < BigInt(op.nativeDropAtomic)) fail("APN_RPC_PROTOCOL", "destination_native_drop_delta");
  if (BigInt(op.nativeDropAtomic) === 0n) { if (e.nativeDrop !== undefined) fail("APN_RPC_PROTOCOL", "unexpected_native_drop_event"); }
  else if (e.nativeDrop?.executor !== STARGATE_TOKEN_DESTINATION_EXECUTOR || e.nativeDrop.success !== true || BigInt(e.nativeDrop.nonceAtomic) < 0n) {
    fail("APN_RPC_PROTOCOL", "destination_native_drop_event");
  }
  hex32(e.destinationTransactionHash); hex32(e.blockHash); uint(e.logIndexAtomic); uint(e.blockNumberAtomic);
}
async function readExecutorCap(call: EvmRpcCall, tag: string) { if (quantity(await call("eth_chainId", [])) !== 10n) fail("APN_CHAIN_MISMATCH", "executor_chain");
  const code = await call("eth_getCode", [STARGATE_TOKEN_SOURCE_EXECUTOR, tag]); if (typeof code !== "string" || !CODE.test(code) || code === "0x") fail("APN_RPC_PROTOCOL", "executor_code");
  const data = encodeFunctionData({ abi: LAYERZERO_EXECUTOR_ABI, functionName: "dstConfig", args: [30109] });
  const decoded = decodeFunctionResult({ abi: LAYERZERO_EXECUTOR_ABI, functionName: "dstConfig", data: await call("eth_call", [{ to: STARGATE_TOKEN_SOURCE_EXECUTOR, data }, tag]) as Hex });
  if (decoded[3] <= 0n) fail("APN_RPC_PROTOCOL", "executor_native_cap"); return decoded[3]; }
async function requoteSend(call: EvmRpcCall, sendParam: Parameters<typeof encodeFunctionData>[0] extends never ? never : any, tag: string) {
  const data = encodeFunctionData({ abi: STARGATE_QUOTE_ABI, functionName: "quoteSend", args: [sendParam, false] });
  const result = decodeFunctionResult({ abi: STARGATE_QUOTE_ABI, functionName: "quoteSend", data: await call("eth_call", [{ to: STARGATE_TOKEN_SOURCE_POOL, data }, tag]) as Hex });
  if (result.lzTokenFee !== 0n) fail("APN_RPC_PROTOCOL", "lz_token_fee"); return result.nativeFee;
}
async function readPoolConfig(call: EvmRpcCall, chain: number, pool: Address, token: Address, eid: number, tag: string) {
  if (quantity(await call("eth_chainId", [])) !== BigInt(chain)) fail("APN_CHAIN_MISMATCH", "pool_chain");
  const [poolCode, tokenCode] = await Promise.all([call("eth_getCode", [pool, tag]), call("eth_getCode", [token, tag])]);
  if (typeof poolCode !== "string" || !CODE.test(poolCode) || poolCode === "0x" || typeof tokenCode !== "string" || !CODE.test(tokenCode) || tokenCode === "0x") fail("APN_RPC_PROTOCOL", "contract_code");
  const read = async (name: "token" | "localEid" | "sharedDecimals" | "status" | "stargateType") => decodeFunctionResult({ abi: STARGATE_SEND_ABI, functionName: name, data: await call("eth_call", [{ to: pool, data: encodeFunctionData({ abi: STARGATE_SEND_ABI, functionName: name }) }, tag]) as Hex });
  const [actualToken, actualEid, decimals, status, kind] = await Promise.all([read("token"), read("localEid"), read("sharedDecimals"), read("status"), read("stargateType")]);
  if (address(actualToken) !== token || actualEid !== eid || decimals !== 6 || status !== 1 || kind !== 0) fail("APN_RPC_PROTOCOL", "pool_config");
  return { poolCodeHash: keccak256(poolCode as Hex), tokenCodeHash: keccak256(tokenCode as Hex) };
}
async function readAllowance(call: EvmRpcCall, owner: Address, tag: string) { return decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "allowance",
  data: await call("eth_call", [{ to: STARGATE_TOKEN_SOURCE_TOKEN, data: encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "allowance", args: [owner, STARGATE_TOKEN_SOURCE_POOL] }) }, tag]) as Hex }); }
async function readTokenBalance(call: EvmRpcCall, token: Address, owner: Address, tag: string) { return decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf",
  data: await call("eth_call", [{ to: token, data: encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", args: [owner] }) }, tag]) as Hex }); }
function assertLane(q: StargateV2QuoteEvidence) { const r = q.route; if (r.sourceChainId !== 10 || r.destinationChainId !== 137 || r.sourceEid !== 30111 || r.destinationEid !== 30109 || r.sourcePool !== STARGATE_TOKEN_SOURCE_POOL || r.destinationPool !== STARGATE_TOKEN_DESTINATION_POOL || r.sourceToken !== STARGATE_TOKEN_SOURCE_TOKEN || r.destinationToken !== STARGATE_TOKEN_DESTINATION_TOKEN || r.asset !== "USDC") fail("APN_OPERATION_BLOCKED", "lane"); }
async function verifySignedEnvelope(raw: Hex, owner: Address, e: StargateTokenEnvelope) { let tx: ReturnType<typeof parseTransaction>, signer: Address;
  try { tx = parseTransaction(raw); signer = getAddress(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })); } catch { return fail("APN_RPC_PROTOCOL", "signed_transaction_decode"); }
  if (signer !== owner || tx.chainId !== 10 || tx.type !== "eip1559" || tx.to?.toLowerCase() !== e.to.toLowerCase() || (tx.data ?? "0x").toLowerCase() !== e.data.toLowerCase() || (tx.value ?? 0n) !== BigInt(e.valueAtomic) || tx.nonce !== Number(e.nonceAtomic) || tx.gas !== BigInt(e.gasLimitAtomic) || tx.maxFeePerGas !== BigInt(e.maxFeePerGasAtomic) || (tx.maxPriorityFeePerGas ?? 0n) !== BigInt(e.maxPriorityFeePerGasAtomic)) fail("APN_RPC_PROTOCOL", "signed_transaction_envelope"); }
function transition(op: StargateTokenOperation | Omit<StargateTokenOperation, "integrityHash">, phase: StargateTokenPhase, reason: string, at: number) { return seal({ ...op, phase, transitions: [...op.transitions, { phase, at: new Date(at).toISOString(), reason }] }); }
function seal(value: Omit<StargateTokenOperation, "integrityHash"> | StargateTokenOperation): StargateTokenOperation { const { integrityHash: _old, ...body } = value as StargateTokenOperation; return Object.freeze({ ...body, integrityHash: hashObject(body) }); }
function validateRecord(value: unknown): StargateTokenOperation { if (!isPlainRecord(value) || value.schemaVersion !== "apn.stargate-v2-token-operation.v1") fail("APN_STATE_CORRUPT", "schema"); const record = value as unknown as StargateTokenOperation, { integrityHash, ...body } = record;
  if (hashObject(body) !== integrityHash || record.transitions.at(-1)?.phase !== record.phase || record.operationId.length !== 64) fail("APN_STATE_CORRUPT", "integrity");
  assertStargateV2RouteFinalityPolicy(record.finalityPolicy, STARGATE_TOKEN_SOURCE_CHAIN, STARGATE_TOKEN_DESTINATION_CHAIN);
  const usageStates: readonly StargateTokenUsageState[] = ["reserved", "submitted", "unknown_finality", "finalized", "failed_before_effect", "failed_confirmed_revert"];
  if ((record.usageState !== undefined && !usageStates.includes(record.usageState)) || (record.usageTarget !== undefined && !usageStates.includes(record.usageTarget))) fail("APN_STATE_CORRUPT", "usage_state");
  if (canonicalJson(record.policy.mechanism) !== canonicalJson(STARGATE_TOKEN_MECHANISM)) fail("APN_STATE_CORRUPT", "mechanism_pin");
  if (["cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality"].includes(record.phase) &&
    (record.cleanupEnvelope === undefined || record.cleanupTransactionHash === undefined)) fail("APN_STATE_CORRUPT", "cleanup_marker");
  if (record.phase === "cleaned" && record.cleanupTransactionHash !== undefined && record.cleanupEnvelope === undefined) fail("APN_STATE_CORRUPT", "cleanup_marker");
  if (record.phase === "cleaned" && record.residualAllowanceAtomic !== "0") fail("APN_STATE_CORRUPT", "cleanup_residual");
  const allowed: Readonly<Partial<Record<StargateTokenPhase, readonly StargateTokenPhase[]>>> = {
    prepared: ["approved"], approved: ["allowance_submission_started", "submission_started", "cleanup_required"],
    allowance_submission_started: ["allowance_submitted", "allowance_unknown_finality"],
    allowance_submitted: ["allowance_unknown_finality", "allowance_observed"], allowance_unknown_finality: ["allowance_observed"],
    allowance_observed: ["submission_started", "cleanup_required"], submission_started: ["submitted", "unknown_finality", "cleanup_required"],
    submitted: ["unknown_finality", "observed", "cleanup_required"], unknown_finality: ["submitted", "observed", "cleanup_required"], observed: [],
    cleanup_required: ["cleanup_submission_started", "cleaned", "observed"], cleanup_submission_started: ["cleanup_submitted", "cleanup_unknown_finality"],
    cleanup_submitted: ["cleanup_unknown_finality", "cleaned", "observed"], cleanup_unknown_finality: ["cleaned", "observed"], cleaned: [],
  };
  if (record.transitions[0]?.phase !== "prepared") fail("APN_STATE_CORRUPT", "transition");
  for (let i = 1; i < record.transitions.length; i++) if (!allowed[record.transitions[i - 1]!.phase]?.includes(record.transitions[i]!.phase)) fail("APN_STATE_CORRUPT", "transition");
  return record; }
function validateAdvance(previous: StargateTokenOperation | null, next: StargateTokenOperation) { if (previous === null) { if (next.phase !== "prepared" || next.transitions.length !== 1) fail("APN_STATE_CORRUPT", "initial"); return; }
  const frozen = (x: StargateTokenOperation) => { const { phase: _p, transitions: _t, integrityHash: _i, approvalTransactionHash: _a, transactionHash: _h,
    residualAllowanceAtomic: _r, sourceReceipt: _s, destinationEvidence: _d, cleanupEnvelope: _ce, cleanupTransactionHash: _ch,
    cleanupReason: _cr, usageState: _us, usageTarget: _ut, ...rest } = x; return rest; };
  if (canonicalJson(frozen(previous)) !== canonicalJson(frozen(next)) || next.transitions.length < previous.transitions.length || canonicalJson(next.transitions.slice(0, previous.transitions.length)) !== canonicalJson(previous.transitions) || (previous.approvalTransactionHash !== undefined && previous.approvalTransactionHash !== next.approvalTransactionHash) || (previous.transactionHash !== undefined && previous.transactionHash !== next.transactionHash) ||
    (previous.cleanupEnvelope !== undefined && canonicalJson(previous.cleanupEnvelope) !== canonicalJson(next.cleanupEnvelope)) ||
    (previous.cleanupTransactionHash !== undefined && previous.cleanupTransactionHash !== next.cleanupTransactionHash) ||
    (previous.cleanupReason !== undefined && previous.cleanupReason !== next.cleanupReason)) fail("APN_STATE_CORRUPT", "journal_rewrite");
  if (previous.usageTarget !== undefined && next.usageTarget !== previous.usageTarget &&
    !(previous.usageTarget === "reserved" && next.usageTarget === "failed_before_effect") &&
    !(next.usageTarget === undefined && next.usageState !== undefined)) fail("APN_STATE_CORRUPT", "usage_target_rewrite");
  const allowedUsage: Readonly<Partial<Record<StargateTokenUsageState, readonly StargateTokenUsageState[]>>> = {
    reserved: ["submitted", "unknown_finality", "finalized", "failed_before_effect", "failed_confirmed_revert"],
    submitted: ["unknown_finality", "finalized", "failed_confirmed_revert"], unknown_finality: ["finalized", "failed_confirmed_revert"],
    finalized: [], failed_before_effect: [], failed_confirmed_revert: [],
  };
  if (previous.usageState !== undefined && next.usageState !== previous.usageState && !allowedUsage[previous.usageState]?.includes(next.usageState!)) fail("APN_STATE_CORRUPT", "usage_state_rewrite"); }
export function stargateV2TokenCanonicalReceipt(input: StargateTokenOperation) { const op = validateRecord(input); if (op.phase !== "observed" || op.sourceReceipt === undefined || op.destinationEvidence === undefined || op.residualAllowanceAtomic !== "0" || op.usageState !== "finalized" || op.usageTarget !== undefined) fail("APN_OPERATION_BLOCKED", "receipt_not_observed");
  const body = { schemaVersion: "apn.stargate-v2-token-receipt.v1" as const, operationId: op.operationId, profile: op.profile,
    route: { sourceChainId: 10, sourceEid: 30111, sourcePool: op.sourcePool, sourceToken: op.sourceToken, destinationChainId: 137, destinationEid: 30109, destinationPool: op.destinationPool, destinationToken: op.destinationToken },
    owner: op.owner, recipient: op.recipient, principalAtomic: op.amountAtomic, minimumOutputAtomic: op.quote.quote.minimumOutputAtomic,
    nativeDropAtomic: op.nativeDropAtomic, nativeMessageFeeAtomic: op.quote.quote.nativeMessageFeeAtomic, maximumDebitAtomic: op.maximumDebitAtomic,
    options: op.options, executor: op.executor, executorNativeCapAtomic: op.executorNativeCapAtomic, policy: op.policy,
    finalityPolicy: op.finalityPolicy, quoteHash: op.quote.quoteHash,
    approvalTransactionHash: op.approvalTransactionHash ?? null, residualAllowanceAtomic: op.residualAllowanceAtomic, source: op.sourceReceipt, destination: op.destinationEvidence };
  return Object.freeze({ ...body, evidenceHash: hashObject(body) }); }
