import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { bindMcpInput } from "../../src/command-binder.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { runCli } from "../../src/cli.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import type { ProfilePolicyApprovalPort } from "../../src/policy-approval.js";
import { RECIPIENT, TestClock, temporaryState } from "./helpers.js";
import {
  ExactX402Native,
  QueuedHttp,
  RecoveryRpc,
  X402_TEST_ACCOUNT,
  challengeObservation,
} from "./x402-helpers.js";
import { X402_URL } from "./x402-vectors.js";

const MASTER = Buffer.from("66".repeat(32), "hex");

class FixedWrappingSecret implements WrappingSecretPort {
  async load(): Promise<Buffer> { return Buffer.from(MASTER); }
  async create(): Promise<Buffer> { return Buffer.from(MASTER); }
}

const ALLOW_POLICY: ProfilePolicyApprovalPort = { approve: async () => {} };

test("payment MCP schemas project the existing catalog scalar contracts", () => {
  const tools = new Map(projectMcpTools().map((tool) => [tool.name, tool.inputSchema.properties]));
  const property = (tool: string, field: string): Record<string, unknown> => {
    const schema = tools.get(tool)?.[field];
    assert.equal(typeof schema, "object");
    assert.notEqual(schema, null);
    return schema as Record<string, unknown>;
  };
  assert.equal(property("apn_pay_transfer_prepare", "to").pattern, "^0x[0-9a-fA-F]{40}$");
  assert.equal(
    property("apn_pay_transfer_prepare", "amount_usdc").pattern,
    "^(?:[1-9][0-9]*(?:\\.[0-9]{0,5}[1-9])?|0\\.[0-9]{0,5}[1-9])$",
  );
  assert.equal(
    property("apn_x402_fetch_prepare", "idempotency_key").pattern,
    "^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$",
  );
  assert.equal(property("apn_operation_status", "operation").pattern, "^[a-f0-9]{64}$");
  assert.equal(
    property("apn_operation_resume", "wait_seconds").pattern,
    "^(?:[1-9]|[1-9][0-9]|[12][0-9]{2}|300)$",
  );
  assert.equal(
    property("apn_operation_recover_provider_request", "provider_request_id").pattern,
    "^[A-Za-z0-9._:-]{1,256}$",
  );
});

test("all nine payment tools bind through the shared catalog binder", () => {
  const tools = new Map(projectMcpTools().map((tool) => [tool.name, tool.command]));
  const operation = "a".repeat(64);
  const bind = (name: string, input: Record<string, unknown>) => {
    const command = tools.get(name);
    assert.notEqual(command, undefined);
    return bindMcpInput(command!, input);
  };
  assert.deepEqual(bind("apn_x402_inspect", { url: X402_URL }), {
    request: { command: "x402.inspect", url: X402_URL },
  });
  assert.deepEqual(bind("apn_x402_fetch_prepare", {
    profile: "default", url: X402_URL, idempotency_key: "x402-bind-001",
    rpc_url: "https://rpc.example", max_amount_atomic: "2000000",
  }), {
    request: {
      command: "x402.fetch.prepare", profile: "default", url: X402_URL,
      idempotencyKey: "x402-bind-001", maxAmountAtomic: "2000000",
    },
    rpcUrl: "https://rpc.example",
  });
  assert.deepEqual(bind("apn_x402_fetch_approve", {
    operation, rpc_url: "https://rpc.example",
  }), { request: { command: "x402.fetch.approve", operationId: operation }, rpcUrl: "https://rpc.example" });
  assert.deepEqual(bind("apn_pay_transfer_prepare", {
    profile: "default", idempotency_key: "direct-bind-001", to: RECIPIENT,
    amount_usdc: "1.25", rpc_url: "https://rpc.example",
  }), {
    request: {
      command: "transfer.prepare", profile: "default", idempotencyKey: "direct-bind-001",
      recipient: RECIPIENT, amount: "1.25",
    },
    rpcUrl: "https://rpc.example",
  });
  assert.deepEqual(bind("apn_pay_transfer_approve", {
    operation, rpc_url: "https://rpc.example",
  }), { request: { command: "transfer.approve", operationId: operation }, rpcUrl: "https://rpc.example" });
  assert.deepEqual(bind("apn_operation_status", { operation }), {
    request: { command: "operation.status", operationId: operation },
  });
  assert.deepEqual(bind("apn_operation_resume", {
    operation, rpc_url: "https://rpc.example", wait_seconds: "300",
  }), {
    request: { command: "operation.resume", operationId: operation, waitSeconds: 300 },
    rpcUrl: "https://rpc.example",
  });
  assert.deepEqual(bind("apn_operation_recover_provider_request", {
    operation, provider_request_id: "request-01234567",
  }), {
    request: {
      command: "operation.recover-provider-request",
      operationId: operation,
      providerRequestId: "request-01234567",
    },
  });
  assert.deepEqual(bind("apn_receipt_get", { operation }), {
    request: { command: "receipt.get", operationId: operation },
  });
});

