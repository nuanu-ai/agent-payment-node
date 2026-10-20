import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import assert from "node:assert/strict";
import test from "node:test";
import * as cliRuntime from "../../src/cli.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { decodePaymentSignatureHeader } from "../../src/x402-codec.js";
import { validateX402Operation } from "../../src/x402-state-integrity.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";
import { networkPaid } from "./evm-x402-helpers.js";
import { ASSET_CASES, ASSET_LIMITS, admitAsset, assetChallenge, assetFixture, assetSettlement, type AssetCase } from "./x402-any-asset-helpers.js";
import { X402_URL } from "./x402-vectors.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const request = (spec: AssetCase) => ({ command: "x402.fetch.prepare" as const, profile: "default", chainId: spec.chainId, asset: spec.token,
  url: X402_URL, idempotencyKey: "any-asset-synthetic" });
const operationOf = (envelope: OutputEnvelope) => (envelope.operation as { operationId: string }).operationId;

for (const spec of ASSET_CASES) {
  test(`${spec.label}: an owner-admitted chain+token pays end to end, proven at its frozen proof tag`, async (context) => {
    const temporary = await temporaryState(); context.after(temporary.cleanup);
    const fixture = assetFixture(temporary.root, spec); await admitAsset(fixture, spec);
    assert.deepEqual(fixture.policyApprovals[0]?.x402Network, { chainId: spec.chainId, token: spec.token });
    const prepared = await fixture.core.execute(request(spec));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operationId = operationOf(prepared);
    const frozen = (await fixture.state.findX402Operation(operationId))!;
    assert.equal(frozen.network, `eip155:${spec.chainId}`); assert.equal(frozen.token, spec.token.toLowerCase());
    assert.deepEqual(frozen.tokenFacts, { decimals: spec.decimals, proofTag: fixture.asset.proofTag });
    assert.equal(fixture.asset.proofTag, [8453, 1, 42161].includes(spec.chainId) ? "safe" : "finalized");
    // The token the RPC was bound to and the nonce prepare probed are this asset's and this authorization's.
    assert.deepEqual(fixture.rpc.boundTokens, [spec.token]);
    assert.deepEqual(fixture.rpc.probedNonces, [frozen.authorization.nonce]);
    assert.deepEqual((await fixture.core.execute(request(spec))).operation, prepared.operation);
    // Another token under the same key is another request.
    const other = await fixture.core.execute({ ...request(spec), asset: "0x00000000000000000000000000000000000000aa" });
    assert.equal(other.error?.code, "APN_IDEMPOTENCY_CONFLICT", JSON.stringify(other));
    assert.equal((await fixture.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
    const signing = fixture.nativeCalls.filter((call) => call.operation === "x402Exact.approveAndAuthorize");
    assert.equal(signing.length, 1);
    assert.equal(signing[0]!.payload.chainId, String(spec.chainId)); assert.equal(signing[0]!.payload.token, spec.token.toLowerCase());
    fixture.http.outcomes.push(networkPaid(frozen));
    assert.equal((await fixture.core.execute({ command: "operation.resume", operationId })).ok, true);
    const paid = fixture.http.calls.filter((call) => call.paymentSignature !== undefined);
    assert.equal(paid.length, 1);
    const payload = decodePaymentSignatureHeader(paid[0]!.paymentSignature!);
    assert.equal(payload.accepted.network, `eip155:${spec.chainId}`); assert.equal(payload.accepted.asset.toLowerCase(), spec.token.toLowerCase());
    assetSettlement(fixture.rpc, frozen);
    const completed = await fixture.core.execute({ command: "operation.resume", operationId });
    assert.equal((completed.operation as { state: string }).state, "completed", JSON.stringify(completed));
    const stored = validateX402Operation((await fixture.state.findX402Operation(operationId))!);
    assert.equal(stored.settlementEvidence?.schemaVersion, "apn.x402.settlement-evidence.v2");
    assert.equal(stored.settlementEvidence?.authorizationState.blockTag, fixture.asset.proofTag);
    assert.equal(fixture.rpc.x402Calls.filter((call) => call === `state:${fixture.asset.proofTag}`).length >= 2, true);
    assert.equal(fixture.rpc.x402Calls.some((call) => call === `state:${fixture.asset.proofTag === "safe" ? "finalized" : "safe"}`), false);
    const receipt = await fixture.core.execute({ command: "receipt.get", operationId });
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    await fixture.core.execute({ command: "operation.resume", operationId });
    assert.equal(fixture.http.calls.length, 2);
  });
}

const POLYGON = ASSET_CASES[0]!;

test("a chain+token the owner did not admit is refused before any seller or RPC read", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, POLYGON); await admitAsset(fixture, POLYGON);
  const usdt = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
  const refused = await fixture.core.execute({ ...request(POLYGON), asset: usdt });
  assert.equal(refused.error?.code, "APN_WALLET_POLICY_REQUIRED", JSON.stringify(refused));
  assert.equal(fixture.http.calls.length, 0); assert.equal(fixture.rpc.x402PrepareCalls, 0);
  // Without --asset only the released USDC spelling exists, and Polygon has none.
  const { asset: _asset, ...unnamedRequest } = request(POLYGON);
  const unnamed = await fixture.core.execute(unnamedRequest);
  assert.equal(unnamed.error?.code, "APN_INVALID_INPUT"); assert.equal(unnamed.error?.details?.reason, "x402_asset_required");
});

