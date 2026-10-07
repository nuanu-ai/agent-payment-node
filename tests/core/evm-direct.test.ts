import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson } from "../../src/canonical.js";
import { keccak256, parseTransaction } from "viem";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { ApnError } from "../../src/errors.js";
import { evmAmount, MAX_EVM_UINT, resolveEvmAsset } from "../../src/evm-asset.js";
import { observeEvmTransfer } from "../../src/evm-transfer-evidence.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import type { Address } from "../../src/model.js";
import { sealReceipt } from "../../src/state-integrity.js";
import { publicReceipt } from "../../src/transfer-policy.js";
import { EVM_BLOCK_HASH, EVM_REQUEST, EVM_TOKEN, EvmApproval, EvmTestRpc, EvmWrappingSecret, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { EVM_USDC, activateDirectPolicy, directAdmission, evmDirectAdmissions } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

for (const chainId of [8453, 1, 56, 42161, 1329] as const) test(`chain ${chainId} arms direct RPC guard through prepare, approval and resume`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = chainId;
  if (chainId !== 8453) { setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n; }
  let armed = 0;
  Object.assign(setup.rpc, { armEvmDirectRpcGuard: () => { armed += 1; } });
  const wallet = await ensureDirectWallet(setup);
  if (chainId === 56 || chainId === 1329) await activateDirectPolicy(setup.state.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission(`eip155:${chainId}`, null)], now: setup.clock.now() });
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId, token: "native" } }) as { operation_id: string };
  assert.equal(armed, 1);
  await setup.core.transfer.approve(prepared.operation_id);
  assert.ok(armed >= 2, "approval and send use the guarded RPC port");
  const beforeResume = armed;
  await setup.core.transfer.resume(prepared.operation_id);
  assert.equal(armed, beforeResume + 1);
});

test("adding Arbitrum guard does not arm unrelated direct Polygon route", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 137;
  setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  let armed = 0;
  Object.assign(setup.rpc, { armEvmDirectRpcGuard: () => { armed += 1; } });
  const wallet = await ensureDirectWallet(setup);
  await activateDirectPolicy(setup.state.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:137", null)], now: setup.clock.now() });
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 137, token: "native" } }) as { operation_id: string };
  assert.equal(armed, 0);
  await setup.core.transfer.approve(prepared.operation_id);
  await setup.core.transfer.resume(prepared.operation_id);
  assert.equal(armed, 0);
});

test("generic CLI and MCP bind the same explicit core request without changing legacy commands", () => {
  const input = { profile: "default", chain: "eip155:8453", asset: EVM_USDC[8453], decimals: "6", rpc_url: "https://rpc.example", to: EVM_REQUEST.recipient, amount: "1.25", max_fee_wei: EVM_REQUEST.maxFeeWei, idempotency_key: EVM_REQUEST.idempotencyKey };
  const tool = MCP_TOOLS.find((entry) => entry.name === "apn_pay_transfer_prepare_asset")!;
  const argv = ["pay", "transfer", "prepare-asset", ...Object.entries(input).flatMap(([name, value]) => [`--${name.replaceAll("_", "-")}`, value])];
  assert.deepEqual(bindArgv(argv), bindMcpInput(tool.command, input));
  assert.equal(bindArgv(argv).request.command, "transfer.prepare");
  assert.equal((bindArgv(argv).request as { batchRpcReads?: true }).batchRpcReads, undefined);
  assert.equal((bindArgv([...argv, "--rpc-read-mode", "batch"]).request as { batchRpcReads?: true }).batchRpcReads, true);
  assert.throws(() => bindArgv([...argv, "--rpc-read-mode", "scalar"]), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bindMcpInput(tool.command, { ...input, chain: "eip155:42170" }), { code: "APN_ALLOWLIST_REFUSED" });
  assert.throws(() => bindMcpInput(tool.command, { ...input, decimals: "256" }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bindArgv(["pay", "transfer", "prepare", "--profile", "default"]));
  assert.ok(MCP_TOOLS.some((entry) => entry.name === "apn_wallet_balance_asset"));
});

for (const chainId of [1, 8453, 42161, 59144, 130, 1329] as const) test(`chain ${chainId} batched native prepare refuses insufficient balance before nonce and estimate`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = chainId; setup.rpc.nativeAtomic = "1";
  const wallet = await ensureDirectWallet(setup);
  await activateDirectPolicy(setup.state.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), ...(chainId === 1 || chainId === 8453 || chainId === 42161 ? [] : [directAdmission(`eip155:${chainId}`, null)])], now: setup.clock.now() });
  let downstreamReads = 0;
  Object.assign(setup.rpc.evm, { [chainId === 1 ? "prepareEthereumNative" : chainId === 8453 ? "prepareBaseNative" : chainId === 42161 ? "prepareArbitrumNative" : chainId === 130 ? "prepareUnichainNative" : chainId === 1329 ? "prepareSeiNative" : "prepareLineaNative"]: () => ({
    balance: setup.rpc.evm.balance,
    nonceEstimate: async () => { downstreamReads += 1; throw new Error("nonce and estimate should not run"); },
    feeQuote: async () => { downstreamReads += 1; throw new Error("fee quote should not run"); },
  }) });
  await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId, token: "native" }, batchRpcReads: true }), { code: "APN_INSUFFICIENT_ASSET" });
  assert.equal(downstreamReads, 0);
});

