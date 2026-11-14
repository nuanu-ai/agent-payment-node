import { type MoneyConflictDomain } from "../../operation-conflict-domain.js";
import { type MerchantOperation } from "../../x402-merchant/model.js";
import { type OperationFamilyAdapter } from "../adapter.js";
export declare function merchantDomains(record: MerchantOperation): readonly MoneyConflictDomain[];
/**
 * Merchant x402 payments on MegaETH. The family's own outcomes end the claim, the phase 4c exits included (never sent,
 * superseded at the finalized nonce, owner abandon, delivery attempts exhausted); besides them, a `prepared` payment
 * (never signed: approve moves it to signing_started only while its 300 s local deadline holds) can never sign once that
 * deadline plus the unstarted margin has passed, so it stops holding its account without any command. Observe then
 * records it `failed_before_effect` and releases any hold a crashed approval reserved. That release reads the machine
 * clock: should the clock go back inside the deadline, approve's own account check first admits this payment again
 * (`OperationIndex.assertAvailable` with `except`) and refuses, writing nothing, while another operation holds the account.
 */
export declare const merchantTerminal: (record: Pick<MerchantOperation, "state" | "expiresAt">) => boolean;
export declare const merchantAdapter: OperationFamilyAdapter<MerchantOperation>;
