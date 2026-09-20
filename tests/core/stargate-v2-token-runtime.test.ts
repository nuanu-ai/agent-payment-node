import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, getAddress, keccak256, pad, parseAbiParameters, type Hex } from "viem";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { StateStore } from "../../src/state.js";
import { LAYERZERO_ENDPOINT_V2_ABI, LAYERZERO_EXECUTOR_ABI, STARGATE_ERC20_ABI, STARGATE_SEND_ABI } from "../../src/stargate-v2/abi.js";
import { LAYERZERO_ENDPOINT_V2, STARGATE_TOKEN_DESTINATION_EXECUTOR, STARGATE_TOKEN_DESTINATION_MESSAGING, STARGATE_TOKEN_DESTINATION_POOL, STARGATE_TOKEN_DESTINATION_TOKEN,
  STARGATE_TOKEN_MECHANISM, STARGATE_TOKEN_SOURCE_MESSAGING, STARGATE_TOKEN_SOURCE_POOL, STARGATE_TOKEN_SOURCE_TOKEN } from "../../src/stargate-v2/token-execution.js";
import { confirmedStargateTokenSourceReceipt, observeStargateTokenDestination, StargateTokenService } from "../../src/stargate-v2/token-runtime.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";

const OWNER = getAddress("0x1111111111111111111111111111111111111111");
const TX = `0x${"12".repeat(32)}` as Hex, OTHER_TX = `0x${"13".repeat(32)}` as Hex, GUID = `0x${"34".repeat(32)}` as Hex;
const BASELINE = `0x${"56".repeat(32)}` as Hex, EVENT_BLOCK = `0x${"78".repeat(32)}` as Hex, SAFE = `0x${"9a".repeat(32)}` as Hex;
const DROP = 50_000n;

test("token source receipt verifies pinned TokenMessaging code when PacketSent is present",async()=>{
  const topics=encodeEventTopics({abi:LAYERZERO_ENDPOINT_V2_ABI,eventName:"PacketSent"}),data=encodeAbiParameters(parseAbiParameters("bytes encodedPayload,bytes options,address sendLibrary"),["0x01","0x",OWNER]);
  const source=(code:Hex)=>({call:async(method:string)=>{if(method==="eth_getTransactionReceipt")return{transactionHash:TX,status:"0x1",blockNumber:"0xa",blockHash:EVENT_BLOCK,logs:[{address:LAYERZERO_ENDPOINT_V2,topics,data}]};if(method==="eth_getBlockByNumber")return{number:"0xa",hash:EVENT_BLOCK};if(method==="eth_getCode")return code;throw new Error(method);}});
  assert.ok(await confirmedStargateTokenSourceReceipt(source(TEST_CODE) as any,TX,"safe",TEST_CODE_HASH));
  await assert.rejects(confirmedStargateTokenSourceReceipt(source("0x6002") as any,TX,"safe",TEST_CODE_HASH),(error:any)=>error.code==="APN_RPC_PROTOCOL");
});

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
    { phase: "allowance_observed" },
    { phase: "post_approval_quote_bound" },
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

type DestinationMutation = "nonce" | "sender" | "oapp" | "guid" | "duplicate-drop" | "duplicate-delivery" | "failed-drop" | "noncanonical" | "bad-order" | "baseline" | "provider-error" | "dedup" | "low-balances";
const TEST_CODE = "0x6001" as Hex, TEST_CODE_HASH = keccak256(TEST_CODE), PACKET_NONCE = 27308n;
const sourcePacket = { srcEid: 30111 as const, sender: pad(STARGATE_TOKEN_SOURCE_MESSAGING, { size: 32 }), nonceAtomic: PACKET_NONCE.toString(),
  dstEid: 30109 as const, receiver: pad(STARGATE_TOKEN_DESTINATION_MESSAGING, { size: 32 }) };
