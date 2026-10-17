import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import type { ClockPort } from "../../ports.js";
import type { SolanaRpcPort } from "../../solana/rpc.js";
import type { StateStore } from "../../state.js";
import type { TtyTransferApprovalOptions } from "../../tty-approval.js";
import { SwapOperationRepository } from "../repository.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime, type GuardedSwapForegroundApprovalPort,
  type GuardedSwapPolicyResolver } from "../runtime.js";
import { GuardedSwapService } from "../service.js";
import { OrcaLocalOwnerAdmission } from "./admission.js";
import { KeylessOrcaQuoteBuilder, type OrcaKeylessQuoteRequest } from "./builder.js";
import { OrcaExecutionBindingStore, OrcaLocalSigner, OrcaSingleSender } from "./effects.js";
import { OrcaExecutionGuard, OrcaSolanaExecutionDriver } from "./execution.js";
import { SavedOrcaQuoteStore } from "./material.js";
import { ORCA_SOLANA_CHAIN, type OrcaProgramPinVerifier } from "./pins.js";
import type { OrcaPoolConfig } from "./pools.js";
import { OrcaReceiptObserver } from "./receipt.js";
import { orcaApprovalScreen } from "./tty.js";
import { TtyGuardedSwapApproval } from "../tty-consent.js";

export interface OrcaKeylessRuntimeOptions {
  readonly state: StateStore;
  readonly clock: ClockPort;
  readonly policy: GuardedSwapPolicyResolver;
  readonly foreground: "tty" | GuardedSwapForegroundApprovalPort;
  readonly tty?: TtyTransferApprovalOptions;
  /** Solana mainnet reader and sender. Production passes the APN_SOLANA_RPC_URL rail client. */
  readonly rpc: SolanaRpcPort;
  /** Encrypted local Solana wallet: seed for signing, sealed signed bytes before the single send. */
  readonly accounts: Pick<ChainWalletStoragePort, "account" | "withSeed" | "effect" | "saveEffect">;
  /** Program byte verifier. Production passes verifyOrcaProgramPins. */
  readonly verifyPins: OrcaProgramPinVerifier;
  /** The one pinned pool this runtime quotes, approves, signs and observes; its lane registry binds every operation. */
  readonly pool: OrcaPoolConfig;
}
/** The runtime of one pool, built on first use within a command. */
export type OrcaRuntimeSelector = (pool: OrcaPoolConfig) => GuardedSwapRuntime<OrcaKeylessQuoteRequest>;

export function createOrcaKeylessRuntime(options: OrcaKeylessRuntimeOptions): GuardedSwapRuntime<OrcaKeylessQuoteRequest> {
  const { state, clock, rpc, accounts, pool } = options, root = state.root, registry = pool.protocolRegistry;
  const quotes = new SavedOrcaQuoteStore(root), operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root);
  const admission = new OrcaLocalOwnerAdmission(accounts, options.policy), signer = new OrcaLocalSigner(accounts);
  const sender = new OrcaSingleSender(rpc), observer = new OrcaReceiptObserver(rpc, () => clock.now());
  const execution = new OrcaSolanaExecutionDriver({ core: new GuardedSwapService(operations, usage), protocolRegistry: registry,
    admission, guard: new OrcaExecutionGuard(rpc, clock, options.verifyPins), bindings: new OrcaExecutionBindingStore(root), signer, sender,
    observer, effects: accounts, clock });
  const foregroundApproval = options.foreground === "tty" ? new TtyGuardedSwapApproval("orca", intent => orcaApprovalScreen(quotes, intent), clock, options.tty) : options.foreground;
  return new GuardedSwapRuntime<OrcaKeylessQuoteRequest>({ chain: ORCA_SOLANA_CHAIN, builder: new KeylessOrcaQuoteBuilder(rpc, quotes, options.verifyPins, pool),
    policy: options.policy, clock, protocolRegistry: registry, usage, operations, ownerAdmission: admission,
    foregroundApproval, execution, approvals: new GuardedSwapApprovalRepository(root), rpc, effectStore: accounts, signer, sender,
    observer, caps: { approvalCapAtomic: "0" } });
}

/** Builds each pool's runtime once per command: a pool selects exactly its own lane registry and builder. */
export function orcaRuntimeSelector(build: OrcaRuntimeSelector): OrcaRuntimeSelector {
  const built = new Map<string, GuardedSwapRuntime<OrcaKeylessQuoteRequest>>();
  return (pool) => {
    const existing = built.get(pool.id); if (existing !== undefined) return existing;
    const runtime = build(pool); built.set(pool.id, runtime); return runtime;
  };
}
