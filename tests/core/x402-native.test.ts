import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData, type Address, type Hex } from "viem";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { BASE_USDC } from "../../src/constants.js";
import { ApnError } from "../../src/errors.js";
import type { NativePort, NativeRequest } from "../../src/ports.js";
import type { X402OperationRecord } from "../../src/x402-state-integrity.js";
import { TestClock, TestRpc, makeCore, temporaryState } from "./helpers.js";
import { TestHttp } from "./x402-helpers.js";
import { X402_URL } from "./x402-vectors.js";

const TEST_PRIVATE_KEY = `0x${"0".repeat(63)}1` as Hex;
const ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);

interface GoldenAuthorizationFixture {
  readonly createPayload: NativeAuthorizationPayload;
  readonly digest: string;
  readonly signature: Hex;
  readonly signatureHash: string;
  readonly effectSlot: string;
}

const GOLDEN = JSON.parse(readFileSync(join(
  process.cwd(),
  "tests/fixtures/x402/eip3009-authorization-v1.json",
), "utf8")) as GoldenAuthorizationFixture;

interface NativeAuthorizationPayload {
  readonly profile: string;
  readonly operationId: string;
  readonly fingerprint: string;
  readonly wallet: Address;
  readonly chainId: "8453";
  readonly token: Address;
  readonly resource: { readonly origin: string; readonly path: string; readonly urlHash: string };
  readonly capAtomic: string;
  readonly payee: Address;
  readonly amountAtomic: string;
  readonly tokenDomain: { readonly name: string; readonly version: string };
  readonly authorization: {
    readonly from: Address;
    readonly to: Address;
    readonly value: string;
    readonly validAfter: "0";
    readonly validBefore: string;
    readonly nonce: Hex;
    readonly createdAt: string;
  };
  readonly paymentIdentifierPosture: "absent" | "optional" | "required";
  readonly paymentIdentifierValue?: string;
  readonly offerHash: string;
  readonly intentHash: string;
  readonly expectedSignatureHash?: string;
}

interface NativeAuthorizationMaterial {
  readonly authorization: Omit<NativeAuthorizationPayload["authorization"], "createdAt">;
  readonly signature: Hex;
  readonly signatureHash: string;
}

class ExactX402Native implements NativePort {
  readonly calls: NativeRequest[] = [];
  material: NativeAuthorizationMaterial | undefined;
  loseCreateResponse = false;
  corruptNextMaterial = false;

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
    if (request.operation === "wallet.describe") {
      return {
        found: true,
        profile: request.payload.profile,
        address: ACCOUNT.address,
        createdAt: "2026-08-25T00:00:00.000Z",
        bindingHash: "a".repeat(64),
      };
    }
    if (request.operation === "x402Exact.authorizationMaterial.get") {
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
    const payload = request.payload as unknown as NativeAuthorizationPayload;
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
    const material: NativeAuthorizationMaterial = {
      authorization: this.corruptNextMaterial
        ? { ...publicAuthorization(payload), to: "0x3333333333333333333333333333333333333333" }
        : publicAuthorization(payload),
      signature,
      signatureHash: domainHash("apn.x402.signature.v1", Buffer.from(signature.slice(2), "hex")),
    };
    this.material = material;
    if (this.loseCreateResponse) {
      this.loseCreateResponse = false;
      throw new ApnError("APN_NATIVE_PROTOCOL", "Simulated lost native response.", { nativeTransport: true });
    }
    return material;
  }
}

function publicAuthorization(
  payload: NativeAuthorizationPayload,
): NativeAuthorizationMaterial["authorization"] {
  return {
    from: payload.authorization.from,
    to: payload.authorization.to,
    value: payload.authorization.value,
    validAfter: payload.authorization.validAfter,
    validBefore: payload.authorization.validBefore,
    nonce: payload.authorization.nonce,
  };
}

