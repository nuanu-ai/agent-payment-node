import { SecureStateStore } from "../secure-state-store.js";
import { z } from "zod";
export declare const nonEvmOperationSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    route: z.ZodLiteral<"base_usdc_to_solana_usdc_circle_cctp_v2">;
    destination: z.ZodObject<{
        chain: z.ZodLiteral<"solana-mainnet">;
        token: z.ZodLiteral<"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v">;
        recipient: z.ZodString;
        minimumReceivedAtomic: z.ZodString;
    }, z.core.$strict>;
    provider: z.ZodObject<{
        kind: z.ZodLiteral<"circle_cctp_v2">;
        feeQuoteHash: z.ZodString;
        requestId: z.ZodString;
        sourceDomain: z.ZodLiteral<6>;
        destinationDomain: z.ZodLiteral<5>;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<"apn.non-evm-bridge-operation.v2">;
    kind: z.ZodLiteral<"non_evm_bridge_intent">;
    executionAdmitted: z.ZodLiteral<false>;
    state: z.ZodLiteral<"unchecked_draft">;
    sourceCallValidation: z.ZodLiteral<"unchecked">;
    profileHash: z.ZodString;
    operationId: z.ZodString;
    requestHash: z.ZodString;
    createdAt: z.ZodString;
    expiresAt: z.ZodString;
    source: z.ZodObject<{
        chainId: z.ZodLiteral<8453>;
        token: z.ZodLiteral<"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913">;
        owner: z.ZodString;
        amountAtomic: z.ZodString;
    }, z.core.$strict>;
    sourceCall: z.ZodObject<{
        chainId: z.ZodLiteral<8453>;
        from: z.ZodString;
        to: z.ZodString;
        valueAtomic: z.ZodString;
        data: z.ZodString;
        dataSha256: z.ZodString;
    }, z.core.$strict>;
    maxSourceNativeDebitWei: z.ZodString;
    maxProviderFeeAtomic: z.ZodString;
    integrityHash: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    route: z.ZodLiteral<"base_usdc_to_tron_usdt_lifi_near_intents">;
    destination: z.ZodObject<{
        chainId: z.ZodLiteral<728126428>;
        token: z.ZodLiteral<"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t">;
        recipient: z.ZodString;
        minimumReceivedAtomic: z.ZodString;
    }, z.core.$strict>;
    provider: z.ZodObject<{
        kind: z.ZodLiteral<"lifi_near_intents">;
        quoteHash: z.ZodString;
        routeId: z.ZodString;
        stepId: z.ZodString;
        transactionId: z.ZodString;
        quoteId: z.ZodString;
        depositAddress: z.ZodString;
    }, z.core.$strict>;
    schemaVersion: z.ZodLiteral<"apn.non-evm-bridge-operation.v2">;
    kind: z.ZodLiteral<"non_evm_bridge_intent">;
    executionAdmitted: z.ZodLiteral<false>;
    state: z.ZodLiteral<"unchecked_draft">;
    sourceCallValidation: z.ZodLiteral<"unchecked">;
    profileHash: z.ZodString;
    operationId: z.ZodString;
    requestHash: z.ZodString;
    createdAt: z.ZodString;
    expiresAt: z.ZodString;
    source: z.ZodObject<{
        chainId: z.ZodLiteral<8453>;
        token: z.ZodLiteral<"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913">;
        owner: z.ZodString;
        amountAtomic: z.ZodString;
    }, z.core.$strict>;
    sourceCall: z.ZodObject<{
        chainId: z.ZodLiteral<8453>;
        from: z.ZodString;
        to: z.ZodString;
        valueAtomic: z.ZodString;
        data: z.ZodString;
        dataSha256: z.ZodString;
    }, z.core.$strict>;
    maxSourceNativeDebitWei: z.ZodString;
    maxProviderFeeAtomic: z.ZodString;
    integrityHash: z.ZodString;
}, z.core.$strict>], "route">;
export type NonEvmBridgeOperation = z.infer<typeof nonEvmOperationSchema>;
export type NonEvmBridgeOperationInput = NonEvmBridgeOperation extends infer T ? T extends NonEvmBridgeOperation ? Omit<T, "integrityHash"> : never : never;
export declare function validateNonEvmBridgeOperation(value: unknown): NonEvmBridgeOperation;
export declare function freezeNonEvmBridgeOperation(input: NonEvmBridgeOperationInput): NonEvmBridgeOperation;
/** Separate immutable namespace; no bridge_route operation can be read from here. */
export declare class NonEvmBridgeOperationRepository extends SecureStateStore {
    save(op: NonEvmBridgeOperation): Promise<void>;
    load(profileHash: string, operationId: string): Promise<NonEvmBridgeOperation | null>;
    private path;
}
