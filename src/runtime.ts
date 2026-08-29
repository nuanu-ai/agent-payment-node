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

export interface CoreDependencies {
  readonly state: StateStore;
  readonly native?: NativePort;
  readonly keychainProbe?: Pick<WrappingSecretPort, "load">;
  readonly rpc?: RpcPort;
  readonly http?: HttpPort;
  readonly clock?: ClockPort;
  readonly ids?: IdPort;
  readonly policy?: ProfilePolicyPort;
  readonly wait?: WaitPort;
  readonly profileRepository?: ProviderProfileRepositoryPort;
  readonly providerRegistry?: ProviderRegistryPort;
  readonly foregroundAuthentication?: ForegroundAuthenticationPort;
}

export class RuntimeContext {
  readonly state: StateStore;
  readonly native?: NativePort;
  readonly keychainProbe?: Pick<WrappingSecretPort, "load">;
  readonly rpc?: RpcPort;
  readonly http?: HttpPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly policy?: ProfilePolicyPort;
  readonly wait: WaitPort;
  readonly profileRepository?: ProviderProfileRepositoryPort;
  readonly providerRegistry?: ProviderRegistryPort;
  readonly foregroundAuthentication?: ForegroundAuthenticationPort;
  private initialized: Promise<void> | undefined;

  constructor(dependencies: CoreDependencies) {
    this.state = dependencies.state;
    if (dependencies.native !== undefined) this.native = dependencies.native;
    if (dependencies.keychainProbe !== undefined) this.keychainProbe = dependencies.keychainProbe;
    if (dependencies.rpc !== undefined) this.rpc = dependencies.rpc;
    if (dependencies.http !== undefined) this.http = dependencies.http;
    this.clock = dependencies.clock ?? { now: () => new Date() };
    this.ids = dependencies.ids ?? { next: () => randomUUID() };
    if (dependencies.policy !== undefined) this.policy = dependencies.policy;
    this.wait = dependencies.wait ?? new ProcessWaitPort();
    if (dependencies.profileRepository !== undefined) this.profileRepository = dependencies.profileRepository;
    if (dependencies.providerRegistry !== undefined) this.providerRegistry = dependencies.providerRegistry;
    if (dependencies.foregroundAuthentication !== undefined) this.foregroundAuthentication = dependencies.foregroundAuthentication;
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
