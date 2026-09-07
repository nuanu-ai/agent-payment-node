import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { PaymentRequiredV2Schema } from "@x402/core/schemas";
import type { PaymentRequired } from "@x402/core/types";
import * as codecRuntime from "../../src/x402-codec.js";
import * as integrityRuntime from "../../src/x402-state-integrity.js";
import * as cliRuntime from "../../src/cli.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { normalizeX402HttpRequest } from "../../src/x402-http-request.js";
import { x402Network } from "../../src/x402-network.js";
import type { EvmChainId } from "../../src/evm-asset.js";
import type { X402OperationRecord } from "../../src/x402-state-integrity.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";
import { initializeNetworkFixture, networkFixture, networkPaid, networkSettlement } from "./evm-x402-helpers.js";
import { challengeObservation } from "./x402-helpers.js";
import { X402_PAYMENT_REQUIRED, X402_REQUIREMENTS, X402_URL, paymentIdentifierDeclaration } from "./x402-vectors.js";

const { decodePaymentRequiredHeader, encodeCanonicalBase64Json, inspectCandidates } =
  await testRuntime(codecRuntime, "x402-codec.js");
const { validateX402Operation } = await testRuntime(integrityRuntime, "x402-state-integrity.js");
const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const quicknode = JSON.parse(await readFile(
  new URL("../../../tests/fixtures/quicknode-payment-required-v2.json", import.meta.url), "utf8",
)) as PaymentRequired;

function lateOffer(chainId: EvmChainId, index = 20, resultRecovery = false): PaymentRequired {
  const network = x402Network(chainId);
  return {
    ...X402_PAYMENT_REQUIRED,
    accepts: [
      ...Array.from({ length: index }, () => ({ ...X402_REQUIREMENTS, network: "eip155:999" as const })),
      { ...X402_REQUIREMENTS, network: network.network, asset: network.token, maxTimeoutSeconds: 300 },
    ],
    extensions: {
      "unsupported-optional-extension": { info: { required: false } },
      ...(resultRecovery ? { "payment-identifier": paymentIdentifierDeclaration(false) } : {}),
    },
  };
}

function reseal(operation: X402OperationRecord): X402OperationRecord {
  const { integrityHash: _integrityHash, ...body } = operation;
  return { ...body, integrityHash: domainHash("apn.x402.state.v1", canonicalJson(body)) };
}

test("the original schema-valid Quicknode21 response preserves all offers and ordinary Base requirements", () => {
  assert.equal(PaymentRequiredV2Schema.safeParse(quicknode).success, true);
  assert.equal(quicknode.accepts.length, 21);
  assert.equal(Buffer.byteLength(JSON.stringify(quicknode)), 7948);
  const decoded = decodePaymentRequiredHeader(encodeCanonicalBase64Json(quicknode));
  assert.deepEqual(decoded.accepts, quicknode.accepts);
  assert.deepEqual(decoded.resource, quicknode.resource);
  assert.equal(decoded.extensions, undefined);
  const candidates = inspectCandidates(decoded, quicknode.resource!.url, 8453);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map(candidate => candidate.amountAtomic).sort(), ["1000", "10000000"]);
  assert.ok(candidates.every(candidate => candidate.assetTransferMethod === "eip3009"));
  for (const candidate of candidates) {
    assert.equal(candidate.offerHash, domainHash("apn.x402.offer.v1", canonicalJson(quicknode.accepts[Number(candidate.index)])));
  }
  assert.deepEqual(inspectCandidates(decoded, quicknode.resource!.url, 1), []);
  assert.deepEqual(inspectCandidates(decoded, quicknode.resource!.url, 42161), []);
});

for (const index of [16, 20, 63, 99]) {
  test(`byte-bounded offer lists preserve the supported original index ${index}`, () => {
    const challenge = lateOffer(1, index);
    assert.ok(Buffer.byteLength(JSON.stringify(challenge)) < 48 * 1024);
    const decoded = decodePaymentRequiredHeader(encodeCanonicalBase64Json(challenge));
    assert.equal(decoded.accepts.length, index + 1);
    const candidates = inspectCandidates(decoded, X402_URL, 1);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.index, String(index));
    assert.equal(candidates[0]?.offerHash, domainHash("apn.x402.offer.v1", canonicalJson(challenge.accepts[index])));
  });
}

