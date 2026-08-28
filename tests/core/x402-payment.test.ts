import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import {
  decodeAndNormalizePaymentResponseHeader,
  decodePaymentSignatureHeader,
} from "../../src/x402-codec.js";
import type { HttpGetRequest, HttpObservation } from "../../src/x402-model.js";
import { ApnError } from "../../src/errors.js";
import type { NativePort, NativeRequest } from "../../src/ports.js";
import { requestX402Authorization, x402NativeRequest } from "../../src/x402-native.js";
import {
  appendX402Transition,
  sealX402Operation,
  type SettlementEvidence,
  type X402OperationRecord,
} from "../../src/x402-state-integrity.js";
import { TestClock, TestRpc, makeCore, temporaryState } from "./helpers.js";
import { QueuedHttp, challengeObservation, paidObservation } from "./x402-helpers.js";
import {
  X402_TRANSACTION,
  X402_URL,
  X402_PAYMENT_REQUIRED,
  canonicalPaymentRequiredHeader,
  canonicalPaymentResponseHeader,
  paymentIdentifierDeclaration,
} from "./x402-vectors.js";

const PRIVATE_KEY = `0x${"0".repeat(63)}1` as Hex;
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);

interface AuthorizationPayload {
  readonly token: `0x${string}`;
  readonly tokenDomain: { readonly name: string; readonly version: string };
  readonly authorization: {
    readonly from: `0x${string}`;
    readonly to: `0x${string}`;
    readonly value: string;
    readonly validAfter: "0";
    readonly validBefore: string;
    readonly nonce: `0x${string}`;
    readonly createdAt: string;
  };
}

class ExactPaymentNative implements NativePort {
  readonly calls: NativeRequest[] = [];
  material: Readonly<Record<string, unknown>> | undefined;
  expireOnGet = false;

  async request(request: NativeRequest): Promise<unknown> {
    this.calls.push(request);
    if (request.operation === "wallet.ensure") {
      return {
        profile: request.payload.profile,
        address: ACCOUNT.address,
        createdAt: "2026-08-25T00:00:00.000Z",
        bindingHash: "a".repeat(64),
      };
    }
    if (request.operation === "x402Exact.authorizationMaterial.get") {
      if (this.expireOnGet) {
        throw new ApnError("APN_NATIVE_REJECTED", "Native material expired.", {
          nativeCode: "APN_APPROVAL_EXPIRED",
        });
      }
      if (this.material === undefined) {
        throw new ApnError("APN_NATIVE_REJECTED", "Native material is absent.", {
          nativeCode: "APN_X402_AUTHORIZATION_NOT_FOUND",
        });
      }
      return this.material;
    }
    if (request.operation !== "x402Exact.approveAndAuthorize") {
      throw new Error(`unexpected native operation ${request.operation}`);
    }
    const payload = request.payload as unknown as AuthorizationPayload;
    const signature = await ACCOUNT.signTypedData({
      domain: {
        name: payload.tokenDomain.name,
        version: payload.tokenDomain.version,
        chainId: 8453,
        verifyingContract: payload.token,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: payload.authorization.from,
        to: payload.authorization.to,
        value: BigInt(payload.authorization.value),
        validAfter: 0n,
        validBefore: BigInt(payload.authorization.validBefore),
        nonce: payload.authorization.nonce,
      },
    });
    this.material = {
      authorization: {
        from: payload.authorization.from,
        to: payload.authorization.to,
        value: payload.authorization.value,
        validAfter: payload.authorization.validAfter,
        validBefore: payload.authorization.validBefore,
        nonce: payload.authorization.nonce,
      },
      signature,
      signatureHash: domainHash("apn.x402.signature.v1", Buffer.from(signature.slice(2), "hex")),
    };
    return this.material;
  }
}

