import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import * as cliRuntime from "../../src/cli.js";
import { testRuntime } from "./installed-runtime.js";
import type { OutputEnvelope } from "../../src/commands.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { decodePaymentSignatureHeader, inspectCandidates } from "../../src/x402-codec.js";
import { normalizeX402HttpRequest } from "../../src/x402-http-request.js";
import { x402Network } from "../../src/x402-network.js";
import { validateX402Operation } from "../../src/x402-state-integrity.js";
import { temporaryState } from "./helpers.js";
import { initializeNetworkFixture, networkChallenge, networkFixture, networkPaid, networkSettlement, NETWORK_LIMITS } from "./evm-x402-helpers.js";
import { X402_PAYMENT_REQUIRED, X402_REQUIREMENTS, X402_URL } from "./x402-vectors.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");

for (const chainId of [1, 42161] as const) {
const network = x402Network(chainId).network;
const networkName = chainId === 1 ? "Ethereum" : "Arbitrum One";
const REQUEST = { command: "x402.fetch.prepare" as const, profile: "default", chainId, url: X402_URL, idempotencyKey: "eth-x402-synthetic" };
for (const body of [undefined, null, "", Buffer.from('{"planId":"synthetic","idempotencyKey":"merchant-one"}').toString("base64")]) {
  test(`${networkName} actual encrypted signer completes ${body === undefined ? "legacy GET" : body === null ? "absent POST" : body === "" ? "empty POST" : "JSON POST"} without Base allowance or replacement`, async (context) => {
    const temporary = await temporaryState(); context.after(temporary.cleanup);
    const fixture = networkFixture(temporary.root, chainId); await initializeNetworkFixture(fixture, chainId);
    const httpRequest = body === undefined ? {} : { httpRequest: normalizeX402HttpRequest({ schemaVersion: "apn.http-request.v1", url: X402_URL, method: "POST", headers: { "idempotency-key": "merchant-one" }, bodyBase64: body }) };
    const prepared = await fixture.core.execute({ ...REQUEST, ...httpRequest });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operationId = (prepared.operation as { operationId: string }).operationId;
    const original = (await fixture.state.findX402Operation(operationId))!;
    assert.equal(original.network, network); assert.equal(original.token, x402Network(chainId).token.toLowerCase());
    assert.deepEqual((await fixture.core.execute({ ...REQUEST, ...httpRequest })).operation, prepared.operation);
    assert.equal((await fixture.core.execute({ ...REQUEST, chainId: 8453, ...httpRequest })).error?.code, "APN_IDEMPOTENCY_CONFLICT");
    const approved = await fixture.core.execute({ command: "x402.fetch.approve", operationId });
    assert.equal(approved.ok, true, JSON.stringify(approved));
    fixture.http.outcomes.push(networkPaid(original));
    assert.equal((await fixture.core.execute({ command: "operation.resume", operationId })).ok, true);
    const paid = fixture.http.calls.filter((call) => call.paymentSignature !== undefined);
    assert.equal(paid.length, 1); assert.deepEqual(paid[0]!.httpRequest, httpRequest.httpRequest);
    const payload = decodePaymentSignatureHeader(paid[0]!.paymentSignature!);
    assert.equal(payload.accepted.network, network);
    networkSettlement(fixture.rpc, original);
    const completed = await fixture.core.execute({ command: "operation.resume", operationId });
    assert.equal(completed.ok, true, JSON.stringify(completed)); assert.equal((completed.operation as { state: string }).state, "completed");
    const stored = (await fixture.state.findX402Operation(operationId))!;
    validateX402Operation(stored);
    assert.equal(stored.settlementEvidence?.chainId, String(chainId));
    assert.equal((await fixture.core.execute({ command: "receipt.get", operationId })).ok, true);
    await fixture.core.execute({ command: "operation.resume", operationId });
    assert.equal(fixture.http.calls.length, 2);
    assert.equal(fixture.nativeCalls.filter((call) => call.operation === "x402Exact.approveAndAuthorize").length, 1);
  });
}

test(`${networkName} never inherits Base policy; lowering current cap blocks new signing and first exposure but not reconciliation`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = networkFixture(temporary.root, chainId); await fixture.core.wallet.ensure("default");
  await fixture.core.wallet.policySet({ command: "wallet.policy.set", profile: "default", ...NETWORK_LIMITS });
  await fixture.core.wallet.policySet({ command: "wallet.policy.set", profile: "default", chainId: chainId === 1 ? 42161 : 1, ...NETWORK_LIMITS });
  assert.equal((await fixture.core.execute(REQUEST)).error?.code, "APN_WALLET_POLICY_REQUIRED");
  assert.equal(fixture.http.calls.length, 0);
  await fixture.core.wallet.policySet({ command: "wallet.policy.set", profile: "default", chainId, ...NETWORK_LIMITS });
  const prepared = await fixture.core.execute(REQUEST); assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = (prepared.operation as { operationId: string }).operationId;
  const lower = { command: "wallet.policy.set" as const, profile: "default", chainId, ...NETWORK_LIMITS, maxX402AmountAtomic: "1" };
  await fixture.core.wallet.policySet(lower);
  assert.equal((await fixture.core.execute({ command: "x402.fetch.approve", operationId })).error?.code, "APN_X402_PROFILE_LIMIT_EXCEEDED");
  assert.equal(fixture.nativeCalls.filter((call) => call.operation.includes("Authorize")).length, 0);
  await fixture.core.wallet.policySet({ ...lower, ...NETWORK_LIMITS });
  await fixture.core.execute({ command: "operation.resume", operationId });
  await fixture.core.execute({ command: "operation.resume", operationId });
  const original = (await fixture.state.findX402Operation(operationId))!;
  assert.equal(original.state, "authorized_not_sent");
  await fixture.core.wallet.policySet(lower);
  const refused = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal(refused.error?.code, "APN_X402_PROFILE_LIMIT_EXCEEDED", JSON.stringify(refused)); assert.equal(fixture.http.calls.length, 1);
  await fixture.core.wallet.policySet({ ...lower, ...NETWORK_LIMITS });
  fixture.http.outcomes.push(networkPaid(original));
  await fixture.core.execute({ command: "operation.resume", operationId });
  await fixture.core.wallet.policySet(lower);
  networkSettlement(fixture.rpc, original);
  const complete = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((complete.operation as { state: string }).state, "completed", JSON.stringify(complete));
  assert.equal(fixture.http.calls.length, 2);
});

