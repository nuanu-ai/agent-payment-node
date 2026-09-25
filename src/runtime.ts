import type { RelayUnsignedPrepareService } from "./relay/prepare.js";
import type { RelayReadOnlyPreflightService } from "./relay/preflight.js";
import type { RelayRetireService } from "./relay/retire.js";
import type { RelayKeylessStatusService } from "./relay/status.js";
import type { RelayEffectJournal } from "./relay/effect-journal.js";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as waitFor } from "node:timers/promises";
import { NATIVE_IPC_VERSION } from "./constants.js";
import { ApnError, type ErrorCode } from "./errors.js";
import type { ClockPort, HttpPort, IdPort, NativePort, NativeRequest, RpcPort, WaitPort } from "./ports.js";
import type { ProfilePolicyPort } from "./profile-policy.js";
import type { StateStore } from "./state.js";
import type { WrappingSecretPort } from "./macos-keychain.js";
import type {
  ForegroundAuthenticationPort,
  ProviderProfileRepositoryPort,
  ProviderRegistryPort,
} from "./provider-ports.js";
import type { TransferApprovalPort } from "./tty-approval.js";
import type { ProviderX402Repository } from "./provider-x402-repository.js";
import type { ProviderX402TransactionEvidencePort } from "./provider-x402-transaction-port.js";
import type { ProviderAuthorizationStorePort } from "./encrypted-provider-authorization-store.js";
import type { ChainWalletStoragePort, DirectRailPort, RailApprovalPort } from "./direct-rail-ports.js";
import type { ChainPolicyApprovalPort } from "./chain-policy.js";
import type { BridgeDependencies } from "./lifi/service.js";
import type { CircleV2ApprovalExecutor } from "./lifi/circle-v2-approval-executor.js";
import type { OneClickSourceService } from "./lifi/near-oneclick-source-service.js";
import type { CircleV2SourceService } from "./lifi/circle-v2-source-service.js";
import type { GaslessDependencies } from "./gasless/service.js";
import type { GaslessUsdtOperationService } from "./gasless-usdt/service.js";
import type { GaslessUsdtCommandPrepare } from "./gasless-usdt/command-prepare.js";
import type { GaslessUsdtCommandExecute } from "./gasless-usdt/command-execute.js";
import type { MetaMaskGaslessDependencies } from "./metamask-gasless/service.js";
import type { SmartAccountGaslessDependencies } from "./smart-account-gasless/service.js";
import type { FacilitatorGaslessDependencies } from "./facilitator-gasless/service.js";
import type { OperationAbandonApprovalPort } from "./operation-abandon-approval.js";
import type { UniswapGuardedSwapBuilder } from "./swap/uniswap-service.js";
import type { UniswapTokenCommandRuntime } from "./swap/uniswap-v3/token-execution.js";
import type { SunSwapReadOnlyQuoteBuilder } from "./swap/sunswap-tron/command-service.js";
import type { JupiterReadOnlyQuoteBuilder } from "./swap/jupiter-solana/command-service.js";
import type { PortfolioDependencies } from "./portfolio/command.js";
import type { AllowlistPolicyApprovalPort } from "./allowlist-policy-activation.js";
import type { CommandRequest } from "./commands.js";
import type { GuardedSwapRuntime } from "./swap/runtime.js";
import type { OrcaKeylessQuoteRequest } from "./swap/orca-solana/builder.js";
import type { StargateNativeService } from "./stargate-v2/native-runtime.js";
import type { StargateTokenService } from "./stargate-v2/token-runtime.js";

export interface RelayExecutionConfirmationSummary {
  readonly operationId: string;
  readonly sourceChainId: 1;
  readonly destinationChainId: 56;
  readonly sourceAccount: string;
  readonly sourceToken: string;
  readonly amountAtomic: string;
  readonly recipient: string;
  readonly minOutputAtomic: string;
  readonly deadline: string;
  readonly requestId: string;
  readonly quoteDigest: string;
  readonly approvalNetworkFeeCeilingWei: string;
  readonly depositNetworkFeeCeilingWei: string;
}
export type RelayExecuteConfirmation = (summary: RelayExecutionConfirmationSummary) => Promise<boolean>;
export interface RelayExecuteHandler { execute(operationId: string): Promise<RelayEffectJournal> }

