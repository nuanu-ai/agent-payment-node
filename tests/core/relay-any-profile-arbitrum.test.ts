/** QA RELAY-008 (Arbitrum USDC to Ethereum USDC) end to end through the installed command path, for a profile and
 * addresses that belong to nobody: `wallet import` → owner policy → `relay arbitrum prepare --recipient` →
 * `approval-check` → `approval-execute` → `observe` → `deposit-dispatch` → `observe` → `observe --ethereum-rpc-url`
 * (the Ethereum USDC credit to the caller's recipient, recorded once and then terminal). */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseTransaction, recoverTransactionAddress } from "viem";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } from "../../src/relay/arbitrum-usdc-source-draft.js";
import { ARBITRUM_USDC, ETHEREUM_USDC, QA_PAYER, QA_RECIPIENT, SimChain, admitBridge, assertNonOwner, consent, importPayer,
  qaWorld, quotePath } from "./relay-any-profile-harness.js";

const ARBITRUM_RPC = "https://arb1.arbitrum.io", PROFILE = "relay-qa-arbitrum";
const prepareArgs = (recipient: string, key: string) => ["relay", "arbitrum", "prepare", "--profile", PROFILE, "--owner", QA_PAYER,
  "--recipient", recipient, "--amount-atomic", "2000000", "--min-output-atomic", "1800000", "--max-provider-fee-atomic", "100000",
  "--max-approval-network-fee-wei", "3000000000000", "--max-deposit-network-fee-wei", "3000000000000",
  "--quote-file", resolve(quotePath("arbitrum-usdc-ethereum-usdc")), "--idempotency-key", key];