test(`${networkName} offer selection refuses other networks, assets, mechanisms and another named network`, () => {
  const required = { ...X402_PAYMENT_REQUIRED, accepts: [{ ...X402_REQUIREMENTS, network: network, asset: x402Network(chainId).token }] };
  assert.equal(inspectCandidates(required, X402_URL, chainId).length, 1);
  assert.equal(inspectCandidates(required, X402_URL).length, 0);
  for (const override of [{ network: chainId === 1 ? "eip155:42161" as const : "eip155:1" as const }, { asset: x402Network(8453).token }, { extra: { ...X402_REQUIREMENTS.extra, assetTransferMethod: "permit2" } }, { extra: { assetTransferMethod: "erc7710", facilitatorAddresses: ["0x2222222222222222222222222222222222222222"] } }]) {
    assert.equal(inspectCandidates({ ...required, accepts: [{ ...required.accepts[0]!, ...override }] }, X402_URL, chainId).length, 0);
  }
});

for (const bodyBase64 of [undefined, null, "", Buffer.from('{"planId":"synthetic"}').toString("base64")]) {
  test(`${networkName} fresh processes recover encrypted authorization and ambiguous POST ${JSON.stringify(bodyBase64)} without replacement`, async (context) => {
    const temporary = await temporaryState(); context.after(temporary.cleanup);
    const fixture = networkFixture(temporary.root, chainId); await initializeNetworkFixture(fixture, chainId);
    fixture.http.outcomes[0] = networkChallenge(chainId, true);
    const httpRequest = bodyBase64 === undefined ? {} : { httpRequest: normalizeX402HttpRequest({ schemaVersion: "apn.http-request.v1", url: X402_URL, method: "POST", headers: { "idempotency-key": "synthetic-one" }, bodyBase64 }) };
    const prepared = await fixture.core.execute({ ...REQUEST, ...httpRequest }); assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operationId = (prepared.operation as { operationId: string }).operationId;
    const worker = fileURLToPath(new URL("./evm-x402-crash-worker.js", import.meta.url));
    const run = (phase: string) => spawnSync(process.execPath, [worker, phase, temporary.root, operationId], { encoding: "utf8", timeout: 15000 });
    const crashed = run("sign-crash"); assert.equal(crashed.status, 75, crashed.stderr + crashed.stdout);
    assert.equal((await fixture.state.findX402Operation(operationId))!.state, "authorization_material_pending");
    const recovered = run("recover"); assert.equal(recovered.status, 0, recovered.stderr);
    const recoveredData = JSON.parse(recovered.stdout);
    assert.equal(recoveredData.result.operation.state, "authorized_not_sent", recovered.stdout); assert.equal(recoveredData.signatures, 0);
    const sendCrash = run("send-crash"); assert.equal(sendCrash.status, 76, sendCrash.stderr + sendCrash.stdout);
    assert.equal((await fixture.state.findX402Operation(operationId))!.state, "paid_request_pending");
    const settled = run("settle"); assert.equal(settled.status, 0, settled.stderr);
    const settledData = JSON.parse(settled.stdout);
    assert.equal(settledData.result.operation.state, "completed", settled.stdout); assert.equal(settledData.signatures, 0); assert.equal(settledData.httpCalls, 1);
    const replay = run("replay"); assert.equal(replay.status, 0, replay.stderr); assert.equal(JSON.parse(replay.stdout).httpCalls, 0);
  });
}

