import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { RELAY_ARBITRUM_USDC, RELAY_ETHEREUM_USDC_RECIPIENT } from "../../src/relay/arbitrum-usdc-ethereum-quote.js";
import { RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE, createRelayArbitrumSourceDraft,
  preflightRelayArbitrumSourceDraft, type RelayArbitrumReadCall } from "../../src/relay/arbitrum-usdc-source-draft.js";

const owner = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const now = new Date(1790347296 * 1000);
const blockHash = `0x${"12".repeat(32)}`;
const head = { number: "0x100", hash: blockHash };
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const quote = async (): Promise<any> => JSON.parse(await readFile(
  "tests/core/relay-fixtures/arbitrum-usdc-ethereum-usdc-quote-20260925.json", "utf8"));

function active(reference = RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE) {
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2",
    registryVersion: "test.arbitrum.1", publishedAt: "2026-09-25T00:00:00.000Z",
    effectiveDate: "2026-09-25", effectiveAt: "2026-09-25T00:00:00.000Z",
    expiresAt: "2026-10-03T00:00:00.000Z", chains: [{ chain: "eip155:42161", family: "evm",
      name: "Arbitrum One", assets: [{ kind: "token", identifier: RELAY_ARBITRUM_USDC, symbol: "USDC", decimals: 6,
        rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
        railCaps: { bridge: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" } },
        mechanismPins: { bridge: { provider: "relay", reference } } }] }] });
  return { profile: "default", registry, digest: registry.policyDigest, revision: 1,
    accounts: { evm: owner }, activationDigest: "a".repeat(64), activatedAt: now.toISOString() };
}

async function input() {
  return { profile: "default" as const, owner, publicAccount: owner, amountAtomic: "500000",
    minimumOutputAtomic: "94065", maxProviderFeeAtomic: "401482",
    maxApprovalNetworkFeeWei: "2000000000000", maxDepositNetworkFeeWei: "2000000000000",
    dailyUsageAtomic: "0", activePolicy: active(), rawQuote: await quote(), now };
}

test("offline source draft binds quote, policy pin, recipient and all fee ceilings without admission", async () => {
  const draft = await createRelayArbitrumSourceDraft(await input());
  assert.equal(draft.sourceChainId, 42161);
  assert.equal(draft.destinationChainId, 1);
  assert.equal(draft.recipient, RELAY_ETHEREUM_USDC_RECIPIENT);
  assert.equal(draft.orderId, (await quote()).protocol.v2.orderId);
  assert.equal(draft.executionAdmitted, false);
  assert.deepEqual(draft.nextActions, []);
  assert.ok(Object.isFrozen(draft) && Object.isFrozen(draft.rawQuote));
  assert.match(draft.integrityHash, /^[a-f0-9]{64}$/u);
});

test("source draft rejects policy, quote, owner, recipient and fee drift", async () => {
  const base = await input();
  const variants: Array<[string, (value: typeof base) => void]> = [
    ["owner mismatch", v => { v.publicAccount = RELAY_ETHEREUM_USDC_RECIPIENT; }],
    ["policy pin", v => { v.activePolicy = active("wrong-route"); }],
    ["provider fee", v => { v.maxProviderFeeAtomic = "401481"; }],
    ["approval gas", v => { v.maxApprovalNetworkFeeWei = "1"; }],
    ["deposit gas", v => { v.maxDepositNetworkFeeWei = "1"; }],
    ["daily cap", v => { v.dailyUsageAtomic = "1900000"; }],
    ["recipient", v => { v.rawQuote.protocol.v2.orderData.output.payments[0].recipient = owner; }],
    ["source token", v => { v.rawQuote.protocol.v2.orderData.inputs[0].payment.currency = owner; }],
    ["source chain", v => { v.rawQuote.steps[0].items[0].data.chainId = 1; }],
    ["approval amount", v => { v.rawQuote.steps[0].items[0].data.data = v.rawQuote.steps[0].items[0].data.data.slice(0, -1) + "1"; }],
    ["deposit order hash", v => { v.rawQuote.steps[1].items[0].data.data = v.rawQuote.steps[1].items[0].data.data.slice(0, -64) + "11".repeat(32); }],
  ];
  for (const [name, change] of variants) {
    const value = await input(); change(value);
    await assert.rejects(createRelayArbitrumSourceDraft(value), (error: unknown) => error instanceof Error, name);
  }
});

