import { encodeFunctionData } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { evmChain, evmUint, validateEvmAmount, validateEvmAsset, type EvmAsset } from "./evm-asset.js";
import type { EvmBalanceSnapshot, EvmFeeQuote, EvmRpcPort, EvmTransactionInput } from "./evm-ports.js";
import type { Address, Economics, Hex, OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";
import { canonicalAddress } from "./wallet-policy.js";

export interface EvmDirectBinding {
  readonly schemaVersion: "apn.evm-direct.v1";
  readonly asset: EvmAsset;
  readonly transactionTo: Address;
  readonly valueAtomic: string;
  readonly maxFeeWei: string;
  readonly feeQuote: EvmFeeQuote;
}

export function requireEvmRpc(rpc: RpcPort): EvmRpcPort {
  if (rpc.evm === undefined) throw new ApnError("APN_RPC_CONFIG", "RPC adapter does not implement explicit EVM assets.");
  return rpc.evm;
}

export function evmTransaction(asset: EvmAsset, from: Address, recipient: Address, amountAtomic: string): EvmTransactionInput {
  evmUint(amountAtomic, true);
  const data: Hex = asset.kind === "native" ? "0x" : encodeFunctionData({
    abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }],
    functionName: "transfer", args: [recipient, BigInt(amountAtomic)],
  });
  return { chainId: asset.chainId, from, to: asset.kind === "native" ? recipient : asset.address, valueAtomic: asset.kind === "native" ? amountAtomic : "0", data };
}

export function evmDirectFingerprint(operation: Pick<OperationRecord,
  "operationId" | "profile" | "chainId" | "token" | "walletAddress" | "recipient" | "amountAtomic" |
  "transactionData" | "economics" | "preparedAt" | "expiresAt" | "evm"
>): string {
  return hashObject({
    method: "pay.transfer.evm.v1", operationId: operation.operationId, profile: operation.profile,
    chainId: operation.chainId, token: operation.token, walletAddress: operation.walletAddress,
    recipient: operation.recipient, amountAtomic: operation.amountAtomic, transactionData: operation.transactionData,
    economics: operation.economics, preparedAt: operation.preparedAt, expiresAt: operation.expiresAt, evm: operation.evm,
  });
}

export function validateEvmFeeQuote(value: unknown, economics?: Economics): EvmFeeQuote {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "chainId", "l1DataFeeUpperWei", "operatorFeeUpperWei", "maximumExecutionFeeWei", "totalQuoteWei", "totalFeeEnforcedOnchain",
    "blockNumberAtomic", "blockHash", "rpcOrigin", "observedAt",
  ])) throw new ApnError("APN_STATE_CORRUPT", "EVM fee quote schema is invalid.");
  const quote = value as unknown as EvmFeeQuote;
  evmChain(quote.chainId);
  const execution = evmUint(quote.maximumExecutionFeeWei, true);
  const total = execution + evmUint(quote.l1DataFeeUpperWei) + evmUint(quote.operatorFeeUpperWei);
  if (evmUint(quote.totalQuoteWei, true) !== total || quote.totalFeeEnforcedOnchain !== false ||
      (quote.chainId === 1 && (quote.l1DataFeeUpperWei !== "0" || quote.operatorFeeUpperWei !== "0")) ||
      (economics !== undefined && economics.maximumGasCostAtomic !== quote.maximumExecutionFeeWei) ||
      typeof quote.blockHash !== "string" || !/^0x[0-9a-f]{64}$/u.test(quote.blockHash) ||
      quote.blockHash === `0x${"0".repeat(64)}` ||
      typeof quote.rpcOrigin !== "string" || !/^https:\/\//u.test(quote.rpcOrigin) ||
      typeof quote.observedAt !== "string" || !Number.isFinite(Date.parse(quote.observedAt))) {
    throw new ApnError("APN_STATE_CORRUPT", "EVM fee quote binding is invalid.");
  }
  evmUint(quote.blockNumberAtomic);
  return quote;
}

export function validateEvmDirectBinding(value: unknown, economics?: Economics): EvmDirectBinding {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "asset", "transactionTo", "valueAtomic", "maxFeeWei", "feeQuote"])) {
    throw new ApnError("APN_STATE_CORRUPT", "EVM direct binding schema is invalid.");
  }
  const binding = value as unknown as EvmDirectBinding;
  const asset = validateEvmAsset(binding.asset);
  const quote = validateEvmFeeQuote(binding.feeQuote, economics);
  if (binding.schemaVersion !== "apn.evm-direct.v1" || quote.chainId !== asset.chainId ||
      canonicalAddress(binding.transactionTo) !== binding.transactionTo || evmUint(binding.maxFeeWei, true) < evmUint(quote.totalQuoteWei)) {
    throw new ApnError("APN_STATE_CORRUPT", "EVM direct asset or fee budget binding is invalid.");
  }
  evmUint(binding.valueAtomic);
  return binding;
}

