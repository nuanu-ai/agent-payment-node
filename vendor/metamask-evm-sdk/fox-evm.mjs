import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  M,
  N,
  X,
  lt
} from "./chunk-JQH5VL7I.mjs";
import "./chunk-R3CE7L2C.mjs";
import {
  i
} from "./chunk-IXRUFS4W.mjs";
import {
  prepareDelegation
} from "./chunk-CW2DSIM7.mjs";
import "./chunk-ITJRA3TR.mjs";
import "./chunk-FXOPQFK3.mjs";
import "./chunk-23SLZEUA.mjs";
import "./chunk-GBOH3J37.mjs";
import "./chunk-E2KNBJAZ.mjs";
import "./chunk-PN5QSJPY.mjs";
import "./chunk-6HTIMX4Q.mjs";
import "./chunk-QI5RJC2T.mjs";
import "./chunk-YQQOMOUG.mjs";
import "./chunk-B7AVLEE2.mjs";
export {
  lt as EvmServerAdapter,
  i as SIGN_REQUEST_KIND,
  X as evmServerAdapter,
  M as executionsToWire,
  prepareDelegation,
  N as unsignedDelegationToWire
};
