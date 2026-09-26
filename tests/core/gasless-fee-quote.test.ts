import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { bindMcpInput } from "../../src/command-binder.js";
import { parseArgv } from "../../src/cli.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

test("Ethereum local quote shows the exact production fee and cap result without creating money state", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 1);
  s.rpc.current = { ...s.rpc.current,
    feeConfiguration: { ...s.rpc.current.feeConfiguration, nativeTokenPrice: "1000000000" } };
  const request = { ...s.request, grossAtomic: "5000", maxFeeAtomic: "4000", minReceivedAtomic: "1000" };
  const before = await s.core.gasless.records.listAllOperations();
  const filesBefore = (await readdir(temporary.root, { recursive: true })).sort();
  const first = await s.core.execute({ command: "gasless.transfer.quote", profile: s.profile, owner: s.account.address, request });
  assert.equal(first.ok, true, first.error?.message);
  const data = first.data as { quote_atomic: string; fee_cap_atomic: string; status: string;
    prepared_recipient_atomic: string; quote_net_atomic: string; gross_atomic: string; block: unknown;
    policy_checked: boolean; usage_checked: boolean; prepare_admitted: string };
  assert.equal(data.fee_cap_atomic, "4000");
  assert.equal(data.gross_atomic, "5000");
  assert.ok(BigInt(data.quote_atomic) < 4000n);
  assert.equal(data.status, "within_fee_cap");
  assert.equal(data.prepared_recipient_atomic, "1000");
  assert.equal(data.quote_net_atomic, (5000n - BigInt(data.quote_atomic)).toString());
  assert.ok(BigInt(data.quote_net_atomic) > BigInt(data.prepared_recipient_atomic));
  assert.deepEqual(data.block, s.rpc.current.block);
  assert.equal(data.policy_checked, false);
  assert.equal(data.usage_checked, false);
  assert.equal(data.prepare_admitted, "unknown");
  assert.deepEqual(s.rpc.calls, ["snapshot"]);
  assert.deepEqual(await s.core.gasless.records.listAllOperations(), before);
  assert.equal(s.wrapping.loads, 0);
  assert.equal(s.approval.calls.length, 0);
  assert.equal(s.rpc.sends.length, 0);
  assert.deepEqual((await readdir(temporary.root, { recursive: true })).sort(), filesBefore);

  s.rpc.current = { ...s.rpc.current,
    feeConfiguration: { ...s.rpc.current.feeConfiguration, nativeTokenPrice: "5000000000" } };
  const second = await s.core.execute({ command: "gasless.transfer.quote", profile: s.profile, owner: s.account.address, request });
  assert.equal(second.ok, true, second.error?.message);
  assert.equal((second.data as { status: string }).status, "fee_exceeds_cap");
  assert.ok(BigInt((second.data as { quote_atomic: string }).quote_atomic) > 4000n);
  assert.deepEqual(await s.core.gasless.records.listAllOperations(), before);
  assert.deepEqual((await readdir(temporary.root, { recursive: true })).sort(), filesBefore);
});

test("invalid Circle calibration is reported as a configuration stage, not an economic cap failure", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 1);
  s.rpc.current = { ...s.rpc.current,
    feeConfiguration: { ...s.rpc.current.feeConfiguration, additionalGasCharge: "200001" } };
  const result = await s.core.execute({ command: "gasless.transfer.quote", profile: s.profile, owner: s.account.address, request: s.request });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "APN_PROVIDER_PROTOCOL");
  assert.equal(result.error?.details?.stage, "fee_calibration");
  assert.deepEqual(await s.core.gasless.records.listAllOperations(), []);
  assert.deepEqual(s.rpc.calls, ["snapshot"]);
});

test("CLI and MCP bind the same explicit Ethereum RPC quote input", () => {
  const tool = projectMcpTools().find(entry => entry.name === "apn_gasless_transfer_quote");
  assert.ok(tool);
  const input = { profile: "gasless-local", chain: "1", owner: "0x5555555555555555555555555555555555555555", to: "0x4444444444444444444444444444444444444444",
    amount: "0.005", max_fee: "0.004", min_received: "0.001", rpc_url: "https://ethereum-rpc.example" };
  const cli = parseArgv(["gasless", "transfer", "quote", "--profile", input.profile, "--chain", input.chain, "--owner", input.owner,
    "--to", input.to, "--amount", input.amount, "--max-fee", input.max_fee,
    "--min-received", input.min_received, "--rpc-url", input.rpc_url]);
  assert.deepEqual(bindMcpInput(tool.command, input), cli);
  assert.equal(cli.rpcUrl, input.rpc_url);
  assert.equal((cli.request as { request: { grossAtomic: string } }).request.grossAtomic, "5000");
  const capped = parseArgv(["gasless", "transfer", "quote", "--profile", input.profile, "--chain", input.chain,
    "--owner", input.owner, "--to", input.to, "--amount", input.amount, "--max-fee", input.max_fee,
    "--min-received", input.min_received, "--rpc-url", input.rpc_url, "--rpc-max-batch-items", "3"]);
  assert.equal((capped.request as { rpcMaxBatchItems: number }).rpcMaxBatchItems, 3);
  assert.deepEqual(bindMcpInput(tool.command, { ...input, rpc_max_batch_items: "3" }), capped);
  assert.throws(() => parseArgv(["gasless", "transfer", "quote", "--profile", input.profile, "--chain", input.chain,
    "--owner", input.owner, "--to", input.to, "--amount", input.amount, "--max-fee", input.max_fee,
    "--min-received", input.min_received, "--rpc-url", input.rpc_url, "--rpc-max-batch-items", "1"]),
  { code: "APN_INVALID_INPUT" });
});

test("compiled dist CLI quote with a nonexistent state root performs one snapshot and leaves the root absent", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const s = await gaslessFixture(temporary.root, 1);
  const absent = join(temporary.root, "absent-state");
  const { runCli: runBuiltCli } = await import(pathToFileURL(join(process.cwd(), "dist", "cli.js")).href) as typeof import("../../src/cli.js");
  const result = await runBuiltCli(["gasless", "transfer", "quote", "--profile", s.profile, "--chain", "1",
    "--owner", s.account.address, "--to", s.request.recipient, "--amount", "0.005", "--max-fee", "0.004",
    "--min-received", "0.001", "--rpc-url", "https://ethereum-rpc.example", "--rpc-max-batch-items", "3"], process.env,
    { stateRoot: absent, gasless: s.dependencies });
  assert.equal(result.ok, true, result.error?.message);
  assert.deepEqual(s.rpc.calls, ["snapshot"]);
  await assert.rejects(stat(absent), { code: "ENOENT" });
});
