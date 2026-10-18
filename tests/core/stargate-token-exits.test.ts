import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeFunctionResult, type Hex } from "viem";
import { bindArgv } from "../../src/command-binder.js";
import { checkNeverLands } from "../../src/evm-finalized-proof.js";
import type { OperationAbandonIntent } from "../../src/operation-abandon-approval.js";
import { namedProfileHash } from "../../src/operation-index/adapters/family-claims.js";
import { OperationService } from "../../src/operation-service.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { STARGATE_ERC20_ABI } from "../../src/stargate-v2/abi.js";
import { executeStargateV2Token, prepareStargateV2Token, type StargateTokenExecutionPorts,
  type StargateTokenOperation } from "../../src/stargate-v2/token-execution.js";
import { StargateTokenService } from "../../src/stargate-v2/token-runtime.js";
import { temporaryState } from "./helpers.js";
import { finalizedNode } from "./finalized-node.js";
import { AMOUNT, OWNER, request, seedTokenFixture, setup } from "./stargate-token-support.js";

/**
 * R4 exits of a token Stargate journal, through the CLI (`stargate token observe|cleanup`, `operation abandon`) over the
 * file journal and the operation index; only chain and ledger ports are scripted. A bridge send or cleanup the node no
 * longer knows, once the finalized nonce passed it, can never land (exit 2); a cleanup that never landed or landed
 * without zeroing the allowance is retired and re-armed for a fresh, consented cleanup; owner abandon is the last resort.
 */
const wrapping = { load: async () => Buffer.alloc(32), create: async () => Buffer.alloc(32) } as never;
const held = async (root: string) => await new OperationService(new StateStore(root)).assertEvmAccountAvailable(namedProfileHash("owner"), 10, OWNER)
  .then(() => false, (error: { code?: string }) => error.code === "APN_OPERATION_BLOCKED");

/** A send accepted by no one (ambiguous) left in unknown_finality, written to a real state root's journal. */
async function dropped(root: string) {
  const s = setup({ allowance: AMOUNT, sendErrorAt: 1 }), prepared = await prepareStargateV2Token(request(), s.ports, s.journal);
  const op = await executeStargateV2Token(prepared.operationId, s.ports, s.journal);
  assert.equal(op.phase, "unknown_finality");
  await new StateStore(root).initialize(); await seedTokenFixture(root, op);
  let finalized = 0n, allowance = AMOUNT, nonce = 7n, receipts: Readonly<Record<string, "success" | "reverted">> = {};
  const ports: StargateTokenExecutionPorts = { ...s.ports,
    // Allowance reads follow the chain this test scripts; everything else is the shared fixture.
    sourceCall: async (method, params) => {
      if (method === "eth_call") { try { const d = decodeFunctionData({ abi: STARGATE_ERC20_ABI, data: (params[0] as { data: Hex }).data });
        if (d.functionName === "allowance") return encodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "allowance", result: allowance }); } catch { /* not ERC-20 */ } }
      return await s.ports.sourceCall(method, params);
    },
    prepareEnvelope: async tx => ({ ...await s.ports.prepareEnvelope(tx), nonceAtomic: String(++nonce) }),
    waitSourceReceipt: async (hash, finality) => receipts[hash] === undefined ? null
      : { transactionHash: hash, status: receipts[hash]!, blockNumberAtomic: "30", blockHash: `0x${"ab".repeat(32)}`, finality, logs: [] },
    // The real R4 check against a finalized-tag node that indexes the operation's quote block (passed by the execution).
    neverLands: async effect => { const era = { hash: effect.before.hash, number: BigInt(effect.before.numberAtomic) };
      return await checkNeverLands({ chainId: 10, account: OWNER, nonce: BigInt(effect.nonceAtomic), transactionHash: effect.transactionHash, before: era },
        finalizedNode(10, () => finalized, { era }).batch); } };
  const state = new StateStore(root), service = new StargateTokenService(state, wrapping,
    { APN_OPTIMISM_RPC_URL: "https://optimism.example", APN_POLYGON_RPC_URL: "https://polygon.example" }, () => 2_000_000_000_000);
  (service as unknown as { ports: () => Promise<StargateTokenExecutionPorts> }).ports = async () => ports;
  const cli = async (argv: readonly string[], now = new Date(2_000_000_000_000), approve?: (intent: OperationAbandonIntent) => Promise<void>) =>
    await createApnCore(bindArgv([...argv]), { stateRoot: root, wrappingSecret: wrapping, stargateToken: service, clock: { now: () => now },
      ...(approve === undefined ? {} : { operationAbandonApproval: { approve } }) }).execute(bindArgv([...argv]).request);
  return { op, id: op.operationId, s, cli, finalized: (value: bigint) => { finalized = value; }, allowance: (value: bigint) => { allowance = value; },
    receipt: (hash: string, status: "success" | "reverted") => { receipts = { ...receipts, [hash]: status }; } };
}
const operationOf = (result: { readonly operation?: unknown }) => result.operation as StargateTokenOperation;

