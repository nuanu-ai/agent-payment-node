import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { bindArgv } from "../../src/command-binder.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { SUNSWAP_V2_KEYLESS_MECHANISM_PIN } from "../../src/swap/sunswap-tron/mechanism.js";
import { REFUSING_SWAP_APPROVAL } from "../../src/swap/uniswap-v3/runtime-factory.js";
import { temporaryState } from "./helpers.js";
import { AMOUNT, PROFILE, sunSwapFlow, sunSwapPolicy } from "./sunswap-tron-runtime-helpers.js";

const prepare = async (f: Awaited<ReturnType<typeof sunSwapFlow>>, key: string) =>
  await f.runtime.prepare({ profile: PROFILE, quoteHash: (await f.quote()).quoteHash, idempotencyKey: key }, f.clock.now());

test("one foreground command shows the exact screen, takes the typed code after 45 seconds, and broadcasts exactly once", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await sunSwapFlow(temporary.root, { typingMs: 45_000 });
  const prepared = await prepare(f, "sunswap-runtime-0001");
  assert.equal(prepared.state, "awaiting_approval"); assert.equal(prepared.approvalCapAtomic, "0");
  assert.equal(prepared.mechanismDigest, swapMechanismDigest(SUNSWAP_V2_KEYLESS_MECHANISM_PIN));
  const sent = await f.runtime.approveAndExecute(prepared.operationId, f.clock.now());
  assert.equal(sent.state, "submitted"); assert.equal(f.rpc.broadcasts.length, 1);
  for (const line of ["You send: 5 TRX (5000000 SUN), native, exact input", "Expected in: 1.671577 USDT", "Minimum in: 1.66322 USDT",
    "Slippage cap: 50 basis points", "Price impact vs pair reserve spot, including the 0.3% LP fee: ",
    "Energy estimate: 157354 energy at 100 SUN = 15.7354 TRX", "fee_limit: 30 TRX (30000000 SUN)", "Bandwidth budget: ",
    "Maximum TRX debit: ", "Deadline: ", "Reference block: 86344586", "Token approval cap: 0", "Pool: TFGDbUyP8xez44C76fin3bn3Ss6jugoUwJ",
    "router: SunSwap V2 TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax", `Mechanism: ${prepared.mechanismDigest}`, "broadcasts exactly once"]) {
    assert.ok(f.printed().includes(line), line);
  }
  const signed = f.rpc.broadcasts[0]!;
  assert.equal((signed.signature as string[]).length, 1); assert.equal(f.rpc.calls.filter((row) => row.method === "wallet/broadcasttransaction").length, 1);
  const binding = JSON.parse(await readFile(join(temporary.root, "sunswap-execution-bindings", sent.ownerProfileHash, `${sent.operationId}.json`), "utf8"));
  assert.equal(binding.submissionMarkerHash, sent.submissionMarker?.markerHash); assert.equal(binding.txID, signed.txID);
  assert.equal(JSON.stringify(binding).includes((signed.signature as string[])[0]!), false);
  f.rpc.outcome = "pending";
  const again = await f.runtime.execute(sent.operationId, f.clock.now());
  assert.equal(again.state, "submitted"); assert.equal(f.rpc.broadcasts.length, 1, "execute after the marker only observes");
  assert.equal((await f.runtime.status(sent.operationId, f.clock.now())).integrityHash, again.integrityHash);
  f.rpc.outcome = "success";
  const final = await f.runtime.status(sent.operationId, f.clock.now());
  assert.equal(final.state, "finalized"); assert.equal(final.receiptProof?.transactionHash, signed.txID); assert.equal(f.rpc.broadcasts.length, 1);
  assert.equal(await f.usage(), AMOUNT);
});

test("a solidified REVERT becomes failed_confirmed_revert and releases the reservation without rebroadcasting", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await sunSwapFlow(temporary.root);
  const sent = await f.runtime.approveAndExecute((await prepare(f, "sunswap-runtime-0002")).operationId, f.clock.now());
  assert.equal(await f.usage(), AMOUNT);
  f.rpc.outcome = "revert";
  const reverted = await f.runtime.status(sent.operationId, f.clock.now());
  assert.equal(reverted.state, "failed_confirmed_revert"); assert.equal(reverted.usageLease?.state, "failed_confirmed_revert");
  assert.equal(reverted.failureProofHash, reverted.receiptProof?.receiptHash); assert.equal(f.rpc.broadcasts.length, 1);
  assert.equal(await f.usage(), "0");
  assert.equal((await f.runtime.status(sent.operationId, f.clock.now())).integrityHash, reverted.integrityHash);
});

