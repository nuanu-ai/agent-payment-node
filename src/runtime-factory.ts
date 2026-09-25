import { RelayUnsignedPrepareService, type RelayPreparePorts } from "./relay/prepare.js";
import { RelayReadOnlyPreflightService, type RelayPreflightPorts } from "./relay/preflight.js";
import { RelayRetireService } from "./relay/retire.js";
import { RelayKeylessStatusService } from "./relay/status.js";
import { ApnError } from "./errors.js";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import type { BoundCommand } from "./command-binder.js";
import type { OutputEnvelope } from "./commands.js";
import { ApnCore } from "./core.js";
import { EncryptedProfilePolicy } from "./encrypted-profile-policy.js";
import { LocalWalletNative } from "./local-wallet-native.js";
import { MacOSLoginKeychainSecret, type WrappingSecretPort } from "./macos-keychain.js";
import type { ClockPort, HttpPort, IdPort, NativePort, RpcPort, WaitPort } from "./ports.js";
import { TtyProfilePolicyApproval, type ProfilePolicyApprovalPort } from "./policy-approval.js";
import type { ProfilePolicyPort } from "./profile-policy.js";
import { HttpsBaseRpc } from "./rpc.js";
import { StateStore } from "./state.js";
import type { TransferApprovalPort } from "./tty-approval.js";
import { TtyRelayExecuteConfirmation, TtyTransferApproval } from "./tty-approval.js";
import type { RelayExecuteConfirmation, RelayExecuteHandler } from "./runtime.js";
import { HttpsX402Http } from "./x402-http.js";
import { AWAL_PROVIDER_ID, AwalProcessAdapter } from "./awal-process-adapter.js";
import { TtyForegroundAuthentication } from "./foreground-auth.js";
import type {
  ForegroundAuthenticationPort,
  ProviderProfileRepositoryPort,
  ProviderRegistryPort,
  X402PaymentMaterialPort,
} from "./provider-ports.js";
import { ProviderRegistry } from "./provider-registry.js";
import {
  METAMASK_AGENT_WALLET_PROVIDER_ID,
  MetaMaskProcessAdapter,
} from "./metamask-process-adapter.js";
import { StateProfileRepository } from "./profile-repository.js";
import type { ProviderX402TransactionEvidencePort } from "./provider-x402-transaction-port.js";
import {
  EncryptedProviderAuthorizationStore,
  type ProviderAuthorizationStorePort,
} from "./encrypted-provider-authorization-store.js";
import {
  EncryptedSmartAccountPermissionStore,
  type SmartAccountPermissionStorePort,
} from "./encrypted-smart-account-permission-store.js";
import {
  METAMASK_SMART_ACCOUNT_PROVIDER_ID,
  LocalSessionKeyFactory,
  MetaMaskSmartAccountAdapter,
  type SessionKeyFactoryPort,
} from "./metamask-smart-account-adapter.js";
import {
  LoopbackMetaMaskConsent,
  type SmartAccountConsentPort,
} from "./metamask-smart-account-consent.js";
import { EncryptedSmartAccountDirectEffectStore } from "./encrypted-smart-account-direct-effect-store.js";
import {
  MetaMaskSmartAccountDirectAdapter,
  OfficialSmartAccountAllowance,
} from "./metamask-smart-account-direct.js";
import { EncryptedSmartAccountX402MaterialStore } from "./encrypted-smart-account-x402-material-store.js";
import { MetaMaskSmartAccountX402Adapter } from "./metamask-smart-account-x402.js";
import { ChainAccountStore } from "./chain-account-store.js";
import type { ChainWalletStoragePort, DirectRailPort, RailApprovalPort } from "./direct-rail-ports.js";
import type { ChainPolicyApprovalPort } from "./chain-policy.js";
import { TtyChainPolicyApproval, TtyRailApproval } from "./tty-approval.js";
import { SolanaRpc } from "./solana/rpc.js";
import { SolanaLocalAdapter } from "./solana/local-adapter.js";
import { SolanaAwalAdapter } from "./solana/awal-adapter.js";
import { TronLocalAdapter } from "./tron/local-adapter.js";
import { TronRpc } from "./tron/rpc.js";
import { configuredTronHttpsFetch } from "./tron/https.js";
import type { BridgeDependencies } from "./lifi/service.js";
import { LocalBridgeCustody } from "./lifi/custody.js";
import { LifiProvider } from "./lifi/provider.js";
import { bridgeRpcFactory } from "./lifi/rpc.js";
import { CircleV2ApprovalExecutor, LocalCircleApprovalSigner, circleApprovalRpcFromBridge } from "./lifi/circle-v2-approval-executor.js";
import type { CircleV2ApprovalExecutor as CircleApprovalService } from "./lifi/circle-v2-approval-executor.js";
import { OneClickSourceService } from "./lifi/near-oneclick-source-service.js";
import { CircleV2SourceService } from "./lifi/circle-v2-source-service.js";
import { TtyBridgeApproval } from "./lifi/tty.js";
import type { GaslessDependencies } from "./gasless/service.js";
import { GaslessUsdtOperationService } from "./gasless-usdt/service.js";
import { GaslessUsdtCommandPrepare, type UsdtCommandPrepareOptions } from "./gasless-usdt/command-prepare.js";
import { GaslessUsdtCommandExecute, type UsdtCommandExecuteOptions } from "./gasless-usdt/command-execute.js";
import { UsdtOperationRepository } from "./gasless-usdt/operation.js";
import { LocalGaslessCustody } from "./gasless/custody.js";
import { gaslessRpcFactory } from "./gasless/rpc.js";
import { gaslessObservationRpcFactory } from "./gasless/observation-rpc.js";
import { TtyGaslessApproval } from "./gasless/tty.js";
import type { MetaMaskGaslessDependencies } from "./metamask-gasless/service.js";
import { MetaMaskGaslessProviderClient } from "./metamask-gasless/client/index.js";
import { metaMaskGaslessObservationRpcFactory, metaMaskGaslessRpcFactory } from "./metamask-gasless/chain/rpc.js";
import { TtyMetaMaskGaslessApproval } from "./metamask-gasless/tty.js";
import { TtyOperationAbandonApproval, type OperationAbandonApprovalPort } from "./operation-abandon-approval.js";
import type { SmartAccountGaslessDependencies } from "./smart-account-gasless/service.js";
import { smartAccountGaslessRuntime } from "./smart-account-gasless/runtime.js";
import { LocalFacilitatorSigner } from "./facilitator-gasless/custody.js";
import { PayAiFacilitator } from "./facilitator-gasless/facilitator.js";
import { avalancheFacilitatorRpc } from "./facilitator-gasless/rpc.js";
import type { FacilitatorGaslessDependencies } from "./facilitator-gasless/service.js";
import { TtyFacilitatorApproval } from "./facilitator-gasless/tty.js";
import type { UniswapGuardedSwapBuilder } from "./swap/uniswap-service.js";
import type { SunSwapReadOnlyQuoteBuilder } from "./swap/sunswap-tron/command-service.js";
import type { JupiterReadOnlyQuoteBuilder } from "./swap/jupiter-solana/command-service.js";
import { portfolioPause, type PortfolioDependencies } from "./portfolio/command.js";
import { PortfolioHttps } from "./portfolio/https.js";
import { TtyAllowlistPolicyApproval, type AllowlistPolicyApprovalPort } from "./allowlist-policy-activation.js";
import type { CommandRequest } from "./commands.js";
import type { GuardedSwapPolicyResolver, GuardedSwapRuntime } from "./swap/runtime.js";
import { createUniswapKeylessRuntime, lazyEthereumRpcCall, REFUSING_SWAP_APPROVAL } from "./swap/uniswap-v3/runtime-factory.js";
import { createUniswapTokenRuntime } from "./swap/uniswap-v3/token-runtime-factory.js";
import { createTokenRpc } from "./swap/uniswap-v3/token-rpc.js";
import { tokenPrimaryCandidates } from "./swap/uniswap-v3/token-rpc-pool.js";
import type { UniswapTokenCommandRuntime } from "./swap/uniswap-v3/token-execution.js";
import { loadActiveAssetPolicyRegistry } from "./allowlist-active-policy.js";
import { verifyUniswapV3CodePins } from "./swap/uniswap-v3/pins.js";
import { createSunSwapKeylessRuntime } from "./swap/sunswap-tron/runtime-factory.js";
import { createOrcaKeylessRuntime } from "./swap/orca-solana/runtime-factory.js";
import { verifyOrcaProgramPins } from "./swap/orca-solana/pins.js";
import type { OrcaKeylessQuoteRequest } from "./swap/orca-solana/builder.js";
import { StargateNativeService } from "./stargate-v2/native-runtime.js";
import { StargateTokenService } from "./stargate-v2/token-runtime.js";

