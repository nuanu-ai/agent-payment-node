import assert from "node:assert/strict";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  AllowlistPolicyStore,
  TtyAllowlistPolicyApproval,
  evaluateAssetPolicy,
  loadActiveAssetPolicyRegistry,
  swapMechanismDigest,
} from "../../src/core.js";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { temporaryState, UUID } from "./helpers.js";
import { EVM_OWNER, SOLANA, SOLANA_OWNER, TRON, TRON_OWNER, USDC, ownerAdmissions, uniswapPin } from "./allowlist-policy-fixtures.js";

const NOW = new Date("2026-09-18T01:30:00.000Z");
const PROFILE = "card2-owner";

interface Script { readonly port: TtyAllowlistPolicyApproval; screen(): string; closes(): number }
function terminal(answer: (screen: string) => Promise<string> | string): Script {
  let screen = "", closes = 0;
  const port = new TtyAllowlistPolicyApproval({ isTerminal: () => true, openTerminal: async () => ({
    fd: 11,
    write: async (text: string) => { screen += text; },
    read: async function* () { yield Buffer.from(`${await answer(screen)}\n`); },
    close: async () => { closes += 1; },
  }) });
  return { port, screen: () => screen, closes: () => closes };
}
const typed = (screen: string) => /Type ([0-9a-f]{6}) and press Enter to confirm\./u.exec(screen)![1]!;

function policy(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: "owner.1",
    accounts: { evm: EVM_OWNER, tron: TRON_OWNER, solana: SOLANA_OWNER }, effectiveAt: "2026-09-18T01:00:00.000Z",
    expiresAt: "2026-10-18T01:00:00.000Z", admissions: ownerAdmissions(), ...overrides };
}

async function setup(t: test.TestContext) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const clock = { now: () => new Date(NOW) };
  const cli = async (argv: readonly string[], approval?: TtyAllowlistPolicyApproval) => await runCli(argv, {},
    { stateRoot: temporary.root, clock, ids: { next: () => UUID }, ...(approval === undefined ? {} : { allowlistPolicyApproval: approval }) });
  const stage = async (value: unknown, name = "policy.json", expected?: number) => {
    const file = join(temporary.base, name); await writeFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    return await cli(["allowlist", "policy", "stage", "--profile", PROFILE, "--file", file,
      ...(expected === undefined ? [] : ["--expected-revision", String(expected)])]);
  };
  const decide = async (action: "activate" | "revoke", revision: number, answer: (screen: string) => Promise<string> | string = typed) => {
    const script = terminal(answer);
    return { envelope: await cli(["allowlist", "policy", action, "--profile", PROFILE, "--revision", String(revision)], script.port), script };
  };
  return { temporary, cli, stage, decide };
}

