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
      if (params[0] === "safe") return { number: "0x20", hash: SAFE };
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
  nativeBalanceBeforeAtomic: "1000000", nativeDropAtomic: DROP.toString(), fromBlockNumberAtomic: "9", fromBlockHash: BASELINE };

test("native-drop completion binds the successful pinned Executor event and canonical baseline", async () => {
  const evidence = await observeStargateTokenDestination(destinationRpc() as any, destinationInput);
  assert.equal(evidence?.nativeDrop?.executor, STARGATE_TOKEN_DESTINATION_EXECUTOR); assert.equal(evidence?.nativeDrop?.success, true);
});

for (const mutation of ["success", "receiver", "amount", "transaction", "guid"] as const) test(`native-drop ${mutation} mismatch refuses unrelated balance growth`, async () => {
  assert.equal(await observeStargateTokenDestination(destinationRpc(mutation) as any, destinationInput), null);
});

test("destination baseline hash mismatch refuses reorged evidence", async () => {
  await assert.rejects(observeStargateTokenDestination(destinationRpc("baseline") as any, destinationInput), (error: any) => error.code === "APN_RPC_PROTOCOL");
});
