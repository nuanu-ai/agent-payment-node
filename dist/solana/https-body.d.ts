/** Compression changes transport bytes only; both wire and decoded bodies remain bounded. */
export declare function decodeSolanaRpcBody(body: Uint8Array, contentEncoding: unknown): Buffer;
/** Preserve a bounded provider cooldown response for the RPC layer and durable pacer. */
export declare function solanaRpcHttpResponse(body: Uint8Array, metadata: {
    readonly statusCode: number | undefined;
    readonly contentType: string;
    readonly contentEncoding: unknown;
    readonly retryAfter: string | undefined;
}): Response;
