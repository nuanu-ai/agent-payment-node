import { decodeFunctionData, encodeFunctionData, keccak256 } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { reconstructPermit2ProductionMaterial } from "./production-material.js";
import { validatePermit2ProductionRecord } from "./production-repository.js";
import { validatePermit2ProductionSigned } from "./production-signed.js";
import { PERMIT2_DIRECT_PROXY_ABI } from "./proxy-abi.js";
import { PROXY_SETTLED_TOPIC, PROXY_SETTLED_WITH_PERMIT_TOPIC, X402_EXACT_PERMIT2_PROXY } from "./registry.js";
export async function encodePermit2ProductionProxyCall(record, value) {
    record = validatePermit2ProductionRecord(JSON.parse(canonicalJson(record)));
    const signed = await validatePermit2ProductionSigned(value, record);
    const { plan } = reconstructPermit2ProductionMaterial(record.material), a = plan.authorization;
    const permit = { permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) },
        nonce: BigInt(a.nonce), deadline: BigInt(a.deadline) };
    const witness = { to: a.witness.to, validAfter: BigInt(a.witness.validAfter) };
    if (plan.eip2612 === null)
        return encodeFunctionData({ abi: PERMIT2_DIRECT_PROXY_ABI, functionName: "settle",
            args: [permit, a.from, witness, signed.permit2Signature] });
    const signature = signed.eip2612Signature, info = plan.eip2612.info;
    return encodeFunctionData({ abi: PERMIT2_DIRECT_PROXY_ABI, functionName: "settleWithPermit", args: [{
                value: BigInt(info.amount), deadline: BigInt(info.deadline), r: `0x${signature.slice(2, 66)}`,
                s: `0x${signature.slice(66, 130)}`, v: Number.parseInt(signature.slice(130), 16),
            }, permit, a.from, witness, signed.permit2Signature] });
}
/** Own the complete flat projection before any asynchronous signature recovery. */
export function snapshotPermit2DirectTransaction(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["chainId", "to", "value", "input", "hash", "blockHash", "blockNumber"]))
        fail();
    const snapshot = { chainId: value.chainId, to: value.to, value: value.value, input: value.input,
        hash: value.hash, blockHash: value.blockHash, blockNumber: value.blockNumber };
    if (snapshot.chainId !== "0xa86a" || typeof snapshot.to !== "string" ||
        snapshot.to.toLowerCase() !== X402_EXACT_PERMIT2_PROXY.toLowerCase() || snapshot.value !== "0x0" ||
        typeof snapshot.input !== "string" || !hash(snapshot.hash) || !hash(snapshot.blockHash) || !quantity(snapshot.blockNumber))
        fail();
    return Object.freeze(snapshot);
}
/** Binds all calldata bytes to the saved signatures/plan. Unknown batchers and builder suffixes refuse. */
export async function attributePermit2DirectTransaction(record, signed, value) {
    record = validatePermit2ProductionRecord(JSON.parse(canonicalJson(record)));
    value = snapshotPermit2DirectTransaction(value);
    signed = await validatePermit2ProductionSigned(signed, record);
    const expected = await encodePermit2ProductionProxyCall(record, signed);
    if (!isPlainRecord(value) || !exactKeys(value, ["chainId", "to", "value", "input", "hash", "blockHash", "blockNumber"]) ||
        value.chainId !== "0xa86a" || typeof value.to !== "string" || value.to.toLowerCase() !== X402_EXACT_PERMIT2_PROXY.toLowerCase() ||
        value.value !== "0x0" || value.input !== expected || !hash(value.hash) || !hash(value.blockHash) || !quantity(value.blockNumber))
        fail();
    try {
        const decoded = decodeFunctionData({ abi: PERMIT2_DIRECT_PROXY_ABI, data: value.input });
        const encoded = decoded.functionName === "settle" ? encodeFunctionData({ abi: PERMIT2_DIRECT_PROXY_ABI,
            functionName: decoded.functionName, args: decoded.args }) : encodeFunctionData({ abi: PERMIT2_DIRECT_PROXY_ABI,
            functionName: decoded.functionName, args: decoded.args });
        if (encoded !== value.input)
            fail();
    }
    catch {
        fail();
    }
    const p = reconstructPermit2ProductionMaterial(record.material), withPermit = p.plan.eip2612 !== null;
    return { source: "pinned-direct-proxy-canonical-abi.v1", operationDigest: signed.operationDigest, headerHash: signed.headerHash,
        calldataHash: keccak256(expected), transactionHash: value.hash, blockHash: value.blockHash,
        blockNumber: BigInt(value.blockNumber).toString(), proxy: X402_EXACT_PERMIT2_PROXY,
        proxyCodeHash: p.plan.selection.listAsset.proxyCodeHash, settledEvent: withPermit ? "SettledWithPermit" : "Settled",
        settledTopic: withPermit ? PROXY_SETTLED_WITH_PERMIT_TOPIC : PROXY_SETTLED_TOPIC,
        transfer: { token: p.token, from: p.payer, to: p.payTo, amountAtomic: p.amountAtomic },
        tokenPermitOutcome: withPermit ? "not_proven" : "not_requested" };
}
export function permit2FactHash(value) {
    return typeof value === "string" && /^0x[a-f0-9]{64}$/u.test(value) && !/^0x0{64}$/u.test(value);
}
export function permit2FactQuantity(value) {
    return typeof value === "string" && /^0x(0|[1-9a-f][0-9a-f]{0,63})$/u.test(value);
}
const hash = permit2FactHash, quantity = permit2FactQuantity;
function fail() { throw new ApnError("APN_X402_SETTLEMENT_INVALID", "Transaction does not match the frozen direct Permit2 proxy call."); }
//# sourceMappingURL=production-proxy-call.js.map