/** QA RELAY-008 (Arbitrum USDC to Ethereum USDC) end to end through the installed command path, for a profile and
 * addresses that belong to nobody: `wallet import` → owner policy → `relay arbitrum prepare --recipient` →
 * `approval-check` → `approval-execute` → `observe` → `deposit-dispatch` → `observe`, then the read-only Ethereum
 * USDC credit proof for the caller's recipient (no command exposes that proof yet). */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { parseTransaction, recoverTransactionAddress } from "viem";
import { StateStore } from "../../src/state.js";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE } from "../../src/relay/arbitrum-usdc-source-draft.js";
import { validateRelayArbitrumUsdcEthereumUsdcQuote } from "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { proveRelayEthereumUsdcCredit, RelayEthereumUsdcReadOnlyRpc } from "../../src/relay/ethereum-usdc-credit-proof.js";
import { ARBITRUM_USDC, ETHEREUM_USDC, QA_PAYER, QA_RECIPIENT, SimChain, admitBridge, assertNonOwner, consent, importPayer,
  qaWorld, quoteFixture, quotePath } from "./relay-any-profile-harness.js";

const ARBITRUM_RPC = "https://arb1.arbitrum.io", PROFILE = "relay-qa-arbitrum";
const prepareArgs = (recipient: string, key: string) => ["relay", "arbitrum", "prepare", "--profile", PROFILE, "--owner", QA_PAYER,
  "--recipient", recipient, "--amount-atomic", "2000000", "--min-output-atomic", "1800000", "--max-provider-fee-atomic", "100000",
  "--max-approval-network-fee-wei", "3000000000000", "--max-deposit-network-fee-wei", "3000000000000",
  "--quote-file", resolve(quotePath("arbitrum-usdc-ethereum-usdc")), "--idempotency-key", key];

test("RELAY-008: any profile bridges Arbitrum USDC to the Ethereum recipient it names, one approval and one deposit", async t => {
  assertNonOwner(PROFILE, QA_PAYER, QA_RECIPIENT);
  const world = await qaWorld(t, null);
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

  // Destination: one canonical safe USDC Transfer to the operation's own recipient, filtered by that recipient.
  const quote = await validateRelayArbitrumUsdcEthereumUsdcQuote(await quoteFixture("arbitrum-usdc-ethereum-usdc"), { payer: QA_PAYER,
    recipient: QA_RECIPIENT, amountAtomic: "2000000", minimumOutputAtomic: "1800000", nowSeconds: Math.floor(Date.now() / 1000) });
  assert.equal(quote.quoteDigest, op.quoteDigest);
  const ethereum = new SimChain(1);
  const payout = ethereum.payoutToken(ETHEREUM_USDC, QA_RECIPIENT, BigInt(quote.minimumOutputAtomic));
  const credit = await proveRelayEthereumUsdcCredit(quote, payout,
    new RelayEthereumUsdcReadOnlyRpc("https://ethereum-rpc.publicnode.com", new StateStore(world.root), ethereum as never));
  assert.equal(credit.status, "recipient_credit_proven", JSON.stringify(credit));
  if (credit.status === "recipient_credit_proven") assert.equal(credit.proof.recipient, QA_RECIPIENT.toLowerCase());
  const elsewhere = ethereum.payoutToken(ETHEREUM_USDC, QA_PAYER, BigInt(quote.minimumOutputAtomic));
  assert.notEqual((await proveRelayEthereumUsdcCredit(quote, elsewhere,
    new RelayEthereumUsdcReadOnlyRpc("https://ethereum-rpc.publicnode.com", new StateStore(world.root), ethereum as never))).status,
  "recipient_credit_proven");
});