test("MCP x402 uses prior policy and preserves durable idempotency, ambiguity, status, resume and restart", async (t) => {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const wrappingSecret = new FixedWrappingSecret();
  const native = new ExactX402Native();
  const rpc = new RecoveryRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: X402_TEST_ACCOUNT.address };
  const http = new QueuedHttp([
    challengeObservation(),
    challengeObservation(),
    new Error("PAID_REQUEST_PROTECTED_CANARY"),
  ]);
  const clock = new TestClock();
  const runtime = { stateRoot: temporary.root, wrappingSecret, native, rpc, http, clock };
  assert.equal((await runCli(["wallet", "ensure"], {}, runtime)).ok, true);
  native.calls.length = 0;

  let connection = await connectMcp(runtime);
  const missingPolicy = decode(await connection.client.callTool({
    name: "apn_x402_fetch_prepare",
    arguments: {
      profile: "default", url: X402_URL, idempotency_key: "x402-mcp-missing-001",
      rpc_url: "https://rpc.example", max_amount_atomic: "2000000",
    },
  }));
  assert.equal(missingPolicy.error?.code, "APN_WALLET_POLICY_REQUIRED");
  assert.equal(http.calls.length, 0);
  assert.equal(native.calls.length, 0);

  const policy = await runCli([
    "wallet", "policy", "set", "--profile", "default",
    "--max-balance-usdc-atomic", "100000000", "--max-x402-amount-atomic", "10000000",
    "--max-balance-eth-wei", "2000000000000000000",
  ], {}, { stateRoot: temporary.root, wrappingSecret, policyApproval: ALLOW_POLICY });
  assert.equal(policy.ok, true, JSON.stringify(policy));

  const inspected = decode(await connection.client.callTool({
    name: "apn_x402_inspect", arguments: { url: X402_URL },
  }));
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.equal(inspected.operation, null);
  assert.equal(native.calls.length, 0);
  assert.equal(rpc.x402PrepareCalls, 0);

  const prepareArguments = {
    profile: "default", url: X402_URL, idempotency_key: "x402-mcp-durable-001",
    rpc_url: "https://rpc.example", max_amount_atomic: "2000000",
  };
  const prepared = decode(await connection.client.callTool({
    name: "apn_x402_fetch_prepare", arguments: prepareArguments,
  }));
  const operation = prepared.operation as { readonly operationId?: unknown; readonly state?: unknown };
  assert.equal(operation.state, "awaiting_approval");
  assert.equal(typeof operation.operationId, "string");
  const operationId = operation.operationId as string;
  assert.equal(native.calls.length, 0, "prepare cannot authorize");
  assert.equal(http.calls.length, 2);

  const duplicate = decode(await connection.client.callTool({
    name: "apn_x402_fetch_prepare", arguments: prepareArguments,
  }));
  assert.equal((duplicate.operation as { readonly operationId: string }).operationId, operationId);
  assert.equal(http.calls.length, 2, "duplicate intent must converge without another seller read");
  const conflict = decode(await connection.client.callTool({
    name: "apn_x402_fetch_prepare",
    arguments: { ...prepareArguments, url: "https://seller.example/different" },
  }));
  assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT");
  assert.equal(http.calls.length, 2);

  const approved = decode(await connection.client.callTool({
    name: "apn_x402_fetch_approve",
    arguments: { operation: operationId, rpc_url: "https://rpc.example" },
  }));
  assert.equal((approved.operation as { readonly state: string }).state, "authorized_not_sent");
  assert.deepEqual(native.calls.map((call) => call.operation), ["x402Exact.approveAndAuthorize"]);
  assert.equal(http.calls.length, 2, "approve authorizes but resume owns the paid request");
  const duplicateApproval = decode(await connection.client.callTool({
    name: "apn_x402_fetch_approve",
    arguments: { operation: operationId, rpc_url: "https://rpc.example" },
  }));
  assert.equal(duplicateApproval.error?.code, "APN_OPERATION_BLOCKED");
  assert.deepEqual(native.calls.map((call) => call.operation), ["x402Exact.approveAndAuthorize"]);
  assert.equal(http.calls.length, 2, "repeated approve cannot authorize or send again");

  const portCounts = [native.calls.length, http.calls.length, rpc.x402Calls.length, rpc.balanceCalls];
  const status = decode(await connection.client.callTool({
    name: "apn_operation_status", arguments: { operation: operationId },
  }));
  assert.equal((status.operation as { readonly state: string }).state, "authorized_not_sent");
  const unavailable = decode(await connection.client.callTool({
    name: "apn_receipt_get", arguments: { operation: operationId },
  }));
  assert.equal(unavailable.error?.code, "APN_RECEIPT_NOT_FOUND");
  assert.deepEqual([native.calls.length, http.calls.length, rpc.x402Calls.length, rpc.balanceCalls], portCounts);

  const resumed = decode(await connection.client.callTool({
    name: "apn_operation_resume",
    arguments: { operation: operationId, rpc_url: "https://rpc.example" },
  }));
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { readonly state: string }).state, "effect_unknown");
  assert.equal(http.calls.length, 3);
  assert.equal(JSON.stringify(resumed).includes("PAID_REQUEST_PROTECTED_CANARY"), false);

  const balancesBeforeBlocked = rpc.balanceCalls;
  const blocked = decode(await connection.client.callTool({
    name: "apn_pay_transfer_prepare",
    arguments: {
      profile: "default", idempotency_key: "cross-kind-block-001", to: RECIPIENT,
      amount_usdc: "1.25", rpc_url: "https://rpc.example",
    },
  }));
  assert.equal(blocked.error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(rpc.balanceCalls, balancesBeforeBlocked, "ambiguous x402 must block a second profile effect before RPC");

  await connection.close();
  connection = await connectMcp(runtime);
  t.after(connection.close);
  const restarted = decode(await connection.client.callTool({
    name: "apn_operation_status", arguments: { operation: operationId },
  }));
  assert.equal((restarted.operation as { readonly state: string }).state, "effect_unknown");
  assert.equal(http.calls.length, 3);
  assert.equal(native.calls.length, 2, "resume may retrieve only the same stored authorization material");
});

async function connectMcp(options: McpRuntimeOptions): Promise<{
  readonly client: Client;
  close(): Promise<void>;
}> {
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-mcp-payment-test", version: "1.0.0" });
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
  assert.equal(parsed.version, "apn.cli.v1");
  return parsed;
}
