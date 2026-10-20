import type { WrappingSecretPort } from "../macos-keychain.js";
import type { Address } from "../model.js";
import { StateStore } from "../state.js";
import { type WalletAllowanceRpc } from "./chain.js";
import { type WalletAllowanceRevokeRecord } from "./model.js";
import { WalletAllowanceRevokeRepository } from "./repository.js";
export interface WalletAllowanceRevokeRequest {
    readonly profile: string;
    readonly chainId: number;
    readonly token: Address;
    readonly spender: Address;
    readonly maxGasLimit: string;
    readonly maxFeePerGasWei: string;
    readonly maxPriorityFeePerGasWei: string;
}
export interface WalletAllowanceRevokePorts {
    readonly rpc: WalletAllowanceRpc;
    /** The chain's own `APN_<CHAIN>_RPC_URL` setting the endpoint came from (frozen in the record). */
    readonly rpcSetting: string;
    readonly wrapping: WrappingSecretPort;
    /** The owner's foreground decision on the exact frozen revoke; throws when refused. */
    readonly consent: (record: WalletAllowanceRevokeRecord) => Promise<void>;
    readonly now: () => Date;
}
/**
 * `wallet allowance revoke`: one owner-approved `approve(spender, 0)` from the profile's local wallet, sent once and
 * observed to its proof. Revoking only removes a permission, so no asset admission applies; the profile, chain, token and
 * spender name one slot, and a repeat of the command continues that slot's open revoke instead of starting another.
 */
export declare class WalletAllowanceRevokeService {
    private readonly ports;
    readonly records: WalletAllowanceRevokeRepository;
    private readonly state;
    constructor(root: string, ports: WalletAllowanceRevokePorts);
    private now;
    private write;
    /** The slot's open revoke, or a new frozen one after the allowance read (refused when it is already zero); nothing is signed. */
    prepare(request: WalletAllowanceRevokeRequest): Promise<WalletAllowanceRevokeRecord>;
    /** Consent, seal, mark and send once; a repeat continues where the record stands and never sends twice. */
    execute(start: WalletAllowanceRevokeRecord): Promise<WalletAllowanceRevokeRecord>;
    /** One bounded observation: a receipt at the proof tag, the chain's never-lands proof, or an expired unsigned preparation. */
    observe(operationId: string): Promise<WalletAllowanceRevokeRecord>;
    /** The slot's open revoke: an unsigned one past its window closes first; one with other gas caps is refused. */
    private openRevoke;
    private sign;
}
/** The observation shared by the command and `apn operation status`; it never signs or sends. */
export declare function observeWalletAllowanceRevoke(records: WalletAllowanceRevokeRepository, rpc: Pick<WalletAllowanceRpc, "batch">, record: WalletAllowanceRevokeRecord, now: () => Date): Promise<WalletAllowanceRevokeRecord>;
/** The owner's exit (TTY consent by the caller) for a sealed or sent revoke no proof decides; it may still land. */
export declare function abandonWalletAllowanceRevoke(root: string, operationId: string, now: () => Date, approve: (record: WalletAllowanceRevokeRecord) => Promise<void>): Promise<WalletAllowanceRevokeRecord>;
/** The public address of the profile's encrypted local wallet (the key that signs), read without decrypting it. */
export declare function localWalletAddress(state: StateStore, profile: string): Promise<Address>;
