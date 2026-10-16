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
 * Every program-byte, account and simulation check that can fail runs before consent, against the same frozen message.
 * After the prompt only the lifetime reserve, the local owner re-check, the marker, the signature and the one send remain,
 * so the frozen blockhash is not spent on bulky public reads after the human typed the code.
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
/** Owns the actual bounded Solana rail transport; no new URL, fallback or financial callback is accepted. */
export declare class JupiterV1BudgetedRpc extends SolanaRpc {
    private readonly base;
    private readonly stage;
    readonly originHash: string;
    readonly budget: SolanaRpc["budget"];
    private readonly journal;
    private readonly stageKey;
    private calls;
    private priorQuoteCalls;
    constructor(base: SolanaRpc, root: string, stage: "quote" | "prepare" | "execute" | "observe", operationId?: string);
    get hasPersistentPacer(): boolean;
    get maximumAccountsPerRead(): 16 | 8;
    bindOperation(quoteHash: string): Promise<void>;
    bindQuote(quoteHash: string): Promise<void>;
    chargeOfficialRead(): Promise<void>;
    private charge;
    call(method: SolanaMethod, params: readonly unknown[]): Promise<unknown>;
    batch(reads: readonly SolanaBatchRead[]): Promise<readonly unknown[]>;
    sendTransactionAtStart(params: readonly unknown[], beforeStart: () => void | Promise<void>): Promise<unknown>;
}