test("prepare refuses a token whose chain facts do not prove the offer's EIP-3009 identity", async (context) => {
  const cases: readonly [string, (fixture: ReturnType<typeof assetFixture>) => void, string, string][] = [
    ["domain", (f) => { f.rpc.x402Evidence = { ...f.rpc.x402Evidence, domainSeparator: `0x${"f".repeat(64)}` }; }, "APN_X402_UNSUPPORTED_OFFER", "x402_token_domain_mismatch"],
    ["decimals", (f) => { f.http.outcomes[0] = assetChallenge(POLYGON, { decimals: 18 }); }, "APN_X402_UNSUPPORTED_OFFER", "x402_token_decimals_mismatch"],
    ["facts", (f) => { f.rpc.tokenFacts = undefined; }, "APN_RPC_PROTOCOL", ""],
    ["tag", (f) => { f.rpc.x402Evidence = { ...f.rpc.x402Evidence, queriedTag: "safe" }; }, "APN_RPC_PROTOCOL", ""],
  ];
  for (const [label, change, code, reason] of cases) {
    const temporary = await temporaryState(); context.after(temporary.cleanup);
    const fixture = assetFixture(temporary.root, POLYGON); await admitAsset(fixture, POLYGON);
    change(fixture);
    const refused = await fixture.core.execute(request(POLYGON));
    assert.equal(refused.error?.code, code, `${label}: ${JSON.stringify(refused)}`);
    if (reason !== "") assert.equal(refused.error?.details?.reason, reason, label);
    assert.equal(fixture.nativeCalls.length > 0 && fixture.nativeCalls.some((call) => call.operation.includes("Authorize")), false, label);
  }
});

test("an asset offered only through Permit2 names the foreground Permit2 command; inspect lists what the seller offers", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, POLYGON); await admitAsset(fixture, POLYGON);
  fixture.http.outcomes[0] = assetChallenge(POLYGON, { assetTransferMethod: "permit2" });
  const refused = await fixture.core.execute(request(POLYGON));
  assert.equal(refused.error?.details?.reason, "x402_offer_permit2_only", JSON.stringify(refused));
  assert.match(refused.error?.message ?? "", /apn x402 permit2 approve/u);
  fixture.http.outcomes.push(assetChallenge(POLYGON));
  const inspected = await fixture.core.execute({ command: "x402.inspect", url: X402_URL, chainId: 137, asset: POLYGON.token });
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.equal((inspected.data as { candidates: { asset: string }[] }).candidates[0]?.asset, POLYGON.token.toLowerCase());
  fixture.http.outcomes.push(assetChallenge(POLYGON));
  const base = await fixture.core.execute({ command: "x402.inspect", url: X402_URL });
  assert.equal(base.error?.details?.reason, "x402_offer_asset_not_offered");
  assert.deepEqual(base.error?.details?.offered, [`eip155:137 ${POLYGON.token.toLowerCase()} eip3009`]);
});

