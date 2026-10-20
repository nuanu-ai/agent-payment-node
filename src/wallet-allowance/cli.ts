import { randomUUID } from "node:crypto";
import { approvalCode } from "../approval-code.js";
import type { BoundCommand } from "../command-binder.js";
import type { OutputEnvelope } from "../commands.js";
import { ApnError } from "../errors.js";
import { FINALIZED_RPC_ENV } from "../evm-finalized-proof.js";
import { MacOSLoginKeychainSecret } from "../macos-keychain.js";
import type { Address } from "../model.js";
import { refreshOperationIndex } from "../operation-index/refresh.js";
import { failureEnvelope, successEnvelope } from "../output.js";
import { HttpsBaseRpc } from "../rpc.js";
import type { RuntimeFactoryOptions } from "../runtime-factory-options.js";
import { StateStore } from "../state.js";
import { exactChainConsent } from "../tty-approval.js";
import { canonicalProfile } from "../wallet-policy.js";
import { readAllowanceAt, type WalletAllowanceRpc } from "./chain.js";
import { walletAllowanceSlot, type WalletAllowanceRevokeRecord } from "./model.js";
import { WalletAllowanceRevokeRepository } from "./repository.js";
import { localWalletAddress, WalletAllowanceRevokeService } from "./service.js";
import { publicWalletAllowanceRevoke, walletAllowanceRevokeCommand, walletAllowanceRevokeProofClass } from "./view.js";

/** `apn wallet allowance revoke|status`; MCP runs status and reaches revoke only as a CLI handoff. */
export async function executeWalletAllowanceCli(bound: BoundCommand, options: RuntimeFactoryOptions, root: string): Promise<OutputEnvelope> {
  const request = bound.request, requestId = randomUUID();
  let operationId: string | undefined;
  try {
    if (request.command !== "wallet.allowance.revoke" && request.command !== "wallet.allowance.status") {
      throw new ApnError("APN_UNSUPPORTED_COMMAND", "Wallet allowance command is unavailable.");
    }
    const state = new StateStore(root), { rpcSetting, rpc } = walletAllowanceRpc(request.chainId, state, options);
    if (request.command === "wallet.allowance.status") {
      const profile = canonicalProfile(request.profile), profileHash = state.profileHash(profile), owner = await localWalletAddress(state, profile);
      const read = await readAllowanceAt(rpc, { chainId: request.chainId, owner, token: request.token, spender: request.spender });
      const open = await new WalletAllowanceRevokeRepository(root).open(walletAllowanceSlot({ profileHash, terms: request }));
      const nextActions = open !== null ? [`apn operation status --operation ${open.operationId}`]
        : read.allowanceAtomic === "0" ? [] : [walletAllowanceRevokeCommand({ profile, chainId: request.chainId, token: request.token, spender: request.spender })];
      return successEnvelope(request, requestId, { proofClass: "allowance_read_at_latest_block", operation: null, receipt: null, nextActions, data: {
        schema_version: "apn.wallet-allowance-read.v1", chain: `eip155:${request.chainId}`, token: request.token, owner, spender: request.spender,
        allowance_atomic: read.allowanceAtomic, block_number: read.blockNumber, block_hash: read.blockHash, rpc_setting: rpcSetting,
        open_revoke_operation_id: open?.operationId ?? null, next_actions: nextActions } });
    }
    const service = new WalletAllowanceRevokeService(root, { rpc, rpcSetting, wrapping: options.wrappingSecret ?? new MacOSLoginKeychainSecret(),
      now: () => options.clock?.now() ?? new Date(), consent: async (record) => await consent(record, options) });
    const { command: _command, ...input } = request;
    const prepared = await service.prepare(input);
    operationId = prepared.operationId;
    const record = await service.execute(prepared);
    const data = publicWalletAllowanceRevoke(record) as { readonly next_actions: readonly string[] };
    return successEnvelope(request, requestId, { proofClass: walletAllowanceRevokeProofClass(record), data, operation: null, receipt: null, nextActions: data.next_actions });
  } catch (error) {
    return failureEnvelope(request.command, requestId, error);
  } finally {
    if (operationId !== undefined) await refreshOperationIndex(root, operationId);
  }
}

/** The chain's own `APN_<CHAIN>_RPC_URL`; a chain APN names no setting for, or an unset one, is refused by name. */
export function walletAllowanceRpc(chainId: number, state: StateStore, options: Pick<RuntimeFactoryOptions, "walletAllowanceRpc">,
  environment: Readonly<Record<string, string | undefined>> = process.env): { readonly rpcSetting: string; readonly rpc: WalletAllowanceRpc } {
  const rpcSetting = FINALIZED_RPC_ENV[chainId];
  if (rpcSetting === undefined) throw new ApnError("APN_RPC_CONFIG", `APN has no RPC setting for eip155:${chainId}; this chain's allowances cannot be read or revoked.`,
    { reason: "wallet_allowance_chain_rpc_setting_unknown", chain: `eip155:${chainId}` });
  if (options.walletAllowanceRpc !== undefined) return { rpcSetting, rpc: options.walletAllowanceRpc(chainId) };
  const url = environment[rpcSetting];
  if (url === undefined || url === "") throw new ApnError("APN_RPC_CONFIG", `Reading or revoking an allowance on eip155:${chainId} needs ${rpcSetting}: set it.`,
    { reason: "wallet_allowance_rpc_required", chain: `eip155:${chainId}`, setting: rpcSetting });
  const rpc = new HttpsBaseRpc(url, { directGuardState: state });
  rpc.armEvmDirectRpcGuard();
  return { rpcSetting, rpc: { batch: async (calls) => await rpc.batchCall(calls), send: async (raw) => await rpc.submitRawTransaction(raw) } };
}

async function consent(record: WalletAllowanceRevokeRecord, options: RuntimeFactoryOptions): Promise<void> {
  const t = record.terms;
  await exactChainConsent([
    "Agent Payment Node ERC-20 allowance revoke", `Operation: ${record.operationId}`, `Profile: ${record.profile}`, `Chain: eip155:${t.chainId}`,
    `Wallet: ${t.owner}`, `Token: ${t.token}`, `Spender: ${t.spender as Address}`, `Current allowance: ${t.priorAllowanceAtomic} atomic (block ${t.era.number})`,
    "New allowance: 0 (approve(spender, 0); nothing else is called)",
    `Nonce ${t.nonce}; gas limit ${t.gasLimit}; max fee ${t.maxFeePerGasWei} wei; priority ${t.maxPriorityFeePerGasWei} wei; maximum gas debit ${t.maxNativeDebitWei} wei`,
    `Fingerprint: ${record.fingerprint}`, `Window ends: ${t.expiresAt}`,
    "One transaction is signed and sent once; an unclear send is observed, never resent.",
  ], approvalCode("transfer", "wallet-allowance-revoke.v1", record.fingerprint), t.expiresAt, options.walletAllowanceTtyOptions ?? {});
}

