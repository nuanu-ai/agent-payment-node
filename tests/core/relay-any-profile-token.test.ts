/** Relay Binance-Peg token routes end to end through the installed command path, for a profile and addresses that belong
 * to nobody: `wallet import` → owner policy (the source token on rail bridge with the route's relay pin) → `relay prepare
 * --destination-asset` → `relay execute` (approval, then deposit, then the final deposit) → `relay observe` (one Transfer of
 * the pinned destination token, in its own decimals) → `relay status`. One lane leaves BNB Smart Chain (18 decimals in, 6
 * out), one arrives there (6 in, 18 out). Chains are simulated; the quotes are Relay-signed for the generated keys. */
import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, parseAbi, parseTransaction } from "viem";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { RELAY_TOKEN_DEPOSITORY } from "../../src/relay/token-routes.js";
import { ARBITRUM_USDC, QA_PAYER, QA_RECIPIENT, SimChain, admitBridge, assertNonOwner, consent, importPayer, qaWorld,
  type TokenQuoteName } from "./relay-any-profile-harness.js";

const BNB_USDT = "0x55d398326f99059fF775485246999027B3197955", BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEPOSIT = parseAbi(["function depositErc20(address depositor, address token, uint256 amount, bytes32 id)"]);
interface Side { readonly chain: 56 | 8453 | 42161; readonly asset: "usdc" | "usdt"; readonly token: string; readonly decimals: 6 | 18; readonly rpc: string }
interface TokenLane {
  readonly qa: string; readonly profile: string; readonly quote: TokenQuoteName; readonly reference: string;
  readonly source: Side; readonly destination: Side; readonly amount: string; readonly minOut: string; readonly balance: bigint;
}
const LANES: readonly TokenLane[] = [
  { qa: "RELAY-BNB-001", profile: "relay-qa-bnb-usdt-base-usdc", quote: "bnb-usdt-base-usdc", reference: "bnb-usdt-base-usdc-v1",
    source: { chain: 56, asset: "usdt", token: BNB_USDT, decimals: 18, rpc: "https://bsc-rpc.publicnode.com" },
    destination: { chain: 8453, asset: "usdc", token: BASE_USDC, decimals: 6, rpc: "https://mainnet.base.org" },
    amount: "5000000000000000000", minOut: "4800000", balance: 10n * 10n ** 18n },
  { qa: "RELAY-BNB-002", profile: "relay-qa-arbitrum-usdc-bnb-usdc", quote: "arbitrum-usdc-bnb-usdc", reference: "arbitrum-usdc-bnb-usdc-v1",
    source: { chain: 42161, asset: "usdc", token: ARBITRUM_USDC, decimals: 6, rpc: "https://arbitrum-one-rpc.publicnode.com" },
    destination: { chain: 56, asset: "usdc", token: BNB_USDC, decimals: 18, rpc: "https://bsc-rpc.publicnode.com" },
    amount: "5000000", minOut: "4800000000000000000", balance: 10_000_000n },
];
const prepareArgs = (lane: TokenLane, key: string, approvalFee = "10000000000000") => ["relay", "prepare", "--profile", lane.profile,
  "--source-chain", `eip155:${lane.source.chain}`, "--asset", lane.source.asset, "--destination-chain", `eip155:${lane.destination.chain}`,
  "--destination-asset", lane.destination.asset, "--recipient", QA_RECIPIENT, "--amount-atomic", lane.amount, "--min-output-atomic", lane.minOut,
  "--max-approval-network-fee-wei", approvalFee, "--max-deposit-network-fee-wei", "10000000000000", "--idempotency-key", key];
const admit = async (world: Awaited<ReturnType<typeof qaWorld>>, lane: TokenLane, reference = lane.reference) =>
  admitBridge(world, lane.profile, { chain: `eip155:${lane.source.chain}`, asset: lane.source.token, reference,
    maximumPerTransferAtomic: lane.amount, dailyLimitAtomic: (BigInt(lane.amount) * 2n).toString(), recipients: [QA_RECIPIENT] });

