/**
 * Proof that a signed EVM transaction which never crossed its send fence can never land. Bytes that never left APN were
 * never on any chain, so a node's pruned transaction index cannot hide them; bytes that MAY have been broadcast use the
 * shared never-lands rule instead (src/evm-finalized-proof.ts), which needs the effect's era.
 *
 * Its account nonce at the safe head is already past the signed nonce, so another transaction consumed that nonce
 * at safe depth, and the node does not know the signed hash, so it is not that transaction. The signed bytes can
 * then never be included; the effect may end as "never landed" and its hold be released. Any other read keeps the
 * effect resumable (nonce not consumed) or under normal observation (own transaction known).
 */
import { ApnError } from "./errors.js";
function quantity(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value))
        throw new ApnError("APN_RPC_PROTOCOL", "EVM nonce read is malformed.");
    return BigInt(value);
}
export async function evmUnsentOutcome(read, input) {
    if (!/^0x[0-9a-fA-F]{40}$/u.test(input.account) || !/^0x[0-9a-fA-F]{64}$/u.test(input.transactionHash) || input.nonce < 0n)
        throw new ApnError("APN_INVALID_INPUT", "Unsent EVM effect identity is invalid.");
    if (quantity(await read("eth_getTransactionCount", [input.account, "safe"])) <= input.nonce)
        return "nonce_not_consumed";
    return await read("eth_getTransactionByHash", [input.transactionHash]) === null ? "never_lands" : "own_transaction_known";
}
//# sourceMappingURL=evm-unsent-outcome.js.map