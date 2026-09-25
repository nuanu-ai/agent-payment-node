/** One guarded BNB native deposit for the fixed Relay BNB -> Polygon quote. */
import { randomBytes } from "node:crypto";
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject, canonicalJson, domainHash } from "../canonical.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { EncryptedWalletStore, walletCustodyLock, type DirectEffectMaterial } from "../encrypted-wallet-store.js";
import { EncryptedSmartAccountPermissionStore } from "../encrypted-smart-account-permission-store.js";
import { assertExclusiveEvmOwner, evmAddressLock } from "../evm-address-ownership.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { ApnError } from "../errors.js";
import { isGrantedPermissionRecord } from "../metamask-smart-account-record.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, validateRelayUnsignedOperation, type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { HttpsBaseRpc } from "../rpc.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import { RELAY_BNB_POLYGON_ROUTE_REFERENCE, RELAY_BNB_SOURCE, RELAY_POLYGON_RECIPIENT, verifySavedRelayNativeQuote } from "./native-quote.js";
import { ETHEREUM_DEPOSITORY } from "./quote.js";
import { RelayRpcInvocation, RELAY_EXECUTION_WALL_MS } from "./rpc-budget.js";

const PROFILE = "evm-live-buyer";
const HASH = /^[a-f0-9]{64}$/u, TX_HASH = /^0x[a-f0-9]{64}$/u;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function blocked(reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", "Relay BNB source execution is blocked.", { reason }); }
function corrupt(reason: string): never { throw new ApnError("APN_STATE_CORRUPT", `Relay BNB source state is invalid: ${reason}.`); }
type Rpc = Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">;
type Phase = "pending" | "signing_started" | "sealed" | "submitting" | "confirmed" | "failed";
export interface RelayNativeSourceJournal {
  readonly schemaVersion: "apn.relay-native-source-journal.v1";
  readonly profileHash: string; readonly operationId: string; readonly operationIntegrityHash: string;
  readonly quoteDigest: string; readonly requestId: string; readonly depositEnvelopeHash: string;
  readonly phase: Phase; readonly marker: string | null; readonly markedAt: string | null;
  readonly transactionHash: string | null; readonly observedAt: string | null; readonly integrityHash: string;
}
function journalBody(j: RelayNativeSourceJournal): Omit<RelayNativeSourceJournal, "integrityHash"> {
  const { integrityHash: _, ...body } = j; return body;
}
function validateJournal(value: unknown, op: RelayUnsignedOperation): RelayNativeSourceJournal {
  if (value === null || typeof value !== "object" || Array.isArray(value)) corrupt("journal shape");
  const j = value as RelayNativeSourceJournal;
  const keys = ["schemaVersion", "profileHash", "operationId", "operationIntegrityHash", "quoteDigest", "requestId",
    "depositEnvelopeHash", "phase", "marker", "markedAt", "transactionHash", "observedAt", "integrityHash"];
  if (Object.keys(j).sort().join() !== keys.sort().join() || j.schemaVersion !== "apn.relay-native-source-journal.v1" ||
    j.profileHash !== op.profileHash || j.operationId !== op.operationId || j.operationIntegrityHash !== op.integrityHash ||
    j.quoteDigest !== op.quoteDigest || j.requestId !== op.statusLocator?.requestId ||
    j.depositEnvelopeHash !== hashObject(op.nativeQuote!.deposit) || !["pending", "signing_started", "sealed", "submitting", "confirmed", "failed"].includes(j.phase) ||
    j.integrityHash !== hashObject(journalBody(j))) corrupt("journal binding");
  if (j.phase === "pending") {
    if (j.marker !== null || j.markedAt !== null || j.transactionHash !== null || j.observedAt !== null) corrupt("pending journal");
  } else {
    if (typeof j.marker !== "string" || !HASH.test(j.marker) || typeof j.markedAt !== "string" ||
      !Number.isFinite(Date.parse(j.markedAt))) corrupt("journal marker");
    if (j.phase === "signing_started" ? j.transactionHash !== null : typeof j.transactionHash !== "string" || !TX_HASH.test(j.transactionHash)) corrupt("journal hash");
    if (["confirmed", "failed"].includes(j.phase) ? typeof j.observedAt !== "string" || !Number.isFinite(Date.parse(j.observedAt)) : j.observedAt !== null) corrupt("journal observation");
  }
  return j;
}
export class RelayNativeSourceJournalRepository extends SecureStateStore {
  private path(op: RelayUnsignedOperation): string { return `relay-native-source-journals/${op.profileHash}/${op.operationId}.json`; }
  async load(op: RelayUnsignedOperation): Promise<RelayNativeSourceJournal | null> {
    const value = await this.readJson(this.path(op)); return value === null ? null : validateJournal(value, op);
  }
  async advance(op: RelayUnsignedOperation, expected: string | null, phase: Phase, hash: string | null = null,
    now: Date = new Date()): Promise<RelayNativeSourceJournal> {
    await this.initialize();
    return this.withLocks([`relay-native-journal:${op.operationId}`], async () => {
      const old = await this.load(op);
      if ((old?.integrityHash ?? null) !== expected) blocked("stale_journal");
      const previous = old?.phase ?? null;
      if (!((previous === null && phase === "pending") || (previous === "pending" && phase === "signing_started") ||
         (previous === "signing_started" && phase === "sealed") || (previous === "sealed" && phase === "submitting") ||
         (previous === "submitting" && (phase === "confirmed" || phase === "failed")))) blocked("journal_transition");
      const fields = previous === null ? { schemaVersion: "apn.relay-native-source-journal.v1" as const,
        profileHash: op.profileHash, operationId: op.operationId, operationIntegrityHash: op.integrityHash,
        quoteDigest: op.quoteDigest, requestId: op.statusLocator!.requestId,
        depositEnvelopeHash: hashObject(op.nativeQuote!.deposit), phase, marker: null, markedAt: null,
        transactionHash: null, observedAt: null } : { ...journalBody(old!), phase,
          marker: phase === "signing_started" ? randomBytes(32).toString("hex") : old!.marker,
          markedAt: phase === "signing_started" ? now.toISOString() : old!.markedAt,
          transactionHash: phase === "sealed" ? hash : old!.transactionHash,
          observedAt: phase === "confirmed" || phase === "failed" ? now.toISOString() : old!.observedAt };
      const next = validateJournal({ ...fields, integrityHash: hashObject(fields) }, op);
      await this.ensureDirectory(`relay-native-source-journals/${op.profileHash}`);
      await this.writeJson(this.path(op), next, previous === null);
      return next;
    });
  }
}

/** Persist the single dispatch marker before the send. Replays only return the marker. */
export async function dispatchRelayNativeDepositOnce(op: RelayUnsignedOperation,
  journal: RelayNativeSourceJournal, store: RelayNativeSourceJournalRepository,
  send: (raw: Hex) => Promise<string>, raw: Hex, now: Date): Promise<RelayNativeSourceJournal> {
  if (journal.phase === "submitting") return journal;
  if (journal.phase !== "sealed" || keccak256(raw) !== journal.transactionHash) blocked("sealed_dispatch_required");
  const marked = await store.advance(op, journal.integrityHash, "submitting", null, now);
  try { await send(raw); } catch { /* An ambiguous send is never repeated. */ }
  return marked;
}
function custodyKey(op: RelayUnsignedOperation): string {
  return domainHash("apn.relay-native-deposit-custody.v1", canonicalJson({ operationId: op.operationId }));
}
function custodyBinding(op: RelayUnsignedOperation): string {
  return domainHash("apn.relay-native-deposit-envelope.v1", canonicalJson({ operationId: op.operationId,
    integrityHash: op.integrityHash, quoteDigest: op.quoteDigest, deposit: op.nativeQuote!.deposit }));
}
async function verifySigned(op: RelayUnsignedOperation, raw: Hex, expectedNonce?: bigint): Promise<Hex> {
  if (!/^0x(?:[a-fA-F0-9]{2})+$/u.test(raw)) corrupt("signed encoding");
  let tx: ReturnType<typeof parseTransaction>, signer: string;
  try { tx = parseTransaction(raw as Parameters<typeof parseTransaction>[0]); signer = await recoverTransactionAddress({ serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]["serializedTransaction"] }); }
  catch { corrupt("signed decode"); }
  const d = op.nativeQuote!.deposit;
  if (tx.type !== "eip1559" || tx.chainId !== 56 || !same(signer, op.sourceAccount) ||
    !same(tx.to ?? "", d.to) || !same(tx.data ?? "0x", d.data) || (tx.value ?? 0n) !== BigInt(d.value) ||
    tx.gas !== BigInt(d.gas) || tx.maxFeePerGas !== BigInt(d.maxFeePerGas) ||
    tx.maxPriorityFeePerGas !== BigInt(d.maxPriorityFeePerGas) || tx.nonce === undefined ||
    (expectedNonce !== undefined && BigInt(tx.nonce) !== expectedNonce) || (tx.accessList?.length ?? 0) !== 0 ||
    tx.gas * tx.maxFeePerGas > BigInt(op.depositNetworkFeeCeilingWei!)) corrupt("signed envelope drift");
  return keccak256(raw);
}
export interface RelayNativeSourcePorts {
  readonly confirm: (summary: { operationId: string; sourceChainId: 56; destinationChainId: 137; sourceAccount: string;
    recipient: string; amountAtomic: string; minOutputAtomic: string; deadline: string; quoteDigest: string;
    requestId: string; depositNetworkFeeCeilingWei: string; depository: string; valueWei: string }) => Promise<boolean>;
  readonly rpc: Rpc;
}
export class RelayNativeSourceRuntime {
  private readonly wallets: EncryptedWalletStore;
  private readonly permissions: EncryptedSmartAccountPermissionStore;
  private readonly journals: RelayNativeSourceJournalRepository;
  private readonly usage: AssetUsageLedger;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly ports: RelayNativeSourcePorts,
    private readonly clock: ClockPort = { now: () => new Date() }, private readonly origin?: string) {
    this.wallets = new EncryptedWalletStore(state, wrapping);
    this.permissions = new EncryptedSmartAccountPermissionStore(state, wrapping);
    this.journals = new RelayNativeSourceJournalRepository(state.root);
    this.usage = new AssetUsageLedger(state.root);
  }
  async execute(operationId: string): Promise<RelayNativeSourceJournal> {
    if (!HASH.test(operationId)) throw new ApnError("APN_INVALID_INPUT", "Relay native execute requires an operation ID.");
    const op = await new RelayUnsignedOperationRepository(this.state.root).loadOperation(this.state.profileHash(PROFILE), operationId);
    if (op === null) blocked("prepared_operation_missing");
    this.assertLane(op);
    try { await verifySavedRelayNativeQuote(op.nativeQuote!); } catch { blocked("saved_native_quote_authority"); }
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), RELAY_EXECUTION_WALL_MS);
    try {
      const transport = this.ports.rpc instanceof HttpsBaseRpc ? this.ports.rpc.withAbortSignal(abort.signal) : this.ports.rpc;
      const invocation = this.origin === undefined ? null : new RelayRpcInvocation(this.state, this.origin, transport, abort.signal,
        transport instanceof HttpsBaseRpc ? () => transport.primePublicAddresses() : undefined);
      const rpc = invocation?.rpc ?? transport;
      const result = await this.state.withLocks([`relay-native-source:${operationId}`, evmAddressLock(op.sourceAccount)],
        async () => this.run(op, rpc));
      invocation?.assertAllowed(); return result;
    } finally { clearTimeout(timeout); }
  }
  private assertLane(op: RelayUnsignedOperation): void {
    validateRelayUnsignedOperation(op);
    const q = op.nativeQuote, d = q?.deposit;
    if (op.quote !== undefined || op.sourceChainId !== 56 || op.destinationChainId !== 137 ||
      !same(op.sourceAccount, RELAY_BNB_SOURCE) || !same(op.recipient, RELAY_POLYGON_RECIPIENT) ||
      q?.routeReference !== RELAY_BNB_POLYGON_ROUTE_REFERENCE || d === undefined ||
      op.statusLocator === undefined || op.policyDigest === undefined || op.policyRevision === undefined ||
      op.depositNetworkFeeCeilingWei === undefined || q.statusLocator?.requestId !== op.statusLocator.requestId ||
      !same(d.to, ETHEREUM_DEPOSITORY) || !same(d.from, op.sourceAccount) || d.chainId !== 56 ||
      d.value !== op.amountAtomic || d.maximumNetworkFeeWei !== op.depositNetworkFeeCeilingWei ||
      !same(q.paymentDetails.depository, d.to)) blocked("saved_native_quote_or_route");
  }
  private async owner(op: RelayUnsignedOperation): Promise<void> {
    await assertExclusiveEvmOwner(this.state, op.sourceAccount, op.profileHash);
    const profile = await this.state.loadProviderProfile(op.profileHash);
    if (profile !== null && !same(profile.public_address, op.sourceAccount)) blocked("provider_owner_changed");
    const publicWallet = await this.state.loadWallet(op.profileHash);
    if (publicWallet === null || !same(publicWallet.address, op.sourceAccount)) blocked("public_wallet_changed");
    for (const record of await this.permissions.listAll()) {
      if (isGrantedPermissionRecord(record) && same(record.owner_address, op.sourceAccount) &&
        record.profile_hash !== op.profileHash) blocked("foreign_encrypted_metamask_grant");
    }
  }
  private usageIdentity(op: RelayUnsignedOperation) {
    return { account: getAddress(op.sourceAccount), chain: "eip155:56", asset: { kind: "native" as const, identifier: null } };
  }
  private async active(op: RelayUnsignedOperation) {
    const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, PROFILE);
    if (active === null || active.profile !== PROFILE || active.digest !== op.policyDigest ||
      active.revision !== op.policyRevision || !same(active.accounts.evm ?? "", op.sourceAccount)) blocked("active_policy_or_owner");
    return active;
  }
  private async admission(op: RelayUnsignedOperation, now: Date): Promise<ReturnType<typeof loadActiveAssetPolicyRegistry> extends Promise<infer T> ? NonNullable<T> : never> {
    await this.owner(op);
    if (await new RelayRetirementRepository(this.state.root).load(op) !== null) blocked("operation_retired");
    if (!Number.isFinite(now.getTime()) || now.getTime() + 60_000 >= Date.parse(op.deadline)) blocked("quote_deadline");
    const active = await this.active(op);
    if (active.registry.expiresAt !== undefined && now.toISOString() >= active.registry.expiresAt) blocked("policy_expired");
    const id = assetUsageReservationId(this.usageIdentity(op), `relay-native-execute:${op.operationId}`);
    const current = await this.usage.usageWithReservation(this.usageIdentity(op), id, now);
    const own = current.reservation !== null && !["failed_before_effect", "failed_confirmed_revert"].includes(current.reservation.state) &&
      current.reservation.reservedAt.slice(0, 10) === now.toISOString().slice(0, 10) ? BigInt(op.amountAtomic) : 0n;
    if (BigInt(current.snapshot.amountAtomic) < own) corrupt("usage total");
    const decision = evaluateAssetPolicy(active.registry, { chain: "eip155:56", asset: { kind: "native", identifier: null },
      rail: "bridge", amountAtomic: op.amountAtomic, dailyUsageAtomic: (BigInt(current.snapshot.amountAtomic) - own).toString(),
      asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    const pin = decision.asset.mechanismPins?.bridge;
    if (pin?.provider !== "relay" || pin.reference !== RELAY_BNB_POLYGON_ROUTE_REFERENCE) blocked("route_pin");
    return active;
  }
  private async funding(op: RelayUnsignedOperation, rpc: Rpc): Promise<bigint> {
    const head = await rpc.batchCall([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["latest", false] }]);
    if (head.length !== 2 || evmRpcQuantity(head[0]) !== 56n) blocked("bnb_rpc_chain");
    const block = evmRpcRecord(head[1]), number = evmRpcQuantity(block.number), hash = evmRpcHex(block.hash, 32);
    const reference = { blockHash: hash, requireCanonical: true };
    const rows = await rpc.batchCall([
      { method: "eth_getBlockByNumber", params: [`0x${number.toString(16)}`, false] },
      { method: "eth_getBalance", params: [op.sourceAccount, reference] },
      { method: "eth_getTransactionCount", params: [op.sourceAccount, "pending"] },
      { method: "eth_gasPrice", params: [] }, { method: "eth_chainId", params: [] },
    ]);
    if (rows.length !== 5 || evmRpcQuantity(rows[4]) !== 56n || evmRpcQuantity(evmRpcRecord(rows[0]).number) !== number ||
      evmRpcHex(evmRpcRecord(rows[0]).hash, 32) !== hash) blocked("bnb_source_block_changed");
    const d = op.nativeQuote!.deposit;
    if (evmRpcQuantity(rows[1]) < BigInt(d.value) + BigInt(op.depositNetworkFeeCeilingWei!) ||
      evmRpcQuantity(rows[3]) > BigInt(d.maxFeePerGas) || evmRpcQuantity(rows[3]) <= 0n) blocked("native_funding_or_fee");
    const nonce = evmRpcQuantity(rows[2]);
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) blocked("nonce_unbounded");
    return nonce;
  }
  private async custody(op: RelayUnsignedOperation, signed?: { raw: Hex; hash: Hex }): Promise<{ raw: Hex; hash: Hex } | null> {
    return this.state.withLocks([walletCustodyLock(this.state, PROFILE)], async () => {
      const wallet = await this.wallets.describe(PROFILE);
      if (wallet === null) blocked("encrypted_wallet_missing");
      try {
        if (!same(wallet.identity.address, op.sourceAccount)) blocked("encrypted_wallet_owner");
        const old = wallet.secret.directEffects[custodyKey(op)];
        if (signed !== undefined) {
          if (old !== undefined) blocked("signed_native_deposit_already_sealed");
          if (await verifySigned(op, signed.raw) !== signed.hash) corrupt("signed hash");
          const entry: DirectEffectMaterial = { payloadHash: custodyBinding(op), transactionHash: signed.hash,
            rawTransaction: signed.raw, rawTransactionHash: signed.hash };
          wallet.secret.directEffects[custodyKey(op)] = entry;
          await this.wallets.save(wallet.identity, wallet.secret); return signed;
        }
        if (old === undefined) return null;
        if (old.payloadHash !== custodyBinding(op) || old.transactionHash !== old.rawTransactionHash ||
          keccak256(old.rawTransaction) !== old.transactionHash) corrupt("custody binding");
        await verifySigned(op, old.rawTransaction);
        return { raw: old.rawTransaction, hash: old.transactionHash };
      } finally { this.wallets.clear(wallet.secret); }
    });
  }
  private async observe(op: RelayUnsignedOperation, rpc: Rpc, hash: Hex): Promise<"confirmed" | "failed" | null> {
    const rows = await rpc.batchCall([{ method: "eth_getTransactionByHash", params: [hash] },
      { method: "eth_getTransactionReceipt", params: [hash] }]);
    if (rows.length !== 2 || rows[0] === null || rows[1] === null) return null;
    const tx = evmRpcRecord(rows[0]), receipt = evmRpcRecord(rows[1]);
    if (evmRpcHex(tx.hash, 32) !== hash || evmRpcHex(receipt.transactionHash, 32) !== hash ||
      evmRpcQuantity(tx.chainId) !== 56n || evmRpcQuantity(tx.type) !== 2n ||
      !same(evmRpcAddress(tx.from), op.sourceAccount) || !same(evmRpcAddress(tx.to), op.nativeQuote!.deposit.to) ||
      !same(evmRpcHex(tx.input), op.nativeQuote!.deposit.data) || evmRpcQuantity(tx.value) !== BigInt(op.amountAtomic) ||
      evmRpcQuantity(tx.blockNumber) !== evmRpcQuantity(receipt.blockNumber) ||
      evmRpcHex(tx.blockHash, 32) !== evmRpcHex(receipt.blockHash, 32)) corrupt("source transaction identity");
    const number = evmRpcQuantity(receipt.blockNumber), tag = `0x${number.toString(16)}`;
    const blocks = await rpc.batchCall([{ method: "eth_getBlockByNumber", params: [tag, false] },
      { method: "eth_getBlockByNumber", params: ["latest", false] }, { method: "eth_chainId", params: [] }]);
    if (blocks.length !== 3 || evmRpcQuantity(blocks[2]) !== 56n) blocked("bnb_rpc_chain");
    const inclusion = evmRpcRecord(blocks[0]), latest = evmRpcRecord(blocks[1]);
    if (evmRpcHex(inclusion.hash, 32) !== evmRpcHex(receipt.blockHash, 32) || evmRpcQuantity(inclusion.number) !== number)
      blocked("source_receipt_reorg");
    if (evmRpcQuantity(latest.number) < number + 15n) return null;
    const recheck = await rpc.batchCall([{ method: "eth_getBlockByNumber", params: [tag, false] },
      { method: "eth_getBlockByNumber", params: [`0x${evmRpcQuantity(latest.number).toString(16)}`, false] },
      { method: "eth_chainId", params: [] }]);
    if (recheck.length !== 3 || evmRpcQuantity(recheck[2]) !== 56n ||
      evmRpcHex(evmRpcRecord(recheck[0]).hash, 32) !== evmRpcHex(inclusion.hash, 32) ||
      evmRpcHex(evmRpcRecord(recheck[1]).hash, 32) !== evmRpcHex(latest.hash, 32)) blocked("source_block_changed");
    const status = evmRpcQuantity(receipt.status);
    if (status !== 0n && status !== 1n) corrupt("receipt status");
    return status === 1n ? "confirmed" : "failed";
  }
  private async run(op: RelayUnsignedOperation, rpc: Rpc): Promise<RelayNativeSourceJournal> {
    await this.owner(op);
    let j = await this.journals.load(op);
    const identity = this.usageIdentity(op);
    const reservationId = assetUsageReservationId(identity, `relay-native-execute:${op.operationId}`);
    if (j === null || j.phase === "pending") {
      const prior = await this.usage.load(identity, reservationId);
      if (prior?.state === "reserved") {
        if (await this.custody(op) !== null) corrupt("signed custody before source marker");
        await this.usage.transition({ ...identity, reservationId, policyDigest: op.policyDigest!,
          state: "failed_before_effect", expectedCurrentStates: ["reserved"], now: this.clock.now(),
          outcomeDigest: hashObject({ operationId: op.operationId, quoteDigest: op.quoteDigest, reason: "no_source_marker" }) });
      } else if (prior !== null && prior.state !== "failed_before_effect") corrupt("usage without source marker");
    }
    if (j?.phase === "confirmed" || j?.phase === "failed") {
      await this.settleUsage(op, j);
      return j;
    }
    const observationOnly = j?.phase === "submitting";
    if (!observationOnly && await this.ports.confirm({ operationId: op.operationId, sourceChainId: 56, destinationChainId: 137,
      sourceAccount: op.sourceAccount, recipient: op.recipient, amountAtomic: op.amountAtomic,
      minOutputAtomic: op.minOutputAtomic, deadline: op.deadline, quoteDigest: op.quoteDigest,
      requestId: op.statusLocator!.requestId, depositNetworkFeeCeilingWei: op.depositNetworkFeeCeilingWei!,
      depository: op.nativeQuote!.deposit.to, valueWei: op.nativeQuote!.deposit.value }) !== true) blocked("foreground_authorization_declined");
    if (j === null) {
      await this.admission(op, this.clock.now());
      j = await this.journals.advance(op, null, "pending");
    }
    if (j.phase === "pending") {
      const active = await this.admission(op, this.clock.now());
      const prior = await this.usage.load(identity, reservationId);
      await this.usage.reserve({ ...identity, registry: active.registry, rail: "bridge", amountAtomic: op.amountAtomic,
        idempotencyKey: `relay-native-execute:${op.operationId}`, now: this.clock.now(),
        ...(prior === null ? {} : { retryFailedBeforeEffect: true }) });
      await this.admission(op, this.clock.now());
      const nonce = await this.funding(op, rpc);
      j = await this.journals.advance(op, j.integrityHash, "signing_started", null, this.clock.now());
      const wallet = await this.wallets.describe(PROFILE);
      if (wallet === null) blocked("encrypted_wallet_missing");
      let raw: Hex;
      try {
        if (!same(wallet.identity.address, op.sourceAccount)) blocked("encrypted_wallet_owner");
        const signer = privateKeyToAccount(wallet.secret.privateKey);
        if (!same(signer.address, op.sourceAccount)) corrupt("local_signer_owner");
        const d = op.nativeQuote!.deposit;
        raw = await signer.signTransaction({ type: "eip1559", chainId: 56, to: d.to as Hex, data: d.data as Hex,
          value: BigInt(d.value), gas: BigInt(d.gas), nonce: Number(nonce), maxFeePerGas: BigInt(d.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(d.maxPriorityFeePerGas), accessList: [] });
      } finally { this.wallets.clear(wallet.secret); }
      const hash = await verifySigned(op, raw, nonce);
      await this.custody(op, { raw, hash });
    }
    if (j.phase === "signing_started") {
      const signed = await this.custody(op);
      if (signed === null) return j; // A crash before sealing is deliberately never signed again.
      j = await this.journals.advance(op, j.integrityHash, "sealed", signed.hash, this.clock.now());
    }
    if (j.phase === "sealed") {
      await this.admission(op, this.clock.now());
      const nonce = await this.funding(op, rpc);
      const signed = await this.custody(op);
      if (signed === null || signed.hash !== j.transactionHash) corrupt("sealed custody missing");
      await verifySigned(op, signed.raw, nonce);
      j = await dispatchRelayNativeDepositOnce(op, j, this.journals,
        raw => rpc.submitRawTransaction(raw), signed.raw, this.clock.now());
    }
    if (j.phase === "submitting") {
      const outcome = await this.observe(op, rpc, j.transactionHash as Hex);
      if (outcome === null) return j;
      j = await this.journals.advance(op, j.integrityHash, outcome, null, this.clock.now());
      await this.settleUsage(op, j);
    }
    return j;
  }
  private async settleUsage(op: RelayUnsignedOperation, j: RelayNativeSourceJournal): Promise<void> {
    if (j.phase !== "confirmed" && j.phase !== "failed") return;
    const identity = this.usageIdentity(op);
    const reservationId = assetUsageReservationId(identity, `relay-native-execute:${op.operationId}`);
    const current = await this.usage.load(identity, reservationId);
    if (current === null) corrupt("usage reservation missing");
    const target = j.phase === "confirmed" ? "finalized" : "failed_confirmed_revert";
    if (current.state === target) return;
    await this.usage.transition({ ...identity, reservationId, policyDigest: op.policyDigest!,
      state: target, now: this.clock.now(), outcomeDigest: j.integrityHash });
  }
}

export function createRelayNativeSourceRuntime(state: StateStore, wrapping: WrappingSecretPort, rpcUrl: string,
  confirm: RelayNativeSourcePorts["confirm"], clock?: ClockPort, transport?: Rpc): RelayNativeSourceRuntime {
  let url: URL;
  try { url = new URL(rpcUrl); } catch { throw new ApnError("APN_RPC_CONFIG", "Relay BNB source requires a HTTPS RPC origin."); }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search !== "" || url.hash !== "" ||
    url.username !== "" || url.password !== "") throw new ApnError("APN_RPC_CONFIG", "Relay BNB source requires a keyless HTTPS RPC origin.");
  return new RelayNativeSourceRuntime(state, wrapping, { confirm, rpc: transport ?? new HttpsBaseRpc(rpcUrl) }, clock, url.origin);
}
