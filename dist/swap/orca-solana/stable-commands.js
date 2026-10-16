import { loadActiveAssetPolicyRegistry } from "../../allowlist-active-policy.js";
import { executeOrcaStableFirstAttempt } from "./stable-effect-runtime.js";
import { OrcaStableExecutionBindingStore } from "./stable-execution-journal.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
import { ORCA_SOLANA_CHAIN } from "./pins.js";
/** The owner's active policy, local Solana account and the ledger's daily usage, as the stable admission reads them. */
export function orcaStableAdmissionPorts(ports, usage) {
    return { activePolicy: profile => loadActiveAssetPolicyRegistry({ state: ports.state, clock: ports.clock }, profile),
        localAccount: profile => ports.accounts.account(profile, "solana"),
        dailyUsage: async (owner, mint, now) => (await usage.usage({ account: owner, chain: ORCA_SOLANA_CHAIN,
            asset: { kind: "token", identifier: mint } }, now)).amountAtomic };
}
/**
 * The single execution after an owner consent: either the stable-approve screen (which authorizes it, SWAP-20) or the
 * separate stable-execute screen for a reservation left unexecuted. Fresh preflight, one signature, at most one send.
 */
export async function executeConsentedOrcaStable(ports, service, operationId) {
    return await executeOrcaStableFirstAttempt({ service, materials: new SavedOrcaStableMaterialStore(ports.state.root),
        bindings: new OrcaStableExecutionBindingStore(ports.state.root), admission: orcaStableAdmissionPorts(ports, service.usage),
        custody: ports.accounts, rpc: ports.rpc, operationId, clock: () => ports.clock.now(), verifyPins: ports.verifyPins });
}
//# sourceMappingURL=stable-commands.js.map