async function authorizedFixture(t: TestContext): Promise<{
  readonly core: ReturnType<typeof makeCore>;
  readonly operationId: string;
  readonly native: ExactPaymentNative;
  readonly http: QueuedHttp;
  readonly rpc: TestRpc;
  readonly root: string;
  readonly clock: TestClock;
}>;
async function authorizedFixture(t: TestContext, input: {
  readonly paymentRequired?: unknown;
  readonly paidOutcome?: HttpObservation | Error;
  readonly clock?: TestClock;
  readonly idempotencyKey?: string;
  readonly onHttpCall?: (request: HttpGetRequest, callNumber: number) => void | Promise<void>;
}): Promise<{
  readonly core: ReturnType<typeof makeCore>;
  readonly operationId: string;
  readonly native: ExactPaymentNative;
  readonly http: QueuedHttp;
  readonly rpc: TestRpc;
  readonly root: string;
  readonly clock: TestClock;
}>;
async function authorizedFixture(t: TestContext, input: {
  readonly paymentRequired?: unknown;
  readonly paidOutcome?: HttpObservation | Error;
  readonly clock?: TestClock;
  readonly idempotencyKey?: string;
  readonly onHttpCall?: (request: HttpGetRequest, callNumber: number) => void | Promise<void>;
} = {}): Promise<{
  readonly core: ReturnType<typeof makeCore>;
  readonly operationId: string;
  readonly native: ExactPaymentNative;
  readonly http: QueuedHttp;
  readonly rpc: TestRpc;
  readonly root: string;
  readonly clock: TestClock;
}> {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const settlement = {
    success: true,
    payer: ACCOUNT.address.toLowerCase(),
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
    amount: "1250000",
  };
  const http = new QueuedHttp([
    challengeObservation({ header: canonicalPaymentRequiredHeader(input.paymentRequired ?? X402_PAYMENT_REQUIRED) }),
    input.paidOutcome ?? paidObservation({ paymentResponseHeader: canonicalPaymentResponseHeader(settlement) }),
  ], input.onHttpCall);
  const native = new ExactPaymentNative();
  const rpc = new TestRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: ACCOUNT.address };
  const clock = input.clock ?? new TestClock();
  const core = makeCore({ root: temporary.root, native, rpc, http, clock });
  assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
  const prepared = await core.execute({
    command: "x402.fetch.prepare",
    profile: "default",
    url: X402_URL,
    maxAmountAtomic: "2000000",
    idempotencyKey: input.idempotencyKey ?? "x402-payment-001",
  });
  const operationId = (prepared.operation as { readonly operationId?: unknown } | null)?.operationId;
  assert.equal(typeof operationId, "string");
  const approved = await core.execute({ command: "x402.fetch.approve", operationId: operationId as string });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  native.calls.length = 0;
  return { core, operationId: operationId as string, native, http, rpc, root: temporary.root, clock };
}

test("authorized resume persists one paid attempt, strict settlement, and protected result", async (t) => {
  const fixture = await authorizedFixture(t);
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "settlement_pending");
  assert.deepEqual(fixture.native.calls.map((call) => call.operation), ["x402Exact.authorizationMaterial.get"]);
  assert.equal(fixture.http.calls.length, 2);
  assert.deepEqual(Object.keys(fixture.http.calls[1] ?? {}).sort(), ["paymentSignature", "timeoutMs", "url"]);
  assert.equal(fixture.http.calls[1]?.url, X402_URL);
  assert.equal(fixture.http.calls[1]?.timeoutMs, 30_000);
  assert.equal(typeof fixture.http.calls[1]?.paymentSignature, "string");
  assert.equal(fixture.rpc.submissions.length, 0);

  const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  assert.equal(operation.attempts.length, 1);
  assert.equal(operation.attempts[0]?.phase, "observed");
  assert.equal(operation.settlementResponseObservation?.classification, "success");
  assert.equal(operation.transactionHint?.transactionHash, X402_TRANSACTION);
  assert.match(operation.resultLink?.resultHash ?? "", /^[a-f0-9]{64}$/u);
  const result = await fixture.core.context.state.loadX402Result(operation.profileHash, operation.operationId);
  assert.equal(result?.bodyText, '{"forecast":"sunny"}');
  assert.equal(JSON.stringify(resumed).includes("forecast"), false);
  assert.equal(JSON.stringify(resumed).includes("order=redacted"), false);
  const rawPairs = paidObservation({
    paymentResponseHeader: canonicalPaymentResponseHeader({
      success: true,
      payer: ACCOUNT.address.toLowerCase(),
      transaction: X402_TRANSACTION,
      network: "eip155:8453",
      amount: "1250000",
    }),
  }).rawHeaderPairs;
  assert.equal(
    operation.attempts[0]?.observation?.rawHeadersHash,
    domainHash("apn.x402.raw-header-pairs.v1", canonicalJson(rawPairs)),
  );
  assert.equal(
    operation.attempts[0]?.observation?.bodyHash,
    domainHash("apn.x402.result-body.v1", Buffer.from('{"forecast":"sunny"}', "utf8")),
  );
});

