/** Explicit, foreground Ethereum source execution for one saved Relay operation. */
import { getAddress, type Hex } from "viem";
import { AsyncLocalStorage } from "node:async_hooks";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../canonical.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { EncryptedSmartAccountPermissionStore } from "../encrypted-smart-account-permission-store.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertExclusiveEvmOwner, evmAddressLock } from "../evm-address-ownership.js";
import { evmRpcAddress, evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord } from "../evm-rpc-codec.js";
import { ApnError } from "../errors.js";
import { isGrantedPermissionRecord } from "../metamask-smart-account-record.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, validateRelayUnsignedOperation, type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { HttpsBaseRpc } from "../rpc.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import { RelayApprovalEffectService, RelayEncryptedApprovalCustody, type RelayApprovalObservation, type RelayApprovalPorts } from "./approval-effect.js";
import { RelayDepositEffectService, RelayEncryptedDepositCustody, type RelayDepositObservation, type RelayDepositPorts } from "./deposit-effect.js";
import { RelayEffectJournalRepository, type RelayEffectJournal } from "./effect-journal.js";
import { relayExecutionRoute } from "./execution-route.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "./quote.js";
import { RelayRpcInvocation, RELAY_EXECUTION_WALL_MS } from "./rpc-budget.js";