export function validateEvmOperation(operation: OperationRecord): void {
  const binding = validateEvmDirectBinding(operation.evm, operation.economics);
  const transaction = evmTransaction(binding.asset, operation.walletAddress, operation.recipient, operation.amountAtomic);
  validateEvmAmount(binding.asset, operation.amountAtomic, operation.amountDecimal);
  const economics = operation.economics;
  if (!isPlainRecord(economics) || !exactKeys(economics, ["nonceAtomic", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "maximumGasCostAtomic"]) ||
      evmUint(economics.nonceAtomic) > BigInt(Number.MAX_SAFE_INTEGER) || evmUint(economics.gasLimitAtomic, true) < 21000n ||
      evmUint(economics.maxPriorityFeePerGasAtomic) > evmUint(economics.maxFeePerGasAtomic, true)) {
    throw new ApnError("APN_STATE_CORRUPT", "Frozen EVM transaction economics exceed the supported signing bounds.");
  }
  evmUint(operation.preparedBlockNumberAtomic);
  if (operation.providerDirect !== undefined || operation.chainId !== binding.asset.chainId || operation.token !== binding.asset.address ||
      operation.transactionData !== transaction.data || binding.transactionTo !== transaction.to || binding.valueAtomic !== transaction.valueAtomic ||
      operation.economics === undefined || operation.economics.maximumGasCostAtomic !==
        (evmUint(operation.economics.gasLimitAtomic, true) * evmUint(operation.economics.maxFeePerGasAtomic, true)).toString() ||
      operation.fingerprint !== evmDirectFingerprint(operation)) {
    throw new ApnError("APN_STATE_CORRUPT", "EVM operation differs from its exact frozen transfer.");
  }
  const allowed: Readonly<Record<string, readonly string[]>> = {
    awaiting_approval: ["started", "failed_before_effect"],
    started: ["signed_not_submitted", "failed_before_effect"],
    signed_not_submitted: ["submitted_pending", "unknown_finality", "completed", "failed_confirmed_revert", "failed_proven_superseded"],
    submitted_pending: ["submitted_pending", "unknown_finality", "completed", "failed_confirmed_revert", "failed_proven_superseded"],
    unknown_finality: ["submitted_pending", "unknown_finality", "completed", "failed_confirmed_revert", "failed_proven_superseded"],
    completed: [], failed_before_effect: [], failed_confirmed_revert: [], failed_proven_superseded: [],
  };
  if (operation.transitions[0]?.state !== "awaiting_approval" ||
      operation.terminal !== ["completed", "failed_before_effect", "failed_confirmed_revert", "failed_proven_superseded"].includes(operation.state)) {
    throw new ApnError("APN_STATE_CORRUPT", "EVM operation state is invalid.");
  }
  for (let index = 1; index < operation.transitions.length; index += 1) {
    const previous = operation.transitions[index - 1], next = operation.transitions[index];
    if (previous === undefined || next === undefined || !(allowed[previous.state] ?? []).includes(next.state)) {
      throw new ApnError("APN_STATE_CORRUPT", "EVM operation transition is invalid.");
    }
  }
  const preEffect = ["awaiting_approval", "started", "failed_before_effect"].includes(operation.state);
  if (preEffect ? operation.transactionHash !== undefined || operation.rawTransactionHash !== undefined :
      !/^0x[0-9a-f]{64}$/u.test(operation.transactionHash ?? "") || operation.rawTransactionHash !== operation.transactionHash) {
    throw new ApnError("APN_STATE_CORRUPT", "EVM operation effect identity is inconsistent with state.");
  }
}

export function requireEvmFunding(balance: EvmBalanceSnapshot, amountAtomic: string, quote: EvmFeeQuote, maximumFeeWei: string): void {
  validateEvmFeeQuote(quote);
  if (balance.asset.chainId !== quote.chainId) throw new ApnError("APN_CHAIN_MISMATCH", "Funding and fee quotes belong to different chains.");
  if (evmUint(quote.totalQuoteWei, true) > evmUint(maximumFeeWei, true)) throw new ApnError("APN_FEE_BUDGET_EXCEEDED", "The current total fee quote exceeds the caller's pre-submission budget.");
  if (evmUint(balance.assetAtomic) < evmUint(amountAtomic, true)) throw new ApnError("APN_INSUFFICIENT_ASSET", "Selected asset balance is insufficient for the exact amount.");
  const required = evmUint(quote.totalQuoteWei) + (balance.asset.kind === "native" ? evmUint(amountAtomic) : 0n);
  if (evmUint(balance.nativeAtomic) < required) throw new ApnError("APN_INSUFFICIENT_GAS", "Native ETH cannot cover the transfer value plus the current total fee quote.");
}
