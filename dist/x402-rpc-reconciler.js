import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { appendX402Transition, sealX402Operation, x402TransactionHintSourceBindingHash, } from "./x402-state-integrity.js";
import { X402RpcScanner, candidateFromLog, isCompleteZeroScan, matchingAuthorizationUsed, matchingTransfer, removeLogDerivedEvidence, sameRpcOrigin, scanCoversObservedSafe, validX402Head, } from "./x402-rpc-scan.js";
export class X402RpcReconciler {
    rpc;
    clock;
    store;
    constructor(rpc, clock, store) {
        this.rpc = rpc;
        this.clock = clock;
        this.store = store;
    }
    async reconcile(input) {
        if (input.unusedExpiryEvidence !== undefined ||
            (input.settlementEvidence !== undefined && (input.settlementResponseObservation === undefined ||
                settlementResponseTransaction(input.settlementResponseObservation.normalizedCanonicalJson) === input.settlementEvidence.transactionHash)))
            return outcome(input, false);
        const chain = await this.rpc.assertBaseChain();
        const rpcOriginHash = sha256(chain.rpcOrigin);
        const safe = await this.rpc.getX402Head("safe");
        if (!validX402Head(safe) || !sameRpcOrigin(safe.rpcOrigin, chain.rpcOrigin))
            return outcome(input, false);
        const expiryRelevant = BigInt(safe.timestamp) >= BigInt(input.authorization.validBefore) ||
            BigInt(Math.floor(this.clock.now().getTime() / 1000)) >= BigInt(input.authorization.validBefore);
        const finalized = expiryRelevant ? await this.rpc.getX402Head("finalized") : undefined;
        if (finalized !== undefined && (!validX402Head(finalized) || !sameRpcOrigin(finalized.rpcOrigin, chain.rpcOrigin) ||
            BigInt(finalized.number) > BigInt(safe.number)))
            return outcome(input, false);
        if (finalized !== undefined) {
            let canonicalFinalized;
            try {
                canonicalFinalized = await this.rpc.getX402Block(finalized.number);
            }
            catch {
                return outcome(input, false);
            }
            if (canonicalFinalized.number !== finalized.number || canonicalFinalized.hash !== finalized.hash ||
                canonicalFinalized.timestamp !== finalized.timestamp ||
                !sameRpcOrigin(canonicalFinalized.rpcOrigin, chain.rpcOrigin))
                return outcome(input, false);
        }
        let operation = input;
        let completeZeroScanRead = false;
        if (operation.transactionHint?.source !== "payment_response") {
            const scanner = new X402RpcScanner(this.rpc, this.clock, async (current, additions, stateOverride, clearLogDerivedEvidence) => await this.persist(current, additions, stateOverride, clearLogDerivedEvidence));
            const scanned = await scanner.scanOneChunk(operation, safe, chain.rpcOrigin);
            operation = scanned.operation;
            completeZeroScanRead = scanned.read && isCompleteZeroScan(operation.authorizationUsedScan) &&
                scanCoversObservedSafe(operation.authorizationUsedScan, safe);
            if (scanned.reorg || scanned.unavailable || scanned.malformed) {
                return outcome(operation, completeZeroScanRead);
            }
            if (isCompleteZeroScan(operation.authorizationUsedScan) &&
                !scanCoversObservedSafe(operation.authorizationUsedScan, safe)) {
                return outcome(operation, false);
            }
        }
        if (operation.transactionHint !== undefined) {
            operation = await this.reconcileHint(operation, safe, rpcOriginHash, chain.rpcOrigin);
            return outcome(operation, completeZeroScanRead);
        }
        if (!isCompleteZeroScan(operation.authorizationUsedScan))
            return outcome(operation, completeZeroScanRead);
        if (finalized === undefined || BigInt(finalized.timestamp) < BigInt(operation.authorization.validBefore)) {
            return outcome(operation, completeZeroScanRead);
        }
        if (operation.settlementResponseObservation !== undefined || operation.settlementEvidence !== undefined ||
            operation.resultLink !== undefined)
            return outcome(operation, completeZeroScanRead);
        const authorizationState = await this.rpc.getX402AuthorizationState(operation.wallet, operation.authorization.nonce, { tag: "finalized" });
        const finalizedRecheck = await this.rpc.getX402Head("finalized");
        if (authorizationState.value || authorizationState.blockTag !== "finalized" ||
            authorizationState.blockNumber !== finalized.number || authorizationState.blockHash !== finalized.hash ||
            !sameHead(finalized, finalizedRecheck) || !sameRpcOrigin(authorizationState.rpcOrigin, chain.rpcOrigin))
            return outcome(operation, completeZeroScanRead);
        const body = {
            schemaVersion: "apn.x402.unused-expiry-evidence.v1",
            network: CHAIN_CAIP2,
            chainId: "8453",
            token: BASE_USDC.toLowerCase(),
            validBefore: operation.authorization.validBefore,
            finalizedHead: {
                number: finalized.number,
                hash: finalized.hash,
                timestamp: finalized.timestamp,
                observedAt: finalized.observedAt,
            },
            authorizationState: {
                value: false,
                blockNumber: authorizationState.blockNumber,
                blockHash: authorizationState.blockHash,
                blockTag: "finalized",
                observedAt: authorizationState.observedAt,
            },
            absence: {
                localSettlement: false,
                httpSettlement: false,
                authorizationUsed: false,
                transactionReceipt: false,
            },
            rpcOriginHash,
        };
        const evidence = {
            ...body,
            evidenceHash: domainHash("apn.x402.unused-expiry-evidence.v1", canonicalJson(body)),
        };
        operation = await this.persist(operation, { unusedExpiryEvidence: evidence });
        return outcome(operation, completeZeroScanRead);
    }
    async reconcileHint(operation, safe, rpcOriginHash, rpcOrigin) {
        const hint = operation.transactionHint;
        if (hint === undefined)
            return operation;
        let receipt;
        try {
            receipt = await this.rpc.getX402Receipt(hint.transactionHash);
        }
        catch {
            return operation;
        }
        if (receipt === null || receipt.status !== "success" || receipt.transactionHash !== hint.transactionHash ||
            BigInt(receipt.blockNumber) > BigInt(safe.number) || !sameRpcOrigin(receipt.rpcOrigin, rpcOrigin))
            return operation;
        let transactionBlock;
        try {
            transactionBlock = await this.rpc.getX402Block(receipt.blockNumber);
        }
        catch {
            return operation;
        }
        if (transactionBlock.hash !== receipt.blockHash || !sameRpcOrigin(transactionBlock.rpcOrigin, rpcOrigin))
            return operation;
        const authorizationLogs = receipt.logs.filter((log) => matchingAuthorizationUsed(log, operation));
        const transferLogs = receipt.logs.filter((log) => matchingTransfer(log, operation));
        if (authorizationLogs.length !== 1 || transferLogs.length !== 1)
            return operation;
        const authorizationLog = authorizationLogs[0];
        const transferLog = transferLogs[0];
        if (authorizationLog === undefined || transferLog === undefined)
            return operation;
        let authorizationState;
        try {
            authorizationState = await this.rpc.getX402AuthorizationState(operation.wallet, operation.authorization.nonce, { number: safe.number });
        }
        catch {
            return operation;
        }
        if (!authorizationState.value || authorizationState.blockTag !== "number" ||
            authorizationState.blockNumber !== safe.number || authorizationState.blockHash !== safe.hash ||
            !sameRpcOrigin(authorizationState.rpcOrigin, rpcOrigin))
            return operation;
        const body = {
            schemaVersion: "apn.x402.settlement-evidence.v1",
            network: CHAIN_CAIP2,
            chainId: "8453",
            token: BASE_USDC.toLowerCase(),
            transactionHash: hint.transactionHash,
            safeHead: { number: safe.number, hash: safe.hash, observedAt: safe.observedAt },
            transactionBlock: { number: transactionBlock.number, hash: transactionBlock.hash, timestamp: transactionBlock.timestamp },
            receiptStatus: "1",
            blockHashRechecked: true,
            authorizationUsed: candidateFromLog(authorizationLog, operation),
            transfer: {
                logIndex: transferLog.logIndex,
                from: operation.wallet,
                to: operation.payee,
                value: operation.amountAtomic,
                blockNumber: transferLog.blockNumber,
                blockHash: transferLog.blockHash,
                transactionHash: transferLog.transactionHash,
            },
            authorizationState: {
                value: true,
                blockNumber: authorizationState.blockNumber,
                blockHash: authorizationState.blockHash,
                blockTag: "number",
                observedAt: authorizationState.observedAt,
            },
            rpcOriginHash,
        };
        const evidence = {
            ...body,
            evidenceHash: domainHash("apn.x402.settlement-evidence.v1", canonicalJson(body)),
        };
        return await this.persist(operation, { settlementEvidence: evidence }, operation.state === "authorized_not_sent" ? "effect_unknown" : undefined);
    }
    async persist(operation, additions, stateOverride, clearLogDerivedEvidence = false) {
        const at = this.clock.now().toISOString();
        const state = stateOverride ?? operation.state;
        const summary = state === "effect_unknown" ? {
            finalityClass: "unknown_finality",
            reason: "x402_effect_unknown",
            proofClass: "x402_unknown_finality",
        } : {
            finalityClass: operation.finalityClass,
            reason: operation.reason,
            proofClass: operation.proofClass,
        };
        const resumableScanState = state === "effect_unknown" || state === "authorized_not_sent";
        const nextActions = resumableScanState
            ? additions.authorizationUsedScan?.status === "unavailable"
                ? ["operation.resume", "operation.status", "use.archival_rpc"]
                : ["operation.resume", "operation.status"]
            : operation.nextActions;
        const { integrityHash: _integrityHash, ...withoutIntegrity } = operation;
        const base = clearLogDerivedEvidence && operation.transactionHint?.source === "authorization_used_log"
            ? removeLogDerivedEvidence(withoutIntegrity)
            : withoutIntegrity;
        const next = sealX402Operation({
            ...base,
            ...additions,
            state,
            finalityClass: summary.finalityClass,
            terminal: false,
            reason: summary.reason,
            proofClass: summary.proofClass,
            nextActions,
            updatedAt: at,
            transitions: appendX402Transition(operation.transitions, {
                at,
                state,
                terminal: false,
                reason: summary.reason,
                proofClass: summary.proofClass,
            }),
        });
        await this.store.persist(next);
        return next;
    }
}
function outcome(operation, completeZeroScanRead) {
    return {
        operation,
        completeZeroScanValidated: isCompleteZeroScan(operation.authorizationUsedScan),
        completeZeroScanRead,
    };
}
function sameHead(left, right) {
    return left.number === right.number && left.hash === right.hash &&
        (left.timestamp === undefined || right.timestamp === undefined || left.timestamp === right.timestamp);
}
function settlementResponseTransaction(normalizedCanonicalJson) {
    try {
        const value = JSON.parse(normalizedCanonicalJson);
        return typeof value.transaction === "string" ? value.transaction : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=x402-rpc-reconciler.js.map