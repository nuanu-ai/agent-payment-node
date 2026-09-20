import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getAddress, pad, parseAbiParameters, type Hex } from "viem";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { StateStore } from "../../src/state.js";
import { LAYERZERO_EXECUTOR_ABI, STARGATE_ERC20_ABI, STARGATE_SEND_ABI } from "../../src/stargate-v2/abi.js";
import { STARGATE_TOKEN_DESTINATION_EXECUTOR, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN,
  STARGATE_TOKEN_MECHANISM, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN } from "../../src/stargate-v2/token-execution.js";
import { observeStargateTokenDestination, StargateTokenService } from "../../src/stargate-v2/token-runtime.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const OWNER = getAddress("0x1111111111111111111111111111111111111111");
const TX = `0x${"12".repeat(32)}` as Hex, OTHER_TX = `0x${"13".repeat(32)}` as Hex, GUID = `0x${"34".repeat(32)}` as Hex;
const BASELINE = `0x${"56".repeat(32)}` as Hex, EVENT_BLOCK = `0x${"78".repeat(32)}` as Hex, SAFE = `0x${"9a".repeat(32)}` as Hex;
const DROP = 50_000n;

function bridgeAdmission(mechanism: Readonly<{ provider: string; reference: string }> = STARGATE_TOKEN_MECHANISM, dailyLimitAtomic = "150") {
  return { chain: "eip155:10", kind: "token" as const, identifier: STARGATE_TOKEN_SOURCE_TOKEN, rail: "bridge" as const,
    maximumPerTransferAtomic: "150", dailyLimitAtomic, mechanism };
}

async function policyPorts(root: string, now: Date) {
  const state = new StateStore(root); await state.initialize();
  const service = new StargateTokenService(state, {} as any,
    { APN_OPTIMISM_RPC_URL: "https://optimism.example", APN_POLYGON_RPC_URL: "https://polygon.example" }, () => now.getTime());
  (service as any).local = { port: async () => ({ kind: "imported_evm_signer", address: OWNER, signTransaction: async () => "0x" }), identity: async () => ({ profile: "owner", address: OWNER }) };
  (service as any).source = { call: async () => { throw new Error("unused"); } };
  (service as any).destination = { call: async () => { throw new Error("unused"); } };
  return await (service as any).ports("owner", OWNER);
}

test("token runtime uses shared nonzero daily usage, enforces the exact Stargate mechanism, and commits idempotently", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const now = new Date("2026-09-20T10:00:00.000Z");
  await activateDirectPolicy(temporary.root, "owner", { accounts: { evm: OWNER }, admissions: [bridgeAdmission()], now });
  const ports = await policyPorts(temporary.root, now), base = { profile: "owner", owner: OWNER, amountAtomic: "100", operationId: "a".repeat(64) };
  const binding = await ports.admitPolicy(base); assert.deepEqual(binding.mechanism, STARGATE_TOKEN_MECHANISM);
  const operation = { ...base, policy: binding, integrityHash: "b".repeat(64) } as any;
  await ports.confirmPolicy(operation);
  await assert.rejects(ports.confirmPolicy({ ...operation, policy: { ...binding, mechanism: { provider: "circle-cctp-v2", reference: "eip155:10" } } }),
    (error: any) => error.code === "APN_ALLOWLIST_REFUSED");
  await ports.reserveUsage(operation); await ports.reserveUsage(operation);
  const ledger = new AssetUsageLedger(temporary.root), identity = { account: OWNER, chain: "eip155:10", asset: { kind: "token" as const, identifier: STARGATE_TOKEN_SOURCE_TOKEN } };
  assert.equal((await ledger.usage(identity, now)).amountAtomic, "100");
  await ports.followUsage(operation, "submitted"); await ports.followUsage(operation, "submitted"); await ports.followUsage(operation, "finalized"); await ports.followUsage(operation, "finalized");
  assert.equal((await ledger.usage(identity, now)).amountAtomic, "100");
  await assert.rejects(ports.admitPolicy({ ...base, amountAtomic: "60", operationId: "c".repeat(64) }), (error: any) => error.code === "APN_OPERATION_BLOCKED");
  const release = { ...base, amountAtomic: "40", operationId: "d".repeat(64) }, releaseBinding = await ports.admitPolicy(release);
  const releaseOp = { ...release, policy: releaseBinding, integrityHash: "e".repeat(64) } as any;
  await ports.reserveUsage(releaseOp); assert.equal((await ledger.usage(identity, now)).amountAtomic, "140");
  await ports.followUsage(releaseOp, "failed_before_effect"); assert.equal((await ledger.usage(identity, now)).amountAtomic, "100");
});

test("token runtime rejects another bridge provider/reference pin", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const now = new Date("2026-09-20T10:00:00.000Z");
  await activateDirectPolicy(temporary.root, "owner", { accounts: { evm: OWNER }, admissions: [bridgeAdmission({ provider: "circle-cctp-v2", reference: "eip155:10" })], now });
  const ports = await policyPorts(temporary.root, now);
  await assert.rejects(ports.admitPolicy({ profile: "owner", owner: OWNER, amountAtomic: "100", operationId: "a".repeat(64) }),
    (error: any) => error.code === "APN_ALLOWLIST_REFUSED");
});

