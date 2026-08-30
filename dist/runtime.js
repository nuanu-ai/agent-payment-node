import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as waitFor } from "node:timers/promises";
import { NATIVE_IPC_VERSION } from "./constants.js";
import { ApnError } from "./errors.js";
export class RuntimeContext {
    state;
    native;
    keychainProbe;
    rpc;
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
    providerX402Repository;
    initialized;
    constructor(dependencies) {
        this.state = dependencies.state;
        if (dependencies.native !== undefined)
            this.native = dependencies.native;
        if (dependencies.keychainProbe !== undefined)
            this.keychainProbe = dependencies.keychainProbe;
        if (dependencies.rpc !== undefined)
            this.rpc = dependencies.rpc;
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
        if (dependencies.providerX402Repository !== undefined)
            this.providerX402Repository = dependencies.providerX402Repository;
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
    requireRpc() {
        if (this.rpc === undefined) {
            throw new ApnError("APN_RPC_CONFIG", "This command requires an explicit HTTPS Base RPC endpoint.");
        }
        return this.rpc;
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
    requireTransferApproval() {
        if (this.transferApproval === undefined) {
            throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "A foreground terminal is required for direct-transfer approval.");
        }
        return this.transferApproval;
    }
    requireRpcUrl() {
        if (this.rpcUrl === undefined)
            throw new ApnError("APN_RPC_CONFIG", "This command requires an explicit HTTPS Base RPC endpoint.");
        return this.rpcUrl;
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