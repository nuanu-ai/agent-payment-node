import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { ApnError } from "../../errors.js";
import { bridgeRpcCall } from "../../lifi/rpc.js";
import { SwapOperationRepository } from "../repository.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime } from "../runtime.js";
import { GuardedSwapService } from "../service.js";
import { EncryptedUniswapExecutionEffectStore, LocalUniswapEthereumSigner, UniswapEthereumExecutionDriver, UniswapEthereumReceiptObserver, UniswapExecutionBindingStore, UniswapExecutionGuard, UniswapSingleSendAdapter } from "../uniswap-ethereum/execution/index.js";
import { UniswapLocalOwnerAdmission } from "./admission.js";
import { KeylessUniswapQuoteBuilder } from "./builder.js";
import { SavedUniswapQuoteStore } from "./material.js";
import { UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY } from "./pins.js";
import { TtyUniswapSwapApproval } from "./tty.js";
/** Only the foreground CLI approve command receives a terminal; every other surface refuses consent outright. */
export const REFUSING_SWAP_APPROVAL = {
    async approve() {
        throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Guarded swap approval must continue in the foreground CLI.", { reason: "swap_foreground_cli_required" });
    },
};
/** Resolves APN_ETHEREUM_RPC_URL on first use, so offline commands never need it and online ones fail closed without it. */
export function lazyEthereumRpcCall(environment) {
    let resolved;
    return async (method, params) => await (resolved ??= bridgeRpcCall(1, environment).call)(method, params);
}
export function createUniswapKeylessRuntime(options) {
    const { state, wrapping, clock, call } = options, root = state.root;
    const quotes = new SavedUniswapQuoteStore(root), operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root);
    const effects = new EncryptedUniswapExecutionEffectStore(state, wrapping), admission = new UniswapLocalOwnerAdmission(state, options.policy);
    const signer = new LocalUniswapEthereumSigner(state, wrapping, effects), sender = new UniswapSingleSendAdapter(effects, call);
    const observer = new UniswapEthereumReceiptObserver(call, () => clock.now());
    const execution = new UniswapEthereumExecutionDriver({ core: new GuardedSwapService(operations, usage),
        protocolRegistry: UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, admission, guard: new UniswapExecutionGuard(call, clock, options.verifyPins),
        bindings: new UniswapExecutionBindingStore(root), signer, sender, observer, effects, clock });
    const foregroundApproval = options.foreground === "tty" ? new TtyUniswapSwapApproval(quotes, clock, options.tty) : options.foreground;
    return new GuardedSwapRuntime({ chain: "eip155:1", builder: new KeylessUniswapQuoteBuilder(call, quotes, options.verifyPins),
        policy: options.policy, clock, protocolRegistry: UNISWAP_V3_KEYLESS_PROTOCOL_REGISTRY, usage, operations, ownerAdmission: admission,
        foregroundApproval, execution, approvals: new GuardedSwapApprovalRepository(root), rpc: { call }, effectStore: effects, signer, sender,
        observer, caps: { approvalCapAtomic: "0" } });
}
//# sourceMappingURL=runtime-factory.js.map