test("stage -> activate shows every admission exactly, writes a sealed ACTIVE record and the loader returns its registry", async (t) => {
  const { temporary, cli, stage, decide } = await setup(t);
  assert.equal(await loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW), null);
  const staged = await stage(policy());
  assert.equal(staged.ok, true, JSON.stringify(staged.error)); assert.equal((staged.data as any).status, "staged_unadmitted");
  const { envelope, script } = await decide("activate", 1);
  assert.equal(envelope.ok, true, JSON.stringify(envelope.error)); assert.equal(envelope.proof_class, "owner_activated_allowlist_policy");
  assert.equal((envelope.data as any).status, "active"); assert.equal(script.closes(), 1);
  const screen = script.screen();
  for (const line of ["Agent Payment Node allowlist policy ACTIVATION", `Profile: ${PROFILE}`, "Currently active revision: none",
    `Owner accounts: evm ${EVM_OWNER}; solana ${SOLANA_OWNER}; tron ${TRON_OWNER}`, "Effective at: 2026-09-18T01:00:00.000Z",
    "Expires at: 2026-10-18T01:00:00.000Z", "Admissions: 6", "1. Ethereum (eip155:1) ETH native; rail direct",
    "   Per operation: 0.0012 ETH (1200000000000000 atomic, 18 decimals)", "   Daily (UTC): 0.004 ETH (4000000000000000 atomic)",
    "2. Ethereum (eip155:1) ETH native; rail swap", `3. Ethereum (eip155:1) USDC token ${USDC}; rail swap`,
    "   Per operation: 3 USDC (3000000 atomic, 6 decimals)", "   Daily (UTC): 10 USDC (10000000 atomic)",
    `pin digest ${swapMechanismDigest(uniswapPin())}`, `(${SOLANA}) SOL native; rail direct`, "   Per operation: 0.0286 SOL",
    `(${TRON}) TRX native; rail direct`, "   Daily (UTC): 29.7 TRX (29700000 atomic)", `USDT token TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t; rail direct`,
    `Policy digest: ${(staged.data as any).registry.policyDigest}`, `Staged record: ${(staged.data as any).recordDigest}`]) {
    assert.ok(screen.includes(line), line);
  }
  const active = await loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW);
  assert.ok(active !== null); assert.equal(active.revision, 1); assert.equal(active.digest, (staged.data as any).registry.policyDigest);
  assert.deepEqual(active.registry, (staged.data as any).registry); assert.deepEqual(active.accounts, { evm: EVM_OWNER, solana: SOLANA_OWNER, tron: TRON_OWNER });
  assert.equal(evaluateAssetPolicy(active.registry, { chain: "eip155:1", asset: { kind: "token", identifier: USDC }, rail: "swap",
    amountAtomic: "3000000", dailyUsageAtomic: "0", asOfDate: "2026-09-18", asOf: NOW.toISOString() }).policyDigest, active.digest);
  assert.deepEqual(await loadActiveAssetPolicyRegistry({ state: { root: temporary.root }, clock: { now: () => NOW } }, PROFILE), active);
  const status = await cli(["allowlist", "policy", "status", "--profile", PROFILE]);
  assert.equal((status.data as any).activation, "active"); assert.equal((status.data as any).active.revision, 1);
  assert.equal((status.data as any).active.admissions.length, 6);
  const already = await decide("activate", 1);
  assert.equal(already.envelope.error?.details?.reason, "already_active"); assert.equal(already.script.closes(), 0);
});

test("a wrong code, a closed terminal and a missing revision write nothing", async (t) => {
  const { temporary, stage, decide } = await setup(t);
  await stage(policy());
  const wrong = await decide("activate", 1, (screen) => typed(screen) === "000000" ? "000001" : "000000");
  assert.equal(wrong.envelope.error?.code, "APN_NATIVE_REJECTED"); assert.equal(wrong.envelope.error?.details?.nativeCode, "APN_APPROVAL_REFUSED");
  const unavailable = await runCli(["allowlist", "policy", "activate", "--profile", PROFILE, "--revision", "1"], {}, { stateRoot: temporary.root,
    clock: { now: () => NOW }, allowlistPolicyApproval: new TtyAllowlistPolicyApproval({ openTerminal: async () => { throw new Error("no tty"); } }) });
  assert.equal(unavailable.error?.details?.nativeCode, "APN_TTY_UNAVAILABLE");
  assert.equal((await decide("activate", 2)).envelope.error?.code, "APN_OPERATION_NOT_FOUND");
  assert.equal(await loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW), null);
  assert.deepEqual(await readdir(join(temporary.root, "allowlist-activations")), []);
});

