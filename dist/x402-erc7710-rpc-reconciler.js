import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { BASE_USDC, CHAIN_CAIP2 } from "./constants.js";
import { matchingTransfer } from "./x402-rpc-scan.js";
import { appendX402Transition, sealX402Operation, x402OperationBindingHash, } from "./x402-state-integrity.js";
const MAX_EXPIRY_BOUND_READS = 4;
export class X402Erc7710RpcReconciler {
    rpc;
    clock;
    store;
    constructor(rpc, clock, store) {
        this.rpc = rpc;
        this.clock = clock;
        this.store = store;
    }
    async reconcile(operation) {
        if (operation.selectedOffer.resolved.assetTransferMethod !== "erc7710" ||
            operation.settlementEvidence !== undefined || operation.unusedExpiryEvidence !== undefined ||
            operation.delegatedMaterial === undefined)
            return operation;
        // Any Base endpoint may reconcile; one pass must come from one endpoint, recorded in the evidence as provenance.
        const chain = await this.rpc.assertBaseChain();
        if (this.canProveExpiredUnused(operation)) {
            return await this.reconcileExpiredUnused(operation, chain.rpcOrigin);
        }
        if (operation.transactionHint === undefined || operation.settlementResponseObservation === undefined ||
            operation.signatureHash === undefined || operation.paymentContextHash === undefined)
            return operation;
        // The safe head is read once; the transaction block read below is the canonical-membership check of the receipt.
        const safe = await this.rpc.getX402Head("safe");
        let receipt;
        try {
            receipt = await this.rpc.getX402Receipt(operation.transactionHint.transactionHash);
        }
        catch {
            return operation;
        }
        if (receipt === null || receipt.status !== "success" ||
            receipt.transactionHash !== operation.transactionHint.transactionHash ||
            BigInt(receipt.blockNumber) > BigInt(safe.number))
            return operation;
        let transactionBlock;
        try {
            transactionBlock = await this.rpc.getX402Block(receipt.blockNumber);
        }
        catch {
            return operation;
        }
        if (transactionBlock.number !== receipt.blockNumber || transactionBlock.hash !== receipt.blockHash)
            return operation;
        const transfers = receipt.logs.filter((log) => matchingTransfer(log, operation));
        if (transfers.length !== 1 || transfers[0] === undefined)
            return operation;
        const transfer = transfers[0];
        const methodBinding = {
            paymentResponseHash: operation.settlementResponseObservation.settlementResponseHash,
            operationBindingHash: x402OperationBindingHash(operation),
            offerHash: operation.selectedOffer.offerHash,
            method: "erc7710",
            delegationManager: operation.delegatedMaterial.delegationManager,
            delegator: operation.wallet,
            childHash: operation.signatureHash,
            permissionContextHash: operation.paymentContextHash,
        };
        const body = {
            schemaVersion: "apn.x402.erc7710-settlement-evidence.v1",
            network: CHAIN_CAIP2,
            chainId: "8453",
            token: BASE_USDC.toLowerCase(),
            transactionHash: operation.transactionHint.transactionHash,
            safeHead: { number: safe.number, hash: safe.hash, observedAt: safe.observedAt },
            transactionBlock: {
                number: transactionBlock.number,
                hash: transactionBlock.hash,
                timestamp: transactionBlock.timestamp,
            },
            receiptStatus: "1",
            blockHashRechecked: true,
            transfer: {
                logIndex: transfer.logIndex,
                from: operation.wallet,
                to: operation.payee,
                value: operation.amountAtomic,
                blockNumber: transfer.blockNumber,
                blockHash: transfer.blockHash,
                transactionHash: transfer.transactionHash,
            },
            methodBinding,
            rpcOriginHash: sha256(chain.rpcOrigin),
        };
        const evidence = {
            ...body,
            evidenceHash: domainHash("apn.x402.erc7710-settlement-evidence.v1", canonicalJson(body)),
        };
        const at = this.clock.now().toISOString();
        const { integrityHash: _integrity, ...withoutIntegrity } = operation;
        const next = sealX402Operation({
            ...withoutIntegrity,
            settlementEvidence: evidence,
            updatedAt: at,
            transitions: appendX402Transition(operation.transitions, {
                at,
                state: operation.state,
                terminal: false,
                reason: operation.reason,
                proofClass: operation.proofClass,
            }),
        });
        await this.store.persist(next);
        return next;
    }
    canProveExpiredUnused(operation) {
        return operation.state === "effect_unknown" && operation.transactionHint === undefined &&
            // A body kept without a settlement answer settles nothing: the scan still decides whether the transfer happened.
            operation.settlementResponseObservation === undefined && operation.settlementEvidence === undefined &&
            operation.signatureHash !== undefined &&
            operation.paymentContextHash !== undefined &&
            operation.attempts.some((attempt) => attempt.purpose === "payment" && attempt.phase !== "pending");
    }
    async reconcileExpiredUnused(operation, rpcOrigin) {
        const binding = operation.delegatedMaterial;
        if (binding === undefined)
            return operation;
        let finalized;
        try {
            finalized = await this.rpc.getX402Head("finalized");
        }
        catch {
            return operation;
        }
        if (BigInt(finalized.timestamp) < BigInt(binding.effectiveExpiryUnix) ||
            BigInt(finalized.number) < BigInt(operation.preparedBlock.number))
            return operation;
        let startBlock;
        try {
            startBlock = await this.rpc.getX402Block(operation.preparedBlock.number);
        }
        catch {
            return operation;
        }
        if (startBlock.number !== operation.preparedBlock.number || startBlock.hash !== operation.preparedBlock.hash ||
            BigInt(startBlock.timestamp) >= BigInt(binding.effectiveExpiryUnix))
            return operation;
        const expiryBlock = await this.expiryBound(startBlock, finalized, binding.effectiveExpiryUnix, rpcOrigin);
        if (expiryBlock === null)
            return operation;
        // Finalized blocks do not reorg and every read above is from this pass's endpoint, so no recheck follows the scan.
        if (!await this.scanNoPayeeTransfer(operation, startBlock.number, expiryBlock.number))
            return operation;
        const completedAt = this.clock.now().toISOString();
        const body = {
            schemaVersion: "apn.x402.erc7710-unused-expiry-evidence.v1",
            network: CHAIN_CAIP2,
            chainId: "8453",
            token: BASE_USDC.toLowerCase(),
            effectiveExpiryUnix: binding.effectiveExpiryUnix,
            searchStartBlock: {
                number: operation.preparedBlock.number,
                hash: operation.preparedBlock.hash,
                observedAt: operation.preparedBlock.observedAt,
            },
            expiryBlock: {
                number: expiryBlock.number,
                hash: expiryBlock.hash,
                timestamp: expiryBlock.timestamp,
                observedAt: expiryBlock.observedAt,
            },
            finalizedHead: {
                number: finalized.number,
                hash: finalized.hash,
                timestamp: finalized.timestamp,
                observedAt: finalized.observedAt,
            },
            scan: {
                fromBlock: operation.preparedBlock.number,
                toBlock: expiryBlock.number,
                matchingTransferCount: "0",
                completedAt,
            },
            methodBinding: {
                operationBindingHash: x402OperationBindingHash(operation),
                offerHash: operation.selectedOffer.offerHash,
                method: "erc7710",
                delegationManager: binding.delegationManager,
                delegator: operation.wallet,
                childHash: operation.signatureHash,
                permissionContextHash: operation.paymentContextHash,
            },
            rpcOriginHash: sha256(rpcOrigin),
        };
        const evidence = {
            ...body,
            evidenceHash: domainHash("apn.x402.erc7710-unused-expiry-evidence.v1", canonicalJson(body)),
        };
        const { integrityHash: _integrity, ...withoutIntegrity } = operation;
        const next = sealX402Operation({
            ...withoutIntegrity,
            unusedExpiryEvidence: evidence,
            updatedAt: completedAt,
            transitions: appendX402Transition(operation.transitions, {
                at: completedAt,
                state: operation.state,
                terminal: false,
                reason: operation.reason,
                proofClass: operation.proofClass,
            }),
        });
        await this.store.persist(next);
        return next;
    }
    /**
     * A block at or after the delegation's expiry that closes the scan range. Any such block is sound: the timestamp
     * caveat refuses redemption from it on, and a later bound only widens the scan. Block times are near-constant, so
     * interpolation between the prepared block and the finalized head lands on the first expired block in one header
     * read (was a binary search of ~log2(range) reads plus four rechecks); a guess that falls short of the expiry moves
     * the lower end and tries again, and the finalized head itself is the bound when the reads run out.
     */
    async expiryBound(start, finalized, expiryUnix, rpcOrigin) {
        const expiry = BigInt(expiryUnix), high = BigInt(finalized.number), highTimestamp = BigInt(finalized.timestamp);
        let low = { number: BigInt(start.number), timestamp: BigInt(start.timestamp) };
        for (let reads = 0; reads < MAX_EXPIRY_BOUND_READS && high - low.number > 1n; reads += 1) {
            const span = high - low.number, elapsed = highTimestamp - low.timestamp;
            let guess = low.number + ((expiry - low.timestamp) * span + elapsed - 1n) / elapsed;
            if (guess >= high)
                guess = high - 1n;
            if (guess <= low.number)
                guess = low.number + 1n;
            let block;
            try {
                block = await this.rpc.getX402Block(guess.toString());
            }
            catch {
                return null;
            }
            if (block.number !== guess.toString())
                return null;
            if (BigInt(block.timestamp) >= expiry)
                return block;
            low = { number: guess, timestamp: BigInt(block.timestamp) };
        }
        return finalized;
    }
    /**
     * True only when the window holds no Transfer of this token from the wallet to the payee, of ANY value. The child
     * delegation caps a cumulative amount ("up to"), so a redemption of less than the amount, or of two parts, is still
     * a redemption: any such Transfer (or a same-payee payment outside this operation) leaves the operation unresolved,
     * with owner abandon as its exit. Every log the port returns already is such a Transfer (its adapter refuses others).
     */
    async scanNoPayeeTransfer(operation, startNumber, endNumber) {
        let from = BigInt(startNumber);
        const end = BigInt(endNumber);
        let chunkSize = 2048n;
        while (from <= end) {
            const to = from + chunkSize - 1n < end ? from + chunkSize - 1n : end;
            let result;
            try {
                result = await this.rpc.getX402TransferLogs({
                    from: operation.wallet,
                    to: operation.payee,
                    fromBlock: from.toString(),
                    toBlock: to.toString(),
                });
            }
            catch {
                return false;
            }
            if (result.kind === "range_unavailable" && chunkSize > 1n) {
                chunkSize = chunkSize / 2n;
                continue;
            }
            if (result.kind !== "complete")
                return false;
            if (result.logs.length > 0)
                return false;
            from = to + 1n;
        }
        return true;
    }
}
//# sourceMappingURL=x402-erc7710-rpc-reconciler.js.map