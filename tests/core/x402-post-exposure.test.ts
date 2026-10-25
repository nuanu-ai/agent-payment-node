import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import assert from "node:assert/strict";
import test from "node:test";
import * as cliRuntime from "../../src/cli.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import * as errorRuntime from "../../src/errors.js";
import type { HttpGetRequest, HttpObservation } from "../../src/x402-model.js";
import { X402SolanaRepository } from "../../src/x402-solana/repository.js";
import { validateX402Operation } from "../../src/x402-state-integrity.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";
import { admitAsset, assetFixture, type AssetCase } from "./x402-any-asset-helpers.js";
import { paidObservation } from "./x402-helpers.js";
import { PAY_ARGS, SolanaSeller, feePayerAddress, readySolanaFixture, solanaOffer } from "./x402-solana-helpers.js";
import { X402_URL } from "./x402-vectors.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const { ApnError } = await testRuntime(errorRuntime, "errors.js");
const BASE_USDC: AssetCase = { label: "Base USDC", chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2", decimals: 6 };

type Fault = "transport" | "echoed_signature" | "changed_target" | "http_500";
/** How a seller can fail its answer to the paid request, the shapes Saylor's country endpoint and others gave. */
function faulty(answer: HttpObservation, request: HttpGetRequest, fault: Fault): HttpObservation {
  if (fault === "transport") throw new ApnError("APN_HTTP_AMBIGUOUS", "Seller transport failed safely.");
  if (fault === "echoed_signature") return { ...answer, rawHeaderPairs: [...answer.rawHeaderPairs, ["PAYMENT-SIGNATURE", request.paymentSignature!]] };
  if (fault === "changed_target") return { ...answer, finalUrl: "https://elsewhere.example/resource" };
  return paidObservation({ status: 500, bodyText: '{"error":"internal"}', startedAt: answer.startedAt, observedAt: answer.observedAt });
}

/** A Saylor-shaped Solana seller whose facilitator lands the payment, then whose paid HTTP answer fails. */
class FailingSeller extends SolanaSeller {
  constructor(rpc: ConstructorParameters<typeof SolanaSeller>[0], private readonly fault: Fault) { super(rpc); }
  override async get(request: HttpGetRequest): Promise<HttpObservation> {
    const answer = await super.get(request);
    return request.paymentSignature === undefined ? answer : faulty(answer, request, this.fault);
  }
}
type SolanaView = { readonly operation_id: string; readonly state: string; readonly exposed_at: string | null; readonly next_actions: readonly string[];
  readonly settlement: { readonly source: string } | null };

for (const fault of ["transport", "echoed_signature", "changed_target", "http_500"] as const) test(`a Solana payment whose seller fails after exposure (${fault}) answers with the operation and its no-send observe, CLI and MCP alike`, async (context) => {
  const f = await readySolanaFixture(context, runCli);
  const seller = new FailingSeller(f.rpc, fault);
  seller.offers = [solanaOffer(await feePayerAddress(), { extra: { feePayer: await feePayerAddress(), memo: "saylor:utility:country:US" } })];
  const options = { ...f.options, http: seller };
  const server = createMcpServer(options as never);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "apn-solana-post-exposure", version: "1.0.0" }); await client.connect(clientTransport);
  context.after(async () => { await client.close(); await server.close(); });
  const paid = (await client.callTool({ name: "apn_x402_solana_pay", arguments: { profile: "default", url: X402_URL, asset: SOLANA_USDC,
    max_amount: "20000", idempotency_key: `post-exposure-${fault}` } })).structuredContent as unknown as OutputEnvelope;
  // A seller HTTP 500 is an answer, not a failure: the record keeps it. Every other fault keeps its own error.
  const view = (fault === "http_500" ? paid.data : paid.operation) as SolanaView;
  assert.equal(paid.ok, fault === "http_500", JSON.stringify(paid));
  if (fault !== "http_500") {
    assert.equal(paid.error?.code, fault === "transport" ? "APN_HTTP_AMBIGUOUS" : "APN_HTTP_PROTOCOL");
    assert.equal(paid.error?.details?.operation_id, view.operation_id); assert.equal(paid.error?.details?.state, "exposed");
    assert.equal(paid.error?.details?.exposed, true);
  }
  assert.equal(view.state, "exposed"); assert.notEqual(view.exposed_at, null);
  const observe = `apn x402 solana observe --operation ${view.operation_id}`;
  assert.equal(paid.next_actions[0], observe, "the first step is the no-send observation of this very payment");
  assert.deepEqual(paid.next_actions, view.next_actions);
  const record = (await new X402SolanaRepository(f.root).find(view.operation_id))!;
  assert.equal(JSON.stringify(paid).includes(record.signed!.rawPayload), false, "no signed bytes leave the record");
  // The same key never sends again, and the same id's observation proves the landed payment.
  const replay = await runCli([...PAY_ARGS, "--idempotency-key", `post-exposure-${fault}`], {}, options as never);
  assert.equal((replay.data as SolanaView).state, "exposed", JSON.stringify(replay));
  assert.equal(seller.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
  const observed = await runCli(["x402", "solana", "observe", "--operation", view.operation_id], {}, options as never);
  assert.equal((observed.data as SolanaView).state, "settled", JSON.stringify(observed));
  assert.equal((observed.data as SolanaView).settlement?.source, "signature_index");
  assert.equal(seller.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
});

test("a Solana refusal before anything is exposed claims no exposure", async (context) => {
  const f = await readySolanaFixture(context, runCli);
  f.rpc.simulateError = { InstructionError: [2n, { Custom: 1n }] };
  const refused = await runCli([...PAY_ARGS, "--idempotency-key", "post-exposure-none"], {}, f.options);
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.notEqual(refused.error?.details?.exposed, true);
  assert.equal(f.seller.calls.filter((call) => call.paymentSignature !== undefined).length, 0);
});

for (const fault of ["transport", "echoed_signature", "changed_target", "http_500"] as const) test(`an EVM x402 payment whose seller fails after its header is sent (${fault}) answers with the operation; nothing is signed again`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, BASE_USDC); await admitAsset(fixture, BASE_USDC);
  const prepared = await fixture.core.execute({ command: "x402.fetch.prepare", profile: "default", chainId: 8453, asset: BASE_USDC.token,
    url: X402_URL, idempotencyKey: `evm-post-exposure-${fault}` });
  const operationId = (prepared.operation as { operationId: string }).operationId;
  assert.equal((await fixture.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  const answer = paidObservation({ startedAt: new Date().toISOString(), observedAt: new Date().toISOString() });
  fixture.http.outcomes.push(fault === "transport" ? new ApnError("APN_HTTP_AMBIGUOUS", "Seller transport failed safely.")
    : faulty(answer, { url: X402_URL, paymentSignature: "c2lnbmF0dXJl" }, fault));
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const view = resumed.operation as { operationId: string; state: string; nextActions: readonly string[] };
  assert.equal(view.operationId, operationId); assert.equal(view.state, "effect_unknown");
  assert.deepEqual(resumed.next_actions, ["operation.resume", "operation.status"]);
  const stored = validateX402Operation((await fixture.state.findX402Operation(operationId))!);
  assert.equal(stored.attempts.length, 1); assert.equal(stored.attempts[0]?.purpose, "payment");
  // The only later send is the same signed header once, while the nonce still reads unused; then the nonce decides.
  fixture.http.outcomes.push(paidObservation({ startedAt: new Date().toISOString(), observedAt: new Date().toISOString() }));
  await fixture.core.execute({ command: "operation.resume", operationId });
  const sent = fixture.http.calls.filter((call) => call.paymentSignature !== undefined);
  assert.ok(sent.length <= 2); assert.equal(new Set(sent.map((call) => call.paymentSignature)).size, 1, "byte-identical, never a new authorization");
  assert.equal(fixture.nativeCalls.filter((call) => call.operation.includes("approveAndAuthorize")).length, 1);
  fixture.rpc.authorizationStateValue = true;
  const settled = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((settled.operation as { terminal: boolean }).terminal, true, JSON.stringify(settled));
  assert.equal(fixture.http.calls.filter((call) => call.paymentSignature !== undefined).length, sent.length);
});