test("expiry fails closed at load time and an expired staged revision cannot be activated", async (t) => {
  const { temporary, cli, stage, decide } = await setup(t);
  await stage(policy({ expiresAt: "2026-09-18T02:00:00.000Z" }));
  assert.equal((await decide("activate", 1)).envelope.ok, true);
  assert.equal((await loadActiveAssetPolicyRegistry(temporary.root, PROFILE, new Date("2026-09-18T01:59:59.999Z")))?.revision, 1);
  await assert.rejects(loadActiveAssetPolicyRegistry(temporary.root, PROFILE, new Date("2026-09-18T02:00:00.000Z")),
    { code: "APN_OPERATION_BLOCKED", details: { reason: "allowlist_policy_expired" } });
  await assert.rejects(loadActiveAssetPolicyRegistry(temporary.root, PROFILE, undefined as never), { code: "APN_INVALID_INPUT" });
  const later = { now: () => new Date("2026-09-18T03:00:00.000Z") };
  const status = await runCli(["allowlist", "policy", "status", "--profile", PROFILE], {}, { stateRoot: temporary.root, clock: later });
  assert.equal((status.data as any).activation, "expired");
  await stage(policy({ overlayVersion: "owner.2", expiresAt: "2026-09-18T01:15:00.000Z" }), "second.json", 1);
  const expired = await decide("activate", 2);
  assert.equal(expired.envelope.error?.details?.reason, "allowlist_policy_expired"); assert.equal(expired.script.closes(), 0);
  assert.equal((await cli(["allowlist", "policy", "status", "--profile", PROFILE])).ok, true);
});

test("tampered ACTIVE, staged or chained records fail closed with APN_STATE_CORRUPT", async (t) => {
  const mutations: readonly [string, (value: any) => void][] = [
    ["allowlist-activations", (value) => { value.registry.chains[0].assets[0].railCaps.direct.dailyLimitAtomic = "9000000000000000"; }],
    ["allowlist-activations", (value) => { value.decidedAt = "2026-09-18T01:31:00.000Z"; }],
    ["allowlist-activations", (value) => { value.status = "revoked"; delete value.registry; }],
    ["allowlist-policies", (value) => { value.overlay.admissions[0].dailyLimitAtomic = "9000000000000000"; }],
  ];
  for (const [directory, mutate] of mutations) {
    const { temporary, stage, decide } = await setup(t);
    await stage(policy()); assert.equal((await decide("activate", 1)).envelope.ok, true);
    const profileDirectory = join(temporary.root, directory, (await readdir(join(temporary.root, directory)))[0]!);
    const path = join(profileDirectory, (await readdir(profileDirectory))[0]!);
    const value = JSON.parse(await readFile(path, "utf8")); mutate(value); await writeFile(path, `${JSON.stringify(value)}\n`);
    await assert.rejects(loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW), { code: "APN_STATE_CORRUPT" }, directory);
  }
  const { temporary, stage, decide } = await setup(t);
  await stage(policy()); assert.equal((await decide("activate", 1)).envelope.ok, true);
  const records = join(temporary.root, "allowlist-policies"); const profileDirectory = join(records, (await readdir(records))[0]!);
  await rm(join(profileDirectory, "v00000001.json"));
  await assert.rejects(loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW), { code: "APN_STATE_CORRUPT" });
});

test("revoke needs the same typed approval; replacement and stale screens are guarded", async (t) => {
  const { temporary, cli, stage, decide } = await setup(t);
  await stage(policy());
  await stage(policy({ overlayVersion: "owner.2", accounts: { tron: TRON_OWNER, solana: SOLANA_OWNER },
    admissions: ownerAdmissions().slice(3) }), "second.json", 1);
  assert.equal((await decide("activate", 1)).envelope.ok, true);
  const replaced = await decide("activate", 2);
  assert.equal(replaced.envelope.ok, true); assert.ok(replaced.script.screen().includes("Effect: this revision replaces active revision 1."));
  assert.equal((await loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW))?.revision, 2);
  assert.equal((await decide("revoke", 1)).envelope.error?.details?.reason, "not_active_revision");
  const wrong = await decide("revoke", 2, () => "abcdef");
  assert.equal(wrong.envelope.error?.details?.nativeCode, "APN_APPROVAL_REFUSED");
  assert.equal((await loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW))?.revision, 2);
  const revoked = await decide("revoke", 2);
  assert.equal(revoked.envelope.ok, true); assert.equal((revoked.envelope.data as any).status, "revoked");
  assert.ok(revoked.script.screen().includes("Agent Payment Node allowlist policy REVOCATION"));
  assert.equal(await loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW), null);
  const status = await cli(["allowlist", "policy", "status", "--profile", PROFILE]);
  assert.equal((status.data as any).activation, "revoked"); assert.equal((status.data as any).lastDecision.status, "revoked");
  // A screen approved against an older chain head is refused when another decision landed meanwhile.
  const stale = await decide("activate", 1, async (screen) => {
    assert.equal((await decide("activate", 2)).envelope.ok, true);
    return typed(screen);
  });
  assert.equal(stale.envelope.error?.code, "APN_PROFILE_REVISION_CONFLICT");
  assert.equal((await loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW))?.revision, 2);
});