test("concurrent reservations serialize the shared daily cap", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const now = new Date("2026-09-20T10:00:00.000Z");
  await activateDirectPolicy(temporary.root, "owner", { accounts: { evm: OWNER }, admissions: [bridgeAdmission(STARGATE_TOKEN_MECHANISM, "150")], now });
  const ports = await policyPorts(temporary.root, now), base = { profile: "owner", owner: OWNER, amountAtomic: "100" };
  const binding = await ports.admitPolicy({ ...base, operationId: "1".repeat(64) });
  const operations = ["1", "2"].map(value => ({ ...base, operationId: value.repeat(64), policy: binding, integrityHash: value.repeat(64) } as any));
  const results = await Promise.allSettled(operations.map(operation => ports.reserveUsage(operation)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  const ledger = new AssetUsageLedger(temporary.root), identity = { account: OWNER, chain: "eip155:10", asset: { kind: "token" as const, identifier: STARGATE_TOKEN_SOURCE_TOKEN } };
  assert.equal((await ledger.usage(identity, now)).amountAtomic, "100");
});

function serviceRecoveryHarness(phase: string, usageTarget?: string) {
  let signs = 0, sends = 0;
  const operation: any = { operationId: "f".repeat(64), profile: "owner", owner: OWNER, amountAtomic: "100", phase,
    transitions: [{ phase, at: "2026-09-20T10:00:00.000Z", reason: "fixture" }], transactionHash: TX,
    finalityPolicy: { version: "apn.stargate-v2-finality.v1", source: { chainId: 10, blockTag: "safe" }, destination: { chainId: 137, blockTag: "finalized" } },
    cleanupTransactionHash: OTHER_TX, policy: { policyDigest: "a".repeat(64), policyRevision: 1, mechanism: STARGATE_TOKEN_MECHANISM },
    ...(usageTarget === undefined ? {} : { usageTarget }), integrityHash: "b".repeat(64) };
  const journal: any = { value: operation, load: async () => structuredClone(journal.value), save: async (value: any) => { journal.value = structuredClone(value); },
    withLock: async (_id: string, work: () => Promise<any>) => await work(), withOwnerChainLock: async (_owner: string, _chain: number, work: () => Promise<any>) => await work() };
  const ports: any = { signer: { kind: "imported_evm_signer", address: OWNER, signTransaction: async () => { signs++; throw new Error("must not sign"); } },
    sendRawTransaction: async () => { sends++; throw new Error("must not send"); }, reserveUsage: async () => "reserved",
    followUsage: async (_op: any, target: string) => target, waitSourceReceipt: async () => null, now: () => Date.parse("2026-09-20T10:00:01.000Z") };
  const service = new StargateTokenService(new StateStore("/tmp/apn-unused-service-recovery"), {} as any, {});
  (service as any).journal = journal; (service as any).ports = async () => ports;
  (service as any).reserveUsage = async () => "reserved"; (service as any).followUsage = async (_op: any, target: string) => target;
  return { service, journal, effects: () => ({ signs, sends }) };
}

test("service observe admits every read-only usage and cleanup recovery path without signing or sending", async () => {
  const cases = [
    { phase: "observed", target: "finalized", state: "finalized" },
    { phase: "cleanup_required", target: "failed_before_effect", state: "failed_before_effect" },
    { phase: "cleaned" },
    { phase: "unknown_finality", state: "unknown_finality" },
    { phase: "cleanup_required", target: "failed_confirmed_revert", state: "failed_confirmed_revert" },
    { phase: "cleanup_unknown_finality" },
  ];
  for (const entry of cases) {
    const h = serviceRecoveryHarness(entry.phase, entry.target), result: any = await h.service.observe("f".repeat(64));
    assert.equal(result.phase, entry.phase); if (entry.state !== undefined) assert.equal(result.usageState, entry.state);
    assert.equal(result.usageTarget, undefined); assert.deepEqual(h.effects(), { signs: 0, sends: 0 });
  }
});

test("service status and receipt reconcile legal terminal targets and reject illegal phase bindings", async () => {
  const status = serviceRecoveryHarness("observed", "finalized"), result: any = await status.service.status("f".repeat(64));
  assert.equal(result.usageState, "finalized"); assert.equal(result.usageTarget, undefined); assert.deepEqual(status.effects(), { signs: 0, sends: 0 });
  const receipt = serviceRecoveryHarness("observed", "finalized"); await assert.rejects(receipt.service.receipt("f".repeat(64)));
  assert.equal(receipt.journal.value.usageState, "finalized"); assert.equal(receipt.journal.value.usageTarget, undefined); assert.deepEqual(receipt.effects(), { signs: 0, sends: 0 });
  for (const entrypoint of ["observe", "status", "receipt"] as const) {
    const illegal = serviceRecoveryHarness("prepared", "finalized"); await assert.rejects(illegal.service[entrypoint]("f".repeat(64)), (error: any) => error.code === "APN_STATE_CORRUPT");
    assert.deepEqual(illegal.effects(), { signs: 0, sends: 0 });
  }
});

function destinationRpc(mutation?: "success" | "receiver" | "amount" | "transaction" | "guid" | "baseline") {
  const oftGuid = mutation === "guid" ? (`0x${"35".repeat(32)}` as Hex) : GUID;
  const oftTopics = encodeEventTopics({ abi: STARGATE_SEND_ABI, eventName: "OFTReceived", args: { guid: oftGuid, toAddress: OWNER } });
  const oftData = encodeAbiParameters(parseAbiParameters("uint32 srcEid,uint256 amountReceivedLD"), [30111, 100n]);
  const dropTopics = encodeEventTopics({ abi: LAYERZERO_EXECUTOR_ABI, eventName: "NativeDropApplied" });
  const dropData = encodeAbiParameters(parseAbiParameters("(uint32 srcEid,bytes32 sender,uint64 nonce) origin,uint32 dstEid,address oapp,(address receiver,uint256 amount)[] params,bool[] success"), [
    { srcEid: 30111, sender: pad(STARGATE_TOKEN_SOURCE_POOL, { size: 32 }), nonce: 7n }, 30109, STARGATE_TOKEN_DESTINATION_POOL,
    [{ receiver: mutation === "receiver" ? getAddress("0x2222222222222222222222222222222222222222") : OWNER, amount: mutation === "amount" ? DROP - 1n : DROP }],
    [mutation !== "success"],
  ]);
  return { call: async (method: string, params: readonly any[]) => {
    if (method === "eth_getBlockByNumber") {
      if (params[0] === "safe" || params[0] === "latest") throw new Error(`weaker finality tag ${params[0]} forbidden`);
      if (params[0] === "finalized") return { number: "0x20", hash: SAFE };
      if (params[0] === "0x9") return { number: "0x9", hash: mutation === "baseline" ? SAFE : BASELINE };
      return { number: "0x1f", hash: EVENT_BLOCK };
    }
    if (method === "eth_getLogs") return params[0].address === STARGATE_TOKEN_DESTINATION_POOL
      ? [{ address: STARGATE_TOKEN_DESTINATION_POOL, topics: oftTopics, data: oftData, transactionHash: TX, logIndex: "0x1", blockNumber: "0x1f", blockHash: EVENT_BLOCK }]
      : [{ address: STARGATE_TOKEN_DESTINATION_EXECUTOR, topics: dropTopics, data: dropData,
          transactionHash: mutation === "transaction" ? OTHER_TX : TX, logIndex: "0x2", blockNumber: "0x1f", blockHash: EVENT_BLOCK }];
    if (method === "eth_getBalance") return `0x${(1_000_000n + DROP).toString(16)}`;
    if (method === "eth_call") return encodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", result: 1_000_100n });
    throw new Error(method);
  } };
}

const destinationInput = { sourceTransactionHash: TX, guid: GUID, recipient: OWNER, sourceEid: 30111 as const,
  destinationPool: STARGATE_TOKEN_DESTINATION_POOL, minimumAmountAtomic: "100", tokenBalanceBeforeAtomic: "1000000",
  nativeBalanceBeforeAtomic: "1000000", nativeDropAtomic: DROP.toString(), fromBlockNumberAtomic: "9", fromBlockHash: BASELINE,
  finalityTag: "finalized" as const };

test("native-drop completion binds the successful pinned Executor event and canonical baseline", async () => {
  const evidence = await observeStargateTokenDestination(destinationRpc() as any, destinationInput);
  assert.equal(evidence?.finality, "finalized");
  assert.equal(evidence?.nativeDrop?.executor, STARGATE_TOKEN_DESTINATION_EXECUTOR); assert.equal(evidence?.nativeDrop?.success, true);
});

test("Polygon finalized unavailability fails closed without safe or latest fallback", async () => {
  const tags: string[] = [], rpc = { call: async (method: string, params: readonly any[]) => {
    if (method === "eth_getBlockByNumber") { tags.push(String(params[0])); throw new Error("finalized unavailable"); }
    throw new Error(`unexpected ${method}`);
  } };
  await assert.rejects(observeStargateTokenDestination(rpc as any, destinationInput), /finalized unavailable/u);
  assert.deepEqual(tags, ["finalized"]);
});

for (const mutation of ["success", "receiver", "amount", "transaction", "guid"] as const) test(`native-drop ${mutation} mismatch refuses unrelated balance growth`, async () => {
  assert.equal(await observeStargateTokenDestination(destinationRpc(mutation) as any, destinationInput), null);
});

test("destination baseline hash mismatch refuses reorged evidence", async () => {
  await assert.rejects(observeStargateTokenDestination(destinationRpc("baseline") as any, destinationInput), (error: any) => error.code === "APN_RPC_PROTOCOL");
});
