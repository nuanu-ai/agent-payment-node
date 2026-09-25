import { decodeEventLog, decodeFunctionData, decodeFunctionResult, encodeEventTopics, encodeFunctionData, getAddress, keccak256, pad, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity, type AssetUsageState } from "../asset-usage-ledger.js";
import { canonicalJson, domainHash } from "../canonical.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { ApnError } from "../errors.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { Address } from "../model.js";
import type { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { LAYERZERO_ENDPOINT_V2_ABI, LAYERZERO_EXECUTOR_ABI, STARGATE_ERC20_ABI, STARGATE_SEND_ABI } from "./abi.js";
import { StargateJsonRpc, confirmedStargateSourceReceipt } from "./native-runtime.js";
import { cleanupStargateV2Token, executeStargateV2Token, FileStargateTokenJournal, observeStargateV2Token, prepareStargateV2Token,
  reconcileStargateV2TokenUsage, stargateV2TokenCanonicalReceipt,
  STARGATE_TOKEN_DESTINATION_EXECUTOR, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN, STARGATE_TOKEN_MECHANISM,
  LAYERZERO_ENDPOINT_V2, STARGATE_TOKEN_DESTINATION_MESSAGING, STARGATE_TOKEN_DESTINATION_MESSAGING_CODE_HASH,
  STARGATE_TOKEN_SOURCE_MESSAGING, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN,
  STARGATE_TOKEN_SOURCE_MESSAGING_CODE_HASH,
  type StargateTokenDestinationEvidence, type StargateTokenEnvelope, type StargateTokenExecutionPorts, type StargateTokenOperation } from "./token-execution.js";
import { TtyStargateTokenApproval } from "./token-tty.js";
import type { StargateTokenUsageState } from "./token-model.js";

function stargateUsageState(state: AssetUsageState): StargateTokenUsageState {
  if (state === "released_unsubmitted") throw new ApnError("APN_STATE_CORRUPT", "Stargate usage has an incompatible release state.");
  return state;
}

function blocked(reason: string): never { throw new ApnError("APN_RPC_CONFIG", `Stargate token runtime unavailable: ${reason}.`, { reason }); }
function quantity(v: unknown) { if (typeof v !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(v)) throw new ApnError("APN_RPC_PROTOCOL", "Malformed Stargate RPC quantity."); return BigInt(v); }
function hash(v: unknown): Hex { if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(v)) throw new ApnError("APN_RPC_PROTOCOL", "Malformed Stargate RPC hash."); return v.toLowerCase() as Hex; }
function record(v: unknown): Record<string, unknown> { if (v === null || typeof v !== "object" || Array.isArray(v)) throw new ApnError("APN_RPC_PROTOCOL", "Malformed Stargate RPC object."); return v as Record<string, unknown>; }

class LocalStargateTokenSigner {
  private readonly wallets: EncryptedWalletStore;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort) { this.wallets = new EncryptedWalletStore(state, wrapping); }
  async identity(profileInput: string, expected?: Address) { const profile = canonicalProfile(profileInput), wallet = await this.wallets.describe(profile);
    if (wallet === null) throw new ApnError("APN_OPERATION_BLOCKED", "Stargate token wallet is missing.");
    try { const derived = privateKeyToAccount(wallet.secret.privateKey).address; if (wallet.identity.profile !== profile || wallet.identity.address !== derived || (expected !== undefined && derived !== expected)) throw new ApnError("APN_OPERATION_BLOCKED", "Stargate token wallet identity mismatch."); return { profile, address: derived }; } finally { this.wallets.clear(wallet.secret); } }
  async port(profileInput: string, owner: Address): Promise<StargateTokenExecutionPorts["signer"]> { const profile = canonicalProfile(profileInput), profileHash = this.state.profileHash(profile);
    return { kind: "imported_evm_signer", address: owner, signTransaction: async (tx: StargateTokenEnvelope) => await this.state.withLocks([`custody:${profileHash}`], async () => {
      const wallet = await this.wallets.describe(profile); if (wallet === null) throw new ApnError("APN_OPERATION_BLOCKED", "Stargate token wallet is missing.");
      try { const account = privateKeyToAccount(wallet.secret.privateKey); if (wallet.identity.profile !== profile || wallet.identity.address !== owner || account.address !== owner) throw new ApnError("APN_OPERATION_BLOCKED", "Stargate token wallet identity mismatch.");
        return await account.signTransaction({ type: "eip1559", chainId: 10, to: tx.to, data: tx.data, value: BigInt(tx.valueAtomic), nonce: Number(tx.nonceAtomic), gas: BigInt(tx.gasLimitAtomic), maxFeePerGas: BigInt(tx.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasAtomic), accessList: [] });
      } finally { this.wallets.clear(wallet.secret); }
    }) };
  }
}

