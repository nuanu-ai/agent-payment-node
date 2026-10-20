import type { Hex } from "../../model.js";
import { type MmRpcCall } from "../chain/abi.js";
import type { MetaMaskGaslessBlock, MetaMaskGaslessDeployment, MetaMaskGaslessIntent } from "../model.js";
import type { MetaMaskDisableCall } from "./call.js";
/** What the chain says right before a disable is handed to the wallet; every refusal here happens before any send. */
export interface MetaMaskRevocationChain {
    readonly finality: MetaMaskGaslessBlock;
    readonly latest: MetaMaskGaslessBlock;
    readonly nonceAtomic: string;
    readonly gasLimitAtomic: string;
    readonly maxFeePerGasAtomic: string;
    readonly maxPriorityFeePerGasAtomic: string;
    /** OP-stack L1 data fee and operator fee upper bounds; 0 elsewhere. Not enforced by the transaction fields. */
    readonly l1FeeUpperWei: string;
    readonly operatorFeeUpperWei: string;
    readonly maximumNativeCostWei: string;
    readonly nativeBalanceWei: string;
}
/**
 * Reads, in order: at the finality block (pinned by hash) the redemption count, the manager's disabled flag and the
 * manager's own hash of the tuple the call carries; then at the latest block the delegator's pending nonce, the gas
 * of exactly this call from the delegator (`eth_estimateGas` executes it, so a call the manager would refuse fails
 * here), the fee rule `EvmRpc.estimate` uses (2 x base fee + priority) and the delegator's native balance.
 */
export declare function readMetaMaskRevocationChain(call: MmRpcCall, deployment: MetaMaskGaslessDeployment, dispatched: MetaMaskGaslessIntent, disable: MetaMaskDisableCall, operationId: string): Promise<MetaMaskRevocationChain>;
export declare const mmRevocationPayload: (disable: MetaMaskDisableCall, chain: MetaMaskRevocationChain) => Readonly<Record<string, Hex>>;
