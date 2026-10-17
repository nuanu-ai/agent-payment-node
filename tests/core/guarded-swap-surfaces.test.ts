import assert from "node:assert/strict";
import { lstat } from "node:fs/promises";
import test from "node:test";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { COMMANDS } from "../../src/command-catalog.js";
import { ApnCore } from "../../src/core.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { MCP_FOREGROUND_HANDOFF, MCP_TOOLS } from "../../src/mcp-projection.js";
import { StateStore } from "../../src/state.js";
import {
  JUPITER_V6_PROGRAM, SOLANA_MAINNET_GENESIS, SOLANA_USDC_MINT, SUNSWAP_PIN_CATALOG,
  SUNSWAP_USDT, SUNSWAP_V2_ROUTER, WRAPPED_SOL_MINT,
} from "../../src/swap/index.js";
import { temporaryState } from "./helpers.js";

const H = (letter: string): string => letter.repeat(64);
const TRON_OWNER = "TVjuTE3V5bMVdpfNhid8kD2v35T2k1u1Br";
const TRON_RECIPIENT = "TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9";
const SOLANA_OWNER = WRAPPED_SOL_MINT;

const FAMILIES = [
  { path: "swap ethereum uniswap", command: "swap.uniswap", cleanup: false },
  { path: "swap ethereum uniswap-token", command: "swap.uniswap-token", cleanup: true },
  { path: "swap tron sunswap", command: "swap.sunswap", cleanup: false },
  { path: "swap solana jupiter", command: "swap.jupiter", cleanup: false },
  { path: "swap solana orca", command: "swap.orca", cleanup: false, stableReads: true },
] as const;
const ACTIONS = ["inventory", "quote", "prepare", "status", "approve", "execute"] as const;
const STABLE_ACTIONS = ["stable-status", "stable-release", "stable-recover-no-send", "stable-observe"] as const;

test("guarded swap families expose six parity actions plus explicit token cleanup", () => {
  const catalog = COMMANDS.filter((row) => row.path[0] === "swap");
  assert.deepEqual(catalog.map((row) => row.path.join(" ")), FAMILIES.flatMap((family) =>
    [...("stableReads" in family ? STABLE_ACTIONS : []), ...ACTIONS, ...(family.cleanup ? ["cleanup"] : [])]
      .map((action) => `${family.path} ${action}`)));
  const tools = MCP_TOOLS.filter((row) => row.command.path[0] === "swap");
  const foreground = MCP_FOREGROUND_HANDOFF.commands.filter((row) => row.path[0] === "swap");
  assert.equal(tools.length, 23); assert.equal(foreground.length, 12);
  assert.equal(MCP_TOOLS.some((row) => row.name === "apn_swap_solana_orca_stable_recover_no_send"), false);
  assert.equal(foreground.some((row) => row.path.join(" ") === "swap solana orca stable-recover-no-send"), true);
  assert.equal(bindArgv(["swap", "solana", "orca", "stable-observe", "--operation", H("a")]).request.command,
    "swap.orca.stable-observe");
  // SWAP-10: the stable creation commands are gone; an old invocation names its keyless replacement.
  for (const action of ["stable-inventory", "stable-quote", "stable-prepare", "stable-approve", "stable-execute"]) {
    assert.throws(() => bindArgv(["swap", "solana", "orca", action, "--operation", H("a")]), /swap solana orca/u);
  }
  assert.deepEqual([...tools.map((row) => row.command), ...foreground].sort((a, b) => catalog.indexOf(a) - catalog.indexOf(b)), catalog);
  for (const command of catalog) {
    const tool = tools.find((row) => row.command.path.join(" ") === command.path.join(" "));
    const fields = command.options.map((option) => option.name.slice(2).replaceAll("-", "_"));
    if (tool === undefined) assert.equal(command.approval.class, "foreground_tty");
    else { assert.deepEqual(Object.keys(tool.inputSchema.properties), fields); assert.deepEqual(tool.inputSchema.required, fields); }
    const input = Object.fromEntries(command.options.map((option) => [option.name.slice(2).replaceAll("-", "_"), sample(option.name, command.path[1]!) ]));
    assert.deepEqual(bindMcpInput(command, input), bindArgv([...command.path, ...command.options.flatMap((option) => [option.name, String(input[option.name.slice(2).replaceAll("-", "_")])]) ]));
  }
});

