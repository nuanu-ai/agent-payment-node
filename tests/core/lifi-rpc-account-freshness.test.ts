import assert from "node:assert/strict";
import test from "node:test";
import { bridgeRpcFactory, RpcReadSession } from "../../src/lifi/rpc.js";
import type { Address } from "../../src/model.js";

const owner = "0x1111111111111111111111111111111111111111" as Address;
const spender = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE" as Address;
const token = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address;
const quantity = (value: bigint) => `0x${value.toString(16)}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

function accountReader() {
  let now = 1_791_448_600_000, head = 1n, pendingNonce = 75n;
  const blocks = new Map([
    [1n, { nonce: 75n, allowance: 0n, balance: 318124n, native: 894589446115754n, baseFee: 20000000n }],
    [2n, { nonce: 76n, allowance: 100000n, balance: 318124n, native: 892589446115754n, baseFee: 40000000n }],
  ]);
  const header = (number: bigint) => ({ number: quantity(number), hash: word(number),
    timestamp: quantity(1_791_448_600n + number), baseFeePerGas: quantity(blocks.get(number)!.baseFee) });
  type Item = { id: string; method: string; params: unknown[] };
  const result = (item: Item): unknown => {
    if (item.method === "eth_chainId") return "0xa4b1";
    if (item.method === "eth_getBlockByNumber") return header(item.params[0] === "latest" ? head : BigInt(String(item.params[0])));
    if (item.method === "eth_getTransactionCount" && item.params[1] === "pending") return quantity(pendingNonce);
    const at = blocks.get(BigInt(String(item.params[1])))!;
    if (item.method === "eth_getBalance") return quantity(at.native);
    if (item.method === "eth_getTransactionCount") return quantity(at.nonce);
    if (item.method === "eth_call") {
      const data = String((item.params[0] as { data: string }).data);
      if (data.startsWith("0x70a08231")) return word(at.balance);
      if (data.startsWith("0xdd62ed3e")) return word(at.allowance);
    }
    throw new Error(`Unreviewed modeled read ${item.method}`);
  };
  const wait = async (milliseconds: number) => { now += milliseconds; };
  const session = new RpcReadSession({ now: () => now, wait, maxReadAttempts: 1 });
  const rpc = bridgeRpcFactory({ APN_ARBITRUM_RPC_URL: "https://arb-primary.example",
    APN_ARBITRUM_ARCHIVE_RPC_URL: "https://arb-archive.example" }, { wait, transport: {
      async request(_url, method, body) {
        assert.equal(method, "POST"); const parsed = JSON.parse(body!) as Item | Item[];
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const responses = items.map((item) => ({ jsonrpc: "2.0", id: item.id, result: result(item) }));
        return { status: 200, headers: {}, body: JSON.stringify(Array.isArray(parsed) ? responses : responses[0]) };
      },
    } })(42161, session);
  return { rpc, session, includeApproval() { head = 2n; pendingNonce = 76n; }, pendingApproval() { pendingNonce = 76n; } };
}

test("one bridge invocation rereads the latest account block after an approval is included", async () => {
  const reader = accountReader();
  const first = await reader.rpc.account(owner, spender, token);
  assert.equal(first.latestNonceAtomic, "75"); assert.equal(first.allowanceAtomic, "0");
  reader.includeApproval();
  const current = await reader.rpc.account(owner, spender, token);
  assert.equal(current.block.numberAtomic, "2");
  assert.equal(current.latestNonceAtomic, "76"); assert.equal(current.pendingNonceAtomic, "76");
  assert.equal(current.allowanceAtomic, "100000"); assert.equal(current.nativeBalanceWei, "892589446115754");
  assert.equal((await reader.rpc.prices()).maxFeePerGasAtomic, "80000000");
  assert(reader.session.telemetry().httpRequests <= 4);
});

test("a stable account block still observes a new pending nonce within the same command", async () => {
  const reader = accountReader(); await reader.rpc.account(owner, spender, token);
  reader.pendingApproval(); const current = await reader.rpc.account(owner, spender, token);
  assert.equal(current.block.numberAtomic, "1"); assert.equal(current.latestNonceAtomic, "75");
  assert.equal(current.pendingNonceAtomic, "76"); assert.equal(current.allowanceAtomic, "0");
  assert(reader.session.telemetry().httpRequests <= 4);
});
