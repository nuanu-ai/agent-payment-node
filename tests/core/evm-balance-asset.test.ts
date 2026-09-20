import assert from "node:assert/strict";
import test from "node:test";
import { bindArgv } from "../../src/command-binder.js";
import { EVM_COMMANDS } from "../../src/evm-command-catalog.js";
import { DIRECT_EVM_NETWORKS } from "../../src/evm-direct-networks.js";
import { EVM_TOKEN, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

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

  for (const network of DIRECT_EVM_NETWORKS) {
    setup.rpc.chainId = network.chainId;
    for (const token of ["native", EVM_TOKEN] as const) {
      const result = await setup.core.execute({ command: "wallet.balance", profile: "default", asset: { chainId: network.chainId, token } });
      assert.equal(result.ok, true, JSON.stringify(result));
      if (!result.ok) continue;
      const data = result.data as { readonly chain: string; readonly asset: { readonly chain: string; readonly kind: string } };
      assert.equal(data.chain, network.caip2);
      assert.equal(data.asset.chain, network.caip2);
      assert.equal(data.asset.kind, token === "native" ? "native" : "erc20");
    }
  }
  assert.equal(setup.rpc.broadcastCount, 0);
});
