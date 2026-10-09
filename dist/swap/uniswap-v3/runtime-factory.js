import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { ApnError } from "../../errors.js";
import { bridgeRpcCall } from "../../lifi/rpc.js";
import { RpcReadSession } from "../../lifi/rpc.js";
import { SwapOperationRepository } from "../repository.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime } from "../runtime.js";
import { GuardedSwapService } from "../service.js";
import { EncryptedUniswapExecutionEffectStore, LocalUniswapEthereumSigner, UniswapBalanceEvidenceStore, UniswapEthereumExecutionDriver, UniswapEthereumReceiptObserver, UniswapExecutionBindingStore, UniswapExecutionGuard, UniswapSingleSendAdapter } from "../uniswap-ethereum/execution/index.js";
import { UniswapLocalOwnerAdmission } from "./admission.js";
import { KeylessUniswapQuoteBuilder } from "./builder.js";
import { SavedUniswapQuoteStore } from "./material.js";
import { scalarUniswapRpcCall } from "./native-rpc.js";
import { ETHEREUM_WBTC, UNISWAP_WBTC_PROTOCOL_REGISTRY, UNISWAP_WBTC_MECHANISM_PIN, verifyUniswapWbtcCodePins, UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY } from "./pins.js";
import { swapMechanismDigest } from "../pin.js";
import { TtyUniswapSwapApproval } from "./tty.js";
/** Only the foreground CLI approve command receives a terminal; every other surface refuses consent outright. */
export const REFUSING_SWAP_APPROVAL = {
    async approve() {
        throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Guarded swap approval must continue in the foreground CLI.", { reason: "swap_foreground_cli_required" });
    },
};
/** Resolves APN_ETHEREUM_RPC_URL on first use, so offline commands never need it and online ones fail closed without it. */
export function lazyEthereumRpcCall(environment, transport) {
    let descriptor;
    const resolve = () => descriptor ??= bridgeRpcCall(1, environment, transport === undefined ? {} : { transport });
    const call = (async (method, params) => await resolve().call(method, params));
    if (environment.APN_UNISWAP_NATIVE_BATCH_READS === "1") {
        let batch;
        Object.defineProperty(call, "beginQuote", { value: () => { batch = undefined; } });
        Object.defineProperty(call, "batch", { value: async (items) => {
                batch ??= resolve().sessionBatchCall(new RpcReadSession({ maxLogicalItems: 30,
                    maxHttpRequests: 10, maxHttpAttempts: 10, maxReadAttempts: 1, deadlineMs: 30_000 }));
                return await batch(items.map((item) => ({ ...item, cachePolicy: "none", decoder: (value) => value })));
            } });
    }
    return call;
}
function createRouteRuntime(options, wbtc = false) {
    const protocolRegistry = wbtc ? UNISWAP_WBTC_PROTOCOL_REGISTRY : UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY;
    const { state, wrapping, clock, call } = options, root = state.root;
    const executionCall = scalarUniswapRpcCall(call);
    const quotes = new SavedUniswapQuoteStore(root), operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root);
    const effects = new EncryptedUniswapExecutionEffectStore(state, wrapping), admission = new UniswapLocalOwnerAdmission(state, options.policy);
    const signer = new LocalUniswapEthereumSigner(state, wrapping, effects), sender = new UniswapSingleSendAdapter(effects, call);
    const observer = new UniswapEthereumReceiptObserver(call, () => clock.now(), new UniswapBalanceEvidenceStore(root));
    const execution = new UniswapEthereumExecutionDriver({ core: new GuardedSwapService(operations, usage),
        protocolRegistry, admission, guard: new UniswapExecutionGuard(executionCall, clock, options.verifyPins),
        bindings: new UniswapExecutionBindingStore(root), signer, sender, observer, effects, clock });
    const foregroundApproval = options.foreground === "tty" ? new TtyUniswapSwapApproval(quotes, clock, options.tty) : options.foreground;
    return new GuardedSwapRuntime({ chain: "eip155:1", builder: new KeylessUniswapQuoteBuilder(call, quotes, options.verifyPins),
        policy: options.policy, clock, protocolRegistry, usage, operations, ownerAdmission: admission,
        foregroundApproval, execution, approvals: new GuardedSwapApprovalRepository(root), rpc: { call }, effectStore: effects, signer, sender,
        observer, caps: { approvalCapAtomic: "0" } });
}
/** Route old operations through their original immutable registry; WBTC has its own digest and lifecycle. */
export function createUniswapKeylessRuntime(options) {
    const stable = createRouteRuntime(options), wbtc = createRouteRuntime({ ...options, verifyPins: verifyUniswapWbtcCodePins }, true);
    const quotes = new SavedUniswapQuoteStore(options.state.root), operations = new SwapOperationRepository(options.state.root);
    const digest = swapMechanismDigest(UNISWAP_WBTC_MECHANISM_PIN);
    return new Proxy(stable, { get(target, property) {
            if (property === "quote")
                return (request, now) => (request.outputToken === ETHEREUM_WBTC ? wbtc : stable).quote(request, now);
            if (property === "prepare")
                return async (request, now) => {
                    const quote = await quotes.load(request.quoteHash);
                    return (quote?.quote.destinationAsset.identifier === ETHEREUM_WBTC ? wbtc : stable).prepare(request, now);
                };
            if (["status", "approve", "approveAndExecute", "execute"].includes(String(property)))
                return async (id, now) => {
                    const op = await operations.loadAny(id), runtime = op?.mechanismDigest === digest ? wbtc : stable;
                    const method = property;
                    return runtime[method](id, now);
                };
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
        } });
}
//# sourceMappingURL=runtime-factory.js.map