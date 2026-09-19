import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getAddress } from "viem";
import { canonicalJson, hashObject } from "../../src/canonical.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { prepareUsdtOperation, refuseUsdtApproval, refuseUsdtDispatch, refuseUsdtRecovery, refuseUsdtSigner,
  resumeUsdtOperation, statusUsdtOperation, UsdtOperationRepository, validateUsdtOperation } from "../../src/gasless-usdt/operation.js";

const PROFILE = "a".repeat(64), POLICY = "b".repeat(64);
const SENDER = getAddress("0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7");
const RECIPIENT = getAddress("0x000000000000000000000000000000000000dEaD");
const THIRD = getAddress("0x000000000000000000000000000000000000BeEf");
const NOW = 1_700_000_000;

async function fixture(t: { after: (callback: () => Promise<void>) => void }): Promise<{ root: string; repo: UsdtOperationRepository }> {
  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-usdt-operation-"));
  t.after(async () => await rm(root, { recursive: true, force: true }));
  return { root, repo: new UsdtOperationRepository(root) };
}

function input(overrides: Partial<Parameters<typeof prepareUsdtOperation>[1]> = {}): Parameters<typeof prepareUsdtOperation>[1] {
  return { profileHash: PROFILE, policyDigest: POLICY, sender: SENDER, recipient: RECIPIENT, grossAtomic: 1_000_000n,
    maxFeeAtomic: 500_000n, minReceivedAtomic: 500_000n, nonce: 7n, expiresAt: NOW + 900, now: NOW, ...overrides };
}

async function prepared(t: { after: (callback: () => Promise<void>) => void }): Promise<{ root: string; repo: UsdtOperationRepository; operation: Awaited<ReturnType<typeof prepareUsdtOperation>> }> {
  const f = await fixture(t), operation = await prepareUsdtOperation(f.repo, input(), "operation-001");
  return { ...f, operation };
}

test("USDT operation journal persists exact schema, bindings, and private modes", async t => {
  const { repo, operation } = await prepared(t);
  const path = join(repo.directory, PROFILE, `${operation.operationId}.json`);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), operation);
  assert.equal((await lstat(repo.root)).mode & 0o777, 0o700);
  assert.equal((await lstat(repo.directory)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(repo.directory, PROFILE))).mode & 0o777, 0o700);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.equal(operation.schemaVersion, "apn.gasless-usdt-operation.v1");
  assert.equal(operation.chainId, 1);
  assert.equal(operation.token, USDT_GASLESS.token);
  assert.equal(operation.signerBoundary, "unavailable");
  assert.equal(operation.dispatch, "disabled");
  assert.equal(operation.recovery, "read_only");
});

test("replay is idempotent only for the complete operation binding", async t => {
  const { repo, operation } = await prepared(t);
  assert.equal((await prepareUsdtOperation(repo, input({ now: NOW + 1 }), "operation-001")).operationId, operation.operationId);
  for (const [field, value] of [
    ["profileHash", "c".repeat(64)], ["policyDigest", "d".repeat(64)], ["sender", THIRD], ["recipient", THIRD],
    ["grossAtomic", 1_000_001n], ["maxFeeAtomic", 499_999n], ["minReceivedAtomic", 499_999n], ["nonce", 8n], ["expiresAt", NOW + 901],
  ] as const) {
    await assert.rejects(() => prepareUsdtOperation(repo, input({ [field]: value } as never), "operation-001"), { code: "APN_IDEMPOTENCY_CONFLICT" }, field);
  }
});

test("same-repository concurrent preparation creates one record and one operation identity", async t => {
  const { repo, operation } = await prepared(t);
  await rm(join(repo.directory, PROFILE, `${operation.operationId}.json`));
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => prepareUsdtOperation(repo, input({ now: NOW + index }), "race-001")));
  assert.equal(new Set(results.map(result => result.operationId)).size, 1);
  assert.equal((await readdir(join(repo.directory, PROFILE))).length, 1);
});

test("status and resume are read only and do not create missing state", async t => {
  const { root, repo, operation } = await prepared(t);
  const path = join(repo.directory, PROFILE, `${operation.operationId}.json`), before = await readFile(path, "utf8");
  assert.equal((await statusUsdtOperation(repo, PROFILE, operation.operationId)).integrityHash, operation.integrityHash);
  assert.equal((await resumeUsdtOperation(repo, PROFILE, operation.operationId)).integrityHash, operation.integrityHash);
  assert.equal(await readFile(path, "utf8"), before);
  const missingRoot = join(root, "missing");
  const missing = new UsdtOperationRepository(missingRoot);
  await assert.rejects(() => statusUsdtOperation(missing, PROFILE, operation.operationId), { code: "APN_OPERATION_NOT_FOUND" });
  await assert.rejects(() => lstat(missingRoot), { code: "ENOENT" });
});

