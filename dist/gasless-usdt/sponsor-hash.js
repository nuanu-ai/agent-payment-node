import { concat, encodeAbiParameters, getAddress, keccak256, padHex, recoverAddress } from "viem";
import { hashObject } from "../canonical.js";
import { decodeUsdtPaymasterData } from "./paymaster-data.js";
import { USDT_GASLESS, usdtFailure } from "./model.js";
const HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;
const uint = (value, bits) => {
    if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value) || BigInt(value) >= 1n << BigInt(bits)) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_uint");
    }
    return BigInt(value);
};
const bytes = (value) => {
    if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(value))
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_bytes");
    return value;
};
/** Raw ERC-4337 tuple, deliberately distinct from the EntryPoint's 7702 hash substitution. */
export function usdtSponsorPackedOperation(op) {
    if (getAddress(op.paymaster) !== USDT_GASLESS.paymaster ||
        (op.factory !== undefined && (op.factory !== "0x7702" || op.factoryData !== "0x")) ||
        (op.factory === undefined && op.factoryData !== undefined)) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_identity");
    }
    const payload = decodeUsdtPaymasterData(op.paymasterData);
    if (payload.token !== USDT_GASLESS.token || payload.treasury !== USDT_GASLESS.treasury || payload.exchangeRate === 0n ||
        payload.paymasterValidationGasLimit === 0n || payload.paymasterValidationGasLimit > uint(op.paymasterVerificationGasLimit, 128)) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_payload_identity");
    }
    return {
        sender: getAddress(op.sender), nonce: uint(op.nonce, 256),
        initCode: op.factory === undefined ? "0x" : concat([op.factory, op.factoryData]), callData: bytes(op.callData),
        accountGasLimits: concat([padHex(`0x${uint(op.verificationGasLimit, 128).toString(16)}`, { size: 16 }),
            padHex(`0x${uint(op.callGasLimit, 128).toString(16)}`, { size: 16 })]),
        preVerificationGas: uint(op.preVerificationGas, 256),
        gasFees: concat([padHex(`0x${uint(op.maxPriorityFeePerGas, 128).toString(16)}`, { size: 16 }),
            padHex(`0x${uint(op.maxFeePerGas, 128).toString(16)}`, { size: 16 })]),
        paymasterAndData: concat([op.paymaster, padHex(op.paymasterVerificationGasLimit, { size: 16 }),
            padHex(`0x${uint(op.paymasterPostOpGasLimit, 128).toString(16)}`, { size: 16 }), op.paymasterData]),
        signature: bytes(op.signature),
    };
}
/** Exact deployed historical V7 getHash, inherited by the pinned V8 runtime (113ce26). */
export function usdtSponsorHash(op) {
    const packed = usdtSponsorPackedOperation(op);
    const inner = keccak256(encodeAbiParameters([
        { type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" },
        { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
    ], [packed.sender, packed.nonce, packed.accountGasLimits, packed.preVerificationGas, packed.gasFees,
        keccak256(packed.initCode), keccak256(packed.callData), keccak256(`0x${packed.paymasterAndData.slice(2, 342)}`)]));
    return keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [inner, BigInt(USDT_GASLESS.chainId)]));
}
export async function recoverUsdtSponsor(op) {
    const signature = decodeUsdtPaymasterData(op.paymasterData).signature;
    const s = BigInt(`0x${signature.slice(66, 130)}`), v = signature.slice(130);
    if (s === 0n || s > HALF_ORDER || (v !== "1b" && v !== "1c")) {
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_signature");
    }
    const sponsorHash = usdtSponsorHash(op);
    const signedDigest = keccak256(concat(["0x19457468657265756d205369676e6564204d6573736167653a0a3332", sponsorHash]));
    let signer;
    try {
        signer = getAddress(await recoverAddress({ hash: signedDigest, signature }));
    }
    catch {
        return usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_signature");
    }
    if (signer === "0x0000000000000000000000000000000000000000")
        usdtFailure("APN_PROVIDER_PROTOCOL", "gasless_usdt_sponsor_signature");
    return { sponsorHash, signedDigest, signature, signer, userOperationDigest: hashObject(op) };
}
//# sourceMappingURL=sponsor-hash.js.map