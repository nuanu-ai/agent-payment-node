import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { x402Asset } from "../../src/x402-network.js";
import assert from "node:assert/strict";
import test from "node:test";
import { recoverTypedDataAddress } from "viem";
import * as cliRuntime from "../../src/cli.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { decodePaymentSignatureHeader } from "../../src/x402-codec.js";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { validateUnusedExpiryEvidence } from "../../src/x402-evidence-validation.js";
import { x402Eip2612TypedData, x402Permit2TypedData } from "../../src/x402-permit2-exact.js";
import { x402Permit2Terms } from "../../src/x402-permit2-native.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY } from "../../src/x402-permit2/registry.js";
import { validateX402Operation } from "../../src/x402-state-integrity.js";
import { tokenDomainSeparator } from "../../src/x402-policy.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";
import { networkPaid } from "./evm-x402-helpers.js";
import { challengeObservation } from "./x402-helpers.js";
import { ASSET_CASES, ASSET_LIMITS, admitAsset, assetFixture, type AssetCase } from "./x402-any-asset-helpers.js";
import { X402_PAYMENT_REQUIRED, X402_REQUIREMENTS, X402_URL, canonicalPaymentRequiredHeader, paymentIdentifierDeclaration } from "./x402-vectors.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const BASE_USDC: AssetCase = { label: "Base USDC", chainId: 8453, token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2", decimals: 6 };
const WORLD = ASSET_CASES.find((spec) => spec.chainId === 480)!;
const SPONSORING = { info: { description: "EIP-2612 gas sponsoring", version: "1" }, schema: { $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object", properties: Object.fromEntries(["from", "asset", "spender", "amount", "nonce", "deadline", "signature", "version"]
    .map((name) => [name, { type: "string", pattern: ".*" }])),
  required: ["from", "asset", "spender", "amount", "nonce", "deadline", "signature", "version"] } };

/** The catalog's common Base shape: the seller takes the token only through Permit2 (optionally also by EIP-3009 first). */
function permit2Challenge(spec: AssetCase, options: { readonly eip3009First?: boolean; readonly sponsor?: boolean; readonly identifier?: boolean; readonly hints?: boolean } = {}) {
  const base = { ...X402_REQUIREMENTS, network: `eip155:${spec.chainId}`, asset: spec.token, maxTimeoutSeconds: 300 };
  return challengeObservation({ header: canonicalPaymentRequiredHeader({ ...X402_PAYMENT_REQUIRED,
    accepts: [...(options.eip3009First ? [{ ...base, extra: { name: spec.name, version: spec.version } }] : []),
      { ...base, extra: { assetTransferMethod: "permit2", ...(options.hints === false ? {} : { name: spec.name, version: spec.version }) } }],
    ...(options.sponsor || options.identifier ? { extensions: { ...(options.sponsor ? { eip2612GasSponsoring: SPONSORING } : {}),
      ...(options.identifier ? { "payment-identifier": paymentIdentifierDeclaration(true) } : {}) } } : {}) } as never) });
}
const request = (spec: AssetCase, key = "permit2-fetch-0001") => ({ command: "x402.fetch.prepare" as const, profile: "default", chainId: spec.chainId,
  asset: spec.token, url: X402_URL, idempotencyKey: key });
const operationOf = (envelope: OutputEnvelope) => (envelope.operation as { operationId: string }).operationId;

