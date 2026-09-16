import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { encodeFunctionData, getAddress, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, hashObject } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { MAX_DIRECT_TRANSACTION_BYTES } from "../evm-asset.js";
import { canonicalProfile } from "../wallet-policy.js";
import { tronAddress } from "../tron/codec.js";
import { BridgeHttps } from "./https.js";
import { CircleBaseJsonRpc } from "./circle-v2-source-service.js";
import { OneClickSourceJournal } from "./near-oneclick-source-journal.js";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord, bridgeUint } from "./validation.js";
const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const ORACLE = getAddress("0x420000000000000000000000000000000000000F");
const ORIGIN = "https://1click.chaindefuser.com";
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const TRON_USDT = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";
const TRANSFER = parseAbi(["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const FEE = parseAbi(["function getL1FeeUpperBound(uint256) view returns (uint256)", "function getOperatorFee(uint256) view returns (uint256)"]);
function fail(reason) { return bridgeFailure("APN_OPERATION_BLOCKED", `oneclick_source_${reason}`); }
function quantity(value) { if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value))
    fail("rpc_quantity"); return BigInt(value); }
function word(value) { return BigInt(bridgeHex(value, 32, 32)); }
function hex(n) { return `0x${n.toString(16)}`; }
function tron(value) { try {
    return tronAddress(value);
}
catch {
    return fail("tron_recipient");
} }
export function inspectOneClickSourceQuote(response, request, minOutput, maxLoss, now) {
    const outer = bridgeRecord(response), echo = bridgeRecord(outer.quoteRequest), quote = bridgeRecord(outer.quote);
    for (const [key, value] of Object.entries(request))
        if (echo[key] !== value)
            fail(`quote_${key}`);
    const amountIn = bridgeUint(quote.amountIn), amountOut = bridgeUint(quote.amountOut), minimum = bridgeUint(quote.minAmountOut);
    const requestedAmount = bridgeUint(request.amount), deadline = Date.parse(String(request.deadline));
    if (amountIn !== requestedAmount || amountIn < bridgeUint(quote.minAmountIn) || minimum > amountOut || minimum < minOutput ||
        (amountIn > minimum ? amountIn - minimum : 0n) > maxLoss ||
        deadline - now < 45_000 || deadline - now > 180_000)
        fail("quote_amount_or_deadline");
    const responseDeadline = Date.parse(String(quote.deadline));
    if (!Number.isFinite(responseDeadline) || responseDeadline <= now)
        fail("quote_response_deadline");
    const deposit = bridgeAddress(quote.depositAddress);
    if (quote.depositMemo !== undefined && quote.depositMemo !== null && quote.depositMemo !== "")
        fail("deposit_memo");
    if (deposit === getAddress("0x0000000000000000000000000000000000000000") || deposit === USDC)
        fail("deposit_address");
    return { deposit, amountIn, amountOut, minimum, quoteHash: hashObject(response) };
}
export class OneClickSourceService {
    state;
    wrapping;
    environment;
    https;
    now;
    approve;
    constructor(state, wrapping, environment, https = new BridgeHttps(), now = Date.now, approve = approveTty) {
        this.state = state;
        this.wrapping = wrapping;
        this.environment = environment;
        this.https = https;
        this.now = now;
        this.approve = approve;
    }
    journal() { return new OneClickSourceJournal(this.state.root); }
    async submit(input) {
        const profile = canonicalProfile(input.profile), payer = bridgeAddress(input.expectedPayer), recipient = tron(input.recipient);
        const amount = bridgeUint(input.amountAtomic, true), minOutput = bridgeUint(input.minOutputAtomic, true);
        const maxLoss = bridgeUint(input.maxQuotedLossAtomic), maxGas = bridgeUint(input.maxGasLimitAtomic, true);
        const maxFee = bridgeUint(input.maxFeePerGasWei, true), maxPriority = bridgeUint(input.maxPriorityFeePerGasWei);
        const maxNative = bridgeUint(input.maxNativeDebitWei, true);
        if (amount > 10000000000000n || maxPriority > maxFee || input.idempotencyKey.length < 8 ||
            input.idempotencyKey.length > 128)
            fail("limits");
        const profileHash = this.state.profileHash(profile);
        const operationId = createHash("sha256").update(`oneclick-base-tron\0${profileHash}\0${input.idempotencyKey}`).digest("hex");
        const journal = this.journal();
        if (await journal.load(operationId) !== null)
            fail("existing_operation_use_status");
        const rpcUrl = this.environment.APN_BASE_RPC_URL;
        if (rpcUrl === undefined)
            fail("base_rpc_missing");
        const rpc = new CircleBaseJsonRpc(rpcUrl, this.https), walletStore = new EncryptedWalletStore(this.state, this.wrapping);
        await this.state.initialize();
        const loaded = await walletStore.describe(profile);
        if (loaded === null)
            fail("wallet_missing");
        try {
            if (loaded.identity.profile !== profile || loaded.identity.address !== payer ||
                privateKeyToAccount(loaded.secret.privateKey).address !== payer)
                fail("wallet_binding");
            const quoteRequest = { dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: BASE_USDC,
                depositType: "ORIGIN_CHAIN", destinationAsset: TRON_USDT, amount: amount.toString(), refundTo: payer,
                refundType: "ORIGIN_CHAIN", recipient, recipientType: "DESTINATION_CHAIN",
                deadline: new Date(this.now() + 180_000).toISOString() };
            const getQuote = async (body) => {
                const response = await this.https.request(`${ORIGIN}/v0/quote`, "POST", canonicalJson(body), 1024 * 1024, "APN_HTTP_CONFIG");
                if (response.status !== 201)
                    fail("quote_http");
                try {
                    return JSON.parse(response.body);
                }
                catch {
                    return fail("quote_json");
                }
            };
            const dry = bridgeRecord(await getQuote(quoteRequest));
            const dryQuote = bridgeRecord(dry.quote);
            if (bridgeUint(dryQuote.minAmountOut) < minOutput || bridgeUint(dryQuote.amountIn) !== amount ||
                dryQuote.depositAddress !== undefined)
                fail("dry_quote");
            const actualRequest = { ...quoteRequest, dry: false };
            const actual = await getQuote(actualRequest);
            const q = inspectOneClickSourceQuote(actual, actualRequest, minOutput, maxLoss, this.now());
            const data = encodeFunctionData({ abi: TRANSFER, functionName: "transfer", args: [q.deposit, amount] });
            if (quantity(await rpc.call("eth_chainId", [])) !== 8453n)
                fail("chain");
            const block = bridgeRecord(await rpc.call("eth_getBlockByNumber", ["safe", false]));
            const blockHash = bridgeHex(block.hash, 32, 32), blockNumber = quantity(block.number);
            const tag = { blockHash, requireCanonical: true };
            const [tokenBalance, nativeBalance, latest, pending, gasEstimate, tipEstimate, simulation] = await Promise.all([
                rpc.call("eth_call", [{ to: USDC, data: encodeFunctionData({ abi: TRANSFER, functionName: "balanceOf", args: [payer] }) }, tag]),
                rpc.call("eth_getBalance", [payer, tag]), rpc.call("eth_getTransactionCount", [payer, "latest"]),
                rpc.call("eth_getTransactionCount", [payer, "pending"]),
                rpc.call("eth_estimateGas", [{ from: payer, to: USDC, data, value: "0x0" }, tag]),
                rpc.call("eth_maxPriorityFeePerGas", []),
                rpc.call("eth_call", [{ from: payer, to: USDC, data, value: "0x0" }, tag]),
            ]);
            if (word(tokenBalance) < amount || quantity(latest) !== quantity(pending) ||
                bridgeHex(simulation, 32, 32) !== `0x${"0".repeat(63)}1`)
                fail("balance_nonce_or_simulation");
            const gas = quantity(gasEstimate) * 12n / 10n + 1n;
            const tip = quantity(tipEstimate), fee = 2n * quantity(block.baseFeePerGas) + tip;
            if (gas > maxGas || fee > maxFee || tip > maxPriority)
                fail("gas_fee");
            const [l1, operator] = await Promise.all([
                rpc.call("eth_call", [{ to: ORACLE, data: encodeFunctionData({ abi: FEE, functionName: "getL1FeeUpperBound", args: [BigInt(MAX_DIRECT_TRANSACTION_BYTES)] }) }, tag]),
                rpc.call("eth_call", [{ to: ORACLE, data: encodeFunctionData({ abi: FEE, functionName: "getOperatorFee", args: [gas] }) }, tag]),
            ]);
            const nativeDebit = gas * fee + word(l1) + word(operator);
            if (nativeDebit > maxNative || quantity(nativeBalance) < nativeDebit)
                fail("native_balance_or_cap");
            const check = bridgeRecord(await rpc.call("eth_getBlockByNumber", [hex(blockNumber), false]));
            if (bridgeHex(check.hash, 32, 32) !== blockHash || this.now() > Date.parse(actualRequest.deadline) - 45_000)
                fail("block_or_quote_expired");
            let record = await journal.stage({ operationId, profileHash, payer, recipient, refundTo: payer,
                depositAddress: q.deposit, quoteHash: q.quoteHash, quoteRequestDeadline: actualRequest.deadline,
                amountInAtomic: q.amountIn.toString(), minAmountOutAtomic: q.minimum.toString(),
                quotedAmountOutAtomic: q.amountOut.toString(), sourceBlockHash: blockHash,
                sourceCall: { to: USDC, data, nonce: quantity(latest).toString(), gas: gas.toString(),
                    maxFeePerGas: fee.toString(), maxPriorityFeePerGas: tip.toString(), maxNativeDebitWei: nativeDebit.toString() } });
            await this.approve(record);
            if (this.now() > Date.parse(record.quoteRequestDeadline) - 30_000)
                fail("quote_expired_after_approval");
            record = await journal.advance(operationId, record.integrityHash, "signing_started");
            const raw = await privateKeyToAccount(loaded.secret.privateKey).signTransaction({ type: "eip1559", chainId: 8453,
                to: USDC, data, value: 0n, nonce: Number(quantity(latest)), gas,
                maxFeePerGas: fee, maxPriorityFeePerGas: tip, accessList: [] });
            record = await journal.advance(operationId, record.integrityHash, "sealed", { rawTransaction: raw, transactionHash: keccak256(raw) });
            if (this.now() > Date.parse(record.quoteRequestDeadline) - 15_000)
                fail("quote_expired_before_send");
            record = await journal.advance(operationId, record.integrityHash, "submitting", { submissionAttempts: 1 });
            try {
                const returned = await rpc.send(raw);
                if (returned !== record.transactionHash)
                    fail("send_hash");
                record = await journal.advance(operationId, record.integrityHash, "submitted_pending");
            }
            catch {
                record = await journal.advance(operationId, record.integrityHash, "unknown_finality");
            }
            return { operationId, sourceTransactionHash: record.transactionHash, sourceState: record.phase,
                submissionAttempts: 1, oneClickDepositAddress: record.depositAddress, sourceReceiptObserved: false,
                tronDestinationDelivered: false };
        }
        finally {
            walletStore.clear(loaded.secret);
        }
    }
    async status(operationId) {
        const record = await this.journal().load(operationId);
        if (record === null)
            fail("missing_operation");
        const rpcUrl = this.environment.APN_BASE_RPC_URL;
        if (rpcUrl === undefined)
            fail("base_rpc_missing");
        const rpc = new CircleBaseJsonRpc(rpcUrl, this.https);
        const source = record.transactionHash === null ? null : await this.observeBase(rpcUrl, rpc, record);
        // Destination status is obtained from a separate provider read and is never inferred from this Base receipt.
        const endpoint = new URL(`${ORIGIN}/v0/status`);
        endpoint.searchParams.set("depositAddress", record.depositAddress);
        const response = await this.https.request(endpoint.toString(), "GET", null, 1024 * 1024, "APN_HTTP_CONFIG");
        let providerStatus = null;
        if (response.status === 200) {
            try {
                const body = bridgeRecord(JSON.parse(response.body));
                if (hashObject(body.quoteResponse) !== record.quoteHash)
                    fail("status_quote_binding");
                providerStatus = body.status;
            }
            catch {
                fail("status_json_or_binding");
            }
        }
        return { operationId, sourceTransactionHash: record.transactionHash, sourceState: record.phase,
            sourceReceipt: source, oneClickProviderStatus: providerStatus, tronDestinationClaimed: providerStatus === "SUCCESS", providerStatusProvenance: "oneclick_https_untrusted" };
    }
    async observeBase(url, rpc, record) {
        const response = await this.https.request(url, "POST", canonicalJson({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [record.transactionHash] }), 1024 * 1024, "APN_RPC_CONFIG");
        if (response.status !== 200)
            fail("receipt_http");
        let receipt;
        try {
            const body = bridgeRecord(JSON.parse(response.body));
            if (body.jsonrpc !== "2.0" || body.id !== 1 || Object.hasOwn(body, "error"))
                fail("receipt_rpc");
            receipt = body.result;
        }
        catch {
            return fail("receipt_json");
        }
        if (receipt === null)
            return null;
        const r = bridgeRecord(receipt);
        if (bridgeHex(r.transactionHash, 32, 32) !== record.transactionHash || bridgeAddress(r.to) !== USDC ||
            bridgeAddress(r.from) !== record.payer)
            fail("receipt_binding");
        const safe = bridgeRecord(await rpc.call("eth_getBlockByNumber", ["safe", false]));
        if (quantity(r.blockNumber) > quantity(safe.number))
            return { safe: false, transactionHash: record.transactionHash };
        const included = bridgeRecord(await rpc.call("eth_getBlockByNumber", [r.blockNumber, false]));
        if (bridgeHex(included.hash, 32, 32) !== bridgeHex(r.blockHash, 32, 32))
            fail("receipt_block");
        return { safe: true, transactionHash: record.transactionHash, status: quantity(r.status) === 1n ? "success" : "reverted",
            blockNumber: quantity(r.blockNumber).toString(), blockHash: bridgeHex(r.blockHash, 32, 32),
            receiptHash: hashObject(receipt), destinationDelivered: false };
    }
}
async function approveTty(record) {
    if (!stdin.isTTY || !stderr.isTTY)
        fail("foreground_tty_required");
    stderr.write(`1Click Base USDC to TRON USDT\nPayer: ${record.payer}\nRecipient: ${record.recipient}\nDeposit: ${record.depositAddress}\nAmount: ${record.amountInAtomic} atomic USDC\nMinimum: ${record.minAmountOutAtomic} atomic USDT\nQuote deadline: ${record.quoteRequestDeadline}\nMaximum Base debit: ${record.sourceCall.maxNativeDebitWei} wei\n`);
    const rl = createInterface({ input: stdin, output: stderr });
    try {
        if ((await rl.question(`Type ${record.operationId} to sign and submit once: `)).trim() !== record.operationId)
            fail("approval_denied");
    }
    finally {
        rl.close();
    }
}
//# sourceMappingURL=near-oneclick-source-service.js.map