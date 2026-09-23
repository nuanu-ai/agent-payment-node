import type { GaslessTransport } from "../gasless/https.js";
import type { Address, Hex } from "../model.js";
import type { UsdtAccountState, UsdtChainPort, UsdtSponsorPort } from "./engine.js";
/** One JSON-RPC exchange over the pinned public HTTPS transport; exact envelope, no retry, bounded provider text. */
export declare class UsdtJsonRpc {
    private readonly transport;
    private readonly endpoint;
    private readonly methods;
    private sequence;
    constructor(transport: GaslessTransport, endpoint: string, methods: ReadonlySet<string>);
    call(method: string, params: readonly unknown[]): Promise<unknown>;
}
/** Read one authenticated safe-block account view. Every contract and account read uses the same safe tag. */
export declare function usdtSafeSnapshot(transport: GaslessTransport, rpcUrl: string, sender: Address): Promise<{
    readonly chainId: bigint;
    readonly blockNumber: bigint;
    readonly blockHash: Hex;
    readonly account: UsdtAccountState;
}>;
/**
 * The keyless sponsor is the mechanism itself: Pimlico's public endpoint for chain 1, fixed, never configurable, so the
 * paymaster named by the capability registry is the one the owner's allowlist pin names.
 */
export declare function usdtSponsorPort(transport: GaslessTransport): UsdtSponsorPort;
/** Canonical Ethereum reads through the owner's explicit `APN_ETHEREUM_RPC_URL`; no default endpoint exists. */
export declare function usdtChainPort(transport: GaslessTransport, rpcUrl: string): UsdtChainPort;