test("validator rejects runtime prototype, bigint, canonicality, timestamp, and exact-key violations", async t => {
  const { operation } = await prepared(t);
  const inherited = Object.assign(Object.create({ inherited: true }), operation);
  assert.throws(() => validateUsdtOperation(inherited), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateUsdtOperation({ ...operation, grossAtomic: 1n }), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateUsdtOperation({ ...operation, unexpected: true }), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateUsdtOperation({ ...operation, sender: operation.sender.toLowerCase() }), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateUsdtOperation({ ...operation, createdAt: "not-an-iso" }), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateUsdtOperation({ ...operation, expiresAt: 0 }), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateUsdtOperation({ ...operation, idempotencyHash: "0".repeat(64) }), { code: "APN_STATE_CORRUPT" });
});

test("load classifies malformed JSON, path substitution, traversal, symlinks, and mode drift", async t => {
  const { root, repo, operation } = await prepared(t);
  const path = join(repo.directory, PROFILE, `${operation.operationId}.json`);
  await writeFile(path, "{ malformed", { encoding: "utf8" });
  await assert.rejects(() => repo.load(PROFILE, operation.operationId), { code: "APN_STATE_CORRUPT" });
  await writeFile(path, `${canonicalJson(operation)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o644);
  await assert.rejects(() => repo.load(PROFILE, operation.operationId), { code: "APN_STATE_SECURITY" });
  await chmod(path, 0o600);
  await assert.rejects(() => repo.load("../" + PROFILE, operation.operationId), { code: "APN_STATE_SECURITY" });
  await assert.rejects(() => repo.load(PROFILE, "../../outside"), { code: "APN_STATE_SECURITY" });
  const target = join(root, "target.json");
  await writeFile(target, `${canonicalJson(operation)}\n`, { mode: 0o600 });
  await rm(path); await symlink(target, path);
  await assert.rejects(() => repo.load(PROFILE, operation.operationId), { code: "APN_STATE_SECURITY" });
});

test("directory inventory rejects profile and operation substitutions and duplicate idempotency", async t => {
  const f = await fixture(t), first = await prepareUsdtOperation(f.repo, input(), "duplicate-001");
  const secondRoot = await mkdtemp(join(await realpath(tmpdir()), "apn-usdt-operation-copy-"));
  t.after(async () => await rm(secondRoot, { recursive: true, force: true }));
  const second = await prepareUsdtOperation(new UsdtOperationRepository(secondRoot), input({ profileHash: "c".repeat(64) }), "duplicate-001");
  await mkdir(join(f.repo.directory, "c".repeat(64)), { recursive: true, mode: 0o700 });
  await writeFile(join(f.repo.directory, "c".repeat(64), `${second.operationId}.json`), JSON.stringify(second), { mode: 0o600 });
  await assert.rejects(() => f.repo.findIdempotency(first.idempotencyHash), { code: "APN_STATE_CORRUPT" });
  await writeFile(join(f.repo.directory, "junk"), "bad", { mode: 0o600 });
  await assert.rejects(() => f.repo.findIdempotency("0".repeat(64)), { code: "APN_STATE_CORRUPT" });
});

test("signer, dispatch, recovery, approval, and execute remain explicit refusals", () => {
  for (const action of [refuseUsdtSigner, refuseUsdtDispatch, refuseUsdtRecovery]) {
    assert.throws(action, { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  }
  assert.throws(() => refuseUsdtApproval("approve"), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.throws(() => refuseUsdtApproval("execute"), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
});

test("integrity and identity are independently checked", async t => {
  const { repo, operation } = await prepared(t);
  const path = join(repo.directory, PROFILE, `${operation.operationId}.json`);
  const body = { ...operation, maxFeeAtomic: "499999" };
  await writeFile(path, `${canonicalJson({ ...body, integrityHash: hashObject(body) })}\n`, { mode: 0o600 });
  await assert.rejects(() => repo.load(PROFILE, operation.operationId), { code: "APN_STATE_CORRUPT" });
});