export interface RuntimeFactoryOptions {
  readonly relayExecute?: RelayExecuteHandler;
  readonly relayExecuteConfirmation?: RelayExecuteConfirmation;
  readonly relayPrepare?: RelayUnsignedPrepareService;
  readonly relayPreparePorts?: RelayPreparePorts;
  readonly relayPreflight?: RelayReadOnlyPreflightService;
  readonly relayPreflightPorts?: RelayPreflightPorts;
  readonly relayStatus?: RelayKeylessStatusService;
  readonly relayStatusFetch?: typeof fetch;
  readonly stargateNative?: StargateNativeService;
  readonly stargateToken?: StargateTokenService;
  readonly portfolio?: PortfolioDependencies;
  readonly uniswapRuntime?: GuardedSwapRuntime<Extract<CommandRequest, { readonly command: "swap.uniswap.quote" }>>;
  readonly uniswapTokenRuntime?: UniswapTokenCommandRuntime;
  readonly sunswapRuntime?: GuardedSwapRuntime<Extract<CommandRequest, { readonly command: "swap.sunswap.quote" }>>;
  readonly orcaRuntime?: GuardedSwapRuntime<OrcaKeylessQuoteRequest>;
  readonly uniswap?: UniswapGuardedSwapBuilder;
  /** Test seam for the owner's active sealed swap policy. Production reads the activated allowlist revision. */
  readonly swapPolicy?: GuardedSwapPolicyResolver;
  readonly sunswap?: SunSwapReadOnlyQuoteBuilder;
  readonly jupiter?: JupiterReadOnlyQuoteBuilder;
  readonly facilitatorGasless?: FacilitatorGaslessDependencies;
  readonly smartAccountGasless?: SmartAccountGaslessDependencies;
  readonly metaMaskGasless?: MetaMaskGaslessDependencies;
  readonly gasless?: GaslessDependencies;
  readonly gaslessUsdt?: GaslessUsdtOperationService;
  readonly gaslessUsdtPrepare?: GaslessUsdtCommandPrepare;
  readonly gaslessUsdtPrepareOptions?: UsdtCommandPrepareOptions;
  readonly gaslessUsdtExecute?: GaslessUsdtCommandExecute;
  readonly gaslessUsdtExecuteOptions?: UsdtCommandExecuteOptions;
  readonly bridge?: BridgeDependencies;
  readonly circleApproval?: CircleApprovalService;
  readonly circleSource?: CircleV2SourceService;
  readonly oneClickSource?: OneClickSourceService;
  readonly chainAccounts?: ChainWalletStoragePort;
  readonly directRails?: readonly DirectRailPort[];
  readonly railApproval?: RailApprovalPort;
  readonly chainPolicyApproval?: ChainPolicyApprovalPort;
  readonly allowlistPolicyApproval?: AllowlistPolicyApprovalPort;
  readonly solanaRpcUrl?: string;
  readonly tronRpcUrl?: string;
  readonly stateRoot?: string;
  readonly native?: NativePort;
  readonly wrappingSecret?: WrappingSecretPort;
  readonly approval?: TransferApprovalPort;
  readonly policy?: ProfilePolicyPort;
  readonly policyApproval?: ProfilePolicyApprovalPort;
  readonly rpc?: RpcPort;
  readonly http?: HttpPort;
  readonly clock?: ClockPort;
  readonly ids?: IdPort;
  readonly wait?: WaitPort;
  readonly profileRepository?: ProviderProfileRepositoryPort;
  readonly providerRegistry?: ProviderRegistryPort;
  readonly foregroundAuthentication?: ForegroundAuthenticationPort;
  readonly providerTransactionEvidence?: ProviderX402TransactionEvidencePort;
  readonly providerAuthorizationStore?: ProviderAuthorizationStorePort;
  readonly smartAccountPermissionStore?: SmartAccountPermissionStorePort;
  readonly smartAccountConsent?: SmartAccountConsentPort;
  readonly smartAccountSessionKeys?: SessionKeyFactoryPort;
  readonly smartAccountX402Material?: X402PaymentMaterialPort;
  readonly operationAbandonApproval?: OperationAbandonApprovalPort;
}

