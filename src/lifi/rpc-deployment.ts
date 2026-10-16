import { decodeFunctionResult, encodeFunctionData, getAddress } from "viem";
import { BNB_COMPOSITE, bnbPoolReadData } from "./bnb-composite.js";
import type { BridgeChainId } from "./chains.js";
import { bridgeDeployment } from "./deployments.js";
import type { BridgeBlock, BridgeTool } from "./model.js";
import { rpcBlockValue, rpcExpectedChainValue, rpcHexValue, rpcRecordValue } from "./rpc-batch-codec.js";
import { BASE_FEE_CONTRACT } from "./rpc-fees.js";
import type { RpcBatchReadItem } from "./rpc-session.js";
import { quantity } from "./rpc-support.js";
import { BRIDGE_ZERO_ADDRESS, bridgeFailure } from "./validation.js";
import { MULTICALL3_ADDRESS, PORTFOLIO_NETWORK_RPC } from "../portfolio/registry.js";
import { MULTICALL3_ABI } from "../portfolio/evm-reader.js";
import type { Address, Hex } from "../model.js";

export const ERC20_READ = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;
export const GAS_ORACLE = "0x420000000000000000000000000000000000000F" as Address;
export const L1_BLOCK = "0x4200000000000000000000000000000000000015" as Address;
export const GAS_ORACLE_ABI = [{ type: "function", name: "getL1FeeUpperBound", stateMutability: "view", inputs: [{ name: "size", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOperatorFee", stateMutability: "view", inputs: [{ name: "gas", type: "uint256" }], outputs: [{ type: "uint256" }] }] as const;
export const BASE_ECOTONE_EIP6780_TIMESTAMP = 1_710_374_401n;
const DEPLOYMENT_MULTICALL_SELECTORS = new Set([
  "0x079bd2c7", "0x105d0b81", "0x2bc5114c", "0x313ce567", "0x54fd4d50", "0x57f6dcb8",
  "0x5e280f11", "0x5f6d9ae4", "0x72607537", "0x857749b0", "0x8da5cb5b", "0x9baf00f9", "0xb54501bc",
  "0xbb0b6a53", "0xd8e8dbc7", "0xd999984d", "0xf6503992", "0xfb214c2f", "0xfc0c546a",
]);
export function deploymentMulticallEligible(data: Hex): boolean { return DEPLOYMENT_MULTICALL_SELECTORS.has(data.slice(0, 10)); }
export type DeploymentReadRow = { readonly kind: "call" | "storage"; readonly address: Address; readonly data: Hex; readonly expected: Hex };
export function deploymentAggregateItem(rows: readonly DeploymentReadRow[], tag: unknown): Omit<RpcBatchReadItem, "batchAttempt"> {
  const data = encodeFunctionData({ abi: MULTICALL3_ABI, functionName: "aggregate3", args: [rows.map((row) => ({
    target: row.address, allowFailure: false, callData: row.data,
  }))] });
  return { method: "eth_call", params: [{ to: MULTICALL3_ADDRESS, data }, tag], cachePolicy: "immutable", decoder: (value: unknown): readonly Hex[] => {
    const raw = rpcHexValue(512 * 1024)(value);
    let decoded: readonly { success: boolean; returnData: Hex }[];
    try { decoded = decodeFunctionResult({ abi: MULTICALL3_ABI, functionName: "aggregate3", data: raw }); }
    catch { return bridgeFailure("APN_RPC_PROTOCOL", "bridge_multicall_response"); }
    if (decoded.length !== rows.length || decoded.some((row) => !row.success)) bridgeFailure("APN_RPC_PROTOCOL", "bridge_multicall_response");
    return decoded.map((row) => rpcHexValue(64 * 1024)(row.returnData));
  } };
}
export const LINEA_TRACE_PROBE_TRANSACTION = "0x4352433956109d31ab50db9547f16bcb90f3545f793ed40f75716ccd9a360efd" as Hex;
export const MONAD_TRACE_PROBE_TRANSACTION = "0x9ff1560ef67d7253df2663b897452abe6644f6d6cb746743253822c264d13440" as Hex;
type PlannedRead = Omit<RpcBatchReadItem, "batchAttempt">;

/** The exact archive batch of one deployment proof. `BridgeRpc.deployment` sends it and the observation budget counts it. */
export function bridgeDeploymentReadPlan(chainId: BridgeChainId, peerChainId: BridgeChainId, tool: BridgeTool, token: Address,
  at: BridgeBlock, exactHashPin: boolean) {
  const contract = bridgeDeployment(chainId, peerChainId, tool, token),
    compactDeployment = (tool === "stargateV2" && (chainId === 8453 || chainId === 42161)) ||
      (tool === "across" && chainId === 8453 && token === BRIDGE_ZERO_ADDRESS),
    tag = exactHashPin ? { blockHash: at.hash, requireCanonical: true } : quantity(BigInt(at.numberAtomic));
  const feeContract = chainId === 8453 ? BASE_FEE_CONTRACT : { code: [], reads: [] };
  const multicallHash = compactDeployment
    ? PORTFOLIO_NETWORK_RPC.find((row) => row.evmChainId === chainId)?.multicall3CodeHash : null;
  if (compactDeployment && (multicallHash === undefined || multicallHash === null)) bridgeFailure("APN_RPC_CONFIG", "bridge_multicall_unreviewed");
  const codeRows = [...contract.code, ...feeContract.code],
    verificationCodeRows = compactDeployment
      ? [...codeRows, { address: getAddress(MULTICALL3_ADDRESS), codeHash: multicallHash! }] : codeRows,
    readRows = [...contract.reads, ...feeContract.reads],
    aggregateGroups = compactDeployment ? [contract.reads, feeContract.reads].map((rows) =>
      rows.filter((row) => row.kind === "call" && deploymentMulticallEligible(row.data))).filter((rows) => rows.length > 0) : [],
    aggregateRows = aggregateGroups.flat(),
    directRows = readRows.filter((row) => !aggregateRows.includes(row));
  const extraItems: PlannedRead[] = [];
  if (chainId === 56 && peerChainId === 1 && tool === "across" && token === BRIDGE_ZERO_ADDRESS) {
    extraItems.push({ method: "eth_call", params: [{ to: BNB_COMPOSITE.vault, data: bnbPoolReadData.registration }, tag], cachePolicy: "immutable", decoder: rpcHexValue(256) },
      { method: "eth_call", params: [{ to: BNB_COMPOSITE.vault, data: bnbPoolReadData.tokens }, tag], cachePolicy: "immutable", decoder: rpcHexValue(2048) });
  }
  let traceProbe: { transaction: Hex; from: string; to: string; value: bigint } | undefined;
  if ((chainId === 143 || chainId === 59144) && peerChainId === 1 && tool === "across" && token === BRIDGE_ZERO_ADDRESS) {
    traceProbe = chainId === 143 ? { transaction: MONAD_TRACE_PROBE_TRANSACTION, from: "0x6f49a8f621353f12378d0046e7d7e4b9b249dc9e", to: "0x0000000000000000000000000000000000001000", value: 18000000000000000000n }
      : { transaction: LINEA_TRACE_PROBE_TRANSACTION, from: "0x9629fe86f04e735923e8542ddd9f265f576e7421", to: "0xbcc016e2a79d509d2b776827ed986568d9b56d59", value: 243939205000000000n };
    extraItems.push({ method: "debug_traceTransaction", params: [traceProbe.transaction, { tracer: "callTracer", tracerConfig: { onlyTopCall: true, withLog: false } }], cachePolicy: "immutable", decoder: rpcRecordValue });
  }
  const items: PlannedRead[] = [
    { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(chainId) },
    ...verificationCodeRows.map((row) => ({ method: "eth_getCode", params: [row.address, tag], cachePolicy: "immutable" as const, decoder: rpcHexValue(128 * 1024) })),
    ...directRows.map((row) => ({ method: row.kind === "storage" ? "eth_getStorageAt" : "eth_call",
      params: row.kind === "storage" ? [row.address, row.data, tag] : [{ to: row.address, data: row.data }, tag], cachePolicy: "immutable" as const,
      decoder: rpcHexValue(64 * 1024) })),
    ...aggregateGroups.map((rows) => deploymentAggregateItem(rows, tag)),
    ...extraItems,
    { method: "eth_getBlockByNumber", params: [quantity(BigInt(at.numberAtomic)), false], cachePolicy: "immutable", decoder: rpcBlockValue },
  ];
  return { contract, feeContract, verificationCodeRows, readRows, directRows, aggregateGroups, traceProbe, items };
}

/** The exact archive batch of the Base pinned fee proof, at the included block's canonical hash. */
export function basePinnedFeeReadPlan(gas: bigint, block: BridgeBlock, safe: BridgeBlock) {
  const tag = { blockHash: block.hash, requireCanonical: true }, multicallHash = PORTFOLIO_NETWORK_RPC.find((row) => row.evmChainId === 8453)?.multicall3CodeHash;
  if (multicallHash === undefined || multicallHash === null) bridgeFailure("APN_RPC_CONFIG", "bridge_multicall_unreviewed");
  const codeRows = [...BASE_FEE_CONTRACT.code, { address: getAddress(MULTICALL3_ADDRESS), codeHash: multicallHash }],
    directRows = BASE_FEE_CONTRACT.reads.filter((row) => row.kind !== "call" || !deploymentMulticallEligible(row.data)),
    aggregateRows = BASE_FEE_CONTRACT.reads.filter((row) => row.kind === "call" && deploymentMulticallEligible(row.data));
  const operatorData = `0x275aedd2${gas.toString(16).padStart(64, "0")}` as Hex;
  const items: PlannedRead[] = [
    { method: "eth_chainId", params: [], cachePolicy: "immutable", decoder: rpcExpectedChainValue(8453) },
    ...codeRows.map((row) => ({ method: "eth_getCode", params: [row.address, tag], cachePolicy: "immutable" as const, decoder: rpcHexValue(128 * 1024) })),
    ...directRows.map((row) => ({ method: "eth_getStorageAt", params: [row.address, row.data, tag], cachePolicy: "immutable" as const, decoder: rpcHexValue(64 * 1024) })),
    deploymentAggregateItem(aggregateRows, tag),
    { method: "eth_call", params: [{ from: BRIDGE_ZERO_ADDRESS, to: GAS_ORACLE, data: operatorData }, tag], cachePolicy: "immutable", decoder: rpcHexValue(32) },
    { method: "eth_call", params: [{ from: BRIDGE_ZERO_ADDRESS, to: L1_BLOCK, data: "0x4d5d9a2a" }, tag], cachePolicy: "immutable", decoder: rpcHexValue(32) },
    { method: "eth_call", params: [{ from: BRIDGE_ZERO_ADDRESS, to: L1_BLOCK, data: "0x16d3bc7f" }, tag], cachePolicy: "immutable", decoder: rpcHexValue(32) },
    { method: "eth_getBlockByNumber", params: [quantity(BigInt(block.numberAtomic)), false], cachePolicy: "immutable", decoder: rpcBlockValue },
    { method: "eth_getBlockByNumber", params: [quantity(BigInt(safe.numberAtomic)), false], cachePolicy: "immutable", decoder: rpcBlockValue },
  ];
  return { codeRows, directRows, aggregateRows, items };
}
