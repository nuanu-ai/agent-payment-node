/** QA RELAY-001 (Ethereum USDC to BNB) and RELAY-005 (Ethereum USDC to Base ETH) end to end through the installed
 * command path, for a profile and addresses that belong to nobody: `wallet import` → owner policy → `relay prepare` /
 * `relay prepare` → `relay execute` (approval) → `relay execute` (deposit) → `relay execute`
 * (finalized deposit) → `relay observe` / `relay base observe` (credit to the caller's recipient) → `relay status`. */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseAbi, parseTransaction, recoverTransactionAddress } from "viem";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { RELAY_BASE_ROUTE_REFERENCE, RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { ETHEREUM_DEPOSITORY } from "../../src/relay/quote.js";
import { ETHEREUM_USDC, QA_PAYER, QA_RECIPIENT, SimChain, admitBridge, assertNonOwner, consent, importPayer, qaWorld,
  type QuoteName } from "./relay-any-profile-harness.js";

const ETHEREUM_RPC = "https://ethereum-rpc.publicnode.com";
const DEPOSIT = parseAbi(["function depositErc20(address depositor, address token, uint256 amount, bytes32 id)"]);
interface TokenLane {
  readonly qa: string; readonly profile: string; readonly quote: QuoteName; readonly reference: string; readonly base: boolean;
  readonly amount: string; readonly minOut: string; readonly destinationRpc: string;
}
const LANES: readonly TokenLane[] = [
  { qa: "RELAY-001", profile: "relay-qa-usdc-bnb", quote: "ethereum-usdc-bnb-native", reference: RELAY_ROUTE_REFERENCE, base: false,
    amount: "1000000", minOut: "1200000000000000", destinationRpc: "https://bsc-rpc.publicnode.com" },
  { qa: "RELAY-005", profile: "relay-qa-usdc-base", quote: "ethereum-usdc-base-eth", reference: RELAY_BASE_ROUTE_REFERENCE, base: true,
    amount: "2500000", minOut: "900000000000000", destinationRpc: "https://mainnet.base.org" },
];

for (const lane of LANES) test(`${lane.qa}: any profile prepares, approves, deposits and proves an Ethereum USDC Relay route to its own recipient`, async t => {
  assertNonOwner(lane.profile, QA_PAYER, QA_RECIPIENT);
  let provider: unknown = { status: "waiting" };
  const world = await qaWorld(t, lane.quote, () => provider);
  await importPayer(world, lane.profile);
  await admitBridge(world, lane.profile, { chain: "eip155:1", asset: ETHEREUM_USDC, reference: lane.reference,
    maximumPerTransferAtomic: lane.amount, dailyLimitAtomic: (BigInt(lane.amount) * 2n).toString(), recipients: [QA_RECIPIENT] });

  const prepared = await world.cli(["relay", "prepare", "--profile", lane.profile, "--source-chain", "eip155:1", "--asset", "usdc",
    "--destination-chain", lane.base ? "eip155:8453" : "eip155:56",
    "--recipient", QA_RECIPIENT, "--amount-atomic", lane.amount, "--min-output-atomic", lane.minOut,
    "--max-approval-network-fee-wei", "10000000000000", "--max-deposit-network-fee-wei", "10000000000000",
    "--idempotency-key", `${lane.qa.toLowerCase()}-0001`]);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const op = prepared.operation as Record<string, any>;
  assert.equal(op.sourceAccount, QA_PAYER.toLowerCase()); assert.equal(op.recipient, QA_RECIPIENT.toLowerCase());
  assert.equal(op.destinationChainId, lane.base ? 8453 : 56); assert.equal(op.amountAtomic, lane.amount);
  // Refunds are derived: source refund = payer, destination refund = recipient (signed order rows).
  assert.equal(op.quote.sourceRefundRecipient, QA_PAYER.toLowerCase());
  assert.deepEqual(world.quoteRequests.map(body => [body.user, body.recipient, body.refundTo, body.amount]),
    [[QA_PAYER.toLowerCase(), QA_RECIPIENT.toLowerCase(), QA_PAYER.toLowerCase(), lane.amount]]);

  const ethereum = new SimChain(1).fund(QA_PAYER, 10n ** 18n, { address: ETHEREUM_USDC, atomic: 10_000_000n });

  const screens: string[] = [];
  const execute = ["relay", "execute", "--profile", lane.profile, "--operation", op.operationId, "--rpc-url", ETHEREUM_RPC];
  const options = { relayExecuteTransport: ethereum, relayApprovalInclusionWait: { polls: 0, delayMs: 0 }, ...consent(op.operationId, op.quoteDigest, screens) };
  const approved = await world.cli(execute, options);
  assert.equal(approved.ok, true, JSON.stringify(approved.error));
  assert.equal((approved.data as any).effects[0].phase, "submitting"); assert.equal(ethereum.sent.length, 1);
  for (const shown of [QA_RECIPIENT.toLowerCase(), QA_PAYER.toLowerCase(), lane.amount, op.minOutputAtomic]) assert.ok(screens[0]!.includes(shown));
  ethereum.mine();
  const deposited = await world.cli(execute, options);
  assert.equal(deposited.ok, true, JSON.stringify(deposited.error));
  assert.equal((deposited.data as any).effects[0].phase, "confirmed"); assert.equal((deposited.data as any).effects[1].phase, "submitting");
  assert.equal(ethereum.sent.length, 2);
  for (const raw of ethereum.sent)
    assert.equal((await recoverTransactionAddress({ serializedTransaction: raw as never })).toLowerCase(), QA_PAYER.toLowerCase());
  const deposit = parseTransaction(ethereum.sent[1]!);
  assert.equal(deposit.to?.toLowerCase(), ETHEREUM_DEPOSITORY.toLowerCase());
  const args = decodeFunctionData({ abi: DEPOSIT, data: deposit.data! }).args;
  assert.equal(args[0].toLowerCase(), QA_PAYER.toLowerCase()); assert.equal(args[2], BigInt(lane.amount));
  ethereum.mine();
  const final = await world.cli(execute, options);
  assert.equal(final.ok, true, JSON.stringify(final.error));
  assert.equal((final.data as any).effects[1].phase, "confirmed"); assert.equal(ethereum.sent.length, 2, "each effect sent once");
  const sourceHash = (final.data as any).effects[1].attempt.transactionHash as string;
  const identity = { account: QA_PAYER, chain: "eip155:1", asset: { kind: "token" as const, identifier: ETHEREUM_USDC } };
  assert.equal((await new AssetUsageLedger(world.root).load(identity,
    assetUsageReservationId(identity, `relay-execute:${op.operationId}`)))?.state, "finalized");

  const destination = new SimChain(lane.base ? 8453 : 56);
  // The solver pays the signed order's minimum, which is at least the caller's minimum.
  assert.ok(BigInt(op.minOutputAtomic) >= BigInt(lane.minOut));
  const credit = BigInt(op.minOutputAtomic);
  const payout = lane.base ? destination.payoutRouter(QA_RECIPIENT, credit) : destination.payoutNative(QA_RECIPIENT, credit);
  provider = { status: "success", originChainId: 1, destinationChainId: lane.base ? 8453 : 56, inTxHashes: [sourceHash], txHashes: [payout] };
  const observed = await world.cli(["relay", "observe", "--profile", lane.profile, "--operation", op.operationId, "--rpc-url", ETHEREUM_RPC,
    "--destination-rpc-url", lane.destinationRpc], lane.base ? { relayObserveBaseRpc: destination, relayObserveSourceRpc: ethereum }
    : { relayObserveSourceRpc: ethereum, relayObserveBnbRpc: destination });
  assert.equal(observed.ok, true, JSON.stringify(observed.error));
  const result = observed.data as any;
  assert.equal(result.state, "operational_acceptance", JSON.stringify(result));
  assert.equal(result.destinationProof.proof.recipient, QA_RECIPIENT.toLowerCase());
  assert.equal(result.destinationProof.proof.creditedWei, op.minOutputAtomic);
  assert.equal(result.paidAcceptance, false);

  const status = await world.cli(["relay", "status", "--profile", lane.profile, "--operation", op.operationId]);
  assert.equal(status.ok, true, JSON.stringify(status.error)); assert.equal((status.data as any).status, "success");
  const stranger = await world.cli(["relay", "execute", "--profile", "relay-qa-stranger", "--operation", op.operationId, "--rpc-url", ETHEREUM_RPC],
    options);
  assert.equal(stranger.ok, false); assert.equal(ethereum.sent.length, 2);
});

test("RELAY-001: a recipient outside the owner's pin is refused at prepare, before any quote", async t => {
  const world = await qaWorld(t, "ethereum-usdc-bnb-native");
  await importPayer(world, "relay-qa-pinned");
  await admitBridge(world, "relay-qa-pinned", { chain: "eip155:1", asset: ETHEREUM_USDC, reference: RELAY_ROUTE_REFERENCE,
    maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000", recipients: [QA_PAYER] });
  const refused = await world.cli(["relay", "prepare", "--profile", "relay-qa-pinned", "--source-chain", "eip155:1", "--asset", "usdc",
    "--destination-chain", "eip155:56", "--recipient", QA_RECIPIENT, "--amount-atomic", "1000000",
    "--min-output-atomic", "1", "--max-approval-network-fee-wei", "1", "--max-deposit-network-fee-wei", "1", "--idempotency-key", "relay-001-pin-0001"]);
  assert.equal(refused.ok, false); assert.equal(refused.error?.code, "APN_ALLOWLIST_REFUSED");
  assert.equal(world.quoteRequests.length, 0);
});
