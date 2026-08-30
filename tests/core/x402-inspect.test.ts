import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { ApnCore } from "../../src/core.js";
import { canonicalJson, domainHash } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { sameIpAddress } from "../../src/network-policy.js";
import type { NativePort, NativeRequest, RpcPort } from "../../src/ports.js";
import { HttpsBaseRpc, isPublicIp } from "../../src/rpc.js";
import { StateStore } from "../../src/state.js";
import {
  decodeCanonicalBase64Json,
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodeCanonicalBase64Json,
  encodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
  inspectCandidates,
} from "../../src/x402-codec.js";
import { HttpsX402Http, inspectX402, SELLER_RESPONSE_MAX_HEADER_BYTES } from "../../src/x402-http.js";
import type { InspectResult } from "../../src/x402-model.js";
import { challengeObservation, TestHttp } from "./x402-helpers.js";
import {
  canonicalPaymentRequiredHeader,
  canonicalPaymentSignatureHeader,
  PAYMENT_IDENTIFIER_SCHEMA,
  paymentIdentifierDeclaration,
  X402_PAYMENT_REQUIRED,
  X402_PAYMENT_PAYLOAD,
  X402_PAYER,
  X402_REQUIREMENTS,
  X402_SIGNATURE,
  X402_URL,
} from "./x402-vectors.js";
import { temporaryState } from "./helpers.js";

const NEVER_NATIVE: NativePort = {
  async request(_request: NativeRequest): Promise<unknown> {
    throw new Error("inspect must not call native");
  },
};

const NEVER_RPC = new Proxy({}, {
  get() { throw new Error("inspect must not access RPC"); },
}) as RpcPort;

test("official-shape canonical PAYMENT-REQUIRED round-trips through the strict codec", () => {
  const encoded = encodeCanonicalBase64Json(X402_PAYMENT_REQUIRED);
  assert.equal(encoded, canonicalPaymentRequiredHeader());
  assert.equal(encodePaymentRequiredHeader({
    ...X402_PAYMENT_REQUIRED,
    resource: { ...X402_PAYMENT_REQUIRED.resource },
    accepts: [{ ...X402_REQUIREMENTS, extra: { ...X402_REQUIREMENTS.extra } }],
  }), encoded);
  assert.deepEqual(decodeCanonicalBase64Json(encoded), X402_PAYMENT_REQUIRED);
  const decoded = decodePaymentRequiredHeader(encoded);
  assert.equal(decoded.x402Version, 2);
  assert.deepEqual(decoded.accepts, [X402_REQUIREMENTS]);
});

test("standard v2 challenge keeps error and offer order while filtering unsupported mechanisms", () => {
  const mixedAsset = `0x${X402_REQUIREMENTS.asset.slice(2).toUpperCase()}`;
  const mixedPayTo = `0x${"aA".repeat(20)}`;
  const supported = {
    ...X402_REQUIREMENTS,
    asset: mixedAsset,
    payTo: mixedPayTo,
    extra: {
      ...X402_REQUIREMENTS.extra,
      assetTransferMethod: "eip3009",
      paymentFlow: "authorization",
    },
  };
  const challenge = {
    ...X402_PAYMENT_REQUIRED,
    error: "payment-signature is required",
    accepts: [
      {
        scheme: "exact",
        network: "solana:mainnet",
        amount: "1000",
        asset: "USDC",
        payTo: "7EcDXy7YJ6VAXhTgVxpVz4v8n8vYt3RwX6fPnSH6q2Yr",
        maxTimeoutSeconds: 60,
        extra: { feePayer: "seller", transactionFormat: "base64" },
      },
      {
        ...X402_REQUIREMENTS,
        extra: {
          ...X402_REQUIREMENTS.extra,
          assetTransferMethod: "permit2",
          permit2Address: "0x000000000022d473030f116ddee9f6b43ac78ba3",
        },
      },
      supported,
    ],
    extensions: { "future-standard-extension": { info: { required: false } } },
  };

  const decoded = decodePaymentRequiredHeader(canonicalPaymentRequiredHeader(challenge));
  assert.equal(decoded.error, challenge.error);
  assert.deepEqual(decoded.accepts, challenge.accepts, "unsupported standard offers remain available for original-index binding");
  assert.equal(decoded.extensions, undefined, "unimplemented extension namespaces are safely ignored");

  const candidates = inspectCandidates(decoded, X402_URL);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.index, "2");
  assert.equal(candidates[0]?.asset, mixedAsset.toLowerCase());
  assert.equal(candidates[0]?.payTo, mixedPayTo.toLowerCase());
  assert.equal(candidates[0]?.offerHash, domainHash("apn.x402.offer.v1", canonicalJson(supported)));
});

