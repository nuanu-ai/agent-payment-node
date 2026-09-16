/** Snapshot-only preflight. Keep this module out of execution until the caller can place it immediately before source submission. */
import { decodeFunctionData, parseAbi } from "viem";
import { inspectCircleV2UpfrontOffline } from "./circle-v2-upfront-offline.js";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord, bridgeUint } from "./validation.js";
const ABI_SIGNATURE = "depositForBurnWithHookAndFees(uint256,uint32,bytes32,address,bytes32,bytes,(bytes,address))";
const ABI = parseAbi([`function ${ABI_SIGNATURE} payable`]);
const VALIDATE_URL = "https://iris-api.circle.com/v2/quote/validate/usdc/6";
function fail(reason) { return bridgeFailure("APN_PROVIDER_PROTOCOL", `circle_v2_preflight_${reason}`); }
function quantity(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value))
        fail("block_quantity");
    return BigInt(value);
}
function integer(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        fail("expiry_integer");
    return BigInt(value);
}
function sameHex(a, b) { return bridgeHex(a, 16 * 1024) === bridgeHex(b, 16 * 1024); }
function sameQuoteArg(a, b) {
    if (typeof a === "string" && typeof b === "string" && /^(?:0|[1-9][0-9]*)$/u.test(a) && /^(?:0|[1-9][0-9]*)$/u.test(b))
        return a === b;
    return sameHex(a, b);
}
function sourceBlock(value) {
    const block = bridgeRecord(value);
    return { number: quantity(block.number), hash: bridgeHex(block.hash, 32, 32), timestamp: quantity(block.timestamp) };
}
function fresh(timestamp) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    return timestamp <= now + 30n && now <= timestamp + 120n;
}
/** Circle checks its own current tip; Base simulation is pinned to a separate canonical block observation. Neither authorizes execution. */
export async function inspectCircleV2Preflight(input, transport) {
    const tx = bridgeRecord(input.transaction);
    const data = bridgeHex(tx.data);
    let decoded;
    try {
        decoded = decodeFunctionData({ abi: ABI, data });
    }
    catch {
        return fail("abi");
    }
    if (decoded.functionName !== "depositForBurnWithHookAndFees" || !decoded.args)
        fail("abi");
    const [amount, destination, recipient, token, caller, hook, claim] = decoded.args;
    const args = [amount.toString(), destination.toString(), recipient, token, caller, hook,
        [claim[0], claim[1]]];
    const response = bridgeRecord(input.quoteResponse);
    const payer = bridgeAddress(input.payer);
    const source = bridgeAddress(tx.to);
    const value = bridgeUint(tx.valueAtomic);
    let validation;
    try {
        validation = bridgeRecord(await transport({ target: "circle", url: VALIDATE_URL, body: { abiSignature: ABI_SIGNATURE, args } }));
    }
    catch {
        return fail("circle_unavailable");
    }
    if (validation.claimable !== true || !Array.isArray(validation.failedChecks) || validation.failedChecks.length !== 0)
        fail("claimability");
    if (!sameHex(validation.signedQuote, response.signedQuote) || bridgeUint(validation.feeTotalAmount) !== bridgeUint(response.feeTotalAmount) ||
        bridgeAddress(validation.feeToken) !== bridgeAddress(response.feeToken) || bridgeUint(validation.nonce) !== bridgeUint(response.nonce))
        fail("signed_fields");
    const quotedExpiry = bridgeRecord(response.expiry);
    const expiry = bridgeRecord(validation.expiry);
    if (expiry.mode !== quotedExpiry.mode || expiry.expired !== false || integer(expiry.secondsRemaining) === 0n)
        fail("expiry");
    if (expiry.mode === "BLOCK_NUMBER") {
        if (integer(expiry.expiresAtBlock) !== integer(quotedExpiry.expiresAtBlock))
            fail("expiry");
    }
    else if (expiry.mode === "TIMESTAMP") {
        if (integer(expiry.expiresAt) !== integer(quotedExpiry.expiresAt) || integer(expiry.expiresAt) <= BigInt(Math.floor(Date.now() / 1000)))
            fail("expiry");
    }
    else
        fail("expiry");
    if (!Array.isArray(validation.items) || !Array.isArray(response.items) || validation.items.length !== response.items.length)
        fail("items");
    for (let i = 0; i < response.items.length; i += 1) {
        const actual = bridgeRecord(validation.items[i]), expected = bridgeRecord(response.items[i]);
        if (actual.argsMatch !== true || actual.type !== expected.type)
            fail("item_binding");
        if (actual.amount !== undefined && bridgeUint(actual.amount) !== bridgeUint(expected.amount))
            fail("item_binding");
        if (actual.argsHash !== undefined && !sameHex(actual.argsHash, expected.argsHash))
            fail("item_binding");
        if (actual.computedArgsHash !== undefined && !sameHex(actual.computedArgsHash, expected.argsHash))
            fail("item_binding");
        const actualArgs = actual.args, expectedArgs = expected.args;
        if (actualArgs !== undefined && (!Array.isArray(actualArgs) || !Array.isArray(expectedArgs) ||
            actualArgs.length !== expectedArgs.length || actualArgs.some((arg, index) => !sameQuoteArg(arg, expectedArgs[index]))))
            fail("item_args");
    }
    let block;
    try {
        block = sourceBlock(await transport({ target: "base", method: "eth_getBlockByNumber", params: ["latest", false] }));
    }
    catch {
        return fail("base_unavailable");
    }
    if (!fresh(block.timestamp))
        fail("stale_block");
    await inspectCircleV2UpfrontOffline({ ...input, sourceBlockNumber: block.number.toString() });
    if (expiry.mode === "BLOCK_NUMBER" && block.number >= integer(expiry.expiresAtBlock))
        fail("expired_block");
    try {
        bridgeHex(await transport({ target: "base", method: "eth_call", params: [{ from: payer, to: source, data, value: `0x${value.toString(16)}` },
                { blockHash: block.hash, requireCanonical: true }] }));
    }
    catch {
        return fail("simulation_reverted");
    }
    let after;
    try {
        after = sourceBlock(await transport({ target: "base", method: "eth_getBlockByNumber", params: ["latest", false] }));
    }
    catch {
        return fail("base_unavailable");
    }
    if (after.number !== block.number || after.hash !== block.hash || after.timestamp !== block.timestamp || !fresh(after.timestamp))
        fail("stale_block");
    return { kind: "circle_v2_preflight_snapshot", executionAdmitted: false, blockNumber: block.number.toString(), blockHash: block.hash, abiSignature: ABI_SIGNATURE };
}
//# sourceMappingURL=circle-v2-preflight.js.map