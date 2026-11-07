import { decodeFunctionResult, encodeFunctionData, serializeTransaction, type Hex } from "viem";
import { canonicalJson, exactKeys, isPlainRecord } from "../canonical.js";
import { directEvmNetwork } from "../evm-direct-networks.js";
import { OP_STACK_GAS_ORACLE, OP_STACK_GAS_ORACLE_ABI } from "../evm-direct-reads.js";
import type { EvmRpcCall } from "../evm-ports.js";
import { STARGATE_TOKEN_SOURCE_CHAIN, UINT, fail, hex32, uint } from "./token-codec.js";
import type { StargateTokenEnvelope, StargateTokenOpStackFee, StargateTokenOpStackFees } from "./token-model.js";

type PinnedBlock = Readonly<{ numberAtomic: string; hash: Hex }>;

/** The exact unsigned EIP-1559 bytes the custody signer signs for this envelope: the oracle's `_unsignedTxSize`. */
export function unsignedEnvelopeBytes(e: StargateTokenEnvelope): bigint {
  const hex = serializeTransaction({ type: "eip1559", chainId: 10, to: e.to, data: e.data, value: BigInt(e.valueAtomic), nonce: Number(e.nonceAtomic),
    gas: BigInt(e.gasLimitAtomic), maxFeePerGas: BigInt(e.maxFeePerGasAtomic), maxPriorityFeePerGas: BigInt(e.maxPriorityFeePerGasAtomic), accessList: [] });
  return BigInt((hex.length - 2) / 2);
}

/** The L1 data fee plus operator fee upper bound of one envelope; an absent envelope (no approval) adds nothing. */
export function opStackFeeOf(fee: StargateTokenOpStackFee | undefined): bigint {
  return fee === undefined ? 0n : BigInt(fee.l1DataFeeUpperWei) + BigInt(fee.operatorFeeUpperWei);
}

/**
 * OP Mainnet charges every transaction an L1 data fee and an operator fee on top of gas x fee per gas, and the signed
 * fields bound neither. The GasPriceOracle predeploy and ABI that direct transfers use give their upper bounds, read for
 * each frozen envelope at one block pinned by hash (EIP-1898). A failed or malformed read refuses: nothing is assumed zero.
 */
export async function readStargateOpStackFees(call: EvmRpcCall, block: PinnedBlock, approval: StargateTokenEnvelope | undefined,
  bridge: StargateTokenEnvelope): Promise<StargateTokenOpStackFees> {
  if (directEvmNetwork(STARGATE_TOKEN_SOURCE_CHAIN).feeModel !== "op-stack") fail("APN_STATE_CORRUPT", "op_stack_fee_model");
  const at = { blockHash: hex32(block.hash), requireCanonical: true }, numberAtomic = uint(block.numberAtomic).toString();
  const read = async (functionName: "getL1FeeUpperBound" | "getOperatorFee", argument: bigint): Promise<bigint> => {
    const raw = await call("eth_call", [{ to: OP_STACK_GAS_ORACLE, data: encodeFunctionData({ abi: OP_STACK_GAS_ORACLE_ABI, functionName, args: [argument] }) }, at]);
    try { return decodeFunctionResult({ abi: OP_STACK_GAS_ORACLE_ABI, functionName, data: raw as Hex }); }
    catch { return fail("APN_RPC_PROTOCOL", "op_stack_fee_oracle"); }
  };
  const bound = async (e: StargateTokenEnvelope): Promise<StargateTokenOpStackFee> => {
    const bytes = unsignedEnvelopeBytes(e), gas = BigInt(e.gasLimitAtomic);
    const [l1, operator] = await Promise.all([read("getL1FeeUpperBound", bytes), read("getOperatorFee", gas)]);
    return { unsignedBytesAtomic: bytes.toString(), gasAtomic: gas.toString(), l1DataFeeUpperWei: l1.toString(), operatorFeeUpperWei: operator.toString() };
  };
  const [approvalFee, bridgeFee] = await Promise.all([approval === undefined ? undefined : bound(approval), bound(bridge)]);
  return Object.freeze({ oracle: OP_STACK_GAS_ORACLE, block: { numberAtomic, hash: block.hash }, ...(approvalFee === undefined ? {} : { approval: approvalFee }),
    bridge: bridgeFee, totalUpperWei: (opStackFeeOf(approvalFee) + opStackFeeOf(bridgeFee)).toString() });
}

/**
 * Stored bounds bind their envelopes: read at the pinned block for at least each envelope's unsigned bytes and gas limit
 * (both bounds rise with them), with exactly one row per frozen envelope and an exact total.
 */
export function validateStargateOpStackFees(value: unknown, block: PinnedBlock, approval: StargateTokenEnvelope | undefined,
  bridge: StargateTokenEnvelope): StargateTokenOpStackFees {
  const bad = (): never => fail("APN_STATE_CORRUPT", "op_stack_fee_binding");
  const word = (input: unknown) => typeof input === "string" && UINT.test(input) && BigInt(input) < 1n << 256n;
  const row = (input: unknown, e: StargateTokenEnvelope): StargateTokenOpStackFee => {
    if (!isPlainRecord(input) || !exactKeys(input, ["gasAtomic", "l1DataFeeUpperWei", "operatorFeeUpperWei", "unsignedBytesAtomic"]) ||
      !Object.values(input).every(word)) return bad();
    let bytes: bigint; try { bytes = unsignedEnvelopeBytes(e); } catch { return bad(); }
    const fee = input as unknown as StargateTokenOpStackFee;
    if (BigInt(fee.unsignedBytesAtomic) < bytes || BigInt(fee.gasAtomic) < BigInt(e.gasLimitAtomic)) bad();
    return fee;
  };
  if (!isPlainRecord(value) || !exactKeys(value, [...(approval === undefined ? [] : ["approval"]), "block", "bridge", "oracle", "totalUpperWei"]) ||
    value.oracle !== OP_STACK_GAS_ORACLE || canonicalJson(value.block) !== canonicalJson({ numberAtomic: block.numberAtomic, hash: block.hash }) ||
    !word(value.totalUpperWei)) bad();
  const fees = value as unknown as StargateTokenOpStackFees;
  const total = (approval === undefined ? 0n : opStackFeeOf(row(fees.approval, approval))) + opStackFeeOf(row(fees.bridge, bridge));
  if (total.toString() !== fees.totalUpperWei) bad();
  return fees;
}