test("Unichain USDC opt-in routes through grouped token reads and refuses insufficient balance before gas reads", async (context) => {
  const token = "0x078D782b760474a361dDA0AF3839290b0EF57AD6" as const;
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 130; setup.rpc.assetAtomic = "1";
  const wallet = await ensureDirectWallet(setup);
  await activateDirectPolicy(setup.state.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:130", token)], now: setup.clock.now() });
  let groupedReads = 0, downstreamReads = 0;
  Object.assign(setup.rpc.evm, { prepareUnichainUsdc: () => ({
    balance: async (address: Address, selection: Parameters<typeof setup.rpc.evm.balance>[1]) => {
      groupedReads += 1; return await setup.rpc.evm.balance(address, selection);
    },
    nonceEstimate: async () => { downstreamReads += 1; throw new Error("nonce and estimate should not run"); },
    feeQuote: async () => { downstreamReads += 1; throw new Error("fee quote should not run"); },
  }) });
  await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 130, token }, amount: "1", batchRpcReads: true }),
    { code: "APN_INSUFFICIENT_ASSET" });
  assert.equal(groupedReads, 1); assert.equal(downstreamReads, 0);
});

test("Polygon USDC opt-in routes through grouped token reads and refuses insufficient balance before gas reads", async (context) => {
  const token = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as const;
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 137; setup.rpc.assetAtomic = "1";
  const wallet = await ensureDirectWallet(setup);
  await activateDirectPolicy(setup.state.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:137", token)], now: setup.clock.now() });
  let groupedReads = 0, downstreamReads = 0;
  Object.assign(setup.rpc.evm, { preparePolygonUsdc: () => ({
    balance: async (address: Address, selection: Parameters<typeof setup.rpc.evm.balance>[1]) => {
      groupedReads += 1; return await setup.rpc.evm.balance(address, selection);
    },
    nonceEstimate: async () => { downstreamReads += 1; throw new Error("nonce and estimate should not run"); },
    feeQuote: async () => { downstreamReads += 1; throw new Error("fee quote should not run"); },
  }) });
  await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 137, token }, amount: "1", batchRpcReads: true }),
    { code: "APN_INSUFFICIENT_ASSET" });
  assert.equal(groupedReads, 1); assert.equal(downstreamReads, 0);
});

test("Ethereum canonical USDC uses grouped token reads for default and explicit batch prepare", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 1; setup.rpc.assetAtomic = "1";
  await ensureDirectWallet(setup);
  let groupedReads = 0, downstreamReads = 0;
  Object.assign(setup.rpc.evm, { prepareEthereumUsdc: () => ({
    balance: async (address: Address, selection: Parameters<typeof setup.rpc.evm.balance>[1]) => {
      groupedReads += 1; return await setup.rpc.evm.balance(address, selection);
    },
    nonceEstimate: async () => { downstreamReads += 1; throw new Error("nonce and estimate should not run"); },
    feeQuote: async () => { downstreamReads += 1; throw new Error("fee quote should not run"); },
  }) });
  for (const batchRpcReads of [undefined, true] as const) {
    await assert.rejects(setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 1, token: EVM_USDC[1] },
      amount: "1", ...(batchRpcReads ? { batchRpcReads } : {}) }), { code: "APN_INSUFFICIENT_ASSET" });
  }
  assert.equal(groupedReads, 2); assert.equal(downstreamReads, 0);
});

test("Ethereum canonical WETH9 signs once and completes only through exact observe-only receipt proof", async (context) => {
  const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 1; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  setup.rpc.assetAtomic = "1000000000"; setup.rpc.decimals = 18;
  const wallet = await ensureDirectWallet(setup); setup.rpc.sender = wallet.address;
  await activateDirectPolicy(setup.state.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:1", weth,
      { maximumPerTransferAtomic: "1000000000000", dailyLimitAtomic: "1000000000000" })], now: setup.clock.now() });
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 1, token: weth },
    amount: "0.0000000001", batchRpcReads: true }) as { operation_id: string; state: string };
  assert.equal(prepared.state, "awaiting_approval");
  const approved = await setup.core.transfer.approve(prepared.operation_id) as { state: string };
  assert.equal(approved.state, "submitted_pending");
  assert.equal(setup.rpc.submissions.length, 1);
  const signed = parseTransaction(setup.rpc.submissions[0]!);
  assert.equal(signed.chainId, 1); assert.equal(signed.to?.toLowerCase(), weth.toLowerCase()); assert.equal(signed.value ?? 0n, 0n);
  assert.equal(signed.data?.slice(-64), (100_000_000n).toString(16).padStart(64, "0"));
  const restarted = evmCore(temporary.root, setup.rpc, setup.wrapping);
  assert.equal((await restarted.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  const receipt = await restarted.core.transfer.receipt(prepared.operation_id) as { state: string; amount_atomic: string };
  assert.equal(receipt.state, "completed"); assert.equal(receipt.amount_atomic, "100000000");
  await restarted.core.transfer.resume(prepared.operation_id, undefined, true);
  assert.equal(setup.rpc.submissions.length, 1, "observation never rebroadcasts the frozen signed transaction");
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
  const deferredReceipt = chainId === 1 || (asset !== "native" && (chainId === 8453 || chainId === 42161));
  assert.equal(approved.state, deferredReceipt ? "submitted_pending" : "completed");
  const raw = setup.rpc.submissions[0]!;
  const transaction = parseTransaction(raw);
  assert.equal(transaction.chainId, chainId);
  assert.equal(transaction.value ?? 0n, asset === "native" ? 1000000000000n : 0n);
  assert.equal(transaction.to?.toLowerCase(), (asset === "native" ? EVM_REQUEST.recipient : asset).toLowerCase());
  assert.equal(setup.approval.intents.length, 1);
  const restarted = evmCore(temporary.root, setup.rpc, setup.wrapping);
  assert.deepEqual(await restarted.core.transfer.status(prepared.operation_id), approved);
  if (deferredReceipt) {
    assert.equal((await restarted.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  }
  const receipt = await restarted.core.transfer.receipt(prepared.operation_id) as { state: string; finality: string };
  assert.equal(receipt.state, "completed");
  assert.equal(receipt.finality, chainId === 42161 ? "rpc_safe_inclusion" : "inclusion_only");
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

      assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state,
        chainId === 1 ? "submitted_pending" : "completed");
      assert.equal(setup.approval.intents.length, 1);
      assert.equal(setup.rpc.submissions.length, 1);
    } finally {
      await temporary.cleanup();
    }
  }
});

