import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createKeyPairSignerFromPrivateKeyBytes, getBase64EncodedWireTransaction, getCompiledTransactionMessageDecoder, getSignatureFromTransaction, getTransactionDecoder, signTransaction } from "@solana/kit";
import { bindArgv, bindMcpInput } from "../../src/command-binder.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import { SolanaRpc, solanaAddress } from "../../src/solana/rpc.js";
import { SolanaAwalAdapter, awalAmount } from "../../src/solana/awal-adapter.js";
import { chainAsset, chainDecimal } from "../../src/chain-policy.js";
import { sealChainAccount } from "../../src/chain-account-store.js";
import { inspectSolana } from "../../src/solana/evidence.js";
import { solanaMessage } from "../../src/solana/message.js";
import { temporaryState } from "./helpers.js";
import { OperationService } from "../../src/operation-service.js";
import type { OperationAbandonApprovalPort, OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { SOL_RECIPIENT, solanaFixture } from "./solana-helpers.js";

test("Solana CLI and MCP use the same explicit profile/asset/amount binding", () => {
  const input = { profile: "solana-test", asset: "usdc", to: SOL_RECIPIENT, amount: "1.25", max_fee_sol: "0.003", idempotency_key: "solana-parity-0001" };
  const tool = MCP_TOOLS.find((entry) => entry.name === "apn_pay_transfer_prepare_solana")!;
  const argv = ["pay", "transfer", "prepare-solana", ...Object.entries(input).flatMap(([key, value]) => [`--${key.replaceAll("_", "-")}`, value])];
  assert.deepEqual(bindArgv(argv), bindMcpInput(tool.command, input));
  for (const amount of ["0", "-1", "+1", "1e3", " 1", "01", "1.0", "0.0000001"]) assert.throws(() => bindMcpInput(tool.command, { ...input, amount }), { code: "APN_INVALID_INPUT" });
  for (const asset of ["USDC", "trx", "native", ""]) assert.throws(() => bindMcpInput(tool.command, { ...input, asset }), { code: "APN_INVALID_INPUT" });
  const { profile: _profile, ...withoutProfile } = input;
  assert.throws(() => bindMcpInput(tool.command, withoutProfile), { code: "APN_INVALID_INPUT" });
  assert.throws(() => solanaAddress("1".repeat(33)), { code: "APN_INVALID_INPUT" });
  assert.equal(chainDecimal("0.000000001", 9), "1");
});

for (const asset of ["sol", "usdc"] as const) test(`local ${asset} integrates encrypted custody, human policy, exact wire effect and finalized receipt`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const setup = await solanaFixture(temporary.root);
  const id = await setup.prepare(asset);
  assert.equal(setup.approval.calls.length, 0); assert.equal(setup.rpc.submissions.length, 0);
  const approved = await setup.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(approved.ok, true, approved.error?.message);
  assert.equal((approved.operation as { state: string }).state, "completed");
  assert.equal(setup.approval.calls.length, 1); assert.equal(setup.rpc.submissions.length, 1);
  const wire = getTransactionDecoder().decode(Buffer.from(setup.rpc.submissions[0]!, "base64"));
  const message = getCompiledTransactionMessageDecoder().decode(wire.messageBytes);
  assert.equal(message.version, 0); assert.equal(message.instructions.length, asset === "sol" ? 1 : 2);
  assert.equal(message.staticAccounts[0], setup.account.address);
  const receipt = await setup.core.execute({ command: "receipt.get", operationId: id });
  assert.equal(receipt.ok, true); assert.equal((receipt.receipt as { schema_version: string }).schema_version, "apn.rail-receipt.v1");
  const proof = (receipt.receipt as { evidence: { actualNetworkFeeAtomic: string; actualRecipientRentAtomic: string } }).evidence;
  assert.equal(proof.actualNetworkFeeAtomic, "5000"); assert.equal(proof.actualRecipientRentAtomic, asset === "sol" ? "0" : "2039280");
  const restart = await solanaFixture(temporary.root, { rpc: setup.rpc, wrapping: setup.wrapping, admit: false });
  assert.deepEqual(await restart.core.execute({ command: "operation.resume", operationId: id }).then((value) => value.operation), approved.operation);
  assert.equal(restart.approval.calls.length, 0); assert.equal(setup.rpc.submissions.length, 1);
  const publicText = JSON.stringify([approved, receipt]);
  assert.equal(publicText.includes(setup.rpc.submissions[0]!), false);
  assert.equal(publicText.includes("unsignedPayload"), false);
  for (const root of ["chain-wallets/solana", `rail-operations/${setup.account.profileHash}`, `rail-receipts/${setup.account.profileHash}`]) {
    for (const file of await readdir(join(temporary.root, root))) {
      const contents = await readFile(join(temporary.root, root, file), "utf8");
      assert.equal(contents.includes(setup.rpc.submissions[0]!), false);
      assert.equal(contents.includes(Buffer.alloc(32, 47).toString("hex")), false);
    }
  }
});

