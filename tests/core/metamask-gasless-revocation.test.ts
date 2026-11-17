import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
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
import { metaMaskRevocationRequestIdHash } from "../../src/metamask-gasless/revocation/requests.js";
import type { MetaMaskRevocationSendInput, MetaMaskRevocationSubmission, MetaMaskRevocationWalletPort } from "../../src/metamask-gasless/revocation/wallet.js";
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
/** The owner's wallet: the check, then the send, each recorded; every answer names the sent id's own hash. */
class Wallet implements MetaMaskRevocationWalletPort {
  readonly checked: MetaMaskRevocationSendInput[] = [];
  readonly sent: MetaMaskRevocationSendInput[] = [];
  constructor(readonly answer: Readonly<Record<string, unknown>> = { disposition: "pending" }) {}
  async check(input: MetaMaskRevocationSendInput) { this.checked.push(input); }
  async send(input: MetaMaskRevocationSendInput) {
    this.sent.push(input);
    return { ...this.answer, requestIdHash: metaMaskRevocationRequestIdHash(input.requestId) } as unknown as MetaMaskRevocationSubmission;
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
/** The step a pending or possibly sent disable names: read this request's MetaMask status again by its hash. */
const readAgain = (hash: string, id: string) => `Run apn operation resume --operation ${id} to read MetaMask's status of this disable ` +
  `request again: it lists it under revocation_requests as request_id_hash ${hash}. That status is MetaMask's word; the chain read stays the record.`;

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
    ["a transaction in flight", { pricing: { ...pricing, pendingNonce: 4n } }, "mm_revoke_transaction_pending"],
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
    clock: f.clock, wait: f.wait, metaMaskGasless: { ...f.dependencies, revocation: { approval, wallet, references: f.providerReferences } } }) };
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
  const requestId = wallet.sent[0]?.requestId ?? "", hash = metaMaskRevocationRequestIdHash(requestId);
  assert.match(requestId, UUID, "APN names the request id itself");
  assert.deepEqual(wallet.sent, [{ requestId, chainId: 1329, from: f.binding.address, intent: `APN ${id}: disable delegation ${call.delegationHash}`,
    payload: { to: call.to, data: call.data, value: "0x0", gas: "0xea60", nonce: "0x0", maxFeePerGas: "0x77359400",
      maxPriorityFeePerGas: "0xf4240" } }]);
  assert.deepEqual(wallet.checked, wallet.sent, "the wallet checked the very request it then sent");
  assert.deepEqual((result.data as Json).submission, { disposition: "pending", requestIdHash: hash });
  assert.equal(JSON.stringify(result).includes(requestId), false, "the id itself is never shown");
  assert.equal((result.data as Json).maximum_native_cost_wei, chain.maximumNativeCostWei);
  assert.deepEqual(result.next_actions, ["Confirm this disable request in MetaMask Mobile or the email registered to your MetaMask dashboard.",
    readAgain(hash, id), `apn operation resume --operation ${id}`]);
  // Nothing in the operation moved and no USDC relay was requested again; the id is sealed beside it, under its hash.
  assert.deepEqual(await f.record(id), before); assert.equal(f.provider.submissions.length, submissions);
  const sealed = { lane: "metamask-revocation", providerId: "metamask-agent-wallet", profileHash: before.profileHash, operationId: id,
    referenceHash: hash } as const;
  assert.equal(await f.providerReferences.open(sealed), requestId);
  f.rpc.phase = "disabled";
  const disabledStatus = await f.core.execute({ command: "operation.status", operationId: id });
  assert.equal(disabledStatus.ok, true);
  assert.equal((disabledStatus.operation as Json).revocation_requests, undefined, "status lists no revoke request");
  f.revocationReader.answers.set(requestId, { outcome: "verified", status: "AWAITING_MFA", transactionHash: null,
    mfa: { expiresAt: "2030-01-01T00:10:00.000Z", authMethod: "qr" }, responseHash: "f".repeat(64) });
  const proved = await f.core.execute({ command: "operation.resume", operationId: id });
  assert.equal((proved.operation as Json).state, "revoked_unused");
  // The chain decided the operation; MetaMask's status of the request is reported beside it, read by its sealed id.
  assert.deepEqual((proved.operation as Json).revocation_requests, [{ request_id_hash: hash, outcome: "verified", status: "AWAITING_MFA",
    transaction_hash: null, mfa: { expires_at: "2030-01-01T00:10:00.000Z", auth_method: "qr" }, response_hash: "f".repeat(64), reason: null, check: null }]);
  assert.deepEqual(f.revocationReader.reads, [{ requestId, projectHash: "c".repeat(64), binding: { sender: f.binding.address, chainId: 1329 } }]);
  const again = await core(new Approval(), new Wallet()).execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.equal(again.error?.code, "APN_OPERATION_BLOCKED"); assert.equal(again.error?.details?.reason, "mm_revoke_not_revocable");
});