test("a dropped bridge send stays open until its nonce is finalized past; then its hold is released and the allowance goes to cleanup", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await dropped(temporary.root), observe = ["stargate", "token", "observe", "--operation", f.id], nonce = BigInt(f.op.sendEnvelope.nonceAtomic);
  f.finalized(nonce);
  const open = operationOf(await f.cli(observe));
  assert.deepEqual([open.phase, open.usageState, open.retiredEffects, await held(temporary.root)], ["unknown_finality", "unknown_finality", undefined, true]);
  f.finalized(nonce + 1n);
  const retired = operationOf(await f.cli(observe));
  assert.deepEqual([retired.phase, retired.cleanupReason, retired.usageState, retired.transactionHash], ["cleanup_required", "bridge_never_landed",
    "released_unsubmitted", f.op.transactionHash]);
  assert.deepEqual(retired.retiredEffects?.map(row => [row.role, row.reason, row.nonceAtomic, row.finalizedNonceAtomic]),
    [["bridge", "never_landed", nonce.toString(), (nonce + 1n).toString()]]);
  assert.equal(f.s.counts().sends, 1, "nothing re-signed or re-sent by the exit");
  assert.equal(await held(temporary.root), true, "the residual allowance keeps the account until its cleanup");
  const cleaning = operationOf(await f.cli(["stargate", "token", "cleanup", "--operation", f.id]));
  // Consents: the execute's own, then this cleanup's.
  assert.deepEqual([cleaning.phase, f.s.counts().sends, f.s.counts().approvals], ["cleanup_unknown_finality", 2, 2]);
});

test("a reverted cleanup and a dropped one are retired and re-armed; each new cleanup is consented on a new nonce; then it cleans", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await dropped(temporary.root), observe = ["stargate", "token", "observe", "--operation", f.id], cleanup = ["stargate", "token", "cleanup", "--operation", f.id];
  f.finalized(BigInt(f.op.sendEnvelope.nonceAtomic) + 1n); await f.cli(observe);
  const first = operationOf(await f.cli(cleanup));
  f.receipt(first.cleanupTransactionHash!, "reverted");
  const rearmed = operationOf(await f.cli(observe));
  assert.deepEqual([rearmed.phase, rearmed.cleanupEnvelope, rearmed.cleanupTransactionHash, rearmed.cleanupReason],
    ["cleanup_required", undefined, undefined, "bridge_never_landed"]);
  assert.deepEqual(rearmed.retiredEffects?.at(-1), { role: "cleanup", transactionHash: first.cleanupTransactionHash, nonceAtomic: first.cleanupEnvelope!.nonceAtomic,
    reason: "reverted", finalizedNonceAtomic: null, at: rearmed.retiredEffects?.at(-1)?.at });
  // Observation alone never signs: the re-armed cleanup waits for the owner's consent.
  assert.equal(operationOf(await f.cli(observe)).phase, "cleanup_required"); assert.equal(f.s.counts().sends, 2);
  const second = operationOf(await f.cli(cleanup));
  assert.notEqual(second.cleanupTransactionHash, first.cleanupTransactionHash);
  assert.deepEqual([second.phase, BigInt(second.cleanupEnvelope!.nonceAtomic) > BigInt(first.cleanupEnvelope!.nonceAtomic), f.s.counts().approvals],
    ["cleanup_unknown_finality", true, 3], "a fresh consent for the re-armed cleanup (after the execute's and the first cleanup's)");
  const nonce = BigInt(second.cleanupEnvelope!.nonceAtomic);
  f.finalized(nonce);
  assert.equal(operationOf(await f.cli(observe)).phase, "cleanup_unknown_finality", "open while its nonce is not finalized past");
  f.finalized(nonce + 1n);
  const dropped2 = operationOf(await f.cli(observe));
  assert.deepEqual([dropped2.phase, dropped2.retiredEffects?.map(row => `${row.role}:${row.reason}`)],
    ["cleanup_required", ["bridge:never_landed", "cleanup:reverted", "cleanup:never_landed"]]);
  const third = operationOf(await f.cli(cleanup));
  f.receipt(third.cleanupTransactionHash!, "success"); f.allowance(0n);
  const cleaned = operationOf(await f.cli(observe));
  assert.deepEqual([cleaned.phase, cleaned.residualAllowanceAtomic, await held(temporary.root)], ["cleaned", "0", false]);
});

test("owner abandon is the last resort: refused before the prepare expiry, then terminal with consent; the ledger stays as it is", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const f = await dropped(temporary.root), abandon = ["operation", "abandon", "--operation", f.id];
  const intents: OperationAbandonIntent[] = [], approve = async (intent: OperationAbandonIntent) => { intents.push(intent); };
  const early = await f.cli(abandon, new Date(2_000_000_000_000), approve);
  assert.deepEqual([early.error?.code, early.error?.details?.reason, intents.length], ["APN_OPERATION_BLOCKED", "stargate_token_abandon_not_eligible", 0]);
  const after = new Date(Date.parse(f.op.expiresAt) + 1), abandoned = await f.cli(abandon, after, approve);
  assert.equal(abandoned.ok, true, JSON.stringify(abandoned.error));
  assert.deepEqual([operationOf(abandoned).phase, operationOf(abandoned).usageState, intents.length], ["abandoned_unknown", "unknown_finality", 1]);
  assert.match(intents[0]!.outcomeNote, new RegExp(`UNKNOWN \\(phase unknown_finality\\)\\. Signed transaction\\(s\\) ${f.op.transactionHash} may still land`, "u"));
  assert.equal(await held(temporary.root), false, "the index released the account");
  const again = await f.cli(abandon, after, approve);
  assert.deepEqual([operationOf(again).phase, intents.length], ["abandoned_unknown", 1], "a replay asks nothing");
  for (const action of ["observe", "cleanup", "execute"]) {
    assert.equal(operationOf(await f.cli(["stargate", "token", action, "--operation", f.id])).phase, "abandoned_unknown", action);
  }
  assert.equal(f.s.counts().sends, 1);
});
