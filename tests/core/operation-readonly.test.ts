import assert from "node:assert/strict";
import { access, chmod, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { GaslessOperationRepository } from "../../src/gasless/operation-repository.js";
import { BridgeOperationRepository } from "../../src/lifi/operation-repository.js";
import { MetaMaskGaslessOperationRepository } from "../../src/metamask-gasless/journal/repository.js";
import { OperationService } from "../../src/operation-service.js";
import { ProviderX402Repository } from "../../src/provider-x402-repository.js";
import { RailOperationRepository } from "../../src/rail-operation-repository.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const PROFILE = "a".repeat(64);
const OPERATION = "b".repeat(64);
const IDEMPOTENCY = "c".repeat(64);

class DirectoryProbe extends SecureStateStore {
  async entries(path: string): Promise<readonly string[]> {
    return (await this.readDirectory(path)).map((entry) => entry.name);
  }
}

function repositories(root: string) {
  const state = new StateStore(root);
  const provider = new ProviderX402Repository(root);
  const rail = new RailOperationRepository(root);
  const bridge = new BridgeOperationRepository(root);
  const gasless = new GaslessOperationRepository(root);
  const metaMask = new MetaMaskGaslessOperationRepository(root);
  return { state, provider, rail, bridge, gasless, metaMask };
}

async function exerciseOperationQueries(root: string): Promise<void> {
  const { state, provider, rail, bridge, gasless, metaMask } = repositories(root);

  assert.equal(await state.loadOperation(PROFILE, OPERATION), null);
  assert.equal(await state.findOperation(OPERATION), null);
  assert.deepEqual(await state.listOperations(PROFILE), []);
  assert.deepEqual(await state.listAllOperations(), []);
  assert.equal(await state.loadX402Operation(PROFILE, OPERATION), null);
  assert.equal(await state.findX402Operation(OPERATION), null);
  assert.deepEqual(await state.listX402Operations(PROFILE), []);
  assert.deepEqual(await state.listAllX402Operations(), []);
  assert.equal(await state.loadX402Result(PROFILE, OPERATION), null);
  assert.equal(await state.loadX402RecoveryResult(PROFILE, OPERATION), null);
  assert.equal(await state.findX402Result(OPERATION), null);
  assert.deepEqual(await state.listX402Results(PROFILE), []);
  assert.equal(await state.loadX402Receipt(PROFILE, OPERATION), null);
  assert.equal(await state.loadX402RecoveryReceipt(PROFILE, OPERATION), null);
  assert.equal(await state.findX402Receipt(OPERATION), null);
  assert.deepEqual(await state.listX402Receipts(PROFILE), []);
  assert.equal(await state.loadReceipt(PROFILE, OPERATION), null);

  for (const repository of [provider, rail, bridge, gasless, metaMask]) {
    assert.equal(await repository.loadOperation(PROFILE, OPERATION), null);
    assert.equal(await repository.findOperation(OPERATION), null);
    assert.deepEqual(await repository.listOperations(PROFILE), []);
    assert.deepEqual(await repository.listAllOperations(), []);
  }
  assert.equal(await provider.loadReceipt(PROFILE, OPERATION), null);
  for (const repository of [rail, bridge, gasless, metaMask]) {
    await assert.rejects(repository.loadReceipt(PROFILE, OPERATION), { code: "APN_OPERATION_NOT_FOUND" });
  }

  const service = new OperationService(state, provider, rail, bridge, gasless, metaMask);
  assert.equal(await service.findIdempotency(IDEMPOTENCY), null);
  assert.equal(await service.resolvePrepare({
    kind: "direct_transfer",
    profileHash: PROFILE,
    operationId: OPERATION,
    idempotencyHash: IDEMPOTENCY,
    requestHash: "d".repeat(64),
  }), null);
  await service.assertProfileAvailable(PROFILE);
  await assert.rejects(service.required(OPERATION), { code: "APN_OPERATION_NOT_FOUND" });
}

async function tree(root: string, relative = ""): Promise<readonly string[]> {
  const output: string[] = [];
  for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(relative, entry.name);
    output.push(`${entry.isDirectory() ? "d" : "f"}:${path}`);
    if (entry.isDirectory()) output.push(...await tree(root, path));
  }
  return output;
}

test("operation queries leave a missing state root absent", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await exerciseOperationQueries(temporary.root);
  await assert.rejects(access(temporary.root), { code: "ENOENT" });
});

test("operation queries do not add namespaces or profile directories", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  await new StateStore(temporary.root).initialize();
  const before = await tree(temporary.root);
  await exerciseOperationQueries(temporary.root);
  assert.deepEqual(await tree(temporary.root), before);
});

test("direct loads validate the root and every existing namespace", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const repos = repositories(temporary.root);
  await repos.state.initialize();
  for (const namespace of ["operations", "x402-operations", "rail-operations", "bridge-operations", "gasless-operations", "metamask-gasless-operations"]) {
    await mkdir(join(temporary.root, namespace, PROFILE), { recursive: true, mode: 0o700 });
    await chmod(join(temporary.root, namespace), 0o700);
    await chmod(join(temporary.root, namespace, PROFILE), 0o700);
  }
  const loads: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    ["operations", () => repos.state.loadOperation(PROFILE, OPERATION)],
    ["x402-operations", () => repos.state.loadX402Operation(PROFILE, OPERATION)],
    ["x402-operations", () => repos.provider.loadOperation(PROFILE, OPERATION)],
    ["rail-operations", () => repos.rail.loadOperation(PROFILE, OPERATION)],
    ["bridge-operations", () => repos.bridge.loadOperation(PROFILE, OPERATION)],
    ["gasless-operations", () => repos.gasless.loadOperation(PROFILE, OPERATION)],
    ["metamask-gasless-operations", () => repos.metaMask.loadOperation(PROFILE, OPERATION)],
  ];

  await chmod(temporary.root, 0o777);
  for (const [, load] of loads) await assert.rejects(load, { code: "APN_STATE_SECURITY" });
  await chmod(temporary.root, 0o700);

  for (const [namespace, load] of loads) {
    await chmod(join(temporary.root, namespace), 0o777);
    await assert.rejects(load, { code: "APN_STATE_SECURITY" });
    await chmod(join(temporary.root, namespace), 0o700);
  }
});

test("protected directory reads reject unsafe targets and paths", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const probe = new DirectoryProbe(temporary.root);
  await probe.initialize();
  const unsafe = join(temporary.root, "unsafe");
  await mkdir(unsafe, { mode: 0o700 });
  await chmod(unsafe, 0o777);
  await assert.rejects(probe.entries("unsafe"), { code: "APN_STATE_SECURITY" });

  await rm(unsafe, { recursive: true });
  const outside = join(temporary.base, "outside");
  await mkdir(outside, { mode: 0o700 });
  await symlink(outside, unsafe);
  await assert.rejects(probe.entries("unsafe"), { code: "APN_STATE_SECURITY" });
  await assert.rejects(probe.entries("../outside"), { code: "APN_STATE_SECURITY" });
  await assert.rejects(probe.entries(outside), { code: "APN_STATE_SECURITY" });

  const realParent = join(temporary.base, "real-parent");
  const aliasParent = join(temporary.base, "alias-parent");
  await mkdir(realParent, { mode: 0o700 });
  await symlink(realParent, aliasParent);
  await assert.rejects(new DirectoryProbe(join(aliasParent, "state")).entries("operations"), {
    code: "APN_STATE_SECURITY",
  });
});
