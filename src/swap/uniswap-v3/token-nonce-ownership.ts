import { UniswapTokenNonceStore } from "./token-nonce.js";

/** Read-only view: every durable token reservation excludes the nonce from other local EVM lanes. */
export async function occupiedUniswapTokenNonces(root: string, account: string): Promise<readonly bigint[]> {
  return await new UniswapTokenNonceStore(root).occupied(account);
}

export async function uniswapTokenNonceOwned(root: string, account: string, nonce: string): Promise<boolean> {
  return (await occupiedUniswapTokenNonces(root, account)).some((owned) => owned === BigInt(nonce));
}
