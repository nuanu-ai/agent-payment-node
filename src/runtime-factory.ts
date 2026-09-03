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

export interface RuntimeFactoryOptions {
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
}

export function createApnCore(bound: BoundCommand, options: RuntimeFactoryOptions = {}): ApnCore {
  const state = new StateStore(options.stateRoot ?? effectiveStateRoot());
  const wrappingSecret = options.wrappingSecret ?? new MacOSLoginKeychainSecret();
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
  const rpc = options.rpc ?? (bound.rpcUrl === undefined ? undefined : new HttpsBaseRpc(bound.rpcUrl));
  const http = options.http ?? (needsHttp(bound.request.command) ? new HttpsX402Http() : undefined);
  const profileRepository = options.profileRepository ?? new StateProfileRepository(state);
  const smartAccountPermissionStore = options.smartAccountPermissionStore ??
    new EncryptedSmartAccountPermissionStore(state, wrappingSecret);
  const smartAccountConsent = options.smartAccountConsent ?? new LoopbackMetaMaskConsent();
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
        options.clock?.now ?? (() => new Date()),
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
    profileRepository,
    providerRegistry,
    ...(foregroundAuthentication === undefined ? {} : { foregroundAuthentication }),
    ...(transferApproval === undefined ? {} : { transferApproval }),
    ...(bound.rpcUrl === undefined ? {} : { rpcUrl: bound.rpcUrl }),
    ...(native === undefined ? {} : { native }),
    ...(bound.request.command === "doctor.keychain" ? { keychainProbe: wrappingSecret } : {}),
    ...(rpc === undefined ? {} : { rpc }),
    ...(http === undefined ? {} : { http }),
    ...(policy === undefined ? {} : { policy }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.ids === undefined ? {} : { ids: options.ids }),
    ...(options.wait === undefined ? {} : { wait: options.wait }),
    ...(options.providerTransactionEvidence === undefined ? {} : { providerTransactionEvidence: options.providerTransactionEvidence }),
    ...(providerAuthorizationStore === undefined ? {} : { providerAuthorizationStore }),
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
    "doctor.keychain", "wallet.ensure", "wallet.status", "transfer.approve", "x402.fetch.approve", "operation.resume",
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
