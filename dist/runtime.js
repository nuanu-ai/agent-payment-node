import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as waitFor } from "node:timers/promises";
import { NATIVE_IPC_VERSION } from "./constants.js";
import { ApnError } from "./errors.js";
import { BASE_RPC_CHAIN, rpcUrlRequired } from "./rpc-requirement.js";
export class RuntimeContext {
    relayPrepare;
    relayRetire;
    relayStatus;
    relayObserve;
    relayBaseObserve;
    relayArbitrumObserve;
    relayArbitrumApprovalDecision;
    relayArbitrumApprovalExecute;
    relayArbitrumDepositDispatch;
    relayExecute;
    relayNativeExecute;
    relayExecuteConfirmation;
    stargateNative;
    circleFundingEvm;
    stargateToken;
    portfolio;
    uniswapRuntime;
    uniswapTokenRuntime;
    sunswapRuntime;
    orcaRuntime;
    /** Finish-only exits of stable USDC to USDT operations a released version prepared (SWAP-10). */
    orcaStableLegacy;
    /** Solana x402 ports for the generic operation commands that delegate to `x402.solana.observe`. */
    x402Solana;
    jupiterV1Runtime;
    facilitatorGasless;
    smartAccountGasless;
    metaMaskGasless;
    gasless;
    gaslessUsdt;
    gaslessUsdtPrepare;
    gaslessUsdtExecute;
    bridge;
    circleApproval;
    circleSource;
    oneClickSource;
    seiFunding;
    megaFunding;
    directRails;
    chainAccounts;
    railApproval;
    chainPolicyApproval;
    allowlistPolicyApproval;
    state;
    native;
    keychainProbe;
    rpc;
    coinbaseRpc;
    http;
    clock;
    ids;
    policy;
    wait;
    profileRepository;
    providerRegistry;
    foregroundAuthentication;
    transferApproval;
    rpcUrl;
    coinbaseRpcUrl;
    providerX402Repository;
    providerTransactionEvidence;
    providerAuthorizationStore;
    operationAbandonApproval;
    finalizedRead;
    coinbaseRpcFactory;
    coinbaseRpcInstance;
    initialized;
    constructor(dependencies) {
        if (dependencies.relayPrepare !== undefined)
            this.relayPrepare = dependencies.relayPrepare;
        if (dependencies.relayRetire !== undefined)
            this.relayRetire = dependencies.relayRetire;
        if (dependencies.relayStatus !== undefined)
            this.relayStatus = dependencies.relayStatus;
        if (dependencies.relayObserve !== undefined)
            this.relayObserve = dependencies.relayObserve;
        if (dependencies.relayBaseObserve !== undefined)
            this.relayBaseObserve = dependencies.relayBaseObserve;
        if (dependencies.relayArbitrumObserve !== undefined)
            this.relayArbitrumObserve = dependencies.relayArbitrumObserve;
        if (dependencies.relayArbitrumApprovalDecision !== undefined)
            this.relayArbitrumApprovalDecision = dependencies.relayArbitrumApprovalDecision;
        if (dependencies.relayArbitrumApprovalExecute !== undefined)
            this.relayArbitrumApprovalExecute = dependencies.relayArbitrumApprovalExecute;
        if (dependencies.relayArbitrumDepositDispatch !== undefined)
            this.relayArbitrumDepositDispatch = dependencies.relayArbitrumDepositDispatch;
        if (dependencies.relayExecute !== undefined)
            this.relayExecute = dependencies.relayExecute;
        if (dependencies.relayNativeExecute !== undefined)
            this.relayNativeExecute = dependencies.relayNativeExecute;
        if (dependencies.relayExecuteConfirmation !== undefined)
            this.relayExecuteConfirmation = dependencies.relayExecuteConfirmation;
        if (dependencies.stargateNative !== undefined)
            this.stargateNative = dependencies.stargateNative;
        if (dependencies.circleFundingEvm !== undefined)
            this.circleFundingEvm = dependencies.circleFundingEvm;
        if (dependencies.stargateToken !== undefined)
            this.stargateToken = dependencies.stargateToken;
        if (dependencies.portfolio !== undefined)
            this.portfolio = dependencies.portfolio;
        if (dependencies.uniswapRuntime !== undefined)
            this.uniswapRuntime = dependencies.uniswapRuntime;
        if (dependencies.uniswapTokenRuntime !== undefined)
            this.uniswapTokenRuntime = dependencies.uniswapTokenRuntime;
        if (dependencies.sunswapRuntime !== undefined)
            this.sunswapRuntime = dependencies.sunswapRuntime;
        if (dependencies.orcaRuntime !== undefined)
            this.orcaRuntime = dependencies.orcaRuntime;
        if (dependencies.orcaStableLegacy !== undefined)
            this.orcaStableLegacy = dependencies.orcaStableLegacy;
        if (dependencies.x402Solana !== undefined)
            this.x402Solana = dependencies.x402Solana;
        if (dependencies.jupiterV1Runtime !== undefined)
            this.jupiterV1Runtime = dependencies.jupiterV1Runtime;
        if (dependencies.facilitatorGasless !== undefined)
            this.facilitatorGasless = dependencies.facilitatorGasless;
        if (dependencies.smartAccountGasless !== undefined)
            this.smartAccountGasless = dependencies.smartAccountGasless;
        if (dependencies.metaMaskGasless !== undefined)
            this.metaMaskGasless = dependencies.metaMaskGasless;
        if (dependencies.gasless !== undefined)
            this.gasless = dependencies.gasless;
        if (dependencies.gaslessUsdt !== undefined)
            this.gaslessUsdt = dependencies.gaslessUsdt;
        if (dependencies.gaslessUsdtPrepare !== undefined)
            this.gaslessUsdtPrepare = dependencies.gaslessUsdtPrepare;
        if (dependencies.gaslessUsdtExecute !== undefined)
            this.gaslessUsdtExecute = dependencies.gaslessUsdtExecute;
        if (dependencies.bridge !== undefined)
            this.bridge = dependencies.bridge;
        if (dependencies.circleApproval !== undefined)
            this.circleApproval = dependencies.circleApproval;
        if (dependencies.circleSource !== undefined)
            this.circleSource = dependencies.circleSource;
        if (dependencies.seiFunding !== undefined)
            this.seiFunding = dependencies.seiFunding;
        if (dependencies.megaFunding !== undefined)
            this.megaFunding = dependencies.megaFunding;
        if (dependencies.oneClickSource !== undefined)
            this.oneClickSource = dependencies.oneClickSource;
        this.directRails = dependencies.directRails ?? [];
        if (dependencies.chainAccounts !== undefined)
            this.chainAccounts = dependencies.chainAccounts;
        if (dependencies.railApproval !== undefined)
            this.railApproval = dependencies.railApproval;
        if (dependencies.chainPolicyApproval !== undefined)
            this.chainPolicyApproval = dependencies.chainPolicyApproval;
        if (dependencies.allowlistPolicyApproval !== undefined)
            this.allowlistPolicyApproval = dependencies.allowlistPolicyApproval;
        this.state = dependencies.state;
        if (dependencies.native !== undefined)
            this.native = dependencies.native;
        if (dependencies.keychainProbe !== undefined)
            this.keychainProbe = dependencies.keychainProbe;
        if (dependencies.rpc !== undefined)
            this.rpc = dependencies.rpc;
        if (dependencies.coinbaseRpc !== undefined)
            this.coinbaseRpc = dependencies.coinbaseRpc;
        if (dependencies.coinbaseRpcFactory !== undefined)
            this.coinbaseRpcFactory = dependencies.coinbaseRpcFactory;
        if (dependencies.http !== undefined)
            this.http = dependencies.http;
        this.clock = dependencies.clock ?? { now: () => new Date() };
        this.ids = dependencies.ids ?? { next: () => randomUUID() };
        if (dependencies.policy !== undefined)
            this.policy = dependencies.policy;
        this.wait = dependencies.wait ?? new ProcessWaitPort();
        if (dependencies.profileRepository !== undefined)
            this.profileRepository = dependencies.profileRepository;
        if (dependencies.providerRegistry !== undefined)
            this.providerRegistry = dependencies.providerRegistry;
        if (dependencies.foregroundAuthentication !== undefined)
            this.foregroundAuthentication = dependencies.foregroundAuthentication;
        if (dependencies.transferApproval !== undefined)
            this.transferApproval = dependencies.transferApproval;
        if (dependencies.rpcUrl !== undefined)
            this.rpcUrl = dependencies.rpcUrl;
        if (dependencies.coinbaseRpcUrl !== undefined)
            this.coinbaseRpcUrl = dependencies.coinbaseRpcUrl;
        if (dependencies.providerX402Repository !== undefined)
            this.providerX402Repository = dependencies.providerX402Repository;
        if (dependencies.providerTransactionEvidence !== undefined)
            this.providerTransactionEvidence = dependencies.providerTransactionEvidence;
        if (dependencies.providerAuthorizationStore !== undefined)
            this.providerAuthorizationStore = dependencies.providerAuthorizationStore;
        if (dependencies.operationAbandonApproval !== undefined)
            this.operationAbandonApproval = dependencies.operationAbandonApproval;
        if (dependencies.finalizedRead !== undefined)
            this.finalizedRead = dependencies.finalizedRead;
    }
    async ready() {
        this.initialized ??= this.state.initialize();
        await this.initialized;
    }
    requireNative() {
        if (this.native === undefined) {
            throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "This command must run as a child of the signed native app host.");
        }
        return this.native;
    }
    requireKeychainProbe() {
        if (this.keychainProbe === undefined) {
            throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "This command requires the read-only login Keychain probe.");
        }
        return this.keychainProbe;
    }
    /** The command's single `--rpc-url` endpoint; a missing one is refused naming the chain this command reads. */
    requireRpc(chain) {
        if (this.rpc === undefined)
            throw rpcUrlRequired(chain);
        return this.rpc;
    }
    requireCoinbaseRpc() {
        if (this.coinbaseRpc !== undefined)
            return this.coinbaseRpc;
        if (this.coinbaseRpcFactory !== undefined)
            return this.coinbaseRpcInstance ??= this.coinbaseRpcFactory();
        return this.requireRpc(BASE_RPC_CHAIN);
    }
    requireHttp() {
        if (this.http === undefined) {
            throw new ApnError("APN_HTTP_CONFIG", "This command requires the fail-closed seller HTTPS adapter.");
        }
        return this.http;
    }
    requirePolicy() {
        if (this.policy === undefined) {
            throw new ApnError("APN_WALLET_POLICY_REQUIRED", "This command requires the encrypted profile policy store.");
        }
        return this.policy;
    }
    requireProfileRepository() {
        if (this.profileRepository === undefined)
            throw new ApnError("APN_INTERNAL", "Provider profile repository is unavailable.");
        return this.profileRepository;
    }
    requireProviderRegistry() {
        if (this.providerRegistry === undefined)
            throw new ApnError("APN_INTERNAL", "Provider registry is unavailable.");
        return this.providerRegistry;
    }
    requireForegroundAuthentication() {
        if (this.foregroundAuthentication === undefined) {
            throw new ApnError("APN_FOREGROUND_AUTH_REQUIRED", "A foreground terminal is required for wallet provider authentication.");
        }
        return this.foregroundAuthentication;
    }
    requireOperationAbandonApproval() {
        if (this.operationAbandonApproval === undefined) {
            throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Unknown-effect abandonment requires exact foreground terminal confirmation.");
        }
        return this.operationAbandonApproval;
    }
    requireTransferApproval() {
        if (this.transferApproval === undefined) {
            throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "A foreground terminal is required for direct-transfer approval.");
        }
        return this.transferApproval;
    }
    requireRpcUrl(chain) {
        if (this.rpcUrl === undefined)
            throw rpcUrlRequired(chain);
        return this.rpcUrl;
    }
    requireCoinbaseRpcUrl() {
        if (this.coinbaseRpcUrl !== undefined)
            return this.coinbaseRpcUrl;
        return this.requireRpcUrl(BASE_RPC_CHAIN);
    }
    requireProviderAuthorizationStore() {
        if (this.providerAuthorizationStore === undefined) {
            throw new ApnError("APN_INTERNAL", "The encrypted provider authorization store is unavailable.");
        }
        return this.providerAuthorizationStore;
    }
    nativeRequest(operation, payload) {
        return { version: NATIVE_IPC_VERSION, requestId: this.ids.next(), operation, payload };
    }
}
class ProcessWaitPort {
    nowMs() { return performance.now(); }
    async wait(milliseconds) {
        const controller = new AbortController();
        const onSigint = () => controller.abort();
        process.once("SIGINT", onSigint);
        try {
            await waitFor(milliseconds, undefined, { signal: controller.signal });
            return "elapsed";
        }
        catch (error) {
            if (controller.signal.aborted)
                return "interrupted";
            throw error;
        }
        finally {
            process.off("SIGINT", onSigint);
        }
    }
}
//# sourceMappingURL=runtime.js.map