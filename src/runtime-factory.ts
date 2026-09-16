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
import { TtyTransferApproval } from "./tty-approval.js";
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
import type { BridgeDependencies } from "./lifi/service.js";
import { LocalBridgeCustody } from "./lifi/custody.js";
import { LifiProvider } from "./lifi/provider.js";
import { bridgeRpcFactory } from "./lifi/rpc.js";
import { CircleV2ApprovalExecutor, LocalCircleApprovalSigner, circleApprovalRpcFromBridge } from "./lifi/circle-v2-approval-executor.js";
import type { CircleV2ApprovalExecutor as CircleApprovalService } from "./lifi/circle-v2-approval-executor.js";
import { CircleV2SourceService } from "./lifi/circle-v2-source-service.js";
import { TtyCircleV2SourceApproval } from "./lifi/circle-v2-source-tty.js";
import { TtyBridgeApproval } from "./lifi/tty.js";
import type { GaslessDependencies } from "./gasless/service.js";
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

export interface RuntimeFactoryOptions {
  readonly facilitatorGasless?: FacilitatorGaslessDependencies;
  readonly smartAccountGasless?: SmartAccountGaslessDependencies;
  readonly metaMaskGasless?: MetaMaskGaslessDependencies;
  readonly gasless?: GaslessDependencies;
  readonly bridge?: BridgeDependencies;
  readonly circleApproval?: CircleApprovalService;
  readonly circleSource?: CircleV2SourceService;
  readonly chainAccounts?: ChainWalletStoragePort;
  readonly directRails?: readonly DirectRailPort[];
  readonly railApproval?: RailApprovalPort;
  readonly chainPolicyApproval?: ChainPolicyApprovalPort;
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
  const tronRpc = new TronRpc(options.tronRpcUrl ?? process.env.APN_TRON_RPC_URL);
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
  return new ApnCore({
    state,
    ...(bound.request.command.startsWith("circle.approval.") || options.circleApproval !== undefined ? {
      circleApproval: options.circleApproval ?? new CircleV2ApprovalExecutor(state,
        circleApprovalRpcFromBridge(bridgeRpcFactory(process.env)(8453)),
        new LocalCircleApprovalSigner(state, wrappingSecret), approvalLimits,
        () => options.clock?.now().getTime() ?? Date.now()),
    } : {}),
    ...(bound.request.command === "circle.source.submit" || options.circleSource !== undefined ? {
      circleSource: options.circleSource ?? new CircleV2SourceService(state, wrappingSecret, process.env, new TtyCircleV2SourceApproval()),
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
    bridge: options.bridge ?? { provider: new LifiProvider(), rpcFor: bridgeRpcFactory(process.env),
      custody: new LocalBridgeCustody(state, wrappingSecret, () => options.clock?.now().getTime() ?? Date.now()),
      ...(bound.request.command === "bridge.approve" ? { approval: new TtyBridgeApproval() } : {}) },
    chainAccounts, directRails,
    ...(bound.request.command === "transfer.approve" || options.railApproval !== undefined ? { railApproval: options.railApproval ?? new TtyRailApproval() } : {}),
    ...(bound.request.command === "policy.admit-solana" || bound.request.command === "policy.admit-tron" || options.chainPolicyApproval !== undefined ? { chainPolicyApproval: options.chainPolicyApproval ?? new TtyChainPolicyApproval() } : {}),
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
