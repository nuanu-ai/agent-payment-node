import type { StateStore } from "../state.js";
import type { HttpPort } from "../x402-model.js";
import { type MerchantOperation, type MerchantReceipt } from "./model.js";
import { MerchantRepository } from "./repository.js";
import { type MerchantRpcPort } from "./rpc.js";
import { type MerchantCustodyPort } from "./custody.js";
export interface MerchantPorts {
    readonly rpc: MerchantRpcPort;
    readonly http: HttpPort;
    readonly custody?: MerchantCustodyPort;
    readonly approve?: (o: MerchantOperation) => Promise<void>;
    readonly now: () => Date;
}
export declare class MerchantService {
    private readonly state;
    private readonly ports;
    readonly records: MerchantRepository;
    private readonly operations;
    private readonly owner;
    constructor(state: StateStore, ports: MerchantPorts);
    prepare(input: {
        profile: string;
        maximumNativeFee: string;
        idempotencyKey: string;
    }): Promise<MerchantOperation>;
    approve(id: string): Promise<MerchantOperation>;
    observe(id: string, deliver?: boolean): Promise<MerchantOperation>;
    status(id: string): Promise<MerchantOperation>;
    private observeLocked;
    private refreshCanonical;
    private canonicalAudit;
    private revalidate;
    private fresh;
    private at;
    private locks;
    private required;
}
export declare function sameReceiptEffect(saved: MerchantReceipt, fresh: MerchantReceipt): boolean;
