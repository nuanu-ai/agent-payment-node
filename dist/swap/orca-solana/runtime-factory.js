import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { SwapOperationRepository } from "../repository.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime } from "../runtime.js";
import { GuardedSwapService } from "../service.js";
import { OrcaLocalOwnerAdmission } from "./admission.js";
import { KeylessOrcaQuoteBuilder } from "./builder.js";
import { OrcaExecutionBindingStore, OrcaLocalSigner, OrcaSingleSender } from "./effects.js";
import { OrcaExecutionGuard, OrcaSolanaExecutionDriver } from "./execution.js";
import { SavedOrcaQuoteStore } from "./material.js";
import { ORCA_KEYLESS_PROTOCOL_REGISTRY, ORCA_SOLANA_CHAIN } from "./pins.js";
import { OrcaReceiptObserver } from "./receipt.js";
import { TtyOrcaSwapApproval } from "./tty.js";
export function createOrcaKeylessRuntime(options) {
    const { state, clock, rpc, accounts } = options, root = state.root;
    const quotes = new SavedOrcaQuoteStore(root), operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root);
    const admission = new OrcaLocalOwnerAdmission(accounts, options.policy), signer = new OrcaLocalSigner(accounts);
    const sender = new OrcaSingleSender(rpc), observer = new OrcaReceiptObserver(rpc, () => clock.now());
    const execution = new OrcaSolanaExecutionDriver({ core: new GuardedSwapService(operations, usage), protocolRegistry: ORCA_KEYLESS_PROTOCOL_REGISTRY,
        admission, guard: new OrcaExecutionGuard(rpc, clock, options.verifyPins), bindings: new OrcaExecutionBindingStore(root), signer, sender,
        observer, effects: accounts, clock });
    const foregroundApproval = options.foreground === "tty" ? new TtyOrcaSwapApproval(quotes, clock, options.tty) : options.foreground;
    return new GuardedSwapRuntime({ chain: ORCA_SOLANA_CHAIN, builder: new KeylessOrcaQuoteBuilder(rpc, quotes, options.verifyPins),
        policy: options.policy, clock, protocolRegistry: ORCA_KEYLESS_PROTOCOL_REGISTRY, usage, operations, ownerAdmission: admission,
        foregroundApproval, execution, approvals: new GuardedSwapApprovalRepository(root), rpc, effectStore: accounts, signer, sender,
        observer, caps: { approvalCapAtomic: "0" } });
}
//# sourceMappingURL=runtime-factory.js.map