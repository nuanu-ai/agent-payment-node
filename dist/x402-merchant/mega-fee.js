import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, keccak256, parseAbi, serializeTransaction } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { gaszipOracleUint256 } from "../lifi/gaszip-oracle-data.js";
import { MERCHANT_AMOUNT, MERCHANT_PAYEE, MERCHANT_TOKEN } from "./pins.js";
import { refuse } from "./protocol.js";
export const MEGA_FEE_ORACLE = { address: getAddress("0x420000000000000000000000000000000000000F"),
    proxyHash: "0xfa8c9db6c6cab7108dea276f4cd09d575674eb0852c0fa3187e59e98ef977998",
    implementation: getAddress("0xc0d3c0d3c0d3c0d3c0d3c0d3c0d3c0d3c0d3000f"), implementationHash: "0x4d195a9d7caf9fb6d4beaf80de252c626c853afd5868c4f4f8d19c9d301c2679",
    slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc", version: "1.4.0" };
const ABI = parseAbi(["function isEcotone() view returns (bool)", "function isFjord() view returns (bool)", "function isIsthmus() view returns (bool)", "function version() view returns (string)", "function getL1FeeUpperBound(uint256) view returns (uint256)", "function getOperatorFee(uint256) view returns (uint256)"]);
const q = (v) => { if (typeof v !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/u.test(v))
    refuse("merchant_fee_quantity"); return BigInt(v); };
const obj = (v) => { if (!isPlainRecord(v))
    refuse("merchant_fee_object"); return v; };
const hash = (v) => { if (typeof v !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(v))
    refuse("merchant_fee_hash"); return v.toLowerCase(); };
const data = (v) => { if (typeof v !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(v))
    refuse("merchant_fee_data"); return v; };
export function unsignedMerchantEnvelope(e) {
    if (BigInt(e.nonce) > BigInt(Number.MAX_SAFE_INTEGER))
        refuse("merchant_fee_nonce");
    return serializeTransaction({ type: "eip1559", chainId: 4326, nonce: Number(e.nonce), gas: BigInt(e.gas), maxFeePerGas: BigInt(e.maxFeePerGas), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGas), to: MERCHANT_TOKEN, value: 0n, accessList: [], data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [MERCHANT_PAYEE, BigInt(MERCHANT_AMOUNT)] }) });
}
export function validateMerchantFeeContext(v, e) {
    if (!isPlainRecord(v) || !exactKeys(v, ["schemaVersion", "anchorNumber", "anchorHash", "oraclePinsDigest", "unsignedBytes", "unsignedHash", "executionUpper", "l1EstimatedUpper", "operatorEstimatedUpper", "admissionEstimatedUpper"]))
        refuse("merchant_fee_context_shape");
    const f = v, raw = unsignedMerchantEnvelope(e);
    for (const key of ["anchorNumber", "unsignedBytes", "executionUpper", "l1EstimatedUpper", "operatorEstimatedUpper", "admissionEstimatedUpper"])
        if (!/^(0|[1-9][0-9]{0,77})$/u.test(f[key]))
            refuse("merchant_fee_context_uint");
    if (f.schemaVersion !== "apn.merchant-mega-fee.v1" || f.oraclePinsDigest !== hashObject(MEGA_FEE_ORACLE) || hash(f.anchorHash) !== f.anchorHash || f.unsignedHash !== keccak256(raw) || f.unsignedBytes !== String((raw.length - 2) / 2) || f.operatorEstimatedUpper !== "0" ||
        BigInt(f.executionUpper) !== BigInt(e.gas) * BigInt(e.maxFeePerGas) || BigInt(f.admissionEstimatedUpper) !== BigInt(f.executionUpper) + BigInt(f.l1EstimatedUpper) || BigInt(f.admissionEstimatedUpper) > BigInt(e.maximumNativeFee))
        refuse("merchant_fee_context_binding");
    return f;
}
/** Exact canonical oracle identity and zero-only operator contract; both estimation and inclusion use this pin. */
export async function merchantOracleAt(rpc, number, blockHash, gas, unsignedBytes) {
    const tag = { blockHash, requireCanonical: true }, call = (name, args) => ({ method: "eth_call", params: [{ to: MEGA_FEE_ORACLE.address, data: encodeFunctionData({ abi: ABI, functionName: name, args }) }, tag] });
    const values = await rpc.batch([{ method: "eth_getCode", params: [MEGA_FEE_ORACLE.address, tag] }, { method: "eth_getStorageAt", params: [MEGA_FEE_ORACLE.address, MEGA_FEE_ORACLE.slot, tag] }, { method: "eth_getCode", params: [MEGA_FEE_ORACLE.implementation, tag] }, call("isEcotone"), call("isFjord"), call("isIsthmus"), call("version"), call("getOperatorFee", [gas]), ...(unsignedBytes === undefined ? [] : [call("getL1FeeUpperBound", [unsignedBytes])])]);
    if (keccak256(data(values[0])) !== MEGA_FEE_ORACLE.proxyHash || data(values[1]).toLowerCase() !== `0x${MEGA_FEE_ORACLE.implementation.slice(2).toLowerCase().padStart(64, "0")}` || keccak256(data(values[2])) !== MEGA_FEE_ORACLE.implementationHash ||
        values.slice(3, 6).some(v => gaszipOracleUint256(v, refuse) !== 1n) || decodeFunctionResult({ abi: ABI, functionName: "version", data: data(values[6]) }) !== MEGA_FEE_ORACLE.version || gaszipOracleUint256(values[7], refuse) !== 0n)
        refuse("merchant_fee_oracle_identity_or_operator");
    const recheck = obj(await rpc.call("eth_getBlockByNumber", [`0x${BigInt(number).toString(16)}`, false]));
    if (q(recheck.number) !== BigInt(number) || hash(recheck.hash) !== blockHash)
        refuse("merchant_fee_anchor_changed");
    return unsignedBytes === undefined ? 0n : gaszipOracleUint256(values[8], refuse);
}
export async function merchantFeeQuote(rpc, head, e) {
    const raw = unsignedMerchantEnvelope(e), number = q(head.number).toString(), blockHash = hash(head.hash), execution = BigInt(e.gas) * BigInt(e.maxFeePerGas);
    // Fjord adds its own 68-byte signature allowance. Pass the exact unsigned serialized length once.
    const l1 = await merchantOracleAt(rpc, number, blockHash, BigInt(e.gas), BigInt((raw.length - 2) / 2));
    return { schemaVersion: "apn.merchant-mega-fee.v1", anchorNumber: number, anchorHash: blockHash, oraclePinsDigest: hashObject(MEGA_FEE_ORACLE), unsignedBytes: String((raw.length - 2) / 2), unsignedHash: keccak256(raw), executionUpper: execution.toString(), l1EstimatedUpper: l1.toString(), operatorEstimatedUpper: "0", admissionEstimatedUpper: (execution + l1).toString() };
}
export function checkMerchantFullFee(fresh, frozen, e, native) {
    validateMerchantFeeContext(frozen, e);
    validateMerchantFeeContext(fresh, e);
    if (e.nativeFeeReserveWei !== undefined && (!/^[1-9][0-9]*$/u.test(e.nativeFeeReserveWei) || BigInt(e.nativeFeeReserveWei) < BigInt(frozen.admissionEstimatedUpper) || BigInt(e.nativeFeeReserveWei) > BigInt(e.maximumNativeFee)))
        refuse("merchant_native_reserve_binding");
    if (fresh.unsignedHash !== frozen.unsignedHash || BigInt(fresh.admissionEstimatedUpper) > BigInt(e.nativeFeeReserveWei ?? frozen.admissionEstimatedUpper) || BigInt(fresh.admissionEstimatedUpper) > BigInt(e.maximumNativeFee) || BigInt(native) < BigInt(e.nativeFeeReserveWei ?? frozen.admissionEstimatedUpper))
        refuse("merchant_full_fee_admission_changed");
}
/** L1 is additional to receipt execution cost. Missing quantities/unsupported nonzero operator fields refuse. */
export function merchantActualFee(r) {
    if (q(r.type) !== 2n || r.l1Fee === undefined || q(r.gasUsed) === 0n || r.blobGasUsed !== undefined && q(r.blobGasUsed) !== 0n)
        refuse("merchant_receipt_full_fee_type");
    if ((r.operatorFeeScalar === undefined) !== (r.operatorFeeConstant === undefined))
        refuse("merchant_receipt_operator_shape");
    for (const k of ["operatorFeeScalar", "operatorFeeConstant", "operatorFee"])
        if (r[k] !== undefined && q(r[k]) !== 0n)
            refuse("merchant_receipt_operator_unreviewed");
    const execution = q(r.gasUsed) * q(r.effectiveGasPrice), l1 = q(r.l1Fee);
    return { execution: execution.toString(), l1: l1.toString(), operator: "0", total: (execution + l1).toString() };
}
/** Block-wide payer debit witness is explicit; it never attributes a two-transaction delta to one target. */
export async function merchantPayerDebit(rpc, owner, blockValue, target, budget) {
    const block = obj(blockValue), number = q(block.number), blockHash = hash(block.hash);
    if (number === 0n || !Array.isArray(block.transactions))
        refuse("merchant_receipt_payer_block");
    const rows = block.transactions.map(obj), outgoing = rows.filter(t => getAddress(String(t.from)) === getAddress(owner));
    if (outgoing.length < 1 || outgoing.length > 8 || rows.some(t => t.to !== null && getAddress(String(t.to)) === getAddress(owner)))
        refuse("merchant_receipt_payer_ambiguity");
    const hashes = outgoing.map(t => hash(t.hash));
    if (new Set(hashes).size !== hashes.length || hashes.filter(h => h === hash(target.transactionHash)).length !== 1)
        refuse("merchant_receipt_payer_membership");
    const receipts = await rpc.batch(hashes.map(h => ({ method: "eth_getTransactionReceipt", params: [h] })));
    let aggregate = 0n;
    for (let i = 0; i < outgoing.length; i++) {
        const tx = outgoing[i], r = obj(receipts[i]);
        if (hash(r.transactionHash) !== hash(tx.hash) || hash(r.blockHash) !== blockHash || q(r.blockNumber) !== number || q(tx.blockNumber) !== number || hash(tx.blockHash) !== blockHash || q(r.transactionIndex) !== q(tx.transactionIndex) || q(tx.transactionIndex) >= BigInt(rows.length) || hash(rows[Number(q(tx.transactionIndex))].hash) !== hash(tx.hash) || getAddress(String(r.to)) !== getAddress(String(tx.to)) || getAddress(String(r.from)) !== getAddress(owner) || q(tx.type) !== 2n || q(tx.chainId) !== 4326n || q(r.status) !== 0n && q(r.status) !== 1n)
            refuse("merchant_receipt_payer_binding");
        if (hash(r.transactionHash) === hash(target.transactionHash) && hashObject(r) !== hashObject(target))
            refuse("merchant_receipt_payer_receipt_changed");
        const price = q(r.effectiveGasPrice), offered = q(block.baseFeePerGas) + q(tx.maxPriorityFeePerGas), cap = q(tx.maxFeePerGas);
        if (q(r.gasUsed) > q(tx.gas) || price !== (cap < offered ? cap : offered))
            refuse("merchant_receipt_payer_gas_binding");
        aggregate += BigInt(merchantActualFee(r).total) + (q(r.status) === 1n ? q(tx.value) : 0n);
    }
    if (BigInt(merchantActualFee(target).total) > BigInt(budget))
        refuse("merchant_receipt_full_fee_budget");
    const prev = obj(await rpc.call("eth_getBlockByNumber", [`0x${(number - 1n).toString(16)}`, false])), previousHash = hash(prev.hash);
    if (q(prev.number) !== number - 1n || hash(block.parentHash) !== previousHash)
        refuse("merchant_receipt_payer_parent");
    const [before, after, again] = await rpc.batch([{ method: "eth_getBalance", params: [owner, { blockHash: previousHash, requireCanonical: true }] }, { method: "eth_getBalance", params: [owner, { blockHash, requireCanonical: true }] }, { method: "eth_getBlockByNumber", params: [`0x${number.toString(16)}`, true] }]);
    if (hash(obj(again).hash) !== blockHash || hashObject(obj(again).transactions) !== hashObject(block.transactions) || q(before) - q(after) !== aggregate)
        refuse("merchant_receipt_payer_debit");
    return { before: q(before).toString(), after: q(after).toString(), aggregateDebit: aggregate.toString(), transactionHashes: hashes, evidenceHash: hashObject({ receipts, prev, before, after, again }) };
}
//# sourceMappingURL=mega-fee.js.map