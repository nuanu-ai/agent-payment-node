import { SecureStateStore } from "./secure-state-store.js";
import { performance } from "node:perf_hooks";
import { AllowlistPolicyStore } from "./allowlist-policy-store.js";
import { allowlistProfileHash } from "./allowlist-policy-overlay.js";
import { isatty } from "node:tty";
import { getAddress } from "viem";
import { exactKeys, hashObject, isPlainRecord, canonicalJson } from "./canonical.js";
import { ApnError } from "./errors.js";
import { StateStore } from "./state.js";
import { AssetUsageLedger, validateAssetUsageReservation, assetUsageReservationId, type AssetUsageReservation } from "./asset-usage-ledger.js";
import { evaluateAssetPolicy } from "./asset-policy-registry.js";
import { activeAssetPolicyFromState, type ActiveAssetPolicy } from "./allowlist-active-policy.js";
import { validateProviderProfile } from "./provider-profile.js";
import { canonicalIdempotencyKey, canonicalOperationId } from "./transfer-policy.js";
import { exactChainConsent } from "./tty-approval.js";
import { approvalCode } from "./approval-code.js";
import { validateMetaMaskNativeFeeQuote, validateMetaMaskNativeFeeReceipt,
  type MetaMaskNativeFeeQuote, type MetaMaskNativeFeeChainId, type MetaMaskNativeFeeReceiptEvidence } from "./metamask-native-fee-evidence.js";
import { readFixedMetaMaskNativePolicy, readFixedMetaMaskNativeRequest, submitOwnedMetaMaskNative } from "./metamask-native-transfer-adapter.js";
import { prepareFixedMetaMaskNativeQuote, readFixedMetaMaskNativeBalances, readFixedMetaMaskNativeNonce, observeFixedMetaMaskNativeTransfer } from "./metamask-native-transfer-rpc.js";

export const METAMASK_NATIVE_OWNER_PROFILE = "metamask-live-v042" as const;
export const METAMASK_NATIVE_OWNER_ADDRESS = "0xf41170df51aab52aaa04fbc3ff325cf051644aca" as const;
const VENDOR_HASH = "e3e44343da17c1912c2da0ce5b58f9c804b53d3715b8a2756c0b035fd50d288a";
declare const scopeBrand: unique symbol;
export interface MetaMaskNativeOwnedScope { readonly [scopeBrand]: true }
export interface MetaMaskNativeOwnedContext {
  readonly stateRoot: string;
  readonly profile: typeof METAMASK_NATIVE_OWNER_PROFILE;
  readonly profileHash: string;
  readonly accountBindingHash: string;
  readonly capabilityHash: string;
  readonly profileRevision: number;
  readonly policyDigest: string;
  readonly policyRevision: number;
  readonly activationDigest: string;
  readonly vendorPolicyHash: string;
  readonly vendorProjectHash: string;
  readonly quote: MetaMaskNativeFeeQuote;
  readonly operationId: string;
  readonly consentExpiresAt: string;
  readonly issuedDay: string;
}
interface ScopeEntry { readonly context: MetaMaskNativeOwnedContext; readonly journal: NativeJournal;
  readonly reservations: readonly AssetUsageReservation[]; state: "issued" | "consuming" | "invalid"; lockActive: boolean; readonly monotonicDeadline:number; lastNow:number }
