import type { MerchantOperation } from "./model.js";
export type MerchantEffect = "sign" | "send";
export interface MerchantAuthority {
    readonly opaque: object;
}
/** This in-memory authority exists only during the foreground approval under its policy lock. */
export declare function issueMerchantAuthority(controller: object, o: MerchantOperation, tokenHold: string, nativeHold: string, approvalEndsAt: string): MerchantAuthority;
export declare function assertMerchantAuthority(grant: MerchantAuthority | undefined, controller: object, o: MerchantOperation, now: Date, effect?: MerchantEffect): void;
export declare function bindMerchantMaterial(grant: MerchantAuthority, controller: object, o: MerchantOperation, now: Date, materialHash: string): void;
export declare function disposeMerchantAuthority(grant: MerchantAuthority): void;
export declare function merchantHoldBinding(o: MerchantOperation, reservationDigest: string): string;