test("official X-PAYMENT-RESPONSE alias is accepted as the settlement response", async (t) => {
  const settlementHeader = canonicalPaymentResponseHeader({
    success: true,
    payer: ACCOUNT.address.toLowerCase(),
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
    amount: "1250000",
  });
  const fixture = await authorizedFixture(t, {
    paidOutcome: paidObservation({
      paymentResponseHeader: settlementHeader,
      paymentResponseHeaderName: "X-PAYMENT-RESPONSE",
    }),
    idempotencyKey: "x402-official-response-alias",
  });
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  assert.equal(operation.state, "settlement_pending");
  assert.equal(operation.settlementResponseObservation?.classification, "success");
  assert.equal(
    operation.attempts[0]?.observation?.paymentResponseHeaderHash,
    domainHash("apn.x402.payment-response-header.v1", Buffer.from(settlementHeader, "ascii")),
  );
  assert.match(operation.resultLink?.resultHash ?? "", /^[a-f0-9]{64}$/u);
});

test("restart reconstructs the exact paid header after the pending marker is durable", async (t) => {
  const exposureStates: X402OperationRecord[] = [];
  let fixtureRef: Awaited<ReturnType<typeof authorizedFixture>> | undefined;
  const fixture = await authorizedFixture(t, {
    idempotencyKey: "x402-payment-restart-ordering",
    onHttpCall: async (_request, callNumber) => {
      if (callNumber !== 2) return;
      if (fixtureRef === undefined) throw new Error("fixture not assigned before paid request");
      const current = await fixtureRef.core.context.state.findX402Operation(fixtureRef.operationId);
      if (current !== null) exposureStates.push(current);
    },
  });
  fixtureRef = fixture;
  const authorized = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  const beforeRestart = await requestX402Authorization(
    fixture.native,
    x402NativeRequest("99999999-9999-4999-8999-999999999999", authorized, "get"),
    authorized,
  );
  fixture.native.calls.length = 0;
  const restarted = makeCore({
    root: fixture.root,
    native: fixture.native,
    rpc: fixture.rpc,
    http: fixture.http,
    clock: fixture.clock,
  });

  const resumed = await restarted.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(exposureStates[0]?.state, "paid_request_pending");
  assert.equal(exposureStates[0]?.attempts.at(-1)?.purpose, "payment");
  assert.equal(exposureStates[0]?.attempts.at(-1)?.phase, "pending");
  const sentHeader = fixture.http.calls[1]?.paymentSignature;
  assert.equal(typeof sentHeader, "string");
  assert.equal(sentHeader, beforeRestart.paymentHeader);
  assert.equal(beforeRestart.native.signatureHash, authorized.signatureHash);
  assert.equal(beforeRestart.paymentPayloadHash, authorized.paymentPayloadHash);
  assert.equal(beforeRestart.paymentHeaderHash, authorized.paymentHeaderHash);
  assert.equal(
    domainHash("apn.x402.payment-header.v1", Buffer.from(sentHeader as string, "ascii")),
    authorized.paymentHeaderHash,
  );
});

