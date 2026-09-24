import { PRODUCT_VERSION } from "./constants.js";

/** Internal JSON-RPC request headers shared by the HTTPS transport and its local fixture. */
export function jsonRpcRequestHeaders(body: string): Readonly<Record<string, string>> {
  return {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body).toString(),
    "accept": "application/json",
    "user-agent": `APN/${PRODUCT_VERSION}`,
  };
}
