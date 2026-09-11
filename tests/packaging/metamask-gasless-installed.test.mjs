import assert from "node:assert/strict";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { before } from "node:test";
import { installedPackage, mcp, reinstall, scenario } from "./metamask-gasless-fixtures/harness.mjs";
import { makeSignedEffect } from "./metamask-gasless-fixtures/signed-effect.mjs";
import { runInstalledStorageProof } from "./metamask-gasless-fixtures/storage-proof.mjs";
import { runInstalledRetainedProof } from "./metamask-gasless-fixtures/retained-proof.mjs";

let installed;
before(async () => { installed = await installedPackage(); }, { timeout: 240000 });

// Every invocation below runs the shipped bin and helper with the pinned public
// SDKs. Only OS identity and the public DNS/HTTPS boundary are synthetic. Fixture
// transaction signatures are produced independently by ethers outside the archive.
test("installed MetaMask CLI proves G=N+F and provider gas payment on all eight finite mainnets", { timeout: 300000 }, async (t) => {
  const rows = [];
  for (const chain of [1, 10, 137, 143, 1329, 8453, 42161, 59144]) await t.test(String(chain), async () => {
    const s = await scenario(installed, chain, { nameless: true });
    const privateBefore = await s.privateBytes(), connection = await mcp(s);
    try {
      const mcpPrepared = await connection.call("apn_gasless_transfer_prepare", { profile: s.profile, chain: String(chain),
        to: s.fixture().recipient, amount: "1", max_fee: "0.002", min_received: "0.998", idempotency_key: "mm-installed-1" });
      assert.equal(mcpPrepared.ok, true, JSON.stringify(mcpPrepared));
      const { id, record, result } = await s.prepare();
      assert.deepEqual(result.operation, mcpPrepared.operation);
      assert.equal(record.state, "awaiting_approval"); assert.equal(record.submissionAttempts, 0);
      assert.equal(BigInt(record.intent.quote.netAtomic) + BigInt(record.intent.quote.feeAtomic), 1000000n);
      assert.equal(record.intent.quote.feeAtomic, chain === 1 ? "1050" : "1000");
      const approved = await s.approve(id);
      assert.equal(approved.envelope.ok, true, JSON.stringify(approved.envelope));
      const completed = await s.record(id);
      assert.equal(completed.state, "completed", JSON.stringify(approved.envelope));
      assert.equal(completed.submissionAttempts, 1); assert.equal(s.fixture().postCount, 1);
      assert.equal(completed.settlement.debitAtomic, "1000000");
      assert.equal(completed.settlement.outerSender, s.fixture().relayer);
      assert.notEqual(completed.settlement.outerSender, s.fixture().owner);
      const traceBeforeReads = await s.trace();
      const status = await connection.call("apn_operation_status", { operation: id });
      const resumed = await connection.call("apn_operation_resume", { operation: id });
      const receipt = await connection.call("apn_receipt_get", { operation: id });
      const cliReceipt = await s.cli(["receipt", "get", "--operation", id]);
      assert.deepEqual(status.operation, approved.envelope.operation);
      assert.deepEqual(resumed.operation, approved.envelope.operation);
      assert.deepEqual(receipt.receipt, cliReceipt.receipt);
      assert.equal(receipt.receipt.operation_id, id);
      assert.deepEqual(receipt.receipt.settlement, completed.settlement);
      assert.equal(receipt.receipt.operation_binding_hash, completed.integrityHash);
      assert.equal(receipt.receipt.transition_hash, completed.transitions.at(-1).transitionHash);
      assert.deepEqual(await s.trace(), traceBeforeReads);
      assert.deepEqual(await s.privateBytes(), privateBefore);
      await assertSafeTrace(s, 1);
      rows.push({ chainId: chain, operationId: id, state: completed.state, debitAtomic: completed.settlement.debitAtomic,
        deliveredAtomic: completed.settlement.deliveredAtomic, feeAtomic: completed.settlement.feeAtomic,
        outerGasPayer: completed.settlement.outerSender, nativeBalanceAtomic: "0", providerPosts: 1,
        surfaces: ["cli", "stdio_mcp"] });
    } finally { await connection.close(); }
  });
  await writeFile(join(installed.root, "eight-chain-installed-proof.json"), JSON.stringify({
    proofClass: "installed_archive_synthetic_transport", archiveSha256: installed.identity.archiveSha256,
    realProviderOrMainnetPayment: false, rows }, null, 2) + "\n");
});

