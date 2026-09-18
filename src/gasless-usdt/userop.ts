import { concat, encodeFunctionData, hashTypedData, numberToHex, padHex, parseAbi } from "viem";
import { GASLESS_FACTORY } from "../gasless/validation.js";
import type { Address, Hex } from "../model.js";
import { USDT_GASLESS, usdtFailure, type UsdtTransferPlan } from "./model.js";

const TOKEN_ABI = parseAbi(["function approve(address spender, uint256 value)", "function transfer(address to, uint256 value)"]);
const ACCOUNT_ABI = parseAbi(["function executeBatch((address target, uint256 value, bytes data)[] calls)"]);

/** The signed EIP-7702 tuple for a first use; a delegated account sends none. */
export interface UsdtAuthorization {
  readonly chainId: Hex; readonly address: Address; readonly nonce: Hex; readonly yParity: Hex; readonly r: Hex; readonly s: Hex;
}

/** ERC-4337 v0.8 JSON-RPC form. Every field is exact; nothing is filled in by the bundler or the paymaster. */
export interface UsdtUserOperation {
  readonly sender: Address; readonly nonce: Hex; readonly factory?: Address; readonly factoryData?: Hex; readonly callData: Hex;
  readonly callGasLimit: Hex; readonly verificationGasLimit: Hex; readonly preVerificationGas: Hex;
  readonly maxFeePerGas: Hex; readonly maxPriorityFeePerGas: Hex; readonly paymaster: Address;
  readonly paymasterVerificationGasLimit: Hex; readonly paymasterPostOpGasLimit: Hex; readonly paymasterData: Hex;
  readonly signature: Hex; readonly eip7702Auth?: UsdtAuthorization;
}

/**
 * The account batch: reset the paymaster allowance to zero (USDT refuses a nonzero-to-nonzero approve), grant exactly F,
 * then send exactly N. The paymaster pulls its charge from the sender in postOp, after this batch, so F - A stays
 * approved to the pinned paymaster; only a later UserOperation signed by this owner can use it, and the next batch resets it.
 */
export function usdtBatchCallData(plan: UsdtTransferPlan): Hex {
  const token = USDT_GASLESS.token, paymaster = USDT_GASLESS.paymaster;
  return encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeBatch", args: [[
    { target: token, value: 0n, data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [paymaster, 0n] }) },
    { target: token, value: 0n, data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [paymaster, plan.feeCapAtomic] }) },
    { target: token, value: 0n, data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "transfer", args: [plan.request.recipient, plan.netAtomic] }) },
  ]] });
}

export function usdtUserOperation(plan: UsdtTransferPlan, input: {
  readonly entryPointNonce: bigint; readonly paymasterData: Hex; readonly signature: Hex; readonly authorization: UsdtAuthorization | null;
}): UsdtUserOperation {
  if (input.authorization !== null && (input.authorization.address !== USDT_GASLESS.delegate || input.authorization.chainId !== "0x1")) {
    usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_authorization_identity");
  }
  const q = (value: bigint): Hex => numberToHex(value);
  return {
    sender: plan.request.sender, nonce: q(input.entryPointNonce),
    ...(input.authorization === null ? {} : { factory: GASLESS_FACTORY, factoryData: "0x" as Hex }),
    callData: usdtBatchCallData(plan), callGasLimit: q(plan.gas.callGasLimit), verificationGasLimit: q(plan.gas.verificationGasLimit),
    preVerificationGas: q(plan.gas.preVerificationGas), maxFeePerGas: q(plan.price.maxFeePerGas),
    maxPriorityFeePerGas: q(plan.price.maxPriorityFeePerGas), paymaster: USDT_GASLESS.paymaster,
    paymasterVerificationGasLimit: q(plan.gas.paymasterVerificationGasLimit), paymasterPostOpGasLimit: q(plan.gas.paymasterPostOpGasLimit),
    paymasterData: input.paymasterData, signature: input.signature,
    ...(input.authorization === null ? {} : { eip7702Auth: input.authorization }),
  };
}

/** EntryPoint v0.8 EIP-712 hash; the 7702 marker makes the EntryPoint hash the delegate in place of initCode. */
export function usdtUserOperationHash(op: UsdtUserOperation): Hex {
  return hashTypedData({
    types: { PackedUserOperation: [
      { type: "address", name: "sender" }, { type: "uint256", name: "nonce" }, { type: "bytes", name: "initCode" },
      { type: "bytes", name: "callData" }, { type: "bytes32", name: "accountGasLimits" }, { type: "uint256", name: "preVerificationGas" },
      { type: "bytes32", name: "gasFees" }, { type: "bytes", name: "paymasterAndData" },
    ] },
    primaryType: "PackedUserOperation",
    domain: { name: "ERC4337", version: "1", chainId: USDT_GASLESS.chainId, verifyingContract: USDT_GASLESS.entryPoint },
    message: {
      sender: op.sender, nonce: BigInt(op.nonce), initCode: op.factory === undefined ? "0x" : USDT_GASLESS.delegate, callData: op.callData,
      accountGasLimits: concat([padHex(op.verificationGasLimit, { size: 16 }), padHex(op.callGasLimit, { size: 16 })]),
      preVerificationGas: BigInt(op.preVerificationGas),
      gasFees: concat([padHex(op.maxPriorityFeePerGas, { size: 16 }), padHex(op.maxFeePerGas, { size: 16 })]),
      paymasterAndData: concat([op.paymaster, padHex(op.paymasterVerificationGasLimit, { size: 16 }),
        padHex(op.paymasterPostOpGasLimit, { size: 16 }), op.paymasterData]),
    },
  });
}
