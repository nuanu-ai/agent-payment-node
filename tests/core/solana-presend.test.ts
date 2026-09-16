import assert from "node:assert/strict";
import test from "node:test";
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { RAIL_PRESEND_ATTEMPTS, SOLANA_APPROVAL_WINDOW_MS } from "../../src/rail-send-binding.js";
import { temporaryState } from "./helpers.js";
import { SOL_BLOCKHASH, SOL_RECIPIENT, solanaFixture } from "./solana-helpers.js";

/** A base58 32-byte value the fixture validator hands back instead of the prepared blockhash. */
const REBOUND_BLOCKHASH = SOL_RECIPIENT;

const lifetime = (raw: string): unknown =>
  getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(raw, "base64")).messageBytes).lifetimeToken;

test("the time the owner spends reading the screen no longer consumes the sending window", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("usdc");
  const record = (await s.core.rails.records.findOperation(id))!;
  // The approval deadline is the owner's reading time; the sending window opens after it.
  assert.equal(Date.parse(record.prepared.expiresAt) - Date.parse(record.prepared.preparedAt), SOLANA_APPROVAL_WINDOW_MS);
  assert.equal(record.prepared.blockReference, SOL_BLOCKHASH);
  assert.equal(record.send, undefined);

  s.rpc.reboundBlockhash = REBOUND_BLOCKHASH;
  // Three minutes of reading: past the whole 60 s validity 0.5.18 allowed for approval and send together.
  s.approval.onApprove = () => s.advance(180_000);
  const approved = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(approved.ok, true, approved.error?.message);
  assert.equal((approved.operation as { state: string }).state, "completed");

  const sent = (await s.core.rails.records.findOperation(id))!;
  assert.ok(sent.send, "the send guard must have taken a binding");
  assert.equal(sent.send.blockReference, REBOUND_BLOCKHASH);
  assert.notEqual(sent.send.blockReference, sent.prepared.blockReference);
  assert.equal(sent.send.acquiredAt, new Date(Date.parse(sent.prepared.preparedAt) + 180_000).toISOString());
  assert.equal(sent.send.simulation.outcome, "would_succeed");
  assert.equal(sent.send.simulation.signatureVerified, false);
  // The bytes that reached the validator carry the re-acquired reference, not the frozen one.
  assert.equal(s.rpc.submissions.length, 1);
  assert.equal(lifetime(s.rpc.submissions[0]!), REBOUND_BLOCKHASH);
  const receipt = await s.core.execute({ command: "receipt.get", operationId: id });
  assert.equal((receipt.receipt as { send_binding: { blockReference: string } }).send_binding.blockReference, REBOUND_BLOCKHASH);
});

test("reading past the approval deadline still refuses before anything is signed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare();
  s.approval.onApprove = () => s.advance(SOLANA_APPROVAL_WINDOW_MS + 1_000);
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.error?.code, "APN_REPREPARE_REQUIRED");
  assert.equal((await s.core.rails.records.findOperation(id))!.state, "failed_before_effect");
  assert.equal(s.rpc.submissions.length, 0); assert.equal(s.rpc.simulateCalls, 0);
});

test("a re-acquired window that is already closing is refused rather than signed into", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare();
  // The validator answers with a blockhash whose window has almost run out.
  s.rpc.blockHeight = 180n;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.error?.code, "APN_STATE_CORRUPT");
  const record = (await s.core.rails.records.findOperation(id))!;
  assert.equal(record.state, "failed_before_effect"); assert.equal(record.reason, "pre_send_guard_refused");
  assert.equal(record.send, undefined); assert.equal(s.rpc.submissions.length, 0);
});

for (const [label, error, reason, code] of [
  ["an instruction error", { InstructionError: [0n, { Custom: 1n }] }, "solana_simulation_instruction_error", "APN_PROVIDER_EFFECT_UNAVAILABLE"],
  ["a missing blockhash", "BlockhashNotFound", "solana_simulation_blockhash_not_found", "APN_REPREPARE_REQUIRED"],
  ["insufficient fee funding", "InsufficientFundsForFee", "solana_simulation_insufficient_funds", "APN_REPREPARE_REQUIRED"],
  ["an already processed transaction", "AlreadyProcessed", "solana_simulation_already_processed", "APN_REPREPARE_REQUIRED"],
  ["an unnamed refusal", { SanitizeFailure: null }, "solana_simulation_rejected", "APN_PROVIDER_EFFECT_UNAVAILABLE"],
] as const) test(`simulation refusing with ${label} stops before any signature exists`, async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("usdc");
  const fingerprint = (await s.core.rails.records.findOperation(id))!.fingerprint;
  s.rpc.simulateError = error;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.error?.code, code);
  const record = (await s.core.rails.records.findOperation(id))!;
  assert.equal(record.state, "failed_before_effect"); assert.equal(record.reason, reason);
  assert.equal(record.transactionId, null); assert.equal(record.rawPayloadHash, null); assert.equal(record.send, undefined);
  // The owner was asked, the validator was asked, and nothing was signed or sent.
  assert.equal(s.approval.calls.length, 1); assert.equal(s.rpc.simulateCalls, 1);
  assert.equal(s.rpc.submissions.length, 0);
  assert.equal(await s.storage.effect(s.account, id, fingerprint), null);
});

