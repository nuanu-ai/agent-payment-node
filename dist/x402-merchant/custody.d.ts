import { type MerchantAuthority } from "./authority.js";
import { type Hex } from "viem";
import type { WrappingSecretPort } from "../macos-keychain.js";
import { SecureStateStore } from "../secure-state-store.js";
import type { StateStore } from "../state.js";
import type { MerchantOperation } from "./model.js";
export interface MerchantCustodyPort {
    verify(o: MerchantOperation, raw: Hex): Promise<Hex>;
    sign(o: MerchantOperation, grant: MerchantAuthority, controller: object, beforeSign?: () => Promise<void>): Promise<Hex>;
    seal(o: MerchantOperation, raw: Hex): Promise<void>;
}
export declare function verifyMerchantRaw(o: MerchantOperation, raw: Hex): Promise<`0x${string}`>;
export declare class MerchantCustody extends SecureStateStore implements MerchantCustodyPort {
    private readonly state;
    private readonly wrapping;
    private readonly now;
    private readonly wallets;
    constructor(state: StateStore, wrapping: WrappingSecretPort, now: () => Date);
    verify(o: MerchantOperation, raw: Hex): Promise<`0x${string}`>;
    sign(o: MerchantOperation, grant: MerchantAuthority, controller: object, beforeSign?: () => Promise<void>): Promise<Hex>;
    /** Create-only authenticated encryption. Public journal contains only the hash and once-only attempt fence. */
    seal(o: MerchantOperation, raw: Hex): Promise<void>;
}
