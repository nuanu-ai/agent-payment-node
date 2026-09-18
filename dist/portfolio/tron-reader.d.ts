import type { BatchBalanceRequest, BatchBalanceResult, FamilyBalanceBatchPort } from "../asset-portfolio-reader.js";
import type { PortfolioHttpPort } from "./https.js";
/**
 * TRON has no batch API: genesis identity, the solidified head (provenance anchor), `walletsolidity/getaccount`
 * for TRX and one `walletsolidity/triggerconstantcontract` `balanceOf` per listed TRC-20 token.
 */
export declare class TronPortfolioPort implements FamilyBalanceBatchPort {
    private readonly http;
    readonly family: "tron";
    constructor(http: PortfolioHttpPort);
    read(request: BatchBalanceRequest): Promise<BatchBalanceResult>;
}
