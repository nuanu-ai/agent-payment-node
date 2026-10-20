/** QA 0.5.51 CIRCLE-POST-BURN-ERROR-STATE-001, Relay instance (996ac8e2…, Base ETH -> Polygon POL): `relay execute` sent the
 * deposit once, then a source read failed ("EVM RPC returned malformed bytes.") and the command answered a bare error with
 * no journal. Through the installed command path with a simulated chain: the same call answers with the journal (hash,
 * submitting, the observe step) and names the failed read; the next execute only observes and the deposit is sent once. */
import assert from "node:assert/strict";
import test from "node:test";
import { ApnError } from "../../src/errors.js";
import { RELAY_BASE_POLYGON_ROUTE_REFERENCE } from "../../src/relay/native-quote.js";
import { QA_PAYER, QA_RECIPIENT, SimChain, admitBridge, consent, importPayer, qaWorld } from "./relay-any-profile-harness.js";

const PROFILE = "relay-qa-base-polygon-post-send", AMOUNT = "60000000000000";

async function preparedLane(t: test.TestContext) {
  const world = await qaWorld(t, "base-native-polygon-native");
  await importPayer(world, PROFILE);
  await admitBridge(world, PROFILE, { chain: "eip155:8453", asset: null, reference: RELAY_BASE_POLYGON_ROUTE_REFERENCE,
    maximumPerTransferAtomic: AMOUNT, dailyLimitAtomic: (BigInt(AMOUNT) * 2n).toString() });
  const prepared = await world.cli(["relay", "prepare", "--profile", PROFILE, "--source-chain", "eip155:8453", "--asset", "native",
    "--destination-chain", "eip155:137", "--recipient", QA_RECIPIENT, "--amount-atomic", AMOUNT, "--min-output-atomic", "1000000000000000000",
    "--max-deposit-network-fee-wei", "1500000000000", "--idempotency-key", "relay-post-send-0001"]);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const op = prepared.operation as { operationId: string; quoteDigest: string };
  const source = new SimChain(8453).fund(QA_PAYER, 10n ** 18n);
  const execute = ["relay", "execute", "--profile", PROFILE, "--operation", op.operationId, "--rpc-url", "https://mainnet.base.org"];
  return { world, op, source, execute };
}

test("a deposit sent before a source read fails answers with its journal and the observe step; the next execute only observes", async (t) => {
  const f = await preparedLane(t); let failed = 0;
  const transport = { submitRawTransaction: (...args: Parameters<SimChain["submitRawTransaction"]>) => f.source.submitRawTransaction(...args),
    batchCall: async (calls: Parameters<SimChain["batchCall"]>[0]) => {
      if (f.source.sent.length > 0 && failed++ === 0) throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC returned malformed bytes.");
      return await f.source.batchCall(calls);
    } };
  const sent = await f.world.cli(f.execute, { relayExecuteTransport: transport, ...consent(f.op.operationId, f.op.quoteDigest) });
  assert.equal(sent.ok, true, JSON.stringify(sent.error));
  const journal = sent.data as { operationId: string; phase: string; transactionHash: string; observationFailure?: unknown; requestId?: unknown };
  assert.deepEqual([journal.operationId, journal.phase, journal.observationFailure], [f.op.operationId, "submitting",
    { code: "APN_RPC_PROTOCOL", reason: null, httpStatus: null }]);
  assert.match(journal.transactionHash, /^0x[a-f0-9]{64}$/u); assert.equal("requestId" in journal, false);
  assert.ok(sent.next_actions.some((action) => action.startsWith(`apn relay observe --profile ${PROFILE} --operation ${f.op.operationId}`)));
  assert.equal(f.source.sent.length, 1);

  f.source.mine();
  const confirmed = await f.world.cli(f.execute, { relayExecuteTransport: f.source });
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed.error));
  assert.deepEqual([(confirmed.data as { phase: string }).phase, (confirmed.data as { transactionHash: string }).transactionHash], ["confirmed", journal.transactionHash]);
  assert.equal("observationFailure" in (confirmed.data as object), false);
  assert.equal(f.source.sent.length, 1, "one send only");
});

test("a source read failing before anything is signed still answers as a bare refusal", async (t) => {
  const f = await preparedLane(t);
  const transport = { submitRawTransaction: async () => { throw new Error("unexpected send"); },
    batchCall: async () => { throw new ApnError("APN_RPC_PROTOCOL", "EVM RPC returned malformed bytes."); } };
  const refused = await f.world.cli(f.execute, { relayExecuteTransport: transport, ...consent(f.op.operationId, f.op.quoteDigest) });
  assert.equal(refused.ok, false); assert.equal(refused.data, null); assert.equal(f.source.sent.length, 0);
});
