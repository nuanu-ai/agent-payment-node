import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseTransaction } from "viem";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { ApnError } from "../../src/errors.js";
import { evmAmount, MAX_EVM_UINT, resolveEvmAsset } from "../../src/evm-asset.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import type { Address } from "../../src/model.js";
import { sealReceipt } from "../../src/state-integrity.js";
import { EVM_REQUEST, EVM_TOKEN, EvmApproval, EvmTestRpc, EvmWrappingSecret, evmCore } from "./evm-helpers.js";
import { temporaryState } from "./helpers.js";

test("generic CLI and MCP bind the same explicit core request without changing legacy commands", () => {
  const input = { profile: "default", chain: "eip155:8453", asset: EVM_TOKEN, decimals: "8", rpc_url: "https://rpc.example", to: EVM_REQUEST.recipient, amount: "1.25", max_fee_wei: EVM_REQUEST.maxFeeWei, idempotency_key: EVM_REQUEST.idempotencyKey };
  const tool = MCP_TOOLS.find((entry) => entry.name === "apn_pay_transfer_prepare_asset")!;
  const argv = ["pay", "transfer", "prepare-asset", ...Object.entries(input).flatMap(([name, value]) => [`--${name.replaceAll("_", "-")}`, value])];
  assert.deepEqual(bindArgv(argv), bindMcpInput(tool.command, input));
  assert.equal(bindArgv(argv).request.command, "transfer.prepare");
  assert.throws(() => bindMcpInput(tool.command, { ...input, chain: "eip155:1" }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bindMcpInput(tool.command, { ...input, decimals: "256" }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bindArgv(["pay", "transfer", "prepare", "--profile", "default"]));
  assert.ok(MCP_TOOLS.some((entry) => entry.name === "apn_wallet_balance_asset"));
});

test("EVM amount handling preserves 0..255 decimals and uint256 without implicit metadata or rounding", () => {
  for (const decimals of [0, 6, 8, 18, 255]) {
    const decimal = decimals === 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`;
    assert.equal(evmAmount(decimal, decimals).atomic, "1");
  }
  assert.equal(evmAmount(MAX_EVM_UINT.toString(), 0).atomic, MAX_EVM_UINT.toString());
  for (const amount of ["0", "-1", "1e3", "01", "1.000000001", (MAX_EVM_UINT + 1n).toString()]) assert.throws(() => evmAmount(amount, 8));
  assert.throws(() => resolveEvmAsset({ chainId: 8453, token: EVM_TOKEN }), { code: "APN_ASSET_METADATA_REQUIRED" });
  assert.throws(() => resolveEvmAsset({ chainId: 8453, token: EVM_TOKEN, decimals: 6 }, 8), { code: "APN_ASSET_MISMATCH" });
  assert.equal(resolveEvmAsset({ chainId: 8453, token: EVM_TOKEN, decimals: 0 }).decimalsSource, "caller");
});

for (const asset of ["native", EVM_TOKEN] as const) test(`Base ${asset === "native" ? "ETH" : "arbitrary ERC-20"} completes through encrypted custody and durable status/receipt`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  const wallet = await setup.core.wallet.ensure("default") as { address: Address };
  setup.rpc.sender = wallet.address;
  const request = { ...EVM_REQUEST, asset: { chainId: 8453 as const, token: asset }, amount: asset === "native" ? "0.000001" : "1.25" };
  const prepared = await setup.core.transfer.prepare(request) as { operation_id: string; state: string };
  assert.equal(prepared.state, "awaiting_approval");
  assert.equal(setup.approval.intents.length, 0);
  const balance = await setup.core.execute({ command: "wallet.balance", profile: "default", asset: request.asset });
  assert.equal(balance.ok, true);
  const calls = setup.rpc.genericBalanceCalls;
  assert.deepEqual(await setup.core.transfer.prepare(request), prepared);
  assert.equal(setup.rpc.genericBalanceCalls, calls);
  await assert.rejects(setup.core.transfer.prepare({ ...request, amount: "2" }), { code: "APN_IDEMPOTENCY_CONFLICT" });
  const approved = await setup.core.transfer.approve(prepared.operation_id) as { state: string };
  assert.equal(approved.state, "completed");
  const raw = setup.rpc.submissions[0]!;
  const transaction = parseTransaction(raw);
  assert.equal(transaction.chainId, 8453);
  assert.equal(transaction.value ?? 0n, asset === "native" ? 1000000000000n : 0n);
  assert.equal(transaction.to?.toLowerCase(), (asset === "native" ? EVM_REQUEST.recipient : asset).toLowerCase());
  assert.equal(setup.approval.intents.length, 1);
  const restarted = evmCore(temporary.root, setup.rpc, setup.wrapping);
  assert.deepEqual(await restarted.core.transfer.status(prepared.operation_id), approved);
  const receipt = await restarted.core.transfer.receipt(prepared.operation_id) as { state: string };
  assert.equal(receipt.state, "completed");
  await restarted.core.transfer.resume(prepared.operation_id);
  assert.equal(setup.rpc.submissions.length, 1);
  assert.equal(restarted.approval.intents.length, 0);
  const envelope = await readFile(join(temporary.root, "wallets/default.json"), "utf8");
  assert.equal(envelope.includes(raw), false);
});

test("fee/value funding and chain mismatch fail before approval or signature", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  await setup.core.wallet.ensure("default");
  await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, maxFeeWei: "1" }), { code: "APN_FEE_BUDGET_EXCEEDED" });
  setup.rpc.nativeAtomic = "1000000000000";
  await assert.rejects(setup.core.transfer.prepare(EVM_REQUEST), { code: "APN_INSUFFICIENT_GAS" });
  setup.rpc.nativeAtomic = "1000000000000000000";
  setup.rpc.chainId = 1;
  await assert.rejects(setup.core.transfer.prepare(EVM_REQUEST), { code: "APN_CHAIN_MISMATCH" });
  assert.equal(setup.approval.intents.length, 0);
  assert.equal(setup.rpc.submissions.length, 0);
});

test("fresh custody recovers the encrypted signature after process loss before public effect binding", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root, undefined, undefined, undefined, (native) => ({ request: async (request) => {
    const result = await native.request(request);
    if (request.operation === "directTransfer.approveAndSign") throw new Error("simulated process loss after encrypted save");
    return result;
  } }));
  await setup.core.wallet.ensure("default");
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), /simulated process loss/u);
  assert.equal((await setup.core.transfer.status(prepared.operation_id) as { state: string }).state, "started");
  assert.equal(setup.rpc.submissions.length, 0);
  const recovered = evmCore(temporary.root, setup.rpc, setup.wrapping);
  assert.equal((await recovered.core.transfer.resume(prepared.operation_id) as { state: string }).state, "completed");
  assert.equal(recovered.approval.intents.length, 0);
  assert.equal(setup.rpc.submissions.length, 1);
});

test("refused foreground approval never loads the key and missing signature recovery terminates without payment", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const approval = new EvmApproval(); approval.rejection = new ApnError("APN_OPERATION_BLOCKED", "refused");
  const setup = evmCore(temporary.root, new EvmTestRpc(), new EvmWrappingSecret(), approval);
  await setup.core.wallet.ensure("default");
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  const loads = setup.wrapping.loads;
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), /refused/u);
  assert.equal(setup.wrapping.loads, loads);
  await assert.rejects(evmCore(temporary.root, setup.rpc, setup.wrapping).core.transfer.resume(prepared.operation_id), { code: "APN_REPREPARE_REQUIRED" });
  assert.equal((await setup.core.transfer.status(prepared.operation_id) as { state: string }).state, "failed_before_effect");
  assert.equal(setup.rpc.submissions.length, 0);
});

test("ambiguous broadcast reuses identical bytes and blocks retry when fee budget has risen", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  await setup.core.wallet.ensure("default");
  setup.rpc.submitError = new Error("timeout"); setup.rpc.receiptEnabled = false;
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "unknown_finality");
  const raw = setup.rpc.submissions[0];
  setup.rpc.l1Fee = BigInt(EVM_REQUEST.maxFeeWei);
  const restarted = evmCore(temporary.root, setup.rpc, setup.wrapping);
  await assert.rejects(restarted.core.transfer.resume(prepared.operation_id), { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.equal(setup.rpc.submissions.length, 1);
  setup.rpc.l1Fee = 1000n; setup.rpc.submitError = null;
  await restarted.core.transfer.resume(prepared.operation_id);
  assert.equal(setup.rpc.submissions.length, 2);
  assert.equal(setup.rpc.submissions[1], raw);
  assert.equal(restarted.approval.intents.length, 0);
});

test("ERC-20 receipt success is insufficient without exact log AND balance deltas", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  const wallet = await setup.core.wallet.ensure("default") as { address: Address }; setup.rpc.sender = wallet.address;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 8453, token: EVM_TOKEN }, amount: "1" }) as { operation_id: string };
  setup.rpc.deltasVerified = false;
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "unknown_finality");
  setup.rpc.deltasVerified = true; setup.rpc.transferLogEnabled = false;
  assert.equal((await setup.core.transfer.resume(prepared.operation_id) as { state: string }).state, "unknown_finality");
  setup.rpc.transferLogEnabled = true;
  assert.equal((await setup.core.transfer.resume(prepared.operation_id) as { state: string }).state, "completed");
});

test("terminal EVM operation with missing or forged receipt fails closed even when hashes are resealed", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); await setup.core.wallet.ensure("default");
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  await setup.core.transfer.approve(prepared.operation_id);
  const path = join(temporary.root, "receipts", setup.state.profileHash("default"), `${prepared.operation_id}.json`);
  const original = JSON.parse(await readFile(path, "utf8"));
  const { integrityHash: _integrityHash, ...body } = original;
  await writeFile(path, JSON.stringify(sealReceipt({ ...body, amountAtomic: "2" })), { mode: 0o600 });
  await assert.rejects(setup.core.transfer.status(prepared.operation_id), { code: "APN_STATE_CORRUPT" });
  await rm(path);
  await assert.rejects(setup.core.transfer.status(prepared.operation_id), { code: "APN_STATE_CORRUPT" });
});
