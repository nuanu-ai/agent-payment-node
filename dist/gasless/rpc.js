import { encodeAbiParameters, keccak256, numberToHex } from "viem";
import { canonicalJson, exactKeys, hashObject, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { gaslessMirrorBootstrap } from "./custody.js";
import { assertGaslessEstimate } from "./economics.js";
import { GaslessHttps } from "./https.js";
import { observeGasless } from "./rpc-observe.js";
import { rpcAddress, rpcBlock, rpcHex, rpcJson, rpcQuantity, rpcRecord, recheckBlock } from "./rpc-codec.js";
import { readAccountAt, readFeeConfigurationAt, verifyProtocolAt } from "./rpc-state.js";
import { bundlerGasPrices } from "./rpc-gas-prices.js";
import { gaslessDeployment, gaslessProtocolHash } from "./registry.js";
import { GASLESS_ESTIMATE_SIGNATURE, verifyGaslessBootstrap, verifyGaslessUserOperation } from "./signature.js";
import { assertGaslessExecutionChain, gaslessChain, gaslessFailure, gaslessSame } from "./validation.js";
import { gaslessUserOperation, gaslessUserOperationHash, validateGaslessWire } from "./wire.js";
const RPC_METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode",
    "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_maxPriorityFeePerGas",
    "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"]);
const BUNDLER_METHODS = new Set(["eth_chainId", "eth_supportedEntryPoints",
    "eth_estimateUserOperationGas", "eth_sendUserOperation", "eth_getUserOperationReceipt", "eth_getUserOperationByHash"]);
const MAX_RESPONSE = 2 * 1024 * 1024;
export function gaslessRpcFactory(environment) {
    const cache = new Map(), transport = new GaslessHttps();
    return (chainId) => {
        const selected = gaslessChain(chainId, "APN_RPC_CONFIG"), existing = cache.get(selected);
        if (existing !== undefined)
            return existing;
        const deployment = gaslessDeployment(selected), rpcUrl = environment[deployment.rpcEnv];
        if (rpcUrl === undefined || rpcUrl.length === 0)
            gaslessFailure("APN_RPC_CONFIG", `missing_${deployment.rpcEnv}`);
        const configuredBundler = environment[deployment.bundlerEnv];
        const rpc = new GaslessRpc(selected, rpcUrl, configuredBundler === undefined || configuredBundler.length === 0
            ? undefined : configuredBundler, transport);
        cache.set(selected, rpc);
        return rpc;
    };
}
export class GaslessRpc {
    transport;
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
    constructor(chainId, rpcUrl, bundlerUrl, transport = new GaslessHttps()) {
        this.transport = transport;
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
        const [rpcChain, bundler] = await Promise.all([this.rpcCall("eth_chainId", []), this.bundlerState()]);
        this.validateChain(rpcChain, bundler[0], bundler[1]);
        const at = await rpcBlock(this.rpcCall, "latest");
        const [account, feeConfiguration, priority] = await Promise.all([
            readAccountAt(this.rpcCall, this.deployment, owner, at.block, true),
            readFeeConfigurationAt(this.rpcCall, this.deployment, owner, at.block),
            this.rpcCall("eth_maxPriorityFeePerGas", []),
            verifyProtocolAt(this.rpcCall, this.deployment, at.block),
        ]).then(([accountState, configuration, priorityFee]) => [accountState, configuration, priorityFee]);
        if (account.pendingEoaNonceAtomic !== account.eoaNonceAtomic) {
            gaslessFailure("APN_OPERATION_BLOCKED", "gasless_nonce_drift");
        }
        const prices = bundlerGasPrices(bundler[2], at.raw.baseFeePerGas, priority, approvedGas);
        await recheckBlock(this.rpcCall, at.block);
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
        try {
            response = await this.transport.request(this.bundlerEndpoint, "POST", canonicalJson(requests), MAX_RESPONSE, "APN_RPC_CONFIG");
        }
        catch {
            throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable.");
        }
        if (response.status !== 200)
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_HTTP_status");
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
        this.assertIntent(intent);
        // One bounded request: the guard snapshot before it already proved both endpoint chains and EntryPoint support.
        const mirror = await gaslessMirrorBootstrap(intent);
        const wire = gaslessUserOperation(mirror.intent, mirror, GASLESS_ESTIMATE_SIGNATURE, fees);
        // FiatToken v2.2 keeps balances in the mapping at storage slot 9; the pinned implementation hash fixes that layout.
        const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [mirror.intent.owner.address, 9n]));
        const override = { [intent.token]: { stateDiff: { [slot]: numberToHex(BigInt(intent.request.grossAtomic), { size: 32 }) } } };
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
        await this.assertChain();
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
        await this.assertChain();
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
    assertIntent(intent) {
        if (intent.request.chainId !== this.chainId || intent.initialSnapshot.chainId !== this.chainId ||
            intent.initialSnapshot.rpcOrigin !== this.rpcOrigin || intent.initialSnapshot.rpcEndpointHash !== this.rpcEndpointHash ||
            intent.initialSnapshot.bundlerOrigin !== this.bundlerOrigin || intent.initialSnapshot.bundlerEndpointHash !== this.bundlerEndpointHash) {
            gaslessFailure("APN_RPC_CONFIG", "gasless_endpoint_identity");
        }
        if (intent.token !== this.deployment.token || intent.paymaster !== this.deployment.paymaster ||
            intent.entryPoint !== this.deployment.entryPoint || intent.delegate !== this.deployment.delegate ||
            intent.initialSnapshot.protocolHash !== gaslessProtocolHash(this.deployment) ||
            !gaslessSame(intent.tokenDomain, this.deployment.tokenDomain)) {
            gaslessFailure("APN_PROVIDER_PROTOCOL", "gasless_protocol_identity");
        }
    }
    async call(which, method, params, transport) {
        const methods = which === "rpc" ? RPC_METHODS : BUNDLER_METHODS;
        if (!methods.has(method))
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_method");
        const id = (++this.sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
        let response;
        try {
            response = await transport.request(which === "rpc" ? this.rpcEndpoint : this.bundlerEndpoint, "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG");
        }
        catch {
            throw new ApnError("APN_RPC_AMBIGUOUS", "Gasless RPC transport is unavailable.");
        }
        if (response.status !== 200)
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_RPC_HTTP_status");
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
}
function endpoint(value) {
    const parsed = parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "Gasless RPC endpoint", 2048);
    if (parsed.search !== "" || parsed.hash !== "")
        gaslessFailure("APN_RPC_CONFIG", "gasless_endpoint_identity");
    return parsed;
}
//# sourceMappingURL=rpc.js.map