test("a lost broadcast answer is unknown_finality; status and execute only observe until the receipt is solidified", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await sunSwapFlow(temporary.root); f.rpc.broadcastLost = true;
  const sent = await f.runtime.approveAndExecute((await prepare(f, "sunswap-runtime-0003")).operationId, f.clock.now());
  assert.equal(sent.state, "unknown_finality"); assert.equal(f.rpc.broadcasts.length, 1);
  for (const read of [() => f.runtime.execute(sent.operationId, f.clock.now()), () => f.runtime.status(sent.operationId, f.clock.now())]) {
    assert.equal((await read()).state, "unknown_finality");
  }
  f.rpc.outcome = "success";
  assert.equal((await f.runtime.status(sent.operationId, f.clock.now())).state, "finalized"); assert.equal(f.rpc.broadcasts.length, 1);
});

test("a wrong code refuses before any reservation, and a pre-send refusal releases the reservation unsigned", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const wrong = await sunSwapFlow(temporary.root, { typed: (code) => code.slice(0, 5) + (code.endsWith("0") ? "1" : "0") });
  const refused = await prepare(wrong, "sunswap-runtime-0004");
  await assert.rejects(wrong.runtime.approveAndExecute(refused.operationId, wrong.clock.now()),
    (error: any) => error.code === "APN_NATIVE_REJECTED" && error.details?.nativeCode === "APN_APPROVAL_REFUSED");
  assert.equal((await new SwapOperationRepository(temporary.root).loadAny(refused.operationId))?.state, "awaiting_approval");
  assert.equal(wrong.rpc.broadcasts.length, 0); assert.equal(await wrong.usage(), "0");
  const other = await temporaryState(); t.after(other.cleanup);
  const moved = await sunSwapFlow(other.root), op = await prepare(moved, "sunswap-runtime-0005");
  moved.rpc.simulation = "revert";
  await assert.rejects(moved.runtime.approveAndExecute(op.operationId, moved.clock.now()),
    (error: any) => error.details?.reason === "sunswap_output_below_minimum");
  const released = await new SwapOperationRepository(other.root).loadAny(op.operationId);
  assert.equal(released?.state, "failed_before_effect"); assert.equal(released?.usageLease?.state, "failed_before_effect");
  assert.equal(released?.submissionMarker, null); assert.equal(moved.rpc.broadcasts.length, 0); assert.equal(await moved.usage(), "0");
});

test("an expired window refuses consent or releases the approved reservation before any signature", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const slow = await sunSwapFlow(temporary.root, { typingMs: 301_000 });
  const late = await prepare(slow, "sunswap-runtime-0006");
  await assert.rejects(slow.runtime.approveAndExecute(late.operationId, slow.clock.now()), (error: any) => error.details?.reason === "swap_approval_tamper");
  assert.equal((await new SwapOperationRepository(temporary.root).loadAny(late.operationId))?.state, "awaiting_approval");
  const other = await temporaryState(); t.after(other.cleanup);
  const f = await sunSwapFlow(other.root), op = await prepare(f, "sunswap-runtime-0007");
  assert.equal((await f.runtime.approve(op.operationId, f.clock.now())).state, "reserved"); assert.equal(await f.usage(), AMOUNT);
  f.advance(300_000);
  const expired = await f.runtime.execute(op.operationId, f.clock.now());
  assert.equal(expired.state, "failed_before_effect"); assert.equal(expired.usageLease?.state, "failed_before_effect");
  assert.equal(f.rpc.broadcasts.length + slow.rpc.broadcasts.length, 0); assert.equal(await f.usage(), "0");
});

