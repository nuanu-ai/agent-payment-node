/** Read-only Base source reconciliation. No custody, send, destination, or route dependency. */
import { decodeFunctionData, getAddress, parseAbi } from "viem";
import { hashObject } from "../canonical.js";
import { decodeCircleV2BaseSourceReceiptOffline, BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "./circle-v2-source-receipt.js";
import { bridgeFailure } from "./validation.js";
const ABI = parseAbi(["function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable"]);
const BASE_USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const ZERO = `0x${"0".repeat(64)}`;
function inconsistent() { return bridgeFailure("APN_RPC_PROTOCOL", "circle_v2_source_inconsistent"); }
function assertProtocolInput(j, intent) {
    if (j.transactionHash !== intent.sourceTransactionHash || j.sourceCall.from !== intent.sourceFrom ||
        j.sourceCall.to !== BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES || j.sourceCall.valueAtomic !== "0")
        inconsistent();
    let decoded;
    try {
        decoded = decodeFunctionData({ abi: ABI, data: j.sourceCall.data });
    }
    catch {
        return inconsistent();
    }
    const args = decoded.args;
    if (decoded.functionName !== "depositForBurnWithHookAndFees" || !args ||
        args[0].toString() !== intent.amountAtomic || args[1] !== 5 ||
        args[2].toLowerCase() !== intent.solanaAtaBytes32.toLowerCase() ||
        args[3] !== BASE_USDC || args[4] !== ZERO ||
        args[5].toLowerCase() !== intent.hookData.toLowerCase())
        inconsistent();
}
function matchesPrior(j, next) {
    const previous = j.safeSourceProof;
    if (previous === null)
        return true;
    if (previous.provenance !== "rpc_observed_untrusted_circle_v2_base_source_v1")
        return false;
    return previous.transactionHash === next.transactionHash && previous.status === next.status &&
        previous.blockNumberAtomic === next.blockNumberAtomic && previous.blockHash === next.blockHash &&
        previous.logsHash === next.logsHash && previous.receiptHash === next.receiptHash &&
        previous.rpcOrigin === next.rpcOrigin && previous.protocolInputDigest === next.protocolInputDigest &&
        previous.protocolProofHash === next.protocolProofHash &&
        BigInt(next.safeBlockNumberAtomic) >= BigInt(previous.safeBlockNumberAtomic) &&
        (next.safeBlockNumberAtomic !== previous.safeBlockNumberAtomic || next.safeBlockHash === previous.safeBlockHash);
}
/** Rechecks the supplied RPC result and persists only untrusted source evidence. Any inconsistency clears an earlier proof. */
export async function reconcileCircleV2BaseSource(input) {
    const { journal: j, repository: repo, rpc, intent, observedAt } = input;
    if (j.route !== "base_usdc_to_solana_usdc_circle_cctp_v2" || j.transactionHash === null ||
        j.signedTransaction === null || j.submissionAttempts !== 1)
        inconsistent();
    const fail = async () => j.phase === "unknown_finality" ? j : repo.observeUnknown(j.profileHash, j.operationId, j.integrityHash, "circle_v2_source_inconsistent", observedAt);
    try {
        if (rpc.chainId !== 8453 || rpc.origin !== input.expectedRpcOrigin)
            inconsistent();
        assertProtocolInput(j, intent);
        const observed = await rpc.observe(j.transactionHash);
        if (observed === null)
            inconsistent();
        const tx = observed.transaction, receipt = observed.receipt, safe = tx.safeBlock;
        if (safe === null || tx.chainId !== 8453 || receipt.chainId !== 8453 ||
            tx.transactionHash !== j.transactionHash || receipt.transactionHash !== j.transactionHash ||
            tx.rpcOrigin !== input.expectedRpcOrigin || tx.from !== j.sourceCall.from || tx.to !== j.sourceCall.to ||
            tx.valueAtomic !== j.sourceCall.valueAtomic || tx.dataHash !== j.sourceCall.dataSha256 ||
            tx.nonceAtomic !== j.sourceCall.nonceAtomic || tx.gasLimitAtomic !== j.sourceCall.gasLimitAtomic ||
            tx.maxFeePerGasAtomic !== j.sourceCall.maxFeePerGasAtomic ||
            tx.maxPriorityFeePerGasAtomic !== j.sourceCall.maxPriorityFeePerGasAtomic ||
            receipt.blockHash !== tx.block.hash || receipt.blockNumberAtomic !== tx.block.numberAtomic ||
            hashObject(receipt.logs) !== tx.logsHash || BigInt(safe.numberAtomic) < BigInt(tx.block.numberAtomic))
            inconsistent();
        // A concrete BridgeRpc adapter reconstructs the transaction and verifies receipt membership;
        // this structural port also accepts synthetic adapters, so its result has untrusted provenance.
        const proof = tx.status === "success" ? decodeCircleV2BaseSourceReceiptOffline(intent, { chainId: 8453, hash: tx.transactionHash, from: tx.from, to: tx.to }, { chainId: 8453, transactionHash: receipt.transactionHash, status: "0x1", blockHash: receipt.blockHash,
            blockNumberAtomic: receipt.blockNumberAtomic, logs: receipt.logs }) : null;
        const next = {
            provenance: "rpc_observed_untrusted_circle_v2_base_source_v1", transactionHash: tx.transactionHash,
            status: tx.status, blockNumberAtomic: tx.block.numberAtomic, blockHash: tx.block.hash,
            safeBlockNumberAtomic: safe.numberAtomic, safeBlockHash: safe.hash, observedAt,
            rpcOrigin: tx.rpcOrigin, logsHash: tx.logsHash, receiptHash: hashObject(receipt),
            protocolInputDigest: hashObject({ version: "circle_v2_base_source_input_v1", sourceCall: j.sourceCall,
                intent: { sourceTransactionHash: intent.sourceTransactionHash, sourceFrom: intent.sourceFrom,
                    amountAtomic: intent.amountAtomic, solanaAtaBytes32: intent.solanaAtaBytes32,
                    maxFeeAtomic: intent.maxFeeAtomic, minFinalityThreshold: intent.minFinalityThreshold,
                    hookData: intent.hookData } }),
            protocolProofHash: proof === null ? null : hashObject(proof), executionAdmitted: false, bridgeCompletion: false,
        };
        if (!matchesPrior(j, next))
            inconsistent();
        if (j.phase === "source_observed_untrusted")
            return j;
        return await repo.recordRpcObservedCircleSource(j.profileHash, j.operationId, j.integrityHash, next, observedAt);
    }
    catch {
        return await fail();
    }
}
//# sourceMappingURL=non-evm-source-reconciliation.js.map