/** Offline inspection only. Never import this module into bridge admission or execution. */
import { getBase58Encoder } from "@solana/kit";
import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi } from "viem";
import { associatedUsdc } from "../solana/accounts.js";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord, bridgeUint, BRIDGE_ZERO_WORD } from "./validation.js";
// Circle: /cctp/references/contract-addresses and /cctp/references/contract-interfaces.
const WITH_FEES = getAddress("0x71f54F818671cD0D7ea140Da213e5C8b5C92a408");
const BASE_USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const ABI = parseAbi([
    "function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable",
]);
const DEFAULT_HOOK = "0x636374702d666f72776172640000000000000000000000000000000000000000";
function fail(reason) { return bridgeFailure("APN_PROVIDER_PROTOCOL", `circle_v2_upfront_${reason}`); }
function uint(value, positive = false) { return bridgeUint(value, positive); }
function safeNumber(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        fail("integer");
    return value;
}
function solanaBytes(value) {
    try {
        const bytes = getBase58Encoder().encode(value);
        if (bytes.length !== 32)
            fail("solana_address");
        return Uint8Array.from(bytes);
    }
    catch {
        return fail("solana_address");
    }
}
function hookForSetup(wallet) {
    // Circle Forwarding Service: bytes24 magic, uint32 version, uint32 length=33,
    // uint8 create-ATA flag, bytes32 wallet owner.
    return `${DEFAULT_HOOK.slice(0, 50)}000000000000002101${Buffer.from(wallet).toString("hex")}`;
}
export async function inspectCircleV2UpfrontOffline(input) {
    if (input.quoteEndpoint !== "https://iris-api.circle.com/v2/quote/burn/usdc/6/5")
        fail("quote_endpoint");
    const request = bridgeRecord(input.quoteRequest);
    const response = bridgeRecord(input.quoteResponse);
    const tx = bridgeRecord(input.transaction);
    const amount = uint(input.amountAtomic, true);
    const maxFee = uint(input.maxSourceFeeAtomic);
    if (amount > 10000000000000n || request.amount !== amount.toString() ||
        bridgeAddress(request.feeToken) !== BASE_USDC || !Array.isArray(request.requests) ||
        request.requests.length < 1 || request.requests.length > 2)
        fail("quote_request");
    const requestTypes = request.requests.map(value => bridgeRecord(value).type);
    if (requestTypes[0] !== "FORWARD" || requestTypes.some((type, index) => type !== "FORWARD" && type !== "PRE_FINALITY" || requestTypes.indexOf(type) !== index))
        fail("fee_types");
    if (bridgeAddress(response.feeToken) !== BASE_USDC || response.nonce !== "0")
        fail("quote_response");
    const signedQuote = bridgeHex(response.signedQuote, 16 * 1024);
    if (signedQuote === "0x")
        fail("missing_signed_quote");
    const fee = uint(response.feeTotalAmount);
    if (fee > maxFee || fee >= amount)
        fail("fee_ceiling");
    if (!Array.isArray(response.items) || response.items.length !== requestTypes.length)
        fail("fee_items");
    let sum = 0n;
    for (const [index, raw] of response.items.entries()) {
        const item = bridgeRecord(raw);
        if (item.type !== requestTypes[index] || !Array.isArray(item.args) || item.args.some(arg => typeof arg !== "string" || !/^0x[0-9a-fA-F]*$/u.test(arg) || arg.length > 1026))
            fail("fee_item");
        bridgeHex(item.argsHash, 32, 32);
        sum += uint(item.amount);
    }
    if (sum !== fee)
        fail("fee_sum");
    const issuedAt = safeNumber(response.issuedAt);
    const expiry = bridgeRecord(response.expiry);
    let expiryProof;
    if (expiry.mode === "BLOCK_NUMBER") {
        if (input.sourceBlockNumber === undefined || uint(input.sourceBlockNumber) >= BigInt(safeNumber(expiry.expiresAtBlock)))
            fail("block_expiry");
        expiryProof = "future_on_supplied_block";
    }
    else if (expiry.mode === "TIMESTAMP") {
        const expiresAt = safeNumber(expiry.expiresAt);
        if (expiresAt <= issuedAt || expiresAt <= Math.floor(Date.now() / 1000))
            fail("time_expiry");
        expiryProof = "future_on_local_clock";
    }
    else
        fail("expiry_mode");
    const wallet = solanaBytes(input.recipientWallet);
    const recipientAta = await associatedUsdc(input.recipientWallet);
    const ataBytes = solanaBytes(recipientAta);
    const mintRecipient = `0x${Buffer.from(ataBytes).toString("hex")}`;
    const target = bridgeAddress(tx.to);
    const refundAddress = bridgeAddress(tx.refundAddress);
    if (target !== WITH_FEES || refundAddress === "0x0000000000000000000000000000000000000000" || tx.chainId !== 8453)
        fail("source_transaction");
    const value = uint(tx.valueAtomic);
    if (value !== 0n)
        fail("usdc_fee_value");
    const data = bridgeHex(tx.data);
    let decoded;
    try {
        decoded = decodeFunctionData({ abi: ABI, data });
    }
    catch {
        return fail("source_abi");
    }
    const args = decoded.args;
    if (!args || args[0] !== amount || args[1] !== 5 || String(args[2]).toLowerCase() !== mintRecipient ||
        getAddress(String(args[3])) !== BASE_USDC || String(args[4]).toLowerCase() !== BRIDGE_ZERO_WORD)
        fail("source_binding");
    const withSetup = input.recipientSetup === "create_ata";
    if (decoded.functionName !== "depositForBurnWithHookAndFees")
        fail("method_setup");
    const claim = args[6];
    if (String(claim.signedQuote).toLowerCase() !== signedQuote || getAddress(claim.refundAddress) !== refundAddress)
        fail("claim");
    const expectedHook = withSetup ? hookForSetup(wallet) : DEFAULT_HOOK;
    if (String(args[5]).toLowerCase() !== expectedHook ||
        bridgeRecord(bridgeRecord(request.requests[0]).params).hookData !== expectedHook)
        fail("forward_hook");
    try {
        if (encodeFunctionData({ abi: ABI, functionName: decoded.functionName, args: args }).toLowerCase() !== data)
            fail("noncanonical_calldata");
    }
    catch {
        return fail("noncanonical_calldata");
    }
    return { kind: "offline_circle_v2_upfront_quote_inspection", executionAdmitted: false, sourceDomain: 6,
        destinationDomain: 5, wrapper: WITH_FEES, recipientAta, amountAtomic: amount.toString(),
        quotedFeeAtomic: fee.toString(), expiry: expiryProof, recipientSetup: input.recipientSetup,
        blockers: ["signedQuote authenticity and field binding are not verified offline", "recipient ATA existence or setup execution is not observed", "source transaction and destination mint are not observed"] };
}
//# sourceMappingURL=circle-v2-upfront-offline.js.map