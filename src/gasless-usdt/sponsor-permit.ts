import { canonicalJson, hashObject } from "../canonical.js";
import type { GaslessTransport } from "../gasless/https.js";
import type { ClockPort } from "../ports.js";
import { validateUsdtAnyBoundOperation, type UsdtAnyBoundOperation } from "./bound-operation.js";
import type { UsdtSigningIdentity } from "./local-signing.js";
import { usdtFailure } from "./model.js";
import { attestUsdtSponsor, assertUsdtSponsorWindow, type UsdtSponsorSnapshot } from "./sponsor-auth.js";
import { verifyUsdtV2Auth } from "./auth-v2-validation.js";
/** Cannot be serialized or minted from saved evidence. The private map supplies authority. */
export interface UsdtSponsorPermit { readonly kind: "usdt-sponsor-custody-permit" }
export interface UsdtConsumedSponsorPermit { readonly kind: "consumed-usdt-sponsor-permit" }
const consumed = new WeakMap<UsdtConsumedSponsorPermit, number>();
export function assertUsdtConsumedPermitFresh(context: UsdtConsumedSponsorPermit, clock: ClockPort): void {
  const capturedAt = consumed.get(context), now = clock.now().getTime();
  if (capturedAt === undefined || !Number.isSafeInteger(now) || now < capturedAt || now - capturedAt > 5000) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_permit_expired_before_signature");
}
const permits = new WeakMap<UsdtSponsorPermit, { readonly boundDigest: string; readonly identity: string;
  readonly capturedAt: number; readonly userOperationDigest: string; readonly sponsorHash: string; readonly signature: string; readonly blockHash: string }>();

/** Mint ONLY after actual local recovery and canonical chain membership/parity attestation. */
export async function mintUsdtSponsorPermit(input: {
  readonly bound: UsdtAnyBoundOperation; readonly identity: UsdtSigningIdentity; readonly snapshot: UsdtSponsorSnapshot;
  readonly transport: GaslessTransport; readonly rpcUrl: string; readonly clock: ClockPort;
}): Promise<UsdtSponsorPermit> {
  const bound = validateUsdtAnyBoundOperation(input.bound);
  if (bound.schemaVersion !== "apn.gasless-usdt-bound-operation.v2" || input.identity.profile !== bound.binding.profile ||
    input.identity.profileHash !== bound.profileHash || input.identity.operationId !== bound.operationId ||
    input.identity.bindingHash !== bound.binding.bindingHash || input.snapshot.blockHash !== bound.binding.safeBlockHash ||
    input.snapshot.blockNumber.toString() !== bound.binding.safeBlockNumber) usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_permit_identity");
  const auth = await attestUsdtSponsor({ op: bound.binding.unsignedOperation, snapshot: input.snapshot,
    expectedBlockHash: bound.binding.safeBlockHash, transport: input.transport, rpcUrl: input.rpcUrl, clock: input.clock });
  await verifyUsdtV2Auth(bound.binding.unsignedOperation, auth, input.snapshot);
  if (auth.signer !== bound.binding.sponsorAuth.signer) usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_identity_changed");
  const permit = Object.freeze({ kind: "usdt-sponsor-custody-permit" as const });
  permits.set(permit, { boundDigest: hashObject(bound), identity: canonicalJson(input.identity), capturedAt: Date.parse(auth.capturedAt),
    userOperationDigest: auth.userOperationDigest, sponsorHash: auth.sponsorHash, signature: auth.signature, blockHash: auth.blockHash });
  return permit;
}
/** Single use under custody lock BEFORE wallet describe. Expiry never triggers an implicit retry. */
export function consumeUsdtSponsorPermit(permit: UsdtSponsorPermit | undefined, bound: UsdtAnyBoundOperation,
  identity: UsdtSigningIdentity, clock: ClockPort): UsdtConsumedSponsorPermit {
  const saved = permit === undefined ? undefined : permits.get(permit);
  if (permit !== undefined) permits.delete(permit);
  const now = clock.now().getTime();
  if (saved === undefined || !Number.isSafeInteger(now) || now < saved.capturedAt || now - saved.capturedAt > 5000 ||
    saved.boundDigest !== hashObject(bound) || saved.identity !== canonicalJson(identity) ||
    saved.userOperationDigest !== hashObject(bound.binding.unsignedOperation) || saved.blockHash !== bound.binding.safeBlockHash ||
    (bound.schemaVersion === "apn.gasless-usdt-bound-operation.v2" &&
      (saved.sponsorHash !== bound.binding.sponsorAuth.sponsorHash || saved.signature !== bound.binding.sponsorAuth.signature))) {
    usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_permit_missing_or_expired");
  }
  assertUsdtSponsorWindow(bound.binding.unsignedOperation, clock);
  const context = Object.freeze({ kind: "consumed-usdt-sponsor-permit" as const });
  consumed.set(context, saved.capturedAt);
  return context;
}
