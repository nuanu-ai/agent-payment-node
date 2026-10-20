import { type Permit2CheckedChallenge } from "./checked-challenge.js";
import { type Permit2ReadRpcSource } from "./read-port.js";
import { type Permit2OfferSelection, type Permit2Requirement } from "./offer.js";
import type { Address } from "../model.js";
import { Permit2ProductionRepository, type Permit2ProductionRecord } from "./production-repository.js";
export interface Permit2ProductionPrepareInput {
    readonly profile: string;
    readonly idempotencyKey: string;
    readonly checked: Permit2CheckedChallenge;
    readonly expected: {
        readonly index: number;
        readonly requirement: Permit2Requirement;
        readonly challengeHash: string;
    };
}
export interface Permit2ProductionPreparePorts {
    readonly rpc: Permit2ReadRpcSource;
    readonly now?: () => Date;
}
/** Durable unsigned production preparation. No custody, send, merchant HTTP or settlement port exists. */
export declare class Permit2ProductionPreparation {
    private readonly ports;
    readonly records: Permit2ProductionRepository;
    private readonly state;
    private readonly usage;
    private readonly operations;
    constructor(root: string, ports: Permit2ProductionPreparePorts);
    private now;
    private locks;
    prepare(input: Permit2ProductionPrepareInput): Promise<Permit2ProductionRecord>;
    /** The lowest-index Permit2 offer whose chain and token the profile's active allowlist policy admits for Permit2. */
    admittedSelection(profile: string, account: Address, checked: Permit2CheckedChallenge): Promise<Permit2OfferSelection>;
    private required;
    /** Concrete active-policy admission; ledger snapshot is acquired without profile/operation locks. */
    assertCurrentOwner(id: string): Promise<Permit2ProductionRecord>;
    reserve(id: string): Promise<Permit2ProductionRecord>;
    /** Expiry only releases proven unsigned material. No caller proof digest or exposed-release API exists. */
    releaseExpired(id: string): Promise<Permit2ProductionRecord>;
}
