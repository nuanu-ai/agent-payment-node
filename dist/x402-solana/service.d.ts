import type { ChainWalletStoragePort } from "../direct-rail-ports.js";
import type { HttpPort } from "../ports.js";
import { type SolanaRpcPort } from "../solana/rpc.js";
import { type X402SolanaRecord } from "./model.js";
import { X402SolanaRepository } from "./repository.js";
import type { ProfilePolicyPort } from "../profile-policy.js";
export interface X402SolanaPorts {
    readonly accounts: ChainWalletStoragePort;
    readonly http: HttpPort;
    /** Built only from an explicit APN_SOLANA_RPC_URL; absent for commands that read nothing from the chain. */
    readonly rpc?: SolanaRpcPort;
    readonly now: () => Date;
    /** The owner's encrypted profile x402 policy store (Solana binding per mint); only read here, never changed. */
    readonly policy?: ProfilePolicyPort;
}
export interface X402SolanaPayRequest {
    readonly profile: string;
    readonly url: string;
    readonly mint: string;
    readonly maxAmountAtomic: string;
    readonly idempotencyKey: string;
}
export declare class X402SolanaService {
    private readonly root;
    private readonly ports;
    readonly records: X402SolanaRepository;
    constructor(root: string, ports: X402SolanaPorts);
    private now;
    private rpc;
    private policyPort;
    /** The owner's policy of this payment's mint, unchanged since prepare (a lowered or replaced policy refuses here). */
    private currentPolicy;
    private locked;
    private write;
    /** The id this profile's key names and the hash of this exact request (url, mint, cap), as prepare freezes them. */
    private identity;
    /** The saved payment of exactly this request, or null: a key that names a different payment is a conflict, never this one. */
    savedFor(input: X402SolanaPayRequest): Promise<X402SolanaRecord | null>;
    /** Freeze one admitted payment (or replay the one this key already names); nothing is reserved or signed here. */
    prepare(input: X402SolanaPayRequest): Promise<X402SolanaRecord>;
    /**
     * Continue the payment once: after the owner's decision on a `prepared` payment, bind a fresh lifetime (simulated),
     * take the usage hold, sign, mark the exposure and send the single paid request. A payment already exposed is never
     * sent again; one signed and not exposed is sent only while its lifetime is still open.
     */
    pay(operationId: string): Promise<X402SolanaRecord>;
    /**
     * One bounded observation. An exposed payment is settled, failed on chain or proven never to land (R4); an unexposed one
     * ends without effect once its approval window or bound lifetime has passed. Otherwise nothing changes.
     */
    observe(operationId: string): Promise<{
        readonly record: X402SolanaRecord;
        readonly pending: string | null;
    }>;
    /** The transition one observation proves, or why nothing is proven yet. */
    private observation;
    private assertOwnerUnchanged;
}
