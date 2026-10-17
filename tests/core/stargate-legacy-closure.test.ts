import assert from "node:assert/strict";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { bindArgv } from "../../src/command-binder.js";
import { ApnError } from "../../src/errors.js";
import { legacyStargateStatus, type LegacyChainRead, type LegacyStargateStatus } from "../../src/legacy/stargate-v2/status.js";
import { namedProfileHash } from "../../src/operation-index/adapters/family-claims.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { OperationService } from "../../src/operation-service.js";
import { failureEnvelope } from "../../src/output.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { StargateNativeService } from "../../src/stargate-v2/native-runtime.js";
import { StargateTokenService } from "../../src/stargate-v2/token-runtime.js";
import { loadLegacyStargateRecord, type LegacyStargateFamily } from "../../src/legacy/stargate-v2/reader.js";
import { entryOf } from "../../src/operation-index/reconcile.js";
import { OperationIndexStore } from "../../src/operation-index/store.js";
import { CHAIN, DIRECTORY, golden, installGolden, mockChain, ownerCopies, seedRecords, TERMINAL_PHASES, type Golden } from "./stargate-legacy-support.js";
import { temporaryState } from "./helpers.js";

/**
 * R4 exit of an open unreleased-schema Stargate record: at the finalized block its signer's nonce is past every nonce it
 * froze and none of its own transactions is pending, so nothing of it can ever land; the closure is written once beside
 * the record (the record and the ledger are untouched) and the operation index re-derives it as terminal, also after a
 * rebuild. No consent: no signature and no money move. Otherwise it stays open and says what it waits for.
 */
const NOW = Date.parse("2026-10-17T12:00:00.000Z"), UUID = "00000000-0000-4000-8000-000000000000";
const wrapping = { load: async () => Buffer.alloc(32) } as never;
const sidecar = (root: string, item: Golden) => join(root, DIRECTORY[item.family], `${item.record.operationId}.legacy-closure.json`);
const exists = async (path: string) => await stat(path).then(() => true, () => false);

/** One open golden record alone in a state root (its siblings would hold the same account). */
async function only(root: string, caseName: Parameters<typeof installGolden>[0], phase: string): Promise<Golden> {
  const records = await installGolden(caseName, root), kept = golden(records, phase);
  for (const item of records) if (item !== kept) await rm(join(root, DIRECTORY[item.family], `${item.record.operationId}.json`));
  return kept;
}
const status = async (root: string, item: Golden, rpc: LegacyChainRead, environment = { APN_OPTIMISM_RPC_URL: "https://op.example", APN_ETHEREUM_RPC_URL: "https://eth.example" }) =>
  (await legacyStargateStatus({ root, family: item.family, operationId: item.record.operationId, environment, now: () => NOW, rpc: () => rpc }))!;

test("nonce past at the finalized block closes the record once; the closure survives an index rebuild and the record is unchanged", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const item = await only(temporary.root, "64-unreleased-stargate-token-v3", "allowance_submitted"), record = item.record;
  const approval = record.approvalTransactionHash as string, recordPath = join(temporary.root, DIRECTORY.stargate_token, `${record.operationId}.json`);
  const bytes = await readFile(recordPath, "utf8"), state = new StateStore(temporary.root), service = new OperationService(state);
  const profileHash = namedProfileHash(record.profile);
  await assert.rejects(service.assertEvmAccountAvailable(profileHash, 10, record.owner), { code: "APN_OPERATION_BLOCKED" });
  const chain = mockChain(10, 9n, { [approval.toLowerCase()]: { hash: approval, blockNumber: "0x10" } });
  const closed: LegacyStargateStatus = await status(temporary.root, item, chain.rpc);
  assert.deepEqual([closed.terminal, closed.terminalReason, closed.proofClass, closed.nextActions], [true, "legacy_closed_nonce_consumed", "chain_verified_public_read", []]);
  assert.deepEqual(chain.calls, ["eth_chainId", "eth_getTransactionCount", "eth_getTransactionByHash"]);
  assert.deepEqual([closed.closure?.chainId, closed.closure?.highestEnvelopeNonceAtomic, closed.closure?.finalizedNonceAtomic, closed.closure?.ownTransactions],
    [10, "8", "9", [{ transactionHash: approval, seen: "included" }]]);
  assert.equal(await exists(sidecar(temporary.root, item)), true);
  assert.equal(await readFile(recordPath, "utf8"), bytes, "the record is never rewritten");
  // The account is free; the index followed the record and its closure.
  await service.assertEvmAccountAvailable(profileHash, 10, record.owner);
  assert.deepEqual([(await new OperationIndex(state).find(record.operationId))?.state, (await new OperationIndex(state).find(record.operationId))?.claims], ["terminal", []]);
  await rm(join(temporary.root, "operation-index"), { recursive: true, force: true });
  await new OperationIndex(state).reconcile();
  assert.equal((await new OperationIndex(state).find(record.operationId))?.state, "terminal", "rm -r operation-index keeps it closed");
  // A second status reads the closure, not the chain.
  const again = await status(temporary.root, item, chain.rpc);
  assert.deepEqual([again.terminal, again.proofClass, chain.calls.length], [true, "durable_public_state", 3]);
});

