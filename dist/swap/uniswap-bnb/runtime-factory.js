import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { bridgeRpcCall } from "../../lifi/rpc.js";
import { SwapOperationRepository } from "../repository.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime } from "../runtime.js";
import { GuardedSwapService } from "../service.js";
import { TtyGuardedSwapApproval } from "../tty-consent.js";
import { EncryptedUniswapExecutionEffectStore, LocalUniswapEthereumSigner, UniswapBalanceEvidenceStore, UniswapEthereumExecutionDriver, UniswapExecutionBindingStore, UniswapExecutionGuard, UniswapSingleSendAdapter } from "../uniswap-ethereum/execution/index.js";
import { UniswapNativeReceiptObserver } from "../uniswap-ethereum/execution/observer.js";
import { UniswapLocalOwnerAdmission } from "../uniswap-v3/admission.js";
import { UniswapNativeQuoteBuilder } from "../uniswap-v3/builder.js";
import { SavedUniswapQuoteStore } from "../uniswap-v3/material.js";
import { uniswapApprovalScreen } from "../uniswap-v3/tty.js";
import { BNB_UNISWAP_NATIVE_LANE } from "./lane.js";
import { BNB_CHAIN, BNB_UNISWAP_PROTOCOL_REGISTRY } from "./pins.js";
/** The BNB Smart Chain quote builder: native BNB through SwapRouter02 into Binance-Peg USDT or USDC. */
export class BnbUniswapQuoteBuilder extends UniswapNativeQuoteBuilder {
    constructor(call, quotes, verifyPins) {
        super(BNB_UNISWAP_NATIVE_LANE, call, quotes, verifyPins);
    }
}
/** The BNB Smart Chain observer, over APN_BNB_RPC_URL (and APN_BNB_ARCHIVE_RPC_URL for block-pinned reads, when set). */
export class UniswapBnbReceiptObserver extends UniswapNativeReceiptObserver {
    constructor(call, now, evidence) {
        super(BNB_UNISWAP_NATIVE_LANE, call, now, evidence);
    }
}
/** Resolves APN_BNB_RPC_URL on first use, so offline commands never need it and online ones fail closed without it. */
export function lazyBnbRpcCall(environment, transport) {
    let descriptor;
    const resolve = () => descriptor ??= bridgeRpcCall(56, environment, transport === undefined ? {} : { transport });
    return async (method, params) => await resolve().call(method, params);
}
/**
 * The guarded swap runtime of the BNB lane: the same owner admission, foreground consent, single send and observe-only
 * status as the Ethereum keyless lane, with BNB's builder, observer, protocol registry and code-pin verifiers.
 */
export function createUniswapBnbRuntime(options) {
    const { state, wrapping, clock, call } = options, root = state.root, protocolRegistry = BNB_UNISWAP_PROTOCOL_REGISTRY;
    const quotes = new SavedUniswapQuoteStore(root), operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root);
    const effects = new EncryptedUniswapExecutionEffectStore(state, wrapping), admission = new UniswapLocalOwnerAdmission(state, options.policy);
    const signer = new LocalUniswapEthereumSigner(state, wrapping, effects), sender = new UniswapSingleSendAdapter(effects, call);
    const observer = new UniswapBnbReceiptObserver(call, () => clock.now(), new UniswapBalanceEvidenceStore(root));
    const execution = new UniswapEthereumExecutionDriver({ core: new GuardedSwapService(operations, usage),
        protocolRegistry, admission, guard: new UniswapExecutionGuard(call, clock, options.verifySendPins),
        bindings: new UniswapExecutionBindingStore(root), signer, sender, observer, effects, clock });
    const foregroundApproval = options.foreground === "tty"
        ? new TtyGuardedSwapApproval("uniswap", intent => uniswapApprovalScreen(quotes, intent), clock, options.tty) : options.foreground;
    return new GuardedSwapRuntime({ chain: BNB_CHAIN, builder: new BnbUniswapQuoteBuilder(call, quotes, options.verifyPins),
        policy: options.policy, clock, protocolRegistry, usage, operations, ownerAdmission: admission,
        foregroundApproval, execution, approvals: new GuardedSwapApprovalRepository(root), rpc: { call }, effectStore: effects, signer, sender,
        observer, caps: { approvalCapAtomic: "0" } });
}
//# sourceMappingURL=runtime-factory.js.map