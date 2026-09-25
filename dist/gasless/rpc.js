import { AsyncLocalStorage } from "node:async_hooks";
import { encodeAbiParameters, keccak256, numberToHex } from "viem";
import { canonicalJson, exactKeys, hashObject, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { gaslessMirrorBootstrap } from "./custody.js";
import { assertGaslessEstimate } from "./economics.js";
import { GaslessHttps } from "./https.js";
import { observeGasless } from "./rpc-observe.js";
import { rpcAddress, rpcBlock, rpcHex, rpcJson, rpcQuantity, rpcRecord, rpcWord, recheckBlock } from "./rpc-codec.js";
import { readAccountAt, readFeeConfigurationAt, verifyProtocolAt } from "./rpc-state.js";
import { bundlerGasPrices } from "./rpc-gas-prices.js";
import { gaslessDeployment, gaslessIntentAsset, gaslessProtocolHash } from "./registry.js";
import { GASLESS_ESTIMATE_SIGNATURE, verifyGaslessBootstrap, verifyGaslessUserOperation } from "./signature.js";
import { assertGaslessExecutionChain, gaslessChain, gaslessFailure } from "./validation.js";
import { gaslessUserOperation, gaslessUserOperationHash, validateGaslessWire } from "./wire.js";
const RPC_METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode",
    "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_maxPriorityFeePerGas",
    "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"]);
const BUNDLER_METHODS = new Set(["eth_chainId", "eth_supportedEntryPoints",
    "eth_estimateUserOperationGas", "eth_sendUserOperation", "eth_getUserOperationReceipt", "eth_getUserOperationByHash"]);