for (const spec of [BASE_USDC, WORLD]) test(`${spec.label} offered only through Permit2 pays unattended under the profile x402 policy, proven by the nonce bit`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, spec); await admitAsset(fixture, spec);
  fixture.http.outcomes[0] = permit2Challenge(spec);
  const prepared = await fixture.core.execute(request(spec));
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = operationOf(prepared), frozen = (await fixture.state.findX402Operation(operationId))!;
  assert.deepEqual(frozen.selectedOffer.resolved, { assetTransferMethod: "permit2", paymentFlow: "permit2WitnessTransfer", eip2612: null });
  assert.deepEqual(fixture.rpc.probedNonces, [frozen.authorization.nonce]); assert.equal(fixture.rpc.permit2.permitReads, 0);
  assert.equal((await fixture.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  assert.deepEqual(fixture.nativeCalls.map((call) => call.operation).filter((operation) => operation.startsWith("x402")), ["x402Permit2.approveAndAuthorize"]);
  fixture.http.outcomes.push(networkPaid(frozen));
  assert.equal((await fixture.core.execute({ command: "operation.resume", operationId })).ok, true);
  const paid = fixture.http.calls.filter((call) => call.paymentSignature !== undefined);
  assert.equal(paid.length, 1);
  const payload = decodePaymentSignatureHeader(paid[0]!.paymentSignature!) as unknown as { payload: { signature: `0x${string}`; permit2Authorization: Record<string, unknown> }; extensions?: unknown };
  const authorization = payload.payload.permit2Authorization as { spender: string; nonce: string; deadline: string; permitted: { token: string; amount: string }; witness: { to: string } };
  assert.equal(authorization.spender, X402_EXACT_PERMIT2_PROXY); assert.equal(authorization.nonce, BigInt(frozen.authorization.nonce).toString());
  assert.equal(authorization.deadline, frozen.authorization.validBefore); assert.equal(authorization.permitted.token.toLowerCase(), frozen.token);
  assert.equal(authorization.witness.to.toLowerCase(), frozen.payee); assert.equal(payload.extensions, undefined);
  const signer = await recoverTypedDataAddress({ ...x402Permit2TypedData(x402Permit2Terms(frozen)), signature: payload.payload.signature } as never);
  assert.equal(signer.toLowerCase(), frozen.wallet);
  fixture.rpc.permit2.used = true;
  const completed = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((completed.operation as { state: string }).state, "completed", JSON.stringify(completed));
  const stored = validateX402Operation((await fixture.state.findX402Operation(operationId))!);
  assert.equal((stored.settlementEvidence as { authorizationState: { blockTag: string } }).authorizationState.blockTag, "safe", "OP Stack and Base prove at safe");
  assert.ok(fixture.rpc.x402Calls.includes("permit2:safe"));
  const receipt = await fixture.core.execute({ command: "receipt.get", operationId });
  assert.equal(receipt.ok, true, JSON.stringify(receipt)); assert.ok(JSON.stringify(receipt).includes('"transferMethod":"permit2"'));
  await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal(fixture.http.calls.length, 2);
});

test("a seller offering both methods is paid by EIP-3009, never by Permit2", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, BASE_USDC); await admitAsset(fixture, BASE_USDC);
  fixture.http.outcomes[0] = permit2Challenge(BASE_USDC, { eip3009First: true });
  const prepared = await fixture.core.execute(request(BASE_USDC));
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal((await fixture.state.findX402Operation(operationOf(prepared)))!.selectedOffer.resolved.assetTransferMethod, "eip3009");
  assert.equal(fixture.rpc.permit2.permitReads, 0);
});

