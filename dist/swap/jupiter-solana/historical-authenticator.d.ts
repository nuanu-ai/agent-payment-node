import type { WrappingSecretPort } from "../../macos-keychain.js";
import { type HistoricalJupiterProjection } from "./historical-projection-reader.js";
export { HISTORICAL_JUPITER_IDS } from "./historical-pins.js";
export type { HistoricalJupiterProjection } from "./historical-projection-reader.js";
declare const brand: unique symbol;
export interface HistoricalJupiterMaterialAuthority {
    readonly [brand]: true;
}
/** Finite historical owner issuer. Neither a public DTO nor a caller-supplied reader can issue authority. */
export declare class JupiterHistoricalAuthenticator {
    #private;
    constructor(root: string, wrapping: WrappingSecretPort);
    authenticate(operationId: string): Promise<{
        readonly projection: HistoricalJupiterProjection;
        readonly authority: HistoricalJupiterMaterialAuthority;
    }>;
    consume(authority: HistoricalJupiterMaterialAuthority, operationId: string): Promise<HistoricalJupiterProjection>;
}
