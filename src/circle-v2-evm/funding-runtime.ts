import { AsyncLocalStorage } from "node:async_hooks";
import { types } from "node:util";
import { verifyCircleFinalizedRevert } from "./revert-proof.js";
import { readCircleMintFeeRecipient } from "./mint-fee-recipient.js";
import { getAddress, keccak256, type Hex } from "viem";
import { approvalCode } from "../approval-code.js";
import { canonicalJson, hashObject } from "../canonical.js";
import { assertExclusiveEvmRawSigner, evmAddressLock } from "../evm-address-ownership.js";
import { assertEvmNativeCustody, evmNativeCustody } from "../evm-native-custody.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { OperationService } from "../operation-service.js";
import { BridgeHttps } from "../lifi/https.js";
import type { StateStore } from "../state.js";
import { exactChainConsent } from "../tty-approval.js";
import { canonicalProfile } from "../wallet-policy.js";
import { ApnError } from "../errors.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute, type CircleDestinationChain } from "./catalog.js";
import { circleHex, circleRecord, circleUint, bindCircleAttestation, decodeCircleSource, decodeCircleDestination, encodeCircleApproval, encodeCircleBurn, encodeCircleMint,
  verifyCircleApproval, verifyCircleAttestationSigners, circleAttesterConfigurationHash, type CircleAttestation } from "./protocol.js";
