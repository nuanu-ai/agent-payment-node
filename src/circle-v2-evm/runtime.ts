import { reconcileOriginalCleanup85 } from "./cleanup85-public-reconcile.js";
import { CLEANUP85_HASH } from "./cleanup85-recovery-store.js";
import { prepareCleanup85Recovery } from "./cleanup85-recovery-prepare.js";
import { Cleanup85RecoveryRuntime, type Cleanup85RecoveryDependencies } from "./cleanup85-recovery-runtime.js";
import { Cleanup85RecoveryStore } from "./cleanup85-recovery-store.js";
import { CirclePublicFailureStore } from "./public-failure-store.js";
import { consumedBurnEvidence, CONSUMER_HASH, CONSUMER_BLOCK_HASH } from "./consumed-burn-rpc.js";
import { assertConsumedCleanup } from "./consumed-burn-proof.js";
import { approvalReceiptIdentity } from "./burn-retirement-rpc.js";
import { isConsumedBurnRetirement, isSealedBurnRetirement, sealedBurnReplacement, assertSealedBurnReplacement, SEALED_BURN_HASH, SEALED_BURN_MATERIAL, SEALED_BURN_OPERATION } from "./burn-retirement.js";
import { sealedBurnEvidence, assertBurnReplacementAccount } from "./burn-retirement-rpc.js";
import { CircleExternalStore } from "./external-store.js";
import { readCircleMintFeeRecipient } from "./mint-fee-recipient.js";
import { adoptCircleExternalMint } from "./external-adoption.js";
import { CircleRetirementAuthorityStore, assertCircleRetirementWindow, type CircleRetirementAuthority } from "./nonce-retirement-authority.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { assertCircleNonceRetirementCase, retireCircleNonce, type CircleNonceRetirementPorts } from "./nonce-retirement.js";
import { verifyCircleFinalizedRevert } from "./revert-proof.js";
import { getAddress, keccak256, type Hex } from "viem";
import { approvalCode } from "../approval-code.js";
import { canonicalJson, hashObject } from "../canonical.js";
import { assertExclusiveEvmRawSigner, evmAddressLock } from "../evm-address-ownership.js";
import { assertEvmNativeCustody, evmNativeCustody } from "../evm-native-custody.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { OperationService } from "../operation-service.js";
import { BridgeHttps } from "../lifi/https.js";
import type { StateStore } from "../state.js";
import { exactChainConsent, type TtyTransferApprovalOptions } from "../tty-approval.js";
import { canonicalProfile } from "../wallet-policy.js";
import { ApnError } from "../errors.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute, type CircleDestinationChain } from "./catalog.js";
import { circleHex, circleRecord, circleUint, bindCircleAttestation, decodeCircleSource, decodeCircleDestination, encodeCircleApproval, encodeCircleBurn, encodeCircleMint,
  verifyCircleApproval, verifyCircleAttestationSigners, circleAttesterConfigurationHash, type CircleAttestation } from "./protocol.js";
