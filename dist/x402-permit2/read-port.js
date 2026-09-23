import { encodeFunctionData, getAddress, parseAbi } from "viem";
import { performance } from "node:perf_hooks";
import { isPlainRecord } from "../canonical.js";
import { loadActiveAssetPolicyRegistry } from "../allowlist-active-policy.js";
import { evaluateAssetPolicy } from "../asset-policy-registry.js";
import { ApnError } from "../errors.js";
import { evmRpcBlock, evmRpcHex, evmRpcQuantity, evmRpcRecord, evmRpcWord, recheckEvmBlock } from "../evm-rpc-codec.js";
import { GaslessHttps } from "../gasless/https.js";
import { parseJsonWithDuplicateRejection } from "../x402-strict-json.js";
import { PERMIT2_ADDRESS, PERMIT2_CODE_HASH, X402_EXACT_PERMIT2_PROXY, X402_PERMIT2_ASSETS, X402_PERMIT2_MECHANISM } from "./registry.js";
const asset = X402_PERMIT2_ASSETS[0];
const FACILITATOR_SUPPORTED = "https://facilitator.payai.network/supported";
const MAX_RPC_CALLS = 10;
const RPC_TIMEOUT_MS = 2_000;
const READ_DEADLINE_MS = 15_000;
const activeRpcSources = new WeakSet();
const TOKEN = parseAbi([
    "function balanceOf(address owner) view returns (uint256)",
    "function allowance(address owner,address spender) view returns (uint256)",
    "function DOMAIN_SEPARATOR() view returns (bytes32)",
    "function nonces(address owner) view returns (uint256)",
]);
const PERMIT2 = parseAbi(["function nonceBitmap(address owner,uint256 wordPos) view returns (uint256)"]);
/** Production read adapter for the existing unsigned prepare boundary. It never creates an operation or reservation. */
export function createPermit2ProductionReadPort(options) {
    const transport = options.transport ?? new GaslessHttps();
    const now = options.now ?? (() => new Date());
    let busy = false;
    return { async read(request) {
            if (busy || activeRpcSources.has(options.rpc))
                blocked("An Avalanche Permit2 read is already in progress.", "x402_permit2_read_busy");
            busy = true;
            activeRpcSources.add(options.rpc);
            try {
                const deadline = performance.now() + READ_DEADLINE_MS;
                let rpcCalls = 0;
                const rpc = async (method, params) => {
                    if (method !== "eth_chainId" && method !== "eth_getBlockByNumber" &&
                        method !== "eth_call" && method !== "eth_getProof") {
                        blocked("The Permit2 read requested an unapproved RPC method.", "x402_permit2_read_budget");
                    }
                    if (++rpcCalls > MAX_RPC_CALLS)
                        blocked("The Permit2 read budget was exhausted.", "x402_permit2_read_budget");
                    const remaining = Math.min(RPC_TIMEOUT_MS, deadline - performance.now());
                    if (remaining <= 0)
                        blocked("The Permit2 read deadline expired.", "x402_permit2_read_deadline");
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), remaining);
                    try {
                        return await Promise.race([
                            options.rpc.call(method, params, controller.signal),
                            new Promise((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(new ApnError("APN_RPC_PROTOCOL", "The Permit2 RPC read timed out.")), { once: true })),
                        ]);
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
                if (evmRpcQuantity(await rpc("eth_chainId", [])) !== BigInt(asset.chainId)) {
                    throw new ApnError("APN_CHAIN_MISMATCH", "The configured Permit2 RPC is not Avalanche C-Chain.");
                }
                const block = await evmRpcBlock(rpc, "finalized");
                const blockTime = evmRpcQuantity(block.raw.timestamp);
                if (blockTime > BigInt(Math.floor(start.getTime() / 1000)) ||
                    BigInt(Math.floor(start.getTime() / 1000)) - blockTime > 30n) {
                    blocked("The finalized Avalanche block is stale.", "x402_permit2_chain_evidence_required");
                }
                const call = async (to, abi, functionName, args = []) => {
                    const data = encodeFunctionData({ abi, functionName, args });
                    return evmRpcHex(await rpc("eth_call", [{ to, data }, block.tag]), 32);
                };
                const balance = await call(asset.token, TOKEN, "balanceOf", [request.payer]);
                const allowance = await call(asset.token, TOKEN, "allowance", [request.payer, PERMIT2_ADDRESS]);
                const domain = await call(asset.token, TOKEN, "DOMAIN_SEPARATOR");
                const nonce = await call(asset.token, TOKEN, "nonces", [request.payer]);
                const bitmap = await call(PERMIT2_ADDRESS, PERMIT2, "nonceBitmap", [request.payer, BigInt(request.nonceBitmapWordIndex)]);
                const proxyCodeHash = proofCodeHash(await rpc("eth_getProof", [X402_EXACT_PERMIT2_PROXY, [], block.tag]), X402_EXACT_PERMIT2_PROXY);
                const permit2CodeHash = proofCodeHash(await rpc("eth_getProof", [PERMIT2_ADDRESS, [], block.tag]), PERMIT2_ADDRESS);
                if (permit2CodeHash.toLowerCase() !== PERMIT2_CODE_HASH.toLowerCase() ||
                    domain.toLowerCase() !== asset.tokenDomainSeparator.toLowerCase() ||
                    proxyCodeHash.toLowerCase() !== asset.proxyCodeHash.toLowerCase()) {
                    blocked("The token domain or exact proxy code changed.", "x402_permit2_chain_evidence_required");
                }
                await recheckEvmBlock(rpc, block);
                let response;
                try {
                    const remaining = Math.min(3_000, deadline - performance.now());
                    if (remaining <= 0)
                        blocked("The Permit2 read deadline expired.", "x402_permit2_read_deadline");
                    response = await withTimeout(transport.request(FACILITATOR_SUPPORTED, "GET", null, 256 * 1024, "APN_HTTP_CONFIG"), remaining);
                }
                catch {
                    return blocked("The facilitator capability read failed.", "x402_permit2_facilitator_unavailable");
                }
                if (response.status !== 200 || Buffer.byteLength(response.body, "utf8") > 256 * 1024) {
                    blocked("The facilitator capability read failed.", "x402_permit2_facilitator_unavailable");
                }
                let supported;
                try {
                    supported = parseJsonWithDuplicateRejection(response.body);
                }
                catch {
                    return blocked("The facilitator capability response is malformed.", "x402_permit2_facilitator_unavailable");
                }
                if (!isPlainRecord(supported) || !Array.isArray(supported.kinds) ||
                    !supported.kinds.some(kind => isPlainRecord(kind) && kind.x402Version === 2 &&
                        kind.scheme === "exact" && kind.network === asset.chain)) {
                    blocked("The facilitator no longer advertises Avalanche exact v2.", "x402_permit2_facilitator_unavailable");
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
                const extensions = Array.isArray(supported.extensions) ? supported.extensions : [];
                const evidence = { chainId: asset.chainId, account: getAddress(request.payer),
                    observedAtSeconds: Number(blockTime), balanceAtomic: evmRpcWord(balance).toString(),
                    allowanceAtomic: evmRpcWord(allowance).toString(), tokenDomainSeparator: domain,
                    proxyCodeHash, permit2Deployed: true, nonceBitmapWordIndex: request.nonceBitmapWordIndex,
                    nonceBitmapWord: bitmap, eip2612Nonce: evmRpcWord(nonce).toString(),
                    facilitator: { available: true, network: asset.chain, scheme: "exact", asset: asset.token,
                        assetTransferMethod: "permit2", permit2Address: PERMIT2_ADDRESS,
                        exactProxy: X402_EXACT_PERMIT2_PROXY, eip2612GasSponsoring: extensions.includes("eip2612GasSponsoring") } };
                return { owner, evidence };
            }
            finally {
                busy = false;
                activeRpcSources.delete(options.rpc);
            }
        } };
}
function proofCodeHash(value, address) {
    const proof = evmRpcRecord(value);
    if (!equalAddress(proof.address, address))
        throw new ApnError("APN_RPC_PROTOCOL", "Permit2 code proof address changed.");
    return evmRpcHex(proof.codeHash, 32);
}
async function withTimeout(promise, milliseconds) {
    let timeout;
    try {
        return await Promise.race([promise, new Promise((_resolve, reject) => {
                timeout = setTimeout(() => reject(new ApnError("APN_PROVIDER_UNAVAILABLE", "The Permit2 facilitator read timed out.")), milliseconds);
            })]);
    }
    finally {
        if (timeout !== undefined)
            clearTimeout(timeout);
    }
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