test("Ethereum signed funding refusal recovers by same-hash observation without custody or first-send retry", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const rpc = new EvmTestRpc(); rpc.chainId = 1; rpc.l1Fee = 0n; rpc.operatorFee = 0n;
  const nonceReads = context.mock.method(rpc.evm, "nonce");
  const evidenceReads = context.mock.method(rpc.evm, "evidence");
  const originalReceipt = rpc.evm.receipt;
  let receiptReads = 0, observedHash: `0x${string}` | null = null;
  rpc.evm.receipt = async (...args) => {
    receiptReads += 1;
    if (observedHash === null) return await originalReceipt(...args);
    // Independent fixture observation, never a simulated first dispatch.
    return { transactionHash: observedHash, blockNumberAtomic: "12346", blockHash: EVM_BLOCK_HASH,
      status: "success", observedAt: new Date().toISOString(), rpcOrigin: rpc.rpcOrigin, logs: [] };
  };
  const originalQuote = rpc.evm.feeQuote;
  let quoteReads = 0;
  Object.assign(rpc.evm, { feeQuote: async (...args: Parameters<typeof originalQuote>) => {
    quoteReads += 1; return await originalQuote(...args);
  } });
  const setup = evmCore(temporary.root, rpc, undefined, undefined, native => ({ request: async request => {
    const result = await native.request(request);
    if (request.operation === "directTransfer.approveAndSign") rpc.nativeAtomic = "0";
    return result;
  } }));
  await ensureDirectWallet(setup);
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 1, token: "native" },
    amount: "0.000001" }) as { operation_id: string };
  assert.equal(quoteReads, 1);
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), { code: "APN_INSUFFICIENT_ASSET" });
  assert.equal(quoteReads, 2, "the signed Ethereum envelope reuses its validated frozen quote");
  assert.equal((await setup.core.transfer.status(prepared.operation_id) as { state: string }).state, "signed_not_submitted");
  assert.equal(rpc.broadcastCount, 0);
  rpc.nativeAtomic = "1000000000000000000";
  const signed = (await setup.state.findOperation(prepared.operation_id))!;
  assert.ok(signed.transactionHash); assert.ok(signed.rawTransactionHash); assert.ok(signed.allowlistLease);
  const recovery = evmCore(temporary.root, rpc, setup.wrapping);
  const nativeRequests = context.mock.method(recovery.local, "request");
  const before = { loads: setup.wrapping.loads, nonce: nonceReads.mock.callCount(), receipt: receiptReads };
  const resumed = await recovery.core.transfer.resume(prepared.operation_id) as { state: string; terminal: boolean; reason: string };
  assert.equal(resumed.state, "unknown_finality"); assert.equal(resumed.terminal, false);
  assert.equal(resumed.reason, "signed_recovery_observation_only");
  assert.equal(receiptReads, before.receipt + 1);
  const retained = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(retained.transactionHash, signed.transactionHash); assert.equal(retained.rawTransactionHash, signed.rawTransactionHash);
  assert.equal(retained.fingerprint, signed.fingerprint);
  assert.equal(retained.allowlistLease!.reservation.reservationId, signed.allowlistLease.reservation.reservationId);
  const { directUsage } = await import("./direct-allowlist-helpers.js");
  const { AssetUsageLedger } = await import("../../src/asset-usage-ledger.js");
  const ledger = new AssetUsageLedger(temporary.root), reservation = signed.allowlistLease.reservation;
  const identity = { account: reservation.account, chain: reservation.chain, asset: reservation.asset };
  assert.equal((await ledger.load(identity, reservation.reservationId))!.state, "unknown_finality");
  assert.equal(await directUsage(temporary.root, signed.walletAddress, `eip155:${signed.chainId}`, null, setup.clock.now()), signed.amountAtomic);
  const readsAfterResume = receiptReads;
  assert.equal((await recovery.core.transfer.status(prepared.operation_id) as { state: string }).state, "unknown_finality");
  assert.equal(receiptReads, readsAfterResume, "public status is local and never observes or opens custody");
  assert.equal(nativeRequests.mock.callCount(), 0); assert.equal(setup.wrapping.loads, before.loads);
  assert.equal(nonceReads.mock.callCount(), before.nonce); assert.equal(rpc.broadcastCount, 0); assert.equal(rpc.submissions.length, 0);
  assert.equal(recovery.approval.intents.length, 0);
  assert.equal(evidenceReads.mock.callCount(), 0);
  observedHash = `0x${"f".repeat(64)}`;
  assert.notEqual(observedHash, signed.transactionHash);
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string; reason: string }).state, "unknown_finality");
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.reason, "receipt_hash_mismatch");
  assert.equal(await directUsage(temporary.root, signed.walletAddress, `eip155:${signed.chainId}`, null, setup.clock.now()), signed.amountAtomic);
  assert.equal(evidenceReads.mock.callCount(), 0, "wrong-hash receipt cannot reach effect proof");
  observedHash = signed.transactionHash;
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  const final = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(evidenceReads.mock.callCount(), 1); assert.equal(receiptReads, before.receipt + 3);
  assert.equal((await ledger.load(identity, reservation.reservationId))!.state, "finalized");
  assert.equal(final.transactionHash, signed.transactionHash); assert.equal(final.rawTransactionHash, signed.rawTransactionHash);
  assert.equal(final.fingerprint, signed.fingerprint);
  assert.equal(await directUsage(temporary.root, signed.walletAddress, `eip155:${signed.chainId}`, null, setup.clock.now()), signed.amountAtomic);
  const finalReads = receiptReads;
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  assert.equal(receiptReads, finalReads); assert.equal(nativeRequests.mock.callCount(), 0); assert.equal(setup.wrapping.loads, before.loads);
  assert.equal(nonceReads.mock.callCount(), before.nonce); assert.equal(rpc.broadcastCount, 0); assert.equal(rpc.submissions.length, 0);
  assert.equal(recovery.approval.intents.length, 0);
  assert.equal(quoteReads, 2, "observation never retries funding or fee quote reads");
});

