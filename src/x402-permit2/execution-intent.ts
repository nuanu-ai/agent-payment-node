import { open } from "node:fs/promises";
import { hashTypedData } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { SecureStateStore } from "../secure-state-store.js";
import { canonicalIdempotencyKey } from "../transfer-policy.js";
import { canonicalProfile } from "../wallet-policy.js";
import type { X402PaymentRequired } from "../x402-codec.js";
import { selectPermit2Offer } from "./offer.js";
import { hashChallenge, preparePermit2Payment, type Permit2OwnerAdmission, type Permit2PrepareEvidence,
  type Permit2PreparedMaterial } from "./prepare.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "./registry.js";

const asset = X402_PERMIT2_ASSETS[0]!;
const SCHEMA = "apn.x402-permit2.execution-intent.v1";
const ENDPOINT = "https://facilitator.payai.network";
const HASH = /^[a-f0-9]{64}$/u;
const QUANTITY = /^(0|[1-9][0-9]{0,77})$/u;

/** A local, unsigned admission. There is deliberately no signature, submission or paid state. */
export interface Permit2ExecutionIntent {
  readonly schemaVersion: typeof SCHEMA;
  readonly operationId: string;
  readonly idempotencyHash: string;
  readonly profileHash: string;
  readonly requestHash: string;
  readonly prepareHash: string;
  readonly challengeHash: string;
  readonly merchantOrigin: string;
  readonly resourceUrl: string;
  readonly facilitatorEndpoint: typeof ENDPOINT;
  readonly chain: "eip155:43114";
  readonly token: string;
  readonly owner: string;
  readonly recipient: string;
  readonly amountAtomic: string;
  readonly permit2Contract: string;
  readonly exactProxy: string;
  readonly typedDataDigest: string;
  readonly eip2612Digest: string | null;
  readonly nonce: string;
  readonly deadline: string;
  readonly policyDigest: string;
  readonly reservationId: string;
  readonly reservationState: "intended";
  readonly capability: "execution_blocked";
  readonly createdAtUnix: number;
  readonly integrityHash: string;
}

/** The port must load the local wallet and active policy for the requested profile from authenticated state.
 * Caller-supplied profile/account labels are insufficient. The port has no effect methods. */
export interface Permit2IntentReadPort {
  read(input: { readonly profile: string; readonly payer: string; readonly nonceBitmapWordIndex: string; readonly amountAtomic: string;
    readonly nowSeconds: number }): Promise<{ readonly owner: Permit2OwnerAdmission;
    readonly evidence: Permit2PrepareEvidence; readonly gasBalanceAtomic: string;
    readonly binding: { readonly walletProfile: string; readonly walletAccount: string;
      readonly policyProfile: string; readonly policyDigest: string };
    readonly facilitatorEndpoint: string }>;
}

export interface Permit2IntentInput {
  readonly profile: string;
  readonly idempotencyKey: string;
  readonly prepared: Permit2PreparedMaterial;
  readonly challenge: X402PaymentRequired;
  readonly merchantOrigin: string;
  readonly resourceUrl: string;
  readonly facilitatorEndpoint: string;
  readonly minimumGasAtomic: string;
  readonly nowSeconds: number;
}

