import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { installGaslessDependencyBoundary } from "../../src/metamask-gasless/client/dependency-boundary.js";
import { executeHelperRequest, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/index.js";
import type { MetaMaskGaslessUnsignedResult } from "../../src/metamask-gasless/model.js";
import { expectedQuote, intent, NOW, OWNER, quoteInput, SdkExchange, syntheticHome } from
  "./metamask-gasless-client-fixtures/sdk.js";

const rejected = /gasless dependency boundary rejected Solana decoder/u;

test("gasless helper rejects ESM and CommonJS Solana decoder loads while allowing EVM SDK", async () => {
  installGaslessDependencyBoundary();
  const require = createRequire(import.meta.url);
  await assert.rejects(import("@solana/spl-token"), rejected);
  await assert.rejects(import("bigint-buffer"), rejected);
  await assert.rejects(import("@metamask/fox-sdk/wallets/solana"), rejected);
  assert.throws(() => require("@solana/buffer-layout-utils"), rejected);
  assert.throws(() => require("bigint-buffer"), rejected);
  assert.throws(() => require("@solana/spl-token"), rejected);
  const evm = await import("@metamask/fox-sdk/wallets/evm");
  assert.equal(typeof evm.prepareDelegation, "function");
});

test("all five supported EVM helper modes run with the decoder boundary installed", async (t) => {
  installGaslessDependencyBoundary();
  const home = await syntheticHome(); t.after(home.cleanup);
  const options = { homeDirectory: home.home, now: () => NOW };
  const inspected = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "inspect",
    expected: { profile: "fixture", profileHash: "e".repeat(64), address: home.binding.address,
      accountBindingHash: home.binding.accountBindingHash, capabilityHash: home.binding.capabilityHash,
      revision: home.binding.revision } }, options);
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  const quoted = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote",
    input: quoteInput(home.binding, 8453) }, { ...options, exchange: new SdkExchange(8453) });
  assert.equal(quoted.ok, true, JSON.stringify(quoted));
  const built = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned",
    input: { owner: OWNER, chainId: 8453, executions: expectedQuote(8453).executions } }, options);
  assert.equal(built.ok, true, JSON.stringify(built));
  if (!built.ok) return;
  const operation = intent(home.binding, 8453, expectedQuote(8453), built.result as MetaMaskGaslessUnsignedResult);
  for (const mode of ["submit", "observe"] as const) {
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode, intent: operation },
      { ...options, exchange: new SdkExchange(8453) });
    assert.equal(result.ok, true, `${mode}: ${JSON.stringify(result)}`);
  }
});

test("a rejected decoder load returns a closed helper failure", async (t) => {
  installGaslessDependencyBoundary();
  const home = await syntheticHome(); t.after(home.cleanup);
  let attempts = 0;
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote",
    input: quoteInput(home.binding, 8453) }, { homeDirectory: home.home, now: () => NOW,
    exchange: { async request() { attempts += 1; await import("@solana/spl-token"); throw new Error("unreachable"); } } });
  assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: false,
    failure: { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" } });
  assert.ok(attempts >= 1 && attempts <= 3);
});
