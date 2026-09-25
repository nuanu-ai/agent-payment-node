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
import { UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY } from "./pins.js";
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
export function createUniswapKeylessRuntime(options) {
    const { state, wrapping, clock, call } = options, root = state.root;
    const executionCall = scalarUniswapRpcCall(call);
    const quotes = new SavedUniswapQuoteStore(root), operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root);
    const effects = new EncryptedUniswapExecutionEffectStore(state, wrapping), admission = new UniswapLocalOwnerAdmission(state, options.policy);
    const signer = new LocalUniswapEthereumSigner(state, wrapping, effects), sender = new UniswapSingleSendAdapter(effects, call);
    const observer = new UniswapEthereumReceiptObserver(call, () => clock.now(), new UniswapBalanceEvidenceStore(root));
    const execution = new UniswapEthereumExecutionDriver({ core: new GuardedSwapService(operations, usage),
        protocolRegistry: UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, admission, guard: new UniswapExecutionGuard(executionCall, clock, options.verifyPins),
        bindings: new UniswapExecutionBindingStore(root), signer, sender, observer, effects, clock });
    const foregroundApproval = options.foreground === "tty" ? new TtyUniswapSwapApproval(quotes, clock, options.tty) : options.foreground;
    return new GuardedSwapRuntime({ chain: "eip155:1", builder: new KeylessUniswapQuoteBuilder(call, quotes, options.verifyPins),
        policy: options.policy, clock, protocolRegistry: UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, usage, operations, ownerAdmission: admission,
        foregroundApproval, execution, approvals: new GuardedSwapApprovalRepository(root), rpc: { call }, effectStore: effects, signer, sender,
        observer, caps: { approvalCapAtomic: "0" } });
}
//# sourceMappingURL=runtime-factory.js.map