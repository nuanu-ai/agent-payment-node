/**
 * Regression (QA 2026-11-13, 0.5.104): a Base transfer dispatched under one `mm` login project was resumed after a login
 * into another project that holds the same server wallet. APN rightly refused to read the old request with the new
 * session (`mm_gasless_binding_changed`), but the operation then only said "resume", forever. It now says why the request
 * stays unread and how to read it again, and lists the delegation-disable exit, which closes it from the chain alone.
 */
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mmError } from "../../src/metamask-gasless/reasons.js";
import { mmFixture } from "./metamask-gasless-helpers.js";

test("a request held by another login project names its reason, the way back and the disable exit", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "apn-mm-project-")));
  try {
    const f = await mmFixture(root), { id } = await f.prepare();
    f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.status = "awaiting_approval"; f.provider.txHash = null;
    assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
    f.advance(600_000); f.provider.observeError = mmError("mm_gasless_binding_changed");
    const moved = await f.restart().execute({ command: "operation.resume", operationId: id });
    assert.equal(moved.ok, true, JSON.stringify(moved.error));
    const saved = await f.record(id);
    assert.deepEqual([saved.state, saved.terminal, saved.failure?.reason], ["unknown_finality", false, "mm_gasless_binding_changed"]);
    const actions = (moved.operation as { next_actions: string[] }).next_actions;
    assert.match(actions[0]!, /in the mm login project it was sent from/u);
    assert.match(actions[0]!, /sign in to MetaMask the way you did when it was sent/u);
    assert.deepEqual(actions.slice(1), [`apn operation resume --operation ${id}`, `apn gasless transfer revoke --operation ${id}`]);
    // The chain alone closes it once the delegation is disabled; the old request is never read and nothing is sent again.
    f.rpc.phase = "disabled";
    const closed = await f.restart().execute({ command: "operation.resume", operationId: id });
    assert.equal(closed.ok, true, JSON.stringify(closed.error));
    assert.equal((await f.record(id)).state, "revoked_unused");
    assert.equal(f.provider.submissions.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