test("chain binders reject excess fields, inherited objects, malformed integers, hashes, and identities", () => {
  assert.equal(bindArgv(["swap", "tron", "sunswap", "quote", "--profile", "swap-test", "--account", TRON_OWNER,
    "--to", TRON_RECIPIENT, "--amount", "1000000", "--slippage-bps", "100", "--owner-slippage-cap-bps", "200",
    "--fee-limit-sun", "30000000", "--deadline", "1790000600"]).request.command,
  "swap.sunswap.quote");
  assert.equal(bindArgv(["swap", "solana", "jupiter", "quote", "--profile", "swap-test", "--account", SOLANA_OWNER,
    "--to", SOLANA_OWNER, "--amount", "1000000", "--slippage-bps", "100", "--owner-slippage-cap-bps", "200"]).request.command,
  "swap.jupiter.quote");
  for (const argv of [
    ["swap", "tron", "sunswap", "quote", "--profile", "swap-test", "--account", "not-tron", "--to", TRON_RECIPIENT,
      "--amount", "1000000", "--slippage-bps", "100", "--owner-slippage-cap-bps", "200", "--fee-limit-sun", "30000000", "--deadline", "1790000600"],
    ["swap", "tron", "sunswap", "quote", "--profile", "swap-test", "--account", TRON_OWNER, "--to", TRON_RECIPIENT,
      "--amount", "1000000", "--slippage-bps", "100", "--owner-slippage-cap-bps", "200", "--deadline", "1790000600"],
    ["swap", "tron", "sunswap", "quote", "--profile", "swap-test", "--account", TRON_OWNER, "--to", TRON_RECIPIENT,
      "--amount", "1000000", "--slippage-bps", "100", "--owner-slippage-cap-bps", "200", "--fee-limit-sun", "0", "--deadline", "1790000600"],
    ["swap", "tron", "sunswap", "quote", "--profile", "swap-test", "--account", TRON_OWNER, "--to", TRON_RECIPIENT,
      "--amount", "1000000", "--slippage-bps", "100", "--owner-slippage-cap-bps", "200", "--fee-limit-sun", "30000000", "--deadline", "01"],
    ["swap", "solana", "jupiter", "quote", "--profile", "swap-test", "--account", "not-solana", "--to", SOLANA_OWNER,
      "--amount", "1000000", "--slippage-bps", "100", "--owner-slippage-cap-bps", "200"],
    ["swap", "tron", "sunswap", "quote", "--profile", "swap-test", "--account", TRON_OWNER, "--to", TRON_RECIPIENT,
      "--amount", "01", "--slippage-bps", "100", "--owner-slippage-cap-bps", "200", "--fee-limit-sun", "30000000", "--deadline", "1790000600"],
    ["swap", "solana", "jupiter", "quote", "--profile", "swap-test", "--account", SOLANA_OWNER, "--to", SOLANA_OWNER,
      "--amount", "1", "--slippage-bps", "201", "--owner-slippage-cap-bps", "200"],
    ["swap", "tron", "sunswap", "status", "--operation", H("A")],
    ["swap", "solana", "jupiter", "inventory", "--extra", "x"],
  ]) assert.throws(() => bindArgv(argv), { code: "APN_INVALID_INPUT" });
  const inherited = Object.create({ profile: "swap-test" }) as Record<string, unknown>;
  const command = COMMANDS.find((row) => row.path.join(" ") === "swap tron sunswap inventory")!;
  assert.throws(() => bindMcpInput(command, inherited), { code: "APN_INVALID_INPUT" });
});

test("inventories expose frozen chain identities without admission and runtime factory installs no swap dependency", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const uniswap = createApnCore(bindArgv(["swap", "ethereum", "uniswap", "inventory"]), { stateRoot: temporary.root });
  assert.equal(uniswap.context.sunswapRuntime, undefined); assert.equal(uniswap.context.jupiterV1Runtime, undefined);
  const core = new ApnCore({ state: new StateStore(temporary.root) });
  const sun = await core.execute({ command: "swap.sunswap.inventory" });
  assert.equal(sun.ok, true); assert.equal((sun.data as any).ownerAdmission.evaluated, false); assert.equal((sun.data as any).execution, "dormant");
  assert.equal((sun.data as any).catalog.router.address, SUNSWAP_V2_ROUTER); assert.equal((sun.data as any).catalog.usdt.address, SUNSWAP_USDT);
  assert.deepEqual((sun.data as any).catalog, SUNSWAP_PIN_CATALOG);
  const jupiter = await core.execute({ command: "swap.jupiter.inventory" });
  assert.equal(jupiter.ok, true); assert.equal((jupiter.data as any).ownerAdmission.evaluated, false); assert.equal((jupiter.data as any).execution, "dormant");
  assert.equal((jupiter.data as any).catalog.genesis, SOLANA_MAINNET_GENESIS); assert.equal(Object.hasOwn(jupiter.data as object, "v2Quantum"), false);
  assert.equal((jupiter.data as any).catalog.program, JUPITER_V6_PROGRAM); assert.equal((jupiter.data as any).catalog.nativeInput, WRAPPED_SOL_MINT);
  assert.equal((jupiter.data as any).catalog.outputToken, SOLANA_USDC_MINT);
});

