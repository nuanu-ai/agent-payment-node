import { encodeFunctionData, getAddress, keccak256, parseAbi } from "viem";
import { performance } from "node:perf_hooks";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { ApnError } from "../errors.js";
import { evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcWord } from "../evm-rpc-codec.js";
import { PERMIT2_ADDRESS, PERMIT2_CODE_HASH, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "./registry.js";
const asset = X402_PERMIT2_ASSETS[0];
/** The read plan: [chainId, finalized header], then one batch pinned to that block's hash. Nothing is retried. */
const READ_PLAN_POSTS = 2;
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
 * Two POSTs: chain id with the finalized header, then balance, allowance, token domain, EIP-2612 nonce, the Permit2
 * nonce word and both pinned runtime codes in one batch pinned by EIP-1898 {blockHash, requireCanonical}. No facilitator
 * read gates it: the seller picks the facilitator, and one that cannot settle leaves the signature to expire unused.
 */
export function createPermit2ProductionReadPort(options) {
    const now = options.now ?? (() => new Date());
    let busy = false;
    const readChecked = async (request) => {
        if (busy || activeRpcSources.has(options.rpc))
            blocked("An Avalanche Permit2 read is already in progress.", "x402_permit2_read_busy");
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
            if (!options.profile || !options.stateRoot || !equalAddress(request.payer, await options.localAccount()) ||
                request.chainId !== asset.chainId || !equalAddress(request.token, asset.token) ||
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
            const owner = { active: true, account: getAddress(request.payer), chain: asset.chain,
                token: asset.token, rail: "x402", mechanism: X402_PERMIT2_MECHANISM,
                maximumPerTransferAtomic: admission.caps.maximumPerTransferAtomic,
                dailyLimitAtomic: admission.caps.dailyLimitAtomic, usedTodayAtomic: usage, policyDigest: active.digest };
            const [chainId, rawBlock] = await batch([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["finalized", false] }]);
            if (evmRpcQuantity(chainId) !== BigInt(asset.chainId)) {
                throw new ApnError("APN_CHAIN_MISMATCH", "The configured Permit2 RPC is not Avalanche C-Chain.");
            }
            const block = evmRpcBlockResult(rawBlock, "finalized");
            const blockTime = evmRpcQuantity(block.raw.timestamp);
            if (blockTime > BigInt(Math.floor(start.getTime() / 1000)) ||
                BigInt(Math.floor(start.getTime() / 1000)) - blockTime > 30n) {
                blocked("The finalized Avalanche block is stale.", "x402_permit2_chain_evidence_required");
            }
            // EIP-1898: every read below is pinned to this canonical finalized block, so no header recheck follows them.
            const pinned = { blockHash: block.hash, requireCanonical: true };
            const call = (to, abi, functionName, args = []) => ({ method: "eth_call", params: [{ to, data: encodeFunctionData({ abi, functionName, args }) }, pinned] });
            const values = await batch([
                call(asset.token, TOKEN, "balanceOf", [request.payer]),
                call(asset.token, TOKEN, "allowance", [request.payer, PERMIT2_ADDRESS]),
                call(asset.token, TOKEN, "DOMAIN_SEPARATOR"),
                call(asset.token, TOKEN, "nonces", [request.payer]),
                call(PERMIT2_ADDRESS, PERMIT2, "nonceBitmap", [request.payer, BigInt(request.nonceBitmapWordIndex)]),
                { method: "eth_getCode", params: [X402_EXACT_PERMIT2_PROXY, pinned] },
                { method: "eth_getCode", params: [PERMIT2_ADDRESS, pinned] },
            ]);
            const [balance, allowance, domain, nonce, bitmap] = values.slice(0, 5).map(value => evmRpcHex(value, 32));
            // Both contracts are immutable at fixed addresses, so the code hash is a deployment fact, not an upgrade pin.
            const proxyCodeHash = keccak256(evmRpcHex(values[5])), permit2CodeHash = keccak256(evmRpcHex(values[6]));
            if (permit2CodeHash.toLowerCase() !== PERMIT2_CODE_HASH.toLowerCase() ||
                domain.toLowerCase() !== asset.tokenDomainSeparator.toLowerCase() ||
                proxyCodeHash.toLowerCase() !== asset.proxyCodeHash.toLowerCase()) {
                blocked("The token domain or exact proxy code changed.", "x402_permit2_chain_evidence_required");
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
                blocked("The finalized Avalanche block is stale at prepare return.", "x402_permit2_chain_evidence_required");
            }
            if (finalTime.getTime() < end.getTime() || finalTime.getTime() - start.getTime() > READ_DEADLINE_MS ||
                performance.now() > deadline) {
                blocked("The Permit2 read deadline expired.", "x402_permit2_read_deadline");
            }
            // The facilitator is the seller's: its pinned exact-Permit2 route, with EIP-2612 sponsorship exactly when the seller's
            // checked 402 declares it (prepare ANDs this with that declaration).
            const evidence = { chainId: asset.chainId, account: getAddress(request.payer),
                observedAtSeconds: Number(blockTime), balanceAtomic: evmRpcWord(balance).toString(),
                allowanceAtomic: evmRpcWord(allowance).toString(), tokenDomainSeparator: domain,
                proxyCodeHash, permit2Deployed: true, nonceBitmapWordIndex: request.nonceBitmapWordIndex,
                nonceBitmapWord: bitmap, eip2612Nonce: evmRpcWord(nonce).toString(),
                facilitator: { available: true, network: asset.chain, scheme: "exact", asset: asset.token,
                    assetTransferMethod: "permit2", permit2Address: PERMIT2_ADDRESS,
                    exactProxy: X402_EXACT_PERMIT2_PROXY, eip2612GasSponsoring: true } };
            return { owner, evidence, checkpoint: { policyRevision: active.revision, registryVersion: active.registry.registryVersion, activationDigest: active.activationDigest,
                    blockNumber: block.number, blockHash: block.hash, blockTimestamp: Number(blockTime),
                    facilitatorSupportedDigest: request.challengeHash } };
        }
        finally {
            busy = false;
            activeRpcSources.delete(options.rpc);
        }
    };
    return { readChecked, read: async (request) => { const { owner, evidence } = await readChecked(request); return { owner, evidence }; } };
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