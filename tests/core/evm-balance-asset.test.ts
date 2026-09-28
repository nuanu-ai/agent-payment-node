import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { bindArgv } from "../../src/command-binder.js";
import { EVM_COMMANDS } from "../../src/evm-command-catalog.js";
import { DIRECT_EVM_NETWORKS } from "../../src/evm-direct-networks.js";
import { evmWalletBalance } from "../../src/evm-wallet-balance.js";
import type { RuntimeContext } from "../../src/runtime.js";
import { EVM_TOKEN, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState, WALLET } from "./helpers.js";

const RPC = "https://rpc.example";

test("balance-asset binds native and ERC-20 reads for every direct EVM network", () => {
  const balance = EVM_COMMANDS.find((command) => command.path.join(" ") === "wallet balance-asset");
  const chain = balance?.options.find((option) => option.name === "--chain");
  assert.deepEqual(chain?.constraints.slice(1), DIRECT_EVM_NETWORKS.map((network) => network.caip2));

  for (const network of DIRECT_EVM_NETWORKS) {
    const native = bindArgv(["wallet", "balance-asset", "--profile", "default", "--chain", network.caip2,
      "--asset", "native", "--rpc-url", RPC]);
    assert.equal(native.request.command, "wallet.balance");
    assert.deepEqual(native.request.asset, { chainId: network.chainId, token: "native" });

    const token = bindArgv(["wallet", "balance-asset", "--profile", "default", "--chain", network.caip2,
      "--asset", EVM_TOKEN, "--decimals", "6", "--rpc-url", RPC]);
    assert.equal(token.request.command, "wallet.balance");
    assert.deepEqual(token.request.asset, { chainId: network.chainId, token: EVM_TOKEN, decimals: 6 });
  }
});

test("balance-asset refuses an unsupported EVM chain before any RPC or payment path", () => {
  assert.throws(() => bindArgv(["wallet", "balance-asset", "--profile", "default", "--chain", "eip155:42170",
    "--asset", "native", "--rpc-url", RPC]), { code: "APN_INVALID_INPUT" });
});

test("core balance reads remain chain verified and read-only for all 11 direct EVM networks", async (context) => {
  const temporary = await temporaryState();
  context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  await ensureDirectWallet(setup);
  const keyLoads = setup.wrapping.loads;

  for (const network of DIRECT_EVM_NETWORKS) {
    setup.rpc.chainId = network.chainId;
    for (const token of ["native", EVM_TOKEN] as const) {
      const result = await setup.core.execute({ command: "wallet.balance", profile: "default", asset: { chainId: network.chainId, token } });
      assert.equal(result.ok, true, JSON.stringify(result));
      if (!result.ok) continue;
      const data = result.data as { readonly chain: string; readonly asset: { readonly chain: string; readonly kind: string };
        readonly native_gas_balance: { readonly symbol: string }; readonly funding_guidance: { readonly action: string } };
      assert.equal(data.chain, network.caip2);
      assert.equal(data.asset.chain, network.caip2);
      assert.equal(data.asset.kind, token === "native" ? "native" : "erc20");
      assert.equal(data.native_gas_balance.symbol, network.nativeSymbol);
      assert.match(data.funding_guidance.action, new RegExp(`native ${network.nativeSymbol} for gas\\.`));
    }
  }
  assert.equal(setup.rpc.broadcastCount, 0);
  assert.equal(setup.wrapping.loads, keyLoads);
});

test("native Sei balance bounds a contended profile lock and never starts a late POST", async () => {
  let posts = 0, lockWaitMs = 0;
  const context = {
    ready: async () => {},
    state: {
      lockWaitMs: 5_000,
      profileHash: () => "profile-hash",
      withLocks: async (_keys: readonly string[], action: () => Promise<unknown>, options: { waitMs: number }) => {
        lockWaitMs = options.waitMs;
        await new Promise(resolve => setTimeout(resolve, 120));
        return await action();
      },
      loadWallet: async () => ({ address: WALLET }),
    },
    requireRpc: () => ({ seiNativeBalance: async () => { posts += 1; throw new Error("late POST"); } }),
  } as unknown as RuntimeContext;
  const started = performance.now();
  await assert.rejects(evmWalletBalance(context, "default", { chainId: 1329, token: "native" }, 40),
    { code: "APN_RPC_AMBIGUOUS" });
  assert.ok(performance.now() - started < 100);
  assert.ok(lockWaitMs > 0 && lockWaitMs <= 40);
  await new Promise(resolve => setTimeout(resolve, 140));
  assert.equal(posts, 0);
});

test("native Sei balance deadline also covers runtime readiness", async () => {
  let locks = 0, posts = 0;
  const context = {
    ready: async () => { await new Promise(resolve => setTimeout(resolve, 120)); },
    state: {
      lockWaitMs: 5_000,
      profileHash: () => "profile-hash",
      withLocks: async () => { locks += 1; throw new Error("late lock"); },
    },
    requireRpc: () => ({ seiNativeBalance: async () => { posts += 1; throw new Error("late POST"); } }),
  } as unknown as RuntimeContext;
  const started = performance.now();
  await assert.rejects(evmWalletBalance(context, "default", { chainId: 1329, token: "native" }, 40),
    { code: "APN_RPC_AMBIGUOUS" });
  assert.ok(performance.now() - started < 100);
  await new Promise(resolve => setTimeout(resolve, 140));
  assert.equal(locks, 0);
  assert.equal(posts, 0);
});