export class StargateTokenService {
  private source?: StargateJsonRpc; private destination?: StargateJsonRpc; private readonly journal: FileStargateTokenJournal; private readonly local: LocalStargateTokenSigner;
  private readonly usage: AssetUsageLedger;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly env: Readonly<Record<string, string | undefined>>, private readonly now: () => number = Date.now) {
    this.journal = new FileStargateTokenJournal(state.root, state); this.local = new LocalStargateTokenSigner(state, wrapping); this.usage = new AssetUsageLedger(state.root);
  }
  async prepare(input: Readonly<{ profile: string; amountAtomic: string; nativeDropAtomic: string; minOutputAtomic: string; maxNativeDebitAtomic: string; idempotencyKey: string; maxFeePerGasWei?: string; maxPriorityFeePerGasWei?: string }>) {
    this.remote(); await this.state.initialize(); const identity = await this.local.identity(input.profile), ports = await this.ports(identity.profile, identity.address);
    return await prepareStargateV2Token({ ...input, owner: identity.address, recipient: identity.address }, ports, this.journal);
  }
  async execute(id: string) { const op = await this.required(id); return await executeStargateV2Token(id, await this.ports(op.profile, op.owner), this.journal); }
  async cleanup(id: string) { const op = await this.required(id); return await cleanupStargateV2Token(id, await this.ports(op.profile, op.owner), this.journal); }
  async observe(id: string) { const op = await this.required(id); assertServiceUsageTarget(op);
    if (["observed", "cleanup_required", "cleaned"].includes(op.phase)) return op.usageTarget === undefined ? op : await this.status(id);
    if (op.usageTarget === undefined && !["allowance_submission_started", "allowance_unknown_finality", "allowance_submitted", "allowance_observed", "post_approval_quote_bound", "submission_started", "submitted", "unknown_finality", "observed", "cleanup_required", "cleanup_submission_started", "cleanup_submitted", "cleanup_unknown_finality", "cleaned"].includes(op.phase)) throw new ApnError("APN_OPERATION_BLOCKED", "Only an attempted or recoverable Stargate token operation can be observed.");
    return await observeStargateV2Token(id, await this.ports(op.profile, op.owner), this.journal); }
  async status(id: string) { const op = await this.required(id); assertServiceUsageTarget(op); if (op.usageTarget === undefined) return op;
    return await reconcileStargateV2TokenUsage(id, { reserveUsage: value => this.reserveUsage(value), followUsage: (value, target) => this.followUsage(value, target) }, this.journal); }
  async receipt(id: string) { return stargateV2TokenCanonicalReceipt(await this.status(id)); }
  private async required(id: string) { const op = await this.journal.load(id); if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Stargate token operation was not found."); return op; }
  private async ports(profile: string, owner: Address): Promise<StargateTokenExecutionPorts> { const signer = await this.local.port(profile, owner), { source, destination } = this.remote();
    const tokenAt = async (rpc: StargateJsonRpc, token: Address, account: Address, tag: string) => decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", data: await rpc.call("eth_call", [{ to: token, data: encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", args: [account] }) }, tag]) as Hex });
    return { sourceCall: (m,p) => source.call(m,p), destinationCall: (m,p) => destination.call(m,p),
      destinationBalances: async (recipient, finalityTag) => { const block = record(await destination.call("eth_getBlockByNumber", [finalityTag, false])); return { tokenAtomic: (await tokenAt(destination, STARGATE_TOKEN_DESTINATION_TOKEN, recipient, String(block.number))).toString(), nativeAtomic: quantity(await destination.call("eth_getBalance", [recipient, block.number])).toString(), blockNumberAtomic: quantity(block.number).toString(), blockHash: hash(block.hash) }; },
      prepareEnvelope: async tx => { if (quantity(await source.call("eth_chainId", [])) !== 10n) throw new ApnError("APN_CHAIN_MISMATCH", "Optimism RPC identity changed."); const block = record(await source.call("eth_getBlockByNumber", ["latest", false]));
        const rpcTx = { from: tx.from, to: tx.to, data: tx.data, value: `0x${BigInt(tx.valueAtomic).toString(16)}` }; const [nonceRaw, balance, gas, tip] = await Promise.all([source.call("eth_getTransactionCount", [tx.from, "pending"]), source.call("eth_getBalance", [tx.from, "pending"]), source.call("eth_estimateGas", [rpcTx]), source.call("eth_maxPriorityFeePerGas", [])]);
        const nonce = tx.nonceAtomic === undefined ? quantity(nonceRaw) : BigInt(tx.nonceAtomic); if (nonce < quantity(nonceRaw)) throw new ApnError("APN_REPREPARE_REQUIRED", "Frozen Stargate nonce is stale."); const priority = quantity(tip), maxFee = 2n * quantity(block.baseFeePerGas) + priority;
        return { nonceAtomic: nonce.toString(), gasLimitAtomic: (quantity(gas) * 12n / 10n + 1n).toString(), maxFeePerGasAtomic: maxFee.toString(), maxPriorityFeePerGasAtomic: priority.toString(), nativeBalanceAtomic: quantity(balance).toString() }; },
      signer, signerIdentity: async () => await this.local.identity(profile, owner), approve: async op => await new TtyStargateTokenApproval().approve(op),
      approveCleanup: async op => await new TtyStargateTokenApproval().approveCleanup(op),
      admitPolicy: async input => { const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: { now: () => new Date(this.now()) } }, input.profile); if (active === null || active.accounts.evm !== input.owner) throw new ApnError("APN_ALLOWLIST_REFUSED", "Stargate token execution requires an active owner policy for this EVM account.");
        const identity = usageIdentity(input.owner), at = new Date(this.now()), current = await this.usage.usage(identity, at);
        const admission = evaluateAssetPolicy(active.registry, { chain: identity.chain, asset: identity.asset, rail: "bridge", amountAtomic: input.amountAtomic, dailyUsageAtomic: current.amountAtomic, asOfDate: at.toISOString().slice(0,10), asOf: at.toISOString() });
        requireMechanism(admission.asset.mechanismPins?.bridge); return { policyDigest: active.digest, policyRevision: active.revision, mechanism: STARGATE_TOKEN_MECHANISM }; },
      confirmPolicy: async op => { const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: { now: () => new Date(this.now()) } }, op.profile); if (active === null || active.digest !== op.policy.policyDigest || active.revision !== op.policy.policyRevision || active.accounts.evm !== op.owner || canonicalJson(op.policy.mechanism) !== canonicalJson(STARGATE_TOKEN_MECHANISM)) throw new ApnError("APN_ALLOWLIST_REFUSED", "The active Stargate owner policy changed; prepare again."); const at = new Date(this.now()); const admission = evaluateAssetPolicy(active.registry, { chain: "eip155:10", asset: { kind: "token", identifier: STARGATE_TOKEN_SOURCE_TOKEN }, rail: "bridge", amountAtomic: op.amountAtomic, dailyUsageAtomic: (await this.usage.usage(usageIdentity(op.owner), at)).amountAtomic, asOfDate: at.toISOString().slice(0,10), asOf: at.toISOString() }); requireMechanism(admission.asset.mechanismPins?.bridge); },
      reserveUsage: async op => await this.reserveUsage(op),
      followUsage: async (op, target) => await this.followUsage(op, target),
      sendRawTransaction: async raw => { const returned = hash(await source.call("eth_sendRawTransaction", [raw])); if (returned !== keccak256(raw)) throw new Error("hash"); return returned; }, waitSourceReceipt: async (txHash, finalityTag) => await confirmedStargateTokenSourceReceipt(source, txHash, finalityTag),
      observeDestination: async input => await observeStargateTokenDestination(destination, input, tokenAt), now: this.now };
  }
  private async reserveUsage(op: StargateTokenOperation): Promise<StargateTokenUsageState> { const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: { now: () => new Date(this.now()) } }, op.profile);
    if (active === null || active.digest !== op.policy.policyDigest || active.revision !== op.policy.policyRevision) throw new ApnError("APN_ALLOWLIST_REFUSED", "The active Stargate owner policy changed; prepare again.");
    const at = new Date(this.now()); return stargateUsageState((await this.usage.reserve({ ...usageIdentity(op.owner), registry: active.registry, rail: "bridge", amountAtomic: op.amountAtomic,
      idempotencyKey: usageKey(op.operationId), now: at })).state); }
  private async followUsage(op: StargateTokenOperation, target: "submitted" | "unknown_finality" | "finalized" | "failed_before_effect" | "failed_confirmed_revert"): Promise<StargateTokenUsageState> {
    const identity = usageIdentity(op.owner), reservationId = assetUsageReservationId(identity, usageKey(op.operationId));
    const current = await this.usage.load(identity, reservationId); if (current === null) { if (target === "failed_before_effect") return target; throw new ApnError("APN_STATE_CORRUPT", "Stargate usage reservation is missing."); }
    const state = stargateUsageState(current.state);
    if (state === target) return state;
    if (target === "submitted" && state === "unknown_finality") return state;
    if (["finalized", "failed_before_effect", "failed_confirmed_revert"].includes(state)) {
      if (target === "submitted" || target === "unknown_finality") return state;
      throw new ApnError("APN_STATE_CORRUPT", "Stargate usage reservation reached a conflicting terminal state.");
    }
    const outcome = ["finalized", "failed_before_effect", "failed_confirmed_revert"].includes(target)
      ? { outcomeDigest: domainHash("apn.stargate-token-usage-outcome.v1", canonicalJson({ operationId: op.operationId, target, integrityHash: op.integrityHash })) } : {};
    return stargateUsageState((await this.usage.transition({ ...identity, reservationId, policyDigest: current.policyDigest, state: target, now: new Date(this.now()), ...outcome })).state);
  }
  private remote() { if (this.source !== undefined && this.destination !== undefined) return { source: this.source, destination: this.destination }; const source = this.env.APN_OPTIMISM_RPC_URL, destination = this.env.APN_POLYGON_RPC_URL; if (source === undefined || destination === undefined) blocked("APN_OPTIMISM_RPC_URL_and_APN_POLYGON_RPC_URL_required"); this.source = new StargateJsonRpc(source); this.destination = new StargateJsonRpc(destination); return { source: this.source, destination: this.destination }; }
}

