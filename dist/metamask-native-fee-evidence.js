import { encodeFunctionData, getAddress } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { ApnError } from "./errors.js";
import { directEvmChain, directEvmListRows, directEvmNetwork, directEvmRequiresSafeHead } from "./evm-direct-networks.js";
import { evmUint } from "./evm-asset.js";
import { validateEvmFeeQuote } from "./evm-direct.js";
export const METAMASK_NATIVE_FEE_SELLER = "0x991e254b5c8e0aaf6c244eaa2706bad059809b04";
export const METAMASK_NATIVE_FEE_AMOUNT_ATOMIC = "1000";
export const METAMASK_NATIVE_FEE_QUOTE_SCHEMA = "apn.metamask-native-fee-quote.v1";
export const METAMASK_NATIVE_FEE_RECEIPT_SCHEMA = "apn.metamask-native-fee-receipt.v1";
const CHAINS = [1, 10, 143, 59144, 1329];
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const USDC_TRANSFER_ABI = [{
        type: "function", name: "transfer", stateMutability: "nonpayable",
        inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }],
    }];
export function validateMetaMaskNativeFeeQuote(value, now = new Date()) {
    return validateQuote(value, now);
}
function validateQuote(value, now) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schemaVersion", "chainId", "sender", "token", "tokenDecimals", "seller", "grossAtomic", "netAtomic",
        "tokenFeeAtomic", "nativeFeeCapAtomic", "transaction", "feeQuote", "expiresAt", "quoteHash",
    ]))
        invalid("Native-fee quote schema is invalid.");
    const quote = value;
    const chainId = requireChain(quote.chainId);
    const network = directEvmNetwork(chainId);
    const sender = requireAddress(quote.sender, "sender");
    const token = canonicalUsdc(chainId);
    if (quote.schemaVersion !== METAMASK_NATIVE_FEE_QUOTE_SCHEMA || quote.chainId !== chainId || quote.sender !== sender || quote.token !== token ||
        quote.tokenDecimals !== 6 || quote.seller !== METAMASK_NATIVE_FEE_SELLER || quote.grossAtomic !== "1000" ||
        quote.netAtomic !== "1000" || quote.tokenFeeAtomic !== "0") {
        invalid("Native-fee quote differs from the fixed USDC transfer identity.");
    }
    const transaction = validateTransaction(quote.transaction, token);
    const feeQuote = validateEvmFeeQuote(quote.feeQuote);
    if (feeQuote.chainId !== chainId || feeQuote.rpcOrigin.length === 0 || feeQuote.blockHash === undefined ||
        evmUint(feeQuote.maximumExecutionFeeWei, true) !== evmUint(transaction.gasLimitAtomic, true) * evmUint(transaction.maxFeePerGasAtomic, true)) {
        invalid("Native-fee quote does not bind the selected transaction and EVM fee model.");
    }
    if (network.feeModel === "monad-gas-limit" && feeQuote.feeModel !== "monad-gas-limit") {
        invalid("Monad quote must name the gas-limit charging model.");
    }
    if (network.feeModel !== "monad-gas-limit" && feeQuote.feeModel !== undefined) {
        invalid("The selected network does not use the named special quote model.");
    }
    if (network.feeModel === "op-stack" && evmUint(feeQuote.l1DataFeeUpperWei) === 0n) {
        invalid("OP quote is missing its positive L1 data-fee upper bound.");
    }
    const cap = evmUint(quote.nativeFeeCapAtomic, true);
    if (evmUint(feeQuote.totalQuoteWei, true) > cap)
        invalid("Native-fee quote exceeds the caller-supplied owner-bound cap.");
    const expiry = parseTime(quote.expiresAt, "quote expiry");
    const quotedAt = parseTime(feeQuote.observedAt, "quote observation time");
    if (expiry <= quotedAt || (now !== undefined && expiry <= now.getTime()))
        invalid("Native-fee quote has expired or has an invalid expiry.");
    const { quoteHash, ...body } = value;
    if (typeof quoteHash !== "string" || !/^[a-f0-9]{64}$/u.test(quoteHash) || hashObject(body) !== quoteHash) {
        invalid("Native-fee quote canonical hash does not match its contents.");
    }
    return quote;
}
export function validateMetaMaskNativeFeeReceipt(value, quoteValue) {
    const quote = validateQuote(quoteValue);
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schemaVersion", "quoteHash", "transactionHash", "chainId", "sender", "to", "valueAtomic", "transactionType",
        "nonceAtomic", "data", "gasLimitAtomic", "maxFeePerGasAtomic", "maxPriorityFeePerGasAtomic", "authorizationList",
        "status", "gasUsedAtomic", "effectiveGasPriceAtomic", "receiptBlock", "canonicalBlock", "logs", "rpcOrigin",
        "observedAt", ...(value.safeHead === undefined ? [] : ["safeHead"]),
        ...(value.opStackFeeComponents === undefined ? [] : ["opStackFeeComponents"]),
    ]))
        invalid("Native-fee receipt schema is invalid.");
    const evidence = value;
    const network = directEvmNetwork(quote.chainId);
    const transaction = quote.transaction;
    if (evidence.schemaVersion !== METAMASK_NATIVE_FEE_RECEIPT_SCHEMA || evidence.quoteHash !== quote.quoteHash ||
        evidence.chainId !== quote.chainId || requireAddress(evidence.sender, "receipt sender") !== quote.sender ||
        requireAddress(evidence.to, "receipt destination") !== transaction.to || evidence.valueAtomic !== "0" ||
        evidence.transactionType !== 2 || evmUint(evidence.nonceAtomic).toString() !== transaction.nonceAtomic ||
        requireHex(evidence.data, "transaction calldata") !== transaction.data.toLowerCase() ||
        evmUint(evidence.gasLimitAtomic, true).toString() !== transaction.gasLimitAtomic ||
        evmUint(evidence.maxFeePerGasAtomic, true).toString() !== transaction.maxFeePerGasAtomic ||
        evmUint(evidence.maxPriorityFeePerGasAtomic).toString() !== transaction.maxPriorityFeePerGasAtomic ||
        !Array.isArray(evidence.authorizationList) || evidence.authorizationList.length !== 0 ||
        evidence.rpcOrigin !== quote.feeQuote.rpcOrigin || !/^0x[0-9a-f]{64}$/u.test(evidence.transactionHash) ||
        evidence.transactionHash === `0x${"0".repeat(64)}` || (evidence.status !== "success" && evidence.status !== "reverted")) {
        invalid("Mined transaction fields differ from the frozen native-fee quote.");
    }
    validateReceiptBlock(evidence.receiptBlock);
    validateReceiptBlock(evidence.canonicalBlock);
    if (evidence.receiptBlock.numberAtomic !== evidence.canonicalBlock.numberAtomic ||
        evidence.receiptBlock.hash.toLowerCase() !== evidence.canonicalBlock.hash.toLowerCase() ||
        evmUint(evidence.receiptBlock.numberAtomic) < evmUint(quote.feeQuote.blockNumberAtomic)) {
        invalid("Receipt block is not reanchored to the quoted chain history.");
    }
    const finality = directEvmRequiresSafeHead(quote.chainId) ? "safe" : "inclusion";
    if (finality === "safe") {
        if (evidence.safeHead === undefined)
            invalid("This network requires a safe-head receipt anchor.");
        validateReceiptBlock(evidence.safeHead);
        if (evmUint(evidence.safeHead.numberAtomic) < evmUint(evidence.receiptBlock.numberAtomic) ||
            (evidence.safeHead.numberAtomic === evidence.receiptBlock.numberAtomic &&
                evidence.safeHead.hash.toLowerCase() !== evidence.receiptBlock.hash.toLowerCase())) {
            invalid("Safe-head evidence does not cover the receipt block.");
        }
    }
    else if (evidence.safeHead !== undefined)
        invalid("Unexpected safe-head evidence for this inclusion-only network.");
    parseTime(evidence.observedAt, "receipt observation time");
    const gasLimit = evmUint(transaction.gasLimitAtomic, true);
    const gasUsed = evmUint(evidence.gasUsedAtomic, true);
    const maxFee = evmUint(transaction.maxFeePerGasAtomic, true);
    const priorityFee = evmUint(transaction.maxPriorityFeePerGasAtomic);
    const effectivePrice = evmUint(evidence.effectiveGasPriceAtomic, true);
    if (gasUsed > gasLimit || effectivePrice > maxFee || effectivePrice < priorityFee) {
        invalid("Receipt execution quantities exceed the signed transaction bounds.");
    }
    let nativeFee = (network.feeModel === "monad-gas-limit" ? gasLimit : gasUsed) * effectivePrice;
    if (network.feeModel === "op-stack") {
        const components = evidence.opStackFeeComponents;
        if (components === undefined)
            inconclusive("op_receipt_surcharge_components_unavailable");
        if (!isPlainRecord(components) || !exactKeys(components, ["l1DataFeeAtomic", "operatorFeeAtomic", "receiptExtensionHash"]) ||
            typeof components.receiptExtensionHash !== "string" || !/^[a-f0-9]{64}$/u.test(components.receiptExtensionHash) ||
            components.receiptExtensionHash === "0".repeat(64))
            inconclusive("op_receipt_surcharge_source_unbound");
        const l1 = evmUint(components.l1DataFeeAtomic);
        const operator = evmUint(components.operatorFeeAtomic);
        if (l1 === 0n || l1 > evmUint(quote.feeQuote.l1DataFeeUpperWei) ||
            operator > evmUint(quote.feeQuote.operatorFeeUpperWei)) {
            invalid("OP receipt surcharge components exceed or contradict the frozen quote.");
        }
        nativeFee += l1 + operator;
    }
    else if (evidence.opStackFeeComponents !== undefined)
        invalid("Unexpected OP fee components for this network.");
    if (nativeFee <= 0n || nativeFee > evmUint(quote.feeQuote.totalQuoteWei) || nativeFee > evmUint(quote.nativeFeeCapAtomic)) {
        invalid("Actual native fee is zero or exceeds the frozen quote or owner-bound cap.");
    }
    const usdcTransfers = usdcTransferLogs(evidence.logs, quote);
    const hasExactTransfer = usdcTransfers.length === 1 && isExactUsdcTransfer(usdcTransfers[0], quote);
    if (evidence.status === "success" && !hasExactTransfer)
        inconclusive("successful_receipt_missing_exact_usdc_transfer");
    if (evidence.status === "reverted" && usdcTransfers.length !== 0)
        invalid("Reverted receipt cannot contain USDC transfer logs.");
    return {
        schemaVersion: METAMASK_NATIVE_FEE_RECEIPT_SCHEMA,
        transactionHash: evidence.transactionHash.toLowerCase(),
        quoteHash: quote.quoteHash,
        chainId: quote.chainId,
        nativeSymbol: network.nativeSymbol,
        nativeDecimals: network.nativeDecimals,
        nativeFeeAtomic: nativeFee.toString(),
        transferAccepted: evidence.status === "success" && hasExactTransfer,
        disposition: evidence.status === "success" ? "exact_transfer_confirmed" : "reverted_fee_charged",
        receiptBlock: evidence.receiptBlock,
        finality,
    };
}
function validateTransaction(value, token) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "type", "to", "data", "valueAtomic", "nonceAtomic", "gasLimitAtomic", "maxFeePerGasAtomic",
        "maxPriorityFeePerGasAtomic", "authorizationList",
    ]))
        invalid("Native-fee transaction schema is invalid.");
    const transaction = value;
    const expectedData = encodeFunctionData({ abi: USDC_TRANSFER_ABI, functionName: "transfer", args: [getAddress(METAMASK_NATIVE_FEE_SELLER), 1000n] });
    if (transaction.type !== 2 || transaction.to !== token || transaction.valueAtomic !== "0" ||
        requireHex(transaction.data, "transaction calldata") !== expectedData.toLowerCase() ||
        !Array.isArray(transaction.authorizationList) || transaction.authorizationList.length !== 0) {
        invalid("Native-fee transaction is not the exact type-2 USDC transfer.");
    }
    evmUint(transaction.nonceAtomic);
    evmUint(transaction.gasLimitAtomic, true);
    evmUint(transaction.maxFeePerGasAtomic, true);
    if (evmUint(transaction.maxPriorityFeePerGasAtomic) > evmUint(transaction.maxFeePerGasAtomic, true)) {
        invalid("Transaction priority fee exceeds its maximum fee.");
    }
    return transaction;
}
function canonicalUsdc(chainId) {
    const matches = directEvmListRows(chainId).filter((row) => row.kind === "token" && row.symbol === "USDC" && row.decimals === 6);
    if (matches.length !== 1 || typeof matches[0]?.identifier !== "string") {
        inconclusive("canonical_usdc_registry_entry_unavailable");
    }
    return getAddress(matches[0].identifier);
}
function usdcTransferLogs(logs, quote) {
    if (!Array.isArray(logs) || logs.length > 256)
        invalid("Receipt log collection exceeds its bound.");
    for (const log of logs) {
        if (!isPlainRecord(log) || !exactKeys(log, ["address", "topics", "data"]) || typeof log.address !== "string" ||
            !Array.isArray(log.topics) || log.topics.length > 4 ||
            log.topics.some((topic) => typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(topic)) ||
            typeof log.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(log.data))
            invalid("Receipt contains a malformed log.");
        requireAddress(log.address, "receipt log");
    }
    return logs.filter((log) => log.address.toLowerCase() === quote.token.toLowerCase() &&
        log.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC);
}
function isExactUsdcTransfer(log, quote) {
    if (!Array.isArray(log.topics) || log.topics.length !== 3 || !/^0x[0-9a-fA-F]{64}$/u.test(log.data))
        return false;
    const senderTopic = `0x${quote.sender.slice(2).toLowerCase().padStart(64, "0")}`;
    const sellerTopic = `0x${quote.seller.slice(2).toLowerCase().padStart(64, "0")}`;
    return log.topics[1]?.toLowerCase() === senderTopic && log.topics[2]?.toLowerCase() === sellerTopic &&
        BigInt(log.data).toString() === METAMASK_NATIVE_FEE_AMOUNT_ATOMIC;
}
function requireChain(value) {
    const chainId = directEvmChain(value);
    if (!CHAINS.includes(chainId))
        inconclusive("chain_not_in_finite_native_fee_scope");
    return chainId;
}
function requireAddress(value, label) {
    if (typeof value !== "string")
        invalid(`Invalid ${label} address.`);
    try {
        return getAddress(value);
    }
    catch {
        invalid(`Invalid ${label} address.`);
    }
}
function requireHex(value, label) {
    if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value))
        invalid(`Invalid ${label}.`);
    return value.toLowerCase();
}
function validateReceiptBlock(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["numberAtomic", "hash"]))
        invalid("Receipt block schema is invalid.");
    const block = value;
    evmUint(block.numberAtomic);
    if (typeof block.hash !== "string" || !/^0x[0-9a-f]{64}$/u.test(block.hash) || block.hash === `0x${"0".repeat(64)}`) {
        invalid("Receipt block hash is invalid.");
    }
    return block;
}
function parseTime(value, label) {
    if (typeof value !== "string")
        invalid(`Invalid ${label}.`);
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
        invalid(`Invalid ${label}.`);
    return parsed;
}
function invalid(message) {
    throw new ApnError("APN_STATE_CORRUPT", message);
}
function inconclusive(reason) {
    throw new ApnError("APN_RPC_AMBIGUOUS", "Native-fee evidence is incomplete and cannot be accepted.", { reason });
}
//# sourceMappingURL=metamask-native-fee-evidence.js.map