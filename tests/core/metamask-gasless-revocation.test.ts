import assert from "node:assert/strict";
import test from "node:test";
import { hashDelegation } from "@metamask/delegation-core";
import { decodeFunctionData, toFunctionSelector } from "viem";
import { parseArgv } from "../../src/cli.js";
import { ApnCore } from "../../src/core.js";
import { foregroundHandoffEnvelope } from "../../src/mcp-foreground-handoff.js";
import { projectMcpForegroundHandoff } from "../../src/mcp-projection.js";
import { MetaMaskGaslessRpc } from "../../src/metamask-gasless/chain/rpc.js";
import { mmDispatchIntent } from "../../src/metamask-gasless/dispatch.js";
import type { MetaMaskRevocationApprovalPort, MetaMaskRevocationSummary } from "../../src/metamask-gasless/revocation/consent.js";
import { mmDisableCall } from "../../src/metamask-gasless/revocation/call.js";
import type { MetaMaskRevocationSubmission, MetaMaskRevocationWalletPort } from "../../src/metamask-gasless/revocation/wallet.js";
import { mmRegistry } from "../../src/metamask-gasless/registry.js";
import type { Hex } from "../../src/model.js";
import { temporaryState } from "./helpers.js";
import { mmFixture } from "./metamask-gasless-helpers.js";
import { BASE_FEE, block, FakeRpcTransport, intent, now, RPC_URL, type Json } from "./metamask-gasless-rpc-fake.js";

const DISABLE = toFunctionSelector("disableDelegation((address,address,bytes32,(address,bytes,bytes)[],uint256,bytes))");
const ABI = [{ type: "function", name: "disableDelegation", stateMutability: "nonpayable", inputs: [{ name: "d", type: "tuple",
  components: [{ name: "delegate", type: "address" }, { name: "delegator", type: "address" }, { name: "authority", type: "bytes32" },
    { name: "caveats", type: "tuple[]", components: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" },
      { name: "args", type: "bytes" }] }, { name: "salt", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [] }] as const;

class Approval implements MetaMaskRevocationApprovalPort {
  readonly seen: MetaMaskRevocationSummary[] = [];
  constructor(readonly answer = true) {}
  async confirm(summary: MetaMaskRevocationSummary) { this.seen.push(summary); return this.answer; }
}
class Wallet implements MetaMaskRevocationWalletPort {
  readonly sent: Parameters<MetaMaskRevocationWalletPort["send"]>[0][] = [];
  constructor(readonly answer: MetaMaskRevocationSubmission = { disposition: "pending", requestIdHash: "e".repeat(64) }) {}
  async send(input: Parameters<MetaMaskRevocationWalletPort["send"]>[0]) { this.sent.push(input); return this.answer; }
}

test("the disable call carries exactly the dispatched delegation, whose official hash is the operation's", () => {
  const value = intent(block(8453, 100n)), call = mmDisableCall(value);
  assert.equal(call.data.slice(0, 10), DISABLE); assert.equal(call.to, mmRegistry(8453).row.protocol.manager.address);
  assert.equal(call.from, value.binding.address);
  const decoded = decodeFunctionData({ abi: ABI, data: call.data }).args[0];
  assert.equal(decoded.delegator.toLowerCase(), value.unsignedDelegation.delegator);
  assert.equal(decoded.signature, "0x");
  assert.equal(hashDelegation({ ...decoded, salt: decoded.salt, caveats: [...decoded.caveats] } as never), value.delegationHash);
});

test("disable pricing reads the finality proofs, the manager's own hash and the delegator's gas at latest", async (t) => {
  const value = intent(block(8453, 100n)), call = mmDisableCall(value);
  const pricing = { managerHash: value.delegationHash as Hex, nonce: 3n, gas: 80_000n, priority: 2_000_000n, balance: 10n ** 15n, l1: 5_000n, operator: 7n };
  const transport = new FakeRpcTransport(8453, { finality: 2500n, head: 2501n, pricing });
  const chain = await new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport }).revocation(value, call, "a".repeat(64));
  const maxFee = 2n * BASE_FEE + 2_000_000n;
  assert.deepEqual(chain, { finality: block(8453, 2500n), latest: block(8453, 2501n), nonceAtomic: "3", gasLimitAtomic: "80000",
    maxFeePerGasAtomic: maxFee.toString(), maxPriorityFeePerGasAtomic: "2000000", l1FeeUpperWei: "5000", operatorFeeUpperWei: "7",
    maximumNativeCostWei: (80_000n * maxFee + 5_007n).toString(), nativeBalanceWei: (10n ** 15n).toString() });
  const estimate = transport.calls.find(entry => entry.method === "eth_estimateGas")!;
  assert.deepEqual(estimate.params, [{ from: value.binding.address, to: call.to, data: call.data, value: "0x0" }]);
  assert.equal(transport.calls.some(entry => ["eth_sendRawTransaction", "eth_sendTransaction"].includes(entry.method)), false);
  for (const [name, options, reason] of [
    ["redeemed", { counter: () => 1n }, "mm_revoke_redeemed"],
    ["disabled", { disabled: () => true }, "mm_revoke_already_disabled"],
    ["other hash", { pricing: { ...pricing, managerHash: `0x${"ab".repeat(32)}` as Hex } }, "mm_revoke_hash_mismatch"],
  ] as const) await t.test(name, async () => {
    const refused = new FakeRpcTransport(8453, { finality: 2500n, head: 2501n, pricing, ...options });
    await assert.rejects(new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport: refused }).revocation(value, call, "a".repeat(64)),
      (error: Json) => error.details?.reason === reason);
    assert.equal(refused.calls.some(entry => entry.method === "eth_estimateGas"), false);
  });
  await t.test("a call the manager would refuse fails its estimate", async () => {
    const refused = new FakeRpcTransport(8453, { finality: 2500n, head: 2501n, pricing: { ...pricing, estimateRevert: true } });
    await assert.rejects(new MetaMaskGaslessRpc({ chainId: 8453, rpcUrl: RPC_URL, clock: now, transport: refused }).revocation(value, call, "a".repeat(64)));
  });
});