test("read-only preflight binds Arbitrum funding reads to one block and keeps dispatch disabled", async () => {
  const draft = await createRelayArbitrumSourceDraft(await input());
  let batches = 0;
  const result = await preflightRelayArbitrumSourceDraft(draft, active(), owner, "0", now, { now: () => now,
    batch: async (calls: readonly RelayArbitrumReadCall[]) => {
    batches++;
    if (batches === 1) {
      assert.deepEqual(calls.map(call => call.method), ["eth_chainId", "eth_getBlockByNumber"]);
      return ["0xa4b1", head]; // 42161
    }
    assert.deepEqual(calls.map(call => call.method), ["eth_getBlockByNumber", "eth_getBalance", "eth_call", "eth_call"]);
    for (const call of calls.slice(1)) assert.deepEqual(call.params[1], { blockHash, requireCanonical: true });
    assert.equal((calls[2]!.params[0] as { to: string }).to, RELAY_ARBITRUM_USDC);
    assert.equal((calls[3]!.params[0] as { data: string }).data.slice(0, 10), "0xdd62ed3e");
    return [head, "0x3a352944000", word(500_000n), word(0n)];
  } });
  assert.equal(batches, 2);
  assert.equal(result.fundingObserved, true);
  assert.equal(result.approvalRequired, true);
  assert.equal(result.requiredNativeWei, "4000000000000");
  assert.equal(result.executionAdmitted, false);
  assert.deepEqual(result.nextActions, []);
});

test("preflight needs deposit gas only when exact owner allowance already covers principal", async () => {
  const draft = await createRelayArbitrumSourceDraft(await input());
  const result = await preflightRelayArbitrumSourceDraft(draft, active(), owner, "0", now, {
    now: () => now,
    batch: async calls => calls.length === 2 ? ["0xa4b1", head]
      : [head, "0x1d1a94a2000", word(500_000n), word(500_000n)], // 2,000,000,000,000 wei
  });
  assert.equal(result.approvalRequired, false);
  assert.equal(result.requiredNativeWei, draft.maxDepositNetworkFeeWei);
  assert.equal(result.fundingObserved, true);
  assert.deepEqual(result.fundingReasons, []);
});

test("preflight rejects reorg after EIP-1898 pinned reads and malformed RPC results", async () => {
  const draft = await createRelayArbitrumSourceDraft(await input());
  let batches = 0;
  await assert.rejects(preflightRelayArbitrumSourceDraft(draft, active(), owner, "0", now, {
    now: () => now,
    batch: async calls => {
      batches++;
      if (batches === 1) return ["0xa4b1", head];
      assert.deepEqual(calls[0]!.params, ["0x100", false]);
      for (const call of calls.slice(1)) assert.deepEqual(call.params[1], { blockHash, requireCanonical: true });
      return [{ ...head, hash: `0x${"34".repeat(32)}` }, "0x3a352944000", word(500_000n), word(0n)];
    },
  }), { code: "APN_OPERATION_BLOCKED", details: { reason: "source_block_changed" } });
  assert.equal(batches, 2);
  for (const malformed of [{ error: { code: -32000, message: "block not found" } }, "0x1", null]) {
    await assert.rejects(preflightRelayArbitrumSourceDraft(draft, active(), owner, "0", now, {
      now: () => now,
      batch: async calls => calls.length === 2 ? ["0xa4b1", head]
        : [head, "0x3a352944000", malformed, word(0n)],
    }), { code: "APN_RPC_PROTOCOL" });
  }
});

test("preflight fails closed on chain, block, funding and draft tamper", async () => {
  const draft = await createRelayArbitrumSourceDraft(await input());
  const fail = async (responses: readonly (readonly unknown[])[]) => {
    let call = 0;
    return preflightRelayArbitrumSourceDraft(draft, active(), owner, "0", now,
      { now: () => now, batch: async () => responses[call++]! });
  };
  await assert.rejects(fail([["0x1", head]]), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(fail([["0xa4b1", head], [{ ...head, hash: `0x${"34".repeat(32)}` }, "0x1", word(500_000n), word(0n)]]),
    { code: "APN_OPERATION_BLOCKED" });
  const unfunded = await fail([["0xa4b1", head], [head, "0x0", word(1n), word(0n)]]);
  assert.deepEqual(unfunded.fundingReasons, ["insufficient_usdc_balance", "insufficient_native_fee_balance"]);
  const changed = { ...draft, orderId: `0x${"11".repeat(32)}` };
  await assert.rejects(preflightRelayArbitrumSourceDraft(changed, active(), owner, "0", now,
    { now: () => now, batch: async () => { throw new Error("RPC must not be reached"); } }), { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(preflightRelayArbitrumSourceDraft({ ...draft, destinationToken: RELAY_ARBITRUM_USDC },
    active(), owner, "0", now, { now: () => now, batch: async () => { throw new Error("RPC must not be reached"); } }),
  { code: "APN_OPERATION_BLOCKED" });
  await assert.rejects(preflightRelayArbitrumSourceDraft(draft, active(), owner, "0", now,
    { now: () => new Date(draft.deadline), batch: async calls => calls.length === 2 ? ["0xa4b1", head]
      : [head, "0x3a352944000", word(500_000n), word(0n)] }), { code: "APN_OPERATION_BLOCKED" });
});
