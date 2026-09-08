import { encodeFunctionData, getAddress, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction } from "viem";
import { bridgeFailure, bridgeHex } from "./validation.js";
const APPROVE_ABI = [{ type: "function", name: "approve", stateMutability: "nonpayable",
        inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] }];
const APPROVAL_TOPIC = keccak256(Buffer.from("Approval(address,address,uint256)"));
export function approvalData(spender, amount) {
    return encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [spender, BigInt(amount)] });
}
export function approvalIncluded(receipt, token, owner, spender, amount) {
    const topic = (a) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;
    const logs = receipt.logs.filter((l) => l.address === token && l.topics[0] === APPROVAL_TOPIC && l.topics[1] === topic(owner));
    if (logs.length !== 1 || logs[0].topics.length !== 3 || logs[0].topics[2] !== topic(spender) ||
        logs[0].data !== `0x${BigInt(amount).toString(16).padStart(64, "0")}`)
        bridgeFailure("APN_RPC_PROTOCOL", "approval_event_identity");
}
/** Only validation is exported; custody owns the one operation-bound signing entry. */
export async function verifyBridgeSigned(raw, expectedHash, e) {
    bridgeHex(raw, 16 * 1024, undefined, "APN_PROVIDER_EFFECT_UNAVAILABLE");
    try {
        const t = parseTransaction(raw), from = getAddress(await recoverTransactionAddress({ serializedTransaction: raw }));
        const s = t.s === undefined ? 0n : BigInt(t.s);
        if (t.type !== "eip1559" || t.chainId !== e.chainId || from !== e.from || t.to === undefined || t.to === null || getAddress(t.to) !== e.to ||
            (t.data ?? "0x") !== e.data || (t.value ?? 0n).toString() !== e.valueAtomic ||
            (t.nonce ?? 0).toString() !== e.economics.nonceAtomic || t.gas?.toString() !== e.economics.gasLimitAtomic ||
            t.maxFeePerGas?.toString() !== e.economics.maxFeePerGasAtomic || (t.maxPriorityFeePerGas ?? 0n).toString() !== e.economics.maxPriorityFeePerGasAtomic ||
            (t.accessList ?? []).length !== 0 || t.r === undefined || t.s === undefined || s <= 0n ||
            s > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n ||
            (t.yParity !== 0 && t.yParity !== 1) || keccak256(raw) !== expectedHash ||
            serializeTransaction(t, { r: t.r, s: t.s, yParity: t.yParity }) !== raw)
            throw new Error("binding");
    }
    catch {
        bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "signed_bridge_binding");
    }
}
//# sourceMappingURL=transaction.js.map