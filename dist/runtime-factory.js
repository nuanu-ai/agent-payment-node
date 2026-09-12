import { userInfo } from "node:os";
import { resolve } from "node:path";
import { ApnCore } from "./core.js";
import { EncryptedProfilePolicy } from "./encrypted-profile-policy.js";
import { LocalWalletNative } from "./local-wallet-native.js";
import { MacOSLoginKeychainSecret } from "./macos-keychain.js";
import { TtyProfilePolicyApproval } from "./policy-approval.js";
import { HttpsBaseRpc } from "./rpc.js";
import { StateStore } from "./state.js";
import { TtyTransferApproval } from "./tty-approval.js";
import { HttpsX402Http } from "./x402-http.js";
import { AWAL_PROVIDER_ID, AwalProcessAdapter } from "./awal-process-adapter.js";
import { TtyForegroundAuthentication } from "./foreground-auth.js";
import { ProviderRegistry } from "./provider-registry.js";
import { METAMASK_AGENT_WALLET_PROVIDER_ID, MetaMaskProcessAdapter, } from "./metamask-process-adapter.js";
import { StateProfileRepository } from "./profile-repository.js";
import { EncryptedProviderAuthorizationStore, } from "./encrypted-provider-authorization-store.js";
import { EncryptedSmartAccountPermissionStore, } from "./encrypted-smart-account-permission-store.js";
import { METAMASK_SMART_ACCOUNT_PROVIDER_ID, LocalSessionKeyFactory, MetaMaskSmartAccountAdapter, } from "./metamask-smart-account-adapter.js";
import { LoopbackMetaMaskConsent, } from "./metamask-smart-account-consent.js";
import { EncryptedSmartAccountDirectEffectStore } from "./encrypted-smart-account-direct-effect-store.js";
import { MetaMaskSmartAccountDirectAdapter, OfficialSmartAccountAllowance, } from "./metamask-smart-account-direct.js";
import { EncryptedSmartAccountX402MaterialStore } from "./encrypted-smart-account-x402-material-store.js";
import { MetaMaskSmartAccountX402Adapter } from "./metamask-smart-account-x402.js";
import { ChainAccountStore } from "./chain-account-store.js";
import { TtyChainPolicyApproval, TtyRailApproval } from "./tty-approval.js";
import { SolanaRpc } from "./solana/rpc.js";
import { SolanaLocalAdapter } from "./solana/local-adapter.js";
import { SolanaAwalAdapter } from "./solana/awal-adapter.js";
import { TronLocalAdapter } from "./tron/local-adapter.js";
import { TronRpc } from "./tron/rpc.js";
import { LocalBridgeCustody } from "./lifi/custody.js";
import { LifiProvider } from "./lifi/provider.js";
import { bridgeRpcFactory } from "./lifi/rpc.js";
import { TtyBridgeApproval } from "./lifi/tty.js";
import { LocalGaslessCustody } from "./gasless/custody.js";
import { gaslessRpcFactory } from "./gasless/rpc.js";
import { gaslessObservationRpcFactory } from "./gasless/observation-rpc.js";
import { TtyGaslessApproval } from "./gasless/tty.js";
import { MetaMaskGaslessProviderClient } from "./metamask-gasless/client/index.js";
import { metaMaskGaslessRpcFactory } from "./metamask-gasless/chain/rpc.js";
import { TtyMetaMaskGaslessApproval } from "./metamask-gasless/tty.js";
import { TtyOperationAbandonApproval } from "./operation-abandon-approval.js";
import { smartAccountGaslessRuntime } from "./smart-account-gasless/runtime.js";
export function createApnCore(bound, options = {}) {
    const state = new StateStore(options.stateRoot ?? effectiveStateRoot());
    const wrappingSecret = options.wrappingSecret ?? new MacOSLoginKeychainSecret();
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
        ? options.policy ?? new EncryptedProfilePolicy(state, wrappingSecret, options.policyApproval ?? new TtyProfilePolicyApproval(), options.clock)
        : undefined;
    const gaslessBaseRpcUrl = ["gasless.transfer.prepare", "gasless.transfer.approve", "operation.resume"].includes(bound.request.command)
        ? process.env.APN_BASE_RPC_URL : undefined;
    const effectiveRpcUrl = bound.rpcUrl ?? gaslessBaseRpcUrl;
    const rpc = options.rpc ?? (effectiveRpcUrl === undefined ? undefined : new HttpsBaseRpc(effectiveRpcUrl));
    const http = options.http ?? (needsHttp(bound.request.command) ? new HttpsX402Http() : undefined);
    const profileRepository = options.profileRepository ?? new StateProfileRepository(state);
    const smartAccountPermissionStore = options.smartAccountPermissionStore ??
        new EncryptedSmartAccountPermissionStore(state, wrappingSecret);
    const smartAccountConsent = options.smartAccountConsent ?? new LoopbackMetaMaskConsent();
    const smartAccountAllowance = rpc !== undefined && effectiveRpcUrl !== undefined
        ? new OfficialSmartAccountAllowance(effectiveRpcUrl)
        : undefined;
    const smartAccountDirect = rpc !== undefined && effectiveRpcUrl !== undefined && smartAccountAllowance !== undefined
        ? new MetaMaskSmartAccountDirectAdapter(smartAccountPermissionStore, new EncryptedSmartAccountDirectEffectStore(state, wrappingSecret), rpc, smartAccountAllowance, undefined, () => options.clock?.now() ?? new Date())
        : undefined;
    const smartAccountX402 = options.smartAccountX402Material ?? (rpc !== undefined && smartAccountAllowance !== undefined
        ? new MetaMaskSmartAccountX402Adapter(smartAccountPermissionStore, new EncryptedSmartAccountX402MaterialStore(state, wrappingSecret), rpc, smartAccountAllowance, undefined, () => options.clock?.now() ?? new Date())
        : undefined);
    const providerRegistry = options.providerRegistry ?? new ProviderRegistry([
        {
            provider_id: AWAL_PROVIDER_ID,
            create: () => new AwalProcessAdapter().bundle(),
        },
        {
            provider_id: METAMASK_AGENT_WALLET_PROVIDER_ID,
            create: () => new MetaMaskProcessAdapter(undefined, async (work) => await state.withLocks([`provider-session:${METAMASK_AGENT_WALLET_PROVIDER_ID}`], work)).bundle(),
        },
        {
            provider_id: METAMASK_SMART_ACCOUNT_PROVIDER_ID,
            create: () => new MetaMaskSmartAccountAdapter(smartAccountPermissionStore, smartAccountConsent, options.smartAccountSessionKeys ?? new LocalSessionKeyFactory(), () => options.clock?.now() ?? new Date(), smartAccountDirect, smartAccountX402).bundle(),
        },
    ]);
    const foregroundAuthentication = options.foregroundAuthentication ?? (bound.request.command === "wallet.connect" && bound.request.providerId !== METAMASK_SMART_ACCOUNT_PROVIDER_ID
        ? new TtyForegroundAuthentication()
        : undefined);
    const transferApproval = options.approval ?? (bound.request.command === "transfer.approve" ? new TtyTransferApproval() : undefined);
    const providerAuthorizationStore = options.providerAuthorizationStore ?? (needsProviderAuthorizationStore(bound.request.command)
        ? new EncryptedProviderAuthorizationStore(state, wrappingSecret)
        : undefined);
    return new ApnCore({
        state,
        smartAccountGasless: options.smartAccountGasless ?? smartAccountGaslessRuntime({ state,
            permissions: smartAccountPermissionStore, wrapping: wrappingSecret, environment: process.env,
            clock: options.clock ?? { now: () => new Date() }, foregroundApproval: bound.request.command === "gasless.transfer.approve" }),
        metaMaskGasless: options.metaMaskGasless ?? {
            rpcFor: metaMaskGaslessRpcFactory(process.env, options.clock ?? { now: () => new Date() }),
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
        ...(bound.request.command === "operation.abandon" || options.operationAbandonApproval !== undefined
            ? { operationAbandonApproval: options.operationAbandonApproval ?? new TtyOperationAbandonApproval() }
            : {}),
    });
}
export async function executeBoundCommand(bound, options = {}) {
    return await createApnCore(bound, options).execute(bound.request);
}
export function effectiveStateRoot() {
    return resolve(userInfo().homedir, ".apn");
}
function needsNative(command) {
    return [
        "doctor.keychain", "wallet.ensure", "wallet.status", "transfer.approve", "x402.fetch.approve", "operation.resume",
    ].includes(command);
}
function needsPolicy(command) {
    return [
        "wallet.balance", "wallet.policy.show", "wallet.policy.set", "x402.fetch.prepare",
        "x402.fetch.approve", "operation.resume",
    ].includes(command);
}
function needsHttp(command) {
    return ["x402.inspect", "x402.fetch.prepare", "x402.fetch.approve", "operation.resume"].includes(command);
}
function needsProviderAuthorizationStore(command) {
    return ["x402.fetch.approve", "operation.resume"].includes(command);
}
//# sourceMappingURL=runtime-factory.js.map