function destinationRpc(mode: "split" | "combined" = "split", mutation?: DestinationMutation) {
  const ranges: { from: bigint; to: bigint }[] = [], deliveryBlock = 304n;
  const dropBlock = mutation === "bad-order" ? 305n : (mode === "combined" ? deliveryBlock : 209n);
  const dropTx = mode === "combined" ? TX : OTHER_TX;
  const oftTopics = encodeEventTopics({ abi: STARGATE_SEND_ABI, eventName: "OFTReceived", args: { guid: GUID, toAddress: OWNER } });
  const oftData = encodeAbiParameters(parseAbiParameters("uint32 srcEid,uint256 amountReceivedLD"), [30111, 100n]);
  const origin = { srcEid: 30111, sender: mutation === "sender" ? pad(OWNER, { size: 32 }) : sourcePacket.sender,
    nonce: mutation === "nonce" ? PACKET_NONCE + 1n : PACKET_NONCE };
  const dropTopics = encodeEventTopics({ abi: LAYERZERO_EXECUTOR_ABI, eventName: "NativeDropApplied" });
  const dropData = encodeAbiParameters(parseAbiParameters("(uint32 srcEid,bytes32 sender,uint64 nonce) origin,uint32 dstEid,address oapp,(address receiver,uint256 amount)[] params,bool[] success"), [
    origin, 30109, mutation === "oapp" ? STARGATE_TOKEN_DESTINATION_POOL : STARGATE_TOKEN_DESTINATION_MESSAGING,
    [{ receiver: OWNER, amount: DROP }], [mutation !== "failed-drop"],
  ]);
  const deliveredTopics = encodeEventTopics({ abi: LAYERZERO_ENDPOINT_V2_ABI, eventName: "PacketDelivered" });
  const deliveredData = encodeAbiParameters(parseAbiParameters("(uint32 srcEid,bytes32 sender,uint64 nonce) origin,address receiver"), [origin, STARGATE_TOKEN_DESTINATION_MESSAGING]);
  const blockHash = (block: bigint) => mutation === "noncanonical" && block === deliveryBlock ? OTHER_TX : (block === deliveryBlock ? EVENT_BLOCK : SAFE);
  const log = (address: string, topics: readonly Hex[], data: Hex, tx: Hex, index: bigint, block: bigint) => ({ address, topics, data,
    transactionHash: tx, logIndex: `0x${index.toString(16)}`, blockNumber: `0x${block.toString(16)}`, blockHash: blockHash(block) });
  const oft = log(STARGATE_TOKEN_DESTINATION_POOL, oftTopics as readonly Hex[], oftData, TX, 2n, deliveryBlock);
  const delivered = log(LAYERZERO_ENDPOINT_V2, deliveredTopics as readonly Hex[], deliveredData, TX, 3n, deliveryBlock);
  const drop = log(STARGATE_TOKEN_DESTINATION_EXECUTOR, dropTopics as readonly Hex[], dropData, dropTx, mode === "combined" ? 1n : 7n, dropBlock);
  const byAddress: Record<string, any[]> = { [STARGATE_TOKEN_DESTINATION_POOL]: [oft], [LAYERZERO_ENDPOINT_V2]: [delivered],
    [STARGATE_TOKEN_DESTINATION_EXECUTOR]: [drop] };
  if (mutation === "duplicate-drop") byAddress[STARGATE_TOKEN_DESTINATION_EXECUTOR]!.push({ ...drop, logIndex: "0x8" });
  if (mutation === "duplicate-delivery") byAddress[LAYERZERO_ENDPOINT_V2]!.push({ ...delivered, logIndex: "0x4" });
  if (mutation === "dedup") for (const rows of Object.values(byAddress)) rows.push(structuredClone(rows[0]));
  const executeData = encodeFunctionData({ abi: LAYERZERO_EXECUTOR_ABI, functionName: "execute302", args: [{ receiver: STARGATE_TOKEN_DESTINATION_MESSAGING,
    origin, guid: mutation === "guid" ? OTHER_TX : GUID, message: "0x0100", extraData: "0x", gasLimit: 170_000n }] });
  return { ranges, call: async (method: string, params: readonly any[]) => {
    if (method === "eth_getBlockByNumber") {
      const tag = String(params[0]); if (tag === "safe" || tag === "latest") throw new Error(`weaker finality tag ${tag} forbidden`);
      if (tag === "finalized") return { number: "0x150", hash: SAFE };
      if (tag === "0x9") return { number: "0x9", hash: mutation === "baseline" ? SAFE : BASELINE };
      const number = BigInt(tag); return { number: tag, hash: number === deliveryBlock ? EVENT_BLOCK : SAFE };
    }
    if (method === "eth_getCode") return TEST_CODE;
    if (method === "eth_getLogs") { const filter = params[0], from = BigInt(filter.fromBlock), to = BigInt(filter.toBlock); ranges.push({ from, to });
      if (to - from + 1n > 100n) throw new Error("provider rejects ranges above 100 blocks");
      if (mutation === "provider-error" && from === 209n) throw new Error("provider range failure");
      return Object.values(byAddress).flat().filter(row => BigInt(row.blockNumber) >= from && BigInt(row.blockNumber) <= to);
    }
    if (method === "eth_getTransactionByHash") return { hash: TX, blockHash: EVENT_BLOCK, blockNumber: `0x${deliveryBlock.toString(16)}`, to: STARGATE_TOKEN_DESTINATION_EXECUTOR, input: executeData };
    if (method === "eth_getBalance") return `0x${(mutation === "low-balances" ? 1n : 1_000_000n + DROP).toString(16)}`;
    if (method === "eth_call") return encodeFunctionResult({ abi: STARGATE_ERC20_ABI, functionName: "balanceOf", result: mutation === "low-balances" ? 1n : 1_000_100n });
    throw new Error(method);
  } };
}

