import { concat, decodeFunctionData, encodeFunctionData, hashTypedData, numberToHex, padHex } from "viem";
import { GASLESS_ACCOUNT_ABI, GASLESS_TOKEN_ABI } from "./abi.js";
import { GASLESS_FACTORY, GASLESS_MAX_UINT, GASLESS_ZERO_ADDRESS, gaslessAddress, gaslessExact, gaslessFailure, gaslessHex, gaslessSame, gaslessUint } from "./validation.js";
const WIRE_FIELDS = ["sender", "nonce", "callData", "callGasLimit",
    "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas", "paymaster",
    "paymasterVerificationGasLimit", "paymasterPostOpGasLimit", "paymasterData", "signature"];
const AUTH_FIELDS = ["chainId", "address", "nonce", "yParity", "r", "s"];
const CURVE_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
const HALF_CURVE_ORDER = CURVE_ORDER / 2n;
export function gaslessBatch(token, recipient, recipientAtomic, paymaster) {
    gaslessAddress(token);
    gaslessAddress(recipient);
    gaslessAddress(paymaster);
    if (recipient === GASLESS_ZERO_ADDRESS || recipient === token || recipient === paymaster)
        wireFailure();
    const amount = gaslessUint(recipientAtomic, true);
    const transfer = encodeFunctionData({ abi: GASLESS_TOKEN_ABI, functionName: "transfer", args: [recipient, amount] });
    const cleanup = encodeFunctionData({ abi: GASLESS_TOKEN_ABI, functionName: "approve", args: [paymaster, 0n] });
    return encodeFunctionData({ abi: GASLESS_ACCOUNT_ABI, functionName: "executeBatch", args: [[
                { target: token, value: 0n, data: transfer }, { target: token, value: 0n, data: cleanup },
            ]] });
}
export function validateGaslessBatch(intent) {
    const recipient = intent.request.recipient;
    if ([intent.owner.address, intent.token, intent.paymaster, intent.entryPoint, intent.delegate].includes(recipient))
        wireFailure();
    const expected = gaslessBatch(intent.token, intent.request.recipient, intent.recipientAtomic, intent.paymaster);
    const data = gaslessHex(intent.callData);
    try {
        const decoded = decodeFunctionData({ abi: GASLESS_ACCOUNT_ABI, data });
        if (decoded.functionName !== "executeBatch" || !gaslessSame(data, expected) || data !== expected)
            wireFailure();
    }
    catch {
        wireFailure();
    }
}
export function gaslessPermitTypedData(intent) {
    return {
        domain: {
            name: intent.tokenDomain.name,
            version: intent.tokenDomain.version,
            chainId: intent.tokenDomain.chainId,
            verifyingContract: intent.tokenDomain.verifyingContract,
        },
        types: { Permit: [
                { name: "owner", type: "address" }, { name: "spender", type: "address" },
                { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
            ] },
        primaryType: "Permit",
        message: {
            owner: intent.owner.address, spender: intent.paymaster, value: BigInt(intent.feeCapAtomic),
            nonce: BigInt(intent.initialSnapshot.permitNonceAtomic), deadline: GASLESS_MAX_UINT,
        },
    };
}
export function gaslessAuthorizationRequest(intent) {
    const nonce = gaslessUint(intent.initialSnapshot.eoaNonceAtomic);
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER))
        wireFailure();
    return { chainId: intent.request.chainId, address: intent.delegate, nonce: Number(nonce) };
}
export function gaslessUserOperation(intent, bootstrap, signature) {
    validateGaslessBatch(intent);
    const permit = structuralSignature(bootstrap.permitSignature);
    const accountSignature = structuralSignature(signature);
    const base = {
        sender: intent.owner.address,
        nonce: quantity(intent.initialSnapshot.entryPointNonceAtomic),
        ...(usesEip7702Marker(intent) ? { factory: GASLESS_FACTORY, factoryData: "0x" } : {}),
        callData: intent.callData,
        callGasLimit: quantity(intent.gas.callGasLimit),
        verificationGasLimit: quantity(intent.gas.verificationGasLimit),
        preVerificationGas: quantity(intent.gas.preVerificationGas),
        maxFeePerGas: quantity(intent.gas.maxFeePerGas),
        maxPriorityFeePerGas: quantity(intent.gas.maxPriorityFeePerGas),
        paymaster: intent.paymaster,
        paymasterVerificationGasLimit: quantity(intent.gas.paymasterVerificationGasLimit),
        paymasterPostOpGasLimit: quantity(intent.gas.paymasterPostOpGasLimit),
        paymasterData: concat(["0x00", intent.token, word(intent.feeCapAtomic), permit]).toLowerCase(),
        signature: accountSignature,
    };
    if (bootstrap.authorization === null) {
        if (intent.initialSnapshot.delegation !== "expected")
            wireFailure();
        return base;
    }
    if (intent.initialSnapshot.delegation !== "empty")
        wireFailure();
    return { ...base, eip7702Auth: validateAuthorization(intent, bootstrap.authorization) };
}
export function gaslessUserOperationTypedData(intent, wire) {
    const validated = validateGaslessWire(intent, wire);
    return {
        types: { PackedUserOperation: [
                { type: "address", name: "sender" }, { type: "uint256", name: "nonce" },
                { type: "bytes", name: "initCode" }, { type: "bytes", name: "callData" },
                { type: "bytes32", name: "accountGasLimits" }, { type: "uint256", name: "preVerificationGas" },
                { type: "bytes32", name: "gasFees" }, { type: "bytes", name: "paymasterAndData" },
            ] },
        primaryType: "PackedUserOperation",
        domain: { name: "ERC4337", version: "1", chainId: intent.request.chainId, verifyingContract: intent.entryPoint },
        message: {
            sender: validated.sender,
            nonce: BigInt(validated.nonce),
            // EntryPoint substitutes the delegate only when initCode carries the 7702 marker.
            initCode: validated.factory === undefined ? "0x" : intent.delegate,
            callData: validated.callData,
            accountGasLimits: concat([padHex(validated.verificationGasLimit, { size: 16 }),
                padHex(validated.callGasLimit, { size: 16 })]),
            preVerificationGas: BigInt(validated.preVerificationGas),
            gasFees: concat([padHex(validated.maxPriorityFeePerGas, { size: 16 }),
                padHex(validated.maxFeePerGas, { size: 16 })]),
            paymasterAndData: concat([validated.paymaster,
                padHex(validated.paymasterVerificationGasLimit, { size: 16 }),
                padHex(validated.paymasterPostOpGasLimit, { size: 16 }), validated.paymasterData]).toLowerCase(),
        },
    };
}
export function gaslessUserOperationHash(intent, wire) {
    return hashTypedData(gaslessUserOperationTypedData(intent, wire));
}
export function validateGaslessWire(intent, value) {
    const expectsAuthorization = intent.initialSnapshot.delegation === "empty";
    const fields = [...WIRE_FIELDS, ...(usesEip7702Marker(intent) ? ["factory", "factoryData"] : []),
        ...(expectsAuthorization ? ["eip7702Auth"] : [])];
    const record = gaslessExact(value, fields, "APN_PROVIDER_PROTOCOL");
    const wire = record;
    validateGaslessBatch(intent);
    const permit = parsePaymasterData(intent, wire.paymasterData);
    structuralSignature(wire.signature);
    const authorization = expectsAuthorization ? validateAuthorization(intent, wire.eip7702Auth) : null;
    const rebuilt = gaslessUserOperation(intent, { permitSignature: permit, authorization }, wire.signature);
    if (!gaslessSame(rebuilt, wire))
        wireFailure();
    return wire;
}
export function gaslessEnvelopeBinding(intent) {
    const { unsignedEnvelopeHash: _hash, ...body } = intent;
    return { schemaVersion: "apn.gasless-envelope.v1", ...body, permitDeadlineAtomic: GASLESS_MAX_UINT.toString() };
}
function usesEip7702Marker(intent) {
    if (intent.wireVersion !== undefined && intent.wireVersion !== "apn.gasless-wire.v2")
        wireFailure();
    return intent.wireVersion === undefined || intent.initialSnapshot.delegation === "empty";
}
function parsePaymasterData(intent, value) {
    const data = gaslessHex(value, 118, 118);
    if (!data.startsWith(`0x00${intent.token.slice(2).toLowerCase()}${word(intent.feeCapAtomic).slice(2)}`))
        wireFailure();
    return structuralSignature(`0x${data.slice(2 + (1 + 20 + 32) * 2)}`);
}
function validateAuthorization(intent, value) {
    const record = gaslessExact(value, AUTH_FIELDS, "APN_PROVIDER_PROTOCOL");
    const authorization = record;
    if (authorization.chainId !== quantity(String(intent.request.chainId)) ||
        authorization.address !== intent.delegate || authorization.nonce !== quantity(intent.initialSnapshot.eoaNonceAtomic) ||
        !["0x0", "0x1"].includes(authorization.yParity) ||
        gaslessHex(authorization.r, 32, 32) !== authorization.r || gaslessHex(authorization.s, 32, 32) !== authorization.s)
        wireFailure();
    return authorization;
}
function quantity(value) {
    return numberToHex(gaslessUint(value, false, "APN_PROVIDER_PROTOCOL"));
}
function word(value) { return numberToHex(gaslessUint(value), { size: 32 }); }
function structuralSignature(value) {
    const signature = gaslessHex(value, 65, 65);
    const r = BigInt(`0x${signature.slice(2, 66)}`), s = BigInt(`0x${signature.slice(66, 130)}`);
    if ((signature.slice(-2) !== "1b" && signature.slice(-2) !== "1c") || r === 0n || r >= CURVE_ORDER ||
        s === 0n || s > HALF_CURVE_ORDER)
        wireFailure();
    return signature;
}
function wireFailure() { return gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity"); }
//# sourceMappingURL=wire.js.map