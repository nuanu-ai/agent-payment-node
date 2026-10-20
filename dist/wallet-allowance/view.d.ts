import type { WalletAllowanceRevokeRecord } from "./model.js";
type Target = {
    readonly profile: string;
    readonly chainId: number;
    readonly token: string;
    readonly spender: string;
};
/** The exact revoke command for one residual permission; the gas caps are the owner's own inputs. */
export declare function walletAllowanceRevokeCommand(input: Target): string;
/** The read-only allowance read of the same permission. */
export declare function walletAllowanceStatusCommand(input: Target): string;
/** The public projection CLI, MCP and `apn operation status` return; the signed bytes stay in the record. */
export declare function publicWalletAllowanceRevoke(record: WalletAllowanceRevokeRecord): unknown;
/** One proof class for the command and `apn operation status`. */
export declare function walletAllowanceRevokeProofClass(record: WalletAllowanceRevokeRecord): string;
export {};
