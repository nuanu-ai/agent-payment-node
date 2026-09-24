import { request } from "node:https";
import { resolvePublicAddresses } from "../network-policy.js";
/** Production transport pins one validated public address and built-in TLS roots. */
export declare const tronHttpsFetch: typeof fetch;
/** Dependency injection keeps transport failure tests offline and deterministic. */
export declare function createTronHttpsFetch(requestHttps: typeof request, resolveAddresses: typeof resolvePublicAddresses): typeof fetch;