export function createApnCore(bound: BoundCommand, options: RuntimeFactoryOptions = {}): ApnCore {
  const state = new StateStore(options.stateRoot ?? effectiveStateRoot());
  const wrappingSecret = options.wrappingSecret ?? new MacOSLoginKeychainSecret();
  const approvalLimits = bound.request.command === "circle.approval.prepare" ? {
    maxGasLimitAtomic: bound.request.maxGasLimitAtomic, maxFeePerGasWei: bound.request.maxFeePerGasWei,
    maxPriorityFeePerGasWei: bound.request.maxPriorityFeePerGasWei, maxNativeDebitWei: bound.request.maxNativeDebitWei,
    ttlMs: 60_000,
  } : { maxGasLimitAtomic: "100000", maxFeePerGasWei: "2000000000",
    maxPriorityFeePerGasWei: "100000000", maxNativeDebitWei: "200000000000000", ttlMs: 60_000 };
  const chainAccounts = options.chainAccounts ?? new ChainAccountStore(state.root, wrappingSecret);
  const solanaRpc = new SolanaRpc(options.solanaRpcUrl ?? process.env.APN_SOLANA_RPC_URL);
  const tronRpc = new TronRpc(options.tronRpcUrl ?? process.env.APN_TRON_RPC_URL,
    configuredTronHttpsFetch({ minimumPostStartIntervalMs: process.env.APN_TRON_RPC_MIN_POST_INTERVAL_MS }));
  const directRails = options.directRails ?? [new SolanaLocalAdapter(chainAccounts, solanaRpc, () => options.clock?.now() ?? new Date()),
    new SolanaAwalAdapter(chainAccounts, solanaRpc, undefined, undefined, () => options.clock?.now() ?? new Date()),
    new TronLocalAdapter(chainAccounts, tronRpc, () => options.clock?.now() ?? new Date())];
  const native = needsNative(bound.request.command)
    ? options.native ?? new LocalWalletNative(state, wrappingSecret, options.approval)
    : undefined;
  const policy = needsPolicy(bound.request.command)
    ? options.policy ?? new EncryptedProfilePolicy(
        state,
        wrappingSecret,
        options.policyApproval ?? new TtyProfilePolicyApproval(),
        options.clock,
      )
    : undefined;
  const coinbaseRpcUrl = ["gasless.balance", "gasless.transfer.prepare", "gasless.transfer.approve", "operation.resume"].includes(bound.request.command)
    ? process.env.APN_BASE_RPC_URL : undefined;
  const effectiveRpcUrl = bound.rpcUrl;
  const rpc = options.rpc ?? (effectiveRpcUrl === undefined ? undefined : new HttpsBaseRpc(effectiveRpcUrl));
  const coinbaseRpc = options.rpc;
  const http = options.http ?? (needsHttp(bound.request.command) ? new HttpsX402Http() : undefined);
  const profileRepository = options.profileRepository ?? new StateProfileRepository(state);
  const smartAccountPermissionStore = options.smartAccountPermissionStore ??
    new EncryptedSmartAccountPermissionStore(state, wrappingSecret);
  const smartAccountConsent = options.smartAccountConsent ?? new LoopbackMetaMaskConsent();
  const smartAccountAllowance = rpc !== undefined && effectiveRpcUrl !== undefined
    ? new OfficialSmartAccountAllowance(effectiveRpcUrl)
    : undefined;
  const smartAccountDirect = rpc !== undefined && effectiveRpcUrl !== undefined && smartAccountAllowance !== undefined
    ? new MetaMaskSmartAccountDirectAdapter(
        smartAccountPermissionStore,
        new EncryptedSmartAccountDirectEffectStore(state, wrappingSecret),
        rpc,
        smartAccountAllowance,
        undefined,
        () => options.clock?.now() ?? new Date(),
    )
    : undefined;
  const smartAccountX402 = options.smartAccountX402Material ?? (
    rpc !== undefined && smartAccountAllowance !== undefined
      ? new MetaMaskSmartAccountX402Adapter(
          smartAccountPermissionStore,
          new EncryptedSmartAccountX402MaterialStore(state, wrappingSecret),
          rpc,
          smartAccountAllowance,
          undefined,
          () => options.clock?.now() ?? new Date(),
        )
      : undefined
  );
  const providerRegistry = options.providerRegistry ?? new ProviderRegistry([
    {
      provider_id: AWAL_PROVIDER_ID,
      create: () => new AwalProcessAdapter().bundle(),
    },
    {
      provider_id: METAMASK_AGENT_WALLET_PROVIDER_ID,
      create: () => new MetaMaskProcessAdapter(
        undefined,
        async (work) => await state.withLocks([`provider-session:${METAMASK_AGENT_WALLET_PROVIDER_ID}`], work),
      ).bundle(),
    },
    {
      provider_id: METAMASK_SMART_ACCOUNT_PROVIDER_ID,
      create: () => new MetaMaskSmartAccountAdapter(
        smartAccountPermissionStore,
        smartAccountConsent,
        options.smartAccountSessionKeys ?? new LocalSessionKeyFactory(),
        () => options.clock?.now() ?? new Date(),
        smartAccountDirect,
        smartAccountX402,
      ).bundle(),
    },
  ]);
  const foregroundAuthentication = options.foregroundAuthentication ?? (
    bound.request.command === "wallet.connect" && bound.request.providerId !== METAMASK_SMART_ACCOUNT_PROVIDER_ID
      ? new TtyForegroundAuthentication()
      : undefined
  );
  const transferApproval = options.approval ?? (
    bound.request.command === "transfer.approve" ? new TtyTransferApproval() : undefined
  );
  const providerAuthorizationStore = options.providerAuthorizationStore ?? (
    needsProviderAuthorizationStore(bound.request.command)
      ? new EncryptedProviderAuthorizationStore(state, wrappingSecret)
      : undefined
  );
  const clock = options.clock ?? { now: () => new Date() };
  if (bound.request.command === "relay.execute") {
    let endpoint: URL;
    try { endpoint = new URL(bound.rpcUrl ?? ""); }
    catch { throw new ApnError("APN_RPC_CONFIG", "Relay execution requires a credential-free HTTPS RPC origin."); }
    if (endpoint.protocol !== "https:" || endpoint.username !== "" || endpoint.password !== "" ||
      endpoint.pathname !== "/" || endpoint.search !== "" || endpoint.hash !== "") {
      throw new ApnError("APN_RPC_CONFIG", "Relay execution requires a credential-free HTTPS RPC origin.");
    }
  }
  const relayExecuteConfirmation = bound.request.command === "relay.execute"
    ? options.relayExecuteConfirmation ?? ((summary) => new TtyRelayExecuteConfirmation().confirm(summary))
    : undefined;
  // The production source transport remains unavailable until its physical POST budget and pacing
  // are enforced outside the source execution lock. An injected handler is for synthetic tests only.
  const relayExecute = bound.request.command === "relay.execute" ? options.relayExecute : undefined;
  const stargateNative = options.stargateNative ?? (bound.request.command.startsWith("stargate.native.")
    ? new StargateNativeService(state, wrappingSecret, process.env, () => clock.now().getTime()) : undefined);
  const stargateToken = options.stargateToken ?? (bound.request.command.startsWith("stargate.token.")
    ? new StargateTokenService(state, wrappingSecret, process.env, () => clock.now().getTime()) : undefined);
  // Keyless Uniswap is built per swap.uniswap.* command, like bridge and 1Click. Only CLI approve gets a terminal;
  // MCP intercepts approve/execute with a CLI handoff before this factory runs.
  const uniswapRuntime = options.uniswapRuntime ?? (bound.request.command.startsWith("swap.uniswap.") && options.uniswap === undefined
    ? createUniswapKeylessRuntime({ state, wrapping: wrappingSecret, call: lazyEthereumRpcCall(process.env), verifyPins: verifyUniswapV3CodePins, clock,
      // The owner's activated allowlist revision; none active means preparation refuses with swap_owner_admission_required.
      policy: options.swapPolicy ?? (async (profile) => (await loadActiveAssetPolicyRegistry({ state, clock }, profile))?.registry ?? null),
      foreground: bound.request.command === "swap.uniswap.approve" ? "tty" : REFUSING_SWAP_APPROVAL })
    : undefined);
  const uniswapTokenRuntime = options.uniswapTokenRuntime ?? (bound.request.command.startsWith("swap.uniswap-token.")
    ? createUniswapTokenRuntime({ state, wrapping: wrappingSecret, call: createTokenRpc({ environment: process.env, state,
      now: () => clock.now().getTime(), ...uniswapTokenRpcBudget(bound.request.command) }), clock,
      foreground: bound.request.command === "swap.uniswap-token.approve" ? "approve" :
        isUniswapTokenCleanup(bound.request.command) ? "cleanup" : "refuse" })
    : undefined);
  // Keyless SunSwap likewise, over APN_TRON_RPC_URL and the profile's encrypted local TRON wallet.
  const sunswapRuntime = options.sunswapRuntime ?? (bound.request.command.startsWith("swap.sunswap.") && options.sunswap === undefined
    ? createSunSwapKeylessRuntime({ state, rpc: tronRpc, accounts: chainAccounts, clock,
      policy: options.swapPolicy ?? (async (profile) => (await loadActiveAssetPolicyRegistry({ state, clock }, profile))?.registry ?? null),
      foreground: bound.request.command === "swap.sunswap.approve" ? "tty" : REFUSING_SWAP_APPROVAL })
    : undefined);
  // Keyless Orca uses the owner-named APN_SOLANA_RPC_URL rail client and the encrypted local Solana wallet.
  const orcaRuntime = options.orcaRuntime ?? (bound.request.command.startsWith("swap.orca.")
    ? createOrcaKeylessRuntime({ state, clock, rpc: solanaRpc, accounts: chainAccounts, verifyPins: verifyOrcaProgramPins,
      policy: options.swapPolicy ?? (async (profile) => (await loadActiveAssetPolicyRegistry({ state, clock }, profile))?.registry ?? null),
      foreground: bound.request.command === "swap.orca.approve" ? "tty" : REFUSING_SWAP_APPROVAL })
    : undefined);
  return new ApnCore({
    state,
    ...(relayExecute === undefined ? {} : { relayExecute, relayExecuteConfirmation: relayExecuteConfirmation! }),
    ...(stargateNative === undefined ? {} : { stargateNative }),
    ...(stargateToken === undefined ? {} : { stargateToken }),
    // Read-only portfolio only: pinned keyless defaults apply here and nowhere else; money-moving rails keep owner-named RPC.
    ...(bound.request.command === "relay.prepare" || options.relayPrepare !== undefined ? { relayPrepare: options.relayPrepare ?? new RelayUnsignedPrepareService(state, clock, undefined, options.relayPreparePorts) } : {}),
    ...(bound.request.command === "relay.retire" ? { relayRetire: new RelayRetireService(state, clock, wrappingSecret) } : {}),
    ...(bound.request.command === "relay.status" || options.relayStatus !== undefined ? {
      relayStatus: options.relayStatus ?? new RelayKeylessStatusService(state, options.relayStatusFetch),
    } : {}),
    ...(bound.request.command === "relay.preflight" || options.relayPreflight !== undefined ? {
      relayPreflight: options.relayPreflight ?? new RelayReadOnlyPreflightService(state, clock, options.relayPreflightPorts ?? {
        batch: calls => {
          if (rpc === undefined || !(rpc instanceof HttpsBaseRpc)) throw new ApnError("APN_RPC_CONFIG", "Relay preflight requires its explicit HTTPS RPC.");
          return rpc.batchCall(calls);
        },
      }),
    } : {}),
    ...(bound.request.command === "wallet.portfolio" || options.portfolio !== undefined ? {
      portfolio: options.portfolio ?? { environment: process.env, http: new PortfolioHttps(), wait: portfolioPause },
    } : {}),
    ...(uniswapRuntime === undefined ? {} : { uniswapRuntime }),
    ...(uniswapTokenRuntime === undefined ? {} : { uniswapTokenRuntime }),
    ...(sunswapRuntime === undefined ? {} : { sunswapRuntime }),
    ...(orcaRuntime === undefined ? {} : { orcaRuntime }),
    ...(options.uniswap === undefined ? {} : { uniswap: options.uniswap }),
    ...(options.sunswap === undefined ? {} : { sunswap: options.sunswap }),
    ...(options.jupiter === undefined ? {} : { jupiter: options.jupiter }),
    ...(bound.request.command.startsWith("circle.approval.") || options.circleApproval !== undefined ? {
      circleApproval: options.circleApproval ?? new CircleV2ApprovalExecutor(state,
        circleApprovalRpcFromBridge(bridgeRpcFactory(process.env)(8453)),
        new LocalCircleApprovalSigner(state, wrappingSecret), approvalLimits,
        () => options.clock?.now().getTime() ?? Date.now()),
    } : {}),
    ...(bound.request.command.startsWith("oneclick.source.") || options.oneClickSource !== undefined ? {
      oneClickSource: options.oneClickSource ?? new OneClickSourceService(state, wrappingSecret, process.env),
    } : {}),
    ...(bound.request.command === "circle.source.submit" || options.circleSource !== undefined ? {
      circleSource: options.circleSource ?? new CircleV2SourceService(state, wrappingSecret, process.env),
    } : {}),
    facilitatorGasless: options.facilitatorGasless ?? { rpc: () => avalancheFacilitatorRpc(process.env),
      facilitator: new PayAiFacilitator(), signer: new LocalFacilitatorSigner(state, wrappingSecret),
      ...(bound.request.command === "gasless.transfer.approve" ? { approval: new TtyFacilitatorApproval() } : {}) },
    smartAccountGasless: options.smartAccountGasless ?? smartAccountGaslessRuntime({ state,
      permissions: smartAccountPermissionStore, wrapping: wrappingSecret, environment: process.env,
      clock: options.clock ?? { now: () => new Date() }, foregroundApproval: bound.request.command === "gasless.transfer.approve" }),
    metaMaskGasless: options.metaMaskGasless ?? {
      rpcFor: metaMaskGaslessRpcFactory(process.env, options.clock ?? { now: () => new Date() }),
      observationRpcFor: metaMaskGaslessObservationRpcFactory(process.env, options.clock ?? { now: () => new Date() }),
      provider: new MetaMaskGaslessProviderClient({ environment: process.env, clock: options.clock ?? { now: () => new Date() } }),
      ...(bound.request.command === "gasless.transfer.approve" ? { approval: new TtyMetaMaskGaslessApproval() } : {}),
    },
    gasless: options.gasless ?? { rpcFor: gaslessRpcFactory(process.env),
      observationRpcFor: gaslessObservationRpcFactory(process.env),
      custody: new LocalGaslessCustody(state, wrappingSecret, () => options.clock?.now().getTime() ?? Date.now()),
      ...(bound.request.command === "gasless.transfer.approve" ? { approval: new TtyGaslessApproval() } : {}) },
    ...(bound.request.command.startsWith("gasless.usdt.") || options.gaslessUsdt !== undefined ? {
      gaslessUsdt: options.gaslessUsdt ?? new GaslessUsdtOperationService(new UsdtOperationRepository(state.root)),
    } : {}),
    ...(bound.request.command === "gasless.usdt.prepare" || options.gaslessUsdtPrepare !== undefined ? {
      gaslessUsdtPrepare: options.gaslessUsdtPrepare ?? new GaslessUsdtCommandPrepare(state, clock,
        options.gaslessUsdt ?? new GaslessUsdtOperationService(new UsdtOperationRepository(state.root)), options.gaslessUsdtPrepareOptions),
    } : {}),
    ...(["gasless.usdt.execute", "gasless.usdt.execution-status", "gasless.usdt.observe"].includes(bound.request.command) ||
      options.gaslessUsdtExecute !== undefined ? {
      gaslessUsdtExecute: options.gaslessUsdtExecute ?? new GaslessUsdtCommandExecute(state, clock, wrappingSecret,
        options.gaslessUsdtExecuteOptions),
    } : {}),
    bridge: options.bridge ?? { provider: new LifiProvider(), rpcFor: bridgeRpcFactory(process.env),
      lineaArchiveDeploymentScalarCode: bound.request.command === "bridge.prepare" &&
        process.env.APN_LIFI_LINEA_ARCHIVE_SCALAR_CODE === "1",
      custody: new LocalBridgeCustody(state, wrappingSecret, () => options.clock?.now().getTime() ?? Date.now()),
      ...(bound.request.command === "bridge.approve" ? { approval: new TtyBridgeApproval() } : {}) },
    chainAccounts, directRails,
    ...(bound.request.command === "transfer.approve" || options.railApproval !== undefined ? { railApproval: options.railApproval ?? new TtyRailApproval() } : {}),
    ...(bound.request.command === "policy.admit-solana" || bound.request.command === "policy.admit-tron" || options.chainPolicyApproval !== undefined ? { chainPolicyApproval: options.chainPolicyApproval ?? new TtyChainPolicyApproval() } : {}),
    ...(bound.request.command === "allowlist.policy.activate" || bound.request.command === "allowlist.policy.revoke" ||
      options.allowlistPolicyApproval !== undefined
      ? { allowlistPolicyApproval: options.allowlistPolicyApproval ?? new TtyAllowlistPolicyApproval() } : {}),
    profileRepository,
    providerRegistry,
    ...(foregroundAuthentication === undefined ? {} : { foregroundAuthentication }),
    ...(transferApproval === undefined ? {} : { transferApproval }),
    ...(effectiveRpcUrl === undefined ? {} : { rpcUrl: effectiveRpcUrl }),
    ...(coinbaseRpcUrl === undefined ? {} : { coinbaseRpcUrl }),
    ...(native === undefined ? {} : { native }),
    ...(bound.request.command === "doctor.keychain" ? { keychainProbe: wrappingSecret } : {}),
    ...(rpc === undefined ? {} : { rpc }),
    ...(coinbaseRpc === undefined ? {} : { coinbaseRpc }),
    ...(coinbaseRpcUrl === undefined || coinbaseRpc !== undefined ? {} : { coinbaseRpcFactory: () => new HttpsBaseRpc(coinbaseRpcUrl) }),
    ...(http === undefined ? {} : { http }),
    ...(policy === undefined ? {} : { policy }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.ids === undefined ? {} : { ids: options.ids }),
    ...(options.wait === undefined ? {} : { wait: options.wait }),
    ...(options.providerTransactionEvidence === undefined ? {} : { providerTransactionEvidence: options.providerTransactionEvidence }),
    ...(providerAuthorizationStore === undefined ? {} : { providerAuthorizationStore }),
    ...(bound.request.command === "operation.abandon" || options.operationAbandonApproval !== undefined
      ? { operationAbandonApproval: options.operationAbandonApproval ?? new TtyOperationAbandonApproval() }
      : {}),
  });
}

