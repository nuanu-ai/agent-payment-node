import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { StateStore } from "../state.js";
import { canonicalProfile } from "../wallet-policy.js";
import { permit2FactHash } from "./production-proxy-call.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { x402ProofTag } from "../x402-network.js";
import { inspectPermit2ProductionReceipt } from "./production-receipt-facts.js";
import { validatePermit2ProductionRecord } from "./production-repository.js";
import { permit2ProductionOperationDigest, validatePermit2ProductionSigned } from "./production-signed.js";
import { Permit2ObserverRpc } from "./production-observer-rpc.js";
import { assertExpiredUnused, assertObserverChain, nonceConsumed, observerBlock, observerNonceCalls, observerReceipt, observerTransaction } from "./production-observer-facts.js";
const proofs = new WeakMap();
function binding(record, signed, mode) {
    return canonicalJson({ mode, operationDigest: permit2ProductionOperationDigest(record), materialHash: record.material.materialHash,
        requestHash: record.material.checked.requestHash, challengeHash: record.material.checked.challengeHash, signedHash: signed?.signedHash ?? null });
}
/** Actual finite canonical observer only. No effect, journal, policy-admission or accounting mutation. */
export async function observePermit2Production(input) {
    // Every caller-owned field is copied/validated before the first await, including private context and bearer material.
    if (!isPlainRecord(input) || !exactKeys(input, ["profile", "stateRoot", "rpcUrl", "record", "signed", "mode", "locator"]))
        invalid();
    const profile = canonicalProfile(input.profile), stateRoot = input.stateRoot, endpoint = input.rpcUrl;
    const mode = input.mode, locator = input.locator;
    const record = validatePermit2ProductionRecord(JSON.parse(canonicalJson(input.record)));
    const supplied = input.signed === null ? null : JSON.parse(canonicalJson(input.signed));
    freezeObservationValue(record);
    freezeObservationValue(supplied);
    if (record.material.wallet.profile !== profile || typeof stateRoot !== "string" || !stateRoot || typeof endpoint !== "string" ||
        !["settlement", "expired_unused"].includes(mode) || mode === "settlement" && (locator !== null && !permit2FactHash(locator) || supplied === null) ||
        mode === "expired_unused" && locator !== null)
        invalid();
    let signed = null, block = null, transactionHash = null;
    let rpc = null;
    let tokenPermitOutcome = null;
    const projection = (outcome, reason) => Object.freeze({
        mode, outcome, reason, operationDigest: permit2ProductionOperationDigest(record), materialHash: record.material.materialHash,
        requestHash: record.material.checked.requestHash, challengeHash: record.material.checked.challengeHash,
        signedHash: signed?.signedHash ?? null, transactionHash, blockNumber: block?.number ?? null, blockHash: block?.hash ?? null,
        tokenPermitOutcome, rpc: rpc?.metrics() ?? Object.freeze({ attempts: 0, admissions: 0, physicalDispatches: 0, logicalReads: 0, errors: 0, methods: Object.freeze({}) })
    });
    try {
        if (supplied !== null)
            signed = await validatePermit2ProductionSigned(supplied, record);
        rpc = new Permit2ObserverRpc(endpoint, new StateStore(stateRoot));
        // Settlement is proven at the chain's stack tag (safe on Ethereum, Arbitrum and OP Stack, as for EIP-3009 x402;
        // finalized elsewhere); expiry is always a finalized proof.
        const tag = mode === "settlement" ? x402ProofTag(Number(reconstructPermit2ProductionMaterial(record.material).chain.slice(7))) : "finalized";
        const first = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: [tag, false] },
            ...(mode === "settlement" && locator !== null ? [{ method: "eth_getTransactionByHash", params: [locator] },
                { method: "eth_getTransactionReceipt", params: [locator] }] : [])]);
        assertObserverChain(first[0], record.material);
        const head = observerBlock(first[1], tag);
        if (mode === "settlement" && locator !== null) {
            // A transaction hash only names the settlement; the consumed nonce bit below decides it, whatever the facilitator's call shape.
            try {
                const transaction = observerTransaction(first[2], locator), receipt = observerReceipt(first[3], first[2]);
                const facts = await inspectPermit2ProductionReceipt(record, signed, transaction, receipt);
                const included = observerBlock((await rpc.batch([{ method: "eth_getBlockByNumber", params: [transaction.blockNumber, false] }]))[0], transaction.blockNumber);
                if (facts.receiptStatus !== "reverted_locator" && facts.attribution.transactionHash === locator &&
                    BigInt(facts.attribution.blockNumber) <= BigInt(head.number) && included.hash === facts.attribution.blockHash) {
                    transactionHash = locator;
                    tokenPermitOutcome = facts.attribution.tokenPermitOutcome;
                }
            }
            catch { /* batched, relayed or suffixed calls cannot be attributed byte for byte; the nonce bit still settles them */ }
        }
        block = head;
        // The nonce state is read pinned by EIP-1898 to that canonical block: no header recheck, and no re-read of the
        // immutable Permit2/proxy code or the token domain, which settlement and expiry do not depend on.
        const reads = await rpc.batch(observerNonceCalls(record.material, block));
        if (mode === "expired_unused")
            assertExpiredUnused(record.material, block, reads);
        else if (!nonceConsumed(record.material, reads[0]))
            return Object.freeze({ projection: projection("hold", "unavailable_or_mismatch"), proof: null });
        const checked = projection(mode === "settlement" ? "settled" : "expired_unused", "checked");
        const proof = Object.freeze({ kind: "checked-permit2-production-observation" });
        proofs.set(proof, { binding: binding(record, signed, mode), projection: checked });
        return Object.freeze({ projection: checked, proof });
    }
    catch {
        return Object.freeze({ projection: projection("hold", "unavailable_or_mismatch"), proof: null });
    }
    finally {
        rpc?.close();
    }
}
/** Later lifecycle code must consume this private capability, bound to the unchanged frozen operation and mode. */
export async function consumePermit2ObservationProof(proof, record, supplied, mode) {
    const saved = proofs.get(proof);
    if (saved === undefined)
        invalid();
    record = validatePermit2ProductionRecord(JSON.parse(canonicalJson(record)));
    const value = supplied === null ? null : JSON.parse(canonicalJson(supplied));
    freezeObservationValue(record);
    freezeObservationValue(value);
    const signed = value === null ? null : await validatePermit2ProductionSigned(value, record);
    // Check again after recovery: simultaneous consumers cannot both acquire authority.
    if (proofs.get(proof) !== saved || saved.binding !== binding(record, signed, mode))
        invalid();
    proofs.delete(proof);
    return saved.projection;
}
function freezeObservationValue(value) {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value))
            freezeObservationValue(child);
        Object.freeze(value);
    }
}
function invalid() { throw new ApnError("APN_X402_SETTLEMENT_INVALID", "Permit2 observation is not bound to the frozen operation."); }
//# sourceMappingURL=production-observer.js.map