/** Exact finite Base deposit runtime and full OP Stack fee preflight. */
import { encodeFunctionData, parseAbi } from "viem";
import { ApnError } from "../errors.js";
import { evmRpcQuantity, evmRpcWord } from "../evm-rpc-codec.js";
import { RELAY_BASE_FULL_FEE } from "./native-quote.js";
export const BASE_RELAY_SIGNED_BYTES = 512;
const ORACLE = "0x420000000000000000000000000000000000000F";
const ABI = parseAbi(["function getL1FeeUpperBound(uint256 size) view returns(uint256)", "function getOperatorFee(uint256 gas) view returns(uint256)"]);
function reject(reason) { throw new ApnError("APN_OPERATION_BLOCKED", "Finite Base Relay source preflight refused.", { reason }); }
/** P5: the depository address is pinned by the saved quote validation and the exact deposit is simulated here; its
 * runtime code hash is not re-read on every funding check. */
export async function verifyRelayBaseFunding(op, rpc, tag) {
    if (op.sourceChainId !== 8453 || !op.nativeQuote || op.depositNetworkFeeCeilingWei !== RELAY_BASE_FULL_FEE.toString())
        reject("base_full_fee_binding");
    const d = op.nativeQuote.deposit;
    const rows = await rpc.batchCall([
        { method: "eth_estimateGas", params: [{ from: op.sourceAccount, to: d.to, data: d.data, value: `0x${BigInt(d.value).toString(16)}` }, tag] },
        { method: "eth_call", params: [{ to: ORACLE, data: encodeFunctionData({ abi: ABI, functionName: "getL1FeeUpperBound", args: [BigInt(BASE_RELAY_SIGNED_BYTES)] }) }, tag] },
        { method: "eth_call", params: [{ to: ORACLE, data: encodeFunctionData({ abi: ABI, functionName: "getOperatorFee", args: [BigInt(d.gas)] }) }, tag] },
    ]);
    if (rows.length !== 3)
        reject("base_funding_batch");
    const estimate = evmRpcQuantity(rows[0]);
    if (estimate === 0n || estimate > BigInt(d.gas))
        reject("base_deposit_gas_drift");
    const full = BigInt(d.gas) * BigInt(d.maxFeePerGas) + evmRpcWord(rows[1]) + evmRpcWord(rows[2]);
    if (full > RELAY_BASE_FULL_FEE)
        reject("base_full_native_fee_exceeded");
}
//# sourceMappingURL=base-source-guard.js.map