test("unsupported-offer filtering retains standard envelope and selected-offer strictness", () => {
  const permit2 = {
    ...X402_REQUIREMENTS,
    extra: {
      ...X402_REQUIREMENTS.extra,
      assetTransferMethod: "permit2",
      arbitraryPermit2Data: { witness: true },
    },
  };
  const malformedEip3009 = {
    ...X402_REQUIREMENTS,
    extra: { ...X402_REQUIREMENTS.extra, assetTransferMethod: "eip3009", unexpected: true },
  };
  const malformedFlow = {
    ...X402_REQUIREMENTS,
    extra: { ...X402_REQUIREMENTS.extra, paymentFlow: null },
  };
  const decoded = decodePaymentRequiredHeader(canonicalPaymentRequiredHeader({
    ...X402_PAYMENT_REQUIRED,
    accepts: [permit2, malformedEip3009, malformedFlow, X402_REQUIREMENTS],
  }));
  assert.deepEqual(inspectCandidates(decoded, X402_URL).map(({ index }) => index), ["3"]);

  for (const challenge of [
    { ...X402_PAYMENT_REQUIRED, error: 402 },
    {
      ...X402_PAYMENT_REQUIRED,
      accepts: [{
        scheme: "exact",
        network: "solana:mainnet",
        amount: 1,
        asset: "USDC",
        payTo: "seller",
        maxTimeoutSeconds: 60,
        extra: { arbitrary: true },
      }],
    },
  ]) assert.throws(() => decodePaymentRequiredHeader(canonicalPaymentRequiredHeader(challenge)), ApnError);
});

test("strict wire rejects malformed base64, duplicate JSON keys, unsafe numbers, and unknown fields", () => {
  const padded = Buffer.from(`${JSON.stringify(X402_PAYMENT_REQUIRED)} `, "utf8").toString("base64");
  for (const header of [
    ` ${canonicalPaymentRequiredHeader()}`,
    padded.replace(/=+$/u, ""),
    canonicalPaymentRequiredHeader().replace(/A/u, "-"),
    Buffer.from('{"x402Version":2,"x402Version":2,"resource":{},"accepts":[]}', "utf8").toString("base64"),
    Buffer.from('{"x402Version":9007199254740992,"resource":{},"accepts":[]}', "utf8").toString("base64"),
    Buffer.from([0xff]).toString("base64"),
    canonicalPaymentRequiredHeader().slice(0, -4),
    canonicalPaymentRequiredHeader({ ...X402_PAYMENT_REQUIRED, resource: { ...X402_PAYMENT_REQUIRED.resource, description: "x".repeat(49 * 1024) } }),
    canonicalPaymentRequiredHeader({ ...X402_PAYMENT_REQUIRED, accepts: Array.from({ length: 17 }, () => X402_REQUIREMENTS) }),
    canonicalPaymentRequiredHeader({ ...X402_PAYMENT_REQUIRED, unexpected: true }),
    canonicalPaymentRequiredHeader({ ...X402_PAYMENT_REQUIRED, accepts: [{ ...X402_REQUIREMENTS, renamedFlow: "authorization" }] }),
    canonicalPaymentRequiredHeader({ ...X402_PAYMENT_REQUIRED, accepts: [{ ...X402_REQUIREMENTS, amount: 1 }] }),
  ]) assert.throws(() => decodePaymentRequiredHeader(header), ApnError, header.slice(0, 32));
});

