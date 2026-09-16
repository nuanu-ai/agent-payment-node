import { createHash } from "node:crypto";
import { encodeFunctionData, getAddress, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getBase58Encoder } from "@solana/kit";
import { canonicalJson, hashObject } from "../canonical.js";
import { EncryptedWalletStore } from "../encrypted-wallet-store.js";
import { MAX_DIRECT_TRANSACTION_BYTES } from "../evm-asset.js";
import { associatedUsdc } from "../solana/accounts.js";
import { canonicalProfile } from "../wallet-policy.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { BridgeHttps } from "./https.js";
import { NonEvmSourceJournalRepository } from "./non-evm-source-journal.js";
import { inspectCircleV2PreflightedDraft } from "./circle-v2-draft.js";
import { prepareCircleV2BaseSourceReadOnly } from "./circle-v2-source-preparation.js";
import { bindCircleV2SourcePreparationToJournal } from "./circle-v2-source-journal.js";
import { bridgeAddress, bridgeFailure, bridgeHex, bridgeRecord, bridgeUint, BRIDGE_MIN_REMAINING_MS } from "./validation.js";
const CIRCLE = "https://iris-api.circle.com";
const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WRAPPER = getAddress("0x71f54F818671cD0D7ea140Da213e5C8b5C92a408");
const ZERO = `0x${"0".repeat(64)}`;
const HOOK = "0x636374702d666f72776172640000000000000000000000000000000000000000";
const ABI = parseAbi(["function depositForBurnWithHookAndFees(uint256,uint32,bytes32,address,bytes32,bytes,(bytes signedQuote,address refundAddress)) payable"]);
const BALANCE = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const ALLOWANCE = parseAbi(["function allowance(address,address) view returns (uint256)"]);
const ORACLE = getAddress("0x420000000000000000000000000000000000000F");
const ORACLE_ABI = parseAbi(["function getL1FeeUpperBound(uint256 size) view returns (uint256)",
    "function getOperatorFee(uint256 gas) view returns (uint256)"]);
