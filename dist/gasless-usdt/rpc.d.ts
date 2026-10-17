import type { GaslessTransport } from "../gasless/https.js";
import type { Address, Hex } from "../model.js";
import type { UsdtAccountState, UsdtSponsorPort } from "./engine.js";
import type { UsdtRecoveryPort } from "./recovery.js";
import type { UsdtUserOperation } from "./userop.js";
/** One JSON-RPC exchange over the pinned public HTTPS transport; exact envelope, no retry, bounded provider text. */
export declare class UsdtJsonRpc {
    private readonly transport;
    private readonly endpoint;
    private readonly methods;
    private sequence;
    constructor(transport: GaslessTransport, endpoint: string, methods: ReadonlySet<string>);
    call(method: string, params: readonly unknown[]): Promise<unknown>;
    /** One physical exchange. Every response must match exactly one requested id, in any order. */
    batch(calls: readonly {
        readonly method: string;
        readonly params: readonly unknown[];
    }[], phase?: "batch" | "safe_head" | "account_snapshot"): Promise<readonly unknown[]>;
}
type UsdtCodeHashPins = Omit<import("./sponsor-auth.js").UsdtSponsorSnapshot["pins"], "paymasterEntryPoint">;
/**
 * Code at an address cannot change on Ethereum (EIP-6780), and none of the four pinned contracts is a proxy. One verified
 * `eth_getCode` read per command invocation and RPC endpoint therefore proves them for every later safe snapshot of that
 * invocation; the storage-backed fee, pause and EntryPoint reads stay in every snapshot.
 */
export declare class UsdtCodePins {
    private proven;
    provenFor(rpcUrl: string): UsdtCodeHashPins | null;
    prove(rpcUrl: string, codes: readonly unknown[]): UsdtCodeHashPins;
}
/** Read one authenticated safe-block account view. Every contract and account read uses the same safe tag. */
export declare function usdtSafeSnapshot(transport: GaslessTransport, rpcUrl: string, sender: Address, codePins: UsdtCodePins): Promise<{
    readonly chainId: bigint;
    readonly blockNumber: bigint;
    readonly blockHash: Hex;
    readonly account: UsdtAccountState;
    readonly pins: import("./sponsor-auth.js").UsdtSponsorSnapshot["pins"];
}>;
/**
 * The keyless sponsor is the mechanism itself: Pimlico's public endpoint for chain 1, fixed, never configurable, so the
 * paymaster named by the capability registry is the one the owner's allowlist pin names.
 */
export declare function usdtSponsorPort(transport: GaslessTransport): UsdtSponsorPort;
/** A single keyless Pimlico dispatch. The caller must persist its submitting intent first. */
export declare function usdtSendPort(transport: GaslessTransport): (op: UsdtUserOperation) => Promise<Hex>;
/** One keyless locator read and bounded public chain reads; the caller supplies its paced transport. */
export declare function usdtRecoveryPort(transport: GaslessTransport, rpcUrl: string): UsdtRecoveryPort;
export {};
