import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sha256 } from "../../src/canonical.js";
import { bindArgv } from "../../src/command-binder.js";
import { environmentFinalizedReader, type FinalizedChainRead } from "../../src/evm-finalized-proof.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "../../src/lifi/circle-v2-source-receipt.js";
import { NonEvmSourceJournalRepository, type NonEvmSourceJournal } from "../../src/lifi/non-evm-source-journal.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { OperationService } from "../../src/operation-service.js";
import { createApnCore } from "../../src/runtime-factory.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

/**
 * `operation status` of a Circle CCTP V2 Base source burn (no status command or observer of its own): the saved journal
 * and, once the burn transaction is known, its receipt at the finalized tag, read once (chain id, receipt, finalized
 * head; no archive). A finalized receipt is recorded once beside the journal and ends the payer's claim before the
 * signing window does; anything short of that writes nothing and keeps the claim.
 */
const ACCOUNT = privateKeyToAccount(`0x${"11".repeat(32)}`), H = (c: string) => c.repeat(64), DATA = "0xc62fa55e" as const;
const wrapping = { load: async () => Buffer.alloc(32), create: async () => Buffer.alloc(32) } as never;
const sidecar = (root: string, j: NonEvmSourceJournal) => join(root, "non-evm-source-journals", j.profileHash, `${j.operationId}.source-proof.json`);
const exists = async (path: string) => await stat(path).then(() => true, () => false);

const at = (ms: number) => new Date(Date.now() + ms).toISOString();
/** A burn staged just now (its signing window is still open), nothing signed. */
async function staged(root: string): Promise<NonEvmSourceJournal> {
  const owner = "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj";
  return await new NonEvmSourceJournalRepository(root).stageLiveCircle({ profileHash: H("a"), operationId: H("b"), draftIntegrityHash: H("c"), route: "base_usdc_to_solana_usdc_circle_cctp_v2",
    createdAt: at(0), maxSourceNativeDebitWei: "1000000000000000",
    sourceCall: { chainId: 8453, from: ACCOUNT.address, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, valueAtomic: "0", data: DATA,
      dataSha256: sha256(Buffer.from(DATA.slice(2), "hex")), type: "eip1559", nonceAtomic: "7", gasLimitAtomic: "100000",
      maxFeePerGasAtomic: "1000000000", maxPriorityFeePerGasAtomic: "1000000", accessList: [] },
    admissionProof: { kind: "circle_v2_live_transport_v1", circleOrigin: "https://iris-api.circle.com", rpcOrigin: "https://base.example.org",
      quoteHash: H("d"), validationHash: H("d"), sourceBlockHash: `0x${H("9")}`, preparationDigest: H("8"), payer: ACCOUNT.address,
      recipientOwner: owner, recipientAta: owner, feeTotalAtomic: "20000" }, protocolInputHash: H("1") });
}
/** The same burn signed, committed and left with an unknown outcome. */
async function burned(root: string): Promise<{ journal: NonEvmSourceJournal; hash: string }> {
  const repo = new NonEvmSourceJournalRepository(root);
  let j = await staged(root);
  const raw = await ACCOUNT.signTransaction({ chainId: 8453, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, data: DATA, value: 0n, nonce: 7,
    gas: 100000n, maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 1000000n, type: "eip1559" });
  j = await repo.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1));
  j = await repo.seal(j.profileHash, j.operationId, j.integrityHash, raw, "7", at(2));
  j = await repo.committingSubmission(j.profileHash, j.operationId, j.integrityHash, at(3));
  j = await repo.observeUnknown(j.profileHash, j.operationId, j.integrityHash, "response_lost", at(4));
  return { journal: j, hash: keccak256(raw) };
}
/** Base at the finalized tag: chain id, one receipt (or none), the finalized head; counts calls. */
function base(receipt: Record<string, unknown> | null, finalized: bigint, chainId = 8453) {
  const calls: string[] = [];
  const rpc: FinalizedChainRead = { async call(method, params) {
    calls.push(method);
    if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
    if (method === "eth_getTransactionReceipt") return receipt;
    if (method === "eth_getBlockByNumber") { assert.equal(params[0], "finalized"); return { number: `0x${finalized.toString(16)}` }; }
    throw new Error(`unexpected ${method}`);
  } };
  return { rpc, calls };
}
const receiptOf = (hash: string, status = "0x1", from: string = ACCOUNT.address) =>
  ({ transactionHash: hash, from: from.toLowerCase(), to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES.toLowerCase(), blockNumber: "0x64", blockHash: `0x${H("e")}`, status });
const status = async (root: string, read: (chainId: number) => FinalizedChainRead, id = H("b")) =>
  await createApnCore(bindArgv(["operation", "status", "--operation", id]), { stateRoot: root, wrappingSecret: wrapping, finalizedRead: read })
    .execute(bindArgv(["operation", "status", "--operation", id]).request);