test("without the installed keyless runtimes quote and every state-changing surface refuse without side effects", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  // No injectable read-only builder exists any more: the runtime factory installs the keyless runtime per command.
  const core = new ApnCore({ state: new StateStore(temporary.root), clock: { now: () => new Date("2026-09-17T00:00:00.000Z") } });
  const sunQuote = await core.execute({ command: "swap.sunswap.quote", profile: "swap-test", account: TRON_OWNER,
    recipient: TRON_RECIPIENT, amountAtomic: "1000000", slippageBps: 100, ownerSlippageCapBps: 200, feeLimitSun: "30000000", deadline: 1790000600 });
  const jupiterQuote = await core.execute({ command: "swap.jupiter.quote", profile: "swap-test", account: SOLANA_OWNER,
    recipient: SOLANA_OWNER, amountAtomic: "1000000", slippageBps: 100, ownerSlippageCapBps: 200 });
  assert.equal(sunQuote.ok, false); assert.equal(sunQuote.error?.details?.reason, "sunswap_runtime_unavailable");
  assert.equal(jupiterQuote.ok, false); assert.equal(jupiterQuote.error?.details?.reason, "jupiter_runtime_unavailable");
  for (const [command, reason] of [
    ["swap.sunswap.prepare", "sunswap_owner_admission_required"], ["swap.sunswap.approve", "sunswap_native_no_approval"],
    ["swap.sunswap.execute", "sunswap_execution_dormant"], ["swap.jupiter.prepare", "jupiter_runtime_unavailable"],
    ["swap.jupiter.approve", "jupiter_runtime_unavailable"], ["swap.jupiter.execute", "jupiter_runtime_unavailable"],
  ] as const) {
    const request = command.endsWith("prepare") ? { command, profile: "swap-test", quoteHash: H("a"), idempotencyKey: "swap-test-0001" }
      : { command, operationId: H("b") };
    const result = await core.execute(request as never);
    assert.equal(result.ok, false); assert.equal(result.error?.details?.reason, reason);
  }
  for (const result of [sunQuote, jupiterQuote]) assert.equal(result.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  await assert.rejects(lstat(temporary.root), { code: "ENOENT" });
});

test("status performs only a durable read and returns a stable missing-operation classification", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  await assert.rejects(lstat(temporary.root), { code: "ENOENT" });
  const core = new ApnCore({ state: new StateStore(temporary.root) });
  for (const command of ["swap.uniswap.status", "swap.sunswap.status"] as const) {
    const result = await core.execute({ command, operationId: H("c") });
    assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_OPERATION_NOT_FOUND");
  }
  const jupiter = await core.execute({ command: "swap.jupiter.status", operationId: H("c") });
  assert.equal(jupiter.ok, false); assert.equal(jupiter.error?.details?.reason, "jupiter_runtime_unavailable");
  await assert.rejects(lstat(temporary.root), { code: "ENOENT" });
});

function sample(option: string, chain: string): string {
  if (option === "--profile") return "swap-test";
  if (option === "--pool") return "usdc-usdt";
  if (option === "--account" || option === "--to") return chain === "tron" ? TRON_OWNER : chain === "solana" ? SOLANA_OWNER :
    "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
  if (option === "--owner") return SOLANA_OWNER;
  if (option === "--policy-revision") return "7";
  if (option === "--create-usdt-ata") return "false";
  if (option === "--maximum-ata-rent") return "0";
  if (option === "--maximum-total-fee") return "3000000";
  if (option === "--output-token") return "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  if (option === "--source-token") return "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  if (option === "--amount") return "1000000";
  if (option === "--minimum-output") return "999000";
  if (option === "--approval-cap") return "1000000";
  if (option === "--slippage-bps") return "100";
  if (option === "--maximum-price-impact-bps") return "200";
  if (option === "--owner-slippage-cap-bps") return "200";
  if (option === "--deadline") return "1790000600";
  if (option === "--fee-limit-sun") return "30000000";
  if (option === "--compute-unit-limit") return "200000";
  if (option === "--compute-unit-price") return "1000";
  if (option === "--max-gas-limit") return "150000";
  if (option === "--max-approval-gas-limit" || option === "--max-cleanup-gas-limit") return "80000";
  if (option === "--max-swap-gas-limit") return "200000";
  if (option === "--max-fee-per-gas") return "2000000000";
  if (option === "--max-priority-fee-per-gas") return "100000000";
  if (option === "--max-native-debit") return "720000000000000";
  if (option === "--quote") return H("a");
  if (option === "--idempotency-key") return "swap-test-0001";
  if (option === "--operation") return H("b");
  throw new Error(`missing sample for ${option}`);
}
