/** Offline Arbitrum source draft and read-only funding snapshot. No operation repository or dispatch uses this module. */
import { hashObject } from "../canonical.js";
import { bridgeMechanismAdmitted, evaluateAssetPolicy } from "../asset-policy-registry.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord } from "../evm-rpc-codec.js";
import { ApnError } from "../errors.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC } from "./quote.js";
import { RELAY_ARBITRUM_USDC, RELAY_ETHEREUM_USDC_RECIPIENT, validateRelayArbitrumUsdcEthereumUsdcQuote } from "./arbitrum-usdc-ethereum-quote.js";
export const RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE = "arbitrum-usdc-ethereum-usdc-source-draft-v1";
const UINT = /^(0|[1-9][0-9]*)$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
function blocked(reason) {
    throw new ApnError("APN_OPERATION_BLOCKED", "Relay Arbitrum source draft is blocked.", { reason });
}
function amount(value, reason) {
    if (!UINT.test(value))
        blocked(reason);
    return BigInt(value);
}
function frozen(value) {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value))
            frozen(child);
        Object.freeze(value);
    }
    return value;
}
function policy(active, owner, principal, usage, now) {
    if (active.profile !== "default" || active.digest !== active.registry.policyDigest ||
        !Number.isSafeInteger(active.revision) || active.revision <= 0 ||
        active.accounts.evm === undefined || !same(active.accounts.evm, owner) ||
        (active.registry.expiresAt !== undefined && now.toISOString() >= active.registry.expiresAt))
        blocked("active_policy_owner_or_expiry");
    const mechanism = { provider: "relay", reference: RELAY_ARBITRUM_SOURCE_DRAFT_REFERENCE };
    const admission = evaluateAssetPolicy(active.registry, { chain: "eip155:42161",
        asset: { kind: "token", identifier: RELAY_ARBITRUM_USDC }, rail: "bridge",
        amountAtomic: principal, dailyUsageAtomic: usage, asOfDate: now.toISOString().slice(0, 10),
        asOf: now.toISOString(), mechanism });
    if (!bridgeMechanismAdmitted(admission, mechanism))
        blocked("source_draft_pin_required");
}
export async function createRelayArbitrumSourceDraft(input) {
    const { now, activePolicy, publicAccount, dailyUsageAtomic, rawQuote, ...request } = input;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || input.profile !== "default" ||
        !ADDRESS.test(input.owner) || !ADDRESS.test(publicAccount) || !same(input.owner, publicAccount))
        blocked("source_owner");
    for (const [name, value] of [["amount", input.amountAtomic], ["minimum", input.minimumOutputAtomic],
        ["provider fee cap", input.maxProviderFeeAtomic], ["approval fee cap", input.maxApprovalNetworkFeeWei],
        ["deposit fee cap", input.maxDepositNetworkFeeWei], ["daily usage", dailyUsageAtomic]])
        amount(value, name);
    if (amount(input.amountAtomic, "amount") === 0n || amount(input.minimumOutputAtomic, "minimum") === 0n)
        blocked("zero_amount");
    const owner = input.owner.toLowerCase();
    policy(activePolicy, owner, input.amountAtomic, dailyUsageAtomic, now);
    const quote = await validateRelayArbitrumUsdcEthereumUsdcQuote(rawQuote, { payer: owner,
        amountAtomic: input.amountAtomic, minimumOutputAtomic: input.minimumOutputAtomic,
        nowSeconds: Math.floor(now.getTime() / 1000) });
    if (BigInt(quote.providerFeeAtomic) > BigInt(input.maxProviderFeeAtomic) ||
        BigInt(quote.approval.maximumNetworkFeeWei) > BigInt(input.maxApprovalNetworkFeeWei) ||
        BigInt(quote.deposit.maximumNetworkFeeWei) > BigInt(input.maxDepositNetworkFeeWei))
        blocked("fee_ceiling");
    if (activePolicy.registry.expiresAt !== undefined && quote.deadline * 1000 > Date.parse(activePolicy.registry.expiresAt))
        blocked("quote_outlives_policy");
    const body = { schemaVersion: "apn.relay-arbitrum-source-draft.v1",
        sourceChainId: 42161, destinationChainId: 1,
        sourceToken: RELAY_ARBITRUM_USDC, destinationToken: quote.orderData.output.payments[0].currency,
        recipient: RELAY_ETHEREUM_USDC_RECIPIENT, profile: request.profile, owner,
        amountAtomic: input.amountAtomic, minimumOutputAtomic: quote.minimumOutputAtomic,
        maxProviderFeeAtomic: input.maxProviderFeeAtomic,
        maxApprovalNetworkFeeWei: input.maxApprovalNetworkFeeWei,
        maxDepositNetworkFeeWei: input.maxDepositNetworkFeeWei,
        policyDigest: activePolicy.digest, policyRevision: activePolicy.revision,
        quoteDigest: quote.quoteDigest, requestId: quote.statusLocator.requestId, orderId: quote.orderId,
        deadline: new Date(quote.deadline * 1000).toISOString(), createdAt: now.toISOString(),
        rawQuote: structuredClone(rawQuote), executionAdmitted: false, nextActions: [] };
    return frozen({ ...body, integrityHash: hashObject(body) });
}
/** Two injected read-only batches, with EIP-1898 binding all account state to one canonical block hash. */
export async function preflightRelayArbitrumSourceDraft(draft, active, publicAccount, dailyUsageAtomic, now, ports) {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) ||
        !ADDRESS.test(publicAccount) || !same(publicAccount, draft.owner) ||
        draft.schemaVersion !== "apn.relay-arbitrum-source-draft.v1" || draft.sourceChainId !== 42161 ||
        draft.destinationChainId !== 1 || draft.profile !== "default" ||
        !same(draft.sourceToken, RELAY_ARBITRUM_USDC) || !same(draft.destinationToken, ETHEREUM_USDC) ||
        !same(draft.recipient, RELAY_ETHEREUM_USDC_RECIPIENT) || draft.executionAdmitted !== false ||
        draft.nextActions.length !== 0)
        blocked("draft_identity");
    for (const [name, value] of [["provider fee cap", draft.maxProviderFeeAtomic],
        ["approval fee cap", draft.maxApprovalNetworkFeeWei],
        ["deposit fee cap", draft.maxDepositNetworkFeeWei]])
        amount(value, name);
    const { integrityHash, ...body } = draft;
    if (hashObject(body) !== integrityHash || active.digest !== draft.policyDigest ||
        active.revision !== draft.policyRevision || now.getTime() + 60_000 >= Date.parse(draft.deadline))
        blocked("draft_integrity_or_expiry");
    policy(active, draft.owner, draft.amountAtomic, dailyUsageAtomic, now);
    const quote = await validateRelayArbitrumUsdcEthereumUsdcQuote(draft.rawQuote, { payer: draft.owner,
        amountAtomic: draft.amountAtomic, minimumOutputAtomic: draft.minimumOutputAtomic,
        nowSeconds: Math.floor(now.getTime() / 1000) });
    if (quote.quoteDigest !== draft.quoteDigest || quote.orderId !== draft.orderId ||
        quote.statusLocator.requestId !== draft.requestId ||
        new Date(quote.deadline * 1000).toISOString() !== draft.deadline ||
        BigInt(quote.providerFeeAtomic) > BigInt(draft.maxProviderFeeAtomic) ||
        BigInt(quote.approval.maximumNetworkFeeWei) > BigInt(draft.maxApprovalNetworkFeeWei) ||
        BigInt(quote.deposit.maximumNetworkFeeWei) > BigInt(draft.maxDepositNetworkFeeWei))
        blocked("draft_quote_or_fee");
    const first = await ports.batch([{ method: "eth_chainId", params: [] },
        { method: "eth_getBlockByNumber", params: ["latest", false] }]);
    if (!Array.isArray(first) || first.length !== 2)
        blocked("rpc_head_batch");
    if (evmRpcQuantity(first[0]) !== 42161n)
        blocked("source_chain");
    const head = evmRpcRecord(first[1]);
    const number = evmRpcQuantity(head.number), blockHash = evmRpcHex(head.hash, 32);
    if (!HASH.test(blockHash) || blockHash === `0x${"0".repeat(64)}`)
        blocked("source_block_hash");
    const reference = { blockHash, requireCanonical: true };
    const balanceOf = `0x70a08231${draft.owner.slice(2).padStart(64, "0")}`;
    const allowance = `0xdd62ed3e${draft.owner.slice(2).padStart(64, "0")}${ETHEREUM_DEPOSITORY.slice(2).padStart(64, "0")}`;
    const second = await ports.batch([
        { method: "eth_getBlockByNumber", params: [`0x${number.toString(16)}`, false] },
        { method: "eth_getBalance", params: [draft.owner, reference] },
        { method: "eth_call", params: [{ to: RELAY_ARBITRUM_USDC, data: balanceOf }, reference] },
        { method: "eth_call", params: [{ to: RELAY_ARBITRUM_USDC, data: allowance }, reference] },
    ]);
    if (!Array.isArray(second) || second.length !== 4)
        blocked("rpc_state_batch");
    const canonical = evmRpcRecord(second[0]);
    if (evmRpcQuantity(canonical.number) !== number || evmRpcHex(canonical.hash, 32) !== blockHash)
        blocked("source_block_changed");
    const nativeBalanceWei = evmRpcQuantity(second[1]);
    const tokenBalanceAtomic = evmRpcWord(second[2]);
    const allowanceAtomic = evmRpcWord(second[3]);
    const approvalRequired = allowanceAtomic < BigInt(draft.amountAtomic);
    const requiredNativeWei = BigInt(draft.maxDepositNetworkFeeWei) +
        (approvalRequired ? BigInt(draft.maxApprovalNetworkFeeWei) : 0n);
    const observedAt = ports.now();
    if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime()) ||
        observedAt.getTime() + 60_000 >= Date.parse(draft.deadline) ||
        (active.registry.expiresAt !== undefined && observedAt.toISOString() >= active.registry.expiresAt))
        blocked("expired_during_read");
    const fundingReasons = [
        ...(tokenBalanceAtomic < BigInt(draft.amountAtomic) ? ["insufficient_usdc_balance"] : []),
        ...(nativeBalanceWei < requiredNativeWei ? ["insufficient_native_fee_balance"] : []),
    ];
    return frozen({ kind: "relay_arbitrum_read_only_source_preflight",
        draftIntegrityHash: draft.integrityHash, sourceChainId: 42161, sourceToken: RELAY_ARBITRUM_USDC,
        sourceAccount: draft.owner, spender: ETHEREUM_DEPOSITORY, observationBlockNumber: number.toString(),
        observationBlockHash: blockHash, rpcBatches: 2, rpcMethods: 6,
        tokenBalanceAtomic: tokenBalanceAtomic.toString(), allowanceAtomic: allowanceAtomic.toString(),
        nativeBalanceWei: nativeBalanceWei.toString(), approvalRequired, requiredNativeWei: requiredNativeWei.toString(),
        fundingReasons, fundingObserved: fundingReasons.length === 0,
        proofClass: "read_only_rpc_observation", executionAdmitted: false, nextActions: [] });
}
//# sourceMappingURL=arbitrum-usdc-source-draft.js.map