test("PAYMENT-RESPONSE codec is exact, normalized, and closed", () => {
  const coreResponse = {
    success: true,
    payer: ACCOUNT.address,
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
    amount: "1250000",
  };
  const coreHeader = canonicalPaymentResponseHeader(coreResponse);
  const core = decodeAndNormalizePaymentResponseHeader(coreHeader, {
    payer: ACCOUNT.address.toLowerCase(), amountAtomic: "1250000",
  });
  const additiveHeader = canonicalPaymentResponseHeader({
    ...coreResponse,
    errorMessage: "facilitator metadata",
    extensions: { trace: { provider: "official" } },
    extra: { settlementRoute: "live", attempts: [1] },
  });
  const success = decodeAndNormalizePaymentResponseHeader(additiveHeader, {
    payer: ACCOUNT.address.toLowerCase(), amountAtomic: "1250000",
  });
  assert.equal(success.classification, "success");
  assert.deepEqual(JSON.parse(success.normalizedCanonicalJson), {
    amount: "1250000",
    network: "eip155:8453",
    payer: ACCOUNT.address.toLowerCase(),
    success: true,
    transaction: X402_TRANSACTION,
  });
  assert.equal(success.normalizedCanonicalJson, core.normalizedCanonicalJson);
  assert.equal(success.settlementResponseHash, core.settlementResponseHash);
  assert.notEqual(success.paymentResponseHeaderHash, core.paymentResponseHeaderHash);
  const pending = decodeAndNormalizePaymentResponseHeader(canonicalPaymentResponseHeader({
    success: false,
    errorReason: "settlement_pending",
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
  }), { payer: ACCOUNT.address.toLowerCase(), amountAtomic: "1250000" });
  assert.equal(pending.classification, "settlement_pending");
  const failed = decodeAndNormalizePaymentResponseHeader(canonicalPaymentResponseHeader({
    success: false,
    errorReason: "rejected",
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
  }), { payer: ACCOUNT.address.toLowerCase(), amountAtomic: "1250000" });
  assert.equal(failed.classification, "failure_with_transaction");

  for (const invalid of [
    "not-base64",
    canonicalPaymentResponseHeader({ ...coreResponse, errorMessage: "" }),
    canonicalPaymentResponseHeader({ ...coreResponse, errorMessage: "x".repeat(513) }),
    canonicalPaymentResponseHeader({ ...coreResponse, extensions: [] }),
    canonicalPaymentResponseHeader({ ...coreResponse, extra: "not-a-record" }),
    canonicalPaymentResponseHeader({ ...coreResponse, unknown: true }),
    canonicalPaymentResponseHeader({ ...coreResponse, errorReason: "conflicts-with-success" }),
    canonicalPaymentResponseHeader({ ...coreResponse, payer: "0x3333333333333333333333333333333333333333" }),
    canonicalPaymentResponseHeader({ success: true, transaction: `0x${"0".repeat(64)}`, network: "eip155:8453" }),
    canonicalPaymentResponseHeader({ success: true, transaction: X402_TRANSACTION, network: "eip155:1" }),
    canonicalPaymentResponseHeader({ success: true, transaction: X402_TRANSACTION, network: "eip155:8453", amount: "1250001" }),
  ]) {
    assert.throws(
      () => decodeAndNormalizePaymentResponseHeader(invalid, {
        payer: ACCOUNT.address.toLowerCase(),
        amountAtomic: "1250000",
      }),
      { code: "APN_X402_SETTLEMENT_INVALID" },
    );
  }
});

test("payment identifier required, optional, and absent postures preserve exact paid payload bytes", async (t) => {
  for (const posture of ["required", "optional", "absent"] as const) {
    await t.test(posture, async (nested) => {
      const paymentRequired = posture === "absent" ? X402_PAYMENT_REQUIRED : {
        ...X402_PAYMENT_REQUIRED,
        extensions: {
          "payment-identifier": paymentIdentifierDeclaration(posture === "required"),
        },
      };
      const fixture = await authorizedFixture(nested, {
        paymentRequired,
        idempotencyKey: `x402-payment-id-${posture}`,
      });
      const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      assert.equal(resumed.ok, true, JSON.stringify(resumed));
      const header = fixture.http.calls[1]?.paymentSignature;
      assert.equal(typeof header, "string");
      const payload = decodePaymentSignatureHeader(header as string) as unknown as Record<string, unknown>;
      if (posture === "absent") {
        assert.equal(payload.extensions, undefined);
      } else {
        assert.deepEqual(payload.extensions, {
          "payment-identifier": {
            ...paymentIdentifierDeclaration(posture === "required"),
            info: { required: posture === "required", id: `apn_${fixture.operationId}` },
          },
        });
      }
      const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
      assert.equal(
        operation.paymentHeaderHash,
        domainHash("apn.x402.payment-header.v1", Buffer.from(header as string, "ascii")),
      );
    });
  }
});

test("post-exposure transport ambiguity is durable and never retries implicitly", async (t) => {
  const fixture = await authorizedFixture(t, { paidOutcome: new Error("raw seller canary") });
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "effect_unknown");
  const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  assert.equal(operation.attempts[0]?.phase, "ambiguous");
  assert.deepEqual(operation.transitions.slice(-2).map((transition) => transition.state), [
    "paid_request_pending",
    "effect_unknown",
  ]);
  assert.equal(JSON.stringify(resumed).includes("raw seller canary"), false);
  const callCount = fixture.http.calls.length;
  const nativeCount = fixture.native.calls.length;
  const second = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(second.ok, true);
  assert.equal(fixture.http.calls.length, callCount);
  assert.equal(fixture.native.calls.length, nativeCount);
  assert.equal(fixture.rpc.submissions.length, 0);
});

test("missing settlement response persists an observed unknown outcome without exposing seller body", async (t) => {
  const fixture = await authorizedFixture(t, { paidOutcome: paidObservation() });
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  assert.equal(operation.state, "effect_unknown");
  assert.equal(operation.attempts[0]?.phase, "observed");
  assert.equal(operation.settlementResponseObservation, undefined);
  assert.equal(operation.resultLink, undefined);
  assert.equal(JSON.stringify(resumed).includes("forecast"), false);
  await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(fixture.http.calls.length, 2);
});

