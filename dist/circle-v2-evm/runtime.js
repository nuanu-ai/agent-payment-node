import { observeHistoricalPaidCircle } from "./historical-paid-observe.js";
import { HISTORICAL_LINEA_OPERATION, HISTORICAL_MONAD_OPERATION } from "./historical-paid-source.js";
import { reconcileOriginalCleanup85 } from "./cleanup85-public-reconcile.js";
import { CLEANUP85_HASH } from "./cleanup85-recovery-store.js";
import { prepareCleanup85Recovery } from "./cleanup85-recovery-prepare.js";
import { Cleanup85RecoveryRuntime } from "./cleanup85-recovery-runtime.js";
import { Cleanup85RecoveryStore } from "./cleanup85-recovery-store.js";
import { CirclePublicFailureStore } from "./public-failure-store.js";
import { consumedBurnEvidence, CONSUMER_HASH, CONSUMER_BLOCK_HASH } from "./consumed-burn-rpc.js";
import { assertConsumedCleanup } from "./consumed-burn-proof.js";
import { approvalReceiptIdentity } from "./burn-retirement-rpc.js";
import { isConsumedBurnRetirement, isSealedBurnRetirement, sealedBurnReplacement, assertSealedBurnReplacement, SEALED_BURN_HASH, SEALED_BURN_MATERIAL, SEALED_BURN_OPERATION } from "./burn-retirement.js";
import { sealedBurnEvidence, assertBurnReplacementAccount } from "./burn-retirement-rpc.js";
import { CircleExternalStore } from "./external-store.js";
import { adoptCircleExternalMint } from "./external-adoption.js";
import { CircleRetirementAuthorityStore, assertCircleRetirementWindow } from "./nonce-retirement-authority.js";
import { CircleNonceRetirementStore } from "./nonce-retirement-store.js";
import { assertCircleNonceRetirementCase, retireCircleNonce } from "./nonce-retirement.js";
import { verifyCircleFinalizedRevert } from "./revert-proof.js";
import { getAddress, keccak256 } from "viem";
import { approvalCode } from "../approval-code.js";
import { canonicalJson, hashObject } from "../canonical.js";
import { evmUnsentOutcome } from "../evm-unsent-outcome.js";
import { assertExclusiveEvmRawSigner, evmAddressLock } from "../evm-address-ownership.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { OperationService } from "../operation-service.js";
import { BridgeHttps } from "../lifi/https.js";
import { exactChainConsent } from "../tty-approval.js";
import { ApnError } from "../errors.js";
import { CIRCLE_SOURCE_OWNER, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, circleRoute } from "./catalog.js";
import { circleHex, circleRecord, circleUint, bindCircleAttestation, decodeCircleSource, decodeCircleDestination, encodeCircleApproval, encodeCircleBurn, encodeCircleMint, verifyCircleApproval, verifyCircleAttestationSigners, circleAttesterConfigurationHash } from "./protocol.js";
import { quoteCircleFastFee, assertCircleFeeQuote, verifyCircleDestinationAccount, verifyCircleGasEnvelope, verifyCircleMintPreflight, verifyCircleClosureFinality } from "./preflight.js";
import { CircleRepository } from "./repository.js";
import { CircleUsage } from "./usage.js";
import { LocalCircleCustody } from "./custody.js";
import { CircleRpc, CIRCLE_COMMAND_REQUEST_BUDGET, currentCircleDeployments, readCircleAttesters, circleRpcTransaction } from "./rpc.js";
import { circleCommandMemo } from "./command-memo.js";
import { advanceCircle, circleBlocked, circleCorrupt, validateCircle, publicCircle } from "./operation-model.js";
import { approveCircleSource, approveCircleMint, observeCircle, refreshCircleAttestation, cleanupCircle } from "./lifecycle.js";
/** The read-only v1 schema (`apn.circle-v2-evm-operation.v1`): existing operations observe, mint, clean up, retire their
 * nonce and adopt an external mint; new operations are prepared only as v2 (`CircleFundingEvmService`). */
