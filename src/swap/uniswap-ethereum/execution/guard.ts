import { ApnError } from "../../../errors.js";
import type { EvmRpcCall } from "../../../evm-ports.js";
import { evmRpcBlock, evmRpcHex, evmRpcQuantity, recheckEvmBlock } from "../../../evm-rpc-codec.js";
import type { ClockPort } from "../../../ports.js";
import { validateSwapOperation, type SwapOperationRecord } from "../../model.js";
import type { UniswapTransactionEnvelope } from "../../uniswap-codec.js";
import type { UniswapV3PinVerifier } from "../../uniswap-v3/pins.js";
import type { UniswapExecutionFreshness, UniswapExecutionGuardPort } from "./types.js";

/**
 * Pre-signing guard at the current head: pinned code unchanged, no pending transaction from the account (the next
 * nonce is exact), the owner's fee cap covers base fee plus tip, the balance covers value plus the maximum fee, and
 * the exact unsigned call still succeeds by eth_call.
 */
export class UniswapExecutionGuard implements UniswapExecutionGuardPort {
  constructor(private readonly call: EvmRpcCall, private readonly clock: ClockPort, private readonly verifyPins: UniswapV3PinVerifier) {}

  async inspect(operationValue: SwapOperationRecord, envelope: UniswapTransactionEnvelope): Promise<UniswapExecutionFreshness> {
    const operation = validateSwapOperation(operationValue), account = operation.quote.account;
    if (evmRpcQuantity(await this.call("eth_chainId", [])) !== 1n) throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap execution requires exact Ethereum chain 1 RPC.");
    const head = await evmRpcBlock(this.call, "latest"), baseFee = evmRpcQuantity(head.raw.baseFeePerGas);
    await this.verifyPins(this.call, head.tag);
    const [latest, pending, balance] = await Promise.all([
      this.call("eth_getTransactionCount", [account, "latest"]), this.call("eth_getTransactionCount", [account, "pending"]),
      this.call("eth_getBalance", [account, head.tag]),
    ]);
    const nonce = evmRpcQuantity(latest), maxFee = BigInt(envelope.maxFeePerGas ?? envelope.gasPrice!),
      priority = BigInt(envelope.maxPriorityFeePerGas ?? "0");
    if (nonce !== evmRpcQuantity(pending)) blocked("The account has a pending transaction; the next nonce is not exact.", "uniswap_pending_nonce");
    if (baseFee + priority > maxFee) blocked("The approved fee cap no longer covers the current base fee plus tip.", "uniswap_fee_cap");
    if (evmRpcQuantity(balance) < BigInt(envelope.value) + BigInt(envelope.gasLimit) * maxFee) {
      blocked("The account balance no longer covers the input plus the maximum network fee.", "uniswap_native_balance");
    }
    try { evmRpcHex(await this.call("eth_call", [{ from: envelope.from, to: envelope.to, data: envelope.data,
      value: `0x${BigInt(envelope.value).toString(16)}` }, head.tag])); }
    catch { blocked("The exact swap would revert at the current head.", "uniswap_presend_simulation"); }
    await recheckEvmBlock(this.call, head);
    return { chainId: 1, account, nonce: nonce.toString(), gasLimit: envelope.gasLimit, maxFeePerGas: maxFee.toString(),
      maxPriorityFeePerGas: priority.toString(), simulationBlockNumber: operation.quote.simulation.blockNumber,
      simulationBlockHash: operation.quote.simulation.blockHash as `0x${string}`, headBlockNumber: head.number, headBlockHash: head.hash,
      checkedAt: this.clock.now().toISOString() };
  }
}

function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
