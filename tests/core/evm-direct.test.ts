import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { keccak256, parseTransaction } from "viem";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { ApnError } from "../../src/errors.js";
import { evmAmount, MAX_EVM_UINT, resolveEvmAsset } from "../../src/evm-asset.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import type { Address } from "../../src/model.js";
import { sealReceipt } from "../../src/state-integrity.js";
import { EVM_REQUEST, EVM_TOKEN, EvmApproval, EvmTestRpc, EvmWrappingSecret, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { EVM_USDC } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

test("generic CLI and MCP bind the same explicit core request without changing legacy commands", () => {
  const input = { profile: "default", chain: "eip155:8453", asset: EVM_USDC[8453], decimals: "6", rpc_url: "https://rpc.example", to: EVM_REQUEST.recipient, amount: "1.25", max_fee_wei: EVM_REQUEST.maxFeeWei, idempotency_key: EVM_REQUEST.idempotencyKey };
  const tool = MCP_TOOLS.find((entry) => entry.name === "apn_pay_transfer_prepare_asset")!;
  const argv = ["pay", "transfer", "prepare-asset", ...Object.entries(input).flatMap(([name, value]) => [`--${name.replaceAll("_", "-")}`, value])];
  assert.deepEqual(bindArgv(argv), bindMcpInput(tool.command, input));
  assert.equal(bindArgv(argv).request.command, "transfer.prepare");
  assert.throws(() => bindMcpInput(tool.command, { ...input, chain: "eip155:42170" }), { code: "APN_ALLOWLIST_REFUSED" });
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

for (const chainId of [8453, 1, 42161] as const) for (const kind of ["native", "usdc"] as const) test(`Chain ${chainId} ${kind === "native" ? "ETH" : "list USDC"} completes through encrypted custody and durable status/receipt`, async (context) => {
  const asset: "native" | Address = kind === "native" ? "native" : EVM_USDC[chainId];
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  setup.rpc.chainId = chainId;
  if (chainId !== 8453) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
  if (chainId === 42161) setup.rpc.fees = { ...setup.rpc.fees, maxPriorityFeePerGasAtomic: "0" };
  const wallet = await ensureDirectWallet(setup);
  setup.rpc.sender = wallet.address;
  const request = { ...EVM_REQUEST, asset: { chainId, token: asset }, amount: asset === "native" ? "0.000001" : "1.25" };
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
  assert.equal(transaction.chainId, chainId);
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
  await ensureDirectWallet(setup);
  await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, maxFeeWei: "1" }), { code: "APN_FEE_BUDGET_EXCEEDED" });
  setup.rpc.nativeAtomic = "1000000000000";
  await assert.rejects(setup.core.transfer.prepare(EVM_REQUEST), { code: "APN_INSUFFICIENT_GAS" });
  setup.rpc.nativeAtomic = "1000000000000000000";
  setup.rpc.chainId = 1;
  await assert.rejects(setup.core.transfer.prepare(EVM_REQUEST), { code: "APN_CHAIN_MISMATCH" });
  assert.equal(setup.approval.intents.length, 0);
  assert.equal(setup.rpc.submissions.length, 0);
});

test("Arbitrum signs the frozen fee envelope when the fresh gas estimate and suggested maximum fee decrease", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  setup.rpc.chainId = 42161; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  await ensureDirectWallet(setup);
  const frozenFees = setup.rpc.fees;
  const prepared = await setup.core.transfer.prepare({
    ...EVM_REQUEST,
    asset: { chainId: 42161, token: "native" },
  }) as { operation_id: string };
  setup.rpc.fees = {
    ...frozenFees,
    gasLimitAtomic: (BigInt(frozenFees.gasLimitAtomic) - 1n).toString(),
    maxFeePerGasAtomic: (BigInt(frozenFees.maxFeePerGasAtomic) - 2n).toString(),
  };

  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "completed");
  assert.equal(setup.approval.intents.length, 1);
  assert.equal(setup.rpc.submissions.length, 1);
  const transaction = parseTransaction(setup.rpc.submissions[0]!);
  assert.equal(transaction.nonce?.toString(), setup.rpc.nonceAtomic);
  assert.equal(transaction.gas?.toString(), frozenFees.gasLimitAtomic);
  assert.equal(transaction.maxFeePerGas?.toString(), frozenFees.maxFeePerGasAtomic);
  assert.equal((transaction.maxPriorityFeePerGas ?? 0n).toString(), frozenFees.maxPriorityFeePerGasAtomic);
});