import { quoteCircleFastFee, assertCircleFeeQuote, verifyCircleSourceAccount, verifyCircleDestinationAccount, verifyCircleGasEnvelope, verifyCircleMintPreflight, verifyCircleClosureFinality } from "./preflight.js";
import { CircleRepository } from "./repository.js";
import { CircleUsage } from "./usage.js";
import { LocalCircleCustody } from "./custody.js";
import { CircleRpc, currentCircleDeployments, readCircleAttesters, circleRpcTransaction } from "./rpc.js";
import { advanceCircle, circleBlocked, circleCorrupt, sealCircle, validateCircle, publicCircle, type CircleOperationV1, type CircleEffect } from "./operation-model.js";
import { approveCircleSource, approveCircleMint, observeCircle, refreshCircleAttestation, cleanupCircle, type CircleLifecyclePorts } from "./lifecycle.js";
export interface CirclePrepareInput { readonly profile: string; readonly destinationProfile: string; readonly destinationChain: CircleDestinationChain; readonly idempotencyKey: string; }
/** A separate CCTP rail owns source custody and destination gas custody, never LI.FI source-only effects. */
export class CircleEvmService {
  private readonly repo: CircleRepository; private readonly usage: CircleUsage; private readonly custody: LocalCircleCustody; private readonly operations: OperationService; private readonly retirements: CircleNonceRetirementStore;
  private readonly cleanup85Recovery: Cleanup85RecoveryRuntime;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly env: Readonly<Record<string, string | undefined>>, private readonly now: () => number = Date.now,
    private readonly ttyOptions: TtyTransferApprovalOptions = {}, private readonly https: Pick<BridgeHttps, "request"> = new BridgeHttps(), cleanup85Dependencies?: Cleanup85RecoveryDependencies) {
    this.retirements = new CircleNonceRetirementStore(state.root); this.repo = new CircleRepository(state.root); this.usage = new CircleUsage(state, now); this.custody = new LocalCircleCustody(state, wrapping); this.operations = new OperationService(state);
    this.cleanup85Recovery = new Cleanup85RecoveryRuntime(state, wrapping, env, now, ttyOptions, https, cleanup85Dependencies);
  }
  async prepare(input: CirclePrepareInput): Promise<CircleOperationV1> {
    const profile = canonicalProfile(input.profile), destinationProfile = canonicalProfile(input.destinationProfile), route = circleRoute(input.destinationChain, destinationProfile);
    if (profile !== "evm-live-buyer" || destinationProfile !== route.gasPayerProfile || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(input.idempotencyKey)) circleBlocked("finite_route_profile_or_idempotency");
    await this.state.initialize(); const [sourceCustody, destinationCustody] = await Promise.all([evmNativeCustody(this.state, profile), evmNativeCustody(this.state, destinationProfile)]);
    if (sourceCustody.walletAddress !== CIRCLE_SOURCE_OWNER || destinationCustody.walletAddress !== route.gasPayer) circleBlocked("finite_route_owner");
    const operationId = this.state.operationId(profile, input.idempotencyKey), idempotencyHash = this.state.idempotencyHash(input.idempotencyKey), requestHash = hashObject({ ...input, profile, destinationProfile });
    const keys = [`profile:${sourceCustody.profileHash}`, `profile:${destinationCustody.profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`, evmAddressLock(sourceCustody.walletAddress), evmAddressLock(destinationCustody.walletAddress)];
    return this.state.withLocks(keys, async () => this.usage.withPolicyLocks([profile, destinationProfile], async () => {
      const replay = await this.operations.resolvePrepare({ kind: "circle_route", profileHash: sourceCustody.profileHash, operationId, idempotencyHash, requestHash });
      if (replay !== null) { if (replay.kind !== "circle_route") circleCorrupt("replay_kind"); return replay.record; }
      try { await this.operations.required(operationId); circleBlocked("operation_identity_occupied"); } catch (e) { if (!(e instanceof ApnError) || e.code !== "APN_OPERATION_NOT_FOUND") throw e; }
      await assertExclusiveEvmRawSigner(this.state, sourceCustody.walletAddress, sourceCustody.profileHash);
      await assertExclusiveEvmRawSigner(this.state, destinationCustody.walletAddress, destinationCustody.profileHash);
      const { source, destination } = this.remotes(route.chainId), deployments = await currentCircleDeployments(source, destination, route.chainId), fee = await this.fee(route.chainId);
      assertCircleFeeQuote(fee, route.chainId, this.now());
      await this.assertPriorSourcesCanonical(source);
      const sourceAccount = await source.account(sourceCustody.walletAddress, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER), src = verifyCircleSourceAccount(sourceAccount);
      // This lane starts at zero allowance. Pre-existing grants require normal cleanup before preparing.
      if (!src.approvalRequired) circleBlocked("initial_zero_allowance_required");
      const dst = verifyCircleDestinationAccount(await destination.account(destinationCustody.walletAddress, route.token, CIRCLE_TRANSMITTER), route.chainId, destinationProfile);
      void dst;
      const approvalEnvelope = await source.envelope(sourceCustody.walletAddress, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(), src.nonceAtomic);
      const burnEnvelope = await source.envelope(sourceCustody.walletAddress, CIRCLE_MESSENGER, encodeCircleBurn(route.chainId), (BigInt(src.nonceAtomic) + 1n).toString(), "600000");
      verifyCircleGasEnvelope(approvalEnvelope, 42161); verifyCircleGasEnvelope(burnEnvelope, 42161);
      if (BigInt(sourceAccount.nativeBalanceAtomic) < BigInt(approvalEnvelope.gasLimitAtomic) * BigInt(approvalEnvelope.maxFeePerGasAtomic) + BigInt(burnEnvelope.gasLimitAtomic) * BigInt(burnEnvelope.maxFeePerGasAtomic)) circleBlocked("source_native_total_balance");
      const preparedAt = new Date(this.now()).toISOString(), expiresAt = new Date(this.now() + 15 * 60_000).toISOString(), fingerprint = hashObject({ requestHash, sourceCustody, destinationCustody, deployments: deployments.digest, approvalEnvelope, burnEnvelope, preparedAt, expiresAt });
      let op = sealCircle({ schemaVersion: "apn.circle-v2-evm-operation.v1", operationId, profile, profileHash: sourceCustody.profileHash, destinationProfile, destinationProfileHash: destinationCustody.profileHash,
        idempotencyHash, requestHash, fingerprint, destinationChain: route.chainId, sourceCustody, destinationCustody, policies: [], preparedAt, expiresAt, deploymentDigest: deployments.digest, feeQuoteAtomic: fee.quotedFeeAtomic,
        state: "awaiting_source", terminal: false, effects: [{ role: "approval", phase: "prepared", envelope: approvalEnvelope, transactionHash: null, materialHash: null, proof: null },
          { role: "burn", phase: "prepared", envelope: burnEnvelope, transactionHash: null, materialHash: null, proof: null }], source: null, attestation: null, destination: null,
        residualAllowanceAtomic: "0", usage: [], usageFinalized: false, transitions: [] });
      op = sealCircle({ ...op, policies: await this.usage.policies(op) });
      const initial = advanceCircle(op, {}, "exact_finite_route_prepared", this.now()); await this.operations.assertCircleAccountsAvailable(initial); await this.repo.save(initial);
      const usage = await this.usage.reserve(initial), reserved = advanceCircle(initial, { usage }, "all_assets_reserved", this.now()); await this.repo.save(reserved); return reserved;
    }));
  }
  async status(id: string) { const op = await this.required(id), failure = await new CirclePublicFailureStore(this.state.root).read(op), recovery = await this.cleanup85Recovery.publicStatus(id); return { ...publicCircle(op), ...(failure === null ? {} : { first_public_effect_failure: failure }), ...(recovery === null ? {} : { cleanup85_recovery: recovery }) }; }
  async prepareCleanup85Recovery(id: string) { const { source, destination } = this.remotes(1329); return prepareCleanup85Recovery(this.state, source, destination, id, this.now); }
  async cancelCleanup85(id: string) { return this.cleanup85Recovery.cancel(id); }
  async approveCleanup86(id: string) { return this.cleanup85Recovery.approve86(id); }
  async approveSource(id: string) { return this.run(id, approveCircleSource); }
  async adoptExternalMint(id: string, transactionHash: Hex) { return adoptCircleExternalMint(this.state,this.repo,this.usage,this.env,this.now,this.https,id,transactionHash); }
  async approveMint(id: string) { return this.run(id, approveCircleMint); }
  async observe(id: string) {
    const saved = await this.required(id); if (saved.state === "nonce_retired" && saved.nonceRetirement?.cleanup85Recovery === undefined) return saved;
    if (saved.operationId === SEALED_BURN_OPERATION && await new Cleanup85RecoveryStore(this.state.root).publicRecord(saved, "cleanup86-intent") !== null) return this.cleanup85Recovery.observe(id);
    return this.run(id, async (op, ports) => {
    if (op.effects.find(e => e.role === "cleanup")?.transactionHash === CLEANUP85_HASH) { const { source, destination } = this.remotes(op.destinationChain); return reconcileOriginalCleanup85(this.state, this.repo, this.usage, source, destination, op, this.now); }
    return await this.retirements.intent(op) === null ? observeCircle(op, ports) : retireCircleNonce(op, ports as CircleNonceRetirementPorts, false);
  }); }
  async refreshAttestation(id: string) { return this.run(id, refreshCircleAttestation); }
  async cleanupNonce(id: string) { return this.run(id, async (op, ports) => {
    if (op.state === "nonce_retired") return op;
    assertCircleNonceRetirementCase(op, this.now());
    const authorityStore = new CircleRetirementAuthorityStore(this.state.root);
    if (await authorityStore.load(op) === null) {
      if (await this.retirements.hasClaim(op, "sign") || await this.retirements.hasClaim(op, "send")) circleBlocked("retirement_claim_without_current_authority");
      await assertEvmNativeCustody(this.state, op.profile, op.sourceCustody); await assertEvmNativeCustody(this.state, op.destinationProfile, op.destinationCustody);
      await this.custody.assertRetirementHeaders(op);
      await assertExclusiveEvmRawSigner(this.state, op.sourceCustody.walletAddress, op.profileHash); await assertExclusiveEvmRawSigner(this.state, op.destinationCustody.walletAddress, op.destinationProfileHash);
      await this.operations.assertCircleAccountsAvailable(op, true, "cleanup");
      const policies = await this.usage.retirementPolicies(op); await this.usage.confirm(op, policies);
      await authorityStore.capture(op, policies, await this.usage.authorizationDeadline(op, policies), this.now());
    }
    return retireCircleNonce(op, ports as CircleNonceRetirementPorts);
  }, true); }
  async cleanup(id: string) { return this.run(id, async (op, ports) => { if (await this.retirements.intent(op) !== null) circleBlocked("explicit_nonce_retirement_cleanup_required"); return cleanupCircle(op, ports); }); }
  private async required(id: string) { const op = await this.repo.load(id); if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Circle EVM operation was not found."); return op; }
  private async run(id: string, action: (op: CircleOperationV1, ports: CircleLifecyclePorts) => Promise<CircleOperationV1>, retirementOnly = false) {
    const initial = await this.required(id); await this.state.initialize();
    return this.state.withLocks([`profile:${initial.profileHash}`, `profile:${initial.destinationProfileHash}`, `operation:${initial.operationId}`, `operation:idempotency:${initial.idempotencyHash}`,
      evmAddressLock(initial.sourceCustody.walletAddress), evmAddressLock(initial.destinationCustody.walletAddress)], async () => this.usage.withPolicyLocks([initial.profile, initial.destinationProfile], async () => {
      let op = await this.required(id);
      if(action === approveCircleMint && op.destinationChain === 143)await new CircleExternalStore(this.state.root).assertOwnedMintAvailable(op);
      if (action !== cleanupCircle && op.usage.length === 0 && op.effects.every(e => e.phase === "prepared")) { op = advanceCircle(op, { usage: await this.usage.reserve(op) }, "interrupted_prepare_reserves_repaired", this.now()); await this.repo.save(op); }
      return action(op, this.ports(op, retirementOnly));
    }));
  }
  private async assertPriorSourcesCanonical(source: CircleRpc, exceptOperationId?: string): Promise<void> {
    for (const old of await this.repo.listAllOperations()) {
      if (old.operationId === exceptOperationId || old.source === null || old.terminal) continue;
      const observation = await source.observation(old.source.transactionHash, "included");
      if (observation === null) circleBlocked("prior_circle_source_not_canonical");
      assertObservedEnvelope(old.effects.find(e => e.role === "burn")!, observation.transaction);
      const proof = decodeCircleSource(observation, old.destinationChain);
      if (proof.blockHash !== old.source.blockHash || proof.receiptHash !== old.source.receiptHash || proof.sourceMessageHash !== old.source.sourceMessageHash ||
        circleUint(await source.call("eth_getTransactionCount", [old.sourceCustody.walletAddress, "latest"])) <= BigInt(old.effects.find(e => e.role === "burn")!.envelope.nonceAtomic)) circleBlocked("prior_circle_source_reorg_or_nonce_not_advanced");
    }
  }
  private preflightDeployments(source: CircleRpc, destination: CircleRpc, chain: CircleDestinationChain) { return currentCircleDeployments(source, destination, chain); }
  private preflightAttesters(destination: CircleRpc, digest: string) { return readCircleAttesters(destination, digest); }
  private remotes(chain: CircleDestinationChain) {
    const route = circleRoute(chain), sourceUrl = this.env.APN_ARBITRUM_RPC_URL ?? "https://arbitrum-one-rpc.publicnode.com", destinationUrl = this.env[route.rpcEnvironment] ?? route.rpcDefault;
    return { source: new CircleRpc(sourceUrl, 42161, this.https), destination: new CircleRpc(destinationUrl, chain, this.https) };
  }
  private async api(path: string) {
    const response = await this.https.request(`https://iris-api.circle.com${path}`, "GET", null, 1024 * 1024, "APN_HTTP_CONFIG");
    if (response.status !== 200) throw new ApnError("APN_HTTP_CONFIG", "Circle issuer API response is unavailable."); return JSON.parse(response.body) as unknown;
  }
  private async fee(chain: CircleDestinationChain) { const value = await this.api(`/v2/burn/USDC/fees/3/${circleRoute(chain).domain}`); return quoteCircleFastFee(chain, value, this.now(), this.now()); }
  private ports(initial: CircleOperationV1, retirementOnly = false): CircleNonceRetirementPorts {
    const { source, destination } = this.remotes(initial.destinationChain), route = circleRoute(initial.destinationChain, initial.destinationProfile);
    const rpc = (e: CircleEffect) => e.role === "mint" ? destination : source;
    const allowance = async (tag = "latest") => String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag));
    const deployments = () => this.preflightDeployments(source, destination, initial.destinationChain);
    let currentAuthority: CircleRetirementAuthority | null = null;
    const authority = async (op: CircleOperationV1) => {
      const retirement = retirementOnly || await this.retirements.intent(op) !== null;
      currentAuthority = retirement ? await new CircleRetirementAuthorityStore(this.state.root).load(op) : null;
      if (retirement && currentAuthority === null) circleBlocked("retirement_current_authority_required"); return currentAuthority;
    };
    return {
      now: this.now, save: op => this.repo.save(op),
      recordEffectFailure: (op, role, error) => new CirclePublicFailureStore(this.state.root).record(op, role, error),
      consentContext: () => currentAuthority?.authorityHash ?? null,
      effectAuthorityGuard: op => { if (currentAuthority !== null) { assertCircleRetirementWindow(currentAuthority, this.now()); if (currentAuthority.operationId !== op.operationId) circleBlocked("retirement_authority_operation_changed"); } },
      authorizationDeadline: async op => { const frame = await authority(op); if (frame !== null) assertCircleRetirementWindow(frame, this.now()); return this.usage.authorizationDeadline(op, frame?.policies ?? op.policies); },
      assertOwnerPolicyAndConflicts: async (op, effectRole) => {
        await assertEvmNativeCustody(this.state, op.profile, op.sourceCustody); await assertEvmNativeCustody(this.state, op.destinationProfile, op.destinationCustody);
        await assertExclusiveEvmRawSigner(this.state, op.sourceCustody.walletAddress, op.profileHash); await assertExclusiveEvmRawSigner(this.state, op.destinationCustody.walletAddress, op.destinationProfileHash);
        await this.operations.assertCircleAccountsAvailable(op, true, effectRole);
        const frame = await authority(op); if (frame !== null) { assertCircleRetirementWindow(frame, this.now()); if (effectRole !== undefined && effectRole !== "cleanup") circleBlocked("retirement_cleanup_authority_only"); }
        await this.usage.confirm(op, frame?.policies ?? op.policies);
      },
      approve: async (op, role, deadline) => role === "cleanup" && await this.retirements.intent(op) !== null ? exactChainConsent([
        isConsumedBurnRetirement(op) ? "Agent Payment Node canonically consumed Circle burn allowance cleanup" : isSealedBurnRetirement(op) ? "Agent Payment Node sealed Circle burn nonce retirement" : "Agent Payment Node expired Circle approval nonce cleanup", `Operation: ${op.operationId}`,
        `Source owner: ${op.profile} / ${op.sourceCustody.walletAddress} / eip155:42161`,
        isConsumedBurnRetirement(op) ? `Original sealed unknown burn84 ${op.effects[1]!.transactionHash} is excluded by finalized native owner transaction ${CONSUMER_HASH}, block513145262/${CONSUMER_BLOCK_HASH}. This fresh cleanup uses nonce85; USDC97924 stays unchanged and allowance40100 becomes0. Historical burn stays unknown; unrelated owner value/fee is not charged here.` : isSealedBurnRetirement(op) ? `Original unknown sealed burn: ${op.effects[1]!.transactionHash}; nonce84. Confirmed approval83 remains historical.` : `Original unknown approval: ${op.effects[0]!.transactionHash}; nonce ${op.effects[0]!.envelope.nonceAtomic}`,
        `One NEW approve-zero transaction: USDC ${CIRCLE_SOURCE_TOKEN}; spender ${CIRCLE_MESSENGER}; ETH value 0.`,
        "Full signed native fee upper at most 15000000000000 wei, charged against the existing cleanup hold. Fresh authority lasts at most 60 seconds and both policy windows.",
        `Frozen cleanup: ${canonicalJson(op.effects.find(e => e.role === "cleanup")!.envelope)}`,
        `Current cleanup owner policies: ${(currentAuthority?.policies ?? op.policies).map(p => `${p.profile}:${p.activationDigest}:${p.revision}`).join(", ")}`,
        "Original approval and burn are permanently disabled. This action retires the source nonce; it does not burn USDC or pay the destination.",
        "Unknown send is observed without resending. Unused holds close only after finalized exact cleanup, consumed nonce and zero allowance proof.",
      ], approvalCode("bridge", op.operationId, hashObject({ integrityHash: op.integrityHash, authorityHash: currentAuthority?.authorityHash ?? null }), "nonce-cleanup"), deadline, this.ttyOptions) : role === "cancel" ? exactChainConsent([
        "Agent Payment Node Circle unsubmitted cancellation", `Operation: ${op.operationId}`,
        `Owners: ${op.profile}/${op.sourceCustody.walletAddress}; ${op.destinationProfile}/${op.destinationCustody.walletAddress}`,
        "Release only verified unspent reservations after zero allowance and absence of private material or transaction markers.",
        `Reservations: ${canonicalJson(op.usage.map(row => ({ reservationId: row.reservationId, account: row.account, chain: row.chain, amountAtomic: row.amountAtomic })))}`,
      ], approvalCode("bridge", op.operationId, op.integrityHash, "cancel"), deadline, this.ttyOptions) : exactChainConsent([
        `Agent Payment Node Circle CCTP V2 Fast ${role} approval`, `Operation: ${op.operationId}`, `Source: ${op.profile} / ${op.sourceCustody.walletAddress} / eip155:42161`,
        `Destination gas owner: ${op.destinationProfile} / ${op.destinationCustody.walletAddress} / eip155:${op.destinationChain}`, `Recipient: 0xf41170df51aab52aaa04fbc3ff325cf051644aca`,
        "Exact burn: 40100 atomic USDC; issuer maximum fee: 100; minimum mint: 40000; minFinalityThreshold: 1000 (FAST)", "Source approval and burn each cost at most 30000000000000 wei ETH; cleanup only if needed costs at most 15000000000000 wei ETH. Total route source capacity: 75000000000000 wei ETH.",
        `Destination mint gas at most 600000 and native debit at most ${route.destinationNativeCap} atomic.`,
        `Policies: ${op.policies.map(p => `${p.profile}:${p.policyDigest}:${p.revision}`).join(", ")}`, `Effects: ${canonicalJson(op.effects.filter(e => role === "source" ? ["approval", "burn"].includes(e.role) : e.role === role).map(e => e.envelope))}`,
        "Every financial boundary is durably fenced. Ambiguous broadcast is observed without resending. Final success requires independent canonical source finality, destination mint and zero allowance.",
      ], approvalCode("bridge", op.operationId, op.integrityHash, role), deadline, this.ttyOptions),
      preflight: async (op, effect) => {
        if (effect.role === "approval" || effect.role === "burn") await this.retirements.assertOriginalEffectsAvailable(op.operationId);
        const freshDeployments = await deployments();
        if (effect.role !== "mint") await this.assertPriorSourcesCanonical(source, op.operationId);
        const remote = rpc(effect), e = effect.envelope; verifyCircleGasEnvelope(e, e.chainId as 42161 | CircleDestinationChain);
        await remote.identity(); const [latest, pending, balance] = await Promise.all([remote.call("eth_getTransactionCount", [e.from, "latest"]), remote.call("eth_getTransactionCount", [e.from, "pending"]), remote.call("eth_getBalance", [e.from, "pending"])]);
        const intent = effect.role === "cleanup" ? await this.retirements.intent(op) : null;
        if (isConsumedBurnRetirement(op) && intent !== null) {
          assertConsumedCleanup(op, e); const evidence = await consumedBurnEvidence(source, op);
          if (approvalReceiptIdentity(evidence.consumerProof) !== approvalReceiptIdentity(intent.consumedBurn!.consumerProof) || approvalReceiptIdentity(evidence.approvalProof) !== approvalReceiptIdentity(intent.consumedBurn!.approvalProof)) circleBlocked("consumed_intent_evidence_changed");
        } else if (isSealedBurnRetirement(op) && intent !== null) {
          await assertBurnReplacementAccount(source, op, String(latest), String(pending)); assertSealedBurnReplacement(op, e);
          const evidence = await sealedBurnEvidence(source, op, allowance);
          if (evidence.usdcBalanceAtomic !== intent.sealedBurn?.usdcBalanceAtomic || await allowance() !== "40100") circleBlocked("retirement_source_principal_or_allowance_changed");
          const head = await source.block("latest"), tip = circleUint(await source.call("eth_maxPriorityFeePerGas", []));
          if (BigInt(e.maxPriorityFeePerGasAtomic) < tip || BigInt(e.maxFeePerGasAtomic) < circleUint(head.baseFeePerGas) * 2n + BigInt(e.maxPriorityFeePerGasAtomic)) circleBlocked("retirement_replacement_network_fee_changed");
        } else if (circleUint(latest).toString() !== e.nonceAtomic || circleUint(pending).toString() !== e.nonceAtomic) circleBlocked("nonce_or_native_balance_changed");
        if (circleUint(balance) < BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic)) circleBlocked("nonce_or_native_balance_changed");
        if (intent !== null && !isSealedBurnRetirement(op) && await allowance() !== "0") circleBlocked("retirement_zero_allowance_changed");
        if (effect.role === "approval" && await allowance() !== "0" || effect.role === "burn" && await allowance() !== "40100") circleBlocked("exact_source_allowance_changed");
        if (effect.role === "approval" || effect.role === "burn") { const quote = await this.fee(op.destinationChain); assertCircleFeeQuote(quote, op.destinationChain, this.now()); }
        const transaction = circleRpcTransaction(e), estimate = circleUint(await remote.call("eth_estimateGas", [transaction])); if (estimate > BigInt(e.gasLimitAtomic)) circleBlocked("simulation_exceeds_gas_ceiling");
        const simulated = circleHex(await remote.call("eth_call", [transaction, "pending"]));
        if (effect.role === "mint") {
          const sourceObservation = await source.observation(op.source!.transactionHash, op.source!.finalityTag === "finalized" ? "finalized" : "included");
          if (sourceObservation === null) circleBlocked("source_reorg_before_mint");
          assertObservedEnvelope(op.effects.find(e => e.role === "burn")!, sourceObservation.transaction);
          if (decodeCircleSource(sourceObservation, op.destinationChain).blockHash !== op.source!.blockHash) circleBlocked("source_reorg_before_mint");
          if (op.source === null || op.attestation === null) circleCorrupt("mint_without_source");
          const snapshot = await this.preflightAttesters(destination, freshDeployments.digest);
          await verifyCircleAttestationSigners(op.attestation, op.attestation.attestation, snapshot);
          const block = await destination.block("latest"), used = String(await destination.read(CIRCLE_TRANSMITTER, "usedNonces", [op.attestation.nonce], String(block.number)));
          verifyCircleMintPreflight(op.source, op.attestation, { destinationBlockAtomic: circleUint(block.number).toString(), usedNonceAtomic: used, attesterConfigurationHash: circleAttesterConfigurationHash(snapshot), transactionSimulationResult: simulated });
        }
      },
      seal: async (op, effect, guard) => {
        if (effect.role === "approval" || effect.role === "burn") await this.retirements.assertOriginalEffectsAvailable(op.operationId);
        else if (effect.role === "cleanup" && await this.retirements.intent(op) !== null) { guard(); await this.custody.assertCleanupAbsent(op); guard(); await this.retirements.claim(op, "sign"); guard(); }
        return this.custody.seal(op, effect, guard);
      }, loadMaterial: (op, effect) => this.custody.load(op, effect),
      broadcast: async (effect, raw, guard) => { guard();
        if (effect.role === "approval" || effect.role === "burn") await this.retirements.assertOriginalEffectsAvailable(initial.operationId);
        else if (effect.role === "cleanup" && await this.retirements.intent(initial) !== null) { const current = await this.required(initial.operationId); guard(); await this.retirements.claim(current, "send"); guard(); }
        guard(); if (keccak256(raw) !== effect.transactionHash) circleBlocked("sealed_broadcast_hash_changed"); const result = circleHex(await rpc(effect).call("eth_sendRawTransaction", [raw], guard), 32); if (result !== keccak256(raw)) circleBlocked("broadcast_hash_changed"); return result; },
      observeEffect: async (op, effect) => {
        if (effect.transactionHash === null) return null;
        const tag = effect.role === "mint" ? "safe" : effect.role === "cleanup" ? "finalized" : "included", observation = await rpc(effect).observation(effect.transactionHash, tag); if (observation === null) return null;
        assertObservedEnvelope(effect, observation.transaction);
        if (circleUint(circleRecord(observation.receipt).status) === 0n && effect.role !== "mint") {
          const finalized = tag === "finalized" ? observation : await source.observation(effect.transactionHash, "finalized");
          if (finalized === null) return null;
          assertObservedEnvelope(effect, finalized.transaction); return verifyCircleFinalizedRevert(effect, finalized);
        }
        if (effect.role === "approval" || effect.role === "cleanup") return verifyCircleApproval(observation, effect.role === "cleanup", await allowance(String(circleRecord(observation.receipt).blockNumber)));
        if (effect.role === "burn") return decodeCircleSource(observation, op.destinationChain);
        if (op.source === null || op.attestation === null) circleCorrupt("mint_proof_without_source");
        return decodeCircleDestination(op.source, op.attestation, observation, String(await destination.read(CIRCLE_TRANSMITTER, "usedNonces", [op.attestation.nonce], String(circleRecord(observation.receipt).blockNumber))), op.destinationProfile, BigInt(op.attestation.feeExecutedAtomic) === 0n ? undefined : await readCircleMintFeeRecipient(destination, observation));
      },
      observeSource: async (op, finalized) => {
        const hash = op.effects.find(e => e.role === "burn")!.transactionHash; if (hash === null) return null;
        const observation = await source.observation(hash, finalized ? "finalized" : "included"); if (observation === null) return null;
        assertObservedEnvelope(op.effects.find(e => e.role === "burn")!, observation.transaction);
        const proof = decodeCircleSource(observation, op.destinationChain); if (finalized && op.source !== null) verifyCircleClosureFinality(op.source, proof); return op.source?.finalityTag === "finalized" ? op.source : proof;
      },
      observeDestination: async op => {
        const hash = op.effects.find(e => e.role === "mint")?.transactionHash;
        if (hash === null || hash === undefined || op.source === null || op.attestation === null) return null;
        const observation = await destination.observation(hash, "safe"); if (observation === null) return null;
        assertObservedEnvelope(op.effects.find(e => e.role === "mint")!, observation.transaction);
        const proof = decodeCircleDestination(op.source, op.attestation, observation, String(await destination.read(CIRCLE_TRANSMITTER, "usedNonces", [op.attestation.nonce], String(circleRecord(observation.receipt).blockNumber))), op.destinationProfile, BigInt(op.attestation.feeExecutedAtomic) === 0n ? undefined : await readCircleMintFeeRecipient(destination, observation));
        if (op.destination !== null && (proof.blockHash !== op.destination.blockHash || proof.receiptHash !== op.destination.receiptHash || proof.transactionHash !== op.destination.transactionHash)) circleBlocked("destination_reorg_holds_required");
        return op.destination ?? proof;
      }, allowance: async () => allowance(),
      attestation: async op => {
        if (op.source === null) return null; const response = circleRecord(await this.api(`/v2/messages/3?transactionHash=${op.source.transactionHash}`));
        if (!Array.isArray(response.messages) || response.messages.length !== 1 || circleRecord(response.messages[0]).status !== "complete") return null;
        const snapshot = await readCircleAttesters(destination, (await deployments()).digest);
        return bindCircleAttestation(op.source, { ...response, sourceTxHash: op.source.transactionHash }, snapshot);
      },
      mintEnvelope: async op => { if (op.attestation === null) circleCorrupt("attestation_missing"); const account = await destination.account(route.gasPayer, route.token, CIRCLE_TRANSMITTER), nonce = verifyCircleDestinationAccount(account, op.destinationChain, op.destinationProfile);
        return destination.envelope(route.gasPayer, CIRCLE_TRANSMITTER, encodeCircleMint(op.attestation), nonce); },
      cleanupEnvelope: async op => { const nonce = circleUint(await source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, "pending"])).toString(); return source.envelope(CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(true), nonce); },
      assertRetirementMaterial: op => this.custody.assertRetirementHeaders(op),
      retirementClaimed: async op => await this.retirements.hasClaim(op, "sign") || await this.retirements.hasClaim(op, "send"),
      prepareRetirement: async op => {
        const existing = await this.retirements.intent(op); if (existing !== null) return existing;
        const account = await source.account(CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER), nonce = isConsumedBurnRetirement(op) ? "85" : op.effects[isSealedBurnRetirement(op) ? 1 : 0]!.envelope.nonceAtomic;
        let evidence, consumedEvidence;
        if (isConsumedBurnRetirement(op)) {
          consumedEvidence = await consumedBurnEvidence(source, op);
          if (account.latestNonceAtomic !== "85" || account.pendingNonceAtomic !== "85" || account.allowanceAtomic !== "40100" || account.usdcBalanceAtomic !== "97924") circleBlocked("consumed_account_changed");
        } else if (isSealedBurnRetirement(op)) {
          await assertBurnReplacementAccount(source, op, account.latestNonceAtomic, account.pendingNonceAtomic);
          if (account.allowanceAtomic !== "40100") circleBlocked("retirement_original_nonce_or_allowance_changed");
          evidence = await sealedBurnEvidence(source, op, allowance);
        } else if (account.latestNonceAtomic !== nonce || account.pendingNonceAtomic !== nonce || account.allowanceAtomic !== "0") circleBlocked("retirement_original_nonce_or_allowance_changed");
        const quote = await source.envelope(CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(true), nonce);
        const envelope = isSealedBurnRetirement(op) && !isConsumedBurnRetirement(op) ? sealedBurnReplacement(op, quote, circleUint(await source.call("eth_maxPriorityFeePerGas", []))) : quote;
        if (isSealedBurnRetirement(op) && BigInt(account.nativeBalanceAtomic) < BigInt(envelope.gasLimitAtomic) * BigInt(envelope.maxFeePerGasAtomic)) circleBlocked("retirement_native_full_upper_balance");
        // Strict cleanup schema includes the FULL signed gas upper <=15T, never only the estimate.
        const effect: CircleEffect = { role: "cleanup", phase: "prepared", envelope, transactionHash: null, materialHash: null, proof: null };
        validateCircle(advanceCircle(op, { effects: [...op.effects, effect], state: "cleanup_required" }, "nonce_retirement_cleanup_frozen", this.now()));
        return this.retirements.start(op, envelope, evidence, consumedEvidence);
      },
      retirementProof: async (op, intent) => {
        await this.retirements.assertClaim(op, "sign"); await this.retirements.assertClaim(op, "send");
        const cleanup = op.effects.find(x => x.role === "cleanup")!;
        if (cleanup.proof?.finalityTag !== "finalized" || cleanup.transactionHash === null || cleanup.envelope.envelopeHash !== intent.cleanupEnvelope.envelopeHash) return null;
        const observation = await source.observation(cleanup.transactionHash, "finalized"); if (observation === null) return null;
        assertObservedEnvelope(cleanup, observation.transaction);
        const receipt = circleRecord(observation.receipt), head = circleRecord(observation.finalityHead), headTag = String(head.number);
        const canonicalProof = verifyCircleApproval(observation, true, await allowance(String(receipt.blockNumber)));
        if (canonicalProof.blockHash !== cleanup.proof.blockHash || canonicalProof.receiptHash !== cleanup.proof.receiptHash) circleBlocked("retirement_cleanup_reorg");
        const [nonce, zeroAllowance] = await Promise.all([source.call("eth_getTransactionCount", [CIRCLE_SOURCE_OWNER, headTag]), allowance(headTag)]);
        if (circleUint(nonce) <= BigInt(intent.cleanupEnvelope.nonceAtomic) || zeroAllowance !== "0" || await allowance() !== "0" || circleHex((await source.block(headTag)).hash, 32) !== circleHex(head.hash, 32)) circleBlocked("retirement_finalized_nonce_or_allowance_changed");
        await this.custody.assertRetirementHeaders(op);
        let sealedBurn, consumedBurn;
        if (isConsumedBurnRetirement(op)) {
          const evidence = await consumedBurnEvidence(source, op, true);
          if (String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], String(receipt.blockNumber))) !== evidence.usdcBalanceAtomic || circleUint(nonce) !== 86n || approvalReceiptIdentity(evidence.consumerProof) !== approvalReceiptIdentity(intent.consumedBurn!.consumerProof) || approvalReceiptIdentity(evidence.approvalProof) !== approvalReceiptIdentity(intent.consumedBurn!.approvalProof)) circleBlocked("consumed_finalized_evidence_changed");
          consumedBurn = { version: "apn.circle-consumed-burn-retirement-proof.v1" as const, originalBurnHash: SEALED_BURN_HASH, originalBurnMaterialHash: SEALED_BURN_MATERIAL, ...evidence };
        } else if (isSealedBurnRetirement(op)) {
          const evidence = await sealedBurnEvidence(source, op, allowance);
          if (circleUint(nonce) !== 85n || evidence.usdcBalanceAtomic !== intent.sealedBurn?.usdcBalanceAtomic || String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], headTag)) !== evidence.usdcBalanceAtomic || String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], String(receipt.blockNumber))) !== evidence.usdcBalanceAtomic || circleHex((await source.block(headTag)).hash, 32) !== circleHex(head.hash, 32)) circleBlocked("retirement_finalized_principal_or_nonce_changed");
          sealedBurn = { version: "apn.circle-sealed-burn-retirement-proof.v1" as const, originalBurnHash: SEALED_BURN_HASH, originalBurnMaterialHash: SEALED_BURN_MATERIAL, ...evidence };
        }
        const body = { ...(sealedBurn === undefined ? {} : { sealedBurn }), ...(consumedBurn === undefined ? {} : { consumedBurn }), intentHash: intent.intentHash, originalApprovalHash: op.effects[0]!.transactionHash!, originalNonceAtomic: intent.cleanupEnvelope.nonceAtomic,
          finalizedNonceAtomic: circleUint(nonce).toString(), finalizedBlockHash: circleHex(head.hash, 32), finalizedBlockNumberAtomic: circleUint(head.number).toString(), cleanupTransactionHash: cleanup.transactionHash, actualCleanupFeeAtomic: canonicalProof.actualFeeAtomic };
        return { ...body, proofHash: hashObject(body) };
      },
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
