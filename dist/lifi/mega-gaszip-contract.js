import { inspectGaszipNativeDelivery } from "./gaszip-native-delivery.js";
import { getAddress } from "viem";
import { ApnError } from "../errors.js";
import { hashObject } from "../canonical.js";
/** A separate GasZip direct deposit; never grants LI.FI GasZip execution. */
export const MEGA_FUNDING = Object.freeze({ sourceChain: 8453, destinationChain: 4326, short: 514,
    owner: getAddress("0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14"), profile: "default",
    target: getAddress("0x391E7C679d29bD940d63be94AD22A25d25b5A604"), data: "0x010202",
    maximumAmount: 10000000000000n, maximumFee: 1000000000000n, minimumOutput: 8000000000000n,
    mechanism: { provider: "gaszip", reference: "v2-direct-base-mega-self-010202.1" } });
export function megaFail(reason) { throw new ApnError("APN_OPERATION_BLOCKED", `mega_gaszip_${reason}`, { reason: `mega_gaszip_${reason}` }); }
export function megaObject(v) {
    if (v === null || typeof v !== "object" || Array.isArray(v))
        megaFail("object");
    return v;
}
export function megaUint(v) {
    if (typeof v !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(v))
        megaFail("exact_uint");
    return BigInt(v);
}
export function megaQuantity(v) {
    if (typeof v !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(v))
        megaFail("rpc_quantity");
    return BigInt(v);
}
export function megaHash(v) {
    if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(v))
        megaFail("hash");
    return v.toLowerCase();
}
export function megaAddress(v) {
    if (typeof v !== "string")
        megaFail("address");
    try {
        return getAddress(v);
    }
    catch {
        return megaFail("address");
    }
}
/** Parse integer lexemes without Number rounding. Unsafe numeric inputs supplied without their source are refused. */
export function megaJson(text) {
    try {
        return JSON.parse(text, ((key, value, context) => {
            if (typeof value !== "number")
                return value;
            if (context?.source !== undefined && /^(?:0|[1-9][0-9]*)$/u.test(context.source))
                return context.source;
            if (!Number.isFinite(value) || !Number.isSafeInteger(value) && Number.isInteger(value))
                megaFail("unsafe_json_number");
            return value;
        }));
    }
    catch {
        return megaFail("json");
    }
}
export function megaExact(v, required, optional = []) {
    if (required.some(k => !Object.hasOwn(v, k)) || Object.keys(v).some(k => !required.includes(k) && !optional.includes(k)))
        megaFail("schema");
}
export function inspectMegaFundingQuote(value, now) {
    const v = megaObject(value);
    megaExact(v, ["calldata", "expires", "quotes"], ["contractDepositTxn"]);
    if (v.calldata !== MEGA_FUNDING.data || !Array.isArray(v.quotes) || v.quotes.length !== 1)
        megaFail("quote_lane");
    const q = megaObject(v.quotes[0]);
    megaExact(q, ["chain", "expected", "gas", "speed", "usd"], ["decimals", "expectedNative"]);
    if (megaUint(q.chain) !== 4326n || (q.decimals !== undefined && megaUint(q.decimals) !== 18n) ||
        (q.expectedNative !== undefined && megaUint(q.expectedNative) !== megaUint(q.expected)) || megaUint(q.expected) < MEGA_FUNDING.minimumOutput ||
        typeof q.speed !== "number" && typeof q.speed !== "string" || typeof q.usd !== "number" && typeof q.usd !== "string")
        megaFail("quote_output");
    megaUint(q.gas);
    const expires = megaUint(v.expires);
    if (expires > BigInt(Number.MAX_SAFE_INTEGER) || Number(expires) * 1000 - now < 30_000 || Number(expires) * 1000 - now > 90_000)
        megaFail("quote_expiry");
    return { digest: hashObject(value), expiresAt: new Date(Number(expires) * 1000).toISOString(), expectedAtomic: megaUint(q.expected).toString(), body: value };
}
/** Provider mapping authorizes observation only; both effects must be independently proved by their chain RPC. */
export function inspectMegaDelivery(value, sourceHash, owner, amount, sourceBlock) {
    if (owner !== MEGA_FUNDING.owner)
        megaFail("owner_pin");
    const v = megaObject(value);
    megaExact(v, ["deposit", "txs"]);
    const d = megaObject(v.deposit);
    if (Object.hasOwn(d, "seen"))
        return inspectGaszipNativeDelivery(value, sourceHash, owner, amount, sourceBlock, 4326, 514, MEGA_FUNDING.minimumOutput, { fail: megaFail, object: megaObject, uint: megaUint, quantity: megaQuantity, hash: megaHash, address: megaAddress, exact: megaExact });
    megaExact(d, ["block", "chain", "hash", "log", "sender", "shorts", "status", "time", "to", "usd", "value"]);
    if (megaHash(d.hash) !== sourceHash || megaUint(d.chain) !== 8453n || megaAddress(d.sender) !== owner || megaUint(d.value) !== megaUint(amount) ||
        megaAddress(d.to) !== owner || !Array.isArray(d.shorts) || d.shorts.length !== 1 || megaUint(d.shorts[0]) !== 514n)
        megaFail("deposit_binding");
    if (sourceBlock !== undefined && megaUint(d.block).toString() !== sourceBlock)
        megaFail("deposit_block_binding");
    if (!["SEEN", "PENDING", "CONFIRMED", "PRIORITY", "CANCELLED"].includes(String(d.status)))
        megaFail("deposit_status");
    if (d.status !== "CONFIRMED")
        return null;
    if (!Array.isArray(v.txs) || v.txs.length > 8)
        megaFail("delivery_count");
    const rows = v.txs.map(megaObject);
    if (rows.some(t => megaUint(t.chain) !== 4326n))
        megaFail("unexpected_outbound_chain");
    if (rows.length === 0)
        return null;
    if (rows.length !== 1)
        megaFail("delivery_ambiguous");
    const t = rows[0];
    megaExact(t, ["chain", "hash", "nonce", "refund", "cancelled", "signer", "status", "time", "to", "usd", "value"]);
    if (t.refund !== false || t.cancelled !== false || megaAddress(t.to) !== owner)
        megaFail("delivery_binding");
    if (!["SEEN", "PENDING", "CONFIRMED", "PRIORITY", "CANCELLED"].includes(String(t.status)))
        megaFail("outbound_status");
    if (t.status !== "CONFIRMED")
        return null;
    const output = megaUint(t.value);
    if (output < MEGA_FUNDING.minimumOutput)
        megaFail("delivery_floor");
    return { hash: megaHash(t.hash), amount: output.toString(), signer: megaAddress(t.signer), nonce: megaUint(t.nonce).toString(), providerDigest: hashObject(value) };
}
//# sourceMappingURL=mega-gaszip-contract.js.map