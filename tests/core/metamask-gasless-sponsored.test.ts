import { hashObject, sha256 } from "../../src/canonical.js";
import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, parseAbi, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyRedemption } from "../../src/metamask-gasless/chain/delegation.js";
import { MetaMaskGaslessRpc } from "../../src/metamask-gasless/chain/rpc.js";
import { MM_SINGLE_ENFORCER, mmProtocolPins } from "../../src/metamask-gasless/single-protocol.js";
import { validateMetaMaskGaslessSnapshot } from "../../src/metamask-gasless/chain/snapshot.js";
import { MM_DELEGATION_PARAMETER } from "../../src/metamask-gasless/chain/abi.js";
import { executeHelperRequest, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/index.js";
import { HelperNetworkPolicy, networkContextQuote } from "../../src/metamask-gasless/client/network.js";
import type { FetchExchangeRequest } from "../../src/metamask-gasless/client/network.js";
import { mmQuote, mmQuoteHash } from "../../src/metamask-gasless/economics.js";
import type { MetaMaskGaslessIntent, MetaMaskGaslessQuote } from "../../src/metamask-gasless/model.js";
import { MM_SINGLE_MODE, MM_BATCH_MODE, mmExactBatchTerms, mmValidateUnsigned } from "../../src/metamask-gasless/unsigned.js";
import { verifyMetaMaskReceiptAccounting } from "../../src/metamask-gasless/chain/receipt.js";
import { addressWord, MM_INCREASED_COUNT_TOPIC, MM_TRANSFER_TOPIC } from "../../src/metamask-gasless/chain/abi.js";
import { mmRegistry } from "../../src/metamask-gasless/registry.js";
import { expectedQuote, intent, NOW, OWNER, RECIPIENT, quoteInput, SdkExchange, syntheticHome } from
  "./metamask-gasless-client-fixtures/sdk.js";

class SponsoredExchange extends SdkExchange {
  constructor(chain: number, readonly mutate: (body: any) => void = () => {}) { super(chain); }
  override async request(request: FetchExchangeRequest) {
    const response = await super.request(request);
    if (request.method !== "POST" || !request.url.includes("tx-sentinel-")) return response;
    const body = JSON.parse(response.body);
    body.result = { transactions: [{ status: "0x1", fees: [{ error: "Not enough funds" }] }],
      sponsorship: { isSponsored: true, error: null } };
    this.mutate(body);
    return { ...response, body: JSON.stringify(body) };
  }
}

for (const chain of [143, 1329] as const) test(`original SDK capture supports explicit sponsored principal on ${chain}`, async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const exchange = new SponsoredExchange(chain), input = { ...quoteInput(home.binding, chain), netAtomic: "1000" };
  const response = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input },
    { homeDirectory: home.home, now: () => NOW, exchange });
  assert.equal(response.ok, true); if (!response.ok) return;
  const quote = response.result as MetaMaskGaslessQuote;
  assert.equal(quote.feeMode, "sponsored"); assert.equal(quote.feeAtomic, "0"); assert.equal(quote.feeRecipient, null);
  assert.equal(quote.executions.length, 1); assert.equal(quote.netAtomic, "1000");
  assert.equal(exchange.requests.length, 5);
  assert.equal(exchange.requests.filter(r => r.method === "GET").length, 3);
  assert.equal(exchange.requests.filter(r => r.url.includes("rpc.example.test")).length, 1);
  assert.equal(exchange.requests.some(r => r.url.includes("transaction-requests")), false);
  const request = { chainId: chain, recipient: RECIPIENT, grossAtomic: "1000", maxFeeAtomic: "0", minReceivedAtomic: "1000" };
  assert.deepEqual(mmQuote(quote, request, home.binding, "1000"), quote);
  const unsignedInput = { owner: OWNER, chainId: chain, executions: quote.executions, feeMode: "sponsored" as const };
  const unsigned = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned", input: unsignedInput });
  assert.equal(unsigned.ok, true); if (!unsigned.ok) return;
  const checked = mmValidateUnsigned(unsigned.result, unsignedInput);
  assert.equal(checked.mode, MM_SINGLE_MODE);
  assert.equal(checked.unsignedDelegation.caveats[1].enforcer, MM_SINGLE_ENFORCER.address);
  assert.equal((mmExactBatchTerms(unsignedInput).length - 2) / 2, 120);
  assert.throws(() => mmValidateUnsigned({ ...checked, mode: MM_BATCH_MODE }, unsignedInput));
  for (const patch of [{ target: RECIPIENT }, { value: "1" }, { callData: quote.executions[0]!.callData.slice(0, -1) + "1" }]) {
    assert.throws(() => mmValidateUnsigned(checked, { ...unsignedInput,
      executions: [{ ...quote.executions[0]!, ...patch }] as typeof quote.executions }));
  }
  const wrongCaveat = { ...checked.unsignedDelegation.caveats[1], enforcer: mmRegistry(chain).row.protocol.exactBatch.address };
  assert.throws(() => mmValidateUnsigned({ ...checked, unsignedDelegation: { ...checked.unsignedDelegation,
    caveats: [checked.unsignedDelegation.caveats[0], wrongCaveat] } }, unsignedInput));
  assert.throws(() => mmValidateUnsigned({ ...checked, unsignedDelegation: { ...checked.unsignedDelegation,
    salt: `0x${"00".repeat(32)}` } }, unsignedInput));
  const { feeMode: omittedUnsignedMode, ...legacyUnsignedInput } = unsignedInput;
  void omittedUnsignedMode;
  assert.throws(() => mmValidateUnsigned(unsigned.result, legacyUnsignedInput));
  const opIntent = { ...intent(home.binding, chain, quote, checked), ...checked, request, quote } as MetaMaskGaslessIntent;
  const row = mmRegistry(chain).row, outer = "0x4444444444444444444444444444444444444444" as const;
  const log = { address: row.token, topics: [MM_TRANSFER_TOPIC, addressWord(OWNER), addressWord(RECIPIENT)],
    data: addressWord("0x00000000000000000000000000000000000003e8"), logIndexAtomic: "2" };
  const count = { address: row.protocol.limitedCalls.address,
    topics: [MM_INCREASED_COUNT_TOPIC, addressWord(row.protocol.manager.address), addressWord(outer), checked.delegationHash],
    data: `0x${"1".padStart(64, "0")}${"1".padStart(64, "0")}` as `0x${string}`, logIndexAtomic: "1" };
  const accounting = verifyMetaMaskReceiptAccounting(opIntent, outer, [count, log]);
  assert.equal(accounting.debitAtomic, "1000"); assert.equal(accounting.feeAtomic, "0");
  assert.equal(accounting.secondTransferIndexAtomic, null);
  assert.throws(() => verifyMetaMaskReceiptAccounting(opIntent, outer, [count, log, { ...log, logIndexAtomic: "3" }]));
});

