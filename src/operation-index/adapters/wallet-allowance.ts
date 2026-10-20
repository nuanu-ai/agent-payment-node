import { ApnError } from "../../errors.js";
import type { FinalizedReadCall, PublicFinalizedRead } from "../../evm-finalized-proof.js";
import { evmConflictDomain } from "../../operation-conflict-domain.js";
import { WALLET_ALLOWANCE_REVOKE_FAMILY, WALLET_ALLOWANCE_REVOKE_STORE, WALLET_ALLOWANCE_REVOKE_TERMINAL_STATES,
  type WalletAllowanceRevokeRecord } from "../../wallet-allowance/model.js";
import { WalletAllowanceRevokeRepository } from "../../wallet-allowance/repository.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity,
  type OperationFamilyAdapter, type OperationStore } from "../adapter.js";
import { pastUnstartedDeadline } from "./family-claims.js";
import { OPERATION_ABANDON, OPERATION_STATUS } from "./family-commands.js";

const STORE: OperationStore = { directory: WALLET_ALLOWANCE_REVOKE_STORE, perProfile: false };

/**
 * The owner's revoke of one ERC-20 allowance of the local wallet: it holds the wallet on its chain from prepare until a
 * receipt at the chain's proof tag, the finalized never-lands proof, an unsigned expiry or the owner's abandon. Its status
 * is its observation (the chain's own APN_<CHAIN>_RPC_URL); it never signs or sends. A `prepared` revoke (never signed:
 * execute writes `signed` only while its consent window holds, checked under the record lock) can never sign once that
 * window plus the unstarted margin has passed, so it stops holding the wallet then, consented or not; its status records
 * it `failed_before_effect`.
 */
export const walletAllowanceRevokeAdapter: OperationFamilyAdapter<WalletAllowanceRevokeRecord> = {
  family: WALLET_ALLOWANCE_REVOKE_FAMILY,
  stores: [STORE],
  async load(root, recordPath) { return await new WalletAllowanceRevokeRepository(root).find(requiredRecordPath(recordPath, STORE).operationId); },
  identity: standardIdentity,
  claims: (record) => readableClaims(() => domainClaims([evmConflictDomain(record.terms.chainId, record.terms.owner)])),
  terminal: (record) => WALLET_ALLOWANCE_REVOKE_TERMINAL_STATES.includes(record.state) ||
    record.state === "prepared" && pastUnstartedDeadline(record.terms.expiresAt),
  state: (record) => record.state,
  salvage: (raw) => salvageRecord(raw, (value) => [salvageEvm(field(value, "terms", "chainId"), field(value, "terms", "owner"))]),
  view: async (record) => (await import("../../wallet-allowance/view.js")).publicWalletAllowanceRevoke(record),
  async status(context, record) {
    const [{ observeWalletAllowanceRevoke }, { publicWalletAllowanceRevoke, walletAllowanceRevokeProofClass }] = await Promise.all([
      import("../../wallet-allowance/service.js"), import("../../wallet-allowance/view.js")]);
    const batch = async (calls: readonly { readonly method: string; readonly params: readonly unknown[] }[]) => {
      // One batch is one node answering every read of the proof together, as the shared never-lands rule requires.
      const reader = context.finalizedRead?.(record.terms.chainId) as Partial<PublicFinalizedRead> | undefined;
      if (reader?.batch === undefined) throw new ApnError("APN_RPC_CONFIG", `Observing this revoke reads eip155:${record.terms.chainId}: set ${record.terms.rpcSetting}.`,
        { reason: "wallet_allowance_rpc_required", setting: record.terms.rpcSetting });
      return await reader.batch(calls as readonly FinalizedReadCall[]);
    };
    const next = await observeWalletAllowanceRevoke(new WalletAllowanceRevokeRepository(context.state.root), { batch }, record, () => context.clock.now());
    const data = publicWalletAllowanceRevoke(next) as { readonly next_actions: readonly string[] };
    return { proofClass: walletAllowanceRevokeProofClass(next), data, operation: null, receipt: null, nextActions: data.next_actions };
  },
  async abandon(context, record) {
    const [{ abandonWalletAllowanceRevoke }, { publicWalletAllowanceRevoke }] = await Promise.all([import("../../wallet-allowance/service.js"),
      import("../../wallet-allowance/view.js")]);
    const approval = context.requireOperationAbandonApproval(), t = record.terms;
    return publicWalletAllowanceRevoke(await abandonWalletAllowanceRevoke(context.state.root, record.operationId, () => context.clock.now(), async (current) =>
      await approval.approve({ operationId: current.operationId, fingerprint: current.fingerprint, profile: current.profile, providerId: "local",
        walletAddress: t.owner, recipient: t.spender, amountAtomic: "0", amountDecimal: "0", chainLabel: `eip155:${t.chainId}`,
        assetLabel: `allowance of ${t.token} to ${t.spender}`, unit: "atomic units",
        outcomeNote: "The revoke may still land and set this allowance to zero; read it with apn wallet allowance status." })));
  },
  commands: { status: OPERATION_STATUS, resume: OPERATION_STATUS, exit: OPERATION_ABANDON },
};
