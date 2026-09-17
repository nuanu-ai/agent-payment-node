import assert from "node:assert/strict";
import { chmod, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  AllowlistPolicyStore,
  compileAllowlistPolicyOverlay,
  evaluateAssetPolicy,
  loadAllowlistInventory,
  type AllowlistPolicyOverlayInput,
} from "../../src/core.js";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { temporaryState, UUID } from "./helpers.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const inventory = loadAllowlistInventory();

function overlay(admissions: AllowlistPolicyOverlayInput["admissions"] = [{
  chain: "eip155:1", kind: "token", identifier: USDC, rail: "direct",
  maximumPerTransferAtomic: "100", dailyLimitAtomic: "300",
}]): AllowlistPolicyOverlayInput {
  return {
    overlayVersion: "owner.1", profile: "card2-test", account: ACCOUNT,
    datasetVersion: inventory.dataset.version, datasetSha256: inventory.dataset.sha256,
    inventorySha256: inventory.inventorySha256, effectiveAt: "2026-09-18T01:02:03.000Z",
    expiresAt: "2026-09-19T01:02:03.000Z", admissions,
  };
}

test("exact frozen inventory overlay compiles deterministically into an evaluator-compatible sealed registry", () => {
  const first = compileAllowlistPolicyOverlay(overlay());
  const second = compileAllowlistPolicyOverlay(structuredClone(overlay()));
  assert.deepEqual(second, first);
  assert.match(first.overlay.overlayDigest, /^[a-f0-9]{64}$/u);
  assert.match(first.registry.policyDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(first.registry.chains[0]?.assets[0]?.rails,
    { direct: true, gasless: false, x402: false, bridge: false, swap: false });
  assert.equal(evaluateAssetPolicy(first.registry, {
    chain: "eip155:1", asset: { kind: "token", identifier: USDC }, rail: "direct", amountAtomic: "100",
    dailyUsageAtomic: "200", asOfDate: "2026-09-18", asOf: "2026-09-18T01:02:03.000Z",
  }).dailyRemainingAtomic, "0");
});

test("unknown assets, family widening, swap, missing mechanisms and duplicate admissions have stable refusals", () => {
  const cases: readonly [AllowlistPolicyOverlayInput, string][] = [
    [overlay([{ chain: "eip155:1", kind: "token", identifier: "0x0000000000000000000000000000000000000001",
      rail: "direct", maximumPerTransferAtomic: "1", dailyLimitAtomic: "1" }]), "APN_ALLOWLIST_ASSET_NOT_FOUND"],
    [overlay([{ chain: "eip155:1", kind: "native", rail: "swap", maximumPerTransferAtomic: "1", dailyLimitAtomic: "1" }]), "APN_INVALID_INPUT"],
    [overlay([{ chain: "eip155:1", kind: "native", rail: "x402", maximumPerTransferAtomic: "1", dailyLimitAtomic: "1" }]), "APN_INVALID_INPUT"],
    [overlay([{ chain: "eip155:1", kind: "native", rail: "direct", maximumPerTransferAtomic: "1", dailyLimitAtomic: "1" },
      { chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", kind: "native", rail: "direct",
        maximumPerTransferAtomic: "1", dailyLimitAtomic: "1" }]), "APN_INVALID_INPUT"],
    [overlay([overlay().admissions[0]!, overlay().admissions[0]!]), "APN_INVALID_INPUT"],
  ];
  for (const [value, code] of cases) assert.throws(() => compileAllowlistPolicyOverlay(value), { code });
});

test("gasless, x402 and bridge require and retain nonempty pinned mechanism metadata", () => {
  for (const rail of ["gasless", "x402", "bridge"] as const) {
    const compiled = compileAllowlistPolicyOverlay(overlay([{
      chain: "eip155:1", kind: "token", identifier: USDC, rail,
      maximumPerTransferAtomic: "1", dailyLimitAtomic: "2",
      mechanism: { provider: `provider-${rail}`, reference: `manifest/${rail}/sha256:abc` },
    }]));
    assert.deepEqual(compiled.registry.chains[0]?.assets[0]?.mechanismPins?.[rail],
      { provider: `provider-${rail}`, reference: `manifest/${rail}/sha256:abc` });
  }
});

test("null, zero, noncanonical and uint256-overflow caps are refused", () => {
  const bad = [null, "0", "00", "01", ((1n << 256n) + 1n).toString()];
  for (const maximumPerTransferAtomic of bad) {
    const value: any = overlay(); value.admissions[0].maximumPerTransferAtomic = maximumPerTransferAtomic;
    assert.throws(() => compileAllowlistPolicyOverlay(value), { code: "APN_INVALID_INPUT" });
  }
});

test("exact effective and expiry instants are enforced by the shared evaluator", () => {
  const registry = compileAllowlistPolicyOverlay(overlay()).registry;
  const input = { chain: "eip155:1", asset: { kind: "token", identifier: USDC }, rail: "direct",
    amountAtomic: "1", dailyUsageAtomic: "0", asOfDate: "2026-09-18" } as const;
  assert.throws(() => evaluateAssetPolicy(registry, { ...input, asOf: "2026-09-18T01:02:02.999Z" }),
    { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => evaluateAssetPolicy(registry, { ...input, asOfDate: "2026-09-19", asOf: "2026-09-19T01:02:03.000Z" }),
    { code: "APN_OPERATION_BLOCKED" });
  assert.throws(() => evaluateAssetPolicy(registry, input), { code: "APN_INVALID_INPUT" });
});

test("stale dataset bindings, profile/account mismatch and invalid expiry fail before state", () => {
  for (const mutate of [
    (value: any) => { value.datasetSha256 = "0".repeat(64); },
    (value: any) => { value.datasetVersion = "stale"; },
    (value: any) => { value.inventorySha256 = "f".repeat(64); },
    (value: any) => { value.account = "11111111111111111111111111111111"; },
    (value: any) => { value.expiresAt = value.effectiveAt; },
    (value: any) => { value.profile = "INVALID PROFILE"; },
  ]) {
    const value: any = overlay(); mutate(value);
    assert.throws(() => compileAllowlistPolicyOverlay(value), { code: "APN_INVALID_INPUT" });
  }
});

test("durable policy versions are owner-only, create-only, stale-write guarded and tamper evident", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const store = new AllowlistPolicyStore(temporary.root);
  const first = await store.prepare({ ...overlay(), now: new Date("2026-09-17T12:00:00.000Z") });
  assert.equal(first.revision, 1); assert.equal(first.status, "staged_unadmitted");
  await assert.rejects(store.prepare({ ...overlay(), overlayVersion: "owner.2", now: new Date("2026-09-17T12:01:00.000Z") }),
    { code: "APN_PROFILE_REVISION_CONFLICT" });
  const second = await store.prepare({ ...overlay(), overlayVersion: "owner.2", expectedRevision: 1,
    now: new Date("2026-09-17T12:01:00.000Z") });
  assert.equal(second.revision, 2);
  await assert.rejects(store.prepare({ ...overlay(), account: "0x0000000000000000000000000000000000000001",
    overlayVersion: "owner.3", expectedRevision: 2, now: new Date("2026-09-17T12:02:00.000Z") }),
  { code: "APN_PROFILE_DRIFT" });
  const root = join(temporary.root, "allowlist-policies");
  const profileDirectories = await readdir(root); const profile = join(root, profileDirectories[0]!);
  assert.equal((await lstat(root)).mode & 0o777, 0o700); assert.equal((await lstat(profile)).mode & 0o777, 0o700);
  const versions = await readdir(profile); assert.deepEqual(versions, ["v00000001.json", "v00000002.json"]);
  const path = join(profile, "v00000002.json"); assert.equal((await lstat(path)).mode & 0o777, 0o600);
  const stored = JSON.parse(await readFile(path, "utf8")); stored.overlay.account = "0x0000000000000000000000000000000000000001";
  await writeFile(path, `${JSON.stringify(stored)}\n`); await chmod(path, 0o600);
  await assert.rejects(store.status("card2-test"), { code: "APN_STATE_CORRUPT" });
});

test("status serializes with writes for the same policy profile", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const store = new AllowlistPolicyStore(temporary.root);
  const first = await store.prepare({ ...overlay(), now: new Date("2026-09-17T12:00:00.000Z") });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let acquired!: () => void;
  const acquiredPromise = new Promise<void>((resolve) => { acquired = resolve; });
  const lock = store.withLocks([`profile:${first.overlay.profileHash}`], async () => { acquired(); await held; });
  await acquiredPromise;
  let settled = false;
  const status = store.status("card2-test").then((value) => { settled = true; return value; });
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  assert.equal(settled, false);
  release(); await lock;
  assert.equal((await status)?.recordDigest, first.recordDigest);
});

