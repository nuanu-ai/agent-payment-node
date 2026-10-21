import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import test, { type TestContext } from "node:test";
import type { Hex } from "viem";
import { hashObject } from "../../src/canonical.js";
import { BASE_USDC } from "../../src/constants.js";
import { takeMetaMaskNativeProcessFailureDiagnostic, NodeMetaMaskProcessRunner } from "../../src/metamask-process-runner.js";
import { providerX402ReadPort } from "../../src/provider-x402-evidence.js";
import { HttpsBaseRpc } from "../../src/rpc.js";
import { executeStargateV2NativeEth, prepareStargateV2NativeEth, stargateV2NativeCanonicalReceipt } from "../../src/stargate-v2/native-execution.js";
import { confirmedStargateSourceReceipt } from "../../src/stargate-v2/native-runtime.js";
import { BLOCK, sourceReceipt, setup, request, AMOUNT, FEE } from "./stargate-native-support.js";

/** QA 0.5.60: provider x402 recovery reads through a Base USDC binding; deadline and native fee follow-ups. */
const PAYER = "0xc48ae87E2f0Dbd94b7c089C1A0217c9b23E55032";

function mockHttps(t: TestContext, responder: (request: { method: string; params: unknown[] }) => unknown) {
  const seen: { method: string; params: unknown[] }[] = [];
  t.mock.method(https, "request", (_endpoint: URL, _options: unknown, receive: (response: unknown) => void) => {
    const request = new EventEmitter() as any;
    request.setTimeout = () => request;
    request.end = (body: string) => {
      queueMicrotask(() => {
        const parsed = JSON.parse(body), batch = Array.isArray(parsed), items = batch ? parsed : [parsed];
        const results = items.map((item: any) => { seen.push({ method: item.method, params: item.params });
          return { jsonrpc: "2.0", id: item.id, result: responder(item) }; });
        const raw = JSON.stringify(batch ? results : results[0]), response = new EventEmitter() as any;
        response.statusCode = 200; response.headers = { "content-length": String(Buffer.byteLength(raw)) };
        response.resume = () => { response.emit("end"); };
        receive(response); response.emit("data", Buffer.from(raw)); response.emit("end");
      });
      return request;
    };
    return request;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return seen;
}

test("provider x402 evidence reads the production RPC through an exact Base USDC binding", async (t) => {
  const seen = mockHttps(t, ({ method }) => {
    if (method === "eth_getLogs") return [];
    throw new Error(`unexpected ${method}`);
  });
  const unbound = new HttpsBaseRpc("https://8.8.8.8/base");
  const port = providerX402ReadPort(unbound);
  const logs = await port.getX402TransferLogs({ from: PAYER, fromBlock: "100", toBlock: "101" });
  assert.deepEqual(logs, { kind: "complete", logs: [] });
  const request = seen.find(entry => entry.method === "eth_getLogs");
  assert.equal(String((request?.params[0] as { address: string }).address).toLowerCase(), BASE_USDC.toLowerCase());
  await assert.rejects(unbound.getX402TransferLogs({ from: PAYER, fromBlock: "100", toBlock: "101" }), /binds no x402 network/u,
    "the unselected instance itself still refuses: only the bound port may read");
});

test("a native deadline that passed before the call carries the resolver deadline diagnostic; a malformed one does not", async () => {
  let launches = 0;
  const runner = new NodeMetaMaskProcessRunner(async () => "/TEST-no-sdk", () => { launches++; throw new Error("must not launch"); });
  let failure: unknown;
  try { await runner.runJson(["auth", "status", "--json"], 30000, new Date(Date.now() - 5).toISOString()); } catch (error) { failure = error; }
  assert.equal((failure as { code?: string }).code, "APN_OPERATION_BLOCKED");
  assert.deepEqual(takeMetaMaskNativeProcessFailureDiagnostic(failure), { stage: "sdk_resolver", code: "deadline", exitCode: null, signal: null,
    durationMs: 0, remainingMs: 0, stderrClass: "none", providerCode: "none" });
  assert.equal(takeMetaMaskNativeProcessFailureDiagnostic(failure), undefined);
  let distant: unknown;
  try { await runner.runJson(["auth", "status", "--json"], 30000, new Date(Date.now() + 120_000).toISOString()); } catch (error) { distant = error; }
  assert.equal((distant as { code?: string }).code, "APN_OPERATION_BLOCKED");
  assert.equal(takeMetaMaskNativeProcessFailureDiagnostic(distant), undefined, "a deadline beyond the window is invalid, not expired");
  assert.equal(launches, 0);
});

test("the native Stargate source receipt keeps gas used and effective gas price, and the receipt shows the actual fee and debit", async () => {
  const s = setup();
  s.ports = { ...s.ports, waitSourceReceipt: async (hash: Hex) => ({ ...sourceReceipt(hash), gasUsedAtomic: "90000", effectiveGasPriceAtomic: "2" }) };
  const prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-fee-0001" }), s.ports, s.journal);
  const observed = await executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal);
  const receipt = stargateV2NativeCanonicalReceipt(observed);
  assert.deepEqual(receipt.actualSourceFee, { gasUsedAtomic: "90000", effectiveGasPriceAtomic: "2",
    networkFeeAtomic: "180000", sourceDebitAtomic: (AMOUNT + FEE + 180000n).toString() });
  assert.ok(BigInt(receipt.actualSourceFee!.sourceDebitAtomic) <= BigInt(receipt.maximumDebitAtomic), "never above the consented ceiling");
  // Numbers outside the signed envelope (gas limit 100000, max fee 2) are not shown.
  for (const [gasUsedAtomic, effectiveGasPriceAtomic] of [["100001", "2"], ["90000", "3"]]) {
    const outside = { ...observed, sourceReceipt: { ...observed.sourceReceipt!, gasUsedAtomic, effectiveGasPriceAtomic } };
    const { integrityHash: _old, ...body } = outside;
    assert.equal(stargateV2NativeCanonicalReceipt({ ...body, integrityHash: hashObject(body) } as typeof observed).actualSourceFee, null);
  }
});

test("a record observed before the fee was kept gains it on its next observe, once, from the same receipt only", async () => {
  const s = setup(), prepared = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-fee-0002" }), s.ports, s.journal);
  const old = await executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal);
  assert.equal(stargateV2NativeCanonicalReceipt(old).actualSourceFee, null, "never the gas envelope in its place");
  let reads = 0;
  s.ports = { ...s.ports, waitSourceReceipt: async (hash: Hex) => { reads++; return { ...sourceReceipt(hash), gasUsedAtomic: "21000", effectiveGasPriceAtomic: "2" }; } };
  const enriched = await executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal);
  assert.deepEqual([enriched.phase, enriched.transitions.length, stargateV2NativeCanonicalReceipt(enriched).actualSourceFee?.networkFeeAtomic],
    ["observed", old.transitions.length, "42000"]);
  await executeStargateV2NativeEth(prepared.operationId, s.ports, s.journal);
  assert.equal(reads, 1, "a recorded fee is never read again");
  const other = setup(), first = await prepareStargateV2NativeEth(request({ idempotencyKey: "native-fee-0003" }), other.ports, other.journal);
  await executeStargateV2NativeEth(first.operationId, other.ports, other.journal);
  other.ports = { ...other.ports, waitSourceReceipt: async (hash: Hex) => ({ ...sourceReceipt(hash), blockHash: `0x${"99".repeat(32)}` as Hex,
    gasUsedAtomic: "21000", effectiveGasPriceAtomic: "3" }) };
  await assert.rejects(executeStargateV2NativeEth(first.operationId, other.ports, other.journal), { code: "APN_RPC_PROTOCOL" });
  assert.equal(other.journal.value?.sourceReceipt?.gasUsedAtomic, undefined);
  assert.equal(other.usage.at(-1), "finalized", "the hold settled before the fee read failed");
});

