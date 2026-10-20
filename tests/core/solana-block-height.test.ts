/**
 * DEVELOPER-STATES-0.5.51 item 9: PublicNode answers a scalar getBlockHeight with the slot and the same call inside a
 * JSON-RPC array with the height. APN asks the height only as an array, and the reads that prove a blockhash expired
 * also check it against the latest blockhash read in the same request: an answer above that blockhash's
 * lastValidBlockHeight is refused with its numbers, never corrected and never answered by another endpoint.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readSolanaBlockHeight, SolanaRpc, solanaBlockHeightValue, type SolanaBatchRead } from "../../src/solana/rpc.js";
import { proveSolanaUnlanded } from "../../src/swap/unlanded.js";

const HEIGHT = 380_000_000n, SLOT = 402_000_000n, BLOCKHASH = "11111111111111111111111111111111";
/** PublicNode's observed behaviour: the slot for a scalar getBlockHeight, the height for the same call in an array. */
function publicNode() {
  const shapes: string[] = [], hosts: string[] = [];
  const fetcher = (async (url: URL | string, init?: RequestInit) => {
    hosts.push(new URL(String(url)).host);
    const body = JSON.parse(String(init?.body)) as { id: string; method: string; params: unknown[] } | { id: string; method: string; params: unknown[] }[];
    const answer = (q: { id: string; method: string }, batched: boolean) => ({ jsonrpc: "2.0", id: q.id,
      result: q.method === "getBlockHeight" ? Number(batched ? HEIGHT : SLOT) : q.method === "getLatestBlockhash"
        ? { context: { slot: Number(SLOT) }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: Number(HEIGHT + 150n) } }
        : q.method === "getSignatureStatuses" ? { context: { slot: Number(SLOT) }, value: [null] } : null });
    shapes.push(Array.isArray(body) ? `array:${body.map(q => q.method).join(",")}` : `scalar:${body.method}`);
    const result = Array.isArray(body) ? body.map(q => answer(q, true)) : answer(body, false);
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { rpc: new SolanaRpc("https://solana-rpc.publicnode.com", fetcher), shapes, hosts };
}

test("a height is always asked as a JSON-RPC array, so PublicNode answers the height, never the slot", async () => {
  const node = publicNode();
  assert.equal(await node.rpc.call("getBlockHeight", [{ commitment: "confirmed" }]), HEIGHT);
  // Beside account reads PublicNode gets one request per read; the height one is still an array.
  const [height] = await node.rpc.batch([{ method: "getBlockHeight", params: [{ commitment: "confirmed" }] },
    { method: "getAccountInfo", params: [BLOCKHASH, { encoding: "base64" }] }]);
  assert.equal(height, HEIGHT);
  assert.deepEqual(node.shapes, ["array:getBlockHeight", "array:getBlockHeight", "scalar:getAccountInfo"]);
  assert.equal(await readSolanaBlockHeight(node.rpc, "finalized"), HEIGHT);
  assert.equal(node.shapes.at(-1), "array:getBlockHeight,getLatestBlockhash");
  assert.deepEqual([...new Set(node.hosts)], ["solana-rpc.publicnode.com"], "no other endpoint is ever asked");
});

test("a still-valid blockhash on PublicNode is never proven expired: the slot no longer reaches the proof", async () => {
  const node = publicNode();
  assert.equal(await proveSolanaUnlanded(node.rpc, { lastValidBlockHeight: (HEIGHT + 100n).toString(), loadSignature: async () => null }), null);
  const proof = await proveSolanaUnlanded(node.rpc, { lastValidBlockHeight: (HEIGHT - 1n).toString(), loadSignature: async () => null });
  assert.deepEqual(proof, { network: "solana", transactionId: null, lastValidBlockHeight: (HEIGHT - 1n).toString(), observedFinalizedBlockHeight: HEIGHT.toString() });
});

test("a height above its own latest blockhash's lastValidBlockHeight is refused with both numbers, never corrected", async () => {
  const latest = { context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 380_000_150n } };
  assert.equal(solanaBlockHeightValue(380_000_150n, latest), 380_000_150n);
  assert.throws(() => solanaBlockHeightValue(SLOT, latest), (error: unknown) => {
    const failure = error as { code: string; message: string; details: Record<string, unknown> };
    assert.equal(failure.code, "APN_RPC_PROTOCOL");
    assert.match(failure.message, /answered getBlockHeight with 402000000, above the lastValidBlockHeight 380000150 of its own latest blockhash/u);
    assert.deepEqual([failure.details.reason, failure.details.observedBlockHeight, failure.details.lastValidBlockHeight],
      ["solana_block_height_inconsistent", "402000000", "380000150"]);
    assert.equal((failure.details.nextActions as readonly string[]).length, 1);
    return true;
  });
  // A port that answers the slot even in a batch cannot prove an expiry: the proof is refused, not given.
  const slotted = { originHash: "x", call: async () => assert.fail("batched"), batch: async (reads: readonly SolanaBatchRead[]) =>
    reads.map(read => read.method === "getBlockHeight" ? SLOT : latest) };
  await assert.rejects(proveSolanaUnlanded(slotted, { lastValidBlockHeight: "380000100", loadSignature: async () => null }),
    { code: "APN_RPC_PROTOCOL" });
});
