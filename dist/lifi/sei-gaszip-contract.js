import { getAddress } from "viem";
import { ApnError } from "../errors.js";
import { hashObject } from "../canonical.js";
/** A separate GasZip direct deposit; never grants LI.FI GasZip execution. */
export const SEI_FUNDING = Object.freeze({ sourceChain: 8453, destinationChain: 1329, short: 246,
    target: getAddress("0x391E7C679d29bD940d63be94AD22A25d25b5A604"), data: "0x0100f6",
    maximumAmount: 10000000000000n, maximumFee: 1000000000000n, minimumOutput: 250000000000000000n,
    mechanism: { provider: "gaszip", reference: "v2-direct-base-sei-self-0100f6.1" } });
export function seiFail(reason) { throw new ApnError("APN_OPERATION_BLOCKED", `sei_gaszip_${reason}`, { reason: `sei_gaszip_${reason}` }); }
export function seiObject(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v))
        seiFail("object");
    return v;
}
export function seiUint(v) {
    if (typeof v !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(v))
        seiFail("exact_uint");
    return BigInt(v);
}
export function seiQuantity(v) {
    if (typeof v !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(v))
        seiFail("rpc_quantity");
    return BigInt(v);
}
export function seiHash(v) {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(v))
        seiFail("hash");
    return v.toLowerCase();
}
export function seiAddress(v) {
    if (typeof v !== "string")
        seiFail("address");
    try {
        return getAddress(v);
    }
    catch {
        return seiFail("address");
    }
}
/** Parse integer lexemes without Number rounding. Unsafe numeric inputs supplied without their source are refused. */
export function seiJson(text) {
    try {
        return JSON.parse(text, ((key, value, context) => {
            if (typeof value !== "number")
                return value;
            if (context?.source !== undefined && /^(?:0|[1-9][0-9]*)$/u.test(context.source))
                return context.source;
            if (!Number.isFinite(value) || !Number.isSafeInteger(value) && Number.isInteger(value))
                seiFail("unsafe_json_number");
            return value;
        }));
    }
    catch {
        return seiFail("json");
    }
}
export function seiExact(v, required, optional = []) {
    if (required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k)))
        seiFail("schema");
}
export function inspectSeiFundingQuote(value, now) {
    const v = seiObject(value);
    seiExact(v, ["calldata", "expires", "quotes"], ["contractDepositTxn"]);
    if (v.calldata !== SEI_FUNDING.data || !Array.isArray(v.quotes) || v.quotes.length !== 1)
        seiFail("quote_lane");
    const q = seiObject(v.quotes[0]);
    seiExact(q, ["chain", "expected", "gas", "speed", "usd"], ["decimals", "expectedNative"]);
    if (seiUint(q.chain) !== 1329n || (q.decimals !== undefined && seiUint(q.decimals) !== 18n) ||
        (q.expectedNative !== undefined && seiUint(q.expectedNative) !== seiUint(q.expected)) || seiUint(q.expected) < SEI_FUNDING.minimumOutput ||
        typeof q.speed !== "number" && typeof q.speed !== "string" || typeof q.usd !== "number" && typeof q.usd !== "string")
        seiFail("quote_output");
    seiUint(q.gas);
    const expires = seiUint(v.expires);
    if (expires > BigInt(Number.MAX_SAFE_INTEGER) || Number(expires) * 1000 - now < 30_000 || Number(expires) * 1000 - now > 90_000)
        seiFail("quote_expiry");
    return { digest: hashObject(value), expiresAt: new Date(Number(expires) * 1000).toISOString(), expectedAtomic: seiUint(q.expected).toString(), body: value };
}
/** Provider mapping authorizes observation only; both effects must be independently proved by their chain RPC. */
export function inspectSeiDelivery(value, sourceHash, owner, amount, sourceBlock) {
    const v = seiObject(value);
    seiExact(v, ["deposit", "txs"]);
    const d = seiObject(v.deposit);
    seiExact(d, ["block", "chain", "hash", "log", "sender", "shorts", "status", "time", "to", "usd", "value"]);
    if (seiHash(d.hash) !== sourceHash || seiUint(d.chain) !== 8453n || seiAddress(d.sender) !== owner || seiUint(d.value) !== seiUint(amount) ||
        seiAddress(d.to) !== owner || !Array.isArray(d.shorts) || d.shorts.length !== 1 || seiUint(d.shorts[0]) !== 246n)
        seiFail("deposit_binding");
    if (sourceBlock !== undefined && seiUint(d.block).toString() !== sourceBlock)
        seiFail("deposit_block_binding");
    if (!["SEEN", "PENDING", "CONFIRMED", "PRIORITY", "CANCELLED"].includes(String(d.status)))
        seiFail("deposit_status");
    if (d.status !== "CONFIRMED")
        return null;
    if (!Array.isArray(v.txs) || v.txs.length > 8)
        seiFail("delivery_count");
    const rows = v.txs.map(seiObject);
    if (rows.some(t => seiUint(t.chain) !== 1329n))
        seiFail("unexpected_outbound_chain");
    if (rows.length === 0)
        return null;
    if (rows.length !== 1)
        seiFail("delivery_ambiguous");
    const t = rows[0];
    seiExact(t, ["chain", "hash", "nonce", "refund", "cancelled", "signer", "status", "time", "to", "usd", "value"]);
    if (t.refund !== false || t.cancelled !== false || seiAddress(t.to) !== owner)
        seiFail("delivery_binding");
    if (!["SEEN", "PENDING", "CONFIRMED", "PRIORITY", "CANCELLED"].includes(String(t.status)))
        seiFail("outbound_status");
    if (t.status !== "CONFIRMED")
        return null;
    const output = seiUint(t.value);
    if (output < SEI_FUNDING.minimumOutput)
        seiFail("delivery_floor");
    return { hash: seiHash(t.hash), amount: output.toString(), signer: seiAddress(t.signer), nonce: seiUint(t.nonce).toString(), providerDigest: hashObject(value) };
}
//# sourceMappingURL=sei-gaszip-contract.js.map