const scopes = new WeakMap<object, ScopeEntry>();
function blocked(message: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message); }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
function entry(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): ScopeEntry {
  const e = scope !== null && typeof scope === "object" ? scopes.get(scope) : undefined;
  const now = new Date();
  if (e === undefined || e.context !== context || !e.lockActive || e.state === "invalid" || performance.now() >= e.monotonicDeadline || now.getTime() < e.lastNow ||
    now.toISOString().slice(0, 10) !== context.issuedDay || now.getTime() >= Date.parse(context.consentExpiresAt) ||
    now.getTime() >= Date.parse(context.quote.expiresAt)) blocked("Native transfer owner scope is absent, changed or expired.");
  e.lastNow=now.getTime();
  return e;
}
/** Claim is deliberately synchronous: no second SDK action can claim the same foreground consent. */
export function claimMetaMaskNativeOwnedScope(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): void {
  const e = entry(scope, context);
  if (e.state !== "issued") blocked("Native transfer consent has already been consumed.");
  e.state = "consuming";
}
export function assertMetaMaskNativeOwnedScope(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): void {
  if (entry(scope, context).state !== "consuming") blocked("Native transfer scope has not been claimed.");
}
/** Static owner guard, never a caller supplied callback. Adapter must invoke this after every awaited seam. */
export async function assertMetaMaskNativeOwnedContextCurrent(scope: MetaMaskNativeOwnedScope, context: MetaMaskNativeOwnedContext): Promise<void> {
  assertMetaMaskNativeOwnedScope(scope, context);
  const e = entry(scope, context), state = new StateStore(context.stateRoot);
  const current = await currentOwner(state); assertMetaMaskNativeOwnedScope(scope, context);
  if (current.profile.account_binding_hash !== context.accountBindingHash || current.profile.capability_hash !== context.capabilityHash ||
    current.profile.revision !== context.profileRevision || current.policy.digest !== context.policyDigest ||
    current.policy.revision !== context.policyRevision || current.policy.activationDigest !== context.activationDigest) blocked("Native transfer current owner policy or custody changed.");
  const vendor=await readFixedMetaMaskNativePolicy(context.quote.chainId); assertMetaMaskNativeOwnedScope(scope,context);
  if(vendor.vendorPolicyHash!==context.vendorPolicyHash||vendor.vendorProjectHash!==context.vendorProjectHash||vendor.tradingMode!=="guard"||vendor.selectedAddress.toLowerCase()!==METAMASK_NATIVE_OWNER_ADDRESS||vendor.policyBytes!==866)blocked("Native transfer current vendor project or Guard policy changed.");
  const op = await e.journal.read(context.operationId); assertMetaMaskNativeOwnedScope(scope, context);
  if (op === null || op.state !== "effect_started" || op.effectAttempts !== 1 || canonicalJson(op.context) !== canonicalJson(context)) blocked("Native transfer durable effect marker changed.");
  const ledger = new AssetUsageLedger(context.stateRoot);
  for (const expected of e.reservations) {
    const held = await ledger.usageWithReservation(expected, expected.reservationId, new Date());
    assertMetaMaskNativeOwnedScope(scope, context);
    if (held.reservation === null || !["reserved","submitted"].includes(held.reservation.state) || held.reservation.policyDigest !== context.policyDigest ||
      held.reservation.amountAtomic !== expected.amountAtomic || held.reservation.idempotencyHash !== expected.idempotencyHash) blocked("Native transfer finite usage hold changed.");
    evaluateAssetPolicy(current.policy.registry, { chain: expected.chain, asset: expected.asset, rail: "direct", amountAtomic: expected.amountAtomic,
      dailyUsageAtomic: (BigInt(held.snapshot.amountAtomic) - BigInt(expected.amountAtomic)).toString(), asOfDate: context.issuedDay, asOf: new Date().toISOString() });
  }
  const balances=await readFixedMetaMaskNativeBalances(context.quote.chainId); assertMetaMaskNativeOwnedScope(scope,context);
  const nonce=await readFixedMetaMaskNativeNonce(context.quote.chainId); assertMetaMaskNativeOwnedScope(scope,context);
  if(balances.address.toLowerCase()!==METAMASK_NATIVE_OWNER_ADDRESS||balances.asset.chainId!==context.quote.chainId||balances.asset.address!==context.quote.token||balances.asset.kind!=="erc20"||balances.asset.decimals!==6||balances.blockHash===undefined||
    BigInt(balances.nativeAtomic)<BigInt(context.quote.feeQuote.totalQuoteWei)||BigInt(balances.assetAtomic)<1000n||Date.now()-Date.parse(balances.observedAt)>30_000||Date.parse(balances.observedAt)>Date.now()||nonce!==context.quote.transaction.nonceAtomic)blocked("Native transfer current physical balance or nonce changed.");
  assertMetaMaskNativeOwnedScope(scope, context);
}