for (const failure of ["overfunded", "insufficient", "domain", "chain"] as const) test(`${networkName} current ${failure} blocks first exposure without losing the signed operation`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = networkFixture(temporary.root, chainId); await initializeNetworkFixture(fixture, chainId);
  const prepared = await fixture.core.execute(REQUEST); assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = (prepared.operation as { operationId: string }).operationId;
  assert.equal((await fixture.core.execute({ command: "x402.fetch.approve", operationId })).ok, true);
  if (failure === "overfunded") fixture.rpc.x402Evidence = { ...fixture.rpc.x402Evidence, usdcAtomic: "100000001" };
  if (failure === "insufficient") fixture.rpc.x402Evidence = { ...fixture.rpc.x402Evidence, usdcAtomic: "0" };
  if (failure === "domain") fixture.rpc.x402Evidence = { ...fixture.rpc.x402Evidence, domainSeparator: `0x${"f".repeat(64)}` };
  if (failure === "chain") fixture.rpc.chainId = 8453;
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId });
  const codes = { overfunded: "APN_WALLET_OVERFUNDED_FOR_UNATTENDED_X402", insufficient: "APN_INSUFFICIENT_USDC", domain: "APN_X402_UNSUPPORTED_OFFER", chain: "APN_CHAIN_MISMATCH" };
  assert.equal(resumed.error?.code, codes[failure], JSON.stringify(resumed));
  assert.equal(fixture.http.calls.length, 1);
  const stored = (await fixture.state.findX402Operation(operationId))!;
  assert.equal(stored.state, "authorized_not_sent"); assert.equal(stored.attempts.length, 0);
});