test("post-sign response loss recovers public same-hash evidence without private custody or first-send retry", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const rpc = new EvmTestRpc();
  const nonceReads = context.mock.method(rpc.evm, "nonce");
  const evidenceReads = context.mock.method(rpc.evm, "evidence");
  const originalReceipt = rpc.evm.receipt;
  let receiptReads = 0, observedHash: `0x${string}` | null = null;
  rpc.evm.receipt = async (...args) => {
    receiptReads += 1;
    if (observedHash === null) return await originalReceipt(...args);
    // Independent fixture observation, never a simulated first dispatch.
    return { transactionHash: observedHash, blockNumberAtomic: "12346", blockHash: EVM_BLOCK_HASH,
      status: "success", observedAt: new Date().toISOString(), rpcOrigin: rpc.rpcOrigin, logs: [] };
  };
  let signedEffect: { transactionHash: `0x${string}`; rawTransactionHash: `0x${string}` } | undefined;
  const setup = evmCore(temporary.root, rpc, undefined, undefined, native => ({ request: async request => {
    const result = await native.request(request);
    if (request.operation === "directTransfer.approveAndSign") {
      signedEffect = result as { transactionHash: `0x${string}`; rawTransactionHash: `0x${string}` };
      throw new Error("simulated process loss after encrypted save");
    }
    return result;
  } }));
  await ensureDirectWallet(setup);
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), /simulated process loss/u);
  assert.equal((await setup.core.transfer.status(prepared.operation_id) as { state: string }).state, "started");
  assert.equal(rpc.submissions.length, 0); assert.ok(signedEffect);
  const started = (await setup.state.findOperation(prepared.operation_id))!; assert.ok(started.allowlistLease);
  const recovery = evmCore(temporary.root, rpc, setup.wrapping);
  const nativeRequests = context.mock.method(recovery.local, "request");
  const before = { loads: setup.wrapping.loads, nonce: nonceReads.mock.callCount(), receipt: receiptReads };
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id) as { state: string }).state, "unknown_finality");
  // This requirement intentionally fails on 7f6 until authenticated public started recovery is integrated.
  assert.equal(nativeRequests.mock.callCount(), 0, "started recovery must use public proof, never effectMaterial.get");
  assert.equal(setup.wrapping.loads, before.loads);
  const retained = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(retained.transactionHash, signedEffect.transactionHash); assert.equal(retained.rawTransactionHash, signedEffect.rawTransactionHash);
  assert.equal(retained.fingerprint, started.fingerprint);
  assert.equal(retained.allowlistLease!.reservation.reservationId, started.allowlistLease.reservation.reservationId);
  const { directUsage } = await import("./direct-allowlist-helpers.js");
  const { AssetUsageLedger } = await import("../../src/asset-usage-ledger.js");
  const ledger = new AssetUsageLedger(temporary.root), reservation = started.allowlistLease.reservation;
  const identity = { account: reservation.account, chain: reservation.chain, asset: reservation.asset };
  assert.equal((await ledger.load(identity, reservation.reservationId))!.state, "unknown_finality");
  assert.equal(await directUsage(temporary.root, started.walletAddress, `eip155:${started.chainId}`, null, setup.clock.now()), started.amountAtomic);
  assert.equal(nonceReads.mock.callCount(), before.nonce); assert.equal(rpc.broadcastCount, 0); assert.equal(rpc.submissions.length, 0);
  assert.equal(recovery.approval.intents.length, 0);
  const readsAfterResume = receiptReads;
  assert.equal((await recovery.core.transfer.status(prepared.operation_id) as { state: string }).state, "unknown_finality");
  assert.equal(receiptReads, readsAfterResume); assert.equal(nativeRequests.mock.callCount(), 0);
  assert.equal(evidenceReads.mock.callCount(), 0);
  observedHash = `0x${"f".repeat(64)}`; assert.notEqual(observedHash, signedEffect.transactionHash);
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "unknown_finality");
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.reason, "receipt_hash_mismatch");
  assert.equal(await directUsage(temporary.root, started.walletAddress, `eip155:${started.chainId}`, null, setup.clock.now()), started.amountAtomic);
  assert.equal(evidenceReads.mock.callCount(), 0, "wrong-hash receipt cannot reach effect proof");
  observedHash = signedEffect.transactionHash;
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  const final = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(evidenceReads.mock.callCount(), 1); assert.equal(receiptReads, before.receipt + 3);
  assert.equal((await ledger.load(identity, reservation.reservationId))!.state, "finalized");
  assert.equal(final.transactionHash, signedEffect.transactionHash); assert.equal(final.rawTransactionHash, signedEffect.rawTransactionHash);
  assert.equal(final.fingerprint, started.fingerprint);
  assert.equal(await directUsage(temporary.root, started.walletAddress, `eip155:${started.chainId}`, null, setup.clock.now()), started.amountAtomic);
  assert.equal(nativeRequests.mock.callCount(), 0); assert.equal(setup.wrapping.loads, before.loads);
  assert.equal(nonceReads.mock.callCount(), before.nonce); assert.equal(rpc.broadcastCount, 0); assert.equal(rpc.submissions.length, 0);
  assert.equal(recovery.approval.intents.length, 0); assert.equal(evidenceReads.mock.callCount(), 1);
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
  const declined = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(declined.state, "started"); assert.ok(declined.allowlistLease);
  const proofPath = join(temporary.root, "direct-public-effects", declined.profileHash, `${declined.operationId}.no-private-entry.json`);
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  assert.equal(proof.outcome, "native_approval_returned_before_private_entry");
  assert.equal(proof.operationIntegrityHash, declined.integrityHash);
  let nativeCalls = 0;
  const recovery = evmCore(temporary.root, setup.rpc, setup.wrapping, undefined, () => ({ request: async () => {
    nativeCalls += 1; throw new Error("recovery must never enter Native");
  } }));
  await assert.rejects(recovery.core.transfer.resume(prepared.operation_id), { code: "APN_REPREPARE_REQUIRED" });
  assert.equal((await setup.core.transfer.status(prepared.operation_id) as { state: string }).state, "failed_before_effect");
  assert.equal(setup.rpc.submissions.length, 0);
  const failed = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(failed.terminal, true); assert.equal(failed.economics!.nonceAtomic, declined.economics!.nonceAtomic);
  assert.equal(failed.allowlistLease!.reservation.reservationId, declined.allowlistLease!.reservation.reservationId);
  const { AssetUsageLedger } = await import("../../src/asset-usage-ledger.js");
  const reservation = declined.allowlistLease!.reservation;
  const ledger = new AssetUsageLedger(temporary.root), identity = { account: reservation.account, chain: reservation.chain, asset: reservation.asset };
  const released = (await ledger.load(identity, reservation.reservationId))!;
  assert.equal(released.state, "failed_before_effect");
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id) as { state: string }).state, "failed_before_effect");
  assert.deepEqual(await ledger.load(identity, reservation.reservationId), released);
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.integrityHash, failed.integrityHash);
  assert.equal(await readFile(proofPath, "utf8"), canonicalJson(proof)+"\n");
  assert.equal(setup.wrapping.loads, loads); assert.equal(nativeCalls, 0); assert.equal(setup.rpc.broadcastCount, 0);
});