test("wrong chain, mint, ATA owner, funding and fee bounds stop before approval or any signed effect", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const request = { command: "transfer.prepare-solana", profile: s.account.profile, asset: "usdc", recipient: SOL_RECIPIENT, amount: "1", maximumFee: "0.003", idempotencyKey: "solana-negative-0001" } as const;
  const check = async (code: string) => { const result = await s.core.execute(request); assert.equal(result.error?.code, code); assert.equal(s.rpc.submissions.length, 0); assert.equal(s.approval.calls.length, 0); };
  s.rpc.genesis = "wrong"; await check("APN_CHAIN_MISMATCH"); s.rpc.genesis = (await import("../../src/chain-policy.js")).SOLANA_GENESIS;
  s.rpc.corruptMint = true; await check("APN_RPC_PROTOCOL"); s.rpc.corruptMint = false;
  s.rpc.corruptTokenOwner = true; await check("APN_RPC_PROTOCOL"); s.rpc.corruptTokenOwner = false;
  s.rpc.native = 1n; await check("APN_INSUFFICIENT_GAS"); s.rpc.native = 5_000_000_000n;
  s.rpc.token = 1n; await check("APN_INSUFFICIENT_ASSET"); s.rpc.token = 9_000_000n;
  s.rpc.fee = 9_000_000n; await check("APN_FEE_BUDGET_EXCEEDED");
});

for (const asset of ["sol", "usdc"] as const) test(`${asset} completed RPC status without exact recipient effect stays unresolved`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare(asset); s.rpc.corruptEffect = true;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.ok, true); assert.equal((result.operation as { state: string }).state, "submitted_pending");
  await s.core.execute({ command: "operation.resume", operationId: id }); assert.equal(s.rpc.submissions.length, 1);
  s.rpc.corruptEffect = false;
  const recovered = await s.core.execute({ command: "operation.resume", operationId: id });
  assert.equal((recovered.operation as { state: string }).state, "completed"); assert.equal(s.rpc.submissions.length, 1);
});

test("finalized rollback records actual fee and no delivered principal or rent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare(); s.rpc.failed = true;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.ok, true); assert.equal((result.operation as { state: string }).state, "failed_confirmed_revert");
  const record = (await s.core.rails.records.findOperation(id))!;
  assert.equal(record.evidence?.senderEffectVerified, false); assert.equal(record.evidence?.actualNetworkFeeAtomic, "5000");
});

