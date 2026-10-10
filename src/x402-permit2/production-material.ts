import { selectPermit2Offer } from "./offer.js";
import { getAddress, hashTypedData } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { canonicalProfile } from "../wallet-policy.js";
import { validatePermit2CheckedChallenge, type Permit2CheckedChallenge } from "./checked-challenge.js";
import { preparePermit2Payment, type Permit2OwnerAdmission, type Permit2PrepareEvidence, type Permit2PreparedMaterial } from "./prepare.js";
import type { Permit2ReadCheckpoint } from "./read-port.js";
import type { Permit2WalletBinding } from "./owner-binding.js";
import { X402_PERMIT2_ASSETS } from "./registry.js";

export const PERMIT2_PRODUCTION_SCHEMA = "apn.x402-permit2-production.v2";
const asset = X402_PERMIT2_ASSETS[0]!;
const HASH = /^[a-f0-9]{64}$/u;
export interface Permit2ProductionMaterial {
  readonly checked: Permit2CheckedChallenge;
  readonly wallet: Permit2WalletBinding;
  readonly checkpoint: Permit2ReadCheckpoint;
  readonly owner: Permit2OwnerAdmission;
  readonly evidence: Permit2PrepareEvidence;
  readonly signingSecond: number;
  readonly nonce: string;
  /** Canonical decimal encoding of every bigint; reconstruction never revives arbitrary fields. */
  readonly preparedCanonicalJson: string;
  readonly typedDataDigest: string;
  readonly eip2612Digest: string | null;
  readonly materialHash: string;
}
export function preparedCanonicalJson(value: Permit2PreparedMaterial): string {
  return canonicalJson(JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)));
}
export function createPermit2ProductionMaterial(input: Omit<Permit2ProductionMaterial,
  "preparedCanonicalJson" | "typedDataDigest" | "eip2612Digest" | "materialHash">): Permit2ProductionMaterial {
  const prepared = reconstruct(input);
  const body = { ...input, preparedCanonicalJson: preparedCanonicalJson(prepared),
    typedDataDigest: hashTypedData(prepared.plan.permit2 as Parameters<typeof hashTypedData>[0]),
    eip2612Digest: prepared.plan.eip2612 === null ? null : hashTypedData(prepared.plan.eip2612.typedData as Parameters<typeof hashTypedData>[0]) };
  return validatePermit2ProductionMaterial({ ...body, materialHash: domainHash(`${PERMIT2_PRODUCTION_SCHEMA}.material`, canonicalJson(body)) });
}
export function reconstructPermit2ProductionMaterial(value: Permit2ProductionMaterial): Permit2PreparedMaterial {
  validatePermit2ProductionMaterial(value);
  return reconstruct(value);
}
function reconstruct(value: Omit<Permit2ProductionMaterial, "preparedCanonicalJson" | "typedDataDigest" | "eip2612Digest" | "materialHash">): Permit2PreparedMaterial {
  const checked = validatePermit2CheckedChallenge(value.checked);
  // Selection is independently reconstructed; no stored seller selection object becomes authority.
  const challenge = checked.challenge;
  const selection = selectPermit2Offer(challenge.accepts, value.wallet.account);
  const prepared = preparePermit2Payment({ payer: value.wallet.account, localWallet: true, challenge,
    expected: { index: selection.index, requirement: selection.requirement, challengeHash: checked.challengeHash },
    owner: value.owner, evidence: value.evidence, nowSeconds: value.signingSecond, nonce: BigInt(value.nonce) });
  if (prepared.plan.eip2612 !== null && (selection.requirement.extra.name !== asset.tokenDomain.name ||
      selection.requirement.extra.version !== asset.tokenDomain.version)) {
    throw new ApnError("APN_OPERATION_BLOCKED", "Sponsored production Permit2 requires matching merchant token domain hints.");
  }
  return prepared;
}
export function validatePermit2ProductionMaterial(value: unknown): Permit2ProductionMaterial {
  try {
    if (!isPlainRecord(value) || !exactKeys(value, ["checked", "wallet", "checkpoint", "owner", "evidence", "signingSecond", "nonce",
      "preparedCanonicalJson", "typedDataDigest", "eip2612Digest", "materialHash"])) corrupt();
    const v = value as unknown as Permit2ProductionMaterial;
    const { materialHash, ...body } = v;
    if (!HASH.test(materialHash) || materialHash !== domainHash(`${PERMIT2_PRODUCTION_SCHEMA}.material`, canonicalJson(body)) ||
        !Number.isSafeInteger(v.signingSecond) || v.signingSecond < 1 || !quantity(v.nonce) ||
        typeof v.preparedCanonicalJson !== "string" || Buffer.byteLength(v.preparedCanonicalJson) > 64 * 1024) corrupt();
    if (!isPlainRecord(v.wallet) || !exactKeys(v.wallet, ["profile", "profileHash", "account", "bindingHash", "provider", "providerRecordDigest", "walletChainId", "walletCreatedAt"]) ||
        canonicalProfile(v.wallet.profile) !== v.wallet.profile || v.wallet.provider !== "local" || !HASH.test(v.wallet.bindingHash) ||
        v.wallet.providerRecordDigest !== null && !HASH.test(v.wallet.providerRecordDigest) ||
        !Number.isSafeInteger(v.wallet.walletChainId) || v.wallet.walletChainId < 1 ||
        typeof v.wallet.walletCreatedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(v.wallet.walletCreatedAt) ||
        !Number.isFinite(Date.parse(v.wallet.walletCreatedAt)) || new Date(v.wallet.walletCreatedAt).toISOString() !== v.wallet.walletCreatedAt ||
        v.wallet.profileHash !== sha256(`profile\0${v.wallet.profile}`) || getAddress(v.wallet.account) !== v.wallet.account) corrupt();
    const c = v.checkpoint;
    if (!isPlainRecord(c) || !exactKeys(c, ["policyRevision", "registryVersion", "activationDigest", "blockNumber", "blockHash", "blockTimestamp", "facilitatorSupportedDigest"]) ||
        !Number.isSafeInteger(c.policyRevision) || c.policyRevision < 1 || typeof c.registryVersion !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(c.registryVersion) || !HASH.test(c.activationDigest) || !quantity(c.blockNumber) ||
        !/^0x[a-f0-9]{64}$/u.test(c.blockHash) || !Number.isSafeInteger(c.blockTimestamp) || c.blockTimestamp < 1 || c.blockTimestamp !== v.evidence.observedAtSeconds ||
        !HASH.test(c.facilitatorSupportedDigest)) corrupt();
    if (!isPlainRecord(v.owner) || !exactKeys(v.owner, ["active", "account", "chain", "token", "rail", "mechanism",
      "maximumPerTransferAtomic", "dailyLimitAtomic", "usedTodayAtomic", "policyDigest"]) ||
        v.owner.active !== true || !isPlainRecord(v.owner.mechanism) || !exactKeys(v.owner.mechanism, ["provider", "reference"])) corrupt();
    const e = v.evidence;
    if (!isPlainRecord(e) || !exactKeys(e, ["chainId", "account", "observedAtSeconds", "balanceAtomic", "allowanceAtomic", "tokenDomainSeparator",
      "proxyCodeHash", "permit2Deployed", "nonceBitmapWordIndex", "nonceBitmapWord", "eip2612Nonce", "facilitator"]) ||
        !isPlainRecord(e.facilitator) || !exactKeys(e.facilitator, ["available", "network", "scheme", "asset", "assetTransferMethod",
          "permit2Address", "exactProxy", "eip2612GasSponsoring"]) || e.facilitator.available !== true || typeof e.facilitator.eip2612GasSponsoring !== "boolean") corrupt();
    const prepared = reconstruct(v);
    if (v.preparedCanonicalJson !== preparedCanonicalJson(prepared) ||
        v.typedDataDigest !== hashTypedData(prepared.plan.permit2 as Parameters<typeof hashTypedData>[0]) ||
        v.eip2612Digest !== (prepared.plan.eip2612 === null ? null : hashTypedData(prepared.plan.eip2612.typedData as Parameters<typeof hashTypedData>[0]))) corrupt();
    return v;
  } catch (error) { if (error instanceof ApnError && error.code === "APN_STATE_CORRUPT") throw error; return corrupt(); }
}
function quantity(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/u.test(value) && BigInt(value) < 1n << 256n;
}
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Permit2 production material is corrupt."); }
