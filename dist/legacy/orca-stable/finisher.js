import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { SwapOperationRepository } from "../../swap/repository.js";
import { GuardedSwapService } from "../../swap/service.js";
import { OrcaStableExecutionBindingStore } from "./execution-binding.js";
import { SavedOrcaStableMaterialStore } from "./material.js";
import { OrcaStableNoSendProofStore } from "./no-send-proof.js";
import { recoverOrcaStableNoSend } from "./no-send-recovery.js";
import { OrcaStableFinalizedObserver } from "./observer.js";
import { confirmOrcaStableNoSendRecovery } from "./recovery-consent.js";
import { releaseOrcaStableNoEffect } from "./release.js";
import { orcaStablePreparedStatus } from "./status.js";
export function orcaStableLegacyFinisher(ports) {
    const { root, clock } = ports, service = () => new GuardedSwapService(new SwapOperationRepository(root), new AssetUsageLedger(root));
    return {
        status: async (operationId) => await orcaStablePreparedStatus(new SwapOperationRepository(root), new SavedOrcaStableMaterialStore(root), operationId, clock.now()),
        release: async (operationId) => await releaseOrcaStableNoEffect(service(), new SavedOrcaStableMaterialStore(root), operationId, clock.now()),
        recoverNoSend: async (operationId) => {
            const swaps = service();
            await confirmOrcaStableNoSendRecovery(swaps, operationId, ports.consent, () => clock.now());
            return await recoverOrcaStableNoSend(swaps, new SavedOrcaStableMaterialStore(root), new OrcaStableExecutionBindingStore(root), new OrcaStableNoSendProofStore(root), ports.accounts, (profile) => ports.accounts.account(profile, "solana"), operationId, clock.now());
        },
        observe: async (operationId) => await new OrcaStableFinalizedObserver(service(), new SavedOrcaStableMaterialStore(root), new OrcaStableExecutionBindingStore(root), ports.accounts, ports.rpc, () => clock.now()).observe(operationId),
    };
}
//# sourceMappingURL=finisher.js.map