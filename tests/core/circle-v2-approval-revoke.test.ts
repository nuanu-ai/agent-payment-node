/**
 * DEVELOPER-STATES-0.5.51 item 16: a Circle Base to Solana burn spends principal plus fee of what the approval granted, and
 * the rest stays on the WithFees wrapper. `apn circle approval revoke` clears it through the approval family itself: an
 * unsigned approve(wrapper, 0) intent, foreground consent at execute, one send, and a safe observation that proves the
 * Approval event with value 0 and a fresh zero allowance. Through the real CLI on a synthetic Base port.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, pad, parseTransaction, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { runCli } from "../../src/cli.js";
import { CircleV2ApprovalExecutor, type CircleApprovalRecord, type CircleApprovalRpc } from "../../src/lifi/circle-v2-approval-executor.js";
import { sealWallet, StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const account = privateKeyToAccount(`0x${"22".repeat(32)}`), token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const spender = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408", now = () => 1_800_000_000_000;
const LIMITS = ["--max-gas-limit-atomic", "100000", "--max-fee-per-gas-wei", "2000000000", "--max-priority-fee-per-gas-wei", "100000000",
  "--max-native-debit-wei", "200000000000000"];
const limits = { maxGasLimitAtomic: "100000", maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "200000000000000", ttlMs: 60000 };

async function setup(t: test.TestContext) {
  const temp = await temporaryState(); t.after(temp.cleanup);
  const state = new StateStore(temp.root); await state.initialize();
  await state.writeWallet(sealWallet({ schemaVersion: "apn.state.v1", profile: "payer", profileHash: state.profileHash("payer"), address: account.address,
    createdAt: "2026-01-01T00:00:00.000Z", bindingHash: "binding" }));
  // The chain: the allowance the wrapper holds, and every approval landed in a safe block with its own Approval event.
  const chain = { allowance: 0n, nonce: 7, landed: new Map<Hex, bigint>() }, sent: Hex[] = [];
  const rpc: CircleApprovalRpc = { chainId: 8453, origin: "https://base.example",
    read: async () => ({ chainId: 8453, payer: account.address, token, spender, blockNumber: "12345", blockHash: `0x${"a".repeat(64)}`,
      latestNonceAtomic: String(chain.nonce), pendingNonceAtomic: String(chain.nonce), usdcBalanceAtomic: "434611",
      usdcAllowanceAtomic: chain.allowance.toString(), nativeBalanceWei: "200000000000000", gasLimitAtomic: "100000",
      maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000", totalNativeDebitWei: "200000000000000" }),
    send: async raw => {
      sent.push(raw); const value = BigInt(`0x${(parseTransaction(raw).data ?? "0x").slice(-64)}`), hash = keccak256(raw);
      chain.allowance = value; chain.nonce += 1; chain.landed.set(hash, value); return hash;
    },
    observe: async hash => { const value = chain.landed.get(hash); return value === undefined ? null : { status: "success", safe: true, receipt: {
      chainId: 8453, transactionHash: hash, blockNumberAtomic: "12345", blockHash: `0x${"a".repeat(64)}` as Hex,
      logs: [{ address: token as Hex, topics: [keccak256(Buffer.from("Approval(address,address,uint256)")), pad(account.address).toLowerCase() as Hex,
        pad(spender).toLowerCase() as Hex], data: toHex(value, { size: 32 }) }] } }; },
    finalizedBatch: async () => { throw new Error("no never-lands read in this test"); } };
  const signer = { sign: async (r: CircleApprovalRecord) => { const e = r.preparation.transaction;
    return await account.signTransaction({ type: "eip1559", chainId: 8453, to: token, data: e.data as Hex, value: 0n, nonce: Number(e.nonceAtomic),
      gas: BigInt(e.gasLimitAtomic), maxFeePerGas: BigInt(e.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGasWei), accessList: [] }); } };
  const circleApproval = new CircleV2ApprovalExecutor(state, rpc, signer, limits, now);
  const wrappingSecret = { load: async () => Buffer.alloc(32), create: async () => Buffer.alloc(32) };
  const cli = async (argv: readonly string[]) => await runCli(argv, {}, { stateRoot: temp.root, circleApproval, wrappingSecret } as never);
  return { chain, sent, circleApproval, cli };
}
type ApprovalView = CircleApprovalRecord & { allowance: Record<string, unknown> };

test("a completed approval names the revoke command for its profile; revoke clears the residual with one consented, observed approve(0)", async t => {
  const f = await setup(t);
  const prepared = await f.cli(["circle", "approval", "prepare", "--profile", "payer", "--cap-atomic", "320000", ...LIMITS]);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const approvalId = (prepared.data as ApprovalView).id;
  assert.equal((await f.circleApproval.execute(approvalId, async () => true)).phase, "completed");
  const done = (await f.cli(["circle", "approval", "status", "--operation", approvalId])).data as ApprovalView;
  assert.deepEqual(done.allowance, { effect: "allowance_set", token, owner: account.address, spender, approvedAtomic: "320000",
    observedAtCompletionAtomic: "320000", spentBy: "apn circle source submit", revoke: "apn circle approval revoke --profile payer " +
      "--max-gas-limit-atomic <uint> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei> --max-native-debit-wei <wei>" });
  // The burn spent principal 170000 plus fee 131130 of it: 18870 atomic units stay on the wrapper.
  f.chain.allowance = 18870n;
  const revoke = await f.cli(["circle", "approval", "revoke", "--profile", "payer", ...LIMITS]);
  assert.equal(revoke.ok, true, JSON.stringify(revoke.error));
  const intent = revoke.data as ApprovalView;
  assert.deepEqual([revoke.command, intent.phase, intent.preparation.approvalCapAtomic, intent.preparation.observedAllowanceAtomic, intent.preparation.transaction.data],
    ["circle.approval.prepare", "prepared", "0", "18870", `0x095ea7b3${spender.slice(2).toLowerCase().padStart(64, "0")}${"0".repeat(64)}`]);
  assert.notEqual(intent.id, approvalId);
  assert.equal(f.sent.length, 1, "preparing the revoke signs and sends nothing");
  let consents = 0;
  const revoked = await f.circleApproval.execute(intent.id, async record => { consents += 1; assert.equal(record.preparation.approvalCapAtomic, "0"); return true; });
  assert.deepEqual([revoked.phase, revoked.observedAllowanceAtomic, f.sent.length, consents, f.chain.allowance], ["completed", "0", 2, 1, 0n]);
  const second = intent.id;
  const shown = (await f.cli(["circle", "approval", "status", "--operation", second])).data as ApprovalView;
  assert.deepEqual(shown.allowance, { effect: "allowance_revoked", token, owner: account.address, spender, approvedAtomic: "0", observedAtCompletionAtomic: "0" });
  assert.equal((await f.cli(["circle", "approval", "status", "--operation", second])).ok, true);
  assert.equal(f.sent.length, 2, "status observes without any resend");
});

test("revoke with nothing left on the wrapper is refused before any record, signature or send", async t => {
  const f = await setup(t);
  const refused = await f.cli(["circle", "approval", "revoke", "--profile", "payer", ...LIMITS]);
  assert.deepEqual([refused.error?.code, refused.error?.details?.reason, f.sent.length], ["APN_OPERATION_BLOCKED", "circle_v2_approval_nothing_to_revoke", 0]);
  assert.match(refused.error?.message ?? "", /already 0/u);
});
