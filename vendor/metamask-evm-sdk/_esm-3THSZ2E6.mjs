import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  require_extension,
  require_permessage_deflate,
  require_receiver,
  require_sender,
  require_stream,
  require_subprotocol,
  require_websocket,
  require_websocket_server
} from "./chunk-BGFFBOJN.mjs";
import {
  __export,
  __toESM
} from "./chunk-UST3XQO6.mjs";

// node_modules/ws/wrapper.mjs
var wrapper_exports = {};
__export(wrapper_exports, {
  PerMessageDeflate: () => import_permessage_deflate.default,
  Receiver: () => import_receiver.default,
  Sender: () => import_sender.default,
  WebSocket: () => import_websocket.default,
  WebSocketServer: () => import_websocket_server.default,
  createWebSocketStream: () => import_stream.default,
  default: () => wrapper_default,
  extension: () => import_extension.default,
  subprotocol: () => import_subprotocol.default
});
var import_stream = __toESM(require_stream(), 1);
var import_extension = __toESM(require_extension(), 1);
var import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_subprotocol = __toESM(require_subprotocol(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);
var wrapper_default = import_websocket.default;

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