export interface CoreDependencies {
  readonly relayPrepare?: RelayUnsignedPrepareService;
  readonly relayPreflight?: RelayReadOnlyPreflightService;
  readonly relayRetire?: RelayRetireService;
  readonly relayStatus?: RelayKeylessStatusService;
  readonly relayExecute?: RelayExecuteHandler;
  readonly relayExecuteConfirmation?: RelayExecuteConfirmation;
  readonly stargateNative?: StargateNativeService;
  readonly stargateToken?: StargateTokenService;
  readonly portfolio?: PortfolioDependencies;
  readonly uniswapRuntime?: GuardedSwapRuntime<Extract<CommandRequest, { readonly command: "swap.uniswap.quote" }>>;
  readonly uniswapTokenRuntime?: UniswapTokenCommandRuntime;
  readonly sunswapRuntime?: GuardedSwapRuntime<Extract<CommandRequest, { readonly command: "swap.sunswap.quote" }>>;
  readonly orcaRuntime?: GuardedSwapRuntime<OrcaKeylessQuoteRequest>;
  readonly uniswap?: UniswapGuardedSwapBuilder;
  readonly sunswap?: SunSwapReadOnlyQuoteBuilder;
  readonly jupiter?: JupiterReadOnlyQuoteBuilder;
  readonly facilitatorGasless?: FacilitatorGaslessDependencies;
  readonly smartAccountGasless?: SmartAccountGaslessDependencies;
  readonly metaMaskGasless?: MetaMaskGaslessDependencies;
  readonly gasless?: GaslessDependencies;
  readonly gaslessUsdt?: GaslessUsdtOperationService;
  readonly gaslessUsdtPrepare?: GaslessUsdtCommandPrepare;
  readonly gaslessUsdtExecute?: GaslessUsdtCommandExecute;
  readonly bridge?: BridgeDependencies;
  readonly circleApproval?: CircleV2ApprovalExecutor;
  readonly circleSource?: CircleV2SourceService;
  readonly oneClickSource?: OneClickSourceService;
  readonly directRails?: readonly DirectRailPort[];
  readonly chainAccounts?: ChainWalletStoragePort;
  readonly railApproval?: RailApprovalPort;
  readonly chainPolicyApproval?: ChainPolicyApprovalPort;
  readonly allowlistPolicyApproval?: AllowlistPolicyApprovalPort;
  readonly state: StateStore;
  readonly native?: NativePort;
  readonly keychainProbe?: Pick<WrappingSecretPort, "load">;
  readonly rpc?: RpcPort;
  readonly coinbaseRpc?: RpcPort;
  readonly coinbaseRpcFactory?: () => RpcPort;
  readonly http?: HttpPort;
  readonly clock?: ClockPort;
  readonly ids?: IdPort;
  readonly policy?: ProfilePolicyPort;
  readonly wait?: WaitPort;
  readonly profileRepository?: ProviderProfileRepositoryPort;
  readonly providerRegistry?: ProviderRegistryPort;
  readonly foregroundAuthentication?: ForegroundAuthenticationPort;
  readonly transferApproval?: TransferApprovalPort;
  readonly rpcUrl?: string;
  readonly coinbaseRpcUrl?: string;
  readonly providerX402Repository?: ProviderX402Repository;
  readonly providerTransactionEvidence?: ProviderX402TransactionEvidencePort;
  readonly providerAuthorizationStore?: ProviderAuthorizationStorePort;
  readonly operationAbandonApproval?: OperationAbandonApprovalPort;
}

