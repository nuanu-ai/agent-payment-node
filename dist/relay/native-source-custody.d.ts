/** Encrypted signed bytes of one Relay native deposit, kept in the operation's own profile envelope. */
import { type Hex } from "viem";
import { type EncryptedWalletStore } from "../encrypted-wallet-store.js";
import type { RelayUnsignedOperation } from "../relay-unsigned-operation.js";
import type { StateStore } from "../state.js";
import type { RelayNativeSourceJournal, RelayNativeSourceJournalRepository } from "./native-source-journal.js";
export type RelayNativeWallets = Pick<EncryptedWalletStore, "describe" | "save" | "clear">;
export type SignedNativeDeposit = {
    readonly raw: Hex;
    readonly hash: Hex;
};
/** The signed bytes must be the exact frozen deposit envelope, signed by the operation's own source account. */
export declare function verifySignedNativeDeposit(op: RelayUnsignedOperation, raw: Hex, expectedNonce?: bigint): Promise<Hex>;
/** One profile's custody slot for native deposits. `held` is true when the caller already holds its wallet mutation lock. */
export declare class RelayNativeDepositCustody {
    private readonly state;
    private readonly wallets;
    private readonly profile;
    private readonly held;
    constructor(state: StateStore, wallets: RelayNativeWallets, profile: string, held: (op: RelayUnsignedOperation) => boolean);
    private locked;
    /** Read the sealed bytes, or seal `signed` once. A damaged slot is corrupt, never empty. */
    slot(op: RelayUnsignedOperation, signed?: SignedNativeDeposit): Promise<SignedNativeDeposit | null>;
    /** Only after the journal records the sealed bytes as never landing. */
    discard(op: RelayUnsignedOperation): Promise<void>;
    /** The only closure without a chain result: journal has no hash or send marker,
     * and encrypted custody is proven empty under its mutation lock. */
    closeUnsignedAttempt(op: RelayUnsignedOperation, j: RelayNativeSourceJournal, journals: RelayNativeSourceJournalRepository, now: Date): Promise<RelayNativeSourceJournal>;
}
