import { PRODUCT_VERSION } from "./constants.js";
/** Internal JSON-RPC request headers shared by the HTTPS transport and its local fixture. */
export function jsonRpcRequestHeaders(body) {
    return {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body).toString(),
        "accept": "application/json",
        "user-agent": `APN/${PRODUCT_VERSION}`,
    };
}
//# sourceMappingURL=rpc-request-headers.js.map