test("payment-identifier stays strict while unknown challenge extensions are ignored", () => {
  for (const required of [false, true]) {
    const decoded = decodePaymentRequiredHeader(canonicalPaymentRequiredHeader({
      ...X402_PAYMENT_REQUIRED,
      extensions: { "payment-identifier": paymentIdentifierDeclaration(required) },
    }));
    assert.deepEqual(decoded.extensions, {
      "payment-identifier": paymentIdentifierDeclaration(required),
    });
  }

  const malformedDeclarations: readonly unknown[] = [
    null,
    { info: null, schema: PAYMENT_IDENTIFIER_SCHEMA },
    { info: { requiredFlag: true }, schema: PAYMENT_IDENTIFIER_SCHEMA },
    { info: { required: true, unexpected: true }, schema: PAYMENT_IDENTIFIER_SCHEMA },
    { info: { required: true }, schema: null },
    { info: { required: true }, schema: { ...PAYMENT_IDENTIFIER_SCHEMA, $schema: "renamed" } },
    { info: { required: true }, schema: { ...PAYMENT_IDENTIFIER_SCHEMA, unexpected: true } },
    {
      info: { required: true },
      schema: {
        ...PAYMENT_IDENTIFIER_SCHEMA,
        properties: {
          ...PAYMENT_IDENTIFIER_SCHEMA.properties,
          id: { ...PAYMENT_IDENTIFIER_SCHEMA.properties.id, minLength: 15 },
        },
      },
    },
    { info: { required: true }, schema: { ...PAYMENT_IDENTIFIER_SCHEMA, required: ["renamed"] } },
  ];
  for (const declaration of malformedDeclarations) {
    const header = canonicalPaymentRequiredHeader({
      ...X402_PAYMENT_REQUIRED,
      extensions: { "payment-identifier": declaration },
    });
    assert.throws(() => decodePaymentRequiredHeader(header), ApnError);
  }
  assert.equal(decodePaymentRequiredHeader(canonicalPaymentRequiredHeader({
    ...X402_PAYMENT_REQUIRED,
    extensions: { "payment-identifier-renamed": paymentIdentifierDeclaration(false) },
  })).extensions, undefined);
  assert.deepEqual(decodePaymentRequiredHeader(canonicalPaymentRequiredHeader({
    ...X402_PAYMENT_REQUIRED,
    extensions: {
      "payment-identifier": paymentIdentifierDeclaration(false),
      "future-standard-extension": { arbitrary: true },
    },
  })).extensions, { "payment-identifier": paymentIdentifierDeclaration(false) });
  assert.throws(() => decodePaymentRequiredHeader(canonicalPaymentRequiredHeader({
    ...X402_PAYMENT_REQUIRED,
    extensions: null,
  })), ApnError);
});

