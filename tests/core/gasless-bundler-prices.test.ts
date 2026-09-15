import assert from "node:assert/strict";
import test from "node:test";
import { gaslessGas } from "../../src/gasless/economics.js";
import { bundlerGasPrices } from "../../src/gasless/rpc-gas-prices.js";
import { bundledGaslessFixture } from "./gasless-fixtures/bundler-transport.js";
import { temporaryState } from "./helpers.js";

const tiers = (fee = 100n, tip = 20n) => Object.fromEntries(["slow", "standard", "fast"].map((name, n) =>
  [name, { maxFeePerGas: `0x${(fee + BigInt(n)).toString(16)}`, maxPriorityFeePerGas: `0x${(tip + BigInt(n)).toString(16)}` }]));

test("gasless quotes cover both bundler fee fields while retaining the frozen snapshot recipe", () => {
  assert.deepEqual(bundlerGasPrices(tiers(), "0xa", "0x1"), {
    baseFeePerGas: "10", maxFeePerGas: "102", maxPriorityFeePerGas: "82" });
  assert.deepEqual(bundlerGasPrices(tiers(), "0x64", "0x64"), {
    baseFeePerGas: "100", maxFeePerGas: "300", maxPriorityFeePerGas: "100" });
});

test("gasless strict bundler batches accept reordered IDs and deny malformed, duplicate and provider-error members", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await bundledGaslessFixture(temporary.root); s.setLimit(100);
  s.setBatchReply(rows => rows.reverse());
  const good = await s.rpc.snapshot(s.account.address), approved = gaslessGas(good);
  assert.equal(good.maxPriorityFeePerGas, "600000");
  const faults: Array<(rows: any[]) => unknown> = [
    rows => rows.slice(1), rows => [...rows, rows[0]], rows => [rows[0], rows[0], rows[2]],
    rows => [{ ...rows[0], id: "unknown" }, ...rows.slice(1)],
    rows => [{ ...rows[0], jsonrpc: "1.0" }, ...rows.slice(1)],
    rows => [{ ...rows[0], extra: true }, ...rows.slice(1)],
    rows => [{ ...rows[0], error: { message: "canary_secret" } }, ...rows.slice(1)],
    rows => [{ jsonrpc: "2.0", id: rows[0].id, error: { message: "canary_secret" } }, ...rows.slice(1)],
    rows => rows[0],
  ];
  for (const fault of faults) {
    s.setBatchReply(fault);
    await assert.rejects(s.rpc.snapshot(s.account.address, approved), (error: any) => {
      assert.match(error.code, /^APN_(RPC_PROTOCOL|PROVIDER_EFFECT_UNAVAILABLE)$/u);
      assert.equal(String(error.message).includes("canary_secret"), false); return true;
    });
  }
  assert.equal(s.calls.some(c => /send|estimate/iu.test(c.method)), false);
});

test("gasless existing offers are never enlarged when current bundler prices exceed either approved field", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await bundledGaslessFixture(temporary.root); s.setLimit(100);
  const original = await s.rpc.snapshot(s.account.address), approved = gaslessGas(original), frozen = structuredClone(approved);
  for (const quote of [tiers(2_600_001n, 200_000n), tiers(2_300_000n, 600_001n)]) {
    s.setFeeQuote(quote);
    await assert.rejects(s.rpc.snapshot(s.account.address, approved), /gasless_bundler_fee_drift/u);
    assert.deepEqual(approved, frozen);
  }
  for (const quote of [null, {}, { ...tiers(), fast: { maxFeePerGas: "0x0", maxPriorityFeePerGas: "0x0" } },
    { ...tiers(), slow: { maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x2" } },
    { ...tiers(), fast: { maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x1" } },
    { ...tiers(), fast: { maxFeePerGas: `0x1${"0".repeat(30)}`, maxPriorityFeePerGas: "0x1" } }]) {
    assert.throws(() => bundlerGasPrices(quote, "0x1", "0x1"));
  }
});
