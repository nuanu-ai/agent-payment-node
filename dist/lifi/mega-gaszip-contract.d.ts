import { type Hex } from "viem";
/** A separate GasZip direct deposit; never grants LI.FI GasZip execution. */
export declare const MEGA_FUNDING: Readonly<{
    sourceChain: 8453;
    destinationChain: 4326;
    short: 514;
    owner: `0x${string}`;
    profile: "default";
    target: `0x${string}`;
    data: Hex;
    maximumAmount: 10000000000000n;
    maximumFee: 1000000000000n;
    minimumOutput: 8000000000000n;
    mechanism: {
        provider: string;
        reference: string;
    };
}>;
export declare function megaFail(reason: string): never;
export declare function megaObject(v: unknown): Record<string, unknown>;
export declare function megaUint(v: unknown): bigint;
export declare function megaQuantity(v: unknown): bigint;
export declare function megaHash(v: unknown): Hex;
export declare function megaAddress(v: unknown): string;
/** Parse integer lexemes without Number rounding. Unsafe numeric inputs supplied without their source are refused. */
export declare function megaJson(text: string): unknown;
export declare function megaExact(v: Record<string, unknown>, required: readonly string[], optional?: readonly string[]): void;
export interface MegaFundingQuote {
    readonly digest: string;
    readonly expiresAt: string;
    readonly expectedAtomic: string;
    readonly body: unknown;
}
export declare function inspectMegaFundingQuote(value: unknown, now: number): MegaFundingQuote;
export interface MegaCorrelatedDelivery {
    readonly hash: Hex;
    readonly amount: string;
    readonly signer: string;
    readonly nonce: string;
    readonly providerDigest: string;
}
/** Provider mapping authorizes observation only; both effects must be independently proved by their chain RPC. */
export declare function inspectMegaDelivery(value: unknown, sourceHash: Hex, owner: string, amount: string, sourceBlock?: string): MegaCorrelatedDelivery | null;
