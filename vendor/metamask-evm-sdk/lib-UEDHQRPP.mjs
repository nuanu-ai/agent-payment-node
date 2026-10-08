import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  require_lib5 as require_lib
} from "./chunk-KARUJRYC.mjs";
import "./chunk-BGFFBOJN.mjs";
import "./chunk-OJOIMBBT.mjs";
import "./chunk-UST3XQO6.mjs";
export default require_lib();