interface NativeOperation {
  readonly schemaVersion: "apn.metamask-native-operation.v1";
  readonly operationId: string;
  readonly requestHash: string;
  readonly context: MetaMaskNativeOwnedContext;
  readonly reservations: readonly AssetUsageReservation[];
  readonly state: "prepared" | "failed_before_effect" | "effect_started" | "acknowledged" | "unknown" | "confirmed";
  readonly effectAttempts: 0 | 1;
  readonly transactionHash: `0x${string}` | null;
  readonly providerRequestId: string | null;
  readonly receiptEvidence: MetaMaskNativeFeeReceiptEvidence | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordHash: string;
}
function validateOperation(value: unknown): NativeOperation {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion","operationId","requestHash","context","reservations","state","effectAttempts","transactionHash","providerRequestId","receiptEvidence","createdAt","updatedAt","recordHash"])) corrupt("Native transfer journal schema is invalid.");
  const o = value as unknown as NativeOperation, { recordHash, ...body } = o;
  if (o.schemaVersion !== "apn.metamask-native-operation.v1" || recordHash !== hashObject(body) || !/^[a-f0-9]{64}$/.test(o.operationId) ||
    o.context.operationId !== o.operationId || o.context.profile !== METAMASK_NATIVE_OWNER_PROFILE || o.context.vendorPolicyHash !== VENDOR_HASH ||
    o.context.quote.sender.toLowerCase() !== METAMASK_NATIVE_OWNER_ADDRESS || !["prepared","failed_before_effect","effect_started","acknowledged","unknown","confirmed"].includes(o.state) ||
    o.effectAttempts !== (o.state === "prepared" || o.state === "failed_before_effect" ? 0 : 1) || !Array.isArray(o.reservations) || o.reservations.length > 2 || o.effectAttempts === 1 && o.reservations.length !== 2) corrupt("Native transfer journal binding is invalid.");
  if(!isPlainRecord(o.context)||!exactKeys(o.context,["stateRoot","profile","profileHash","accountBindingHash","capabilityHash","profileRevision","policyDigest","policyRevision","activationDigest","vendorPolicyHash","vendorProjectHash","quote","operationId","consentExpiresAt","issuedDay"])||
    ![o.requestHash,o.context.profileHash,o.context.accountBindingHash,o.context.capabilityHash,o.context.policyDigest,o.context.activationDigest,o.context.vendorProjectHash].every(x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x))||
    !Number.isSafeInteger(o.context.profileRevision)||o.context.profileRevision<1||!Number.isSafeInteger(o.context.policyRevision)||o.context.policyRevision<1||
    new Date(o.createdAt).toISOString()!==o.createdAt||new Date(o.updatedAt).toISOString()!==o.updatedAt||o.updatedAt<o.createdAt||o.context.issuedDay!==o.createdAt.slice(0,10)||
    Date.parse(o.context.consentExpiresAt)-Date.parse(o.createdAt)>60000||Date.parse(o.context.consentExpiresAt)<=Date.parse(o.createdAt)||
    !(o.providerRequestId===null||typeof o.providerRequestId==="string"&&o.providerRequestId.length>0&&o.providerRequestId.length<=1024))corrupt("Native transfer immutable owner context is invalid.");
  for(let i=0;i<o.reservations.length;i++){
    const r=validateAssetUsageReservation(o.reservations[i]),kind=i===0?"native":"token";
    if(r.account.toLowerCase()!==METAMASK_NATIVE_OWNER_ADDRESS||r.chain!==`eip155:${o.context.quote.chainId}`||r.asset.kind!==kind||r.asset.identifier!==(kind==="native"?null:o.context.quote.token)||r.policyDigest!==o.context.policyDigest||
      r.amountAtomic!==(kind==="native"?o.context.quote.feeQuote.totalQuoteWei:"1000")||r.reservationId!==assetUsageReservationId(r,`apn.metamask-native:${o.operationId}:${kind}`)||r.metamaskNativeReservation?.operationId!==o.operationId||r.metamaskNativeReservation?.quoteHash!==o.context.quote.quoteHash)corrupt("Native transfer journal prior usage hold is invalid.");
  }
  // Stored quote is authenticated independent of its old consent deadline. Receipt verifier performs complete quote validation.
  validateMetaMaskNativeFeeQuote(o.context.quote, new Date(o.createdAt));
  if (o.receiptEvidence !== null) {
    const r = validateMetaMaskNativeFeeReceipt(o.receiptEvidence, o.context.quote);
    if (o.state !== "confirmed" || r.transactionHash !== o.transactionHash) corrupt("Native transfer journal receipt changed.");
  } else if (o.state === "confirmed") corrupt("Native transfer confirmed journal has no receipt.");
  if (o.transactionHash !== null && !/^0x[0-9a-f]{64}$/.test(o.transactionHash)) corrupt("Native transfer transaction hash is invalid.");
  return o;
}
class NativeJournal extends SecureStateStore {
  async read(id: string): Promise<NativeOperation | null> {
    canonicalOperationId(id);
    const value = await this.readJson(`metamask-native-operations/${id}.json`);
    if (value === null) return null;
    const op = validateOperation(value);
    if (op.operationId !== id || op.context.stateRoot !== this.root) corrupt("Native transfer journal root changed.");
    return op;
  }
  async matchingHold(reservation:AssetUsageReservation):Promise<NativeOperation|null> {
    const entries=await this.readDirectory("metamask-native-operations");
    for(const item of entries){
      if(!item.isFile()||!/^([a-f0-9]{64})\.json$/.test(item.name))corrupt("Native transfer journal directory is invalid.");
      const op=await this.read(item.name.slice(0,-5));if(op===null)corrupt("Native transfer journal disappeared.");
      const q=op.context.quote;
      for(const asset of [{kind:"native" as const,identifier:null},{kind:"token" as const,identifier:q.token}]){
        const identity={account:q.sender,chain:`eip155:${q.chainId}`,asset};
        if(assetUsageReservationId(identity,`apn.metamask-native:${op.operationId}:${asset.kind}`)===reservation.reservationId)return op;
      }
    }
    return null;
  }
  async persist(body: Omit<NativeOperation,"recordHash">): Promise<NativeOperation> {
    const next = validateOperation({ ...body, recordHash: hashObject(body) }), old = await this.read(next.operationId);
    if (old !== null && (old.requestHash !== next.requestHash || canonicalJson(old.context) !== canonicalJson(next.context) ||
      old.createdAt !== next.createdAt || old.effectAttempts > next.effectAttempts || old.transactionHash !== null && old.transactionHash !== next.transactionHash ||
      old.state === "confirmed" || old.state === "failed_before_effect")) blocked("Native transfer journal cannot replace an existing outcome.");
    await this.ensureDirectory("metamask-native-operations");
    await this.writeJson(`metamask-native-operations/${next.operationId}.json`, next, old === null);
    return next;
  }
}
function transitionIdentity(r:AssetUsageReservation) { return {account:r.account,chain:r.chain,asset:r.asset,reservationId:r.reservationId,policyDigest:r.policyDigest}; }
function patch(op: NativeOperation, fields: Partial<NativeOperation>): Omit<NativeOperation,"recordHash"> {
  const { recordHash: _, ...body } = op; return { ...body, ...fields, updatedAt: new Date().toISOString() };
}
async function currentOwner(state: StateStore): Promise<{ profile: ReturnType<typeof validateProviderProfile>; policy: ActiveAssetPolicy }> {
  const value = await state.loadProviderProfile(state.profileHash(METAMASK_NATIVE_OWNER_PROFILE));
  if (value === null) blocked("Fixed MetaMask provider profile is absent.");
  const profile = validateProviderProfile(value), policy = activeAssetPolicyFromState(await new AllowlistPolicyStore(state.root).readUnderProfileLock(METAMASK_NATIVE_OWNER_PROFILE),new Date());
  if (profile.profile !== METAMASK_NATIVE_OWNER_PROFILE || profile.profile_hash !== state.profileHash(METAMASK_NATIVE_OWNER_PROFILE) ||
    profile.provider_id !== "metamask-agent-wallet" || profile.drift.state !== "bound" || profile.drift.reason !== "none" ||
    profile.public_address.toLowerCase() !== METAMASK_NATIVE_OWNER_ADDRESS || policy === null || policy.accounts.evm?.toLowerCase() !== METAMASK_NATIVE_OWNER_ADDRESS) blocked("Fixed MetaMask custody or owner policy is unavailable.");
  return { profile, policy };
}
function freeze<T>(value: T): T { if (value !== null && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
function publicOperation(o: NativeOperation) {
  const receipt=o.receiptEvidence===null?null:validateMetaMaskNativeFeeReceipt(o.receiptEvidence,o.context.quote);
  return { operation_id: o.operationId, state: o.state==="confirmed"&&receipt?.transferAccepted===false?"confirmed_reverted":o.state, chain_id: o.context.quote.chainId, profile: o.context.profile,
    sender: o.context.quote.sender, seller: o.context.quote.seller, token: o.context.quote.token, usdc_atomic: "1000",
    maximum_native_fee_atomic: o.context.quote.feeQuote.totalQuoteWei, transaction_hash: o.transactionHash,
    effect_attempts: o.effectAttempts, proof_class: o.state === "confirmed" ? receipt?.transferAccepted ? "canonical_native_fee_transfer" : "canonical_reverted_native_fee" : "durable_public_state",
    ...(receipt === null ? {} : { receipt }) };
}
function chain(input: number): MetaMaskNativeFeeChainId {
  if (![1,10,143,59144,1329].includes(input)) throw new ApnError("APN_INVALID_INPUT", "Only the fixed MetaMask native transfer chains are admitted.");
  return input as MetaMaskNativeFeeChainId;
}

/** Normal finite command owner. No injected provider, terminal, scope issuer or arbitrary effect is accepted. */
export async function runFixedMetaMaskNativeTransfer(stateRoot: string, chainInput: number, keyInput: string) {
  const chainId = chain(chainInput), key = canonicalIdempotencyKey(keyInput), state = new StateStore(stateRoot), journal = new NativeJournal(stateRoot);
  const id = state.operationId(METAMASK_NATIVE_OWNER_PROFILE, `metamask-native:${chainId}:${key}`), requestHash = hashObject({chainId,key,profile:METAMASK_NATIVE_OWNER_PROFILE});
  await journal.initialize();
  return state.withLocks([`profile:${allowlistProfileHash(METAMASK_NATIVE_OWNER_PROFILE)}`,`profile:${state.profileHash(METAMASK_NATIVE_OWNER_PROFILE)}`,`operation:${id}`,"provider-session:metamask-agent-wallet",`account-chain-nonce:${METAMASK_NATIVE_OWNER_ADDRESS}:${chainId}`], async () => {
    const existing = await journal.read(id);
    if (existing !== null) { if (existing.requestHash !== requestHash) blocked("Native transfer idempotency collision."); return publicOperation(existing); }
    const owner = await currentOwner(state), ledger = new AssetUsageLedger(stateRoot), now = new Date(), day = now.toISOString().slice(0,10);
    const identity = {account:getAddress(METAMASK_NATIVE_OWNER_ADDRESS),chain:`eip155:${chainId}`,asset:{kind:"native" as const,identifier:null}};
    const usage = await ledger.usage(identity, now);
    const admission = evaluateAssetPolicy(owner.policy.registry,{chain:identity.chain,asset:identity.asset,rail:"direct",amountAtomic:"1",dailyUsageAtomic:usage.amountAtomic,asOfDate:day,asOf:now.toISOString()});
    const cap = BigInt(admission.caps.maximumPerTransferAtomic) < BigInt(admission.dailyRemainingAtomic) ? admission.caps.maximumPerTransferAtomic : admission.dailyRemainingAtomic;
    const vendor = await readFixedMetaMaskNativePolicy(chainId);
    if (vendor.selectedAddress.toLowerCase() !== METAMASK_NATIVE_OWNER_ADDRESS || vendor.vendorPolicyHash !== VENDOR_HASH || vendor.policyBytes !== 866 || vendor.tradingMode !== "guard" || !/^[a-f0-9]{64}$/.test(vendor.vendorProjectHash)) blocked("MetaMask vendor policy differs from the current finite approved policy.");
    const quote = freeze(structuredClone(validateMetaMaskNativeFeeQuote(await prepareFixedMetaMaskNativeQuote({chainId,maximumNativeFeeWei:cap}),new Date())));
    if (quote.sender.toLowerCase() !== METAMASK_NATIVE_OWNER_ADDRESS || quote.nativeFeeCapAtomic !== cap) blocked("MetaMask native quote payer or current policy ceiling changed.");
    const balances = await readFixedMetaMaskNativeBalances(chainId);
    if (balances.address.toLowerCase() !== METAMASK_NATIVE_OWNER_ADDRESS || balances.asset.chainId !== chainId || balances.asset.address !== quote.token || balances.asset.kind !== "erc20" || balances.asset.decimals !== 6 || balances.blockHash === undefined || BigInt(balances.nativeAtomic) < BigInt(quote.feeQuote.totalQuoteWei) || BigInt(balances.assetAtomic) < 1000n ||
      Date.now()-Date.parse(balances.observedAt)>30_000 || Date.parse(balances.observedAt)>Date.now()) blocked("MetaMask physical native/USDC balance is insufficient or stale.");
    const expires = new Date(Math.min(Date.now()+60_000,Date.parse(quote.expiresAt))).toISOString();
    const context = freeze({stateRoot,profile:METAMASK_NATIVE_OWNER_PROFILE,profileHash:owner.profile.profile_hash,accountBindingHash:owner.profile.account_binding_hash,
      capabilityHash:owner.profile.capability_hash,profileRevision:owner.profile.revision,policyDigest:owner.policy.digest,policyRevision:owner.policy.revision,
      activationDigest:owner.policy.activationDigest,vendorPolicyHash:VENDOR_HASH,vendorProjectHash:vendor.vendorProjectHash,quote,operationId:id,consentExpiresAt:expires,issuedDay:day});
    const reservations: AssetUsageReservation[] = [];
    let op: NativeOperation | undefined, scope: MetaMaskNativeOwnedScope | undefined;
    try {
      op = await journal.persist({schemaVersion:"apn.metamask-native-operation.v1",operationId:id,requestHash,context,reservations:[],state:"prepared",effectAttempts:0,
        transactionHash:null,providerRequestId:null,receiptEvidence:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
      for (const kind of ["native","token"] as const) reservations.push(await ledger.reserveMetaMaskNative(id,kind,new Date()));
      if (reservations.some(r=>r.state!=="reserved")) blocked("Native transfer usage replay cannot invoke a private effect.");
      op = await journal.persist(patch(op,{reservations}));
      if (process.stdin.isTTY !== true || process.stderr.isTTY !== true || !isatty(0) || !isatty(2)) blocked("A genuine foreground stdin/stderr terminal is required.");
      await exactChainConsent(["Agent Payment Node — fixed MetaMask native-paid USDC transfer",`Profile: ${context.profile}; sender: ${quote.sender}`,`Chain: eip155:${chainId}; token: ${quote.token}`,
        `Seller: ${quote.seller}; exact USDC: 1000 atomic`,`Maximum FULL native fee: ${quote.feeQuote.totalQuoteWei} atomic`,`Quote: ${quote.quoteHash}`,`Operation: ${id}`],approvalCode("transfer",id,quote.quoteHash),expires,{});
      if (new Date().toISOString().slice(0,10)!==day || Date.now()>=Date.parse(expires)) blocked("Native transfer consent expired.");
      const fresh = await currentOwner(state);
      if (fresh.policy.activationDigest!==owner.policy.activationDigest || fresh.profile.revision!==owner.profile.revision || fresh.profile.account_binding_hash!==owner.profile.account_binding_hash) blocked("Native transfer owner changed during consent.");
      const vendorFresh=await readFixedMetaMaskNativePolicy(chainId);
      if(vendorFresh.vendorProjectHash!==context.vendorProjectHash||vendorFresh.vendorPolicyHash!==context.vendorPolicyHash||vendorFresh.tradingMode!=="guard"||Date.now()>=Date.parse(expires)||new Date().toISOString().slice(0,10)!==day)blocked("Native transfer vendor project/policy changed or consent expired before private handoff.");
      op = await journal.persist(patch(op,{state:"effect_started",effectAttempts:1}));
      scope = Object.freeze({}) as MetaMaskNativeOwnedScope;
      scopes.set(scope,{context,journal,reservations,state:"issued",lockActive:true,monotonicDeadline:performance.now()+Math.min(60000,Date.parse(expires)-Date.now()),lastNow:Date.now()});
      const result = await submitOwnedMetaMaskNative(scope,context);
      op = await journal.persist(patch(op,result.disposition === "acknowledged" ? {state:"acknowledged",transactionHash:result.transactionHash} : {state:"unknown",transactionHash:"transactionHash" in result ? result.transactionHash ?? null : null,providerRequestId:result.requestId ?? null}));
      for (const r of reservations) await ledger.transition({...transitionIdentity(r),state:result.disposition==="acknowledged"?"submitted":"unknown_finality",now:new Date()});
      return publicOperation(op);
    } catch (error) {
      if (op !== undefined) {
        if (op.effectAttempts===1) {
          if (op.state==="effect_started") op=await journal.persist(patch(op,{state:"unknown"}));
          for (const r of reservations) await ledger.transition({...transitionIdentity(r),state:"unknown_finality",now:new Date()});
          return publicOperation(op);
        }
        op=await journal.persist(patch(op,{state:"failed_before_effect",reservations}));
      }
      for (const r of reservations) await ledger.transition({...transitionIdentity(r),state:"failed_before_effect",now:new Date(),outcomeDigest:hashObject({id,kind:"failed_before_effect"}),expectedCurrentStates:["reserved"]});
      throw error;
    } finally { if (scope !== undefined) { const e=scopes.get(scope); if(e!==undefined){e.state="invalid";e.lockActive=false;} scopes.delete(scope); } }
  });
}
export async function readFixedMetaMaskNativeTransfer(stateRoot:string,idInput:string,observe=false) {
  const id=canonicalOperationId(idInput), journal=new NativeJournal(stateRoot);
  if(await journal.read(id)===null)throw new ApnError("APN_OPERATION_NOT_FOUND","Native transfer operation does not exist.");
  return journal.withLocks([`operation:${id}`],async()=>{
    let op=await journal.read(id); if(op===null)throw new ApnError("APN_OPERATION_NOT_FOUND","Native transfer operation does not exist.");
    if(observe && op.transactionHash===null && op.providerRequestId!==null && op.effectAttempts===1) {
      const hint=await readFixedMetaMaskNativeRequest(op.providerRequestId,op.context.vendorProjectHash);
      if(hint.requestId!==undefined&&hint.requestId!==op.providerRequestId||hint.chainId!==undefined&&hint.chainId!==op.context.quote.chainId)blocked("Native transfer stored provider request identity or chain changed.");
      const hash="transactionHash" in hint ? hint.transactionHash : undefined;
      if(hash!==undefined)op=await journal.persist(patch(op,{state:"unknown",transactionHash:hash}));
    }
    if(observe && op.transactionHash!==null && op.state!=="confirmed") {
      const result=await observeFixedMetaMaskNativeTransfer(op.context.quote,op.transactionHash);
      if(result.kind==="accepted") {
        const verdict=validateMetaMaskNativeFeeReceipt(result.evidence,op.context.quote);
        if(verdict.transactionHash!==op.transactionHash || canonicalJson(verdict)!==canonicalJson(result.receipt)) blocked("Native transfer canonical receipt binding changed.");
        op=await journal.persist(patch(op,{state:"confirmed",receiptEvidence:result.evidence}));
      }
    }
    if(op.state==="confirmed") await new AssetUsageLedger(stateRoot).settleMetaMaskNativeActual(op.operationId,new Date());
    return publicOperation(op);
  });
}
/** Durable, read-only proof extraction for the common ledger; accepts no DTO as permission. */
export async function readMetaMaskNativeSettlement(stateRoot:string,id:string) {
  const op=await new NativeJournal(stateRoot).read(id);
  if(op===null || op.state!=="confirmed" || op.effectAttempts!==1 || op.receiptEvidence===null || op.transactionHash===null) blocked("Native transfer authentic canonical settlement is absent.");
  const receipt=validateMetaMaskNativeFeeReceipt(op.receiptEvidence,op.context.quote);
  if(receipt.transactionHash!==op.transactionHash) blocked("Native transfer settlement hash changed.");
  return { operationId:op.operationId,policyDigest:op.context.policyDigest,reservations:op.reservations,receipt,
    proof:{kind:"metamask_native_actual_fee" as const,operationId:op.operationId,quoteHash:op.context.quote.quoteHash,receiptHash:hashObject(op.receiptEvidence),
      actualFee:receipt.nativeFeeAtomic,reservedFee:op.context.quote.feeQuote.totalQuoteWei} };
}

/** Existing normal journal only; no caller quote, policy or approval is admitted. */
export async function readMetaMaskNativeReservation(stateRoot:string,id:string) {
  const op=await new NativeJournal(stateRoot).read(id);
  if(op===null||op.effectAttempts!==0||op.state!=="prepared")blocked("MetaMask native reservation requires untouched normal journal.");
  const current=await currentOwner(new StateStore(stateRoot));
  if(current.policy.activationDigest!==op.context.activationDigest||current.profile.revision!==op.context.profileRevision||current.profile.account_binding_hash!==op.context.accountBindingHash)blocked("MetaMask reserve current owner changed.");
  validateMetaMaskNativeFeeQuote(op.context.quote,new Date());
  return {operationId:id,quote:op.context.quote,registry:current.policy.registry};
}
export async function assertMetaMaskNativeFailedBeforeEffect(stateRoot:string,id:string):Promise<void> {
  const op=await new NativeJournal(stateRoot).read(id);
  if(op===null||op.effectAttempts!==0||op.state!=="failed_before_effect")blocked("MetaMask capacity release requires durable no-private-effect outcome.");
}

/** Existing-only durable guard also protects a hold whose public marker was removed. */
export async function assertMetaMaskNativeGenericCapacityRelease(stateRoot:string,value:AssetUsageReservation):Promise<void> {
  const reservation=validateAssetUsageReservation(value),op=await new NativeJournal(stateRoot).matchingHold(reservation);
  if(op===null){if(reservation.metamaskNativeReservation!==undefined)blocked("MetaMask hold has no authentic normal owner journal.");return;}
  if(op.effectAttempts!==0||op.state!=="failed_before_effect")blocked("MetaMask native hold requires canonical normal-owner settlement.");
}