test("sponsored admission refuses non-sponsor, execution failure, malformed evidence and paid rows", async (t) => {
  const mutations: Array<[string, (body: any) => void]> = [
    ["false", b => b.result.sponsorship.isSponsored = false], ["truthy", b => b.result.sponsorship.isSponsored = "true"],
    ["sponsor error", b => b.result.sponsorship.error = "refused"], ["missing sponsor", b => delete b.result.sponsorship],
    ["execution reverted", b => b.result.transactions[0].status = "0x0"],
    ["missing status", b => delete b.result.transactions[0].status], ["execution error", b => b.result.transactions[0].error = "failed"],
    ["extra transaction", b => b.result.transactions.push(b.result.transactions[0])], ["wrong id", b => b.id = 11],
    ["result error", b => b.result.error = "failed"], ["null fees", b => b.result.transactions[0].fees = null],
    ["null tokenFees", b => b.result.transactions[0].fees[0].tokenFees = null],
    ["empty tokenFees", b => b.result.transactions[0].fees[0].tokenFees = []],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async (t) => {
    const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SponsoredExchange(143, mutate);
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 143) },
      { homeDirectory: home.home, now: () => NOW, exchange });
    assert.equal(result.ok, false); assert.equal(exchange.beforeSends, 0);
    assert.equal(exchange.requests.some(r => r.url.includes("transaction-requests")), false);
  });
});

