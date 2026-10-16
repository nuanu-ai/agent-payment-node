import { sha256 } from "../canonical.js";
import type { Address, Hex } from "../model.js";
import type { GaslessChainId } from "./model.js";
import { rpcAddress, rpcHex, rpcQuantity } from "./rpc-codec.js";
import { gaslessFailure } from "./validation.js";

export interface GaslessOuterTransaction {
  readonly typeAtomic: string;
  readonly from: Address;
  readonly to: Address;
  readonly nonceAtomic: string;
  readonly valueAtomic: string;
  readonly dataHash: string;
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
}

/**
 * The bundler's outer transaction as the RPC reports it, bound to the receipt by hash and canonical block membership.
 * Its signature is not reconstructed: the RPC is the trust root for chain data and could serve any self-consistent
 * signed transaction, so recovery proves nothing more. The effect is proven by the receipt logs; this projection only
 * fixes the EntryPoint target, the zero value and a sender other than the owner for the transaction proof hash.
 */
export function gaslessOuterTransaction(raw: Record<string, unknown>, chainId: GaslessChainId,
  expectedHash: Hex): GaslessOuterTransaction {
  const type = rpcQuantity(raw.type), nonce = rpcQuantity(raw.nonce);
  const to = rpcAddress(raw.to), from = rpcAddress(raw.from);
  if (rpcHex(raw.hash, 32, 32) !== expectedHash ||
    (raw.chainId !== undefined && raw.chainId !== null && rpcQuantity(raw.chainId) !== BigInt(chainId))) {
    gaslessFailure("APN_RPC_PROTOCOL", "gasless_outer_chain_or_hash");
  }
  const data = rpcHex(raw.input, 256 * 1024), gas = rpcQuantity(raw.gas), value = rpcQuantity(raw.value);
  const maxFee = rpcQuantity(raw.maxFeePerGas ?? raw.gasPrice);
  const priority = raw.maxPriorityFeePerGas === undefined ? 0n : rpcQuantity(raw.maxPriorityFeePerGas);
  if (priority > maxFee) gaslessFailure("APN_RPC_PROTOCOL", "gasless_outer_fee_fields");
  return { typeAtomic: type.toString(), from, to, nonceAtomic: nonce.toString(), valueAtomic: value.toString(),
    dataHash: sha256(Buffer.from(data.slice(2), "hex")), gasLimitAtomic: gas.toString(),
    maxFeePerGasAtomic: maxFee.toString(), maxPriorityFeePerGasAtomic: priority.toString() };
}