const held = async (root: string) => await new OperationService(new StateStore(root)).assertEvmAccountAvailable(H("a"), 8453, ACCOUNT.address)
  .then(() => false, (error: { code?: string }) => error.code === "APN_OPERATION_BLOCKED");

test("no receipt yet, or one not yet finalized: the journal shows what it waits for, nothing is written and the payer stays held", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { journal, hash } = await burned(temporary.root);
  const none = base(null, 200n), pending = await status(temporary.root, () => none.rpc);
  assert.equal(pending.ok, true, JSON.stringify(pending.error));
  const view = pending.operation as { outcome: unknown; waitingFor: string; journal: { phase: string } };
  assert.deepEqual([view.outcome, view.waitingFor, view.journal.phase, pending.proof_class, pending.next_actions],
    [null, `the burn transaction ${hash} to have a receipt`, "unknown_finality", "chain_verified_public_read", [`apn operation status --operation ${H("b")}`]]);
  assert.deepEqual(none.calls, ["eth_chainId", "eth_getTransactionReceipt"], "one receipt read, no archive and no polling");
  const unfinal = base(receiptOf(hash), 99n), later = await status(temporary.root, () => unfinal.rpc);
  assert.equal((later.operation as { waitingFor: string }).waitingFor, "the burn receipt in block 100 to be finalized (the finalized block is 99)");
  assert.equal(await exists(sidecar(temporary.root, journal)), false);
  assert.equal(await held(temporary.root), true);
  // A receipt of another sender is not this burn: refused, nothing written.
  const foreign = await status(temporary.root, () => base(receiptOf(hash, "0x1", "0x000000000000000000000000000000000000dEaD"), 200n).rpc);
  assert.equal(foreign.error?.code, "APN_RPC_PROTOCOL");
  assert.equal(await exists(sidecar(temporary.root, journal)), false);
});

test("a finalized receipt is recorded once and ends the payer's claim inside the signing window; the proof survives an index rebuild", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { journal, hash } = await burned(temporary.root), state = new StateStore(temporary.root);
  assert.equal(await held(temporary.root), true);
  const chain = base(receiptOf(hash, "0x0"), 100n), proved = await status(temporary.root, () => chain.rpc);
  assert.equal(proved.ok, true, JSON.stringify(proved.error));
  const view = proved.operation as { outcome: string; sourceProof: { status: string; blockNumberAtomic: string; finalizedBlockNumberAtomic: string; nonceAtomic: string } };
  assert.deepEqual([view.outcome, view.sourceProof.status, view.sourceProof.blockNumberAtomic, view.sourceProof.finalizedBlockNumberAtomic,
    view.sourceProof.nonceAtomic, proved.proof_class, proved.next_actions], ["reverted", "reverted", "100", "100", "7", "chain_verified_public_read", []]);
  assert.deepEqual(chain.calls, ["eth_chainId", "eth_getTransactionReceipt", "eth_getBlockByNumber"]);
  assert.equal(await exists(sidecar(temporary.root, journal)), true);
  assert.equal(await held(temporary.root), false, "the recorded proof released the payer before the signing window ended");
  assert.equal((await new OperationIndex(state).find(journal.operationId))?.state, "terminal");
  await rm(join(temporary.root, "operation-index"), { recursive: true, force: true });
  assert.equal((await new OperationIndex(state).find(journal.operationId))?.state, "terminal", "rm -r operation-index keeps the proof");
  const again = await status(temporary.root, () => chain.rpc);
  assert.deepEqual([(again.operation as { outcome: string }).outcome, again.proof_class, chain.calls.length], ["reverted", "durable_public_state", 3]);
});

test("a journal without a burn transaction reads no RPC; a missing Base RPC setting is named", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { hash } = await burned(temporary.root);
  const missing = await status(temporary.root, environmentFinalizedReader({}));
  assert.equal(missing.error?.code, "APN_RPC_CONFIG");
  assert.deepEqual(missing.next_actions, ["Set APN_BASE_RPC_URL to a public HTTPS RPC endpoint of that chain, then rerun the same command."]);
  const other = await status(temporary.root, () => base(receiptOf(hash), 200n, 1).rpc);
  assert.equal(other.error?.code, "APN_CHAIN_MISMATCH");
  const fresh = await temporaryState(); t.after(fresh.cleanup);
  const journal = await staged(fresh.root), unread = base(null, 0n), shown = await status(fresh.root, () => unread.rpc);
  assert.equal(shown.ok, true, JSON.stringify(shown.error));
  assert.deepEqual([(shown.operation as { waitingFor: string }).waitingFor, shown.next_actions, unread.calls],
    ["no burn transaction was signed; nothing of this operation can land", [], []]);
  assert.equal(await exists(sidecar(fresh.root, journal)), false);
});