test("CLI and MCP prepare/status are identical, no policy exists by default, and neither surface activates it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const ids = { next: () => UUID }; const server = createMcpServer({ stateRoot: temporary.root, ids,
    clock: { now: () => new Date("2026-09-17T12:00:00.000Z") } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "allowlist-policy-parity", version: "1" }); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const statusArgs = { profile: "card2-parity" };
  const absentCli = await runCli(["allowlist", "policy", "status", "--profile", "card2-parity"], {}, { stateRoot: temporary.root, ids });
  const absentMcp = await mcp(client, "apn_allowlist_policy_status", statusArgs);
  assert.deepEqual(absentMcp, absentCli); assert.deepEqual(absentCli.data,
    { configured: false, status: "not_present", profile: "card2-parity", activation: "not_available" });
  const args = { profile: "card2-parity", account: ACCOUNT, overlay_version: "owner.1", chain: "eip155:1", kind: "token",
    identifier: USDC, rail: "direct", max_per_transfer_atomic: "100", daily_limit_atomic: "300",
    effective_at: "2026-09-18T01:02:03.000Z" };
  const cliArgv = ["allowlist", "policy", "prepare", "--profile", args.profile, "--account", args.account,
    "--overlay-version", args.overlay_version, "--chain", args.chain, "--kind", args.kind, "--identifier", args.identifier,
    "--rail", args.rail, "--max-per-transfer-atomic", args.max_per_transfer_atomic, "--daily-limit-atomic", args.daily_limit_atomic,
    "--effective-at", args.effective_at];
  const cli = await runCli(cliArgv, {}, { stateRoot: temporary.root, ids, clock: { now: () => new Date("2026-09-17T12:00:00.000Z") } });
  assert.equal(cli.ok, true); assert.equal((cli.data as any).status, "staged_unadmitted");
  assert.equal((cli.data as any).activation, undefined);
  const statusCli = await runCli(["allowlist", "policy", "status", "--profile", "card2-parity"], {}, { stateRoot: temporary.root, ids });
  const statusMcp = await mcp(client, "apn_allowlist_policy_status", statusArgs); assert.deepEqual(statusMcp, statusCli);
  const secondRoot = await temporaryState(); const thirdRoot = await temporaryState();
  t.after(secondRoot.cleanup); t.after(thirdRoot.cleanup);
  const cliSecond = await runCli(cliArgv, {}, { stateRoot: secondRoot.root, ids, clock: { now: () => new Date("2026-09-17T12:00:00.000Z") } });
  const serverSecond = createMcpServer({ stateRoot: thirdRoot.root, ids, clock: { now: () => new Date("2026-09-17T12:00:00.000Z") } });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await serverSecond.connect(st);
  const clientSecond = new Client({ name: "allowlist-policy-prepare-parity", version: "1" }); await clientSecond.connect(ct);
  t.after(async () => { await clientSecond.close(); await serverSecond.close(); });
  const mcpSecond = await mcp(clientSecond, "apn_allowlist_policy_prepare", args); assert.deepEqual(mcpSecond, cliSecond);
});

async function mcp(client: Client, name: string, args: Record<string, unknown>): Promise<OutputEnvelope> {
  const result = await client.callTool({ name, arguments: args }); const content = result.content[0];
  if (content?.type !== "text") throw new Error("expected MCP text");
  const envelope = JSON.parse(content.text) as OutputEnvelope; assert.deepEqual(result.structuredContent, envelope); return envelope;
}