test("shared EIP-3009 fixture matches viem signing, intent hash, and effect slot", async () => {
  const payload = GOLDEN.createPayload;
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
  const digest = hashTypedData({
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
  assert.equal(digest, `0x${GOLDEN.digest}`);
  assert.equal(signature, GOLDEN.signature);
  assert.equal(domainHash("apn.x402.signature.v1", Buffer.from(signature.slice(2), "hex")), GOLDEN.signatureHash);
  assert.equal(domainHash("apn.x402.authorization-intent.v1", canonicalJson(payload.authorization)), payload.intentHash);
  const effectSlot = createHash("sha256").update(Buffer.concat([
    Buffer.from("apn-x402-effect-v1\0"),
    Buffer.from(payload.profile),
    Buffer.from([0]),
    Buffer.from(payload.operationId),
    Buffer.from([0]),
    Buffer.from(payload.fingerprint),
  ])).digest("hex");
  assert.equal(effectSlot, GOLDEN.effectSlot);
});

async function preparedFixture(t: TestContext): Promise<{
  readonly core: ReturnType<typeof makeCore>;
  readonly operationId: string;
  readonly native: ExactX402Native;
  readonly http: TestHttp;
  readonly clock: TestClock;
}> {
  const temporary = await temporaryState();
  t.after(temporary.cleanup);
  const native = new ExactX402Native();
  const rpc = new TestRpc();
  rpc.x402Evidence = { ...rpc.x402Evidence, address: ACCOUNT.address };
  const http = new TestHttp();
  const clock = new TestClock();
  const core = makeCore({ root: temporary.root, native, rpc, http, clock });
  const wallet = await core.execute({ command: "wallet.ensure", profile: "default" });
  assert.equal(wallet.ok, true);
  const prepared = await core.execute({
    command: "x402.fetch.prepare",
    profile: "default",
    url: X402_URL,
    maxAmountAtomic: "2000000",
    idempotencyKey: "x402-native-001",
  });
  assert.equal(prepared.ok, true);
  const operationId = (prepared.operation as { readonly operationId?: unknown } | null)?.operationId;
  assert.equal(typeof operationId, "string");
  native.calls.length = 0;
  return { core, operationId: operationId as string, native, http, clock };
}

test("x402 approve uses one narrow native create request and persists only verified public hashes", async (t) => {
  const fixture = await preparedFixture(t);
  const approved = await fixture.core.execute({
    command: "x402.fetch.approve",
    operationId: fixture.operationId,
  });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal((approved.operation as { readonly state?: unknown } | null)?.state, "authorized_not_sent");
  assert.deepEqual(fixture.native.calls.map((call) => call.operation), ["x402Exact.approveAndAuthorize"]);
  const createPayload = fixture.native.calls[0]?.payload;
  assert.deepEqual(Object.keys(createPayload ?? {}).sort(), [
    "amountAtomic", "authorization", "capAtomic", "chainId", "fingerprint", "intentHash", "offerHash",
    "operationId", "payee", "paymentIdentifierPosture", "profile", "resource", "token", "tokenDomain", "wallet",
  ]);
  assert.equal(Object.hasOwn(createPayload?.authorization as object, "intentHash"), false);
  assert.equal(fixture.http.calls.length, 1, "CP3 authorization does not make a paid HTTP request");

  const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  assert.match(operation.signatureHash ?? "", /^[a-f0-9]{64}$/u);
  assert.match(operation.paymentPayloadHash ?? "", /^[a-f0-9]{64}$/u);
  assert.match(operation.paymentHeaderHash ?? "", /^[a-f0-9]{64}$/u);
  const protectedJson = JSON.stringify(operation);
  assert.equal(protectedJson.includes(fixture.native.material?.signature ?? "CANARY"), false);
  assert.equal(protectedJson.includes(TEST_PRIVATE_KEY), false);
  assert.equal(operation.attempts.length, 0);
});

test("lost create response remains durable pending and resume recovers the same Keychain material", async (t) => {
  const fixture = await preparedFixture(t);
  fixture.native.loseCreateResponse = true;
  const first = await fixture.core.execute({
    command: "x402.fetch.approve",
    operationId: fixture.operationId,
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal((first.operation as { readonly state?: unknown } | null)?.state, "authorization_material_pending");
  assert.deepEqual(fixture.native.calls.map((call) => call.operation), ["x402Exact.approveAndAuthorize"]);

  const resumed = await fixture.core.execute({ command: "operation.resume", operationId: fixture.operationId });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal((resumed.operation as { readonly state?: unknown } | null)?.state, "authorized_not_sent");
  assert.deepEqual(fixture.native.calls.map((call) => call.operation), [
    "x402Exact.approveAndAuthorize",
    "x402Exact.authorizationMaterial.get",
  ]);
  const recoveryPayload = fixture.native.calls[1]?.payload;
  assert.deepEqual(Object.keys(recoveryPayload ?? {}).sort(), [
    "authorization", "chainId", "fingerprint", "intentHash", "operationId", "profile", "token", "tokenDomain", "wallet",
  ]);
  assert.deepEqual(Object.keys((recoveryPayload?.authorization ?? {}) as object).sort(), [
    "from", "nonce", "to", "validAfter", "validBefore", "value",
  ]);
  assert.equal(fixture.http.calls.length, 1);
});

test("native material mismatch fails closed without a paid marker or signature bytes in state", async (t) => {
  const fixture = await preparedFixture(t);
  fixture.native.corruptNextMaterial = true;
  const result = await fixture.core.execute({
    command: "x402.fetch.approve",
    operationId: fixture.operationId,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "APN_NATIVE_PROTOCOL", JSON.stringify(result));
  const operation = await fixture.core.context.state.findX402Operation(fixture.operationId) as X402OperationRecord;
  assert.equal(operation.state, "authorization_material_pending");
  assert.equal(operation.signatureHash, undefined);
  assert.equal(operation.paymentPayloadHash, undefined);
  assert.equal(operation.paymentHeaderHash, undefined);
  assert.equal(operation.attempts.length, 0);
  assert.equal(JSON.stringify(operation).includes(fixture.native.material?.signature ?? "CANARY"), false);
  assert.equal(fixture.http.calls.length, 1);
});

test("x402 approval never routes through the direct-transfer TTY native operation", async (t) => {
  const fixture = await preparedFixture(t);
  await fixture.core.execute({ command: "x402.fetch.approve", operationId: fixture.operationId });
  assert.equal(fixture.native.calls.some((call) => call.operation === "directTransfer.approveAndSign"), false);
});
