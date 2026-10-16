import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { hashObject } from "../../src/canonical.js";
import { runCli } from "../../src/cli.js";
import { STATE_VERSION } from "../../src/constants.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import { StateStore, sealWallet } from "../../src/state.js";
import { encodeCanonicalBase64Json, encodePaymentRequiredHeader, type X402PaymentRequired } from "../../src/x402-codec.js";
import { hashChallenge } from "../../src/x402-permit2/prepare.js";
import { permit2PublicRpc } from "../../src/x402-permit2/preflight.js";
import { selectPermit2Offer } from "../../src/x402-permit2/offer.js";
import { PERMIT2_ADDRESS, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "../../src/x402-permit2/registry.js";
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
  const calls: string[] = [], posts: number[] = [];
  const proxyCode = readFileSync("tests/fixtures/x402-permit2/original-proxy-runtime.hex", "utf8").trim();
  const permit2Code = readFileSync("tests/fixtures/x402-permit2/avalanche-permit2-runtime.hex", "utf8").trim();
  const rpc = { batch: async (batch: readonly { method: string; params: readonly unknown[] }[]) => {
    posts.push(batch.length);
    return batch.map(({ method, params }) => {
      calls.push(method);
      if (method === "eth_chainId") return "0xa86a";
      if (method === "eth_getBlockByNumber") return { number: "0x12", hash: `0x${"1".repeat(64)}`,
        timestamp: `0x${(Math.floor(at.getTime() / 1000) - 5).toString(16)}` };
      assert.deepEqual(params[1], { blockHash: `0x${"1".repeat(64)}`, requireCanonical: true });
      if (method === "eth_getCode") return params[0] === PERMIT2_ADDRESS ? permit2Code : proxyCode;
      if (method === "eth_call") {
        const index = calls.filter(value => value === "eth_call").length - 1;
        return [word(20000n), word(10000n), asset.tokenDomainSeparator, word(9n), word(0n)][index];
      }
      throw new Error(`Unexpected RPC method ${method}`);
    });
  } };
  const argv = ["x402", "permit2", "preflight", "--profile", "owner", "--payment-required", encodePaymentRequiredHeader(challenge),
    "--expected-challenge-hash", hashChallenge(challenge), "--expected-index", "0",
    "--expected-terms", encodeCanonicalBase64Json(selection.requirement), "--rpc-url", "https://rpc.example"];
  const options = { stateRoot: temp.root, permit2PreflightPorts: { rpc, now: () => at } };
  const result = await runCli(argv, process.env, options);
  assert.equal(result.ok, true, JSON.stringify(result.error));
  const data = result.data as Record<string, unknown>;
  assert.equal(data.state, "admissible_unsigned"); assert.equal(data.payer, payer);
  assert.equal(data.recipient, selection.payTo); assert.equal(data.amountAtomic, "10000");
  assert.deepEqual(data.blockerCodes, ["permit2_execution_not_exposed"]);
  assert.equal(JSON.stringify(result).includes("typedData"), false);
  assert.equal(JSON.stringify(result).includes("signature"), false);
  assert.equal(projectMcpTools().some(tool => tool.name === "apn_x402_permit2_preflight"), false);
  assert.equal(calls.length, 9); assert.deepEqual(posts, [2, 7], "two POSTs, no facilitator GET");
  assert.deepEqual(await snapshot(temp.root), before);

  calls.length = 0;
  const changed = [...argv]; changed[changed.indexOf("--expected-challenge-hash") + 1] = "f".repeat(64);
  const mismatch = await runCli(changed, process.env, options);
  assert.equal(mismatch.ok, false); assert.equal(mismatch.error?.details?.reason, "x402_permit2_merchant_terms_mismatch");
  assert.deepEqual(calls, []); assert.deepEqual(await snapshot(temp.root), before);

  const alteredTerms = [...argv];
  alteredTerms[alteredTerms.indexOf("--expected-terms") + 1] = encodeCanonicalBase64Json({
    ...selection.requirement, amount: "10001" });
  const termsMismatch = await runCli(alteredTerms, process.env, options);
  assert.equal(termsMismatch.ok, false);
  assert.equal(termsMismatch.error?.details?.reason, "x402_permit2_merchant_terms_mismatch");
  assert.deepEqual(calls, []); assert.deepEqual(await snapshot(temp.root), before);

  const staleCalls: string[] = [];
  const stale = await runCli(argv, process.env, { ...options, permit2PreflightPorts: {
    ...options.permit2PreflightPorts, rpc: { batch: async (batch: readonly { method: string }[]) => batch.map(({ method }) => {
      staleCalls.push(method);
      if (method === "eth_chainId") return "0xa86a";
      if (method === "eth_getBlockByNumber") return { number: "0x12", hash: `0x${"1".repeat(64)}`, timestamp: "0x1" };
      throw new Error("stale read advanced");
    }) } } });
  assert.equal(stale.ok, false); assert.equal(stale.error?.details?.reason, "x402_permit2_chain_evidence_required");
  assert.deepEqual(staleCalls, ["eth_chainId", "eth_getBlockByNumber"]);
  assert.deepEqual(await snapshot(temp.root), before);
});

test("public Permit2 reads send one batch per call through the shared transport and honor abort", async t => {
  const temp = await temporaryState(); t.after(temp.cleanup); await setup(temp.root);
  const before = await paymentSnapshot(temp.root);
  const sent: (readonly { method: string }[])[] = [];
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const source = permit2PublicRpc("https://rpc.example", temp.root, { batchCall: async (calls) => {
    sent.push(calls); if (sent.length === 2) await hold; return calls.map(() => "0xa86a");
  } });
  assert.deepEqual(await source.batch([{ method: "eth_chainId", params: [] }, { method: "eth_chainId", params: [] }], new AbortController().signal), ["0xa86a", "0xa86a"]);
  const controller = new AbortController();
  const waiting = source.batch([{ method: "eth_chainId", params: [] }], controller.signal);
  controller.abort(); release();
  await assert.rejects(waiting, /aborted/u);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(source.batch([{ method: "eth_chainId", params: [] }], aborted.signal), /aborted/u);
  assert.equal(sent.length, 2, "an already-aborted read sends nothing");
  assert.deepEqual(await paymentSnapshot(temp.root), before);
});
