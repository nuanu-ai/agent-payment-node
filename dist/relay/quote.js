/** A finite, unsigned Relay quote lane. Nothing in this module signs or sends a transaction. */
import { getOrderId } from "@relay-protocol/settlement-sdk";
import { decodeFunctionData, encodeFunctionData, parseAbi, recoverMessageAddress } from "viem";
import { hashObject } from "../canonical.js";
export const ETHEREUM_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const BNB_NATIVE = "0x0000000000000000000000000000000000000000";
export const BASE_NATIVE = BNB_NATIVE;
// Independently read from Relay GET /chains on 2026-09-25. A change requires fresh review.
export const ETHEREUM_DEPOSITORY = "0x4cd00e387622c35bddb9b4c962c136462338bc31";
export const RELAY_SOLVER = "0xf70da97812cb96acdf810712aa562db8dfa3dbef";
const CHAINS = { ethereum: "ethereum-vm", bnb: "ethereum-vm", base: "ethereum-vm" };
const DEPOSIT_ABI = parseAbi(["function depositErc20(address depositor, address token, uint256 amount, bytes32 id)"]);
const APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})+$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const RELAY_REQUEST_ID = /^0x[0-9a-fA-F]{64}$/;
const RELAY_STATUS_ORIGIN = "https://api.relay.link";
const RELAY_STATUS_PATH = "/intents/status/v3";
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const fail = (reason) => { throw new Error(`Relay quote rejected: ${reason}`); };
const object = (value, reason) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : fail(reason);
const array = (value, reason) => Array.isArray(value) ? value : fail(reason);
const string = (value, reason) => typeof value === "string" ? value : fail(reason);
const address = (value, reason) => {
    const s = string(value, reason);
    return ADDRESS.test(s) ? s : fail(reason);
};
const amount = (value, reason) => {
    const s = string(value, reason);
    return UINT.test(s) ? BigInt(s) : fail(reason);
};
const exactlyOne = (value, reason) => {
    const a = array(value, reason);
    return a.length === 1 ? object(a[0], reason) : fail(reason);
};
const destination = (intent) => intent.destinationChainId === 8453 ? "base" : "bnb";
export function relayQuoteRequest(intent) {
    address(intent.payer, "payer");
    address(intent.recipient, "recipient");
    if (intent.destinationChainId !== undefined && intent.destinationChainId !== 56 && intent.destinationChainId !== 8453)
        fail("destination chain");
    if (amount(intent.amountAtomic, "amount") <= 0n || amount(intent.minimumOutputWei, "minimum output") <= 0n)
        fail("amount");
    return { user: intent.payer, originChainId: 1, destinationChainId: intent.destinationChainId ?? 56,
        originCurrency: ETHEREUM_USDC, destinationCurrency: BNB_NATIVE,
        amount: intent.amountAtomic, tradeType: "EXACT_INPUT", recipient: intent.recipient,
        refundTo: intent.payer, includeProtocolData: true, usePermit: false, useDepositAddress: false };
}
/** Only the Relay status/v3 endpoint can supply a status locator. Never follow a quote URL. */
export function relayStatusLocator(requestId, endpoint) {
    const id = string(requestId, "request id");
    if (!RELAY_REQUEST_ID.test(id))
        fail("request id");
    const canonicalId = id.toLowerCase();
    const canonicalEndpoint = `${RELAY_STATUS_ORIGIN}${RELAY_STATUS_PATH}?requestId=${canonicalId}`;
    if (endpoint !== undefined) {
        const source = string(endpoint, "status endpoint");
        let url;
        try {
            url = new URL(source, RELAY_STATUS_ORIGIN);
        }
        catch {
            return fail("status endpoint");
        }
        if (url.origin !== RELAY_STATUS_ORIGIN || url.pathname !== RELAY_STATUS_PATH ||
            url.username || url.password || url.hash || [...url.searchParams.keys()].length !== 1 ||
            url.searchParams.get("requestId")?.toLowerCase() !== canonicalId ||
            !RELAY_REQUEST_ID.test(url.searchParams.get("requestId") ?? "") ||
            (source.startsWith("/") && source.startsWith("//")) ||
            (!source.startsWith("/") && !source.startsWith(`${RELAY_STATUS_ORIGIN}/`)))
            fail("status endpoint");
    }
    return { requestId: canonicalId, endpoint: canonicalEndpoint };
}
function quoteStatusLocator(quote, steps) {
    const ids = [];
    const endpoints = [];
    if (quote.requestId !== undefined)
        ids.push(quote.requestId);
    for (const value of steps) {
        const step = object(value, "step");
        if (step.requestId !== undefined)
            ids.push(step.requestId);
        const item = exactlyOne(step.items, "step items");
        if (item.check !== undefined) {
            const check = object(item.check, "step check");
            onlyKeys(check, ["endpoint", "method"], "step check extension");
            if (check.method !== "GET")
                fail("step check method");
            const endpoint = string(check.endpoint, "status endpoint");
            let url;
            try {
                url = new URL(endpoint, RELAY_STATUS_ORIGIN);
            }
            catch {
                return fail("status endpoint");
            }
            ids.push(url.searchParams.get("requestId"));
            endpoints.push(endpoint);
        }
    }
    if (ids.length === 0)
        return undefined;
    const locator = relayStatusLocator(ids[0]);
    for (const value of ids.slice(1))
        if (relayStatusLocator(value).requestId !== locator.requestId)
            fail("conflicting request ids");
    for (const endpoint of endpoints)
        relayStatusLocator(locator.requestId, endpoint);
    return locator;
}
function onlyKeys(value, keys, reason) {
    for (const key of Object.keys(value))
        if (!keys.includes(key))
            fail(reason);
}
function bytes32(value, reason) {
    const s = string(value, reason);
    return BYTES32.test(s) ? s.toLowerCase() : fail(reason);
}
function frozen(value) {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value))
            frozen(child);
        Object.freeze(value);
    }
    return value;
}
function projectedTransaction(tx) {
    const gas = amount(tx.gas, "gas");
    const maxFeePerGas = amount(tx.maxFeePerGas, "max fee");
    return { from: address(tx.from, "transaction from").toLowerCase(), to: address(tx.to, "transaction to").toLowerCase(),
        data: string(tx.data, "transaction data").toLowerCase(), value: "0", chainId: 1,
        gas: gas.toString(), maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: amount(tx.maxPriorityFeePerGas, "priority fee").toString(),
        maximumNetworkFeeWei: (gas * maxFeePerGas).toString() };
}
function transaction(value, expectedId, intent) {
    const step = object(value, "step");
    for (const key of Object.keys(step))
        if (!["id", "action", "description", "kind", "items", "requestId", "depositAddress"].includes(key))
            fail("step extension");
    if (step.id !== expectedId || step.kind !== "transaction" ||
        (step.depositAddress !== undefined && step.depositAddress !== ""))
        fail("step action");
    const item = exactlyOne(step.items, "step items");
    for (const key of Object.keys(item))
        if (!["status", "data", "check"].includes(key))
            fail("step item extension");
    if (item.status !== "incomplete" || item.sign !== undefined || item.post !== undefined)
        fail("step item action");
    const tx = object(item.data, "transaction");
    if (!same(address(tx.from, "transaction from"), intent.payer) || tx.chainId !== 1 ||
        amount(tx.value, "transaction value") !== 0n || !HEX.test(string(tx.data, "transaction data")))
        fail("transaction envelope");
    for (const key of Object.keys(tx))
        if (!["from", "to", "data", "value", "chainId", "gas", "maxFeePerGas", "maxPriorityFeePerGas"].includes(key))
            fail("transaction extension");
    if (amount(tx.gas, "gas") > 500000n || amount(tx.gas, "gas") === 0n ||
        amount(tx.maxFeePerGas, "max fee") > 100000000000n || amount(tx.maxFeePerGas, "max fee") === 0n ||
        amount(tx.maxPriorityFeePerGas, "priority fee") > 10000000000n || amount(tx.maxPriorityFeePerGas, "priority fee") === 0n ||
        amount(tx.maxPriorityFeePerGas, "priority fee") > amount(tx.maxFeePerGas, "max fee"))
        fail("gas limits");
    return tx;
}
export async function validateRelayQuote(value, intent) {
    relayQuoteRequest(intent);
    const destinationChain = destination(intent);
    if (!Number.isSafeInteger(intent.nowSeconds) || intent.nowSeconds < 0)
        fail("clock");
    const quote = object(value, "quote");
    const steps = array(quote.steps, "steps");
    if (steps.length !== 2)
        fail("unsupported steps");
    const statusLocator = quoteStatusLocator(quote, steps);
    const protocol = object(object(quote.protocol, "protocol").v2, "protocol v2");
    if (protocol.hubType !== "onchain")
        fail("hub type");
    const order = object(protocol.orderData, "order data");
    onlyKeys(order, ["version", "solverChainId", "solver", "salt", "inputs", "output", "fees"], "order extension");
    const input = exactlyOne(order.inputs, "inputs");
    onlyKeys(input, ["payment", "refunds"], "input extension");
    const payment = object(input.payment, "payment");
    onlyKeys(payment, ["chainId", "currency", "amount", "weight"], "payment extension");
    const output = object(order.output, "output");
    onlyKeys(output, ["chainId", "payments", "calls", "deadline", "extraData"], "output extension");
    const payee = exactlyOne(output.payments, "output payments");
    onlyKeys(payee, ["recipient", "currency", "minimumAmount", "expectedAmount"], "payee extension");
    const refunds = array(input.refunds, "refunds");
    if (refunds.length !== 2 || array(output.calls, "calls").length !== 0 || array(order.fees, "fees").length !== 0)
        fail("order actions");
    if (order.version !== "v1" || order.solverChainId !== "base" ||
        !same(address(order.solver, "solver"), RELAY_SOLVER) ||
        payment.chainId !== "ethereum" || !same(address(payment.currency, "input currency"), ETHEREUM_USDC) ||
        amount(payment.amount, "input amount") !== amount(intent.amountAtomic, "intent amount") || payment.weight !== "1" ||
        output.chainId !== destinationChain || !same(address(payee.currency, "output currency"), BNB_NATIVE) ||
        !same(address(payee.recipient, "recipient"), intent.recipient))
        fail("order identity");
    const minimum = amount(payee.minimumAmount, "minimum output");
    if (minimum < amount(intent.minimumOutputWei, "required minimum") || amount(payee.expectedAmount, "expected output") < minimum)
        fail("output minimum");
    const deadline = output.deadline;
    if (typeof deadline !== "number" || !Number.isSafeInteger(deadline) || deadline <= intent.nowSeconds + 60 || deadline > intent.nowSeconds + 7 * 86400)
        fail("deadline");
    for (const [index, expected] of [[0, { chain: "ethereum", recipient: intent.payer, currency: ETHEREUM_USDC }],
        [1, { chain: destinationChain, recipient: intent.recipient, currency: BNB_NATIVE }]]) {
        const refund = object(refunds[index], "refund");
        onlyKeys(refund, ["chainId", "recipient", "currency", "minimumAmount", "deadline", "extraData"], "refund extension");
        if (refund.chainId !== expected.chain || !same(address(refund.recipient, "refund recipient"), expected.recipient) ||
            !same(address(refund.currency, "refund currency"), expected.currency) ||
            amount(refund.minimumAmount, "refund minimum") !== 0n || refund.deadline !== deadline)
            fail("refund");
    }
    const orderData = {
        version: "v1", solverChainId: "base", solver: address(order.solver, "solver").toLowerCase(),
        salt: bytes32(order.salt, "salt"),
        inputs: [{ payment: { chainId: "ethereum", currency: address(payment.currency, "input currency").toLowerCase(),
                    amount: amount(payment.amount, "input amount").toString(), weight: "1" },
                refunds: refunds.map((entry, index) => {
                    const refund = object(entry, "refund");
                    return { chainId: index === 0 ? "ethereum" : destinationChain,
                        recipient: address(refund.recipient, "refund recipient").toLowerCase(),
                        currency: address(refund.currency, "refund currency").toLowerCase(), minimumAmount: "0",
                        deadline: deadline, extraData: bytes32(refund.extraData, "refund extra data") };
                }) }],
        output: { chainId: destinationChain, payments: [{ recipient: address(payee.recipient, "recipient").toLowerCase(),
                    currency: address(payee.currency, "output currency").toLowerCase(), minimumAmount: minimum.toString(),
                    expectedAmount: amount(payee.expectedAmount, "expected output").toString() }], calls: [],
            deadline: deadline, extraData: bytes32(output.extraData, "output extra data") }, fees: []
    };
    const details = object(quote.details, "details");
    const currencyIn = object(details.currencyIn, "currency in"), currencyOut = object(details.currencyOut, "currency out");
    const inToken = object(currencyIn.currency, "input token"), outToken = object(currencyOut.currency, "output token");
    if (!same(address(details.sender, "sender"), intent.payer) || !same(address(details.recipient, "recipient"), intent.recipient) ||
        inToken.chainId !== 1 || !same(address(inToken.address, "input token"), ETHEREUM_USDC) ||
        outToken.chainId !== (intent.destinationChainId ?? 56) || !same(address(outToken.address, "output token"), BNB_NATIVE) ||
        amount(currencyIn.amount, "details input") !== amount(intent.amountAtomic, "intent input") ||
        amount(currencyOut.minimumAmount, "details minimum") !== minimum)
        fail("quote details");
    let orderId;
    try {
        orderId = getOrderId(orderData, CHAINS);
    }
    catch {
        return fail("order encoding");
    }
    if (!same(string(protocol.orderId, "order id"), orderId))
        fail("order id");
    const signature = string(protocol.orderSignature, "order signature");
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature))
        fail("order signature");
    let signer;
    try {
        signer = await recoverMessageAddress({ message: { raw: orderId }, signature: signature });
    }
    catch {
        return fail("order signature");
    }
    if (!same(signer, RELAY_SOLVER))
        fail("order signer");
    const paymentDetails = object(protocol.paymentDetails, "payment details");
    if (paymentDetails.chainId !== "ethereum" ||
        !same(address(paymentDetails.depository, "depository"), ETHEREUM_DEPOSITORY) ||
        !same(address(paymentDetails.currency, "payment currency"), ETHEREUM_USDC) ||
        amount(paymentDetails.amount, "payment amount") !== amount(intent.amountAtomic, "intent amount"))
        fail("payment details");
    const approval = transaction(steps[0], "approve", intent);
    const deposit = transaction(steps[1], "deposit", intent);
    if (!same(address(approval.to, "approval target"), ETHEREUM_USDC) ||
        !same(address(deposit.to, "deposit target"), ETHEREUM_DEPOSITORY))
        fail("transaction target");
    try {
        const approved = decodeFunctionData({ abi: APPROVE_ABI, data: approval.data });
        if (approved.functionName !== "approve" || !same(approved.args[0], ETHEREUM_DEPOSITORY) || approved.args[1] !== amount(intent.amountAtomic, "amount"))
            fail("approval calldata");
        if (!same(encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [...approved.args] }), approval.data))
            fail("approval calldata");
        const deposited = decodeFunctionData({ abi: DEPOSIT_ABI, data: deposit.data });
        if (deposited.functionName !== "depositErc20" || !same(deposited.args[0], intent.payer) ||
            !same(deposited.args[1], ETHEREUM_USDC) || deposited.args[2] !== amount(intent.amountAtomic, "amount") ||
            !same(deposited.args[3], orderId))
            fail("deposit calldata");
        if (!same(encodeFunctionData({ abi: DEPOSIT_ABI, functionName: "depositErc20", args: [...deposited.args] }), deposit.data))
            fail("deposit calldata");
    }
    catch {
        return fail("call data");
    }
    const projection = { schemaVersion: "apn.relay-quote.v1",
        ...(destinationChain === "base" ? { routeReference: "ethereum-usdc-base-eth-v1" } : {}),
        ...(statusLocator === undefined ? {} : { statusLocator }), orderId: orderId.toLowerCase(),
        orderSignature: signature.toLowerCase(), solver: RELAY_SOLVER, payer: intent.payer.toLowerCase(),
        recipient: intent.recipient.toLowerCase(), sourceRefundRecipient: intent.payer.toLowerCase(),
        principalAtomic: amount(intent.amountAtomic, "amount").toString(), orderData,
        paymentDetails: { chainId: "ethereum", depository: ETHEREUM_DEPOSITORY,
            currency: ETHEREUM_USDC.toLowerCase(), amount: amount(paymentDetails.amount, "payment amount").toString() },
        minimumOutputWei: minimum.toString(), deadline: deadline,
        approval: projectedTransaction(approval), deposit: projectedTransaction(deposit) };
    return frozen({ ...projection, quoteDigest: hashObject(projection) });
}
/** One POST, no API key, no retry. The caller receives a validated unsigned envelope only. */
export async function requestRelayQuote(intent, fetcher = fetch, now = () => Math.floor(Date.now() / 1000)) {
    const response = await fetcher("https://api.relay.link/quote/v2", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(relayQuoteRequest(intent)), signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok)
        fail(`HTTP ${response.status}`);
    const body = await response.json();
    return validateRelayQuote(body, { ...intent, nowSeconds: now() });
}
//# sourceMappingURL=quote.js.map