test(`${networkName} settlement rejects Base token logs and foreign evidence even with resealed hashes`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = networkFixture(temporary.root, chainId); await initializeNetworkFixture(fixture, chainId);
  const prepared = await fixture.core.execute(REQUEST); assert.equal(prepared.ok, true);
  const operationId = (prepared.operation as { operationId: string }).operationId;
  const original = (await fixture.state.findX402Operation(operationId))!;
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  fixture.http.outcomes.push(networkPaid(original));
  await fixture.core.execute({ command: "operation.resume", operationId });
  networkSettlement(fixture.rpc, original, x402Network(8453).token.toLowerCase() as `0x${string}`);
  const refused = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((refused.operation as { terminal: boolean }).terminal, false);
  assert.equal((await fixture.state.findX402Operation(operationId))!.settlementEvidence, undefined);
  networkSettlement(fixture.rpc, original);
  const completed = await fixture.core.execute({ command: "operation.resume", operationId }); assert.equal((completed.operation as { state: string }).state, "completed");
  const { canonicalJson, domainHash } = await import("../../src/canonical.js");
  const { validateSettlementEvidence } = await import("../../src/x402-evidence-validation.js");
  const stored = (await fixture.state.findX402Operation(operationId))!;
  const { evidenceHash: _hash, ...body } = stored.settlementEvidence!;
  const forged = { ...body, chainId: "8453", network: "eip155:8453", token: x402Network(8453).token.toLowerCase() };
  assert.throws(() => validateSettlementEvidence({ ...forged, evidenceHash: domainHash("apn.x402.settlement-evidence.v1", canonicalJson(forged)) }, stored as unknown as Record<string, unknown>), { code: "APN_STATE_CORRUPT" });
});

test(`${networkName} CLI/MCP policy and x402 share one encrypted state and exact chain handoff`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = networkFixture(temporary.root, chainId); await fixture.core.wallet.ensure("default");
  const options = { stateRoot: temporary.root, wrappingSecret: fixture.wrapping, rpc: fixture.rpc, http: fixture.http, clock: fixture.clock };
  const server = createMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport);
  const client = new Client({ name: "apn-ethereum-parity", version: "1.0.0" }); await client.connect(clientTransport);
  context.after(async () => { await client.close(); await server.close(); });
  const invoke = async (name: string, input: Record<string, string>) => (await client.callTool({ name, arguments: input })).structuredContent as unknown as OutputEnvelope;
  const setInput = { profile: "default", chain: network, max_balance_usdc_atomic: NETWORK_LIMITS.maxBalanceUsdcAtomic, max_x402_amount_atomic: NETWORK_LIMITS.maxX402AmountAtomic };
  const handoff = await invoke("apn_wallet_policy_set_network", setInput);
  assert.equal(handoff.error?.code, "APN_FOREGROUND_APPROVAL_REQUIRED", JSON.stringify(handoff));
  assert.match(JSON.stringify(handoff.error?.details), /set-network/); assert.ok(JSON.stringify(handoff.error?.details).includes(network));
  const configured = await runCli(["wallet", "policy", "set-network", ...Object.entries(setInput).flatMap(([key, value]) => [`--${key.replaceAll("_", "-")}`, value])], {}, {
    ...options, policyApproval: { approve: async (intent) => { fixture.policyApprovals.push(intent); } },
  });
  assert.equal(configured.ok, true, JSON.stringify(configured)); assert.equal(fixture.policyApprovals[0]?.x402Network?.chainId, chainId);
  const shown = await invoke("apn_wallet_policy_show_network", { profile: "default", chain: network });
  assert.deepEqual(shown.data, configured.data);
  const base = await invoke("apn_wallet_policy_show_network", { profile: "default", chain: "eip155:8453" });
  assert.equal((base.data as { configured: boolean }).configured, false);
  const input = { profile: "default", chain: network, url: X402_URL, idempotency_key: REQUEST.idempotencyKey, rpc_url: "https://rpc.example", method: "POST", body_base64: "" };
  const prepared = await invoke("apn_x402_fetch_prepare_network", input);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operationId = (prepared.operation as { operationId: string }).operationId;
  const cliReplay = await runCli(["x402", "fetch", "prepare-network", ...Object.entries(input).flatMap(([key, value]) => [`--${key.replaceAll("_", "-")}`, value])], {}, options);
  assert.deepEqual(cliReplay.operation, prepared.operation); assert.equal(fixture.http.calls.length, 1);
  const approved = await invoke("apn_x402_fetch_approve", { operation: operationId, rpc_url: input.rpc_url });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const operation = (await fixture.state.findX402Operation(operationId))!;
  fixture.http.outcomes.push(networkPaid(operation));
  await runCli(["operation", "resume", "--operation", operationId, "--rpc-url", input.rpc_url], {}, options);
  networkSettlement(fixture.rpc, operation);
  const completed = await invoke("apn_operation_resume", { operation: operationId, rpc_url: input.rpc_url });
  assert.equal((completed.operation as { state: string }).state, "completed", JSON.stringify(completed));
  assert.equal((await invoke("apn_receipt_get", { operation: operationId })).ok, true);
});