const MAX_RESPONSE = 2 * 1024 * 1024;
const MAX_INVOCATION_POSTS = 24;
const invocation = new AsyncLocalStorage();
/** One command invocation includes RPC and bundler POSTs, including failed transport attempts. */
export class GaslessRpcRequestSession {
    posts = 0;
    terminalStatus = null;
    verifiedChains = new Set();
    protocolAnchors = new Map();
    reserve() {
        this.assertActive();
        if (this.posts >= MAX_INVOCATION_POSTS)
            gaslessFailure("APN_RPC_BUDGET_EXCEEDED", "gasless_RPC_request_budget");
        this.posts += 1;
    }
    assertActive() {
        if (this.terminalStatus !== null)
            this.rejectHttp(this.terminalStatus);
    }
    rejectHttp(status) {
        this.terminalStatus = status;
        if (status === 429)
            return gaslessFailure("APN_RPC_RATE_LIMITED", "gasless_RPC_HTTP_429");
        return gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_HTTP_status");
    }
    hasVerifiedChain(rpc) { return this.verifiedChains.has(rpc); }
    verifyChain(rpc) { this.verifiedChains.add(rpc); }
    protocolAt(rpc, hash, verify) {
        const cached = this.protocolAnchors.get(rpc);
        if (cached?.hash === hash)
            return cached.proof;
        // A changed latest anchor requires fresh code and proxy reads before the next effect gate.
        const proof = verify();
        this.protocolAnchors.set(rpc, { hash, proof });
        void proof.catch(() => { if (this.protocolAnchors.get(rpc)?.proof === proof)
            this.protocolAnchors.delete(rpc); });
        return proof;
    }
}
/** Wrap a public APN command so a reused RPC factory receives a fresh 24-POST budget. */
export async function withGaslessRpcInvocation(work) {
    return await invocation.run(new GaslessRpcRequestSession(), work);
}
/** Reuse the public command's budget, or start one for a directly invoked observation port. */
export async function withinGaslessRpcInvocation(work) {
    return invocation.getStore() === undefined ? await withGaslessRpcInvocation(work) : await work();
}
export function gaslessRpcInvocation() {
    const session = invocation.getStore();
    if (session === undefined)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_invocation_missing");
    return session;
}
export function gaslessRpcFactory(environment) {
    const cache = new Map(), transport = new GaslessHttps();
    const fallbackSession = new GaslessRpcRequestSession();
    return (chainId) => {
        const selected = gaslessChain(chainId, "APN_RPC_CONFIG"), existing = cache.get(selected);
        if (existing !== undefined)
            return existing;
        const deployment = gaslessDeployment(selected), rpcUrl = environment[deployment.rpcEnv];
        if (rpcUrl === undefined || rpcUrl.length === 0)
            gaslessFailure("APN_RPC_CONFIG", `missing_${deployment.rpcEnv}`);
        const configuredBundler = environment[deployment.bundlerEnv];
        const rpc = new GaslessRpc(selected, rpcUrl, configuredBundler === undefined || configuredBundler.length === 0
            ? undefined : configuredBundler, transport, fallbackSession);
        cache.set(selected, rpc);
        return rpc;
    };
}
export class GaslessRpc {
    transport;
    fallbackSession;
    chainId;
    rpcOrigin;
    rpcEndpointHash;
    bundlerOrigin;
    bundlerEndpointHash;
    rpcEndpoint;
    bundlerEndpoint;
    deployment;
    sequence = 0n;
    rpcCall;
    bundlerCall;
    pendingReads = new Map();
    constructor(chainId, rpcUrl, bundlerUrl, transport = new GaslessHttps(), fallbackSession = new GaslessRpcRequestSession()) {
        this.transport = transport;
        this.fallbackSession = fallbackSession;
        this.chainId = gaslessChain(chainId, "APN_RPC_CONFIG");
        this.deployment = gaslessDeployment(this.chainId);
        const rpc = endpoint(rpcUrl), bundler = endpoint(bundlerUrl ?? this.deployment.publicBundlerUrl);
        this.rpcEndpoint = rpc.toString();
        this.bundlerEndpoint = bundler.toString();
        this.rpcOrigin = rpc.origin;
        this.bundlerOrigin = bundler.origin;
        this.rpcEndpointHash = sha256(this.rpcEndpoint);
        this.bundlerEndpointHash = sha256(this.bundlerEndpoint);
        this.rpcCall = async (method, params) => await this.call("rpc", method, params, this.transport);
        this.bundlerCall = async (method, params) => await this.call("bundler", method, params, this.transport);
    }
    async assertChain() {
        const [rpcChain, bundlerChain, supported] = await Promise.all([
            this.rpcCall("eth_chainId", []), this.bundlerCall("eth_chainId", []),
            this.bundlerCall("eth_supportedEntryPoints", []),
        ]);
        this.validateChain(rpcChain, bundlerChain, supported);
    }
    validateChain(rpcChain, bundlerChain, supported) {
        if (rpcQuantity(rpcChain) !== BigInt(this.chainId) || rpcQuantity(bundlerChain) !== BigInt(this.chainId)) {
            gaslessFailure("APN_CHAIN_MISMATCH", "gasless_chain_identity");
        }
        if (!Array.isArray(supported) || supported.length < 1 || supported.length > 16 ||
            !supported.some((value) => {
                try {
                    return rpcAddress(value) === this.deployment.entryPoint;
                }
                catch {
                    return false;
                }
            }))
            gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_entrypoint_unavailable");
    }
    async snapshot(owner, approvedGas) {
        const session = invocation.getStore() ?? this.fallbackSession;
        // The latest anchor is read in the same read-only batch as the chain identity.
        const [rpcChain, bundler, at] = await Promise.all([
            this.rpcCall("eth_chainId", []), this.bundlerState(), rpcBlock(this.rpcCall, "latest"),
        ]);
        this.validateChain(rpcChain, bundler[0], bundler[1]);
        const [account, feeConfiguration, priority] = await Promise.all([
            readAccountAt(this.rpcCall, this.deployment, owner, at.block, true),
            readFeeConfigurationAt(this.rpcCall, this.deployment, owner, at.block),
            this.rpcCall("eth_maxPriorityFeePerGas", []),
            session.protocolAt(this, at.block.hash, async () => await verifyProtocolAt(this.rpcCall, this.deployment, at.block)),
        ]).then(([accountState, configuration, priorityFee]) => [accountState, configuration, priorityFee]);
        if (account.pendingEoaNonceAtomic !== account.eoaNonceAtomic) {
            gaslessFailure("APN_OPERATION_BLOCKED", "gasless_nonce_drift");
        }
        const prices = bundlerGasPrices(bundler[2], at.raw.baseFeePerGas, priority, approvedGas);
        await recheckBlock(this.rpcCall, at.block);
        session.verifyChain(this);
        return { chainId: this.chainId, rpcOrigin: this.rpcOrigin, rpcEndpointHash: this.rpcEndpointHash,
            bundlerOrigin: this.bundlerOrigin, bundlerEndpointHash: this.bundlerEndpointHash, block: at.block,
            protocolHash: gaslessProtocolHash(this.deployment), owner: account.owner, token: this.deployment.token,
            balanceAtomic: account.balanceAtomic, nativeBalanceWei: account.nativeBalanceWei,
            allowanceAtomic: account.allowanceAtomic, permitNonceAtomic: account.permitNonceAtomic,
            entryPointNonceAtomic: account.entryPointNonceAtomic, eoaNonceAtomic: account.eoaNonceAtomic,
            pendingEoaNonceAtomic: account.pendingEoaNonceAtomic, delegation: account.delegation, feeConfiguration, ...prices };
    }
    /** One bounded, read-only HTTP batch; no effect call can enter this batch. */
    async bundlerState() {
        const methods = ["eth_chainId", "eth_supportedEntryPoints", "pimlico_getUserOperationGasPrice"];
        const requests = methods.map(method => ({ jsonrpc: "2.0", id: (++this.sequence).toString(), method, params: [] }));
        let response;
        const session = invocation.getStore() ?? this.fallbackSession;
        session.reserve();
        try {
            response = await this.transport.request(this.bundlerEndpoint, "POST", canonicalJson(requests), MAX_RESPONSE, "APN_RPC_CONFIG", () => session.assertActive());
        }
        catch {
            throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable.");
        }
        assertHttpStatus(response.status, session);
        const rows = rpcJson(response.body, MAX_RESPONSE);
        if (!Array.isArray(rows) || rows.length !== requests.length)
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
        const results = new Map();
        for (const value of rows) {
            const row = rpcRecord(value), id = row.id;
            const result = Object.hasOwn(row, "result"), error = Object.hasOwn(row, "error");
            if (typeof id !== "string" || !requests.some(request => request.id === id) || results.has(id) ||
                row.jsonrpc !== "2.0" || result === error ||
                !exactKeys(row, result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"])) {
                gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
            }
            if (error)
                gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_provider_response");
            results.set(id, row.result);
        }
        return requests.map(request => results.get(request.id));
    }
    async mirrorEstimate(intent, fees) {
        assertGaslessExecutionChain(this.chainId);
        const asset = this.assertIntent(intent);
        // Proved before any use: the row's balance-layout claim must reproduce the owner's own snapshot balance on chain.
        const slot = await this.provenBalanceSlot(asset, intent);
        // One bounded request: the guard snapshot before it already proved both endpoint chains and EntryPoint support.
        const mirror = await gaslessMirrorBootstrap(intent);
        const wire = gaslessUserOperation(mirror.intent, mirror, GASLESS_ESTIMATE_SIGNATURE, fees);
        const override = { [intent.token]: { stateDiff: { [gaslessBalanceSlot(mirror.intent.owner.address, slot)]: numberToHex(BigInt(intent.request.grossAtomic), { size: 32 }) } } };
        let raw;
        try {
            raw = rpcRecord(await this.bundlerCall("eth_estimateUserOperationGas", [wire, intent.entryPoint, override]));
        }
        catch {
            return gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_mirror_estimate_unavailable");
        }
        const fields = ["verificationGasLimit", "callGasLimit", "paymasterVerificationGasLimit",
            "paymasterPostOpGasLimit", "preVerificationGas"];
        if (!exactKeys(raw, fields))
            gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_mirror_estimate_unavailable");
        const bounded = Object.fromEntries(fields.map((field) => [field, rpcQuantity(raw[field]).toString()]));
        const estimate = { ...bounded, responseHash: hashObject(bounded) };
        try {
            assertGaslessEstimate(intent, estimate);
        }
        catch {
            gaslessFailure("APN_FEE_BUDGET_EXCEEDED", "gasless_mirror_estimate_bounds");
        }
        return estimate;
    }
    async estimate(intent, bootstrap, fees) {
        assertGaslessExecutionChain(this.chainId);
        this.assertIntent(intent);
        await verifyGaslessBootstrap(intent, { permitSignature: bootstrap.permitSignature, authorization: bootstrap.authorization });
        await this.assertChainUnlessVerified();
        const wire = gaslessUserOperation(intent, bootstrap, GASLESS_ESTIMATE_SIGNATURE, fees);
        validateGaslessWire(intent, wire);
        const raw = rpcRecord(await this.bundlerCall("eth_estimateUserOperationGas", [wire, intent.entryPoint]));
        const fields = ["verificationGasLimit", "callGasLimit", "paymasterVerificationGasLimit",
            "paymasterPostOpGasLimit", "preVerificationGas"];
        if (!exactKeys(raw, fields))
            gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_estimate_bounds");
        const bounded = Object.fromEntries(fields.map((field) => [field, rpcQuantity(raw[field]).toString()]));
        const estimate = { ...bounded, responseHash: hashObject(bounded) };
        assertGaslessEstimate(intent, estimate);
        return estimate;
    }
    async send(intent, sealed) {
        assertGaslessExecutionChain(this.chainId);
        this.assertIntent(intent);
        const wire = validateGaslessWire(intent, sealed.userOperation);
        const localHash = gaslessUserOperationHash(intent, wire);
        if (sealed.userOperationHash !== localHash || await verifyGaslessUserOperation(intent, wire) !== localHash) {
            gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity");
        }
        await this.assertChainUnlessVerified();
        try {
            const returned = rpcHex(await this.bundlerCall("eth_sendUserOperation", [wire, intent.entryPoint]), 32, 32);
            if (returned !== localHash)
                throw new Error("hash");
            return returned;
        }
        catch {
            throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless submission state is unknown.");
        }
    }
    async observe(intent, identity, cursor) {
        this.assertIntent(intent);
        const rpcChain = await this.rpcCall("eth_chainId", []);
        if (rpcQuantity(rpcChain) !== BigInt(this.chainId))
            gaslessFailure("APN_CHAIN_MISMATCH", "gasless_chain_identity");
        return await observeGasless({ chainId: this.chainId, rpcOrigin: this.rpcOrigin, deployment: this.deployment,
            rpc: this.rpcCall, bundler: this.bundlerCall }, intent, identity, cursor);
    }
    async assertChainUnlessVerified() {
        if (!(invocation.getStore() ?? this.fallbackSession).hasVerifiedChain(this))
            await this.assertChain();
    }
    /** Returns the admitted asset the intent names, so no caller has to re-derive it from a literal. */
    assertIntent(intent) {
        if (intent.request.chainId !== this.chainId || intent.initialSnapshot.chainId !== this.chainId ||
            intent.initialSnapshot.rpcOrigin !== this.rpcOrigin || intent.initialSnapshot.rpcEndpointHash !== this.rpcEndpointHash ||
            intent.initialSnapshot.bundlerOrigin !== this.bundlerOrigin || intent.initialSnapshot.bundlerEndpointHash !== this.bundlerEndpointHash) {
            gaslessFailure("APN_RPC_CONFIG", "gasless_endpoint_identity");
        }
        const asset = gaslessIntentAsset(intent);
        if (intent.entryPoint !== this.deployment.entryPoint || intent.delegate !== this.deployment.delegate ||
            intent.initialSnapshot.protocolHash !== gaslessProtocolHash(this.deployment)) {
            gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity");
        }
        return asset;
    }
    /**
     * The row's `balanceLayout` is a claim about one token implementation's storage, never protocol knowledge, so it is
     * proved twice before it is trusted. First the claim must name the implementation this chain is verified to run, so
     * a layout description can never outlive the code it describes. Then it is measured: the owner's balance word at the
     * claimed slot must equal the balance the frozen snapshot already read through `balanceOf` at that exact block.
     * A row with no claim, a claim for another implementation, a zero witness balance or any disagreement fails closed
     * rather than fabricating a balance at an unverified slot.
     */
    async provenBalanceSlot(asset, intent) {
        const layout = asset.balanceLayout;
        if (layout === null)
            gaslessFailure("APN_PROVIDER_CAPABILITY_UNAVAILABLE", "gasless_balance_layout_unknown");
        if (layout.implementationHash !== asset.implementationHash) {
            gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_balance_layout_stale");
        }
        const witness = BigInt(intent.initialSnapshot.balanceAtomic);
        if (witness === 0n)
            gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_balance_layout_unproven");
        const observed = rpcWord(await this.rpcCall("eth_getStorageAt", [asset.token,
            gaslessBalanceSlot(intent.owner.address, layout.mappingSlotAtomic),
            { blockHash: intent.initialSnapshot.block.hash, requireCanonical: true }]));
        if (observed !== witness)
            gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_balance_layout_mismatch");
        return layout.mappingSlotAtomic;
    }
    async call(which, method, params, transport) {
        const methods = which === "rpc" ? RPC_METHODS : BUNDLER_METHODS;
        if (!methods.has(method))
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_method");
        const id = (++this.sequence).toString();
        const session = invocation.getStore() ?? this.fallbackSession;
        if (which === "rpc")
            return await this.queueRead({ id, method, params }, session);
        const body = canonicalJson({ jsonrpc: "2.0", id, method, params });
        session.reserve();
        let response;
        try {
            response = await transport.request(this.bundlerEndpoint, "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG", () => session.assertActive());
        }
        catch {
            throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable.");
        }
        assertHttpStatus(response.status, session);
        const record = rpcRecord(rpcJson(response.body, MAX_RESPONSE));
        const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
        const keys = result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"];
        if (record.jsonrpc !== "2.0" || record.id !== id || result === error || !exactKeys(record, keys)) {
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
        }
        if (error)
            gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_provider_response");
        return record.result;
    }
    /** Same-turn read calls share one physical POST; invocation sessions never share a batch. */
    queueRead(read, session) {
        return new Promise((resolve, reject) => {
            const pending = this.pendingReads.get(session);
            const row = { ...read, resolve, reject };
            if (pending !== undefined) {
                pending.push(row);
                return;
            }
            this.pendingReads.set(session, [row]);
            queueMicrotask(() => { void this.flushReads(session); });
        });
    }
    async flushReads(session) {
        const reads = this.pendingReads.get(session);
        if (reads === undefined)
            return;
        this.pendingReads.delete(session);
        try {
            session.reserve();
            const requests = reads.map(({ id, method, params }) => ({ jsonrpc: "2.0", id, method, params }));
            const response = await this.transport.request(this.rpcEndpoint, "POST", canonicalJson(requests.length === 1 ? requests[0] : requests), MAX_RESPONSE, "APN_RPC_CONFIG", () => session.assertActive());
            assertHttpStatus(response.status, session);
            if (reads.length === 1) {
                reads[0].resolve(parseRpcResult(rpcRecord(rpcJson(response.body, MAX_RESPONSE)), reads[0].id));
                return;
            }
            const rows = rpcJson(response.body, MAX_RESPONSE);
            if (!Array.isArray(rows) || rows.length !== reads.length)
                gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
            const expected = new Set(reads.map(row => row.id)), results = new Map();
            for (const value of rows) {
                const record = rpcRecord(value), id = record.id;
                if (typeof id !== "string" || !expected.has(id) || results.has(id)) {
                    gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
                }
                results.set(id, parseRpcResult(record, id));
            }
            for (const read of reads)
                read.resolve(results.get(read.id));
        }
        catch (error) {
            const safe = error instanceof ApnError ? error : new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable.");
            for (const read of reads)
                read.reject(safe);
        }
    }
}
function parseRpcResult(record, id) {
    const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
    const keys = result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"];
    if (record.jsonrpc !== "2.0" || record.id !== id || result === error || !exactKeys(record, keys)) {
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_response");
    }
    if (error)
        gaslessFailure("APN_PROVIDER_EFFECT_UNAVAILABLE", "gasless_provider_response");
    return record.result;
}
function assertHttpStatus(status, session) {
    if (status !== 200)
        session.rejectHttp(status);
}
/** Storage key of a Solidity `mapping(address => uint256)` entry at the given base slot. */
export function gaslessBalanceSlot(holder, base) {
    return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, BigInt(base)]));
}
function endpoint(value) {
    const parsed = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Gasless RPC endpoint", 2048);
    if (parsed.search !== "" || parsed.hash !== "")
        gaslessFailure("APN_RPC_CONFIG", "gasless_endpoint_identity");
    return parsed;
}
//# sourceMappingURL=rpc.js.map