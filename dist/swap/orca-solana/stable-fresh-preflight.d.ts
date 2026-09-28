import { SolanaRpc, type SolanaRpcPort } from "../../solana/rpc.js";
import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import { type SwapOperationRecord } from "../model.js";
import { type OrcaStableAdmissionPorts } from "./stable-admission.js";
import { type OrcaStableMaterial } from "./stable-material.js";
import { type OrcaProgramPinVerifier } from "./pins.js";
import type { OrcaStableExecutionPreflight } from "./stable-execution-journal.js";
/**
 * Internal production port only. The same budget must be retained by any later send, leaving one physical POST.
 * This function has no signer, sender, public command or operation transition.
 */
export declare function freshOrcaStableExecutionPreflight(rpc: SolanaRpc, admission: OrcaStableAdmissionPorts, usage: AssetUsageLedger, operation: SwapOperationRecord, material: OrcaStableMaterial, clock?: () => Date): Promise<OrcaStableExecutionPreflight>;
/** Injectable, no-effect core for deterministic fake RPC and policy tests. */
export declare function freshOrcaStableExecutionPreflightCore(rpc: SolanaRpcPort, admission: OrcaStableAdmissionPorts, usage: AssetUsageLedger, operationValue: SwapOperationRecord, materialValue: OrcaStableMaterial, verifyPins: OrcaProgramPinVerifier, clock: () => Date): Promise<OrcaStableExecutionPreflight>;
