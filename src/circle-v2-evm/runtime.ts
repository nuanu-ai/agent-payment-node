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
  private readonly repo: CircleRepository; private readonly usage: CircleUsage; private readonly custody: LocalCircleCustody; private readonly operations: OperationService;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly env: Readonly<Record<string, string | undefined>>, private readonly now: () => number = Date.now,
    private readonly ttyOptions: TtyTransferApprovalOptions = {}, private readonly https: Pick<BridgeHttps, "request"> = new BridgeHttps()) {
    this.repo = new CircleRepository(state.root); this.usage = new CircleUsage(state, now); this.custody = new LocalCircleCustody(state, wrapping); this.operations = new OperationService(state);
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
  async status(id: string) { return publicCircle(await this.required(id)); }
  async approveSource(id: string) { return this.run(id, approveCircleSource); }
  async approveMint(id: string) { return this.run(id, approveCircleMint); }
  async observe(id: string) { return this.run(id, observeCircle); }
  async refreshAttestation(id: string) { return this.run(id, refreshCircleAttestation); }
  async cleanup(id: string) { return this.run(id, cleanupCircle); }
  private async required(id: string) { const op = await this.repo.load(id); if (op === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Circle EVM operation was not found."); return op; }
  private async run(id: string, action: (op: CircleOperationV1, ports: CircleLifecyclePorts) => Promise<CircleOperationV1>) {
    const initial = await this.required(id); await this.state.initialize();
    return this.state.withLocks([`profile:${initial.profileHash}`, `profile:${initial.destinationProfileHash}`, `operation:${initial.operationId}`, `operation:idempotency:${initial.idempotencyHash}`,
      evmAddressLock(initial.sourceCustody.walletAddress), evmAddressLock(initial.destinationCustody.walletAddress)], async () => this.usage.withPolicyLocks([initial.profile, initial.destinationProfile], async () => {
      let op = await this.required(id);
      if (action !== cleanupCircle && op.usage.length === 0 && op.effects.every(e => e.phase === "prepared")) { op = advanceCircle(op, { usage: await this.usage.reserve(op) }, "interrupted_prepare_reserves_repaired", this.now()); await this.repo.save(op); }
      return action(op, this.ports(op));
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
  private ports(initial: CircleOperationV1): CircleLifecyclePorts {
    const { source, destination } = this.remotes(initial.destinationChain), route = circleRoute(initial.destinationChain, initial.destinationProfile);
    const rpc = (e: CircleEffect) => e.role === "mint" ? destination : source;
    const allowance = async (tag = "latest") => String(await source.read(CIRCLE_SOURCE_TOKEN, "allowance", [CIRCLE_SOURCE_OWNER, CIRCLE_MESSENGER], tag));
    const deployments = () => this.preflightDeployments(source, destination, initial.destinationChain);
    return {
      now: this.now, save: op => this.repo.save(op), authorizationDeadline: op => this.usage.authorizationDeadline(op),
      assertOwnerPolicyAndConflicts: async (op, effectRole) => {
        await assertEvmNativeCustody(this.state, op.profile, op.sourceCustody); await assertEvmNativeCustody(this.state, op.destinationProfile, op.destinationCustody);
        await assertExclusiveEvmRawSigner(this.state, op.sourceCustody.walletAddress, op.profileHash); await assertExclusiveEvmRawSigner(this.state, op.destinationCustody.walletAddress, op.destinationProfileHash);
        await this.operations.assertCircleAccountsAvailable(op, true, effectRole); await this.usage.confirm(op);
      },
      approve: async (op, role, deadline) => role === "cancel" ? exactChainConsent([
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
        const freshDeployments = await deployments();
        if (effect.role !== "mint") await this.assertPriorSourcesCanonical(source, op.operationId);
        const remote = rpc(effect), e = effect.envelope; verifyCircleGasEnvelope(e, e.chainId as 42161 | CircleDestinationChain);
        await remote.identity(); const [latest, pending, balance] = await Promise.all([remote.call("eth_getTransactionCount", [e.from, "latest"]), remote.call("eth_getTransactionCount", [e.from, "pending"]), remote.call("eth_getBalance", [e.from, "pending"])]);
        if (circleUint(latest).toString() !== e.nonceAtomic || circleUint(pending).toString() !== e.nonceAtomic || circleUint(balance) < BigInt(e.gasLimitAtomic) * BigInt(e.maxFeePerGasAtomic)) circleBlocked("nonce_or_native_balance_changed");
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
      seal: (op, effect, guard) => this.custody.seal(op, effect, guard), loadMaterial: (op, effect) => this.custody.load(op, effect),
      broadcast: async (effect, raw, guard) => { guard(); if (keccak256(raw) !== effect.transactionHash) circleBlocked("sealed_broadcast_hash_changed"); const result = circleHex(await rpc(effect).call("eth_sendRawTransaction", [raw], guard), 32); if (result !== keccak256(raw)) circleBlocked("broadcast_hash_changed"); return result; },
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
        return decodeCircleDestination(op.source, op.attestation, observation, String(await destination.read(CIRCLE_TRANSMITTER, "usedNonces", [op.attestation.nonce], String(circleRecord(observation.receipt).blockNumber))), op.destinationProfile);
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
        const proof = decodeCircleDestination(op.source, op.attestation, observation, String(await destination.read(CIRCLE_TRANSMITTER, "usedNonces", [op.attestation.nonce], String(circleRecord(observation.receipt).blockNumber))), op.destinationProfile);
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