test("installed CLI and stdio MCP share replay, foreground handoff, status and receipt without extra effects", { timeout: 90000 }, async () => {
  const s = await scenario(installed), { id, result } = await s.prepare();
  const connection = await mcp(s);
  try {
    const before = await s.trace();
    const replay = await connection.call("apn_gasless_transfer_prepare", { profile: s.profile, chain: "8453",
      to: s.fixture().recipient, amount: "1", max_fee: "0.002", min_received: "0.998", idempotency_key: "mm-installed-1" });
    assert.deepEqual(replay.operation, result.operation);
    const handoff = await connection.call("apn_gasless_transfer_approve", { operation: id });
    assert.equal(handoff.error.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    assert.deepEqual(handoff.error.details.cli_handoff_argv, ["apn", "gasless", "transfer", "approve", "--operation", id]);
    assert.deepEqual(await s.trace(), before);
    await s.approve(id);
    const after = await s.trace();
    const cliStatus = await s.cli(["operation", "status", "--operation", id]);
    const rpcStatus = await connection.call("apn_operation_status", { operation: id });
    assert.deepEqual(rpcStatus.operation, cliStatus.operation);
    const cliReceipt = await s.cli(["receipt", "get", "--operation", id]);
    const rpcReceipt = await connection.call("apn_receipt_get", { operation: id });
    assert.deepEqual(rpcReceipt.receipt, cliReceipt.receipt);
    assert.deepEqual(await s.trace(), after);
  } finally { await connection.close(); }
});

test("installed CLI and MCP discovery enumerate the same finite gasless surface without opening state", { timeout: 60000 }, async () => {
  const s = await scenario(installed);
  await chmod(s.stateRoot, 0o777);
  await chmod(join(s.home, ".metamask/session.json"), 0o666);
  const privateBefore = await s.privateBytes();
  const cli = await s.cli(["gasless", "capabilities", "--profile", s.profile]);
  assert.equal(cli.ok, true, JSON.stringify(cli));
  assert.equal(cli.data.profile_binding_inspected, false);
  assert.deepEqual(cli.data.provider_networks["metamask-agent-wallet"].map(row => row.chain_id),
    [1, 10, 137, 143, 1329, 8453, 42161, 59144]);
  const connection = await mcp(s);
  try {
    const discovery = await connection.client.listTools();
    assert.deepEqual(discovery.tools.filter(tool => tool.name.startsWith("apn_gasless_")).map(tool => tool.name),
      ["apn_gasless_capabilities", "apn_gasless_balance", "apn_gasless_transfer_prepare", "apn_gasless_transfer_approve"]);
    const capabilities = await connection.call("apn_gasless_capabilities", { profile: s.profile });
    assert.deepEqual(capabilities.data, cli.data);
  } finally { await connection.close(); }
  assert.equal((await stat(s.stateRoot)).mode & 0o777, 0o777);
  assert.deepEqual(await s.privateBytes(), privateBefore);
  assert.deepEqual(await s.trace(), []);
});

test("installed approval rejects missing TTY, incomplete phrase, expiry, changed fee and protocol before provider POST", { timeout: 180000 }, async (t) => {
  for (const kind of ["missing-tty", "short-phrase", "expired", "changed-fee", "changed-protocol"]) await t.test(kind, async () => {
    const s = await scenario(installed), { id } = await s.prepare();
    if (kind === "expired") s.update({ nowOffsetMs: 301000 });
    if (kind === "changed-fee") s.update({ rawFeeAtomic: "1100" });
    if (kind === "changed-protocol") s.update({ corruptProtocol: true });
    if (kind === "missing-tty") {
      const denied = await s.cli(["gasless", "transfer", "approve", "--operation", id]);
      assert.equal(denied.error.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    } else await s.approve(id, kind === "short-phrase" ? "APPROVE GASLESS" : undefined);
    const record = await s.record(id);
    assert.equal(record.state, kind === "missing-tty" ? "awaiting_approval" : "failed_before_effect");
    assert.equal(record.submissionAttempts, 0); assert.equal(s.fixture().postCount, 0);
    await assertSafeTrace(s, 0);
  });
});

test("installed POST response loss and helper termination retain the marker across expiry and fresh processes", { timeout: 120000 }, async (t) => {
  for (const kind of ["lost-response", "terminated-helper"]) await t.test(kind, async () => {
    const s = await scenario(installed, 8453, { afterPostPhase: "pending", submitResponseLost: kind === "lost-response",
      killSubmitHelper: kind === "terminated-helper" });
    const { id } = await s.prepare(); await s.approve(id);
    const first = await s.record(id);
    assert.equal(first.submissionAttempts, 1); assert.equal(first.terminal, false);
    assert.equal(s.fixture().postCount, kind === "lost-response" ? 1 : 0);
    s.update({ nowOffsetMs: 301000, killSubmitHelper: false, submitResponseLost: false, phase: "success" });
    const resumed = await s.cli(["operation", "resume", "--operation", id]);
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    const current = await s.record(id);
    assert.equal(current.submissionAttempts, 1);
    assert.equal(current.state, kind === "lost-response" ? "completed" : "unknown_finality");
    assert.equal(s.fixture().postCount, kind === "lost-response" ? 1 : 0);
    await assertSafeTrace(s, s.fixture().postCount);
  });
});

test("installed invalid hinted receipt retains its cursor and resumes without a second POST", { timeout: 90000 }, async () => {
  const s = await scenario(installed, 8453, { receiptLogCount: 513, emptyScanPage: true });
  const { id, record: prepared } = await s.prepare();
  await s.approve(id);
  const invalid = await s.record(id);
  assert.equal(invalid.observation.phase, "invalid");
  assert.equal(invalid.observation.reason, "mm_gasless_evidence_invalid");
  assert.equal(invalid.terminal, false); assert.equal(invalid.submissionAttempts, 1);
  assert.deepEqual(invalid.cursor, prepared.cursor);
  assert.equal(s.fixture().postCount, 1);
  s.update({ receiptLogCount: null, emptyScanPage: false });
  const resumed = await s.cli(["operation", "resume", "--operation", id]);
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const complete = await s.record(id);
  assert.equal(complete.state, "completed");
  assert.equal(complete.intent.delegationHash, prepared.intent.delegationHash);
  assert.equal(complete.submissionAttempts, 1); assert.equal(s.fixture().postCount, 1);
  await assertSafeTrace(s, 1);
  await writeFile(join(installed.root, "receipt-cursor-installed-proof.json"), JSON.stringify({
    proofClass: "installed_archive_synthetic_transport", archiveSha256: installed.identity.archiveSha256,
    realProviderOrMainnetPayment: false, operationId: id, invalidReceiptLogs: 513,
    originalCursor: prepared.cursor, invalidCursor: invalid.cursor,
    invalidState: invalid.state, finalState: complete.state, providerPosts: 1,
  }, null, 2) + "\n");
});

test("installed reverted transaction keeps effects pending and later same-permission delivery closes after reinstall", { timeout: 120000 }, async () => {
  const s = await scenario(installed, 8453, { afterPostPhase: "reverted" });
  const { id } = await s.prepare(); await s.approve(id);
  const first = await s.record(id);
  assert.equal(first.state, "failed_effects_pending"); assert.equal(first.terminal, false);
  const next = await makeSignedEffect(s.packageRoot, s.fixture(), s.fixture().effect.posted,
    { nonce: 8, blockNumber: 104, type: 2 });
  s.update({ effect: next, phase: "success", initialDesignation: "pinned", nowOffsetMs: 301000 });
  await reinstall(s);
  const resumed = await s.cli(["operation", "resume", "--operation", id]);
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const complete = await s.record(id);
  assert.equal(complete.state, "completed", JSON.stringify(resumed));
  assert.equal(complete.settlement.txHash, next.transaction.hash);
  assert.equal(complete.intent.delegationHash, first.intent.delegationHash);
  assert.equal(s.fixture().postCount, 1); await assertSafeTrace(s, 1);
});

test("installed prepare rejects private identity and transport failures without a payment request", { timeout: 120000 }, async (t) => {
  for (const kind of ["expired-session", "unsafe-session", "wrong-wallet", "inventory-failure", "private-dns", "wrong-peer", "redirect", "invalid-utf8", "oversized-header", "timeout"]) await t.test(kind, async () => {
    const s = await scenario(installed);
    if (kind === "expired-session") s.update({ nowOffsetMs: 86401000 });
    if (kind === "unsafe-session") await chmod(join(s.home, ".metamask/session.json"), 0o644);
    if (kind === "wrong-wallet") {
      const path = join(s.home, ".metamask/wallets.json"), wallet = JSON.parse(await readFile(path, "utf8"));
      wallet.data.selectedWallet.ref = { id: "incidental-id" }; await writeFile(path, JSON.stringify(wallet), { mode: 0o600 });
    }
    if (kind === "inventory-failure") s.update({ inventoryFailure: true });
    if (["private-dns", "wrong-peer", "redirect", "invalid-utf8", "oversized-header", "timeout"].includes(kind)) s.update({ transportFault: kind });
    const result = await s.cli(s.prepareArgv("mm-denied"));
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(s.fixture().postCount, 0); await assertSafeTrace(s, 0);
  });
});

test("installed archive preserves real encrypted storage and classified Keychain boundaries", { timeout: 90000 }, async () => {
  const evidence = await runInstalledStorageProof({ packageRoot: installed.packageRoot, workRoot: installed.root });
  await writeFile(join(installed.root, "storage-installed-proof.json"), JSON.stringify(evidence, null, 2) + "\n");
});

test("installed archive and reinstall preserve historical operation families and profile lifecycle guards", { timeout: 300000 }, async () => {
  const evidence = await runInstalledRetainedProof(installed);
  await writeFile(join(installed.root, "retained-installed-proof.json"), JSON.stringify(evidence, null, 2) + "\n");
});

async function assertSafeTrace(s, posts) {
  const trace = await s.trace();
  assert.deepEqual(trace.filter(entry => ["forbidden-egress", "fixture-violation"].includes(entry.kind)), []);
  assert.equal(trace.filter(entry => entry.kind === "provider-post").length, posts);
  const rpcMethods = trace.filter(entry => entry.rpcMethod).map(entry => entry.rpcMethod);
  assert.equal(rpcMethods.some(method => /sendRawTransaction|sendTransaction|sign|approve/iu.test(method)), false);
}
