import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import "./chunk-L4R6PIP7.mjs";
import "./chunk-DQE3KJNP.mjs";
import "./chunk-GHAODLUH.mjs";
import {
  SIGNABLE_DELEGATION_TYPED_DATA,
  decodeDelegations,
  encodeDelegations,
  toDelegationStruct
} from "./chunk-XRTWDKRZ.mjs";
import "./chunk-IMFZ4P7A.mjs";
import "./chunk-S2MT4VX5.mjs";
import "./chunk-HMYUAAIA.mjs";
import "./chunk-GFNUYFFY.mjs";
import "./chunk-T6VOGCFD.mjs";
import "./chunk-ZSEVIWSW.mjs";
import "./chunk-VBXYOQOU.mjs";
import "./chunk-GQCBBNZL.mjs";
export {
  SIGNABLE_DELEGATION_TYPED_DATA,
  decodeDelegations,
  encodeDelegations,
  toDelegationStruct
};
