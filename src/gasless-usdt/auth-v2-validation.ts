import { concat, getAddress, keccak256 } from "viem";
import { canonicalJson, exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { decodeUsdtPaymasterData } from "./paymaster-data.js";
import { recoverUsdtSponsor, usdtSponsorHash } from "./sponsor-hash.js";
import { USDT_GASLESS, usdtFailure, type UsdtTokenQuote, type UsdtGasPrice } from "./model.js";
import type { UsdtSponsorAuthEvidence, UsdtSponsorSnapshot } from "./sponsor-auth.js";
import type { UsdtUserOperation } from "./userop.js";

export function usdtQuoteChangedFields(initial: UsdtTokenQuote, price: UsdtGasPrice, fresh: UsdtTokenQuote, freshPrice: UsdtGasPrice): readonly string[] {
  return ["postOpGas", "exchangeRate", "exchangeRateNativeToUsd"].filter(k => initial[k as keyof UsdtTokenQuote] !== fresh[k as keyof UsdtTokenQuote])
    .map(k => `quote.${k}`).concat(["maxFeePerGas", "maxPriorityFeePerGas"].filter(k => price[k as keyof UsdtGasPrice] !== freshPrice[k as keyof UsdtGasPrice]).map(k => `price.${k}`));
}
/** Strict saved capture relationships; this is evidence, not current chain authorization. */
export function assertUsdtV2Evidence(op: UsdtUserOperation, evidence: unknown, snapshot: UsdtSponsorSnapshot): asserts evidence is UsdtSponsorAuthEvidence {
  function fail(): never { return usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_auth_evidence"); }
  if (!isPlainRecord(evidence) || !exactKeys(evidence, ["schemaVersion", "sponsorHash", "signedDigest", "signature", "signer", "userOperationDigest",
    "chainId", "blockNumber", "blockHash", "pins", "membership", "parityHash", "capturedAt"])) fail();
  if (!isPlainRecord(snapshot.pins) || !exactKeys(snapshot.pins, ["token", "entryPoint", "delegate", "paymaster", "paymasterEntryPoint"]) || snapshot.blockNumber < 1n || !/^0x[0-9a-f]{64}$/u.test(snapshot.blockHash)) fail();
  const hash = usdtSponsorHash(op), signature = decodeUsdtPaymasterData(op.paymasterData).signature;
  const s = BigInt(`0x${signature.slice(66, 130)}`), v = signature.slice(130);
  if (s === 0n || s > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n || !["1b", "1c"].includes(v)) fail();
  if (evidence.schemaVersion !== "apn.gasless-usdt-sponsor-auth.v1" || evidence.sponsorHash !== hash || evidence.parityHash !== hash ||
    evidence.signedDigest !== keccak256(concat(["0x19457468657265756d205369676e6564204d6573736167653a0a3332", hash])) ||
    evidence.signature !== signature || evidence.userOperationDigest !== hashObject(op) || evidence.membership !== true ||
    evidence.chainId !== "1" || snapshot.chainId !== 1n || evidence.blockNumber !== snapshot.blockNumber.toString() ||
    evidence.blockHash !== snapshot.blockHash || canonicalJson(evidence.pins) !== canonicalJson(snapshot.pins) ||
    snapshot.pins.token !== USDT_GASLESS.tokenCodeHash || snapshot.pins.paymaster !== USDT_GASLESS.paymasterCodeHash ||
    snapshot.pins.entryPoint !== USDT_GASLESS.entryPointCodeHash || snapshot.pins.delegate !== USDT_GASLESS.delegateCodeHash ||
    snapshot.pins.paymasterEntryPoint !== USDT_GASLESS.entryPoint || typeof evidence.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(evidence.capturedAt)) || new Date(evidence.capturedAt).toISOString() !== evidence.capturedAt) fail();
  try { if (typeof evidence.signer !== "string" || getAddress(evidence.signer) !== evidence.signer || /^0x0{40}$/u.test(evidence.signer)) fail(); }
  catch { fail(); }
}
export async function verifyUsdtV2Auth(op: UsdtUserOperation, evidence: UsdtSponsorAuthEvidence, snapshot: UsdtSponsorSnapshot): Promise<void> {
  assertUsdtV2Evidence(op, evidence, snapshot);
  const recovered = await recoverUsdtSponsor(op);
  for (const key of ["sponsorHash", "signedDigest", "signature", "signer", "userOperationDigest"] as const) {
    if (recovered[key] !== evidence[key]) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_identity_changed");
  }
}
