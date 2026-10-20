import assert from "node:assert/strict";
import test from "node:test";
import { toHex } from "viem";
import { ApnError } from "../../src/errors.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { tokenDomainSeparator } from "../../src/x402-policy.js";
import { x402Asset } from "../../src/x402-network.js";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const NONCE = `0x${"7".repeat(64)}` as const;
const HASH = `0x${"b".repeat(64)}`;
const POLYGON_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as const;

function wired(rpc: HttpsBaseRpc, chain: string, calls: { method: string; params: readonly unknown[] }[], tokenReads: "ok" | "revert" = "ok") {
  const call = async (method: string, params: readonly unknown[]): Promise<unknown> => {
    calls.push({ method, params });
    if (method === "eth_chainId") return chain;
    if (method === "eth_getBlockByNumber") return { number: "0x3039", hash: HASH, timestamp: "0x6a91d200" };
    if (method === "eth_call") {
      if (tokenReads === "revert") throw new ApnError("APN_RPC_PROTOCOL", "RPC batch response envelope is invalid.");
      const { to, data } = params[0] as { to: string; data: string };
      assert.equal(to, POLYGON_USDC);
      // Prepare pins its batch by block hash; a nonce-state proof reads at the proof header's number.
      assert.ok(params[1] === "0x3039" || JSON.stringify(params[1]) === JSON.stringify({ blockHash: HASH, requireCanonical: true }));
      if (data.startsWith("0x70a08231")) return toHex(50000000n, { size: 32 });
      if (data === "0x3644e515") return tokenDomainSeparator("USD Coin", "2", { chainId: 137, token: POLYGON_USDC });
      if (data === "0x313ce567") return toHex(6n, { size: 32 });
      if (data.startsWith("0xe94a0102")) { assert.ok(data.endsWith(NONCE.slice(2))); return toHex(0n, { size: 32 }); }
    }
    throw new Error(`unexpected ${method}`);
  };
  (rpc as unknown as { call: typeof call }).call = call;
  (rpc as unknown as { batchCall: (batch: readonly { method: string; params: readonly unknown[] }[]) => Promise<unknown[]> }).batchCall =
    async (batch) => await Promise.all(batch.map(({ method, params }) => call(method, params)));
  return rpc;
}

test("production x402 RPC bound to a non-released token reads at finalized and proves decimals and EIP-3009 state in one pinned batch", async () => {
  const calls: { method: string; params: readonly unknown[] }[] = [];
  const polygon = wired(new HttpsBaseRpc("https://rpc.example").forX402Network(137, POLYGON_USDC), "0x89", calls);
  assert.equal((await polygon.assertX402Chain(137)).chainId, 137);
  const evidence = await polygon.getX402PrepareEvidence(WALLET, NONCE);
  assert.equal(evidence.queriedTag, "finalized"); assert.deepEqual(evidence.tokenFacts, { decimals: 6, nonceUnused: true });
  assert.equal(evidence.domainSeparator, tokenDomainSeparator("USD Coin", "2", x402Asset(137, POLYGON_USDC)));
  assert.deepEqual(calls.filter((call) => call.method === "eth_getBlockByNumber").map((call) => call.params[0]), ["finalized"]);
  assert.equal(calls.filter((call) => call.method === "eth_call").length, 4);
  await polygon.getX402AuthorizationState(WALLET, NONCE, { tag: "finalized" });
  await assert.rejects(polygon.getX402PrepareEvidence(WALLET), { code: "APN_INTERNAL" });
});

test("a token that does not answer the EIP-3009 reads, or an RPC of another chain, is refused by name", async () => {
  const reverted = wired(new HttpsBaseRpc("https://rpc.example").forX402Network(137, POLYGON_USDC), "0x89", [], "revert");
  await assert.rejects(reverted.getX402PrepareEvidence(WALLET, NONCE), (error: unknown) =>
    error instanceof ApnError && error.code === "APN_X402_UNSUPPORTED_OFFER" && error.details?.reason === "x402_token_reads_failed" &&
    error.details?.chain === "eip155:137");
  const wrongChain = wired(new HttpsBaseRpc("https://rpc.example").forX402Network(137, POLYGON_USDC), "0x2105", []);
  await assert.rejects(wrongChain.assertX402Chain(137), (error: unknown) =>
    error instanceof ApnError && error.code === "APN_CHAIN_MISMATCH" && error.details?.chain === "eip155:137");
});
