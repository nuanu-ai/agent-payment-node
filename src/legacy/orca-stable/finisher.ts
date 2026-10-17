import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import type { ClockPort } from "../../ports.js";
import type { SolanaRpc } from "../../solana/rpc.js";
import type { SwapOperationRecord } from "../../swap/model.js";
import { SwapOperationRepository } from "../../swap/repository.js";
import { GuardedSwapService } from "../../swap/service.js";
import { OrcaStableExecutionBindingStore } from "./execution-binding.js";
import { SavedOrcaStableMaterialStore } from "./material.js";
import { OrcaStableNoSendProofStore } from "./no-send-proof.js";
import { recoverOrcaStableNoSend } from "./no-send-recovery.js";
import { OrcaStableFinalizedObserver } from "./observer.js";
import { confirmOrcaStableNoSendRecovery, type OrcaStableConsentPort } from "./recovery-consent.js";
import { releaseOrcaStableNoEffect } from "./release.js";
import { orcaStablePreparedStatus } from "./status.js";

/**
 * The four exits of stable USDC to USDT operations a released version (0.5.45 or earlier) prepared: read status (and
 * release an expired unsigned preparation), release an unsigned preparation, prove a marked-but-unsigned execution never
 * sent (owner TTY consent), and observe a claimed or signed execution to its finalized, reverted or expired outcome.
 */
export interface OrcaStableLegacyFinisher {
  status(operationId: string): Promise<unknown>;
  release(operationId: string): Promise<unknown>;
  recoverNoSend(operationId: string): Promise<SwapOperationRecord>;
  observe(operationId: string): Promise<SwapOperationRecord>;
}
export interface OrcaStableLegacyPorts {
  readonly root: string;
  readonly clock: ClockPort;
  /** Public account metadata for every exit; the sealed effect lookup only for no-send recovery. */
  readonly accounts: Pick<ChainWalletStoragePort, "account" | "effectByOperationId">;
  /** Budgeted, persistently paced Solana RPC: observation only. */
  readonly rpc: SolanaRpc;
  readonly consent: OrcaStableConsentPort;
}

export function orcaStableLegacyFinisher(ports: OrcaStableLegacyPorts): OrcaStableLegacyFinisher {
  const { root, clock } = ports, service = () => new GuardedSwapService(new SwapOperationRepository(root), new AssetUsageLedger(root));
  return {
    status: async (operationId) => await orcaStablePreparedStatus(new SwapOperationRepository(root), new SavedOrcaStableMaterialStore(root),
      operationId, clock.now()),
    release: async (operationId) => await releaseOrcaStableNoEffect(service(), new SavedOrcaStableMaterialStore(root), operationId, clock.now()),
    recoverNoSend: async (operationId) => {
      const swaps = service();
      await confirmOrcaStableNoSendRecovery(swaps, operationId, ports.consent, () => clock.now());
      return await recoverOrcaStableNoSend(swaps, new SavedOrcaStableMaterialStore(root), new OrcaStableExecutionBindingStore(root),
        new OrcaStableNoSendProofStore(root), ports.accounts, (profile) => ports.accounts.account(profile, "solana"), operationId, clock.now());
    },
    observe: async (operationId) => await new OrcaStableFinalizedObserver(service(), new SavedOrcaStableMaterialStore(root),
      new OrcaStableExecutionBindingStore(root), ports.accounts, ports.rpc, () => clock.now()).observe(operationId),
  };
}
