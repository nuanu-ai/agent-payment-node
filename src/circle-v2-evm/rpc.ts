import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi, type Address, type Hex } from "viem";
import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { BridgeHttps } from "../lifi/https.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { CIRCLE_DEPLOYMENT_PINS, CIRCLE_IMPLEMENTATION_SLOT, CIRCLE_TOKEN_IMPLEMENTATION_SLOT, CIRCLE_MINTER, CIRCLE_MESSENGER, CIRCLE_TRANSMITTER, CIRCLE_SOURCE_TOKEN,
  circleRoute, type CircleDestinationChain } from "./catalog.js";
import { circleFail, circleHex, circleRecord, circleUint, type CircleAttesterSnapshot, type CircleObservation } from "./protocol.js";
import { circleTokenPairKey, verifyCircleDeployments, type CircleDeploymentSnapshot, type CircleAccountPreflight } from "./preflight.js";
import { circleBlocked, circleEnvelope, type CircleEnvelope } from "./operation-model.js";
export const CIRCLE_RPC_ABI = parseAbi([
  "function localDomain() view returns(uint32)", "function version() view returns(uint32)", "function paused() view returns(bool)",
  "function remoteTokenMessengers(uint32) view returns(bytes32)", "function localMinter() view returns(address)",
  "function localMessageTransmitter() view returns(address)", "function messageBodyVersion() view returns(uint32)",
  "function localTokenMessenger() view returns(address)", "function remoteTokensToLocalTokens(bytes32) view returns(address)",
  "function decimals() view returns(uint8)", "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)", "function usedNonces(bytes32) view returns(uint256)",
  "function signatureThreshold() view returns(uint256)", "function getNumEnabledAttesters() view returns(uint256)", "function getEnabledAttester(uint256) view returns(address)",
]);
const METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getTransactionCount", "eth_getCode", "eth_getStorageAt", "eth_call",
  "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_sendRawTransaction", "eth_getTransactionReceipt", "eth_getTransactionByHash"]);
