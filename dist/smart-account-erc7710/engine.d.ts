import type { Erc7710Custody, Erc7710MaterialIntent, Erc7710PaymentPayload } from "./intent.js";
export interface Erc7710EnginePort {
    create(intent: Erc7710MaterialIntent, custody: Erc7710Custody): Promise<Erc7710PaymentPayload>;
}
/** Uses the pinned MetaMask SDK to create and sign exactly one child delegation. */
export declare class OfficialErc7710Engine implements Erc7710EnginePort {
    create(intent: Erc7710MaterialIntent, custody: Erc7710Custody): Promise<Erc7710PaymentPayload>;
}