test(`${networkName} expiry requires finalized selected-network absence, not a timeout or Base balance`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = networkFixture(temporary.root, chainId); await initializeNetworkFixture(fixture, chainId);
  const prepared = await fixture.core.execute(REQUEST); assert.equal(prepared.ok, true);
  const operationId = (prepared.operation as { operationId: string }).operationId;
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  const frozen = (await fixture.state.findX402Operation(operationId))!;
  fixture.clock.advance(310000);
  const observedAt = fixture.clock.now().toISOString(), timestamp = Math.floor(fixture.clock.now().getTime() / 1000).toString();
  fixture.rpc.safeHead = { ...fixture.rpc.safeHead, number: "12347", hash: `0x${"e".repeat(64)}`, observedAt, timestamp };
  fixture.rpc.finalizedHead = { ...fixture.rpc.finalizedHead, number: "12346", hash: `0x${"d".repeat(64)}`, observedAt, timestamp };
  const expired = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((expired.operation as { state: string }).state, "failed_expired_unused", JSON.stringify(expired));
  const stored = (await fixture.state.findX402Operation(operationId))!;
  assert.equal(stored.unusedExpiryEvidence?.chainId, String(chainId)); assert.equal(stored.unusedExpiryEvidence?.token, frozen.token);
  assert.equal(fixture.http.calls.length, 1); assert.equal(stored.attempts.length, 0);
});

test(`${networkName} first-exposure policy reads inherit the caller's bounded deadline`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = networkFixture(temporary.root, chainId); await initializeNetworkFixture(fixture, chainId);
  const prepared = await fixture.core.execute(REQUEST); assert.equal(prepared.ok, true);
  const operation = (await fixture.state.findX402Operation((prepared.operation as { operationId: string }).operationId))!;
  const { assertCurrentNetworkPolicy } = await import("../../src/x402-network-policy.js");
  const timeouts: number[] = [];
  fixture.rpc.withTotalTimeout = (timeout) => { timeouts.push(timeout); return fixture.rpc; };
  await assertCurrentNetworkPolicy(fixture.core.context, operation, fixture.core.context.wait.nowMs() + 1000);
  assert.equal(timeouts.length, 1); assert.ok(timeouts[0]! > 0 && timeouts[0]! <= 1000);
  const reads = fixture.rpc.x402PrepareCalls;
  await assert.rejects(assertCurrentNetworkPolicy(fixture.core.context, operation, fixture.core.context.wait.nowMs() - 1), { code: "APN_STATE_BUSY" });
  assert.equal(fixture.rpc.x402PrepareCalls, reads);
});

test(`${networkName} rechecks receipt and safe block after authorization-state reads before accepting settlement`, async (context) => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = networkFixture(temporary.root, chainId); await initializeNetworkFixture(fixture, chainId);
  const prepared = await fixture.core.execute(REQUEST);
  const operationId = (prepared.operation as { operationId: string }).operationId;
  const operation = (await fixture.state.findX402Operation(operationId))!;
  await fixture.core.execute({ command: "x402.fetch.approve", operationId });
  fixture.http.outcomes.push(networkPaid(operation));
  await fixture.core.execute({ command: "operation.resume", operationId });
  networkSettlement(fixture.rpc, operation);
  let numberedReads = 0;
  fixture.rpc.onX402Call = (name) => {
    if (name === "block:12345" && ++numberedReads === 3) fixture.rpc.blockHashes.set("12345", `0x${"f".repeat(64)}`);
  };
  const observed = await fixture.core.execute({ command: "operation.resume", operationId });
  assert.equal((observed.operation as { terminal: boolean }).terminal, false);
  assert.equal((await fixture.state.findX402Operation(operationId))!.settlementEvidence, undefined);
  assert.equal(fixture.http.calls.length, 2);
});

}
