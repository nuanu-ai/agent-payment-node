import { loadActiveAssetPolicyRegistry } from "../../allowlist-active-policy.js";
import type { AssetUsageLedger } from "../../asset-usage-ledger.js";
import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import type { ClockPort } from "../../ports.js";
import type { SolanaRpc } from "../../solana/rpc.js";
import type { StateStore } from "../../state.js";
import type { GuardedSwapService } from "../service.js";
import type { OrcaStableAdmissionPorts } from "./stable-admission.js";
import { executeOrcaStableFirstAttempt } from "./stable-effect-runtime.js";
import { OrcaStableExecutionBindingStore } from "./stable-execution-journal.js";
import { SavedOrcaStableMaterialStore } from "./stable-material.js";
import { ORCA_SOLANA_CHAIN, type OrcaProgramPinVerifier } from "./pins.js";

export interface OrcaStableCommandPorts {
  readonly state: StateStore;
  readonly clock: ClockPort;
  readonly accounts: Pick<ChainWalletStoragePort, "account" | "withSeed" | "saveEffect" | "effect" | "effectByOperationId">;
  readonly rpc: SolanaRpc;
  readonly verifyPins: OrcaProgramPinVerifier;
}

/** The owner's active policy, local Solana account and the ledger's daily usage, as the stable admission reads them. */
export function orcaStableAdmissionPorts(ports: OrcaStableCommandPorts, usage: AssetUsageLedger): OrcaStableAdmissionPorts {
  return { activePolicy: profile => loadActiveAssetPolicyRegistry({ state: ports.state, clock: ports.clock }, profile),
    localAccount: profile => ports.accounts.account(profile, "solana"),
    dailyUsage: async (owner, mint, now) => (await usage.usage({ account: owner, chain: ORCA_SOLANA_CHAIN,
      asset: { kind: "token", identifier: mint } }, now)).amountAtomic };
}

/**
 * The single execution after an owner consent: either the stable-approve screen (which authorizes it, SWAP-20) or the
 * separate stable-execute screen for a reservation left unexecuted. Fresh preflight, one signature, at most one send.
 */
export async function executeConsentedOrcaStable(ports: OrcaStableCommandPorts, service: GuardedSwapService, operationId: string) {
  return await executeOrcaStableFirstAttempt({ service, materials: new SavedOrcaStableMaterialStore(ports.state.root),
    bindings: new OrcaStableExecutionBindingStore(ports.state.root), admission: orcaStableAdmissionPorts(ports, service.usage),
    custody: ports.accounts, rpc: ports.rpc, operationId, clock: () => ports.clock.now(), verifyPins: ports.verifyPins });
}
