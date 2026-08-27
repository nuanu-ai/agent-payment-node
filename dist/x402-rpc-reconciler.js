import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { appendX402Transition, sealX402Operation, x402TransactionHintSourceBindingHash, } from "./x402-state-integrity.js";
const AUTHORIZATION_USED_TOPIC = "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
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
        if (!validHead(safe) || !sameOrigin(safe.rpcOrigin, chain.rpcOrigin))
            return outcome(input, false);
        const expiryRelevant = BigInt(safe.timestamp) >= BigInt(input.authorization.validBefore) ||
            BigInt(Math.floor(this.clock.now().getTime() / 1000)) >= BigInt(input.authorization.validBefore);
        const finalized = expiryRelevant ? await this.rpc.getX402Head("finalized") : undefined;
        if (finalized !== undefined && (!validHead(finalized) || !sameOrigin(finalized.rpcOrigin, chain.rpcOrigin) ||
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
                !sameOrigin(canonicalFinalized.rpcOrigin, chain.rpcOrigin))
                return outcome(input, false);
        }
        let operation = input;
        let completeZeroScanRead = false;
        if (operation.transactionHint?.source !== "payment_response") {
            const scanned = await this.scanOneChunk(operation, safe, chain.rpcOrigin);
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
            !sameHead(finalized, finalizedRecheck) || !sameOrigin(authorizationState.rpcOrigin, chain.rpcOrigin))
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
            BigInt(receipt.blockNumber) > BigInt(safe.number) || !sameOrigin(receipt.rpcOrigin, rpcOrigin))
            return operation;
        let transactionBlock;
        try {
            transactionBlock = await this.rpc.getX402Block(receipt.blockNumber);
        }
        catch {
            return operation;
        }
        if (transactionBlock.hash !== receipt.blockHash || !sameOrigin(transactionBlock.rpcOrigin, rpcOrigin))
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
            authorizationState = await this.rpc.getX402AuthorizationState(operation.wallet, operation.authorization.nonce, { tag: "safe" });
        }
        catch {
            return operation;
        }
        const safeRecheck = await this.rpc.getX402Head("safe");
        if (!authorizationState.value || authorizationState.blockTag !== "safe" ||
            authorizationState.blockNumber !== safe.number || authorizationState.blockHash !== safe.hash ||
            !sameOrigin(authorizationState.rpcOrigin, rpcOrigin) || !sameHead(safe, safeRecheck))
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
                blockTag: "safe",
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
    async scanOneChunk(input, observedSafe, rpcOrigin) {
        let operation = input;
        let scan = operation.authorizationUsedScan;
        if (scan === undefined) {
            if (BigInt(observedSafe.number) < BigInt(operation.preparedBlock.number)) {
                return { operation, reorg: false, unavailable: false, malformed: true, read: false };
            }
            scan = sealScan({
                schemaVersion: "apn.x402.authorization-used-scan.v1",
                searchStartBlock: operation.preparedBlock.number,
                nextFromBlock: operation.preparedBlock.number,
                targetSafeHead: { number: observedSafe.number, hash: observedSafe.hash, observedAt: observedSafe.observedAt },
                candidates: [],
                status: "active",
                updatedAt: this.clock.now().toISOString(),
            });
            operation = await this.persist(operation, { authorizationUsedScan: scan });
        }
        const anchored = await this.validateScanAnchor(operation, scan, rpcOrigin);
        operation = anchored.operation;
        if (anchored.reorg || anchored.malformed) {
            return { operation, reorg: anchored.reorg, unavailable: false, malformed: anchored.malformed, read: false };
        }
        scan = operation.authorizationUsedScan;
        if (scan.status === "complete") {
            const targetNumber = BigInt(scan.targetSafeHead.number);
            const observedNumber = BigInt(observedSafe.number);
            const postExposureExtension = operation.state === "effect_unknown" &&
                operation.attempts.some((attempt) => attempt.purpose === "payment");
            const preSendReorgExtension = operation.state === "effect_unknown" && operation.attempts.length === 0 &&
                operation.transitions.at(-2)?.state === "effect_unknown" &&
                operation.transitions.at(-1)?.state === "effect_unknown";
            const preSendExtension = operation.state === "authorized_not_sent" &&
                !operation.attempts.some((attempt) => attempt.purpose === "payment");
            const extendable = (postExposureExtension || preSendReorgExtension || preSendExtension) && scan.candidates.length === 0 &&
                operation.transactionHint === undefined && operation.settlementEvidence === undefined && operation.resultLink === undefined;
            if (!extendable || observedNumber === targetNumber) {
                return { operation, reorg: false, unavailable: false, malformed: false, read: false };
            }
            if (observedNumber < targetNumber) {
                return { operation, reorg: false, unavailable: false, malformed: true, read: false };
            }
            let extendedTarget;
            try {
                extendedTarget = await this.rpc.getX402Block(observedSafe.number);
            }
            catch {
                return { operation, reorg: false, unavailable: false, malformed: true, read: false };
            }
            if (extendedTarget.number !== observedSafe.number || extendedTarget.hash !== observedSafe.hash ||
                extendedTarget.timestamp !== observedSafe.timestamp || !sameOrigin(extendedTarget.rpcOrigin, rpcOrigin))
                return { operation, reorg: false, unavailable: false, malformed: true, read: false };
            const active = sealScan({
                ...withoutEvidenceHash(scan),
                targetSafeHead: {
                    number: observedSafe.number,
                    hash: observedSafe.hash,
                    observedAt: observedSafe.observedAt,
                },
                status: "active",
                updatedAt: this.clock.now().toISOString(),
            });
            operation = await this.persist(operation, { authorizationUsedScan: active });
            scan = operation.authorizationUsedScan;
        }
        else if (scan.status === "ambiguous") {
            return { operation, reorg: false, unavailable: false, malformed: false, read: false };
        }
        if (scan.status === "unavailable") {
            const active = sealScan({
                ...withoutEvidenceHash(scan),
                status: "active",
                updatedAt: this.clock.now().toISOString(),
            });
            operation = await this.persist(operation, { authorizationUsedScan: active });
            scan = operation.authorizationUsedScan;
        }
        const from = BigInt(scan.nextFromBlock);
        const head = BigInt(scan.targetSafeHead.number);
        if (from > head)
            return { operation, reorg: false, unavailable: false, malformed: true, read: false };
        const to = from + 2047n < head ? from + 2047n : head;
        let result;
        try {
            result = await this.rpc.getX402AuthorizationUsedLogs({
                authorizer: operation.wallet,
                nonce: operation.authorization.nonce,
                fromBlock: from.toString(),
                toBlock: to.toString(),
            });
        }
        catch {
            return { operation, reorg: false, unavailable: false, malformed: true, read: true };
        }
        if (result.kind !== "complete") {
            const commitAnchor = await this.validateScanAnchor(operation, scan, rpcOrigin);
            operation = commitAnchor.operation;
            if (commitAnchor.reorg || commitAnchor.malformed) {
                return { operation, reorg: commitAnchor.reorg, unavailable: false, malformed: commitAnchor.malformed, read: true };
            }
            scan = operation.authorizationUsedScan;
            const unavailable = sealScan({
                ...withoutEvidenceHash(scan),
                status: "unavailable",
                unavailableReason: result.kind,
                updatedAt: this.clock.now().toISOString(),
            });
            operation = await this.persist(operation, { authorizationUsedScan: unavailable });
            return { operation, reorg: false, unavailable: true, malformed: false, read: true };
        }
        const candidates = new Map(scan.candidates.map((candidate) => [candidateKey(candidate), candidate]));
        try {
            for (const log of result.logs) {
                if (!matchingAuthorizationUsed(log, operation) || BigInt(log.blockNumber) < from || BigInt(log.blockNumber) > to) {
                    return { operation, reorg: false, unavailable: false, malformed: true, read: true };
                }
                const candidate = candidateFromLog(log, operation);
                const key = candidateKey(candidate);
                if (!candidates.has(key) && candidates.size < 2)
                    candidates.set(key, candidate);
            }
        }
        catch {
            return { operation, reorg: false, unavailable: false, malformed: true, read: true };
        }
        let toBlock;
        try {
            toBlock = await this.rpc.getX402Block(to.toString());
        }
        catch {
            return { operation, reorg: false, unavailable: false, malformed: true, read: true };
        }
        const finalAnchor = await this.validateScanAnchor(operation, scan, rpcOrigin);
        operation = finalAnchor.operation;
        if (finalAnchor.reorg || finalAnchor.malformed) {
            return { operation, reorg: finalAnchor.reorg, unavailable: false, malformed: finalAnchor.malformed, read: true };
        }
        scan = operation.authorizationUsedScan;
        if (to === head && toBlock.hash !== scan.targetSafeHead.hash) {
            return { operation, reorg: false, unavailable: false, malformed: true, read: true };
        }
        const candidateList = [...candidates.values()];
        const complete = to === head;
        const status = candidateList.length > 1 ? "ambiguous" : complete ? "complete" : "active";
        const updated = sealScan({
            schemaVersion: "apn.x402.authorization-used-scan.v1",
            searchStartBlock: scan.searchStartBlock,
            nextFromBlock: (to + 1n).toString(),
            targetSafeHead: scan.targetSafeHead,
            lastCompletedChunk: { fromBlock: from.toString(), toBlock: to.toString(), toBlockHash: toBlock.hash },
            candidates: candidateList,
            status,
            updatedAt: this.clock.now().toISOString(),
        });
        const unique = status === "complete" && candidateList.length === 1 ? candidateList[0] : undefined;
        operation = await this.persist(operation, {
            authorizationUsedScan: updated,
            ...(unique === undefined ? {} : {
                transactionHint: {
                    transactionHash: unique.transactionHash,
                    source: "authorization_used_log",
                    sourceBindingHash: x402TransactionHintSourceBindingHash("authorization_used_log", updated.evidenceHash),
                    observedAt: updated.updatedAt,
                },
            }),
        }, operation.state === "authorized_not_sent" && candidateList.length > 0 ? "effect_unknown" : undefined);
        return { operation, reorg: false, unavailable: false, malformed: false, read: true };
    }
    async validateScanAnchor(operation, scan, rpcOrigin) {
        let targetBlock;
        try {
            targetBlock = await this.rpc.getX402Block(scan.targetSafeHead.number);
        }
        catch {
            return { operation, reorg: false, malformed: true };
        }
        if (targetBlock.number !== scan.targetSafeHead.number || !sameOrigin(targetBlock.rpcOrigin, rpcOrigin)) {
            return { operation, reorg: false, malformed: true };
        }
        if (targetBlock.hash !== scan.targetSafeHead.hash)
            return await this.resetScanAfterReorg(operation, scan, rpcOrigin);
        if (scan.lastCompletedChunk === undefined)
            return { operation, reorg: false, malformed: false };
        let priorEnd;
        try {
            priorEnd = await this.rpc.getX402Block(scan.lastCompletedChunk.toBlock);
        }
        catch {
            return { operation, reorg: false, malformed: true };
        }
        if (priorEnd.number !== scan.lastCompletedChunk.toBlock ||
            priorEnd.hash !== scan.lastCompletedChunk.toBlockHash ||
            !sameOrigin(priorEnd.rpcOrigin, rpcOrigin))
            return await this.resetScanAfterReorg(operation, scan, rpcOrigin);
        return { operation, reorg: false, malformed: false };
    }
    async resetScanAfterReorg(operation, scan, rpcOrigin) {
        let currentSafe;
        try {
            currentSafe = await this.rpc.getX402Head("safe");
        }
        catch {
            return { operation, reorg: false, malformed: true };
        }
        if (!validHead(currentSafe) || !sameOrigin(currentSafe.rpcOrigin, rpcOrigin) ||
            BigInt(currentSafe.number) < BigInt(scan.searchStartBlock))
            return { operation, reorg: false, malformed: true };
        return {
            operation: await this.persistScanReset(operation, scan, currentSafe),
            reorg: true,
            malformed: false,
        };
    }
    async persistScanReset(operation, scan, safe) {
        const state = operation.state === "authorized_not_sent" && operation.attempts.length === 0
            ? undefined
            : "effect_unknown";
        return await this.persist(operation, { authorizationUsedScan: resetScan(scan.searchStartBlock, safe, this.clock.now().toISOString()) }, state, true);
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
function sealScan(value) {
    return { ...value, evidenceHash: domainHash("apn.x402.authorization-used-scan.v1", canonicalJson(value)) };
}
function withoutEvidenceHash(scan) {
    const { evidenceHash: _evidenceHash, unavailableReason: _unavailableReason, ...body } = scan;
    return body;
}
function resetScan(searchStartBlock, safe, updatedAt) {
    return sealScan({
        schemaVersion: "apn.x402.authorization-used-scan.v1",
        searchStartBlock,
        nextFromBlock: searchStartBlock,
        targetSafeHead: { number: safe.number, hash: safe.hash, observedAt: safe.observedAt },
        candidates: [],
        status: "active",
        updatedAt,
    });
}
function outcome(operation, completeZeroScanRead) {
    return {
        operation,
        completeZeroScanValidated: isCompleteZeroScan(operation.authorizationUsedScan),
        completeZeroScanRead,
    };
}
function isCompleteZeroScan(scan) {
    return scan?.status === "complete" && scan.candidates.length === 0 &&
        BigInt(scan.nextFromBlock) === BigInt(scan.targetSafeHead.number) + 1n;
}
function scanCoversObservedSafe(scan, safe) {
    return scan?.targetSafeHead.number === safe.number && scan.targetSafeHead.hash === safe.hash;
}
function removeLogDerivedEvidence(operation) {
    const { transactionHint: _transactionHint, settlementEvidence: _settlementEvidence, ...withoutLogEvidence } = operation;
    return withoutLogEvidence;
}
function sameHead(left, right) {
    return left.number === right.number && left.hash === right.hash &&
        (left.timestamp === undefined || right.timestamp === undefined || left.timestamp === right.timestamp);
}
function sameOrigin(left, right) { return left === right; }
function settlementResponseTransaction(normalizedCanonicalJson) {
    try {
        const value = JSON.parse(normalizedCanonicalJson);
        return typeof value.transaction === "string" ? value.transaction : undefined;
    }
    catch {
        return undefined;
    }
}
function validHead(head) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(head.number) || !/^(?:0|[1-9][0-9]*)$/u.test(head.timestamp) ||
        !/^0x[0-9a-f]{64}$/u.test(head.hash) || /^0x0{64}$/u.test(head.hash) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(head.observedAt))
        return false;
    const observedAt = Date.parse(head.observedAt);
    if (!Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== head.observedAt)
        return false;
    return BigInt(head.timestamp) <= BigInt(Math.floor(observedAt / 1000));
}
function candidateKey(candidate) {
    return `${candidate.blockHash}\0${candidate.transactionHash}\0${candidate.logIndex}`;
}
function candidateFromLog(log, operation) {
    return {
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        authorizer: operation.wallet,
        nonce: operation.authorization.nonce,
    };
}
function matchingAuthorizationUsed(log, operation) {
    return log.address.toLowerCase() === BASE_USDC.toLowerCase() && log.topics.length === 3 &&
        log.topics[0]?.toLowerCase() === AUTHORIZATION_USED_TOPIC &&
        log.topics[1]?.toLowerCase() === paddedAddress(operation.wallet) &&
        log.topics[2]?.toLowerCase() === operation.authorization.nonce && log.data === "0x";
}
function matchingTransfer(log, operation) {
    if (log.address.toLowerCase() !== BASE_USDC.toLowerCase() || log.topics.length !== 3 ||
        log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics[1]?.toLowerCase() !== paddedAddress(operation.wallet) ||
        log.topics[2]?.toLowerCase() !== paddedAddress(operation.payee) || !/^0x[0-9a-f]{64}$/u.test(log.data))
        return false;
    return BigInt(log.data) === BigInt(operation.amountAtomic);
}
function paddedAddress(address) {
    return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}
//# sourceMappingURL=x402-rpc-reconciler.js.map