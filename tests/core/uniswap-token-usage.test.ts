import assert from "node:assert/strict";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { swapMechanismDigest } from "../../src/swap/pin.js";
import { UniswapTokenCustody } from "../../src/swap/uniswap-v3/token-custody.js";
import { newUniswapTokenOperation } from "../../src/swap/uniswap-v3/token-operation.js";
import { createUniswapTokenRoute, UNISWAP_TOKEN_MECHANISM_PIN, verifyUniswapTokenUsdtState } from "../../src/swap/uniswap-v3/token-route.js";
import { UniswapTokenUsage } from "../../src/swap/uniswap-v3/token-usage.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { StateStore } from "../../src/state.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1";
const NOW = new Date("2026-09-22T00:00:00.000Z");
const clock = { now: () => NOW };

async function setup(root: string, daily = "1500000") {
  const admissions = [UNISWAP_USDC, ETHEREUM_USDT].map((identifier) => ({ chain: "eip155:1", kind: "token" as const,
    identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: daily,
    mechanism: UNISWAP_TOKEN_MECHANISM_PIN }));
  const policy = await activateDirectPolicy(root, "token-swap", { accounts: { evm: ACCOUNT }, admissions, now: NOW });
  const ledger = new AssetUsageLedger(root), usage = new UniswapTokenUsage(new StateStore(root), clock, ledger);
  return { ledger, usage, policy };
}

function operation(policyDigest: string, id: string) {
  const gas = { gasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1" };
  return newUniswapTokenOperation({ operationId: id.repeat(64), profile: "token-swap", account: ACCOUNT,
    route: createUniswapTokenRoute({ inputToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, recipient: ACCOUNT,
      amountIn: "1000000", amountOutMinimum: "990000", deadline: 1_900_000_000 }), approvalCapAtomic: "1000000",
    allowanceAtPrepare: "0", approvalGas: gas, swapGas: gas, cleanupGas: gas, maximumNativeDebitWei: "600000",
    policyDigest, mechanismDigest: swapMechanismDigest(UNISWAP_TOKEN_MECHANISM_PIN), now: NOW });
}
function quoteRequest() { return { command: "swap.uniswap-token.quote" as const, profile: "token-swap", account: ACCOUNT, recipient: ACCOUNT,
  sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "990000",
  approvalCapAtomic: "1000000", deadline: 1_900_000_000, maxApprovalGasLimit: "100000", maxSwapGasLimit: "100000",
  maxCleanupGasLimit: "100000", maxFeePerGas: "2", maxPriorityFeePerGas: "1", maxNativeDebitWei: "600000" }; }

test("token usage atomically enforces the daily source cap across concurrent operations", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root);
  const settled = await Promise.allSettled([s.usage.reserve(operation(s.policy.policyDigest, "a")), s.usage.reserve(operation(s.policy.policyDigest, "b"))]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await s.ledger.usage({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "token", identifier: UNISWAP_USDC } }, NOW)).amountAtomic, "1000000");
  await assert.rejects(s.usage.admitQuote(quoteRequest(), NOW), { code: "APN_OPERATION_BLOCKED" });
});

test("token usage is idempotent across restart and retains unknown principal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root, "2000000"), op = operation(s.policy.policyDigest, "c");
  const first = await s.usage.reserve(op), restarted = new UniswapTokenUsage(new StateStore(temporary.root), clock, new AssetUsageLedger(temporary.root));
  assert.deepEqual(await restarted.reserve(op), first);
  assert.equal((await restarted.follow(op, "unknown_finality")).state, "unknown_finality");
  assert.equal((await s.ledger.usage({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "token", identifier: UNISWAP_USDC } }, NOW)).amountAtomic, "1000000");
});

test("token usage finalizes consumed principal and releases only proven no-debit outcomes", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root, "3000000");
  const success = operation(s.policy.policyDigest, "d"), reverted = operation(s.policy.policyDigest, "e"), preswap = operation(s.policy.policyDigest, "f");
  await s.usage.reserve(success); await s.usage.follow(success, "finalized");
  await s.usage.reserve(reverted); await s.usage.follow(reverted, "failed_confirmed_revert");
  await s.usage.reserve(preswap); await s.usage.follow(preswap, "failed_before_effect");
  assert.equal((await s.ledger.usage({ account: ACCOUNT, chain: "eip155:1", asset: { kind: "token", identifier: UNISWAP_USDC } }, NOW)).amountAtomic, "1000000");
  assert.equal((await s.usage.current(success)).state, "finalized");
  assert.equal((await s.usage.current(reverted)).state, "failed_confirmed_revert");
  assert.equal((await s.usage.current(preswap)).state, "failed_before_effect");
});

test("account custody serializes concurrent nonce allocation and recovers it after restart", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await setup(temporary.root, "3000000");
  const state = new StateStore(temporary.root), wrapping = { load: async () => null, create: async () => Buffer.alloc(32) };
  const call = async (method: string) => { if (method === "eth_getTransactionCount") return "0x7"; throw new Error(method); };
  const custody = new UniswapTokenCustody(state, wrapping, call, () => NOW), first = operation(s.policy.policyDigest, "1"), second = operation(s.policy.policyDigest, "2");
  const nonces = await Promise.all([custody.withAccountLock(ACCOUNT, async () => await custody.allocateNonce(first, "approval")),
    custody.withAccountLock(ACCOUNT, async () => await custody.allocateNonce(second, "approval"))]);
  assert.deepEqual([...nonces].sort(), ["7", "8"]);
  const restarted = new UniswapTokenCustody(new StateStore(temporary.root), wrapping, call, () => NOW);
  assert.equal(await restarted.withAccountLock(ACCOUNT, async () => await restarted.allocateNonce(first, "approval")), nonces[0]);
  assert.equal(await restarted.withAccountLock(ACCOUNT, async () => await restarted.allocateNonce(operation(s.policy.policyDigest, "3"), "approval")), "9");
});

test("token USDT behavior pins reject deprecated and fee-bearing state", async () => {
  const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
  const verify = async (values: readonly bigint[]) => { let index = 0;
    await verifyUniswapTokenUsdtState(async (method) => { assert.equal(method, "eth_call"); return word(values[index++]!); }, "0x64"); };
  await verify([0n, 0n, 0n]);
  for (const values of [[1n, 0n, 0n], [0n, 1n, 0n], [0n, 0n, 1n]] as const) {
    await assert.rejects(verify(values), (error: any) => error.code === "APN_OPERATION_BLOCKED" && error.details?.reason === "uniswap_code_pin_drift");
  }
});