test("PAYMENT-SIGNATURE is canonical strict exact-EVM PaymentPayload before transport", async () => {
  const encoded = canonicalPaymentSignatureHeader();
  assert.equal(encodePaymentSignatureHeader(X402_PAYMENT_PAYLOAD), encoded);
  assert.deepEqual(decodePaymentSignatureHeader(encoded), X402_PAYMENT_PAYLOAD);

  const nonCanonicalHeaders = [
    Buffer.from(` ${JSON.stringify(X402_PAYMENT_PAYLOAD)}\n`, "utf8").toString("base64"),
    Buffer.from(JSON.stringify({
      payload: X402_PAYMENT_PAYLOAD.payload,
      x402Version: X402_PAYMENT_PAYLOAD.x402Version,
      resource: X402_PAYMENT_PAYLOAD.resource,
      accepted: X402_PAYMENT_PAYLOAD.accepted,
    }), "utf8").toString("base64"),
  ];
  for (const header of nonCanonicalHeaders) {
    const compatible = decodePaymentSignatureHeader(header);
    assert.deepEqual(compatible, X402_PAYMENT_PAYLOAD, "official-shape decode remains compatible");
    assert.notEqual(encodePaymentSignatureHeader(compatible), header, "outbound bytes must canonicalize recursively");
  }

  const paymentId = `apn_${"a".repeat(64)}`;
  const declaration = paymentIdentifierDeclaration(false);
  const withPaymentId = {
    ...X402_PAYMENT_PAYLOAD,
    extensions: {
      "payment-identifier": {
        ...declaration,
        info: { required: false, id: paymentId },
      },
    },
  };
  assert.deepEqual(decodePaymentSignatureHeader(canonicalPaymentSignatureHeader(withPaymentId)), withPaymentId);

  const highSignature = `0x${"0".repeat(63)}1${"f".repeat(64)}1b`;
  const malformedPayloads: readonly unknown[] = [
    { ...X402_PAYMENT_PAYLOAD, unexpected: true },
    { ...X402_PAYMENT_PAYLOAD, x402Version: 1 },
    { ...X402_PAYMENT_PAYLOAD, resource: null },
    { ...X402_PAYMENT_PAYLOAD, accepted: { ...X402_REQUIREMENTS, scheme: "upto" } },
    { ...X402_PAYMENT_PAYLOAD, accepted: { ...X402_REQUIREMENTS, network: "eip155:1" } },
    { ...X402_PAYMENT_PAYLOAD, payload: { ...X402_PAYMENT_PAYLOAD.payload, unexpected: true } },
    { ...X402_PAYMENT_PAYLOAD, payload: { ...X402_PAYMENT_PAYLOAD.payload, signature: "arbitrary" } },
    { ...X402_PAYMENT_PAYLOAD, payload: { ...X402_PAYMENT_PAYLOAD.payload, signature: highSignature } },
    {
      ...X402_PAYMENT_PAYLOAD,
      payload: { ...X402_PAYMENT_PAYLOAD.payload, authorization: { ...X402_PAYMENT_PAYLOAD.payload.authorization, sender: X402_PAYER } },
    },
    {
      ...X402_PAYMENT_PAYLOAD,
      payload: { ...X402_PAYMENT_PAYLOAD.payload, authorization: { ...X402_PAYMENT_PAYLOAD.payload.authorization, from: `0x${"0".repeat(40)}` } },
    },
    {
      ...X402_PAYMENT_PAYLOAD,
      payload: { ...X402_PAYMENT_PAYLOAD.payload, authorization: { ...X402_PAYMENT_PAYLOAD.payload.authorization, to: X402_PAYER } },
    },
    {
      ...X402_PAYMENT_PAYLOAD,
      payload: { ...X402_PAYMENT_PAYLOAD.payload, authorization: { ...X402_PAYMENT_PAYLOAD.payload.authorization, value: "2" } },
    },
    {
      ...X402_PAYMENT_PAYLOAD,
      payload: { ...X402_PAYMENT_PAYLOAD.payload, authorization: { ...X402_PAYMENT_PAYLOAD.payload.authorization, validAfter: "1" } },
    },
    {
      ...X402_PAYMENT_PAYLOAD,
      payload: { ...X402_PAYMENT_PAYLOAD.payload, authorization: { ...X402_PAYMENT_PAYLOAD.payload.authorization, validBefore: "0" } },
    },
    {
      ...X402_PAYMENT_PAYLOAD,
      payload: { ...X402_PAYMENT_PAYLOAD.payload, authorization: { ...X402_PAYMENT_PAYLOAD.payload.authorization, nonce: `0x${"AB".repeat(32)}` } },
    },
    { ...X402_PAYMENT_PAYLOAD, extensions: { "payment-identifier": declaration } },
    {
      ...X402_PAYMENT_PAYLOAD,
      extensions: { "payment-identifier": { ...declaration, info: { required: false, id: "short" } } },
    },
  ];
  for (const payload of malformedPayloads) {
    assert.throws(() => decodePaymentSignatureHeader(canonicalPaymentSignatureHeader(payload)), ApnError);
  }
  for (const header of [
    "arbitrary",
    canonicalPaymentSignatureHeader().slice(0, -4),
    Buffer.from([0xff]).toString("base64"),
    Buffer.from('{"x402Version":2,"x402Version":2}', "utf8").toString("base64"),
  ]) assert.throws(() => decodePaymentSignatureHeader(header), ApnError);

  const source = await readFile("src/x402-http.ts", "utf8");
  const validation = source.indexOf("decodePaymentSignatureHeader(request.paymentSignature)");
  const canonicality = source.indexOf("encodePaymentSignatureHeader(decodedPaymentSignature) !== request.paymentSignature");
  const network = source.indexOf("this.resolveAddresses(endpoint");
  assert.ok(
    validation >= 0 && canonicality > validation && network > canonicality,
    "paid header validation and canonical byte equality must precede DNS/TLS I/O",
  );
  assert.equal(X402_SIGNATURE.length, 132);
});

