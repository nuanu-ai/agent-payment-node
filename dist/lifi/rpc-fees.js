import { hashObject } from "../canonical.js";
import { evmRpcQuantity } from "../evm-rpc-codec.js";
import { bridgeFailure, bridgeUint } from "./validation.js";
import { decodeRelayBaseReceiptFee } from "../relay/source-fee-proof.js";
const FEE_RULE = { opGeth: "7da4560d1fb3045286b70a8dc23360d2626543f2", gasPriceOracle: "773798a67678ab28c3ef7ee3405f25c04616af19",
    l1Block: "3c82c3f7618b98e161ce0aff4a1901bed3a4abb9", nitro: "4130f4c50d81209ff94aa63b51ed55d3739cdaba", ethereum: "EIP-1559,EIP-4844" };
/** Proofs recorded with the Base operator fee proven by the pinned GasPriceOracle at the inclusion block (0.5.42 and older records;
 * read-only, validated by operation-validation.ts). */
export const BRIDGE_FEE_RULE_HASH = hashObject(FEE_RULE);
/** Proofs whose Base L1 and operator fees come from the receipt's own fee fields, as for the L1 fee before. */
export const BRIDGE_RECEIPT_FEE_RULE_HASH = hashObject({ ...FEE_RULE, base: "receipt l1Fee + gasUsed * operatorFeeScalar * 100 + operatorFeeConstant" });
/**
 * The paid fee of one source effect, from its receipt alone. Base: the receipt's `l1Fee` and the Jovian operator fee from
 * its `operatorFeeScalar`/`operatorFeeConstant` (absent fields are zero parameters), exactly as the Relay rail decodes it.
 * Arbitrum: the poster gas is inside gasUsed * effectiveGasPrice. Other chains: execution plus any EIP-4844 blob fee.
 */
export function bridgeActualFees(chainId, receipt) {
    const gas = evmRpcQuantity(receipt.gasUsed), price = evmRpcQuantity(receipt.effectiveGasPrice), type = evmRpcQuantity(receipt.type);
    if (gas > (1n << 64n) - 1n || ![0n, 1n, 2n, 3n, 4n].includes(type))
        bridgeFailure("APN_RPC_PROTOCOL", "receipt_fee_shape");
    const execution = gas * price;
    let l1 = 0n, operator = 0n, blob = 0n, arbitrumPosterGasAtomic = null;
    if (chainId === 8453) {
        if (type === 3n)
            bridgeFailure("APN_RPC_PROTOCOL", "unsupported_Base_blob_transaction");
        const fee = decodeRelayBaseReceiptFee(receipt);
        l1 = BigInt(fee.l1FeeWei);
        operator = BigInt(fee.operatorFeeWei);
    }
    else if (chainId === 42161) {
        const posterGas = evmRpcQuantity(receipt.gasUsedForL1);
        if (posterGas > gas)
            bridgeFailure("APN_RPC_PROTOCOL", "arbitrum_poster_gas");
        arbitrumPosterGasAtomic = posterGas.toString();
    }
    else if (type === 3n) {
        blob = evmRpcQuantity(receipt.blobGasUsed) * evmRpcQuantity(receipt.blobGasPrice);
    }
    const total = execution + l1 + operator + blob;
    for (const amount of [execution, l1, operator, blob, total])
        bridgeUint(amount.toString(), false, "APN_RPC_PROTOCOL");
    return { gasUsedAtomic: gas.toString(), effectiveGasPriceAtomic: price.toString(), executionFeeWei: execution.toString(),
        l1DataFeeWei: l1.toString(), operatorFeeWei: operator.toString(), blobFeeWei: blob.toString(), actualTotalFeeWei: total.toString(),
        feeEvidence: { receiptHash: hashObject(receipt), ruleHash: BRIDGE_RECEIPT_FEE_RULE_HASH, baseOracle: null, arbitrumPosterGasAtomic } };
}
//# sourceMappingURL=rpc-fees.js.map