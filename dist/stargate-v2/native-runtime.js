import { decodeEventLog, encodeEventTopics, getAddress, keccak256 } from "viem";
import { canonicalJson } from "../canonical.js";
import { ApnError } from "../errors.js";
import { parsePublicHttpsUrl } from "../network-policy.js";
import { BridgeHttps } from "../lifi/https.js";
import { STARGATE_SEND_ABI } from "./abi.js";
import { executeStargateV2NativeEth, FileStargateNativeJournal, LocalStargateNativeSigner, prepareStargateV2NativeEth, stargateV2NativeCanonicalReceipt } from "./native-execution.js";
import { TtyStargateNativeApproval } from "./native-tty.js";
const SOURCE_POOL = getAddress("0x77b2043768d28E9C9aB44E1aBfC95944bcE57931");
const DESTINATION_POOL = getAddress("0xe9aBA835f813ca05E50A6C0ce65D0D74390F7dE7");
function blocked(reason) { throw new ApnError("APN_RPC_CONFIG", `Stargate native runtime unavailable: ${reason}.`, { reason }); }
function quantity(value) {
    if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value))
        throw new ApnError("APN_RPC_PROTOCOL", "Malformed Stargate RPC quantity.");
    return BigInt(value);
}
function hash(value) {
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value))
        throw new ApnError("APN_RPC_PROTOCOL", "Malformed Stargate RPC hash.");
    return value.toLowerCase();
}
function record(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new ApnError("APN_RPC_PROTOCOL", "Malformed Stargate RPC object.");
    return value;
}
export class StargateJsonRpc {
    https;
    sequence = 0;
    origin;
    endpoint;
    constructor(url, https = new BridgeHttps()) {
        this.https = https;
        const parsed = parsePublicHttpsUrl(url, "APN_RPC_CONFIG", "Stargate RPC endpoint", 2048);
        if (parsed.search !== "" || parsed.hash !== "")
            blocked("rpc_url");
        this.endpoint = parsed.toString();
        this.origin = parsed.origin;
    }
    async call(method, params) {
        if (!["eth_chainId", "eth_getBlockByNumber", "eth_getBalance", "eth_getTransactionCount", "eth_getCode", "eth_call",
            "eth_estimateGas", "eth_maxPriorityFeePerGas", "eth_sendRawTransaction", "eth_getTransactionReceipt", "eth_getLogs"].includes(method))
            blocked("rpc_method");
        const id = String(++this.sequence), response = await this.https.request(this.endpoint, "POST", canonicalJson({ jsonrpc: "2.0", id, method, params }), 2 * 1024 * 1024, "APN_RPC_CONFIG");
        if (response.status !== 200)
            blocked("rpc_status");
        const body = record(JSON.parse(response.body));
        if (body.jsonrpc !== "2.0" || String(body.id) !== id || !Object.hasOwn(body, "result") || Object.hasOwn(body, "error"))
            blocked("rpc_result");
        return body.result;
    }
}
export class StargateNativeService {
    state;
    now;
    source;
    destination;
    journal;
    local;
    constructor(state, wrapping, environment, now = Date.now) {
        this.state = state;
        this.now = now;
        const source = environment.APN_ETHEREUM_RPC_URL, destination = environment.APN_UNICHAIN_RPC_URL;
        if (source === undefined || destination === undefined)
            blocked("APN_ETHEREUM_RPC_URL_and_APN_UNICHAIN_RPC_URL_required");
        this.source = new StargateJsonRpc(source);
        this.destination = new StargateJsonRpc(destination);
        this.journal = new FileStargateNativeJournal(state.root);
        this.local = new LocalStargateNativeSigner(state, wrapping);
    }
    async prepare(input) {
        await this.state.initialize();
        const identity = await this.local.identity(input.profile), ports = await this.ports(identity.profile, identity.address);
        return await prepareStargateV2NativeEth({ ...input, owner: identity.address, recipient: identity.address }, ports, this.journal);
    }
    async execute(operationId) {
        const operation = await this.required(operationId);
        return await executeStargateV2NativeEth(operationId, await this.ports(operation.profile, operation.owner), this.journal);
    }
    async status(operationId) {
        const operation = await this.required(operationId);
        return ["submission_started", "submitted", "unknown_finality"].includes(operation.phase)
            ? await executeStargateV2NativeEth(operationId, await this.ports(operation.profile, operation.owner), this.journal)
            : operation;
    }
    async receipt(operationId) { return stargateV2NativeCanonicalReceipt(await this.required(operationId)); }
    async required(id) {
        const found = await this.journal.load(id);
        if (found === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Stargate native operation was not found.");
        return found;
    }
    async ports(profile, owner) {
        const signer = await this.local.port(profile, owner), source = this.source, destination = this.destination;
        return {
            sourceCall: (method, params) => source.call(method, params), destinationCall: (method, params) => destination.call(method, params),
            destinationBalance: async (recipient) => {
                const block = record(await destination.call("eth_getBlockByNumber", ["safe", false]));
                return { balanceAtomic: quantity(await destination.call("eth_getBalance", [recipient, block.number])).toString(),
                    blockNumberAtomic: quantity(block.number).toString(), blockHash: hash(block.hash) };
            },
            prepareEnvelope: async (tx) => {
                if (quantity(await source.call("eth_chainId", [])) !== 1n)
                    throw new ApnError("APN_CHAIN_MISMATCH", "Ethereum RPC identity changed.");
                const block = record(await source.call("eth_getBlockByNumber", ["latest", false]));
                const rpcTx = { from: tx.from, to: tx.to, data: tx.data, value: `0x${BigInt(tx.valueAtomic).toString(16)}` };
                const [nonce, balance, gas, tip] = await Promise.all([source.call("eth_getTransactionCount", [tx.from, "pending"]),
                    source.call("eth_getBalance", [tx.from, "pending"]), source.call("eth_estimateGas", [rpcTx]), source.call("eth_maxPriorityFeePerGas", [])]);
                const gasLimit = quantity(gas) * 12n / 10n + 1n, priority = quantity(tip), maxFee = 2n * quantity(block.baseFeePerGas) + priority;
                return { nonceAtomic: quantity(nonce).toString(), gasLimitAtomic: gasLimit.toString(), maxFeePerGasAtomic: maxFee.toString(),
                    maxPriorityFeePerGasAtomic: priority.toString(), nativeBalanceAtomic: quantity(balance).toString() };
            }, signer, signerIdentity: async () => await this.local.identity(profile, owner), approve: async (operation) => await new TtyStargateNativeApproval().approve(operation),
            sendRawTransaction: async (raw) => { const returned = hash(await source.call("eth_sendRawTransaction", [raw])); if (returned !== keccak256(raw))
                throw new Error("hash"); return returned; },
            waitSourceReceipt: async (transactionHash) => await confirmedReceipt(source, transactionHash),
            observeDestination: async (input) => await observeDestination(destination, input), now: this.now,
        };
    }
}
async function confirmedReceipt(rpc, transactionHash) {
    const raw = await rpc.call("eth_getTransactionReceipt", [transactionHash]);
    if (raw === null)
        return null;
    const receipt = record(raw), safe = record(await rpc.call("eth_getBlockByNumber", ["safe", false]));
    if (quantity(receipt.blockNumber) > quantity(safe.number))
        return null;
    const logs = Array.isArray(receipt.logs) ? receipt.logs.map(value => {
        const log = record(value);
        return { address: getAddress(String(log.address)),
            topics: log.topics.map(hash), data: String(log.data) };
    }) : blocked("receipt_logs");
    return { transactionHash: hash(receipt.transactionHash), status: quantity(receipt.status) === 1n ? "success" : "reverted",
        blockNumberAtomic: quantity(receipt.blockNumber).toString(), blockHash: hash(receipt.blockHash), finality: "safe", logs };
}
async function observeDestination(rpc, input) {
    const safe = record(await rpc.call("eth_getBlockByNumber", ["safe", false])), topic = encodeEventTopics({ abi: STARGATE_SEND_ABI,
        eventName: "OFTReceived", args: { guid: input.guid, toAddress: input.recipient } });
    const raw = await rpc.call("eth_getLogs", [{ address: DESTINATION_POOL,
            fromBlock: `0x${BigInt(input.fromBlockNumberAtomic).toString(16)}`, toBlock: safe.number, topics: topic }]);
    if (!Array.isArray(raw))
        blocked("destination_logs");
    for (const value of raw) {
        const log = record(value);
        try {
            const event = decodeEventLog({ abi: STARGATE_SEND_ABI, eventName: "OFTReceived", topics: log.topics, data: String(log.data) });
            if (event.args.srcEid === input.sourceEid && event.args.guid === input.guid && getAddress(event.args.toAddress) === input.recipient &&
                event.args.amountReceivedLD.toString() === input.minimumAmountAtomic)
                return { mode: "oft_received", emitter: DESTINATION_POOL,
                    sourceTransactionHash: input.sourceTransactionHash, guid: input.guid, sourceEid: 30101, recipient: input.recipient,
                    destinationTransactionHash: hash(log.transactionHash), logIndexAtomic: quantity(log.logIndex).toString(),
                    amountReceivedAtomic: event.args.amountReceivedLD.toString(), blockNumberAtomic: quantity(log.blockNumber).toString(),
                    blockHash: hash(log.blockHash), finality: "safe" };
        }
        catch { /* skip unrelated/malformed candidates */ }
    }
    const after = quantity(await rpc.call("eth_getBalance", [input.recipient, safe.number]));
    const before = BigInt(input.balanceBeforeAtomic);
    return after >= before ? { mode: "balance_delta", recipient: input.recipient, balanceBeforeAtomic: before.toString(),
        balanceAfterAtomic: after.toString(), deltaAtomic: (after - before).toString(), blockNumberAtomic: quantity(safe.number).toString(),
        blockHash: hash(safe.hash), finality: "safe" } : null;
}
//# sourceMappingURL=native-runtime.js.map