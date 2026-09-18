import { createHash } from "node:crypto";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { approvalCode } from "../approval-code.js";
import { canonicalJson, hashObject } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { SolanaRpc } from "../solana/rpc.js";
import { TronRpc } from "../tron/rpc.js";
import { exactChainConsent } from "../tty-approval.js";
import { canonicalProfile } from "../wallet-policy.js";
import { BridgeHttps } from "./https.js";
import { oneClickDestinationHashes, proveOneClickDestination } from "./near-oneclick-destination.js";
import { assertOneClickNativePostApproval, assertOneClickPostApproval, OneClickEvmSource, planOneClickNative } from "./near-oneclick-evm-source.js";
import { LEGACY_ONECLICK_LANE, oneClickLane, oneClickRecipient } from "./near-oneclick-lanes.js";
import { OneClickSourceJournal, oneClickRecordLane, oneClickSourceCall } from "./near-oneclick-source-journal.js";
import { bridgeAddress, bridgeFailure, bridgeRecord, bridgeUint } from "./validation.js";
export { assertOneClickPostApproval } from "./near-oneclick-evm-source.js";
const ORIGIN = "https://1click.chaindefuser.com";
/** The quote request deadline is set this far ahead; it also bounds how old an attributable destination credit may be. */
const QUOTE_WINDOW_MS = 180_000;
const ZERO = "0x0000000000000000000000000000000000000000";
function fail(reason) { return bridgeFailure("APN_OPERATION_BLOCKED", `oneclick_source_${reason}`); }
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
    const legacy = oneClickLane(LEGACY_ONECLICK_LANE);
    try {
        const outer = bridgeRecord(value), request = bridgeRecord(outer.quoteRequest), quote = bridgeRecord(outer.quote);
        return typeof outer.timestamp === "string" && Number.isFinite(Date.parse(outer.timestamp)) &&
            typeof outer.signature === "string" && outer.signature.length >= 16 &&
            request.dry === false && request.swapType === "EXACT_INPUT" && request.slippageTolerance === 100 &&
            request.originAsset === legacy.origin.oneClickAsset && request.depositType === "ORIGIN_CHAIN" &&
            request.destinationAsset === legacy.destination.oneClickAsset && request.refundType === "ORIGIN_CHAIN" &&
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
    if (record.schemaVersion !== "apn.oneclick-source.v2" && record.schemaVersion !== "apn.oneclick-source.v3")
        return false;
    try {
        if (quoteIdentity(value) === record.quoteHash)
            return true;
        const status = bridgeRecord(value), request = bridgeRecord(status.quoteRequest);
        // 1Click's status response omits two neutral quote defaults and adds three null fields.
        // Reconstruct only that observed representation; the signature, quote economics,
        // deposit address, payer, recipient and deadlines still participate in the saved digest.
        if (Object.hasOwn(request, "insured") || Object.hasOwn(request, "quoteWaitingTimeMs"))
            return false;
        const originalRequest = { ...request, insured: false, quoteWaitingTimeMs: 0 };
        for (const key of ["referral", "virtualChainRecipient", "virtualChainRefundRecipient"]) {
            if (!Object.hasOwn(originalRequest, key) || originalRequest[key] !== null)
                return false;
            delete originalRequest[key];
        }
        return quoteIdentity({ ...status, quoteRequest: originalRequest }) === record.quoteHash;
    }
    catch {
        return false;
    }
}
export { assertOneClickNativePostApproval };
export function inspectOneClickSourceQuote(response, request, minOutput, maxLoss, now, lane) {
    const outer = bridgeRecord(response), echo = bridgeRecord(outer.quoteRequest), quote = bridgeRecord(outer.quote);
    if (request.originAsset !== lane.origin.oneClickAsset || request.destinationAsset !== lane.destination.oneClickAsset)
        fail("quote_lane");
    for (const [key, value] of Object.entries(request))
        if (echo[key] !== value)
            fail(`quote_${key}`);
    const amountIn = bridgeUint(quote.amountIn), amountOut = bridgeUint(quote.amountOut), minimum = bridgeUint(quote.minAmountOut);
    const requestedAmount = bridgeUint(request.amount), deadline = Date.parse(String(request.deadline));
    const loss = lane.loss === "input_at_par" ? (amountIn > minimum ? amountIn - minimum : 0n) : amountOut - minimum;
    if (amountIn !== requestedAmount || amountIn < bridgeUint(quote.minAmountIn) || minimum > amountOut || minimum < minOutput ||
        loss > maxLoss || deadline - now < 45_000 || deadline - now > QUOTE_WINDOW_MS)
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
    if (deposit === ZERO || deposit === lane.origin.token || deposit === bridgeAddress(request.refundTo))
        fail("deposit_address");
    return { deposit, amountIn, amountOut, minimum, quoteHash: quoteIdentity(response),
        quoteDeadline: new Date(responseDeadline).toISOString(), effectiveDeadline: new Date(effectiveDeadline).toISOString() };
}
/** Legacy lane IDs keep their original derivation, so an old idempotency key still resolves to its existing operation. */
export function oneClickOperationId(lane, profileHash, idempotencyKey) {
    const domain = lane.id === LEGACY_ONECLICK_LANE ? "oneclick-base-tron" : `oneclick-lane\0${lane.id}`;
    return createHash("sha256").update(`${domain}\0${profileHash}\0${idempotencyKey}`).digest("hex");
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
    rpcUrl(name, network) {
        const url = this.environment[name];
        if (url === undefined)
            fail(`${network}_rpc_missing`);
        return url;
    }
    async submit(input) {
        const https = new BridgeHttps(), now = Date.now, lane = oneClickLane(input.lane);
        const profile = canonicalProfile(input.profile), payer = bridgeAddress(input.expectedPayer), recipient = oneClickRecipient(lane, input.recipient);
        const amount = bridgeUint(input.amountAtomic, true), minOutput = bridgeUint(input.minOutputAtomic, true);
        const maxLoss = bridgeUint(input.maxQuotedLossAtomic), maxGas = bridgeUint(input.maxGasLimitAtomic, true);
        const maxFee = bridgeUint(input.maxFeePerGasWei, true), maxPriority = bridgeUint(input.maxPriorityFeePerGasWei);
        const maxNative = bridgeUint(input.maxNativeDebitWei, true);
        if (amount > lane.origin.maxAmountAtomic || maxPriority > maxFee || input.idempotencyKey.length < 8 ||
            input.idempotencyKey.length > 128)
            fail("limits");
        const profileHash = this.state.profileHash(profile), operationId = oneClickOperationId(lane, profileHash, input.idempotencyKey);
        const journal = this.journal();
        if (await journal.load(operationId) !== null)
            fail("existing_operation_use_status");
        const source = new OneClickEvmSource(lane, this.rpcUrl(lane.origin.rpcEnvironment, lane.origin.network), https);
        const walletStore = new EncryptedWalletStore(this.state, this.wrapping);
        await this.state.initialize();
        const loaded = await walletStore.describe(profile);
        if (loaded === null)
            fail("wallet_missing");
        try {
            if (loaded.identity.profile !== profile || loaded.identity.address !== payer ||
                privateKeyToAccount(loaded.secret.privateKey).address !== payer)
                fail("wallet_binding");
            const quoteRequest = { dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: lane.origin.oneClickAsset,
                depositType: "ORIGIN_CHAIN", destinationAsset: lane.destination.oneClickAsset, amount: amount.toString(), refundTo: payer,
                refundType: "ORIGIN_CHAIN", recipient, recipientType: "DESTINATION_CHAIN",
                deadline: new Date(now() + QUOTE_WINDOW_MS).toISOString() };
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
            const q = inspectOneClickSourceQuote(await getQuote(actualRequest), actualRequest, minOutput, maxLoss, now(), lane);
            const call = oneClickSourceCall(lane, q.deposit, q.amountIn.toString()), deadlineMs = Date.parse(q.effectiveDeadline);
            const caps = { maxGas, maxFee, maxPriority, maxNative };
            const read = async () => {
                if (lane.origin.kind === "erc20")
                    return await source.readToken(payer, call.data, amount, caps, deadlineMs, now);
                const plan = planOneClickNative(await source.observeNative(payer, q.deposit, amount), amount, caps);
                if (now() > deadlineMs - 45_000)
                    fail("block_or_quote_expired");
                return plan;
            };
            const initial = await read();
            let record = await journal.stage({ lane: lane.id, operationId, profileHash, payer, recipient, refundTo: payer,
                depositAddress: q.deposit, ...(initial.depositCode === null ? {} : { depositCode: initial.depositCode }),
                quoteHash: q.quoteHash, quoteRequestDeadline: actualRequest.deadline,
                quoteDeadline: q.quoteDeadline, effectiveDeadline: q.effectiveDeadline,
                amountInAtomic: q.amountIn.toString(), minAmountOutAtomic: q.minimum.toString(),
                quotedAmountOutAtomic: q.amountOut.toString(), sourceBlockHash: initial.blockHash,
                sourceCall: { ...call, nonce: initial.nonce.toString(), gas: initial.gas.toString(),
                    maxFeePerGas: initial.fee.toString(), maxPriorityFeePerGas: initial.tip.toString(), maxNativeDebitWei: maxNative.toString() } });
            await new TtyOneClickSourceApproval().approve(record, initial);
            if (lane.origin.kind === "erc20")
                assertOneClickPostApproval(initial, await read(), maxNative, deadlineMs, now());
            else
                assertOneClickNativePostApproval(initial, await source.observeNative(payer, q.deposit, amount), amount, deadlineMs, now());
            if (now() > deadlineMs - 15_000)
                fail("quote_expired_before_sign");
            record = await journal.advance(operationId, record.integrityHash, "signing_started");
            const fees = { nonce: Number(initial.nonce), gas: initial.gas, maxFeePerGas: initial.fee, maxPriorityFeePerGas: initial.tip, accessList: [] };
            const account = privateKeyToAccount(loaded.secret.privateKey);
            const raw = lane.origin.kind === "erc20"
                ? await account.signTransaction({ type: "eip1559", chainId: lane.origin.chainId, to: call.to, data: call.data, value: 0n, ...fees })
                : await account.signTransaction({ type: "eip1559", chainId: lane.origin.chainId, to: call.to, value: amount, ...fees });
            record = await journal.advance(operationId, record.integrityHash, "sealed", { rawTransaction: raw, transactionHash: keccak256(raw) });
            if (now() > Date.parse(record.effectiveDeadline) - 15_000)
                fail("quote_expired_before_send");
            record = await journal.advance(operationId, record.integrityHash, "submitting", { submissionAttempts: 1 });
            try {
                const returned = await source.send(raw);
                if (returned !== record.transactionHash)
                    fail("send_hash");
                record = await journal.advance(operationId, record.integrityHash, "submitted_pending");
            }
            catch {
                record = await journal.advance(operationId, record.integrityHash, "unknown_finality");
            }
            const common = { operationId, lane: lane.id, sourceTransactionHash: record.transactionHash, sourceState: record.phase,
                submissionAttempts: 1, oneClickDepositAddress: record.depositAddress, sourceReceiptObserved: false };
            return lane.id === LEGACY_ONECLICK_LANE ? { ...common, tronDestinationDelivered: false } : { ...common, destinationDelivered: false };
        }
        finally {
            walletStore.clear(loaded.secret);
        }
    }
    async status(operationId) {
        const record = await this.journal().load(operationId);
        if (record === null)
            fail("missing_operation");
        const lane = oneClickRecordLane(record), https = new BridgeHttps();
        const source = new OneClickEvmSource(lane, this.rpcUrl(lane.origin.rpcEnvironment, lane.origin.network), https);
        const sourceReceipt = record.transactionHash === null ? null : await source.observe(record);
        // Destination status is obtained from a separate provider read and is never inferred from the source receipt.
        const endpoint = new URL(`${ORIGIN}/v0/status`);
        endpoint.searchParams.set("depositAddress", record.depositAddress);
        const response = await https.request(endpoint.toString(), "GET", null, 1024 * 1024, "APN_HTTP_CONFIG");
        let providerStatus = null, body = null;
        if (response.status === 200) {
            try {
                body = bridgeRecord(JSON.parse(response.body));
                if (!oneClickStatusQuoteMatchesRecord(body.quoteResponse, record) || typeof body.status !== "string")
                    fail("status_quote_binding");
                providerStatus = body.status;
            }
            catch {
                fail("status_json_or_binding");
            }
        }
        const provider = { operationId, lane: lane.id, sourceTransactionHash: record.transactionHash, sourceState: record.phase,
            sourceReceipt, oneClickProviderStatus: providerStatus, providerStatusProvenance: "oneclick_https_untrusted" };
        if (lane.id === LEGACY_ONECLICK_LANE)
            return { ...provider, tronDestinationClaimed: providerStatus === "SUCCESS", tronDestinationFinalized: false };
        const hashes = body === null ? [] : oneClickDestinationHashes(lane, body);
        const destinationProof = await proveOneClickDestination({ lane, recipient: record.recipient, minimumOutputAtomic: record.minAmountOutAtomic,
            notBeforeMs: Date.parse(record.quoteRequestDeadline) - QUOTE_WINDOW_MS, hashes,
            tron: () => new TronRpc(this.rpcUrl(lane.destination.rpcEnvironment, lane.destination.network)),
            solana: () => new SolanaRpc(this.rpcUrl(lane.destination.rpcEnvironment, lane.destination.network)) });
        return { ...provider, destinationClaimed: providerStatus === "SUCCESS", providerDestinationTransactions: hashes,
            destinationProof, destinationFinalized: destinationProof.status === "finalized" };
    }
}
/** Foreground-only consent with a six-character code bound to the exact staged record. */
export class TtyOneClickSourceApproval {
    async approve(record, plan) {
        const lane = oneClickRecordLane(record), o = lane.origin, d = lane.destination;
        await exactChainConsent([
            `Agent Payment Node 1Click lane ${lane.id}`,
            `${o.network} ${o.asset} (${o.decimals} decimals) to ${d.network} ${d.asset} (${d.decimals} decimals)`,
            `Operation: ${record.operationId}`,
            `Payer and refund address: ${record.payer}`,
            `Recipient: ${record.recipient}`,
            `Deposit address: ${record.depositAddress}${record.depositCode === undefined ? "" : ` (${record.depositCode})`}`,
            `Amount: ${record.amountInAtomic} atomic ${o.asset}`,
            `Quoted output: ${record.quotedAmountOutAtomic} atomic ${d.asset}; minimum output: ${record.minAmountOutAtomic} atomic ${d.asset}`,
            `Nonce: ${record.sourceCall.nonce}; gas limit: ${record.sourceCall.gas}`,
            `Max fee per gas: ${record.sourceCall.maxFeePerGas} wei; max priority fee per gas: ${record.sourceCall.maxPriorityFeePerGas} wei`,
            `Planned ${o.network} debit (${o.kind === "native" ? "value plus gas times max fee" : "gas times max fee plus L1 and operator bounds"}): ${plan.nativeDebit} wei`,
            `Owner maximum ${o.network} debit: ${record.sourceCall.maxNativeDebitWei} wei`,
            `Quote hash: ${record.quoteHash}`,
            `Effective deposit deadline: ${record.effectiveDeadline}`,
            "Exactly one signed source transaction may be sent. An unknown result is never resent.",
            "Source success does not prove destination delivery; status verifies the destination chain separately.",
        ], approvalCode("bridge", record.operationId, record.integrityHash), new Date(Date.parse(record.effectiveDeadline) - 30_000).toISOString(), {});
    }
}
//# sourceMappingURL=near-oneclick-source-service.js.map