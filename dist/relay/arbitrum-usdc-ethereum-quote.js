/** Offline decoding of one observed Relay quote shape. This module has no prepare or execution route. */
import { getOrderId } from "@relay-protocol/settlement-sdk";
import { decodeFunctionData, encodeFunctionData, parseAbi, recoverMessageAddress } from "viem";
import { hashObject } from "../canonical.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC, RELAY_SOLVER, relayStatusLocator } from "./quote.js";
export const RELAY_ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
export const RELAY_ETHEREUM_USDC_RECIPIENT = "0x991e254B5C8e0AAf6c244eaa2706BAd059809b04";
// The captured signed order has no calls and names this exact router in all extraData fields.
const ROUTER_DATA = "0x000000000000000000000000b92fe925dc43a0ecde6c8b1a2709c170ec4fff4f";
const CHAINS = { arbitrum: "ethereum-vm", ethereum: "ethereum-vm", base: "ethereum-vm" };
const APPROVE = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const DEPOSIT = parseAbi(["function depositErc20(address depositor, address token, uint256 amount, bytes32 id)"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const UINT = /^(0|[1-9][0-9]*)$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/u;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const fail = (reason) => { throw new Error(`Relay Arbitrum quote rejected: ${reason}`); };
function object(value, reason) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : fail(reason);
}
function array(value, reason) { return Array.isArray(value) ? value : fail(reason); }
function one(value, reason) {
    const rows = array(value, reason);
    return rows.length === 1 ? object(rows[0], reason) : fail(reason);
}
function string(value, reason) { return typeof value === "string" ? value : fail(reason); }
function address(value, reason) {
    const result = string(value, reason);
    return ADDRESS.test(result) ? result.toLowerCase() : fail(reason);
}
function atomic(value, reason) {
    const result = string(value, reason);
    return UINT.test(result) ? BigInt(result) : fail(reason);
}
function keys(row, allowed, reason) {
    if (Object.keys(row).some(key => !allowed.includes(key)))
        fail(reason);
}
function frozen(value) {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value))
            frozen(child);
        Object.freeze(value);
    }
    return value;
}
export function relayArbitrumUsdcEthereumUsdcQuoteRequest(intent) {
    const payer = address(intent.payer, "payer");
    if (atomic(intent.amountAtomic, "amount") <= 0n || atomic(intent.minimumOutputAtomic, "minimum") <= 0n)
        fail("amount");
    return { user: payer, originChainId: 42161, destinationChainId: 1,
        originCurrency: RELAY_ARBITRUM_USDC, destinationCurrency: ETHEREUM_USDC,
        amount: intent.amountAtomic, tradeType: "EXACT_INPUT", recipient: RELAY_ETHEREUM_USDC_RECIPIENT,
        refundTo: payer, includeProtocolData: true, usePermit: false, useDepositAddress: false };
}
function transaction(value, id, payer) {
    const step = object(value, "step");
    keys(step, ["id", "action", "description", "kind", "items", "requestId", "depositAddress"], "step extension");
    if (step.id !== id || step.kind !== "transaction" ||
        step.action !== "Confirm transaction in your wallet" ||
        (step.depositAddress !== undefined && step.depositAddress !== ""))
        fail("step action");
    const item = one(step.items, "step items");
    keys(item, ["status", "data", "check"], "step item extension");
    if (item.status !== "incomplete")
        fail("step status");
    const tx = object(item.data, "transaction");
    keys(tx, ["from", "to", "data", "value", "chainId", "gas", "maxFeePerGas", "maxPriorityFeePerGas"], "transaction extension");
    const gas = atomic(tx.gas, "gas"), maxFee = atomic(tx.maxFeePerGas, "max fee");
    const priority = atomic(tx.maxPriorityFeePerGas, "priority fee");
    if (!same(address(tx.from, "transaction from"), payer) || tx.chainId !== 42161 ||
        atomic(tx.value, "transaction value") !== 0n || gas === 0n || gas > 500000n ||
        maxFee === 0n || maxFee > 100000000000n || priority > maxFee || priority > 10000000000n)
        fail("transaction envelope");
    const data = string(tx.data, "transaction data");
    if (!/^0x(?:[0-9a-fA-F]{2})+$/u.test(data))
        fail("transaction data");
    return { from: payer, to: address(tx.to, "transaction target"), data: data.toLowerCase(),
        value: "0", chainId: 42161, gas: gas.toString(), maxFeePerGas: maxFee.toString(),
        maxPriorityFeePerGas: priority.toString(), maximumNetworkFeeWei: (gas * maxFee).toString() };
}
/** Strictly projects the captured onchain V2 shape; never authorizes signing or sending. */
export async function validateRelayArbitrumUsdcEthereumUsdcQuote(value, intent) {
    relayArbitrumUsdcEthereumUsdcQuoteRequest(intent);
    if (!Number.isSafeInteger(intent.nowSeconds) || intent.nowSeconds < 0)
        fail("clock");
    const payer = address(intent.payer, "payer"), recipient = RELAY_ETHEREUM_USDC_RECIPIENT.toLowerCase();
    const quote = object(value, "quote");
    keys(quote, ["steps", "details", "protocol", "fees", "requestId"], "quote extension");
    const steps = array(quote.steps, "steps");
    if (steps.length !== 2)
        fail("steps");
    const requestId = string(quote.requestId, "request id");
    const locator = relayStatusLocator(requestId);
    for (const stepValue of steps) {
        const step = object(stepValue, "step");
        if (step.requestId !== requestId)
            fail("step request id");
    }
    const approvalStep = object(steps[0], "approval step"), depositStep = object(steps[1], "deposit step");
    if (one(approvalStep.items, "approval items").check !== undefined)
        fail("approval check");
    const check = object(one(depositStep.items, "deposit items").check, "deposit check");
    keys(check, ["endpoint", "method"], "check extension");
    if (check.method !== "GET" || relayStatusLocator(requestId, check.endpoint).endpoint !== locator.endpoint)
        fail("deposit check");
    const protocolContainer = object(quote.protocol, "protocol");
    keys(protocolContainer, ["v2"], "protocol version extension");
    const protocol = object(protocolContainer.v2, "protocol v2");
    keys(protocol, ["orderId", "hubType", "orderData", "orderSignature", "paymentDetails"], "protocol extension");
    if (protocol.hubType !== "onchain")
        fail("hub type");
    const order = object(protocol.orderData, "order data");
    keys(order, ["version", "solverChainId", "solver", "salt", "inputs", "output", "fees"], "order extension");
    const input = one(order.inputs, "inputs"), output = object(order.output, "output");
    keys(input, ["payment", "refunds"], "input extension");
    keys(output, ["chainId", "payments", "calls", "deadline", "extraData"], "output extension");
    const payment = object(input.payment, "payment"), payee = one(output.payments, "payments");
    keys(payment, ["chainId", "currency", "amount", "weight"], "payment extension");
    keys(payee, ["recipient", "currency", "minimumAmount", "expectedAmount"], "payee extension");
    const refunds = array(input.refunds, "refunds");
    const deadline = output.deadline;
    if (order.version !== "v1" || order.solverChainId !== "base" ||
        !same(address(order.solver, "solver"), RELAY_SOLVER) || !BYTES32.test(string(order.salt, "salt")) ||
        payment.chainId !== "arbitrum" || !same(address(payment.currency, "input currency"), RELAY_ARBITRUM_USDC) ||
        atomic(payment.amount, "input amount") !== atomic(intent.amountAtomic, "intent amount") || payment.weight !== "1" ||
        output.chainId !== "ethereum" || !same(address(payee.recipient, "recipient"), recipient) ||
        !same(address(payee.currency, "output currency"), ETHEREUM_USDC) ||
        array(output.calls, "calls").length !== 0 || array(order.fees, "fees").length !== 0 ||
        refunds.length !== 2 || output.extraData !== ROUTER_DATA ||
        typeof deadline !== "number" || !Number.isSafeInteger(deadline) ||
        deadline <= intent.nowSeconds + 60 || deadline > intent.nowSeconds + 7 * 86400)
        fail("order identity");
    const minimum = atomic(payee.minimumAmount, "output minimum");
    const expected = atomic(payee.expectedAmount, "expected output");
    if (minimum < atomic(intent.minimumOutputAtomic, "required minimum") || expected < minimum)
        fail("output bound");
    const normalizedRefunds = refunds.map((value, index) => {
        const refund = object(value, "refund");
        keys(refund, ["chainId", "recipient", "currency", "minimumAmount", "deadline", "extraData"], "refund extension");
        const chainId = index === 0 ? "arbitrum" : "ethereum";
        const expectedRecipient = index === 0 ? payer : recipient;
        const token = index === 0 ? RELAY_ARBITRUM_USDC : ETHEREUM_USDC;
        if (refund.chainId !== chainId || !same(address(refund.recipient, "refund recipient"), expectedRecipient) ||
            !same(address(refund.currency, "refund currency"), token) || atomic(refund.minimumAmount, "refund minimum") !== 0n ||
            refund.deadline !== deadline || refund.extraData !== ROUTER_DATA)
            fail("refund identity");
        return { chainId, recipient: expectedRecipient, currency: token.toLowerCase(), minimumAmount: "0", deadline, extraData: ROUTER_DATA };
    });
    const orderData = { version: "v1", solverChainId: "base", solver: RELAY_SOLVER,
        salt: string(order.salt, "salt").toLowerCase(), inputs: [{ payment: { chainId: "arbitrum",
                    currency: RELAY_ARBITRUM_USDC.toLowerCase(), amount: intent.amountAtomic, weight: "1" }, refunds: normalizedRefunds }],
        output: { chainId: "ethereum", payments: [{ recipient, currency: ETHEREUM_USDC.toLowerCase(),
                    minimumAmount: minimum.toString(), expectedAmount: expected.toString() }], calls: [], deadline, extraData: ROUTER_DATA }, fees: [] };
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
    if (!SIGNATURE.test(signature))
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
    const details = object(protocol.paymentDetails, "payment details");
    keys(details, ["chainId", "depository", "currency", "amount"], "payment details extension");
    if (details.chainId !== "arbitrum" || !same(address(details.depository, "depository"), ETHEREUM_DEPOSITORY) ||
        !same(address(details.currency, "payment currency"), RELAY_ARBITRUM_USDC) ||
        atomic(details.amount, "payment amount") !== atomic(intent.amountAtomic, "intent amount"))
        fail("payment details");
    const quoteDetails = object(quote.details, "quote details");
    const currencyIn = object(quoteDetails.currencyIn, "currency in"), currencyOut = object(quoteDetails.currencyOut, "currency out");
    const inToken = object(currencyIn.currency, "input token"), outToken = object(currencyOut.currency, "output token");
    if (!same(address(quoteDetails.sender, "sender"), payer) || !same(address(quoteDetails.recipient, "recipient"), recipient) ||
        inToken.chainId !== 42161 || !same(address(inToken.address, "input token address"), RELAY_ARBITRUM_USDC) ||
        outToken.chainId !== 1 || !same(address(outToken.address, "output token address"), ETHEREUM_USDC) ||
        atomic(currencyIn.amount, "details input") !== atomic(intent.amountAtomic, "intent amount") ||
        atomic(currencyIn.minimumAmount, "details input minimum") !== atomic(intent.amountAtomic, "intent amount") ||
        atomic(currencyOut.amount, "details output") !== expected ||
        atomic(currencyOut.minimumAmount, "details minimum") !== minimum)
        fail("quote details");
    const approval = transaction(steps[0], "approve", payer), deposit = transaction(steps[1], "deposit", payer);
    if (!same(approval.to, RELAY_ARBITRUM_USDC) || !same(deposit.to, ETHEREUM_DEPOSITORY))
        fail("transaction target");
    const fees = object(quote.fees, "fees");
    keys(fees, ["gas", "relayer", "relayerGas", "relayerService", "app", "subsidized"], "fee extension");
    const feeAmounts = Object.fromEntries(["gas", "relayer", "relayerGas", "relayerService", "app", "subsidized"].map(name => {
        const fee = object(fees[name], `${name} fee`), currency = object(fee.currency, `${name} currency`);
        const token = name === "gas" ? "0x0000000000000000000000000000000000000000" : RELAY_ARBITRUM_USDC;
        if (currency.chainId !== 42161 || !same(address(currency.address, `${name} currency`), token))
            fail("fee currency");
        const amount = atomic(fee.amount, `${name} amount`), minimumFee = atomic(fee.minimumAmount, `${name} minimum`);
        if (minimumFee !== amount)
            fail("fee minimum");
        return [name, amount];
    }));
    if (feeAmounts.gas !== BigInt(deposit.maximumNetworkFeeWei) ||
        feeAmounts.relayer !== feeAmounts.relayerGas + feeAmounts.relayerService ||
        feeAmounts.app !== 0n || feeAmounts.subsidized !== 0n ||
        atomic(intent.amountAtomic, "amount") - feeAmounts.relayer !== expected)
        fail("fee accounting");
    try {
        const decodedApproval = decodeFunctionData({ abi: APPROVE, data: approval.data });
        if (decodedApproval.functionName !== "approve" || !same(decodedApproval.args[0], ETHEREUM_DEPOSITORY) ||
            decodedApproval.args[1] !== atomic(intent.amountAtomic, "amount") ||
            !same(encodeFunctionData({ abi: APPROVE, functionName: "approve", args: [...decodedApproval.args] }), approval.data))
            fail("approval calldata");
        const decodedDeposit = decodeFunctionData({ abi: DEPOSIT, data: deposit.data });
        if (decodedDeposit.functionName !== "depositErc20" || !same(decodedDeposit.args[0], payer) ||
            !same(decodedDeposit.args[1], RELAY_ARBITRUM_USDC) || decodedDeposit.args[2] !== atomic(intent.amountAtomic, "amount") ||
            !same(decodedDeposit.args[3], orderId) ||
            !same(encodeFunctionData({ abi: DEPOSIT, functionName: "depositErc20", args: [...decodedDeposit.args] }), deposit.data))
            fail("deposit calldata");
    }
    catch {
        return fail("call data");
    }
    const projection = { schemaVersion: "apn.relay-arbitrum-usdc-ethereum-usdc-quote.v1",
        routeReference: "arbitrum-usdc-ethereum-usdc-observation-v1",
        statusLocator: locator, orderId: orderId.toLowerCase(), orderSignature: signature.toLowerCase(),
        solver: RELAY_SOLVER, payer, recipient, sourceRefundRecipient: payer,
        principalAtomic: intent.amountAtomic, minimumOutputAtomic: minimum.toString(), deadline: deadline,
        providerFeeAtomic: feeAmounts.relayer.toString(), quotedDepositNetworkFeeWei: feeAmounts.gas.toString(),
        orderData, paymentDetails: { chainId: "arbitrum", depository: ETHEREUM_DEPOSITORY,
            currency: RELAY_ARBITRUM_USDC.toLowerCase(), amount: intent.amountAtomic }, approval, deposit };
    return frozen({ ...projection, quoteDigest: hashObject(projection) });
}
//# sourceMappingURL=arbitrum-usdc-ethereum-quote.js.map