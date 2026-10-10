import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  toHex
} from "./chunk-S2MT4VX5.mjs";

// node_modules/@metamask/smart-accounts-kit/dist/chunk-IMO6XNDJ.mjs
function generateSalt() {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Secure randomness is unavailable in this runtime");
  }
  const randomValues = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return toHex(randomValues);
}

export {
  generateSalt
};