test("a short allowance is paid only through the seller's sponsored exact-amount permit to Permit2, proven against the token domain", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, BASE_USDC); await admitAsset(fixture, BASE_USDC);
  fixture.rpc.permit2.allowanceAtomic = "0";
  fixture.rpc.permit2.permit = { domainSeparator: tokenDomainSeparator("USD Coin", "2", x402Asset(8453)), nonce: "9" };
  fixture.http.outcomes[0] = permit2Challenge(BASE_USDC, { sponsor: true });
  const prepared = await fixture.core.execute(request(BASE_USDC));
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = operationOf(prepared), frozen = (await fixture.state.findX402Operation(operationId))!;
  assert.deepEqual(frozen.selectedOffer.resolved, { assetTransferMethod: "permit2", paymentFlow: "permit2WitnessTransfer",
    eip2612: { tokenName: "USD Coin", tokenVersion: "2", nonce: "9" } });
  assert.equal((await fixture.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  fixture.http.outcomes.push(networkPaid(frozen));
  await fixture.core.execute({ command: "operation.resume", operationId });
  const header = fixture.http.calls.find((call) => call.paymentSignature !== undefined)!.paymentSignature!;
  const info = (decodePaymentSignatureHeader(header) as unknown as { extensions: { eip2612GasSponsoring: { info: Record<string, string> } } }).extensions.eip2612GasSponsoring.info;
  assert.equal(info.spender, PERMIT2_ADDRESS); assert.equal(info.amount, frozen.amountAtomic); assert.equal(info.nonce, "9");
  const permitSigner = await recoverTypedDataAddress({ ...x402Eip2612TypedData(x402Permit2Terms(frozen), { name: "USD Coin", version: "2", nonce: "9" }),
    signature: info.signature as `0x${string}` } as never);
  assert.equal(permitSigner.toLowerCase(), frozen.wallet);
});

for (const [label, change, reason] of [
  ["no sponsorship", (fixture: ReturnType<typeof assetFixture>) => { fixture.rpc.permit2.allowanceAtomic = "0"; fixture.http.outcomes[0] = permit2Challenge(BASE_USDC); }, "x402_permit2_allowance_required"],
  ["a wrong token domain", (fixture: ReturnType<typeof assetFixture>) => { fixture.rpc.permit2.allowanceAtomic = "0"; fixture.http.outcomes[0] = permit2Challenge(BASE_USDC, { sponsor: true }); }, "x402_permit2_allowance_required"],
  ["a required payment identifier", (fixture: ReturnType<typeof assetFixture>) => { fixture.http.outcomes[0] = permit2Challenge(BASE_USDC, { identifier: true }); }, "x402_permit2_payment_identifier_required"],
] as const) test(`a Permit2 offer with ${label} is refused before anything is signed`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, BASE_USDC); await admitAsset(fixture, BASE_USDC);
  change(fixture);
  const refused = await fixture.core.execute(request(BASE_USDC));
  assert.equal(refused.error?.details?.reason, reason, JSON.stringify(refused));
  // A short allowance names the owner's foreground command for exactly this chain and token.
  if (reason === "x402_permit2_allowance_required") {
    assert.match(refused.next_actions[0] ?? "", new RegExp(`^apn x402 permit2 allowance set --profile default --chain eip155:8453 --asset ${BASE_USDC.token} `, "u"));
  }
  assert.equal(fixture.nativeCalls.some((call) => call.operation.startsWith("x402")), false);
});

test("an authorized Permit2 payment never sent ends failed_expired_unused once the finalized deadline passes with the nonce unused", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, BASE_USDC); await admitAsset(fixture, BASE_USDC);
  fixture.http.outcomes[0] = permit2Challenge(BASE_USDC);
  const operationId = operationOf(await fixture.core.execute(request(BASE_USDC)));
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  fixture.clock.advance(310000);
  const observedAt = fixture.clock.now().toISOString(), timestamp = Math.floor(fixture.clock.now().getTime() / 1000).toString();
  fixture.rpc.finalizedHead = { ...fixture.rpc.finalizedHead, number: "12346", hash: `0x${"d".repeat(64)}`, observedAt, timestamp };
  const expired = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((expired.operation as { state: string }).state, "failed_expired_unused", JSON.stringify(expired));
  assert.ok(fixture.rpc.x402Calls.includes("permit2:finalized")); assert.equal(fixture.http.calls.length, 1);
});