test("larger lists retain byte, schema, supported-mechanism and selected-network boundaries", () => {
  for (const challenge of [
    { ...lateOffer(1), accepts: [] },
    { ...lateOffer(1), accepts: {} },
    { ...lateOffer(1), resource: undefined },
    { ...lateOffer(1), resource: { ...X402_PAYMENT_REQUIRED.resource, description: "x".repeat(49 * 1024) } },
    { ...lateOffer(1), accepts: [...lateOffer(1).accepts, { ...X402_REQUIREMENTS, amount: 1 }] },
  ]) assert.throws(() => decodePaymentRequiredHeader(encodeCanonicalBase64Json(challenge)), { code: "APN_HTTP_PROTOCOL" });
  const challenge = lateOffer(1);
  challenge.accepts.push({
    ...challenge.accepts[20]!,
    extra: { ...X402_REQUIREMENTS.extra, assetTransferMethod: "permit2" },
  });
  const decoded = decodePaymentRequiredHeader(encodeCanonicalBase64Json(challenge));
  assert.deepEqual(inspectCandidates(decoded, X402_URL, 1).map(candidate => candidate.index), ["20"]);
  assert.deepEqual(inspectCandidates(decoded, X402_URL, 8453), []);
});

for (const chainId of [8453, 1, 42161] as const) {
  for (const bodyBase64 of [undefined, null, "", Buffer.from('{"planId":"synthetic","idempotencyKey":"merchant-one"}').toString("base64")]) {
    test(`${chainId} late-index ${JSON.stringify(bodyBase64)} survives real sign/send crashes without replacement`, async context => {
      const temporary = await temporaryState(); context.after(temporary.cleanup);
      const fixture = networkFixture(temporary.root, chainId);
      await initializeNetworkFixture(fixture, chainId);
      fixture.http.outcomes.splice(0, fixture.http.outcomes.length, challengeObservation({
        header: encodeCanonicalBase64Json(lateOffer(chainId, 20, true)),
      }));
      const httpRequest = bodyBase64 === undefined ? {} : { httpRequest: normalizeX402HttpRequest({
        schemaVersion: "apn.http-request.v1", url: X402_URL, method: "POST",
        headers: { "idempotency-key": "merchant-one" }, bodyBase64,
      }) };
      const request = { command: "x402.fetch.prepare" as const, profile: "default", chainId,
        url: X402_URL, idempotencyKey: "multi-offer-recovery", ...httpRequest };
      const prepared = await fixture.core.execute(request);
      assert.equal(prepared.ok, true, JSON.stringify(prepared));
      const operationId = (prepared.operation as { operationId: string }).operationId;
      const original = (await fixture.state.findX402Operation(operationId))!;
      assert.equal(original.selectedOffer.index, "20");
      assert.equal(validateX402Operation(original).selectedOffer.index, "20");
      assert.deepEqual((await fixture.core.execute(request)).operation, prepared.operation);
      assert.equal(fixture.http.calls.length, 1);
      const alternateChain = chainId === 1 ? 42161 : 1;
      assert.equal((await fixture.core.execute({ ...request, chainId: alternateChain })).error?.code, "APN_IDEMPOTENCY_CONFLICT");
      const worker = fileURLToPath(new URL("./evm-x402-crash-worker.js", import.meta.url));
      const run = (phase: string) => spawnSync(process.execPath, [worker, phase, temporary.root, operationId], {
        encoding: "utf8", timeout: 30000, env: process.env,
      });
      assert.equal(run("sign-crash").status, 75);
      const signed = run("recover-sign");
      assert.equal(signed.status, 0, signed.stderr);
      assert.equal(JSON.parse(signed.stdout).signatures, 0);
      assert.equal(JSON.parse(signed.stdout).result.operation.state, "authorized_not_sent");
      assert.equal(run("send-crash").status, 76);
      const recovered = run("recover-send");
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(JSON.parse(recovered.stdout).signatures, 0);
      const settlement = run("settle");
      assert.equal(settlement.status, 0, settlement.stderr);
      assert.equal(JSON.parse(settlement.stdout).signatures, 0);
      const completed = (await fixture.state.findX402Operation(operationId))!;
      assert.equal(completed.state, "completed", settlement.stdout);
      assert.equal(completed.operationId, original.operationId);
      assert.equal(completed.requestHash, original.requestHash);
      assert.equal(completed.selectedOffer.index, "20");
      assert.equal(completed.selectedOffer.offerHash, original.selectedOffer.offerHash);
      assert.equal(completed.authorization.nonce, original.authorization.nonce);
      assert.equal(completed.settlementEvidence?.chainId, String(chainId));
      validateX402Operation(completed);
      assert.equal((await fixture.core.execute({ command: "receipt.get", operationId })).ok, true);
      const replay = run("settle");
      assert.equal(replay.status, 0, replay.stderr);
      assert.equal(JSON.parse(replay.stdout).signatures, 0);
      assert.equal(JSON.parse(replay.stdout).httpCalls, 0);
      assert.throws(() => validateX402Operation({
        ...completed, selectedOffer: { ...completed.selectedOffer, index: "19" },
      }), { code: "APN_STATE_CORRUPT" });
      for (const index of ["-1", "1.5", "49152", "9007199254740992"]) {
        assert.throws(() => validateX402Operation(reseal({
          ...completed, selectedOffer: { ...completed.selectedOffer, index },
        })), { code: "APN_STATE_CORRUPT" });
      }
      assert.throws(() => validateX402Operation(reseal({
        ...completed, selectedOffer: { ...completed.selectedOffer, declaredCanonicalJson: "{}" },
      })), { code: "APN_STATE_CORRUPT" });
    });
  }

  test(`${chainId} late-index CLI/MCP share the exact payment, receipt and idempotency record`, async context => {
    const temporary = await temporaryState(); context.after(temporary.cleanup);
    const fixture = networkFixture(temporary.root, chainId);
    await initializeNetworkFixture(fixture, chainId);
    fixture.http.outcomes.splice(0, fixture.http.outcomes.length, challengeObservation({
      header: encodeCanonicalBase64Json(lateOffer(chainId)),
    }));
    const options = { stateRoot: temporary.root, wrappingSecret: fixture.wrapping,
      rpc: fixture.rpc, http: fixture.http, clock: fixture.clock };
    const server = createMcpServer(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "apn-multi-offer-parity", version: "1.0.0" });
    await client.connect(clientTransport);
    context.after(async () => { await client.close(); await server.close(); });
    const invoke = async (name: string, input: Record<string, string>) =>
      (await client.callTool({ name, arguments: input })).structuredContent as unknown as OutputEnvelope;
    const input = { profile: "default", chain: x402Network(chainId).network, url: X402_URL,
      idempotency_key: "multi-offer-parity", rpc_url: "https://rpc.example", method: "POST", body_base64: "" };
    const prepared = await invoke("apn_x402_fetch_prepare_network", input);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    const operationId = (prepared.operation as { operationId: string }).operationId;
    const operation = (await fixture.state.findX402Operation(operationId))!;
    assert.equal(operation.selectedOffer.index, "20");
    const replay = await runCli(["x402", "fetch", "prepare-network",
      ...Object.entries(input).flatMap(([key, value]) => [`--${key.replaceAll("_", "-")}`, value])], {}, options);
    assert.deepEqual(replay.operation, prepared.operation);
    assert.equal(fixture.http.calls.length, 1);
    assert.equal((await invoke("apn_x402_fetch_approve", { operation: operationId, rpc_url: input.rpc_url })).ok, true);
    fixture.http.outcomes.push(networkPaid(operation));
    await runCli(["operation", "resume", "--operation", operationId, "--rpc-url", input.rpc_url], {}, options);
    networkSettlement(fixture.rpc, operation);
    const completed = await invoke("apn_operation_resume", { operation: operationId, rpc_url: input.rpc_url });
    assert.equal((completed.operation as { state: string }).state, "completed", JSON.stringify(completed));
    const receipt = await invoke("apn_receipt_get", { operation: operationId });
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.equal(fixture.http.calls.filter(call => call.paymentSignature !== undefined).length, 1);
  });
}

