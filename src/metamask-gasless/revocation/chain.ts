import { encodeFunctionData, serializeTransaction } from "viem";
import { ApnError } from "../../errors.js";
import { directEvmNetwork } from "../../evm-direct-networks.js";
import { OP_STACK_GAS_ORACLE, OP_STACK_GAS_ORACLE_ABI } from "../../evm-direct-reads.js";
import type { Hex } from "../../model.js";
import { quantity, rpcBlock, rpcHex, rpcQuantity, rpcWord, type MmRpcCall } from "../chain/abi.js";
import { mmDelegationDisabled, mmRedemptionCount } from "../chain/scan.js";
import type { MetaMaskGaslessBlock, MetaMaskGaslessDeployment, MetaMaskGaslessIntent } from "../model.js";
import type { MetaMaskDisableCall } from "./call.js";

/** What the chain says right before a disable is handed to the wallet; every refusal here happens before any send. */
export interface MetaMaskRevocationChain {
  readonly finality: MetaMaskGaslessBlock;
  readonly latest: MetaMaskGaslessBlock;
  readonly nonceAtomic: string;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
  /** OP-stack L1 data fee and operator fee upper bounds; 0 elsewhere. Not enforced by the transaction fields. */
  readonly l1FeeUpperWei: string;
  readonly operatorFeeUpperWei: string;
  readonly maximumNativeCostWei: string;
  readonly nativeBalanceWei: string;
}

const blocked = (message: string, reason: string, operationId: string) => new ApnError("APN_OPERATION_BLOCKED", message,
  { reason, nextActions: [`apn operation resume --operation ${operationId}`] });

/**
 * Reads, in order: at the finality block (pinned by hash) the redemption count, the manager's disabled flag and the
 * manager's own hash of the tuple the call carries; then at the latest block the delegator's pending nonce, the gas
 * of exactly this call from the delegator (`eth_estimateGas` executes it, so a call the manager would refuse fails
 * here), the fee rule `EvmRpc.estimate` uses (2 x base fee + priority) and the delegator's native balance.
 */
export async function readMetaMaskRevocationChain(call: MmRpcCall, deployment: MetaMaskGaslessDeployment,
  dispatched: MetaMaskGaslessIntent, disable: MetaMaskDisableCall, operationId: string): Promise<MetaMaskRevocationChain> {
  const context = { row: deployment.row, call }, row = deployment.row, chainId = dispatched.request.chainId;
  const finality = (await rpcBlock(call, row.finalityTag)).block;
  if (await mmRedemptionCount(context, disable.delegationHash, finality) !== 0n) {
    throw blocked("This delegation was already redeemed; resume the operation to prove the payment.", "mm_revoke_redeemed", operationId);
  }
  if (await mmDelegationDisabled(context, disable.delegationHash, finality)) {
    throw blocked("This delegation is already disabled at the finality block; resume the operation to record the proof.",
      "mm_revoke_already_disabled", operationId);
  }
  const pinned = { blockHash: finality.hash, requireCanonical: true } as const;
  if (rpcHex(await call("eth_call", [{ to: disable.to, data: disable.hashQuery }, pinned]), 32, 32) !== disable.delegationHash.toLowerCase()) {
    throw new ApnError("APN_RPC_PROTOCOL", "The pinned manager hashes this disable call to another delegation.", { reason: "mm_revoke_hash_mismatch" });
  }
  const head = await rpcBlock(call, "latest"), at = { blockHash: head.block.hash, requireCanonical: true } as const;
  const transaction = { from: disable.from, to: disable.to, data: disable.data, value: "0x0" };
  const model = directEvmNetwork(chainId).feeModel;
  const [nonce, gas, priority, balance] = await Promise.all([
    call("eth_getTransactionCount", [disable.from, "pending"]).then(value => rpcQuantity(value)),
    call("eth_estimateGas", [transaction]).then(value => rpcQuantity(value)),
    model === "arbitrum-inclusive" ? Promise.resolve(0n) : call("eth_maxPriorityFeePerGas", []).then(value => rpcQuantity(value)),
    call("eth_getBalance", [disable.from, at]).then(value => rpcQuantity(value)),
  ]);
  const maxFee = 2n * rpcQuantity(head.raw.baseFeePerGas) + priority;
  if (gas === 0n || maxFee === 0n) throw new ApnError("APN_RPC_PROTOCOL", "The RPC quoted no gas for the disable call.", { reason: "mm_revoke_gas_quote" });
  let l1 = 0n, operator = 0n;
  if (model === "op-stack") {
    const size = (serializeTransaction({ type: "eip1559", chainId, nonce: Number(nonce), gas, maxFeePerGas: maxFee,
      maxPriorityFeePerGas: priority, to: disable.to, data: disable.data, value: 0n }).length - 2) / 2;
    [l1, operator] = await Promise.all([
      call("eth_call", [{ to: OP_STACK_GAS_ORACLE, data: encodeFunctionData({ abi: OP_STACK_GAS_ORACLE_ABI,
        functionName: "getL1FeeUpperBound", args: [BigInt(size)] }) }, at]).then(value => rpcWord(value)),
      call("eth_call", [{ to: OP_STACK_GAS_ORACLE, data: encodeFunctionData({ abi: OP_STACK_GAS_ORACLE_ABI,
        functionName: "getOperatorFee", args: [gas] }) }, at]).then(value => rpcWord(value)),
    ]);
  }
  const maximum = gas * maxFee + l1 + operator;
  return { finality, latest: head.block, nonceAtomic: nonce.toString(), gasLimitAtomic: gas.toString(),
    maxFeePerGasAtomic: maxFee.toString(), maxPriorityFeePerGasAtomic: priority.toString(), l1FeeUpperWei: l1.toString(),
    operatorFeeUpperWei: operator.toString(), maximumNativeCostWei: maximum.toString(), nativeBalanceWei: balance.toString() };
}

export const mmRevocationPayload = (disable: MetaMaskDisableCall, chain: MetaMaskRevocationChain): Readonly<Record<string, Hex>> => ({
  to: disable.to, data: disable.data, value: "0x0", gas: quantity(BigInt(chain.gasLimitAtomic)), nonce: quantity(BigInt(chain.nonceAtomic)),
  maxFeePerGas: quantity(BigInt(chain.maxFeePerGasAtomic)), maxPriorityFeePerGas: quantity(BigInt(chain.maxPriorityFeePerGasAtomic)),
});
