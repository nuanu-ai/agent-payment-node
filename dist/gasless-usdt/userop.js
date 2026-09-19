import { concat, encodeFunctionData, hashTypedData, numberToHex, padHex, parseAbi } from "viem";
import { USDT_GASLESS, usdtFailure } from "./model.js";
export const USDT_7702_FACTORY_MARKER = "0x7702";
export function usdtUserOperation(plan, input) {
    if (input.authorization !== null && (input.authorization.address !== USDT_GASLESS.delegate || input.authorization.chainId !== "0x1")) {
        usdtFailure("APN_STATE_CORRUPT", "gasless_usdt_authorization_identity");
    }
    const q = (value) => numberToHex(value);
    return {
        sender: plan.request.sender, nonce: q(input.entryPointNonce),
        ...(input.authorization === null ? {} : { factory: USDT_7702_FACTORY_MARKER, factoryData: "0x" }),
        callData: input.callData, callGasLimit: q(plan.gas.callGasLimit), verificationGasLimit: q(plan.gas.verificationGasLimit),
        preVerificationGas: q(plan.gas.preVerificationGas), maxFeePerGas: q(plan.price.maxFeePerGas),
        maxPriorityFeePerGas: q(plan.price.maxPriorityFeePerGas), paymaster: USDT_GASLESS.paymaster,
        paymasterVerificationGasLimit: q(plan.gas.paymasterVerificationGasLimit), paymasterPostOpGasLimit: q(plan.gas.paymasterPostOpGasLimit),
        paymasterData: input.paymasterData, signature: input.signature,
        ...(input.authorization === null ? {} : { eip7702Auth: input.authorization }),
    };
}
/** EntryPoint v0.8 EIP-712 hash; the 7702 marker makes the EntryPoint hash the delegate in place of initCode. */
export function usdtUserOperationHash(op) {
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
//# sourceMappingURL=userop.js.map