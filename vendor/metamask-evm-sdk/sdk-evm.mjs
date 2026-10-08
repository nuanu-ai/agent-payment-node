import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  S,
  v
} from "./chunk-ZRGEL2C7.mjs";
import "./chunk-5SRSLBJ2.mjs";
import "./chunk-QMX5GBKX.mjs";
import "./chunk-VT3KA7ZE.mjs";
import "./chunk-VWOLN53K.mjs";
import "./chunk-YOJA2JWO.mjs";
import "./chunk-XUIZAIKJ.mjs";
import "./chunk-KARUJRYC.mjs";
import "./chunk-BGFFBOJN.mjs";
import "./chunk-OJOIMBBT.mjs";
import "./chunk-D6DBKKWT.mjs";
import "./chunk-VXZBS4XQ.mjs";
import "./chunk-YZGUBLTF.mjs";
import "./chunk-PL6MZGBX.mjs";
import "./chunk-UST3XQO6.mjs";
export {
  v as getAgenticEvmChains,
  S as withEvmRpcTarget
};
