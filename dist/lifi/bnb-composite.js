import { concatHex, decodeAbiParameters, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi, parseAbiParameters, recoverTypedDataAddress } from "viem";
import { bridgeFailure, bridgeHex } from "./validation.js";
export const BNB_COMPOSITE = Object.freeze({
    chainId: 56,
    receiver: getAddress("0x33b255b5db44A78c34381f89f1a454bc0Ef49871"),
    executor: getAddress("0x2dfaDAB8266483beD9Fd9A292Ce56596a2D1378D"),
    flyRouter: getAddress("0x20F6ee51340aDEed01A59B0e65cB3703f3dc860c"),
    core: getAddress("0x09ad820aac5779683b481c4674208a4e1b024afa"),
    weth: getAddress("0x2170Ed0880ac9A755fd29B2688956BD959F933F8"),
    wbnb: getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"),
    vault: getAddress("0xA82f327BBbf0667356d2935c6532D164B06cEceD"),
    poolId: "0xaecf01c5a659d74dc33c9c922a4458eab0b13dea000100000000000000000012",
    poolTokens: [getAddress("0x2170Ed0880ac9A755fd29B2688956BD959F933F8"), getAddress("0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47"),
        getAddress("0x570A5D26f7765Ecb712C0924E4De545B89fD43dF"), getAddress("0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402"),
        getAddress("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c")],
    selector: "0x46ec278a",
    balancerSelector: "0x52bbbe29",
    signer: getAddress("0x28de4113921BD79388B0ef80A259f871977442E9"),
    commandDescriptors: ["010000015a01650000", "00002001a301d0013f", "05000001d001d60000",
        "06002001d601d90000", "03000001d901e00000"],
});
const DESTINATION_MESSAGE = parseAbiParameters("bytes32 transactionId, (address callTo,address approveTo,address sendingAssetId,address receivingAssetId,uint256 fromAmount,bytes callData,bool requiresDeposit)[] swaps, address finalReceiver");
// Frozen verified program shape with only quote/header values zeroed. This makes every VM byte and sequence pointer fail closed.
const FLY_PROGRAM_SHAPE = "019a00402dfadab8266483bed9fd9a292ce56596a2d1378d2170ed0880ac9a755fd29b2688956bd959f933f800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e00114c80119c801210000000000000000000000000000000000000000000000000000000000000000f0012900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000c800000000000000c800000000000000f000002170ed0880ac9a755fd29b2688956bd959f933f8a82f327bbbf0667356d2935c6532d164b06cecedd000000000000002012b02013f0e0153015352bbbe29f8e0f800aecf01c5a659d74dc33c9c922a4458eab0b13dea000100000000000000000012bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095cf8c00101650301690603016b0603016b03016b03011304016d002003016b02012b02018d0e015301530301a103016b02018d05000002007002007007050020010000015a0165000000002001a301d0013f05000001d001d6000006002001d601d9000003000001d901e00000";
const VAULT_READ = parseAbi([
    "function getPool(bytes32 poolId) view returns (address poolAddress,uint8 specialization)",
    "function getPoolTokens(bytes32 poolId) view returns (address[] tokens,uint256[] balances,uint256 lastChangeBlock)",
]);
/** Strict parser for the one reviewed LI.FI ReceiverAcrossV4 -> Executor -> Fly program. */
export function decodeBnbCompositeMessage(message, expectedTransactionId, expectedRecipient) {
    let decoded;
    try {
        decoded = decodeAbiParameters(DESTINATION_MESSAGE, message);
    }
    catch {
        return fail("bnb_message_abi");
    }
    if (encodeAbiParameters(DESTINATION_MESSAGE, decoded) !== message)
        fail("bnb_message_noncanonical");
    const [transactionId, swaps, finalReceiver] = decoded;
    if (transactionId.toLowerCase() !== expectedTransactionId.toLowerCase() || finalReceiver !== expectedRecipient || swaps.length !== 1)
        fail("bnb_message_binding");
    const swap = swaps[0];
    if (swap.callTo !== BNB_COMPOSITE.flyRouter || swap.approveTo !== BNB_COMPOSITE.flyRouter || swap.sendingAssetId !== BNB_COMPOSITE.weth ||
        swap.receivingAssetId !== "0x0000000000000000000000000000000000000000" || swap.fromAmount <= 0n || !swap.requiresDeposit)
        fail("bnb_destination_swap");
    const program = decodeFlyProgram(swap.callData, expectedRecipient, swap.fromAmount);
    return { kind: "across-fly-bnb", transactionId, finalReceiver, inputAmountAtomic: swap.fromAmount.toString(),
        expectedOutputAtomic: program.expectedOutputAtomic, minimumOutputAtomic: program.minimumOutputAtomic,
        deadlineAtomic: program.deadlineAtomic, maximumRetentionBps: program.maximumRetentionBps,
        consumerId: program.consumerId, signature: program.signature,
        payloadHash: program.payloadHash, messageHash: keccak256(message) };
}
export function decodeFlyProgram(calldata, _expectedRecipient, expectedAmount) {
    const raw = Buffer.from(bridgeHex(calldata, 2048).slice(2), "hex");
    if (raw.length < 4 + 64 || `0x${raw.subarray(0, 4).toString("hex")}` !== BNB_COMPOSITE.selector)
        fail("fly_selector");
    const offset = uint(raw, 4, 32), length = uint(raw, 36, 32);
    if (offset !== 32n || length > 1024n)
        fail("fly_abi_bounds");
    const payloadStart = 68, payloadEnd = payloadStart + Number(length), paddedEnd = payloadStart + Math.ceil(Number(length) / 32) * 32;
    if (paddedEnd !== raw.length || raw.subarray(payloadEnd).some(Boolean))
        fail("fly_abi_padding");
    const p = raw.subarray(payloadStart, payloadEnd);
    if (p.length !== 457 || Number(uint(p, 0, 2)) !== 410 || Number(uint(p, 2, 2)) !== 64)
        fail("fly_program_header");
    const shape = Buffer.from(p);
    for (const [start, end] of [[64, 96], [105, 137], [141, 206], [208, 212], [213, 220], [221, 228], [229, 231], [272, 278]])
        shape.fill(0, start, end);
    if (shape.toString("hex") !== FLY_PROGRAM_SHAPE)
        fail("fly_program_shape");
    // Fly's signed consumer is LI.FI's Executor; the final self recipient is independently bound by the enclosing message.
    address(p, 4, BNB_COMPOSITE.executor, "fly_recipient");
    address(p, 24, BNB_COMPOSITE.weth, "fly_input");
    address(p, 44, "0x0000000000000000000000000000000000000000", "fly_output");
    if (uint(p, 64, 32) !== expectedAmount)
        fail("fly_amount");
    const deadline = compact(p, 96), minimum = compact(p, 99), expected = compact(p, 102), retention = compact(p, 137);
    if (deadline <= 0n || minimum <= 0n || expected < minimum || retention > 500n)
        fail("fly_economics");
    if (p[140] !== 0)
        fail("fly_transfer_mode");
    if (p[206] !== 0)
        fail("fly_fee_count");
    address(p, 231, BNB_COMPOSITE.weth, "fly_vm_weth");
    address(p, 251, BNB_COMPOSITE.vault, "fly_vm_vault");
    if (p[271] !== 0xd0 || uint(p, 272, 6) !== expectedAmount)
        fail("fly_vm_amount");
    if (`0x${p.subarray(289, 293).toString("hex")}` !== BNB_COMPOSITE.balancerSelector ||
        `0x${p.subarray(297, 329).toString("hex")}` !== BNB_COMPOSITE.poolId)
        fail("fly_balancer");
    address(p, 329, BNB_COMPOSITE.wbnb, "fly_vm_wbnb");
    const commands = p.subarray(412);
    if (commands.length !== 45 || BNB_COMPOSITE.commandDescriptors.some((x, i) => commands.subarray(i * 9, i * 9 + 9).toString("hex") !== x))
        fail("fly_commands");
    const consumerId = `0x${p.subarray(105, 137).toString("hex")}`;
    const signature = concatHex([`0x${p.subarray(141, 173).toString("hex")}`, `0x${p.subarray(173, 205).toString("hex")}`,
        `0x${p.subarray(205, 206).toString("hex")}`]);
    return { deadlineAtomic: deadline.toString(), minimumOutputAtomic: minimum.toString(), expectedOutputAtomic: expected.toString(),
        maximumRetentionBps: Number(retention), consumerId, signature, payloadHash: keccak256(`0x${p.toString("hex")}`) };
}
/** Rebuild Fly's exact no-fee EIP-712 header authorization; command integrity remains the parser's responsibility. */
export async function verifyFlyHeaderSignature(call, authorizedSigner) {
    const typed = { domain: { name: "Dex Aggregator", version: "1", chainId: 56, verifyingContract: BNB_COMPOSITE.flyRouter },
        primaryType: "Swap",
        types: { Swap: [
                { name: "router", type: "address" }, { name: "sender", type: "address" }, { name: "recipient", type: "address" },
                { name: "fromAsset", type: "address" }, { name: "toAsset", type: "address" }, { name: "deadline", type: "uint256" },
                { name: "amountOutMin", type: "uint256" }, { name: "expectedAmountOut", type: "uint256" }, { name: "consumerId", type: "bytes32" },
                { name: "maxRetentionBps", type: "uint256" }, { name: "transferFromRouter", type: "bool" },
            ] },
        message: { router: BNB_COMPOSITE.flyRouter, sender: BNB_COMPOSITE.executor, recipient: BNB_COMPOSITE.executor,
            fromAsset: BNB_COMPOSITE.weth, toAsset: "0x0000000000000000000000000000000000000000",
            deadline: BigInt(call.deadlineAtomic), amountOutMin: BigInt(call.minimumOutputAtomic), expectedAmountOut: BigInt(call.expectedOutputAtomic),
            consumerId: call.consumerId, maxRetentionBps: BigInt(call.maximumRetentionBps), transferFromRouter: false } };
    const digest = hashTypedData(typed);
    let signer;
    try {
        signer = getAddress(await recoverTypedDataAddress({ ...typed, signature: call.signature }));
    }
    catch {
        return fail("fly_signature");
    }
    if (signer !== authorizedSigner)
        fail("fly_signer");
    return { digest, signer };
}
export const bnbPoolReadData = Object.freeze({
    registration: encodeFunctionData({ abi: VAULT_READ, functionName: "getPool", args: [BNB_COMPOSITE.poolId] }),
    tokens: encodeFunctionData({ abi: VAULT_READ, functionName: "getPoolTokens", args: [BNB_COMPOSITE.poolId] }),
});
/** Fail-closed semantic decoding avoids pinning mutable balances while pinning the pool registration and token order. */
export function verifyBnbPoolConfiguration(registrationRaw, tokensRaw) {
    let registration, tokenState;
    try {
        registration = decodeFunctionResult({ abi: VAULT_READ, functionName: "getPool", data: bridgeHex(registrationRaw, 256) });
        tokenState = decodeFunctionResult({ abi: VAULT_READ, functionName: "getPoolTokens", data: bridgeHex(tokensRaw, 2048) });
    }
    catch {
        return fail("bnb_pool_return");
    }
    const pool = getAddress(BNB_COMPOSITE.poolId.slice(0, 42));
    if (registration[0] !== pool || registration[1] !== 1 || tokenState[0].length !== BNB_COMPOSITE.poolTokens.length ||
        tokenState[1].length !== BNB_COMPOSITE.poolTokens.length || tokenState[0].some((token, index) => token !== BNB_COMPOSITE.poolTokens[index]) ||
        tokenState[0][0] !== BNB_COMPOSITE.weth || tokenState[0].at(-1) !== BNB_COMPOSITE.wbnb || tokenState[2] <= 0n)
        fail("bnb_pool_configuration");
    return { pool, specialization: 1, tokens: tokenState[0], lastChangeBlockAtomic: tokenState[2].toString() };
}
function compact(p, at) {
    const shift = p[at];
    const pointer = Number(uint(p, at + 1, 2));
    const width = (256 - shift) / 8;
    const absolute = pointer - 68;
    if (!Number.isInteger(width) || width < 1 || width > 32 || absolute < 0 || absolute + width > 412)
        fail("fly_pointer");
    return uint(p, absolute, width);
}
function address(p, at, expected, reason) {
    if (`0x${p.subarray(at, at + 20).toString("hex")}`.toLowerCase() !== expected.toLowerCase())
        fail(reason);
}
function uint(p, at, size) {
    if (at < 0 || size < 1 || at + size > p.length)
        fail("fly_range");
    return BigInt(`0x${p.subarray(at, at + size).toString("hex")}`);
}
function fail(reason) { return bridgeFailure("APN_PROVIDER_PROTOCOL", reason); }
//# sourceMappingURL=bnb-composite.js.map