test("UTF-8 Content-Type parameters are accepted and normalized to the base media type", async (t) => {
  const settlementHeader = canonicalPaymentResponseHeader({
    success: true,
    payer: ACCOUNT.address.toLowerCase(),
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
    amount: "1250000",
  });
  const cases = [
    { label: "json-token", mediaType: "application/json; charset=UTF-8", expected: "application/json", bodyText: "{}" },
    { label: "text-quoted", mediaType: "text/plain; charset=\"UTF-8\"", expected: "text/plain", bodyText: "sunny" },
  ] as const;
  for (const item of cases) {
    await t.test(item.label, async (nested) => {
      const fixture = await authorizedFixture(nested, {
        paidOutcome: paidObservation({
          paymentResponseHeader: settlementHeader,
          mediaType: item.mediaType,
          bodyText: item.bodyText,
        }),
        idempotencyKey: `x402-content-type-${item.label}`,
      });
      const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      assert.equal(resumed.ok, true, JSON.stringify(resumed));
      const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
      assert.equal(operation.attempts[0]?.observation?.mediaType, item.expected);
      const result = await fixture.core.context.state.loadX402Result(operation.profileHash, operation.operationId);
      assert.equal(result?.mediaType, item.expected);
      assert.equal(result?.bodyText, item.bodyText);
    });
  }
});

test("invalid result and duplicate control headers remain bounded non-terminal with one send", async (t) => {
  const settlementHeader = canonicalPaymentResponseHeader({
    success: true,
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
    payer: ACCOUNT.address.toLowerCase(),
    amount: "1250000",
  });
  const cases: readonly { readonly label: string; readonly response: HttpObservation }[] = [
    {
      label: "mixed-case-media",
      response: paidObservation({ paymentResponseHeader: settlementHeader, mediaType: "Application/Json" }),
    },
    {
      label: "malformed-json",
      response: paidObservation({ paymentResponseHeader: settlementHeader, bodyText: "{" }),
    },
    {
      label: "duplicate-payment-response",
      response: paidObservation({
        rawHeaderPairs: [
          ["Content-Type", "application/json"],
          ["Content-Length", "2"],
          ["PAYMENT-RESPONSE", settlementHeader],
          ["payment-response", settlementHeader],
        ],
        bodyText: "{}",
      }),
    },
    {
      label: "primary-and-alias-identical",
      response: paidObservation({
        rawHeaderPairs: [
          ["Content-Type", "application/json"],
          ["Content-Length", "2"],
          ["PAYMENT-RESPONSE", settlementHeader],
          ["X-PAYMENT-RESPONSE", settlementHeader],
        ],
        bodyText: "{}",
      }),
    },
    {
      label: "primary-and-alias-conflicting",
      response: paidObservation({
        rawHeaderPairs: [
          ["Content-Type", "application/json"],
          ["Content-Length", "2"],
          ["PAYMENT-RESPONSE", settlementHeader],
          ["X-PAYMENT-RESPONSE", "different"],
        ],
        bodyText: "{}",
      }),
    },
    {
      label: "duplicate-alias",
      response: paidObservation({
        rawHeaderPairs: [
          ["Content-Type", "application/json"],
          ["Content-Length", "2"],
          ["X-PAYMENT-RESPONSE", settlementHeader],
          ["x-payment-response", settlementHeader],
        ],
        bodyText: "{}",
      }),
    },
    {
      label: "folded-alias",
      response: paidObservation({
        rawHeaderPairs: [
          ["Content-Type", "application/json"],
          ["Content-Length", "2"],
          ["X-PAYMENT-RESPONSE", `${settlementHeader},${settlementHeader}`],
        ],
        bodyText: "{}",
      }),
    },
    {
      label: "malformed-content-type-parameter",
      response: paidObservation({ paymentResponseHeader: settlementHeader, mediaType: "application/json; charset", bodyText: "{}" }),
    },
    {
      label: "duplicate-content-type-parameter",
      response: paidObservation({
        paymentResponseHeader: settlementHeader,
        mediaType: "application/json; charset=utf-8; charset=utf-8",
        bodyText: "{}",
      }),
    },
    {
      label: "unknown-content-type-parameter",
      response: paidObservation({ paymentResponseHeader: settlementHeader, mediaType: "application/json; profile=v1", bodyText: "{}" }),
    },
    {
      label: "non-utf8-content-type-parameter",
      response: paidObservation({
        paymentResponseHeader: settlementHeader,
        mediaType: "application/json; charset=iso-8859-1",
        bodyText: "{}",
      }),
    },
    {
      label: "oversized-media",
      response: paidObservation({
        paymentResponseHeader: settlementHeader,
        mediaType: `text/${"a".repeat(124)}`,
        bodyText: "safe",
      }),
    },
  ];
  for (const item of cases) {
    await t.test(item.label, async (nested) => {
      const fixture = await authorizedFixture(nested, {
        paidOutcome: item.response,
        idempotencyKey: `x402-invalid-${item.label}`,
      });
      const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      assert.equal(resumed.ok, true, JSON.stringify(resumed));
      const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
      assert.equal(operation.state, "effect_unknown");
      assert.equal(operation.attempts[0]?.phase, "ambiguous");
      assert.equal(operation.resultLink, undefined);
      await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
      assert.equal(fixture.http.calls.length, 2);
      assert.equal(fixture.rpc.submissions.length, 0);
    });
  }
});

