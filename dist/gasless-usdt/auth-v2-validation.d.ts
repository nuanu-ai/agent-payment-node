import { type UsdtTokenQuote, type UsdtGasPrice } from "./model.js";
import type { UsdtSponsorAuthEvidence, UsdtSponsorSnapshot } from "./sponsor-auth.js";
import type { UsdtUserOperation } from "./userop.js";
export declare function usdtQuoteChangedFields(initial: UsdtTokenQuote, price: UsdtGasPrice, fresh: UsdtTokenQuote, freshPrice: UsdtGasPrice): readonly string[];
/** Strict saved capture relationships; this is evidence, not current chain authorization. */
export declare function assertUsdtV2Evidence(op: UsdtUserOperation, evidence: unknown, snapshot: UsdtSponsorSnapshot): asserts evidence is UsdtSponsorAuthEvidence;
export declare function verifyUsdtV2Auth(op: UsdtUserOperation, evidence: UsdtSponsorAuthEvidence, snapshot: UsdtSponsorSnapshot): Promise<void>;