for (const lane of LANES) test(`${lane.qa}: any profile prepares, approves, deposits and proves ${lane.reference} in each side's own decimals`, async t => {
  assertNonOwner(lane.profile, QA_PAYER, QA_RECIPIENT);
  let provider: unknown = { status: "waiting" };
  const world = await qaWorld(t, lane.quote, () => provider);
  await importPayer(world, lane.profile);
  await admit(world, lane);

  const prepared = await world.cli(prepareArgs(lane, `${lane.qa.toLowerCase()}-0001`));
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const op = prepared.operation as Record<string, any>;
  assert.equal(op.sourceAccount, QA_PAYER.toLowerCase()); assert.equal(op.recipient, QA_RECIPIENT.toLowerCase());
  assert.deepEqual([op.sourceChainId, op.destinationChainId, op.amountAtomic], [lane.source.chain, lane.destination.chain, lane.amount]);
  assert.equal(op.quote, undefined); assert.equal(op.tokenQuote.routeReference, lane.reference);
  assert.deepEqual([op.tokenQuote.sourceDecimals, op.tokenQuote.destinationDecimals], [lane.source.decimals, lane.destination.decimals]);
  assert.equal(op.tokenQuote.sourceRefundRecipient, QA_PAYER.toLowerCase());
  assert.ok(BigInt(op.minOutputAtomic) >= BigInt(lane.minOut));
  assert.deepEqual(world.quoteRequests.map(body => [body.user, body.recipient, body.refundTo, body.amount, body.originChainId,
    body.destinationChainId, String(body.originCurrency).toLowerCase(), String(body.destinationCurrency).toLowerCase()]),
    [[QA_PAYER.toLowerCase(), QA_RECIPIENT.toLowerCase(), QA_PAYER.toLowerCase(), lane.amount, lane.source.chain, lane.destination.chain,
      lane.source.token.toLowerCase(), lane.destination.token.toLowerCase()]]);

  const source = new SimChain(lane.source.chain).fund(QA_PAYER, 10n ** 18n, { address: lane.source.token, atomic: lane.balance });
  const screens: string[] = [];
  const execute = ["relay", "execute", "--profile", lane.profile, "--operation", op.operationId, "--rpc-url", lane.source.rpc];
  const options = { relayExecuteTransport: source, relayApprovalInclusionWait: { polls: 0, delayMs: 0 }, ...consent(op.operationId, op.quoteDigest, screens) };
  const approved = await world.cli(execute, options);
  assert.equal(approved.ok, true, JSON.stringify(approved.error));
  assert.equal((approved.data as any).effects[0].phase, "submitting"); assert.equal(source.sent.length, 1);
  for (const shown of [QA_RECIPIENT.toLowerCase(), QA_PAYER.toLowerCase(), lane.amount, op.minOutputAtomic, `eip155:${lane.source.chain}`,
    `${lane.source.decimals} decimals`, `${lane.destination.decimals} decimals`, lane.destination.token]) {
    assert.ok(screens[0]!.toLowerCase().includes(shown.toLowerCase()), shown);
  }
  assert.equal(parseTransaction(source.sent[0]!).chainId, lane.source.chain);
  source.mine();
  const deposited = await world.cli(execute, options);
  assert.equal(deposited.ok, true, JSON.stringify(deposited.error));
  assert.equal((deposited.data as any).effects[0].phase, "confirmed"); assert.equal((deposited.data as any).effects[1].phase, "submitting");
  const deposit = parseTransaction(source.sent[1]!);
  assert.equal(deposit.to?.toLowerCase(), RELAY_TOKEN_DEPOSITORY);
  const args = decodeFunctionData({ abi: DEPOSIT, data: deposit.data! }).args;
  assert.deepEqual([args[0].toLowerCase(), args[1].toLowerCase(), args[2]], [QA_PAYER.toLowerCase(), lane.source.token.toLowerCase(), BigInt(lane.amount)]);
  source.mine();
  const final = await world.cli(execute, options);
  assert.equal(final.ok, true, JSON.stringify(final.error));
  assert.equal((final.data as any).effects[1].phase, "confirmed"); assert.equal(source.sent.length, 2, "each effect sent once");
  const sourceHash = (final.data as any).effects[1].attempt.transactionHash as string;
  // The hold is the source token's own bucket: its chain, its checksummed address, its atomic units.
  const identity = { account: QA_PAYER, chain: `eip155:${lane.source.chain}`, asset: { kind: "token" as const, identifier: lane.source.token } };
  const hold = await new AssetUsageLedger(world.root).load(identity, assetUsageReservationId(identity, `relay-execute:${op.operationId}`));
  assert.deepEqual([hold?.state, hold?.amountAtomic], ["finalized", lane.amount]);

  const destination = new SimChain(lane.destination.chain);
  const credit = BigInt(op.minOutputAtomic);
  const payout = destination.payoutToken(lane.destination.token, QA_RECIPIENT, credit);
  provider = { status: "success", originChainId: lane.source.chain, destinationChainId: lane.destination.chain, inTxHashes: [sourceHash], txHashes: [payout] };
  const observe = ["relay", "observe", "--profile", lane.profile, "--operation", op.operationId, "--rpc-url", lane.source.rpc,
    "--destination-rpc-url", lane.destination.rpc];
  const observed = await world.cli(observe, { relayObserveSourceRpc: source, relayObserveBnbRpc: destination });
  assert.equal(observed.ok, true, JSON.stringify(observed.error));
  const result = observed.data as any;
  assert.equal(result.state, "operational_acceptance", JSON.stringify(result));
  assert.deepEqual([result.destinationProof.proof.method, result.destinationProof.proof.recipient, result.destinationProof.proof.creditedWei],
    ["pinned_erc20_transfer_event", QA_RECIPIENT.toLowerCase(), op.minOutputAtomic]);
  assert.equal(result.paidAcceptance, false);
  const status = await world.cli(["relay", "status", "--profile", lane.profile, "--operation", op.operationId]);
  assert.equal(status.ok, true, JSON.stringify(status.error)); assert.equal((status.data as any).status, "success");
});