test("MCP activate and revoke return a foreground handoff; MCP stage and status keep CLI parity", async (t) => {
  const { temporary, stage } = await setup(t);
  await stage(policy());
  const server = createMcpServer({ stateRoot: temporary.root, ids: { next: () => UUID }, clock: { now: () => NOW } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "allowlist-activation", version: "1" }); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  for (const action of ["activate", "revoke"] as const) {
    const envelope = await mcp(client, `apn_allowlist_policy_${action}`, { profile: PROFILE, revision: "1" });
    assert.equal(envelope.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    assert.equal(envelope.error?.details?.cli_handoff, `apn allowlist policy ${action} --profile ${PROFILE} --revision 1`);
  }
  assert.equal(await loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW), null);
  const status = await mcp(client, "apn_allowlist_policy_status", { profile: PROFILE });
  assert.deepEqual(status, await runCli(["allowlist", "policy", "status", "--profile", PROFILE], {},
    { stateRoot: temporary.root, ids: { next: () => UUID }, clock: { now: () => NOW } }));
  const file = join(temporary.base, "mcp.json"); await writeFile(file, JSON.stringify(policy({ overlayVersion: "owner.mcp" })));
  const staged = await mcp(client, "apn_allowlist_policy_stage", { profile: PROFILE, file, expected_revision: "1" });
  assert.equal((staged.data as any).revision, 2);
});

test("v1 records stay readable, activatable and account-bound next to v2 revisions", async (t) => {
  const { temporary, cli, stage, decide } = await setup(t);
  const prepared = await cli(["allowlist", "policy", "prepare", "--profile", PROFILE, "--account", EVM_OWNER, "--overlay-version", "legacy.1",
    "--chain", "eip155:1", "--kind", "token", "--identifier", USDC, "--rail", "direct", "--max-per-transfer-atomic", "3000000",
    "--daily-limit-atomic", "10000000", "--effective-at", "2026-09-18T01:00:00.000Z"]);
  assert.equal((prepared.data as any).schemaVersion, "apn.allowlist-policy-record.v1");
  const activated = await decide("activate", 1);
  assert.equal(activated.envelope.ok, true); assert.ok(activated.script.screen().includes("Expires at: never (active until revoked)"));
  const active = await loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW);
  assert.equal(active?.registry.schemaVersion, "apn.asset-policy-registry.v1"); assert.deepEqual(active?.accounts, { evm: EVM_OWNER });
  const drift = await stage(policy({ accounts: { evm: "0x0000000000000000000000000000000000000001", tron: TRON_OWNER, solana: SOLANA_OWNER } }), "drift.json", 1);
  assert.equal(drift.error?.code, "APN_PROFILE_DRIFT");
  assert.equal((await stage(policy(), "v2.json")).error?.code, "APN_PROFILE_REVISION_CONFLICT");
  assert.equal((await stage(policy({ overlayVersion: "legacy.1" }), "reuse.json", 1)).error?.details?.reason, "overlay_version_reused");
  assert.equal((await stage(policy(), "v2.json", 1)).ok, true);
  // A revision that omits the EVM family does not release the EVM binding for later revisions.
  assert.equal((await stage(policy({ overlayVersion: "owner.3", accounts: { solana: SOLANA_OWNER }, admissions: ownerAdmissions().slice(5) }),
    "solana-only.json", 2)).ok, true);
  assert.equal((await stage(policy({ overlayVersion: "owner.4", accounts: { evm: "0x0000000000000000000000000000000000000001" },
    admissions: ownerAdmissions().slice(0, 3) }), "evm-drift.json", 3)).error?.code, "APN_PROFILE_DRIFT");
  const store = new AllowlistPolicyStore(temporary.root);
  assert.deepEqual((await store.read(PROFILE)).records.map((record) => record.schemaVersion),
    ["apn.allowlist-policy-record.v1", "apn.allowlist-policy-record.v2", "apn.allowlist-policy-record.v2"]);
});

