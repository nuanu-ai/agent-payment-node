/**
 * One synthetic record per custody store, sealed and opened through the store's own public API. Import only after
 * installCustodyEnvelopeMocks(): the material validators behind decryption are stubbed, the envelope code is real.
 * Public synthetic keys only; no profile, Keychain or network.
 */
import { getAddress, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, domainHash, hashObject, sha256 } from "../../src/canonical.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { CircleFundingEffectStore } from "../../src/circle-v2-evm/funding-custody.js";
import { EncryptedProfilePolicy } from "../../src/encrypted-profile-policy.js";
import { EncryptedProviderAuthorizationStore } from "../../src/encrypted-provider-authorization-store.js";
import { EncryptedSmartAccountDirectEffectStore } from "../../src/encrypted-smart-account-direct-effect-store.js";
import { EncryptedSmartAccountGaslessMaterialStore } from "../../src/encrypted-smart-account-gasless-material-store.js";
import { EncryptedSmartAccountPermissionStore } from "../../src/encrypted-smart-account-permission-store.js";
import { EncryptedSmartAccountX402MaterialStore } from "../../src/encrypted-smart-account-x402-material-store.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { GaslessEffectStore } from "../../src/gasless/effect-store.js";
import { BridgeEffectStore } from "../../src/lifi/effect-store.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { decodeDelegations, encodeDelegations, ROOT_AUTHORITY } from "../../src/metamask-smart-account-vendor.js";
import { StateStore } from "../../src/state.js";
import { EncryptedUniswapExecutionEffectStore, newUniswapExecutionEffect } from "../../src/swap/uniswap-ethereum/execution/effect-store.js";
import { encodeCanonicalBase64Json } from "../../src/x402-codec.js";
import { MerchantCustody } from "../../src/x402-merchant/custody.js";
import { flatFormat, nestedFormat, type Json, type ReferenceFormat } from "./custody-envelope-reference.js";
import { smartAccountGaslessRecord } from "./custody-envelope-sa-gasless.js";

export interface SealedCase { readonly files: readonly string[]; readonly envelopePath: string; readonly context: Json; readonly plaintext: string }
export interface AadChange { readonly files: Readonly<Record<string, unknown>>; readonly context: Json; readonly envelopePath: string }
export interface CustodyCase {
  /** The 0.5.45 format of this store's envelope. */
  readonly format: ReferenceFormat;
  /** Seals one record into `root` through the store; returns what opening needs and the canonical plaintext. */
  seal(root: string, secret: WrappingSecretPort): Promise<SealedCase>;
  /** Opens through the store; absent for merchant material, which no release decrypts. */
  readonly open?: (root: string, secret: WrappingSecretPort, context: Json) => Promise<unknown>;
  /** Changes authenticated header data in a way the store's own layout checks still accept. */
  readonly aad?: (files: Readonly<Record<string, Json>>, context: Json, envelopePath: string) => AadChange;
}

const AT = "2026-10-17T10:00:00.000Z";
const KEY = `0x${"4".repeat(63)}1` as Hex, ACCOUNT = privateKeyToAccount(KEY);
const PROFILE = "golden", PROFILE_HASH = sha256(`profile\0${PROFILE}`);
const OPERATION = "1".repeat(64), FINGERPRINT = "2".repeat(64), ENVELOPE = "3".repeat(64);
const RAW = `0x02${"ab".repeat(40)}` as Hex;
const h = (digit: string): string => digit.repeat(64);

