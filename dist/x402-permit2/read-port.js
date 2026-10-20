import { encodeFunctionData, getAddress, keccak256, parseAbi } from "viem";
import { performance } from "node:perf_hooks";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { assertRecipientAdmitted } from "../allowlist-recipient-pins.js";
import { ApnError } from "../errors.js";
import { evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcWord } from "../evm-rpc-codec.js";
import { tokenDomainSeparator } from "../x402-policy.js";
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY, X402_EXACT_PERMIT2_PROXY_CODE_HASH, X402_PERMIT2_MECHANISM, canonicalPermit2Code } from "./registry.js";
/**
 * The read plan: [chainId, latest header], one batch pinned to that block's hash, and a third pinned batch (token domain
 * and permit nonce) only when the allowance is short and the seller sponsors an EIP-2612 permit. Nothing is retried.
 */
const READ_PLAN_POSTS = 3;
const RPC_TIMEOUT_MS = 5_000;
const READ_DEADLINE_MS = 15_000;
const activeRpcSources = new WeakSet();
const TOKEN = parseAbi([
    "function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner,address spender) view returns (uint256)",
    "function DOMAIN_SEPARATOR() view returns (bytes32)",
    "function nonces(address owner) view returns (uint256)",
]);
const PERMIT2 = parseAbi(["function nonceBitmap(address owner,uint256 wordPos) view returns (uint256)"]);
/**
 * Production read adapter for the existing unsigned prepare boundary. It never creates an operation or reservation.
 * Two POSTs: chain id with the latest header, then balance, allowance, the Permit2 nonce word and both runtime codes in
 * one batch pinned by EIP-1898 {blockHash, requireCanonical}; a third pinned POST (token domain, EIP-2612 nonce) only for
 * a sponsored permit. No facilitator read gates it: the seller picks the facilitator, and one that cannot settle leaves
 * the signature to expire unused.
 */