export class RuntimeContext {
  readonly relayPrepare?: RelayUnsignedPrepareService;
  readonly relayPreflight?: RelayReadOnlyPreflightService;
  readonly relayRetire?: RelayRetireService;
  readonly relayStatus?: RelayKeylessStatusService;
  readonly relayExecute?: RelayExecuteHandler;
  readonly relayExecuteConfirmation?: RelayExecuteConfirmation;
  readonly stargateNative?: StargateNativeService;
  readonly stargateToken?: StargateTokenService;
  readonly portfolio?: PortfolioDependencies;
  readonly uniswapRuntime?: GuardedSwapRuntime<Extract<CommandRequest, { readonly command: "swap.uniswap.quote" }>>;
  readonly uniswapTokenRuntime?: UniswapTokenCommandRuntime;
  readonly sunswapRuntime?: GuardedSwapRuntime<Extract<CommandRequest, { readonly command: "swap.sunswap.quote" }>>;
  readonly orcaRuntime?: GuardedSwapRuntime<OrcaKeylessQuoteRequest>;
  readonly uniswap?: UniswapGuardedSwapBuilder;
  readonly sunswap?: SunSwapReadOnlyQuoteBuilder;
  readonly jupiter?: JupiterReadOnlyQuoteBuilder;
  readonly facilitatorGasless?: FacilitatorGaslessDependencies;
  readonly smartAccountGasless?: SmartAccountGaslessDependencies;
  readonly metaMaskGasless?: MetaMaskGaslessDependencies;
  readonly gasless?: GaslessDependencies;
  readonly gaslessUsdt?: GaslessUsdtOperationService;
  readonly gaslessUsdtPrepare?: GaslessUsdtCommandPrepare;
  readonly gaslessUsdtExecute?: GaslessUsdtCommandExecute;
  readonly bridge?: BridgeDependencies;
  readonly circleApproval?: CircleV2ApprovalExecutor;
  readonly circleSource?: CircleV2SourceService;
  readonly oneClickSource?: OneClickSourceService;
  readonly directRails: readonly DirectRailPort[];
  readonly chainAccounts?: ChainWalletStoragePort;
  readonly railApproval?: RailApprovalPort;
  readonly chainPolicyApproval?: ChainPolicyApprovalPort;
  readonly allowlistPolicyApproval?: AllowlistPolicyApprovalPort;
  readonly state: StateStore;
  readonly native?: NativePort;
  readonly keychainProbe?: Pick<WrappingSecretPort, "load">;
  readonly rpc?: RpcPort;
  readonly coinbaseRpc?: RpcPort;
  readonly http?: HttpPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly policy?: ProfilePolicyPort;
  readonly wait: WaitPort;
  readonly profileRepository?: ProviderProfileRepositoryPort;
  readonly providerRegistry?: ProviderRegistryPort;
  readonly foregroundAuthentication?: ForegroundAuthenticationPort;
  readonly transferApproval?: TransferApprovalPort;
  readonly rpcUrl?: string;
  readonly coinbaseRpcUrl?: string;
  readonly providerX402Repository?: ProviderX402Repository;
  readonly providerTransactionEvidence?: ProviderX402TransactionEvidencePort;
  readonly providerAuthorizationStore?: ProviderAuthorizationStorePort;
  readonly operationAbandonApproval?: OperationAbandonApprovalPort;
  private readonly coinbaseRpcFactory?: () => RpcPort;
  private coinbaseRpcInstance?: RpcPort;
  private initialized: Promise<void> | undefined;

