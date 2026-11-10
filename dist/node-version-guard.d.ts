/**
 * The Node.js range APN runs on, exactly package.json `engines.node`. bin/apn.js imports this module first and as its
 * only static import, so an older Node prints one line instead of a raw SyntaxError while linking a newer runtime module
 * (Node 20 has no `registerHooks` export in node:module). Keep it free of imports and of syntax newer than ES2015.
 */
export declare const SUPPORTED_NODE_RANGE = ">=24 <27";
/** The one stderr line for an unsupported `process.versions.node`, or null when that version is supported. */
export declare function unsupportedNodeMessage(version: string): string | null;
