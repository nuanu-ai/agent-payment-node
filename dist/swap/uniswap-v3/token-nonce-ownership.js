import { UniswapTokenNonceStore } from "./token-nonce.js";
/** Read-only view: every durable token reservation excludes the nonce from other local EVM lanes. */
export async function occupiedUniswapTokenNonces(root, account) {
    return await new UniswapTokenNonceStore(root).occupied(account);
}
export async function uniswapTokenNonceOwned(root, account, nonce) {
    return (await occupiedUniswapTokenNonces(root, account)).some((owned) => owned === BigInt(nonce));
}
//# sourceMappingURL=token-nonce-ownership.js.map