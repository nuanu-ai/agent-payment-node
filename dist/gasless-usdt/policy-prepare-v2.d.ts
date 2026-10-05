import { type UsdtSponsorPort } from "./engine.js";
import { type UsdtPolicyPrepared, type UsdtPreparePort, type UsdtPolicyPrepareRequest } from "./policy-prepare.js";
import { validateUsdtGasPrice, validateUsdtTokenQuote } from "./quote.js";
import { type UsdtV2Plan } from "./economics-v2.js";
import type { UsdtSponsorAuthEvidence } from "./sponsor-auth.js";
export declare function consumeUsdtV2Prepared(binding: UsdtPolicyPreparedV2): void;
export interface UsdtPolicyPreparedV2 extends Omit<UsdtPolicyPrepared, "schemaVersion" | "plan"> {
    readonly schemaVersion: "apn.gasless-usdt-policy-prepare.v2";
    readonly plan: UsdtV2Plan;
    readonly quoteFacts: {
        readonly initialQuote: ReturnType<typeof validateUsdtTokenQuote>;
        readonly initialPrice: ReturnType<typeof validateUsdtGasPrice>["fast"];
        readonly freshQuote: ReturnType<typeof validateUsdtTokenQuote>;
        readonly freshPrice: ReturnType<typeof validateUsdtGasPrice>["fast"];
        readonly changedFields: readonly string[];
    };
    readonly sponsorAuth: UsdtSponsorAuthEvidence;
}
export declare function preparePolicyBoundUsdtV2(ports: {
    readonly prepare: UsdtPreparePort;
    readonly sponsor: Pick<UsdtSponsorPort, "tokenQuote" | "gasPrice" | "paymasterData">;
}, request: UsdtPolicyPrepareRequest): Promise<UsdtPolicyPreparedV2>;
