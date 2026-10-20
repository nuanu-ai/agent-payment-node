import { type WalletAllowanceRevokeRecord } from "../../wallet-allowance/model.js";
import { type OperationFamilyAdapter } from "../adapter.js";
/**
 * The owner's revoke of one ERC-20 allowance of the local wallet: it holds the wallet on its chain from prepare until a
 * receipt at the chain's proof tag, the finalized never-lands proof, an unsigned expiry or the owner's abandon. Its status
 * is its observation (the chain's own APN_<CHAIN>_RPC_URL); it never signs or sends.
 */
export declare const walletAllowanceRevokeAdapter: OperationFamilyAdapter<WalletAllowanceRevokeRecord>;
