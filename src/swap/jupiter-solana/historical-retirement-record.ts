import { canonicalJson, domainHash, exactKeys, hashObject, isPlainRecord, sha256 } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import type { AssetPolicyRegistry } from "../../asset-policy-registry.js";
import { validateAssetPolicyRegistry } from "../../asset-policy-registry.js";
import type { AssetUsageIdentity, AssetUsageReservation } from "../../asset-usage-ledger.js";
import { validateAssetUsageReservation, assetUsageReservationId, sumUsage } from "../../asset-usage-ledger-record.js";
import { validateSwapOperation, type SwapOperationRecord } from "../model.js";
import type { HistoricalJupiterProjection } from "./historical-projection-reader.js";
import { HISTORICAL_JUPITER_IDS, HISTORICAL_JUPITER_OWNER_PROFILE, HISTORICAL_JUPITER_PAYER, HISTORICAL_JUPITER_ACCOUNT_BINDING } from "./historical-pins.js";
import { JUPITER_V1_OLD_ROUTE } from "./v1-route-config.js";
import { swapMechanismDigest } from "../pin.js";
import { checkedJupiterV1QuoteRpcLifetime } from "./v1-material.js";
import { SOLANA_USDC_MINT, SOLANA_MAINNET_GENESIS } from "./catalog.js";
import { calculateHistoricalRetirementPolicy, type HistoricalRetirementPolicyAdmission } from "./historical-retirement-policy.js";

export const HISTORICAL_RETIREMENT_NAMESPACE = "jupiter-historical-retirements";
export const HISTORICAL_RETIREMENT_SCHEMA = "apn.jupiter-historical-retirement.v1" as const;
export const HISTORICAL_RETIREMENT_IDENTITY: AssetUsageIdentity = Object.freeze({ account: HISTORICAL_JUPITER_PAYER,
 chain: `solana:${SOLANA_MAINNET_GENESIS}`, asset: Object.freeze({ kind: "native", identifier: null }) });
