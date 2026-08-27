import { randomUUID } from "node:crypto";
import { NATIVE_IPC_VERSION } from "./constants.js";
import { ApnError, type ErrorCode } from "./errors.js";
import type { ClockPort, HttpPort, IdPort, NativePort, NativeRequest, RpcPort } from "./ports.js";
import type { StateStore } from "./state.js";

export interface CoreDependencies {
  readonly state: StateStore;
  readonly native?: NativePort;
  readonly rpc?: RpcPort;
  readonly http?: HttpPort;
  readonly clock?: ClockPort;
  readonly ids?: IdPort;
}

export class RuntimeContext {
  readonly state: StateStore;
  readonly native?: NativePort;
  readonly rpc?: RpcPort;
  readonly http?: HttpPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  private initialized: Promise<void> | undefined;

  constructor(dependencies: CoreDependencies) {
    this.state = dependencies.state;
    if (dependencies.native !== undefined) this.native = dependencies.native;
    if (dependencies.rpc !== undefined) this.rpc = dependencies.rpc;
    if (dependencies.http !== undefined) this.http = dependencies.http;
    this.clock = dependencies.clock ?? { now: () => new Date() };
    this.ids = dependencies.ids ?? { next: () => randomUUID() };
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

  nativeRequest(operation: NativeRequest["operation"], payload: Readonly<Record<string, unknown>>): NativeRequest {
    return { version: NATIVE_IPC_VERSION, requestId: this.ids.next(), operation, payload };
  }
}
