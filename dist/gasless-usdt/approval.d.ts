import type { UsdtGaslessAdmission } from "./allowlist.js";
import { type UsdtTransferPlan } from "./model.js";
/** Six-decimal display of an atomic USDT amount; exact, never rounded. */
export declare function usdtDisplay(atomic: bigint | string): string;
/**
 * The approval screen: gross, fee budget, net and the owner's caps, with the sponsor's identity and the one allowance
 * the batch leaves behind. The human approves exactly these values; the signature later commits to them.
 */
export declare function usdtApprovalScreen(plan: UsdtTransferPlan, admission: UsdtGaslessAdmission, firstUse: boolean): readonly string[];
