import { BNB_TOKEN_NONCE_SPACE, UniswapTokenLaneNonceStore, UniswapTokenNonceStore } from "./token-nonce.js";
/** Read-only view: every durable token reservation excludes the nonce from other local EVM lanes. */
export async function occupiedUniswapTokenNonces(root, account) {
    return await new UniswapTokenNonceStore(root).occupied(account);
}
export async function uniswapTokenNonceOwned(root, account, nonce) {
    return (await occupiedUniswapTokenNonces(root, account)).some((owned) => owned === BigInt(nonce));
}
/** The BNB Smart Chain token lane's reservations, which exclude their nonces from other local chain-56 lanes. */
export async function occupiedBnbUniswapTokenNonces(root, account) {
    return await new UniswapTokenLaneNonceStore(root, BNB_TOKEN_NONCE_SPACE).occupied(account);
}
export async function bnbUniswapTokenNonceOwned(root, account, nonce) {
    return (await occupiedBnbUniswapTokenNonces(root, account)).some((owned) => owned === BigInt(nonce));
}
//# sourceMappingURL=token-nonce-ownership.js.map