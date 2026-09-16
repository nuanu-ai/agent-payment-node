import { approvalCode } from "../approval-code.js";
import { ApnError } from "../errors.js";
import { exactChainConsent } from "../tty-approval.js";
import type { CircleApprovalRecord } from "./circle-v2-approval-executor.js";

export async function confirmCircleApproval(record: CircleApprovalRecord): Promise<boolean> {
  const p = record.preparation, t = p.transaction;
  const phrase = approvalCode("bridge", record.id, p.intentDigest);
  const lines = ["Agent Payment Node Circle V2 Base USDC approval", `Profile: ${record.profile}`,
    `Operation: ${record.id}`, `Base chain: ${t.chainId}`, `Owner: ${t.from}`, `USDC: ${p.token}`,
    `Circle V2 WithFees spender: ${p.spender}`, `Exact allowance cap: ${p.approvalCapAtomic} USDC atomic`,
    `Existing allowance at preparation: ${p.observedAllowanceAtomic} USDC atomic`,
    `Nonce: ${t.nonceAtomic}`, `Gas limit: ${t.gasLimitAtomic}`, `Max fee per gas: ${t.maxFeePerGasWei} wei`,
    `Max priority fee per gas: ${t.maxPriorityFeePerGasWei} wei`,
    `Maximum native debit: ${p.maximumNativeDebitWei} wei`,
    "This separate approval transaction may cost Base ETH even if no Circle transfer follows.",
    "Only this exact signed transaction may be sent once. Recovery observes without resend.",
    `Intent digest: ${p.intentDigest}`, `Expires: ${p.expiresAt}`];
  try { await exactChainConsent(lines, phrase, p.expiresAt, {}); return true; }
  catch (error) {
    if (error instanceof ApnError && error.code === "APN_NATIVE_REJECTED" && error.details?.nativeCode !== "APN_TTY_UNAVAILABLE") return false;
    throw error;
  }
}