test("a missing --rpc-url is refused naming the network the operation reads", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, POLYGON, { rpc: false }); await admitAsset(fixture, POLYGON);
  const refused = await fixture.core.execute(request(POLYGON));
  assert.equal(refused.error?.code, "APN_RPC_CONFIG"); assert.equal(refused.error?.details?.reason, "x402_rpc_required");
  assert.equal(refused.error?.details?.chain, "eip155:137");
});

test("stored records keep token facts exactly where their own chain and token call for them", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, POLYGON); await admitAsset(fixture, POLYGON);
  const operationId = operationOf(await fixture.core.execute(request(POLYGON)));
  const stored = (await fixture.state.findX402Operation(operationId))!;
  const { canonicalJson, domainHash } = await import("../../src/canonical.js");
  const reseal = (value: Record<string, unknown>) => {
    const { integrityHash: _hash, ...body } = value;
    return { ...body, integrityHash: domainHash("apn.x402.state.v1", canonicalJson(body)) };
  };
  const { tokenFacts: _facts, ...withoutFacts } = stored;
  assert.throws(() => validateX402Operation(reseal(withoutFacts)), { code: "APN_STATE_CORRUPT" });
  assert.throws(() => validateX402Operation(reseal({ ...stored, tokenFacts: { decimals: 6, proofTag: "latest" } })), { code: "APN_STATE_CORRUPT" });
});

test("CLI and MCP share the chain+token policy, its foreground handoff and the prepared operation", async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = assetFixture(temporary.root, POLYGON); await fixture.core.wallet.ensure("default");
  const options = { stateRoot: temporary.root, wrappingSecret: fixture.wrapping, rpc: fixture.rpc, http: fixture.http, clock: fixture.clock };
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "apn-any-asset-parity", version: "1.0.0" }); await client.connect(clientTransport);
  context.after(async () => { await client.close(); await server.close(); });
  const invoke = async (name: string, input: Record<string, string>) => (await client.callTool({ name, arguments: input })).structuredContent as unknown as OutputEnvelope;
  const setInput = { profile: "default", chain: "eip155:137", asset: POLYGON.token, max_balance_usdc_atomic: ASSET_LIMITS.maxBalanceUsdcAtomic,
    max_x402_amount_atomic: ASSET_LIMITS.maxX402AmountAtomic };
  const handoff = await invoke("apn_wallet_policy_set", setInput);
  assert.equal(handoff.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED", JSON.stringify(handoff));
  assert.ok(JSON.stringify(handoff.error?.details).includes(`--asset ${POLYGON.token}`));
  const configured = await runCli(["wallet", "policy", "set", ...Object.entries(setInput).flatMap(([key, value]) => [`--${key.replaceAll("_", "-")}`, value])], {}, {
    ...options, policyApproval: { approve: async (intent) => { fixture.policyApprovals.push(intent); } },
  });
  assert.equal(configured.ok, true, JSON.stringify(configured));
  assert.deepEqual(fixture.policyApprovals[0]?.x402Network, { chainId: 137, token: POLYGON.token });
  assert.deepEqual((await invoke("apn_wallet_policy_show", { profile: "default", chain: "eip155:137", asset: POLYGON.token })).data, configured.data);
  const input = { profile: "default", chain: "eip155:137", asset: POLYGON.token, url: X402_URL, idempotency_key: "any-asset-parity", rpc_url: "https://rpc.example" };
  const prepared = await invoke("apn_x402_fetch_prepare", input);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const replay = await runCli(["x402", "fetch", "prepare", ...Object.entries(input).flatMap(([key, value]) => [`--${key.replaceAll("_", "-")}`, value])], {}, options);
  assert.deepEqual(replay.operation, prepared.operation); assert.equal(fixture.http.calls.length, 1);
});
