import { exactKeys, isPlainRecord } from "../../canonical.js";
import { mmFail } from "../reasons.js";
import { readDataRecord } from "./read-diagnostic.js";
/**
 * The facts are taken only from an answer APN's `tx` check refused: an object whose `from` is the owner and whose
 * chain id is the request's number passes that check, so such a set can only be forged and is refused.
 */
const SHAPES = ["object", "absent", "null", "other"];
const FROMS = ["owner", "other_address", "other_string", "absent", "other"];
const CHAIN_IDS = ["number", "decimal_string", "hex_string", "caip2_string", "other_string", "absent", "other"];
const READABLE = ["number", "decimal_string", "hex_string", "caip2_string"];
const KEYS = ["tx", "from", "chainId", "chainIdMatches"];
const NONE = { from: null, chainId: null, chainIdMatches: null };
export function jobTx(value, intent) {
    if (value === undefined)
        return { tx: "absent", ...NONE };
    if (value === null)
        return { tx: "null", ...NONE };
    if (!isPlainRecord(value))
        return { tx: "other", ...NONE };
    const chain = chainIdForm(value.chainId);
    return { tx: "object", from: fromForm(value.from, intent), chainId: chain.form,
        chainIdMatches: chain.id === undefined ? null : chain.id === intent.request.chainId };
}
function fromForm(value, intent) {
    // The same comparison as the check in client/service.ts, so `owner` says exactly that `from` passed it.
    if (String(value).toLowerCase() === intent.binding.address)
        return "owner";
    if (value === undefined)
        return "absent";
    if (typeof value !== "string")
        return "other";
    return /^0x[0-9a-fA-F]{40}$/u.test(value) ? "other_address" : "other_string";
}
function chainIdForm(value) {
    if (value === undefined)
        return { form: "absent" };
    if (typeof value === "number")
        return Number.isSafeInteger(value) ? { form: "number", id: value } : { form: "other" };
    if (typeof value !== "string")
        return { form: "other" };
    if (/^[1-9][0-9]{0,14}$/u.test(value))
        return { form: "decimal_string", id: Number(value) };
    if (/^0x[0-9a-fA-F]{1,12}$/u.test(value))
        return { form: "hex_string", id: Number.parseInt(value.slice(2), 16) };
    const caip = /^eip155:([1-9][0-9]{0,14})$/u.exec(value);
    return caip ? { form: "caip2_string", id: Number(caip[1]) } : { form: "other_string" };
}
export function validateJobTx(value, reason) {
    let d;
    try {
        d = readDataRecord(value);
    }
    catch {
        return mmFail(reason);
    }
    // Each field is read once from the data-only copy.
    const tx = d.tx, from = d.from, chainId = d.chainId, matches = d.chainIdMatches;
    const object = tx === "object", readable = typeof chainId === "string" && READABLE.includes(chainId);
    if (!exactKeys(d, KEYS) || typeof tx !== "string" || !SHAPES.includes(tx) ||
        (object ? typeof from !== "string" || !FROMS.includes(from) || typeof chainId !== "string" || !CHAIN_IDS.includes(chainId) ||
            (readable ? typeof matches !== "boolean" : matches !== null) || from === "owner" && chainId === "number" && matches === true
            : from !== null || chainId !== null || matches !== null))
        mmFail(reason);
    return Object.freeze({ tx, from, chainId, chainIdMatches: matches });
}
/** The facts as flat error details under `prefix` (ErrorDetail values only; a null fact is left out). */
export function jobTxDetails(prefix, t) {
    if (t === null)
        return {};
    return { [`${prefix}Tx`]: t.tx, ...(t.from === null ? {} : { [`${prefix}TxFrom`]: t.from }),
        ...(t.chainId === null ? {} : { [`${prefix}TxChainId`]: t.chainId }),
        ...(t.chainIdMatches === null ? {} : { [`${prefix}TxChainIdMatches`]: t.chainIdMatches }) };
}
/** The facts back from flat error details, or null when there are none; a malformed set refuses with `reason`. */
export function takeJobTx(prefix, x, reason) {
    if (x[`${prefix}Tx`] === undefined)
        return null;
    const value = (key) => x[`${prefix}${key}`] ?? null;
    return validateJobTx({ tx: x[`${prefix}Tx`], from: value("TxFrom"), chainId: value("TxChainId"), chainIdMatches: value("TxChainIdMatches") }, reason);
}
/** The facts in the output's own key style. */
export function jobTxOutput(t) {
    return t === null ? null : { tx: t.tx, from: t.from, chain_id: t.chainId, chain_id_matches: t.chainIdMatches };
}
//# sourceMappingURL=job-tx.js.map