test("the source receipt reader takes both numbers from the RPC receipt or neither", async () => {
  const hash = `0x${"12".repeat(32)}` as Hex;
  const rpc = (receipt: Record<string, unknown>) => ({ call: async (method: string, params: readonly unknown[]) => {
    if (method === "eth_getTransactionReceipt") return { transactionHash: hash, status: "0x1", blockNumber: "0x14", blockHash: BLOCK, logs: [], ...receipt };
    if (method === "eth_getBlockByNumber") return params[0] === "safe" ? { number: "0x20", hash: `0x${"34".repeat(32)}` } : { number: "0x14", hash: BLOCK };
    throw new Error(`unexpected ${method}`);
  } });
  const full = await confirmedStargateSourceReceipt(rpc({ gasUsed: "0x51d08", effectiveGasPrice: "0x2e1cd95" }), hash, "safe");
  assert.deepEqual([full?.gasUsedAtomic, full?.effectiveGasPriceAtomic], ["335112", "48352661"]);
  for (const receipt of [{ gasUsed: "0x51d08" }, { gasUsed: "0x51d08", effectiveGasPrice: null }, { gasUsed: "0x051d08", effectiveGasPrice: "0x2e1cd95" }]) {
    const partial = await confirmedStargateSourceReceipt(rpc(receipt), hash, "safe");
    assert.deepEqual([partial?.status, partial?.gasUsedAtomic, partial?.effectiveGasPriceAtomic], ["success", undefined, undefined]);
  }
});