test("authorization deadline requires one full second and derives a whole-second timeout", async (t) => {
  await t.test("native-expiry-race", async (nested) => {
    const fixture = await authorizedFixture(nested, { idempotencyKey: "x402-native-expiry-race" });
    fixture.native.expireOnGet = true;
    const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "authorized_not_sent");
    assert.equal(fixture.http.calls.length, 1);
  });
  await t.test("less-than-one-second", async (nested) => {
    const clock = new TestClock();
    const fixture = await authorizedFixture(nested, { clock, idempotencyKey: "x402-deadline-expired" });
    clock.advance(59_500);
    const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    assert.equal(resumed.ok, true);
    assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "authorized_not_sent");
    assert.equal(fixture.http.calls.length, 1);
    const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
    assert.equal(operation.attempts.length, 0);
  });
  await t.test("bounded-whole-second", async (nested) => {
    const clock = new TestClock();
    const fixture = await authorizedFixture(nested, {
      clock,
      idempotencyKey: "x402-deadline-bounded",
      paidOutcome: paidObservation({
        paymentResponseHeader: canonicalPaymentResponseHeader({
          success: true,
          payer: ACCOUNT.address.toLowerCase(),
          transaction: X402_TRANSACTION,
          network: "eip155:8453",
          amount: "1250000",
        }),
        startedAt: "2026-08-26T00:00:30.260Z",
        observedAt: "2026-08-26T00:00:30.270Z",
      }),
    });
    clock.advance(30_250);
    const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(fixture.http.calls[1]?.timeoutMs, 29_000);
  });
});

test("paid 402 may report a new challenge but cannot rebind frozen economics", async (t) => {
  const settlementHeader = canonicalPaymentResponseHeader({
    success: false,
    errorReason: "settlement_pending",
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
  });
  const changedChallenge = {
    ...X402_PAYMENT_REQUIRED,
    accepts: [{ ...X402_PAYMENT_REQUIRED.accepts[0], amount: "9999999" }],
  };
  const fixture = await authorizedFixture(t, {
    paidOutcome: paidObservation({
      status: 402,
      bodyText: "seller pending",
      paymentResponseHeader: settlementHeader,
      paymentRequiredHeader: canonicalPaymentRequiredHeader(changedChallenge),
    }),
  });
  const before = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const after = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  assert.equal(after.state, "settlement_pending");
  assert.equal(after.amountAtomic, before.amountAtomic);
  assert.equal(after.selectedOffer.offerHash, before.selectedOffer.offerHash);
  assert.equal(after.fingerprint, before.fingerprint);
  assert.equal(after.attempts[0]?.observation?.paymentRequiredHeaderHash, domainHash(
    "apn.x402.payment-required-header.v1",
    Buffer.from(canonicalPaymentRequiredHeader(changedChallenge), "ascii"),
  ));
  assert.equal(after.resultLink, undefined);
});

test("supported text result preserves exact bytes behind the protected result link", async (t) => {
  const settlementHeader = canonicalPaymentResponseHeader({
    success: true,
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
    payer: ACCOUNT.address.toLowerCase(),
    amount: "1250000",
  });
  const body = "\uFEFFsunny\nwind: 3m/s";
  const fixture = await authorizedFixture(t, {
    paidOutcome: paidObservation({ paymentResponseHeader: settlementHeader, mediaType: "text/plain", bodyText: body }),
  });
  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  const result = await fixture.core.context.state.loadX402Result(operation.profileHash, operation.operationId);
  assert.equal(result?.bodyText, body);
  assert.equal(result?.byteLength, Buffer.byteLength(body, "utf8").toString());
  assert.equal(result?.resultHash, domainHash("apn.x402.result-body.v1", Buffer.from(body, "utf8")));
  assert.equal(JSON.stringify(resumed).includes(body), false);
});

