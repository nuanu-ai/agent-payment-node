import { circleExternalHeader } from "./external-proof.js";
import { readCircleMintFeeRecipient } from "./mint-fee-recipient.js";
import { decodeEventLog, encodeEventTopics, erc20Abi, getAddress } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { assertEvmNativeCustody } from "../evm-native-custody.js";
import { evmAddressLock } from "../evm-address-ownership.js";
import { listLocalWallets } from "../wallet-import-collision.js";
import { CIRCLE_TRANSMITTER, circleRoute } from "./catalog.js";
import { circleHex, circleRecord, circleUint, decodeCircleSource, verifyCircleApproval, verifyCircleAttestationSigners, circleAttesterConfigurationHash } from "./protocol.js";
import { verifyCircleDeployments } from "./preflight.js";
import { readCircleAttesters, readCircleDeployment } from "./rpc.js";
import { circleBlocked } from "./operation-model.js";
import { advanceCircleFundingOperation as advanceCircle } from "./funding-operation.js";
import { CircleRepository } from "./repository.js";
import { CircleUsage } from "./usage.js";
import { CircleExternalRpc, CircleExternalRpcBudget } from "./external-rpc.js";
import { decodeCircleFundingExternalDestination, fundingExternalStableIdentity, fundingExternalClaimKey, validateFundingExternalFulfillment } from "./funding-external-proof.js";
import { CircleFundingExternalStore } from "./funding-external-store.js";
import { CircleFundingEffectStore } from "./funding-custody.js";
function publicLog(l) { return { address: getAddress(String(l.address)), topics: l.topics, data: circleHex(l.data), blockHash: circleHex(l.blockHash, 32), blockNumber: circleUint(l.blockNumber).toString(), transactionHash: circleHex(l.transactionHash, 32), transactionIndex: circleUint(l.transactionIndex).toString(), logIndex: circleUint(l.logIndex).toString(), removed: l.removed }; }
function sourceEnvelope(effect, input) {
    const t = circleRecord(input), e = effect.envelope;
    if (circleHex(t.hash, 32) !== effect.transactionHash || circleUint(t.nonce).toString() !== e.nonceAtomic || circleUint(t.gas).toString() !== e.gasLimitAtomic || circleUint(t.maxFeePerGas).toString() !== e.maxFeePerGasAtomic || circleUint(t.maxPriorityFeePerGas).toString() !== e.maxPriorityFeePerGasAtomic || circleHex(t.input) !== e.data || getAddress(String(t.from)) !== e.from || getAddress(String(t.to)) !== e.to || circleUint(t.value) !== 0n || circleUint(t.chainId) !== BigInt(e.chainId))
        circleBlocked("external_source_envelope_changed");
}
function strongSource(observation) {
    circleExternalHeader(observation.canonicalBlock);
    circleExternalHeader(observation.recheckedBlock);
    circleExternalHeader(observation.finalityHead);
    const t = circleRecord(observation.transaction), r = circleRecord(observation.receipt), b = circleRecord(observation.canonicalBlock), i = circleUint(t.transactionIndex);
    if (circleUint(r.transactionIndex) !== i || !Array.isArray(b.transactions) || b.transactions[Number(i)] !== t.hash)
        circleBlocked("external_source_index_binding");
}
/** An owned mint or cleanup attempt is closed when the chain proved it can never land (`abandoned_unsent`), or when a fresh
 * envelope re-armed after such a proof has not been signed since. A closed attempt cannot mint, so an external one may be adopted. */