test("policy files are strict: owner-written, canonical path, no defaults filled in", async (t) => {
  const { temporary, cli, stage } = await setup(t);
  for (const value of [policy({ accounts: undefined }), { ...policy(), admissions: [{ chain: "eip155:1", kind: "native", rail: "direct",
    maximumPerTransferAtomic: "1" }] }, { ...policy(), extra: true }, policy({ schemaVersion: "apn.allowlist-policy-file.v0" })]) {
    const result = await stage(value, "bad.json");
    assert.equal(result.error?.code, "APN_INVALID_INPUT", JSON.stringify(value));
  }
  for (const file of ["relative.json", `${temporary.base}/../x/policy.json`, join(temporary.base, "missing.json")]) {
    const result = await cli(["allowlist", "policy", "stage", "--profile", PROFILE, "--file", file]);
    assert.equal(result.ok, false, file);
  }
  const writable = join(temporary.base, "writable.json"); await writeFile(writable, JSON.stringify(policy()), { mode: 0o666 });
  const { chmod } = await import("node:fs/promises"); await chmod(writable, 0o666);
  assert.equal((await cli(["allowlist", "policy", "stage", "--profile", PROFILE, "--file", writable])).error?.code, "APN_STATE_SECURITY");
  assert.equal(await new AllowlistPolicyStore(temporary.root).status(PROFILE), null);
});

test("the store appends a decision only for the exact staged record and registry the screen showed", async (t) => {
  const { temporary, stage } = await setup(t);
  const staged = (await stage(policy())).data as any;
  const store = new AllowlistPolicyStore(temporary.root);
  const decision = { status: "active" as const, revision: 1, stagedRecordDigest: staged.recordDigest, policyDigest: staged.registry.policyDigest,
    registry: staged.registry, approvalFingerprint: "a".repeat(64), decidedAt: NOW.toISOString() };
  const other = structuredClone(staged.registry); other.registryVersion = "other.1";
  for (const altered of [{ ...decision, stagedRecordDigest: "b".repeat(64) }, { ...decision, policyDigest: "c".repeat(64) },
    { ...decision, registry: other }, { ...decision, revision: 2 }]) {
    await assert.rejects(store.appendDecision(PROFILE, null, altered), (error: any) => ["APN_PROFILE_REVISION_CONFLICT", "APN_STATE_CORRUPT"].includes(error.code));
  }
  await assert.rejects(store.appendDecision(PROFILE, "d".repeat(64), decision), { code: "APN_PROFILE_REVISION_CONFLICT" });
  assert.equal((await store.appendDecision(PROFILE, null, decision)).sequence, 1);
  assert.equal((await loadActiveAssetPolicyRegistry(temporary.root, PROFILE, NOW))?.revision, 1);
});

async function mcp(client: Client, name: string, args: Record<string, unknown>): Promise<OutputEnvelope> {
  const result = await client.callTool({ name, arguments: args }); const content = result.content[0];
  if (content?.type !== "text") throw new Error("expected MCP text");
  return JSON.parse(content.text) as OutputEnvelope;
}