/** Public HTTPS, DNS pinning, bounded bodies, no redirect/retry and a finite per-command physical request budget. */
export class CircleRpc {
  private sequence = 0; private requests = 0; private readonly endpoint: string;
  constructor(url: string, readonly chainId: number, private readonly https: Pick<BridgeHttps, "request"> = new BridgeHttps(), private readonly maxRequests = 256) {
    const parsed = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", "Circle RPC", 2048);
    if (parsed.search !== "" || parsed.hash !== "") circleBlocked("rpc_url"); this.endpoint = parsed.toString();
  }
  async call(method: string, params: readonly unknown[], beforeSend?: () => void): Promise<unknown> {
    if (!METHODS.has(method) || ++this.requests > this.maxRequests) circleBlocked("rpc_method_or_budget");
    if (method === "eth_sendRawTransaction" && beforeSend === undefined) circleBlocked("financial_rpc_consent_required");
    beforeSend?.();
    const id = ++this.sequence, response = await this.https.request(this.endpoint, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }), 1024 * 1024, "APN_RPC_CONFIG", beforeSend);
    if (response.status !== 200) throw new ApnError("APN_RPC_CONFIG", "Circle RPC returned an unsuccessful HTTP response.");
    const value = circleRecord(JSON.parse(response.body));
    if (value.jsonrpc !== "2.0" || value.id !== id || !Object.hasOwn(value, "result") || Object.hasOwn(value, "error")) throw new ApnError("APN_RPC_PROTOCOL", "Circle RPC result envelope is invalid.");
    return value.result;
  }
  async identity() { if (circleUint(await this.call("eth_chainId", [])) !== BigInt(this.chainId)) circleBlocked("rpc_chain_changed"); }
  async read(to: Address, name: string, args: readonly unknown[] = [], tag = "latest"): Promise<unknown> {
    const data = encodeFunctionData({ abi: CIRCLE_RPC_ABI, functionName: name as never, args: args as never });
    const result = circleHex(await this.call("eth_call", [{ to, data }, tag]));
    return decodeFunctionResult({ abi: CIRCLE_RPC_ABI, functionName: name as never, data: result });
  }
  async block(tag: string) { return circleRecord(await this.call("eth_getBlockByNumber", [tag, false])); }
  async observation(transactionHash: Hex, finalityTag: "included" | "safe" | "finalized"): Promise<CircleObservation | null> {
    await this.identity(); const [transaction, receipt] = await Promise.all([this.call("eth_getTransactionByHash", [transactionHash]), this.call("eth_getTransactionReceipt", [transactionHash])]);
    if (transaction === null || receipt === null) return null;
    const r = circleRecord(receipt); if (r.blockNumber === null || r.blockHash === null) return null;
    const canonicalBlock = await this.block(String(r.blockNumber)), finalityHead = await this.block(finalityTag === "included" ? "latest" : finalityTag);
    if (circleUint(finalityHead.number) < circleUint(r.blockNumber)) return null;
    const recheckedBlock = await this.block(String(r.blockNumber));
    return { transaction, receipt, canonicalBlock, recheckedBlock, finalityHead, chainId: this.chainId, finalityTag };
  }
  async account(address: Address, token: Address, spender: Address): Promise<CircleAccountPreflight> {
    await this.identity(); const values = await Promise.all([this.call("eth_getBalance", [address, "pending"]), this.read(token, "balanceOf", [address]), this.read(token, "allowance", [address, spender]),
      this.call("eth_getTransactionCount", [address, "latest"]), this.call("eth_getTransactionCount", [address, "pending"])]);
    return { chainId: this.chainId, address, nativeBalanceAtomic: circleUint(values[0]).toString(), usdcBalanceAtomic: String(values[1]), allowanceAtomic: String(values[2]), latestNonceAtomic: circleUint(values[3]).toString(), pendingNonceAtomic: circleUint(values[4]).toString() };
  }
  async envelope(from: Address, to: Address, data: Hex, nonceAtomic: string, gasLimit?: string): Promise<CircleEnvelope> {
    await this.identity(); const block = await this.block("latest"), tip = this.chainId === 42161 ? 0n : circleUint(await this.call("eth_maxPriorityFeePerGas", []));
    const estimated = gasLimit === undefined ? circleUint(await this.call("eth_estimateGas", [{ from, to, data, value: "0x0" }])) : BigInt(gasLimit), gas = gasLimit === undefined ? estimated * 12n / 10n + 1n : estimated;
    return circleEnvelope({ chainId: this.chainId, from, to, data, valueAtomic: "0", nonceAtomic, gasLimitAtomic: gas.toString(), maxFeePerGasAtomic: (circleUint(block.baseFeePerGas) * 2n + tip).toString(), maxPriorityFeePerGasAtomic: tip.toString() });
  }
}
function hexQuantity(input: unknown): string { return `0x${circleUint(input).toString(16)}`; }
export async function readCircleDeployment(rpc: CircleRpc, destinationChain: CircleDestinationChain): Promise<CircleDeploymentSnapshot> {
  await rpc.identity(); const route = circleRoute(destinationChain), source = rpc.chainId === 42161, token = source ? CIRCLE_SOURCE_TOKEN : route.token, remoteDomain = source ? route.domain : 3,
    remoteToken = source ? route.token : CIRCLE_SOURCE_TOKEN, block = await rpc.block("safe"), tag = String(block.number), expected = CIRCLE_DEPLOYMENT_PINS[rpc.chainId as 42161 | CircleDestinationChain];
  const contracts = {} as Record<"messenger" | "transmitter" | "minter" | "token", CircleDeploymentSnapshot["contracts"]["token"]>;
  for (const key of ["messenger", "transmitter", "minter", "token"] as const) {
    const address = getAddress(expected[key].address), proxyCodeHash = keccak256(circleRuntimeBytecode(await rpc.call("eth_getCode", [address, tag])));
    const slot = key === "token" ? CIRCLE_TOKEN_IMPLEMENTATION_SLOT : CIRCLE_IMPLEMENTATION_SLOT;
    const storage = circleHex(await rpc.call("eth_getStorageAt", [address, slot, tag]), 32), implementation = getAddress(`0x${storage.slice(-40)}`), zero = `0x${"0".repeat(40)}`;
    const implementationCodeHash = implementation.toLowerCase() === zero ? null : keccak256(circleRuntimeBytecode(await rpc.call("eth_getCode", [implementation, tag])));
    contracts[key] = { address, proxyCodeHash, implementation, implementationCodeHash };
  }
  const values = await Promise.all([rpc.read(CIRCLE_TRANSMITTER, "localDomain", [], tag), rpc.read(CIRCLE_MESSENGER, "remoteTokenMessengers", [remoteDomain], tag),
    rpc.read(CIRCLE_MINTER, "remoteTokensToLocalTokens", [circleTokenPairKey(remoteDomain, remoteToken)], tag), rpc.read(CIRCLE_MESSENGER, "localMinter", [], tag),
    rpc.read(CIRCLE_MESSENGER, "localMessageTransmitter", [], tag), rpc.read(CIRCLE_MINTER, "localTokenMessenger", [], tag), rpc.read(CIRCLE_TRANSMITTER, "version", [], tag),
    rpc.read(CIRCLE_MESSENGER, "messageBodyVersion", [], tag), rpc.read(token, "decimals", [], tag), rpc.read(CIRCLE_TRANSMITTER, "paused", [], tag), rpc.read(CIRCLE_MINTER, "paused", [], tag), rpc.read(token, "paused", [], tag)]);
  const rechecked = await rpc.block(tag); if (circleHex(rechecked.hash, 32) !== circleHex(block.hash, 32)) circleBlocked("deployment_snapshot_reorg");
  return { chainId: rpc.chainId as 42161 | CircleDestinationChain, domain: Number(values[0]), blockHash: circleHex(block.hash, 32), blockNumberAtomic: circleUint(block.number).toString(), contracts,
    remoteDomain, remoteMessenger: circleHex(values[1], 32), pairedToken: getAddress(String(values[2])), localMinter: getAddress(String(values[3])), localMessageTransmitter: getAddress(String(values[4])),
    localTokenMessenger: getAddress(String(values[5])), messageVersion: Number(values[6]), messageBodyVersion: Number(values[7]), tokenDecimals: Number(values[8]), transmitterPaused: values[9] === true, minterPaused: values[10] === true, tokenPaused: values[11] === true };
}
export async function currentCircleDeployments(source: CircleRpc, destination: CircleRpc, chain: CircleDestinationChain) {
  const [a, b] = await Promise.all([readCircleDeployment(source, chain), readCircleDeployment(destination, chain)]);
  return { source: a, destination: b, digest: verifyCircleDeployments(a, b) };
}
export async function readCircleAttesters(rpc: CircleRpc, deploymentDigest: string): Promise<CircleAttesterSnapshot> {
  await rpc.identity(); const block = await rpc.block("safe"), tag = String(block.number), threshold = Number(await rpc.read(CIRCLE_TRANSMITTER, "signatureThreshold", [], tag)), count = Number(await rpc.read(CIRCLE_TRANSMITTER, "getNumEnabledAttesters", [], tag));
  if (!Number.isSafeInteger(count) || count < 1 || count > 20 || !Number.isSafeInteger(threshold) || threshold < 1 || threshold > count) circleBlocked("attester_count");
  const enabledAttesters: Address[] = [];
  for (let i = 0; i < count; i++) enabledAttesters.push(getAddress(String(await rpc.read(CIRCLE_TRANSMITTER, "getEnabledAttester", [BigInt(i)], tag))));
  if (circleHex((await rpc.block(tag)).hash, 32) !== circleHex(block.hash, 32)) circleBlocked("attester_snapshot_reorg");
  return { threshold, enabledAttesters, chainId: rpc.chainId as CircleDestinationChain, transmitter: CIRCLE_TRANSMITTER, blockHash: circleHex(block.hash, 32), blockNumberAtomic: circleUint(block.number).toString(), deploymentDigest };
}
export const circleRpcTransaction = (e: CircleEnvelope) => ({ from: e.from, to: e.to, data: e.data, value: "0x0", nonce: hexQuantity(e.nonceAtomic), gas: hexQuantity(e.gasLimitAtomic), maxFeePerGas: hexQuantity(e.maxFeePerGasAtomic), maxPriorityFeePerGas: hexQuantity(e.maxPriorityFeePerGasAtomic) });

/** EIP-170 runtime code is a distinct field domain from CCTP messages and sealed transactions. */
export function circleRuntimeBytecode(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x(?:[a-fA-F0-9]{2})*$/u.test(value) || value.length > 2 + 24_576 * 2) circleFail("runtime_bytecode");
  return value.toLowerCase() as Hex;
}