test("ambiguous EVM broadcast terminalizes from receipt when custody material is unavailable", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  await ensureDirectWallet(setup);
  setup.rpc.submitError = new Error("timeout"); setup.rpc.receiptEnabled = false;
  const prepared = await setup.core.transfer.prepare(EVM_REQUEST) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "unknown_finality");
  setup.rpc.l1Fee = BigInt(EVM_REQUEST.maxFeeWei);
  let custodyCalls = 0;
  const restarted = evmCore(temporary.root, setup.rpc, setup.wrapping, undefined, () => ({
    request: async () => { custodyCalls += 1; throw new Error("custody material unavailable"); },
  }));
  assert.equal((await restarted.core.transfer.resume(prepared.operation_id) as { state: string }).state, "unknown_finality");
  assert.equal(setup.rpc.submissions.length, 1);
  setup.rpc.receiptEnabled = true;
  assert.equal((await restarted.core.transfer.resume(prepared.operation_id) as { state: string }).state, "completed");
  assert.equal(setup.rpc.submissions.length, 1);
  assert.equal(custodyCalls, 0);
  assert.equal(restarted.approval.intents.length, 0);
});

test("ERC-20 receipt success is insufficient without exact log AND balance deltas", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root);
  const wallet = await ensureDirectWallet(setup); setup.rpc.sender = wallet.address;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 8453, token: EVM_USDC[8453] }, amount: "1" }) as { operation_id: string };
  setup.rpc.deltasVerified = false;
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "submitted_pending");
  assert.equal((await setup.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "unknown_finality");
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

for (const [chainId, feeModel] of [[42161, "arbitrum-inclusive"], [56, undefined]] as const) test(`chain ${chainId} receipt without safe proof stays nonterminal and resumes without another signature or submission`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = chainId; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  const wallet = await ensureDirectWallet(setup);
  if (chainId === 56) await activateDirectPolicy(temporary.root, "default", { accounts: { evm: wallet.address },
    admissions: [...evmDirectAdmissions(), directAdmission("eip155:56", null)], now: setup.clock.now() });
  const evidence = setup.rpc.evm.evidence;
  setup.rpc.evm.evidence = async (...args) => {
    const { safeBlockNumberAtomic: _number, safeBlockHash: _hash, ...latestOnly } = await evidence(...args);
    return latestOnly;
  };
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId, token: "native" } }) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { terminal: boolean }).terminal, false);
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.state, "unknown_finality");
  assert.equal(setup.rpc.broadcastCount, 1); assert.equal(setup.approval.intents.length, 1);
  setup.rpc.evm.evidence = evidence;
  const restarted = evmCore(temporary.root, setup.rpc, setup.wrapping);
  assert.equal((await restarted.core.transfer.resume(prepared.operation_id) as { state: string }).state, "completed");
  assert.equal(setup.rpc.broadcastCount, 1); assert.equal(restarted.approval.intents.length, 0);
  const receipt = await restarted.core.transfer.receipt(prepared.operation_id) as { finality: string; fee_model: string };
  assert.equal(receipt.finality, "rpc_safe_inclusion"); assert.equal(receipt.fee_model, feeModel);
  const stored = (await setup.state.findOperation(prepared.operation_id))!;
  const record = (await setup.state.loadReceipt(stored.profileHash, stored.operationId))!;
  const { safeBlockNumberAtomic: _safeNumber, safeBlockHash: _safeHash, ...withoutSafe } = record.evmEvidence!;
  assert.equal((publicReceipt({ ...record, evmEvidence: withoutSafe }) as { finality: string }).finality, "inclusion_only");
  const { assertDirectTerminalReceiptAuthority } = await import("../../src/direct-terminal-receipt.js");
  for (const override of [{ safeBlockNumberAtomic: undefined, safeBlockHash: undefined }, { safeBlockNumberAtomic: "1" }, { safeBlockHash: `0x${"c".repeat(64)}` }]) {
    assert.throws(() => assertDirectTerminalReceiptAuthority(stored, { ...record, evmEvidence: { ...record.evmEvidence!, ...override } } as typeof record), { code: "APN_STATE_CORRUPT" });
  }
});

