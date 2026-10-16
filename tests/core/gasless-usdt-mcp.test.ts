import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ApnCore } from "../../src/core.js";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { UsdtBoundOperationRepository } from "../../src/gasless-usdt/bound-operation.js";
import { preparePolicyBoundUsdtV2 } from "../../src/gasless-usdt/policy-prepare-v2.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { v2Fixture } from "./gasless-usdt-v2-fixture.js";

const PROFILE_HASH = "a".repeat(64);
const REQUEST_ID = "12345678-1234-4234-8234-123456789abc";

test("MCP status/resume are byte-equivalent to CLI and leave the USDT journal unchanged", async t => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  // The live bound journal written by `gasless usdt prepare`; resume of a never-executed operation is a local read.
  const f = v2Fixture("expected"), repository = new UsdtBoundOperationRepository(temporary.root);
  const operation = await repository.create(PROFILE_HASH, await preparePolicyBoundUsdtV2({ prepare: f.prepare, sponsor: f.sponsor },
    f.request), "mcp-usdt-001", f.now());
  const path = join(repository.directory, PROFILE_HASH, `${operation.operationId}.json`);
  const before = await readFile(path, "utf8");
  const options = { stateRoot: temporary.root, ids: { next: () => REQUEST_ID } };
  const connection = await connectMcp(options);
  t.after(connection.close);

  for (const action of ["status", "resume"] as const) {
    const argv = ["gasless", "usdt", action, "--profile-hash", PROFILE_HASH, "--operation", operation.operationId];
    const cli = await runCli(argv, {}, options);
    const mcpResult = await connection.client.callTool({
      name: `apn_gasless_usdt_${action}`,
      arguments: { profile_hash: PROFILE_HASH, operation: operation.operationId },
    });
    const mcp = decode(mcpResult);
    assert.equal(cli.ok, true);
    assert.equal(mcpResult.content[0]?.type, "text");
    if (mcpResult.content[0]?.type !== "text") throw new Error("expected one text MCP result");
    assert.equal(mcpResult.content[0].text, JSON.stringify(cli));
    assert.deepEqual(mcp, cli);
    assert.equal(await readFile(path, "utf8"), before);
  }
});

test("MCP USDT status/resume reject invalid profile hashes and do not create missing state", async t => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const absentRoot = join(temporary.root, "missing-usdt-state");
  const connection = await connectMcp({ stateRoot: absentRoot, ids: { next: () => REQUEST_ID } });
  t.after(connection.close);

  for (const action of ["status", "resume"] as const) {
    const invalid = await connection.client.callTool({
      name: `apn_gasless_usdt_${action}`,
      arguments: { profile_hash: "A".repeat(64), operation: "b".repeat(64) },
    });
    assert.equal(decode(invalid).error?.code, "APN_INVALID_INPUT");
    const missing = await connection.client.callTool({
      name: `apn_gasless_usdt_${action}`,
      arguments: { profile_hash: PROFILE_HASH, operation: "b".repeat(64) },
    });
    assert.equal(decode(missing).error?.code, "APN_OPERATION_NOT_FOUND");
  }
  await assert.rejects(stat(absentRoot), { code: "ENOENT" });
});

test("a missing USDT runtime service is classified as capability unavailable", async t => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const core = new ApnCore({ state: new StateStore(temporary.root), ids: { next: () => REQUEST_ID } });
  for (const command of ["gasless.usdt.status", "gasless.usdt.resume"] as const) {
    const result = await core.execute({ command, profileHash: PROFILE_HASH, operationId: "b".repeat(64) });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "APN_PROVIDER_CAPABILITY_UNAVAILABLE");
    assert.equal(result.error?.details?.reason, "gasless_usdt_command_runtime_unavailable");
  }
});

async function connectMcp(options: Parameters<typeof createMcpServer>[0]) {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "gasless-usdt-mcp-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

function decode(result: Awaited<ReturnType<Client["callTool"]>>): OutputEnvelope {
  assert.equal(result.content.length, 1);
  const content = result.content[0];
  assert.equal(content?.type, "text");
  if (content?.type !== "text") throw new Error("expected one text MCP result");
  const parsed = JSON.parse(content.text) as OutputEnvelope;
  assert.deepEqual(result.structuredContent, parsed);
  assert.equal(result.isError, !parsed.ok);
  return parsed;
}
