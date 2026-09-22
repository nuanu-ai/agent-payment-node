import { decodeFunctionResult, encodeFunctionData } from "viem";
import { rpcHexValue } from "./rpc-batch-codec.js";
import { bridgeFailure } from "./validation.js";
import { MULTICALL3_ADDRESS } from "../portfolio/registry.js";
import { MULTICALL3_ABI } from "../portfolio/evm-reader.js";
export const ERC20_READ = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
export const GAS_ORACLE = "0x420000000000000000000000000000000000000F";
export const L1_BLOCK = "0x4200000000000000000000000000000000000015";
export const GAS_ORACLE_ABI = [{ type: "function", name: "getL1FeeUpperBound", stateMutability: "view", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "getOperatorFee", stateMutability: "view", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] }];
export const BASE_ECOTONE_EIP6780_TIMESTAMP = 1710374401n;
const DEPLOYMENT_MULTICALL_SELECTORS = new Set([
    "0x079bd2c7", "0x105d0b81", "0x2bc5114c", "0x313ce567", "0x54fd4d50", "0x57f6dcb8",
    "0x5e280f11", "0x5f6d9ae4", "0x72607537", "0x857749b0", "0x8da5cb5b", "0x9baf00f9", "0xb54501bc",
    "0xbb0b6a53", "0xd8e8dbc7", "0xd999984d", "0xf6503992", "0xfb214c2f", "0xfc0c546a",
]);
export function deploymentMulticallEligible(data) { return DEPLOYMENT_MULTICALL_SELECTORS.has(data.slice(0, 10)); }
export function deploymentAggregateItem(rows, tag) {
    const data = encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "aggregate3", args: [rows.map((row) => ({
                target: row.address, allowFailure: false, callData: row.data,
            }))] });
    return { method: "eth_call", params: [{ to: MULTICALL3_ADDRESS, data }, tag], cachePolicy: "immutable", decoder: (value) => {
            const raw = rpcHexValue(512 * 1024)(value);
            let decoded;
            try {
                decoded = decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: raw });
            }
            catch {
                return bridgeFailure("APN_RPC_PROTOCOL", "bridge_multicall_response");
            }
            if (decoded.length !== rows.length || decoded.some((row) => !row.success))
                bridgeFailure("APN_RPC_PROTOCOL", "bridge_multicall_response");
            return decoded.map((row) => rpcHexValue(64 * 1024)(row.returnData));
        } };
}
export const LINEA_TRACE_PROBE_TRANSACTION = "0x4352433956109d31ab50db9547f16bcb90f3545f793ed40f75716ccd9a360efd";
export const MONAD_TRACE_PROBE_TRANSACTION = "0x9ff1560ef67d7253df2663b897452abe6644f6d6cb746743253822c264d13440";
//# sourceMappingURL=rpc-deployment.js.map