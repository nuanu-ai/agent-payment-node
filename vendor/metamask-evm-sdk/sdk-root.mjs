import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import "./chunk-LLF67L57.mjs";
import {
  xt
} from "./chunk-E433ALBJ.mjs";
import {
  S,
  m,
  w
} from "./chunk-RV3JCRYH.mjs";
import "./chunk-M2NCJOQH.mjs";
import "./chunk-R3CE7L2C.mjs";
import "./chunk-VWOLN53K.mjs";
import "./chunk-ZKSOCOTX.mjs";
import "./chunk-CW2DSIM7.mjs";
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
  m as NetworkRegistry,
  S as PriceService,
  xt as createWalletServiceFromSession,
  w as disableAnalytics
};
