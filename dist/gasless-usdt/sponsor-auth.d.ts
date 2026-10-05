import type { ClockPort } from "../ports.js";
import type { Address, Hex } from "../model.js";
import type { GaslessTransport } from "../gasless/https.js";
import type { UsdtUserOperation } from "./userop.js";
/** Material from a trusted canonical safe snapshot, not a caller's verification boolean. */
export interface UsdtSponsorSnapshot {
    readonly chainId: bigint;
    readonly blockNumber: bigint;
    readonly blockHash: Hex;
    readonly pins: {
        readonly token: Hex;
        readonly entryPoint: Hex;
        readonly delegate: Hex;
        readonly paymaster: Hex;
        readonly paymasterEntryPoint: Address;
    };
}
export declare function assertUsdtSponsorWindow(op: UsdtUserOperation, clock: ClockPort): string;
/** One read-only batch; caller's existing transport owns admission/pacing. No wallet/custody access. */
export declare function attestUsdtSponsor(input: {
    readonly op: UsdtUserOperation;
    readonly snapshot: UsdtSponsorSnapshot;
    readonly expectedBlockHash: Hex;
    readonly transport: GaslessTransport;
    readonly rpcUrl: string;
    readonly clock: ClockPort;
}): Promise<{
    chainId: string;
    blockNumber: string;
    blockHash: `0x${string}`;
    pins: {
        token: Hex;
        entryPoint: Hex;
        delegate: Hex;
        paymaster: Hex;
        paymasterEntryPoint: Address;
    };
    membership: true;
    parityHash: `0x${string}`;
    capturedAt: string;
    sponsorHash: Hex;
    signedDigest: Hex;
    signature: Hex;
    signer: Address;
    userOperationDigest: string;
    schemaVersion: "apn.gasless-usdt-sponsor-auth.v1";
}>;
