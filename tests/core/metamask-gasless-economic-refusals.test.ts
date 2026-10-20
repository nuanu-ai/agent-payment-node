import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import { temporaryState } from "./helpers.js";
import { MM_TEST_RECIPIENT, mmFixture } from "./metamask-gasless-helpers.js";

/**
 * A quoted relay fee above the owner's cap, and a USDC balance that only falls short at APN's own chain snapshot after
 * the quote, are economic refusals stated with both numbers: never "could not advance safely", never a protocol fault.
 */
type Amounts = Readonly<Record<string, string>>;
async function surfaces(t: TestContext) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await mmFixture(temporary.root, 1);
  const options: McpRuntimeOptions = { stateRoot: temporary.root, metaMaskGasless: f.dependencies, clock: f.clock };
  const connection = await connectMcp(options); t.after(connection.close);
  /** The same prepare through the CLI and MCP; both answers must be the same envelope. */
  const prepare = async (amounts: Amounts, key: string) => {
    const cli = await runCli(["gasless", "transfer", "prepare", "--profile", f.profile, "--chain", "1", "--to", MM_TEST_RECIPIENT,
      ...Object.entries(amounts).flatMap(([flag, value]) => [`--${flag}`, value]), "--idempotency-key", key], {}, options);
    const mcp = decode(await connection.client.callTool({ name: "apn_gasless_transfer_prepare", arguments: { profile: f.profile, chain: "1",
      to: MM_TEST_RECIPIENT, ...Object.fromEntries(Object.entries(amounts).map(([flag, value]) => [flag.replaceAll("-", "_"), value])),
      idempotency_key: key } }));
    assert.deepEqual({ ...mcp, request_id: null }, { ...cli, request_id: null });
    return cli;
  };
  const nothingWritten = async () => {
    assert.equal((await f.core.metaMaskGasless.records.listAllOperations()).length, 0);
    assert.equal(f.provider.submissions.length, 0); assert.equal(f.approval.calls.length, 0);
  };
  return { f, prepare, nothingWritten };
}
const GROSS = { amount: "10", "max-fee": "0.05", "min-received": "9.95" } as const;

test("a quoted fee above the owner's cap names fee, cap, network and the option that set it, in CLI and MCP alike", async t => {
  const cases: ReadonlyArray<readonly [string, Amounts, string, string, string]> = [
    ["gross", GROSS, "50000 USDC atoms (0.05 USDC) set by --max-fee",
      "--max-fee of at least 0.06 and --amount minus --min-received of at least 0.06", "--max-fee"],
    ["gross room", { amount: "10", "max-fee": "0.09", "min-received": "9.95" }, "50000 USDC atoms (0.05 USDC) set by --amount minus --min-received",
      "--max-fee of at least 0.06 and --amount minus --min-received of at least 0.06", "--amount minus --min-received"],
    ["fixed net", { "net-amount-atomic": "1000", "max-gross-atomic": "100000", "max-fee-atomic": "50000" },
      "50000 USDC atoms (0.05 USDC) set by --max-fee-atomic", "--max-fee-atomic of at least 60000 and --max-gross-atomic of at least 61000", "--max-fee-atomic"],
    ["fixed gross", { "net-amount-atomic": "1000", "max-gross-atomic": "50000", "max-fee-atomic": "99000" },
      "49000 USDC atoms (0.049 USDC) set by --max-gross-atomic minus --net-amount-atomic",
      "--max-fee-atomic of at least 60000 and --max-gross-atomic of at least 61000", "--max-gross-atomic minus --net-amount-atomic"],
  ];
  for (const [name, amounts, cap, raise, option] of cases) await t.test(name, async t => {
    const { f, prepare, nothingWritten } = await surfaces(t);
    f.provider.fees = ["60000"];
    const refused = await prepare(amounts, `mm-fee-cap-${name.replace(" ", "-")}`);
    assert.equal(refused.ok, false); assert.equal(refused.operation, null);
    assert.equal(refused.error?.code, "APN_FEE_BUDGET_EXCEEDED");
    assert.equal(refused.error?.message, "MetaMask quoted a USDC relay fee of 60000 USDC atoms (0.06 USDC) for this transfer on Ethereum " +
      `(chain 1), above the owner's fee cap of ${cap}.`);
    assert.deepEqual([refused.error?.details?.reason, refused.error?.details?.fee_atomic, refused.error?.details?.fee_cap_option],
      ["mm_gasless_fee_cap", "60000", option]);
    assert.deepEqual(refused.next_actions, ["No operation was written and nothing was sent. Only if the owner accepts a relay fee of 60000 " +
      `USDC atoms (0.06 USDC), rerun the same prepare with ${raise}; the fee is quoted again then.`]);
    await nothingWritten();
  });
  // The owner accepts the fee: the same prepare with a cap that covers it is written once.
  const { f, prepare } = await surfaces(t);
  f.provider.fees = ["60000"];
  assert.equal((await prepare(GROSS, "mm-fee-cap-accepted")).ok, false);
  const accepted = await prepare({ amount: "10", "max-fee": "0.06", "min-received": "9.94" }, "mm-fee-cap-accepted");
  assert.equal(accepted.ok, true, JSON.stringify(accepted.error));
  assert.equal((await f.core.metaMaskGasless.records.listAllOperations()).length, 1);
});