/** Internal-only journal. It owns one durable, immutable file per profile/idempotency key. */
export class Permit2ExecutionIntentJournal extends SecureStateStore {
  private async ready(): Promise<void> {
    await this.initialize();
    await this.ensureDirectory("permit2-intents");
    // mkdir persists the child inode, but its name in the root can still be lost
    // after a crash. Repeat on every retry, including after a failed first sync.
    try { await this.syncIntentDirectoryParent(); }
    catch { throw new ApnError("APN_STATE_SECURITY", "Permit2 intent directory parent sync failed."); }
  }
  protected async syncIntentDirectoryParent(): Promise<void> {
    const handle = await open(this.root, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
  private path(operationId: string): string { return `permit2-intents/${operationId}.json`; }
  async create(input: Permit2IntentInput, port: Permit2IntentReadPort): Promise<Permit2ExecutionIntent> {
    const profile = canonicalProfile(input.profile);
    const key = canonicalIdempotencyKey(input.idempotencyKey);
    const profileHash = this.profileHash(profile);
    const operationId = this.operationId(profile, key);
    const idempotencyHash = this.idempotencyHash(key);
    const bound = validateBoundInput(input);
    const requestHash = domainHash(`${SCHEMA}.request`, canonicalJson({ profileHash, ...bound,
      preparedSnapshot: preparedSnapshot(input.prepared) }));
    await this.ready();
    return this.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `permit2-intent:${idempotencyHash}`], async () => {
      const existing = await this.load(operationId);
      if (existing !== null) {
        if (existing.requestHash !== requestHash) throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Permit2 intent key names different immutable material.");
        return existing;
      }
      const nonce = BigInt(bound.nonce);
      const fresh = await port.read({ profile, payer: bound.owner, nonceBitmapWordIndex: (nonce >> 8n).toString(),
        amountAtomic: bound.amountAtomic, nowSeconds: input.nowSeconds });
      if (fresh.binding?.walletProfile !== profile || fresh.binding.policyProfile !== profile ||
          fresh.binding.walletAccount?.toLowerCase() !== bound.owner.toLowerCase() ||
          fresh.binding.policyDigest !== fresh.owner.policyDigest) {
        refuse("The selected profile does not own this wallet and active policy.");
      }
      if (fresh.facilitatorEndpoint !== ENDPOINT) refuse("The facilitator endpoint changed.");
      if (!validQuantity(fresh.gasBalanceAtomic) || BigInt(fresh.gasBalanceAtomic) < BigInt(input.minimumGasAtomic)) {
        throw new ApnError("APN_INSUFFICIENT_GAS", "Avalanche gas balance is below the required minimum.");
      }
      // The existing pure prepare validator checks policy caps, pinned contracts, balance,
      // allowance, nonce bitmap and facilitator capability. Its signing time is restored
      // from the frozen deadline; the fresh observation is checked against the current clock first.
      if (!Number.isSafeInteger(fresh.evidence.observedAtSeconds) || fresh.evidence.observedAtSeconds > input.nowSeconds ||
          input.nowSeconds - fresh.evidence.observedAtSeconds > 30) refuse("Fresh Avalanche evidence is required.");
      if (fresh.owner.policyDigest !== bound.policyDigest) refuse("The owner policy revision changed.");
      const signingSecond = Number(BigInt(bound.deadline) - BigInt(bound.timeoutSeconds));
      const checked = preparePermit2Payment({ payer: input.prepared.payer, localWallet: true, challenge: input.challenge,
        expected: { index: input.prepared.plan.selection.index, requirement: input.prepared.plan.selection.requirement,
          challengeHash: input.prepared.challengeHash }, owner: fresh.owner,
        evidence: { ...fresh.evidence, observedAtSeconds: signingSecond }, nowSeconds: signingSecond, nonce });
      if (preparedSnapshot(checked) !== preparedSnapshot(input.prepared)) refuse("Prepared Permit2 material changed.");
      // The intended reservation is a journal identity only. Packet 2 must perform an
      // atomic real usage reservation before any signature can be obtained.
      const body = { schemaVersion: SCHEMA as typeof SCHEMA, operationId, idempotencyHash, profileHash, requestHash,
        prepareHash: bound.prepareHash, challengeHash: bound.challengeHash, merchantOrigin: bound.merchantOrigin,
        resourceUrl: bound.resourceUrl, facilitatorEndpoint: ENDPOINT as typeof ENDPOINT,
        chain: asset.chain as "eip155:43114", token: asset.token,
        owner: bound.owner, recipient: bound.recipient, amountAtomic: bound.amountAtomic,
        permit2Contract: PERMIT2_ADDRESS, exactProxy: X402_EXACT_PERMIT2_PROXY,
        typedDataDigest: bound.typedDataDigest, eip2612Digest: bound.eip2612Digest,
        nonce: bound.nonce, deadline: bound.deadline, policyDigest: bound.policyDigest,
        reservationId: domainHash(`${SCHEMA}.reservation`, canonicalJson({ operationId, profileHash,
          chain: asset.chain, token: asset.token, owner: bound.owner, amountAtomic: bound.amountAtomic })),
        reservationState: "intended" as const, capability: "execution_blocked" as const,
        createdAtUnix: input.nowSeconds };
      const record: Permit2ExecutionIntent = { ...body, integrityHash: domainHash(SCHEMA, canonicalJson(body)) };
      await this.writeJson(this.path(operationId), record, true);
      return record;
    });
  }
  async load(operationId: string): Promise<Permit2ExecutionIntent | null> {
    if (!HASH.test(operationId)) throw new ApnError("APN_INVALID_INPUT", "Invalid Permit2 operation ID.");
    await this.ready();
    const value = await this.readJson(this.path(operationId));
    if (value === null) return null;
    return validatePermit2ExecutionIntent(value, operationId);
  }
}