test("one advertised-ID result recovery reuses identical material and cannot send twice", async (t) => {
  const pendingHeader = canonicalPaymentResponseHeader({
    success: false,
    errorReason: "settlement_pending",
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
  });
  const paymentRequired = {
    ...X402_PAYMENT_REQUIRED,
    extensions: { "payment-identifier": paymentIdentifierDeclaration(false) },
  };
  const exposureStates: X402OperationRecord[] = [];
  let fixtureRef: Awaited<ReturnType<typeof authorizedFixture>> | undefined;
  const fixture = await authorizedFixture(t, {
    paymentRequired,
    paidOutcome: paidObservation({ status: 402, bodyText: "pending", paymentResponseHeader: pendingHeader }),
    idempotencyKey: "x402-result-recovery",
    onHttpCall: async (_request, callNumber) => {
      if (callNumber !== 3) return;
      if (fixtureRef === undefined) throw new Error("fixture not assigned before recovery request");
      const current = await fixtureRef.core.context.state.findX402Operation(fixtureRef.operationId);
      if (current !== null) exposureStates.push(current);
    },
  });
  fixtureRef = fixture;
  let operation = await seedSellerResultRecovery(fixture);
  const recoveryHeader = canonicalPaymentResponseHeader({
    success: true,
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
    payer: operation.wallet,
    amount: operation.amountAtomic,
  });
  fixture.http.outcomes.push(paidObservation({
    paymentResponseHeader: recoveryHeader,
    bodyText: '{"recovered":true}',
  }));
  fixture.native.calls.length = 0;
  const restarted = makeCore({
    root: fixture.root,
    native: fixture.native,
    rpc: fixture.rpc,
    http: fixture.http,
    clock: fixture.clock,
  });

  const recovered = await restarted.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  assert.equal(operation.state, "seller_result_recovery_pending");
  assert.deepEqual(operation.attempts.map((attempt) => [attempt.purpose, attempt.phase]), [
    ["payment", "observed"],
    ["result_recovery", "observed"],
  ]);
  assert.equal(exposureStates[0]?.state, "seller_result_recovery_pending");
  assert.equal(exposureStates[0]?.attempts.at(-1)?.purpose, "result_recovery");
  assert.equal(exposureStates[0]?.attempts.at(-1)?.phase, "pending");
  assert.equal(operation.transactionHint?.source, "payment_response");
  assert.equal(operation.resultLink?.resultHash, domainHash(
    "apn.x402.result-body.v1",
    Buffer.from('{"recovered":true}', "utf8"),
  ));
  assert.deepEqual(fixture.native.calls.map((call) => call.operation), ["x402Exact.authorizationMaterial.get"]);
  assert.equal(fixture.http.calls.length, 3);

  const sendCount = fixture.http.calls.length;
  const nativeCount = fixture.native.calls.length;
  const repeated = await restarted.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(repeated.ok, true);
  assert.equal(fixture.http.calls.length, sendCount);
  assert.equal(fixture.native.calls.length, nativeCount);
  assert.equal(fixture.rpc.submissions.length, 0);
});

test("non-success cached recovery is observed without replacing proven settlement", async (t) => {
  const pendingHeader = canonicalPaymentResponseHeader({
    success: false,
    errorReason: "settlement_pending",
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
  });
  const fixture = await authorizedFixture(t, {
    paymentRequired: {
      ...X402_PAYMENT_REQUIRED,
      extensions: { "payment-identifier": paymentIdentifierDeclaration(false) },
    },
    paidOutcome: paidObservation({ status: 402, bodyText: "pending", paymentResponseHeader: pendingHeader }),
    idempotencyKey: "x402-result-recovery-non-success",
  });
  const before = await seedSellerResultRecovery(fixture);
  fixture.http.outcomes.push(paidObservation({
    status: 402,
    bodyText: "still pending",
    paymentResponseHeader: pendingHeader,
  }));

  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const after = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  assert.equal(after.state, "seller_result_recovery_pending");
  assert.equal(after.attempts.at(-1)?.purpose, "result_recovery");
  assert.equal(after.attempts.at(-1)?.phase, "observed");
  assert.equal(
    after.settlementResponseObservation?.settlementResponseHash,
    before.settlementResponseObservation?.settlementResponseHash,
  );
  assert.deepEqual(after.transactionHint, before.transactionHint);
  assert.equal(after.resultLink, undefined);
});