test("seller parser admits spec-valid headers above Node's default before APN applies its limits", async (t) => {
  assert.equal(SELLER_RESPONSE_MAX_HEADER_BYTES, 128 * 1024);
  const largeRequirement = {
    scheme: "s".repeat(64),
    network: "n".repeat(128),
    amount: "9".repeat(128),
    asset: "a".repeat(256),
    payTo: "p".repeat(256),
    maxTimeoutSeconds: 300,
    extra: {
      name: "n".repeat(128),
      version: "v".repeat(128),
      assetTransferMethod: "m".repeat(64),
      paymentFlow: "f".repeat(64),
    },
  };
  const largeHeader = canonicalPaymentRequiredHeader({
    ...X402_PAYMENT_REQUIRED,
    resource: { ...X402_PAYMENT_REQUIRED.resource, description: "d".repeat(512) },
    accepts: [X402_REQUIREMENTS, ...Array.from({ length: 15 }, () => largeRequirement)],
  });
  assert.ok(Buffer.byteLength(largeHeader, "utf8") > 16 * 1024);
  assert.ok(Buffer.byteLength(largeHeader, "utf8") <= 64 * 1024);

  const server = createServer((_request, response) => {
    response.writeHead(402, { "PAYMENT-REQUIRED": largeHeader });
    response.end();
  });
  t.after(async () => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const rawHeaders = await new Promise<readonly string[]>((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/",
      maxHeaderSize: SELLER_RESPONSE_MAX_HEADER_BYTES,
    }, (response) => {
      const received = [...response.rawHeaders];
      response.resume();
      response.once("end", () => resolve(received));
    });
    request.once("error", reject);
    request.end();
  });
  const rawHeaderPairs: Array<readonly [string, string]> = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    assert.ok(name !== undefined && value !== undefined);
    rawHeaderPairs.push([name, value]);
  }
  const result = await inspectX402(new TestHttp(challengeObservation({ rawHeaderPairs })), X402_URL);
  assert.equal(result.candidates.length, 1);

  const source = await readFile("src/x402-http.ts", "utf8");
  assert.match(source, /maxHeaderSize:\s*SELLER_RESPONSE_MAX_HEADER_BYTES/u);

  await assert.rejects(inspectX402(new TestHttp(challengeObservation({
    rawHeaderPairs: [["PAYMENT-REQUIRED", "A".repeat(64 * 1024 + 1)]],
  })), X402_URL), ApnError);
});