test("EVM approval rejects only a changed nonce, insufficient frozen gas, or a base fee above the signed ceiling", async () => {
  const cases = [
    { name: "higher nonce", mutate: (setup: ReturnType<typeof evmCore>) => { setup.rpc.nonceAtomic = (BigInt(setup.rpc.nonceAtomic) + 1n).toString(); } },
    { name: "lower nonce", mutate: (setup: ReturnType<typeof evmCore>) => { setup.rpc.nonceAtomic = (BigInt(setup.rpc.nonceAtomic) - 1n).toString(); } },
    { name: "higher gas limit", mutate: (setup: ReturnType<typeof evmCore>) => { setup.rpc.fees = { ...setup.rpc.fees, gasLimitAtomic: (BigInt(setup.rpc.fees.gasLimitAtomic) + 1n).toString() }; } },
    { name: "base fee above signed ceiling", mutate: (setup: ReturnType<typeof evmCore>) => { setup.rpc.fees = {
      ...setup.rpc.fees,
      maxFeePerGasAtomic: (2n * BigInt(setup.rpc.fees.maxFeePerGasAtomic) + BigInt(setup.rpc.fees.maxPriorityFeePerGasAtomic) + 2n).toString(),
    }; } },
  ] as const;

  for (const scenario of cases) {
    const temporary = await temporaryState();
    try {
      const setup = evmCore(temporary.root);
      setup.rpc.chainId = 42161; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
      await ensureDirectWallet(setup);
      const prepared = await setup.core.transfer.prepare({
        ...EVM_REQUEST,
        idempotencyKey: `arbitrum-drift-${scenario.name.replaceAll(" ", "-")}`,
        asset: { chainId: 42161, token: "native" },
      }) as { operation_id: string };
      const wrappingLoads = setup.wrapping.loads;
      scenario.mutate(setup);

      await assert.rejects(setup.core.transfer.approve(prepared.operation_id), { code: "APN_REPREPARE_REQUIRED" }, scenario.name);
      const status = await setup.core.transfer.status(prepared.operation_id) as { state: string; terminal: boolean; reason: string; proof_class: string };
      assert.deepEqual(
        { state: status.state, terminal: status.terminal, reason: status.reason, proofClass: status.proof_class },
        { state: "failed_before_effect", terminal: true, reason: "fee_or_nonce_changed", proofClass: "durable_pre_effect_failure" },
        scenario.name,
      );
      assert.equal(setup.approval.intents.length, 0, scenario.name);
      assert.equal(setup.wrapping.loads, wrappingLoads, scenario.name);
      assert.equal(setup.rpc.submissions.length, 0, scenario.name);
    } finally {
      await temporary.cleanup();
    }
  }
});

test("all EVM chains keep the frozen signed envelope across harmless live fee and gas-estimate movement", async () => {
  for (const chainId of [8453, 1, 42161] as const) {
    const temporary = await temporaryState();
    try {
      const setup = evmCore(temporary.root);
      setup.rpc.chainId = chainId;
      if (chainId !== 8453) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
      await ensureDirectWallet(setup);
      const prepared = await setup.core.transfer.prepare({
        ...EVM_REQUEST,
        idempotencyKey: `live-envelope-${chainId}`,
        asset: { chainId, token: "native" },
      }) as { operation_id: string };
      setup.rpc.fees = {
        ...setup.rpc.fees,
        gasLimitAtomic: (BigInt(setup.rpc.fees.gasLimitAtomic) - 1n).toString(),
        maxFeePerGasAtomic: (BigInt(setup.rpc.fees.maxFeePerGasAtomic) + 1_000_000_000n).toString(),
      };

      assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "completed");
      assert.equal(setup.approval.intents.length, 1);
      assert.equal(setup.rpc.submissions.length, 1);
    } finally {
      await temporary.cleanup();
    }
  }
});

