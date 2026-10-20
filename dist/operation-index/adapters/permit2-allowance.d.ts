import { type Permit2AllowanceRecord } from "../../x402-permit2/allowance/model.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/**
 * The owner's bounded ERC-20 allowance to Permit2: it holds the wallet on its chain from prepare until a receipt at the
 * chain's proof tag, the finalized never-lands proof, an unsigned expiry or the owner's abandon.
 */
export declare const permit2AllowanceAdapter: OperationFamilyAdapter<Permit2AllowanceRecord>;
