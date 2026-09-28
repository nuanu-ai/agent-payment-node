import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { hashObject } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import { STATE_VERSION } from "../../src/constants.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { StateStore, sealWallet } from "../../src/state.js";
import { encodeCanonicalBase64Json, encodePaymentRequiredHeader, type X402PaymentRequired } from "../../src/x402-codec.js";
import { hashChallenge } from "../../src/x402-permit2/prepare.js";
import { permit2PublicRpc } from "../../src/x402-permit2/preflight.js";
import { selectPermit2Offer } from "../../src/x402-permit2/offer.js";
import { PERMIT2_ADDRESS, PERMIT2_CODE_HASH, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const asset = X402_PERMIT2_ASSETS[0]!;
const payer = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4" as const;
const at = new Date("2026-09-23T04:00:00.000Z");
const challenge: X402PaymentRequired = { x402Version: 2, resource: { url: "https://seller.example/data" },
  accepts: [{ scheme: "exact", network: asset.chain, asset: asset.token, amount: "10000",
    payTo: "0x2222222222222222222222222222222222222222", maxTimeoutSeconds: 60,
    extra: { assetTransferMethod: "permit2" } }] };
const selection = selectPermit2Offer(challenge.accepts, payer);
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

async function setup(root: string) {
  const state = new StateStore(root), profile = "owner", createdAt = at.toISOString();
  await state.initialize();
  const bindingHash = hashObject({ profile, address: payer, createdAt });
  await state.writeWallet(sealWallet({ schemaVersion: STATE_VERSION, profile,
    profileHash: state.profileHash(profile), address: payer, createdAt, bindingHash }));
  await state.writeEncryptedWalletEnvelope(profile, { schemaVersion: "apn.wallet-envelope.v1",
    identity: { profile, address: payer, chainId: 8453, createdAt, bindingHash },
    kdf: { name: "HKDF-SHA-256", salt: "fixture" },
    cipher: { name: "AES-256-GCM", nonce: "fixture", ciphertext: "fixture", tag: "fixture" } });
  await activateDirectPolicy(root, profile, { accounts: { evm: payer }, now: at,
    admissions: [{ chain: asset.chain, kind: "token", identifier: asset.token, rail: "x402",
      maximumPerTransferAtomic: "20000", dailyLimitAtomic: "30000", mechanism: X402_PERMIT2_MECHANISM }] });
}

async function snapshot(root: string): Promise<readonly (readonly [string, string])[]> {
  const paths = (await readdir(root, { recursive: true })).sort();
  return await Promise.all(paths.map(async path => {
    const full = join(root, path), info = await stat(full);
    return [path, info.isFile() ? (await readFile(full)).toString("hex") : "directory"] as const;
  }));
}

async function paymentSnapshot(root: string) {
  return (await snapshot(root)).filter(([path]) => path !== "locks" && !path.startsWith("locks/") &&
    path !== "rpc-provider-pacing" && !path.startsWith("rpc-provider-pacing/"));
}

test("CLI current-owner preflight is admissible and leaves no journal, POST, signature or send", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); await setup(temp.root);
  const before = await snapshot(temp.root);
  const calls: string[] = [], http: string[] = [];
  const rpc = { call: async (method: string, params: readonly unknown[]) => {
    calls.push(method);
    if (method === "eth_chainId") return "0xa86a";
    if (method === "eth_getBlockByNumber") return { number: "0x12", hash: `0x${"1".repeat(64)}`,
      timestamp: `0x${(Math.floor(at.getTime() / 1000) - 5).toString(16)}` };
    if (method === "eth_call") {
      const index = calls.filter(value => value === "eth_call").length - 1;
      assert.equal(params[1], "0x12");
      return [word(20000n), word(10000n), asset.tokenDomainSeparator, word(9n), word(0n)][index];
    }
    if (method === "eth_getProof") return { address: params[0],
      codeHash: params[0] === PERMIT2_ADDRESS ? PERMIT2_CODE_HASH : asset.proxyCodeHash };
    throw new Error(`Unexpected RPC method ${method}`);
  } };
  const transport = { request: async (_url: string, method: string, body: unknown) => {
    http.push(method); assert.equal(method, "GET"); assert.equal(body, null);
    return { status: 200, body: JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: asset.chain }],
      extensions: [] }) };
  } };
  const argv = ["x402", "permit2", "preflight", "--profile", "owner", "--payment-required", encodePaymentRequiredHeader(challenge),
    "--expected-challenge-hash", hashChallenge(challenge), "--expected-index", "0",
    "--expected-terms", encodeCanonicalBase64Json(selection.requirement), "--rpc-url", "https://rpc.example"];
  const options = { stateRoot: temp.root, permit2PreflightPorts: { rpc, transport, now: () => at } };
  const result = await runCli(argv, process.env, options);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const data = result.data as Record<string, unknown>;
  assert.equal(data.state, "admissible_unsigned"); assert.equal(data.payer, payer);
  assert.equal(data.recipient, selection.payTo); assert.equal(data.amountAtomic, "10000");
  assert.deepEqual(data.blockerCodes, ["permit2_execution_not_exposed"]);
  assert.equal(JSON.stringify(result).includes("typedData"), false);
  assert.equal(JSON.stringify(result).includes("signature"), false);
  assert.equal(projectMcpTools().some(tool => tool.name === "apn_x402_permit2_preflight"), false);
  assert.equal(calls.length, 10); assert.deepEqual(http, ["GET"]);
  assert.deepEqual(await snapshot(temp.root), before);

  calls.length = 0; http.length = 0;
  const changed = [...argv]; changed[changed.indexOf("--expected-challenge-hash") + 1] = "f".repeat(64);
  const mismatch = await runCli(changed, process.env, options);
  assert.equal(mismatch.ok, false); assert.equal(mismatch.error?.details?.reason, "x402_permit2_merchant_terms_mismatch");
  assert.deepEqual(calls, []); assert.deepEqual(http, []); assert.deepEqual(await snapshot(temp.root), before);

  const alteredTerms = [...argv];
  alteredTerms[alteredTerms.indexOf("--expected-terms") + 1] = encodeCanonicalBase64Json({
    ...selection.requirement, amount: "10001" });
  const termsMismatch = await runCli(alteredTerms, process.env, options);
  assert.equal(termsMismatch.ok, false);
  assert.equal(termsMismatch.error?.details?.reason, "x402_permit2_merchant_terms_mismatch");
  assert.deepEqual(calls, []); assert.deepEqual(http, []); assert.deepEqual(await snapshot(temp.root), before);

  const staleCalls: string[] = [];
  const stale = await runCli(argv, process.env, { ...options, permit2PreflightPorts: {
    ...options.permit2PreflightPorts, rpc: { call: async (method: string) => {
      staleCalls.push(method);
      if (method === "eth_chainId") return "0xa86a";
      if (method === "eth_getBlockByNumber") return { number: "0x12", hash: `0x${"1".repeat(64)}`, timestamp: "0x1" };
      throw new Error("stale read advanced");
    } } } });
  assert.equal(stale.ok, false); assert.equal(stale.error?.details?.reason, "x402_permit2_chain_evidence_required");
  assert.deepEqual(staleCalls, ["eth_chainId", "eth_getBlockByNumber"]);
  assert.deepEqual(http, []); assert.deepEqual(await snapshot(temp.root), before);
});

