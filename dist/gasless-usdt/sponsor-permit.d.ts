import type { GaslessTransport } from "../gasless/https.js";
import type { ClockPort } from "../ports.js";
import { type UsdtAnyBoundOperation } from "./bound-operation.js";
import type { UsdtSigningIdentity } from "./local-signing.js";
import { type UsdtSponsorSnapshot } from "./sponsor-auth.js";
/** Cannot be serialized or minted from saved evidence. The private map supplies authority. */
export interface UsdtSponsorPermit {
    readonly kind: "usdt-sponsor-custody-permit";
}
export interface UsdtConsumedSponsorPermit {
    readonly kind: "consumed-usdt-sponsor-permit";
}
export declare function assertUsdtConsumedPermitFresh(context: UsdtConsumedSponsorPermit, clock: ClockPort): void;
/** Mint ONLY after actual local recovery and canonical chain membership/parity attestation. */
export declare function mintUsdtSponsorPermit(input: {
    readonly bound: UsdtAnyBoundOperation;
    readonly identity: UsdtSigningIdentity;
    readonly snapshot: UsdtSponsorSnapshot;
    readonly transport: GaslessTransport;
    readonly rpcUrl: string;
    readonly clock: ClockPort;
}): Promise<UsdtSponsorPermit>;
/** Single use under custody lock BEFORE wallet describe. Expiry never triggers an implicit retry. */
export declare function consumeUsdtSponsorPermit(permit: UsdtSponsorPermit | undefined, bound: UsdtAnyBoundOperation, identity: UsdtSigningIdentity, clock: ClockPort): UsdtConsumedSponsorPermit;
