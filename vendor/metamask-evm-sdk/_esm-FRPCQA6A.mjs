import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  import_websocket,
  wrapper_exports
} from "./chunk-AI6UKPXV.mjs";
import "./chunk-B7AVLEE2.mjs";

// node_modules/isows/_esm/utils.js
function getNativeWebSocket() {
  if (typeof WebSocket !== "undefined")
    return WebSocket;
  if (typeof global.WebSocket !== "undefined")
    return global.WebSocket;
  if (typeof window.WebSocket !== "undefined")
    return window.WebSocket;
  if (typeof self.WebSocket !== "undefined")
    return self.WebSocket;
  throw new Error("`WebSocket` is not supported in this environment");
}

// node_modules/isows/_esm/index.js
var WebSocket3 = (() => {
  try {
    return getNativeWebSocket();
  } catch {
    if (import_websocket.default)
      return import_websocket.default;
    return wrapper_exports;
  }
})();
export {
  WebSocket3 as WebSocket
};
