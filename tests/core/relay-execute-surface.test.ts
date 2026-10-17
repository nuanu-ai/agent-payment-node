import assert from "node:assert/strict";
import test from "node:test";
import { bindArgv } from "../../src/command-binder.js";
import { approvalCode } from "../../src/approval-code.js";
import { runCli } from "../../src/cli.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { TtyRelayExecuteConfirmation } from "../../src/tty-approval.js";
import { ApnCore } from "../../src/core.js";
import { StateStore } from "../../src/state.js";
import type { RelayEffectJournal } from "../../src/relay/effect-journal.js";
import { temporaryState } from "./helpers.js";

const operationId = "a".repeat(64);
const argv = ["relay", "execute", "--profile", "alice", "--operation", operationId, "--rpc-url", "https://rpc.example"];

test("Relay execute binds an explicit profile, an exact saved operation identity and explicit Ethereum RPC", () => {
  assert.deepEqual(bindArgv(argv), { request: { command: "relay.route", action: "execute", profile: "alice", operationId }, rpcUrl: "https://rpc.example" });
  for (const invalid of [
    ["relay", "execute", "--operation", operationId, "--rpc-url", "https://rpc.example"],
    ["relay", "execute", "--profile", "alice", "--operation", operationId],
    ["relay", "execute", "--profile", "alice", "--rpc-url", "https://rpc.example"],
    [...argv, "--profile", "default"],
    [...argv, "--dry-run", "false"],
    [...argv, "--operation", operationId],
    ["relay", "execute", "--operation", "b", "--rpc-url", "https://rpc.example"],
    ["relay", "execute", "--operation", operationId, "--rpc-url", "http://rpc.example"],
  ]) assert.throws(() => bindArgv(invalid), { code: "APN_INVALID_INPUT" });
});

test("relay prepare picks the route from source chain, asset and destination chain and binds its exact v1 request", () => {
  const common = ["--profile", "alice", "--recipient", "0x1111111111111111111111111111111111111111", "--amount-atomic", "1000",
    "--min-output-atomic", "900", "--max-deposit-network-fee-wei", "50", "--idempotency-key", "relay-route-0001"];
  const fields = { profile: "alice", recipient: "0x1111111111111111111111111111111111111111", amountAtomic: "1000", minOutputAtomic: "900",
    maxDepositNetworkFeeWei: "50", idempotencyKey: "relay-route-0001" };
  const route = (source: string, asset: string, destination: string, ...extra: string[]) =>
    bindArgv(["relay", "prepare", "--source-chain", source, "--asset", asset, "--destination-chain", destination, ...common, ...extra]).request;
  assert.deepEqual(route("eip155:1", "usdc", "eip155:56", "--max-approval-network-fee-wei", "60"),
    { command: "relay.prepare", ...fields, maxApprovalNetworkFeeWei: "60" });
  assert.deepEqual(route("eip155:1", "usdc", "eip155:8453", "--max-approval-network-fee-wei", "60"),
    { command: "relay.base.prepare", ...fields, maxApprovalNetworkFeeWei: "60" });
  for (const [source, destination] of [["eip155:56", "eip155:137"], ["eip155:56", "eip155:143"], ["eip155:8453", "eip155:4326"], ["eip155:8453", "eip155:137"]]) {
    assert.deepEqual(route(source!, "native", destination!), { command: "relay.native.prepare", ...fields, sourceChain: source, destinationChain: destination });
  }
  assert.deepEqual(route("eip155:42161", "usdc", "eip155:1", "--max-approval-network-fee-wei", "60", "--payer", "0x2222222222222222222222222222222222222222",
    "--max-provider-fee-atomic", "70", "--quote-file", "/absolute/quote.json"), { command: "relay.arbitrum.prepare", ...fields,
    maxApprovalNetworkFeeWei: "60", owner: "0x2222222222222222222222222222222222222222", maxProviderFeeAtomic: "70", quoteFile: "/absolute/quote.json" });
  // Unknown routes and route-only options that do not belong to the route are refused; none is silently ignored.
  for (const [source, asset, destination, ...extra] of [["eip155:1", "native", "eip155:56"], ["eip155:56", "usdc", "eip155:137"],
    ["eip155:56", "native", "eip155:4326"], ["eip155:1", "usdc", "eip155:137", "--max-approval-network-fee-wei", "60"],
    ["eip155:1", "usdc", "eip155:56"], ["eip155:56", "native", "eip155:137", "--max-approval-network-fee-wei", "60"],
    ["eip155:1", "usdc", "eip155:56", "--max-approval-network-fee-wei", "60", "--quote-file", "/absolute/quote.json"],
    ["eip155:42161", "usdc", "eip155:1", "--max-approval-network-fee-wei", "60"]] as const) {
    assert.throws(() => route(source, asset, destination, ...extra), { code: "APN_INVALID_INPUT" }, `${source} ${asset} ${destination} ${extra.join(" ")}`);
  }
});

test("removed v1 Relay commands fail with their merged replacement", async () => {
  for (const [old, replacement] of [[["relay", "native", "execute"], "apn relay execute "], [["relay", "arbitrum", "deposit-dispatch"], "apn relay execute "],
    [["relay", "base", "observe"], "apn relay observe "], [["relay", "arbitrum", "prepare"], "apn relay prepare "], [["relay", "preflight"], "apn relay execute "]] as const) {
    const result = await runCli([...old, "--profile", "alice", "--operation", operationId], {});
    assert.equal(result.error?.code, "APN_UNSUPPORTED_COMMAND");
    assert.ok(result.next_actions[0]?.startsWith(replacement), result.next_actions[0]);
  }
});

