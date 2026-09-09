import { keccak256 } from "viem";
import type { Address, Hex } from "../../model.js";
import type { MetaMaskGaslessBlock, MetaMaskGaslessChainId, MetaMaskGaslessChainState,
  MetaMaskGaslessDeploymentRow, MetaMaskGaslessSnapshot } from "../model.js";
import { mmRegistry } from "../registry.js";
import { mmFail } from "../reasons.js";
import { mmCanonicalAddress, mmExact, mmHash, mmHex, mmIso, mmUint } from "../validation.js";
import { addressWord, callData, rpcAddress, rpcHex, rpcWord, type MmRpcCall } from "./abi.js";

type BalanceState = Omit<MetaMaskGaslessChainState, "counterAtomic">;

/** Read every protocol, proxy, implementation, owner, token and counter value at one EIP-1898 block. */
export async function readMetaMaskChainState(call: MmRpcCall, deployment: MetaMaskGaslessDeploymentRow,
  owner: Address, block: MetaMaskGaslessBlock, delegationHash: Hex | null): Promise<MetaMaskGaslessChainState | BalanceState> {
  const pinned = { blockHash: block.hash, requireCanonical: true } as const;
  const protocolEntries = Object.entries(deployment.protocol) as Array<
    [keyof typeof deployment.protocol, (typeof deployment.protocol)[keyof typeof deployment.protocol]]>;
  const protocolPromise = Promise.all(protocolEntries.map(async ([name, pin]) => {
    const code = rpcHex(await call("eth_getCode", [pin.address, pinned]), 256 * 1024);
    if (code === "0x" || keccak256(code) !== pin.codeHash) mmFail("mm_gasless_evidence_invalid");
    return [name, keccak256(code)] as const;
  }));
  const proxyCodePromise = call("eth_getCode", [deployment.token, pinned]).then(value => rpcHex(value, 256 * 1024));
  const implementationSlotPromise = call("eth_getStorageAt",
    [deployment.token, deployment.tokenImplementationSlot, pinned]).then(value => rpcHex(value, 32, 32));
  const decimalsPromise = call("eth_call", [{ to: deployment.token, data: callData("decimals()") }, pinned]).then(rpcWord);
  const balancePromise = call("eth_call", [{ to: deployment.token,
    data: callData("balanceOf(address)", [addressWord(owner)]) }, pinned]).then(rpcWord);
  const ownerCodePromise = call("eth_getCode", [owner, pinned]).then(value => rpcHex(value, 32 * 1024));
  const counterPromise = delegationHash === null ? Promise.resolve(null) : call("eth_call", [{
    to: deployment.protocol.limitedCalls.address,
    data: callData("callCounts(address,bytes32)", [addressWord(deployment.protocol.manager.address), delegationHash]),
  }, pinned]).then(rpcWord);
  const [protocolPairs, proxyCode, implementationSlot, decimals, balance, ownerCode, counter] = await Promise.all([
    protocolPromise, proxyCodePromise, implementationSlotPromise, decimalsPromise, balancePromise, ownerCodePromise, counterPromise,
  ]);
  if (proxyCode === "0x" || keccak256(proxyCode) !== deployment.tokenProxyCodeHash || decimals !== 6n) {
    mmFail("mm_gasless_evidence_invalid");
  }
  const implementationAddress = storageAddress(implementationSlot);
  if (implementationAddress !== deployment.tokenImplementationAddress) mmFail("mm_gasless_evidence_invalid");
  const implementationCode = rpcHex(await call("eth_getCode", [implementationAddress, pinned]), 256 * 1024);
  if (implementationCode === "0x" || keccak256(implementationCode) !== deployment.tokenImplementationCodeHash) {
    mmFail("mm_gasless_evidence_invalid");
  }
  const expectedDesignation = `0xef0100${deployment.protocol.delegate.address.slice(2)}` as Hex;
  let designation: "empty" | "pinned";
  if (ownerCode === "0x") designation = "empty";
  else if (ownerCode === expectedDesignation) designation = "pinned";
  else mmFail("mm_gasless_evidence_invalid");
  const common: BalanceState = {
    protocolCodeHashes: Object.fromEntries(protocolPairs) as MetaMaskGaslessChainState["protocolCodeHashes"],
    tokenProxyCodeHash: keccak256(proxyCode), tokenImplementationAddress: implementationAddress,
    tokenImplementationCodeHash: keccak256(implementationCode), tokenDecimals: 6,
    ownerCodeHash: keccak256(ownerCode), designation, usdcBalanceAtomic: balance.toString(),
  };
  return counter === null ? common : { ...common, counterAtomic: counter.toString() };
}