test("fresh custody recovers the encrypted signature after process loss before public effect binding", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root, undefined, undefined, undefined, (native) => ({ request: async (request) => {
    const result = await native.request(request);
    if (request.operation === "directTransfer.approveAndSign") throw new Error("simulated process loss after encrypted save");
    return result;
  } }));
  await ensureDirectWallet(setup);
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
  await ensureDirectWallet(setup);
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
  await ensureDirectWallet(setup);
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
  const wallet = await ensureDirectWallet(setup); setup.rpc.sender = wallet.address;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 8453, token: EVM_USDC[8453] }, amount: "1" }) as { operation_id: string };
  setup.rpc.deltasVerified = false;
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "unknown_finality");
  setup.rpc.deltasVerified = true; setup.rpc.transferLogEnabled = false;
  assert.equal((await setup.core.transfer.resume(prepared.operation_id) as { state: string }).state, "unknown_finality");
  setup.rpc.transferLogEnabled = true;
  assert.equal((await setup.core.transfer.resume(prepared.operation_id) as { state: string }).state, "completed");
});

test("terminal EVM operation with missing or forged receipt fails closed even when hashes are resealed", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); await ensureDirectWallet(setup);
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

test("Arbitrum receipt without safe proof stays nonterminal and resumes without another signature or submission", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 42161; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  await ensureDirectWallet(setup);
  const evidence = setup.rpc.evm.evidence;
  setup.rpc.evm.evidence = async (...args) => {
    const { safeBlockNumberAtomic: _number, safeBlockHash: _hash, ...latestOnly } = await evidence(...args);
    return latestOnly;
  };
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 42161, token: "native" } }) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { terminal: boolean }).terminal, false);
  assert.equal(setup.rpc.broadcastCount, 1); assert.equal(setup.approval.intents.length, 1);
  setup.rpc.evm.evidence = evidence;
  const restarted = evmCore(temporary.root, setup.rpc, setup.wrapping);
  assert.equal((await restarted.core.transfer.resume(prepared.operation_id) as { state: string }).state, "completed");
  assert.equal(setup.rpc.broadcastCount, 1); assert.equal(restarted.approval.intents.length, 0);
  const receipt = await restarted.core.transfer.receipt(prepared.operation_id) as { finality: string; fee_model: string };
  assert.equal(receipt.finality, "rpc_safe_inclusion"); assert.equal(receipt.fee_model, "arbitrum-inclusive");
  const stored = (await setup.state.findOperation(prepared.operation_id))!;
  const record = (await setup.state.loadReceipt(stored.profileHash, stored.operationId))!;
  const { assertDirectTerminalReceiptAuthority } = await import("../../src/direct-terminal-receipt.js");
  for (const override of [{ safeBlockNumberAtomic: undefined, safeBlockHash: undefined }, { safeBlockNumberAtomic: "1" }, { safeBlockHash: `0x${"c".repeat(64)}` }]) {
    assert.throws(() => assertDirectTerminalReceiptAuthority(stored, { ...record, evmEvidence: { ...record.evmEvidence!, ...override } } as typeof record), { code: "APN_STATE_CORRUPT" });
  }
});

test("Arbitrum increasing inclusive gas after signing prevents first submission and retains the exact signed operation", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root, undefined, undefined, undefined, (native) => ({ request: async (request) => {
    const result = await native.request(request);
    if (request.operation === "directTransfer.approveAndSign") setup.rpc.fees = { ...setup.rpc.fees, gasLimitAtomic: "99999" };
    return result;
  } }));
  setup.rpc.chainId = 42161; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  await ensureDirectWallet(setup);
  const previousFees = setup.rpc.fees;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 42161, token: "native" } }) as { operation_id: string };
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), { code: "APN_FEE_BUDGET_EXCEEDED" });
  const signed = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(signed.state, "signed_not_submitted"); assert.equal(setup.rpc.broadcastCount, 0);
  setup.rpc.fees = previousFees;
  const restarted = evmCore(temporary.root, setup.rpc, setup.wrapping);
  assert.equal((await restarted.core.transfer.resume(prepared.operation_id) as { state: string }).state, "completed");
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.transactionHash, signed.transactionHash);
  assert.equal(restarted.approval.intents.length, 0); assert.equal(setup.rpc.broadcastCount, 1);
});