function fail(reason) { return bridgeFailure("APN_OPERATION_BLOCKED", `circle_v2_source_service_${reason}`); }
function q(n) { return `0x${n.toString(16)}`; }
function rq(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value))
        fail("rpc_quantity");
    return BigInt(value);
}
function rw(value) { return BigInt(bridgeHex(value, 32, 32)); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
/** Production adapters use one pinned HTTPS Circle origin and one explicitly configured Base RPC origin. */
export class CircleV2SourceService {
    state;
    wrapping;
    environment;
    approval;
    constructor(state, wrapping, environment, approval) {
        this.state = state;
        this.wrapping = wrapping;
        this.environment = environment;
        this.approval = approval;
    }
    async submit(request) {
        const profile = canonicalProfile(request.profile), payer = bridgeAddress(request.expectedPayer);
        const amount = bridgeUint(request.amountAtomic, true);
        const feeCap = bridgeUint(request.maxSourceFeeAtomic);
        if (feeCap >= amount || amount > 10000000000000n || request.idempotencyKey.length < 8 ||
            request.idempotencyKey.length > 128)
            fail("intent");
        const profileHash = this.state.profileHash(profile);
        const operationId = hash(`circle-v2-base-source\0${profileHash}\0${request.idempotencyKey}`);
        const rpcUrl = this.environment.APN_BASE_RPC_URL;
        if (rpcUrl === undefined)
            return fail("base_rpc_missing");
        const transport = new BridgeHttps();
        const rpc = new CircleBaseJsonRpc(rpcUrl, transport);
        const walletStore = new EncryptedWalletStore(this.state, this.wrapping);
        await this.state.initialize();
        // No wallet.ensure or import is called here; an operator must import the exact payer profile separately.
        const loaded = await walletStore.describe(profile);
        if (loaded === null)
            fail("wallet_missing");
        try {
            if (loaded.identity.address !== payer || loaded.identity.profile !== profile ||
                privateKeyToAccount(loaded.secret.privateKey).address !== payer)
                fail("wallet_owner");
            const ata = await associatedUsdc(request.recipientOwner);
            const bytes = getBase58Encoder().encode(ata);
            if (bytes.length !== 32)
                fail("recipient_ata");
            const mintRecipient = `0x${Buffer.from(bytes).toString("hex")}`;
            const ownerBytes = getBase58Encoder().encode(request.recipientOwner);
            if (ownerBytes.length !== 32)
                fail("recipient_owner");
            const hook = request.recipientSetup === "existing_ata" ? HOOK :
                `${HOOK.slice(0, 50)}000000000000002101${Buffer.from(ownerBytes).toString("hex")}`;
            const quoteRequest = { amount: amount.toString(), feeToken: USDC,
                requests: [{ type: "FORWARD", params: { hookData: hook } }] };
            let validationHash;
            const circlePost = async (path, body) => {
                const response = await transport.request(`${CIRCLE}${path}`, "POST", canonicalJson(body), 1024 * 1024, "APN_HTTP_CONFIG");
                if (response.status !== 200)
                    fail("circle_http_status");
                try {
                    const parsed = JSON.parse(response.body);
                    if (path === "/v2/quote/validate/usdc/6")
                        validationHash = hashObject({ request: body, response: parsed });
                    return parsed;
                }
                catch {
                    return fail("circle_json");
                }
            };
            const result = await submitCircleV2BaseSourceBurnLive({ payer, solanaWalletOwner: request.recipientOwner,
                solanaRecipientAta: ata, recipientSetup: request.recipientSetup, profileHash, operationId,
                limits: { maxAllowanceAtomic: request.maxAllowanceAtomic, maxGasLimitAtomic: request.maxGasLimitAtomic,
                    maxFeePerGasWei: request.maxFeePerGasWei, maxPriorityFeePerGasWei: request.maxPriorityFeePerGasWei,
                    maxNativeDebitWei: request.maxNativeDebitWei, ttlMs: 60_000 },
                claimedValidationHash: hash(canonicalJson({ quoteRequest, operationId })), minFinalityThreshold: 1000 }, {
                freshDraft: async () => {
                    const response = bridgeRecord(await circlePost("/v2/quote/burn/usdc/6/5", quoteRequest));
                    const signedQuote = bridgeHex(response.signedQuote, 16 * 1024);
                    const data = encodeFunctionData({ abi: ABI, functionName: "depositForBurnWithHookAndFees",
                        args: [amount, 5, mintRecipient, USDC, ZERO, hook,
                            { signedQuote, refundAddress: payer }] });
                    return { payer, quoteEndpoint: `${CIRCLE}/v2/quote/burn/usdc/6/5`, quoteRequest, quoteResponse: response,
                        transaction: { from: payer, to: WRAPPER, chainId: 8453, valueAtomic: "0", refundAddress: payer, data },
                        recipientWallet: request.recipientOwner, recipientSetup: request.recipientSetup,
                        amountAtomic: amount.toString(), maxSourceFeeAtomic: feeCap.toString() };
                },
                preflight: async (query) => query.target === "circle"
                    ? circlePost("/v2/quote/validate/usdc/6", query.body) : rpc.call(query.method, query.params),
                readBase: async (query) => rpc.readSource(query),
                signer: { kind: "imported_evm_signer", address: payer,
                    signTransaction: tx => privateKeyToAccount(loaded.secret.privateKey).signTransaction(tx) },
                sendRawTransaction: raw => rpc.send(raw),
                approve: p => this.approval.approve(p),
                journal: new NonEvmSourceJournalRepository(this.state.root),
                admitLive: async (p) => {
                    if (validationHash === undefined)
                        fail("validation_missing");
                    return { kind: "circle_v2_live_transport_v1", circleOrigin: CIRCLE, rpcOrigin: rpc.origin,
                        quoteHash: p.quoteHash.slice(7), validationHash, sourceBlockHash: p.sourceBlock.hash,
                        preparationDigest: p.preparationDigest.slice(7), payer, recipientOwner: p.recipient.wallet,
                        recipientAta: p.recipient.ata, feeTotalAtomic: p.quote.feeTotalAtomic };
                },
            });
            return { operationId, sourceTransactionHash: result.sourceTransactionHash, sourceState: result.sourceState,
                submissionAttempts: 1, bridgeCompletion: false, circleAttestationObserved: false,
                solanaDestinationFinalized: false };
        }
        finally {
            walletStore.clear(loaded.secret);
        }
    }
}
/** Minimal EIP-1898 Base reader. Every token and native balance read uses the same canonical block hash. */
export class CircleBaseJsonRpc {
    https;
    origin;
    endpoint;
    sequence = 0;
    constructor(url, https = new BridgeHttps()) {
        this.https = https;
        const parsed = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", "Base RPC endpoint", 2048);
        if (parsed.search !== "" || parsed.hash !== "")
            fail("rpc_url");
        this.endpoint = parsed.toString();
        this.origin = parsed.origin;
    }
    async call(method, params) {
        if (!["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getTransactionCount", "eth_call",
            "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_sendRawTransaction"].includes(method))
            fail("rpc_method");
        const id = String(++this.sequence);
        const response = await this.https.request(this.endpoint, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }), 1024 * 1024, "APN_RPC_CONFIG");
        if (response.status !== 200)
            fail("rpc_status");
        let result;
        try {
            result = bridgeRecord(JSON.parse(response.body));
        }
        catch {
            return fail("rpc_json");
        }
        if (result.jsonrpc !== "2.0" || String(result.id) !== id || !Object.hasOwn(result, "result") ||
            Object.hasOwn(result, "error"))
            fail("rpc_result");
        return result.result;
    }
    async readSource(query) {
        if (rq(await this.call("eth_chainId", [])) !== 8453n)
            fail("chain_id");
        const tag = { blockHash: query.freshBlockHash, requireCanonical: true };
        const token = bridgeAddress(query.token), payer = bridgeAddress(query.payer), spender = bridgeAddress(query.spender);
        const draftBlock = bridgeRecord(await this.call("eth_getBlockByNumber", [q(BigInt(query.draftBlockNumber)), false]));
        const block = bridgeRecord(await this.call("eth_getBlockByNumber", [q(BigInt(query.freshBlockNumber)), false]));
        if (bridgeHex(block.hash, 32, 32) !== query.freshBlockHash)
            fail("block_hash");
        const call = (to, data) => this.call("eth_call", [{ to, data }, tag]);
        const balanceData = encodeFunctionData({ abi: BALANCE, functionName: "balanceOf", args: [payer] });
        const allowanceData = encodeFunctionData({ abi: ALLOWANCE, functionName: "allowance", args: [payer, spender] });
        const [balance, allowance, native, latest, pending, estimated, priority] = await Promise.all([
            call(token, balanceData), call(token, allowanceData), this.call("eth_getBalance", [payer, tag]),
            this.call("eth_getTransactionCount", [payer, "latest"]), this.call("eth_getTransactionCount", [payer, "pending"]),
            this.call("eth_estimateGas", [{ from: payer, to: query.to, data: query.data, value: "0x0" }, tag]),
            this.call("eth_maxPriorityFeePerGas", []),
        ]);
        const gas = rq(estimated) * 12n / 10n + 1n;
        const tip = rq(priority), baseFee = rq(block.baseFeePerGas), maxFee = 2n * baseFee + tip;
        const [l1, operator] = await Promise.all([
            call(ORACLE, encodeFunctionData({ abi: ORACLE_ABI, functionName: "getL1FeeUpperBound",
                args: [BigInt(MAX_DIRECT_TRANSACTION_BYTES)] })),
            call(ORACLE, encodeFunctionData({ abi: ORACLE_ABI, functionName: "getOperatorFee", args: [gas] })),
        ]);
        const after = bridgeRecord(await this.call("eth_getBlockByNumber", [q(BigInt(query.freshBlockNumber)), false]));
        if (bridgeHex(after.hash, 32, 32) !== query.freshBlockHash || rq(await this.call("eth_chainId", [])) !== 8453n)
            fail("block_drift");
        return { chainId: 8453, payer, draftBlockHash: bridgeHex(draftBlock.hash, 32, 32),
            blockNumber: query.freshBlockNumber, blockHash: query.freshBlockHash,
            latestNonceAtomic: rq(latest).toString(), pendingNonceAtomic: rq(pending).toString(),
            usdcBalanceAtomic: rw(balance).toString(), usdcAllowanceAtomic: rw(allowance).toString(),
            nativeBalanceWei: rq(native).toString(), gasLimitAtomic: gas.toString(),
            maxFeePerGasWei: maxFee.toString(), maxPriorityFeePerGasWei: tip.toString(),
            l1DataFeeUpperWei: rw(l1).toString(), operatorFeeUpperWei: rw(operator).toString() };
    }
    async send(raw) {
        const returned = bridgeHex(await this.call("eth_sendRawTransaction", [raw]), 32, 32);
        if (returned !== keccak256(raw))
            fail("send_hash");
        return returned;
    }
}
const ROUTE = "base_usdc_to_solana_usdc_circle_cctp_v2";
function blocked(reason) { return bridgeFailure("APN_OPERATION_BLOCKED", `circle_v2_source_execution_${reason}`); }
function assertSolanaOwner(wallet) {
    try {
        if (getBase58Encoder().encode(wallet).length !== 32)
            blocked("solana_wallet_owner");
    }
    catch {
        blocked("solana_wallet_owner");
    }
}
/** Requires an exact imported signer and fresh quote, validation, pinned simulation, allowance, nonce and gas reads. */
async function submitCircleV2BaseSourceBurnLive(intent, ports) {
    const now = ports.now ?? Date.now;
    const payer = bridgeAddress(intent.payer);
    if (bridgeAddress(ports.signer.address) !== payer || ports.signer.kind !== "imported_evm_signer")
        blocked("signer_owner");
    assertSolanaOwner(intent.solanaWalletOwner);
    const input = await ports.freshDraft();
    const quote = bridgeRecord(input.quoteResponse);
    const issuedAt = quote.issuedAt;
    const current = now();
    if (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) ||
        issuedAt * 1000 > current + 30_000 || current - issuedAt * 1000 > 60_000)
        blocked("quote_freshness");
    if (bridgeAddress(input.payer) !== payer || input.recipientWallet !== intent.solanaWalletOwner ||
        input.recipientSetup !== intent.recipientSetup)
        blocked("recipient_or_payer");
    const draft = await inspectCircleV2PreflightedDraft(input, ports.preflight);
    if (draft.recipientAta !== intent.solanaRecipientAta)
        blocked("recipient_ata");
    const p = await prepareCircleV2BaseSourceReadOnly(draft, ports.preflight, ports.readBase, intent.limits, now);
    if (Date.parse(p.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS)
        blocked("expiry_margin");
    const expiry = bridgeRecord(p.quote.expiry);
    if (expiry.mode === "BLOCK_NUMBER" && (typeof expiry.expiresAtBlock !== "number" ||
        BigInt(expiry.expiresAtBlock) - BigInt(p.sourceBlock.number) < 5n))
        blocked("block_expiry_margin");
    await ports.approve(p);
    if (Date.parse(p.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS)
        blocked("approval_expired");
    // Consent can outlast a Base block. Refresh Circle validation, canonical simulation and balances before sealing.
    const afterConsent = await prepareCircleV2BaseSourceReadOnly(draft, ports.preflight, ports.readBase, intent.limits, now);
    if (afterConsent.quoteHash !== p.quoteHash || afterConsent.draftIntegrityDigest !== p.draftIntegrityDigest ||
        afterConsent.recipient.wallet !== p.recipient.wallet || afterConsent.recipient.ata !== p.recipient.ata ||
        afterConsent.transaction.from !== p.transaction.from || afterConsent.transaction.to !== p.transaction.to ||
        afterConsent.transaction.data !== p.transaction.data || afterConsent.transaction.nonceAtomic !== p.transaction.nonceAtomic ||
        BigInt(afterConsent.transaction.gasLimitAtomic) > BigInt(p.transaction.gasLimitAtomic) ||
        BigInt(afterConsent.transaction.maxFeePerGasWei) > BigInt(p.transaction.maxFeePerGasWei) ||
        BigInt(afterConsent.transaction.maxPriorityFeePerGasWei) > BigInt(p.transaction.maxPriorityFeePerGasWei) ||
        Date.parse(afterConsent.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS)
        blocked("post_approval_drift");
    const refreshedExpiry = bridgeRecord(afterConsent.quote.expiry);
    if (refreshedExpiry.mode === "BLOCK_NUMBER" && (typeof refreshedExpiry.expiresAtBlock !== "number" ||
        BigInt(refreshedExpiry.expiresAtBlock) - BigInt(afterConsent.sourceBlock.number) < 5n))
        blocked("post_approval_expiry");
    const binding = bindCircleV2SourcePreparationToJournal({ preparation: p, route: ROUTE, payer,
        draftIntegrityDigest: draft.integrityDigest, preparationDigest: p.preparationDigest,
        profileHash: intent.profileHash, operationId: intent.operationId, createdAt: new Date(now()).toISOString(),
        admission: { claimedValidationHash: intent.claimedValidationHash, note: "live_source_execution", minFinalityThreshold: intent.minFinalityThreshold } });
    if (ports.admitLive === undefined)
        blocked("live_admission_missing");
    const admission = await ports.admitLive(afterConsent);
    if (admission.kind !== "circle_v2_live_transport_v1" || admission.circleOrigin !== "https://iris-api.circle.com" ||
        admission.payer !== payer || admission.recipientOwner !== p.recipient.wallet ||
        admission.recipientAta !== p.recipient.ata || admission.quoteHash !== p.quoteHash.slice(7) ||
        admission.sourceBlockHash !== afterConsent.sourceBlock.hash ||
        admission.preparationDigest !== afterConsent.preparationDigest.slice(7) ||
        admission.feeTotalAtomic !== p.quote.feeTotalAtomic ||
        !/^https:\/\//u.test(admission.rpcOrigin) || !/^[a-f0-9]{64}$/u.test(admission.validationHash))
        blocked("live_admission_binding");
    let j = await ports.journal.stageLiveCircle({ ...binding.binding,
        admissionProof: admission, protocolInputHash: hashObject({ binding: binding.protocolInputHash, admission }) });
    if (j.phase !== "staged_untrusted")
        blocked("already_started");
    if (j.schemaVersion !== "apn.non-evm-source-journal.v3" || j.executionAdmitted !== true)
        blocked("synthetic_admission");
    j = await ports.journal.signingStarted(j.profileHash, j.operationId, j.integrityHash, new Date(now()).toISOString());
    const tx = p.transaction, nonce = BigInt(tx.nonceAtomic);
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || Date.parse(p.expiresAt) - now() < BRIDGE_MIN_REMAINING_MS)
        blocked("signing_expired");
    const raw = await ports.signer.signTransaction({ type: "eip1559", chainId: 8453, to: getAddress(tx.to),
        data: tx.data, value: 0n, nonce: Number(nonce), gas: BigInt(tx.gasLimitAtomic),
        maxFeePerGas: BigInt(tx.maxFeePerGasWei), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGasWei), accessList: [] });
    j = await ports.journal.seal(j.profileHash, j.operationId, j.integrityHash, raw, tx.nonceAtomic, new Date(now()).toISOString());
    // Once the journal records an attempt, no failure path retries or re-signs this nonce.
    j = await ports.journal.committingSubmission(j.profileHash, j.operationId, j.integrityHash, new Date(now()).toISOString());
    const hash = j.transactionHash;
    let phase = "unknown_finality";
    try {
        const returned = await ports.sendRawTransaction(raw);
        if (returned.toLowerCase() !== hash.toLowerCase() || keccak256(raw) !== hash)
            blocked("send_hash");
        j = await ports.journal.observePending(j.profileHash, j.operationId, j.integrityHash, new Date(now()).toISOString());
        phase = "submitted_pending";
    }
    catch {
        j = await ports.journal.observeUnknown(j.profileHash, j.operationId, j.integrityHash, "send_result_ambiguous", new Date(now()).toISOString());
    }
    return { journal: j, sourceTransactionHash: hash, sourceState: phase,
        circleAttestationObserved: false, solanaDestinationFinalized: false, bridgeCompletion: false };
}
//# sourceMappingURL=circle-v2-source-service.js.map