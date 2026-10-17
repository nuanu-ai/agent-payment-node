/** QA RELAY-002, 003, 004, 006, 007 end to end through the installed command path, for profiles and addresses that
 * belong to nobody: `wallet import` → owner policy → `relay prepare` → `relay execute` (foreground code,
 * real signing, one send) → `relay execute` (source receipt) → `relay observe` (destination credit to the
 * caller's recipient) → `relay status`. Chains are simulated; quotes are provider-signed for the generated keys. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { parseTransaction, recoverTransactionAddress, type Hex } from "viem";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import { RELAY_BASE_MEGA_ROUTE_REFERENCE, RELAY_BASE_POLYGON_ROUTE_REFERENCE, RELAY_BNB_MONAD_ROUTE_REFERENCE,
  RELAY_BNB_POLYGON_ROUTE_REFERENCE, RELAY_LEGACY_BNB_MONAD_DEFAULT_REFERENCE, RELAY_MEGA_USDM } from "../../src/relay/native-quote.js";
import { QA_PAYER, QA_RECIPIENT, SimChain, admitBridge, assertNonOwner, consent, importPayer, qaWorld,
  type QaWorld, type QuoteName } from "./relay-any-profile-harness.js";

const RPC: Readonly<Record<number, string>> = { 56: "https://bsc-rpc.publicnode.com", 8453: "https://mainnet.base.org",
  137: "https://polygon-bor-rpc.publicnode.com", 143: "https://rpc.monad.xyz", 4326: "https://mainnet.megaeth.com" };
interface NativeLane {
  readonly qa: string; readonly profile: string; readonly quote: QuoteName; readonly reference: string;
  readonly source: 56 | 8453; readonly destination: 137 | 143 | 4326;
  readonly amount: string; readonly minOut: string; readonly fee: string;
  readonly payout: (chain: SimChain, minimum: bigint) => Hex; readonly method: string;
  readonly recipients?: readonly string[];
}
const LANES: readonly NativeLane[] = [
  { qa: "RELAY-002", profile: "relay-qa-bnb-polygon", quote: "bnb-native-polygon-native", reference: RELAY_BNB_POLYGON_ROUTE_REFERENCE,
    source: 56, destination: 137, amount: "1500000000000000", minOut: "10000000000000000000", fee: "30000000000000",
    payout: (chain, minimum) => chain.payoutNative(QA_RECIPIENT, minimum), method: "direct_native_transaction" },
  { qa: "RELAY-003", profile: "relay-qa-bnb-monad", quote: "bnb-native-monad-native", reference: RELAY_BNB_MONAD_ROUTE_REFERENCE,
    source: 56, destination: 143, amount: "1200000000000000", minOut: "30000000000000000000", fee: "30000000000000",
    payout: (chain, minimum) => chain.payoutNative(QA_RECIPIENT, minimum), method: "direct_native_transaction" },
  // RELAY-004 was the same physical route as 003 under an owner-named reference; it now is 003 for any profile, here
  // with the owner's optional recipient pin (OD-1) admitting the caller's recipient.
  { qa: "RELAY-004", profile: "relay-qa-bnb-monad-pinned", quote: "bnb-native-monad-native", reference: RELAY_BNB_MONAD_ROUTE_REFERENCE,
    source: 56, destination: 143, amount: "1200000000000000", minOut: "30000000000000000000", fee: "30000000000000",
    payout: (chain, minimum) => chain.payoutNative(QA_RECIPIENT, minimum), method: "direct_native_transaction", recipients: [QA_RECIPIENT] },
  { qa: "RELAY-006", profile: "relay-qa-base-mega", quote: "base-native-megaeth-usdm", reference: RELAY_BASE_MEGA_ROUTE_REFERENCE,
    source: 8453, destination: 4326, amount: "60000000000000", minOut: "100000000000000000", fee: "1500000000000",
    payout: (chain, minimum) => chain.payoutToken(RELAY_MEGA_USDM, QA_RECIPIENT, minimum), method: "pinned_erc20_transfer_event" },
  { qa: "RELAY-007", profile: "relay-qa-base-polygon", quote: "base-native-polygon-native", reference: RELAY_BASE_POLYGON_ROUTE_REFERENCE,
    source: 8453, destination: 137, amount: "60000000000000", minOut: "1000000000000000000", fee: "1500000000000",
    payout: (chain, minimum) => chain.payoutRouter(QA_RECIPIENT, minimum), method: "relay_router_event" },
];

function prepareArgs(lane: NativeLane, key: string): string[] {
  return ["relay", "prepare", "--profile", lane.profile, "--source-chain", `eip155:${lane.source}`, "--asset", "native",
    "--destination-chain", `eip155:${lane.destination}`, "--recipient", QA_RECIPIENT, "--amount-atomic", lane.amount,
    "--min-output-atomic", lane.minOut, "--max-deposit-network-fee-wei", lane.fee, "--idempotency-key", key];
}
async function admit(world: QaWorld, lane: NativeLane, reference = lane.reference) {
  await admitBridge(world, lane.profile, { chain: `eip155:${lane.source}`, asset: null, reference,
    maximumPerTransferAtomic: lane.amount, dailyLimitAtomic: (BigInt(lane.amount) * 2n).toString(),
    ...(lane.recipients === undefined ? {} : { recipients: lane.recipients }) });
}

async function runLane(t: TestContext, lane: NativeLane) {
  assertNonOwner(lane.profile, QA_PAYER, QA_RECIPIENT);
  let provider: unknown = { status: "waiting" };
  const world = await qaWorld(t, lane.quote, () => provider);
  await importPayer(world, lane.profile);
  await admit(world, lane);

  const prepared = await world.cli(prepareArgs(lane, `${lane.qa.toLowerCase()}-0001`));
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const op = prepared.operation as Record<string, any>;
  assert.equal(op.state, "prepared");
  assert.equal(op.sourceAccount, QA_PAYER.toLowerCase()); assert.equal(op.recipient, QA_RECIPIENT.toLowerCase());
  assert.equal(op.sourceChainId, lane.source); assert.equal(op.destinationChainId, lane.destination);
  assert.equal(op.amountAtomic, lane.amount); assert.equal(op.nativeQuote.routeReference, lane.reference);
  // On Base the consented ceiling is the full OP Stack budget the caller chose; on BNB it is the quoted gas x max fee.
  if (lane.source === 8453) assert.equal(op.depositNetworkFeeCeilingWei, lane.fee);
  assert.ok(BigInt(op.depositNetworkFeeCeilingWei) <= BigInt(lane.fee));
  assert.deepEqual(world.quoteRequests.map(body => [body.user, body.recipient, body.refundTo, body.amount, body.originChainId, body.destinationChainId]),
    [[QA_PAYER.toLowerCase(), QA_RECIPIENT.toLowerCase(), QA_PAYER.toLowerCase(), lane.amount, lane.source, lane.destination]]);

  const source = new SimChain(lane.source).fund(QA_PAYER, 10n ** 18n);
  const screens: string[] = [];
  const execute = ["relay", "execute", "--profile", lane.profile, "--operation", op.operationId, "--rpc-url", RPC[lane.source]!];
  const sent = await world.cli(execute, { relayExecuteTransport: source, ...consent(op.operationId, op.quoteDigest, screens) });
  assert.equal(sent.ok, true, JSON.stringify(sent.error));
  assert.equal((sent.data as any).phase, "submitting");
  assert.equal(source.sent.length, 1);
  const raw = source.sent[0]!, tx = parseTransaction(raw);
  assert.equal((await recoverTransactionAddress({ serializedTransaction: raw as never })).toLowerCase(), QA_PAYER.toLowerCase());
  assert.equal(tx.chainId, lane.source); assert.equal(tx.value, BigInt(lane.amount));
  assert.equal(tx.to?.toLowerCase(), op.nativeQuote.deposit.to); assert.equal(tx.data?.toLowerCase(), op.nativeQuote.deposit.data);
  assert.equal(screens.length, 1);
  for (const shown of [QA_RECIPIENT.toLowerCase(), QA_PAYER.toLowerCase(), lane.amount, op.minOutputAtomic, op.depositNetworkFeeCeilingWei])
    assert.ok(screens[0]!.includes(shown), `consent shows ${shown}`);

  source.mine();
  const confirmed = await world.cli(execute, { relayExecuteTransport: source });
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed.error));
  assert.equal((confirmed.data as any).phase, "confirmed");
  assert.equal(source.sent.length, 1, "one send only");
  const sourceHash = (confirmed.data as any).transactionHash as string;
  const identity = { account: QA_PAYER, chain: `eip155:${lane.source}`, asset: { kind: "native" as const, identifier: null } };
  assert.equal((await new AssetUsageLedger(world.root).load(identity,
    assetUsageReservationId(identity, `relay-native-execute:${op.operationId}`)))?.state, "finalized");

  const destination = new SimChain(lane.destination);
  // The solver pays the signed order's minimum, which is at least the caller's minimum.
  assert.ok(BigInt(op.minOutputAtomic) >= BigInt(lane.minOut));
  const payout = lane.payout(destination, BigInt(op.minOutputAtomic));
  provider = { status: "success", originChainId: lane.source, destinationChainId: lane.destination, inTxHashes: [sourceHash], txHashes: [payout] };
  const observed = await world.cli(["relay", "observe", "--profile", lane.profile, "--operation", op.operationId,
    "--rpc-url", RPC[lane.source]!, "--destination-rpc-url", RPC[lane.destination]!], { relayObserveSourceRpc: source, relayObserveBnbRpc: destination });
  assert.equal(observed.ok, true, JSON.stringify(observed.error));
  const result = observed.data as any;
  assert.equal(result.state, "operational_acceptance", JSON.stringify(result));
  assert.equal(result.destinationProof.proof.recipient, QA_RECIPIENT.toLowerCase());
  assert.equal(result.destinationProof.proof.method, lane.method);
  assert.equal(result.destinationProof.proof.creditedWei, op.minOutputAtomic);
  if (lane.destination === 137) assert.equal(result.destinationProof.proof.finalityKind, "polygon_milestone_finalized");
  if (lane.source === 8453) assert.ok(BigInt(result.sourceActualFee.totalFeeWei) <= BigInt(lane.fee));
  assert.equal(result.paidAcceptance, false);

  const status = await world.cli(["relay", "status", "--profile", lane.profile, "--operation", op.operationId]);
  assert.equal(status.ok, true, JSON.stringify(status.error)); assert.equal((status.data as any).status, "success");
  const stranger = await world.cli(["relay", "status", "--profile", "relay-qa-stranger", "--operation", op.operationId]);
  assert.equal(stranger.ok, false); assert.equal(stranger.error?.code, "APN_OPERATION_NOT_FOUND");
  return { world, op };
}

for (const lane of LANES) test(`${lane.qa}: any profile prepares, executes and proves a native Relay route to its own recipient`, async t => {
  await runLane(t, lane);
});

test("RELAY-004: an owner-named reference no longer admits new prepares; restaging the owner-free pin does", async t => {
  const lane = LANES.find(candidate => candidate.qa === "RELAY-004")!;
  const world = await qaWorld(t, lane.quote);
  await importPayer(world, lane.profile);
  await admit(world, lane, RELAY_LEGACY_BNB_MONAD_DEFAULT_REFERENCE);
  const refused = await world.cli(prepareArgs(lane, "relay-004-legacy-0001"));
  assert.equal(refused.ok, false); assert.equal(refused.error?.code, "APN_ALLOWLIST_REFUSED");
  assert.equal(world.quoteRequests.length, 0);
  await admit(world, lane);
  const prepared = await world.cli(prepareArgs(lane, "relay-004-legacy-0002"));
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  assert.equal((prepared.operation as any).nativeQuote.routeReference, RELAY_BNB_MONAD_ROUTE_REFERENCE);
});

test("OD-1: a recipient pin that does not list the caller's recipient refuses before any quote or signature", async t => {
  const lane = { ...LANES.find(candidate => candidate.qa === "RELAY-006")!, recipients: [QA_PAYER] };
  const world = await qaWorld(t, lane.quote);
  await importPayer(world, lane.profile);
  await admit(world, lane);
  const refused = await world.cli(prepareArgs(lane, "relay-006-pin-0001"));
  assert.equal(refused.ok, false); assert.equal(refused.error?.code, "APN_ALLOWLIST_REFUSED");
  assert.equal(world.quoteRequests.length, 0);
});
