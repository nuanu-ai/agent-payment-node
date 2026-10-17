import assert from "node:assert/strict";
import test from "node:test";
import { bindArgv } from "../../src/command-binder.js";
import { EVM_COMMANDS } from "../../src/evm-command-catalog.js";
import { DIRECT_EVM_NETWORKS } from "../../src/evm-direct-networks.js";
import { EVM_TOKEN, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

const RPC = "https://rpc.example";

test("wallet balance binds native and ERC-20 reads for every direct EVM network", () => {
  const balance = EVM_COMMANDS.find((command) => command.path.join(" ") === "wallet balance");
  const chain = balance?.options.find((option) => option.name === "--chain");
  assert.deepEqual(chain?.constraints.slice(1, -1), DIRECT_EVM_NETWORKS.map((network) => network.caip2));
  assert.equal(chain?.required, false);

  for (const network of DIRECT_EVM_NETWORKS) {
    const native = bindArgv(["wallet", "balance", "--profile", "default", "--chain", network.caip2,
      "--asset", "native", "--rpc-url", RPC]);
    assert.equal(native.request.command, "wallet.balance");
    assert.deepEqual(native.request.asset, { chainId: network.chainId, token: "native" });

    const token = bindArgv(["wallet", "balance", "--profile", "default", "--chain", network.caip2,
      "--asset", EVM_TOKEN, "--decimals", "6", "--rpc-url", RPC]);
    assert.equal(token.request.command, "wallet.balance");
    assert.deepEqual(token.request.asset, { chainId: network.chainId, token: EVM_TOKEN, decimals: 6 });
  }
});

test("wallet balance selects one asset with --chain and --asset together, or the Base pair with neither", () => {
  assert.deepEqual(bindArgv(["wallet", "balance", "--profile", "default", "--rpc-url", RPC]).request, { command: "wallet.balance", profile: "default" });
  for (const partial of [["--chain", "eip155:8453"], ["--asset", "native"], ["--decimals", "6"]]) {
    assert.throws(() => bindArgv(["wallet", "balance", "--profile", "default", ...partial, "--rpc-url", RPC]), { code: "APN_INVALID_INPUT" });
  }
  assert.throws(() => bindArgv(["wallet", "balance", "--rpc-url", RPC]), { code: "APN_INVALID_INPUT" }, "--profile is required");
  assert.throws(() => bindArgv(["wallet", "balance-asset", "--profile", "default", "--chain", "eip155:8453", "--asset", "native", "--rpc-url", RPC]),
    (error: Error) => /apn wallet balance --profile <profile> --chain <caip2> --asset/u.test(error.message));
});

test("wallet balance refuses an unsupported EVM chain before any RPC or payment path", () => {
  assert.throws(() => bindArgv(["wallet", "balance", "--profile", "default", "--chain", "eip155:42170",
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
      assert.match(data.funding_guidance.action, new RegExp(`native ${network.nativeSymbol} on ${network.caip2} for gas manually with a small amount only`));
    }
  }
  assert.equal(setup.rpc.broadcastCount, 0);
  assert.equal(setup.wrapping.loads, keyLoads);
});

