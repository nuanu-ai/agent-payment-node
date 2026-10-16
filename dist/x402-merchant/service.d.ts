import type { StateStore } from "../state.js";
import type { HttpPort } from "../x402-model.js";
import { type MerchantOperation, type MerchantReceipt } from "./model.js";
import { MerchantRepository } from "./repository.js";
import { type MerchantRpcPort } from "./rpc.js";
import { type MerchantCustodyPort } from "./custody.js";
import { type MerchantAssetPin } from "./asset-pins.js";
export interface MerchantPorts {
    readonly rpc: MerchantRpcPort;
    readonly http: HttpPort;
    readonly custody?: MerchantCustodyPort;
    readonly approve?: (o: MerchantOperation) => Promise<void>;
    readonly now: () => Date;
    /** The per-asset pin registry a new challenge row must name. Production passes MERCHANT_ASSET_PINS. */
    readonly assets?: readonly MerchantAssetPin[];
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
        url: string;
        /** Optional: the pinned asset to pay with when the merchant offers several. */
        asset?: string;
        maximumNativeFee: string;
        nativeFeeReserveWei?: string;
        idempotencyKey: string;
    }): Promise<MerchantOperation>;
    approve(id: string): Promise<MerchantOperation>;
    observe(id: string, deliver?: boolean): Promise<MerchantOperation>;
    retireUnsent(id: string): Promise<MerchantOperation>;
    status(id: string): Promise<MerchantOperation>;
    private observeLocked;
    private refreshCanonical;
    private canonicalAudit;
    private revalidate;
    private refreshFee;
    private consentFresh;
    private fresh;
    private at;
    private locks;
    private required;
}
export declare function sameReceiptEffect(saved: MerchantReceipt, fresh: MerchantReceipt): boolean;
