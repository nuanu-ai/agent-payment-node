import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { encodeFunctionData, getAddress, keccak256, pad, parseAbi } from "viem";
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
const TRANSFER_TOPIC = keccak256(Buffer.from("Transfer(address,address,uint256)"));
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
function quoteIdentity(value) {
    const response = bridgeRecord(value);
    if (typeof response.timestamp !== "string" || !Number.isFinite(Date.parse(response.timestamp)) ||
        typeof response.signature !== "string" || response.signature.length < 16)
        fail("quote_identity");
    return hashObject({ timestamp: response.timestamp, signature: response.signature,
        quoteRequest: response.quoteRequest, quote: response.quote });
}
/** Existing v1 records hashed the whole quote envelope, including an ephemeral correlationId.
 * Rebind their provider status to every field that can change the source or destination effect.
 */
export function legacyStatusQuoteMatchesRecord(value, record) {
    try {
        const outer = bridgeRecord(value), request = bridgeRecord(outer.quoteRequest), quote = bridgeRecord(outer.quote);
        return typeof outer.timestamp === "string" && Number.isFinite(Date.parse(outer.timestamp)) &&
            typeof outer.signature === "string" && outer.signature.length >= 16 &&
            request.dry === false && request.swapType === "EXACT_INPUT" && request.slippageTolerance === 100 &&
            request.originAsset === BASE_USDC && request.depositType === "ORIGIN_CHAIN" &&
            request.destinationAsset === TRON_USDT && request.refundType === "ORIGIN_CHAIN" &&
            request.recipientType === "DESTINATION_CHAIN" && request.amount === record.amountInAtomic &&
            bridgeAddress(request.refundTo) === record.refundTo && request.recipient === record.recipient &&
            request.deadline === record.quoteRequestDeadline &&
            bridgeAddress(quote.depositAddress) === record.depositAddress &&
            (quote.depositMemo === null || quote.depositMemo === undefined || quote.depositMemo === "") &&
            bridgeUint(quote.amountIn) === BigInt(record.amountInAtomic) &&
            bridgeUint(quote.minAmountIn) <= BigInt(record.amountInAtomic) &&
            bridgeUint(quote.amountOut) === BigInt(record.quotedAmountOutAtomic) &&
            bridgeUint(quote.minAmountOut) === BigInt(record.minAmountOutAtomic) &&
            Date.parse(String(quote.deadline)) === Date.parse(record.quoteDeadline);
    }
    catch {
        return false;
    }
}
export function oneClickStatusQuoteMatchesRecord(value, record) {
    if (record.schemaVersion === "apn.oneclick-source.v1")
        return legacyStatusQuoteMatchesRecord(value, record);
    if (record.schemaVersion !== "apn.oneclick-source.v2")
        return false;
    try {
        return quoteIdentity(value) === record.quoteHash;
    }
    catch {
        return false;
    }
}
export function assertOneClickPostApproval(initial, fresh, maxNativeDebit, effectiveDeadlineMs, nowMs) {
    if (fresh.nonce !== initial.nonce || fresh.gas > initial.gas || fresh.fee > initial.fee ||
        fresh.tip > initial.tip || fresh.nativeDebit > maxNativeDebit ||
        nowMs > effectiveDeadlineMs - 30_000)
        fail("post_approval_drift");
}
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
    const effectiveDeadline = Math.min(deadline, responseDeadline);
    if (effectiveDeadline - now < 45_000)
        fail("quote_effective_deadline");
    const deposit = bridgeAddress(quote.depositAddress);
    if (quote.depositMemo !== undefined && quote.depositMemo !== null && quote.depositMemo !== "")
        fail("deposit_memo");
    if (deposit === getAddress("0x0000000000000000000000000000000000000000") || deposit === USDC)
        fail("deposit_address");
    return { deposit, amountIn, amountOut, minimum, quoteHash: quoteIdentity(response),
        quoteDeadline: new Date(responseDeadline).toISOString(), effectiveDeadline: new Date(effectiveDeadline).toISOString() };
}
export class OneClickSourceService {
    state;
    wrapping;
    environment;
    constructor(state, wrapping, environment) {
        this.state = state;
        this.wrapping = wrapping;
        this.environment = environment;
    }
    journal() { return new OneClickSourceJournal(this.state.root); }
    async submit(input) {
        const https = new BridgeHttps(), now = Date.now;
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
        const rpc = new CircleBaseJsonRpc(rpcUrl, https), walletStore = new EncryptedWalletStore(this.state, this.wrapping);
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
                deadline: new Date(now() + 180_000).toISOString() };
            const getQuote = async (body) => {
                const response = await https.request(`${ORIGIN}/v0/quote`, "POST", canonicalJson(body), 1024 * 1024, "APN_HTTP_CONFIG");
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
            const q = inspectOneClickSourceQuote(actual, actualRequest, minOutput, maxLoss, now());
            const data = encodeFunctionData({ abi: TRANSFER, functionName: "transfer", args: [q.deposit, amount] });
            const readBase = async () => {
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
                const nonce = quantity(latest);
                if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || word(tokenBalance) < amount || nonce !== quantity(pending) ||
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
                if (bridgeHex(check.hash, 32, 32) !== blockHash || now() > Date.parse(q.effectiveDeadline) - 45_000)
                    fail("block_or_quote_expired");
                return { blockHash, nonce, gas, fee, tip, nativeDebit };
            };
            const initial = await readBase();
            let record = await journal.stage({ operationId, profileHash, payer, recipient, refundTo: payer,
                depositAddress: q.deposit, quoteHash: q.quoteHash, quoteRequestDeadline: actualRequest.deadline,
                quoteDeadline: q.quoteDeadline, effectiveDeadline: q.effectiveDeadline,
                amountInAtomic: q.amountIn.toString(), minAmountOutAtomic: q.minimum.toString(),
                quotedAmountOutAtomic: q.amountOut.toString(), sourceBlockHash: initial.blockHash,
                sourceCall: { to: USDC, data, nonce: initial.nonce.toString(), gas: initial.gas.toString(),
                    maxFeePerGas: initial.fee.toString(), maxPriorityFeePerGas: initial.tip.toString(), maxNativeDebitWei: maxNative.toString() } });
            await new TtyOneClickSourceApproval().approve(record);
            const fresh = await readBase();
            assertOneClickPostApproval(initial, fresh, maxNative, Date.parse(record.effectiveDeadline), now());
            if (now() > Date.parse(record.effectiveDeadline) - 15_000)
                fail("quote_expired_before_sign");
            record = await journal.advance(operationId, record.integrityHash, "signing_started");
            const raw = await privateKeyToAccount(loaded.secret.privateKey).signTransaction({ type: "eip1559", chainId: 8453,
                to: USDC, data, value: 0n, nonce: Number(initial.nonce), gas: initial.gas,
                maxFeePerGas: initial.fee, maxPriorityFeePerGas: initial.tip, accessList: [] });
            record = await journal.advance(operationId, record.integrityHash, "sealed", { rawTransaction: raw, transactionHash: keccak256(raw) });
            if (now() > Date.parse(record.effectiveDeadline) - 15_000)
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
        const https = new BridgeHttps(), rpc = new CircleBaseJsonRpc(rpcUrl, https);
        const source = record.transactionHash === null ? null : await this.observeBase(rpcUrl, rpc, https, record);
        // Destination status is obtained from a separate provider read and is never inferred from this Base receipt.
        const endpoint = new URL(`${ORIGIN}/v0/status`);
        endpoint.searchParams.set("depositAddress", record.depositAddress);
        const response = await https.request(endpoint.toString(), "GET", null, 1024 * 1024, "APN_HTTP_CONFIG");
        let providerStatus = null;
        if (response.status === 200) {
            try {
                const body = bridgeRecord(JSON.parse(response.body));
                if (!oneClickStatusQuoteMatchesRecord(body.quoteResponse, record))
                    fail("status_quote_binding");
                providerStatus = body.status;
            }
            catch {
                fail("status_json_or_binding");
            }
        }
        return { operationId, sourceTransactionHash: record.transactionHash, sourceState: record.phase,
            sourceReceipt: source, oneClickProviderStatus: providerStatus, tronDestinationClaimed: providerStatus === "SUCCESS", providerStatusProvenance: "oneclick_https_untrusted",
            tronDestinationFinalized: false };
    }
    async observeBase(url, rpc, https, record) {
        const response = await https.request(url, "POST", canonicalJson({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [record.transactionHash] }), 1024 * 1024, "APN_RPC_CONFIG");
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
        const index = quantity(r.transactionIndex), status = quantity(r.status);
        if (bridgeHex(included.hash, 32, 32) !== bridgeHex(r.blockHash, 32, 32) ||
            !Array.isArray(included.transactions) || included.transactions.length > 20_000 ||
            index >= BigInt(included.transactions.length) || included.transactions[Number(index)] !== record.transactionHash ||
            (status !== 0n && status !== 1n))
            fail("receipt_block_or_membership");
        if (status === 1n) {
            if (!Array.isArray(r.logs) || r.logs.length > 256)
                fail("receipt_logs");
            const transfers = r.logs.filter((raw) => {
                const log = bridgeRecord(raw);
                return bridgeAddress(log.address) === USDC && Array.isArray(log.topics) && log.topics.length === 3 &&
                    log.topics[0] === TRANSFER_TOPIC && log.topics[1] === pad(bridgeAddress(record.payer)).toLowerCase() &&
                    log.topics[2] === pad(bridgeAddress(record.depositAddress)).toLowerCase() &&
                    word(log.data) === BigInt(record.amountInAtomic) &&
                    bridgeHex(log.transactionHash, 32, 32) === record.transactionHash &&
                    bridgeHex(log.blockHash, 32, 32) === bridgeHex(r.blockHash, 32, 32);
            });
            if (transfers.length !== 1)
                fail("source_transfer_log");
        }
        const recheck = bridgeRecord(await rpc.call("eth_getBlockByNumber", [r.blockNumber, false]));
        if (bridgeHex(recheck.hash, 32, 32) !== bridgeHex(r.blockHash, 32, 32))
            fail("receipt_reorg");
        return { safe: true, transactionHash: record.transactionHash, status: status === 1n ? "success" : "reverted",
            blockNumber: quantity(r.blockNumber).toString(), blockHash: bridgeHex(r.blockHash, 32, 32),
            receiptHash: hashObject(receipt), destinationDelivered: false };
    }
}
export class TtyOneClickSourceApproval {
    async approve(record) {
        if (!stdin.isTTY || !stderr.isTTY)
            fail("foreground_tty_required");
        stderr.write(`1Click Base USDC to TRON USDT\nPayer: ${record.payer}\nRecipient: ${record.recipient}\nDeposit: ${record.depositAddress}\nAmount: ${record.amountInAtomic} atomic USDC\nMinimum: ${record.minAmountOutAtomic} atomic USDT\nEffective deposit deadline: ${record.effectiveDeadline}\nMaximum Base debit: ${record.sourceCall.maxNativeDebitWei} wei\n`);
        const rl = createInterface({ input: stdin, output: stderr });
        try {
            if ((await rl.question(`Type ${record.operationId} to sign and submit once: `)).trim() !== record.operationId)
                fail("approval_denied");
        }
        finally {
            rl.close();
        }
    }
}
//# sourceMappingURL=near-oneclick-source-service.js.map