import { getAddress, keccak256, recoverTransactionAddress, serializeTransaction } from "viem";
import { hashObject } from "../canonical.js";
const DEPOSIT = ["block", "chain", "hash", "log", "seen", "sender", "shorts", "status", "time", "to", "token", "type", "usd", "value", "valueNative"];
const OUTBOUND = ["chain", "data", "hash", "minValue", "nonce", "retries", "signer", "status", "time", "to", "updated", "usd", "value", "valueNative"];
const STATUSES = ["SEEN", "PENDING", "CONFIRMED", "PRIORITY", "CANCELLED"];
/** Only the fully observed native EOA API schema. Legacy responses use their existing parser. */
export function inspectGaszipNativeDelivery(value, sourceHash, owner, amount, sourceBlock, chain, short, floor, h) {
    const v = h.object(value);
    h.exact(v, ["deposit", "txs"]);
    const d = h.object(v.deposit);
    h.exact(d, DEPOSIT, ["refund", "cancelled"]);
    const flags = (r) => { for (const k of ["refund", "cancelled"])
        if (Object.hasOwn(r, k) && r[k] !== false)
            h.fail("delivery_binding"); };
    const usd = (x) => { if (typeof x !== "number" || !Number.isFinite(x) || x < 0)
        h.fail("native_usd"); };
    flags(d);
    usd(d.usd);
    for (const k of ["block", "log", "seen", "time"])
        h.uint(d[k]);
    if (d.type !== "EOA" || h.address(d.token) !== getAddress("0x0000000000000000000000000000000000000000") ||
        h.uint(d.valueNative) !== h.uint(d.value) || h.uint(d.log) !== 0n || h.hash(d.hash) !== sourceHash || h.uint(d.chain) !== 8453n ||
        h.address(d.sender) !== owner || h.address(d.to) !== owner || h.uint(d.value) !== h.uint(amount) ||
        !Array.isArray(d.shorts) || d.shorts.length !== 1 || h.uint(d.shorts[0]) !== BigInt(short))
        h.fail("deposit_binding");
    if (sourceBlock !== undefined && h.uint(d.block).toString() !== sourceBlock)
        h.fail("deposit_block_binding");
    if (typeof d.status !== "string" || !STATUSES.includes(d.status))
        h.fail("deposit_status");
    if (!Array.isArray(v.txs) || v.txs.length > 1)
        h.fail("delivery_ambiguous");
    if (v.txs.length === 0)
        return null;
    const t = h.object(v.txs[0]);
    h.exact(t, OUTBOUND, ["refund", "cancelled"]);
    flags(t);
    usd(t.usd);
    for (const k of ["nonce", "retries", "time", "updated", "minValue"])
        h.uint(t[k]);
    if (h.uint(t.chain) !== BigInt(chain) || t.data !== "0x" || h.uint(t.minValue) !== 0n || h.uint(t.valueNative) !== h.uint(t.value) ||
        h.address(t.to) !== owner)
        h.fail("delivery_binding");
    const hash = h.hash(t.hash), signer = h.address(t.signer), nonce = h.uint(t.nonce).toString(), output = h.uint(t.value);
    if (typeof t.status !== "string" || !STATUSES.includes(t.status))
        h.fail("outbound_status");
    if (d.status !== "CONFIRMED" || t.status !== "CONFIRMED")
        return null;
    if (output < floor)
        h.fail("delivery_floor");
    return { hash, amount: output.toString(), signer, nonce, providerDigest: hashObject(value), grossNative: true };
}
/** Observed type-0 EIP-155 native payouts only. Reconstruct signed bytes before trusting the gross/net equation. */
export async function gaszipNativeNet(tv, d, owner, chain, floor, h) {
    const t = h.object(tv), gas = h.quantity(t.gas), price = h.quantity(t.gasPrice), net = h.quantity(t.value), nonce = h.quantity(t.nonce), v = h.quantity(t.v);
    if (h.quantity(t.type) !== 0n || h.quantity(t.chainId) !== BigInt(chain) || t.input !== "0x" || h.address(t.to) !== owner ||
        h.address(t.from) !== d.signer || nonce.toString() !== d.nonce || nonce > BigInt(Number.MAX_SAFE_INTEGER) ||
        gas === 0n || price === 0n || v !== BigInt(chain) * 2n + 35n && v !== BigInt(chain) * 2n + 36n ||
        Object.hasOwn(t, "maxFeePerGas") || Object.hasOwn(t, "maxPriorityFeePerGas") || Object.hasOwn(t, "accessList"))
        h.fail("native_signed_envelope");
    const raw = serializeTransaction({ type: "legacy", chainId: chain, nonce: Number(nonce), gas, gasPrice: price, to: getAddress(owner), value: net, data: "0x" }, { r: h.hash(t.r), s: h.hash(t.s), v });
    if (keccak256(raw) !== d.hash || h.hash(t.hash) !== d.hash || await recoverTransactionAddress({ serializedTransaction: raw }) !== d.signer)
        h.fail("native_signed_hash");
    if (h.uint(d.amount) !== net + gas * price || net < floor)
        h.fail("native_gross_net");
    return net.toString();
}
//# sourceMappingURL=gaszip-native-delivery.js.map