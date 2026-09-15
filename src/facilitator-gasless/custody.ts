import { recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { assertGaslessOwner } from "../gasless/owner.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import type { Hex } from "../model.js";
import type { StateStore } from "../state.js";
import { facilitatorFail } from "./failure.js";
import type { FacilitatorOperationRecord } from "./operation-model.js";
import { facilitatorTypedData } from "./requirement.js";
import { validateFacilitatorOperation } from "./transitions.js";

export interface FacilitatorSignerPort {
  /** Signs the frozen authorization of an approved, unexposed operation. The signature is returned, never stored. */
  sign(operation: FacilitatorOperationRecord): Promise<Hex>;
}

export class LocalFacilitatorSigner implements FacilitatorSignerPort {
  private readonly wallets: EncryptedWalletStore;

  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort) {
    this.wallets = new EncryptedWalletStore(state, wrapping);
  }

  async sign(input: FacilitatorOperationRecord): Promise<Hex> {
    const op = validateFacilitatorOperation(input), signed = op.signed, owner = op.intent.owner;
    if (op.terminal || op.state !== "approved" || op.approval === null || signed === null || signed.signatureHash !== null) {
      return facilitatorFail("facilitator_gasless_signing");
    }
    return await this.state.withLocks([`custody:${op.profileHash}`], async () => {
      await assertGaslessOwner(this.state, { owner, providerBinding: op.intent.providerBinding });
      const wallet = await this.wallets.describe(owner.profile);
      if (wallet === null) return facilitatorFail("facilitator_gasless_signing");
      try {
        const identity = wallet.identity;
        if (identity.profile !== owner.profile || identity.address !== owner.address ||
          identity.bindingHash !== owner.walletBindingHash || identity.createdAt !== owner.walletCreatedAt) {
          facilitatorFail("facilitator_gasless_signing");
        }
        const account = privateKeyToAccount(wallet.secret.privateKey);
        if (account.address !== owner.address) facilitatorFail("facilitator_gasless_signing");
        const signature = await account.signTypedData(facilitatorTypedData(signed.authorization));
        if (await recoverAddress({ hash: signed.digest, signature }) !== owner.address) facilitatorFail("facilitator_gasless_signing");
        return signature;
      } finally {
        this.wallets.clear(wallet.secret);
      }
    });
  }
}
