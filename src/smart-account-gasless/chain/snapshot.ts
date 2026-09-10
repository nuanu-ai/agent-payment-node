import { keccak256 } from "viem";
import type { ClockPort } from "../../ports.js";
import type { Hex } from "../../model.js";
import { SA_PROTOCOL_NAMES, type SmartAccountGaslessBinding, type SmartAccountGaslessBlock,
  type SmartAccountGaslessChainState, type SmartAccountGaslessSnapshot } from "../model.js";
import { saFail } from "../reasons.js";
import { saRegistry } from "../registry.js";
import { saBinding, saBlock, saBlockOrder, saSnapshot } from "../schema.js";
import { readChildSpent, readCurrentAllowance, readCurrentNonce } from "./allowance.js";
import { SA_BALANCE_OF_SELECTOR, SA_DECIMALS_SELECTOR, SA_DOMAIN_SEPARATOR_SELECTOR,
  addressWord, quantity, recheckBlock, rpcAddress, rpcBlock, rpcHex, rpcQuantity, rpcWord,
  type SaRpcCall } from "./abi.js";

export interface SmartAccountGaslessProofState {
  readonly protocolCodeHashes: SmartAccountGaslessChainState["protocolCodeHashes"];
  readonly ownerCodeHash: Hex;
  readonly sessionCodeHash: Hex;
  readonly tokenProxyCodeHash: Hex;
  readonly tokenImplementationAddress: SmartAccountGaslessChainState["tokenImplementationAddress"];
  readonly tokenImplementationCodeHash: Hex;
  readonly tokenDomainSeparator: Hex;
  readonly tokenDecimals: 6;
  readonly childSpentAtomic: string;
}

/** Read every preparation identity and economic value at one captured numeric safe block. */
export async function readSmartAccountGaslessChainState(call: SaRpcCall, bindingInput: SmartAccountGaslessBinding,
  block: SmartAccountGaslessBlock): Promise<SmartAccountGaslessChainState> {
  const binding = saBinding(bindingInput), deployment = saRegistry(8453), tag = quantity(BigInt(block.numberAtomic));
  const base = await readDeployment(call, binding, block);
  const [balance, ownerNative, sessionNative, allowance, nonce] = await Promise.all([
    call("eth_call", [{ to: deployment.token.address,
      data: `${SA_BALANCE_OF_SELECTOR}${addressWord(binding.ownerAddress).slice(2)}` }, tag]).then(rpcWord),
    call("eth_getBalance", [binding.ownerAddress, tag]).then(rpcQuantity),
    call("eth_getBalance", [binding.sessionAddress, tag]).then(rpcQuantity),
    readCurrentAllowance(call, binding, block),
    readCurrentNonce(call, binding, block),
  ]);
  return { ownerAddress: binding.ownerAddress, sessionAddress: binding.sessionAddress,
    ownerCodeHash: base.ownerCodeHash, sessionCodeHash: base.sessionCodeHash,
    protocolCodeHashes: base.protocolCodeHashes, tokenProxyCodeHash: base.tokenProxyCodeHash,
    tokenImplementationAddress: base.tokenImplementationAddress,
    tokenImplementationCodeHash: base.tokenImplementationCodeHash,
    tokenDomainSeparator: base.tokenDomainSeparator, tokenDecimals: 6,
    usdcBalanceAtomic: balance.toString(), ownerNativeBalanceWei: ownerNative.toString(),
    sessionNativeBalanceWei: sessionNative.toString(), availableAtomic: allowance.availableAtomic,
    allowancePeriodAtomic: allowance.currentPeriodAtomic, allowanceIsNewPeriod: allowance.isNewPeriod,
    currentNonceAtomic: nonce };
}

/** Historical proof deliberately omits current allowance and nonce validity. */
export async function readSmartAccountGaslessProofState(call: SaRpcCall, binding: SmartAccountGaslessBinding,
  childHash: Hex, block: SmartAccountGaslessBlock): Promise<SmartAccountGaslessProofState> {
  const deployment = await readDeployment(call, saBinding(binding), block);
  const childSpentAtomic = await readChildSpent(call, binding.delegationManager, childHash, block);
  return { ...deployment, childSpentAtomic };
}