export class CircleEvmService {
    state;
    env;
    now;
    ttyOptions;
    https;
    repo;
    usage;
    custody;
    operations;
    retirements;
    cleanup85Recovery;
    constructor(state, wrapping, env, now = Date.now, ttyOptions = {}, https = new BridgeHttps(), cleanup85Dependencies) {
        this.state = state;
        this.env = env;
        this.now = now;
        this.ttyOptions = ttyOptions;
        this.https = https;
        this.retirements = new CircleNonceRetirementStore(state.root);
        this.repo = new CircleRepository(state.root);
        this.usage = new CircleUsage(state, now);
        this.custody = new LocalCircleCustody(state, wrapping);
        this.operations = new OperationService(state);
        this.cleanup85Recovery = new Cleanup85RecoveryRuntime(state, wrapping, env, now, ttyOptions, https, cleanup85Dependencies);
    }
    async status(id) { const op = await this.required(id), failure = await new CirclePublicFailureStore(this.state.root).read(op), recovery = await this.cleanup85Recovery.publicStatus(id); return { ...publicCircle(op), ...(failure === null ? {} : { first_public_effect_failure: failure }), ...(recovery === null ? {} : { cleanup85_recovery: recovery }) }; }
    async prepareCleanup85Recovery(id) { const { source, destination } = this.remotes(1329, "anchored"); return prepareCleanup85Recovery(this.state, source, destination, id, this.now); }
    async cancelCleanup85(id) { return this.cleanup85Recovery.cancel(id); }
    async approveCleanup86(id) { return this.cleanup85Recovery.approve86(id); }
    async approveSource(id) { return this.run(id, approveCircleSource); }
    async adoptExternalMint(id, transactionHash) { return adoptCircleExternalMint(this.state, this.repo, this.usage, this.env, this.now, this.https, id, transactionHash); }
    async approveMint(id) { return this.run(id, approveCircleMint); }
    async observe(id) {
        const saved = await this.required(id);
        if (id === HISTORICAL_LINEA_OPERATION || id === HISTORICAL_MONAD_OPERATION && saved.state === "external_fulfilled")
            return observeHistoricalPaidCircle(this.state, this.repo, this.usage, this.env, this.now, this.https, id);
        if (saved.state === "nonce_retired" && saved.nonceRetirement?.cleanup85Recovery === undefined)
            return saved;
        if (saved.operationId === SEALED_BURN_OPERATION && await new Cleanup85RecoveryStore(this.state.root).publicRecord(saved, "cleanup86-intent") !== null)
            return this.cleanup85Recovery.observe(id);
        return this.run(id, async (op, ports) => {
            if (op.effects.find(e => e.role === "cleanup")?.transactionHash === CLEANUP85_HASH) {
                const { source, destination } = this.remotes(op.destinationChain, "anchored");
                return reconcileOriginalCleanup85(this.state, this.repo, this.usage, source, destination, op, this.now);
            }
            return await this.retirements.intent(op) === null ? observeCircle(op, ports) : retireCircleNonce(op, ports, false);
        });
    }
    async refreshAttestation(id) { return this.run(id, refreshCircleAttestation); }
    async cleanupNonce(id) {
        return this.run(id, async (op, ports) => {
            if (op.state === "nonce_retired")
                return op;
            assertCircleNonceRetirementCase(op, this.now());
            const authorityStore = new CircleRetirementAuthorityStore(this.state.root);
            if (await authorityStore.load(op) === null) {
                if (await this.retirements.hasClaim(op, "sign") || await this.retirements.hasClaim(op, "send"))
                    circleBlocked("retirement_claim_without_current_authority");
                await assertEvmNativeCustody(this.state, op.profile, op.sourceCustody);
                await assertEvmNativeCustody(this.state, op.destinationProfile, op.destinationCustody);
                await this.custody.assertRetirementHeaders(op);
                await assertExclusiveEvmRawSigner(this.state, op.sourceCustody.walletAddress, op.profileHash);
                await assertExclusiveEvmRawSigner(this.state, op.destinationCustody.walletAddress, op.destinationProfileHash);
                await this.operations.assertCircleAccountsAvailable(op, true, "cleanup");
                const policies = await this.usage.retirementPolicies(op);
                await this.usage.confirm(op, policies);
                await authorityStore.capture(op, policies, await this.usage.authorizationDeadline(op, policies), this.now());
            }
            return retireCircleNonce(op, ports);
        }, true);
    }
    async cleanup(id) { return this.run(id, async (op, ports) => { if (await this.retirements.intent(op) !== null)
        circleBlocked("explicit_nonce_retirement_cleanup_required"); return cleanupCircle(op, ports); }); }
    async required(id) { const op = await this.repo.load(id); if (op === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Circle EVM operation was not found."); return op; }
    async run(id, action, retirementOnly = false) {
        const initial = await this.required(id);
        await this.state.initialize();
        return this.state.withLocks([`profile:${initial.profileHash}`, `profile:${initial.destinationProfileHash}`, `operation:${initial.operationId}`, `operation:idempotency:${initial.idempotencyHash}`,
            evmAddressLock(initial.sourceCustody.walletAddress), evmAddressLock(initial.destinationCustody.walletAddress)], async () => this.usage.withPolicyLocks([initial.profile, initial.destinationProfile], async () => {
            let op = await this.required(id);
            // An adopted or claimed external mint of this nonce, on any destination, refuses the owned mint before consent.
            if (action === approveCircleMint)
                await new CircleExternalStore(this.state.root).assertOwnedMintAvailable(op);
            if (action !== cleanupCircle && op.usage.length === 0 && op.effects.every(e => e.phase === "prepared")) {
                op = advanceCircle(op, { usage: await this.usage.reserve(op) }, "interrupted_prepare_reserves_repaired", this.now());
                await this.repo.save(op);
            }
            // Frozen nonce-retirement recovery (phase 4) keeps its anchored one-call-per-POST reads; every live rail is lean.
            const frozen = retirementOnly || op.nonceRetirement !== undefined || await this.retirements.intent(op) !== null;
            return action(op, this.ports(op, retirementOnly, frozen ? "anchored" : "lean"));
        }));
    }
    preflightDeployments(source, destination, chain) { return currentCircleDeployments(source, destination, chain); }
    preflightAttesters(destination, digest) { return readCircleAttesters(destination, digest); }
    remotes(chain, mode = "lean") {
        const route = circleRoute(chain), sourceUrl = this.env.APN_ARBITRUM_RPC_URL ?? "https://arbitrum-one-rpc.publicnode.com", destinationUrl = this.env[route.rpcEnvironment] ?? route.rpcDefault;
        if (mode === "anchored")
            return { source: new CircleRpc(sourceUrl, 42161, this.https, 256, this.env.APN_ARBITRUM_ARCHIVE_MIN_INTERVAL_MS ?? "0"), destination: new CircleRpc(destinationUrl, chain, this.https, 256, this.env.APN_ARBITRUM_ARCHIVE_MIN_INTERVAL_MS ?? "0") };
        return { source: new CircleRpc(sourceUrl, 42161, this.https, CIRCLE_COMMAND_REQUEST_BUDGET, "0", undefined, "lean"), destination: new CircleRpc(destinationUrl, chain, this.https, CIRCLE_COMMAND_REQUEST_BUDGET, "0", undefined, "lean") };
    }
    async api(path) {
        const response = await this.https.request(`https://iris-api.circle.com${path}`, "GET", null, 1024 * 1024, "APN_HTTP_CONFIG");
        if (response.status !== 200)
            throw new ApnError("APN_HTTP_CONFIG", "Circle issuer API response is unavailable.");
        return JSON.parse(response.body);
    }
    async fee(chain) { const value = await this.api(`/v2/burn/USDC/fees/3/${circleRoute(chain).domain}`); return quoteCircleFastFee(chain, value, this.now(), this.now()); }
    ports(initial, retirementOnly = false, mode = retirementOnly ? "anchored" : "lean") {
        const { source, destination } = this.remotes(initial.destinationChain, mode), route = circleRoute(initial.destinationChain);
        // The record's own signers (the v1 validator binds them to the frozen v1 rows).
        const owner = initial.sourceCustody.walletAddress, gasPayer = initial.destinationCustody.walletAddress;
        const rpc = (e) => e.role === "mint" ? destination : source;
        const allowance = async (tag = "latest") => String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [owner, CIRCLE_MESSENGER], tag));
        // P2: one configuration, attester set and fresh fee quote per command; a finalized observation never changes.
        const memo = circleCommandMemo(this.now, () => this.preflightDeployments(source, destination, initial.destinationChain), digest => this.preflightAttesters(destination, digest), () => this.fee(initial.destinationChain), (rpc, hash, tag) => rpc.observation(hash, tag));
        const deployments = memo.deployments, observe = (rpc, hash, tag) => memo.observation(rpc, hash, tag);
        // P1: a used CCTP nonce never becomes unused, so the current value plus the receipt's MessageReceived event proves consumption.
        const usedNonce = async (nonce) => String(await destination.read(CIRCLE_TRANSMITTER, "usedNonces", [nonce], "latest"));
        let currentAuthority = null;
        const authority = async (op) => {
            const retirement = retirementOnly || await this.retirements.intent(op) !== null;
            currentAuthority = retirement ? await new CircleRetirementAuthorityStore(this.state.root).load(op) : null;
            if (retirement && currentAuthority === null)
                circleBlocked("retirement_current_authority_required");
            return currentAuthority;
        };
        return {
            now: this.now, save: op => this.repo.save(op),
            recordEffectFailure: (op, role, error) => new CirclePublicFailureStore(this.state.root).record(op, role, error),
            consentContext: () => currentAuthority?.authorityHash ?? null,
            effectAuthorityGuard: op => { if (currentAuthority !== null) {
                assertCircleRetirementWindow(currentAuthority, this.now());
                if (currentAuthority.operationId !== op.operationId)
                    circleBlocked("retirement_authority_operation_changed");
            } },
            authorizationDeadline: async (op) => { const frame = await authority(op); if (frame !== null)
                assertCircleRetirementWindow(frame, this.now()); return this.usage.authorizationDeadline(op, frame?.policies ?? op.policies); },
            assertOwnerPolicyAndConflicts: async (op, effectRole) => {
                await assertEvmNativeCustody(this.state, op.profile, op.sourceCustody);
                await assertEvmNativeCustody(this.state, op.destinationProfile, op.destinationCustody);
                await assertExclusiveEvmRawSigner(this.state, op.sourceCustody.walletAddress, op.profileHash);
                await assertExclusiveEvmRawSigner(this.state, op.destinationCustody.walletAddress, op.destinationProfileHash);
                await this.operations.assertCircleAccountsAvailable(op, true, effectRole);
                const frame = await authority(op);
                if (frame !== null) {
                    assertCircleRetirementWindow(frame, this.now());
                    if (effectRole !== undefined && effectRole !== "cleanup")
                        circleBlocked("retirement_cleanup_authority_only");
                }
                await this.usage.confirm(op, frame?.policies ?? op.policies);
            },
            approve: async (op, role, deadline) => role === "cleanup" && await this.retirements.intent(op) !== null ? exactChainConsent([
                isConsumedBurnRetirement(op) ? "Agent Payment Node canonically consumed Circle burn allowance cleanup" : isSealedBurnRetirement(op) ? "Agent Payment Node sealed Circle burn nonce retirement" : "Agent Payment Node expired Circle approval nonce cleanup", `Operation: ${op.operationId}`,
                `Source owner: ${op.profile} / ${op.sourceCustody.walletAddress} / eip155:42161`,
                isConsumedBurnRetirement(op) ? `Original sealed unknown burn84 ${op.effects[1].transactionHash} is excluded by finalized native owner transaction ${CONSUMER_HASH}, block513145262/${CONSUMER_BLOCK_HASH}. This fresh cleanup uses nonce85; USDC97924 stays unchanged and allowance40100 becomes0. Historical burn stays unknown; unrelated owner value/fee is not charged here.` : isSealedBurnRetirement(op) ? `Original unknown sealed burn: ${op.effects[1].transactionHash}; nonce84. Confirmed approval83 remains historical.` : `Original unknown approval: ${op.effects[0].transactionHash}; nonce ${op.effects[0].envelope.nonceAtomic}`,
                `One NEW approve-zero transaction: USDC ${CIRCLE_SOURCE_TOKEN}; spender ${CIRCLE_MESSENGER}; ETH value 0.`,
                "Full signed native fee upper at most 15000000000000 wei, charged against the existing cleanup hold. Fresh authority lasts at most 60 seconds and both policy windows.",
                `Frozen cleanup: ${canonicalJson(op.effects.find(e => e.role === "cleanup").envelope)}`,
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
                if (effect.role === "approval" || effect.role === "burn")
                    await this.retirements.assertOriginalEffectsAvailable(op.operationId);
                const freshDeployments = await deployments();
                // A prior burn reorged out would lower this account's latest nonce below the frozen envelope nonce; the exact
                // `latest == pending == envelope` check below refuses that, so other operations' sources are not re-observed here.
                const remote = rpc(effect), e = effect.envelope;
                verifyCircleGasEnvelope(e, e.chainId);
                await remote.identity();
                const [latest, pending, balance, sourceAllowance] = await Promise.all([remote.call("eth_getTransactionCount", [e.from, "latest"]), remote.call("eth_getTransactionCount", [e.from, "pending"]), remote.call("eth_getBalance", [e.from, "pending"]),
                    effect.role === "approval" || effect.role === "burn" ? allowance() : Promise.resolve(null)]);
                const intent = effect.role === "cleanup" ? await this.retirements.intent(op) : null;
                if (isConsumedBurnRetirement(op) && intent !== null) {
                    assertConsumedCleanup(op, e);
                    const evidence = await consumedBurnEvidence(source, op);
                    if (approvalReceiptIdentity(evidence.consumerProof) !== approvalReceiptIdentity(intent.consumedBurn.consumerProof) || approvalReceiptIdentity(evidence.approvalProof) !== approvalReceiptIdentity(intent.consumedBurn.approvalProof))
                        circleBlocked("consumed_intent_evidence_changed");
                }
                else if (isSealedBurnRetirement(op) && intent !== null) {
                    await assertBurnReplacementAccount(source, op, String(latest), String(pending));
                    assertSealedBurnReplacement(op, e);
                    const evidence = await sealedBurnEvidence(source, op, allowance);
                    if (evidence.usdcBalanceAtomic !== intent.sealedBurn?.usdcBalanceAtomic || await allowance() !== "40100")
                        circleBlocked("retirement_source_principal_or_allowance_changed");
                    const head = await source.block("latest"), tip = circleUint(await source.call("eth_maxPriorityFeePerGas", []));
                    if (BigInt(e.maxPriorityFeePerGasAtomic) < tip || BigInt(e.maxFeePerGasAtomic) < circleUint(head.baseFeePerGas) * 2n + BigInt(e.maxPriorityFeePerGasAtomic))
                        circleBlocked("retirement_replacement_network_fee_changed");
                }
                else if (circleUint(latest).toString() !== e.nonceAtomic || circleUint(pending).toString() !== e.nonceAtomic)
                    circleBlocked("nonce_or_native_balance_changed");
                if (circleUint(balance) < BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic))
                    circleBlocked("nonce_or_native_balance_changed");
                if (intent !== null && !isSealedBurnRetirement(op) && await allowance() !== "0")
                    circleBlocked("retirement_zero_allowance_changed");
                if (effect.role === "approval" && sourceAllowance !== "0" || effect.role === "burn" && sourceAllowance !== "40100")
                    circleBlocked("exact_source_allowance_changed");
                if (effect.role === "approval" || effect.role === "burn") {
                    const quote = await memo.fee();
                    assertCircleFeeQuote(quote, op.destinationChain, this.now());
                }
                const transaction = circleRpcTransaction(e), [rawEstimate, rawSimulation] = await Promise.all([remote.call("eth_estimateGas", [transaction, "pending"]), remote.call("eth_call", [transaction, "pending"])]);
                if (circleUint(rawEstimate) > BigInt(e.gasLimitAtomic))
                    circleBlocked("simulation_exceeds_gas_ceiling");
                const simulated = circleHex(rawSimulation);
                if (effect.role === "mint") {
                    const sourceObservation = await observe(source, op.source.transactionHash, op.source.finalityTag === "finalized" ? "finalized" : "included");
                    if (sourceObservation === null)
                        circleBlocked("source_reorg_before_mint");
                    assertObservedEnvelope(op.effects.find(e => e.role === "burn"), sourceObservation.transaction);
                    if (decodeCircleSource(sourceObservation, op.destinationChain).blockHash !== op.source.blockHash)
                        circleBlocked("source_reorg_before_mint");
                    if (op.source === null || op.attestation === null)
                        circleCorrupt("mint_without_source");
                    const snapshot = await memo.attesters(freshDeployments.digest);
                    await verifyCircleAttestationSigners(op.attestation, op.attestation.attestation, snapshot);
                    const [block, rawUsed] = await Promise.all([destination.block("latest"), destination.read(CIRCLE_TRANSMITTER, "usedNonces", [op.attestation.nonce], "latest")]), used = String(rawUsed);
                    verifyCircleMintPreflight(op.source, op.attestation, { destinationBlockAtomic: circleUint(block.number).toString(), usedNonceAtomic: used, attesterConfigurationHash: circleAttesterConfigurationHash(snapshot), transactionSimulationResult: simulated });
                }
            },
            seal: async (op, effect, guard) => {
                if (effect.role === "approval" || effect.role === "burn")
                    await this.retirements.assertOriginalEffectsAvailable(op.operationId);
                else if (effect.role === "cleanup" && await this.retirements.intent(op) !== null) {
                    guard();
                    await this.custody.assertCleanupAbsent(op);
                    guard();
                    await this.retirements.claim(op, "sign");
                    guard();
                }
                return this.custody.seal(op, effect, guard);
            }, loadMaterial: (op, effect) => this.custody.load(op, effect),
            unsent: { outcome: async (_op, effect) => {
                    const remote = rpc(effect);
                    await remote.identity();
                    return evmUnsentOutcome((method, params) => remote.call(method, params), { account: effect.envelope.from,
                        nonce: BigInt(effect.envelope.nonceAtomic), transactionHash: effect.transactionHash ?? circleCorrupt("unsent_hash_missing") });
                },
                discard: (op, effect) => this.custody.discard(op, effect) },
            broadcast: async (effect, raw, guard) => {
                guard();
                if (effect.role === "approval" || effect.role === "burn")
                    await this.retirements.assertOriginalEffectsAvailable(initial.operationId);
                else if (effect.role === "cleanup" && await this.retirements.intent(initial) !== null) {
                    const current = await this.required(initial.operationId);
                    guard();
                    await this.retirements.claim(current, "send");
                    guard();
                }
                guard();
                if (keccak256(raw) !== effect.transactionHash)
                    circleBlocked("sealed_broadcast_hash_changed");
                const result = circleHex(await rpc(effect).call("eth_sendRawTransaction", [raw], guard), 32);
                if (result !== keccak256(raw))
                    circleBlocked("broadcast_hash_changed");
                return result;
            },
            observeEffect: async (op, effect) => {
                if (effect.transactionHash === null)
                    return null;
                const tag = effect.role === "mint" ? "safe" : effect.role === "cleanup" ? "finalized" : "included", observation = await observe(rpc(effect), effect.transactionHash, tag);
                if (observation === null)
                    return null;
                assertObservedEnvelope(effect, observation.transaction);
                if (circleUint(circleRecord(observation.receipt).status) === 0n && effect.role !== "mint") {
                    const finalized = tag === "finalized" ? observation : await observe(source, effect.transactionHash, "finalized");
                    if (finalized === null)
                        return null;
                    assertObservedEnvelope(effect, finalized.transaction);
                    return verifyCircleFinalizedRevert(effect, finalized);
                }
                // P1: the exact Approval event of a direct owner approve proves the allowance; no state read at the receipt block.
                if (effect.role === "approval" || effect.role === "cleanup")
                    return verifyCircleApproval(observation, effect.role === "cleanup", null);
                if (effect.role === "burn")
                    return decodeCircleSource(observation, op.destinationChain);
                if (op.source === null || op.attestation === null)
                    circleCorrupt("mint_proof_without_source");
                return decodeCircleDestination(op.source, op.attestation, observation, await usedNonce(op.attestation.nonce), op.destinationProfile);
            },
            observeSource: async (op, finalized) => {
                const hash = op.effects.find(e => e.role === "burn").transactionHash;
                if (hash === null)
                    return null;
                const observation = await observe(source, hash, finalized ? "finalized" : "included");
                if (observation === null)
                    return null;
                assertObservedEnvelope(op.effects.find(e => e.role === "burn"), observation.transaction);
                const proof = decodeCircleSource(observation, op.destinationChain);
                if (finalized && op.source !== null)
                    verifyCircleClosureFinality(op.source, proof);
                return op.source?.finalityTag === "finalized" ? op.source : proof;
            },
            observeDestination: async (op) => {
                const hash = op.effects.find(e => e.role === "mint")?.transactionHash;
                if (hash === null || hash === undefined || op.source === null || op.attestation === null)
                    return null;
                const observation = await observe(destination, hash, "safe");
                if (observation === null)
                    return null;
                assertObservedEnvelope(op.effects.find(e => e.role === "mint"), observation.transaction);
                const proof = decodeCircleDestination(op.source, op.attestation, observation, await usedNonce(op.attestation.nonce), op.destinationProfile);
                if (op.destination !== null && (proof.blockHash !== op.destination.blockHash || proof.receiptHash !== op.destination.receiptHash || proof.transactionHash !== op.destination.transactionHash))
                    circleBlocked("destination_reorg_holds_required");
                return op.destination ?? proof;
            }, allowance: async () => allowance(),
            attestation: async (op) => {
                if (op.source === null)
                    return null;
                const response = circleRecord(await this.api(`/v2/messages/3?transactionHash=${op.source.transactionHash}`));
                if (!Array.isArray(response.messages) || response.messages.length !== 1 || circleRecord(response.messages[0]).status !== "complete")
                    return null;
                const snapshot = await memo.attesters((await deployments()).digest);
                return bindCircleAttestation(op.source, { ...response, sourceTxHash: op.source.transactionHash }, snapshot);
            },
            mintEnvelope: async (op) => {
                if (op.attestation === null)
                    circleCorrupt("attestation_missing");
                const account = await destination.account(gasPayer, route.token, CIRCLE_TRANSMITTER), nonce = verifyCircleDestinationAccount(account, op.destinationChain, gasPayer);
                return destination.envelope(gasPayer, CIRCLE_TRANSMITTER, encodeCircleMint(op.attestation), nonce);
            },
            cleanupEnvelope: async (op) => { const nonce = circleUint(await source.call("eth_getTransactionCount", [owner, "pending"])).toString(); return source.envelope(owner, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(true), nonce); },
            assertRetirementMaterial: op => this.custody.assertRetirementHeaders(op),
            retirementClaimed: async (op) => await this.retirements.hasClaim(op, "sign") || await this.retirements.hasClaim(op, "send"),
            prepareRetirement: async (op) => {
                const existing = await this.retirements.intent(op);
                if (existing !== null)
                    return existing;
                const account = await source.account(owner, CIRCLE_SOURCE_TOKEN, CIRCLE_MESSENGER), nonce = isConsumedBurnRetirement(op) ? "85" : op.effects[isSealedBurnRetirement(op) ? 1 : 0].envelope.nonceAtomic;
                let evidence, consumedEvidence;
                if (isConsumedBurnRetirement(op)) {
                    consumedEvidence = await consumedBurnEvidence(source, op);
                    if (account.latestNonceAtomic !== "85" || account.pendingNonceAtomic !== "85" || account.allowanceAtomic !== "40100" || account.usdcBalanceAtomic !== "97924")
                        circleBlocked("consumed_account_changed");
                }
                else if (isSealedBurnRetirement(op)) {
                    await assertBurnReplacementAccount(source, op, account.latestNonceAtomic, account.pendingNonceAtomic);
                    if (account.allowanceAtomic !== "40100")
                        circleBlocked("retirement_original_nonce_or_allowance_changed");
                    evidence = await sealedBurnEvidence(source, op, allowance);
                }
                else if (account.latestNonceAtomic !== nonce || account.pendingNonceAtomic !== nonce || account.allowanceAtomic !== "0")
                    circleBlocked("retirement_original_nonce_or_allowance_changed");
                const quote = await source.envelope(owner, CIRCLE_SOURCE_TOKEN, encodeCircleApproval(true), nonce);
                const envelope = isSealedBurnRetirement(op) && !isConsumedBurnRetirement(op) ? sealedBurnReplacement(op, quote, circleUint(await source.call("eth_maxPriorityFeePerGas", []))) : quote;
                if (isSealedBurnRetirement(op) && BigInt(account.nativeBalanceAtomic) < BigInt(envelope.gasLimitAtomic) * BigInt(envelope.maxFeePerGasAtomic))
                    circleBlocked("retirement_native_full_upper_balance");
                // Strict cleanup schema includes the FULL signed gas upper <=15T, never only the estimate.
                const effect = { role: "cleanup", phase: "prepared", envelope, transactionHash: null, materialHash: null, proof: null };
                validateCircle(advanceCircle(op, { effects: [...op.effects, effect], state: "cleanup_required" }, "nonce_retirement_cleanup_frozen", this.now()));
                return this.retirements.start(op, envelope, evidence, consumedEvidence);
            },
            retirementProof: async (op, intent) => {
                await this.retirements.assertClaim(op, "sign");
                await this.retirements.assertClaim(op, "send");
                const cleanup = op.effects.find(x => x.role === "cleanup");
                if (cleanup.proof?.finalityTag !== "finalized" || cleanup.transactionHash === null || cleanup.envelope.envelopeHash !== intent.cleanupEnvelope.envelopeHash)
                    return null;
                const observation = await source.observation(cleanup.transactionHash, "finalized");
                if (observation === null)
                    return null;
                assertObservedEnvelope(cleanup, observation.transaction);
                const receipt = circleRecord(observation.receipt), head = circleRecord(observation.finalityHead), headTag = String(head.number);
                const canonicalProof = verifyCircleApproval(observation, true, await allowance(String(receipt.blockNumber)));
                if (canonicalProof.blockHash !== cleanup.proof.blockHash || canonicalProof.receiptHash !== cleanup.proof.receiptHash)
                    circleBlocked("retirement_cleanup_reorg");
                const [nonce, zeroAllowance] = await Promise.all([source.call("eth_getTransactionCount", [owner, headTag]), allowance(headTag)]);
                if (circleUint(nonce) <= BigInt(intent.cleanupEnvelope.nonceAtomic) || zeroAllowance !== "0" || await allowance() !== "0" || circleHex((await source.block(headTag)).hash, 32) !== circleHex(head.hash, 32))
                    circleBlocked("retirement_finalized_nonce_or_allowance_changed");
                await this.custody.assertRetirementHeaders(op);
                let sealedBurn, consumedBurn;
                if (isConsumedBurnRetirement(op)) {
                    const evidence = await consumedBurnEvidence(source, op, true);
                    if (String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], String(receipt.blockNumber))) !== evidence.usdcBalanceAtomic || circleUint(nonce) !== 86n || approvalReceiptIdentity(evidence.consumerProof) !== approvalReceiptIdentity(intent.consumedBurn.consumerProof) || approvalReceiptIdentity(evidence.approvalProof) !== approvalReceiptIdentity(intent.consumedBurn.approvalProof))
                        circleBlocked("consumed_finalized_evidence_changed");
                    consumedBurn = { version: "apn.circle-consumed-burn-retirement-proof.v1", originalBurnHash: SEALED_BURN_HASH, originalBurnMaterialHash: SEALED_BURN_MATERIAL, ...evidence };
                }
                else if (isSealedBurnRetirement(op)) {
                    const evidence = await sealedBurnEvidence(source, op, allowance);
                    if (circleUint(nonce) !== 85n || evidence.usdcBalanceAtomic !== intent.sealedBurn?.usdcBalanceAtomic || String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], headTag)) !== evidence.usdcBalanceAtomic || String(await source.read(CIRCLE_SOURCE_TOKEN, "balanceOf", [CIRCLE_SOURCE_OWNER], String(receipt.blockNumber))) !== evidence.usdcBalanceAtomic || circleHex((await source.block(headTag)).hash, 32) !== circleHex(head.hash, 32))
                        circleBlocked("retirement_finalized_principal_or_nonce_changed");
                    sealedBurn = { version: "apn.circle-sealed-burn-retirement-proof.v1", originalBurnHash: SEALED_BURN_HASH, originalBurnMaterialHash: SEALED_BURN_MATERIAL, ...evidence };
                }
                const body = { ...(sealedBurn === undefined ? {} : { sealedBurn }), ...(consumedBurn === undefined ? {} : { consumedBurn }), intentHash: intent.intentHash, originalApprovalHash: op.effects[0].transactionHash, originalNonceAtomic: intent.cleanupEnvelope.nonceAtomic,
                    finalizedNonceAtomic: circleUint(nonce).toString(), finalizedBlockHash: circleHex(head.hash, 32), finalizedBlockNumberAtomic: circleUint(head.number).toString(), cleanupTransactionHash: cleanup.transactionHash, actualCleanupFeeAtomic: canonicalProof.actualFeeAtomic };
                return { ...body, proofHash: hashObject(body) };
            },
            usage: (op, target) => this.usage.follow(op, target),
        };
    }
}
function assertObservedEnvelope(effect, input) {
    const t = circleRecord(input), e = effect.envelope;
    if (circleHex(t.hash, 32) !== effect.transactionHash || circleUint(t.nonce).toString() !== e.nonceAtomic || circleUint(t.gas).toString() !== e.gasLimitAtomic ||
        circleUint(t.maxFeePerGas).toString() !== e.maxFeePerGasAtomic || circleUint(t.maxPriorityFeePerGas).toString() !== e.maxPriorityFeePerGasAtomic ||
        circleHex(t.input) !== e.data || getAddress(String(t.from)) !== e.from || getAddress(String(t.to)) !== e.to || circleUint(t.value) !== 0n || circleUint(t.chainId) !== BigInt(e.chainId))
        circleBlocked("receipt_transaction_envelope_changed");
}
//# sourceMappingURL=runtime.js.map