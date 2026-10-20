import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { request as httpsRequest } from "node:https";
import test from "node:test";
import * as cliRuntime from "../../src/cli.js";
import { ApnError } from "../../src/errors.js";
import { HttpsX402Http, observePaidX402Response } from "../../src/x402-http.js";
import type { HttpGetRequest, HttpObservation } from "../../src/x402-model.js";
import { validateX402Operation } from "../../src/x402-state-integrity.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";
import { admitAsset, assetFixture, type AssetCase } from "./x402-any-asset-helpers.js";
import { paidObservation } from "./x402-helpers.js";
import { PAY_ARGS, SolanaSeller, feePayerAddress, readySolanaFixture, solanaOffer } from "./x402-solana-helpers.js";
import { X402_TRANSACTION, X402_URL, canonicalPaymentResponseHeader, canonicalPaymentSignatureHeader } from "./x402-vectors.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const BASE_USDC: AssetCase = { label: "Base USDC", chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2", decimals: 6 };
const BODY = '{"country":"US"}';

/** A paid 200 whose PAYMENT-RESPONSE comes as several copies (the shape a Saylor seller answered with), exactly as given. */
function paidWithCopies(copies: readonly (readonly [string, string])[]): HttpObservation {
  const now = new Date().toISOString();
  return paidObservation({ startedAt: now, observedAt: now, rawHeaderPairs: [["Content-Type", "application/json"],
    ["Content-Length", Buffer.byteLength(BODY).toString()], ...copies], bodyText: BODY });
}