import { verifyCircleDestinationAccount, verifyCircleGasEnvelope, verifyCircleMintPreflight, verifyCircleClosureFinality } from "./preflight.js";
import { CircleRepository } from "./repository.js";
import { CircleUsage } from "./usage.js";
import { LocalCircleFundingCustody } from "./funding-custody.js";
import { CircleRpc, currentCircleDeployments, readCircleAttesters, circleRpcTransaction } from "./rpc.js";
import { circleBlocked, circleCorrupt, type CircleEffect } from "./operation-model.js";
import { approveCircleFundingSource, approveCircleFundingMint, observeCircleFunding, refreshCircleFundingAttestation, cleanupCircleFunding, snapshotCircleFundingOperation, snapshotCircleFundingEffect, type CircleFundingLifecyclePorts } from "./funding-lifecycle.js";
import { circleFundingBinding, quoteCircleFundingFee, assertCircleFundingFee, type CircleFundingParameters } from "./funding-binding.js";
import { advanceCircleFundingOperation as advanceCircle, sealCircleFundingOperation as sealCircle, validateCircleFundingOperation as validateCircle, circleFundingFingerprint, publicCircleFundingOperation as publicCircle, type CircleFundingOperationV2 } from "./funding-operation.js";
interface FundingRuntimeScope { readonly state: StateStore; readonly fingerprint: string; readonly now: () => number; readonly grants: Map<string, { readonly deadline: number; readonly envelopes: ReadonlyMap<string, string> }>; active: boolean; }
const fundingRuntimeScope = new AsyncLocalStorage<FundingRuntimeScope>();
/** Assertion only: authority is issued privately after production foreground consent inside the locked service. */
export function assertCircleFundingRuntimeAuthority(state: StateStore, input: CircleFundingOperationV2, effectInput: CircleEffect): void {
  const op = snapshotCircleFundingOperation(input), effect = snapshotCircleFundingEffect(op, effectInput); const scope = fundingRuntimeScope.getStore(), grant = scope?.grants.get(effect.role);
  if (scope === undefined || !scope.active || scope.state !== state || scope.fingerprint !== op.fingerprint || grant === undefined || scope.now() >= grant.deadline || Date.now() >= grant.deadline || grant.envelopes.get(effect.role) !== hashObject(effect.envelope)) circleBlocked("private_funding_runtime_authority_required");
}
export interface CircleFundingApprovalOptions { readonly deadlineMs?: number; readonly signal?: AbortSignal; }
function fundingApprovalOptions(value: CircleFundingApprovalOptions): CircleFundingApprovalOptions {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) circleBlocked("funding_tty_options");
  const descriptors = Object.getOwnPropertyDescriptors(value), result: { deadlineMs?: number; signal?: AbortSignal } = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !["deadlineMs", "signal"].includes(key)) circleBlocked("funding_tty_options");
    const d = descriptors[key]!; if (!("value" in d) || !d.enumerable) circleBlocked("funding_tty_options");
    if (key === "deadlineMs") { if (!Number.isSafeInteger(d.value) || d.value < 15_000 || d.value > 300_000) circleBlocked("funding_tty_options"); result.deadlineMs = d.value as number; }
    else { const signal: unknown = d.value; if (signal === null || typeof signal !== "object" || types.isProxy(signal)) circleBlocked("funding_tty_options");
      try { Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!.call(signal); } catch { circleBlocked("funding_tty_options"); }
      result.signal = signal as AbortSignal; }
  }
  return Object.freeze(result);
}
export interface CircleFundingPrepareInput { readonly profile: string; readonly destinationProfile: string; readonly destinationChain: CircleDestinationChain; readonly idempotencyKey: string; readonly funding: CircleFundingParameters; }
export class CircleFundingEvmService {
  private readonly ttyOptions: CircleFundingApprovalOptions; private readonly repo: CircleRepository; private readonly usage: CircleUsage; private readonly custody: LocalCircleFundingCustody; private readonly operations: OperationService;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly env: Readonly<Record<string, string | undefined>>, private readonly now: () => number = Date.now, ttyOptions: CircleFundingApprovalOptions = {}, private readonly https: Pick<BridgeHttps, "request"> = new BridgeHttps()) { this.ttyOptions = fundingApprovalOptions(ttyOptions); this.repo = new CircleRepository(state.root); this.usage = new CircleUsage(state, now); this.custody = new LocalCircleFundingCustody(state, wrapping); this.operations = new OperationService(state); }
  async prepare(input: CircleFundingPrepareInput): Promise<CircleFundingOperationV2> {
    const profile = canonicalProfile(input.profile), destinationProfile = canonicalProfile(input.destinationProfile), route = circleRoute(input.destinationChain, destinationProfile);
    if (profile !== "evm-live-buyer" || destinationProfile !== route.gasPayerProfile || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.idempotencyKey)) circleBlocked("finite_route_profile_or_idempotency");
    const funding = circleFundingBinding(input.destinationChain, destinationProfile, input.funding);
    await this.state.initialize(); const [sourceCustody, destinationCustody] = await Promise.all([evmNativeCustody(this.state, profile), evmNativeCustody(this.state, destinationProfile)]);
    if (sourceCustody.walletAddress !== CIRCLE_SOURCE_OWNER || destinationCustody.walletAddress !== route.gasPayer) circleBlocked("finite_route_owner");
    const operationId = this.state.operationId(profile, input.idempotencyKey), idempotencyHash = this.state.idempotencyHash(input.idempotencyKey), requestHash = hashObject({ ...input, profile, destinationProfile });
    const keys = [`profile:${sourceCustody.profileHash}`, `profile:${destinationCustody.profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`, evmAddressLock(sourceCustody.walletAddress), evmAddressLock(destinationCustody.walletAddress)];
    return this.state.withLocks(keys, async () => this.usage.withPolicyLocks([profile, destinationProfile], async () => {
      const replay = await this.operations.resolvePrepare({ kind: "circle_route", profileHash: sourceCustody.profileHash, operationId, idempotencyHash, requestHash });
      if (replay !== null) { if (replay.kind !== "circle_route" || replay.record.schemaVersion !== "apn.circle-v2-evm-operation.v2") circleCorrupt("replay_kind"); return replay.record; }
      try { await this.operations.required(operationId); circleBlocked("operation_identity_occupied"); } catch (e) { if (!(e instanceof ApnError) || e.code !== "APN_OPERATION_NOT_FOUND") throw e; }
      await assertExclusiveEvmRawSigner(this.state, sourceCustody.walletAddress, sourceCustody.profileHash);
      await assertExclusiveEvmRawSigner(this.state, destinationCustody.walletAddress, destinationCustody.profileHash);
      const { source, destination } = this.remotes(route.chainId), deployments = await currentCircleDeployments(source, destination, route.chainId), fee = await this.fee(funding);
      assertCircleFundingFee(funding, fee, this.now());
      await this.assertPriorSourcesCanonical(source);
      const sourceAccount = await source.account(sourceCustody.walletAddress, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER), src = this.sourceAccount(sourceAccount, funding.amountAtomic);
      // This lane starts at zero allowance. Pre-existing grants require normal cleanup before preparing.
      if (!src.approvalRequired) circleBlocked("initial_zero_allowance_required");
      const dst = verifyCircleDestinationAccount(await destination.account(destinationCustody.walletAddress, route.token, CIRCLE_TRANSMITTER), route.chainId, destinationProfile);
      void dst;
      const approvalEnvelope = await source.envelope(sourceCustody.walletAddress, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(false, funding), src.nonceAtomic);
      const burnEnvelope = await source.envelope(sourceCustody.walletAddress, CIRCLE_MESSENGER, encodeCircleBurn(route.chainId, funding), (BigInt(src.nonceAtomic) + 1n).toString(), "600000");
      verifyCircleGasEnvelope(approvalEnvelope, 42161); verifyCircleGasEnvelope(burnEnvelope, 42161);
      if (BigInt(sourceAccount.nativeBalanceAtomic) < 75_000_000_000_000n) circleBlocked("source_native_total_balance");
      const preparedAt = new Date(this.now()).toISOString(), expiresAt = new Date(this.now() + 15 * 60_000).toISOString(), fingerprint = "0".repeat(64);
      let op = sealCircle({ schemaVersion: "apn.circle-v2-evm-operation.v2", funding, feeQuote: fee, operationId, profile, profileHash: sourceCustody.profileHash, destinationProfile, destinationProfileHash: destinationCustody.profileHash,
        idempotencyHash, requestHash, fingerprint, destinationChain: route.chainId, sourceCustody, destinationCustody, policies: [], preparedAt, expiresAt, deploymentDigest: deployments.digest, feeQuoteAtomic: fee.quotedFeeAtomic,
        state: "awaiting_source", terminal: false, effects: [{ role: "approval", phase: "prepared", envelope: approvalEnvelope, transactionHash: null, materialHash: null, proof: null },
          { role: "burn", phase: "prepared", envelope: burnEnvelope, transactionHash: null, materialHash: null, proof: null }], source: null, attestation: null, destination: null,
        residualAllowanceAtomic: "0", usage: [], usageFinalized: false, transitions: [] });
      op = sealCircle({ ...op, policies: await this.usage.policies(op) }); op = sealCircle({ ...op, fingerprint: circleFundingFingerprint(op) });
      const initial = advanceCircle(op, {}, "exact_finite_route_prepared", this.now()); await this.operations.assertCircleAccountsAvailable(initial); await this.repo.saveFunding(initial);
      const usage = await this.usage.reserve(initial), reserved = advanceCircle(initial, { usage }, "all_assets_reserved", this.now()); await this.repo.saveFunding(reserved); return reserved;
    }));
  }
  async status(id: string) { return publicCircle(await this.required(id)); }
  async approveSource(id: string) { return this.run(id, approveCircleFundingSource); }
  async approveMint(id: string) { return this.run(id, approveCircleFundingMint); }
  async observe(id: string) { return this.run(id, observeCircleFunding); }
  async refreshAttestation(id: string) { return this.run(id, refreshCircleFundingAttestation); }
  async cleanup(id: string) { return this.run(id, cleanupCircleFunding); }
  private async required(id: string) { const op = await this.repo.loadAny(id); if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Circle EVM operation was not found."); if (op.schemaVersion !== "apn.circle-v2-evm-operation.v2") circleBlocked("funding_operation_schema_required"); return snapshotCircleFundingOperation(op); }
  private async run(id: string, action: (op: CircleFundingOperationV2, ports: CircleFundingLifecyclePorts) => Promise<CircleFundingOperationV2>) {
    const initial = await this.required(id); await this.state.initialize();
    return this.state.withLocks([`profile:${initial.profileHash}`, `profile:${initial.destinationProfileHash}`, `operation:${initial.operationId}`, `operation:idempotency:${initial.idempotencyHash}`,
      evmAddressLock(initial.sourceCustody.walletAddress), evmAddressLock(initial.destinationCustody.walletAddress)], async () => this.usage.withPolicyLocks([initial.profile, initial.destinationProfile], async () => {
      let op = await this.required(id);
      if (action !== cleanupCircleFunding && op.usage.length === 0 && op.effects.every(e => e.phase === "prepared")) { op = advanceCircle(op, { usage: await this.usage.reserve(op) }, "interrupted_prepare_reserves_repaired", this.now()); await this.repo.saveFunding(op); }
      const scope: FundingRuntimeScope = { state: this.state, fingerprint: op.fingerprint, now: this.now, grants: new Map(), active: true };
      return fundingRuntimeScope.run(scope, async () => { try { return await action(op, this.ports(op)); } finally { scope.active = false; scope.grants.clear(); } });
    }));
  }
  private async assertPriorSourcesCanonical(source: CircleRpc, exceptOperationId?: string): Promise<void> {
    for (const old of await this.repo.listAllAny()) {
      if (old.operationId === exceptOperationId || old.source === null || old.terminal) continue;
      const observation = await source.observation(old.source.transactionHash, "included");
      if (observation === null) circleBlocked("prior_circle_source_not_canonical");
      assertObservedEnvelope(old.effects.find(e => e.role === "burn")!, observation.transaction);
      const proof = decodeCircleSource(observation, old.destinationChain, old.schemaVersion === "apn.circle-v2-evm-operation.v2" ? old.funding : undefined);
      if (proof.blockHash !== old.source.blockHash || proof.receiptHash !== old.source.receiptHash || proof.sourceMessageHash !== old.source.sourceMessageHash ||
        circleUint(await source.call("eth_getTransactionCount", [old.sourceCustody.walletAddress, "latest"])) <= BigInt(old.effects.find(e => e.role === "burn")!.envelope.nonceAtomic)) circleBlocked("prior_circle_source_reorg_or_nonce_not_advanced");
    }
  }
  private preflightDeployments(source: CircleRpc, destination: CircleRpc, chain: CircleDestinationChain) { return currentCircleDeployments(source, destination, chain); }
  private preflightAttesters(destination: CircleRpc, digest: string) { return readCircleAttesters(destination, digest); }
  private remotes(chain: CircleDestinationChain) {
    const route = circleRoute(chain), sourceUrl = this.env.APN_ARBITRUM_RPC_URL ?? "https://arbitrum-one-rpc.publicnode.com", destinationUrl = this.env[route.rpcEnvironment] ?? route.rpcDefault;
    return { source: new CircleRpc(sourceUrl, 42161, this.https, 256, this.env.APN_ARBITRUM_ARCHIVE_MIN_INTERVAL_MS ?? "0"), destination: new CircleRpc(destinationUrl, chain, this.https, 256, this.env.APN_ARBITRUM_ARCHIVE_MIN_INTERVAL_MS ?? "0") };
  }
  private async api(path: string) {
    const response = await this.https.request(`https://iris-api.circle.com${path}`, "GET", null, 1024 * 1024, "APN_HTTP_CONFIG");
    if (response.status !== 200) throw new ApnError("APN_HTTP_CONFIG", "Circle issuer API response is unavailable."); return JSON.parse(response.body) as unknown;
  }
  private async fee(funding: CircleFundingOperationV2["funding"]) { const value = await this.api(`/v2/burn/USDC/fees/3/${funding.destinationDomain}`); return quoteCircleFundingFee(funding, value, this.now(), this.now()); }
  private sourceAccount(a: import("./preflight.js").CircleAccountPreflight, amount: string) { if (a.chainId !== 42161 || a.address !== CIRCLE_SOURCE_OWNER || circleUint(a.usdcBalanceAtomic) < BigInt(amount) || circleUint(a.nativeBalanceAtomic) < 75_000_000_000_000n || circleUint(a.allowanceAtomic) !== 0n || circleUint(a.latestNonceAtomic) !== circleUint(a.pendingNonceAtomic)) circleBlocked("funding_source_account"); return { approvalRequired: true, nonceAtomic: circleUint(a.latestNonceAtomic).toString() }; }
  private ports(initial: CircleFundingOperationV2): CircleFundingLifecyclePorts {
    const { source, destination } = this.remotes(initial.destinationChain), route = circleRoute(initial.destinationChain, initial.destinationProfile);
    const rpc = (e: CircleEffect) => e.role === "mint" ? destination : source;
    const allowance = async (tag = "latest") => String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag));
    const deployments = () => this.preflightDeployments(source, destination, initial.destinationChain);
    return { now: this.now, save: op => this.repo.saveFunding(op), authorizationDeadline: op => this.usage.authorizationDeadline(op),
      assertOwnerPolicyAndConflicts: async (op, role) => { await assertEvmNativeCustody(this.state, op.profile, op.sourceCustody); await assertEvmNativeCustody(this.state, op.destinationProfile, op.destinationCustody); await assertExclusiveEvmRawSigner(this.state, op.sourceCustody.walletAddress, op.profileHash); await assertExclusiveEvmRawSigner(this.state, op.destinationCustody.walletAddress, op.destinationProfileHash); await this.operations.assertCircleAccountsAvailable(op, true, role); await this.usage.confirm(op); },
      approve: async (input, role, deadline) => {
        const op = snapshotCircleFundingOperation(input);
        const scope = fundingRuntimeScope.getStore();
        if (scope === undefined || !scope.active || scope.state !== this.state || scope.fingerprint !== op.fingerprint) circleBlocked("private_funding_runtime_scope_required");
        const end = Date.parse(deadline); if (!Number.isFinite(end) || end > this.now() + 60_000 || end > Date.now() + 60_000) circleBlocked("funding_authority_deadline");
        await exactChainConsent([`Circle finite funding ${role}`, `Operation: ${op.operationId}`, `Source: ${op.profile} / ${op.sourceCustody.walletAddress} / eip155:42161`, `Destination gas owner: ${op.destinationProfile} / ${op.destinationCustody.walletAddress} / eip155:${op.destinationChain}`, `Beneficiary: ${op.funding.recipient} (not asserted owned by gas profile)`, `Gross USDC: ${op.funding.amountAtomic}; maximum issuer fee: ${op.funding.maxFeeAtomic}; minimum net mint: ${op.funding.minMintAtomic}`, `Source full native capacity 75000000000000; destination cap ${route.destinationNativeCap}`, `Policies: ${canonicalJson(op.policies)}`, `Effects: ${canonicalJson(op.effects.filter(e => role === "source" ? ["approval", "burn"].includes(e.role) : e.role === role).map(e => e.envelope))}`, "No ambiguous resubmission; independent canonical finality and zero allowance required."], approvalCode("bridge", op.operationId, op.integrityHash, role), deadline, this.ttyOptions);
        if (this.now() >= end || Date.now() >= end) circleBlocked("funding_authority_expired");
        if (role !== "cancel") for (const e of op.effects.filter(e => role === "source" ? e.role === "approval" || e.role === "burn" : e.role === role)) {
          if (scope.grants.has(e.role)) circleBlocked("funding_authority_reissue");
          scope.grants.set(e.role, { deadline: end, envelopes: new Map([[e.role, hashObject(e.envelope)]]) });
        }
      },
      preflight: async (input, effectInput) => {
        const op = snapshotCircleFundingOperation(input), effect = snapshotCircleFundingEffect(op, effectInput);
        const freshDeployments = await deployments(); if (effect.role !== "mint") await this.assertPriorSourcesCanonical(source, op.operationId);
        const remote = rpc(effect), e = effect.envelope; verifyCircleGasEnvelope(e, e.chainId as 42161 | CircleDestinationChain); await remote.identity();
        const [latest, pending, balance] = await Promise.all([remote.call("eth_getTransactionCount", [e.from, "latest"]), remote.call("eth_getTransactionCount", [e.from, "pending"]), remote.call("eth_getBalance", [e.from, "pending"])]);
        if (circleUint(latest).toString() !== e.nonceAtomic || circleUint(pending).toString() !== e.nonceAtomic || circleUint(balance) < BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic)) circleBlocked("nonce_or_native_balance_changed");
        const remainingNative = effect.role === "mint" ? BigInt(route.destinationNativeCap) : effect.role === "approval" ? 75_000_000_000_000n : effect.role === "burn" ? 45_000_000_000_000n : 15_000_000_000_000n;
        if (circleUint(balance) < remainingNative) circleBlocked("funding_remaining_native_capacity");
        if (effect.role === "approval" && await allowance() !== "0" || effect.role === "burn" && await allowance() !== op.funding.amountAtomic) circleBlocked("exact_source_allowance_changed");
        if (effect.role === "approval" || effect.role === "burn") { assertCircleFundingFee(op.funding, await this.fee(op.funding), this.now()); if (circleUint(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], "pending")) < BigInt(op.funding.amountAtomic)) circleBlocked("funding_source_principal_changed"); }
        const transaction = circleRpcTransaction(e), estimate = circleUint(await remote.call("eth_estimateGas", [transaction])); if (estimate > BigInt(e.gasLimitAtomic)) circleBlocked("simulation_exceeds_gas_ceiling"); const simulated = circleHex(await remote.call("eth_call", [transaction, "pending"]));
        if (effect.role === "mint") { if (op.source === null || op.attestation === null) circleCorrupt("mint_without_source"); const observation = await source.observation(op.source.transactionHash, op.source.finalityTag === "finalized" ? "finalized" : "included"); if (observation === null) circleBlocked("source_reorg_before_mint"); assertObservedEnvelope(op.effects[1]!, observation.transaction); const proof = decodeCircleSource(observation, op.destinationChain, op.funding); if (proof.blockHash !== op.source.blockHash || proof.receiptHash !== op.source.receiptHash || proof.sourceMessageHash !== op.source.sourceMessageHash || await allowance() !== "0") circleBlocked("source_reorg_before_mint"); const snapshot = await this.preflightAttesters(destination, freshDeployments.digest); await verifyCircleAttestationSigners(op.attestation, op.attestation.attestation, snapshot, op.funding); const block = await destination.block("latest"), used = String(await destination.read(CIRCLE_TRANSMITTER, "usedNonces", [op.attestation.nonce], String(block.number))); verifyCircleMintPreflight(op.source, op.attestation, { destinationBlockAtomic: circleUint(block.number).toString(), usedNonceAtomic: used, attesterConfigurationHash: circleAttesterConfigurationHash(snapshot), transactionSimulationResult: simulated }, op.funding); }
      }, seal: (op, e, guard) => this.custody.seal(op, e, guard), loadMaterial: (op, e) => this.custody.load(op, e),
      broadcast: async (e, raw, guard) => { guard(); const current = await this.required(initial.operationId); const effect = snapshotCircleFundingEffect(current, e); await this.custody.claimSend(current, effect, guard); guard(); if (keccak256(raw) !== e.transactionHash) circleBlocked("sealed_broadcast_hash_changed"); const returned = circleHex(await rpc(e).call("eth_sendRawTransaction", [raw], guard), 32); if (returned !== keccak256(raw)) circleBlocked("broadcast_hash_changed"); return returned; },
      observeEffect: async (op, effect) => {
        if (effect.transactionHash === null) return null;
        const tag = effect.role === "mint" ? "safe" : effect.role === "cleanup" ? "finalized" : "included", observation = await rpc(effect).observation(effect.transactionHash, tag); if (observation === null) return null;
        assertObservedEnvelope(effect, observation.transaction);
        if (circleUint(circleRecord(observation.receipt).status) === 0n && effect.role !== "mint") {
          const finalized = tag === "finalized" ? observation : await source.observation(effect.transactionHash, "finalized");
          if (finalized === null) return null;
          assertObservedEnvelope(effect, finalized.transaction); return verifyCircleFinalizedRevert(effect, finalized);
        }
        if (effect.role === "approval" || effect.role === "cleanup") return verifyCircleApproval(observation, effect.role === "cleanup", await allowance(String(circleRecord(observation.receipt).blockNumber)), op.funding);
        if (effect.role === "burn") return decodeCircleSource(observation, op.destinationChain, op.funding);
        if (op.source === null || op.attestation === null) circleCorrupt("mint_proof_without_source");
        return decodeCircleDestination(op.source, op.attestation, observation, String(await destination.read(CIRCLE_TRANSMITTER, "usedNonces", [op.attestation.nonce], String(circleRecord(observation.receipt).blockNumber))), op.destinationProfile, BigInt(op.attestation.feeExecutedAtomic) === 0n ? undefined : await readCircleMintFeeRecipient(destination, observation), op.funding);
      },
      observeSource: async (op, finalized) => {
        const hash = op.effects.find(e => e.role === "burn")!.transactionHash; if (hash === null) return null;
        const observation = await source.observation(hash, finalized ? "finalized" : "included"); if (observation === null) return null;
        assertObservedEnvelope(op.effects.find(e => e.role === "burn")!, observation.transaction);
        const proof = decodeCircleSource(observation, op.destinationChain, op.funding); if (finalized && op.source !== null) verifyCircleClosureFinality(op.source, proof, op.funding); return op.source?.finalityTag === "finalized" ? op.source : proof;
      },
      observeDestination: async op => {
        const hash = op.effects.find(e => e.role === "mint")?.transactionHash;
        if (hash === null || hash === undefined || op.source === null || op.attestation === null) return null;
        const observation = await destination.observation(hash, "safe"); if (observation === null) return null;
        assertObservedEnvelope(op.effects.find(e => e.role === "mint")!, observation.transaction);
        const proof = decodeCircleDestination(op.source, op.attestation, observation, String(await destination.read(CIRCLE_TRANSMITTER, "usedNonces", [op.attestation.nonce], String(circleRecord(observation.receipt).blockNumber))), op.destinationProfile, BigInt(op.attestation.feeExecutedAtomic) === 0n ? undefined : await readCircleMintFeeRecipient(destination, observation), op.funding);
        if (op.destination !== null && (proof.blockHash !== op.destination.blockHash || proof.receiptHash !== op.destination.receiptHash || proof.transactionHash !== op.destination.transactionHash)) circleBlocked("destination_reorg_holds_required");
        return op.destination ?? proof;
      }, allowance: async () => allowance(),
      attestation: async op => {
        if (op.source === null) return null; const response = circleRecord(await this.api(`/v2/messages/3?transactionHash=${op.source.transactionHash}`));
        if (!Array.isArray(response.messages) || response.messages.length !== 1 || circleRecord(response.messages[0]).status !== "complete") return null;
        const snapshot = await readCircleAttesters(destination, (await deployments()).digest);
        return bindCircleAttestation(op.source, { ...response, sourceTxHash: op.source.transactionHash }, snapshot, op.funding);
      },
      mintEnvelope: async op => { if (op.attestation === null) circleCorrupt("attestation_missing"); const account = await destination.account(route.gasPayer, route.token, CIRCLE_TRANSMITTER), nonce = verifyCircleDestinationAccount(account, op.destinationChain, op.destinationProfile);
        return destination.envelope(route.gasPayer, CIRCLE_TRANSMITTER, encodeCircleMint(op.attestation), nonce); },
      cleanupEnvelope: async op => { const nonce = circleUint(await source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, "pending"])).toString(); return source.envelope(CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(true, op.funding), nonce); },
      usage: (op, target) => this.usage.follow(op, target),
    };
  }
}
function assertObservedEnvelope(effect: CircleEffect, input: unknown): void {
  const t = circleRecord(input), e = effect.envelope;
  if (circleHex(t.hash, 32) !== effect.transactionHash || circleUint(t.nonce).toString() !== e.nonceAtomic || circleUint(t.gas).toString() !== e.gasLimitAtomic ||
    circleUint(t.maxFeePerGas).toString() !== e.maxFeePerGasAtomic || circleUint(t.maxPriorityFeePerGas).toString() !== e.maxPriorityFeePerGasAtomic ||
    circleHex(t.input) !== e.data || getAddress(String(t.from)) !== e.from || getAddress(String(t.to)) !== e.to || circleUint(t.value) !== 0n || circleUint(t.chainId) !== BigInt(e.chainId)) circleBlocked("receipt_transaction_envelope_changed");
}