  constructor(dependencies: CoreDependencies) {
    if (dependencies.relayPrepare !== undefined) this.relayPrepare = dependencies.relayPrepare;
    if (dependencies.relayPreflight !== undefined) this.relayPreflight = dependencies.relayPreflight;
    if (dependencies.relayRetire !== undefined) this.relayRetire = dependencies.relayRetire;
    if (dependencies.relayStatus !== undefined) this.relayStatus = dependencies.relayStatus;
    if (dependencies.relayExecute !== undefined) this.relayExecute = dependencies.relayExecute;
    if (dependencies.relayExecuteConfirmation !== undefined) this.relayExecuteConfirmation = dependencies.relayExecuteConfirmation;
    if (dependencies.stargateNative !== undefined) this.stargateNative = dependencies.stargateNative;
    if (dependencies.stargateToken !== undefined) this.stargateToken = dependencies.stargateToken;
    if (dependencies.portfolio !== undefined) this.portfolio = dependencies.portfolio;
    if (dependencies.uniswapRuntime !== undefined) this.uniswapRuntime = dependencies.uniswapRuntime;
    if (dependencies.uniswapTokenRuntime !== undefined) this.uniswapTokenRuntime = dependencies.uniswapTokenRuntime;
    if (dependencies.sunswapRuntime !== undefined) this.sunswapRuntime = dependencies.sunswapRuntime;
    if (dependencies.orcaRuntime !== undefined) this.orcaRuntime = dependencies.orcaRuntime;
    if (dependencies.uniswap !== undefined) this.uniswap = dependencies.uniswap;
    if (dependencies.sunswap !== undefined) this.sunswap = dependencies.sunswap;
    if (dependencies.jupiter !== undefined) this.jupiter = dependencies.jupiter;
    if (dependencies.facilitatorGasless !== undefined) this.facilitatorGasless = dependencies.facilitatorGasless;
    if (dependencies.smartAccountGasless !== undefined) this.smartAccountGasless = dependencies.smartAccountGasless;
    if (dependencies.metaMaskGasless !== undefined) this.metaMaskGasless = dependencies.metaMaskGasless;
    if (dependencies.gasless !== undefined) this.gasless = dependencies.gasless;
    if (dependencies.gaslessUsdt !== undefined) this.gaslessUsdt = dependencies.gaslessUsdt;
    if (dependencies.gaslessUsdtPrepare !== undefined) this.gaslessUsdtPrepare = dependencies.gaslessUsdtPrepare;
    if (dependencies.gaslessUsdtExecute !== undefined) this.gaslessUsdtExecute = dependencies.gaslessUsdtExecute;
    if (dependencies.bridge !== undefined) this.bridge = dependencies.bridge;
    if (dependencies.circleApproval !== undefined) this.circleApproval = dependencies.circleApproval;
    if (dependencies.circleSource !== undefined) this.circleSource = dependencies.circleSource;
    if (dependencies.oneClickSource !== undefined) this.oneClickSource = dependencies.oneClickSource;
    this.directRails = dependencies.directRails ?? [];
    if (dependencies.chainAccounts !== undefined) this.chainAccounts = dependencies.chainAccounts;
    if (dependencies.railApproval !== undefined) this.railApproval = dependencies.railApproval;
    if (dependencies.chainPolicyApproval !== undefined) this.chainPolicyApproval = dependencies.chainPolicyApproval;
    if (dependencies.allowlistPolicyApproval !== undefined) this.allowlistPolicyApproval = dependencies.allowlistPolicyApproval;
    this.state = dependencies.state;
    if (dependencies.native !== undefined) this.native = dependencies.native;
    if (dependencies.keychainProbe !== undefined) this.keychainProbe = dependencies.keychainProbe;
    if (dependencies.rpc !== undefined) this.rpc = dependencies.rpc;
    if (dependencies.coinbaseRpc !== undefined) this.coinbaseRpc = dependencies.coinbaseRpc;
    if (dependencies.coinbaseRpcFactory !== undefined) this.coinbaseRpcFactory = dependencies.coinbaseRpcFactory;
    if (dependencies.http !== undefined) this.http = dependencies.http;
    this.clock = dependencies.clock ?? { now: () => new Date() };
    this.ids = dependencies.ids ?? { next: () => randomUUID() };
    if (dependencies.policy !== undefined) this.policy = dependencies.policy;
    this.wait = dependencies.wait ?? new ProcessWaitPort();
    if (dependencies.profileRepository !== undefined) this.profileRepository = dependencies.profileRepository;
    if (dependencies.providerRegistry !== undefined) this.providerRegistry = dependencies.providerRegistry;
    if (dependencies.foregroundAuthentication !== undefined) this.foregroundAuthentication = dependencies.foregroundAuthentication;
    if (dependencies.transferApproval !== undefined) this.transferApproval = dependencies.transferApproval;
    if (dependencies.rpcUrl !== undefined) this.rpcUrl = dependencies.rpcUrl;
    if (dependencies.coinbaseRpcUrl !== undefined) this.coinbaseRpcUrl = dependencies.coinbaseRpcUrl;
    if (dependencies.providerX402Repository !== undefined) this.providerX402Repository = dependencies.providerX402Repository;
    if (dependencies.providerTransactionEvidence !== undefined) this.providerTransactionEvidence = dependencies.providerTransactionEvidence;
    if (dependencies.providerAuthorizationStore !== undefined) this.providerAuthorizationStore = dependencies.providerAuthorizationStore;
    if (dependencies.operationAbandonApproval !== undefined) this.operationAbandonApproval = dependencies.operationAbandonApproval;
  }