/** Structural public witness contract. PART A's pure witness cannot issue economic authority. */
export interface HistoricalRetirementCanonicalWitness {
 readonly schemaVersion: "apn.jupiter-canonical-future-invalidity.v1"; readonly scope: "blockhash_future_invalidity_only";
 readonly outcome: "future_invalidity_witness"; readonly inputHash: string; readonly transactionHash: string;
 readonly messageHash: string; readonly signatureHash: string; readonly blockhash: string;
 readonly quoteContextSlot: string; readonly searchedStartSlot: string;
 readonly birth: { readonly slot: string; readonly blockHeight: string; readonly blockhash: string };
 readonly finalizedAnchor: { readonly slot: string; readonly blockHeight: string; readonly blockhash: string };
 readonly processingAge: { readonly documentedMaximumProcessingAge: 150; readonly requiredConservativeFinalizedHeight: string };
 readonly quoteLastValidBlockHeight: string | null;
 readonly providers: readonly { readonly originHash: string; readonly finalizedSlot: string; readonly finalizedBlockHeight: string;
   readonly isBlockhashValid: false; readonly signatureStatusObservation: "not_reported"; readonly readCount: number }[];
 readonly resultHash: string;
}
export interface HistoricalRetirementCurrentPolicy {
 readonly registry: AssetPolicyRegistry; readonly activationDigest: string; readonly revision: number; readonly activatedAt: string;
}
/** Immutable economic record DTO; callers cannot turn this object into private commit permission. */
export interface HistoricalRetirementRecord {
 readonly schemaVersion: typeof HISTORICAL_RETIREMENT_SCHEMA; readonly kind: "retired_unknown";
 readonly operationId: string; readonly ownerProfileHash: string; readonly rootSnapshotHash: string; readonly bucketHash: string;
 readonly originalOperation: SwapOperationRecord; readonly originalReservationRawHash: string;
 readonly authentication: HistoricalJupiterProjection; readonly canonicalProof: HistoricalRetirementCanonicalWitness;
 readonly currentPolicy: HistoricalRetirementCurrentPolicy; readonly policyAdmission: HistoricalRetirementPolicyAdmission;
 readonly accountingAt: string; readonly conservativeTotalAtomic: "6000000"; readonly additionalAdmissionAtomic: "5000000";
 readonly historicalOutcome: "unknown"; readonly transactionMayHaveBeenSubmitted: true;
 readonly actualNativeFeeAtomic: null; readonly effectAt: null; readonly recordHash: string;
}
const HASH = /^[a-f0-9]{64}$/u, UINT = /^(?:0|[1-9][0-9]{0,77})$/u, BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const RECORD_KEYS = ["schemaVersion","kind","operationId","ownerProfileHash","rootSnapshotHash","bucketHash","originalOperation","originalReservationRawHash","authentication","canonicalProof","currentPolicy","policyAdmission","accountingAt","conservativeTotalAtomic","additionalAdmissionAtomic","historicalOutcome","transactionMayHaveBeenSubmitted","actualNativeFeeAtomic","effectAt","recordHash"];
export function historicalRetirementBucketHash(): string { return hashBucket(HISTORICAL_RETIREMENT_IDENTITY); }
export function hashBucket(identity: AssetUsageIdentity): string { return domainHash("apn.asset-usage-bucket.v1", canonicalJson(identity)); }
/** Pure sealing is useful for codec fixtures and does not grant permission to persist it. */
export function sealHistoricalRetirementRecord(body: Omit<HistoricalRetirementRecord,"recordHash">): HistoricalRetirementRecord {
 return validateHistoricalRetirementRecord({ ...body, recordHash: hashObject(body) });
}
export function validateHistoricalRetirementRecord(value: unknown): HistoricalRetirementRecord {
 if (!isPlainRecord(value) || !exactKeys(value, RECORD_KEYS) || value.schemaVersion !== HISTORICAL_RETIREMENT_SCHEMA || value.kind !== "retired_unknown" ||
   !HISTORICAL_JUPITER_IDS.some(id => id === value.operationId) || value.ownerProfileHash !== HISTORICAL_JUPITER_OWNER_PROFILE ||
   !isHash(value.rootSnapshotHash) || value.bucketHash !== historicalRetirementBucketHash() || !isHash(value.originalReservationRawHash) ||
   value.conservativeTotalAtomic !== "6000000" || value.additionalAdmissionAtomic !== "5000000" || value.historicalOutcome !== "unknown" ||
   value.transactionMayHaveBeenSubmitted !== true || value.actualNativeFeeAtomic !== null || value.effectAt !== null) corrupt();
 const op = validateSwapOperation(value.originalOperation);
 if (op.operationId !== value.operationId || op.ownerProfileHash !== HISTORICAL_JUPITER_OWNER_PROFILE || op.quote.profile !== "solana-local" ||
   op.quote.account !== HISTORICAL_JUPITER_PAYER || op.quote.recipient !== HISTORICAL_JUPITER_PAYER || op.quote.sourceAsset.chain !== HISTORICAL_RETIREMENT_IDENTITY.chain ||
   op.quote.sourceAsset.kind !== "native" || op.quote.destinationAsset.identifier !== SOLANA_USDC_MINT || op.quote.destinationAsset.kind !== "token" ||
   op.mechanismDigest !== swapMechanismDigest(JUPITER_V1_OLD_ROUTE.mechanismPin) || op.protocolRegistryDigest !== JUPITER_V1_OLD_ROUTE.protocolRegistry.registryDigest || op.protocolRegistryVersion !== JUPITER_V1_OLD_ROUTE.protocolRegistry.registryVersion || op.quote.inputAmountAtomic !== "1000000" || !["submitted","unknown_finality"].includes(op.state) ||
   op.submissionMarker === null || op.receiptProof !== null || op.failureProofHash !== null || op.usageLease === null) corrupt();
 const lease = validateAssetUsageReservation(op.usageLease);
 if (!sameIdentity(lease,HISTORICAL_RETIREMENT_IDENTITY) || lease.reservationId !== assetUsageReservationId(HISTORICAL_RETIREMENT_IDENTITY,`swap-${op.idempotencyHash}`) || lease.rail !== "swap" || lease.amountAtomic !== "1000000" ||
   !["submitted","unknown_finality"].includes(lease.state) || lease.effectAt !== null || lease.outcomeDigest !== null || lease.consumedAtomic !== undefined) corrupt();
 const auth = validateAuthentication(value.authentication,op), at = instant(value.accountingAt);
 if (at < auth.authenticatedAt || at >= auth.authenticationExpiresAt || at < op.updatedAt) corrupt();
 validateCanonical(value.canonicalProof,auth);
 if (!isPlainRecord(value.currentPolicy) || !exactKeys(value.currentPolicy,["registry","activationDigest","revision","activatedAt"]) ||
   !isHash(value.currentPolicy.activationDigest) || !Number.isSafeInteger(value.currentPolicy.revision) || (value.currentPolicy.revision as number)<1) corrupt();
 const policy = value.currentPolicy as unknown as HistoricalRetirementCurrentPolicy, registry = validateAssetPolicyRegistry(policy.registry);
 instant(policy.activatedAt);
 if(registry.expiresAt!==undefined && auth.authenticationExpiresAt>registry.expiresAt)corrupt();
 if (!isPlainRecord(value.policyAdmission) || !isUint(value.policyAdmission.priorNativeUsageAtomic)) corrupt();
 // The original USD-output permission is rechecked; its current usage is included in the immutable calculation input.
 const a = value.policyAdmission as unknown as HistoricalRetirementPolicyAdmission;
 const admitted = calculateHistoricalRetirementPolicy({profile:"solana-local",accounts:{solana:HISTORICAL_JUPITER_PAYER},registry,
   digest:registry.policyDigest,activationDigest:policy.activationDigest,revision:policy.revision,activatedAt:policy.activatedAt},op.operationId,
   a.priorNativeUsageAtomic,a.priorUsdcUsageAtomic,op.quote.minimumOutputAtomic,new Date(at));
 if (canonicalJson(admitted)!==canonicalJson(value.policyAdmission)) corrupt();
 const {recordHash,...body}=value;
 if (!isHash(recordHash) || recordHash!==hashObject(body)) corrupt();
 return value as unknown as HistoricalRetirementRecord;
}
export function assertHistoricalRetirementBindings(record: HistoricalRetirementRecord, rootSnapshotHash: string,
 operation: SwapOperationRecord | null, reservation: AssetUsageReservation | undefined, originalRowRawHash: string): void {
 validateHistoricalRetirementRecord(record);
 if (record.rootSnapshotHash!==rootSnapshotHash || operation===null || canonicalJson(operation)!==canonicalJson(record.originalOperation) ||
   reservation===undefined || canonicalJson(reservation)!==canonicalJson(record.originalOperation.usageLease) || originalRowRawHash!==record.originalReservationRawHash) corrupt();
}
export function sameIdentity(a: AssetUsageIdentity,b: AssetUsageIdentity): boolean { return a.account===b.account && a.chain===b.chain && canonicalJson(a.asset)===canonicalJson(b.asset); }
/** Replace only exact original holds. No actual spend/finality claim is derived from this projection. */
export function historicalRetirementUsage(records: readonly AssetUsageReservation[], retirements: readonly HistoricalRetirementRecord[], now: Date): string {
 const at=instant(now instanceof Date ? now.toISOString() : now), ids=new Set<string>();let charge=0n;
 for (const r of retirements) {
   validateHistoricalRetirementRecord(r);const row=r.originalOperation.usageLease!;
   if (ids.has(row.reservationId) || !records.some(v=>canonicalJson(v)===canonicalJson(row))) corrupt();ids.add(row.reservationId);
   if(at.slice(0,10)<r.accountingAt.slice(0,10)) blocked();
   if(at.slice(0,10)===r.accountingAt.slice(0,10))charge+=6_000_000n;
 }
 const total=BigInt(sumUsage(records.filter(r=>!ids.has(r.reservationId)),now))+charge;
 if(total>(1n<<256n)-1n)corrupt();return total.toString();
}
function validateAuthentication(value: unknown,op: SwapOperationRecord): HistoricalJupiterProjection {
 const keys=["schemaVersion","operationId","operationIntegrityHash","rootBinding","ownerProfileHash","accountBindingHash","payer","policyDigest","activationDigest","originalBindingHash","originalMaterialDigest","freshMaterialDigest","markerHash","principalLamports","maximumNativeExpenseLamports","freshMaximumNativeExpenseLamports","networkFeeLamports","tokenAccountRentLamports","genesis","blockhash","lastValidBlockHeight","signature","rawPayloadHash","messageHash","freshBlockhash","freshLastValidBlockHeight","heightBinding","originalQuoteRpcLifetime","lifetimeProvenance","retainedClaimEvidence","ordinaryRecentBlockhash","authenticatedAt","authenticationExpiresAt"];
 if(!isPlainRecord(value)||!exactKeys(value,keys)||value.schemaVersion!=="apn.jupiter-historical-authentication.v1" || value.operationId!==op.operationId ||
   value.operationIntegrityHash!==op.integrityHash || value.ownerProfileHash!==op.ownerProfileHash || value.accountBindingHash!==HISTORICAL_JUPITER_ACCOUNT_BINDING ||
   value.payer!==HISTORICAL_JUPITER_PAYER || value.policyDigest!==op.policyDigest || value.markerHash!==op.submissionMarker!.markerHash ||
   value.principalLamports!=="1000000" || value.maximumNativeExpenseLamports!=="6000000" || value.freshMaximumNativeExpenseLamports!=="6000000" ||
   value.genesis!==SOLANA_MAINNET_GENESIS || value.ordinaryRecentBlockhash!==true || value.heightBinding!=="authenticated_material_not_signed_message" ||
   !BASE58.test(value.blockhash as string) || value.freshBlockhash!==value.blockhash || !isUint(value.lastValidBlockHeight)||!isUint(value.freshLastValidBlockHeight)||
   !isUint(value.networkFeeLamports)||!isUint(value.tokenAccountRentLamports)|| !/^[1-9A-HJ-NP-Za-km-z]{64,128}$/u.test(value.signature as string))corrupt();
 for(const k of ["operationIntegrityHash","rootBinding","activationDigest","originalBindingHash","originalMaterialDigest","freshMaterialDigest","rawPayloadHash","messageHash"])if(!isHash(value[k]))corrupt();
 if(BigInt(value.networkFeeLamports as string)<1400n || BigInt(value.networkFeeLamports as string)>20_000n || 1_000_000n+BigInt(value.networkFeeLamports as string)+BigInt(value.tokenAccountRentLamports as string)>6_000_000n)corrupt();
 const from=instant(value.authenticatedAt),until=instant(value.authenticationExpiresAt);
 if(until<=from || Date.parse(until)-Date.parse(from)>60_000)corrupt();
 const lifetime=value.originalQuoteRpcLifetime;
 checkedJupiterV1QuoteRpcLifetime(lifetime);
 if(!isPlainRecord(lifetime)||!exactKeys(lifetime,["source","rpcOriginHash","contextSlot","minimumContextSlot","blockhash","lastValidBlockHeight"]) ||
   lifetime.source!=="configured_mainnet_rpc_before_quote_freeze" || !isHash(lifetime.rpcOriginHash) || !isUint(lifetime.contextSlot) ||
   !isUint(lifetime.minimumContextSlot) || !isUint(lifetime.lastValidBlockHeight) || lifetime.blockhash!==value.blockhash ||
   value.lifetimeProvenance!=="configured_mainnet_rpc_before_quote_freeze")corrupt();
 const evidence=value.retainedClaimEvidence;
 if(!isPlainRecord(evidence)||!isHash(evidence.signedMarkerSnapshotHash))corrupt();
 if(evidence.kind==="retained_send_claim_present") {if(!exactKeys(evidence,["kind","claimHash","signedMarkerSnapshotHash"])||!isHash(evidence.claimHash))corrupt();}
 else if(evidence.kind==="retained_send_claim_absent") {if(op.operationId!==HISTORICAL_JUPITER_IDS[1] || !exactKeys(evidence,["kind","observation","submissionHistory","transactionMayHaveBeenSubmitted","absenceSnapshotHash","signedMarkerSnapshotHash"]) || evidence.observation!=="current_observation" || evidence.submissionHistory!=="unknown" || evidence.transactionMayHaveBeenSubmitted!==true || !isHash(evidence.absenceSnapshotHash))corrupt();}
 else corrupt();
 return value as unknown as HistoricalJupiterProjection;
}
function validateCanonical(value: unknown,auth: HistoricalJupiterProjection): void {
 if(!isPlainRecord(value)||!exactKeys(value,["schemaVersion","scope","outcome","inputHash","transactionHash","messageHash","signatureHash","blockhash","quoteContextSlot","searchedStartSlot","birth","finalizedAnchor","processingAge","quoteLastValidBlockHeight","providers","resultHash"]) || value.schemaVersion!=="apn.jupiter-canonical-future-invalidity.v1" || value.scope!=="blockhash_future_invalidity_only" || value.outcome!=="future_invalidity_witness" || !isHash(value.inputHash) || value.transactionHash!==auth.rawPayloadHash || value.messageHash!==auth.messageHash || value.signatureHash!==sha256(auth.signature) || value.blockhash!==auth.blockhash || !isUint(value.quoteContextSlot)||!isUint(value.searchedStartSlot))corrupt();
 const lifetime=auth.originalQuoteRpcLifetime!;
 if(value.quoteContextSlot!==lifetime.contextSlot || value.quoteLastValidBlockHeight!==lifetime.lastValidBlockHeight)corrupt();
 const birth=value.birth,anchor=value.finalizedAnchor,age=value.processingAge;
 for(const h of [birth,anchor])if(!isPlainRecord(h)||!exactKeys(h,["slot","blockHeight","blockhash"])||!isUint(h.slot)||!isUint(h.blockHeight)||!BASE58.test(h.blockhash as string))corrupt();
 if(!isPlainRecord(birth)||!isPlainRecord(anchor)||birth.blockhash!==auth.blockhash || BigInt(birth.slot as string)<BigInt(value.searchedStartSlot as string) || BigInt(birth.slot as string)>BigInt(value.quoteContextSlot as string) || BigInt(value.searchedStartSlot as string)!==(BigInt(value.quoteContextSlot as string)>64n?BigInt(value.quoteContextSlot as string)-64n:0n) ||
   !isPlainRecord(age)||!exactKeys(age,["documentedMaximumProcessingAge","requiredConservativeFinalizedHeight"])||age.documentedMaximumProcessingAge!==150||!isUint(age.requiredConservativeFinalizedHeight)|| BigInt(age.requiredConservativeFinalizedHeight)!==BigInt(birth.blockHeight as string)+152n || BigInt(anchor.slot as string)<BigInt(birth.slot as string) || BigInt(anchor.blockHeight as string)<BigInt(birth.blockHeight as string))corrupt();
 if(!Array.isArray(value.providers)||value.providers.length!==2)corrupt();const origins=new Set<string>();
 for(const p of value.providers){if(!isPlainRecord(p)||!exactKeys(p,["originHash","finalizedSlot","finalizedBlockHeight","isBlockhashValid","signatureStatusObservation","readCount"])||!isHash(p.originHash)||!isUint(p.finalizedSlot)||!isUint(p.finalizedBlockHeight)||p.isBlockhashValid!==false||p.signatureStatusObservation!=="not_reported"||typeof p.readCount!=="number"||!Number.isSafeInteger(p.readCount)||p.readCount<1||p.readCount>72 || BigInt(p.finalizedSlot)<BigInt(anchor.slot as string) || BigInt(p.finalizedBlockHeight)<BigInt(anchor.blockHeight as string) || BigInt(p.finalizedBlockHeight)<BigInt(age.requiredConservativeFinalizedHeight as string) || BigInt(p.finalizedBlockHeight)<=BigInt(lifetime.lastValidBlockHeight) || origins.has(p.originHash))corrupt();origins.add(p.originHash);}
 const {resultHash,...body}=value;if(!isHash(resultHash)||resultHash!==hashObject(body))corrupt();
}
function instant(v:unknown):string {if(typeof v!=="string" || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString()!==v)corrupt();return v;}
function isHash(v:unknown):v is string{return typeof v==="string"&&HASH.test(v);}
function isUint(v:unknown):v is string{return typeof v==="string"&&UINT.test(v);}
function corrupt():never{throw new ApnError("APN_STATE_CORRUPT","Historical Jupiter retirement evidence is invalid.");}
function blocked():never{throw new ApnError("APN_OPERATION_BLOCKED","Historical Jupiter retirement accounting cannot move backward.");}