test("Relay execute dispatch fails closed without both source handler and foreground confirmation", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  let executions = 0;
  const relayExecute = { async execute(profile: string, id: string): Promise<RelayEffectJournal> {
    assert.equal(profile, "alice"); assert.equal(id, operationId);
    executions++;
    return { schemaVersion: "apn.relay-effect-journal.v1", operationId } as RelayEffectJournal;
  } };
  const relayExecuteConfirmation = async () => true;
  for (const deps of [{}, { relayExecute }, { relayExecuteConfirmation }]) {
    const result = await new ApnCore({ state, ...deps }).execute({ command: "relay.execute", profile: "alice", operationId });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
    assert.equal(executions, 0);
  }
  const result = await new ApnCore({ state, relayExecute, relayExecuteConfirmation })
    .execute({ command: "relay.execute", profile: "alice", operationId });
  assert.equal(result.ok, true);
  assert.equal(executions, 1);
  assert.equal(result.proof_class, "source_effect_journal");
  assert.equal(result.operation, null);
  assert.equal(result.receipt, null);
  assert.equal((result.data as RelayEffectJournal).operationId, operationId);
});

test("Relay execute CLI refuses an operation that was not prepared", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const result = await runCli(argv, {}, { stateRoot: temporary.root });
  assert.equal(result.ok, false);
  assert.equal(result.command, "relay.execute");
  assert.equal(result.error?.code, "APN_OPERATION_NOT_FOUND");
  assert.equal(result.operation, null);
  assert.equal(result.receipt, null);
});

test("Relay execute CLI rejects credential-bearing RPC before source execution", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let starts = 0;
  const transport = { batchCall: async () => { starts++; return []; },
    submitRawTransaction: async () => { starts++; return `0x${"a".repeat(64)}` as const; } };
  for (const rpcUrl of ["https://rpc.example/private", "https://rpc.example/?key=secret",
    "https://user:pass@rpc.example", "https://rpc.example/#fragment"]) {
    const result = await runCli(["relay", "execute", "--profile", "alice", "--operation", operationId, "--rpc-url", rpcUrl], {},
      { stateRoot: temporary.root, relayExecuteTransport: transport });
    assert.equal(result.ok, false);
    // Credentials and fragments fail in the catalog parser; a signed path or query is refused by the route runtime
    // (keyless origin only) once the saved route is known, here the operation does not exist. Nothing reaches an RPC.
    assert.ok(["APN_INVALID_INPUT", "APN_RPC_CONFIG", "APN_OPERATION_NOT_FOUND"].includes(result.error?.code ?? ""));
  }
  assert.equal(starts, 0);
});

test("Relay status and retire do not install the source execution runtime", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let starts = 0;
  const transport = { batchCall: async () => { starts++; return []; },
    submitRawTransaction: async () => { starts++; return `0x${"a".repeat(64)}` as const; } };
  for (const args of [["relay", "status", "--profile", "alice", "--operation", operationId],
    ["relay", "retire", "--profile", "alice", "--operation", operationId]]) {
    const core = createApnCore(bindArgv(args), { stateRoot: temporary.root, relayExecuteTransport: transport });
    assert.equal(core.context.relayExecute, undefined);
    assert.equal(core.context.relayExecuteConfirmation, undefined);
  }
  assert.equal(starts, 0);
});

test("Relay foreground prompt shows payment terms, hides request ID, and fails closed", async () => {
  let written = "";
  const summary = { operationId, sourceChainId: 1 as const, destinationChainId: 56 as const,
    sourceAccount: "0x1111111111111111111111111111111111111111",
    sourceToken: "0x2222222222222222222222222222222222222222", amountAtomic: "2500000",
    recipient: "0x3333333333333333333333333333333333333333", minOutputAtomic: "3000000000000000",
    deadline: new Date(Date.now() + 120_000).toISOString(), requestId: "secret-request-id",
    quoteDigest: "b".repeat(64), approvalNetworkFeeCeilingWei: "1000", depositNetworkFeeCeilingWei: "2000" };
  const terminal = { fd: 0, write: async (value: string) => { written += value; },
    read: async function* () { yield Buffer.from("decline\n"); }, close: async () => {} };
  const confirmation = new TtyRelayExecuteConfirmation({ isTerminal: () => true, openTerminal: async () => terminal });
  assert.equal(await confirmation.confirm(summary), false);
  for (const expected of ["Ethereum", "BNB Chain", summary.sourceToken, summary.amountAtomic,
    summary.recipient, summary.minOutputAtomic, summary.deadline, summary.approvalNetworkFeeCeilingWei,
    summary.depositNetworkFeeCeilingWei, operationId]) assert.ok(written.includes(expected));
  assert.ok(!written.includes(summary.requestId));
  assert.equal(await new TtyRelayExecuteConfirmation({ isTerminal: () => false,
    openTerminal: async () => terminal }).confirm(summary), false);
  const accepted = { ...terminal, read: async function* () {
    yield Buffer.from(`${approvalCode("bridge", summary.operationId, summary.quoteDigest)}\n`);
  } };
  assert.equal(await new TtyRelayExecuteConfirmation({ isTerminal: () => true,
    openTerminal: async () => accepted }).confirm(summary), true);
});
