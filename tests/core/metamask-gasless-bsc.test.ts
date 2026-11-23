import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toHex } from "viem";
import { hashObject, sha256 } from "../../src/canonical.js";
import { parseArgv } from "../../src/cli.js";
import { bindMcpInput } from "../../src/command-binder.js";
import { projectMcpTools } from "../../src/mcp-projection.js";
import type { Address, Hex } from "../../src/model.js";
import { metaMaskGaslessApprovalSummary } from "../../src/metamask-gasless/approval.js";
import { MetaMaskGaslessRpc } from "../../src/metamask-gasless/chain/rpc.js";
import { executeHelperRequest, MM_HELPER_VERSION } from "../../src/metamask-gasless/client/index.js";
import type { FetchExchangeRequest, FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { mmQuoteHash } from "../../src/metamask-gasless/economics.js";
import { publicMetaMaskGaslessOperation } from "../../src/metamask-gasless/journal/receipt.js";
import { MM_EMPTY_CODE_HASH, MM_ZERO_ADDRESS } from "../../src/metamask-gasless/model.js";
import { MM_BSC_DEPLOYMENT_SOURCE_FILES } from "../../src/metamask-gasless/registry-data-bsc.js";
import { MM_DEPLOYMENTS, MM_RPC_ENV, MM_SENTINEL_SLUG, mmChainFacts, mmChainTokens, mmRegistry, mmRequestDeployment,
  mmRequestToken, mmTokenSymbol } from "../../src/metamask-gasless/registry.js";
import { mmFormat } from "../../src/metamask-gasless/validation.js";
import { BSC_EVIDENCE_PATH, bscEvidence, FakeRpcTransport, now, RPC_URL, runtime, vector, type Json } from "./metamask-gasless-rpc-fake.js";
import { FEE_RECIPIENT, NOW, quoteInput, RECIPIENT, SdkExchange, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";
import { mmFixture } from "./metamask-gasless-helpers.js";

const USDT = "0x55d398326f99059ff775485246999027b3197955" as Address, USDC = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" as Address;
const USDT_CHECKSUM = "0x55d398326f99059fF775485246999027B3197955", RECIPIENT_CHECKSUM = "0x2222222222222222222222222222222222222222";
const transfer = parseAbi(["function transfer(address,uint256) returns (bool)"]);
const DOMAIN_TYPE = keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));

/** Opcodes outside PUSH data, so a pushed constant never reads as an instruction. */
function opcodeCount(code: string, opcode: number): number {
  const bytes = Buffer.from(code.slice(2), "hex");
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    const op = bytes[i]!;
    if (op === opcode) count++;
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
  }
  return count;
}