test("pinned awal amount conversion preserves exact atomic inputs and production economics block before provider launch", async (t) => {
  assert.equal(awalAmount(chainAsset("solana", "usdc"), "1000001"), "1000001");
  assert.equal(awalAmount(chainAsset("solana", "usdc"), "1"), "0.000001");
  assert.equal(awalAmount(chainAsset("solana", "sol"), "1000000000"), "1");
  assert.throws(() => awalAmount(chainAsset("solana", "usdc"), "9007199254740993"), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  let launches = 0;
  const adapter = new SolanaAwalAdapter(s.storage, s.rpc, { run: async () => { launches++; throw new Error("must not launch"); } });
  await assert.rejects(adapter.prepare({ account: s.account, asset: chainAsset("solana", "sol"), recipient: SOL_RECIPIENT, amountAtomic: "1", maximumFeeAtomic: "5000", now: s.now }), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.equal(launches, 0);
});

test("provider finality binds signed instruction bytes to the exact prepared amount and parsed RPC evidence", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare();
  await s.core.execute({ command: "transfer.approve", operationId: id });
  const local = (await s.core.rails.records.findOperation(id))!;
  const { identityHash: _hash, ...accountBody } = s.account;
  const account = sealChainAccount({ ...accountBody, provider: "coinbase-awal", custody: "provider_managed" });
  const prepared = { ...local.prepared, unsignedPayload: null, economics: { ...local.prepared.economics, feeControl: "provider_guarantee" as const } };
  assert.equal((await inspectSolana(s.rpc, account, prepared, local.transactionId!, s.now)).status, "completed");
  // A valid signature over another amount must not inherit a fabricated parsed result.
  const signer = await createKeyPairSignerFromPrivateKeyBytes(Buffer.alloc(32, 47));
  const changed = await solanaMessage({ ...local.prepared, amountAtomic: "2000" });
  const transaction = await signTransaction([signer.keyPair], changed.transaction);
  s.rpc.submissions.push(getBase64EncodedWireTransaction(transaction));
  await assert.rejects(inspectSolana(s.rpc, account, prepared, getSignatureFromTransaction(transaction), s.now), { code: "APN_RPC_PROTOCOL" });
});

test("Solana HTTPS rejects wrong ids, malformed and oversized responses and credential URLs with bounded safe errors", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response(JSON.stringify({ jsonrpc: "2.0", id: "wrong", result: "secret_external_data" }), { headers: { "content-type": "application/json" } }); }) as typeof fetch;
  await assert.rejects(new SolanaRpc("https://user:secret@rpc.example", fetcher).call("getGenesisHash", []), { code: "APN_RPC_CONFIG" });
  assert.equal(calls, 0);
  await assert.rejects(new SolanaRpc("https://rpc.example", fetcher).call("getGenesisHash", []), (error: Error) => !error.message.includes("secret_external_data"));
  const oversized = (async () => new Response("x".repeat(2_097_153), { headers: { "content-type": "application/json" } })) as typeof fetch;
  await assert.rejects(new SolanaRpc("https://rpc.example", oversized).call("getGenesisHash", []), { code: "APN_RPC_PROTOCOL" });
});

class RailAbandonApproval implements OperationAbandonApprovalPort {
  readonly calls: OperationAbandonIntent[] = [];
  async approve(intent: OperationAbandonIntent): Promise<void> { this.calls.push(intent); }
}

test("Solana expired unlanded transfer is owner-abandoned only after its finalized validity window and never resent", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const approval = new RailAbandonApproval();
  const s = await solanaFixture(temporary.root, { abandonApproval: approval }); const id = await s.prepare();
  s.rpc.submissionTimeout = true; const first = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal((first.operation as { state: string }).state, "unknown_finality"); assert.equal(s.rpc.submissions.length, 1);
  s.rpc.absentHistory = true; s.rpc.blockHeight = 200n;
  assert.equal((await s.core.execute({ command: "operation.abandon", operationId: id })).error?.code, "APN_OPERATION_BLOCKED");
  s.rpc.blockHeight = 201n; s.rpc.absentHistory = false;
  assert.equal((await s.core.execute({ command: "operation.abandon", operationId: id })).error?.code, "APN_OPERATION_BLOCKED");
  assert.equal(approval.calls.length, 0); s.rpc.absentHistory = true;
  const abandoned = await s.core.execute({ command: "operation.abandon", operationId: id });
  assert.equal(abandoned.ok, true, abandoned.error?.message); assert.equal((abandoned.operation as { state: string }).state, "abandoned_unknown");
  assert.equal(approval.calls.length, 1); assert.equal(s.rpc.submissions.length, 1);
  await new OperationService(s.core.context.state).assertProfileAvailable(s.account.profileHash);
});
