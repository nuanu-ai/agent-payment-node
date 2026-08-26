import { randomUUID } from "node:crypto";
import { NATIVE_IPC_VERSION } from "./constants.js";
import { ApnError } from "./errors.js";
import type { ClockPort, IdPort, NativePort, NativeRequest, RpcPort } from "./ports.js";
import type { StateStore } from "./state.js";

export interface CoreDependencies {
  readonly state: StateStore;
  readonly native?: NativePort;
  readonly rpc?: RpcPort;
  readonly clock?: ClockPort;
  readonly ids?: IdPort;
}

export class RuntimeContext {
  readonly state: StateStore;
  readonly native?: NativePort;
  readonly rpc?: RpcPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  private initialized: Promise<void> | undefined;

  constructor(dependencies: CoreDependencies) {
    this.state = dependencies.state;
    if (dependencies.native !== undefined) this.native = dependencies.native;
    if (dependencies.rpc !== undefined) this.rpc = dependencies.rpc;
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

  nativeRequest(operation: NativeRequest["operation"], payload: Readonly<Record<string, unknown>>): NativeRequest {
    return { version: NATIVE_IPC_VERSION, requestId: this.ids.next(), operation, payload };
  }
}