test("paid quote bytes and two-execution contract remain unchanged", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup); const exchange = new SdkExchange(1);
  const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 1) },
    { homeDirectory: home.home, now: () => NOW, exchange });
  assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: true, result: expectedQuote(1) });
  assert.equal(exchange.requests.length, 6);
  assert.equal(expectedQuote(1).hash, "b7f812a0af7d56821e7667d4bf7472f8e85563a7520370835894cd1d30c8aefc");
  assert.deepEqual(Object.keys(mmProtocolPins(mmRegistry(1).row)), ["manager", "delegate", "limitedCalls", "exactBatch"]);
  const quote = expectedQuote(1), request = { chainId: 1 as const, recipient: RECIPIENT, grossAtomic: "1000050",
    maxFeeAtomic: "1050", minReceivedAtomic: "999000" };
  assert.throws(() => mmQuote({ ...quote, feeRecipient: null }, request, home.binding, "999000"));
  const sponsored = { ...quote, feeMode: "sponsored" as const, sponsorshipHash: "a".repeat(64), feeAtomic: "0", feeRecipient: null };
  assert.throws(() => mmQuote({ ...sponsored, hash: mmQuoteHash(sponsored) }, request, home.binding, "999000"));
});


test("caller-provided errors cannot mint a sponsored capture", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const policy = new HelperNetworkPolicy(networkContextQuote(quoteInput(home.binding, 143), OWNER, home.token), new SponsoredExchange(143));
  assert.equal(policy.takeSponsoredQuote(new Error("Insufficient balance to cover the transfer and gasless relay fee.")), undefined);
  assert.equal(policy.takeSponsoredQuote({ validationPredicate: "sentinel_token_fees", tokenFeesShape: "missing" }), undefined);
  assert.equal(policy.takeSponsoredQuote(null), undefined);
});


test("production RPC intent and genuine TEST-signed redemption correlate the sponsored one-call batch", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const response = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote",
    input: { ...quoteInput(home.binding, 143), netAtomic: "1000" } },
    { homeDirectory: home.home, now: () => NOW, exchange: new SponsoredExchange(143) });
  assert.equal(response.ok, true); if (!response.ok) return;
  const quote = response.result as MetaMaskGaslessQuote;
  // Publicly known synthetic test key only; this exercises the original cryptographic verifier.
  const account = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
  const owner = account.address.toLowerCase() as typeof OWNER;
  const input = { owner, chainId: 143 as const, executions: quote.executions, feeMode: "sponsored" as const };
  const built = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "buildUnsigned", input });
  assert.equal(built.ok, true); if (!built.ok) return;
  const unsigned = mmValidateUnsigned(built.result, input);
  const initial = intent({ ...home.binding, address: owner }, 143, quote, unsigned);
  const selectedState = { ...initial.initialSnapshot.safeState,
    protocolCodeHashes: Object.fromEntries(Object.entries(mmProtocolPins(mmRegistry(143).row, "sponsored"))
      .map(([name, pin]) => [name, pin.codeHash])) as typeof initial.initialSnapshot.safeState.protocolCodeHashes,
    ownerCodeHash: keccak256("0x") };
  const value: MetaMaskGaslessIntent = { ...initial, initialSnapshot: { ...initial.initialSnapshot,
    safeState: selectedState, headState: selectedState },
    request: { chainId: 143, recipient: RECIPIENT, grossAtomic: "1000", maxFeeAtomic: "0", minReceivedAtomic: "1000" } };
  const signature = await account.sign({ hash: unsigned.signingDigest });
  const context = encodeAbiParameters([MM_DELEGATION_PARAMETER], [[{ ...unsigned.unsignedDelegation,
    salt: BigInt(unsigned.unsignedDelegation.salt), signature }]]);
  const calldata = encodeFunctionData({ abi: parseAbi([
    "function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)"]),
    functionName: "redeemDelegations", args: [[context], [unsigned.mode], [mmExactBatchTerms(input)]] });
  assert.equal((await verifyRedemption(calldata, value)).signature, signature);
  const { feeMode: omittedQuoteMode, ...legacyQuote } = quote; void omittedQuoteMode;
  await assert.rejects(verifyRedemption(calldata, { ...value, quote: legacyQuote }));
  const calls: string[] = [];
  const rpc = new MetaMaskGaslessRpc({ chainId: 143, rpcUrl: "https://rpc.example.test/143", clock: { now: () => NOW },
    transport: { async request(_endpoint, _method, body) { calls.push(JSON.parse(body!).method); throw new Error("synthetic read boundary stop"); } } });
  const bound = { ...value, initialSnapshot: { ...value.initialSnapshot,
    endpointHash: rpc.endpointHash, endpointOrigin: rpc.endpointOrigin } };
  const expectedSnapshot = { chainId: 143 as const, endpointHash: rpc.endpointHash,
    endpointOrigin: rpc.endpointOrigin, grossAtomic: "1000", feeMode: "sponsored" as const };
  validateMetaMaskGaslessSnapshot(bound.initialSnapshot, expectedSnapshot);
  assert.throws(() => validateMetaMaskGaslessSnapshot({ ...bound.initialSnapshot,
    safeState: { ...selectedState, protocolCodeHashes: initial.initialSnapshot.safeState.protocolCodeHashes } }, expectedSnapshot));
  // Deliberately stops at the first public read: reaching it proves the complete production intent guard admitted the tag.
  await assert.rejects(rpc.observe(bound, {} as never, null));
  assert.deepEqual(calls, ["eth_chainId"]);
  calls.length = 0;
  await assert.rejects(rpc.observe({ ...bound, quote: legacyQuote }, {} as never, null));
  assert.deepEqual(calls, []);
});


