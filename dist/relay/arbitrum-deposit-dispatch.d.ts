import { type Hex } from "viem";
import { type ActiveAssetPolicy } from "../allowlist-active-policy.js";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { type RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import { ArbitrumSourceEffectJournalRepository, type ArbitrumSourceEffectJournal } from "./arbitrum-source-effect-journal.js";
import { RelayArbitrumDepositPreflightReader } from "./arbitrum-deposit-preflight.js";
export interface RelayArbitrumDepositSummary {
    readonly operationId: string;
    readonly sourceChainId: 42161;
    readonly destinationChainId: 1;
    readonly owner: string;
    readonly token: string;
    readonly spender: string;
    readonly depositAmountAtomic: string;
    readonly quoteDigest: string;
    readonly deadline: string;
    readonly depositNetworkFeeCeilingWei: string;
}
export interface RelayArbitrumDepositSigner {
    sign(op: RelayUnsignedOperation, nonce: string, journal: ArbitrumSourceEffectJournal): Promise<Hex>;
}
export interface RelayArbitrumDepositDispatchPorts {
    readonly confirm: (summary: RelayArbitrumDepositSummary) => Promise<boolean>;
    readonly signer: RelayArbitrumDepositSigner;
    readonly send: (raw: Hex) => Promise<Hex>;
    /** Caller holds the allowlist profile lock. Production uses the authenticated policy store. */
    readonly activePolicyUnderLock?: (at: Date) => Promise<ActiveAssetPolicy | null>;
    readonly dailyUsage?: (owner: string, at: Date) => Promise<string>;
    readonly now?: () => Date;
    /** Synthetic seams; production uses the verified durable repositories. */
    readonly operation?: (profileHash: string, operationId: string) => Promise<RelayUnsignedOperation | null>;
    readonly journals?: Pick<ArbitrumSourceEffectJournalRepository, "load" | "createUnderLocks" | "beginSigningUnderLocks" | "transitionUnderLocks">;
}
/** Unlocks local custody only after a durable signing marker exists. */
export declare class LocalRelayArbitrumDepositSigner implements RelayArbitrumDepositSigner {
    private readonly state;
    private readonly wallets;
    constructor(state: StateStore, wrapping: WrappingSecretPort);
    sign(op: RelayUnsignedOperation, nonce: string, journal: ArbitrumSourceEffectJournal): Promise<Hex>;
}
export declare class RelayArbitrumDepositDispatchService {
    private readonly state;
    private readonly reader;
    private readonly ports;
    private readonly journals;
    private readonly permissions;
    private readonly usage;
    constructor(state: StateStore, reader: Pick<RelayArbitrumDepositPreflightReader, "read">, ports: RelayArbitrumDepositDispatchPorts, wrapping: WrappingSecretPort);
    private now;
    private owner;
    private snapshot;
    private usageIdentity;
    private reservationId;
    private dailyUsageExcludingOwn;
    private reserve;
    private result;
    private lockedPolicy;
    execute(profile: string, operationId: string): Promise<{
        operationId: string;
        state: string;
        reason: string;
        approvalPhase: import("./arbitrum-source-effect-journal.js").ArbitrumEffectPhase | null;
        depositPhase: import("./arbitrum-source-effect-journal.js").ArbitrumEffectPhase | null;
        transactionHash: string | null;
        journalIntegrityHash: string | null;
        depositDispatched: boolean;
        destinationDeliveryProven: false;
        paidAcceptance: false;
    }>;
}