function isUniswapTokenCleanup(command: string): boolean { return command === "swap.uniswap-token.cleanup"; }
function uniswapTokenRpcBudget(command: string): { readonly maxHttpRequests: number; readonly deadlineMs: number } {
  if (command === "swap.uniswap-token.inventory") return { maxHttpRequests: 1, deadlineMs: 1_000 };
  const overhead = process.env.APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS === undefined || process.env.APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS === ""
    ? 0 : tokenPrimaryCandidates(process.env).length;
  if (command === "swap.uniswap-token.quote") return { maxHttpRequests: (overhead === 0 ? 8 : 7 + overhead), deadlineMs: 60_000 };
  if (command === "swap.uniswap-token.prepare") return { maxHttpRequests: (overhead === 0 ? 9 : 8 + overhead), deadlineMs: 60_000 };
  if (command === "swap.uniswap-token.approve") return { maxHttpRequests: 14 + overhead, deadlineMs: 90_000 };
  if (command === "swap.uniswap-token.execute") return { maxHttpRequests: 24, deadlineMs: 150_000 };
  if (command === "swap.uniswap-token.status") return { maxHttpRequests: 8 + overhead, deadlineMs: 45_000 };
  return { maxHttpRequests: 14 + overhead, deadlineMs: 90_000 };
}

export async function executeBoundCommand(
  bound: BoundCommand,
  options: RuntimeFactoryOptions = {},
): Promise<OutputEnvelope> {
  return await createApnCore(bound, options).execute(bound.request);
}

export function effectiveStateRoot(): string {
  return resolve(userInfo().homedir, ".apn");
}

function needsNative(command: string): boolean {
  return [
    "doctor.keychain", "wallet.ensure", "wallet.import", "wallet.status", "transfer.approve", "x402.fetch.approve", "operation.resume",
  ].includes(command);
}

function needsPolicy(command: string): boolean {
  return [
    "wallet.balance", "wallet.policy.show", "wallet.policy.set", "x402.fetch.prepare",
    "x402.fetch.approve", "operation.resume",
  ].includes(command);
}

function needsHttp(command: string): boolean {
  return ["x402.inspect", "x402.fetch.prepare", "x402.fetch.approve", "operation.resume"].includes(command);
}

function needsProviderAuthorizationStore(command: string): boolean {
  return ["x402.fetch.approve", "operation.resume"].includes(command);
}
