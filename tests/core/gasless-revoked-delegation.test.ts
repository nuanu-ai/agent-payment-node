import assert from "node:assert/strict";
import test from "node:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import type { GaslessIntent, GaslessObservation } from "../../src/gasless/model.js";
import type { GaslessRpcPort } from "../../src/gasless/ports.js";
import { gaslessDeployment } from "../../src/gasless/registry.js";
import { gaslessObservedContracts, readAccountAt } from "../../src/gasless/rpc-state.js";
import { OperationService } from "../../src/operation-service.js";
import { gaslessFixture, GaslessTestRpc, testWord } from "./gasless-helpers.js";
import { temporaryState } from "./helpers.js";

type Revocation = "consumed" | "permit_nonce_unconsumed" | "safe_head_read";

/**
 * The owner revoked the EIP-7702 delegation (code `0x`) after the transfer landed and before APN recorded its safe
 * settlement. Since 0.5.43 the account is read once at the latest head (`accountBlock`) and so sees the revocation.
 */
class RevokedAfterEffectRpc extends GaslessTestRpc {
  revocation: Revocation | null = null;
  override async observe(intent: GaslessIntent, identity: Parameters<GaslessRpcPort["observe"]>[1],
    cursor: Parameters<GaslessRpcPort["observe"]>[2]): Promise<GaslessObservation> {
    const result = await super.observe(intent, identity, cursor);
    if (this.revocation === null || result.settlement === null) return result;
    const s = result.settlement, initial = intent.initialSnapshot;
    const account = { ...s.safeAccount, delegation: "empty" as const,
      ...(this.revocation === "permit_nonce_unconsumed" ? { permitNonceAtomic: initial.permitNonceAtomic } : {}) };
    const latest = { numberAtomic: "2000", hash: testWord("2000"), timestampAtomic: s.safeBlock.timestampAtomic };
    // "safe_head_read" is the shape written before 0.5.43: accounts read at the safe head, no `accountBlock`.
    const settlement = { ...s, effectAccount: account, safeAccount: account,
      ...(this.revocation === "safe_head_read" ? {} : { accountBlock: latest }) };
    return { ...result, settlement, evidenceHash: hashObject(settlement) };
  }
}

async function sent(root: string) {
  const now = new Date(Math.floor(Date.now() / 1000) * 1000), key = generatePrivateKey();
  const rpc = new RevokedAfterEffectRpc(8453, privateKeyToAccount(key).address, "empty", now);
  const s = await gaslessFixture(root, 8453, { now, key, rpc }), { id } = await s.prepare();
  const approved = await s.core.execute({ command: "gasless.transfer.approve", operationId: id });
  assert.equal(approved.ok, true, approved.error?.message); assert.equal((await s.record(id)).state, "submitted_pending");
  return { s, id, rpc };
}

test("gasless transfer whose delegation the owner revoked after the effect completes and reports the revocation", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { s, id, rpc } = await sent(temporary.root);
  rpc.revocation = "consumed";
  const resumed = await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(resumed.ok, true, resumed.error?.message);
  const done = await s.record(id);
  assert.equal(done.state, "completed"); assert.equal(done.terminal, true); assert.equal(done.failure, null);
  assert.equal(done.settlement?.safeAccount.delegation, "empty"); assert.equal(done.settlement?.accountBlock?.numberAtomic, "2000");
  const receipt = await s.core.execute({ command: "receipt.get", operationId: id }); assert.equal(receipt.ok, true, receipt.error?.message);
  const permission = (receipt.receipt as { permission: Record<string, unknown> }).permission;
  assert.equal(permission.initial_designation, "empty"); assert.equal(permission.observed_designation, "empty");
  assert.equal(permission.delegation_persists, false); assert.equal(permission.residual_allowance_read_at, "latest");
  await new OperationService(s.state).assertProfileAvailable(done.profileHash);
  // A completed operation is never observed again, and its stored proof keeps validating as it loads.
  rpc.result = "throw";
  assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
  assert.equal(hashObject(await s.record(id)), hashObject(done)); assert.equal(rpc.sends.length, 1);
});

test("a revoked delegation never stands in for a consumed nonce, and a pre-0.5.43 safe-head read still needs the delegation", async (t) => {
  for (const revocation of ["permit_nonce_unconsumed", "safe_head_read"] as const) await t.test(revocation, async (child) => {
    const temporary = await temporaryState(); child.after(temporary.cleanup); const { s, id, rpc } = await sent(temporary.root);
    rpc.revocation = revocation;
    assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
    const held = await s.record(id);
    assert.equal(held.state, "unknown_finality"); assert.equal(held.failure, "gasless_receipt_unresolved");
    assert.equal(held.terminal, false); assert.equal(held.settlement, null); assert.equal(held.observation?.settlement ?? null, null);
    await assert.rejects(new OperationService(s.state).assertProfileAvailable(held.profileHash), { code: "APN_OPERATION_BLOCKED" });
    // Once the latest-head read shows the permit consumed, the same operation completes without any new effect.
    rpc.revocation = "consumed";
    assert.equal((await s.core.execute({ command: "operation.resume", operationId: id })).ok, true);
    assert.equal((await s.record(id)).state, "completed"); assert.equal(rpc.sends.length, 1);
  });
});

test("the account read accepts only the pinned designation or no code; another contract's designation is refused", async () => {
  const owner = privateKeyToAccount(generatePrivateKey()).address, row = gaslessDeployment(8453);
  const contracts = gaslessObservedContracts({ token: row.token, paymaster: row.paymaster, entryPoint: row.entryPoint,
    delegate: row.delegate } as GaslessIntent);
  const block = { numberAtomic: "2000", hash: testWord("2000"), timestampAtomic: "1" };
  const read = (code: string) => readAccountAt(async (method) => method === "eth_getCode" ? code
    : method === "eth_call" ? `0x${"0".repeat(63)}8` : "0x1", contracts, owner, block, true);
  assert.equal((await read("0x")).delegation, "empty");
  assert.equal((await read(`0xef0100${row.delegate.slice(2).toLowerCase()}`)).delegation, "expected");
  await assert.rejects(read(`0xef0100${"12".repeat(20)}`), (error: unknown) => error instanceof ApnError &&
    error.code === "APN_RPC_PROTOCOL" && error.message.includes("gasless_delegation_identity"));
});
