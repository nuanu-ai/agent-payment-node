import { address, getCompiledTransactionMessageDecoder, getSignatureFromTransaction, getTransactionDecoder } from "@solana/kit";
import { canonicalJson, domainHash, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { rpcArray, rpcAtomic, rpcRecord, solanaSignature } from "../../solana/rpc.js";
import { validateSwapOperation } from "../model.js";
import { sha256Hex, USDC_MINT } from "./pins.js";
/**
 * Observe-only receipt reader. A finalized success must carry the exact signature and message, a fee within the
 * approved fee, a SOL spend within the approved maximum, and a USDC delta on the owner's account of at least the
 * minimum. A finalized failure proves every instruction reverted and only the fee was spent.
 */
export class OrcaReceiptObserver {
    rpc;
    now;
    constructor(rpc, now) {
        this.rpc = rpc;
        this.now = now;
    }
    async observeOutcome(operationValue, binding, material, signature) {
        const operation = validateSwapOperation(operationValue);
        solanaSignature(signature);
        if (operation.submissionMarker === null || operation.submissionMarker.markerHash !== binding.submissionMarkerHash) {
            blocked("Orca observation is forbidden before the durable submission marker.", "orca_observation_before_marker");
        }
        const statusParams = [[signature], { searchTransactionHistory: true }];
        const statuses = rpcArray(rpcRecord(await this.rpc.call("getSignatureStatuses", statusParams)).value, 1);
        if (statuses.length !== 1)
            conflict();
        if (statuses[0] === null)
            return null;
        const status = rpcRecord(statuses[0]);
        if (status.confirmationStatus !== "finalized")
            return null;
        const slot = rpcAtomic(status.slot);
        const transactionParams = [signature, { encoding: "base64", commitment: "finalized", maxSupportedTransactionVersion: 0 }];
        const raw = await this.rpc.call("getTransaction", transactionParams);
        if (raw === null)
            return null;
        const response = rpcRecord(raw), meta = rpcRecord(response.meta);
        // The Solana transport parses every JSON number as a bigint, so the v0 marker arrives as 0n.
        if (rpcAtomic(response.slot) !== slot || rpcAtomic(response.version) !== 0n)
            conflict();
        const encoded = rpcArray(response.transaction, 2);
        if (encoded.length !== 2 || encoded[1] !== "base64" || typeof encoded[0] !== "string" || encoded[0].length > 4_096)
            conflict();
        let wire;
        try {
            wire = getTransactionDecoder().decode(Buffer.from(encoded[0], "base64"));
        }
        catch {
            return conflict();
        }
        if (getSignatureFromTransaction(wire) !== signature || sha256Hex(new Uint8Array(wire.messageBytes)) !== binding.messageHash)
            conflict();
        const fee = rpcAtomic(meta.fee);
        if (fee > BigInt(binding.networkFeeLamports))
            conflict();
        const observedAt = this.now().toISOString(), statusErr = status.err ?? null, metaErr = meta.err;
        if ((statusErr === null) !== (metaErr === null))
            conflict();
        if (metaErr !== null) {
            const receiptHash = domainHash("apn.orca-revert-proof.v1", canonicalJson({ signature, slot: slot.toString(), fee: fee.toString(),
                error: canonical(metaErr), messageHash: binding.messageHash, bindingHash: binding.bindingHash, observedAt }));
            return { outcome: "reverted", proof: { receiptHash, transactionHash: signature, observedAt, finalized: true } };
        }
        const loaded = isPlainRecord(meta.loadedAddresses) ? meta.loadedAddresses : { writable: [], readonly: [] };
        if (rpcArray(loaded.writable ?? [], 0).length !== 0 || rpcArray(loaded.readonly ?? [], 0).length !== 0)
            conflict();
        const pre = rpcArray(meta.preBalances, 64).map(rpcAtomic), post = rpcArray(meta.postBalances, 64).map(rpcAtomic);
        if (pre.length !== post.length || pre.length < 1)
            conflict();
        const spent = pre[0] - post[0];
        if (spent < fee || spent > BigInt(material.execution.maximumSolSpendLamports))
            conflict();
        const usdcIndex = accountIndex(new Uint8Array(wire.messageBytes), material.execution.plan.usdcAccount);
        const before = usdcBalance(meta.preTokenBalances, usdcIndex, operation.quote.account, true);
        const after = usdcBalance(meta.postTokenBalances, usdcIndex, operation.quote.account, false);
        const received = after - before;
        if (received < BigInt(operation.quote.minimumOutputAtomic))
            conflict();
        const receiptHash = domainHash("apn.orca-finalized-receipt.v1", canonicalJson({ signature, slot: slot.toString(), fee: fee.toString(),
            solSpentLamports: spent.toString(), usdcReceivedAtomic: received.toString(), messageHash: binding.messageHash,
            bindingHash: binding.bindingHash, observedAt }));
        return { outcome: "succeeded", proof: { receiptHash, transactionHash: signature, observedAt, finalized: true } };
    }
}
/** Static key index in the exact bound v0 message, which has no lookup tables. */
function accountIndex(messageBytes, key) {
    let index;
    try {
        index = getCompiledTransactionMessageDecoder().decode(messageBytes).staticAccounts.indexOf(address(key));
    }
    catch {
        return conflict();
    }
    if (index < 0)
        conflict();
    return index;
}
function usdcBalance(value, index, owner, allowMissing) {
    let found;
    for (const item of rpcArray(value ?? [], 64)) {
        const balance = rpcRecord(item);
        if (Number(rpcAtomic(balance.accountIndex)) !== index)
            continue;
        const amount = rpcRecord(balance.uiTokenAmount);
        if (balance.mint !== USDC_MINT || balance.owner !== owner || rpcAtomic(amount.decimals) !== 6n || typeof amount.amount !== "string" ||
            !/^(?:0|[1-9][0-9]{0,19})$/u.test(amount.amount) || found !== undefined)
            conflict();
        found = BigInt(amount.amount);
    }
    if (found === undefined && !allowMissing)
        conflict();
    return found ?? 0n;
}
function canonical(value) { return JSON.parse(JSON.stringify(value, (_key, entry) => typeof entry === "bigint" ? entry.toString() : entry)); }
function conflict() { throw new ApnError("APN_OPERATION_BLOCKED", "Finalized Orca transaction evidence conflicts with the signed binding.", { reason: "orca_receipt_conflict" }); }
function blocked(message, reason) { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
//# sourceMappingURL=receipt.js.map