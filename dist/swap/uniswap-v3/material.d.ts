import { type Hex } from "viem";
import { SecureStateStore } from "../../secure-state-store.js";
import { type SwapQuoteSnapshot } from "../quote.js";
import type { GuardedSwapPreparedMaterial } from "../runtime.js";
import type { UniswapTransactionEnvelope } from "../uniswap-codec.js";
import type { UniswapV3PoolQuote } from "./onchain.js";
import { type UniswapV3CodePin } from "./pins.js";
export declare const UNISWAP_KEYLESS_EXECUTION_SCHEMA: "apn.uniswap-v3-keyless-execution.v1";
export declare const UNISWAP_KEYLESS_EVIDENCE_DOMAIN: "apn.uniswap-v3-onchain-evidence.v1";
/** Read-only chain facts behind one quote. Its domain hash is the quote's providerResponseHash. */
export interface UniswapKeylessEvidence {
    readonly chainId: 1;
    readonly blockNumber: string;
    readonly blockHash: Hex;
    readonly baseFeePerGas: string;
    readonly accountBalanceWei: string;
    readonly codePins: readonly UniswapV3CodePin[];
    readonly pool: UniswapV3PoolQuote;
}
export interface UniswapKeylessExecution {
    readonly schemaVersion: typeof UNISWAP_KEYLESS_EXECUTION_SCHEMA;
    readonly envelope: UniswapTransactionEnvelope;
    readonly deadline: number;
    readonly evidence: UniswapKeylessEvidence;
}
export interface UniswapKeylessMaterial extends GuardedSwapPreparedMaterial {
    readonly quote: SwapQuoteSnapshot;
    readonly approvalCapAtomic: "0";
    readonly execution: UniswapKeylessExecution;
}
export declare function uniswapEvidenceHash(evidence: UniswapKeylessEvidence): string;
/** Proves the stored unsigned transaction, gas display and chain evidence are exactly the ones the quote hash binds. */
export declare function validateUniswapKeylessMaterial(value: unknown, mode?: "input" | "stored"): UniswapKeylessMaterial;
export declare function uniswapGasDisplay(envelope: UniswapTransactionEnvelope): Readonly<Record<string, string>>;
/** Saved-quote store: GuardedSwapReadOnlyBuilder.load resolves prepared material here by quote hash. */
export declare class SavedUniswapQuoteStore extends SecureStateStore {
    private initialized;
    save(value: UniswapKeylessMaterial): Promise<UniswapKeylessMaterial>;
    load(quoteHash: string): Promise<UniswapKeylessMaterial | null>;
    private path;
    private ready;
}