test("owner admission: missing policy, policy drift and a different local TRON account all refuse unsigned", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const none = await sunSwapFlow(temporary.root, { policy: async () => null });
  await assert.rejects(prepare(none, "sunswap-runtime-0008"), (error: any) => error.details?.reason === "swap_owner_admission_required");
  let active = sunSwapPolicy(new Date(), { trx: AMOUNT, trxDaily: "10000000" });
  const other = await temporaryState(); t.after(other.cleanup);
  const drift = await sunSwapFlow(other.root, { policy: async () => active }), op = await prepare(drift, "sunswap-runtime-0009");
  active = sunSwapPolicy(new Date(), { trx: AMOUNT, trxDaily: "10000000" }, "sunswap-runtime.2");
  await assert.rejects(drift.runtime.approveAndExecute(op.operationId, drift.clock.now()), (error: any) => error.details?.reason === "swap_policy_drift");
  const third = await temporaryState(); t.after(third.cleanup);
  const hidden = await sunSwapFlow(third.root), hiddenOp = await prepare(hidden, "sunswap-runtime-0010");
  hidden.hideAccount(true);
  await assert.rejects(hidden.runtime.approveAndExecute(hiddenOp.operationId, hidden.clock.now()), (error: any) => error.details?.reason === "swap_owner_account");
  assert.equal(none.rpc.broadcasts.length + drift.rpc.broadcasts.length + hidden.rpc.broadcasts.length, 0);
  assert.equal(hidden.printed(), "", "no approval screen before admission");
});

test("per-operation and daily caps come from the owner policy and the shared usage ledger", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const small = await sunSwapFlow(temporary.root, { caps: { trx: "4999999", trxDaily: "10000000" } });
  await assert.rejects(prepare(small, "sunswap-runtime-0011"), { code: "APN_OPERATION_BLOCKED" });
  const other = await temporaryState(); t.after(other.cleanup);
  const daily = await sunSwapFlow(other.root, { caps: { trx: AMOUNT, trxDaily: AMOUNT } });
  const first = await prepare(daily, "sunswap-runtime-0012"), second = await prepare(daily, "sunswap-runtime-0013");
  assert.equal((await daily.runtime.approveAndExecute(first.operationId, daily.clock.now())).state, "submitted");
  await assert.rejects(daily.runtime.approveAndExecute(second.operationId, daily.clock.now()), { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await new SwapOperationRepository(other.root).loadAny(second.operationId))?.state, "awaiting_approval");
  assert.equal(daily.rpc.broadcasts.length, 1); assert.equal(await daily.usage(), AMOUNT);
});

test("the installed factory wires the keyless runtime and MCP hands approve and execute to the foreground CLI", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const core = createApnCore(bindArgv(["swap", "tron", "sunswap", "inventory"]), { stateRoot: temporary.root });
  assert.notEqual(core.context.sunswapRuntime, undefined);
  const inventory = await core.execute({ command: "swap.sunswap.inventory" });
  assert.equal((inventory.data as any).execution, "foreground_cli_after_owner_admission");
  assert.equal((inventory.data as any).keyless.mechanismDigest, swapMechanismDigest(SUNSWAP_V2_KEYLESS_MECHANISM_PIN));
  await assert.rejects(REFUSING_SWAP_APPROVAL.approve({} as never), { code: "APN_FOREGROUND_APPROVAL_REQUIRED" });
  const server = createMcpServer({ stateRoot: temporary.root });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "apn-sunswap-mcp-test", version: "1.0.0" }); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const call = async (name: string, args: Record<string, unknown>): Promise<OutputEnvelope> => {
    const result = await client.callTool({ name, arguments: args }), content = result.content[0];
    if (content?.type !== "text") throw new Error("expected text");
    return JSON.parse(content.text) as OutputEnvelope;
  };
  const listed = await call("apn_swap_tron_sunswap_inventory", {});
  assert.equal((listed.data as any).keyless.mechanismPin.constructorKind, "sdk"); assert.equal((listed.data as any).admitted, false);
  const operation = "c".repeat(64);
  for (const action of ["approve", "execute"]) {
    const refused = await call(`apn_swap_tron_sunswap_${action}`, { operation });
    assert.equal(refused.ok, false); assert.equal(refused.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
    assert.equal(refused.error?.details?.cli_handoff, `apn swap tron sunswap ${action} --operation ${operation}`);
  }
  assert.equal((await call("apn_swap_tron_sunswap_status", { operation })).error?.code, "APN_OPERATION_NOT_FOUND");
});