async function seiProviderFailed(root: string) {
  const f = await mmFixture(root, 1329), { id } = await f.prepare();
  f.rpc.phase = "pending"; f.rpc.candidate = null; f.provider.status = "failed"; f.provider.txHash = null;
  assert.equal((await f.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  return { f, id, core: (approval: MetaMaskRevocationApprovalPort, wallet: MetaMaskRevocationWalletPort) => new ApnCore({ state: f.state,
    clock: f.clock, wait: f.wait, metaMaskGasless: { ...f.dependencies, revocation: { approval, wallet } } }) };
}

test("Sei 7ca4e73c shape: the owner's wallet disables the delegation once, then resume proves revoked_unused", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { f, id, core } = await seiProviderFailed(temporary.root), before = await f.record(id);
  const status = await f.core.execute({ command: "operation.status", operationId: id });
  assert.deepEqual(status.next_actions, [`apn operation resume --operation ${id}`, `apn gasless transfer revoke --operation ${id}`]);
  const approval = new Approval(), wallet = new Wallet(), submissions = f.provider.submissions.length;
  const result = await core(approval, wallet).execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const call = mmDisableCall(mmDispatchIntent(before)), chain = f.rpc.revocationChain as Json;
  assert.equal(approval.seen.length, 1); assert.equal(approval.seen[0]!.call.callHash, call.callHash);
  assert.deepEqual(wallet.sent, [{ chainId: 1329, from: f.binding.address, intent: `APN ${id}: disable delegation ${call.delegationHash}`,
    payload: { to: call.to, data: call.data, value: "0x0", gas: "0xea60", nonce: "0x0", maxFeePerGas: "0x77359400",
      maxPriorityFeePerGas: "0xf4240" } }]);
  assert.equal((result.data as Json).submission.disposition, "pending");
  assert.equal((result.data as Json).maximum_native_cost_wei, chain.maximumNativeCostWei);
  assert.deepEqual(result.next_actions, ["Confirm this disable request in MetaMask Mobile or the email registered to your MetaMask dashboard.",
    `apn operation resume --operation ${id}`]);
  // Nothing in the operation moved and no USDC relay was requested again.
  assert.deepEqual(await f.record(id), before); assert.equal(f.provider.submissions.length, submissions);
  f.rpc.phase = "disabled";
  const proved = await f.core.execute({ command: "operation.resume", operationId: id });
  assert.equal((proved.operation as Json).state, "revoked_unused");
  const again = await core(new Approval(), new Wallet()).execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.equal(again.error?.code, "APN_OPERATION_BLOCKED"); assert.equal(again.error?.details?.reason, "mm_revoke_not_revocable");
});

test("the disable refuses before any send without consent, gas, a foreground terminal or a revocable state", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { f, id, core } = await seiProviderFailed(temporary.root);
  const refused = new Wallet(), declined = await core(new Approval(false), refused).execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.equal(declined.error?.details?.reason, "mm_revoke_refused"); assert.equal(refused.sent.length, 0);
  const calls = f.rpc.calls.length;
  const headless = await f.core.execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.equal(headless.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED"); assert.equal(f.rpc.calls.length, calls);
  f.rpc.revocationChain = { ...(f.rpc.revocationChain as Json), nativeBalanceWei: "0" } as never;
  const poor = new Approval(), poorWallet = new Wallet();
  const unfunded = await core(poor, poorWallet).execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.equal(unfunded.error?.code, "APN_INSUFFICIENT_GAS"); assert.equal(unfunded.error?.details?.native_balance_wei, "0");
  assert.deepEqual(unfunded.next_actions, [`Send at least 120000000000000 wei of chain 1329's native coin (no USDC) to ${f.binding.address}, then rerun: apn gasless transfer revoke --operation ${id}`]);
  assert.equal(poor.seen.length, 0); assert.equal(poorWallet.sent.length, 0);
  const other = await temporaryState(); t.after(other.cleanup);
  const fresh = await mmFixture(other.root), waiting = await fresh.prepare();
  const never = await new ApnCore({ state: fresh.state, clock: fresh.clock, metaMaskGasless: { ...fresh.dependencies,
    revocation: { approval: new Approval(), wallet: new Wallet() } } }).execute({ command: "gasless.transfer.revoke", operationId: waiting.id });
  assert.equal(never.error?.details?.reason, "mm_revoke_not_revocable"); assert.equal(fresh.rpc.calls.includes("revocation"), false);
});

test("CLI binds the disable from argv and MCP answers it only with the same foreground CLI handoff", () => {
  const id = "c".repeat(64);
  assert.deepEqual(parseArgv(["gasless", "transfer", "revoke", "--operation", id]).request, { command: "gasless.transfer.revoke", operationId: id });
  const envelope = foregroundHandoffEnvelope(projectMcpForegroundHandoff(), { command: "gasless transfer revoke", arguments: { operation: id } });
  assert.equal(envelope.command, "gasless.transfer.revoke"); assert.equal(envelope.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED");
  assert.deepEqual(envelope.error?.details?.cli_handoff_argv, ["apn", "gasless", "transfer", "revoke", "--operation", id]);
  assert.deepEqual(envelope.next_actions, [`apn gasless transfer revoke --operation ${id}`]);
});
