/** One finite Relay v2 BNB native to Polygon native POL quote; no signing or submission. */
import { getOrderId } from "@relay-protocol/settlement-sdk";
import { decodeFunctionData, encodeFunctionData, parseAbi, recoverMessageAddress } from "viem";
import { hashObject } from "../canonical.js";
import { BNB_NATIVE, ETHEREUM_DEPOSITORY, RELAY_SOLVER, relayStatusLocator } from "./quote.js";
export const RELAY_BNB_POLYGON_ROUTE_REFERENCE = "bnb-native-polygon-native-v1";
export const POLYGON_USDC = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
export const RELAY_BNB_SOURCE = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
export const RELAY_POLYGON_RECIPIENT = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const DEPOSIT_NATIVE = parseAbi(["function depositNative(address depositor, bytes32 id) payable"]);
const CHAINS = { ethereum: "ethereum-vm", bnb: "ethereum-vm", base: "ethereum-vm", polygon: "ethereum-vm" };
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u, UINT = /^(0|[1-9][0-9]*)$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u, HEX = /^0x(?:[0-9a-fA-F]{2})+$/u;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const fail = (reason) => { throw new Error(`Relay native quote rejected: ${reason}`); };
const record = (value, reason) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : fail(reason);
const list = (value, reason) => Array.isArray(value) ? value : fail(reason);
const string = (value, reason) => typeof value === "string" ? value : fail(reason);
const address = (value, reason) => {
    const s = string(value, reason);
    return ADDRESS.test(s) ? s : fail(reason);
};
const amount = (value, reason) => {
    const s = string(value, reason);
    return UINT.test(s) ? BigInt(s) : fail(reason);
};
const bytes32 = (value, reason) => {
    const s = string(value, reason);
    return BYTES32.test(s) ? s.toLowerCase() : fail(reason);
};
const one = (value, reason) => {
    const a = list(value, reason);
    return a.length === 1 ? record(a[0], reason) : fail(reason);
};
function keys(value, allowed, reason) {
    if (Object.keys(value).some(key => !allowed.includes(key)))
        fail(reason);
}
function freeze(value) {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value))
            freeze(child);
        Object.freeze(value);
    }
    return value;
}
export function relayNativeQuoteRequest(intent) {
    if (!same(address(intent.payer, "payer"), RELAY_BNB_SOURCE) ||
        !same(address(intent.recipient, "recipient"), RELAY_POLYGON_RECIPIENT) ||
        amount(intent.amountAtomic, "amount") <= 0n || amount(intent.minimumOutputWei, "minimum output") <= 0n)
        fail("lane intent");
    return { user: intent.payer, originChainId: 56, destinationChainId: 137,
        originCurrency: BNB_NATIVE, destinationCurrency: BNB_NATIVE,
        amount: intent.amountAtomic, tradeType: "EXACT_INPUT", recipient: intent.recipient,
        refundTo: intent.payer, includeProtocolData: true, usePermit: false, useDepositAddress: false };
}
export async function validateRelayNativeQuote(value, intent) {
    relayNativeQuoteRequest(intent);
    if (!Number.isSafeInteger(intent.nowSeconds) || intent.nowSeconds < 0)
        fail("clock");
    const quote = record(value, "quote"), steps = list(quote.steps, "steps");
    if (steps.length !== 1)
        fail("steps");
    const step = record(steps[0], "deposit step");
    keys(step, ["id", "kind", "action", "description", "items", "requestId", "depositAddress"], "step extension");
    if (step.id !== "deposit" || step.kind !== "transaction" || (step.depositAddress !== undefined && step.depositAddress !== ""))
        fail("step action");
    const item = one(step.items, "deposit items");
    keys(item, ["status", "data", "check"], "item extension");
    if (item.status !== "incomplete")
        fail("item status");
    let statusLocator;
    const ids = [quote.requestId, step.requestId].filter(v => v !== undefined);
    if (item.check !== undefined) {
        const check = record(item.check, "status check");
        keys(check, ["method", "endpoint"], "status check extension");
        if (check.method !== "GET")
            fail("status method");
        const endpoint = string(check.endpoint, "status endpoint");
        let url;
        try {
            url = new URL(endpoint, "https://api.relay.link");
        }
        catch {
            return fail("status endpoint");
        }
        ids.push(url.searchParams.get("requestId"));
        if (ids.length === 0)
            fail("request id");
        statusLocator = relayStatusLocator(ids[0], endpoint);
    }
    else if (ids.length > 0)
        statusLocator = relayStatusLocator(ids[0]);
    for (const id of ids)
        if (relayStatusLocator(id).requestId !== statusLocator?.requestId)
            fail("conflicting request ids");
    const protocol = record(record(quote.protocol, "protocol").v2, "protocol v2");
    if (protocol.hubType !== "onchain")
        fail("hub type");
    const order = record(protocol.orderData, "order");
    keys(order, ["version", "solverChainId", "solver", "salt", "inputs", "output", "fees"], "order extension");
    const input = one(order.inputs, "inputs");
    keys(input, ["payment", "refunds"], "input extension");
    const payment = record(input.payment, "payment");
    keys(payment, ["chainId", "currency", "amount", "weight"], "payment extension");
    const refunds = list(input.refunds, "refunds");
    const output = record(order.output, "output");
    keys(output, ["chainId", "payments", "calls", "deadline", "extraData"], "output extension");
    const payee = one(output.payments, "output payments");
    keys(payee, ["recipient", "currency", "minimumAmount", "expectedAmount"], "payee extension");
    if (order.version !== "v1" || order.solverChainId !== "base" || !same(address(order.solver, "solver"), RELAY_SOLVER) ||
        payment.chainId !== "bnb" || !same(address(payment.currency, "input currency"), BNB_NATIVE) ||
        amount(payment.amount, "input amount") !== amount(intent.amountAtomic, "amount") || payment.weight !== "1" ||
        output.chainId !== "polygon" || !same(address(payee.currency, "output currency"), BNB_NATIVE) ||
        !same(address(payee.recipient, "payee"), intent.recipient) || refunds.length !== 2 ||
        list(output.calls, "calls").length !== 0 || list(order.fees, "fees").length !== 0)
        fail("order identity");
    const minimum = amount(payee.minimumAmount, "minimum output");
    if (minimum < amount(intent.minimumOutputWei, "required minimum") || amount(payee.expectedAmount, "expected output") < minimum)
        fail("output minimum");
    const deadline = output.deadline;
    if (typeof deadline !== "number" || !Number.isSafeInteger(deadline) || deadline <= intent.nowSeconds + 60 ||
        deadline > intent.nowSeconds + 7 * 86400)
        fail("deadline");
    const expectedRefunds = [{ chainId: "bnb", recipient: intent.payer, currency: BNB_NATIVE },
        { chainId: "polygon", recipient: intent.recipient, currency: POLYGON_USDC }];
    const projectedRefunds = refunds.map((value, index) => {
        const refund = record(value, "refund"), expected = expectedRefunds[index];
        keys(refund, ["chainId", "recipient", "currency", "minimumAmount", "deadline", "extraData"], "refund extension");
        if (refund.chainId !== expected.chainId || !same(address(refund.recipient, "refund recipient"), expected.recipient) ||
            !same(address(refund.currency, "refund currency"), expected.currency) || amount(refund.minimumAmount, "refund minimum") !== 0n ||
            refund.deadline !== deadline)
            fail("refund");
        return { chainId: expected.chainId, recipient: address(refund.recipient, "refund recipient").toLowerCase(),
            currency: address(refund.currency, "refund currency").toLowerCase(), minimumAmount: "0", deadline,
            extraData: bytes32(refund.extraData, "refund extra data") };
    });
    const orderData = { version: "v1", solverChainId: "base", solver: address(order.solver, "solver").toLowerCase(),
        salt: bytes32(order.salt, "salt"), inputs: [{ payment: { chainId: "bnb", currency: BNB_NATIVE,
                    amount: amount(payment.amount, "input amount").toString(), weight: "1" }, refunds: projectedRefunds }],
        output: { chainId: "polygon", payments: [{ recipient: address(payee.recipient, "payee").toLowerCase(),
                    currency: BNB_NATIVE, minimumAmount: minimum.toString(), expectedAmount: amount(payee.expectedAmount, "expected output").toString() }],
            calls: [], deadline, extraData: bytes32(output.extraData, "output extra data") }, fees: [] };
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
    if (!/^0x[0-9a-fA-F]{130}$/u.test(signature))
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
    const details = record(protocol.paymentDetails, "payment details");
    if (details.chainId !== "bnb" || !same(address(details.depository, "depository"), ETHEREUM_DEPOSITORY) ||
        !same(address(details.currency, "payment currency"), BNB_NATIVE) ||
        amount(details.amount, "payment amount") !== amount(intent.amountAtomic, "amount"))
        fail("payment details");
    const quotedDetails = record(quote.details, "details"), inCurrency = record(record(quotedDetails.currencyIn, "currency in").currency, "input token"), out = record(quotedDetails.currencyOut, "currency out"), outCurrency = record(out.currency, "output token");
    if (!same(address(quotedDetails.sender, "sender"), intent.payer) || !same(address(quotedDetails.recipient, "recipient"), intent.recipient) ||
        inCurrency.chainId !== 56 || !same(address(inCurrency.address, "input token"), BNB_NATIVE) ||
        outCurrency.chainId !== 137 || !same(address(outCurrency.address, "output token"), BNB_NATIVE) ||
        amount(record(quotedDetails.currencyIn, "currency in").amount, "details input") !== amount(intent.amountAtomic, "amount") ||
        amount(out.minimumAmount, "details minimum") !== minimum)
        fail("quote details");
    const tx = record(item.data, "transaction");
    keys(tx, ["from", "to", "data", "value", "chainId", "gas", "maxFeePerGas", "maxPriorityFeePerGas"], "transaction extension");
    if (!same(address(tx.from, "transaction from"), intent.payer) || tx.chainId !== 56 ||
        !same(address(tx.to, "transaction to"), ETHEREUM_DEPOSITORY) ||
        amount(tx.value, "transaction value") !== amount(intent.amountAtomic, "amount") ||
        !HEX.test(string(tx.data, "transaction data")))
        fail("transaction envelope");
    const gas = amount(tx.gas, "gas"), maxFeePerGas = amount(tx.maxFeePerGas, "max fee"), priority = amount(tx.maxPriorityFeePerGas, "priority fee");
    if (gas === 0n || gas > 500000n || maxFeePerGas === 0n || maxFeePerGas > 100000000000n ||
        priority === 0n || priority > 10000000000n || priority > maxFeePerGas)
        fail("gas limits");
    try {
        const decoded = decodeFunctionData({ abi: DEPOSIT_NATIVE, data: string(tx.data, "transaction data") });
        if (decoded.functionName !== "depositNative" || !same(decoded.args[0], intent.payer) || !same(decoded.args[1], orderId) ||
            !same(encodeFunctionData({ abi: DEPOSIT_NATIVE, functionName: "depositNative", args: [...decoded.args] }), string(tx.data, "transaction data")))
            fail("deposit calldata");
    }
    catch {
        return fail("deposit calldata");
    }
    const projection = { schemaVersion: "apn.relay-native-quote.v1",
        routeReference: RELAY_BNB_POLYGON_ROUTE_REFERENCE,
        ...(statusLocator === undefined ? {} : { statusLocator }), orderId: orderId.toLowerCase(),
        orderSignature: signature.toLowerCase(), solver: RELAY_SOLVER, payer: intent.payer.toLowerCase(),
        recipient: intent.recipient.toLowerCase(), principalAtomic: amount(intent.amountAtomic, "amount").toString(), orderData,
        paymentDetails: { chainId: "bnb", depository: ETHEREUM_DEPOSITORY,
            currency: BNB_NATIVE, amount: amount(details.amount, "payment amount").toString() },
        minimumOutputWei: minimum.toString(), deadline,
        deposit: { from: address(tx.from, "transaction from").toLowerCase(), to: ETHEREUM_DEPOSITORY,
            data: string(tx.data, "transaction data").toLowerCase(), value: amount(tx.value, "transaction value").toString(),
            chainId: 56, gas: gas.toString(), maxFeePerGas: maxFeePerGas.toString(),
            maxPriorityFeePerGas: priority.toString(), maximumNetworkFeeWei: (gas * maxFeePerGas).toString() } };
    return freeze({ ...projection, quoteDigest: hashObject(projection) });
}
/** One public quote POST, no API key or retry. */
export async function requestRelayNativeQuote(intent, fetcher = fetch, now = () => Math.floor(Date.now() / 1000)) {
    const response = await fetcher("https://api.relay.link/quote/v2", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify(relayNativeQuoteRequest(intent)),
        signal: AbortSignal.timeout(12_000) });
    if (!response.ok)
        fail(`HTTP ${response.status}`);
    return validateRelayNativeQuote(await response.json(), { ...intent, nowSeconds: now() });
}
//# sourceMappingURL=native-quote.js.map