test("RELAY-BNB-003: a destination-token transfer in the other side's decimals or of the other token never proves the credit", async t => {
  const lane = LANES[1]!;
  let provider: unknown = { status: "waiting" };
  const world = await qaWorld(t, lane.quote, () => provider);
  await importPayer(world, lane.profile);
  await admit(world, lane);
  const prepared = await world.cli(prepareArgs(lane, "relay-bnb-003-0001"));
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const op = prepared.operation as Record<string, any>;
  const source = new SimChain(lane.source.chain).fund(QA_PAYER, 10n ** 18n, { address: lane.source.token, atomic: lane.balance });
  const options = { relayExecuteTransport: source, relayApprovalInclusionWait: { polls: 0, delayMs: 0 }, ...consent(op.operationId, op.quoteDigest) };
  const execute = ["relay", "execute", "--profile", lane.profile, "--operation", op.operationId, "--rpc-url", lane.source.rpc];
  let journal: any;
  for (let step = 0; step < 3; step++) {
    const run = await world.cli(execute, options);
    assert.equal(run.ok, true, JSON.stringify(run.error)); journal = run.data; source.mine();
  }
  assert.equal(journal.effects[1].phase, "confirmed");
  const sourceHash = journal.effects[1].attempt.transactionHash as string;
  const observe = ["relay", "observe", "--profile", lane.profile, "--operation", op.operationId, "--rpc-url", lane.source.rpc,
    "--destination-rpc-url", lane.destination.rpc];
  // 6-decimal reading of the minimum (an 18-decimal token paid 10^-12 of it), then the right amount of the other BNB token.
  for (const [token, amount, reason] of [[BNB_USDC, BigInt(op.minOutputAtomic) / 10n ** 12n, "destination_value_below_minimum"],
    [BNB_USDT, BigInt(op.minOutputAtomic), "token_credit_missing_or_ambiguous"]] as const) {
    const destination = new SimChain(56), payout = destination.payoutToken(token, QA_RECIPIENT, amount);
    provider = { status: "success", originChainId: lane.source.chain, destinationChainId: 56, inTxHashes: [sourceHash], txHashes: [payout] };
    const observed = await world.cli(observe, { relayObserveSourceRpc: source, relayObserveBnbRpc: destination });
    assert.equal(observed.ok, true, JSON.stringify(observed.error));
    assert.deepEqual([(observed.data as any).state, (observed.data as any).reason], ["provider_candidate_unproven", reason]);
  }
});

test("RELAY-BNB-004: a standing allowance to the depository is refused before any token-route signature", async t => {
  const lane = LANES[0]!;
  const world = await qaWorld(t, lane.quote);
  await importPayer(world, lane.profile);
  await admit(world, lane);
  const prepared = await world.cli(prepareArgs(lane, "relay-bnb-004-0001"));
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const op = prepared.operation as Record<string, any>;
  const source = new SimChain(56).fund(QA_PAYER, 10n ** 18n, { address: BNB_USDT, atomic: lane.balance })
    .allow(BNB_USDT, QA_PAYER, RELAY_TOKEN_DEPOSITORY, 1n);
  const refused = await world.cli(["relay", "execute", "--profile", lane.profile, "--operation", op.operationId, "--rpc-url", lane.source.rpc],
    { relayExecuteTransport: source, relayApprovalInclusionWait: { polls: 0, delayMs: 0 }, ...consent(op.operationId, op.quoteDigest) });
  assert.equal(refused.ok, false);
  assert.equal(refused.error?.details?.reason, "source_allowance_not_zero", JSON.stringify(refused.error));
  assert.equal(source.sent.length, 0);
});

test("RELAY-BNB-005: prepare refuses a policy pinned to another token route, a fee above the ceiling and a token Relay pays only as a destination", async t => {
  const lane = LANES[0]!;
  const world = await qaWorld(t, lane.quote);
  await importPayer(world, lane.profile);
  await admit(world, lane, "bnb-usdt-base-usdt-v1");
  const pinned = await world.cli(prepareArgs(lane, "relay-bnb-005-0001"));
  assert.equal(pinned.ok, false); assert.equal(pinned.error?.code, "APN_ALLOWLIST_REFUSED");
  assert.equal(world.quoteRequests.length, 0, "refused before any quote");
  await admit(world, lane);
  const fee = await world.cli(prepareArgs(lane, "relay-bnb-005-0002", "1"));
  assert.equal(fee.ok, false); assert.equal(fee.error?.details?.reason, "relay_approval_fee_above_ceiling");
  const baseSource = await world.cli(["relay", "prepare", "--profile", lane.profile, "--source-chain", "eip155:8453", "--asset", "usdc",
    "--destination-chain", "eip155:56", "--destination-asset", "usdt", "--recipient", QA_RECIPIENT, "--amount-atomic", "5000000",
    "--min-output-atomic", "1", "--max-approval-network-fee-wei", "1", "--max-deposit-network-fee-wei", "1", "--idempotency-key", "relay-bnb-005-0003"]);
  assert.equal(baseSource.ok, false); assert.equal(baseSource.error?.details?.reason, "relay_route_unknown");
});
