import assert from "node:assert/strict";
import test from "node:test";
import { bindArgv } from "../../src/command-binder.js";
import { runCli } from "../../src/cli.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { TtyRelayExecuteConfirmation } from "../../src/tty-approval.js";
import { ApnCore } from "../../src/core.js";
import { StateStore } from "../../src/state.js";
import type { RelayEffectJournal } from "../../src/relay/effect-journal.js";
import { temporaryState } from "./helpers.js";

const operationId = "a".repeat(64);
const argv = ["relay", "execute", "--operation", operationId, "--rpc-url", "https://rpc.example"];

test("Relay execute binds only an exact saved operation identity and explicit Ethereum RPC", () => {
  assert.deepEqual(bindArgv(argv), { request: { command: "relay.execute", operationId }, rpcUrl: "https://rpc.example" });
  for (const invalid of [
    ["relay", "execute", "--operation", operationId],
    ["relay", "execute", "--rpc-url", "https://rpc.example"],
    [...argv, "--profile", "default"],
    [...argv, "--dry-run", "false"],
    [...argv, "--operation", operationId],
    ["relay", "execute", "--operation", "b", "--rpc-url", "https://rpc.example"],
    ["relay", "execute", "--operation", operationId, "--rpc-url", "http://rpc.example"],
  ]) assert.throws(() => bindArgv(invalid), { code: "APN_INVALID_INPUT" });
});

test("Relay execute dispatch fails closed without both source handler and foreground confirmation", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root);
  let executions = 0;
  const relayExecute = { async execute(id: string): Promise<RelayEffectJournal> {
    assert.equal(id, operationId);
    executions++;
    return { schemaVersion: "apn.relay-effect-journal.v1", operationId } as RelayEffectJournal;
  } };
  const relayExecuteConfirmation = async () => true;
  for (const deps of [{}, { relayExecute }, { relayExecuteConfirmation }]) {
    const result = await new ApnCore({ state, ...deps }).execute({ command: "relay.execute", operationId });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
    assert.equal(executions, 0);
  }
  const result = await new ApnCore({ state, relayExecute, relayExecuteConfirmation })
    .execute({ command: "relay.execute", operationId });
  assert.equal(result.ok, true);
  assert.equal(executions, 1);
  assert.equal(result.proof_class, "source_effect_journal");
  assert.equal(result.operation, null);
  assert.equal(result.receipt, null);
  assert.equal((result.data as RelayEffectJournal).operationId, operationId);
});

test("installed Relay execute CLI remains unavailable until the source transport is budgeted", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const result = await runCli(argv, {}, { stateRoot: temporary.root });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  assert.equal(result.operation, null);
  assert.equal(result.receipt, null);
});

test("Relay execute factory dispatches exactly one injected source handler with an explicit confirmation", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let executions = 0;
  const confirmation = async () => true;
  const core = createApnCore(bindArgv(argv), { stateRoot: temporary.root,
    relayExecuteConfirmation: confirmation,
    relayExecute: { execute: async id => {
      assert.equal(id, operationId);
      executions++;
      return { schemaVersion: "apn.relay-effect-journal.v1", operationId } as RelayEffectJournal;
    } },
  });
  assert.equal(core.context.relayExecuteConfirmation, confirmation);
  const result = await core.execute({ command: "relay.execute", operationId });
  assert.equal(result.ok, true);
  assert.equal(result.proof_class, "source_effect_journal");
  assert.equal(executions, 1);
});

test("Relay execute rejects credential-bearing RPC before invoking an injected source handler", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let executions = 0;
  for (const rpcUrl of ["http://rpc.example", "https://rpc.example/private", "https://rpc.example/?key=secret",
    "https://user:pass@rpc.example", "https://rpc.example/#fragment"]) {
    const result = await runCli(["relay", "execute", "--operation", operationId, "--rpc-url", rpcUrl], {}, {
      stateRoot: temporary.root, relayExecuteConfirmation: async () => true,
      relayExecute: { execute: async () => { executions++; throw new Error("must not run"); } },
    });
    assert.equal(result.ok, false);
    assert.ok(["APN_INVALID_INPUT", "APN_RPC_CONFIG"].includes(result.error?.code ?? ""));
  }
  assert.equal(executions, 0);
});

test("Relay execute handler is not installed for prepare or status", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const relayExecute = { execute: async () => { throw new Error("must not run"); } };
  for (const command of ["relay.prepare", "relay.status"] as const) {
    const request = command === "relay.status" ? { command, operationId } : {
      command, profile: "default", recipient: "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7",
      amountAtomic: "1", minOutputAtomic: "1", maxApprovalNetworkFeeWei: "1", maxDepositNetworkFeeWei: "1",
      idempotencyKey: "relay-test-0001",
    };
    const core = createApnCore({ request }, { stateRoot: temporary.root, relayExecute });
    assert.equal(core.context.relayExecute, undefined);
    assert.equal(core.context.relayExecuteConfirmation, undefined);
  }
});

test("Relay foreground prompt displays bounded payment terms and hides request identity", async () => {
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
    summary.depositNetworkFeeCeilingWei]) assert.ok(written.includes(expected));
  assert.ok(!written.includes(summary.requestId));
  assert.ok(written.includes(operationId));
  assert.equal(await new TtyRelayExecuteConfirmation({ isTerminal: () => false,
    openTerminal: async () => terminal }).confirm(summary), false);
});
