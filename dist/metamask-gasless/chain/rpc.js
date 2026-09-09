import { canonicalJson, exactKeys, sha256 } from "../../canonical.js";
import { parsePublicHttpsUrl } from "../../network-policy.js";
import { GaslessHttps } from "../../gasless/https.js";
import { mmAssertStableQuote, mmQuote } from "../economics.js";
import { mmRegistry, MM_RPC_ENV } from "../registry.js";
import { mmFail } from "../reasons.js";
import { mmValidateUnsigned } from "../unsigned.js";
import { mmAddress, mmChain, mmHex, mmUint } from "../validation.js";
import { observeMetaMaskGasless } from "./observe.js";
import { recheckBlock, rpcBlock, rpcQuantity, rpcRecord } from "./abi.js";
import { readMetaMaskChainState, validateMetaMaskGaslessSnapshot } from "./snapshot.js";
export { validateMetaMaskGaslessSnapshot } from "./snapshot.js";
const READ_METHODS = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode",
    "eth_getStorageAt", "eth_call", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getLogs"]);
const MAX_RESPONSE = 4 * 1024 * 1024;
/** Lazy environment binding. Merely creating the factory performs no DNS, RPC, provider, or state I/O. */
export function metaMaskGaslessRpcFactory(environment, clock, transport) {
    const cache = new Map();
    const selectedTransport = transport ?? new GaslessHttps();
    return (chainId) => {
        const selected = mmChain(chainId), existing = cache.get(selected);
        if (existing !== undefined)
            return existing;
        const name = MM_RPC_ENV[selected], rpcUrl = environment[name];
        if (rpcUrl === undefined || rpcUrl.length === 0)
            mmFail("mm_gasless_rpc_binding");
        const created = new MetaMaskGaslessRpc({ chainId: selected, rpcUrl, clock, transport: selectedTransport });
        cache.set(selected, created);
        return created;
    };
}
export class MetaMaskGaslessRpc {
    chainId;
    endpointOrigin;
    endpointHash;
    rpcUrl;
    deployment;
    clock;
    transport;
    sequence = 0n;
    callRpc;
    constructor(options) {
        this.chainId = mmChain(options.chainId);
        this.deployment = mmRegistry(this.chainId);
        const endpoint = rpcEndpoint(options.rpcUrl);
        this.rpcUrl = endpoint.toString();
        this.endpointOrigin = endpoint.origin;
        this.endpointHash = sha256(this.rpcUrl);
        this.clock = options.clock;
        this.transport = options.transport ?? new GaslessHttps();
        this.callRpc = async (method, params) => await this.call(method, params);
    }
    async balance(ownerInput) {
        const owner = strictOwner(ownerInput);
        await this.assertChain();
        const at = await rpcBlock(this.callRpc, this.deployment.row.finalityTag);
        const state = await readMetaMaskChainState(this.callRpc, this.deployment.row, owner, at.block, null);
        if ("counterAtomic" in state)
            mmFail("mm_gasless_internal");
        await recheckBlock(this.callRpc, at.block, "mm_gasless_evidence_invalid");
        return { chainId: this.chainId, endpointHash: this.endpointHash, endpointOrigin: this.endpointOrigin,
            observedAt: this.clock.now().toISOString(), block: at.block, state };
    }
    async snapshot(input) {
        const owner = strictOwner(input.owner), delegationHash = mmHex(input.delegationHash, 32, "mm_gasless_evidence_invalid");
        const grossAtomic = mmUint(input.grossAtomic, true, "mm_gasless_evidence_invalid").toString();
        await this.assertChain();
        const safe = await rpcBlock(this.callRpc, this.deployment.row.finalityTag);
        const head = await rpcBlock(this.callRpc, "latest");
        const [safeState, headState] = await Promise.all([
            readMetaMaskChainState(this.callRpc, this.deployment.row, owner, safe.block, delegationHash),
            readMetaMaskChainState(this.callRpc, this.deployment.row, owner, head.block, delegationHash),
        ]);
        if (!("counterAtomic" in safeState) || !("counterAtomic" in headState))
            mmFail("mm_gasless_internal");
        await recheckBlock(this.callRpc, safe.block, "mm_gasless_evidence_invalid");
        await recheckBlock(this.callRpc, head.block, "mm_gasless_evidence_invalid");
        const snapshot = { chainId: this.chainId, endpointHash: this.endpointHash,
            endpointOrigin: this.endpointOrigin, observedAt: this.clock.now().toISOString(),
            safeBlock: safe.block, headBlock: head.block, safeState, headState };
        return validateMetaMaskGaslessSnapshot(snapshot, { chainId: this.chainId, endpointHash: this.endpointHash,
            endpointOrigin: this.endpointOrigin, grossAtomic });
    }
    async observe(intent, cursor, provider) {
        this.assertIntent(intent);
        await this.assertChain();
        return await observeMetaMaskGasless({ deployment: this.deployment, call: this.callRpc, clock: this.clock }, intent, cursor, provider);
    }
    assertIntent(intent) {
        if (intent.request.chainId !== this.chainId || intent.initialSnapshot.chainId !== this.chainId ||
            intent.initialSnapshot.endpointHash !== this.endpointHash || intent.initialSnapshot.endpointOrigin !== this.endpointOrigin ||
            intent.token !== this.deployment.row.token || intent.deploymentEvidenceHash !== this.deployment.deploymentEvidenceHash ||
            intent.relayTo !== this.deployment.row.protocol.manager.address)
            mmFail("mm_gasless_rpc_binding");
        validateMetaMaskGaslessSnapshot(intent.initialSnapshot, { chainId: this.chainId,
            endpointHash: this.endpointHash, endpointOrigin: this.endpointOrigin, grossAtomic: intent.request.grossAtomic });
        mmQuote(intent.quote, intent.request, intent.binding, intent.quote.netAtomic, "mm_gasless_state_corrupt");
        mmAssertStableQuote(intent.request, intent.quote, "mm_gasless_state_corrupt");
        mmValidateUnsigned({ unsignedDelegation: intent.unsignedDelegation, delegationHash: intent.delegationHash,
            signingDigest: intent.signingDigest, relayTo: intent.relayTo, mode: intent.mode }, { owner: intent.binding.address, chainId: intent.request.chainId, executions: intent.quote.executions }, "mm_gasless_state_corrupt");
    }
    async assertChain() {
        if (rpcQuantity(await this.callRpc("eth_chainId", [])) !== BigInt(this.chainId))
            mmFail("mm_gasless_rpc_binding");
    }
    async call(method, params) {
        if (!READ_METHODS.has(method))
            mmFail("mm_gasless_evidence_invalid");
        const id = (++this.sequence).toString(), body = canonicalJson({ jsonrpc: "2.0", id, method, params });
        let response;
        try {
            response = await this.transport.request(this.rpcUrl, "POST", body, MAX_RESPONSE, "APN_RPC_CONFIG");
        }
        catch {
            return mmFail("mm_gasless_rpc_unavailable");
        }
        if (response.status !== 200 || Buffer.byteLength(response.body, "utf8") > MAX_RESPONSE) {
            mmFail("mm_gasless_rpc_unavailable");
        }
        let parsed;
        try {
            parsed = JSON.parse(response.body);
        }
        catch {
            return mmFail("mm_gasless_evidence_invalid");
        }
        const record = rpcRecord(parsed), hasResult = Object.hasOwn(record, "result"), hasError = Object.hasOwn(record, "error");
        const keys = hasResult ? ["jsonrpc", "id", "result"] : ["jsonrpc", "id", "error"];
        if (record.jsonrpc !== "2.0" || record.id !== id || hasResult === hasError || !exactKeys(record, keys)) {
            mmFail("mm_gasless_evidence_invalid");
        }
        if (hasError)
            mmFail("mm_gasless_rpc_unavailable");
        return record.result;
    }
}
function strictOwner(value) {
    const owner = mmAddress(value, "mm_gasless_evidence_invalid");
    if (owner !== value)
        mmFail("mm_gasless_evidence_invalid");
    return owner;
}
function rpcEndpoint(value) {
    try {
        return parsePublicHttpsUrl(value, "APN_RPC_CONFIG", "MetaMask gasless RPC endpoint", 2048);
    }
    catch {
        return mmFail("mm_gasless_rpc_binding");
    }
}
//# sourceMappingURL=rpc.js.map