test("chain 56 rows bind APN's own 2026-11-23 evidence to the lane's pinned deployment model", () => {
  const bytes = readFileSync(BSC_EVIDENCE_PATH), [source] = MM_BSC_DEPLOYMENT_SOURCE_FILES;
  assert.deepEqual({ path: source.path, sha256: source.sha256, bytes: source.bytes }, { path: BSC_EVIDENCE_PATH, sha256: sha256(bytes), bytes: bytes.length });
  assert.deepEqual(mmChainTokens(56), [USDT, USDC]);
  assert.equal(MM_RPC_ENV[56], "APN_BNB_RPC_URL"); assert.equal(MM_SENTINEL_SLUG[56], "bsc-mainnet");
  assert.equal(MM_SENTINEL_SLUG[56], bscEvidence.relay.sentinelNetworks.row.network);
  assert.equal(bscEvidence.relay.sentinelNetworks.row.relayTransactions, true);
  assert.equal(bscEvidence.relay.serverWalletNetworks.row.chainId, 56);
  assert.equal(bscEvidence.relay.accountsNetworks.fullSupportIncludes, "eip155:56");
  const base = mmRegistry(8453).row, facts = mmChainFacts(56);
  assert.deepEqual({ network: facts.network, finalityTag: facts.finalityTag }, { network: "bsc", finalityTag: "safe" });
  const protocol = Object.fromEntries((bscEvidence.protocol as Json[]).map(item => [item.role, item]));
  for (const name of ["manager", "delegate", "limitedCalls", "exactBatch"] as const) {
    assert.equal(facts.protocol[name].address, base.protocol[name].address);
    assert.equal(facts.protocol[name].codeHash, keccak256(protocol[name]!.runtime));
  }
  // The two stateless enforcers run the very runtime every 2026-09-09 chain runs.
  assert.equal(facts.protocol.limitedCalls.codeHash, base.protocol.limitedCalls.codeHash);
  assert.equal(facts.protocol.exactBatch.codeHash, base.protocol.exactBatch.codeHash);
  // Manager and delegate equal the proven Ethereum runtimes except their EIP-712 cached chain id and domain separator.
  const ethereum = (runtime.rows as Json[]).find(row => row.chainId === 1)!;
  for (const [name, title] of [["manager", "DelegationManager"], ["delegate", "EIP7702StatelessDeleGator"]] as const) {
    const ours = Buffer.from(String(protocol[name]!.runtime).slice(2), "hex");
    const reference = Buffer.from(String(runtime.codes[ethereum.protocol[name]]).slice(2), "hex");
    assert.equal(keccak256(`0x${reference.toString("hex")}`), mmRegistry(1).row.protocol[name].codeHash);
    const [chainWord, domainWord] = protocol[name]!.template.substitutions as Json[];
    const windows = [chainWord!, domainWord!].map(item => [item.start as number, item.start + 32] as const);
    assert.equal(ours.length, reference.length);
    for (let i = 0; i < ours.length; i++) {
      if (ours[i] !== reference[i]) assert.ok(windows.some(([from, to]) => i >= from && i < to), `${name} byte ${i}`);
    }
    const word = (start: number) => `0x${ours.subarray(start, start + 32).toString("hex")}` as Hex;
    assert.equal(BigInt(word(chainWord!.start)), 56n);
    assert.equal(word(domainWord!.start), keccak256(encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [DOMAIN_TYPE, keccak256(toHex(title)), keccak256(toHex("1")), 56n, facts.protocol[name].address])));
  }
  const tokens = Object.fromEntries((bscEvidence.tokens as Json[]).map(item => [item.token, item]));
  for (const { row, deploymentEvidenceHash } of MM_DEPLOYMENTS.filter(entry => entry.row.chainId === 56)) {
    const evidence = tokens[row.token]!;
    assert.equal(deploymentEvidenceHash, hashObject({ purpose: "apn.metamask-gasless.deployment-evidence.v1",
      sourceFiles: MM_BSC_DEPLOYMENT_SOURCE_FILES, row }));
    assert.deepEqual(row.evidenceBlock, { numberAtomic: bscEvidence.block.numberAtomic, hash: bscEvidence.block.hash,
      timestampAtomic: bscEvidence.block.timestampAtomic });
    assert.equal(row.decimals, 18); assert.equal(evidence.decimals, 18); assert.equal(mmTokenSymbol(row.token), evidence.symbol);
    assert.equal(row.tokenProxyCodeHash, keccak256(evidence.runtime));
    assert.equal(row.tokenImplementationSlot, evidence.eip1967ImplementationSlot);
    assert.equal(row.tokenImplementationSlot, toHex(BigInt(keccak256(toHex("eip1967.proxy.implementation"))) - 1n, { size: 32 }));
  }
  // USDT is no proxy: both slots are empty and its pinned runtime cannot hand control to other code.
  assert.equal(mmRegistry(56, USDT).row.tokenImplementationAddress, MM_ZERO_ADDRESS);
  assert.equal(mmRegistry(56, USDT).row.tokenImplementationCodeHash, MM_EMPTY_CODE_HASH);
  assert.equal(BigInt(tokens[USDT]!.eip1967ImplementationWord), 0n); assert.equal(BigInt(tokens[USDT]!.zeppelinosImplementationWord), 0n);
  for (const opcode of [0xf4, 0xf2, 0xff]) assert.equal(opcodeCount(tokens[USDT]!.runtime, opcode), 0);
  // USDC is an EIP-1967 proxy over the pinned implementation, which itself delegates nowhere.
  const usdc = mmRegistry(56, USDC).row, proxied = tokens[USDC]!;
  assert.equal(`0x${String(proxied.eip1967ImplementationWord).slice(-40)}`, usdc.tokenImplementationAddress);
  assert.equal(usdc.tokenImplementationCodeHash, keccak256(proxied.implementationRuntime));
  assert.equal(opcodeCount(proxied.implementationRuntime, 0xf4), 0);
});

