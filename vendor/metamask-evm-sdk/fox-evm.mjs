import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  M,
  N,
  X,
  import_ethereum_controllers,
  lt
} from "./chunk-VT3KA7ZE.mjs";
import {
  i
} from "./chunk-YOJA2JWO.mjs";
import "./chunk-XUIZAIKJ.mjs";
import "./chunk-KARUJRYC.mjs";
import "./chunk-BGFFBOJN.mjs";
import "./chunk-OJOIMBBT.mjs";
import "./chunk-D6DBKKWT.mjs";
import "./chunk-VXZBS4XQ.mjs";
import "./chunk-YZGUBLTF.mjs";
import "./chunk-PL6MZGBX.mjs";
import "./chunk-UST3XQO6.mjs";
var export_prepareDelegation = import_ethereum_controllers.prepareDelegation;
export {
  lt as EvmServerAdapter,
  i as SIGN_REQUEST_KIND,
  X as evmServerAdapter,
  M as executionsToWire,
  export_prepareDelegation as prepareDelegation,
  N as unsignedDelegationToWire
};
