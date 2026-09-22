export function publicWalletIdentity(identity) {
    return { profile: identity.profile, address: identity.address, createdAt: identity.createdAt, bindingHash: identity.bindingHash };
}
export function publicDirectEffect(effect) {
    return { transactionHash: effect.transactionHash, rawTransaction: effect.rawTransaction, rawTransactionHash: effect.rawTransactionHash };
}
export function publicX402Effect(effect) {
    return { authorization: effect.authorization, signature: effect.signature, signatureHash: effect.signatureHash };
}
//# sourceMappingURL=local-wallet-native-public.js.map