export async function captureSmartAccountGaslessSnapshot(call: SaRpcCall, chainId: 8453,
  endpointOrigin: string, endpointHash: string, clock: ClockPort,
  bindingInput: SmartAccountGaslessBinding): Promise<SmartAccountGaslessSnapshot> {
  if (chainId !== 8453) saFail("sa_gasless_rpc_binding");
  const binding = saBinding(bindingInput), preparation = (await rpcBlock(call, "latest")).block;
  const safe = (await rpcBlock(call, "safe")).block;
  try { saBlockOrder(safe, preparation); } catch { return saFail("sa_gasless_evidence"); }
  const safeState = await readSmartAccountGaslessChainState(call, binding, safe);
  await recheckBlock(call, safe); await recheckBlock(call, preparation);
  const snapshot = { chainId, endpointOrigin, endpointHash, observedAt: instant(clock),
    preparationBlock: preparation, safeBlock: safe, safeState } as const;
  try { return saSnapshot(snapshot, binding); } catch { return saFail("sa_gasless_evidence"); }
}

/** Re-bind a later guard snapshot to the operation's immutable preparation anchor. */
export async function recheckSmartAccountPreparation(call: SaRpcCall, expectedInput: SmartAccountGaslessBlock,
  currentPreparation: SmartAccountGaslessBlock): Promise<void> {
  const expected = saBlock(expectedInput);
  try { saBlockOrder(expected, currentPreparation); }
  catch { return saFail("sa_gasless_evidence"); }
  await recheckBlock(call, expected);
}

async function readDeployment(call: SaRpcCall, binding: SmartAccountGaslessBinding,
  block: SmartAccountGaslessBlock): Promise<Omit<SmartAccountGaslessProofState, "childSpentAtomic">> {
  const deployment = saRegistry(8453), tag = quantity(BigInt(block.numberAtomic));
  const protocolEntries = SA_PROTOCOL_NAMES.map(name => [name, deployment.protocol[name]] as const);
  const protocolPromise = Promise.all(protocolEntries.map(async ([name, pin]) => {
    const code = rpcHex(await call("eth_getCode", [pin.address, tag]), 256 * 1024);
    if (code === "0x" || keccak256(code) !== pin.codeHash) saFail("sa_gasless_evidence");
    return [name, pin.codeHash] as const;
  }));
  const [protocolPairs, proxyCode, implementationSlot, decimals, domain, ownerCode, sessionCode] = await Promise.all([
    protocolPromise,
    call("eth_getCode", [deployment.token.address, tag]).then(value => rpcHex(value, 256 * 1024)),
    call("eth_getStorageAt", [deployment.token.address, deployment.token.implementationSlot, tag])
      .then(value => rpcHex(value, 32, 32)),
    call("eth_call", [{ to: deployment.token.address, data: SA_DECIMALS_SELECTOR }, tag]).then(rpcWord),
    call("eth_call", [{ to: deployment.token.address, data: SA_DOMAIN_SEPARATOR_SELECTOR }, tag])
      .then(value => rpcHex(value, 32, 32)),
    call("eth_getCode", [binding.ownerAddress, tag]).then(value => rpcHex(value, 32 * 1024)),
    call("eth_getCode", [binding.sessionAddress, tag]).then(value => rpcHex(value, 32 * 1024)),
  ]);
  if (proxyCode === "0x" || keccak256(proxyCode) !== deployment.token.proxyCodeHash || decimals !== 6n ||
    domain !== deployment.token.domainSeparator || ownerCode !== deployment.ownerDesignationCode || sessionCode !== "0x") {
    saFail("sa_gasless_evidence");
  }
  const implementationAddress = storageAddress(implementationSlot);
  if (implementationAddress !== deployment.token.implementationAddress) saFail("sa_gasless_evidence");
  const implementationCode = rpcHex(await call("eth_getCode", [implementationAddress, tag]), 256 * 1024);
  if (implementationCode === "0x" || keccak256(implementationCode) !== deployment.token.implementationCodeHash) {
    saFail("sa_gasless_evidence");
  }
  return {
    protocolCodeHashes: Object.fromEntries(protocolPairs) as unknown as SmartAccountGaslessChainState["protocolCodeHashes"],
    ownerCodeHash: keccak256(ownerCode), sessionCodeHash: keccak256(sessionCode),
    tokenProxyCodeHash: keccak256(proxyCode), tokenImplementationAddress: implementationAddress,
    tokenImplementationCodeHash: keccak256(implementationCode), tokenDomainSeparator: domain, tokenDecimals: 6,
  };
}

function storageAddress(value: Hex): SmartAccountGaslessChainState["tokenImplementationAddress"] {
  if (!/^0x0{24}[0-9a-f]{40}$/u.test(value)) saFail("sa_gasless_evidence");
  return rpcAddress(`0x${value.slice(-40)}`);
}

function instant(clock: ClockPort): string {
  const value = clock.now();
  if (!Number.isFinite(value.getTime())) saFail("sa_gasless_internal");
  return value.toISOString();
}
