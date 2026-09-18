import type { BatchBalanceRequest, BatchBalanceResult, FamilyBalanceBatchPort } from "../asset-portfolio-reader.js";
import type { PortfolioHttpPort } from "./https.js";
/**
 * One HTTP request: a JSON-RPC batch of `getGenesisHash` and one `getMultipleAccounts` for the owner plus the
 * associated token account of every listed mint. Tokens held outside the associated account are not counted.
 */
export declare class SolanaPortfolioPort implements FamilyBalanceBatchPort {
    private readonly http;
    readonly family: "solana";
    constructor(http: PortfolioHttpPort);
    read(request: BatchBalanceRequest): Promise<BatchBalanceResult>;
}
