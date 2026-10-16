import type { AssetUsageLedger } from "../../asset-usage-ledger.js";
import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import type { ClockPort } from "../../ports.js";
import type { SolanaRpc } from "../../solana/rpc.js";
import type { StateStore } from "../../state.js";
import type { GuardedSwapService } from "../service.js";
import type { OrcaStableAdmissionPorts } from "./stable-admission.js";
import { type OrcaProgramPinVerifier } from "./pins.js";
export interface OrcaStableCommandPorts {
    readonly state: StateStore;
    readonly clock: ClockPort;
    readonly accounts: Pick<ChainWalletStoragePort, "account" | "withSeed" | "saveEffect" | "effect" | "effectByOperationId">;
    readonly rpc: SolanaRpc;
    readonly verifyPins: OrcaProgramPinVerifier;
}
/** The owner's active policy, local Solana account and the ledger's daily usage, as the stable admission reads them. */
export declare function orcaStableAdmissionPorts(ports: OrcaStableCommandPorts, usage: AssetUsageLedger): OrcaStableAdmissionPorts;
/**
 * The single execution after an owner consent: either the stable-approve screen (which authorizes it, SWAP-20) or the
 * separate stable-execute screen for a reservation left unexecuted. Fresh preflight, one signature, at most one send.
 */
export declare function executeConsentedOrcaStable(ports: OrcaStableCommandPorts, service: GuardedSwapService, operationId: string): Promise<{
    operation: import("../model.js").SwapOperationRecord;
    binding: null;
    signature: null;
} | {
    operation: import("../model.js").SwapOperationRecord;
    binding: import("./stable-execution-journal.js").OrcaStableExecutionBinding;
    signature: string;
}>;