async function state(root: string): Promise<StateStore> { const s = new StateStore(root); await s.initialize(); return s; }
function single(path: string, context: Json, plaintext: unknown): SealedCase {
  return { files: [path], envelopePath: path, context, plaintext: typeof plaintext === "string" ? plaintext : canonicalJson(plaintext) };
}
/** Moves the envelope to a new operation id: the id is in the HKDF info and the AAD. */
function moved(dir: string, idKey: string, contextKey: string) {
  return (files: Readonly<Record<string, Json>>, context: Json, path: string): AadChange => {
    const id = h("9"), next = `${dir}/${id}.json`;
    return { files: { [next]: { ...files[path], [idKey]: id } }, context: { ...context, [contextKey]: id }, envelopePath: next };
  };
}
const gaslessOperation = { profileHash: PROFILE_HASH, operationId: OPERATION, fingerprint: FINGERPRINT,
  intent: { unsignedEnvelopeHash: ENVELOPE }, bootstrap: { materialHash: h("c"), estimate: { gasAtomic: "21000" } } };
const gaslessMaterial = {
  bootstrap: { role: "bootstrap", material: "synthetic-bootstrap" },
  user_operation: { role: "user_operation", bootstrapMaterialHash: h("c"), estimateHash: hashObject({ gasAtomic: "21000" }), material: "synthetic-final" },
} as const;
function gaslessCase(role: "bootstrap" | "user_operation"): CustodyCase {
  return {
    format: nestedFormat("nonce", f => ["apn.gasless-effect-envelope.v1", "gasless-effects", f.profileHash, f.operationId,
      f.fingerprint, f.role, f.envelopeHash, f.bootstrapMaterialHash ?? "", f.estimateHash ?? ""].join("\0")),
    async seal(root, secret) {
      const store = new GaslessEffectStore(root, secret);
      await store.seal(gaslessOperation as never, gaslessMaterial.bootstrap as never);
      await store.seal(gaslessOperation as never, gaslessMaterial.user_operation as never);
      const path = (r: string) => `gasless-effects/${PROFILE_HASH}/${OPERATION}-${r}.json`;
      return { files: [path("bootstrap"), path("user_operation")], envelopePath: path(role),
        context: { operation: gaslessOperation, role }, plaintext: canonicalJson(gaslessMaterial[role]) };
    },
    open: async (root, secret, c) => await new GaslessEffectStore(root, secret).load(c.operation, c.role),
    aad: (files, c, path) => ({ files: { ...files, [path]: { ...files[path], fingerprint: h("8") } },
      context: { ...c, operation: { ...c.operation, fingerprint: h("8") } }, envelopePath: path }),
  };
}

