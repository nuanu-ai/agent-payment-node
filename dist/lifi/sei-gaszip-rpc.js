import { assertGaszipPhysicalGuard } from "./gaszip-authority.js";
import { gaszipOracleUint256 } from "./gaszip-oracle-data.js";
import { encodeFunctionData, parseAbi } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { MAX_DIRECT_TRANSACTION_BYTES } from "../evm-asset.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { BridgeHttps } from "./https.js";
import { SEI_FUNDING, seiAddress, seiFail, seiHash, seiObject, seiQuantity } from "./sei-gaszip-contract.js";
const ORACLE = "0x420000000000000000000000000000000000000F";
const ABI = parseAbi(["function getL1FeeUpperBound(uint256) view returns (uint256)", "function getOperatorFee(uint256) view returns (uint256)"]);
const hex = (x) => `0x${x.toString(16)}`;
/** Finite public RPC transport shares DNS pinning, response bounds, TLS and no-redirect/no-retry HTTP. */
export class SeiFundingRpc {
    https;
    sequence = 0;
    reads = 0;
    url;
    constructor(url, https = new BridgeHttps()) {
        this.https = https;
        const u = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", "GasZip RPC", 2048);
        if (u.search !== "" || u.hash !== "")
            seiFail("rpc_url");
        this.url = u.toString();
    }
    async call(method, params, beforeSend) {
        if (!["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_sendRawTransaction", "eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(method) || ++this.reads > 64)
            seiFail("rpc_method_or_budget");
        if (method === "eth_sendRawTransaction") {
            if (params.length !== 1)
                seiFail("send_parameters");
            assertGaszipPhysicalGuard(beforeSend, params[0]);
        }
        const id = String(++this.sequence);
        const r = await this.https.request(this.url, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }), 1024 * 1024, "APN_RPC_CONFIG", beforeSend);
        if (r.status !== 200)
            seiFail("rpc_http");
        let v;
        try {
            v = seiObject(JSON.parse(r.body));
        }
        catch {
            return seiFail("rpc_json");
        }
        if (v.jsonrpc !== "2.0" || v.id !== id || !Object.hasOwn(v, "result") || Object.hasOwn(v, "error"))
            seiFail("rpc_result");
        return v.result;
    }
}
export async function readSeiFundingPlan(rpc, owner, amount, maxFee, frozenFeeUpper) {
    if (seiQuantity(await rpc.call("eth_chainId", [])) !== 8453n)
        seiFail("source_chain");
    const block = seiObject(await rpc.call("eth_getBlockByNumber", ["latest", false]));
    const blockHash = seiHash(block.hash), number = seiQuantity(block.number);
    const tag = { blockHash, requireCanonical: true };
    const tx = { from: owner, to: SEI_FUNDING.target, data: SEI_FUNDING.data, value: hex(BigInt(amount)) };
    const [code, balance, n, p, g] = await Promise.all([rpc.call("eth_getCode", [SEI_FUNDING.target, tag]), rpc.call("eth_getBalance", [owner, tag]),
        rpc.call("eth_getTransactionCount", [owner, "latest"]), rpc.call("eth_getTransactionCount", [owner, "pending"]), rpc.call("eth_estimateGas", [tx, tag])]);
    if (code !== "0x" || seiQuantity(n) !== seiQuantity(p) || seiQuantity(n) > BigInt(Number.MAX_SAFE_INTEGER))
        seiFail("source_code_or_nonce");
    // Base requires a quoted total fee including L1 data and operator components. It is not an on-chain total-fee cap.
    const gas = (seiQuantity(g) * 110n + 99n) / 100n, tip = 1000000n, fee = 2n * seiQuantity(block.baseFeePerGas) + tip;
    if (gas > 30000n || fee > 100000000n)
        seiFail("source_fee_pair");
    const [l1, op] = await Promise.all([rpc.call("eth_call", [{ to: ORACLE, data: encodeFunctionData({ abi: ABI, functionName: "getL1FeeUpperBound", args: [BigInt(MAX_DIRECT_TRANSACTION_BYTES)] }) }, tag]),
        rpc.call("eth_call", [{ to: ORACLE, data: encodeFunctionData({ abi: ABI, functionName: "getOperatorFee", args: [gas] }) }, tag])]);
    const l1Fee = gaszipOracleUint256(l1, seiFail), operator = gaszipOracleUint256(op, seiFail), total = gas * fee + l1Fee + operator;
    if (operator !== 0n)
        seiFail("base_operator_fee_unreviewed");
    if (total > BigInt(maxFee) || total > SEI_FUNDING.maximumFee || seiQuantity(balance) < BigInt(amount) + (frozenFeeUpper === undefined || total > BigInt(frozenFeeUpper) ? total : BigInt(frozenFeeUpper)))
        seiFail("source_balance_or_fee_cap");
    const check = seiObject(await rpc.call("eth_getBlockByNumber", [hex(number), false]));
    if (seiHash(check.hash) !== blockHash)
        seiFail("source_reorg");
    return { blockHash, nonce: seiQuantity(n).toString(), gas: gas.toString(), maxFee: fee.toString(), tip: tip.toString(), l1FeeUpper: l1Fee.toString(), operatorFeeUpper: operator.toString(), feeUpper: total.toString() };
}
export function assertSeiFundingFresh(initial, fresh) {
    if (initial.nonce !== fresh.nonce || BigInt(fresh.gas) > BigInt(initial.gas) || BigInt(fresh.maxFee) > BigInt(initial.maxFee) ||
        BigInt(fresh.l1FeeUpper) > BigInt(initial.l1FeeUpper) || BigInt(fresh.operatorFeeUpper) > BigInt(initial.operatorFeeUpper) ||
        BigInt(fresh.feeUpper) > BigInt(initial.feeUpper))
        seiFail("source_plan_drift");
}
/** The exact transaction and receipt must agree, have canonical block identity, and lie at or below a fresh safe head. */
export async function proveSeiSafeTransaction(rpc, chain, hash, expected) {
    if (seiQuantity(await rpc.call("eth_chainId", [])) !== BigInt(chain))
        seiFail("proof_chain");
    const [tv, rv, sv] = await Promise.all([rpc.call("eth_getTransactionByHash", [hash]), rpc.call("eth_getTransactionReceipt", [hash]), rpc.call("eth_getBlockByNumber", ["safe", false])]);
    if (tv === null || rv === null)
        return null;
    const t = seiObject(tv), r = seiObject(rv), safe = seiObject(sv);
    const blockHash = seiHash(r.blockHash), number = seiQuantity(r.blockNumber);
    if (number > seiQuantity(safe.number))
        return null;
    if (seiHash(t.hash) !== hash || seiHash(r.transactionHash) !== hash || seiHash(t.blockHash) !== blockHash || seiQuantity(t.blockNumber) !== number ||
        seiAddress(t.from) !== expected.from || seiAddress(r.from) !== expected.from || seiAddress(t.to) !== expected.to || seiAddress(r.to) !== expected.to ||
        t.input !== expected.data || seiQuantity(t.value).toString() !== expected.value || seiQuantity(t.nonce).toString() !== expected.nonce ||
        seiQuantity(t.chainId) !== BigInt(chain) || (expected.gas !== undefined && seiQuantity(t.gas).toString() !== expected.gas) ||
        (expected.maxFee !== undefined && seiQuantity(t.maxFeePerGas).toString() !== expected.maxFee) || (expected.tip !== undefined && seiQuantity(t.maxPriorityFeePerGas).toString() !== expected.tip))
        seiFail("proof_binding");
    const included = seiObject(await rpc.call("eth_getBlockByNumber", [hex(number), false]));
    if (seiHash(included.hash) !== blockHash || seiQuantity(r.status) !== 0n && seiQuantity(r.status) !== 1n)
        seiFail("proof_reorg_or_status");
    if (expected.gas !== undefined && seiQuantity(r.gasUsed) > BigInt(expected.gas) || expected.maxFee !== undefined && seiQuantity(r.effectiveGasPrice) > BigInt(expected.maxFee))
        seiFail("source_receipt_gas_binding");
    let actualFee = null;
    if (chain === 8453) {
        if (r.l1Fee === undefined)
            seiFail("source_receipt_l1_fee_missing");
        let fee = seiQuantity(r.gasUsed) * seiQuantity(r.effectiveGasPrice) + seiQuantity(r.l1Fee);
        // Current Base operator fee is zero; a nonzero/configured future operator component is required explicitly.
        if (r.operatorFeeScalar !== undefined || r.operatorFeeConstant !== undefined) {
            if (r.operatorFeeScalar === undefined || r.operatorFeeConstant === undefined)
                seiFail("operator_receipt_shape");
            fee += seiQuantity(r.operatorFeeConstant) + seiQuantity(r.gasUsed) * seiQuantity(r.operatorFeeScalar) / 1000000n;
        }
        actualFee = fee.toString();
    }
    return { hash, blockHash, blockNumber: number.toString(), status: seiQuantity(r.status) === 1n ? "success" : "reverted",
        transactionDigest: hashObject(t), receiptDigest: hashObject(r), amount: expected.value, actualFee };
}
export async function proveSeiDelivery(rpc, owner, d) {
    const p = await proveSeiSafeTransaction(rpc, 1329, d.hash, { from: d.signer, to: owner, data: "0x", value: d.amount, nonce: d.nonce });
    if (p === null)
        return null;
    if (p.status !== "success")
        seiFail("destination_revert");
    const number = BigInt(p.blockNumber);
    if (number === 0n)
        seiFail("destination_genesis");
    const previous = seiObject(await rpc.call("eth_getBlockByNumber", [hex(number - 1n), false]));
    const previousHash = seiHash(previous.hash);
    const [before, after, code] = await Promise.all([rpc.call("eth_getBalance", [owner, { blockHash: previousHash, requireCanonical: true }]),
        rpc.call("eth_getBalance", [owner, { blockHash: p.blockHash, requireCanonical: true }]), rpc.call("eth_getCode", [owner, { blockHash: previousHash, requireCanonical: true }])]);
    if (code !== "0x" || seiQuantity(after) - seiQuantity(before) !== BigInt(d.amount))
        seiFail("destination_exact_delta");
    return p;
}
export async function proveSeiSource(rpc, r) {
    if (r.transactionHash === null)
        return null;
    return proveSeiSafeTransaction(rpc, 8453, r.transactionHash, { from: r.owner.address, to: SEI_FUNDING.target,
        data: SEI_FUNDING.data, value: r.amountAtomic, nonce: r.plan.nonce, gas: r.plan.gas, maxFee: r.plan.maxFee, tip: r.plan.tip });
}
//# sourceMappingURL=sei-gaszip-rpc.js.map