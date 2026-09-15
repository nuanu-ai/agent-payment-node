import { hashObject } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { GaslessEffectStore } from "./effect-store.js";
import type { Hex } from "../model.js";
import type { GaslessAuthorization, GaslessFees, GaslessIntent, GaslessOwner } from "./model.js";
import type { GaslessOperationRecord, GaslessRole } from "./operation-model.js";
import { validateGaslessOperation } from "./operation-validation.js";
import { assertGaslessOwner } from "./owner.js";
import type {
  GaslessBootstrapMaterial,
  GaslessCustodyPort,
  GaslessSealedMaterial,
  GaslessUserOperationMaterial,
} from "./ports.js";
import {
  GASLESS_ESTIMATE_SIGNATURE,
  verifyGaslessBootstrap,
  verifyGaslessUserOperation,
} from "./signature.js";
import { GASLESS_MIN_REMAINING_MS, gaslessFailure, gaslessSame } from "./validation.js";
import {
  gaslessAuthorizationRequest,
  gaslessPermitTypedData,
  gaslessUserOperation,
  gaslessUserOperationTypedData,
} from "./wire.js";

export class LocalGaslessCustody implements GaslessCustodyPort {
  private readonly wallets: EncryptedWalletStore;
  private readonly effects: GaslessEffectStore;

  constructor(
    private readonly state: StateStore,
    wrapping: WrappingSecretPort,
    private readonly now: () => number = Date.now,
  ) {
    this.wallets = new EncryptedWalletStore(state, wrapping);
    this.effects = new GaslessEffectStore(state.root, wrapping);
  }

  async load(operation: GaslessOperationRecord, role: GaslessRole): Promise<GaslessSealedMaterial | null> {
    validateGaslessOperation(operation);
    validRole(role);
    return await this.state.withLocks(
      [`custody:${operation.profileHash}`],
      async () => await this.effects.load(operation, role),
    );
  }

  async seal(
    operation: GaslessOperationRecord,
    role: GaslessRole,
    owner: GaslessOwner,
    bootstrap?: GaslessBootstrapMaterial,
    fees?: GaslessFees,
  ): Promise<GaslessSealedMaterial> {
    validateGaslessOperation(operation);
    validRole(role);
    assertSigningGate(operation, role, owner, this.now());
    return await this.state.withLocks([`custody:${operation.profileHash}`], async () => {
      assertSigningGate(operation, role, owner, this.now());
      await assertGaslessOwner(this.state, {
        owner: operation.intent.owner,
        providerBinding: operation.intent.providerBinding,
      });
      const existing = await this.effects.load(operation, role);
      if (existing !== null) return existing;
      const wallet = await this.wallets.describe(owner.profile);
      if (wallet === null) unavailable("gasless_encrypted_wallet_missing");
      try {
        if (wallet.identity.profile !== owner.profile || wallet.identity.address !== owner.address ||
          wallet.identity.bindingHash !== owner.walletBindingHash || wallet.identity.createdAt !== owner.walletCreatedAt) {
          gaslessFailure("APN_WALLET_MISMATCH", "gasless_encrypted_wallet_binding");
        }
        assertRemaining(operation, this.now());
        const account = privateKeyToAccount(wallet.secret.privateKey);
        if (account.address !== owner.address) gaslessFailure("APN_WALLET_MISMATCH", "gasless_owner_key_binding");
        if (role === "bootstrap") {
          if (bootstrap !== undefined || fees !== undefined) corrupt("gasless_unexpected_bootstrap_argument");
          return await this.sealBootstrap(operation, account);
        }
        if (bootstrap === undefined) corrupt("gasless_original_bootstrap_required");
        return await this.sealUserOperation(operation, account, bootstrap, fees);
      } finally {
        this.wallets.clear(wallet.secret);
      }
    });
  }

  private async sealBootstrap(
    operation: GaslessOperationRecord,
    account: ReturnType<typeof privateKeyToAccount>,
  ): Promise<GaslessBootstrapMaterial> {
    const permitSignature = await account.signTypedData(gaslessPermitTypedData(operation.intent));
    let authorization: GaslessAuthorization | null = null;
    if (operation.intent.initialSnapshot.delegation === "empty") {
      const signed = await account.signAuthorization(gaslessAuthorizationRequest(operation.intent));
      if (signed.yParity === undefined) corrupt("gasless_authorization_parity");
      authorization = {
        chainId: toHex(signed.chainId),
        address: signed.address,
        nonce: toHex(signed.nonce),
        yParity: toHex(signed.yParity),
        r: signed.r,
        s: signed.s,
      };
    }
    const body = {
      schemaVersion: "apn.gasless-effect.v1" as const,
      profileHash: operation.profileHash,
      operationId: operation.operationId,
      role: "bootstrap" as const,
      fingerprint: operation.fingerprint,
      envelopeHash: operation.intent.unsignedEnvelopeHash,
      permitSignature,
      authorization,
    };
    const material: GaslessBootstrapMaterial = { ...body, materialHash: hashObject(body) };
    await verifyGaslessBootstrap(operation.intent, {
      permitSignature: material.permitSignature,
      authorization: material.authorization,
    });
    return await this.effects.seal(operation, material) as GaslessBootstrapMaterial;
  }