test("public-address policy follows fail-closed IPv4 and IPv6 special-use boundaries", () => {
  for (const address of [
    "1.1.1.1",
    "8.8.8.8",
    "192.0.0.9",
    "192.0.0.10",
    "192.0.1.1",
    "192.31.196.1",
    "198.51.99.1",
    "203.0.114.1",
    "2606:4700:4700::1111",
    "2606:4700:4700:0000:0000:0000:0000:1111",
    "2001:4860:4860::8888",
    "2001:3::1",
    "2001:4:112::1",
    "2001:30::1",
  ]) assert.equal(isPublicIp(address), true, address);

  for (const address of [
    "0.0.0.1", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1",
    "172.16.0.1", "192.0.0.8", "192.0.0.170", "192.0.2.1", "192.88.99.1",
    "192.168.0.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1",
    "239.255.255.255", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:8.8.8.8", "0000:0000:0000:0000:0000:ffff:0808:0808",
    "64:ff9b::808:808", "64:ff9b:1::1", "100::1", "100:0:0:1::1", "2001::1",
    "2001:2::1", "2001:0002:0000:0000:0000:0000:0000:0001", "2001:10::1",
    "2001:20::1", "2001:0020:0000:0000:0000:0000:0000:0001", "2001:db8::1",
    "2001:0db8:0000:0000:0000:0000:0000:0001", "2002::1", "3fff::1", "5f00::1",
    "fc00::1", "fd00::1", "fe80::1", "fec0::1", "ff00::1", "not-an-ip",
  ]) assert.equal(isPublicIp(address), false, address);
  assert.equal(sameIpAddress("2606:4700:4700::1111", "2606:4700:4700:0000:0000:0000:0000:1111"), true);
  assert.equal(sameIpAddress("2606:4700:4700::1111", "2606:4700:4700::1001"), false);
});

test("seller transport pins built-in trust and preserves hostname plus IP pinning", async () => {
  const source = await readFile("src/x402-http.ts", "utf8");
  assert.match(source, /rejectUnauthorized:\s*true/u);
  assert.match(source, /ca:\s*\[\.\.\.rootCertificates\]/u);
  assert.match(source, /servername:/u);
  assert.match(source, /sameIpAddress\(socket\.remoteAddress, selected\.address\)/u);
  assert.doesNotMatch(source, /NODE_(?:TLS_REJECT_UNAUTHORIZED|EXTRA_CA_CERTS)/u);
});

test("seller URL cap does not change pre-existing RPC URL parsing", async () => {
  const longRpcUrl = `https://rpc.example/${"a".repeat(4096)}`;
  const rpc = new HttpsBaseRpc(longRpcUrl);
  assert.equal(rpc.endpoint.toString(), longRpcUrl);
  await assert.rejects(new HttpsX402Http().get({ url: longRpcUrl }), ApnError);
});

test("inspect performs one unpaid GET, preserves compatible seller order, and has zero state/native/RPC/payment effects", async (t) => {
  const state = await temporaryState();
  t.after(state.cleanup);
  const { extra: _omittedExtra, ...requirementsWithoutExtra } = X402_REQUIREMENTS;
  const challenge = {
    ...X402_PAYMENT_REQUIRED,
    accepts: [
      requirementsWithoutExtra,
      { ...X402_REQUIREMENTS, scheme: "upto" },
      { ...X402_REQUIREMENTS, amount: "999999999999999999999", extra: { name: "Wrong Onchain Name", version: "999" } },
      { ...X402_REQUIREMENTS, amount: "2", payTo: "0x3333333333333333333333333333333333333333" },
    ],
  };
  const http = new TestHttp(challengeObservation({ header: canonicalPaymentRequiredHeader(challenge) }));
  const core = new ApnCore({
    state: new StateStore(state.root),
    http,
    native: NEVER_NATIVE,
    rpc: NEVER_RPC,
    ids: { next: () => "12345678-1234-4234-8234-123456789abc" },
  });

  const envelope = await core.execute({ command: "x402.inspect", url: X402_URL });
  assert.equal(envelope.ok, true);
  assert.equal(envelope.operation, null);
  assert.equal(envelope.receipt, null);
  const result = envelope.data as InspectResult;
  assert.equal(result.kind, "x402_inspection");
  assert.deepEqual(result.resource, {
    origin: "https://seller.example",
    path: "/resource",
    urlHash: result.resource.urlHash,
  });
  assert.equal(result.resource.urlHash.length, 64);
  assert.deepEqual(result.candidates.map((candidate) => candidate.amountAtomic), ["999999999999999999999", "2"]);
  assert.deepEqual(result.candidates.map((candidate) => candidate.index), ["2", "3"]);
  for (const candidate of result.candidates) {
    assert.deepEqual(candidate.readiness, {
      cap: "unverified",
      walletBalance: "unverified",
      tokenDomain: "unverified",
      payment: "unverified",
    });
  }
  assert.deepEqual(http.calls, [{ url: X402_URL }]);
  await assert.rejects(access(state.root));
});