test("a refusal that executed nothing still reads as the chain's own reason", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare();
  // BlockhashNotFound never reaches execution, so the answer carries zero consumed units.
  s.rpc.simulateError = "BlockhashNotFound"; s.rpc.simulateUnits = 0n;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.error?.code, "APN_REPREPARE_REQUIRED");
  assert.equal((await s.core.rails.records.findOperation(id))!.reason, "solana_simulation_blockhash_not_found");
  assert.equal(s.rpc.submissions.length, 0);
});

test("a success claiming zero consumed units proves nothing and is refused", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare();
  s.rpc.simulateUnits = 0n;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.error?.code, "APN_RPC_PROTOCOL");
  assert.equal((await s.core.rails.records.findOperation(id))!.reason, "solana_simulation_protocol");
  assert.equal(s.rpc.submissions.length, 0);
});

test("malformed simulation evidence is a protocol answer, not a chain refusal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare();
  s.rpc.simulateMalformed = true;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.error?.code, "APN_RPC_PROTOCOL");
  assert.equal((await s.core.rails.records.findOperation(id))!.reason, "solana_simulation_protocol");
  assert.equal(s.rpc.simulateCalls, 1); assert.equal(s.rpc.submissions.length, 0);
});

test("a transport loss during simulation is waited out inside the approved window and then succeeds", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("usdc");
  s.rpc.simulateTransportLosses = RAIL_PRESEND_ATTEMPTS - 1;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.ok, true, result.error?.message);
  assert.equal((result.operation as { state: string }).state, "completed");
  assert.equal(s.rpc.simulateCalls, RAIL_PRESEND_ATTEMPTS);
  assert.equal(s.wait.waits.length, RAIL_PRESEND_ATTEMPTS - 1);
  assert.equal(s.rpc.submissions.length, 1);
});

test("a persistent transport loss ends before any effect and never reads as an unknown failure", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare();
  const fingerprint = (await s.core.rails.records.findOperation(id))!.fingerprint;
  s.rpc.simulateTransportLosses = 99;
  const result = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal(result.error?.code, "APN_RPC_PROTOCOL");
  const record = (await s.core.rails.records.findOperation(id))!;
  assert.equal(record.state, "failed_before_effect");
  assert.equal(record.reason, "solana_simulation_unavailable");
  assert.equal(s.rpc.simulateCalls, RAIL_PRESEND_ATTEMPTS);
  assert.equal(s.wait.waits.length, RAIL_PRESEND_ATTEMPTS - 1);
  assert.equal(s.rpc.submissions.length, 0);
  assert.equal(await s.storage.effect(s.account, id, fingerprint), null);
});

test("an interrupted wait stops retrying at once and still ends before any effect", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare();
  s.rpc.simulateTransportLosses = 99; s.wait.interrupt = true;
  assert.equal((await s.core.execute({ command: "transfer.approve", operationId: id })).error?.code, "APN_RPC_PROTOCOL");
  assert.equal((await s.core.rails.records.findOperation(id))!.state, "failed_before_effect");
  assert.equal(s.rpc.simulateCalls, 1); assert.equal(s.rpc.submissions.length, 0);
});

test("the send binding is taken once and an interrupted send recovers the same bytes", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const s = await solanaFixture(temporary.root);
  const id = await s.prepare("usdc");
  s.rpc.reboundBlockhash = REBOUND_BLOCKHASH; s.rpc.submissionTimeout = true;
  const first = await s.core.execute({ command: "transfer.approve", operationId: id });
  assert.equal((first.operation as { state: string }).state, "unknown_finality");
  const interrupted = (await s.core.rails.records.findOperation(id))!;
  assert.ok(interrupted.send); assert.equal(interrupted.send.blockReference, REBOUND_BLOCKHASH);
  const simulations = s.rpc.simulateCalls;

  // Resume must reuse the recorded window: no second binding, no second simulation, no second send.
  s.rpc.submissionTimeout = false;
  const restart = await solanaFixture(temporary.root, { rpc: s.rpc, wrapping: s.wrapping, admit: false });
  const resumed = await restart.core.execute({ command: "operation.resume", operationId: id });
  assert.equal(resumed.ok, true, resumed.error?.message);
  const after = (await restart.core.rails.records.findOperation(id))!;
  assert.deepEqual(after.send, interrupted.send);
  assert.equal(s.rpc.simulateCalls, simulations);
  assert.equal(s.rpc.submissions.length, 1);
});
