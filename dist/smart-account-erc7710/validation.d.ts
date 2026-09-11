import type { Erc7710MaterialIntent, Erc7710PaymentPayload, Erc7710ValidatedMaterial } from "./intent.js";
export declare function validateErc7710Material(intent: Erc7710MaterialIntent, payment: Erc7710PaymentPayload): Promise<Erc7710ValidatedMaterial>;