test("the exact Quicknode challenge freezes only the ordinary Base offer under an explicit1000-atomic cap", async context => {
  const temporary = await temporaryState(); context.after(temporary.cleanup);
  const fixture = networkFixture(temporary.root, 8453);
  await initializeNetworkFixture(fixture, 8453);
  fixture.http.outcomes.splice(0, fixture.http.outcomes.length, challengeObservation({
    header: encodeCanonicalBase64Json(quicknode), finalUrl: quicknode.resource!.url,
  }));
  const prepared = await fixture.core.execute({ command: "x402.fetch.prepare", profile: "default", chainId: 8453,
    url: quicknode.resource!.url, maxAmountAtomic: "1000", idempotencyKey: "quicknode-unpaid-fixture" });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const operation = (await fixture.state.findX402Operation((prepared.operation as { operationId: string }).operationId))!;
  assert.equal(operation.amountAtomic, "1000");
  assert.equal(operation.selectedOffer.index, String(quicknode.accepts.findIndex(
    offer => offer.network === "eip155:8453" && offer.amount === "1000",
  )));
  assert.equal(operation.selectedOffer.resolved.assetTransferMethod, "eip3009");
  assert.equal(operation.paymentIdentifier, undefined);
  assert.equal(fixture.http.calls.filter(call => call.paymentSignature !== undefined).length, 0);
  assert.equal(fixture.nativeCalls.filter(call => call.operation === "x402Exact.approveAndAuthorize").length, 0);
});
