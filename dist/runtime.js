import { randomUUID } from "node:crypto";
import { NATIVE_IPC_VERSION } from "./constants.js";
import { ApnError } from "./errors.js";
export class RuntimeContext {
    state;
    native;
    rpc;
    http;
    clock;
    ids;
    initialized;
    constructor(dependencies) {
        this.state = dependencies.state;
        if (dependencies.native !== undefined)
            this.native = dependencies.native;
        if (dependencies.rpc !== undefined)
            this.rpc = dependencies.rpc;
        if (dependencies.http !== undefined)
            this.http = dependencies.http;
        this.clock = dependencies.clock ?? { now: () => new Date() };
        this.ids = dependencies.ids ?? { next: () => randomUUID() };
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
    nativeRequest(operation, payload) {
        return { version: NATIVE_IPC_VERSION, requestId: this.ids.next(), operation, payload };
    }
}
//# sourceMappingURL=runtime.js.map