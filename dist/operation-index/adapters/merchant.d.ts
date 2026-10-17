import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type MerchantOperation } from "../../x402-merchant/model.js";
import { type OperationFamilyAdapter } from "../adapter.js";
export declare function merchantDomains(record: MerchantOperation): readonly MoneyConflictDomain[];
/**
 * Merchant x402 payments on MegaETH. The family's own outcomes end the claim; besides them, a `prepared` payment (never
 * signed: approve moves it to signing_started only while its 300 s local deadline holds, and a payment prepared but
 * never approved has no other exit) can never sign once that deadline plus the unstarted margin has passed.
 */
export declare const merchantTerminal: (record: Pick<MerchantOperation, "state" | "expiresAt">) => boolean;
export declare const merchantAdapter: OperationFamilyAdapter<MerchantOperation>;
