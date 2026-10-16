import { keccak256 } from "viem";
import { hashObject } from "./canonical.js";
import { DirectPublicEffectJournal, directCustodyPayload } from "./direct-public-effect.js";
import type { WalletIdentity, WalletSecretState } from "./encrypted-wallet-store.js";
import { parseDirectRecovery } from "./local-wallet-direct-payload.js";
import { assertWallet, effectSlot, protocol } from "./local-wallet-native-fields.js";
import { publicDirectEffect } from "./local-wallet-native-public.js";
import type { StateStore } from "./state.js";

type WithWallet = <T>(profile: string, action: (identity: WalletIdentity, secret: WalletSecretState) => Promise<T>) => Promise<T>;

/**
 * The exact bytes the owner already approved and APN already signed, read back for their first or a repeated dispatch.
 * It never signs: the encrypted effect must match the operation's public signed evidence byte for byte.
 */
export async function signedDirectTransaction(state: StateStore, payload: Readonly<Record<string, unknown>>, withWallet: WithWallet): Promise<unknown> {
  const recovery = parseDirectRecovery(payload);
  if ("expectedPayloadHash" in recovery) throw protocol("Signed direct material is bound to its public transaction hash.");
  const operation = await state.findOperation(recovery.operationId);
  if (operation === null || operation.terminal || operation.providerDirect !== undefined || operation.profile !== recovery.profile ||
      operation.fingerprint !== recovery.fingerprint || operation.transactionHash !== recovery.expectedTransactionHash ||
      operation.rawTransactionHash !== recovery.expectedRawTransactionHash) {
    throw protocol("Signed direct material request does not match its saved non-terminal signed operation.");
  }
  const published = await new DirectPublicEffectJournal(state).effect(operation);
  const payloadHash = hashObject(directCustodyPayload(operation));
  return await withWallet(recovery.profile, async (identity, secret) => {
    assertWallet(identity, operation.walletAddress);
    const effect = secret.directEffects[effectSlot("apn-effect-v1", recovery.profile, recovery.operationId, recovery.fingerprint)];
    if (effect === undefined || effect.payloadHash !== payloadHash || effect.transactionHash !== published.transactionHash ||
        effect.rawTransactionHash !== published.rawTransactionHash || keccak256(effect.rawTransaction) !== effect.transactionHash) {
      throw protocol("Encrypted direct effect differs from its public signed evidence.");
    }
    return publicDirectEffect(effect);
  });
}
