import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ApnCore } from "../../../src/core.js";
import { sha256 } from "../../../src/canonical.js";
import type { GaslessTransport } from "../../../src/gasless/https.js";
import type { GaslessIntent } from "../../../src/gasless/model.js";
import { gaslessAsset, gaslessDeployment } from "../../../src/gasless/registry.js";
import { GaslessRpc, gaslessBalanceSlot, withGaslessRpcInvocation } from "../../../src/gasless/rpc.js";
import { gaslessUserOperationHash } from "../../../src/gasless/wire.js";
import { gaslessFixture } from "../gasless-helpers.js";

type Json = Record<string, any>;
const RPC_URL = "https://rpc.example/base";
const BUNDLER_URL = "https://bundler.example/base";
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

/** Entire production RPC path; all network replies and wallet secrets are fixtures. */
export async function bundledGaslessFixture(root: string) {
  const s = await gaslessFixture(root), row = gaslessDeployment(8453), asset = gaslessAsset(8453, row.token);
  const balanceLayoutSlot = gaslessBalanceSlot(s.account.address, asset.balanceLayout!.mappingSlotAtomic);
  const captured = JSON.parse(await readFile(resolve("tests/core/gasless-fixtures/deployment-base.json"), "utf8")) as Json;
  const additional = JSON.parse(await readFile(resolve("tests/core/gasless-fixtures/bundler-runtime-code.json"), "utf8")) as Json;
  const runtimes = [captured.token.proxyRuntime, captured.token.implementationRuntime,
    captured.token.signatureCheckerRuntime, captured.entryPointRuntime, captured.delegateRuntime,
    captured.paymasterProxyRuntime, captured.paymasterImplementationRuntime];
  const codes = new Map<string, string>(runtimes.filter((r: Json) => r.raw !== undefined)
    .map((r: Json) => [r.address.toLowerCase(), r.raw]));
  for (const r of additional.codes as Json[]) codes.set(r.address.toLowerCase(), r.code as string);
  const blockHash = `0x${sha256("bundler-budget-block")}`;
  const at = { number: "0x64", hash: blockHash, timestamp: `0x${Math.floor(s.now.getTime() / 1000).toString(16)}`,
    baseFeePerGas: "0xf4240" };
  const calls: Array<{ method: string; bundler: boolean; afterApproval: boolean }> = [];
  const estimates: unknown[][] = [];
  let approved = false, limit = 20, intent: GaslessIntent | undefined;
  let fault: "" | "chain" | "entrypoint" | "balance" | "allowance" | "nonce" | "fees" | "decimals" | "layout" = "";
  let batchReply: (rows: Json[]) => unknown = rows => rows;
  let feeQuote: unknown;
  const transport: GaslessTransport = { request: async (endpoint, method, body) => {
    assert.equal(method, "POST"); assert.notEqual(body, null);
    const request = JSON.parse(body!) as Json | Json[], bundler = endpoint === BUNDLER_URL;
    assert.ok(bundler || endpoint === RPC_URL);
    calls.push({ method: Array.isArray(request) ? "read_only_batch" : request.method, bundler, afterApproval: approved });
    if (bundler && calls.filter(c => c.bundler).length > limit) return { status: 429, body: "fixture limit" };
    if (Array.isArray(request)) {
      if (bundler) assert.equal(request.length, 3);
      else assert.ok(request.length >= 2);
      const rows = request.map(row => ({ jsonrpc: "2.0", id: row.id, result: response(row.method, row.params) }));
      return { status: 200, body: JSON.stringify(bundler ? batchReply(rows) : rows) };
    }
    const result = response(request.method, request.params as readonly unknown[]);
    return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) };
  } };
  function response(method: string, params: readonly unknown[]): unknown {
    if (method === "eth_chainId") return fault === "chain" ? "0x1" : "0x2105";
    if (method === "eth_supportedEntryPoints") return fault === "entrypoint" ? [] : [row.entryPoint];
    if (method === "pimlico_getUserOperationGasPrice") return feeQuote ?? Object.fromEntries(
      ["slow", "standard", "fast"].map((name, n) => {
        const priority = fault === "fees" ? 1_000_000_000n : BigInt(200_000 + n * 50_000);
        return [name, { maxFeePerGas: `0x${(2_000_000n + priority).toString(16)}`,
          maxPriorityFeePerGas: `0x${priority.toString(16)}` }];
      }));
    if (method === "eth_getBlockByNumber") { assert.ok(["latest", "safe", "0x64"].includes(params[0] as string)); return at; }
    if (method === "eth_maxPriorityFeePerGas") return "0x186a0";
    if (method === "eth_getBalance") return "0x0";
    if (method === "eth_getTransactionCount") return "0x1";
    if (method === "eth_getCode") {
      if ((params[0] as string).toLowerCase() === s.account.address.toLowerCase()) return "0x";
      const code = codes.get((params[0] as string).toLowerCase()); assert.ok(code); return code;
    }
    if (method === "eth_getStorageAt") {
      const read = row.reads.find(r => r.kind === "storage" && r.address === params[0] && r.data === params[1]);
      if (read) return read.expected;
      // The mirror estimate measures the row's balance-layout claim before overriding it.
      assert.equal(params[0], asset.token); assert.equal(params[1], balanceLayoutSlot);
      return word(fault === "layout" ? 1n : fault === "balance" ? 0n : 100_000_000n);
    }
    if (method === "eth_call") {
      const call = params[0] as Json, data = call.data as string;
      if (data.startsWith("0x313ce567")) return word(fault === "decimals" ? 18n : BigInt(asset.decimals));
      if (data.startsWith("0x70a08231")) return word(fault === "balance" ? 0n : 100_000_000n);
      if (data.startsWith("0xdd62ed3e")) return word(fault === "allowance" ? 1n : 0n);
      if (data.startsWith("0x7ecebe00")) return word(fault === "nonce" ? 8n : 7n);
      if (data.startsWith("0x35567e1a")) return word(9n);
      if (data === "0x5c975abb" || data.startsWith("0xe877a526")) return word(0n);
      if (data === "0x1c704f2e") return word(35_000n);
      if (data === "0x37876f0d") return word(100n);
      if (data === "0x0fdb11cf") return word(2_500_000_000n);
      const read = row.reads.find(r => r.kind === "call" && r.address === call.to && r.data === data);
      assert.ok(read); return read.expected;
    }
    if (method === "eth_estimateUserOperationGas") { estimates.push([...params]); } 
    if (method === "eth_estimateUserOperationGas") return { verificationGasLimit: "0x15f90", callGasLimit: "0x30d40",
      paymasterVerificationGasLimit: "0x2bf20", paymasterPostOpGasLimit: "0x88b8", preVerificationGas: "0x222e0" };
    if (method === "eth_sendUserOperation") { assert.ok(intent); return gaslessUserOperationHash(intent, params[0] as never); }
    if (method === "eth_getUserOperationReceipt" || method === "eth_getUserOperationByHash") return null;
    if (method === "eth_getLogs") return [];
    throw new Error(`Unexpected fixture RPC method: ${method}`);
  }
  const rpc = new GaslessRpc(8453, RPC_URL, BUNDLER_URL, transport);
  const confirm = s.approval.confirm.bind(s.approval);
  s.approval.confirm = async input => { approved = true; return await confirm(input); };
  const core = new ApnCore({ state: s.state, gasless: { ...s.dependencies, rpcFor: () => rpc },
    clock: { now: () => new Date(s.now) }, wait: s.wait });
  const execute = core.execute.bind(core);
  core.execute = async request => await withGaslessRpcInvocation(async () => await execute(request));
  return { ...s, core, rpc, calls, estimates, setLimit: (value: number) => { limit = value; },
    setFault: (value: typeof fault) => { fault = value; },
    setBatchReply: (value: typeof batchReply) => { batchReply = value; },
    setFeeQuote: (value: unknown) => { feeQuote = value; },
    prepare: async () => {
      const result = await core.execute({ command: "gasless.transfer.prepare", profile: s.profile,
        request: s.request, idempotencyKey: "bundler-request-budget-0001" });
      assert.equal(result.ok, true, result.error?.message);
      const id = (result.operation as Json).operation_id as string;
      const operation = await s.record(id); intent = operation.intent;
      return { id, operation };
    } };
}