test("RELAY-008: any profile bridges Arbitrum USDC to the Ethereum recipient it names, one approval and one deposit", async t => {
  assertNonOwner(PROFILE, QA_PAYER, QA_RECIPIENT);
  let provider: unknown = { status: "waiting" }, statusReads = 0;
  const world = await qaWorld(t, null, () => { statusReads++; return provider; });
  await importPayer(world, PROFILE);
  await admitBridge(world, PROFILE, { chain: "eip155:42161", asset: ARBITRUM_USDC, reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE,
    maximumPerTransferAtomic: "2000000", dailyLimitAtomic: "4000000", recipients: [QA_RECIPIENT] });

  // A recipient outside the owner's pin is refused before the quote file is read (OD-1).
  const wrong = await world.cli(prepareArgs(QA_PAYER, "relay-008-wrong-0001"));
  assert.equal(wrong.ok, false);
  const prepared = await world.cli(prepareArgs(QA_RECIPIENT, "relay-008-0001"));
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const op = prepared.operation as Record<string, any>;
  assert.equal(op.sourceAccount, QA_PAYER.toLowerCase()); assert.equal(op.recipient, QA_RECIPIENT.toLowerCase());
  assert.equal(op.sourceChainId, 42161); assert.equal(op.destinationChainId, 1);

  const arbitrum = new SimChain(42161).fund(QA_PAYER, 10n ** 17n, { address: ARBITRUM_USDC, atomic: 5_000_000n });
  const id = ["--profile", PROFILE, "--operation", op.operationId, "--rpc-url", ARBITRUM_RPC];
  const check = await world.cli(["relay", "arbitrum", "approval-check", ...id], { relayArbitrumApprovalRpc: arbitrum });
  assert.equal(check.ok, true, JSON.stringify(check.error)); assert.equal((check.data as any).state, "approval_required");

  const screens: string[] = [];
  const approval = await world.cli(["relay", "arbitrum", "approval-execute", ...id],
    { relayArbitrumApprovalExecuteRpc: arbitrum, ...consent(op.operationId, op.quoteDigest, screens) });
  assert.equal(approval.ok, true, JSON.stringify(approval.error)); assert.equal((approval.data as any).state, "approval_submitted");
  assert.ok(screens[0]!.includes(QA_RECIPIENT.toLowerCase()));
  arbitrum.mine();
  const approved = await world.cli(["relay", "arbitrum", "observe", ...id], { relayArbitrumObserveRpc: arbitrum });
  assert.equal(approved.ok, true, JSON.stringify(approved.error)); assert.equal((approved.data as any).state, "approval_source_confirmed");

  const deposit = await world.cli(["relay", "arbitrum", "deposit-dispatch", ...id],
    { relayArbitrumDepositDispatchRpc: arbitrum, ...consent(op.operationId, op.quoteDigest, screens) });
  assert.equal(deposit.ok, true, JSON.stringify(deposit.error)); assert.equal((deposit.data as any).state, "deposit_submitted");
  arbitrum.mine();
  const deposited = await world.cli(["relay", "arbitrum", "observe", ...id], { relayArbitrumObserveRpc: arbitrum });
  assert.equal(deposited.ok, true, JSON.stringify(deposited.error)); assert.equal((deposited.data as any).state, "deposit_source_confirmed");
  assert.equal(arbitrum.sent.length, 2, "one approval and one deposit");
  for (const raw of arbitrum.sent) {
    assert.equal((await recoverTransactionAddress({ serializedTransaction: raw as never })).toLowerCase(), QA_PAYER.toLowerCase());
    assert.equal(parseTransaction(raw).chainId, 42161);
  }

  // Destination through the same command: with --ethereum-rpc-url a final deposit continues to the Ethereum USDC credit.
  const ethereum = new SimChain(1), sourceHash = (deposited.data as any).sourceProof.deposit.transactionHash as string;
  const observeDestination = () => world.cli(["relay", "arbitrum", "observe", ...id, "--ethereum-rpc-url", "https://ethereum-rpc.publicnode.com"],
    { relayArbitrumObserveRpc: arbitrum, relayArbitrumDestinationRpc: ethereum });
  provider = { status: "pending", originChainId: 42161, destinationChainId: 1, inTxHashes: [sourceHash] };
  let observed = await observeDestination();
  assert.equal(observed.ok, true, JSON.stringify(observed.error));
  assert.deepEqual([(observed.data as any).state, (observed.data as any).reason, (observed.data as any).terminal],
    ["deposit_source_confirmed", "provider_candidate_missing", false]);
  // A Transfer to anyone else is never this operation's credit.
  const minimum = BigInt(op.minOutputAtomic);
  provider = { status: "success", originChainId: 42161, destinationChainId: 1, inTxHashes: [sourceHash],
    txHashes: [ethereum.payoutToken(ETHEREUM_USDC, QA_PAYER, minimum)] };
  observed = await observeDestination();
  assert.equal(observed.ok, true, JSON.stringify(observed.error));
  assert.equal((observed.data as any).state, "provider_candidate_unproven"); assert.equal((observed.data as any).destinationDeliveryProven, false);
  const payout = ethereum.payoutToken(ETHEREUM_USDC, QA_RECIPIENT, minimum);
  provider = { status: "success", originChainId: 42161, destinationChainId: 1, inTxHashes: [sourceHash], txHashes: [payout] };
  observed = await observeDestination();
  assert.equal(observed.ok, true, JSON.stringify(observed.error));
  const accepted = observed.data as any;
  assert.equal(accepted.state, "operational_acceptance", JSON.stringify(accepted));
  assert.equal(accepted.terminal, true); assert.equal(accepted.sourceFinalized, true); assert.equal(accepted.destinationDeliveryProven, true);
  assert.equal(accepted.destinationProof.recipient, QA_RECIPIENT.toLowerCase());
  assert.equal(accepted.destinationProof.destinationTransactionHash, payout);
  assert.equal(accepted.destinationProof.creditedAtomic, op.minOutputAtomic);
  assert.equal(accepted.paidAcceptance, false);
  // Terminal: the recorded outcome returns without a Relay status read or an Ethereum POST.
  const posts = ethereum.posts, reads = statusReads;
  const again = await observeDestination();
  assert.equal(again.ok, true, JSON.stringify(again.error));
  assert.deepEqual([(again.data as any).state, (again.data as any).reason, (again.data as any).destinationProof],
    ["operational_acceptance", "recorded_destination_credit", accepted.destinationProof]);
  assert.equal(ethereum.posts, posts); assert.equal(statusReads, reads);
  // Without --ethereum-rpc-url the source-only contract is unchanged.
  const sourceOnly = await world.cli(["relay", "arbitrum", "observe", ...id], { relayArbitrumObserveRpc: arbitrum });
  assert.equal((sourceOnly.data as any).state, "deposit_source_confirmed"); assert.equal((sourceOnly.data as any).destinationDeliveryProven, false);
  // The record is checked against its own seal and the operation: an edited record is corrupt, never an acceptance.
  const path = join(world.root, "relay-arbitrum-destination-credits", op.profileHash, `${op.operationId}.json`);
  const saved = JSON.parse(await readFile(path, "utf8"));
  saved.proof.recipient = QA_PAYER.toLowerCase();
  await writeFile(path, JSON.stringify(saved));
  const edited = await observeDestination();
  assert.equal(edited.ok, false); assert.equal(edited.error?.code, "APN_STATE_CORRUPT");
});