test("capture is bound to its exact policy, original error, request purpose and one consumption", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const input = { ...quoteInput(home.binding, 143), netAtomic: "1000" };
  const original = new SponsoredExchange(143);
  await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input },
    { homeDirectory: home.home, now: () => NOW, exchange: original });
  async function capture(netAtomic = "1000") {
    const exchange = new SponsoredExchange(143);
    const gate = new HelperNetworkPolicy(networkContextQuote({ ...input, netAtomic }, OWNER, home.token), exchange);
    let error: unknown;
    for (const request of original.requests) {
      try { await gate.fetch(request.url, { method: request.method, headers: request.headers, body: request.body }); }
      catch (caught) { error = caught; }
    }
    assert.ok(error !== undefined);
    return { gate, exchange, error };
  }
  const first = await capture(), second = await capture();
  assert.equal(first.gate.takeSponsoredQuote(new Error("same message")), undefined);
  assert.equal(first.gate.takeSponsoredQuote(Object.assign({}, first.error)), undefined);
  assert.equal(first.gate.takeSponsoredQuote(second.error), undefined);
  assert.equal(second.gate.takeSponsoredQuote(first.error), undefined);
  assert.equal(first.gate.takeSponsoredQuote(first.error)?.feeMode, "sponsored");
  assert.equal(first.gate.takeSponsoredQuote(first.error), undefined);
  assert.equal(second.gate.takeSponsoredQuote(second.error)?.feeMode, "sponsored");
  const wrongPurpose = await capture("1001");
  assert.equal(wrongPurpose.gate.takeSponsoredQuote(wrongPurpose.error), undefined);
  assert.equal(wrongPurpose.exchange.requests.some(r => r.url.includes("tx-sentinel-") && r.method === "POST"), false);
});


test("authentic large numeric vendor metadata binds exact response bytes without changing economic validation", async (t) => {
  const home = await syntheticHome(); t.after(home.cleanup);
  const input = { ...quoteInput(home.binding, 143), netAtomic: "1000" };
  class NumericSponsoredExchange extends SponsoredExchange {
    capturedBody = "";
    constructor(readonly spaced: boolean) { super(143); }
    override async request(request: FetchExchangeRequest) {
      const response = await super.request(request);
      if (request.method !== "POST" || !request.url.includes("tx-sentinel-")) return response;
      // Exact public vendor numeric token from the SHA-bound authentic Monad response; never a monetary input.
      const body = response.body.replace('"status":"0x1"', '"status":"0x1","feeEstimate":12811506000125603');
      this.capturedBody = this.spaced ? ` ${body}\n` : body;
      return { ...response, body: this.capturedBody };
    }
  }
  const hashes: string[] = [];
  for (const spaced of [false, true]) {
    const exchange = new NumericSponsoredExchange(spaced);
    const response = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input },
      { homeDirectory: home.home, now: () => NOW, exchange });
    assert.equal(response.ok, true); if (!response.ok) return;
    const quote = response.result as MetaMaskGaslessQuote;
    const sentinel = exchange.requests.find(r => r.method === "POST" && r.url.includes("tx-sentinel-"))!;
    assert.throws(() => hashObject(JSON.parse(exchange.capturedBody)));
    assert.equal(quote.sponsorshipHash, hashObject({ purpose: "apn.metamask.sponsored-simulation.v1", input,
      requestHash: hashObject(JSON.parse(sentinel.body!)), responseHash: sha256(exchange.capturedBody) }));
    assert.equal(quote.feeAtomic, "0"); assert.equal(quote.executions.length, 1);
    hashes.push(quote.sponsorshipHash!);
  }
  assert.notEqual(hashes[0], hashes[1]);
});