export const CUSTODY_CASES: Readonly<Record<string, CustodyCase>> = {
  wallet: {
    format: nestedFormat("nonce", f => `apn.wallet-envelope.v1\0${f.identity.profile}`),
    async seal(root, secret) {
      const store = new EncryptedWalletStore(await state(root), secret);
      await store.importNew(PROFILE, KEY, ACCOUNT.address);
      return single(`wallets/${PROFILE}.json`, { profile: PROFILE }, (await store.describe(PROFILE))!.secret);
    },
    open: async (root, secret, c) => (await new EncryptedWalletStore(await state(root), secret).describe(c.profile))?.secret,
    aad: (files, c, path) => {
      const file = files[path], createdAt = "2026-10-17T10:00:01.000Z";
      const identity = { ...file.identity, createdAt, bindingHash: hashObject({ profile: file.identity.profile, address: file.identity.address, createdAt }) };
      return { files: { [path]: { ...file, identity } }, context: c, envelopePath: path };
    },
  },
  profilePolicy: {
    format: nestedFormat("nonce", f => `apn.profile-policy-envelope.v1\0${f.binding.x402Network === undefined ? f.binding.profile
      : `~network~${f.binding.x402Network.chainId}~${f.binding.x402Network.token.toLowerCase()}~${f.binding.profile}`}`),
    async seal(root, secret) {
      const binding = { profile: PROFILE, profileHash: PROFILE_HASH, walletAddress: ACCOUNT.address, walletBindingHash: h("a") };
      const policy = new EncryptedProfilePolicy(await state(root), secret, { approve: async () => undefined }, { now: () => new Date(AT) });
      return single(`policies/${PROFILE}.json`, { binding },
        await policy.set(binding, { maxBalanceUsdcAtomic: "60000000", maxX402AmountAtomic: "2000000" }));
    },
    open: async (root, secret, c) => await new EncryptedProfilePolicy(await state(root), secret, { approve: async () => undefined }).load(c.binding),
    aad: (files, c, path) => {
      const binding = { ...c.binding, walletBindingHash: h("8") };
      return { files: { [path]: { ...files[path], binding } }, context: { binding }, envelopePath: path };
    },
  },
  providerAuthorization: {
    format: nestedFormat("nonce", f => `apn.provider-authorization-envelope.v1\0${f.binding.profileHash}\0${f.binding.operationId}`),
    async seal(root, secret) {
      const binding = { profile: PROFILE, profileHash: PROFILE_HASH, operationId: OPERATION, fingerprint: FINGERPRINT,
        wallet: ACCOUNT.address.toLowerCase(), providerId: "golden-provider", profileRevision: 1, capabilityHash: h("4"), accountBindingHash: h("5") };
      const signature = `0x${"12".repeat(65)}`;
      const record = { schemaVersion: "apn.provider-authorization.v1", requestHash: h("6"), phase: "signed", updatedAt: AT,
        signature, signatureHash: domainHash("apn.x402.signature.v1", Buffer.from(signature.slice(2), "hex")) };
      await new EncryptedProviderAuthorizationStore(await state(root), secret).save(binding as never, record as never);
      return single(`provider-authorizations/${PROFILE_HASH}/${OPERATION}.json`, { binding }, record);
    },
    open: async (root, secret, c) => await new EncryptedProviderAuthorizationStore(await state(root), secret).load(c.binding),
    aad: (files, c, path) => {
      const binding = { ...c.binding, fingerprint: h("8") };
      return { files: { [path]: { ...files[path], binding } }, context: { binding }, envelopePath: path };
    },
  },
  smartAccountDirectEffect: {
    format: nestedFormat("nonce", f => `apn.metamask-smart-account-direct-effect-envelope.v1\0${f.operation_id}`),
    async seal(root, secret) {
      const child = "0xc0ffee";
      const body = { schema_version: "apn.metamask-smart-account-direct-effect.v1", operation_id: OPERATION, profile_hash: PROFILE_HASH,
        intent_fingerprint: h("4"), root_grant_fingerprint: h("5"), child_fingerprint: sha256(`apn.smart-account.child\0${child}`),
        owner_address: ACCOUNT.address, session_address: getAddress(`0x${"22".repeat(20)}`), recipient: getAddress(`0x${"33".repeat(20)}`),
        amount_atomic: "1000000", delegation_manager: getAddress(`0x${"44".repeat(20)}`), child_context: child, redemption_calldata: "0xdeadbeef",
        raw_transaction: RAW, transaction_hash: keccak256(RAW), nonce_atomic: "5",
        economics: { nonceAtomic: "5", gasLimitAtomic: "100000", maxFeePerGasAtomic: "3", maxPriorityFeePerGasAtomic: "1", maximumGasCostAtomic: "300000" },
        phase: "sealed", submission_attempts: 0, sealed_at: AT, updated_at: AT };
      const sealed = await new EncryptedSmartAccountDirectEffectStore(await state(root), secret).seal(body as never);
      return single(`smart-account-effects/${OPERATION}.json`, { operationId: OPERATION }, sealed);
    },
    open: async (root, secret, c) => await new EncryptedSmartAccountDirectEffectStore(await state(root), secret).load(c.operationId),
    aad: moved("smart-account-effects", "operation_id", "operationId"),
  },
  smartAccountX402Material: {
    format: nestedFormat("nonce", f => `apn.metamask-smart-account-x402-material-envelope.v1\0${f.operation_id}`),
    async seal(root, secret) {
      const owner = ACCOUNT.address.toLowerCase(), session = `0x${"22".repeat(20)}`, manager = `0x${"44".repeat(20)}`;
      const context = encodeDelegations([{ delegate: session, delegator: owner, authority: ROOT_AUTHORITY, caveats: [], salt: "0x01",
        signature: `0x${"11".repeat(65)}` } as never]).toLowerCase() as Hex;
      const payload = { x402Version: 2, accepted: { scheme: "exact", network: "eip155:8453" },
        payload: { delegationManager: manager, delegator: owner, permissionContext: context } };
      const header = encodeCanonicalBase64Json(payload), json = canonicalJson(payload);
      const record = { schema_version: "apn.metamask-smart-account-x402-material.v1", operation_id: OPERATION, profile_hash: PROFILE_HASH,
        fingerprint: FINGERPRINT, request_hash: h("4"), offer_hash: h("5"), root_grant_fingerprint: h("6"),
        child_hash: domainHash("apn.x402.erc7710.child.v1", encodeDelegations([decodeDelegations(context)[0]!])),
        permission_context_hash: domainHash("apn.x402.erc7710.permission-context.v1", context),
        payment_payload_hash: domainHash("apn.x402.payment-payload.v1", json),
        payment_header_hash: domainHash("apn.x402.payment-header.v1", Buffer.from(header, "ascii")),
        delegation_manager: manager, delegator: owner, child_permission_context: context, payment_payload_canonical_json: json,
        payment_header: header, effective_expiry_unix: "1792000000", phase: "sealed", sealed_at: AT, updated_at: AT };
      const sealed = await new EncryptedSmartAccountX402MaterialStore(await state(root), secret).seal(record as never);
      return single(`smart-account-x402-materials/${OPERATION}.json`, { operationId: OPERATION }, sealed);
    },
    open: async (root, secret, c) => await new EncryptedSmartAccountX402MaterialStore(await state(root), secret).load(c.operationId),
    aad: moved("smart-account-x402-materials", "operation_id", "operationId"),
  },
  smartAccountGaslessMaterial: {
    format: nestedFormat("iv", f => `apn.smart-account-gasless-material-envelope.v1\0${f.operation_id}`),
    async seal(root, secret) {
      const sealed = await new EncryptedSmartAccountGaslessMaterialStore(await state(root), secret).seal(await smartAccountGaslessRecord(OPERATION));
      return single(`smart-account-gasless-materials/${OPERATION}.json`, { operationId: OPERATION }, sealed);
    },
    open: async (root, secret, c) => await new EncryptedSmartAccountGaslessMaterialStore(await state(root), secret).load(c.operationId),
    aad: moved("smart-account-gasless-materials", "operation_id", "operationId"),
  },
  smartAccountPermission: {
    format: nestedFormat("nonce", f => `apn.metamask-smart-account-permission-envelope.v1\0${f.profile_hash}`),
    async seal(root, secret) {
      const sessionKey = `0x${"5".repeat(64)}` as Hex;
      const record = { schema_version: "apn.metamask-smart-account-permission.v1", profile: PROFILE, profile_hash: PROFILE_HASH,
        provider_id: "metamask-smart-account", idempotency_hash: h("4"), intent_fingerprint: h("5"), phase: "pending_consent", revision: 1,
        requested_cap_atomic: "1000000", requested_expires_at_unix: 1792000000, starts_at_unix: 1791000000,
        session_address: privateKeyToAccount(sessionKey).address, session_private_key: sessionKey, created_at: AT, updated_at: AT,
        max_observed_unix: 1791000000, revocation_freshness: "never_synced" };
      await new EncryptedSmartAccountPermissionStore(await state(root), secret).save(record as never);
      return single(`smart-account-permissions/${PROFILE_HASH}.json`, { profileHash: PROFILE_HASH }, record);
    },
    open: async (root, secret, c) => await new EncryptedSmartAccountPermissionStore(await state(root), secret).load(c.profileHash),
    aad: moved("smart-account-permissions", "profile_hash", "profileHash"),
  },
  chainAccount: {
    format: flatFormat(f => `apn.chain-wallet.v1\0${f.account.rail}\0${f.account.profile}\0${f.account.identityHash}`),
    async seal(root, secret) {
      const store = new ChainAccountStore(root, secret);
      const account = await store.ensureLocal({ profile: PROFILE, rail: "solana",
        create: async () => ({ address: `GoLdEn${"1".repeat(37)}`, seed: Buffer.alloc(32, 9) }) });
      const effect = { operationId: OPERATION, fingerprint: FINGERPRINT, transactionId: "A".repeat(64), rawPayload: "c2lnbmVk", rawPayloadHash: sha256("c2lnbmVk") };
      await store.saveEffect(account, effect);
      const wallet = `chain-wallets/solana/${PROFILE_HASH}.json`;
      return { files: [`chain-accounts/solana/${PROFILE_HASH}.json`, wallet], envelopePath: wallet,
        context: { account, operationId: OPERATION }, plaintext: canonicalJson({ version: "apn.chain-wallet-secret.v1", seedHex: "09".repeat(32), effects: { [OPERATION]: effect } }) };
    },
    open: async (root, secret, c) => {
      const store = new ChainAccountStore(root, secret);
      const effect = await store.effectByOperationId(c.account, c.operationId);
      return await store.withSeed(c.account, async seed => ({ version: "apn.chain-wallet-secret.v1", seedHex: seed.toString("hex"), effects: { [c.operationId]: effect } }));
    },
  },
  circleFunding: {
    format: flatFormat(f => `apn.circle-v2-evm-effect-envelope.v2\0${f.operationId}\0${f.role}\0${f.fingerprint}\0${f.envelopeHash}`),
    async seal(root, secret) {
      const body = { chainId: 42161, from: ACCOUNT.address, to: getAddress(`0x${"66".repeat(20)}`), data: "0x1234" as Hex, valueAtomic: "0",
        nonceAtomic: "7", gasLimitAtomic: "100000", maxFeePerGasAtomic: "2000000000", maxPriorityFeePerGasAtomic: "1000000" };
      const effect = { role: "burn", envelope: { ...body, envelopeHash: hashObject(body) }, transactionHash: null, materialHash: null };
      const op = { operationId: OPERATION, fingerprint: FINGERPRINT };
      const rawTransaction = await ACCOUNT.signTransaction({ type: "eip1559", chainId: 42161, to: body.to, data: body.data, value: 0n,
        nonce: 7, gas: 100000n, maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 1000000n, accessList: [] });
      const material = { schemaVersion: "apn.circle-v2-evm-effect.v2", operationId: OPERATION, role: "burn", fingerprint: FINGERPRINT,
        envelopeHash: effect.envelope.envelopeHash, rawTransaction, transactionHash: keccak256(rawTransaction) };
      const sealed = { ...material, materialHash: hashObject(material) };
      await new CircleFundingEffectStore(root, secret).save(op as never, effect as never, sealed as never);
      return single(`circle-v2-evm-funding-effects/${OPERATION}-burn.json`, { op, effect }, sealed);
    },
    open: async (root, secret, c) => await new CircleFundingEffectStore(root, secret).load(c.op, c.effect),
    aad: (files, c, path) => ({ files: { [path]: { ...files[path], fingerprint: h("8") } },
      context: { ...c, op: { ...c.op, fingerprint: h("8") } }, envelopePath: path }),
  },
  gaslessBootstrap: gaslessCase("bootstrap"),
  gaslessUserOperation: gaslessCase("user_operation"),
  bridgeEffect: {
    format: nestedFormat("nonce", f => `apn.bridge-effect-envelope.v1\0${f.profileHash}\0${f.operationId}\0${f.role}\0${f.fingerprint}\0${f.envelopeHash}`),
    async seal(root, secret) {
      const op = { profileHash: PROFILE_HASH, operationId: OPERATION, fingerprint: FINGERPRINT,
        effects: [{ role: "bridge", envelope: { envelopeHash: ENVELOPE }, transactionHash: null, sealedMaterialHash: null }] };
      const body = { schemaVersion: "apn.bridge-effect.v1", profileHash: PROFILE_HASH, operationId: OPERATION, role: "bridge",
        fingerprint: FINGERPRINT, envelopeHash: ENVELOPE, rawTransaction: RAW, transactionHash: keccak256(RAW) };
      const material = { ...body, materialHash: hashObject(body) };
      await new BridgeEffectStore(root, secret).seal(op as never, material as never);
      return single(`bridge-effects/${PROFILE_HASH}/${OPERATION}-bridge.json`, { op, role: "bridge" }, material);
    },
    open: async (root, secret, c) => await new BridgeEffectStore(root, secret).load(c.op, c.role),
    aad: (files, c, path) => ({ files: { [path]: { ...files[path], fingerprint: h("8") } },
      context: { ...c, op: { ...c.op, fingerprint: h("8") } }, envelopePath: path }),
  },
  uniswapExecution: {
    format: nestedFormat("nonce", f => `apn.uniswap-ethereum.execution-effect-envelope.v1\0${f.profileHash}\0${f.operationId}\0${f.bindingHash}\0${f.submissionMarkerHash}`),
    async seal(root, secret) {
      const operation = { operationId: OPERATION, ownerProfileHash: PROFILE_HASH };
      const binding = { bindingHash: h("4"), envelopeHash: ENVELOPE, submissionMarkerHash: h("5") };
      const effect = newUniswapExecutionEffect({ operationId: OPERATION, profileHash: PROFILE_HASH, bindingHash: binding.bindingHash,
        envelopeHash: ENVELOPE, submissionMarkerHash: binding.submissionMarkerHash, rawTransaction: RAW, transactionHash: keccak256(RAW),
        phase: "sealed", sendAttempts: 0, sealedAt: AT, updatedAt: AT } as never);
      await new EncryptedUniswapExecutionEffectStore(await state(root), secret).seal(operation as never, binding as never, effect);
      return single(`uniswap-execution-effects/${PROFILE_HASH}/${OPERATION}.json`, { operation, binding }, effect);
    },
    open: async (root, secret, c) => await new EncryptedUniswapExecutionEffectStore(await state(root), secret).load(c.operation, c.binding),
    aad: (files, c, path) => ({ files: { [path]: { ...files[path], transactionHash: `0x${h("7")}` } }, context: c, envelopePath: path }),
  },
  merchantMaterial: {
    format: flatFormat(f => canonicalJson({ schemaVersion: f.schemaVersion, operationId: f.operationId, profileHash: f.profileHash,
      fingerprint: f.fingerprint, txHash: f.txHash }), f => ({ schemaVersion: f.schemaVersion, operationId: f.operationId,
      profileHash: f.profileHash, fingerprint: f.fingerprint, txHash: f.txHash })),
    async seal(root, secret) {
      const terms = { payer: ACCOUNT.address, token: getAddress(`0x${"77".repeat(20)}`), data: `0xa9059cbb${"00".repeat(64)}` as Hex };
      const o = { operationId: OPERATION, profileHash: PROFILE_HASH, fingerprint: FINGERPRINT, terms,
        envelope: { nonce: "3", gas: "60000", maxFeePerGas: "1000000000", maxPriorityFeePerGas: "0" } };
      const raw = await ACCOUNT.signTransaction({ type: "eip1559", chainId: 4326, to: terms.token, data: terms.data, value: 0n,
        nonce: 3, gas: 60000n, maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 0n, accessList: [] });
      await new MerchantCustody(await state(root), secret, () => new Date(AT)).seal(o as never, raw);
      return single(`merchant-material/${OPERATION}.json`, { operationId: OPERATION }, raw);
    },
  },
};