function assertServiceUsageTarget(op: StargateTokenOperation): void {
  if (op.usageTarget === undefined) return;
  const legal: Readonly<Record<NonNullable<StargateTokenOperation["usageTarget"]>, readonly StargateTokenOperation["phase"][]>> = {
    reserved: ["approved", "allowance_observed", "cleanup_required"], submitted: ["submitted"], unknown_finality: ["unknown_finality"],
    finalized: ["observed"], failed_before_effect: ["cleanup_required"], failed_confirmed_revert: ["cleanup_required"],
  };
  if (!legal[op.usageTarget].includes(op.phase)) throw new ApnError("APN_STATE_CORRUPT", "The Stargate token usage reconciliation target is incompatible with the journal phase.");
}

export async function confirmedStargateTokenSourceReceipt(rpc: Pick<StargateJsonRpc, "call">, transactionHash: Hex,
  finalityTag: Parameters<typeof confirmedStargateSourceReceipt>[2], expectedCodeHash: Hex = STARGATE_TOKEN_SOURCE_MESSAGING_CODE_HASH) {
  const receipt = await confirmedStargateSourceReceipt(rpc, transactionHash, finalityTag); if (receipt === null) return null;
  if (receipt.logs.some(log => log.address === LAYERZERO_ENDPOINT_V2)) {
    const code = await rpc.call("eth_getCode", [STARGATE_TOKEN_SOURCE_MESSAGING, finalityTag]);
    if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(code) || keccak256(code as Hex) !== expectedCodeHash)
      throw new ApnError("APN_RPC_PROTOCOL", "Pinned Optimism TokenMessaging code mismatch.");
  }
  return receipt;
}