function closedOwnedRoles(op) {
    const closed = new Set();
    for (const role of ["mint", "cleanup"]) {
        const e = op.effects.find(x => x.role === role);
        if (e === undefined)
            continue;
        const lastPrivate = op.transitions.findLastIndex(t => new RegExp(`^${role}_(signing|submission|material|submitted|fenced)`, "u").test(t.reason)), lastRearm = op.transitions.findLastIndex(t => t.reason.startsWith(`${role}_fresh_envelope_after_never_landed:`));
        if (e.phase === "abandoned_unsent" && e.proof === null || e.phase === "prepared" && e.transactionHash === null && e.materialHash === null && e.proof === null && lastRearm > lastPrivate)
            closed.add(role);
    }
    return closed;
}
async function noPrivate(state, op) {
    const closed = closedOwnedRoles(op);
    if (op.usage.length !== 5 || op.destination !== null || op.effects.some(e => (e.role === "mint" || e.role === "cleanup") && !closed.has(e.role) && (e.phase !== "prepared" || e.transactionHash !== null || e.materialHash !== null || e.proof !== null)) || op.transitions.some(t => { const m = /^(mint|cleanup)_(signing|submission|material|submitted|fenced)/u.exec(t.reason); return m !== null && !closed.has(m[1]); }))
        circleBlocked("external_owned_private_entry");
    await new CircleFundingEffectStore(state.root, { load: async () => { circleBlocked("external_private_wallet_forbidden"); }, create: async () => { circleBlocked("external_private_wallet_forbidden"); } }).assertExternalAbsent(op, closed);
    await assertEvmNativeCustody(state, op.profile, op.sourceCustody);
    await assertEvmNativeCustody(state, op.destinationProfile, op.destinationCustody);
}
async function notControlled(state, caller) {
    for (const entry of await state.walletImportEntries())
        if (entry.isFile() && !entry.isSymbolicLink() && /^[a-z0-9][a-z0-9._-]{0,63}\.json$/u.test(entry.name)) {
            const wallet = await state.loadWallet(state.profileHash(entry.name.slice(0, -5)));
            if (wallet === null)
                circleBlocked("external_public_wallet_identity_incomplete");
        }
    for (const wallet of await listLocalWallets(state))
        if (wallet.address.toLowerCase() === caller.toLowerCase())
            circleBlocked("external_caller_controlled");
    for (const entry of await state.profileImportEntries()) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name))
            circleBlocked("external_profile_directory");
        const p = await state.loadProviderProfile(entry.name);
        if (p === null)
            circleBlocked("external_profile_disappeared");
        if (p.public_address.toLowerCase() === caller.toLowerCase())
            circleBlocked("external_caller_controlled");
    }
}
export async function adoptCircleFundingExternalMint(state, repo, usage, env, now, https, id, txHash) {
    const found = await repo.loadAny(id);
    if (found === null || found.schemaVersion !== "apn.circle-v2-evm-operation.v2")
        circleBlocked("external_funding_operation_required");
    const initial = found;
    if (initial === null)
        circleBlocked("external_operation_not_found");
    if (initial.source === null || initial.attestation === null)
        circleBlocked("external_verified_source_required");
    const key = fundingExternalClaimKey(initial), sourceKey = hashObject({ sourceTransactionHash: initial.source.transactionHash, sourceMessageHash: initial.source.sourceMessageHash });
    await state.initialize();
    return state.withLocks([`profile:${initial.profileHash}`, `profile:${initial.destinationProfileHash}`, `custody:${initial.profileHash}`, `custody:${initial.destinationProfileHash}`, `operation:${id}`, `operation:idempotency:${initial.idempotencyHash}`, evmAddressLock(initial.sourceCustody.walletAddress), evmAddressLock(initial.destinationCustody.walletAddress), `circle-external-nonce:${key}`, `circle-external-message:${sourceKey}`], async () => {
        const savedOperation = await repo.loadAny(id);
        if (savedOperation === null || savedOperation.schemaVersion !== "apn.circle-v2-evm-operation.v2")
            circleBlocked("external_funding_operation_required");
        let op = savedOperation;
        await noPrivate(state, op);
        if (op.terminal) {
            if (op.state !== "external_fulfilled" || op.externalFulfillment?.destinationReceipt.transactionHash !== txHash)
                circleBlocked("external_terminal_conflict");
            return op;
        }
        const route = circleRoute(op.destinationChain), budget = new CircleExternalRpcBudget(now, now() + 120000, https), source = new CircleExternalRpc(env.APN_ARBITRUM_RPC_URL ?? "https://arbitrum-one-rpc.publicnode.com", 42161, budget), destination = new CircleExternalRpc(env[route.rpcEnvironment] ?? route.rpcDefault, op.destinationChain, budget);
        const approval = op.effects[0], burn = op.effects[1];
        if (approval.phase !== "confirmed" || burn.phase !== "confirmed" || approval.transactionHash === null || burn.transactionHash === null)
            circleBlocked("external_source_not_confirmed");
        const [approvalObservation, burnObservation, destinationObservation] = await Promise.all([source.observation(approval.transactionHash, "finalized"), source.observation(burn.transactionHash, "finalized"), destination.observation(txHash, "safe")]);
        if (approvalObservation === null || burnObservation === null || destinationObservation === null)
            circleBlocked("external_finality_unresolved");
        strongSource(approvalObservation);
        strongSource(burnObservation);
        sourceEnvelope(approval, approvalObservation.transaction);
        sourceEnvelope(burn, burnObservation.transaction);
        const sourceHead = circleRecord(burnObservation.finalityHead);
        // P1: the exact Approval event proves the approved allowance, and the burn at the next nonce consumed exactly it, so
        // the allowance at the burn block is zero without a state read that a later, unrelated approval could change.
        const approvalProof = verifyCircleApproval(approvalObservation, false, null, op.funding);
        const sourceProof = decodeCircleSource(burnObservation, op.destinationChain, op.funding);
        if (op.source === null || sourceProof.sourceMessageHash !== op.source.sourceMessageHash || sourceProof.blockHash !== op.source.blockHash || sourceProof.receiptHash !== op.source.receiptHash || approval.proof?.receiptHash !== approvalProof.receiptHash)
            circleBlocked("external_source_reorg");
        const proofOp = { ...op, source: sourceProof }, destBlock = circleRecord(destinationObservation.canonicalBlock);
        const destinationHead = circleRecord(destinationObservation.finalityHead);
        circleExternalHeader(destinationHead);
        const [sourceDeploy, destinationDeploy, historicalSourceDeploy, historicalDeploy] = await Promise.all([readCircleDeployment(source, op.destinationChain, sourceHead), readCircleDeployment(destination, op.destinationChain, destinationHead), readCircleDeployment(source, op.destinationChain, circleRecord(burnObservation.canonicalBlock)), readCircleDeployment(destination, op.destinationChain, destBlock)]);
        verifyCircleDeployments(sourceDeploy, destinationDeploy);
        const historicalDeploymentDigest = verifyCircleDeployments(historicalSourceDeploy, historicalDeploy);
        const attesters = await readCircleAttesters(destination, historicalDeploymentDigest, destBlock), signers = await verifyCircleAttestationSigners(op.attestation, op.attestation.attestation, attesters, op.funding);
        if (circleAttesterConfigurationHash(attesters) !== op.attestation.attesterConfigurationHash || hashObject(signers) !== hashObject(op.attestation.signers))
            circleBlocked("external_frozen_attester_configuration_changed");
        const used = await destination.read(CIRCLE_TRANSMITTER, "usedNonces", [op.attestation.nonce], "latest"); // a used nonce never becomes unused
        const feeRecipient = BigInt(op.attestation.feeExecutedAtomic) > 0n ? await readCircleMintFeeRecipient(destination, destinationObservation) : undefined;
        const external = await decodeCircleFundingExternalDestination(proofOp, destinationObservation, used, feeRecipient);
        if (external.transactionHash !== txHash)
            circleBlocked("external_exact_txhash");
        await notControlled(state, external.caller);
        // Canonical receipt credit is historical fulfillment; later recipient spending is unrelated.
        const credits = circleRecord(destinationObservation.receipt).logs.map(circleRecord).filter(l => {
            if (getAddress(String(l.address)) !== route.token || !Array.isArray(l.topics) || l.topics[0] !== encodeEventTopics({ abi: erc20Abi, eventName: "Transfer" })[0])
                return false;
            const d = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: l.topics, data: circleHex(l.data), strict: true });
            return d.args.from === "0x0000000000000000000000000000000000000000" && d.args.to === op.funding.recipient && d.args.value === BigInt(op.attestation.receivedAtomic);
        });
        if (credits.length !== 1)
            circleBlocked("external_receipt_credit_binding");
        const credit = credits[0], recipientCredit = { transactionHash: external.transactionHash, blockHash: external.blockHash, logIndexAtomic: circleUint(credit.logIndex).toString(), amountAtomic: op.attestation.receivedAtomic, logHash: hashObject(publicLog(credit)) };
        const [sourceAnchor, destAnchor] = await Promise.all([source.block(String(circleRecord(burnObservation.canonicalBlock).number)), destination.block(String(destBlock.number))]);
        if (circleExternalHeader(sourceAnchor) !== sourceProof.blockHash || circleExternalHeader(destAnchor) !== external.blockHash)
            circleBlocked("external_reanchor_changed");
        budget.assert();
        await noPrivate(state, op);
        const evidence = budget.evidence.map(value => ({ value, key: canonicalJson(value) })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(x => x.value);
        const { caller, ...destinationReceipt } = external;
        const body = { schemaVersion: "apn.circle-funding-external-fulfillment.v2", operationId: op.operationId, fingerprint: op.fingerprint, sourceTransactionHash: sourceProof.transactionHash, sourceMessageHash: sourceProof.sourceMessageHash, attestedMessageHash: op.attestation.hash, nonce: op.attestation.nonce, destinationChain: op.destinationChain, recipient: op.funding.recipient, token: route.token, grossAtomic: op.funding.amountAtomic, issuerFeeAtomic: op.attestation.feeExecutedAtomic, netAtomic: op.attestation.receivedAtomic, caller, controlledDestinationNativeAtomic: "0", sourceApprovalActualFeeAtomic: approvalProof.actualFeeAtomic, sourceBurnActualFeeAtomic: sourceProof.actualFeeAtomic, destinationReceipt, sourceFinality: sourceProof, recipientCredit, historicalDeploymentDigest, claimDigest: key, evidenceHash: hashObject(evidence) };
        const fresh = { ...body, proofHash: hashObject(body) }, store = new CircleFundingExternalStore(state.root), prior = await store.readClaim(proofOp);
        const saved = op.externalFulfillment ?? prior;
        validateFundingExternalFulfillment(fresh, proofOp);
        if (saved !== undefined && saved !== null) {
            validateFundingExternalFulfillment(saved, proofOp);
            if (canonicalJson(fundingExternalStableIdentity(saved)) !== canonicalJson(fundingExternalStableIdentity(fresh)))
                circleBlocked("external_frozen_proof_changed");
        }
        const fulfillment = saved ?? fresh;
        validateFundingExternalFulfillment(fulfillment, proofOp);
        await noPrivate(state, op);
        await store.claim(proofOp, fulfillment, saved === null || saved === undefined ? evidence : await store.evidence(fulfillment));
        if (op.externalFulfillment === undefined) {
            op = advanceCircle(op, { source: sourceProof, effects: op.effects.map(e => e.role === "approval" ? { ...e, proof: e.proof?.finalityTag === "finalized" ? e.proof : approvalProof } : e.role === "burn" ? { ...e, proof: e.proof?.finalityTag === "finalized" ? e.proof : sourceProof } : e), externalFulfillment: fulfillment, residualAllowanceAtomic: "0" }, "external_mint_proof_verified", now());
            await repo.saveFunding(op);
        }
        await noPrivate(state, op);
        const rows = await usage.followFundingExternalFulfillment(op);
        op = advanceCircle(op, { usage: rows, usageFinalized: true, state: "external_fulfilled", terminal: true }, "external_fulfillment_closed", now());
        await repo.saveFunding(op);
        return op;
    });
}
//# sourceMappingURL=funding-external-adoption.js.map