for (const scenario of [
  { name: "HTTP 403", error: new ApnError("APN_RPC_PROTOCOL", "private URL https://rpc.example/secret?key=raw", { httpStatus: 403 }), reason: "evm_effect_rpc_forbidden" },
  { name: "HTTP 429", error: new ApnError("APN_RPC_RATE_LIMITED", "private URL https://rpc.example/secret?key=raw", { httpStatus: 429 }), reason: "evm_effect_rpc_rate_limited" },
  { name: "request budget", error: new ApnError("APN_RPC_BUDGET_EXCEEDED", "private URL https://rpc.example/secret?key=raw"), reason: "evm_effect_rpc_budget_exceeded" },
  { name: "request deadline", error: new ApnError("APN_RPC_AMBIGUOUS", "private URL https://rpc.example/secret?key=raw", { reason: "request_deadline" }), reason: "evm_effect_rpc_deadline" },
  { name: "safe-head lag", error: new ApnError("APN_RPC_PROTOCOL", "private URL https://rpc.example/secret?key=raw", { reason: "evm_safe_head_lag" }), reason: "evm_effect_safe_head_lag" },
  { name: "block identity change", error: new ApnError("APN_RPC_PROTOCOL", "private URL https://rpc.example/secret?key=raw", { reason: "evm_block_identity_changed" }), reason: "evm_effect_block_changed" },
  { name: "unknown provider error", error: new Error("private URL https://rpc.example/secret?key=raw"), reason: "evm_effect_evidence_unavailable" },
] as const) test(`EVM observer exposes only sanitized ${scenario.name} reason and recovers the same operation`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 42161; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  setup.rpc.sender = (await ensureDirectWallet(setup)).address;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 42161, token: EVM_USDC[42161] }, amount: "1" }) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "submitted_pending");
  const evidence = setup.rpc.evm.evidence;
  let evidenceCalls = 0;
  setup.rpc.evm.evidence = async () => { evidenceCalls += 1; throw scenario.error; };
  const observed = await setup.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string; reason: string; proof_class: string };
  const status = await setup.core.transfer.status(prepared.operation_id) as { state: string; reason: string; proof_class: string };
  const receipt = await setup.core.transfer.receipt(prepared.operation_id) as { state: string; reason: string; proof_class: string };
  for (const publicResult of [observed, status, receipt]) {
    assert.equal(publicResult.state, "unknown_finality");
    assert.equal(publicResult.reason, scenario.reason);
    assert.equal(publicResult.proof_class, "inclusion_effect_unproven");
    assert.doesNotMatch(JSON.stringify(publicResult), /secret|key=raw/u);
  }
  assert.equal(evidenceCalls, 1); assert.equal(setup.rpc.broadcastCount, 1); assert.equal(setup.rpc.submissions.length, 1);
  setup.rpc.evm.evidence = evidence;
  const restarted = evmCore(temporary.root, setup.rpc, setup.wrapping);
  assert.equal((await restarted.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  assert.equal(setup.rpc.broadcastCount, 1); assert.equal(setup.rpc.submissions.length, 1);
  assert.equal(restarted.approval.intents.length, 0);
});

for (const scenario of [
  { name: "safe head below receipt", safeNumber: "0x3039", reason: "evm_effect_safe_head_lag" },
  { name: "safe head at receipt height with another hash", safeNumber: "0x303a", reason: "evm_effect_block_changed" },
] as const) test(`Arbitrum ${scenario.name} persists its distinct sanitized observer reason`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const setup = evmCore(temporary.root); setup.rpc.chainId = 42161; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
  setup.rpc.sender = (await ensureDirectWallet(setup)).address;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 42161, token: EVM_USDC[42161] }, amount: "1" }) as { operation_id: string };
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "submitted_pending");
  const originalEvidence = setup.rpc.evm.evidence;
  let blockReads = 0;
  setup.rpc.evm.evidence = async (operation, receipt) => await observeEvmTransfer(async (method, params) => {
    assert.equal(method, "eth_getBlockByNumber");
    blockReads += 1;
    if (params[0] === "safe") return { number: scenario.safeNumber, hash: `0x${"a".repeat(64)}` };
    assert.equal(params[0], "0x303a");
    return { number: "0x303a", hash: EVM_BLOCK_HASH };
  }, operation, receipt);
  const observed = await setup.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string; reason: string; proof_class: string };
  const status = await setup.core.transfer.status(prepared.operation_id) as { state: string; reason: string; proof_class: string };
  const receipt = await setup.core.transfer.receipt(prepared.operation_id) as { state: string; reason: string; proof_class: string };
  for (const row of [observed, status, receipt]) assert.deepEqual(
    { state: row.state, reason: row.reason, proofClass: row.proof_class },
    { state: "unknown_finality", reason: scenario.reason, proofClass: "inclusion_effect_unproven" });
  assert.equal(blockReads, 2); assert.equal(setup.rpc.broadcastCount, 1);
  setup.rpc.evm.evidence = originalEvidence;
  const restarted = evmCore(temporary.root, setup.rpc, setup.wrapping);
  assert.equal((await restarted.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  assert.equal(setup.rpc.broadcastCount, 1); assert.equal(restarted.approval.intents.length, 0);
});