test("Arbitrum base fee above the frozen signed ceiling retains and later submits the exact signed bytes", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  let signedRaw: `0x${string}` | undefined;
  const setup = evmCore(temporary.root, undefined, undefined, undefined, (native) => ({ request: async (request) => {
    const result = await native.request(request);
    if (request.operation === "directTransfer.approveAndSign") {
      signedRaw = (result as { rawTransaction: `0x${string}` }).rawTransaction;
      setup.rpc.fees = {
        ...setup.rpc.fees,
        maxFeePerGasAtomic: (2n * BigInt(setup.rpc.fees.maxFeePerGasAtomic) + BigInt(setup.rpc.fees.maxPriorityFeePerGasAtomic) + 2n).toString(),
      };
    }
    return result;
  } }));
  setup.rpc.chainId = 42161; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  await ensureDirectWallet(setup);
  const frozenFees = setup.rpc.fees;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 42161, token: "native" } }) as { operation_id: string };
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), { code: "APN_FEE_BUDGET_EXCEEDED" });
  const signed = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(signed.state, "signed_not_submitted"); assert.equal(setup.rpc.broadcastCount, 0);

  const stillBlocked = evmCore(temporary.root, setup.rpc, setup.wrapping);
  await assert.rejects(stillBlocked.core.transfer.resume(prepared.operation_id), { code: "APN_FEE_BUDGET_EXCEEDED" });
  const retained = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(retained.state, "signed_not_submitted"); assert.equal(retained.transactionHash, signed.transactionHash);
  assert.equal(retained.rawTransactionHash, signed.rawTransactionHash); assert.equal(setup.rpc.broadcastCount, 0);

  setup.rpc.fees = frozenFees;
  assert.equal((await stillBlocked.core.transfer.resume(prepared.operation_id) as { state: string }).state, "completed");
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.transactionHash, signed.transactionHash);
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.rawTransactionHash, signed.rawTransactionHash);
  assert.equal(setup.rpc.submissions[0], signedRaw);
  assert.equal(keccak256(setup.rpc.submissions[0]!), signed.rawTransactionHash);
  assert.equal(stillBlocked.approval.intents.length, 0); assert.equal(setup.rpc.broadcastCount, 1);
});

for (const chainId of [8453, 1, 42161] as const) for (const decimals of [6, 18]) test(`chain ${chainId} list USDC keeps the list's decimals; a contract reporting ${decimals} decimals ${decimals === 6 ? "preserves exact accounting" : "is refused"}`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = chainId; setup.rpc.decimals = decimals;
  if (chainId !== 8453) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
  setup.rpc.sender = (await ensureDirectWallet(setup)).address;
  const request = { ...EVM_REQUEST, asset: { chainId, token: EVM_USDC[chainId] }, amount: "1.000001" };
  if (decimals !== 6) {
    await assert.rejects(setup.core.transfer.prepare(request), { code: "APN_ASSET_MISMATCH" });
    assert.equal(setup.rpc.submissions.length, 0); return;
  }
  const prepared = await setup.core.transfer.prepare(request) as { operation_id: string };
  const operation = (await setup.state.findOperation(prepared.operation_id))!;
  const atomic = decimals === 6 ? "1000001" : "1000001000000000000";
  assert.equal(operation.amountAtomic, atomic); assert.equal(operation.evm?.asset.decimals, decimals);
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "completed");
  const receipt = await setup.core.transfer.receipt(prepared.operation_id) as { amount_atomic: string };
  assert.equal(receipt.amount_atomic, atomic); assert.equal(setup.rpc.submissions.length, 1);
});

test("Arbitrum foreground approval explicitly labels inclusive fees without claiming free L1 posting", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 42161; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  await ensureDirectWallet(setup);
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 42161, token: "native" } }) as { operation_id: string };
  await setup.core.transfer.approve(prepared.operation_id);
  const { TtyTransferApproval, transferApprovalPhrase } = await import("../../src/tty-approval.js");
  const intent = setup.approval.intents[0]!;
  let output = "";
  const approval = new TtyTransferApproval({ isTerminal: () => true, openTerminal: async () => ({
    fd: 123, write: async (text) => { output += text; }, close: async () => undefined,
    read: async function* () { yield Buffer.from(transferApprovalPhrase(intent.fingerprint) + "\n"); },
  }) });
  await approval.approve(intent);
  assert.match(output, /eip155:42161/); assert.match(output, /L2 execution plus L1 posting; no separate surcharge/);
  assert.match(output, /Maximum inclusive transaction fee/); assert.doesNotMatch(output, /Maximum execution fee:/);
});
