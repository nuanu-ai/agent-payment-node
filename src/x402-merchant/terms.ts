import { getAddress } from "viem";
import type { MerchantAssetPin } from "./asset-pins.js";
import type { MerchantOperation } from "./model.js";
import type { FrozenMerchantChallenge } from "./protocol.js";
import { LEGACY_MERCHANT_ASSET, LEGACY_MERCHANT_MECHANISM, LEGACY_MERCHANT_URL, MERCHANT_CHAIN, merchantAssetMechanism } from "./pins.js";

/**
 * The exact payment one merchant operation makes. The payer is always the operation's own custody wallet; the payee
 * and amount are the challenge row frozen at prepare; the asset is the pin that row named.
 */
export interface MerchantTerms {
  readonly payer: string;
  readonly url: string;
  readonly chain: typeof MERCHANT_CHAIN;
  readonly token: string;
  readonly payee: string;
  readonly amount: string;
  readonly mechanism: Readonly<{ provider: string; reference: string }>;
  readonly asset: MerchantAssetPin;
  /** Version 1 (x402engine Bitcoin-price lane): legacy mechanism, URL and delivery schema. */
  readonly legacy: boolean;
  /** The operation's fee context is v1 (pinned GasPriceOracle, zero operator fee); new operations use v2. */
  readonly feePins: boolean;
}

function terms(payer: string, url: string, accepted: Readonly<Record<string, unknown>>, asset: MerchantAssetPin, legacy: boolean, feePins: boolean): MerchantTerms {
  return { payer, url, chain: asset.chain, token: asset.token, payee: getAddress(String(accepted.payTo)), amount: String(accepted.amount),
    mechanism: legacy ? LEGACY_MERCHANT_MECHANISM : merchantAssetMechanism(asset), asset, legacy, feePins };
}

/** Terms of a new operation: payer custody(profile), `--url`, and the single challenge row naming a pinned asset. */
export function merchantPrepareTerms(payer: string, url: string, frozen: FrozenMerchantChallenge, asset: MerchantAssetPin): MerchantTerms {
  return terms(payer, url, frozen.accepted, asset, false, false);
}

/** Terms of a stored operation, from its own recorded custody, URL, asset and frozen row (version 1: the frozen legacy table). */
export function merchantTerms(o: Pick<MerchantOperation, "schemaVersion" | "custody" | "frozen" | "url" | "asset" | "feeContext">): MerchantTerms {
  const feePins = o.feeContext?.schemaVersion !== "apn.merchant-mega-fee.v2";
  return o.schemaVersion === "apn.x402-merchant.v1"
    ? terms(o.custody.walletAddress, LEGACY_MERCHANT_URL, o.frozen.accepted, LEGACY_MERCHANT_ASSET, true, feePins)
    : terms(o.custody.walletAddress, o.url!, o.frozen.accepted, o.asset!, false, feePins);
}
