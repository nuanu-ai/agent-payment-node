import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { temporaryState } from "./helpers.js";
import { historicalFixture } from "./jupiter-historical-authentication-fixture.js";
import { HISTORICAL_JUPITER_IDS } from "../../src/swap/jupiter-solana/historical-pins.js";
import { executeHistoricalJupiterCli, isHistoricalJupiterCli } from "../../src/swap/jupiter-solana/historical-cli.js";
import { runCli } from "../../src/cli.js";
import { COMMANDS } from "../../src/command-catalog.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";

const path = ["swap", "solana", "jupiter", "historical-authenticate"];
const id = HISTORICAL_JUPITER_IDS[0]!;
let wrappingLoads = 0, wrappingCreates = 0;
mock.module("../../src/macos-keychain.js", { namedExports: { MacOSLoginKeychainSecret: class {
  async load() { wrappingLoads++; throw Error("TEST_ONLY keychain denial"); }
  async create() { wrappingCreates++; throw Error("TEST_ONLY keychain denial"); }
} } });
for (const tail of [[], ["--operation"], ["--operation", "unknown"], ["--operation", id, "--operation", id],
  ["--operation", id, "--profile", "solana-local"], ["--operation", id, "--rpc-url", "https://invalid.example"],
  ["--operation=" + id], [id], ["--operation", id, "--"], ["--operation", id.toUpperCase()]]) {
  test(`strict historical CLI refuses ${JSON.stringify(tail)} before root/custody/key`, async () => {
    let roots = 0;
    const result = await executeHistoricalJupiterCli([...path, ...tail], () => { roots++; throw Error("must not resolve root"); });
    assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_INVALID_INPUT");
    assert.equal(roots, 0); assert.equal(result.data, null);
    const normal = await runCli([...path, ...tail], {}, { stateRoot: "/TEST_ONLY/must-not-read" });
    assert.deepEqual(normal.error, result.error);
    assert.equal(wrappingLoads, 0); assert.equal(wrappingCreates, 0);
  });
}
test("CLI-only route leaves catalog and exact MCP122 unchanged", () => {
  assert.equal(COMMANDS.some(c => c.path.includes("historical-authenticate")), false);
  assert.equal(MCP_TOOLS.length, 122);
  assert.equal(isHistoricalJupiterCli([...path, "--operation", id]), true);
  assert.equal(isHistoricalJupiterCli(["swap", "solana", "jupiter", "historical-authenticate-extra"]), false);
});
for (const operation of HISTORICAL_JUPITER_IDS) test(`normal CLI real issuer missing TEST root ${operation}: no init/key/RPC`, async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const result = await runCli([...path, "--operation", operation], {}, {
    stateRoot: temp.root,
    wrappingSecret: { load: async () => { throw Error("injected key port must never be used"); }, create: async () => { throw Error("no creation"); } },
  });
  assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_OPERATION_BLOCKED");
  assert.deepEqual(await readdir(temp.base), []); assert.equal(result.data, null);
  assert.equal(wrappingLoads, 0); assert.equal(wrappingCreates, 0);
});
test("normal CLI real issuer symlink TEST root refuses without creating records", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const target = join(temp.base, "existing"); await mkdir(target, {mode: 0o700}); await symlink(target, temp.root);
  const result = await runCli([...path, "--operation", id], {}, {stateRoot: temp.root});
  assert.equal(result.ok, false); assert.deepEqual(await readdir(target), []);
  assert.equal(wrappingLoads, 0); assert.equal(wrappingCreates, 0);
});
test("normal CLI real issuer generated wrong owner refuses before wrapping load/TTY", async t => {
  const f = await historicalFixture({operationId: id}); t.after(f.temp.cleanup);
  const result = await runCli([...path, "--operation", id], {}, {stateRoot: f.temp.root});
  assert.equal(result.ok, false); assert.equal(result.data, null);
  assert.deepEqual(result.error, {code: "APN_OPERATION_BLOCKED", message: "Historical Jupiter material authentication is unavailable."});
  assert.equal(wrappingLoads, 0); assert.equal(wrappingCreates, 0);
});
test("handler sanitizes root exceptions without material/paths/details", async () => {
  const result = await executeHistoricalJupiterCli([...path, "--operation", id], () => { throw Error("TEST_PRIVATE_CANARY/path/body"); });
  assert.equal(JSON.stringify(result).includes("TEST_PRIVATE_CANARY"), false);
  assert.equal(result.ok, false); assert.equal(result.operation, null); assert.equal(result.receipt, null);
});
