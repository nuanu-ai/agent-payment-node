import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { Address } from "../../model.js";
import { type ProfilePolicyPort } from "../../profile-policy.js";
import { type Permit2AllowanceRpc } from "./chain.js";
import { type Permit2AllowanceRecord } from "./model.js";
import { Permit2AllowanceRepository } from "./repository.js";
export interface Permit2AllowanceRequest {
    readonly action: "set" | "revoke";
    readonly profile: string;
    readonly chainId: number;
    readonly token: Address;
    readonly amountAtomic: string;
    readonly maxGasLimit: string;
    readonly maxFeePerGasWei: string;
    readonly maxPriorityFeePerGasWei: string;
    readonly idempotencyKey: string;
}
export interface Permit2AllowancePorts {
    readonly rpc: Permit2AllowanceRpc;
    readonly policy: ProfilePolicyPort;
    readonly wrapping: WrappingSecretPort;
    /** The owner's foreground decision on the exact frozen approve; throws when refused. */
    readonly consent: (record: Permit2AllowanceRecord) => Promise<void>;
    readonly now: () => Date;
}
/**
 * `x402 permit2 allowance set|revoke`: one owner-approved ERC-20 approve of an owner-specified, bounded amount to the
 * canonical Permit2 contract (or to zero), signed by the local wallet, sent once and observed to its proof.
 */
export declare class Permit2AllowanceService {
    private readonly root;
    private readonly ports;
    readonly records: Permit2AllowanceRepository;
    private readonly state;
    constructor(root: string, ports: Permit2AllowancePorts);
    private now;
    private write;
    prepare(request: Permit2AllowanceRequest): Promise<Permit2AllowanceRecord>;
    /** Consent, seal, mark and send once; a replay continues where the record stands and never sends twice. */
    execute(operationId: string): Promise<Permit2AllowanceRecord>;
    /** One bounded observation: a receipt at the proof tag, the chain's never-lands proof, or an expired unsigned preparation. */
    observe(operationId: string): Promise<Permit2AllowanceRecord>;
    /** The owner admits the chain+token for x402 (profile policy, else the allowlist Permit2 row); the amount stays within its cap. */
    private admission;
    private sign;
}
/** The owner's exit (TTY consent by the caller) for a sealed or sent approve no proof decides; it may still land. */
export declare function abandonPermit2Allowance(root: string, operationId: string, now: () => Date, approve: (record: Permit2AllowanceRecord) => Promise<void>): Promise<Permit2AllowanceRecord>;