function validateBoundInput(input: Permit2IntentInput) {
  const prepared = input.prepared;
  if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 1 ||
      !validQuantity(input.minimumGasAtomic) || BigInt(input.minimumGasAtomic) === 0n) invalid();
  if (input.facilitatorEndpoint !== ENDPOINT || !HASH.test(prepared?.prepareHash) ||
      !HASH.test(prepared.challengeHash) || !HASH.test(prepared.policyDigest)) invalid();
  const url = new URL(input.resourceUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.toString() !== input.resourceUrl ||
      input.challenge.resource.url !== input.resourceUrl || hashChallenge(input.challenge) !== prepared.challengeHash ||
      url.origin !== input.merchantOrigin) refuse("Merchant resource or origin changed.");
  const selection = selectPermit2Offer(input.challenge.accepts, prepared.payer);
  if (selection.offerHash !== prepared.offerHash || selection.index !== prepared.plan.selection.index ||
      canonicalJson(selection.requirement) !== canonicalJson(prepared.plan.selection.requirement)) refuse("Merchant terms changed.");
  const authorization = prepared.plan.authorization;
  const deadline = BigInt(authorization.deadline);
  if (deadline <= BigInt(input.nowSeconds) || deadline > BigInt(Number.MAX_SAFE_INTEGER) ||
      prepared.expiresAtUnix !== authorization.deadline || prepared.chain !== asset.chain ||
      prepared.token !== asset.token || prepared.amountAtomic !== selection.amountAtomic ||
      prepared.payTo !== selection.payTo || prepared.payer !== authorization.from ||
      authorization.permitted.token !== asset.token || authorization.permitted.amount !== selection.amountAtomic ||
      authorization.spender !== X402_EXACT_PERMIT2_PROXY || authorization.witness.to !== selection.payTo ||
      authorization.witness.validAfter !== "0" || !validQuantity(authorization.nonce) ||
      prepared.plan.permit2.domain.verifyingContract !== PERMIT2_ADDRESS ||
      prepared.plan.permit2.domain.chainId !== asset.chainId ||
      prepared.plan.permit2.domain.name !== "Permit2") refuse("Permit2 bound fields changed.");
  let typedDataDigest: string, eip2612Digest: string | null;
  try {
    typedDataDigest = hashTypedData(prepared.plan.permit2 as Parameters<typeof hashTypedData>[0]);
    eip2612Digest = prepared.plan.eip2612 === null ? null :
      hashTypedData(prepared.plan.eip2612.typedData as Parameters<typeof hashTypedData>[0]);
  } catch { return refuse("Permit2 typed data is invalid."); }
  return { prepareHash: prepared.prepareHash, challengeHash: prepared.challengeHash,
    merchantOrigin: input.merchantOrigin, resourceUrl: input.resourceUrl, owner: prepared.payer,
    recipient: prepared.payTo, amountAtomic: prepared.amountAtomic, typedDataDigest, eip2612Digest,
    nonce: authorization.nonce, deadline: authorization.deadline, timeoutSeconds: selection.maxTimeoutSeconds,
    policyDigest: prepared.policyDigest, minimumGasAtomic: input.minimumGasAtomic };
}