// Public Polygon providers used by the live recovery rejected 261-block log ranges despite advertising a larger limit.
const DESTINATION_LOG_CHUNK = 100n, DESTINATION_MAX_CHUNKS = 256;
async function destinationLogs(rpc: Pick<StargateJsonRpc, "call">, addresses: readonly Address[], topic0: readonly Hex[], from: bigint, to: bigint) {
  if (to < from) return [] as Record<string, unknown>[];
  const chunks = Number((to - from) / DESTINATION_LOG_CHUNK + 1n); if (chunks > DESTINATION_MAX_CHUNKS) blocked("destination_scan_range");
  const unique = new Map<string, { raw: string; value: Record<string, unknown> }>();
  for (let start = from; start <= to; start += DESTINATION_LOG_CHUNK) {
    const end = start + DESTINATION_LOG_CHUNK - 1n > to ? to : start + DESTINATION_LOG_CHUNK - 1n;
    const raw = await rpc.call("eth_getLogs", [{ address: addresses, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, topics: [topic0] }]);
    if (!Array.isArray(raw) || raw.length > 5_000) blocked("destination_logs");
    for (const candidate of raw) { const value = record(candidate), key = `${String(value.transactionHash).toLowerCase()}:${String(value.logIndex).toLowerCase()}`;
      const encoded = JSON.stringify(value), previous = unique.get(key); if (previous !== undefined && previous.raw !== encoded) blocked("destination_log_conflict");
      unique.set(key, { raw: encoded, value }); }
  }
  return [...unique.values()].map(item => item.value);
}
function logPosition(log: Record<string, unknown>) { return [quantity(log.blockNumber), quantity(log.logIndex)] as const; }
function atOrBefore(a: Record<string, unknown>, b: Record<string, unknown>) { const x = logPosition(a), y = logPosition(b); return x[0] < y[0] || (x[0] === y[0] && x[1] <= y[1]); }

