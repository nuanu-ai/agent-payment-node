import { type HistoricalRetirementDiagnostic } from "./historical-retirement-diagnostic-types.js";
import { type OwnedJupiterHistoricalRetirementAuthority, type OwnedJupiterHistoricalRetirementContext, type JupiterHistoricalRetirementPublicResult } from "./historical-retirement-owner.js";
/** Read-only provenance lookup; no diagnostic issuer is exported. */
export declare function historicalRetirementConsumerDiagnostic(error: unknown): HistoricalRetirementDiagnostic | undefined;
/** The accounting record is the sole linearization point; no old operation/lease/receipt is rewritten. */
export declare function consumeJupiterHistoricalRetirement(token: OwnedJupiterHistoricalRetirementAuthority, context: OwnedJupiterHistoricalRetirementContext): Promise<JupiterHistoricalRetirementPublicResult>;
/** Record-first restart repair. Reads no current policy, private material, RPC or owner key. */
export declare function recoverCommittedJupiterHistoricalRetirement(operationId: string, state: OwnedJupiterHistoricalRetirementContext["state"]): Promise<JupiterHistoricalRetirementPublicResult | null>;