test("Arbitrum inclusive-gas refusal recovers by same-hash observation without custody or first-send retry", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const rpc = new EvmTestRpc();
  const nonceReads = context.mock.method(rpc.evm, "nonce");
  const evidenceReads = context.mock.method(rpc.evm, "evidence");
  const originalReceipt = rpc.evm.receipt;
  let receiptReads = 0, observedHash: `0x${string}` | null = null;
  rpc.evm.receipt = async (...args) => {
    receiptReads += 1;
    if (observedHash === null) return await originalReceipt(...args);
    // Independent fixture observation, never a simulated first dispatch.
    return { transactionHash: observedHash, blockNumberAtomic: "12346", blockHash: EVM_BLOCK_HASH,
      status: "success", observedAt: new Date().toISOString(), rpcOrigin: rpc.rpcOrigin, logs: [] };
  };
  const setup = evmCore(temporary.root, rpc, undefined, undefined, native => ({ request: async request => {
    const result = await native.request(request);
    if (request.operation === "directTransfer.approveAndSign") rpc.fees = { ...rpc.fees, gasLimitAtomic: "99999" };
    return result;
  } }));
  rpc.chainId = 42161; rpc.l1Fee = 0n; rpc.operatorFee = 0n;
  await ensureDirectWallet(setup);
  const previousFees = rpc.fees;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 42161, token: "native" } }) as { operation_id: string };
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.state, "signed_not_submitted"); assert.equal(rpc.broadcastCount, 0);
  rpc.fees = previousFees;
  const signed = (await setup.state.findOperation(prepared.operation_id))!;
  assert.ok(signed.transactionHash); assert.ok(signed.rawTransactionHash); assert.ok(signed.allowlistLease);
  const recovery = evmCore(temporary.root, rpc, setup.wrapping);
  const nativeRequests = context.mock.method(recovery.local, "request");
  const before = { loads: setup.wrapping.loads, nonce: nonceReads.mock.callCount(), receipt: receiptReads };
  const resumed = await recovery.core.transfer.resume(prepared.operation_id) as { state: string; terminal: boolean; reason: string };
  assert.equal(resumed.state, "unknown_finality"); assert.equal(resumed.terminal, false);
  assert.equal(resumed.reason, "signed_recovery_observation_only");
  assert.equal(receiptReads, before.receipt + 1);
  const retained = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(retained.transactionHash, signed.transactionHash); assert.equal(retained.rawTransactionHash, signed.rawTransactionHash);
  assert.equal(retained.fingerprint, signed.fingerprint);
  assert.equal(retained.allowlistLease!.reservation.reservationId, signed.allowlistLease.reservation.reservationId);
  const { directUsage } = await import("./direct-allowlist-helpers.js");
  const { AssetUsageLedger } = await import("../../src/asset-usage-ledger.js");
  const ledger = new AssetUsageLedger(temporary.root), reservation = signed.allowlistLease.reservation;
  const identity = { account: reservation.account, chain: reservation.chain, asset: reservation.asset };
  assert.equal((await ledger.load(identity, reservation.reservationId))!.state, "unknown_finality");
  assert.equal(await directUsage(temporary.root, signed.walletAddress, `eip155:${signed.chainId}`, null, setup.clock.now()), signed.amountAtomic);
  const readsAfterResume = receiptReads;
  assert.equal((await recovery.core.transfer.status(prepared.operation_id) as { state: string }).state, "unknown_finality");
  assert.equal(receiptReads, readsAfterResume, "public status is local and never observes or opens custody");
  assert.equal(nativeRequests.mock.callCount(), 0); assert.equal(setup.wrapping.loads, before.loads);
  assert.equal(nonceReads.mock.callCount(), before.nonce); assert.equal(rpc.broadcastCount, 0); assert.equal(rpc.submissions.length, 0);
  assert.equal(recovery.approval.intents.length, 0);
  assert.equal(evidenceReads.mock.callCount(), 0);
  observedHash = `0x${"f".repeat(64)}`;
  assert.notEqual(observedHash, signed.transactionHash);
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string; reason: string }).state, "unknown_finality");
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.reason, "receipt_hash_mismatch");
  assert.equal(await directUsage(temporary.root, signed.walletAddress, `eip155:${signed.chainId}`, null, setup.clock.now()), signed.amountAtomic);
  assert.equal(evidenceReads.mock.callCount(), 0, "wrong-hash receipt cannot reach effect proof");
  observedHash = signed.transactionHash;
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  const final = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(evidenceReads.mock.callCount(), 1); assert.equal(receiptReads, before.receipt + 3);
  assert.equal((await ledger.load(identity, reservation.reservationId))!.state, "finalized");
  assert.equal(final.transactionHash, signed.transactionHash); assert.equal(final.rawTransactionHash, signed.rawTransactionHash);
  assert.equal(final.fingerprint, signed.fingerprint);
  assert.equal(await directUsage(temporary.root, signed.walletAddress, `eip155:${signed.chainId}`, null, setup.clock.now()), signed.amountAtomic);
  const finalReads = receiptReads;
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  assert.equal(receiptReads, finalReads); assert.equal(nativeRequests.mock.callCount(), 0); assert.equal(setup.wrapping.loads, before.loads);
  assert.equal(nonceReads.mock.callCount(), before.nonce); assert.equal(rpc.broadcastCount, 0); assert.equal(rpc.submissions.length, 0);
  assert.equal(recovery.approval.intents.length, 0); assert.equal(evidenceReads.mock.callCount(), 1);
});