test("a USDC shortfall first seen at APN's chain snapshot is APN_INSUFFICIENT_USDC with both numbers, in CLI and MCP alike", async t => {
  const { f, prepare, nothingWritten } = await surfaces(t);
  f.rpc.state = { ...f.rpc.state, usdcBalanceAtomic: "9000000" };
  const refused = await prepare(GROSS, "mm-snapshot-short-01");
  assert.equal(refused.ok, false); assert.equal(refused.operation, null);
  assert.equal(refused.error?.code, "APN_INSUFFICIENT_USDC");
  assert.equal(refused.error?.message, "The MetaMask server wallet on Ethereum (chain 1) holds 9000000 USDC atoms (9 USDC), below the " +
    "10000000 USDC atoms (10 USDC) this transfer plus MetaMask's quoted USDC relay fee needs (APN's own balanceOf read at its safe block 100).");
  assert.deepEqual(refused.error?.details, { reason: "mm_gasless_balance", chain_id: 1, network: "Ethereum", usdc_current_atomic: "9000000",
    usdc_required_atomic: "10000000", usdc_block_tag: "safe", usdc_block_number: "100", nextActions: refused.next_actions });
  assert.deepEqual(refused.next_actions, [`apn gasless balance --profile ${f.profile} --chain 1`,
    "The server wallet's USDC on Ethereum (chain 1) is 1000000 atoms (1 USDC) short of this transfer plus MetaMask's quoted relay fee. " +
    "No operation was written, so the same prepare may run again once it holds at least 10000000 USDC atoms."]);
  assert.equal(f.rpc.calls.includes("snapshot"), true, "the quote passed; the shortfall came from the snapshot");
  await nothingWritten();
  f.rpc.state = { ...f.rpc.state, usdcBalanceAtomic: "10000000" };
  const funded = await prepare(GROSS, "mm-snapshot-short-01");
  assert.equal(funded.ok, true, JSON.stringify(funded.error));
});

test("a USDC shortfall at the approve-time snapshot fails before effect as mm_gasless_balance, not as evidence", async t => {
  const { f } = await surfaces(t);
  const { id } = await f.prepare("mm-approve-short-01");
  f.rpc.state = { ...f.rpc.state, usdcBalanceAtomic: "9000000" };
  await f.core.execute({ command: "gasless.transfer.approve", operationId: id });
  const op = await f.record(id);
  assert.deepEqual([op.state, op.failure, op.submissionAttempts, f.provider.submissions.length],
    ["failed_before_effect", { code: "APN_INSUFFICIENT_USDC", reason: "mm_gasless_balance" }, 0, 0]);
});

async function connectMcp(options: McpRuntimeOptions) {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-metamask-economic-refusal-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
function decode(result: Awaited<ReturnType<Client["callTool"]>>): OutputEnvelope {
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("expected one text MCP result");
  const parsed = JSON.parse(content.text) as OutputEnvelope;
  assert.deepEqual(result.structuredContent, parsed);
  return parsed;
}
