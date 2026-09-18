export declare const SWAP_MECHANISM_PIN_SCHEMA: "apn.swap-mechanism-pin.v1";
export type SwapProtocolFamily = "uniswap_ethereum" | "sunswap_tron" | "jupiter_solana" | "orca_solana";
export type SwapNetworkFamily = "evm" | "tron" | "solana";
export interface SwapMechanismPin {
    readonly schemaVersion: typeof SWAP_MECHANISM_PIN_SCHEMA;
    readonly protocolFamily: SwapProtocolFamily;
    readonly networkFamily: SwapNetworkFamily;
    readonly chain: string;
    readonly protocolVersion: string;
    readonly constructorKind: "builder_api" | "sdk";
    readonly constructorIdentity: string;
    readonly constructorVersion: string;
    readonly routerProgramIdentity: string;
    readonly auxiliaryContractProgramIdentities: readonly string[];
    readonly quoteSchemaVersion: string;
    readonly transactionSchemaVersion: string;
    readonly validationPolicyIdentity: string;
    readonly validationPolicyVersion: string;
}
export declare function validateSwapMechanismPin(value: unknown): SwapMechanismPin;
export declare function swapMechanismDigest(value: unknown): string;
