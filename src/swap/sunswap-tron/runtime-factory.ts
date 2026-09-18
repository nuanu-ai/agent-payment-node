import { AssetUsageLedger } from "../../asset-usage-ledger.js";
import type { ChainWalletStoragePort } from "../../direct-rail-ports.js";
import { ApnError } from "../../errors.js";
import type { ClockPort } from "../../ports.js";
import type { StateStore } from "../../state.js";
import type { TronRpcPort } from "../../tron/rpc.js";
import type { TtyTransferApprovalOptions } from "../../tty-approval.js";
import { swapMechanismDigest } from "../pin.js";
import { SwapOperationRepository } from "../repository.js";
import { GuardedSwapApprovalRepository, GuardedSwapRuntime, type GuardedSwapForegroundApprovalPort,
  type GuardedSwapPolicyResolver, type GuardedSwapReadOnlyBuilder } from "../runtime.js";
import { GuardedSwapService } from "../service.js";
import { SunSwapLocalOwnerAdmission } from "./admission.js";
import { SUNSWAP_TRON_CHAIN, SUNSWAP_USDT, SUNSWAP_V2_ROUTER, SUNSWAP_V2_WTRX_USDT_PAIR } from "./catalog.js";
import { SunSwapTronExecutionDriver, type SunSwapSigningPort } from "./driver.js";
import { SunSwapExecutionBindingStore } from "./execution-binding.js";
import { SunSwapExecutionGuard } from "./guard.js";
import { SunSwapKeylessQuoteBuilder, type SunSwapKeylessQuoteRequest } from "./keyless-builder.js";
import { SUNSWAP_V2_KEYLESS_MECHANISM_PIN, SUNSWAP_V2_KEYLESS_PROTOCOL_REGISTRY } from "./mechanism.js";
import { SunSwapOutcomeObserver } from "./outcome.js";
import { SunSwapPreparedMaterialStore, type SunSwapPreparedMaterial } from "./prepared.js";
import { SunSwapProtectedExecutionAdapter } from "./signer.js";
import { TtySunSwapApproval } from "./tty.js";

export interface SunSwapKeylessRuntimeOptions {
  readonly state: StateStore;
  readonly clock: ClockPort;
  readonly policy: GuardedSwapPolicyResolver;
  readonly foreground: "tty" | GuardedSwapForegroundApprovalPort;
  readonly tty?: TtyTransferApprovalOptions;
  /** TRON mainnet reader and broadcaster. Production passes new TronRpc(APN_TRON_RPC_URL); it fails closed when unset. */
  readonly rpc: TronRpcPort;
  /** The profile's encrypted local chain wallet (ChainAccountStore). */
  readonly accounts: ChainWalletStoragePort;
}

export function createSunSwapKeylessRuntime(options: SunSwapKeylessRuntimeOptions): GuardedSwapRuntime<SunSwapKeylessQuoteRequest> {
  const { state, clock, rpc, accounts } = options, root = state.root;
  const store = new SunSwapPreparedMaterialStore(root), operations = new SwapOperationRepository(root), usage = new AssetUsageLedger(root);
  const admission = new SunSwapLocalOwnerAdmission(accounts, options.policy), observer = new SunSwapOutcomeObserver(rpc, () => clock.now());
  const signing = new LocalSunSwapSigning(accounts, rpc, operations, state);
  const execution = new SunSwapTronExecutionDriver({ core: new GuardedSwapService(operations, usage),
    protocolRegistry: SUNSWAP_V2_KEYLESS_PROTOCOL_REGISTRY, admission, guard: new SunSwapExecutionGuard(rpc, clock),
    bindings: new SunSwapExecutionBindingStore(root), signing, observer, clock });
  const foregroundApproval = options.foreground === "tty" ? new TtySunSwapApproval(store, clock, options.tty) : options.foreground;
  return new GuardedSwapRuntime<SunSwapKeylessQuoteRequest>({ chain: SUNSWAP_TRON_CHAIN,
    builder: new SunSwapRuntimeBuilder(new SunSwapKeylessQuoteBuilder(rpc, store)), policy: options.policy, clock,
    protocolRegistry: SUNSWAP_V2_KEYLESS_PROTOCOL_REGISTRY, usage, operations, ownerAdmission: admission, foregroundApproval, execution,
    approvals: new GuardedSwapApprovalRepository(root), rpc, effectStore: accounts, signer: signing, sender: signing, observer,
    caps: { approvalCapAtomic: "0" } });
}

/** Quote output for the CLI and MCP: the exact prepared material plus the keyless pin, never signed or broadcast. */
class SunSwapRuntimeBuilder implements GuardedSwapReadOnlyBuilder<SunSwapKeylessQuoteRequest> {
  constructor(private readonly builder: SunSwapKeylessQuoteBuilder) {}
  async quote(input: SunSwapKeylessQuoteRequest & { readonly now: Date }): Promise<unknown> {
    const material = await this.builder.quote(input), { market, pricing, transaction } = material.execution;
    return { quoteHash: material.quote.quoteHash, quote: material.quote, unsignedTransaction: transaction, approvalCapAtomic: "0",
      resources: material.gasOrEnergy, price: { source: "sunswap_v2_router_getamountsout_and_pair_getreserves", router: SUNSWAP_V2_ROUTER,
        pair: SUNSWAP_V2_WTRX_USDT_PAIR, outputToken: SUNSWAP_USDT, outputSymbol: "USDT", outputDecimals: 6, referenceBlock: market.referenceBlock,
        headBlockNumber: market.headBlockNumber, reserveInAtomic: market.reserveInAtomic, reserveOutAtomic: market.reserveOutAtomic, ...pricing },
      simulation: material.execution.simulation,
      mechanism: { pin: SUNSWAP_V2_KEYLESS_MECHANISM_PIN, digest: swapMechanismDigest(SUNSWAP_V2_KEYLESS_MECHANISM_PIN) },
      signed: false, broadcast: false };
  }
  async load(quoteHash: string): Promise<SunSwapPreparedMaterial | null> { return await this.builder.load(quoteHash); }
}

/** Opens the encrypted local TRON key only inside the signing call, under the common profile lock of the chain wallet. */
class LocalSunSwapSigning implements SunSwapSigningPort {
  constructor(private readonly storage: ChainWalletStoragePort, private readonly rpc: TronRpcPort,
    private readonly operations: SwapOperationRepository, private readonly locks: Pick<StateStore, "withLocks" | "profileHash">) {}
  async sign(...[operation, binding]: Parameters<SunSwapSigningPort["sign"]>): Promise<{ readonly signedMaterialHandle: string }> {
    const adapter = new SunSwapProtectedExecutionAdapter(this.storage, this.rpc, this.operations, operation, binding);
    return await this.locks.withLocks([`profile:${this.locks.profileHash(operation.quote.profile)}`], async () => await adapter.sign(operation));
  }
  async sendOnce(...[operation, binding, handle]: Parameters<SunSwapSigningPort["sendOnce"]>): Promise<{ readonly transactionHash: string }> {
    const marker = operation.submissionMarker;
    if (marker === null) throw new ApnError("APN_OPERATION_BLOCKED", "SunSwap send requires its durable submission marker.", { reason: "sunswap_marker_missing" });
    return await new SunSwapProtectedExecutionAdapter(this.storage, this.rpc, this.operations, operation, binding).sendOnce(handle, marker.markerHash);
  }
}
