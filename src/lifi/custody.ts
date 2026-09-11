import { hashObject } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { StateStore } from "../state.js";
import { BridgeEffectStore } from "./effect-store.js";
import type { BridgeOwner } from "./model.js";
import type { BridgeOperationRecord } from "./operation-model.js";
import { validateBridgeOperation } from "./operation-validation.js";
import { assertBridgeOwner } from "./owner.js";
import type { BridgeCustodyPort, BridgeSealedMaterial } from "./ports.js";
import { verifyBridgeSigned } from "./transaction.js";
import { BRIDGE_MIN_REMAINING_MS, bridgeFailure, bridgeSame } from "./validation.js";

export class LocalBridgeCustody implements BridgeCustodyPort {
  private readonly wallets: EncryptedWalletStore;
  private readonly effects: BridgeEffectStore;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly now: () => number = Date.now) {
    this.wallets = new EncryptedWalletStore(state, wrapping); this.effects = new BridgeEffectStore(state.root, wrapping);
  }
  async load(op: BridgeOperationRecord, role: "approval" | "bridge"): Promise<BridgeSealedMaterial | null> {
    validateBridgeOperation(op);
    return await this.state.withLocks([`custody:${op.profileHash}`], async () => await this.effects.load(op, role));
  }
  async seal(op: BridgeOperationRecord, role: "approval" | "bridge", owner: BridgeOwner): Promise<BridgeSealedMaterial> {
    validateBridgeOperation(op);
    const effect = op.effects.find((e) => e.role === role);
    if (op.terminal || op.approval === null || effect?.phase !== "signing_started" || !bridgeSame(owner, op.intent.owner) ||
      Date.parse(op.intent.expiresAt) - this.now() < BRIDGE_MIN_REMAINING_MS) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_signing_gate");
    return await this.state.withLocks([`custody:${op.profileHash}`], async () => {
      await assertBridgeOwner(this.state, op.intent);
      const existing = await this.effects.load(op, role);
      if (existing !== null) return existing;
      const wallet = await this.wallets.describe(owner.profile);
      if (wallet === null) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_encrypted_wallet_missing");
      try {
        if (wallet.identity.address !== owner.address || wallet.identity.profile !== owner.profile ||
          wallet.identity.bindingHash !== owner.walletBindingHash || wallet.identity.createdAt !== owner.walletCreatedAt) bridgeFailure("APN_WALLET_MISMATCH", "bridge_encrypted_wallet_binding");
        if (Date.parse(op.intent.expiresAt) - this.now() < BRIDGE_MIN_REMAINING_MS) bridgeFailure("APN_REPREPARE_REQUIRED", "bridge_signing_expired");
        const e = effect.envelope, c = e.economics, nonce = BigInt(c.nonceAtomic);
        if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) bridgeFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "bridge_nonce_bound");
        const account = privateKeyToAccount(wallet.secret.privateKey);
        const rawTransaction = await account.signTransaction({ type: "eip1559", chainId: e.chainId, to: e.to,
          data: e.data, value: BigInt(e.valueAtomic), nonce: Number(nonce), gas: BigInt(c.gasLimitAtomic),
          maxFeePerGas: BigInt(c.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(c.maxPriorityFeePerGasAtomic), accessList: [] });
        const transactionHash = keccak256(rawTransaction);
        await verifyBridgeSigned(rawTransaction, transactionHash, e);
        const body = { schemaVersion: "apn.bridge-effect.v1" as const, profileHash: op.profileHash, operationId: op.operationId,
          role, fingerprint: op.fingerprint, envelopeHash: e.envelopeHash, rawTransaction, transactionHash };
        return await this.effects.seal(op, { ...body, materialHash: hashObject(body) });
      } finally { this.wallets.clear(wallet.secret); }
    });
  }
}
