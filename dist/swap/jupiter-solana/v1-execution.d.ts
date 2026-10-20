import type { ClockPort } from "../../ports.js";
import { SolanaRpc, type SolanaMethod, type SolanaBatchRead } from "../../solana/rpc.js";
import type { SwapOperationRecord } from "../model.js";
import type { GuardedSwapExecutionDriver, GuardedSwapExecutionInput, GuardedSwapObservationInput } from "../runtime.js";
import type { GuardedSwapService } from "../service.js";
import type { JupiterV1OwnerAdmission } from "./v1-admission.js";
import { type JupiterV1ExecutionBindingStore, JupiterV1LocalSigner } from "./v1-effects.js";
import { type SavedJupiterV1MaterialStore } from "./v1-material.js";
import { type JupiterV1SimulationProof } from "./v1-proof.js";
import type { JupiterV1ResolvedMaterial } from "./v1-material.js";
import { type SwapUnlandedProof } from "../unlanded.js";
/** The public sender reloads durable ownership and consumes its fsynced create-only claim under the operation lock. */
export declare class JupiterV1SingleSender {
    private readonly core;
    private readonly materials;
    private readonly bindings;
    private readonly native;
    private readonly rpc;
    private readonly clock;
    constructor(core: GuardedSwapService, materials: SavedJupiterV1MaterialStore, bindings: JupiterV1ExecutionBindingStore, native: JupiterV1LocalSigner, rpc: SolanaRpc, clock: ClockPort);
    sendOnce(operationId: string): Promise<SwapOperationRecord>;
}
/** Executable bytes, exact-message simulation and balance deltas proved before the owner's prompt, for the send after it. */
export interface JupiterV1PreconsentProof {
    readonly operationId: string;
    readonly materialDigest: string;
    readonly fresh: JupiterV1ResolvedMaterial;
    readonly simulation: JupiterV1SimulationProof;
}
/**
 * Every program-byte, account and simulation check that can fail runs before consent, against the exact message signed
 * after it. The approval freezes its own lifetime: the configured RPC's latest blockhash, read after this command's fresh
 * account reads, so the human gets a whole blockhash lifetime instead of what the quote and prepare commands left of the
 * quote's. Only those 32 bytes are new; every instruction, account, privilege, lookup table and program authority must
 * be the quoted one. After the prompt only the lifetime reserve, the local owner re-check, the marker, the signature and
 * the one send remain.
 */
export declare function proveJupiterV1Preconsent(rpc: SolanaRpc, clock: ClockPort, op: SwapOperationRecord, materialValue: unknown): Promise<JupiterV1PreconsentProof>;
export interface JupiterV1ExecutionDependencies {
    readonly core: GuardedSwapService;
    readonly materials: SavedJupiterV1MaterialStore;
    readonly bindings: JupiterV1ExecutionBindingStore;
    readonly admission: JupiterV1OwnerAdmission;
    readonly native: JupiterV1LocalSigner;
    readonly sender: JupiterV1SingleSender;
    readonly rpc: SolanaRpc;
    readonly clock: ClockPort;
    /** Filled by the foreground approval of this process before its prompt; consumed once by the first execution. */
    readonly preconsent: Map<string, JupiterV1PreconsentProof>;
}
export declare class JupiterV1ExecutionDriver implements GuardedSwapExecutionDriver {
    private readonly d;
    constructor(d: JupiterV1ExecutionDependencies);
    execute(input: GuardedSwapExecutionInput): Promise<SwapOperationRecord>;
    observe(input: GuardedSwapObservationInput): Promise<SwapOperationRecord>;
    proveUnlanded(input: GuardedSwapObservationInput): Promise<SwapUnlandedProof | null>;
}
/** Under the operation lock that marking, signing and the single send hold: the frozen lifetime passed at finality and
 * the persisted signature, if any, has no status. Nothing is decrypted, signed or sent. */
export declare function proveJupiterV1Unlanded(d: Pick<JupiterV1ExecutionDependencies, "core" | "bindings" | "rpc">, input: GuardedSwapObservationInput): Promise<SwapUnlandedProof | null>;
/**
 * The Jupiter rail transport: the configured Solana RPC with its per-command physical budget (solanaSwapCommandRequests)
 * and persistent provider pacing. No read budget is stored or carried across commands (SWAP-19), so retrying a command
 * after a rate limit never exhausts an operation. A height read uses a one-element batch: PublicNode returns another
 * shape for the scalar call.
 */
export declare class JupiterV1BudgetedRpc extends SolanaRpc {
    private readonly base;
    readonly originHash: string;
    readonly budget: SolanaRpc["budget"];
    constructor(base: SolanaRpc);
    get hasPersistentPacer(): boolean;
    call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown>;
    batch(reads: readonly SolanaBatchRead[]): Promise<readonly unknown[]>;
    sendTransactionAtStart(params: readonly unknown[], beforeStart: () => void | Promise<void>): Promise<unknown>;
}
