import { checkNeverLands } from "../evm-finalized-proof.js";
import { evmRpcQuantity } from "../evm-rpc-codec.js";
import { circleCorrupt } from "./operation-model.js";
/**
 * The shared never-lands rule (R4 exit 2) for one sent Circle effect: at the finalized tag its signer's nonce is past
 * the envelope nonce while a node indexing the envelope's era block (read before signing, hash-bound into the envelope)
 * knows neither the transaction nor a receipt. An envelope written before eras were recorded never proves it; its exit is
 * the owner's abandon.
 */
async function circleNeverLands(rpc, effect) {
    const e = effect.envelope, era = e.eraBlock;
    if (e.chainId !== rpc.chainId)
        circleCorrupt("never_lands_chain");
    return await checkNeverLands({ chainId: e.chainId, account: e.from, nonce: BigInt(e.nonceAtomic),
        transactionHash: effect.transactionHash ?? circleCorrupt("unsent_hash_missing"),
        ...(era === undefined ? {} : { before: { hash: era.hash, number: BigInt(era.numberAtomic) } }) }, async (calls) => await rpc.finalizedBatch(calls));
}
/** A possibly-broadcast approval or burn (submission fence crossed, no receipt proof). */
export async function circleSentOutcome(rpc, effect) {
    const check = await circleNeverLands(rpc, effect);
    return check.neverLands ? "never_lands" : check.receiptFound || check.transactionKnown ? "own_transaction_known" : "not_proven";
}
/**
 * A possibly-broadcast mint or cleanup. Below the finalized nonce, a hash the node holds neither as a transaction nor a
 * receipt may be re-sent as the identical bytes only while the latest nonce has not passed them (same hash and nonce:
 * at most one inclusion); the latest nonce is read after the lookups, so an inclusion between them reads as moved on.
 */
export async function circleAmbiguousOutcome(rpc, effect) {
    const check = await circleNeverLands(rpc, effect), nonce = BigInt(effect.envelope.nonceAtomic);
    if (check.neverLands)
        return "never_lands";
    if (check.receiptFound || check.transactionKnown)
        return "own_transaction_known";
    if (check.finalizedNonce > nonce)
        return "other_transaction_pending";
    const [latest] = await rpc.finalizedBatch([{ method: "eth_getTransactionCount", params: [effect.envelope.from, "latest"] }]);
    return evmRpcQuantity(latest) <= nonce ? "resend_identical" : "other_transaction_pending";
}
/** The era an envelope records: the latest block its RPC returned while freezing it, before anything was signed. */
export function circleEnvelopeEra(block) {
    return { numberAtomic: evmRpcQuantity(block.number).toString(), hash: circleEraHash(block.hash) };
}
function circleEraHash(value) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value) || /^0x0{64}$/u.test(value))
        circleCorrupt("era_block_hash");
    return value.toLowerCase();
}
//# sourceMappingURL=funding-never-lands.js.map