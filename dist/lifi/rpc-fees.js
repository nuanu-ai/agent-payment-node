import { encodeAbiParameters, getAddress, keccak256, parseAbiParameters } from "viem";
import { hashObject } from "../canonical.js";
import { evmRpcHex, evmRpcQuantity, evmRpcWord } from "../evm-rpc-codec.js";
import { BRIDGE_ZERO_ADDRESS, bridgeFailure, bridgeUint } from "./validation.js";
const GPO = getAddress("0x420000000000000000000000000000000000000F"), L1_BLOCK = getAddress("0x4200000000000000000000000000000000000015");
const SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const FEE_RULE = { opGeth: "7da4560d1fb3045286b70a8dc23360d2626543f2", gasPriceOracle: "773798a67678ab28c3ef7ee3405f25c04616af19",
    l1Block: "3c82c3f7618b98e161ce0aff4a1901bed3a4abb9", nitro: "4130f4c50d81209ff94aa63b51ed55d3739cdaba", ethereum: "EIP-1559,EIP-4844" };
export const BRIDGE_FEE_RULE_HASH = hashObject(FEE_RULE);
export const BASE_FEE_CONTRACT = {
    code: [
        { address: getAddress("0x4f1db3c6abd250ba86e0928471a8f7db3afd88f1"), codeHash: "0xe9fc7c96c4db0d6078e3d359d7e8c982c350a513cb2c31121adf5e1e8a446614" },
        { address: getAddress("0x3ba4007f5c922fbb33c454b41ea7a1f11e83df2c"), codeHash: "0x5f885ca815d2cf27a203123e50b8ae204fdca910b6995d90b2d7700cbb9240d1" },
    ],
    reads: [
        { kind: "storage", address: GPO, data: SLOT, expected: `0x${"0".repeat(24)}4f1db3c6abd250ba86e0928471a8f7db3afd88f1` },
        { kind: "storage", address: L1_BLOCK, data: SLOT, expected: `0x${"0".repeat(24)}3ba4007f5c922fbb33c454b41ea7a1f11e83df2c` },
        { kind: "call", address: GPO, data: "0x54fd4d50", expected: encodeAbiParameters(parseAbiParameters("string"), ["1.6.0"]) },
        { kind: "call", address: L1_BLOCK, data: "0x54fd4d50", expected: encodeAbiParameters(parseAbiParameters("string"), ["1.7.0"]) },
        { kind: "call", address: GPO, data: "0xb54501bc", expected: `0x${"0".repeat(63)}1` },
        { kind: "call", address: GPO, data: "0x105d0b81", expected: `0x${"0".repeat(63)}1` },
    ],
};
export async function bridgeActualFees(chainId, receipt, block, call) {
    const gas = evmRpcQuantity(receipt.gasUsed), price = evmRpcQuantity(receipt.effectiveGasPrice), type = evmRpcQuantity(receipt.type);
    if (gas > (1n << 64n) - 1n || ![0n, 1n, 2n, 3n, 4n].includes(type))
        bridgeFailure("APN_RPC_PROTOCOL", "receipt_fee_shape");
    const execution = gas * price;
    let l1 = 0n, operator = 0n, blob = 0n;
    let baseOracle = null, arbitrumPosterGasAtomic = null;
    if (chainId === 8453) {
        if (type === 3n)
            bridgeFailure("APN_RPC_PROTOCOL", "unsupported_Base_blob_transaction");
        l1 = evmRpcQuantity(receipt.l1Fee);
        const pinned = { blockHash: block.hash, requireCanonical: true };
        await verifyBaseFeeDeployment(call, block);
        const data = `0x275aedd2${gas.toString(16).padStart(64, "0")}`;
        const [rawReturn, rawScalar, rawConstant] = await Promise.all([
            call("eth_call", [{ from: BRIDGE_ZERO_ADDRESS, to: GPO, data }, pinned]),
            call("eth_call", [{ from: BRIDGE_ZERO_ADDRESS, to: L1_BLOCK, data: "0x4d5d9a2a" }, pinned]),
            call("eth_call", [{ from: BRIDGE_ZERO_ADDRESS, to: L1_BLOCK, data: "0x16d3bc7f" }, pinned]),
        ]);
        operator = evmRpcWord(rawReturn);
        const scalar = evmRpcWord(rawScalar), constant = evmRpcWord(rawConstant);
        if (scalar >= 1n << 32n || constant >= 1n << 64n || gas * scalar * 100n + constant !== operator)
            bridgeFailure("APN_RPC_PROTOCOL", "operator_fee_formula");
        const hasScalar = Object.hasOwn(receipt, "operatorFeeScalar"), hasConstant = Object.hasOwn(receipt, "operatorFeeConstant");
        if (hasScalar !== hasConstant || (hasScalar && (evmRpcQuantity(receipt.operatorFeeScalar) !== scalar || evmRpcQuantity(receipt.operatorFeeConstant) !== constant)))
            bridgeFailure("APN_RPC_PROTOCOL", "operator_receipt_parameters");
        // Jovian blobGasUsed is DA footprint, not an EIP-4844 type-3 surcharge.
        evmRpcQuantity(receipt.daFootprintGasScalar);
        baseOracle = { oracle: GPO, from: BRIDGE_ZERO_ADDRESS, callData: data, rawReturn: evmRpcHex(rawReturn, 32),
            blockHash: block.hash, requireCanonical: true, version: "1.6.0", regime: "jovian", scalarAtomic: scalar.toString(), constantWei: constant.toString() };
    }
    else if (chainId === 42161) {
        const posterGas = evmRpcQuantity(receipt.gasUsedForL1);
        if (posterGas > gas)
            bridgeFailure("APN_RPC_PROTOCOL", "arbitrum_poster_gas");
        arbitrumPosterGasAtomic = posterGas.toString(); // Already included in gasUsed * effectiveGasPrice.
    }
    else if (type === 3n) {
        blob = evmRpcQuantity(receipt.blobGasUsed) * evmRpcQuantity(receipt.blobGasPrice);
    }
    const total = execution + l1 + operator + blob;
    for (const amount of [execution, l1, operator, blob, total])
        bridgeUint(amount.toString(), false, "APN_RPC_PROTOCOL");
    return { gasUsedAtomic: gas.toString(), effectiveGasPriceAtomic: price.toString(), executionFeeWei: execution.toString(),
        l1DataFeeWei: l1.toString(), operatorFeeWei: operator.toString(), blobFeeWei: blob.toString(), actualTotalFeeWei: total.toString(),
        feeEvidence: { receiptHash: hashObject(receipt), ruleHash: BRIDGE_FEE_RULE_HASH, baseOracle, arbitrumPosterGasAtomic } };
}
export async function verifyBaseFeeDeployment(call, block) {
    const pinned = { blockHash: block.hash, requireCanonical: true };
    for (const row of BASE_FEE_CONTRACT.code) {
        const code = evmRpcHex(await call("eth_getCode", [row.address, pinned]));
        if (code === "0x" || code.length > 256 * 1024 || keccak256(code) !== row.codeHash)
            bridgeFailure("APN_RPC_PROTOCOL", "Base_fee_code_identity");
    }
    for (const row of BASE_FEE_CONTRACT.reads) {
        const result = row.kind === "storage" ? await call("eth_getStorageAt", [row.address, row.data, pinned]) :
            await call("eth_call", [{ from: BRIDGE_ZERO_ADDRESS, to: row.address, data: row.data }, pinned]);
        if (evmRpcHex(result) !== row.expected)
            bridgeFailure("APN_RPC_PROTOCOL", "Base_fee_configuration_identity");
    }
}
//# sourceMappingURL=rpc-fees.js.map