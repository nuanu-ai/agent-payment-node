import { SecureStateStore } from "../../secure-state-store.js";
import { type SwapQuoteSnapshot } from "../quote.js";
import type { GuardedSwapPreparedMaterial } from "../runtime.js";
import { SOLANA_MAINNET_GENESIS } from "./catalog.js";
import { type JupiterV1QuoteResponse, type JupiterV1RawBuildResponse, type JupiterV1RawInstruction } from "./v1-codec.js";
export declare const JUPITER_V1_MATERIAL_SCHEMA: "apn.jupiter-v1-resolved-material.v1";
export interface JupiterV1SemanticAccount {
    readonly address: string;
    readonly existence: "present" | "absent";
    readonly owner: string | null;
    readonly executable: boolean;
    readonly lamports: string;
    readonly dataBase64: string;
    readonly dataHash: string;
    readonly slot: string;
}
export interface JupiterV1AddressTable {
    readonly account: JupiterV1SemanticAccount;
    readonly addresses: readonly string[];
    readonly deactivationSlot: string;
    readonly lastExtendedSlot: string;
}
export interface JupiterV1RuntimeProgramPin {
    readonly programId: string;
    readonly loader: string;
    readonly programDataAddress: string | null;
    readonly deploymentSlot: string | null;
    readonly upgradeAuthority: string | null;
    readonly accountHash: string;
    readonly programDataHash: string | null;
    readonly storedPayloadHash: string;
    readonly provenance: "runtime_bytes_only";
}
export interface JupiterV1CompiledAccount {
    readonly address: string;
    readonly signer: boolean;
    readonly writable: boolean;
    readonly source: "static" | "lookup";
}
export interface JupiterV1ResolvedMaterial {
    readonly schemaVersion: typeof JUPITER_V1_MATERIAL_SCHEMA;
    readonly genesis: typeof SOLANA_MAINNET_GENESIS;
    readonly payer: string;
    readonly quoteResponse: JupiterV1QuoteResponse;
    readonly rawBuildResponse: JupiterV1RawBuildResponse;
    readonly quoteResponseHash: string;
    readonly rawBuildResponseHash: string;
    readonly lifetime: {
        readonly blockhash: string;
        readonly lastValidBlockHeight: string;
    };
    /** Obtained before quote freeze; the original official build stays untouched. */
    readonly quoteRpcLifetime?: JupiterV1QuoteRpcLifetime;
    readonly transactionBase64: string;
    readonly transactionHash: string;
    readonly messageBase64: string;
    readonly messageHash: string;
    readonly rawInstructions: readonly JupiterV1RawInstruction[];
    readonly compiledAccounts: readonly JupiterV1CompiledAccount[];
    readonly lookupBindingDigest: string;
    readonly semanticAccounts: readonly JupiterV1SemanticAccount[];
    readonly addressTables: readonly JupiterV1AddressTable[];
    readonly programPins: readonly JupiterV1RuntimeProgramPin[];
    readonly accountSlot: string;
    readonly currentBlockHeight: string;
    readonly networkFeeLamports: string | null;
    readonly tokenAccountRentLamports: string;
    readonly maximumNativeExpenseLamports: string;
    readonly materialDigest: string;
}
export interface JupiterV1QuoteRpcLifetime {
    readonly source: "configured_mainnet_rpc_before_quote_freeze";
    readonly rpcOriginHash: string;
    readonly contextSlot: string;
    readonly minimumContextSlot: string;
    readonly blockhash: string;
    readonly lastValidBlockHeight: string;
}
export declare function checkedJupiterV1QuoteRpcLifetime(value: unknown): JupiterV1QuoteRpcLifetime;
/** A saved RPC lifetime cannot silently move to another configured endpoint.
 * Legacy material has no origin evidence; its existing genesis and pin guards remain.
 */
export declare function assertJupiterV1RpcOrigin(originHash: string, lifetime?: JupiterV1QuoteRpcLifetime): void;
export interface JupiterV1PreparedMaterial extends GuardedSwapPreparedMaterial {
    readonly quote: SwapQuoteSnapshot;
    readonly approvalCapAtomic: "0";
    readonly execution: JupiterV1ResolvedMaterial;
}
export declare function jupiterV1MaterialDigest(value: Omit<JupiterV1ResolvedMaterial, "materialDigest">): string;
export declare function validateJupiterV1Material(value: unknown): JupiterV1ResolvedMaterial;
export declare function assertJupiterV1FreshMaterial(material: JupiterV1ResolvedMaterial): void;
export declare function validateJupiterV1PreparedMaterial(value: unknown): JupiterV1PreparedMaterial;
/** Complete public ProgramData bytes are chunked below the shared store's 1 MiB per-file cap. */
export declare function jupiterV1GasDisplay(execution: JupiterV1ResolvedMaterial): Readonly<Record<string, string>>;
export declare class SavedJupiterV1MaterialStore extends SecureStateStore {
    private initialized;
    save(value: JupiterV1PreparedMaterial): Promise<JupiterV1PreparedMaterial>;
    load(hash: string): Promise<JupiterV1PreparedMaterial | null>;
    private readMaterial;
    private path;
    protected initializeStorage(): Promise<void>;
    private ready;
}