const destinationInput = { sourceTransactionHash: TX, guid: GUID, recipient: OWNER, sourceEid: 30111 as const,
  destinationPool: STARGATE_TOKEN_DESTINATION_POOL, minimumAmountAtomic: "100", tokenBalanceBeforeAtomic: "1000000",
  nativeBalanceBeforeAtomic: "1000000", nativeDropAtomic: DROP.toString(), fromBlockNumberAtomic: "9", fromBlockHash: BASELINE,
  sourcePacket, finalityTag: "finalized" as const };

for (const mode of ["split", "combined"] as const) test(`live-shaped ${mode} finalized native drop and delivery bind one packet`, async () => {
  const rpc = destinationRpc(mode), evidence = await observeStargateTokenDestination(rpc as any, destinationInput, undefined, TEST_CODE_HASH);
  assert.equal(evidence?.finality, "finalized"); assert.equal(evidence?.packetDelivery?.nonceAtomic, PACKET_NONCE.toString());
  assert.equal(evidence?.nativeDrop?.nonceAtomic, PACKET_NONCE.toString());
  assert.equal(evidence?.nativeDrop?.transactionHash, mode === "split" ? OTHER_TX : TX);
});

test("destination scanner uses complete inclusive <=100-block chunks and deduplicates identical provider rows", async () => {
  const rpc = destinationRpc("split", "dedup"), evidence = await observeStargateTokenDestination(rpc as any, destinationInput, undefined, TEST_CODE_HASH);
  assert.ok(evidence); assert.deepEqual(rpc.ranges.map(row=>[row.from,row.to]),[[9n,108n],[109n,208n],[209n,308n],[309n,336n]]);
});

test("destination scanner propagates a bounded provider chunk error without weakening or skipping", async () => {
  const rpc=destinationRpc("split","provider-error"); await assert.rejects(observeStargateTokenDestination(rpc as any,destinationInput,undefined,TEST_CODE_HASH),/provider range failure/u);
  assert.equal(rpc.ranges.every(row=>row.to-row.from+1n<=100n),true);
});

test("destination scanner refuses a finalized horizon above its 256-query ceiling",async()=>{
  let queries=0;const rpc={call:async(method:string,params:readonly any[])=>{if(method==="eth_getBlockByNumber")return params[0]==="finalized"?{number:"0x6409",hash:SAFE}:{number:"0x9",hash:BASELINE};if(method==="eth_getCode")return TEST_CODE;if(method==="eth_getLogs"){queries++;return [];}throw new Error(method);}};
  await assert.rejects(observeStargateTokenDestination(rpc as any,destinationInput,undefined,TEST_CODE_HASH),(error:any)=>error.code==="APN_RPC_CONFIG"&&error.details.reason==="destination_scan_range");assert.equal(queries,0);
});

for (const mutation of ["nonce","sender","oapp","guid","duplicate-drop","duplicate-delivery","failed-drop","noncanonical","bad-order"] as const)
  test(`${mutation} packet/drop/delivery evidence fails closed`,async()=>assert.equal(await observeStargateTokenDestination(destinationRpc("split",mutation) as any,destinationInput,undefined,TEST_CODE_HASH),null));

test("post-finality balances are corroborative and cannot replace or invalidate exact packet events",async()=>{
  const evidence=await observeStargateTokenDestination(destinationRpc("split","low-balances") as any,destinationInput,undefined,TEST_CODE_HASH);assert.ok(evidence);assert.ok(BigInt(evidence!.tokenDeltaAtomic)<0n);assert.ok(BigInt(evidence!.nativeDeltaAtomic)<0n);
});

test("Polygon finalized unavailability fails closed without safe or latest fallback", async () => {
  const tags: string[] = [], rpc = { call: async (method: string, params: readonly any[]) => {
    if (method === "eth_getBlockByNumber") { tags.push(String(params[0])); throw new Error("finalized unavailable"); }
    throw new Error(`unexpected ${method}`);
  } };
  await assert.rejects(observeStargateTokenDestination(rpc as any, destinationInput, undefined, TEST_CODE_HASH), /finalized unavailable/u);
  assert.deepEqual(tags, ["finalized"]);
});

test("destination baseline hash mismatch refuses reorged evidence", async () => {
  await assert.rejects(observeStargateTokenDestination(destinationRpc("split","baseline") as any, destinationInput, undefined, TEST_CODE_HASH), (error: any) => error.code === "APN_RPC_PROTOCOL");
});