test("separate RPC sources share durable 750 ms endpoint pacing and leave other endpoints independent", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); await setup(temp.root);
  const before = await paymentSnapshot(temp.root);
  const starts: number[] = [], otherStarts: number[] = [];
  const sameTransport = { permit2ReadCall: async () => { starts.push(performance.now()); return "0xa86a"; } };
  const otherTransport = { permit2ReadCall: async () => { otherStarts.push(performance.now()); return "0xa86a"; } };
  const first = permit2PublicRpc("https://RPC.example:443/", temp.root, sameTransport);
  const second = permit2PublicRpc("https://rpc.example", temp.root, sameTransport);
  const other = permit2PublicRpc("https://other-rpc.example", temp.root, otherTransport);
  const signal = new AbortController().signal;
  await Promise.all([
    first.call("eth_chainId", [], signal), second.call("eth_chainId", [], signal),
    other.call("eth_chainId", [], signal),
  ]);
  assert.equal(starts.length, 2);
  assert.ok(starts[1]! - starts[0]! >= 740, `same endpoint gap ${starts[1]! - starts[0]!}`);
  assert.equal(otherStarts.length, 1);
  assert.ok(Math.abs(otherStarts[0]! - starts[0]!) < 300, "another endpoint is not queued behind the first");
  assert.equal((await readdir(join(temp.root, "rpc-provider-pacing"))).length, 2);
  assert.deepEqual(await paymentSnapshot(temp.root), before);
});

test("cancelling a queued public RPC read removes it without a transport call", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); await setup(temp.root);
  const before = await paymentSnapshot(temp.root);
  let calls = 0;
  const transport = { permit2ReadCall: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 100)); return "0xa86a"; } };
  const first = permit2PublicRpc("https://cancel-rpc.example", temp.root, transport);
  const second = permit2PublicRpc("https://cancel-rpc.example/", temp.root, transport);
  const active = first.call("eth_chainId", [], new AbortController().signal);
  const cancelled = new AbortController();
  const waiting = second.call("eth_chainId", [], cancelled.signal);
  cancelled.abort();
  await assert.rejects(waiting, /aborted/u);
  await active;
  assert.equal(calls, 1);
  assert.deepEqual(await paymentSnapshot(temp.root), before);
});
