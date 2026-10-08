import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  require_lib6 as require_lib
} from "./chunk-XUIZAIKJ.mjs";
import "./chunk-KARUJRYC.mjs";
import "./chunk-BGFFBOJN.mjs";
import "./chunk-OJOIMBBT.mjs";
import {
  __toESM
} from "./chunk-UST3XQO6.mjs";

// apn-sdk:controller
var import_ethereum_controllers = __toESM(require_lib());
var export_getDelegationHashOffchain = import_ethereum_controllers.getDelegationHashOffchain;
export {
  export_getDelegationHashOffchain as getDelegationHashOffchain
};
