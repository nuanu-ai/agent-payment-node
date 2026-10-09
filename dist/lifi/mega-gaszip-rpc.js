import { assertGaszipPhysicalGuard } from "./gaszip-authority.js";
import { gaszipOracleUint256 } from "./gaszip-oracle-data.js";
import { encodeFunctionData, parseAbi } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { MAX_DIRECT_TRANSACTION_BYTES } from "../evm-asset.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { BridgeHttps } from "./https.js";
import { MEGA_FUNDING, megaAddress, megaFail, megaHash, megaObject, megaQuantity } from "./mega-gaszip-contract.js";
const ORACLE = "0x420000000000000000000000000000000000000F";
const ABI = parseAbi(["function getL1FeeUpperBound(uint256) view returns (uint256)", "function getOperatorFee(uint256) view returns (uint256)"]);
const hex = (x) => `0x${x.toString(16)}`;
/** Finite public RPC transport shares DNS pinning, response bounds, TLS and no-redirect/no-retry HTTP. */
export class MegaFundingRpc {
    https;
    sequence = 0;
    reads = 0;
    url;
    constructor(url, https = new BridgeHttps()) {
        this.https = https;
        const u = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", "GasZip RPC", 2048);
        if (u.search !== "" || u.hash !== "")
            megaFail("rpc_url");
        this.url = u.toString();
    }
    async call(method, params, beforeSend) {
        if (!["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode", "eth_getTransactionCount", "eth_call", "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_sendRawTransaction", "eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(method) || ++this.reads > 64)
            megaFail("rpc_method_or_budget");
        if (method === "eth_sendRawTransaction") {
            if (params.length !== 1)
                megaFail("send_parameters");
            assertGaszipPhysicalGuard(beforeSend, params[0]);
        }
        const id = String(++this.sequence);
        const r = await this.https.request(this.url, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }), 1024 * 1024, "APN_RPC_CONFIG", beforeSend);
        if (r.status !== 200)
            megaFail("rpc_http");
        let v;
        try {
            v = megaObject(JSON.parse(r.body));
        }
        catch {
            return megaFail("rpc_json");
        }
        if (v.jsonrpc !== "2.0" || v.id !== id || !Object.hasOwn(v, "result") || Object.hasOwn(v, "error"))
            megaFail("rpc_result");
        return v.result;
    }
}
export async function readMegaFundingPlan(rpc, owner, amount, maxFee, frozenFeeUpper) {
    if (megaQuantity(await rpc.call("eth_chainId", [])) !== 8453n)
        megaFail("source_chain");
    const block = megaObject(await rpc.call("eth_getBlockByNumber", ["latest", false]));
    const blockHash = megaHash(block.hash), number = megaQuantity(block.number);
    const tag = { blockHash, requireCanonical: true };
    const tx = { from: owner, to: MEGA_FUNDING.target, data: MEGA_FUNDING.data, value: hex(BigInt(amount)) };
    const [code, balance, n, p, g] = await Promise.all([rpc.call("eth_getCode", [MEGA_FUNDING.target, tag]), rpc.call("eth_getBalance", [owner, tag]),
        rpc.call("eth_getTransactionCount", [owner, "latest"]), rpc.call("eth_getTransactionCount", [owner, "pending"]), rpc.call("eth_estimateGas", [tx, tag])]);
    if (code !== "0x" || megaQuantity(n) !== megaQuantity(p) || megaQuantity(n) > BigInt(Number.MAX_SAFE_INTEGER))
        megaFail("source_code_or_nonce");
    // Base requires a quoted total fee including L1 data and operator components. It is not an on-chain total-fee cap.
    const gas = (megaQuantity(g) * 110n + 99n) / 100n, tip = 1000000n, fee = 2n * megaQuantity(block.baseFeePerGas) + tip;
    if (gas > 30000n || fee > 100000000n)
        megaFail("source_fee_pair");
    const [l1, op] = await Promise.all([rpc.call("eth_call", [{ to: ORACLE, data: encodeFunctionData({ abi: ABI, functionName: "getL1FeeUpperBound", args: [BigInt(MAX_DIRECT_TRANSACTION_BYTES)] }) }, tag]),
        rpc.call("eth_call", [{ to: ORACLE, data: encodeFunctionData({ abi: ABI, functionName: "getOperatorFee", args: [gas] }) }, tag])]);
    const l1Fee = gaszipOracleUint256(l1, megaFail), operator = gaszipOracleUint256(op, megaFail), total = gas * fee + l1Fee + operator;
    if (operator !== 0n)
        megaFail("base_operator_fee_unreviewed");
    if (total > BigInt(maxFee) || total > MEGA_FUNDING.maximumFee || megaQuantity(balance) < BigInt(amount) + (frozenFeeUpper === undefined || total > BigInt(frozenFeeUpper) ? total : BigInt(frozenFeeUpper)))
        megaFail("source_balance_or_fee_cap");
    const check = megaObject(await rpc.call("eth_getBlockByNumber", [hex(number), false]));
    if (megaHash(check.hash) !== blockHash)
        megaFail("source_reorg");
    return { blockHash, nonce: megaQuantity(n).toString(), gas: gas.toString(), maxFee: fee.toString(), tip: tip.toString(), l1FeeUpper: l1Fee.toString(), operatorFeeUpper: operator.toString(), feeUpper: total.toString() };
}
export function assertMegaFundingFresh(initial, fresh) {
    if (initial.nonce !== fresh.nonce || BigInt(fresh.gas) > BigInt(initial.gas) || BigInt(fresh.maxFee) > BigInt(initial.maxFee) ||
        BigInt(fresh.l1FeeUpper) > BigInt(initial.l1FeeUpper) || BigInt(fresh.operatorFeeUpper) > BigInt(initial.operatorFeeUpper) ||
        BigInt(fresh.feeUpper) > BigInt(initial.feeUpper))
        megaFail("source_plan_drift");
}
/** The exact transaction and receipt must agree, have canonical block identity, and lie at or below a fresh safe head. */
export async function proveMegaSafeTransaction(rpc, chain, hash, expected) {
    if (megaQuantity(await rpc.call("eth_chainId", [])) !== BigInt(chain))
        megaFail("proof_chain");
    const [tv, rv, sv] = await Promise.all([rpc.call("eth_getTransactionByHash", [hash]), rpc.call("eth_getTransactionReceipt", [hash]), rpc.call("eth_getBlockByNumber", ["safe", false])]);
    if (tv === null || rv === null)
        return null;
    const t = megaObject(tv), r = megaObject(rv), safe = megaObject(sv);
    const blockHash = megaHash(r.blockHash), number = megaQuantity(r.blockNumber);
    if (number > megaQuantity(safe.number))
        return null;
    if (megaHash(t.hash) !== hash || megaHash(r.transactionHash) !== hash || megaHash(t.blockHash) !== blockHash || megaQuantity(t.blockNumber) !== number ||
        megaAddress(t.from) !== expected.from || megaAddress(r.from) !== expected.from || megaAddress(t.to) !== expected.to || megaAddress(r.to) !== expected.to ||
        t.input !== expected.data || megaQuantity(t.value).toString() !== expected.value || megaQuantity(t.nonce).toString() !== expected.nonce ||
        megaQuantity(t.chainId) !== BigInt(chain) || (expected.gas !== undefined && megaQuantity(t.gas).toString() !== expected.gas) ||
        (expected.maxFee !== undefined && megaQuantity(t.maxFeePerGas).toString() !== expected.maxFee) || (expected.tip !== undefined && megaQuantity(t.maxPriorityFeePerGas).toString() !== expected.tip))
        megaFail("proof_binding");
    const included = megaObject(await rpc.call("eth_getBlockByNumber", [hex(number), false]));
    if (megaHash(included.hash) !== blockHash || megaQuantity(r.status) !== 0n && megaQuantity(r.status) !== 1n)
        megaFail("proof_reorg_or_status");
    if (expected.gas !== undefined && megaQuantity(r.gasUsed) > BigInt(expected.gas) || expected.maxFee !== undefined && megaQuantity(r.effectiveGasPrice) > BigInt(expected.maxFee))
        megaFail("source_receipt_gas_binding");
    let actualFee = null;
    if (chain === 8453) {
        if (r.l1Fee === undefined)
            megaFail("source_receipt_l1_fee_missing");
        let fee = megaQuantity(r.gasUsed) * megaQuantity(r.effectiveGasPrice) + megaQuantity(r.l1Fee);
        // Current Base operator fee is zero; a nonzero/configured future operator component is required explicitly.
        if (r.operatorFeeScalar !== undefined || r.operatorFeeConstant !== undefined) {
            if (r.operatorFeeScalar === undefined || r.operatorFeeConstant === undefined)
                megaFail("operator_receipt_shape");
            fee += megaQuantity(r.operatorFeeConstant) + megaQuantity(r.gasUsed) * megaQuantity(r.operatorFeeScalar) / 1000000n;
        }
        actualFee = fee.toString();
    }
    return { hash, blockHash, blockNumber: number.toString(), status: megaQuantity(r.status) === 1n ? "success" : "reverted",
        transactionDigest: hashObject(t), receiptDigest: hashObject(r), amount: expected.value, actualFee };
}
export async function proveMegaDelivery(rpc, owner, d) {
    const p = await proveMegaSafeTransaction(rpc, 4326, d.hash, { from: d.signer, to: owner, data: "0x", value: d.amount, nonce: d.nonce });
    if (p === null)
        return null;
    if (p.status !== "success")
        megaFail("destination_revert");
    const number = BigInt(p.blockNumber);
    if (number === 0n)
        megaFail("destination_genesis");
    const previous = megaObject(await rpc.call("eth_getBlockByNumber", [hex(number - 1n), false]));
    const previousHash = megaHash(previous.hash);
    const [before, after, code] = await Promise.all([rpc.call("eth_getBalance", [owner, { blockHash: previousHash, requireCanonical: true }]),
        rpc.call("eth_getBalance", [owner, { blockHash: p.blockHash, requireCanonical: true }]), rpc.call("eth_getCode", [owner, { blockHash: previousHash, requireCanonical: true }])]);
    if (code !== "0x" || megaQuantity(after) - megaQuantity(before) !== BigInt(d.amount))
        megaFail("destination_exact_delta");
    return p;
}
export async function proveMegaSource(rpc, r) {
    if (r.transactionHash === null)
        return null;
    return proveMegaSafeTransaction(rpc, 8453, r.transactionHash, { from: r.owner.address, to: MEGA_FUNDING.target,
        data: MEGA_FUNDING.data, value: r.amountAtomic, nonce: r.plan.nonce, gas: r.plan.gas, maxFee: r.plan.maxFee, tip: r.plan.tip });
}
//# sourceMappingURL=mega-gaszip-rpc.js.map