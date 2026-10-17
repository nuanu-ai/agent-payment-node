import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { bindArgv } from "../../src/command-binder.js";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { refreshOperationIndex } from "../../src/operation-index/refresh.js";
import { OperationIndexStore } from "../../src/operation-index/store.js";
import { OperationService } from "../../src/operation-service.js";
import { executeBoundCommand } from "../../src/runtime-factory.js";
import { StargateNativeService } from "../../src/stargate-v2/native-runtime.js";
import { StargateTokenService } from "../../src/stargate-v2/token-runtime.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { NoSecret, WP2_FAMILY_RECORDS } from "./operation-commands-families.js";
import { golden, installGolden, mockChain } from "./stargate-legacy-support.js";

/**
 * A command that reads or closes an operation's record refreshes that operation's index entry right away (best effort):
 * an operation that became terminal drops its claims and its `open/` copy at once instead of at the next admission that
 * happens to meet it. The generic exits answer a terminal operation as terminal instead of naming a family command.
 */
const openExists = async (root: string, id: string) => await stat(join(root, "operation-index", "open", `${id}.json`)).then(() => true, () => false);
const entry = async (root: string, id: string) => await new OperationIndexStore(root).entry(id);

test("a Circle approval its own status closed before any effect drops its account and profile at the next command naming it", async (t) => {
  const { root, id } = await WP2_FAMILY_RECORDS.circle_approval(t), path = join(root, "circle-approvals", `${id}.json`);
  assert.deepEqual([(await entry(root, id))?.state, await openExists(root, id)], ["active", true]);
  // What `circle approval status` writes for an approval whose signing crashed before its submission marker.
  const { integrityHash: _old, ...saved } = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const body = { ...saved, phase: "failed_before_effect", failureReason: "no_submission_marker" };
  await writeFile(path, `${canonicalJson({ ...body, integrityHash: hashObject(body) })}\n`, { mode: 0o600 });
  assert.equal((await entry(root, id))?.state, "active", "nothing has refreshed the index yet");

  // The family's own status refuses here (no Base RPC is configured); the refresh runs whatever the command answers.
  const status = await runCli(["operation", "status", "--operation", id], {}, { stateRoot: root, wrappingSecret: new NoSecret() });
  assert.equal(status.error?.code, "APN_RPC_CONFIG", JSON.stringify(status.error));
  assert.deepEqual([(await entry(root, id))?.state, (await entry(root, id))?.claims, await openExists(root, id)], ["terminal", [], false]);
  const abandon = await runCli(["operation", "abandon", "--operation", id], {}, { stateRoot: root, wrappingSecret: new NoSecret() });
  assert.deepEqual([abandon.error?.code, abandon.error?.details?.reason, abandon.error?.details?.state, abandon.next_actions],
    ["APN_OPERATION_BLOCKED", "operation_already_terminal", "failed_before_effect", [`apn operation status --operation ${id}`]]);
  const saved2 = JSON.parse(await readFile(path, "utf8")) as { readonly profileHash: string };
  await new OperationService(new StateStore(root)).assertProfileAvailable(saved2.profileHash);
});

test("operation status that closes an unreleased Stargate record drops its index claims at once; abandon then answers terminal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const token = golden(await installGolden("62-unreleased-stargate-token-v1", temporary.root), "cleanup_required"), id = token.record.operationId;
  const state = new StateStore(temporary.root), wrapping = { load: async () => Buffer.alloc(32) } as never, now = () => Date.now();
  const env = { APN_OPTIMISM_RPC_URL: "https://op.example", APN_ETHEREUM_RPC_URL: "https://eth.example" };
  const run = async (argv: readonly string[]) => await executeBoundCommand(bindArgv([...argv]), { stateRoot: temporary.root, wrappingSecret: wrapping,
    stargateToken: new StargateTokenService(state, wrapping, env, now, () => mockChain(10, 100n).rpc),
    stargateNative: new StargateNativeService(state, wrapping, env, now, () => mockChain(1, 100n).rpc) });
  assert.deepEqual([(await new OperationIndex(state).find(id))?.state, await openExists(temporary.root, id)], ["active", true]);

  const status = await run(["operation", "status", "--operation", id]);
  assert.equal(status.ok, true, JSON.stringify(status.error));
  assert.deepEqual([(await entry(temporary.root, id))?.state, await openExists(temporary.root, id)], ["terminal", false]);
  const abandon = await run(["operation", "abandon", "--operation", id]);
  assert.deepEqual([abandon.error?.details?.reason, abandon.next_actions], ["operation_already_terminal",
    [`apn operation status --operation ${id}`, `apn receipt get --operation ${id}`]]);
});

test("a refresh never fails its command and never re-reads a terminal entry", async (t) => {
  const { root, id } = await WP2_FAMILY_RECORDS.circle_approval(t), index = new OperationIndex(new StateStore(root));
  await refreshOperationIndex("not/an/absolute/root", id);
  await refreshOperationIndex(root, "not-an-operation-id");
  const entryPath = join(root, "operation-index", "entries", `${id}.json`), bytes = await readFile(entryPath, "utf8");
  await writeFile(entryPath, "{", { mode: 0o600 });
  await index.refresh(id);
  await writeFile(entryPath, bytes, { mode: 0o600 });
  // A terminal entry stays terminal even when its record can no longer be read: only an admission re-reads it.
  const path = join(root, "circle-approvals", `${id}.json`), { integrityHash: _old, ...saved } = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const body = { ...saved, phase: "completed" };
  await writeFile(path, `${canonicalJson({ ...body, integrityHash: hashObject(body) })}\n`, { mode: 0o600 });
  await index.refresh(id);
  assert.equal((await entry(root, id))?.state, "terminal");
  await writeFile(path, "{", { mode: 0o600 });
  await index.refresh(id);
  assert.deepEqual([(await entry(root, id))?.state, await openExists(root, id)], ["terminal", false]);
});
