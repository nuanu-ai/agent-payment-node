import { keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Hex } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { circleBlocked, type CircleEnvelope } from "./operation-model.js";
import { CIRCLE_SOURCE_TOKEN } from "./catalog.js";
import { encodeCircleApproval } from "./protocol.js";

/** Pure, internal wire check. Production intent identity is authenticated by the controller. */
export async function assertCleanup86RestoredWire(raw: Hex, envelope: CircleEnvelope, transactionHash: Hex): Promise<void> {
  const { envelopeHash, ...body } = envelope;
  if (!isPlainRecord(envelope) || !exactKeys(envelope, ["chainId", "from", "to", "data", "valueAtomic", "nonceAtomic", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "envelopeHash"]) || envelopeHash !== hashObject(body) || envelope.chainId !== 42161 || envelope.to !== CIRCLE_SOURCE_TOKEN || envelope.data !== encodeCircleApproval(true) || envelope.valueAtomic !== "0" || envelope.nonceAtomic !== "86" || envelope.gasLimitAtomic !== "46936" || envelope.maxFeePerGasAtomic !== "80024000" || envelope.maxPriorityFeePerGasAtomic !== "0" || !/^0x02(?:[a-f0-9]{2})+$/u.test(raw) || keccak256(raw) !== transactionHash) circleBlocked("cleanup86_restored_wire_binding");
  try {
    const tx = parseTransaction(raw);
    if (tx.type !== "eip1559" || tx.chainId !== envelope.chainId || tx.to?.toLowerCase() !== envelope.to.toLowerCase() || tx.data !== envelope.data || (tx.value ?? 0n) !== 0n || tx.nonce !== 86 || tx.gas !== BigInt(envelope.gasLimitAtomic) || tx.maxFeePerGas !== BigInt(envelope.maxFeePerGasAtomic) || (tx.maxPriorityFeePerGas ?? 0n) !== 0n || (tx.accessList?.length ?? 0) !== 0 || tx.r === undefined || tx.s === undefined || tx.yParity === undefined || ![0, 1].includes(tx.yParity) || BigInt(tx.r) === 0n || BigInt(tx.r) >= 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n || BigInt(tx.s) === 0n || BigInt(tx.s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n || serializeTransaction(tx) !== raw || (await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` })).toLowerCase() !== envelope.from.toLowerCase()) circleBlocked("cleanup86_restored_wire_binding");
  } catch { circleBlocked("cleanup86_restored_wire_binding"); }
}
