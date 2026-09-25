import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { canonicalJson, exactKeys, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { GaslessHttps } from "./https.js";
import { validateGaslessIntent } from "./intent-validation.js";
import { gaslessObservationRpcEnv, gaslessObservationSource } from "./observation-source.js";
import { gaslessRpcInvocation, withinGaslessRpcInvocation } from "./rpc.js";
import { recheckBlock, rpcJson, rpcQuantity, rpcRecord } from "./rpc-codec.js";
import { observeGasless } from "./rpc-observe.js";
import { verifyProtocolAt } from "./rpc-state.js";
import { gaslessDeployment, gaslessProtocolHash } from "./registry.js";
import { gaslessChain, gaslessFailure, gaslessSame } from "./validation.js";
const READ_METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getCode",
    "eth_getStorageAt", "eth_getTransactionCount", "eth_call", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"]);
const MAX_RESPONSE = 2 * 1024 * 1024;
const OBSERVATION_REQUEST_INTERVAL_MS = 1_000;
const defaultPacing = () => ({
    minimumIntervalMs: OBSERVATION_REQUEST_INTERVAL_MS,
    monotonicNow: () => performance.now(),
    sleep: async (milliseconds) => { await sleep(milliseconds); },
});
export function gaslessObservationRpcFactory(environment) {
    const transport = new GaslessHttps();
    return (chainId, environmentName) => {
        const name = gaslessObservationRpcEnv(environmentName), rpcUrl = environment[name];
        if (rpcUrl === undefined || rpcUrl.length === 0)
            gaslessFailure("APN_RPC_CONFIG", "gasless_observation_rpc_missing");
        return new GaslessObservationRpc(chainId, rpcUrl, name, transport, defaultPacing());
    };
}
/** One explicit observation source. No bundler, key, estimate or send capability exists here. */
export class GaslessObservationRpc {
    transport;
    pacing;
    chainId;
    rpcOrigin;
    rpcEndpointHash;
    endpoint;
    environmentName;
    deployment;
    sequence = 0n;
    rpcCall;
    queue = Promise.resolve();
    pendingReads = new Map();
    lastRequestAt = null;
    unavailable = false;
    constructor(chainId, rpcUrl, environmentName, transport = new GaslessHttps(), pacing = defaultPacing()) {
        this.transport = transport;
        this.pacing = pacing;
        this.chainId = gaslessChain(chainId, "APN_RPC_CONFIG");
        this.environmentName = gaslessObservationRpcEnv(environmentName);
        this.deployment = gaslessDeployment(this.chainId);
        const endpoint = parsePublicHttpsUrl(rpcUrl, "APN_RPC_CONFIG", "Observation RPC endpoint", 2048);
        if (endpoint.search !== "" || endpoint.hash !== "")
            gaslessFailure("APN_RPC_CONFIG", "gasless_observation_rpc_endpoint");
        this.endpoint = endpoint.toString();
        this.rpcOrigin = endpoint.origin;
        this.rpcEndpointHash = sha256(this.endpoint);
        this.rpcCall = async (method, params) => await this.call(method, params);
    }
    async observe(intent, identity, cursor) {
        return await withinGaslessRpcInvocation(async () => await this.observeWithinInvocation(intent, identity, cursor));
    }
    async observeWithinInvocation(intent, identity, cursor) {
        this.unavailable = false;
        validateGaslessIntent(intent);
        if (intent.request.chainId !== this.chainId || intent.initialSnapshot.chainId !== this.chainId ||
            intent.token !== this.deployment.token || intent.paymaster !== this.deployment.paymaster ||
            intent.entryPoint !== this.deployment.entryPoint || intent.delegate !== this.deployment.delegate ||
            intent.initialSnapshot.protocolHash !== gaslessProtocolHash(this.deployment) ||
            !gaslessSame(intent.tokenDomain, this.deployment.tokenDomain)) {
            gaslessFailure("APN_RPC_CONFIG", "gasless_observation_rpc_binding");
        }
        if (rpcQuantity(await this.rpcCall("eth_chainId", [])) !== BigInt(this.chainId)) {
            gaslessFailure("APN_CHAIN_MISMATCH", "gasless_chain_identity");
        }
        // Validate the original anchor before accepting even partial scan progress from another provider.
        await recheckBlock(this.rpcCall, intent.initialSnapshot.block);
        await verifyProtocolAt(this.rpcCall, this.deployment, intent.initialSnapshot.block);
        const result = await observeGasless({ chainId: this.chainId, rpcOrigin: this.rpcOrigin,
            deployment: this.deployment, rpc: this.rpcCall }, intent, identity, cursor);
        if (this.unavailable)
            throw observationUnavailable();
        await recheckBlock(this.rpcCall, intent.initialSnapshot.block);
        return { ...result, source: gaslessObservationSource(intent, this.environmentName, this) };
    }
    async call(method, params) {
        if (!READ_METHODS.has(method))
            gaslessFailure("APN_RPC_PROTOCOL", "gasless_observation_rpc_method");
        return await withinGaslessRpcInvocation(async () => await new Promise((resolve, reject) => {
            const session = gaslessRpcInvocation(), pending = this.pendingReads.get(session);
            const row = { id: (++this.sequence).toString(), method, params, resolve, reject };
            if (pending !== undefined) {
                pending.push(row);
                return;
            }
            this.pendingReads.set(session, [row]);
            queueMicrotask(() => { void this.flushReads(session); });
        }));
    }
    async flushReads(session) {
        const reads = this.pendingReads.get(session);
        if (reads === undefined)
            return;
        this.pendingReads.delete(session);
        try {
            const requests = reads.map(({ id, method, params }) => ({ jsonrpc: "2.0", id, method, params }));
            const response = await this.request(canonicalJson(requests.length === 1 ? requests[0] : requests), session);
            if (reads.length === 1) {
                reads[0].resolve(parseObservationResult(rpcRecord(rpcJson(response.body, MAX_RESPONSE)), reads[0].id));
                return;
            }
            const rows = rpcJson(response.body, MAX_RESPONSE);
            if (!Array.isArray(rows) || rows.length !== reads.length)
                gaslessFailure("APN_RPC_PROTOCOL", "gasless_observation_rpc_response");
            const expected = new Set(reads.map(row => row.id)), results = new Map();
            for (const value of rows) {
                const record = rpcRecord(value), id = record.id;
                if (typeof id !== "string" || !expected.has(id) || results.has(id)) {
                    gaslessFailure("APN_RPC_PROTOCOL", "gasless_observation_rpc_response");
                }
                results.set(id, parseObservationResult(record, id));
            }
            for (const read of reads)
                read.resolve(results.get(read.id));
        }
        catch (error) {
            for (const read of reads)
                read.reject(error);
        }
    }
    async request(body, session) {
        const pending = this.queue.then(async () => {
            if (this.unavailable)
                throw observationUnavailable();
            if (this.lastRequestAt !== null) {
                const remaining = this.pacing.minimumIntervalMs - (this.pacing.monotonicNow() - this.lastRequestAt);
                if (remaining > 0)
                    await this.pacing.sleep(remaining);
            }
            if (this.unavailable)
                throw observationUnavailable();
            try {
                session.reserve();
                this.lastRequestAt = this.pacing.monotonicNow();
                const response = await this.transport.request(this.endpoint, "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG", () => session.assertActive());
                if (response.status !== 200) {
                    try {
                        session.rejectHttp(response.status);
                    }
                    catch (error) {
                        if (response.status === 408 || response.status === 429 || response.status >= 500)
                            throw observationUnavailable();
                        throw error;
                    }
                }
                return response;
            }
            catch (error) {
                this.unavailable = true;
                if (error instanceof ApnError && error.details?.reason === "gasless_observation_rpc_unavailable")
                    throw error;
                if (error instanceof ApnError && error.code === "APN_RPC_PROTOCOL")
                    throw error;
                throw observationUnavailable();
            }
        });
        this.queue = pending.then(() => undefined, () => undefined);
        return await pending;
    }
}
function parseObservationResult(record, id) {
    const result = Object.hasOwn(record, "result"), error = Object.hasOwn(record, "error");
    if (record.jsonrpc !== "2.0" || record.id !== id || result === error ||
        !exactKeys(record, result ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"])) {
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_observation_rpc_response");
    }
    if (error)
        gaslessFailure("APN_RPC_PROTOCOL", "gasless_observation_rpc_error");
    return record.result;
}
function observationUnavailable() {
    return new ApnError("APN_RPC_AMBIGUOUS", "Explicit observation RPC is unavailable.", {
        reason: "gasless_observation_rpc_unavailable", retryable: true,
    });
}
//# sourceMappingURL=observation-rpc.js.map