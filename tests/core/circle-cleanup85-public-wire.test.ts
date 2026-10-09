import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyCleanup85PublicWire } from "../../src/circle-v2-evm/cleanup85-public-proof.js";
import { CircleEvmService } from "../../src/circle-v2-evm/runtime.js";
import { approvalObservationFixture } from "./circle-v2-evm-approval-public-fixture.js";
import { installCleanup85PublicFixture } from "./circle-cleanup85-public-fixture.js";
import type { CircleObservation } from "../../src/circle-v2-evm/protocol.js";
for (const variant of ["authentic83", "wrong_chain", "wrong_nonce", "wrong_sender", "wrong_value", "wrong_signature", "wrong_index", "duplicate_member", "zero_head", "old_head", "header_drift", "authorization", "reverted", "malformed_quantity"] as const) test(`public finalized wire verifier ${variant}`, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "cleanup85-wire-"))); t.after(() => rm(root, { recursive: true, force: true }));
  const { op } = await installCleanup85PublicFixture(root), o = structuredClone(approvalObservationFixture) as unknown as CircleObservation;
  const tx = o.transaction as Record<string, unknown>, receipt = o.receipt as Record<string, unknown>, block = o.canonicalBlock as Record<string, unknown>, head = o.finalityHead as Record<string, unknown>;
  if (variant === "wrong_chain") tx.chainId = "0x1"; if (variant === "wrong_nonce") tx.nonce = "0x55"; if (variant === "wrong_sender") tx.from = op.destinationCustody.walletAddress; if (variant === "wrong_value") tx.value = "0x1"; if (variant === "wrong_signature") tx.r = "0x" + "1".repeat(64);
  if (variant === "wrong_index") { tx.transactionIndex = "0x3"; receipt.transactionIndex = "0x3"; }
  if (variant === "duplicate_member") (block.transactions as unknown[]).push(tx.hash);
  if (variant === "zero_head") head.hash = "0x" + "0".repeat(64); if (variant === "old_head") head.timestamp = "0x1";
  if (variant === "header_drift") (o.recheckedBlock as Record<string, unknown>).timestamp = "0x1";
  if (variant === "authorization") tx.authorizationList = [{ nonce: "0x0" }]; if (variant === "reverted") receipt.status = "0x0"; if (variant === "malformed_quantity") tx.nonce = "0x053";
  const verify = verifyCleanup85PublicWire(o, op.effects[0]!.envelope, op.effects[0]!.transactionHash!);
  if (variant === "authentic83") assert.match(await verify, /^0x02/u); else await assert.rejects(verify);
});
test("normal public observe old24cb null needs no active old policy, no TTY, no key or SEND synthesis", async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "cleanup85-observe-"))); t.after(() => rm(root, { recursive: true, force: true })); const { state, op } = await installCleanup85PublicFixture(root);
  let privateLoads = 0, tty = 0, send = 0;
  const service = new CircleEvmService(state, { load: async () => { privateLoads++; throw new Error("private forbidden"); } } as never, { APN_ARBITRUM_RPC_URL: "https://example.org" }, () => Date.parse("2026-10-09T12:00:00.000Z"), { openTerminal: async () => { tty++; throw new Error("TTY forbidden"); } }, { request: async (_url, _method, body) => { const q = JSON.parse(body!); if (q.method === "eth_sendRawTransaction") send++; assert.ok(["eth_chainId", "eth_getTransactionByHash", "eth_getTransactionReceipt"].includes(q.method)); return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result: q.method === "eth_chainId" ? "0xa4b1" : null }) }; } });
  assert.deepEqual(await service.observe(op.operationId), op); assert.deepEqual([privateLoads, tty, send], [0, 0, 0]);
  await assert.rejects(service.cancelCleanup85(op.operationId), /verified_native_backend_required/); assert.deepEqual([privateLoads, tty, send], [0, 0, 0]);
});
