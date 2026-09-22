import { UniswapTokenEffectJournal } from "./token-effects.js";
import { UniswapTokenNonceStore } from "./token-nonce.js";
import { UniswapTokenJournal } from "./token-operation.js";
import type { TokenEffectKind } from "./token-execution.js";

/** Reconciles token reservations against durable operation/effect markers before another local EVM lane chooses a nonce. */
export async function occupiedUniswapTokenNonces(root: string, account: string): Promise<readonly bigint[]> {
  const operations = new UniswapTokenJournal(root), effects = new UniswapTokenEffectJournal(root), store = new UniswapTokenNonceStore(root);
  const durable = async (operationId: string, kind: TokenEffectKind) => {
    const operation = await operations.load(operationId); if (operation === null) return false;
    const attempt = kind === "approval" ? operation.approvalAttempt : kind === "swap" ? operation.swapAttempt : operation.cleanupAttempt;
    return attempt?.transactionHash != null || await effects.load(operation, kind) !== null;
  };
  return await store.occupied(account, durable);
}

export async function uniswapTokenNonceOwned(root: string, account: string, nonce: string): Promise<boolean> {
  return (await occupiedUniswapTokenNonces(root, account)).some((owned) => owned === BigInt(nonce));
}
