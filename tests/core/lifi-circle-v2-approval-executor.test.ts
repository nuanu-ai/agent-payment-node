import assert from "node:assert/strict";
import test from "node:test";
import { keccak256, pad, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { StateStore, sealWallet } from "../../src/state.js";
import { CircleV2ApprovalExecutor, type CircleApprovalRecord, type CircleApprovalRpc } from "../../src/lifi/circle-v2-approval-executor.js";
import { temporaryState } from "./helpers.js";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const spender = "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408";
const limits = { maxGasLimitAtomic: "100000", maxFeePerGasWei: "2000000000",
  maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "200000000000000", ttlMs: 60000 };
const now = () => 1_800_000_000_000;
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const tmp = await temporaryState(); t.after(tmp.cleanup);
  const state = new StateStore(tmp.root);
  await state.initialize();
  await state.writeWallet(sealWallet({ schemaVersion: "apn.state.v1", profile: "test", profileHash: state.profileHash("test"),
    address: account.address, createdAt: "2026-01-01T00:00:00.000Z", bindingHash: "binding" }));
  let sends = 0, signings = 0, allowance = "0", nonce = "7", balance = "434611", ambiguous = false, include = false, wrongLog = false;
  let raw: Hex | null = null;
  const rpc: CircleApprovalRpc = {
    chainId: 8453,
    read: async () => ({ chainId: 8453, payer: account.address, token, spender, blockNumber: "12345",
      blockHash: `0x${"a".repeat(64)}`, latestNonceAtomic: nonce, pendingNonceAtomic: nonce,
      usdcBalanceAtomic: balance, usdcAllowanceAtomic: allowance, nativeBalanceWei: "200000000000000",
      gasLimitAtomic: "100000", maxFeePerGasWei: "2000000000", maxPriorityFeePerGasWei: "100000000" }),
    send: async sent => { sends++; raw = sent; if (ambiguous) throw new Error("lost response"); return keccak256(sent); },
    observe: async hash => include && raw !== null ? { status: "success", safe: true,
      receipt: { chainId: 8453, transactionHash: hash, blockNumberAtomic: "12345", blockHash: `0x${"a".repeat(64)}` as Hex,
        logs: [{ address: token as Hex, topics: [keccak256(Buffer.from("Approval(address,address,uint256)")),
          pad(account.address).toLowerCase() as Hex, pad(wrongLog ? account.address : spender).toLowerCase() as Hex], data: toHex(430000n, { size: 32 }) }] } } : null,
  };
  const signer = { sign: async (r: CircleApprovalRecord) => {
    signings++;
    const e = r.preparation.transaction;
    return await account.signTransaction({ type: "eip1559", chainId: 8453, to: token as Hex,
      data: e.data as Hex, value: 0n, nonce: Number(e.nonceAtomic), gas: BigInt(e.gasLimitAtomic),
      maxFeePerGas: BigInt(e.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGasWei), accessList: [] });
  } };
  const make = () => new CircleV2ApprovalExecutor(state, rpc, signer, limits, now);
  const prepare = () => make().prepare({ profile: "test", payer: account.address, walletBindingHash: "binding",
    walletCreatedAt: "2026-01-01T00:00:00.000Z", approvalCapAtomic: "430000" });
  return { make, prepare, get sends() { return sends; }, get signings() { return signings; },
    set nonce(v: string) { nonce = v; }, set balance(v: string) { balance = v; },
    set allowance(v: string) { allowance = v; }, set ambiguous(v: boolean) { ambiguous = v; },
    set include(v: boolean) { include = v; }, set wrongLog(v: boolean) { wrongLog = v; } };
}

test("durable one-send boundary survives restart and ambiguous response", async t => {
  const f = await fixture(t), p = await f.prepare(); f.ambiguous = true;
  const unknown = await f.make().execute(p.id, async () => true);
  assert.equal(unknown.phase, "unknown_finality"); assert.equal(unknown.submissionAttempts, 1);
  assert.equal(unknown.transactionHash?.length, 66); assert.equal(unknown.rawTransaction?.slice(0, 4), "0x02");
  assert.equal((await f.make().execute(p.id, async () => { throw new Error("reapproval"); })).phase, "unknown_finality");
  assert.equal(f.sends, 1); assert.equal(f.signings, 1);
});
test("refresh rejects nonce and balance drift before signing or broadcast", async t => {
  const f = await fixture(t), p = await f.prepare(); f.nonce = "8";
  await assert.rejects(f.make().execute(p.id, async () => true), { code: "APN_REPREPARE_REQUIRED" });
  assert.equal(f.signings, 0); assert.equal(f.sends, 0);
  f.nonce = "7"; f.balance = "429999";
  await assert.rejects(f.make().execute(p.id, async () => true), { code: "APN_PROVIDER_PROTOCOL" });
  assert.equal(f.sends, 0);
});
test("exact finalized Approval event and fresh allowance are both needed for completion", async t => {
  const f = await fixture(t), p = await f.prepare(); f.include = true; f.wrongLog = true; f.allowance = "430000";
  assert.equal((await f.make().execute(p.id, async () => true)).phase, "unknown_finality");
  f.wrongLog = false;
  assert.equal((await f.make().status(p.id)).phase, "completed");
  assert.equal(f.sends, 1);
});
test("refused consent never signs or broadcasts", async t => {
  const f = await fixture(t), p = await f.prepare();
  assert.equal((await f.make().execute(p.id, async () => false)).phase, "failed_before_effect");
  assert.equal(f.signings, 0); assert.equal(f.sends, 0);
});