test("inspect rejects an unsupported-only challenge after one unpaid GET and no other effect", async (t) => {
  const state = await temporaryState();
  t.after(state.cleanup);
  const http = new TestHttp(challengeObservation({
    header: canonicalPaymentRequiredHeader({
      ...X402_PAYMENT_REQUIRED,
      accepts: [{ ...X402_REQUIREMENTS, network: "eip155:1" }],
    }),
  }));
  const core = new ApnCore({
    state: new StateStore(state.root),
    http,
    native: NEVER_NATIVE,
    rpc: NEVER_RPC,
    ids: { next: () => "12345678-1234-4234-8234-123456789abc" },
  });
  const envelope = await core.execute({ command: "x402.inspect", url: X402_URL });
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error?.code, "APN_X402_UNSUPPORTED_OFFER");
  assert.deepEqual(http.calls, [{ url: X402_URL }]);
  await assert.rejects(access(state.root));
});

test("inspect fails closed for duplicate/folded control headers and non-402 or changed targets", async (t) => {
  const state = await temporaryState();
  t.after(state.cleanup);
  const cases = [
    challengeObservation({ rawHeaderPairs: [["PAYMENT-REQUIRED", canonicalPaymentRequiredHeader()], ["payment-required", canonicalPaymentRequiredHeader()]] }),
    challengeObservation({ rawHeaderPairs: [["PAYMENT-REQUIRED", `${canonicalPaymentRequiredHeader()},${canonicalPaymentRequiredHeader()}`]] }),
    challengeObservation({ rawHeaderPairs: [["PAYMENT-REQUIRED", ` ${canonicalPaymentRequiredHeader()}`]] }),
    challengeObservation({ rawHeaderPairs: [["PAYMENT-REQUIRED", canonicalPaymentRequiredHeader()], ["PAYMENT-RESPONSE", "one"], ["payment-response", "two"]] }),
    challengeObservation({ rawHeaderPairs: [["PAYMENT-REQUIRED", canonicalPaymentRequiredHeader()], ["PAYMENT-SIGNATURE", " folded"]] }),
    challengeObservation({ status: 200 }),
    challengeObservation({ finalUrl: "https://other.example/resource" }),
  ];
  for (const response of cases) {
    const http = new TestHttp(response);
    const core = new ApnCore({ state: new StateStore(state.root), http, ids: { next: () => "12345678-1234-4234-8234-123456789abc" } });
    const envelope = await core.execute({ command: "x402.inspect", url: X402_URL });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.operation, null);
    assert.equal(envelope.receipt, null);
    assert.equal(http.calls.length, 1);
  }
  await assert.rejects(access(state.root));
});

test("production seller adapter is GET-only and rejects non-public or credential-bearing targets before I/O", async () => {
  const http = new HttpsX402Http();
  for (const url of [
    "http://seller.example/resource",
    "https://user:secret@seller.example/resource",
    "https://seller.example/resource#fragment",
    "https://127.0.0.1/resource",
    "https://10.0.0.1/resource",
    "https://[::1]/resource",
  ]) await assert.rejects(http.get({ url }), ApnError, url);
});

test("CLI parses only the GET-only effect-free inspect surface", async () => {
  const { parseArgv } = await import("../../src/cli.js");
  assert.deepEqual(parseArgv(["x402", "inspect", "--url", X402_URL]), {
    request: { command: "x402.inspect", url: X402_URL },
  });
  assert.throws(() => parseArgv(["x402", "inspect", "--url", X402_URL, "--rpc-url", "https://rpc.example"]), ApnError);
  assert.throws(() => parseArgv(["x402", "inspect", "--url", X402_URL, "--max-amount-atomic", "1"]), ApnError);
  assert.throws(() => parseArgv(["x402", "inspect", "--url", X402_URL, "--method", "HEAD"]), ApnError);
});
