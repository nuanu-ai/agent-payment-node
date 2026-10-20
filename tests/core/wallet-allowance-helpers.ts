import type { Hex } from "viem";
import { canonicalJson, domainHash, sha256 } from "../../src/canonical.js";
import type { FinalizedReadCall, PublicFinalizedRead } from "../../src/evm-finalized-proof.js";
import type { WalletAllowanceRpc } from "../../src/wallet-allowance/chain.js";
import { newWalletAllowanceRevoke } from "../../src/wallet-allowance/model.js";
import { WalletAllowanceRevokeRepository } from "../../src/wallet-allowance/repository.js";
import type { movingNode } from "./uniswap-token-qa0552-harness.js";

type Call = { readonly method: string; readonly params: readonly unknown[] };
/** The fake node's transport as the family's chain port and as a finalized reader: one POST per batch, one per send (no POST cap, no cooldown). */
export function allowanceRpc(chain: ReturnType<typeof movingNode>, posts: string[] = []): WalletAllowanceRpc & PublicFinalizedRead {
  let id = 0;
  const post = async (body: unknown) => JSON.parse((await chain.request("https://rpc.example", "POST", JSON.stringify(body))).body) as unknown;
  const batch = async (calls: readonly Call[]) => {
    posts.push(calls.map((call) => call.method).join(","));
    const rows = calls.map((call) => ({ jsonrpc: "2.0", id: ++id, method: call.method, params: call.params }));
    const answers = await post(rows) as readonly { readonly id: number; readonly result: unknown }[];
    return rows.map((row) => answers.find((answer) => answer.id === row.id)!.result);
  };
  return { batch: async (calls: readonly (Call | FinalizedReadCall)[]) => await batch(calls), call: async (method: string, params: readonly unknown[]) => (await batch([{ method, params }]))[0],
    send: async (raw: Hex) => { posts.push("send"); return ((await post({ jsonrpc: "2.0", id: ++id, method: "eth_sendRawTransaction", params: [raw] })) as { result: Hex }).result; },
    checkSend: async () => undefined };
}

/** A prepared revoke written straight to its store, for the generic operation commands. */
export async function preparedRevokeRecord(root: string): Promise<string> {
  const records = new WalletAllowanceRevokeRepository(root), profileHash = records.profileHash("default"), now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const operationId = domainHash("apn.wallet-allowance-revoke.operation-id.v1", canonicalJson({ slot: "generic-0001", preparedAt: now.toISOString() }));
  await records.ready();
  await records.withLocks([`operation:${operationId}`], async () => await records.persistLocked(newWalletAllowanceRevoke({ operationId, profile: "default", profileHash,
    idempotencyHash: sha256("revoke-idempotency"), requestHash: sha256("revoke-request"), terms: { chainId: 1, proofTag: "safe", rpcSetting: "APN_ETHEREUM_RPC_URL",
      token: "0xdAC17F958D2ee523a2206206994597C13D831ec7", owner: "0x1111111111111111111111111111111111111111",
      spender: "0xE592427A0AEce92De3Edee1F18E0157C05861564", priorAllowanceAtomic: "10000", nonce: "7", gasLimit: "60000", maxFeePerGasWei: "2000000000",
      maxPriorityFeePerGasWei: "1000000", maxNativeDebitWei: "120000000000000", era: { number: "1000", hash: `0x${"a".repeat(64)}` },
      preparedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 240_000).toISOString() } })));
  return operationId;
}
