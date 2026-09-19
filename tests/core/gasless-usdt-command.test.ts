import assert from "node:assert/strict";
import test from "node:test";
import { bindArgv } from "../../src/command-binder.js";
import { COMMANDS } from "../../src/command-catalog.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { temporaryState } from "./helpers.js";

const HASH = "a".repeat(64), OP = "b".repeat(64);
test("gasless USDT status/resume bind only an explicit profile hash", () => {
  for (const action of ["status", "resume"] as const) {
    const bound = bindArgv(["gasless", "usdt", action, "--profile-hash", HASH, "--operation", OP]);
    assert.deepEqual(bound.request, { command: `gasless.usdt.${action}`, profileHash: HASH, operationId: OP });
  }
  assert.throws(() => bindArgv(["gasless", "usdt", "status", "--profile-hash", "default", "--operation", OP]), { code: "APN_INVALID_INPUT" });
});

test("gasless USDT status/resume catalog entries are local-read and non-approval", () => {
  for (const action of ["status", "resume"]) {
    const entry = COMMANDS.find(command => command.path.join(" ") === `gasless usdt ${action}`)!;
    assert.equal(entry.effect.class, "local_read"); assert.equal(entry.approval.class, "none");
    assert.equal(entry.options.some(option => option.name === "--profile-hash"), true);
  }
});

test("gasless USDT command cases read the isolated journal and do not create missing state", async t => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  for (const action of ["status", "resume"] as const) {
    const bound = bindArgv(["gasless", "usdt", action, "--profile-hash", HASH, "--operation", OP]);
    const result = await createApnCore(bound, { stateRoot: temporary.root }).execute(bound.request);
    assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_OPERATION_NOT_FOUND");
  }
});