export function createPermit2ProductionReadPort(options) {
    const now = options.now ?? (() => new Date());
    let busy = false;
    const readChecked = async (request) => {
        if (busy || activeRpcSources.has(options.rpc))
            blocked("A Permit2 read is already in progress.", "x402_permit2_read_busy");
        busy = true;
        activeRpcSources.add(options.rpc);
        try {
            const deadline = performance.now() + READ_DEADLINE_MS;
            let posts = 0;
            const batch = async (calls) => {
                if (++posts > READ_PLAN_POSTS)
                    blocked("The Permit2 read budget was exhausted.", "x402_permit2_read_budget");
                const remaining = Math.min(RPC_TIMEOUT_MS, deadline - performance.now());
                if (remaining <= 0)
                    blocked("The Permit2 read deadline expired.", "x402_permit2_read_deadline");
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), remaining);
                try {
                    const values = await Promise.race([
                        options.rpc.batch(calls, controller.signal),
                        new Promise((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(new ApnError("APN_RPC_PROTOCOL", "The Permit2 RPC read timed out.")), { once: true })),
                    ]);
                    if (!Array.isArray(values) || values.length !== calls.length)
                        throw new ApnError("APN_RPC_PROTOCOL", "The Permit2 RPC batch answer is incomplete.");
                    return values;
                }
                finally {
                    clearTimeout(timeout);
                }
            };
            const asset = request.asset;
            if (!options.profile || !options.stateRoot || !equalAddress(request.payer, await options.localAccount()) ||
                !Number.isSafeInteger(asset?.chainId) || asset.chain !== `eip155:${asset.chainId}` || !/^0x[0-9a-fA-F]{40}$/u.test(String(asset.token)) ||
                !/^[a-f0-9]{64}$/u.test(request.challengeHash) || !/^[a-f0-9]{64}$/u.test(request.offerHash) ||
                !/^[1-9][0-9]{0,77}$/u.test(request.amountAtomic) ||
                !/^(0|[1-9][0-9]{0,77})$/u.test(request.nonceBitmapWordIndex) ||
                !Number.isSafeInteger(request.nowSeconds) || request.nowSeconds < 1) {
                blocked("The local wallet or selected merchant terms are invalid.", "x402_permit2_read_binding");
            }
            const start = instant(now());
            if (Math.abs(Math.floor(start.getTime() / 1000) - request.nowSeconds) > 1) {
                blocked("The caller's prepare clock is stale.", "x402_permit2_read_clock");
            }
            const active = await loadActiveAssetPolicyRegistry(options.stateRoot, options.profile, start);
            if (active === null || !equalAddress(active.accounts.evm, request.payer)) {
                blocked("The active owner policy does not bind this local wallet.", "x402_permit2_owner_admission_required");
            }
            const identity = { account: getAddress(request.payer), chain: asset.chain,
                asset: { kind: "token", identifier: asset.token } };
            const usage = (await options.usage.usage(identity, start)).amountAtomic;
            const admission = evaluateAssetPolicy(active.registry, { chain: asset.chain, asset: identity.asset,
                rail: "x402", amountAtomic: request.amountAtomic, dailyUsageAtomic: usage,
                asOfDate: start.toISOString().slice(0, 10), asOf: start.toISOString() });
            if (admission.asset.mechanismPins?.x402?.provider !== X402_PERMIT2_MECHANISM.provider ||
                !equalAddress(admission.asset.mechanismPins.x402.reference, X402_PERMIT2_MECHANISM.reference)) {
                blocked("The active owner policy lacks the exact Permit2 mechanism.", "x402_permit2_owner_admission_required");
            }
            // Token identity is the owner's row, never the seller's: the selected asset must carry exactly its symbol and decimals.
            if (admission.asset.symbol !== asset.symbol || admission.asset.decimals !== asset.decimals) {
                blocked("The owner's token row changed after selection.", "x402_permit2_owner_admission_required");
            }
            assertRecipientAdmitted({ admission, recipient: request.payTo });
            const owner = { active: true, account: getAddress(request.payer), chain: asset.chain,
                token: asset.token, rail: "x402", mechanism: X402_PERMIT2_MECHANISM,
                maximumPerTransferAtomic: admission.caps.maximumPerTransferAtomic,
                dailyLimitAtomic: admission.caps.dailyLimitAtomic, usedTodayAtomic: usage, policyDigest: active.digest };
            const [chainId, rawBlock] = await batch([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["latest", false] }]);
            if (evmRpcQuantity(chainId) !== BigInt(asset.chainId)) {
                throw new ApnError("APN_CHAIN_MISMATCH", `The --rpc-url endpoint is not the admitted Permit2 network ${asset.chain}.`, { reason: "x402_rpc_chain_mismatch", chain: asset.chain });
            }
            // Pre-sign facts predict settlement and cannot move money (the signature binds token, amount, payee, nonce and
            // deadline), so they are read at the newest block, pinned by hash; settlement and expiry stay finalized proofs.
            const block = evmRpcBlockResult(rawBlock, "latest");
            const blockTime = evmRpcQuantity(block.raw.timestamp);
            if (blockTime > BigInt(Math.floor(start.getTime() / 1000)) ||
                BigInt(Math.floor(start.getTime() / 1000)) - blockTime > 30n) {
                blocked(`The latest ${asset.chain} block is stale.`, "x402_permit2_chain_evidence_required");
            }
            // EIP-1898: every read below is pinned to this canonical block, so no header recheck follows them.
            const pinned = { blockHash: block.hash, requireCanonical: true };
            const call = (to, abi, functionName, args = []) => ({ method: "eth_call", params: [{ to, data: encodeFunctionData({ abi, functionName, args }) }, pinned] });
            const values = await batch([
                call(asset.token, TOKEN, "balanceOf", [request.payer]),
                call(asset.token, TOKEN, "allowance", [request.payer, PERMIT2_ADDRESS]),
                call(PERMIT2_ADDRESS, PERMIT2, "nonceBitmap", [request.payer, BigInt(request.nonceBitmapWordIndex)]),
                { method: "eth_getCode", params: [X402_EXACT_PERMIT2_PROXY, pinned] },
                { method: "eth_getCode", params: [PERMIT2_ADDRESS, pinned] },
            ]);
            const [balance, allowance, bitmap] = values.slice(0, 3).map(value => evmRpcHex(value, 32));
            // Both contracts are immutable at their CREATE2 addresses: the proxy has one runtime on every chain, and Permit2's
            // runtime is one template whose two immutables must be exactly this chain id and its recomputed domain separator.
            const proxyCodeHash = keccak256(evmRpcHex(values[3]));
            if (!canonicalPermit2Code(evmRpcHex(values[4]), asset.chainId) || proxyCodeHash.toLowerCase() !== X402_EXACT_PERMIT2_PROXY_CODE_HASH) {
                blocked(`Canonical Permit2 or the x402 exact proxy is not deployed with its expected code on ${asset.chain}.`, "x402_permit2_chain_evidence_required");
            }
            // A short allowance can only be paid through a seller-sponsored EIP-2612 permit: read the token's domain and nonce.
            let domain = null, nonce = null;
            if (evmRpcWord(allowance) < BigInt(request.amountAtomic) && request.sellerSponsorsEip2612 && asset.tokenDomain !== null) {
                [domain, nonce] = (await batch([call(asset.token, TOKEN, "DOMAIN_SEPARATOR"), call(asset.token, TOKEN, "nonces", [request.payer])]))
                    .map(value => evmRpcHex(value, 32));
                if (tokenDomainSeparator(asset.tokenDomain.name, asset.tokenDomain.version, asset) !== domain.toLowerCase()) {
                    blocked("The token's EIP-712 name and version do not recompute its on-chain DOMAIN_SEPARATOR.", "x402_permit2_token_domain_mismatch");
                }
            }
            const end = instant(now());
            const current = await loadActiveAssetPolicyRegistry(options.stateRoot, options.profile, end);
            const currentUsage = (await options.usage.usage(identity, end)).amountAtomic;
            if (current === null || current.digest !== active.digest || current.revision !== active.revision ||
                current.activationDigest !== active.activationDigest || currentUsage !== usage ||
                !equalAddress(current.accounts.evm, request.payer) || !equalAddress(await options.localAccount(), request.payer) ||
                end.getTime() < start.getTime() ||
                end.getTime() - start.getTime() > READ_DEADLINE_MS || performance.now() > deadline) {
                blocked("Owner policy, usage or observation window changed during prepare.", "x402_permit2_owner_admission_required");
            }
            const finalTime = instant(now());
            if (BigInt(Math.floor(finalTime.getTime() / 1000)) - blockTime > 30n ||
                BigInt(Math.floor(finalTime.getTime() / 1000)) < blockTime) {
                blocked(`The latest ${asset.chain} block is stale at prepare return.`, "x402_permit2_chain_evidence_required");
            }
            if (finalTime.getTime() < end.getTime() || finalTime.getTime() - start.getTime() > READ_DEADLINE_MS ||
                performance.now() > deadline) {
                blocked("The Permit2 read deadline expired.", "x402_permit2_read_deadline");
            }
            // The facilitator is the seller's: its pinned exact-Permit2 route, with EIP-2612 sponsorship exactly when the seller's
            // checked 402 declares it (prepare ANDs this with that declaration).
            const evidence = { chainId: asset.chainId, account: getAddress(request.payer),
                observedAtSeconds: Number(blockTime), balanceAtomic: evmRpcWord(balance).toString(),
                allowanceAtomic: evmRpcWord(allowance).toString(), tokenDomainSeparator: domain === null ? null : domain.toLowerCase(),
                proxyCodeHash, permit2Deployed: true, nonceBitmapWordIndex: request.nonceBitmapWordIndex,
                nonceBitmapWord: bitmap, eip2612Nonce: nonce === null ? null : evmRpcWord(nonce).toString(),
                facilitator: { available: true, network: asset.chain, scheme: "exact", asset: asset.token,
                    assetTransferMethod: "permit2", permit2Address: PERMIT2_ADDRESS,
                    exactProxy: X402_EXACT_PERMIT2_PROXY, eip2612GasSponsoring: true } };
            const selected = { ...asset, networkName: admissionChainName(active, asset.chain), tokenDomainSeparator: evidence.tokenDomainSeparator,
                proxyCodeHash: X402_EXACT_PERMIT2_PROXY_CODE_HASH };
            return { owner, evidence, asset: selected, checkpoint: { policyRevision: active.revision, registryVersion: active.registry.registryVersion, activationDigest: active.activationDigest,
                    blockNumber: block.number, blockHash: block.hash, blockTimestamp: Number(blockTime),
                    facilitatorSupportedDigest: request.challengeHash } };
        }
        finally {
            busy = false;
            activeRpcSources.delete(options.rpc);
        }
    };
    return { readChecked, read: async (request) => { const { owner, evidence, asset } = await readChecked(request); return { owner, evidence, asset }; } };
}
function admissionChainName(active, chain) {
    const row = active.registry.chains.find((candidate) => candidate.chain === chain);
    if (row === undefined)
        blocked("The admitted Permit2 network is absent from the active owner policy.", "x402_permit2_owner_admission_required");
    return row.name;
}
function equalAddress(value, expected) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value))
        return false;
    try {
        return getAddress(value).toLowerCase() === expected.toLowerCase();
    }
    catch {
        return false;
    }
}
function instant(value) {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
        throw new ApnError("APN_INVALID_INPUT", "A valid prepare clock is required.");
    return value;
}
function blocked(message, reason) {
    throw new ApnError("APN_X402_UNSUPPORTED_OFFER", message, { reason, rail: "x402" });
}
//# sourceMappingURL=read-port.js.map