test("Arbitrum signed-ceiling refusal observes the same hash without fee retry, custody or first send", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const rpc = new EvmTestRpc();
  const nonceReads = context.mock.method(rpc.evm, "nonce");
  const evidenceReads = context.mock.method(rpc.evm, "evidence");
  const originalReceipt = rpc.evm.receipt;
  let receiptReads = 0, observedHash: `0x${string}` | null = null;
  rpc.evm.receipt = async (...args) => {
    receiptReads += 1;
    if (observedHash === null) return await originalReceipt(...args);
    // Independent fixture observation, never a simulated first dispatch.
    return { transactionHash: observedHash, blockNumberAtomic: "12346", blockHash: EVM_BLOCK_HASH,
      status: "success", observedAt: new Date().toISOString(), rpcOrigin: rpc.rpcOrigin, logs: [] };
  };
  const setup = evmCore(temporary.root, rpc, undefined, undefined, native => ({ request: async request => {
    const result = await native.request(request);
    if (request.operation === "directTransfer.approveAndSign") rpc.fees = { ...rpc.fees,
      maxFeePerGasAtomic: (2n * BigInt(rpc.fees.maxFeePerGasAtomic) + BigInt(rpc.fees.maxPriorityFeePerGasAtomic) + 2n).toString() };
    return result;
  } }));
  rpc.chainId = 42161; rpc.l1Fee = 0n; rpc.operatorFee = 0n;
  await ensureDirectWallet(setup);
  const frozenFees = rpc.fees;
  const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 42161, token: "native" } }) as { operation_id: string };
  await assert.rejects(setup.core.transfer.approve(prepared.operation_id), { code: "APN_FEE_BUDGET_EXCEEDED" });
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.state, "signed_not_submitted"); assert.equal(rpc.broadcastCount, 0);
  // Resume observes even while fees still exceed the signed ceiling. It has no send authority.
  const signed = (await setup.state.findOperation(prepared.operation_id))!;
  assert.ok(signed.transactionHash); assert.ok(signed.rawTransactionHash); assert.ok(signed.allowlistLease);
  const recovery = evmCore(temporary.root, rpc, setup.wrapping);
  const nativeRequests = context.mock.method(recovery.local, "request");
  const before = { loads: setup.wrapping.loads, nonce: nonceReads.mock.callCount(), receipt: receiptReads };
  const resumed = await recovery.core.transfer.resume(prepared.operation_id) as { state: string; terminal: boolean; reason: string };
  assert.equal(resumed.state, "unknown_finality"); assert.equal(resumed.terminal, false);
  assert.equal(resumed.reason, "signed_recovery_observation_only");
  assert.equal(receiptReads, before.receipt + 1);
  const retained = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(retained.transactionHash, signed.transactionHash); assert.equal(retained.rawTransactionHash, signed.rawTransactionHash);
  assert.equal(retained.fingerprint, signed.fingerprint);
  assert.equal(retained.allowlistLease!.reservation.reservationId, signed.allowlistLease.reservation.reservationId);
  const { directUsage } = await import("./direct-allowlist-helpers.js");
  const { AssetUsageLedger } = await import("../../src/asset-usage-ledger.js");
  const ledger = new AssetUsageLedger(temporary.root), reservation = signed.allowlistLease.reservation;
  const identity = { account: reservation.account, chain: reservation.chain, asset: reservation.asset };
  assert.equal((await ledger.load(identity, reservation.reservationId))!.state, "unknown_finality");
  assert.equal(await directUsage(temporary.root, signed.walletAddress, `eip155:${signed.chainId}`, null, setup.clock.now()), signed.amountAtomic);
  const readsAfterResume = receiptReads;
  assert.equal((await recovery.core.transfer.status(prepared.operation_id) as { state: string }).state, "unknown_finality");
  assert.equal(receiptReads, readsAfterResume, "public status is local and never observes or opens custody");
  assert.equal(nativeRequests.mock.callCount(), 0); assert.equal(setup.wrapping.loads, before.loads);
  assert.equal(nonceReads.mock.callCount(), before.nonce); assert.equal(rpc.broadcastCount, 0); assert.equal(rpc.submissions.length, 0);
  assert.equal(recovery.approval.intents.length, 0);
  assert.equal(evidenceReads.mock.callCount(), 0);
  observedHash = `0x${"f".repeat(64)}`;
  assert.notEqual(observedHash, signed.transactionHash);
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string; reason: string }).state, "unknown_finality");
  assert.equal((await setup.state.findOperation(prepared.operation_id))!.reason, "receipt_hash_mismatch");
  assert.equal(await directUsage(temporary.root, signed.walletAddress, `eip155:${signed.chainId}`, null, setup.clock.now()), signed.amountAtomic);
  assert.equal(evidenceReads.mock.callCount(), 0, "wrong-hash receipt cannot reach effect proof");
  observedHash = signed.transactionHash;
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  const final = (await setup.state.findOperation(prepared.operation_id))!;
  assert.equal(evidenceReads.mock.callCount(), 1); assert.equal(receiptReads, before.receipt + 3);
  assert.equal((await ledger.load(identity, reservation.reservationId))!.state, "finalized");
  assert.equal(final.transactionHash, signed.transactionHash); assert.equal(final.rawTransactionHash, signed.rawTransactionHash);
  assert.equal(final.fingerprint, signed.fingerprint);
  assert.equal(await directUsage(temporary.root, signed.walletAddress, `eip155:${signed.chainId}`, null, setup.clock.now()), signed.amountAtomic);
  const finalReads = receiptReads;
  assert.equal((await recovery.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  assert.equal(receiptReads, finalReads); assert.equal(nativeRequests.mock.callCount(), 0); assert.equal(setup.wrapping.loads, before.loads);
  assert.equal(nonceReads.mock.callCount(), before.nonce); assert.equal(rpc.broadcastCount, 0); assert.equal(rpc.submissions.length, 0);
  assert.equal(recovery.approval.intents.length, 0);
  rpc.fees = frozenFees;
  const replay = evmCore(temporary.root, rpc, setup.wrapping);
  const replayNative = context.mock.method(replay.local, "request"), replayLoads = setup.wrapping.loads;
  assert.equal((await replay.core.transfer.resume(prepared.operation_id) as { state: string }).state, "completed");
  assert.equal(replayNative.mock.callCount(), 0); assert.equal(setup.wrapping.loads, replayLoads);
  assert.equal(nonceReads.mock.callCount(), before.nonce); assert.equal(rpc.broadcastCount, 0); assert.equal(rpc.submissions.length, 0);
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
  assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state,
    "submitted_pending");
  {
    assert.equal((await setup.core.transfer.resume(prepared.operation_id, undefined, true) as { state: string }).state, "completed");
  }
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
