import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { runCli } from "../../src/cli.js";
import { ApnCore } from "../../src/core.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { loadCircleApproval, type CircleApprovalRecord } from "../../src/lifi/circle-v2-approval-executor.js";
import { circleApprovalAdapter } from "../../src/operation-index/adapters/circle-approval.js";
import { walletAllowanceRevokeAdapter } from "../../src/operation-index/adapters/wallet-allowance.js";
import { StateStore } from "../../src/state.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_V3_SWAP_ROUTER } from "../../src/swap/uniswap-v3/token-route.js";
import { WalletAllowanceRevokeRepository } from "../../src/wallet-allowance/repository.js";
import { temporaryState } from "./helpers.js";
import { WP2_FAMILY_RECORDS } from "./operation-commands-families.js";
import { blockHash, movingNode, typingTerminal, WRAPPING } from "./uniswap-token-moving-node-harness.js";
import { allowanceRpc } from "./wallet-allowance-helpers.js";

// The blocker settle ports of the families whose own status is their observation: each delegates to that observation and
// answers null while it proves nothing. The direct port is in direct-transfer-settle.test, the legacy closures beside
// their own tests (lifi-legacy-closure, stargate-legacy-closure).
const KEY = `0x${"0".repeat(63)}9` as Hex, ACCOUNT = privateKeyToAccount(KEY).address, PROFILE = "settle-port-revoke";

test("the wallet allowance port runs the revoke's own observation: null while nothing is proven, the never-lands proof once it is", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize(); await new EncryptedWalletStore(state, WRAPPING).importNew(PROFILE, KEY, ACCOUNT);
  const chain = movingNode({ account: ACCOUNT, allowance: "10000", pending: 10n }), terminal = typingTerminal(), posts: string[] = [];
  const options = { stateRoot: temporary.root, wrappingSecret: WRAPPING, clock: { now: () => new Date() }, walletAllowanceRpc: () => allowanceRpc(chain),
    walletAllowanceTtyOptions: terminal.tty, finalizedRead: () => allowanceRpc(chain) };
  const revoke = ["wallet", "allowance", "revoke", "--profile", PROFILE, "--chain", "eip155:1", "--asset", ETHEREUM_USDT, "--spender", UNISWAP_V3_SWAP_ROUTER,
    "--max-gas-limit", "60000", "--max-fee-per-gas-wei", "2000000000", "--max-priority-fee-per-gas-wei", "1000000"];
  const sent = await runCli(revoke, process.env, options), id = (sent.data as { operation_id: string }).operation_id;
  const records = new WalletAllowanceRevokeRepository(temporary.root), record = await records.required(id);
  assert.deepEqual([record.state, chain.node.sends.length], ["submitted", 1]);
  const context = new ApnCore({ state, clock: { now: () => new Date() }, finalizedRead: () => allowanceRpc(chain, posts) }).context;

  // Another transaction took nonce 10 at finality, but the node does not index the era block: nothing is proven.
  chain.node.pending = 11n; chain.node.finalizedNonce = 11n;
  assert.equal(await walletAllowanceRevokeAdapter.settleIfNeverLands!(context, record), null);
  assert.ok(posts.length > 0, "the observation read the chain"); assert.equal((await records.required(id)).state, "submitted");
  const probe = `0x${"c".repeat(64)}`;
  chain.node.txs.set(probe, { hash: probe, blockHash: blockHash(BigInt(record.terms.era.number)), blockNumber: `0x${BigInt(record.terms.era.number).toString(16)}` });
  assert.equal(await walletAllowanceRevokeAdapter.settleIfNeverLands!(context, record), "finalized_nonce_spent_era_indexed");
  assert.equal((await records.required(id)).state, "superseded");
  assert.equal(chain.node.sends.length, 1, "nothing is signed or sent");
});

test("the Circle approval port delegates to the executor's own status and names its proof class only for a resolved phase", async (t) => {
  const { root, id } = await WP2_FAMILY_RECORDS.circle_approval(t), state = new StateStore(root), record = (await loadCircleApproval(root, id))!;
  const asked: string[] = [];
  let phase: CircleApprovalRecord["phase"] = "unknown_finality";
  const executor = { status: async (operationId: string) => { asked.push(operationId); return { ...record, phase }; } };
  const context = new ApnCore({ state, circleApproval: executor as never, clock: { now: () => new Date() } }).context;
  assert.equal(await circleApprovalAdapter.settleIfNeverLands!(context, record), null);
  phase = "failed_proven_superseded";
  assert.equal(await circleApprovalAdapter.settleIfNeverLands!(context, record), "circle_approval_journal_state");
  phase = "completed";
  assert.equal(await circleApprovalAdapter.settleIfNeverLands!(context, record), "circle_approval_safe_receipt_and_allowance");
  assert.deepEqual(asked, [id, id, id]);
  // Without the family's runtime there is nothing to observe with: its own refusal, which the wrapper reports.
  await assert.rejects(circleApprovalAdapter.settleIfNeverLands!(new ApnCore({ state }).context, record), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
});