function preparedSnapshot(value: Permit2PreparedMaterial): string {
  return canonicalJson(JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item)));
}
function validQuantity(value: unknown): value is string {
  return typeof value === "string" && QUANTITY.test(value) && BigInt(value) <= (1n << 256n) - 1n;
}
function invalid(): never { throw new ApnError("APN_INVALID_INPUT", "Invalid Permit2 intent input."); }
function refuse(message: string): never {
  throw new ApnError("APN_OPERATION_BLOCKED", message, { reason: "x402_permit2_intent_mismatch" });
}
function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Permit2 intent journal is corrupt."); }

/** Validate a checked existing record without initialization or effects. */
export function validatePermit2ExecutionIntent(value: unknown, operationId: string): Permit2ExecutionIntent {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "idempotencyHash", "profileHash",
    "requestHash", "prepareHash", "challengeHash", "merchantOrigin", "resourceUrl", "facilitatorEndpoint", "chain",
    "token", "owner", "recipient", "amountAtomic", "permit2Contract", "exactProxy", "typedDataDigest",
    "eip2612Digest", "nonce", "deadline", "policyDigest", "reservationId", "reservationState", "capability",
    "createdAtUnix", "integrityHash"])) corrupt();
  const { integrityHash, ...body } = value;
  if (value.schemaVersion !== SCHEMA || value.operationId !== operationId ||
    value.capability !== "execution_blocked" || value.reservationState !== "intended" ||
    value.facilitatorEndpoint !== ENDPOINT || value.chain !== asset.chain || value.token !== asset.token ||
    value.permit2Contract !== PERMIT2_ADDRESS || value.exactProxy !== X402_EXACT_PERMIT2_PROXY ||
    !HASH.test(String(integrityHash)) || integrityHash !== domainHash(SCHEMA, canonicalJson(body))) corrupt();
  for (const field of ["idempotencyHash", "profileHash", "requestHash", "prepareHash", "challengeHash", "policyDigest", "reservationId"]) {
    if (typeof value[field] !== "string" || !HASH.test(value[field])) corrupt();
  }
  for (const field of ["owner", "recipient"]) {
    if (typeof value[field] !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value[field]) || /^0x0{40}$/u.test(value[field])) corrupt();
  }
  if (!validQuantity(value.amountAtomic) || BigInt(value.amountAtomic) === 0n || !validQuantity(value.nonce) ||
      !validQuantity(value.deadline) || BigInt(value.deadline) > BigInt(Number.MAX_SAFE_INTEGER) ||
      typeof value.createdAtUnix !== "number" || !Number.isSafeInteger(value.createdAtUnix) || value.createdAtUnix < 1 ||
      BigInt(value.deadline) <= BigInt(value.createdAtUnix) ||
      typeof value.typedDataDigest !== "string" || !/^0x[a-f0-9]{64}$/u.test(value.typedDataDigest) ||
      (value.eip2612Digest !== null && (typeof value.eip2612Digest !== "string" || !/^0x[a-f0-9]{64}$/u.test(value.eip2612Digest)))) corrupt();
  try {
    if (typeof value.resourceUrl !== "string" || typeof value.merchantOrigin !== "string") corrupt();
    const url = new URL(value.resourceUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.toString() !== value.resourceUrl ||
        url.origin !== value.merchantOrigin) corrupt();
  } catch { corrupt(); }
  return value as unknown as Permit2ExecutionIntent;
}
