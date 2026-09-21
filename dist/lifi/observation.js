import { hashObject } from "../canonical.js";
import { isEvmTransactionHash } from "../rail-status-binding.js";
import { retainedUnsentBridgeRpcFailure } from "./operation-model.js";
import { bridgeDestinationProof, bridgeSourceProof, destinationEventFilter, validateBnbFilledRelay } from "./protocol-evidence.js";
import { bridgeProtocolEmitter } from "./deployments.js";
import { BNB_COMPOSITE } from "./bnb-composite.js";
import { bridgeProviderBoundNativeDestination } from "./asset-registry.js";
import { approvalIncluded } from "./transaction.js";
import { bridgeFailure, bridgeSame } from "./validation.js";
import { ApnError } from "../errors.js";
import { observationRpcFailure } from "./observation-diagnostics.js";
export class BridgeObservation {
    sourcePort;
    destinationPort;
    provider;
    save;
    residualPort;
    constructor(sourcePort, destinationPort, provider, save, residualPort = sourcePort) {
        this.sourcePort = sourcePort;
        this.destinationPort = destinationPort;
        this.provider = provider;
        this.save = save;
        this.residualPort = residualPort;
    }
    source() { return typeof this.sourcePort === "function" ? this.sourcePort() : this.sourcePort; }
    destination() { return typeof this.destinationPort === "function" ? this.destinationPort() : this.destinationPort; }
    residualSource() { return typeof this.residualPort === "function" ? this.residualPort() : this.residualPort; }
    async sources(op) {
        let reliable = true;
        for (const savedEffect of op.effects) {
            if (savedEffect.submissionAttempts === 0)
                continue;
            const effect = op.effects.find((e) => e.role === savedEffect.role);
            if (effect.phase === "safe_success" && effect.safeProof !== null &&
                (effect.role !== "bridge" || op.sourceProof !== null))
                continue;
            let observation;
            try {
                const source = this.source();
                observation = await source.observe(effect.transactionHash, effect.envelope);
                if (observation !== null) {
                    await this.historicalDeployment(op, source, observation.transaction, op.intent.sourceDeployment);
                    if (observation.transaction.status === "success" && effect.role === "approval") {
                        const m = op.intent.materialization;
                        approvalIncluded(observation.receipt, m.request.fromToken, m.sender, m.approvalAddress, m.request.amountAtomic);
                    }
                }
            }
            catch (error) {
                reliable = false;
                op = await this.save(op, { state: "unknown_finality", failure: retainedUnsentBridgeRpcFailure(op) ?? observationFailure(effect.role, error, "APN_INTERNAL") });
                continue;
            }
            if (observation === null) {
                reliable = false;
                if (effect.safeProof !== null) {
                    op = await this.save(op, { state: "unknown_finality", failure: retainedUnsentBridgeRpcFailure(op) ?? {
                            ...observationFailure(effect.role, null, "APN_RECEIPT_NOT_FOUND"), reason: "safe_source_observation_conflict"
                        } });
                }
                else {
                    op = await this.save(op, { state: "unknown_finality", effects: replaceEffect(op, {
                            ...effect, phase: "unknown_finality", includedProof: null, safeProof: null,
                        }), ...(effect.role === "bridge" ? { sourceProof: null } : {}),
                        failure: retainedUnsentBridgeRpcFailure(op) ?? observationFailure(effect.role, null, "APN_RECEIPT_NOT_FOUND") });
                }
                continue;
            }
            const { transaction, receipt } = observation;
            if (effect.safeProof !== null) {
                if (transaction.safeBlock === null || !bridgeSame(proofIdentity(effect.safeProof), proofIdentity(transaction))) {
                    reliable = false;
                    op = await this.save(op, { state: "unknown_finality", failure: retainedUnsentBridgeRpcFailure(op) ?? { reason: "safe_source_observation_conflict", residualAllowance: null } });
                }
                continue;
            }
            // An inclusion can disappear or move before safe finality. Preserve that change in a separate journal entry.
            if (effect.includedProof !== null && !bridgeSame(proofIdentity(effect.includedProof), proofIdentity(transaction))) {
                op = await this.save(op, { state: "unknown_finality", effects: replaceEffect(op, {
                        ...effect, phase: "unknown_finality", includedProof: null, safeProof: null,
                    }), ...(effect.role === "bridge" ? { sourceProof: null } : {}) });
            }
            const current = op.effects.find((e) => e.role === effect.role);
            const phase = `${transaction.safeBlock === null ? "included" : "safe"}_${transaction.status === "success" ? "success" : "revert"}`;
            let sourceProof = op.sourceProof;
            if (effect.role === "bridge" && transaction.status === "success") {
                try {
                    sourceProof = bridgeSourceProof(op.intent.materialization, op.intent.decoded, receipt);
                }
                catch {
                    reliable = false;
                    op = await this.save(op, { state: "unknown_finality", failure: { reason: "source_protocol_evidence_unavailable", residualAllowance: null } });
                    continue;
                }
            }
            op = await this.save(op, { state: reliable ? "source_pending" : "unknown_finality", sourceProof,
                failure: reliable ? retainedUnsentBridgeRpcFailure(op) : op.failure, effects: replaceEffect(op, {
                    ...current, phase, includedProof: transaction, safeProof: transaction.safeBlock === null ? null : transaction,
                }) });
        }
        return { operation: op, reliable };
    }
    async destinationProof(op) {
        if (op.sourceProof === null || op.effects.some((e) => e.phase !== "safe_success"))
            return op;
        if (op.destinationProof !== null) {
            return await this.finish(op);
        }
        const m = op.intent.materialization;
        if (!reusableProviderObservation(op)) {
            let observation = null;
            try {
                observation = await this.provider.status({ transactionHash: op.sourceProof.transactionHash, tool: m.tool,
                    fromChainId: m.request.fromChainId, toChainId: m.request.toChainId });
            }
            catch { /* Provider availability is independent of canonical chain evidence. */ }
            if (observation !== null)
                op = await this.save(op, { providerObservation: observation });
        }
        const hint = op.providerObservation?.destinationTransactionHash;
        const providerBoundNative = bridgeProviderBoundNativeDestination(m.request);
        if (providerBoundNative) {
            if (op.providerObservation?.status !== "completed_observed" || !isEvmTransactionHash(hint))
                return await this.waiting(op);
            try {
                const proof = await this.destinationCandidate(op, hint);
                op = await this.save(op, { destinationProof: proof });
                const outcome = proof.compositeTrace?.outcome;
                if (outcome === undefined || outcome === null || outcome === "completed_native")
                    return await this.finish(op, outcome ?? "delivery_correlated");
                if (outcome === "recovered_weth" || outcome === "below_floor" || outcome === "protocol_mismatch")
                    return await this.finishDestinationFailure(op, outcome);
                return await this.save(op, { state: "unknown_finality", failure: { reason: "evidence_unavailable", residualAllowance: null } });
            }
            catch (error) {
                if (error instanceof BnbProtocolMismatch)
                    return await this.finishDestinationFailure(op, "protocol_mismatch");
                return await this.save(op, { state: "unknown_finality", failure: destinationObservationFailure("evidence_unavailable", error) });
            }
        }
        // Only an EVM hash can address the EVM destination reader; a Solana hint falls through to the scan.
        if (isEvmTransactionHash(hint)) {
            let proof = null;
            try {
                proof = await this.destinationCandidate(op, hint);
            }
            catch { /* Scan the exact protocol correlation next. */ }
            if (proof !== null)
                return await this.finish(await this.save(op, { destinationProof: proof }));
        }
        return await this.scan(op);
    }
    async residual(op) {
        const m = op.intent.materialization, account = await this.residualSource().account(m.sender, m.approvalAddress, m.request.fromToken);
        if (account.chainId !== m.request.fromChainId || account.rpcOrigin !== op.intent.sourceRpcOrigin ||
            account.owner !== m.sender || account.token !== m.request.fromToken || account.spender !== m.approvalAddress)
            bridgeFailure("APN_RPC_PROTOCOL", "residual_allowance_identity");
        return { amountAtomic: account.allowanceAtomic, block: account.block, rpcOrigin: account.rpcOrigin };
    }
    async finish(op, reason = "delivery_correlated") {
        let residualAllowance;
        try {
            residualAllowance = await this.residual(op);
        }
        catch {
            return await this.save(op, { state: "unknown_finality", failure: { reason: "residual_allowance_unavailable", residualAllowance: null } });
        }
        return await this.save(op, { state: "completed", failure: { reason, residualAllowance } });
    }
    async finishDestinationFailure(op, reason) {
        try {
            return await this.save(op, { state: "destination_failed", failure: { reason, residualAllowance: await this.residual(op), residualAllowanceStatus: "observed" } });
        }
        catch {
            return await this.save(op, { state: "destination_failed", failure: { reason, residualAllowance: null, residualAllowanceStatus: "unavailable" } });
        }
    }
    async destinationCandidate(op, hash) {
        const request = op.intent.materialization.request;
        const proveNativeDelta = bridgeProviderBoundNativeDestination(request);
        const bnb = op.intent.decoded.composite !== undefined;
        let canonical = null;
        const destination = this.destination();
        const observe = async (transactionHash, nativeDelivery) => destination.observeDestination === undefined
            ? await destination.observe(transactionHash, undefined, nativeDelivery)
            : await destination.observeDestination(transactionHash, nativeDelivery);
        if (bnb) {
            canonical = await observe(hash);
            if (canonical === null || canonical.transaction.safeBlock === null || canonical.transaction.status !== "success")
                bridgeFailure("APN_RPC_PROTOCOL", "destination_not_safe_success");
            await this.historicalDeployment(op, destination, canonical.transaction, op.intent.destinationDeployment);
            try {
                validateBnbFilledRelay(op.sourceProof, op.intent.materialization, op.intent.decoded, canonical.receipt);
            }
            catch {
                throw new BnbProtocolMismatch();
            }
        }
        const found = await observe(hash, proveNativeDelta ? { recipient: request.recipient,
            from: bnb ? BNB_COMPOSITE.executor : bridgeProtocolEmitter(request.toChainId, "across", request.toToken),
            ...(bnb ? { minimumAmountAtomic: op.intent.decoded.minimumOutputAtomic,
                composite: { message: op.intent.decoded.protocol.kind === "across" ? op.intent.decoded.protocol.message : "0x", call: op.intent.decoded.composite } } : { amountAtomic: op.sourceProof.correlation.kind === "across"
                    ? op.sourceProof.correlation.outputAmountAtomic : op.intent.decoded.minimumOutputAtomic }) } : undefined);
        if (found === null || found.transaction.safeBlock === null || found.transaction.status !== "success")
            bridgeFailure("APN_RPC_PROTOCOL", "destination_not_safe_success");
        if (canonical !== null && (!bridgeSame(proofIdentity(canonical.transaction), proofIdentity(found.transaction)) ||
            !bridgeSame(canonical.receipt.logs, found.receipt.logs)))
            bridgeFailure("APN_RPC_PROTOCOL", "destination_trace_rebind");
        if (canonical === null)
            await this.historicalDeployment(op, destination, found.transaction, op.intent.destinationDeployment);
        let proof;
        try {
            proof = bridgeDestinationProof(op.sourceProof, op.intent.materialization, op.intent.decoded, found.receipt);
        }
        catch (error) {
            if (bnb)
                throw new BnbProtocolMismatch();
            throw error;
        }
        return { ...proof, safeBlock: found.transaction.safeBlock, rpcOrigin: destination.origin,
            transactionProofHash: hashObject(proofIdentity(found.transaction)) };
    }
    async scan(op) {
        let proof = null;
        let destinationScan = op.destinationScan;
        try {
            const destination = this.destination();
            const cursor = op.destinationScan;
            if (cursor.previousEndBlock !== null && !bridgeSame(await destination.block(cursor.previousEndBlock.numberAtomic), cursor.previousEndBlock))
                bridgeFailure("APN_RPC_PROTOCOL", "destination_scan_cursor_reorg");
            const safe = await destination.block("safe"), start = BigInt(cursor.nextBlockAtomic);
            if (BigInt(safe.numberAtomic) >= start) {
                const end = BigInt(safe.numberAtomic) < start + 1023n ? BigInt(safe.numberAtomic) : start + 1023n;
                const endBlock = await destination.block(end.toString()), filter = destinationEventFilter(op.sourceProof, op.intent.materialization.request.toToken);
                const logs = await destination.logs({ fromBlockAtomic: start.toString(), toBlockAtomic: end.toString(), ...filter });
                const unique = [...new Map(logs.map((log) => [log.transactionHash, log])).values()];
                let unresolvedCandidate = false;
                for (const log of unique) {
                    let candidate;
                    try {
                        candidate = await this.destinationCandidate(op, log.transactionHash);
                        if (candidate.blockNumberAtomic !== log.blockNumberAtomic || candidate.blockHash !== log.blockHash)
                            bridgeFailure("APN_RPC_PROTOCOL", "destination_scan_membership");
                    }
                    catch {
                        unresolvedCandidate = true;
                        continue;
                    }
                    if (proof !== null)
                        bridgeFailure("APN_RPC_PROTOCOL", "duplicate_destination_delivery");
                    proof = candidate;
                }
                if (!bridgeSame(await destination.block(endBlock.numberAtomic), endBlock) ||
                    !bridgeSame(await destination.block(safe.numberAtomic), safe))
                    bridgeFailure("APN_RPC_PROTOCOL", "destination_scan_reorg");
                if (proof === null && unresolvedCandidate)
                    bridgeFailure("APN_RPC_PROTOCOL", "destination_candidate_unresolved");
                destinationScan = { ...cursor, nextBlockAtomic: (end + 1n).toString(), previousEndBlock: endBlock };
            }
        }
        catch (error) {
            return await this.save(op, { state: "unknown_finality", failure: destinationObservationFailure("destination_observation_unavailable", error) });
        }
        if (proof !== null)
            return await this.finish(await this.save(op, { destinationProof: proof }));
        return await this.waiting(await this.save(op, { destinationScan }));
    }
    async waiting(op) {
        const provider = op.providerObservation?.status;
        const exceptional = provider !== undefined && !["not_found", "pending", "completed_observed"].includes(provider);
        return await this.save(op, { state: exceptional ? "unknown_finality" : "destination_pending",
            failure: exceptional ? { reason: `provider_${provider}_unproved`, residualAllowance: null } : null });
    }
    async historicalDeployment(op, rpc, proof, frozen) {
        if (rpc.origin !== frozen.rpcOrigin || proof.rpcOrigin !== frozen.rpcOrigin || proof.chainId !== frozen.chainId)
            bridgeFailure("APN_RPC_CONFIG", "observation_RPC_identity");
        const current = await rpc.deployment(op.intent.materialization.tool, frozen.peerChainId, frozen.chainId === op.intent.materialization.request.fromChainId ? op.intent.materialization.request.fromToken : op.intent.materialization.request.toToken, proof.block);
        if (current.contractHash !== frozen.contractHash || current.codeHash !== frozen.codeHash ||
            current.configurationHash !== frozen.configurationHash || !bridgeSame(current.block, proof.block))
            bridgeFailure("APN_PROVIDER_PROTOCOL", "historical_deployment_identity");
    }
}
function observationFailure(effectRole, error, fallbackCode = null) {
    return { reason: "source_observation_unavailable", residualAllowance: null,
        observationRpc: observationRpcFailure("source", effectRole, error, fallbackCode) };
}
function destinationObservationFailure(reason, error) {
    return { reason, residualAllowance: null, ...(error instanceof ApnError
            ? { observationRpc: observationRpcFailure("destination", "bridge", error) } : {}) };
}
class BnbProtocolMismatch extends Error {
}
export function replaceEffect(op, effect) {
    return op.effects.map((e) => e.role === effect.role ? effect : e);
}
function proofIdentity(proof) { return { ...proof, safeBlock: null }; }
function reusableProviderObservation(op) {
    const observation = op.providerObservation, bridge = op.effects.at(-1);
    if (observation?.status !== "completed_observed")
        return false;
    if (op.sourceProof === null || bridge?.role !== "bridge" || bridge.phase !== "safe_success" ||
        bridge.transactionHash !== op.sourceProof.transactionHash || observation.responseHash === null ||
        !isEvmTransactionHash(observation.destinationTransactionHash))
        bridgeFailure("APN_STATE_CORRUPT", "durable_bridge_provider_binding");
    return true;
}
//# sourceMappingURL=observation.js.map