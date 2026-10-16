import assert from "node:assert/strict";
import test from "node:test";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { runCli } from "../../src/cli.js";
import { ApnError } from "../../src/errors.js";
import type { OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import type { TtyTransferApprovalOptions } from "../../src/tty-approval.js";
import { abandonSwapOperation } from "../../src/swap/abandon.js";
import { ORCA_SOLANA_CHAIN } from "../../src/swap/orca-solana/pins.js";
import { createOrcaKeylessRuntime } from "../../src/swap/orca-solana/runtime-factory.js";
import { SwapOperationRepository } from "../../src/swap/repository.js";
import { AMOUNT_IN, FakeOrcaRpc, orcaOwner, orcaPolicy, PROFILE } from "./orca-solana-helpers.js";
import { temporaryState } from "./helpers.js";

const reason = (error: unknown) => error instanceof ApnError ? String(error.details?.reason ?? error.code) : String(error);

async function marked(root: string, options: { readonly send: boolean }) {
  let clockMs = Date.now(); const clock = { now: () => new Date(clockMs) };
  const owner = await orcaOwner(root), rpc = new FakeOrcaRpc(owner.address, owner.wsol, owner.usdc, owner.oracle);
  const policy = orcaPolicy(owner.address, clock.now());
  let printed = "";
  const terminal: NonNullable<TtyTransferApprovalOptions["openTerminal"]> = async () => ({ fd: 11, write: async (text: string) => { printed += text; },
    read: async function* () { yield Buffer.from(`${/Type ([0-9a-f]{6}) and press Enter/u.exec(printed)?.[1] ?? ""}\n`); }, close: async () => undefined });
  const runtime = createOrcaKeylessRuntime({ state: owner.state, clock, rpc, accounts: owner.accounts, verifyPins: async () => [], foreground: "tty",
    policy: async () => policy, tty: { isTerminal: () => true, openTerminal: terminal } });
  const quoted = await runtime.quote({ profile: PROFILE, account: owner.address, amountAtomic: AMOUNT_IN.toString(), slippageBps: 50,
    ownerSlippageCapBps: 50, computeUnitLimit: 200_000, computeUnitPriceMicroLamports: "1000" }, clock.now()) as { quoteHash: string };
  const prepared = await runtime.prepare({ profile: PROFILE, quoteHash: quoted.quoteHash, idempotencyKey: `orca-abandon-${options.send}` }, clock.now());
  let operation;
  if (options.send) operation = await runtime.approveAndExecute(prepared.operationId, clock.now());
  else {
    // The process died after the durable marker and before the execution binding: no lifetime was ever recorded.
    const reserved = await runtime.approve(prepared.operationId, clock.now());
    operation = await runtime.service.markSubmitting(reserved, clock.now());
  }
  const approvals: OperationAbandonIntent[] = [];
  const context = { state: owner.state, clock, requireOperationAbandonApproval: () => ({ approve: async (intent: OperationAbandonIntent) => {
    approvals.push(intent); } }) };
  const usage = async () => (await new AssetUsageLedger(root).usage({ account: owner.address, chain: ORCA_SOLANA_CHAIN,
    asset: { kind: "native", identifier: null } }, clock.now())).amountAtomic;
  return { runtime, rpc, owner, clock, operation, prepared, context, approvals, usage, advance: (ms: number) => { clockMs += ms; } };
}

test("a marked swap with no recorded lifetime is abandoned after consent and its input stays charged", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await marked(temporary.root, { send: false });
  assert.equal(f.operation.state, "submitting");
  await assert.rejects(abandonSwapOperation(f.context, f.operation.operationId), (error) => reason(error) === "swap_abandon_window_open");
  assert.equal(f.approvals.length, 0);
  f.advance(Date.parse(f.operation.quote.expiresAt) - f.clock.now().getTime() + 1);
  const calls = f.rpc.calls.length;
  const abandoned = await abandonSwapOperation(f.context, f.operation.operationId);
  assert.equal(abandoned.state, "abandoned_unknown");
  assert.equal(abandoned.usageLease?.state, "finalized");
  assert.equal(abandoned.usageLease?.outcomeDigest, abandoned.failureProofHash);
  assert.equal(await f.usage(), AMOUNT_IN.toString(), "an unknown outcome keeps the input charged as spent");
  assert.equal(f.approvals.length, 1);
  assert.match(f.approvals[0]!.outcomeNote, /UNKNOWN/u); assert.equal(f.approvals[0]!.amountAtomic, AMOUNT_IN.toString());
  assert.equal(f.rpc.calls.length, calls, "abandon reads no RPC and sends nothing"); assert.equal(f.rpc.sends.length, 0);
  assert.equal((await abandonSwapOperation(f.context, f.operation.operationId)).integrityHash, abandoned.integrityHash);
  assert.equal(f.approvals.length, 1, "a repeated abandon is idempotent without a second consent");
  assert.equal((await f.runtime.status(f.operation.operationId, f.clock.now())).state, "abandoned_unknown");
});

test("operation abandon refuses a swap whose outcome the chain can still prove, and an unmarked swap", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await marked(temporary.root, { send: true });
  assert.equal(f.operation.state, "submitted");
  f.advance(Date.parse(f.operation.quote.expiresAt) - f.clock.now().getTime() + 1);
  await assert.rejects(abandonSwapOperation(f.context, f.operation.operationId), (error) => error instanceof ApnError &&
    error.details?.reason === "swap_chain_proof_available" &&
    JSON.stringify(error.details?.nextActions) === JSON.stringify([`apn swap solana orca status --operation ${f.operation.operationId}`]));
  assert.equal(f.approvals.length, 0);
  const other = await temporaryState(); t.after(other.cleanup);
  const g = await marked(other.root, { send: false });
  const unmarked = await g.runtime.prepare({ profile: PROFILE, quoteHash: g.prepared.quote.quoteHash, idempotencyKey: "orca-abandon-unmarked" }, g.clock.now());
  await assert.rejects(abandonSwapOperation(g.context, unmarked.operationId), (error) => reason(error) === "swap_abandon_unmarked");
});

test("apn operation abandon routes a swap through the exact owner consent and refuses without it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await marked(temporary.root, { send: false });
  const at = new Date(Date.parse(f.operation.quote.expiresAt) + 1), argv = ["operation", "abandon", "--operation", f.operation.operationId];
  const denied = await runCli(argv, {}, { stateRoot: temporary.root, clock: { now: () => at },
    operationAbandonApproval: { approve: async () => { throw new ApnError("APN_OPERATION_BLOCKED", "Owner declined."); } } });
  assert.equal(denied.ok, false);
  assert.equal((await new SwapOperationRepository(temporary.root).loadAny(f.operation.operationId))?.state, "submitting");
  let screens = 0;
  const result = await runCli(argv, {}, { stateRoot: temporary.root, clock: { now: () => at },
    operationAbandonApproval: { approve: async (intent: OperationAbandonIntent) => { screens++; assert.equal(intent.operationId, f.operation.operationId); } } });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal((result.operation as { state: string }).state, "abandoned_unknown"); assert.equal(screens, 1);
});
