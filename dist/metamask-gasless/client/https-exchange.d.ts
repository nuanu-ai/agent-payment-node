import type { ClientRequest } from "node:http";
/** The helper's one HTTPS transport: a pinned public address, no redirect, no encoding, a byte cap and a hard timeout. */
export interface FetchExchangeRequest {
    readonly url: string;
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string | null;
    readonly signal?: AbortSignal;
    readonly maxBytes: number;
    readonly timeoutMs: number;
    /**
     * A send's final gate. The production transport calls it once the TLS session is up and writes the request right after
     * it; a gate that throws destroys the request with nothing of it written.
     */
    readonly beforeSend?: () => void;
}
export interface FetchExchangeResponse {
    readonly status: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body: string;
}
export interface FetchExchange {
    request(request: FetchExchangeRequest): Promise<FetchExchangeResponse>;
}
export declare class HttpsFetchExchange implements FetchExchange {
    request(request: FetchExchangeRequest): Promise<FetchExchangeResponse>;
}
/**
 * Hands the request's bytes to `req`. A read (no `beforeSend`) is written at once. A send is written only once its TLS
 * session is up, right after its gate: Node writes nothing of a request before `end`, so none of a send's bytes can wait
 * in a buffer while DNS, TCP or the handshake take their time, and the deadline check runs right before they go. A gate
 * that refuses destroys the request with nothing written and reports its error through `fail`.
 */
export declare function endRequestWhenSecure(req: ClientRequest, input: Pick<FetchExchangeRequest, "body" | "beforeSend">, fail: (error: unknown) => void): void;