test("chain 56 needs its transfer token and refuses any other spelling of one request", () => {
  assert.throws(() => mmRegistry(56), { code: "APN_INVALID_INPUT", details: { reason: "mm_gasless_input" } });
  assert.throws(() => mmRegistry(56, "0x1111111111111111111111111111111111111111"), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.throws(() => mmRequestToken(56, undefined), (error: any) => error.code === "APN_INVALID_INPUT" &&
    error.details.reason === "mm_gasless_input" && error.message.includes(`USDT ${USDT}`) && error.message.includes(`USDC ${USDC}`));
  assert.deepEqual(mmRequestToken(56, USDT), { token: USDT });
  assert.deepEqual(mmRequestToken(8453, undefined), {});
  assert.deepEqual(mmRequestToken(8453, mmRegistry(8453).row.token), {});
  assert.throws(() => mmRequestToken(8453, USDT), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.throws(() => mmRequestDeployment({ chainId: 56 }), { code: "APN_INVALID_INPUT" });
  assert.throws(() => mmRequestDeployment({ chainId: 8453, token: mmRegistry(8453).row.token }), { code: "APN_INVALID_INPUT" });
  assert.equal(mmRequestDeployment({ chainId: 56, token: USDC }).row.token, USDC);
});

test("chain 56 snapshots read the plain USDT and the proxied USDC at 18 decimals and refuse any other scale", async () => {
  for (const token of [USDT, USDC]) {
    const transport = new FakeRpcTransport(56, { token });
    const rpc = new MetaMaskGaslessRpc({ chainId: 56, rpcUrl: RPC_URL, clock: now, transport });
    const snapshot = await rpc.snapshot({ owner: vector.owner, token, delegationHash: vector.delegationHash, grossAtomic: "1000000" });
    assert.equal(snapshot.safeState.tokenDecimals, 18);
    assert.equal(snapshot.safeState.tokenImplementationAddress, mmRegistry(56, token).row.tokenImplementationAddress);
    // The plain token's empty implementation is never read; the proxy's implementation is read at each pinned block.
    const implementationReads = transport.calls.filter(call => call.method === "eth_getCode" &&
      call.params[0] === mmRegistry(56, token).row.tokenImplementationAddress).length;
    assert.equal(implementationReads, token === USDT ? 0 : 2);
    const six = new MetaMaskGaslessRpc({ chainId: 56, rpcUrl: RPC_URL, clock: now,
      transport: new FakeRpcTransport(56, { token, decimals: 6n, finality: 100n, head: 100n }) });
    await assert.rejects(six.snapshot({ owner: vector.owner, token, delegationHash: vector.delegationHash, grossAtomic: "1000000" }),
      (error: any) => error.code === "APN_RPC_PROTOCOL" && error.details.reason === "mm_gasless_evidence_invalid" &&
        error.details.evidencePredicate === "token_decimals");
  }
  const untokened = new FakeRpcTransport(56, { token: USDT });
  const rpc = new MetaMaskGaslessRpc({ chainId: 56, rpcUrl: RPC_URL, clock: now, transport: untokened });
  await assert.rejects(rpc.snapshot({ owner: vector.owner, delegationHash: vector.delegationHash, grossAtomic: "1000000" }),
    { code: "APN_INVALID_INPUT" });
  assert.equal(untokened.calls.length, 0);
});

function quoteOf(token: Address, netAtomic: string, feeAtomic: string) {
  const executions = [[RECIPIENT, netAtomic], [FEE_RECIPIENT, feeAtomic]].map(([to, amount]) => ({ target: token, value: "0",
    callData: encodeFunctionData({ abi: transfer, functionName: "transfer", args: [to as Address, BigInt(amount!)] }) }));
  const material = { netAtomic, feeAtomic, feeRecipient: FEE_RECIPIENT, executions };
  return { ...material, hash: mmQuoteHash(material as never) };
}
/** Rewrites one answer of the synthetic MetaMask and RPC endpoints. */
class EditedExchange extends SdkExchange {
  constructor(token: Address, readonly edit: (request: FetchExchangeRequest, body: any) => unknown) { super(56, 200, null, token); }
  override async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    const response = await super.request(request);
    return { status: response.status, body: JSON.stringify(this.edit(request, JSON.parse(response.body))) };
  }
}

test("chain 56 quotes 18-decimal USDT and USDC with the fee in the same token through the pinned SDK", async (t) => {
  for (const token of [USDT, USDC]) {
    const home = await syntheticHome(); t.after(home.cleanup);
    // The server wallet holds 2 tokens (2e18 atoms), so 1.5 of them plus the fee is covered.
    const exchange = new EditedExchange(token, (request, body) => {
      if (request.url.includes("rpc.example.test") && String(JSON.parse(request.body!).params[0].data).startsWith("0x70a08231")) {
        body.result = `0x${(2n * 10n ** 18n).toString(16).padStart(64, "0")}`;
      }
      return body;
    });
    const input = { ...quoteInput(home.binding, 56, token), netAtomic: "1500000000000000000" };
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input }, { homeDirectory: home.home, now: () => NOW, exchange });
    assert.deepEqual(result, { version: MM_HELPER_VERSION, ok: true, result: quoteOf(token, "1500000000000000000", "1000") });
    const sentinel = exchange.requests.filter(request => request.method === "POST" && request.url.includes("tx-sentinel-"));
    assert.deepEqual(sentinel.map(request => request.url), ["https://agentic-proxy.workers.cx.metamask.io/proxy/prd/tx-sentinel-bsc-mainnet"]);
    assert.equal(String(JSON.parse(sentinel[0]!.body!).params[0].transactions[0].to).toLowerCase(), token);
  }
  for (const [name, edit] of [
    ["fee token at 6 decimals", (request: FetchExchangeRequest, body: any) => {
      if (request.method === "POST" && request.url.includes("tx-sentinel-")) body.result.transactions[0].fees[0].tokenFees[0].token.decimals = 6;
      return body; }],
    ["token answering 6 decimals", (request: FetchExchangeRequest, body: any) => {
      if (request.url.includes("rpc.example.test") && JSON.parse(request.body!).params[0].data === "0x313ce567") body.result = `0x${"6".padStart(64, "0")}`;
      return body; }],
  ] as const) await t.test(name, async () => {
    const home = await syntheticHome(); t.after(home.cleanup); const exchange = new EditedExchange(USDT, edit);
    const result = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 56, USDT) },
      { homeDirectory: home.home, now: () => NOW, exchange });
    assert.equal(result.ok, false); if (result.ok) return;
    assert.deepEqual(result.failure, { code: "APN_PROVIDER_UNAVAILABLE", reason: "mm_gasless_provider_unavailable" });
    if (name === "fee token at 6 decimals") assert.equal((result.diagnostic as unknown as Json).validationPredicate, "sentinel_decimals");
    else assert.equal(exchange.requests.some(request => request.method === "POST" && request.url.includes("tx-sentinel-")), false);
    assert.equal(exchange.beforeSends, 0);
  });
});

