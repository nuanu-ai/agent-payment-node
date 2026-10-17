import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { SwapOperationRepository } from "../repository.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime } from "../runtime.js";
import { GuardedSwapService } from "../service.js";
import { OrcaLocalOwnerAdmission } from "./admission.js";
import { KeylessOrcaQuoteBuilder } from "./builder.js";
import { OrcaExecutionBindingStore, OrcaLocalSigner, OrcaSingleSender } from "./effects.js";
import { OrcaExecutionGuard, OrcaSolanaExecutionDriver } from "./execution.js";
import { SavedOrcaQuoteStore } from "./material.js";
import { ORCA_SOLANA_CHAIN } from "./pins.js";
import { OrcaReceiptObserver } from "./receipt.js";
import { orcaApprovalScreen } from "./tty.js";
import { TtyGuardedSwapApproval } from "../tty-consent.js";
export function createOrcaKeylessRuntime(options) {
    const { state, clock, rpc, accounts, pool } = options, root = state.root, registry = pool.protocolRegistry;
    const quotes = new SavedOrcaQuoteStore(root), operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root);
    const admission = new OrcaLocalOwnerAdmission(accounts, options.policy), signer = new OrcaLocalSigner(accounts);
    const sender = new OrcaSingleSender(rpc), observer = new OrcaReceiptObserver(rpc, () => clock.now());
    const execution = new OrcaSolanaExecutionDriver({ core: new GuardedSwapService(operations, usage), protocolRegistry: registry,
        admission, guard: new OrcaExecutionGuard(rpc, clock, options.verifyPins), bindings: new OrcaExecutionBindingStore(root), signer, sender,
        observer, effects: accounts, clock });
    const foregroundApproval = options.foreground === "tty" ? new TtyGuardedSwapApproval("orca", intent => orcaApprovalScreen(quotes, intent), clock, options.tty) : options.foreground;
    return new GuardedSwapRuntime({ chain: ORCA_SOLANA_CHAIN, builder: new KeylessOrcaQuoteBuilder(rpc, quotes, options.verifyPins, pool),
        policy: options.policy, clock, protocolRegistry: registry, usage, operations, ownerAdmission: admission,
        foregroundApproval, execution, approvals: new GuardedSwapApprovalRepository(root), rpc, effectStore: accounts, signer, sender,
        observer, caps: { approvalCapAtomic: "0" } });
}
/** Builds each pool's runtime once per command: a pool selects exactly its own lane registry and builder. */
export function orcaRuntimeSelector(build) {
    const built = new Map();
    return (pool) => {
        const existing = built.get(pool.id);
        if (existing !== undefined)
            return existing;
        const runtime = build(pool);
        built.set(pool.id, runtime);
        return runtime;
    };
}
//# sourceMappingURL=runtime-factory.js.map