const HASH = /^[a-f0-9]{64}$/u;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function blocked(reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", "Relay source execution is blocked.", { reason }); }
function corrupt(reason: string): never { throw new ApnError("APN_STATE_CORRUPT", `Relay source execution state is invalid: ${reason}.`); }

export interface RelayExecutionSummary {
  readonly operationId: string;
  readonly sourceChainId: 1;
  readonly destinationChainId: 56 | 8453;
  readonly sourceAccount: string;
  readonly sourceToken: string;
  readonly amountAtomic: string;
  readonly recipient: string;
  readonly minOutputAtomic: string;
  readonly deadline: string;
  readonly requestId: string;
  readonly quoteDigest: string;
  readonly approvalNetworkFeeCeilingWei: string;
  readonly depositNetworkFeeCeilingWei: string;
}
export interface RelayExecutionAuthorizationPort { confirm(summary: RelayExecutionSummary): Promise<boolean> }
interface RelayExecutionAdmission {
  readonly schemaVersion: "apn.relay-execution-admission.v1";
  readonly profileHash: string;
  readonly operationId: string;
  readonly operationIntegrityHash: string;
  readonly quoteDigest: string;
  readonly requestId: string;
  readonly confirmedAt: string;
  readonly integrityHash: string;
}
class RelayExecutionAdmissionStore extends SecureStateStore {
  private path(op: RelayUnsignedOperation): string { return `relay-execution-admissions/${op.profileHash}/${op.operationId}.json`; }
  async load(op: RelayUnsignedOperation): Promise<RelayExecutionAdmission | null> {
    const value = await this.readJson(this.path(op));
    if (value === null) return null;
    if (typeof value !== "object" || Array.isArray(value)) corrupt("admission shape");
    const record = value as RelayExecutionAdmission;
    const { integrityHash, ...body } = record;
    if (Object.keys(record).sort().join(",") !== ["schemaVersion", "profileHash", "operationId", "operationIntegrityHash",
      "quoteDigest", "requestId", "confirmedAt", "integrityHash"].sort().join(",") ||
      record.schemaVersion !== "apn.relay-execution-admission.v1" || record.profileHash !== op.profileHash ||
      record.operationId !== op.operationId || record.operationIntegrityHash !== op.integrityHash ||
      record.quoteDigest !== op.quoteDigest || record.requestId !== op.statusLocator?.requestId ||
      !Number.isFinite(Date.parse(record.confirmedAt)) || record.integrityHash !== hashObject(body)) corrupt("admission binding");
    return record;
  }
  async admit(op: RelayUnsignedOperation, now: Date): Promise<RelayExecutionAdmission> {
    stateIdentifier(op.operationId, "Relay operation");
    await this.initialize();
    return this.withLocks([`relay-admission:${op.operationId}`], async () => {
      const old = await this.load(op);
      if (old !== null) return old;
      if (op.statusLocator === undefined || !Number.isFinite(now.getTime())) blocked("request_id_or_clock");
      const body = { schemaVersion: "apn.relay-execution-admission.v1" as const, profileHash: op.profileHash,
        operationId: op.operationId, operationIntegrityHash: op.integrityHash, quoteDigest: op.quoteDigest,
        requestId: op.statusLocator.requestId, confirmedAt: now.toISOString() };
      const record = { ...body, integrityHash: hashObject(body) };
      await this.ensureDirectory(`relay-execution-admissions/${op.profileHash}`);
      await this.writeJson(this.path(op), record, true);
      return record;
    });
  }
}

/** Production constructor uses one explicit public HTTPS Ethereum RPC, with no Relay credential. */
export function createRelayEthereumSourceRuntime(state: StateStore, wrappingSecret: WrappingSecretPort,
  rpcUrl: string, authorization: RelayExecutionAuthorizationPort, clock: ClockPort = { now: () => new Date() },
  transport?: Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">): RelayEthereumSourceRuntime {
  let endpoint: URL;
  try { endpoint = new URL(rpcUrl); }
  catch { throw new ApnError("APN_RPC_CONFIG", "Relay execution requires one HTTPS RPC URL."); }
  if (endpoint.pathname !== "/" || endpoint.search !== "" || endpoint.hash !== "" || endpoint.username !== "" || endpoint.password !== "")
    throw new ApnError("APN_RPC_CONFIG", "Relay execution requires a keyless HTTPS RPC origin without a signed path or query.");
  const validatedTransport = new HttpsBaseRpc(rpcUrl);
  return new RelayEthereumSourceRuntime(state, wrappingSecret, transport ?? validatedTransport, authorization, clock, endpoint.origin);
}

/** The constructor accepts an injected RPC surface so tests can never reach a network. */
export class RelayEthereumSourceRuntime {
  private readonly wallets: EncryptedWalletStore;
  private readonly permissions: EncryptedSmartAccountPermissionStore;
  private readonly admissions: RelayExecutionAdmissionStore;
  private readonly usage: AssetUsageLedger;
  private readonly approvalCustody: RelayEncryptedApprovalCustody;
  private readonly depositCustody: RelayEncryptedDepositCustody;
  private readonly rpcScope = new AsyncLocalStorage<Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">>();
  private signingNonce: bigint | null = null;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly transport: Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">,
    private readonly authorization: RelayExecutionAuthorizationPort, private readonly clock: ClockPort = { now: () => new Date() },
    private readonly pacedOrigin?: string) {
    this.wallets = new EncryptedWalletStore(state, wrapping);
    this.permissions = new EncryptedSmartAccountPermissionStore(state, wrapping);
    this.admissions = new RelayExecutionAdmissionStore(state.root);
    this.usage = new AssetUsageLedger(state.root);
    this.approvalCustody = new RelayEncryptedApprovalCustody(state, wrapping);
    this.depositCustody = new RelayEncryptedDepositCustody(state, wrapping);
  }

  private get rpc(): Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction"> {
    return this.rpcScope.getStore() ?? this.transport;
  }

  async execute(operationId: string): Promise<RelayEffectJournal> {
    if (this.pacedOrigin === undefined) return await this.executeScoped(operationId);
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), RELAY_EXECUTION_WALL_MS);
    try {
      const transport = this.transport instanceof HttpsBaseRpc ? this.transport.withAbortSignal(abort.signal) : this.transport;
      const invocation = new RelayRpcInvocation(this.state, this.pacedOrigin, transport, abort.signal,
        transport instanceof HttpsBaseRpc ? () => transport.primePublicAddresses() : undefined);
      const journal = await this.rpcScope.run(invocation.rpc, () => this.executeScoped(operationId));
      invocation.assertAllowed();
      return journal;
    }
    finally { clearTimeout(timeout); }
  }

  private async executeScoped(operationId: string): Promise<RelayEffectJournal> {
    if (!HASH.test(operationId)) throw new ApnError("APN_INVALID_INPUT", "Relay execution requires one operation ID.");
    const profileHash = this.state.profileHash("default");
    const op = await new RelayUnsignedOperationRepository(this.state.root).loadOperation(profileHash, operationId);
    if (op === null) blocked("prepared_operation_missing");
    this.assertPrepared(op);
    return this.state.withLocks([`relay-source-execute:${operationId}`, evmAddressLock(op.sourceAccount)], async () => {
      // Recover a crash between cap reservation and the first durable effect.
      // This runs before deadline/policy checks, so an expired quote cannot strand its cap.
      await this.reconcilePreEffectReservation(op);
      const existing = await new RelayEffectJournalRepository(this.state.root).load(profileHash, operationId);
      const observationOnly = existing !== null && (existing.effects[0].phase === "submitting" ||
        existing.effects[1].phase === "submitting" || existing.effects[0].phase === "failed" ||
        existing.effects[1].phase === "failed" || existing.effects[1].phase === "confirmed");
      if (observationOnly) {
        if (await new RelayRetirementRepository(this.state.root).load(op) !== null) blocked("operation_retired");
        await this.assertOwner(op);
      } else await this.assertReady(op);
      const summary = this.summary(op);
      if (await this.authorization.confirm(summary) !== true) blocked("foreground_authorization_declined");
      if (observationOnly) {
        if (await this.admissions.load(op) === null) blocked("execution_admission_missing");
      } else await this.assertReady(op);
      // The same exact operation/requestId is persisted before any effect can be marked.
      if (!observationOnly) {
        await this.admissions.admit(op, this.clock.now());
        const active = await this.activePolicy(op);
        if (active === null) blocked("active_policy_missing");
        const reserveInput = { account: getAddress(op.sourceAccount), chain: "eip155:1",
          asset: { kind: "token" as const, identifier: ETHEREUM_USDC }, registry: active.registry,
          rail: "bridge" as const, amountAtomic: op.amountAtomic, idempotencyKey: `relay-execute:${op.operationId}`, now: this.clock.now() };
        const previous = await this.usage.load(this.usageIdentity(op), this.usageReservationId(op));
        if (previous?.state === "failed_before_effect") {
          await this.withNoEffectProof(op, async () => {
            await this.usage.reserve({ ...reserveInput, retryFailedBeforeEffect: true });
          });
        } else await this.usage.reserve(reserveInput);
      }
      const common = {
        now: () => this.clock.now(),
        activePolicy: async () => this.activePolicy(op),
        publicAccount: async () => this.publicAccount(op),
        dailyUsage: async (_account: string, now: Date) => this.dailyUsageExcludingOwn(op, now),
        executionAdmission: async () => { const record = await this.admissions.load(op);
          return record === null ? null : { requestId: record.requestId, operationIntegrityHash: record.operationIntegrityHash,
            quoteDigest: record.quoteDigest }; },
        funding: async () => this.funding(op),
        send: async (raw: Hex) => this.rpc.submitRawTransaction(raw),
      };
      const approvalPorts: RelayApprovalPorts = { ...common,
        sign: async operation => this.sign(operation, "approval"), custody: this.approvalCustody,
        observe: async hash => this.observeApproval(hash) };
      const depositPorts: RelayDepositPorts = { ...common,
        sign: async operation => this.sign(operation, "deposit"), custody: this.depositCustody,
        observeApproval: async hash => this.observeApproval(hash), observe: async hash => this.observeDeposit(hash) };
      try {
        let journal = await new RelayApprovalEffectService(this.state, approvalPorts).run(operationId);
        await this.updateUsage(op, journal);
        if (journal.effects[0].phase === "confirmed") journal = await new RelayDepositEffectService(this.state, depositPorts).run(operationId);
        await this.updateUsage(op, journal);
        return journal;
      } catch (error) {
        // A cleanup failure must not hide the original execution error. It leaves
        // the cap conservatively held for the next explicit reconciliation.
        try { await this.reconcilePreEffectReservation(op); } catch { /* keep original error */ }
        throw error;
      }
    });
  }

  private usageIdentity(op: RelayUnsignedOperation) {
    return { account: getAddress(op.sourceAccount), chain: "eip155:1",
      asset: { kind: "token" as const, identifier: ETHEREUM_USDC } };
  }
  private usageReservationId(op: RelayUnsignedOperation): string {
    return assetUsageReservationId(this.usageIdentity(op), `relay-execute:${op.operationId}`);
  }
  /** Profile/operation -> encrypted custody -> exact usage bucket. A journal with
   * any marker, or either signed-material slot, forbids cap release. */
  private async withNoEffectProof<T>(op: RelayUnsignedOperation, action: () => Promise<T>): Promise<T> {
    return this.state.withLocks([`profile:${op.profileHash}`, `operation:${op.operationId}`], async () =>
      this.approvalCustody.withNoMaterial(op, async () => {
        const journal = await new RelayEffectJournalRepository(this.state.root).load(op.profileHash, op.operationId);
        if (journal !== null && journal.effects.some(effect => effect.phase !== "pending" ||
          effect.attempt !== null || effect.observedAt !== null)) blocked("source_effect_intent_exists");
        return action();
      }));
  }
  private async reconcilePreEffectReservation(op: RelayUnsignedOperation): Promise<void> {
    const identity = this.usageIdentity(op), reservationId = this.usageReservationId(op);
    const current = await this.usage.load(identity, reservationId);
    if (current === null || current.state !== "reserved") return;
    try {
      await this.withNoEffectProof(op, async () => {
        await this.usage.transition({ ...identity, reservationId, policyDigest: op.policyDigest!,
          state: "failed_before_effect", expectedCurrentStates: ["reserved"], now: this.clock.now(),
          outcomeDigest: hashObject({ operationId: op.operationId, quoteDigest: op.quoteDigest,
            requestId: op.statusLocator!.requestId, reason: "no_durable_source_effect" }) });
      });
    } catch (error) {
      // A durable intent or signed envelope keeps the cap held. Let the effect
      // engine take its observation-only replay path; propagate other errors.
      if (error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" &&
        (error.details?.reason === "source_effect_intent_exists" ||
          error.details?.reason === "signed_effect_custody_exists")) return;
      throw error;
    }
  }

  private assertPrepared(op: RelayUnsignedOperation): void {
    validateRelayUnsignedOperation(op);
    if (op.sourceChainId !== 1 || op.quote === undefined || op.statusLocator === undefined ||
      op.policyDigest === undefined || op.policyRevision === undefined || op.approvalNetworkFeeCeilingWei === undefined ||
      op.depositNetworkFeeCeilingWei === undefined || op.quote.statusLocator?.requestId !== op.statusLocator.requestId ||
      op.quote.quoteDigest !== op.quoteDigest) blocked("saved_quote_or_request_id_required");
    relayExecutionRoute(op);
  }
  private summary(op: RelayUnsignedOperation): RelayExecutionSummary {
    this.assertPrepared(op);
    return { operationId: op.operationId, sourceChainId: 1, destinationChainId: op.destinationChainId as 56 | 8453, sourceAccount: op.sourceAccount,
      sourceToken: ETHEREUM_USDC, amountAtomic: op.amountAtomic, recipient: op.recipient,
      minOutputAtomic: op.minOutputAtomic, deadline: op.deadline, requestId: op.statusLocator!.requestId,
      quoteDigest: op.quoteDigest, approvalNetworkFeeCeilingWei: op.approvalNetworkFeeCeilingWei!,
      depositNetworkFeeCeilingWei: op.depositNetworkFeeCeilingWei! };
  }
  private async assertReady(op: RelayUnsignedOperation): Promise<void> {
    this.assertPrepared(op);
    if (await new RelayRetirementRepository(this.state.root).load(op) !== null) blocked("operation_retired");
    const now = this.clock.now();
    if (!Number.isFinite(now.getTime()) || now.getTime() + 60_000 >= Date.parse(op.deadline)) blocked("quote_deadline");
    await this.assertOwner(op);
    const active = await this.activePolicy(op);
    if (active === null || active.digest !== op.policyDigest || active.revision !== op.policyRevision ||
      !same(active.accounts.evm ?? "", op.sourceAccount)) blocked("active_policy_or_owner");
    if (!same(await this.publicAccount(op) ?? "", op.sourceAccount)) blocked("public_owner");
  }
  private async assertOwner(op: RelayUnsignedOperation): Promise<void> {
    // execute holds evmAddressLock from before confirmation through the first send.
    await assertExclusiveEvmOwner(this.state, op.sourceAccount, op.profileHash);
    const profile = await this.state.loadProviderProfile(op.profileHash);
    if (profile !== null && !same(profile.public_address, op.sourceAccount)) blocked("public_provider_profile_changed");
    const publicWallet = await this.state.loadWallet(op.profileHash);
    if (publicWallet !== null && !same(publicWallet.address, op.sourceAccount)) blocked("public_wallet_profile_changed");
    for (const record of await this.permissions.listAll()) {
      if (isGrantedPermissionRecord(record) && same(record.owner_address, op.sourceAccount) && record.profile_hash !== op.profileHash)
        blocked("foreign_encrypted_metamask_grant");
    }
  }
  private async activePolicy(op: RelayUnsignedOperation) {
    await this.assertOwner(op);
    return loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, "default");
  }
  private async publicAccount(op: RelayUnsignedOperation): Promise<string | null> {
    const wallet = await this.wallets.describe("default");
    if (wallet === null) return null;
    try { return same(wallet.identity.address, op.sourceAccount) ? wallet.identity.address : null; }
    finally { this.wallets.clear(wallet.secret); }
  }
  private async dailyUsageExcludingOwn(op: RelayUnsignedOperation, now: Date): Promise<string> {
    const identity = this.usageIdentity(op);
    const id = this.usageReservationId(op);
    const result = await this.usage.usageWithReservation(identity, id, now);
    if (result.reservation === null || result.reservation.amountAtomic !== op.amountAtomic ||
      result.reservation.policyDigest !== op.policyDigest) blocked("usage_reservation_missing_or_changed");
    const total = BigInt(result.snapshot.amountAtomic);
    const own = result.reservation.state !== "failed_before_effect" &&
      result.reservation.state !== "failed_confirmed_revert" &&
      result.reservation.reservedAt.slice(0, 10) === now.toISOString().slice(0, 10)
      ? BigInt(op.amountAtomic) : 0n;
    if (total < own) corrupt("usage total below own reservation");
    return (total - own).toString();
  }
  private async funding(op: RelayUnsignedOperation) {
    await this.assertOwner(op);
    const heads = await this.rpc.batchCall([{ method: "eth_chainId", params: [] },
      { method: "eth_getBlockByNumber", params: ["latest", false] }]);
    if (heads.length !== 2 || evmRpcQuantity(heads[0]) !== 1n) blocked("ethereum_rpc_chain");
    const head = evmRpcRecord(heads[1]), block = evmRpcQuantity(head.number), blockHash = evmRpcHex(head.hash, 32);
    if (blockHash === `0x${"0".repeat(64)}`) corrupt("zero source block hash");
    const reference = { blockHash, requireCanonical: true };
    const balanceData = `0x70a08231${op.sourceAccount.slice(2).toLowerCase().padStart(64, "0")}`;
    const allowanceData = `0xdd62ed3e${op.sourceAccount.slice(2).toLowerCase().padStart(64, "0")}${ETHEREUM_DEPOSITORY.slice(2).padStart(64, "0")}`;
    const rows = await this.rpc.batchCall([
      { method: "eth_getBlockByNumber", params: [`0x${block.toString(16)}`, false] },
      { method: "eth_getBalance", params: [op.sourceAccount, reference] },
      { method: "eth_call", params: [{ to: ETHEREUM_USDC, data: balanceData }, reference] },
      { method: "eth_call", params: [{ to: ETHEREUM_USDC, data: allowanceData }, reference] },
      { method: "eth_getTransactionCount", params: [op.sourceAccount, "pending"] },
      { method: "eth_maxPriorityFeePerGas", params: [] },
      { method: "eth_chainId", params: [] },
    ]);
    if (rows.length !== 7 || evmRpcQuantity(rows[6]) !== 1n) blocked("ethereum_rpc_chain");
    const canonical = evmRpcRecord(rows[0]);
    if (evmRpcQuantity(canonical.number) !== block || evmRpcHex(canonical.hash, 32) !== blockHash) blocked("source_block_changed");
    const priority = evmRpcQuantity(rows[5]), baseFee = evmRpcQuantity(head.baseFeePerGas);
    const nonce = evmRpcQuantity(rows[4]);
    this.signingNonce = nonce;
    const currentMaxFeePerGasWei = baseFee * 2n + priority;
    if (currentMaxFeePerGasWei === 0n) blocked("source_fee_unavailable");
    return { chainId: 1, nativeBalanceWei: evmRpcQuantity(rows[1]), tokenBalanceAtomic: evmRpcWord(rows[2]),
      allowanceAtomic: evmRpcWord(rows[3]), currentMaxFeePerGasWei, nextNonce: nonce };
  }
  private async sign(op: RelayUnsignedOperation, role: "approval" | "deposit"): Promise<Hex> {
    await this.assertReady(op);
    const nonce = this.signingNonce;
    this.signingNonce = null;
    if (nonce === null || nonce > BigInt(Number.MAX_SAFE_INTEGER)) blocked("signing_nonce_missing_or_unbounded");
    const wallet = await this.wallets.describe("default");
    if (wallet === null) blocked("encrypted_wallet_missing");
    try {
      if (!same(wallet.identity.address, op.sourceAccount)) blocked("encrypted_wallet_owner");
      const account = privateKeyToAccount(wallet.secret.privateKey);
      if (!same(account.address, op.sourceAccount)) corrupt("local_signer_owner");
      const envelope = role === "approval" ? op.quote!.approval : op.quote!.deposit;
      return await account.signTransaction({ type: "eip1559", chainId: 1, to: envelope.to as Hex,
        data: envelope.data as Hex, value: 0n, nonce: Number(nonce), gas: BigInt(envelope.gas),
        maxFeePerGas: BigInt(envelope.maxFeePerGas), maxPriorityFeePerGas: BigInt(envelope.maxPriorityFeePerGas), accessList: [] });
    } finally { this.wallets.clear(wallet.secret); }
  }
  private async observeApproval(hash: Hex): Promise<RelayApprovalObservation | null> {
    const found = await this.observation(hash);
    if (found === null) return null;
    return { transaction: { hash, from: found.from, to: found.to, input: found.input, chainId: 1 },
      receipt: { transactionHash: hash, status: found.status, blockNumber: found.blockNumber,
        blockHash: found.blockHash, logs: found.logs }, canonicalBlockHash: found.blockHash };
  }
  private async observeDeposit(hash: Hex): Promise<RelayDepositObservation | null> {
    const found = await this.observation(hash);
    if (found === null) return null;
    return { transaction: { hash, from: found.from, to: found.to, input: found.input, value: found.value, chainId: 1 },
      receipt: { transactionHash: hash, status: found.status, blockNumber: found.blockNumber,
        blockHash: found.blockHash }, canonicalBlockHash: found.blockHash };
  }
  private async observation(hash: Hex) {
    const [rawTx, rawReceipt] = await this.rpc.batchCall([
      { method: "eth_getTransactionByHash", params: [hash] },
      { method: "eth_getTransactionReceipt", params: [hash] },
    ]);
    if (rawTx === null && rawReceipt === null) return null;
    if (rawTx === null || rawReceipt === null) return null;
    const tx = evmRpcRecord(rawTx), receipt = evmRpcRecord(rawReceipt);
    if (evmRpcHex(tx.hash, 32) !== hash || evmRpcHex(receipt.transactionHash, 32) !== hash ||
      evmRpcQuantity(tx.chainId) !== 1n || evmRpcQuantity(tx.type) !== 2n ||
      evmRpcQuantity(tx.blockNumber) !== evmRpcQuantity(receipt.blockNumber) ||
      evmRpcHex(tx.blockHash, 32) !== evmRpcHex(receipt.blockHash, 32)) corrupt("transaction and receipt identity");
    const number = evmRpcQuantity(receipt.blockNumber);
    const inclusionTag = `0x${number.toString(16)}`;
    const [rawBlock, rawFinalized] = await this.rpc.batchCall([
      { method: "eth_getBlockByNumber", params: [inclusionTag, false] },
      { method: "eth_getBlockByNumber", params: ["finalized", false] },
    ]);
    const block = evmRpcBlockResult(rawBlock, inclusionTag);
    if (block.hash !== evmRpcHex(receipt.blockHash, 32)) blocked("source_receipt_reorg");
    const finalized = evmRpcBlockResult(rawFinalized, "finalized");
    if (BigInt(finalized.number) < number) return null;
    const [rawRecheckedBlock, rawRecheckedFinalized, rawChainId] = await this.rpc.batchCall([
      { method: "eth_getBlockByNumber", params: [block.tag, false] },
      { method: "eth_getBlockByNumber", params: [finalized.tag, false] },
      { method: "eth_chainId", params: [] },
    ]);
    if (evmRpcBlockResult(rawRecheckedBlock, block.tag).hash !== block.hash ||
      evmRpcBlockResult(rawRecheckedFinalized, finalized.tag).hash !== finalized.hash)
      throw new ApnError("APN_RPC_PROTOCOL", "EVM block changed around pinned reads.");
    if (evmRpcQuantity(rawChainId) !== 1n)
      blocked("ethereum_rpc_chain");
    const status = evmRpcQuantity(receipt.status);
    if (status !== 0n && status !== 1n) corrupt("receipt status");
    if (!Array.isArray(receipt.logs) || receipt.logs.length > 256) corrupt("receipt logs");
    const logs = receipt.logs.map(value => {
      const log = evmRpcRecord(value);
      if (!Array.isArray(log.topics) || log.topics.length > 4 || evmRpcHex(log.transactionHash, 32) !== hash ||
        evmRpcHex(log.blockHash, 32) !== block.hash || evmRpcQuantity(log.blockNumber) !== number || log.removed !== false)
        corrupt("receipt log identity");
      return { address: evmRpcAddress(log.address), topics: log.topics.map(topic => evmRpcHex(topic, 32)),
        data: evmRpcHex(log.data), transactionHash: hash, blockHash: block.hash };
    });
    return { from: evmRpcAddress(tx.from), to: tx.to === null ? null : evmRpcAddress(tx.to),
      input: evmRpcHex(tx.input), value: evmRpcQuantity(tx.value), status: status === 1n ? "success" as const : "reverted" as const,
      blockNumber: number, blockHash: block.hash, logs };
  }
  private async updateUsage(op: RelayUnsignedOperation, journal: RelayEffectJournal): Promise<void> {
    const approval = journal.effects[0].phase, deposit = journal.effects[1].phase;
    const state = deposit === "confirmed" ? "finalized" : deposit === "failed" ? "failed_confirmed_revert" :
      approval === "failed" ? "failed_confirmed_revert" :
        (approval === "pending" || approval === "signing_started" || approval === "sealed") ? null : "submitted";
    if (state === null) return;
    const identity = { account: getAddress(op.sourceAccount), chain: "eip155:1", asset: { kind: "token" as const, identifier: ETHEREUM_USDC } };
    const id = assetUsageReservationId(identity, `relay-execute:${op.operationId}`);
    const existing = await this.usage.load(identity, id);
    if (existing === null) corrupt("usage reservation vanished");
    if (existing.state === state) return;
    await this.usage.transition({ ...identity, reservationId: id, policyDigest: op.policyDigest!, state,
      now: this.clock.now(), ...(state === "finalized" || state === "failed_confirmed_revert"
        ? { outcomeDigest: journal.integrityHash } : {}) });
  }
}
