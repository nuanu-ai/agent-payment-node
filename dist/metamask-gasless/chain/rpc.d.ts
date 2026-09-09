import type { ClockPort } from "../../ports.js";
import type { Address, Hex } from "../../model.js";
import { type GaslessTransport } from "../../gasless/https.js";
import type { MetaMaskGaslessBalance, MetaMaskGaslessChainId, MetaMaskGaslessCursor, MetaMaskGaslessIntent, MetaMaskGaslessProviderObservation, MetaMaskGaslessRpcObservation, MetaMaskGaslessSnapshot } from "../model.js";
import type { MetaMaskGaslessRpcFactory, MetaMaskGaslessRpcPort } from "../ports.js";
export { validateMetaMaskGaslessSnapshot } from "./snapshot.js";
export interface MetaMaskGaslessRpcOptions {
    readonly chainId: MetaMaskGaslessChainId;
    readonly rpcUrl: string;
    readonly clock: ClockPort;
    readonly transport?: GaslessTransport;
}
/** Lazy environment binding. Merely creating the factory performs no DNS, RPC, provider, or state I/O. */
export declare function metaMaskGaslessRpcFactory(environment: Readonly<Record<string, string | undefined>>, clock: ClockPort, transport?: GaslessTransport): MetaMaskGaslessRpcFactory;
export declare class MetaMaskGaslessRpc implements MetaMaskGaslessRpcPort {
    readonly chainId: MetaMaskGaslessChainId;
    readonly endpointOrigin: string;
    readonly endpointHash: string;
    readonly rpcUrl: string;
    private readonly deployment;
    private readonly clock;
    private readonly transport;
    private sequence;
    private readonly callRpc;
    constructor(options: MetaMaskGaslessRpcOptions);
    balance(ownerInput: Address): Promise<MetaMaskGaslessBalance>;
    snapshot(input: {
        readonly owner: Address;
        readonly delegationHash: Hex;
        readonly grossAtomic: string;
    }): Promise<MetaMaskGaslessSnapshot>;
    observe(intent: MetaMaskGaslessIntent, cursor: MetaMaskGaslessCursor, provider: MetaMaskGaslessProviderObservation | null): Promise<MetaMaskGaslessRpcObservation>;
    private assertIntent;
    private assertChain;
    private call;
}