  private async sealUserOperation(
    operation: GaslessOperationRecord,
    account: ReturnType<typeof privateKeyToAccount>,
    suppliedBootstrap: GaslessBootstrapMaterial,
    fees: GaslessFees | undefined,
  ): Promise<GaslessUserOperationMaterial> {
    const original = await this.effects.load(operation, "bootstrap");
    if (original?.role !== "bootstrap") unavailable("gasless_bootstrap_seal_missing");
    if (!gaslessSame(original, suppliedBootstrap)) corrupt("gasless_original_bootstrap_mismatch");
    if (operation.bootstrap.estimate === null) corrupt("gasless_checked_estimate_missing");
    const estimateHash = hashObject(operation.bootstrap.estimate);
    const estimateWire = gaslessUserOperation(operation.intent, original, GASLESS_ESTIMATE_SIGNATURE, fees);
    const signature = await account.signTypedData(gaslessUserOperationTypedData(operation.intent, estimateWire));
    const userOperation = gaslessUserOperation(operation.intent, original, signature, fees);
    const userOperationHash = await verifyGaslessUserOperation(operation.intent, userOperation);
    const body = {
      schemaVersion: "apn.gasless-effect.v1" as const,
      profileHash: operation.profileHash,
      operationId: operation.operationId,
      role: "user_operation" as const,
      fingerprint: operation.fingerprint,
      envelopeHash: operation.intent.unsignedEnvelopeHash,
      bootstrapMaterialHash: original.materialHash,
      estimateHash,
      userOperation,
      userOperationHash,
    };
    const material: GaslessUserOperationMaterial = { ...body, materialHash: hashObject(body) };
    return await this.effects.seal(operation, material) as GaslessUserOperationMaterial;
  }
}

/** Throwaway-key material for a pre-disclosure mirror estimate. The owner's wallet and key are never loaded. */
export async function gaslessMirrorBootstrap(intent: GaslessIntent): Promise<{
  readonly intent: GaslessIntent; readonly permitSignature: Hex; readonly authorization: GaslessAuthorization;
}> {
  const account = privateKeyToAccount(generatePrivateKey());
  const initialSnapshot = { ...intent.initialSnapshot, owner: account.address, delegation: "empty" as const,
    allowanceAtomic: "0", permitNonceAtomic: "0", entryPointNonceAtomic: "0", eoaNonceAtomic: "0", pendingEoaNonceAtomic: "0" };
  const mirror: GaslessIntent = { ...intent, owner: { ...intent.owner, address: account.address }, initialSnapshot };
  const permitSignature = await account.signTypedData(gaslessPermitTypedData(mirror));
  const signed = await account.signAuthorization(gaslessAuthorizationRequest(mirror));
  if (signed.yParity === undefined) corrupt("gasless_authorization_parity");
  return { intent: mirror, permitSignature, authorization: { chainId: toHex(signed.chainId), address: signed.address,
    nonce: toHex(signed.nonce), yParity: toHex(signed.yParity), r: signed.r, s: signed.s } };
}

function assertSigningGate(
  operation: GaslessOperationRecord,
  role: GaslessRole,
  owner: GaslessOwner,
  now: number,
): void {
  const effect = role === "bootstrap" ? operation.bootstrap : operation.userOperation;
  const approval = operation.approval;
  if (operation.terminal || approval === null || approval.policy !== "apn.gasless.foreground-approval.v1" ||
    approval.fingerprint !== operation.fingerprint || approval.expiresAt !== operation.intent.expiresAt ||
    effect.role !== role || effect.phase !== "signing_started" || effect.signingAttempts !== 1 ||
    effect.materialHash !== null || !gaslessSame(owner, operation.intent.owner)) {
    unavailable("gasless_signing_gate");
  }
  assertRemaining(operation, now);
}

function assertRemaining(operation: GaslessOperationRecord, now: number): void {
  if (Date.parse(operation.intent.expiresAt) - now < GASLESS_MIN_REMAINING_MS) {
    gaslessFailure("APN_REPREPARE_REQUIRED", "gasless_action_expired");
  }
}

function validRole(role: GaslessRole): void {
  if (role !== "bootstrap" && role !== "user_operation") corrupt("gasless_effect_role");
}
function corrupt(reason: string): never { return gaslessFailure("APN_STATE_CORRUPT", reason); }
function unavailable(reason: string): never { return gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", reason); }
