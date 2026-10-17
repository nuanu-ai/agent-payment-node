/**
 * Frozen copies of the pins the Stargate readers of 60b247d5^ (the last tree that read native schema v1 and token schemas
 * v1..v4) checked. These records were written only by unreleased builds of 2026-09-20; they stay on owners' disks, so their
 * reader stays, read-only. Never edit these values to follow the live lanes: they describe what those builds wrote.
 */
export declare const LEGACY_NATIVE_LANE: Readonly<{
    sourceChain: 1;
    destinationChain: 130;
    sourceEid: 30101;
    destinationEid: 30320;
    sourcePool: `0x${string}`;
    destinationPool: `0x${string}`;
}>;
export declare const LEGACY_TOKEN_LANE: Readonly<{
    sourceChain: 10;
    destinationChain: 137;
    sourceEid: 30111;
    destinationEid: 30109;
    sourceToken: `0x${string}`;
    destinationToken: `0x${string}`;
    sourcePool: `0x${string}`;
    destinationPool: `0x${string}`;
    sourceExecutor: `0x${string}`;
    maxBridgeGas: 5000000n;
}>;
export declare const LEGACY_TOKEN_MECHANISM: Readonly<{
    provider: "stargate-v2";
    reference: `eip155:10:0x${string}/eip155:137:0x${string}`;
}>;
export declare const UINT: RegExp;
export declare function fail(reason: string): never;
/** A v1 record either carries no policy (the reader derived the historical all-safe one) or exactly that derived policy. */
export declare function assertLegacyV1Policy(record: Readonly<Record<string, unknown>>, source: number, destination: number): void;
/** Every later unreleased schema froze the pinned policy at prepare. */
export declare function assertPinnedPolicy(record: Readonly<Record<string, unknown>>, source: number, destination: number): void;