async function evmPaid(context: test.TestContext, copies: (header: string) => readonly (readonly [string, string])[]) {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, BASE_USDC); await admitAsset(fixture, BASE_USDC);
  const prepared = await fixture.core.execute({ command: "x402.fetch.prepare", profile: "default", chainId: 8453, asset: BASE_USDC.token,
    url: X402_URL, idempotencyKey: "response-copies-0001" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = (prepared.operation as { operationId: string }).operationId;
  assert.equal((await fixture.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  const frozen = (await fixture.state.findX402Operation(operationId))!;
  const header = canonicalPaymentResponseHeader({ success: true, transaction: X402_TRANSACTION, network: "eip155:8453", payer: frozen.wallet, amount: frozen.amountAtomic });
  fixture.http.outcomes.push(paidWithCopies(copies(header)));
  const paid = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal(paid.ok, true, JSON.stringify(paid));
  return { fixture, operationId, paid };
}

test("byte-identical PAYMENT-RESPONSE copies (primary and X- alias) count as one settlement hint; the body is kept", async (context) => {
  const { fixture, operationId, paid } = await evmPaid(context, (header) => [["PAYMENT-RESPONSE", header], ["X-PAYMENT-RESPONSE", header]]);
  const operation = validateX402Operation((await fixture.state.findX402Operation(operationId))!);
  assert.equal(operation.state, "settlement_pending");
  assert.equal(operation.transactionHint?.transactionHash, X402_TRANSACTION);
  assert.deepEqual((paid.data as { body: unknown }).body, { country: "US" });
  fixture.rpc.authorizationStateValue = true;
  const completed = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((completed.operation as { state: string }).state, "completed", JSON.stringify(completed));
});

type Copies = (header: string) => readonly (readonly [string, string])[];
for (const [label, copies] of [
  ["copies that differ", (header) => [["PAYMENT-RESPONSE", header], ["X-PAYMENT-RESPONSE", canonicalPaymentResponseHeader({ success: true,
    transaction: `0x${"d".repeat(64)}`, network: "eip155:8453" })]]],
  ["two primary headers that differ", (header) => [["PAYMENT-RESPONSE", header], ["payment-response", `${header.slice(0, -4)}AAAA`]]],
  ["a folded value", (header) => [["PAYMENT-RESPONSE", `${header},${header}`]]],
] as const satisfies readonly (readonly [string, Copies])[]) test(`a paid EVM response with ${label} is no settlement hint, yet its body is kept and the chain completes the purchase without a resend`, async (context) => {
  const { fixture, operationId, paid } = await evmPaid(context, copies);
  const operation = validateX402Operation((await fixture.state.findX402Operation(operationId))!);
  assert.equal(operation.state, "effect_unknown");
  assert.equal(operation.attempts[0]?.phase, "observed");
  assert.equal(operation.attempts[0]?.observation?.paymentResponseHeaderHash, undefined);
  assert.equal(operation.settlementResponseObservation, undefined); assert.equal(operation.transactionHint, undefined);
  assert.notEqual(operation.resultLink, undefined, "a paid service is never lost because of a malformed header");
  assert.deepEqual((paid.data as { body: unknown }).body, { country: "US" });
  // The nonce still reads unused: nothing is resent once a body is kept.
  await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal(fixture.http.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
  fixture.rpc.authorizationStateValue = true;
  const completed = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((completed.operation as { state: string }).state, "completed", JSON.stringify(completed));
  assert.deepEqual((completed.data as { body: unknown }).body, { country: "US" });
  const receipt = await fixture.core.execute({ command: "receipt.get", operationId });
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal((receipt.receipt as { result?: { mediaType: string } }).result?.mediaType, "application/json");
  assert.equal(fixture.http.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
  assert.equal(fixture.rpc.submissions.length, 0);
});

/** A Solana seller answering its paid request like Saylor did: the settlement hint as several PAYMENT-RESPONSE copies. */
class CopiesSeller extends SolanaSeller {
  copies: (header: string) => readonly (readonly [string, string])[] = (header) => [["PAYMENT-RESPONSE", header], ["X-PAYMENT-RESPONSE", header]];
  override async get(request: HttpGetRequest): Promise<HttpObservation> {
    const answer = await super.get(request);
    if (request.paymentSignature === undefined) return answer;
    const header = answer.rawHeaderPairs.find(([name]) => name === "PAYMENT-RESPONSE")![1];
    return paidWithCopies(this.copies(header));
  }
}
type SolanaStatus = { readonly operation_id: string; readonly state: string; readonly settlement: { readonly source: string } | null;
  readonly seller_response: { readonly settlement_hint: string | null; readonly result: { readonly body: string } | null } | null };

for (const differ of [false, true]) test(`a Saylor-shaped Solana payment with ${differ ? "differing" : "identical"} PAYMENT-RESPONSE copies keeps the paid body and settles on chain`, async (context) => {
  const f = await readySolanaFixture(context, runCli);
  const seller = new CopiesSeller(f.rpc);
  seller.offers = [solanaOffer(await feePayerAddress(), { extra: { feePayer: await feePayerAddress(), memo: "saylor:utility:country:US" } })];
  if (differ) seller.copies = (header) => [["PAYMENT-RESPONSE", header], ["X-PAYMENT-RESPONSE", Buffer.from("{}").toString("base64")]];
  const options = { ...f.options, http: seller };
  const paid = await runCli([...PAY_ARGS, "--idempotency-key", `saylor-copies-${String(differ)}`], {}, options as never);
  assert.equal(paid.ok, true, JSON.stringify(paid));
  const status = paid.data as SolanaStatus;
  assert.equal(status.state, "exposed");
  assert.equal(status.seller_response?.result?.body, BODY, "the purchased body is in the record");
  assert.equal(status.seller_response?.settlement_hint === null, differ);
  const observed = await runCli(["x402", "solana", "observe", "--operation", status.operation_id], {}, options as never);
  const settled = observed.data as SolanaStatus;
  assert.equal(settled.state, "settled", JSON.stringify(observed));
  assert.equal(settled.settlement?.source, differ ? "signature_index" : "payment_response");
  assert.equal(settled.seller_response?.result?.body, BODY);
  assert.equal(seller.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
});

test("the production transport reads a paid response whole despite differing PAYMENT-RESPONSE copies, but a challenge read stays strict", async () => {
  const answer = (rawHeaders: string[]) => ((_endpoint: URL, _options: unknown, callback: (response: IncomingMessage) => void) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    const response = new EventEmitter() as EventEmitter & { statusCode: number; rawHeaders: string[]; rawTrailers: string[];
      socket: { authorized: boolean; remoteAddress: string }; destroy: () => void };
    Object.assign(response, { statusCode: rawHeaders.includes("PAYMENT-REQUIRED") ? 402 : 200, rawHeaders, rawTrailers: [],
      socket: { authorized: true, remoteAddress: "1.1.1.1" }, destroy: () => undefined });
    request.destroy = () => undefined;
    request.end = () => { callback(response as unknown as IncomingMessage); response.emit("data", Buffer.from(BODY)); response.emit("end"); };
    return request;
  }) as unknown as typeof httpsRequest;
  const http = (rawHeaders: string[]): HttpsX402Http => {
    const adapter = new HttpsX402Http();
    Object.assign(adapter as unknown as Record<string, unknown>, { request: answer(rawHeaders), resolveAddresses: async () => [{ address: "1.1.1.1", family: 4 }] });
    return adapter;
  };
  const copies = ["content-type", "application/json", "PAYMENT-RESPONSE", "eyJhIjoxfQ==", "X-PAYMENT-RESPONSE", "eyJiIjoyfQ=="];
  const raw = await http(copies).get({ url: X402_URL, paymentSignature: canonicalPaymentSignatureHeader() });
  const paid = observePaidX402Response(raw, { attemptNumber: "1", purpose: "payment", canonicalUrl: X402_URL, targetHash: "0".repeat(64), origin: new URL(X402_URL).origin });
  assert.equal(paid.paymentResponseHeader, undefined);
  assert.equal(paid.result?.bodyText, BODY);
  await assert.rejects(http(["PAYMENT-REQUIRED", "e30=", ...copies.slice(2)]).get({ url: X402_URL }),
    (error: unknown) => error instanceof ApnError && error.code === "APN_HTTP_PROTOCOL");
});
