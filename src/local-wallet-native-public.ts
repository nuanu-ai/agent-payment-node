import type { DirectEffectMaterial, WalletIdentity, X402EffectMaterial } from "./encrypted-wallet-store.js";
import type { Address } from "./model.js";

export function publicWalletIdentity(identity: WalletIdentity): { readonly profile: string; readonly address: Address; readonly createdAt: string; readonly bindingHash: string } {
  return { profile: identity.profile, address: identity.address, createdAt: identity.createdAt, bindingHash: identity.bindingHash };
}
export function publicDirectEffect(effect: DirectEffectMaterial): unknown {
  return { transactionHash: effect.transactionHash, rawTransaction: effect.rawTransaction, rawTransactionHash: effect.rawTransactionHash };
}
export function publicX402Effect(effect: X402EffectMaterial): unknown {
  return { authorization: effect.authorization, signature: effect.signature, signatureHash: effect.signatureHash };
}