test("chain 56 is refused, naming the list, when MetaMask's relay does not list it", async (t) => {
  for (const [mode, listing, flag] of [["unlisted", "unlisted", "enabled"], ["disabled", "listed", "disabled"], ["absent", "listed", "absent"]] as const) {
    await t.test(mode, async () => {
      const home = await syntheticHome(); t.after(home.cleanup);
      const exchange = new EditedExchange(USDC, (request, body) => {
        if (mode === "unlisted" && request.url.endsWith("/v1/supportedNetworks")) body.networks = body.networks.filter((row: Json) => row.chainId !== 56);
        if (mode !== "unlisted" && request.method === "GET" && request.url.endsWith("/networks")) {
          if (mode === "absent") delete body["56"]; else body["56"].relayTransactions = false;
        }
        return body;
      });
      const response = await executeHelperRequest({ version: MM_HELPER_VERSION, mode: "quote", input: quoteInput(home.binding, 56, USDC) },
        { homeDirectory: home.home, now: () => NOW, exchange });
      assert.deepEqual(response, { version: MM_HELPER_VERSION, ok: false,
        failure: { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE", reason: "mm_gasless_relay_unsupported" },
        diagnostic: { mode: "quote", stage: "relay_support", invariant: "closed_failure", network: "none", httpStatus: null,
          exitCode: null, signal: "none", timedOut: false, relayServerWalletNetwork: listing, relaySentinelFlag: flag } });
      assert.equal(exchange.requests.some(request => request.method === "POST"), false);
    });
  }
});

test("chain 56 binds --asset through CLI and MCP and prepares an 18-decimal USDT transfer end to end", async () => {
  const argv = ["gasless", "transfer", "prepare", "--profile", "bsc", "--chain", "56", "--asset", USDT_CHECKSUM, "--to", RECIPIENT_CHECKSUM,
    "--amount", "1.5", "--max-fee", "0.01", "--min-received", "1.49", "--idempotency-key", "bsc-usdt-1"];
  const bound = parseArgv(argv);
  assert.deepEqual(bound.request, { command: "gasless.transfer.prepare", profile: "bsc", idempotencyKey: "bsc-usdt-1", asset: USDT_CHECKSUM,
    request: { chainId: 56, recipient: RECIPIENT_CHECKSUM, grossAtomic: "1500000000000000000", maxFeeAtomic: "10000000000000000",
      minReceivedAtomic: "1490000000000000000" } });
  const tool = projectMcpTools().find(item => item.name === "apn_gasless_transfer_prepare")!;
  assert.deepEqual(bindMcpInput(tool.command, { profile: "bsc", chain: "56", asset: USDT_CHECKSUM, to: RECIPIENT_CHECKSUM, amount: "1.5",
    max_fee: "0.01", min_received: "1.49", idempotency_key: "bsc-usdt-1" }), bound);
  const withoutAsset = argv.filter((_, index) => index !== 7 && index !== 8);
  assert.throws(() => parseArgv(withoutAsset), { code: "APN_INVALID_INPUT" });
  assert.equal(mmFormat("1500000000000000000", 18), "1.5");

  const root = await mkdtemp(join(await realpath(tmpdir()), "apn-mm-bsc-test-"));
  try {
    const f = await mmFixture(join(root, "usdt"), 56, "empty", { token: USDT });
    const { operation } = await f.prepare("bsc-usdt-fixture");
    assert.equal(operation.intent.request.token, USDT); assert.equal(operation.intent.token, USDT); assert.equal(operation.intent.decimals, 18);
    assert.equal(operation.intent.deploymentEvidenceHash, mmRegistry(56, USDT).deploymentEvidenceHash);
    assert.deepEqual(f.provider.quotes.map(quote => quote.token), [USDT]);
    const transfer = publicMetaMaskGaslessOperation(operation).transfer;
    assert.deepEqual({ symbol: transfer.symbol, decimals: transfer.decimals, token: transfer.token }, { symbol: "USDT", decimals: 18, token: USDT });
    const summary = metaMaskGaslessApprovalSummary(operation, Date.parse(operation.intent.preparedAt), []);
    assert.equal(summary.gross_usdc, mmFormat("10000000", 18)); assert.match(String(summary.authorization), /exact USDT batch/u);
    // The same request without its token is another request: chain 56 never falls back to a default token.
    const bare = await f.core.execute({ command: "gasless.transfer.prepare", profile: f.profile, request: f.request, idempotencyKey: "bsc-bare" });
    assert.equal(bare.ok, false); assert.equal(bare.error?.code, "APN_INVALID_INPUT");
  } finally { await rm(root, { recursive: true, force: true }); }
});