/** Strictly validate a returned prepare snapshot before orchestration trusts its economics. */
export function validateMetaMaskGaslessSnapshot(value: unknown, expected: {
  readonly chainId: MetaMaskGaslessChainId;
  readonly endpointHash: string;
  readonly endpointOrigin: string;
  readonly grossAtomic: string;
}): MetaMaskGaslessSnapshot {
  const snapshot = mmExact(value, ["chainId", "endpointHash", "endpointOrigin", "observedAt", "safeBlock",
    "headBlock", "safeState", "headState"], "mm_gasless_evidence_invalid");
  if (snapshot.chainId !== expected.chainId || mmHash(snapshot.endpointHash, "mm_gasless_evidence_invalid") !== expected.endpointHash ||
    snapshot.endpointOrigin !== expected.endpointOrigin) mmFail("mm_gasless_rpc_binding");
  mmIso(snapshot.observedAt, "mm_gasless_evidence_invalid");
  const safeBlock = validateBlock(snapshot.safeBlock), headBlock = validateBlock(snapshot.headBlock);
  if (BigInt(safeBlock.numberAtomic) > BigInt(headBlock.numberAtomic)) mmFail("mm_gasless_evidence_invalid");
  const gross = mmUint(expected.grossAtomic, true, "mm_gasless_evidence_invalid"), row = mmRegistry(expected.chainId).row;
  const safeState = validateState(snapshot.safeState, row, gross);
  const headState = validateState(snapshot.headState, row, gross);
  return { chainId: expected.chainId, endpointHash: expected.endpointHash, endpointOrigin: expected.endpointOrigin,
    observedAt: snapshot.observedAt as string, safeBlock, headBlock, safeState, headState };
}

function validateBlock(value: unknown): MetaMaskGaslessBlock {
  const block = mmExact(value, ["numberAtomic", "hash", "timestampAtomic"], "mm_gasless_evidence_invalid");
  return { numberAtomic: mmUint(block.numberAtomic, false, "mm_gasless_evidence_invalid").toString(),
    hash: mmHex(block.hash, 32, "mm_gasless_evidence_invalid"),
    timestampAtomic: mmUint(block.timestampAtomic, false, "mm_gasless_evidence_invalid").toString() };
}

function validateState(value: unknown, row: MetaMaskGaslessDeploymentRow, gross: bigint): MetaMaskGaslessChainState {
  const state = mmExact(value, ["protocolCodeHashes", "tokenProxyCodeHash", "tokenImplementationAddress",
    "tokenImplementationCodeHash", "tokenDecimals", "ownerCodeHash", "designation", "usdcBalanceAtomic",
    "counterAtomic"], "mm_gasless_evidence_invalid");
  const protocol = mmExact(state.protocolCodeHashes, ["manager", "delegate", "limitedCalls", "exactBatch"],
    "mm_gasless_evidence_invalid");
  for (const name of ["manager", "delegate", "limitedCalls", "exactBatch"] as const) {
    if (mmHex(protocol[name], 32, "mm_gasless_evidence_invalid") !== row.protocol[name].codeHash) {
      mmFail("mm_gasless_evidence_invalid");
    }
  }
  if (mmHex(state.tokenProxyCodeHash, 32, "mm_gasless_evidence_invalid") !== row.tokenProxyCodeHash ||
    mmCanonicalAddress(state.tokenImplementationAddress, "mm_gasless_evidence_invalid") !== row.tokenImplementationAddress ||
    mmHex(state.tokenImplementationCodeHash, 32, "mm_gasless_evidence_invalid") !== row.tokenImplementationCodeHash ||
    state.tokenDecimals !== 6 || state.counterAtomic !== "0" ||
    mmUint(state.usdcBalanceAtomic, false, "mm_gasless_evidence_invalid") < gross) mmFail("mm_gasless_evidence_invalid");
  const designation = state.designation;
  if (designation !== "empty" && designation !== "pinned") mmFail("mm_gasless_evidence_invalid");
  const expectedOwnerCode = designation === "empty" ? "0x" as Hex :
    `0xef0100${row.protocol.delegate.address.slice(2)}` as Hex;
  if (mmHex(state.ownerCodeHash, 32, "mm_gasless_evidence_invalid") !== keccak256(expectedOwnerCode)) {
    mmFail("mm_gasless_evidence_invalid");
  }
  return state as unknown as MetaMaskGaslessChainState;
}

function storageAddress(value: Hex): Address {
  if (!/^0x0{24}[0-9a-f]{40}$/u.test(value)) mmFail("mm_gasless_evidence_invalid");
  return rpcAddress(`0x${value.slice(-40)}`);
}
