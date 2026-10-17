/** One durable native deposit for an exact saved Relay BNB or Base native-source quote of any profile. */
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../canonical.js";
import { activeAssetPolicyFromState } from "../allowlist-active-policy.js";
import { allowlistProfileHash } from "../allowlist-policy-overlay.js";
import { AllowlistPolicyStore } from "../allowlist-policy-store.js";
import { RelayNativeAuthority } from "./native-authority.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { assertRecipientAdmitted } from "../allowlist-recipient-pins.js";
import { AssetUsageLedger, assetUsageReservationId } from "../asset-usage-ledger.js";
import { EncryptedWalletStore, walletCustodyLock } from "../encrypted-wallet-store.js";
import { EncryptedSmartAccountPermissionStore } from "../encrypted-smart-account-permission-store.js";
import { assertExclusiveEvmOwner, evmAddressLock } from "../evm-address-ownership.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { ApnError } from "../errors.js";
import { evmFrozenFeeAdmitted } from "../evm-fee-admission.js";
import { evmUnsentOutcome } from "../evm-unsent-outcome.js";
import { relaySignedNonce } from "./approval-effect.js";
import { isGrantedPermissionRecord } from "../metamask-smart-account-record.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { ClockPort } from "../ports.js";
import { RelayRetirementRepository, RelayUnsignedOperationRepository, validateRelayUnsignedOperation, type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { StateStore } from "../state.js";
import { verifySavedRelayNativeQuote } from "./native-quote.js";
import { relayNativeRouteByReference } from "./native-routes.js";
import { ETHEREUM_DEPOSITORY } from "./quote.js";
import { verifyRelayBaseFunding } from "./base-source-guard.js";
import { RelayNativeDepositCustody, verifySignedNativeDeposit as verifySigned } from "./native-source-custody.js";
import { decodeRelayBaseReceiptFee, verifyRelayBaseReceiptFee } from "./source-fee-proof.js";
import { RelayRpcInvocation, RELAY_EXECUTION_WALL_MS } from "./rpc-budget.js";

const HASH = /^[a-f0-9]{64}$/u;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function blocked(reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", "Relay native source execution is blocked.", { reason }); }
function corrupt(reason: string): never { throw new ApnError("APN_STATE_CORRUPT", `Relay native source state is invalid: ${reason}.`); }
type Rpc = Pick<HttpsBaseRpc, "batchCall" | "submitRawTransaction">;
export { RelayNativeSourceJournalRepository, dispatchRelayNativeDepositOnce, publicRelayNativeSourceJournal,
  type RelayNativeSourceJournal } from "./native-source-journal.js";
import { RelayNativeSourceJournalRepository, dispatchRelayNativeDepositOnce, type RelayNativeSourceJournal } from "./native-source-journal.js";
export interface RelayNativeSourcePorts {
  readonly confirm: (summary: { operationId: string; sourceChainId: 56 | 8453; destinationChainId: 137 | 143 | 4326; sourceAccount: string;
    recipient: string; amountAtomic: string; minOutputAtomic: string; deadline: string; quoteDigest: string;
    requestId: string; depositNetworkFeeCeilingWei: string; depository: string; valueWei: string }) => Promise<boolean>;
  readonly rpc: Rpc;
}
export class RelayNativeSourceRuntime {
  readonly #heldCustody = new WeakSet<RelayUnsignedOperation>();
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
  /** `profile` is the caller's explicit profile; the operation is found only under its hash (OWNR 4.1). */
  async execute(profile: string, operationId: string): Promise<RelayNativeSourceJournal> {
    if (!HASH.test(operationId)) throw new ApnError("APN_INVALID_INPUT", "Relay native execute requires an operation ID.");
    allowlistProfileHash(profile);
    const op = await new RelayUnsignedOperationRepository(this.state.root).loadOperation(this.state.profileHash(profile), operationId);
    if (op === null) blocked("prepared_operation_missing");
    this.assertLane(op);
    try { await verifySavedRelayNativeQuote(op.nativeQuote!); } catch { blocked("saved_native_quote_authority"); }
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), RELAY_EXECUTION_WALL_MS);
    try {
      const transport = this.ports.rpc instanceof HttpsBaseRpc ? this.ports.rpc.withAbortSignal(abort.signal) : this.ports.rpc;
      const invocation = this.origin === undefined ? null : new RelayRpcInvocation(this.state, this.origin, transport, abort.signal,
        transport instanceof HttpsBaseRpc ? () => transport.primePublicAddresses() : undefined);
      const rpc = invocation?.rpc ?? transport;
      const work = () => this.state.withLocks([`profile:${op.profileHash}`, `profile:${allowlistProfileHash(profile)}`, `relay-native-source:${operationId}`, evmAddressLock(op.sourceAccount)],
        async () => this.run(op, profile, rpc, abort.signal));
      const result = op.sourceChainId !== 8453 ? await work() : await this.state.withLocks([
        walletCustodyLock(this.state, profile)], async () => {
        this.#heldCustody.add(op);
        try { return await work(); } finally { this.#heldCustody.delete(op); }
      });
      invocation?.assertAllowed(); return result;
    } finally { abort.abort(); clearTimeout(timeout); }
  }
  private assertLane(op: RelayUnsignedOperation): void {
    validateRelayUnsignedOperation(op);
    const q = op.nativeQuote, d = q?.deposit;
    // The route is the protocol row the saved quote names; payer and recipient are the operation's own (OWNR R2).
    const route = q === undefined ? null : relayNativeRouteByReference(q.routeReference);
    if (route === null || q === undefined) blocked("saved_native_quote_or_route");
    if (op.quote !== undefined || op.sourceChainId !== route.sourceChainId || op.destinationChainId !== route.chainId ||
      !same(q.payer, op.sourceAccount) || !same(q.recipient, op.recipient) || d === undefined ||
      op.statusLocator === undefined || op.policyDigest === undefined || op.policyRevision === undefined ||
      op.depositNetworkFeeCeilingWei === undefined || q.statusLocator?.requestId !== op.statusLocator.requestId ||
      !same(d.to, ETHEREUM_DEPOSITORY) || !same(d.from, op.sourceAccount) || d.chainId !== route.sourceChainId ||
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
    return { account: getAddress(op.sourceAccount), chain: `eip155:${op.sourceChainId}`, asset: { kind: "native" as const, identifier: null } };
  }
  private async active(op: RelayUnsignedOperation, profile: string) {
    const active = activeAssetPolicyFromState(await new AllowlistPolicyStore(this.state.root).readUnderProfileLock(profile), this.clock.now());
    if (active === null || active.profile !== profile || active.digest !== op.policyDigest ||
      active.revision !== op.policyRevision || !same(active.accounts.evm ?? "", op.sourceAccount) || op.policyActivationDigest !== undefined && active.activationDigest !== op.policyActivationDigest) blocked("active_policy_or_owner");
    return active;
  }
  /** Owner admission at every gate (prepare-of-execute, reservation, signing, first send): owner, policy, caps, mechanism
   * and the owner's optional recipient pin (OD-1). */
  private async admission(op: RelayUnsignedOperation, profile: string, now: Date) {
    await this.owner(op);
    if (await new RelayRetirementRepository(this.state.root).load(op) !== null) blocked("operation_retired");
    if (!Number.isFinite(now.getTime()) || now.getTime() + 60_000 >= Date.parse(op.deadline)) blocked("quote_deadline");
    const active = await this.active(op, profile);
    if (active.registry.expiresAt !== undefined && now.toISOString() >= active.registry.expiresAt) blocked("policy_expired");
    const id = assetUsageReservationId(this.usageIdentity(op), `relay-native-execute:${op.operationId}`);
    const current = await this.usage.usageWithReservation(this.usageIdentity(op), id, now);
    const own = current.reservation !== null && !["failed_before_effect", "failed_confirmed_revert"].includes(current.reservation.state) &&
      current.reservation.reservedAt.slice(0, 10) === now.toISOString().slice(0, 10) ? BigInt(op.amountAtomic) : 0n;
    if (BigInt(current.snapshot.amountAtomic) < own) corrupt("usage total");
    const mechanism = { provider: "relay", reference: op.nativeQuote!.routeReference };
    const decision = evaluateAssetPolicy(active.registry, { chain: `eip155:${op.sourceChainId}`, asset: { kind: "native", identifier: null },
      rail: "bridge", mechanism, amountAtomic: op.amountAtomic, dailyUsageAtomic: (BigInt(current.snapshot.amountAtomic) - own).toString(),
      asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    if (!bridgeMechanismAdmitted(decision, mechanism)) blocked("route_pin");
    assertRecipientAdmitted({ admission: decision, mechanism, recipient: op.recipient });
    return active;
  }
  /** Chain and head, then the balance pinned to the head hash (EIP-1898 requireCanonical) and the pending nonce; Base
   * adds its exact simulation and OP fee reads at that height. No header is re-read around pinned reads (P2). */
  private async funding(op: RelayUnsignedOperation, rpc: Rpc): Promise<bigint> {
    const head = await rpc.batchCall([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["latest", false] }]);
    if (head.length !== 2 || evmRpcQuantity(head[0]) !== BigInt(op.sourceChainId)) blocked("bnb_rpc_chain");
    const block = evmRpcRecord(head[1]), number = evmRpcQuantity(block.number), hash = evmRpcHex(block.hash, 32);
    const reference = { blockHash: hash, requireCanonical: true };
    const rows = await rpc.batchCall([
      { method: "eth_getBalance", params: [op.sourceAccount, reference] },
      { method: "eth_getTransactionCount", params: [op.sourceAccount, "pending"] },
    ]);
    if (rows.length !== 2) blocked("bnb_source_batch");
    const d = op.nativeQuote!.deposit;
    if (evmRpcQuantity(rows[0]) < BigInt(d.value) + BigInt(op.depositNetworkFeeCeilingWei!) ||
      !evmFrozenFeeAdmitted(evmRpcQuantity(block.baseFeePerGas), { maxFeePerGasWei: BigInt(d.maxFeePerGas),
        maxPriorityFeePerGasWei: BigInt(d.maxPriorityFeePerGas) })) blocked("native_funding_or_fee");
    if (op.sourceChainId === 8453) await verifyRelayBaseFunding(op, rpc, `0x${number.toString(16)}`);
    const nonce = evmRpcQuantity(rows[1]);
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) blocked("nonce_unbounded");
    return nonce;
  }
  private async observe(op: RelayUnsignedOperation, rpc: Rpc, hash: Hex): Promise<"confirmed" | "failed" | null> {
    const rows = await rpc.batchCall([{ method: "eth_getTransactionByHash", params: [hash] },
      { method: "eth_getTransactionReceipt", params: [hash] }]);
    if (rows.length !== 2 || rows[0] === null || rows[1] === null) return null;
    const tx = evmRpcRecord(rows[0]), receipt = evmRpcRecord(rows[1]);
    if (evmRpcHex(tx.hash, 32) !== hash || evmRpcHex(receipt.transactionHash, 32) !== hash ||
      evmRpcQuantity(tx.chainId) !== BigInt(op.sourceChainId) || evmRpcQuantity(tx.type) !== 2n ||
      !same(evmRpcAddress(tx.from), op.sourceAccount) || !same(evmRpcAddress(tx.to), op.nativeQuote!.deposit.to) ||
      !same(evmRpcHex(tx.input), op.nativeQuote!.deposit.data) || evmRpcQuantity(tx.value) !== BigInt(op.amountAtomic) ||
      evmRpcQuantity(tx.blockNumber) !== evmRpcQuantity(receipt.blockNumber) ||
      evmRpcHex(tx.blockHash, 32) !== evmRpcHex(receipt.blockHash, 32)) corrupt("source transaction identity");
    const number = evmRpcQuantity(receipt.blockNumber), tag = `0x${number.toString(16)}`;
    const blocks = await rpc.batchCall([{ method: "eth_getBlockByNumber", params: [tag, false] },
      { method: "eth_getBlockByNumber", params: [op.sourceChainId === 8453 ? "safe" : "latest", false] }, { method: "eth_chainId", params: [] }]);
    if (blocks.length !== 3 || evmRpcQuantity(blocks[2]) !== BigInt(op.sourceChainId)) blocked("bnb_rpc_chain");
    const inclusion = evmRpcRecord(blocks[0]), latest = evmRpcRecord(blocks[1]);
    if (evmRpcHex(inclusion.hash, 32) !== evmRpcHex(receipt.blockHash, 32) || evmRpcQuantity(inclusion.number) !== number)
      blocked("source_receipt_reorg");
    if (evmRpcQuantity(latest.number) < number + (op.sourceChainId === 56 ? 15n : 0n)) return null;
    const recheck = await rpc.batchCall([{ method: "eth_getBlockByNumber", params: [tag, false] },
      { method: "eth_getBlockByNumber", params: [`0x${evmRpcQuantity(latest.number).toString(16)}`, false] },
      { method: "eth_chainId", params: [] }]);
    if (recheck.length !== 3 || evmRpcQuantity(recheck[2]) !== BigInt(op.sourceChainId) ||
      evmRpcHex(evmRpcRecord(recheck[0]).hash, 32) !== evmRpcHex(inclusion.hash, 32) ||
      evmRpcHex(evmRpcRecord(recheck[1]).hash, 32) !== evmRpcHex(latest.hash, 32)) blocked("source_block_changed");
    const status = evmRpcQuantity(receipt.status);
    if (status !== 0n && status !== 1n) corrupt("receipt status");
    if (op.sourceChainId === 8453) {
      // A source receipt cannot settle the native hold on L2-only gas evidence.
      // Unsupported, malformed or over-cap fee evidence keeps the send charged
      // and nonterminal; it must never trigger a send retry or hold release.
      try { verifyRelayBaseReceiptFee(decodeRelayBaseReceiptFee(receipt), op.depositNetworkFeeCeilingWei!); }
      catch { return null; }
    }
    return status === 1n ? "confirmed" : "failed";
  }
  private async run(op: RelayUnsignedOperation, profile: string, rpc: Rpc, signal: AbortSignal): Promise<RelayNativeSourceJournal> {
    let authority: RelayNativeAuthority | undefined;
    const vault = new RelayNativeDepositCustody(this.state, this.wallets, profile, candidate => this.#heldCustody.has(candidate));
    try {
      await this.owner(op);
      let j = await this.journals.load(op);
      const identity = this.usageIdentity(op);
      const reservationId = assetUsageReservationId(identity, `relay-native-execute:${op.operationId}`);
      if ((j === null || j.phase === "pending" || j.phase === "failed_before_effect") && await this.journals.hasEffectClaim(op)) {
        const prior = await this.usage.load(identity, reservationId);
        if (prior?.state === "reserved") await this.usage.transition({ ...identity, reservationId,
          policyDigest: op.policyDigest!, state: "unknown_finality", now: this.clock.now() });
        blocked("permanent_effect_claim_requires_observation");
      }
      if (j === null || j.phase === "pending") {
        const prior = await this.usage.load(identity, reservationId);
        if (prior?.state === "reserved") {
          if (await vault.slot(op) !== null) corrupt("signed custody before source marker");
          await this.usage.transition({ ...identity, reservationId, policyDigest: op.policyDigest!,
            state: "failed_before_effect", expectedCurrentStates: ["reserved"], now: this.clock.now(),
            outcomeDigest: hashObject({ operationId: op.operationId, quoteDigest: op.quoteDigest, reason: "no_source_marker" }) });
        } else if (prior !== null && prior.state !== "failed_before_effect") corrupt("usage without source marker");
      }
      if (j?.phase === "sealed") {
        // Saved bytes never sent end only when another transaction consumed their nonce at safe depth; otherwise they resume.
        const saved = await vault.slot(op);
        const outcome = saved !== null && saved.hash === j.transactionHash ? await this.unsentOutcome(rpc, op, saved) : null;
        if (outcome === "never_lands") {
          j = await this.journals.advance(op, j.integrityHash, "abandoned_unsent", null, this.clock.now());
          await vault.discard(op);
        }
        // The node already knows these exact bytes: never send them again; fence them as possibly sent and only observe.
        if (outcome === "own_transaction_known") j = await this.journals.advance(op, j.integrityHash, "submitting", null, this.clock.now());
      }
      if (j?.phase === "confirmed" || j?.phase === "failed" || j?.phase === "failed_before_effect" || j?.phase === "abandoned_unsent") {
        await this.settleUsage(op, j);
        return j;
      }
      if (j?.phase === "signing_started" && op.sourceChainId === 8453 && await vault.slot(op) === null) {
        if ((await this.usage.load(identity, reservationId))?.state === "reserved")
          await this.usage.transition({ ...identity, reservationId, policyDigest: op.policyDigest!, state: "unknown_finality", now: this.clock.now() });
        return j;
      }
      const observationOnly = j?.phase === "submitting";
      if (j === null || j.phase === "pending" || j.phase === "sealed" || op.sourceChainId === 8453 && j.phase === "signing_started")
        authority = new RelayNativeAuthority(op, await this.admission(op, profile, this.clock.now()), this.clock, signal);
      if (!observationOnly && await this.ports.confirm({ operationId: op.operationId, sourceChainId: op.sourceChainId as 56 | 8453, destinationChainId: op.destinationChainId as 137 | 143 | 4326,
        sourceAccount: op.sourceAccount, recipient: op.recipient, amountAtomic: op.amountAtomic,
        minOutputAtomic: op.minOutputAtomic, deadline: authority?.deadline ?? op.deadline, quoteDigest: op.quoteDigest,
        requestId: op.statusLocator!.requestId, depositNetworkFeeCeilingWei: op.depositNetworkFeeCeilingWei!,
        depository: op.nativeQuote!.deposit.to, valueWei: op.nativeQuote!.deposit.value }) !== true) blocked("foreground_authorization_declined");
      if (authority !== undefined) authority.assert();
      if (j === null) {
        authority!.assert();
        j = await this.journals.advance(op, null, "pending");
      }
      // P2: bytes signed in this invocation go out on the funding and nonce just read under the held locks.
      let signedNonce: bigint | null = null;
      if (j.phase === "pending") {
        const active = await this.admission(op, profile, this.clock.now());
        const prior = await this.usage.load(identity, reservationId);
        await this.usage.reserve({ ...identity, registry: active.registry, rail: "bridge", mechanism: { provider: "relay", reference: op.nativeQuote!.routeReference }, amountAtomic: op.amountAtomic,
          idempotencyKey: `relay-native-execute:${op.operationId}`, now: this.clock.now(),
          ...(prior === null ? {} : { retryFailedBeforeEffect: true }) });
        await this.admission(op, profile, this.clock.now());
        const nonce = await this.funding(op, rpc);
        authority!.assert(await this.admission(op, profile, this.clock.now()));
        await this.journals.claimSigning(op, nonce);
        j = await this.journals.advance(op, j.integrityHash, "signing_started", null, this.clock.now());
        if (op.sourceChainId === 8453) await this.usage.transition({ ...identity, reservationId, policyDigest: op.policyDigest!, state: "unknown_finality", now: this.clock.now() });
        const wallet = await this.wallets.describe(profile);
        if (wallet === null) blocked("encrypted_wallet_missing");
        let raw: Hex;
        try {
          authority!.assert(await this.admission(op, profile, this.clock.now()));
          if (!same(wallet.identity.address, op.sourceAccount)) blocked("encrypted_wallet_owner");
          const signer = privateKeyToAccount(wallet.secret.privateKey);
          if (!same(signer.address, op.sourceAccount)) corrupt("local_signer_owner");
          const d = op.nativeQuote!.deposit;
          authority!.assert();
          raw = await signer.signTransaction({ type: "eip1559", chainId: op.sourceChainId, to: d.to as Hex, data: d.data as Hex,
            value: BigInt(d.value), gas: BigInt(d.gas), nonce: Number(nonce), maxFeePerGas: BigInt(d.maxFeePerGas),
            maxPriorityFeePerGas: BigInt(d.maxPriorityFeePerGas), accessList: [] });
        } finally { this.wallets.clear(wallet.secret); }
        const hash = await verifySigned(op, raw, nonce);
        await vault.slot(op, { raw, hash }); signedNonce = nonce;
      }
      if (j.phase === "signing_started") {
        if (op.sourceChainId === 8453 && (await this.usage.load(identity, reservationId))?.state === "reserved")
          await this.usage.transition({ ...identity, reservationId, policyDigest: op.policyDigest!, state: "unknown_finality", now: this.clock.now() });
        const signed = await vault.slot(op);
        if (signed === null) {
          if (op.sourceChainId === 8453) return j; // Missing signed material is observe-only on Base sources (permanent signing claim).
          j = await vault.closeUnsignedAttempt(op, j, this.journals, this.clock.now());
          await this.settleUsage(op, j);
          return j;
        }
        j = await this.journals.advance(op, j.integrityHash, "sealed", signed.hash, this.clock.now());
      }
      if (j.phase === "sealed") {
        authority ??= new RelayNativeAuthority(op, await this.admission(op, profile, this.clock.now()), this.clock, signal);
        const nonce = signedNonce ?? await this.funding(op, rpc);
        const signed = await vault.slot(op);
        if (signed === null || signed.hash !== j.transactionHash) corrupt("sealed custody missing");
        await verifySigned(op, signed.raw, nonce);
        authority!.assert(await this.admission(op, profile, this.clock.now()));
        j = await dispatchRelayNativeDepositOnce(op, j, this.journals,
          raw => { authority!.assert(); return rpc.submitRawTransaction(raw, () => authority!.assert()); }, signed.raw, this.clock.now());
      }
      if (j.phase === "submitting") {
        const outcome = await this.observe(op, rpc, j.transactionHash as Hex);
        if (outcome === null) return j;
        j = await this.journals.advance(op, j.integrityHash, outcome, null, this.clock.now());
        await this.settleUsage(op, j);
      }
      return j;
    } finally { authority?.dispose(); }
  }
  private async settleUsage(op: RelayUnsignedOperation, j: RelayNativeSourceJournal): Promise<void> {
    if (j.phase !== "confirmed" && j.phase !== "failed" && j.phase !== "failed_before_effect" && j.phase !== "abandoned_unsent") return;
    const identity = this.usageIdentity(op);
    const reservationId = assetUsageReservationId(identity, `relay-native-execute:${op.operationId}`);
    const current = await this.usage.load(identity, reservationId);
    if (current === null) corrupt("usage reservation missing");
    // Never-landing bytes moved nothing: a still-reserved hold closes as no effect; a Base hold already counted at signing is released.
    const target = j.phase === "confirmed" ? "finalized" : j.phase === "failed_before_effect" ? "failed_before_effect" :
      j.phase === "abandoned_unsent" ? (current.state === "reserved" ? "failed_before_effect" : "released_unsubmitted") : "failed_confirmed_revert";
    if (current.state === target) return;
    if (target === "failed_confirmed_revert" && current.state === "reserved")
      await this.usage.transition({ ...identity, reservationId, policyDigest: op.policyDigest!,
        state: "submitted", expectedCurrentStates: ["reserved"], now: this.clock.now() });
    await this.usage.transition({ ...identity, reservationId, policyDigest: op.policyDigest!,
      state: target, now: this.clock.now(), outcomeDigest: j.integrityHash });
  }
  private async unsentOutcome(rpc: Rpc, op: RelayUnsignedOperation, saved: { raw: Hex; hash: Hex }) {
    const [count, own] = await rpc.batchCall([{ method: "eth_getTransactionCount", params: [op.sourceAccount, "safe"] },
      { method: "eth_getTransactionByHash", params: [saved.hash] }]);
    return evmUnsentOutcome(async method => method === "eth_getTransactionCount" ? count : own,
      { account: op.sourceAccount, nonce: relaySignedNonce(saved.raw), transactionHash: saved.hash });
  }
}

export function createRelayNativeSourceRuntime(state: StateStore, wrapping: WrappingSecretPort, rpcUrl: string,
  confirm: RelayNativeSourcePorts["confirm"], clock?: ClockPort, transport?: Rpc): RelayNativeSourceRuntime {
  let url: URL;
  try { url = new URL(rpcUrl); } catch { throw new ApnError("APN_RPC_CONFIG", "Relay native source requires a HTTPS RPC origin."); }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search !== "" || url.hash !== "" ||
    url.username !== "" || url.password !== "") throw new ApnError("APN_RPC_CONFIG", "Relay native source requires a keyless HTTPS RPC origin.");
  return new RelayNativeSourceRuntime(state, wrapping, { confirm, rpc: transport ?? new HttpsBaseRpc(rpcUrl) }, clock, url.origin);
}
