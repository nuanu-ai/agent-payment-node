import type { Address, Hex } from "../../model.js";
import type { MetaMaskGaslessBlock, MetaMaskGaslessChainId, MetaMaskGaslessChainState, MetaMaskGaslessDeploymentRow, MetaMaskGaslessSnapshot } from "../model.js";
import { type MmRpcCall } from "./abi.js";
type BalanceState = Omit<MetaMaskGaslessChainState, "counterAtomic">;
/** Read every protocol, proxy, implementation, owner, token and counter value at one EIP-1898 block. */
export declare function readMetaMaskChainState(call: MmRpcCall, deployment: MetaMaskGaslessDeploymentRow, owner: Address, block: MetaMaskGaslessBlock, delegationHash: Hex | null): Promise<MetaMaskGaslessChainState | BalanceState>;
/** Strictly validate a returned prepare snapshot before orchestration trusts its economics. */
export declare function validateMetaMaskGaslessSnapshot(value: unknown, expected: {
    readonly chainId: MetaMaskGaslessChainId;
    readonly endpointHash: string;
    readonly endpointOrigin: string;
    readonly grossAtomic: string;
}): MetaMaskGaslessSnapshot;
export {};