test("nonce not past: the record stays open, says what it waits for, writes nothing, and keeps its account", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const item = await only(temporary.root, "65-unreleased-stargate-token-v4", "approved"), record = item.record;
  const chain = mockChain(10, 8n), open = await status(temporary.root, item, chain.rpc);
  assert.deepEqual([open.terminal, open.closure, open.nextActions], [false, null, [`apn operation status --operation ${record.operationId}`]]);
  assert.match(open.waitingFor ?? "", /finalized nonce of 0x[0-9a-fA-F]{40} on chain 10 to pass 8 \(it is 8\)/u);
  assert.deepEqual(chain.calls, ["eth_chainId", "eth_getTransactionCount"], "no hash is read while the nonce is not past");
  assert.equal(await exists(sidecar(temporary.root, item)), false);
  await assert.rejects(new OperationService(new StateStore(temporary.root)).assertEvmAccountAvailable(namedProfileHash(record.profile), 10, record.owner),
    { code: "APN_OPERATION_BLOCKED", details: { blockingOperationId: record.operationId, blockingState: "approved", blockingNetwork: "evm:10",
      blockingAccount: record.owner.toLowerCase() } });
});

test("a pending own transaction keeps it open even past the nonce, and an RPC of another chain closes nothing", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const item = await only(temporary.root, "61-unreleased-stargate-native-v1", "unknown_finality"), hash = item.record.transactionHash as string;
  const pending = await status(temporary.root, item, mockChain(1, 8n, { [hash.toLowerCase()]: { hash, blockNumber: null } }).rpc);
  assert.deepEqual([pending.terminal, pending.waitingFor], [false, `own transaction ${hash} to leave the pending pool`]);
  await assert.rejects(status(temporary.root, item, mockChain(10, 8n).rpc), { code: "APN_CHAIN_MISMATCH" });
  assert.equal(await exists(sidecar(temporary.root, item)), false);
  const closed = await status(temporary.root, item, mockChain(1, 8n).rpc);
  assert.deepEqual([closed.terminal, closed.closure?.ownTransactions], [true, [{ transactionHash: hash, seen: "not_found" }]]);
});

test("operation status, operation resume and the family status run the closure; a terminal phase needs no RPC; no RPC setting names it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const tokens = await installGolden("62-unreleased-stargate-token-v1", temporary.root);
  const natives = await installGolden("61-unreleased-stargate-native-v1", temporary.root);
  const token = golden(tokens, "cleanup_required"), cleaned = golden(tokens, "cleaned"), native = golden(natives, "submission_started");
  const optimism = mockChain(10, 100n), ethereum = mockChain(1, 100n), env = { APN_OPTIMISM_RPC_URL: "https://op.example", APN_ETHEREUM_RPC_URL: "https://eth.example" };
  const state = new StateStore(temporary.root);
  const core = (argv: readonly string[], environment: Readonly<Record<string, string>> = env) => createApnCore(bindArgv([...argv]), {
    stateRoot: temporary.root, wrappingSecret: wrapping,
    stargateToken: new StargateTokenService(state, wrapping, environment, () => NOW, () => optimism.rpc),
    stargateNative: new StargateNativeService(state, wrapping, environment, () => NOW, () => ethereum.rpc) });
  const run = async (argv: readonly string[], environment?: Readonly<Record<string, string>>) =>
    await core(argv, environment).execute(bindArgv([...argv]).request);

  const terminal = await run(["stargate", "token", "status", "--operation", cleaned.record.operationId], {});
  assert.equal(terminal.ok, true); assert.deepEqual([(terminal.operation as LegacyStargateStatus).terminalReason, optimism.calls.length], ["phase", 0]);
  const missing = await run(["operation", "status", "--operation", token.record.operationId], {});
  assert.equal(missing.error?.code, "APN_RPC_CONFIG");
  assert.deepEqual(missing.next_actions, ["Set APN_OPTIMISM_RPC_URL to a public HTTPS RPC endpoint of that chain, then rerun the same command."]);

  const generic = await run(["operation", "status", "--operation", token.record.operationId]);
  assert.equal(generic.ok, true, JSON.stringify(generic.error));
  assert.deepEqual([(generic.operation as LegacyStargateStatus).terminal, generic.proof_class, generic.next_actions], [true, "chain_verified_public_read", []]);
  const resumed = await run(["operation", "resume", "--operation", native.record.operationId]);
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error));
  assert.equal((resumed.operation as LegacyStargateStatus).terminalReason, "legacy_closed_nonce_consumed");
  const family = await run(["stargate", "native", "status", "--operation", native.record.operationId]);
  assert.deepEqual([(family.operation as LegacyStargateStatus).terminal, family.proof_class], [true, "durable_public_state"]);
  // Effects stay refused: nothing executes an unreleased-schema record.
  const execute = await run(["stargate", "token", "execute", "--operation", token.record.operationId]);
  assert.deepEqual([execute.ok, execute.error?.code], [false, "APN_STATE_CORRUPT"]);
});

