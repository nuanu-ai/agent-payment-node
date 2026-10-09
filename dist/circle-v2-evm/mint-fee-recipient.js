import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, parseAbi } from "viem";
import { CIRCLE_DEPLOYMENT_PINS, CIRCLE_IMPLEMENTATION_SLOT, CIRCLE_TOKEN_IMPLEMENTATION_SLOT, CIRCLE_MESSENGER, CIRCLE_MINTER } from "./catalog.js";
import { circleFail, circleHex, circleRecord, circleUint } from "./protocol.js";
import { circleRuntimeBytecode } from "./rpc.js";
const ABI = parseAbi(["function feeRecipient() view returns(address)", "function localMinter() view returns(address)", "function localTokenMessenger() view returns(address)"]);
/** Authenticate the getter against the pinned deployment at the receipt's exact canonical block. No journal fields. */
export async function readCircleMintFeeRecipient(rpc, observation) {
    await rpc.identity();
    const block = circleRecord(observation.canonicalBlock), blockHash = circleHex(block.hash, 32);
    if (observation.chainId !== rpc.chainId || circleHex(circleRecord(observation.receipt).blockHash, 32) !== blockHash)
        circleFail("mint_fee_block_binding");
    const pins = CIRCLE_DEPLOYMENT_PINS[rpc.chainId];
    if (pins === undefined)
        circleFail("mint_fee_chain");
    const tag = { blockHash, requireCanonical: true };
    for (const key of ["messenger", "minter", "token"]) {
        const pin = pins[key], proxyHash = keccak256(circleRuntimeBytecode(await rpc.call("eth_getCode", [pin.address, tag])));
        const slot = key === "token" ? CIRCLE_TOKEN_IMPLEMENTATION_SLOT : CIRCLE_IMPLEMENTATION_SLOT;
        const word = circleHex(await rpc.call("eth_getStorageAt", [pin.address, slot, tag]), 32), implementation = getAddress(`0x${word.slice(-40)}`);
        const implementationHash = implementation === getAddress(`0x${"0".repeat(40)}`) ? null : keccak256(circleRuntimeBytecode(await rpc.call("eth_getCode", [implementation, tag])));
        if (proxyHash !== pin.proxyCodeHash || implementation.toLowerCase() !== pin.implementation.toLowerCase() || implementationHash !== pin.implementationCodeHash)
            circleFail("mint_fee_code_pin");
    }
    for (const [to, name, expected] of [[CIRCLE_MESSENGER, "localMinter", CIRCLE_MINTER], [CIRCLE_MINTER, "localTokenMessenger", CIRCLE_MESSENGER]]) {
        const data = circleHex(await rpc.call("eth_call", [{ to, data: encodeFunctionData({ abi: ABI, functionName: name }) }, tag]));
        if (decodeFunctionResult({ abi: ABI, functionName: name, data }) !== expected)
            circleFail("mint_fee_configuration");
    }
    const raw = circleHex(await rpc.call("eth_call", [{ to: CIRCLE_MESSENGER, data: encodeFunctionData({ abi: ABI, functionName: "feeRecipient" }) }, tag]));
    const recipient = getAddress(decodeFunctionResult({ abi: ABI, functionName: "feeRecipient", data: raw }));
    if (recipient === getAddress(`0x${"0".repeat(40)}`) || raw !== `0x${recipient.slice(2).toLowerCase().padStart(64, "0")}`)
        circleFail("mint_fee_recipient");
    const rechecked = await rpc.block(String(block.number));
    if (circleHex(rechecked.hash, 32) !== blockHash || circleUint(rechecked.number) !== circleUint(block.number))
        circleFail("mint_fee_reanchor");
    return recipient;
}
//# sourceMappingURL=mint-fee-recipient.js.map