  async ready(): Promise<void> {
    this.initialized ??= this.state.initialize();
    await this.initialized;
  }

  requireNative(): NativePort {
    if (this.native === undefined) {
      throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "This command must run as a child of the signed native app host.");
    }
    return this.native;
  }

  requireKeychainProbe(): Pick<WrappingSecretPort, "load"> {
    if (this.keychainProbe === undefined) {
      throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "This command requires the read-only login Keychain probe.");
    }
    return this.keychainProbe;
  }

  requireRpc(): RpcPort {
    if (this.rpc === undefined) {
      throw new ApnError("APN_RPC_CONFIG", "This command requires an explicit HTTPS Base RPC endpoint.");
    }
    return this.rpc;
  }

  requireCoinbaseRpc(): RpcPort {
    if (this.coinbaseRpc !== undefined) return this.coinbaseRpc;
    if (this.coinbaseRpcFactory !== undefined) return this.coinbaseRpcInstance ??= this.coinbaseRpcFactory();
    return this.requireRpc();
  }

  requireHttp(): HttpPort {
    if (this.http === undefined) {
      throw new ApnError("APN_HTTP_CONFIG" as ErrorCode, "This command requires the fail-closed seller HTTPS adapter.");
    }
    return this.http;
  }

  requirePolicy(): ProfilePolicyPort {
    if (this.policy === undefined) {
      throw new ApnError("APN_WALLET_POLICY_REQUIRED", "This command requires the encrypted profile policy store.");
    }
    return this.policy;
  }

  requireProfileRepository(): ProviderProfileRepositoryPort {
    if (this.profileRepository === undefined) throw new ApnError("APN_INTERNAL", "Provider profile repository is unavailable.");
    return this.profileRepository;
  }

  requireProviderRegistry(): ProviderRegistryPort {
    if (this.providerRegistry === undefined) throw new ApnError("APN_INTERNAL", "Provider registry is unavailable.");
    return this.providerRegistry;
  }

  requireForegroundAuthentication(): ForegroundAuthenticationPort {
    if (this.foregroundAuthentication === undefined) {
      throw new ApnError("APN_FOREGROUND_AUTH_REQUIRED", "A foreground terminal is required for wallet provider authentication.");
    }
    return this.foregroundAuthentication;
  }

  requireOperationAbandonApproval(): OperationAbandonApprovalPort {
    if (this.operationAbandonApproval === undefined) {
      throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Unknown-effect abandonment requires exact foreground terminal confirmation.");
    }
    return this.operationAbandonApproval;
  }

  requireTransferApproval(): TransferApprovalPort {
    if (this.transferApproval === undefined) {
      throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "A foreground terminal is required for direct-transfer approval.");
    }
    return this.transferApproval;
  }

  requireRpcUrl(): string {
    if (this.rpcUrl === undefined) throw new ApnError("APN_RPC_CONFIG", "This command requires an explicit HTTPS Base RPC endpoint.");
    return this.rpcUrl;
  }

  requireCoinbaseRpcUrl(): string {
    if (this.coinbaseRpcUrl !== undefined) return this.coinbaseRpcUrl;
    return this.requireRpcUrl();
  }

  requireProviderAuthorizationStore(): ProviderAuthorizationStorePort {
    if (this.providerAuthorizationStore === undefined) {
      throw new ApnError("APN_INTERNAL", "The encrypted provider authorization store is unavailable.");
    }
    return this.providerAuthorizationStore;
  }

  nativeRequest(operation: NativeRequest["operation"], payload: Readonly<Record<string, unknown>>): NativeRequest {
    return { version: NATIVE_IPC_VERSION, requestId: this.ids.next(), operation, payload };
  }
}

class ProcessWaitPort implements WaitPort {
  nowMs(): number { return performance.now(); }

  async wait(milliseconds: number): Promise<"elapsed" | "interrupted"> {
    const controller = new AbortController();
    const onSigint = (): void => controller.abort();
    process.once("SIGINT", onSigint);
    try {
      await waitFor(milliseconds, undefined, { signal: controller.signal });
      return "elapsed";
    } catch (error) {
      if (controller.signal.aborted) return "interrupted";
      throw error;
    } finally {
      process.off("SIGINT", onSigint);
    }
  }
}