test("the disable refuses before any send without consent, gas, a foreground terminal or a revocable state", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { f, id, core } = await seiProviderFailed(temporary.root);
  const refused = new Wallet(), declined = await core(new Approval(false), refused).execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.equal(declined.error?.details?.reason, "mm_revoke_refused"); assert.equal(refused.sent.length, 0); assert.equal(refused.checked.length, 0);
  const calls = f.rpc.calls.length;
  const headless = await f.core.execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.equal(headless.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED"); assert.equal(f.rpc.calls.length, calls);
  f.rpc.revocationChain = { ...(f.rpc.revocationChain as Json), nativeBalanceWei: "0" } as never;
  const poor = new Approval(), poorWallet = new Wallet();
  const unfunded = await core(poor, poorWallet).execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.equal(unfunded.error?.code, "APN_INSUFFICIENT_GAS"); assert.equal(unfunded.error?.details?.native_balance_wei, "0");
  assert.deepEqual(unfunded.next_actions, [`Send at least 120000000000000 wei of chain 1329's native coin (no USDC) to ${f.binding.address}, then rerun: apn gasless transfer revoke --operation ${id}`]);
  assert.equal(poor.seen.length, 0); assert.equal(poorWallet.sent.length, 0);
  // The balance is read again inside the send lock, right before the helper: mm's send read it there, the helper does not.
  f.rpc.revocationChain = { ...(f.rpc.revocationChain as Json), nativeBalanceWei: "500000000000000" } as never;
  f.rpc.sendBalanceWei = "119999999999999";
  const drained = new Approval(), drainedWallet = new Wallet();
  const late = await core(drained, drainedWallet).execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.equal(late.error?.code, "APN_INSUFFICIENT_GAS"); assert.equal(late.error?.details?.reason, "mm_revoke_native_gas");
  assert.equal(late.error?.details?.native_balance_wei, "119999999999999");
  assert.equal(drained.seen.length, 1, "the owner had confirmed"); assert.equal(drainedWallet.sent.length, 0, "nothing was sent");
  assert.equal(drainedWallet.checked.length, 0);
  // None of these refusals sealed a request id.
  assert.deepEqual(await readdir(join(f.state.root, "metamask-revocation-request-references")).catch(() => []), []);
  f.rpc.sendBalanceWei = undefined;
  const other = await temporaryState(); t.after(other.cleanup);
  const fresh = await mmFixture(other.root), waiting = await fresh.prepare();
  const never = await new ApnCore({ state: fresh.state, clock: fresh.clock, metaMaskGasless: { ...fresh.dependencies,
    revocation: { approval: new Approval(), wallet: new Wallet(), references: fresh.providerReferences } } })
    .execute({ command: "gasless.transfer.revoke", operationId: waiting.id });
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

test("an unknown disable answer names MetaMask's error code and when another disable is safe", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { f, id, core } = await seiProviderFailed(temporary.root), before = await f.record(id);
  const wallet = new Wallet({ disposition: "unknown", reason: "provider_handoff_outcome_unknown", providerErrorCode: "POLICY_VIOLATION" });
  const result = await core(new Approval(), wallet).execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal((result.data as Json).submission.providerErrorCode, "POLICY_VIOLATION");
  const from = f.binding.address, hash = metaMaskRevocationRequestIdHash(wallet.sent[0]!.requestId);
  assert.equal((result.data as Json).submission.requestIdHash, hash);
  assert.deepEqual(result.next_actions, [`MetaMask did not confirm this disable (MetaMask error code POLICY_VIOLATION). Run the resume below: ` +
    `it reads whether the delegation is disabled. If it is not, and eth_getTransactionCount(${from}, "latest") and ` +
    `eth_getTransactionCount(${from}, "pending") on this chain both still answer 0x0 (0), no transaction used ` +
    `this disable's nonce or waits for it: remove the cause, then run apn gasless transfer revoke --operation ${id} again. ` +
    `It moves no USDC, and with the same nonce only one of the two disables can land.`,
  readAgain(hash, id), `apn operation resume --operation ${id}`]);
  assert.deepEqual(await f.record(id), before);
  const plain = await core(new Approval(), new Wallet({ disposition: "unknown", reason: "provider_handoff_outcome_unknown" }))
    .execute({ command: "gasless.transfer.revoke", operationId: id });
  assert.match(plain.next_actions![0]!, /^MetaMask did not confirm this disable\. Run the resume below/u);
  assert.match(plain.next_actions![1]!, /^Run apn operation resume --operation [0-9a-f]{64} to read MetaMask's status of this disable request again/u);
  // The helper's own closed facts say nothing left the machine: the answer stays unknown, and the step names the cause.
  const stopped = (helperFailure: string, stage: string, check: string) => core(new Approval(), new Wallet({ disposition: "unknown",
    reason: "provider_handoff_outcome_unknown", helperFailure, submitDiagnostic: { mode: "submit", stage: stage as never,
      post: "not_reached", httpStatus: null, check: check as never, providerError: null, providerStatus: null, responseTx: null } }))
    .execute({ command: "gasless.transfer.revoke", operationId: id });
  const safe = `No disable left this machine and nonce 0x0 (0) of ${from} is untouched, so running revoke again is safe.`;
  const again = `apn gasless transfer revoke --operation ${id} again`;
  const unsent = await stopped("mm_gasless_binding_changed", "private_state", "unclassified");
  assert.equal((unsent.data as Json).submission.disposition, "unknown");
  assert.deepEqual(unsent.next_actions, [`The MetaMask helper stopped before any network call: the signed-in MetaMask Agent Wallet is in another ` +
    `project or has another wallet than ${from} selected (mm_gasless_binding_changed). ${safe} Select the server wallet ${from} in the MetaMask ` +
    `Agent Wallet, then run ${again}.`, `apn operation resume --operation ${id}`]);
  // Each stop names its own cause: the deadline, the session, the SDK load. None blames the session or wallet for another.
  assert.equal((await stopped("mm_gasless_expired", "post", "deadline")).next_actions![0], `The MetaMask helper stopped before any network ` +
    `call: its 120-second send bound passed before the request was written (mm_gasless_expired). ${safe} Run ${again}.`);
  assert.equal((await stopped("mm_gasless_session_unavailable", "private_state", "unclassified")).next_actions![0], `The MetaMask helper ` +
    `stopped before any network call: the MetaMask Agent Wallet is signed out or its session expired (mm_gasless_session_unavailable). ${safe} ` +
    `Sign in to the MetaMask Agent Wallet again, then run ${again}.`);
  assert.equal((await stopped("mm_gasless_internal", "sdk_load", "unclassified")).next_actions![0], `The MetaMask helper stopped before any ` +
    `network call: the MetaMask SDK bundled with APN did not load (mm_gasless_internal). ${safe} Run ${again}; reinstall APN if it stops here again.`);
  // At the session read: another mm writing its files is no sign-in problem, nor are files that are not private.
  assert.equal((await stopped("mm_gasless_state_busy", "private_state", "unclassified")).next_actions![0], `The MetaMask helper stopped ` +
    `before any network call: another mm process was writing the MetaMask Agent Wallet's files (mm_gasless_state_busy). ${safe} Run ${again}.`);
  assert.equal((await stopped("mm_gasless_state_security", "private_state", "unclassified")).next_actions![0], `The MetaMask helper stopped ` +
    `before any network call: the MetaMask Agent Wallet's files on this machine are not private to this user (their owner, their permissions ` +
    `or a symbolic link on the way to them) (mm_gasless_state_security). ${safe} Make the MetaMask Agent Wallet's directory and files owned by ` +
    `this user and private to it, with no symbolic link on the way, then run ${again}.`);
  assert.match((await stopped("mm_gasless_state_corrupt", "private_state", "unclassified")).next_actions![0]!,
    /: the MetaMask Agent Wallet's files on this machine could not be read \(mm_gasless_state_corrupt\)\. .* Sign in to the MetaMask Agent Wallet again, then run /u);
  // A stop past the request's own checks is not proof that nothing left: the resume step, as for any unknown answer.
  assert.match((await stopped("mm_gasless_submit_unknown", "post", "unclassified")).next_actions![0]!, /^MetaMask did not confirm this disable\. /u);
});