test("a damaged closure file makes the record undecidable (blocking, unreadable), never silently terminal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const item = await only(temporary.root, "63-unreleased-stargate-token-v2", "unknown_finality"), record = item.record;
  const hash = record.transactionHash as string, closed = await status(temporary.root, item, mockChain(10, 9n, { [hash.toLowerCase()]: { hash, blockNumber: "0x1" } }).rpc);
  assert.equal(closed.terminal, true);
  await rm(join(temporary.root, "operation-index"), { recursive: true, force: true });
  await writeFile(sidecar(temporary.root, item), `${canonicalJson({ ...closed.closure, finalizedNonceAtomic: "8" })}\n`, { mode: 0o600 });
  const blocked = await new OperationService(new StateStore(temporary.root)).assertEvmAccountAvailable(namedProfileHash(record.profile), 10, record.owner)
    .then(() => null, (error: unknown) => error);
  assert.ok(blocked instanceof ApnError && blocked.details?.blockingReason === "blocking_record_unreadable", String(blocked));
  assert.deepEqual(failureEnvelope("stargate.token.prepare", UUID, blocked).next_actions.slice(0, 1), [`apn operation status --operation ${record.operationId}`]);
});

test("the owner's six unreleased records (read-only copies), when present, index readable with only their account claims and close by their nonces", async (t) => {
  const files = await ownerCopies();
  if (files === null) { t.skip("the owner's copies are not on this machine"); return; }
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  await seedRecords(temporary.root, files);
  const profile = namedProfileHash("evm-live-buyer"), owner = "0x823a3a5bab1186141b32fc65f8e25ca24c679ce7";
  const legacy: Golden[] = [];
  for (const file of files) {
    const family = (Object.keys(DIRECTORY) as LegacyStargateFamily[]).find(key => DIRECTORY[key] === file.directory)!;
    const record = await loadLegacyStargateRecord(temporary.root, family, file.name.slice(0, -".json".length));
    if (record !== null) legacy.push({ family, record });
  }
  assert.deepEqual(legacy.map(item => `${item.record.schemaVersion}:${item.record.phase}`).sort(), [
    "apn.stargate-v2-native-operation.v1:approved", "apn.stargate-v2-native-operation.v1:observed", "apn.stargate-v2-token-operation.v3:approved",
    "apn.stargate-v2-token-operation.v4:approved", "apn.stargate-v2-token-operation.v4:approved", "apn.stargate-v2-token-operation.v4:cleaned"]);
  // The index 0.5.47 left behind: each one quarantined with its account and the whole profile.
  const store = new OperationIndexStore(temporary.root);
  for (const { family, record } of legacy) {
    const quarantined = entryOf({ operationId: record.operationId, family, profileHash: profile, idempotencyHash: null, requestHash: null,
      recordPath: `${DIRECTORY[family]}/${record.operationId}.json`, claims: [{ key: `profile:${profile}` }, { key: `evm:${CHAIN[family]}:${owner}` }],
      state: "unreadable", admittedAt: null, unreadableReason: "record_invalid" });
    await store.putOpen(quarantined); await store.putEntry(quarantined);
  }
  const state = new StateStore(temporary.root), service = new OperationService(state), index = new OperationIndex(state);
  await service.assertProfileAvailable(profile);
  for (const { family, record } of legacy) {
    const terminal = TERMINAL_PHASES[family].includes(record.phase), entry = await index.find(record.operationId);
    assert.deepEqual([entry?.state, entry?.claims], [terminal ? "terminal" : "active", terminal ? [] : [{ key: `evm:${CHAIN[family]}:${owner}` }]],
      `${record.operationId} ${record.schemaVersion} ${record.phase}`);
  }
  const approved = (network: string) => (error: ApnError) => error.code === "APN_OPERATION_BLOCKED" && error.details?.blockingState === "approved" &&
    error.details.blockingNetwork === network && legacy.some(item => item.record.operationId === error.details?.blockingOperationId);
  await assert.rejects(service.assertEvmAccountAvailable(profile, 10, owner), approved("evm:10"));
  await assert.rejects(service.assertEvmAccountAvailable(profile, 1, owner), approved("evm:1"));
  // R4 against the account's finalized nonces of 2026-10-17 (Optimism 38, Ethereum 71): every open one closes.
  for (const item of legacy.filter(entry => !TERMINAL_PHASES[entry.family].includes(entry.record.phase))) {
    const closed = await status(temporary.root, item, mockChain(CHAIN[item.family], item.family === "stargate_token" ? 38n : 71n).rpc);
    assert.deepEqual([closed.terminal, closed.closure?.highestEnvelopeNonceAtomic], [true, item.family === "stargate_token" ? "31" : "36"]);
  }
  await service.assertEvmAccountAvailable(profile, 10, owner); await service.assertEvmAccountAvailable(profile, 1, owner);
  await rm(join(temporary.root, "operation-index"), { recursive: true, force: true });
  for (const { record } of legacy) assert.equal((await new OperationIndex(state).find(record.operationId))?.state, "terminal");
});