test("a finalized block stamped exactly at the Permit2 deadline does not prove expiry; the next second does", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, BASE_USDC); await admitAsset(fixture, BASE_USDC);
  fixture.http.outcomes[0] = permit2Challenge(BASE_USDC);
  const operationId = operationOf(await fixture.core.execute(request(BASE_USDC)));
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  const deadline = BigInt((await fixture.state.findX402Operation(operationId))!.authorization.validBefore);
  fixture.clock.advance(310000);
  const observedAt = fixture.clock.now().toISOString();
  // Permit2 reverts only when block.timestamp > deadline: a block at the deadline can still settle the witness transfer.
  fixture.rpc.finalizedHead = { ...fixture.rpc.finalizedHead, number: "12346", hash: `0x${"d".repeat(64)}`, observedAt, timestamp: deadline.toString() };
  const atDeadline = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.notEqual((atDeadline.operation as { state: string } | null)?.state, "failed_expired_unused", JSON.stringify(atDeadline));
  assert.equal((await fixture.state.findX402Operation(operationId))!.unusedExpiryEvidence, undefined);
  fixture.rpc.finalizedHead = { ...fixture.rpc.finalizedHead, number: "12347", hash: `0x${"e".repeat(64)}`, observedAt, timestamp: (deadline + 1n).toString() };
  const past = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((past.operation as { state: string }).state, "failed_expired_unused", JSON.stringify(past));
  // The validator holds stored evidence to the same rule: a Permit2 head stamped at the deadline proves nothing.
  const expired = (await fixture.state.findX402Operation(operationId))!, evidence = expired.unusedExpiryEvidence as unknown as Record<string, unknown>;
  const { evidenceHash: _hash, ...body } = { ...evidence, finalizedHead: { ...(evidence.finalizedHead as object), timestamp: deadline.toString() } } as Record<string, unknown>;
  assert.throws(() => validateUnusedExpiryEvidence({ ...body, evidenceHash: domainHash("apn.x402.unused-expiry-evidence.v2", canonicalJson(body)) },
    expired as unknown as Record<string, unknown>), /not past the authorization's last executable second/u);
});

test("CLI and MCP prepare, approve and settle the same unattended Permit2 operation", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, BASE_USDC); await fixture.core.wallet.ensure("default");
  await fixture.core.wallet.policySet({ command: "wallet.policy.set", profile: "default", ...ASSET_LIMITS });
  fixture.http.outcomes[0] = permit2Challenge(BASE_USDC);
  const options = { stateRoot: temporary.root, wrappingSecret: fixture.wrapping, rpc: fixture.rpc, http: fixture.http, clock: fixture.clock };
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "apn-permit2-parity", version: "1.0.0" }); await client.connect(clientTransport);
  context.after(async () => { await client.close(); await server.close(); });
  const invoke = async (name: string, input: Record<string, string>) => (await client.callTool({ name, arguments: input })).structuredContent as unknown as OutputEnvelope;
  const input = { profile: "default", url: X402_URL, idempotency_key: "permit2-parity-0001", rpc_url: "https://rpc.example" };
  const prepared = await invoke("apn_x402_fetch_prepare", input);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = operationOf(prepared);
  const replay = await runCli(["x402", "fetch", "prepare", ...Object.entries(input).flatMap(([key, value]) => [`--${key.replaceAll("_", "-")}`, value])], {}, options);
  assert.deepEqual(replay.operation, prepared.operation);
  const approved = await invoke("apn_x402_fetch_approve", { operation: operationId, rpc_url: input.rpc_url });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const frozen = (await fixture.state.findX402Operation(operationId))!;
  assert.equal(frozen.selectedOffer.resolved.assetTransferMethod, "permit2");
  fixture.http.outcomes.push(networkPaid(frozen));
  await runCli(["operation", "resume", "--operation", operationId, "--rpc-url", input.rpc_url], {}, options);
  fixture.rpc.permit2.used = true;
  const completed = await invoke("apn_operation_resume", { operation: operationId, rpc_url: input.rpc_url });
  assert.equal((completed.operation as { state: string }).state, "completed", JSON.stringify(completed));
  assert.equal(fixture.http.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
});
