import assert from "node:assert/strict";
import test from "node:test";
import { bindArgv } from "../../src/command-binder.js";
import { runCli } from "../../src/cli.js";
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

test("Relay execute CLI has no implicit signing or sending runtime", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const result = await runCli(argv, {}, { stateRoot: temporary.root });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
  assert.equal(result.operation, null);
  assert.equal(result.receipt, null);
});