test("cached recovery links the designated response even when an earlier body is byte-identical", async (t) => {
  const pendingHeader = canonicalPaymentResponseHeader({
    success: false,
    errorReason: "settlement_pending",
    transaction: X402_TRANSACTION,
    network: "eip155:8453",
  });
  const fixture = await authorizedFixture(t, {
    paymentRequired: {
      ...X402_PAYMENT_REQUIRED,
      extensions: { "payment-identifier": paymentIdentifierDeclaration(false) },
    },
    paidOutcome: paidObservation({ status: 402, bodyText: "{}", paymentResponseHeader: pendingHeader }),
    idempotencyKey: "x402-result-recovery-same-body",
  });
  await seedSellerResultRecovery(fixture);
  fixture.http.outcomes.push(paidObservation({
    bodyText: "{}",
    paymentResponseHeader: canonicalPaymentResponseHeader({
      success: true,
      transaction: X402_TRANSACTION,
      network: "eip155:8453",
      payer: ACCOUNT.address.toLowerCase(),
      amount: "1250000",
    }),
  }));

  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  assert.equal(operation.resultLink?.resultHash, domainHash("apn.x402.result-body.v1", Buffer.from("{}", "utf8")));
  assert.equal(operation.settlementResponseObservation?.httpAttemptNumber, "2");
  assert.equal(operation.attempts[0]?.observation?.bodyHash, operation.attempts[1]?.observation?.bodyHash);
});

async function seedSellerResultRecovery(
  fixture: Awaited<ReturnType<typeof authorizedFixture>>,
): Promise<X402OperationRecord> {
  const first = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(first.ok, true, JSON.stringify(first));
  const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  assert.equal(operation.state, "settlement_pending");
  assert.equal(operation.resultLink, undefined);
  const evidence = settlementEvidenceFor(operation);
  const at = operation.updatedAt;
  const { integrityHash: _integrity, ...withoutIntegrity } = operation;
  const recoveryState = sealX402Operation({
    ...withoutIntegrity,
    settlementEvidence: evidence,
    state: "seller_result_recovery_pending",
    finalityClass: "known_settled",
    terminal: false,
    reason: "x402_seller_result_recovery_pending",
    proofClass: "x402_settlement_verified_result_pending",
    nextActions: ["operation.resume", "operation.status"],
    updatedAt: at,
    transitions: appendX402Transition(operation.transitions, {
      at,
      state: "seller_result_recovery_pending",
      terminal: false,
      reason: "x402_seller_result_recovery_pending",
      proofClass: "x402_settlement_verified_result_pending",
    }),
  });
  await fixture.core.context.state.writeX402Operation(recoveryState);
  return recoveryState;
}

function settlementEvidenceFor(operation: X402OperationRecord): SettlementEvidence {
  const body = {
    schemaVersion: "apn.x402.settlement-evidence.v1" as const,
    network: "eip155:8453" as const,
    chainId: "8453" as const,
    token: operation.token,
    transactionHash: X402_TRANSACTION as `0x${string}`,
    safeHead: {
      number: "12350",
      hash: `0x${"d".repeat(64)}` as `0x${string}`,
      observedAt: operation.updatedAt,
    },
    transactionBlock: {
      number: "12349",
      hash: `0x${"e".repeat(64)}` as `0x${string}`,
      timestamp: "1787702400",
    },
    receiptStatus: "1" as const,
    blockHashRechecked: true as const,
    authorizationUsed: {
      logIndex: "0",
      authorizer: operation.wallet,
      nonce: operation.authorization.nonce as `0x${string}`,
      blockNumber: "12349",
      blockHash: `0x${"e".repeat(64)}` as `0x${string}`,
      transactionHash: X402_TRANSACTION as `0x${string}`,
    },
    transfer: {
      logIndex: "1",
      from: operation.wallet,
      to: operation.payee,
      value: operation.amountAtomic,
      blockNumber: "12349",
      blockHash: `0x${"e".repeat(64)}` as `0x${string}`,
      transactionHash: X402_TRANSACTION as `0x${string}`,
    },
    authorizationState: {
      value: true as const,
      blockNumber: "12350",
      blockHash: `0x${"d".repeat(64)}` as `0x${string}`,
      blockTag: "safe" as const,
      observedAt: operation.updatedAt,
    },
    rpcOriginHash: "f".repeat(64),
  };
  return {
    ...body,
    evidenceHash: domainHash("apn.x402.settlement-evidence.v1", canonicalJson(body)),
  };
}