export async function observeStargateTokenDestination(rpc: Pick<StargateJsonRpc, "call">, input: Parameters<StargateTokenExecutionPorts["observeDestination"]>[0], tokenAt?: (rpc: StargateJsonRpc, token: Address, account: Address, tag: string) => Promise<bigint>, expectedCodeHash: Hex = STARGATE_TOKEN_DESTINATION_MESSAGING_CODE_HASH): Promise<StargateTokenDestinationEvidence | null> {
  const finalityHead = record(await rpc.call("eth_getBlockByNumber", [input.finalityTag, false])), head = quantity(finalityHead.number);
  const baselineNumber = BigInt(input.fromBlockNumberAtomic), baselineTag = `0x${baselineNumber.toString(16)}`;
  const baseline = record(await rpc.call("eth_getBlockByNumber", [baselineTag, false]));
  if (hash(baseline.hash) !== input.fromBlockHash) throw new ApnError("APN_RPC_PROTOCOL", "Stargate destination baseline is no longer canonical.");
  if (head < baselineNumber) throw new ApnError("APN_RPC_PROTOCOL", "Stargate finalized horizon precedes its frozen baseline.");
  const messagingCode = await rpc.call("eth_getCode", [STARGATE_TOKEN_DESTINATION_MESSAGING, finalityHead.number]);
  if (typeof messagingCode !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(messagingCode) || keccak256(messagingCode as Hex) !== expectedCodeHash)
    throw new ApnError("APN_RPC_PROTOCOL", "Pinned Polygon TokenMessaging code mismatch.");
  const oftTopics = encodeEventTopics({ abi: STARGATE_SEND_ABI, eventName: "OFTReceived", args: { guid: input.guid, toAddress: input.recipient } });
  const deliveredTopics = encodeEventTopics({ abi: LAYERZERO_ENDPOINT_V2_ABI, eventName: "PacketDelivered" });
  const dropTopics = encodeEventTopics({ abi: LAYERZERO_EXECUTOR_ABI, eventName: "NativeDropApplied" });
  const addresses = BigInt(input.nativeDropAtomic) === 0n
    ? [STARGATE_TOKEN_DESTINATION_POOL, LAYERZERO_ENDPOINT_V2] as const
    : [STARGATE_TOKEN_DESTINATION_POOL, LAYERZERO_ENDPOINT_V2, STARGATE_TOKEN_DESTINATION_EXECUTOR] as const;
  const topic0 = [oftTopics[0], deliveredTopics[0], ...(BigInt(input.nativeDropAtomic) === 0n ? [] : [dropTopics[0]])] as Hex[];
  const allLogs = await destinationLogs(rpc, addresses, topic0, baselineNumber, head);
  const oftLogs = allLogs.filter(log => { try { return getAddress(String(log.address)) === STARGATE_TOKEN_DESTINATION_POOL; } catch { return false; } });
  const deliveredLogs = allLogs.filter(log => { try { return getAddress(String(log.address)) === LAYERZERO_ENDPOINT_V2; } catch { return false; } });
  const dropLogs = allLogs.filter(log => { try { return getAddress(String(log.address)) === STARGATE_TOKEN_DESTINATION_EXECUTOR; } catch { return false; } });
  const canonical = new Map<string, boolean>(); const isCanonical = async (log: Record<string, unknown>) => { const number = String(log.blockNumber), expected = hash(log.blockHash);
    const key = `${number}:${expected}`; if (!canonical.has(key)) { const block = record(await rpc.call("eth_getBlockByNumber", [number, false])); canonical.set(key, hash(block.hash) === expected); } return canonical.get(key)!; };
  const packet = input.sourcePacket;
  const oftMatches: { log: Record<string, unknown>; amount: bigint }[] = [];
  for (const log of oftLogs) { try { const event = decodeEventLog({ abi: STARGATE_SEND_ABI, eventName: "OFTReceived", topics: log.topics as [Hex, ...Hex[]], data: String(log.data) as Hex });
    if (getAddress(String(log.address)) === STARGATE_TOKEN_DESTINATION_POOL && event.args.srcEid === 30111 && event.args.guid === input.guid &&
      getAddress(event.args.toAddress) === input.recipient && event.args.amountReceivedLD.toString() === input.minimumAmountAtomic && await isCanonical(log)) oftMatches.push({ log, amount: event.args.amountReceivedLD });
  } catch { /* unrelated candidate */ } }
  if (oftMatches.length !== 1) return null;
  const oft = oftMatches[0]!;
  let delivery: { log: Record<string, unknown>; nonce: bigint } | undefined;
  if (packet !== undefined) {
    const matches: { log: Record<string, unknown>; nonce: bigint }[] = [];
    for (const log of deliveredLogs) { try { const event = decodeEventLog({ abi: LAYERZERO_ENDPOINT_V2_ABI, eventName: "PacketDelivered", topics: log.topics as [Hex, ...Hex[]], data: String(log.data) as Hex });
      if (getAddress(String(log.address)) === LAYERZERO_ENDPOINT_V2 && event.args.origin.srcEid === packet.srcEid && event.args.origin.sender.toLowerCase() === packet.sender.toLowerCase() &&
        event.args.origin.nonce.toString() === packet.nonceAtomic && getAddress(event.args.receiver) === STARGATE_TOKEN_DESTINATION_MESSAGING &&
        hash(log.transactionHash) === hash(oft.log.transactionHash) && await isCanonical(log)) matches.push({ log, nonce: event.args.origin.nonce });
    } catch { /* unrelated candidate */ } }
    if (matches.length !== 1) return null; delivery = matches[0]!; if (!atOrBefore(oft.log, delivery.log)) return null;
    const tx = record(await rpc.call("eth_getTransactionByHash", [hash(delivery.log.transactionHash)]));
    try { if (hash(tx.hash) !== hash(delivery.log.transactionHash) || hash(tx.blockHash) !== hash(delivery.log.blockHash) ||
      quantity(tx.blockNumber) !== quantity(delivery.log.blockNumber) || getAddress(String(tx.to)) !== STARGATE_TOKEN_DESTINATION_EXECUTOR) return null;
      const decoded = decodeFunctionData({ abi: LAYERZERO_EXECUTOR_ABI, data: String(tx.input) as Hex }); if (decoded.functionName !== "execute302") return null;
      const params = decoded.args[0]; if (getAddress(params.receiver) !== STARGATE_TOKEN_DESTINATION_MESSAGING || params.origin.srcEid !== packet.srcEid ||
        params.origin.sender.toLowerCase() !== packet.sender.toLowerCase() || params.origin.nonce.toString() !== packet.nonceAtomic || params.guid !== input.guid) return null;
    } catch { return null; }
  }
  let nativeDrop: StargateTokenDestinationEvidence["nativeDrop"];
  if (BigInt(input.nativeDropAtomic) > 0n) {
    const matches: { log: Record<string, unknown>; nonce: bigint }[] = [];
    for (const log of dropLogs) { try { const event = decodeEventLog({ abi: LAYERZERO_EXECUTOR_ABI, eventName: "NativeDropApplied", topics: log.topics as [Hex, ...Hex[]], data: String(log.data) as Hex }).args;
      const nonce = packet?.nonceAtomic; if (getAddress(String(log.address)) === STARGATE_TOKEN_DESTINATION_EXECUTOR && event.origin.srcEid === 30111 &&
        event.origin.sender.toLowerCase() === pad(STARGATE_TOKEN_SOURCE_MESSAGING, { size: 32 }).toLowerCase() && (nonce === undefined || event.origin.nonce.toString() === nonce) &&
        event.dstEid === 30109 && getAddress(event.oapp) === STARGATE_TOKEN_DESTINATION_MESSAGING && event.params.length === 1 && event.success.length === 1 && event.success[0] === true &&
        getAddress(event.params[0]!.receiver) === input.recipient && event.params[0]!.amount.toString() === input.nativeDropAtomic && await isCanonical(log)) matches.push({ log, nonce: event.origin.nonce });
    } catch { /* unrelated candidate */ } }
    if (matches.length !== 1 || !atOrBefore(matches[0]!.log, oft.log)) return null; const match = matches[0]!;
    nativeDrop = { executor: STARGATE_TOKEN_DESTINATION_EXECUTOR, nonceAtomic: match.nonce.toString(), success: true,
      transactionHash: hash(match.log.transactionHash), blockNumberAtomic: quantity(match.log.blockNumber).toString(), blockHash: hash(match.log.blockHash), logIndexAtomic: quantity(match.log.logIndex).toString() };
  }
  const readToken = tokenAt ?? (async (client, token, account, tag) => decodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", data: await client.call("eth_call", [{ to: token, data: encodeFunctionData({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", args: [account] }) }, tag]) as Hex }));
  const [tokenAfter, nativeAfter] = await Promise.all([readToken(rpc as StargateJsonRpc, STARGATE_TOKEN_DESTINATION_TOKEN, input.recipient, String(finalityHead.number)), rpc.call("eth_getBalance", [input.recipient, finalityHead.number]).then(quantity)]);
  const tokenBefore = BigInt(input.tokenBalanceBeforeAtomic), nativeBefore = BigInt(input.nativeBalanceBeforeAtomic), log = oft.log;
  return { emitter: STARGATE_TOKEN_DESTINATION_POOL, sourceTransactionHash: input.sourceTransactionHash, guid: input.guid, sourceEid: 30111,
    destinationTransactionHash: hash(log.transactionHash), logIndexAtomic: quantity(log.logIndex).toString(), blockNumberAtomic: quantity(log.blockNumber).toString(),
    blockHash: hash(log.blockHash), finality: input.finalityTag, recipient: input.recipient, amountReceivedAtomic: oft.amount.toString(),
    tokenBalanceBeforeAtomic: tokenBefore.toString(), tokenBalanceAfterAtomic: tokenAfter.toString(), tokenDeltaAtomic: (tokenAfter-tokenBefore).toString(),
    nativeBalanceBeforeAtomic: nativeBefore.toString(), nativeBalanceAfterAtomic: nativeAfter.toString(), nativeDeltaAtomic: (nativeAfter-nativeBefore).toString(),
    ...(nativeDrop === undefined ? {} : { nativeDrop }), ...(delivery === undefined ? {} : { packetDelivery: { endpoint: LAYERZERO_ENDPOINT_V2,
      tokenMessaging: STARGATE_TOKEN_DESTINATION_MESSAGING, nonceAtomic: delivery.nonce.toString(), transactionHash: hash(delivery.log.transactionHash),
      blockNumberAtomic: quantity(delivery.log.blockNumber).toString(), blockHash: hash(delivery.log.blockHash), logIndexAtomic: quantity(delivery.log.logIndex).toString() } }) };
}

function usageIdentity(owner: Address): AssetUsageIdentity { return { account: owner, chain: "eip155:10", asset: { kind: "token", identifier: STARGATE_TOKEN_SOURCE_TOKEN } }; }
function usageKey(operationId: string): string { return `apn.stargate-token-usage:${operationId}`; }
function requireMechanism(pin: unknown): void {
  if (canonicalJson(pin) !== canonicalJson(STARGATE_TOKEN_MECHANISM)) throw new ApnError("APN_ALLOWLIST_REFUSED", "The active bridge mechanism pin does not authorize this exact Stargate V2 lane.");
}
