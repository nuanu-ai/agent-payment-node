import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  AbiEventNotFoundError,
  AbiEventSignatureEmptyTopicsError,
  AbiEventSignatureNotFoundError,
  AtomicReadyWalletRejectedUpgradeError,
  AtomicityNotSupportedError,
  BaseError,
  BaseError2,
  BundleTooLargeError,
  BytesSizeMismatchError,
  CallExecutionError,
  ChainDisconnectedError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  DecodeLogDataMismatch,
  DecodeLogTopicsMismatch,
  DuplicateIdError,
  ExecutionRevertedError,
  FeePayerNonceMismatchError,
  HttpRequestError,
  IntegerOutOfRangeError,
  InternalRpcError,
  InvalidAddressError,
  InvalidInputRpcError,
  InvalidParamsRpcError,
  InvalidRequestRpcError,
  InvalidSerializableTransactionError,
  JsonRpcVersionUnsupportedError,
  LimitExceededRpcError,
  LruMap,
  MethodNotFoundRpcError,
  MethodNotSupportedRpcError,
  ParseRpcError,
  PositionOutOfBoundsError,
  ProviderDisconnectedError,
  RawContractError,
  ResourceNotFoundRpcError,
  ResourceUnavailableRpcError,
  ResponseBodyTooLargeError,
  RpcRequestError,
  SwitchChainError,
  TimeoutError,
  TransactionExecutionError,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  TransactionReceiptRevertedError,
  TransactionRejectedRpcError,
  UnauthorizedProviderError,
  UnknownBundleIdError,
  UnknownNodeError,
  UnknownRpcError,
  UnsupportedChainIdError,
  UnsupportedNonOptionalCapabilityError,
  UnsupportedProviderMethodError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
  WalletConnectSessionSettlementError,
  addressResolverAbi,
  assertRequest,
  bytesRegex,
  bytesToHex,
  call,
  checksumAddress,
  concat,
  concat2,
  concatHex,
  createBatchScheduler,
  createCursor,
  decodeAbiParameters,
  decodeFunctionResult,
  deploylessCallViaBytecodeBytecode,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  erc1271Abi,
  erc20Abi,
  erc6492SignatureValidatorAbi,
  erc6492SignatureValidatorByteCode,
  extract,
  format,
  formatAbiItem,
  formatAbiItem2,
  formatAbiParameters,
  formatBlockParameter,
  formatEther,
  formatGwei,
  formatTransactionRequest,
  from,
  from2,
  fromBoolean,
  fromBytes,
  fromHex,
  fromNumber,
  fromString,
  fromString2,
  getAbiItem,
  getAbortError,
  getAddress,
  getCallError,
  getChainContractAddress,
  getNodeError,
  hexToBigInt,
  hexToBool,
  hexToBytes,
  hexToNumber,
  integerRegex,
  isAbortError,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  localBatchGatewayUrl,
  multicall3Abi,
  multicall3Bytecode,
  numberToHex,
  pad,
  padLeft,
  padRight,
  parseAbiItem,
  parseAbiParameters,
  parseAccount,
  prettyPrint,
  serializeStateOverride,
  size,
  size2,
  size3,
  slice,
  slice2,
  slice3,
  stringToBytes,
  stringToHex,
  stringify,
  stringify2,
  textResolverAbi,
  toBigInt,
  toBoolean,
  toBytes,
  toEventSelector,
  toHex,
  toNumber,
  toNumber2,
  toRpc,
  toString,
  trim,
  trimLeft,
  trimLeft2,
  universalResolverResolveAbi,
  universalResolverReverseAbi,
  validate,
  validate2,
  withResolvers
} from "./chunk-QMX5GBKX.mjs";
import {
  sha256
} from "./chunk-VT3KA7ZE.mjs";
import {
  c2 as c,
  s,
  x
} from "./chunk-YOJA2JWO.mjs";
import {
  init_tslib_es6,
  tslib_es6_exports
} from "./chunk-XUIZAIKJ.mjs";
import {
  require_cjs,
  require_objectSpread2
} from "./chunk-KARUJRYC.mjs";
import {
  require_loglevel
} from "./chunk-OJOIMBBT.mjs";
import {
  secp256k1
} from "./chunk-D6DBKKWT.mjs";
import {
  keccak_256
} from "./chunk-YZGUBLTF.mjs";
import {
  __commonJS,
  __export,
  __require,
  __toCommonJS,
  __toESM
} from "./chunk-UST3XQO6.mjs";

// node_modules/@segment/analytics-core/dist/cjs/emitter/interface.js
var require_interface = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/emitter/interface.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/@segment/analytics-core/dist/cjs/plugins/index.js
var require_plugins = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/plugins/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/@segment/analytics-core/dist/cjs/events/interfaces.js
var require_interfaces = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/events/interfaces.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/dset/dist/index.js
var require_dist = __commonJS({
  "node_modules/dset/dist/index.js"(exports) {
    function dset(obj, keys, val) {
      keys.split && (keys = keys.split("."));
      var i5 = 0, l6 = keys.length, t2 = obj, x5, k2;
      while (i5 < l6) {
        k2 = "" + keys[i5++];
        if (k2 === "__proto__" || k2 === "constructor" || k2 === "prototype") break;
        t2 = t2[k2] = i5 === l6 ? val : typeof (x5 = t2[k2]) === typeof keys ? x5 : keys[i5] * 0 !== 0 || !!~("" + keys[i5]).indexOf(".") ? {} : [];
      }
    }
    exports.dset = dset;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/utils/pick.js
var require_pick = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/utils/pick.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.pickBy = void 0;
    var pickBy = function(obj, fn) {
      return Object.keys(obj).filter(function(k2) {
        return fn(k2, obj[k2]);
      }).reduce(function(acc, key) {
        return acc[key] = obj[key], acc;
      }, {});
    };
    exports.pickBy = pickBy;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/validation/errors.js
var require_errors = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/validation/errors.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ValidationError = void 0;
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    var ValidationError = (
      /** @class */
      (function(_super) {
        tslib_1.__extends(ValidationError2, _super);
        function ValidationError2(field, message) {
          var _this = _super.call(this, "".concat(field, " ").concat(message)) || this;
          _this.field = field;
          return _this;
        }
        return ValidationError2;
      })(Error)
    );
    exports.ValidationError = ValidationError;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/validation/helpers.js
var require_helpers = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/validation/helpers.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isPlainObject = exports.exists = exports.isFunction = exports.isNumber = exports.isString = void 0;
    function isString(obj) {
      return typeof obj === "string";
    }
    exports.isString = isString;
    function isNumber(obj) {
      return typeof obj === "number";
    }
    exports.isNumber = isNumber;
    function isFunction(obj) {
      return typeof obj === "function";
    }
    exports.isFunction = isFunction;
    function exists(val) {
      return val !== void 0 && val !== null;
    }
    exports.exists = exists;
    function isPlainObject2(obj) {
      return Object.prototype.toString.call(obj).slice(8, -1).toLowerCase() === "object";
    }
    exports.isPlainObject = isPlainObject2;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/validation/assertions.js
var require_assertions = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/validation/assertions.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateEvent = exports.assertMessageId = exports.assertTraits = exports.assertTrackEventProperties = exports.assertTrackEventName = exports.assertEventType = exports.assertEventExists = exports.assertUserIdentity = void 0;
    var errors_1 = require_errors();
    var helpers_1 = require_helpers();
    var stringError = "is not a string";
    var objError = "is not an object";
    var nilError = "is nil";
    function assertUserIdentity(event) {
      var USER_FIELD_NAME = ".userId/anonymousId/previousId/groupId";
      var getAnyUserId = function(event2) {
        var _a, _b, _c;
        return (_c = (_b = (_a = event2.userId) !== null && _a !== void 0 ? _a : event2.anonymousId) !== null && _b !== void 0 ? _b : event2.groupId) !== null && _c !== void 0 ? _c : event2.previousId;
      };
      var id = getAnyUserId(event);
      if (!(0, helpers_1.exists)(id)) {
        throw new errors_1.ValidationError(USER_FIELD_NAME, nilError);
      } else if (!(0, helpers_1.isString)(id)) {
        throw new errors_1.ValidationError(USER_FIELD_NAME, stringError);
      }
    }
    exports.assertUserIdentity = assertUserIdentity;
    function assertEventExists(event) {
      if (!(0, helpers_1.exists)(event)) {
        throw new errors_1.ValidationError("Event", nilError);
      }
      if (typeof event !== "object") {
        throw new errors_1.ValidationError("Event", objError);
      }
    }
    exports.assertEventExists = assertEventExists;
    function assertEventType(event) {
      if (!(0, helpers_1.isString)(event.type)) {
        throw new errors_1.ValidationError(".type", stringError);
      }
    }
    exports.assertEventType = assertEventType;
    function assertTrackEventName(event) {
      if (!(0, helpers_1.isString)(event.event)) {
        throw new errors_1.ValidationError(".event", stringError);
      }
    }
    exports.assertTrackEventName = assertTrackEventName;
    function assertTrackEventProperties(event) {
      if (!(0, helpers_1.isPlainObject)(event.properties)) {
        throw new errors_1.ValidationError(".properties", objError);
      }
    }
    exports.assertTrackEventProperties = assertTrackEventProperties;
    function assertTraits(event) {
      if (!(0, helpers_1.isPlainObject)(event.traits)) {
        throw new errors_1.ValidationError(".traits", objError);
      }
    }
    exports.assertTraits = assertTraits;
    function assertMessageId(event) {
      if (!(0, helpers_1.isString)(event.messageId)) {
        throw new errors_1.ValidationError(".messageId", stringError);
      }
    }
    exports.assertMessageId = assertMessageId;
    function validateEvent(event) {
      assertEventExists(event);
      assertEventType(event);
      assertMessageId(event);
      if (event.type === "track") {
        assertTrackEventName(event);
        assertTrackEventProperties(event);
      }
      if (["group", "identify"].includes(event.type)) {
        assertTraits(event);
      }
    }
    exports.validateEvent = validateEvent;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/events/index.js
var require_events = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/events/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CoreEventFactory = void 0;
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    tslib_1.__exportStar(require_interfaces(), exports);
    var dset_1 = require_dist();
    var pick_1 = require_pick();
    var assertions_1 = require_assertions();
    var InternalEventFactorySettings = (
      /** @class */
      /* @__PURE__ */ (function() {
        function InternalEventFactorySettings2(settings) {
          var _a, _b;
          this.settings = settings;
          this.createMessageId = settings.createMessageId;
          this.onEventMethodCall = (_a = settings.onEventMethodCall) !== null && _a !== void 0 ? _a : (function() {
          });
          this.onFinishedEvent = (_b = settings.onFinishedEvent) !== null && _b !== void 0 ? _b : (function() {
          });
        }
        return InternalEventFactorySettings2;
      })()
    );
    var CoreEventFactory = (
      /** @class */
      (function() {
        function CoreEventFactory2(settings) {
          this.settings = new InternalEventFactorySettings(settings);
        }
        CoreEventFactory2.prototype.track = function(event, properties, options, integrationOptions) {
          this.settings.onEventMethodCall({ type: "track", options });
          return this.normalize(tslib_1.__assign(tslib_1.__assign({}, this.baseEvent()), { event, type: "track", properties: properties !== null && properties !== void 0 ? properties : {}, options: tslib_1.__assign({}, options), integrations: tslib_1.__assign({}, integrationOptions) }));
        };
        CoreEventFactory2.prototype.page = function(category, page, properties, options, integrationOptions) {
          var _a;
          this.settings.onEventMethodCall({ type: "page", options });
          var event = {
            type: "page",
            properties: tslib_1.__assign({}, properties),
            options: tslib_1.__assign({}, options),
            integrations: tslib_1.__assign({}, integrationOptions)
          };
          if (category !== null) {
            event.category = category;
            event.properties = (_a = event.properties) !== null && _a !== void 0 ? _a : {};
            event.properties.category = category;
          }
          if (page !== null) {
            event.name = page;
          }
          return this.normalize(tslib_1.__assign(tslib_1.__assign({}, this.baseEvent()), event));
        };
        CoreEventFactory2.prototype.screen = function(category, screen, properties, options, integrationOptions) {
          this.settings.onEventMethodCall({ type: "screen", options });
          var event = {
            type: "screen",
            properties: tslib_1.__assign({}, properties),
            options: tslib_1.__assign({}, options),
            integrations: tslib_1.__assign({}, integrationOptions)
          };
          if (category !== null) {
            event.category = category;
          }
          if (screen !== null) {
            event.name = screen;
          }
          return this.normalize(tslib_1.__assign(tslib_1.__assign({}, this.baseEvent()), event));
        };
        CoreEventFactory2.prototype.identify = function(userId, traits, options, integrationsOptions) {
          this.settings.onEventMethodCall({ type: "identify", options });
          return this.normalize(tslib_1.__assign(tslib_1.__assign({}, this.baseEvent()), { type: "identify", userId, traits: traits !== null && traits !== void 0 ? traits : {}, options: tslib_1.__assign({}, options), integrations: integrationsOptions }));
        };
        CoreEventFactory2.prototype.group = function(groupId, traits, options, integrationOptions) {
          this.settings.onEventMethodCall({ type: "group", options });
          return this.normalize(tslib_1.__assign(tslib_1.__assign({}, this.baseEvent()), {
            type: "group",
            traits: traits !== null && traits !== void 0 ? traits : {},
            options: tslib_1.__assign({}, options),
            integrations: tslib_1.__assign({}, integrationOptions),
            //
            groupId
          }));
        };
        CoreEventFactory2.prototype.alias = function(to, from15, options, integrationOptions) {
          this.settings.onEventMethodCall({ type: "alias", options });
          var base = {
            userId: to,
            type: "alias",
            options: tslib_1.__assign({}, options),
            integrations: tslib_1.__assign({}, integrationOptions)
          };
          if (from15 !== null) {
            base.previousId = from15;
          }
          if (to === void 0) {
            return this.normalize(tslib_1.__assign(tslib_1.__assign({}, base), this.baseEvent()));
          }
          return this.normalize(tslib_1.__assign(tslib_1.__assign({}, this.baseEvent()), base));
        };
        CoreEventFactory2.prototype.baseEvent = function() {
          return {
            integrations: {},
            options: {}
          };
        };
        CoreEventFactory2.prototype.context = function(options) {
          var _a;
          var eventOverrideKeys = [
            "userId",
            "anonymousId",
            "timestamp",
            "messageId"
          ];
          delete options["integrations"];
          var providedOptionsKeys = Object.keys(options);
          var context = (_a = options.context) !== null && _a !== void 0 ? _a : {};
          var eventOverrides = {};
          providedOptionsKeys.forEach(function(key) {
            if (key === "context") {
              return;
            }
            if (eventOverrideKeys.includes(key)) {
              (0, dset_1.dset)(eventOverrides, key, options[key]);
            } else {
              (0, dset_1.dset)(context, key, options[key]);
            }
          });
          return [context, eventOverrides];
        };
        CoreEventFactory2.prototype.normalize = function(event) {
          var _a, _b;
          var integrationBooleans = Object.keys((_a = event.integrations) !== null && _a !== void 0 ? _a : {}).reduce(function(integrationNames, name) {
            var _a2;
            var _b2;
            return tslib_1.__assign(tslib_1.__assign({}, integrationNames), (_a2 = {}, _a2[name] = Boolean((_b2 = event.integrations) === null || _b2 === void 0 ? void 0 : _b2[name]), _a2));
          }, {});
          event.options = (0, pick_1.pickBy)(event.options || {}, function(_5, value) {
            return value !== void 0;
          });
          var allIntegrations = tslib_1.__assign(tslib_1.__assign({}, integrationBooleans), (_b = event.options) === null || _b === void 0 ? void 0 : _b.integrations);
          var _c = event.options ? this.context(event.options) : [], context = _c[0], overrides = _c[1];
          var options = event.options, rest = tslib_1.__rest(event, ["options"]);
          var evt = tslib_1.__assign(tslib_1.__assign(tslib_1.__assign(tslib_1.__assign({ timestamp: /* @__PURE__ */ new Date() }, rest), { context, integrations: allIntegrations }), overrides), { messageId: options.messageId || this.settings.createMessageId() });
          this.settings.onFinishedEvent(evt);
          (0, assertions_1.validateEvent)(evt);
          return evt;
        };
        return CoreEventFactory2;
      })()
    );
    exports.CoreEventFactory = CoreEventFactory;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/callback/index.js
var require_callback = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/callback/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.invokeCallback = exports.sleep = exports.pTimeout = void 0;
    function pTimeout(promise, timeout) {
      return new Promise(function(resolve, reject) {
        var timeoutId = setTimeout(function() {
          reject(Error("Promise timed out"));
        }, timeout);
        promise.then(function(val) {
          clearTimeout(timeoutId);
          return resolve(val);
        }).catch(reject);
      });
    }
    exports.pTimeout = pTimeout;
    function sleep(timeoutInMs) {
      return new Promise(function(resolve) {
        return setTimeout(resolve, timeoutInMs);
      });
    }
    exports.sleep = sleep;
    function invokeCallback(ctx, callback, delay) {
      var cb = function() {
        try {
          return Promise.resolve(callback(ctx));
        } catch (err) {
          return Promise.reject(err);
        }
      };
      return sleep(delay).then(function() {
        return pTimeout(cb(), 1e3);
      }).catch(function(err) {
        ctx === null || ctx === void 0 ? void 0 : ctx.log("warn", "Callback Error", { error: err });
        ctx === null || ctx === void 0 ? void 0 : ctx.stats.increment("callback_error");
      }).then(function() {
        return ctx;
      });
    }
    exports.invokeCallback = invokeCallback;
  }
});

// node_modules/@segment/analytics-generic-utils/dist/cjs/create-deferred/create-deferred.js
var require_create_deferred = __commonJS({
  "node_modules/@segment/analytics-generic-utils/dist/cjs/create-deferred/create-deferred.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createDeferred = void 0;
    var createDeferred = function() {
      var resolve;
      var reject;
      var settled = false;
      var promise = new Promise(function(_resolve, _reject) {
        resolve = function() {
          var args = [];
          for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
          }
          settled = true;
          _resolve.apply(void 0, args);
        };
        reject = function() {
          var args = [];
          for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
          }
          settled = true;
          _reject.apply(void 0, args);
        };
      });
      return {
        resolve,
        reject,
        promise,
        isSettled: function() {
          return settled;
        }
      };
    };
    exports.createDeferred = createDeferred;
  }
});

// node_modules/@segment/analytics-generic-utils/dist/cjs/create-deferred/index.js
var require_create_deferred2 = __commonJS({
  "node_modules/@segment/analytics-generic-utils/dist/cjs/create-deferred/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    tslib_1.__exportStar(require_create_deferred(), exports);
  }
});

// node_modules/@segment/analytics-generic-utils/dist/cjs/emitter/emitter.js
var require_emitter = __commonJS({
  "node_modules/@segment/analytics-generic-utils/dist/cjs/emitter/emitter.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Emitter = void 0;
    var Emitter = (
      /** @class */
      (function() {
        function Emitter2(options) {
          var _a;
          this.callbacks = {};
          this.warned = false;
          this.maxListeners = (_a = options === null || options === void 0 ? void 0 : options.maxListeners) !== null && _a !== void 0 ? _a : 10;
        }
        Emitter2.prototype.warnIfPossibleMemoryLeak = function(event) {
          if (this.warned) {
            return;
          }
          if (this.maxListeners && this.callbacks[event].length > this.maxListeners) {
            console.warn("Event Emitter: Possible memory leak detected; ".concat(String(event), " has exceeded ").concat(this.maxListeners, " listeners."));
            this.warned = true;
          }
        };
        Emitter2.prototype.on = function(event, callback) {
          if (!this.callbacks[event]) {
            this.callbacks[event] = [callback];
          } else {
            this.callbacks[event].push(callback);
            this.warnIfPossibleMemoryLeak(event);
          }
          return this;
        };
        Emitter2.prototype.once = function(event, callback) {
          var _this = this;
          var on = function() {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
              args[_i] = arguments[_i];
            }
            _this.off(event, on);
            callback.apply(_this, args);
          };
          this.on(event, on);
          return this;
        };
        Emitter2.prototype.off = function(event, callback) {
          var _a;
          var fns = (_a = this.callbacks[event]) !== null && _a !== void 0 ? _a : [];
          var without = fns.filter(function(fn) {
            return fn !== callback;
          });
          this.callbacks[event] = without;
          return this;
        };
        Emitter2.prototype.emit = function(event) {
          var _this = this;
          var _a;
          var args = [];
          for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
          }
          var callbacks = (_a = this.callbacks[event]) !== null && _a !== void 0 ? _a : [];
          callbacks.forEach(function(callback) {
            callback.apply(_this, args);
          });
          return this;
        };
        return Emitter2;
      })()
    );
    exports.Emitter = Emitter;
  }
});

// node_modules/@segment/analytics-generic-utils/dist/cjs/emitter/index.js
var require_emitter2 = __commonJS({
  "node_modules/@segment/analytics-generic-utils/dist/cjs/emitter/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    tslib_1.__exportStar(require_emitter(), exports);
  }
});

// node_modules/@segment/analytics-generic-utils/dist/cjs/index.js
var require_cjs2 = __commonJS({
  "node_modules/@segment/analytics-generic-utils/dist/cjs/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    tslib_1.__exportStar(require_create_deferred2(), exports);
    tslib_1.__exportStar(require_emitter2(), exports);
  }
});

// node_modules/@segment/analytics-core/dist/cjs/priority-queue/backoff.js
var require_backoff = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/priority-queue/backoff.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.backoff = void 0;
    function backoff(params) {
      var random = Math.random() + 1;
      var _a = params.minTimeout, minTimeout = _a === void 0 ? 500 : _a, _b = params.factor, factor = _b === void 0 ? 2 : _b, attempt = params.attempt, _c = params.maxTimeout, maxTimeout = _c === void 0 ? Infinity : _c;
      return Math.min(random * minTimeout * Math.pow(factor, attempt), maxTimeout);
    }
    exports.backoff = backoff;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/priority-queue/index.js
var require_priority_queue = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/priority-queue/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PriorityQueue = exports.ON_REMOVE_FROM_FUTURE = void 0;
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    var analytics_generic_utils_1 = require_cjs2();
    var backoff_1 = require_backoff();
    exports.ON_REMOVE_FROM_FUTURE = "onRemoveFromFuture";
    var PriorityQueue = (
      /** @class */
      (function(_super) {
        tslib_1.__extends(PriorityQueue2, _super);
        function PriorityQueue2(maxAttempts, queue, seen) {
          var _this = _super.call(this) || this;
          _this.future = [];
          _this.maxAttempts = maxAttempts;
          _this.queue = queue;
          _this.seen = seen !== null && seen !== void 0 ? seen : {};
          return _this;
        }
        PriorityQueue2.prototype.push = function() {
          var _this = this;
          var items = [];
          for (var _i = 0; _i < arguments.length; _i++) {
            items[_i] = arguments[_i];
          }
          var accepted = items.map(function(operation) {
            var attempts = _this.updateAttempts(operation);
            if (attempts > _this.maxAttempts || _this.includes(operation)) {
              return false;
            }
            _this.queue.push(operation);
            return true;
          });
          this.queue = this.queue.sort(function(a4, b4) {
            return _this.getAttempts(a4) - _this.getAttempts(b4);
          });
          return accepted;
        };
        PriorityQueue2.prototype.pushWithBackoff = function(item, minTimeout) {
          if (minTimeout === void 0) {
            minTimeout = 0;
          }
          if (minTimeout == 0 && this.getAttempts(item) === 0) {
            return this.push(item)[0];
          }
          var timeout = (0, backoff_1.backoff)({ attempt: this.getAttempts(item) });
          if (minTimeout > 0 && timeout < minTimeout) {
            timeout = minTimeout;
          }
          return this.scheduleItem(item, timeout);
        };
        PriorityQueue2.prototype.pushWithDelay = function(item, delay) {
          return this.scheduleItem(item, delay);
        };
        PriorityQueue2.prototype.scheduleItem = function(item, timeout) {
          var _this = this;
          var attempt = this.updateAttempts(item);
          if (attempt > this.maxAttempts || this.includes(item)) {
            return false;
          }
          setTimeout(function() {
            _this.queue.push(item);
            _this.future = _this.future.filter(function(f5) {
              return f5.id !== item.id;
            });
            _this.emit(exports.ON_REMOVE_FROM_FUTURE);
          }, timeout);
          this.future.push(item);
          return true;
        };
        PriorityQueue2.prototype.getAttempts = function(item) {
          var _a;
          return (_a = this.seen[item.id]) !== null && _a !== void 0 ? _a : 0;
        };
        PriorityQueue2.prototype.updateAttempts = function(item) {
          this.seen[item.id] = this.getAttempts(item) + 1;
          return this.getAttempts(item);
        };
        PriorityQueue2.prototype.includes = function(item) {
          return this.queue.includes(item) || this.future.includes(item) || Boolean(this.queue.find(function(i5) {
            return i5.id === item.id;
          })) || Boolean(this.future.find(function(i5) {
            return i5.id === item.id;
          }));
        };
        PriorityQueue2.prototype.pop = function() {
          return this.queue.shift();
        };
        Object.defineProperty(PriorityQueue2.prototype, "length", {
          get: function() {
            return this.queue.length;
          },
          enumerable: false,
          configurable: true
        });
        Object.defineProperty(PriorityQueue2.prototype, "todo", {
          get: function() {
            return this.queue.length + this.future.length;
          },
          enumerable: false,
          configurable: true
        });
        return PriorityQueue2;
      })(analytics_generic_utils_1.Emitter)
    );
    exports.PriorityQueue = PriorityQueue;
  }
});

// node_modules/@lukeed/uuid/dist/index.js
var require_dist2 = __commonJS({
  "node_modules/@lukeed/uuid/dist/index.js"(exports) {
    var IDX = 256;
    var HEX = [];
    var BUFFER;
    while (IDX--) HEX[IDX] = (IDX + 256).toString(16).substring(1);
    function v4() {
      var i5 = 0, num, out = "";
      if (!BUFFER || IDX + 16 > 256) {
        BUFFER = Array(i5 = 256);
        while (i5--) BUFFER[i5] = 256 * Math.random() | 0;
        i5 = IDX = 0;
      }
      for (; i5 < 16; i5++) {
        num = BUFFER[IDX + i5];
        if (i5 == 6) out += HEX[num & 15 | 64];
        else if (i5 == 8) out += HEX[num & 63 | 128];
        else out += HEX[num];
        if (i5 & 1 && i5 > 1 && i5 < 11) out += "-";
      }
      IDX++;
      return out;
    }
    exports.v4 = v4;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/logger/index.js
var require_logger = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/logger/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CoreLogger = void 0;
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    var CoreLogger = (
      /** @class */
      (function() {
        function CoreLogger2() {
          this._logs = [];
        }
        CoreLogger2.prototype.log = function(level, message, extras) {
          var time = /* @__PURE__ */ new Date();
          this._logs.push({
            level,
            message,
            time,
            extras
          });
        };
        Object.defineProperty(CoreLogger2.prototype, "logs", {
          get: function() {
            return this._logs;
          },
          enumerable: false,
          configurable: true
        });
        CoreLogger2.prototype.flush = function() {
          if (this.logs.length > 1) {
            var formatted = this._logs.reduce(function(logs, log) {
              var _a;
              var _b, _c;
              var line = tslib_1.__assign(tslib_1.__assign({}, log), { json: JSON.stringify(log.extras, null, " "), extras: log.extras });
              delete line["time"];
              var key = (_c = (_b = log.time) === null || _b === void 0 ? void 0 : _b.toISOString()) !== null && _c !== void 0 ? _c : "";
              if (logs[key]) {
                key = "".concat(key, "-").concat(Math.random());
              }
              return tslib_1.__assign(tslib_1.__assign({}, logs), (_a = {}, _a[key] = line, _a));
            }, {});
            if (console.table) {
              console.table(formatted);
            } else {
              console.log(formatted);
            }
          } else {
            this.logs.forEach(function(logEntry) {
              var level = logEntry.level, message = logEntry.message, extras = logEntry.extras;
              if (level === "info" || level === "debug") {
                console.log(message, extras !== null && extras !== void 0 ? extras : "");
              } else {
                console[level](message, extras !== null && extras !== void 0 ? extras : "");
              }
            });
          }
          this._logs = [];
        };
        return CoreLogger2;
      })()
    );
    exports.CoreLogger = CoreLogger;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/stats/index.js
var require_stats = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/stats/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NullStats = exports.CoreStats = void 0;
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    var compactMetricType = function(type) {
      var enums = {
        gauge: "g",
        counter: "c"
      };
      return enums[type];
    };
    var CoreStats = (
      /** @class */
      (function() {
        function CoreStats2() {
          this.metrics = [];
        }
        CoreStats2.prototype.increment = function(metric, by, tags) {
          if (by === void 0) {
            by = 1;
          }
          this.metrics.push({
            metric,
            value: by,
            tags: tags !== null && tags !== void 0 ? tags : [],
            type: "counter",
            timestamp: Date.now()
          });
        };
        CoreStats2.prototype.gauge = function(metric, value, tags) {
          this.metrics.push({
            metric,
            value,
            tags: tags !== null && tags !== void 0 ? tags : [],
            type: "gauge",
            timestamp: Date.now()
          });
        };
        CoreStats2.prototype.flush = function() {
          var formatted = this.metrics.map(function(m3) {
            return tslib_1.__assign(tslib_1.__assign({}, m3), { tags: m3.tags.join(",") });
          });
          if (console.table) {
            console.table(formatted);
          } else {
            console.log(formatted);
          }
          this.metrics = [];
        };
        CoreStats2.prototype.serialize = function() {
          return this.metrics.map(function(m3) {
            return {
              m: m3.metric,
              v: m3.value,
              t: m3.tags,
              k: compactMetricType(m3.type),
              e: m3.timestamp
            };
          });
        };
        return CoreStats2;
      })()
    );
    exports.CoreStats = CoreStats;
    var NullStats = (
      /** @class */
      (function(_super) {
        tslib_1.__extends(NullStats2, _super);
        function NullStats2() {
          return _super !== null && _super.apply(this, arguments) || this;
        }
        NullStats2.prototype.gauge = function() {
          var _args = [];
          for (var _i = 0; _i < arguments.length; _i++) {
            _args[_i] = arguments[_i];
          }
        };
        NullStats2.prototype.increment = function() {
          var _args = [];
          for (var _i = 0; _i < arguments.length; _i++) {
            _args[_i] = arguments[_i];
          }
        };
        NullStats2.prototype.flush = function() {
          var _args = [];
          for (var _i = 0; _i < arguments.length; _i++) {
            _args[_i] = arguments[_i];
          }
        };
        NullStats2.prototype.serialize = function() {
          var _args = [];
          for (var _i = 0; _i < arguments.length; _i++) {
            _args[_i] = arguments[_i];
          }
          return [];
        };
        return NullStats2;
      })(CoreStats)
    );
    exports.NullStats = NullStats;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/context/index.js
var require_context = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/context/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CoreContext = exports.ContextCancelation = void 0;
    var uuid_1 = require_dist2();
    var dset_1 = require_dist();
    var logger_1 = require_logger();
    var stats_1 = require_stats();
    var ContextCancelation = (
      /** @class */
      /* @__PURE__ */ (function() {
        function ContextCancelation2(options) {
          var _a, _b, _c;
          this.retry = (_a = options.retry) !== null && _a !== void 0 ? _a : true;
          this.type = (_b = options.type) !== null && _b !== void 0 ? _b : "plugin Error";
          this.reason = (_c = options.reason) !== null && _c !== void 0 ? _c : "";
        }
        return ContextCancelation2;
      })()
    );
    exports.ContextCancelation = ContextCancelation;
    var CoreContext = (
      /** @class */
      (function() {
        function CoreContext2(event, id, stats, logger) {
          if (id === void 0) {
            id = (0, uuid_1.v4)();
          }
          if (stats === void 0) {
            stats = new stats_1.NullStats();
          }
          if (logger === void 0) {
            logger = new logger_1.CoreLogger();
          }
          this.attempts = 0;
          this.event = event;
          this._id = id;
          this.logger = logger;
          this.stats = stats;
        }
        CoreContext2.system = function() {
        };
        CoreContext2.prototype.isSame = function(other) {
          return other.id === this.id;
        };
        CoreContext2.prototype.cancel = function(error) {
          if (error) {
            throw error;
          }
          throw new ContextCancelation({ reason: "Context Cancel" });
        };
        CoreContext2.prototype.log = function(level, message, extras) {
          this.logger.log(level, message, extras);
        };
        Object.defineProperty(CoreContext2.prototype, "id", {
          get: function() {
            return this._id;
          },
          enumerable: false,
          configurable: true
        });
        CoreContext2.prototype.updateEvent = function(path, val) {
          var _a;
          if (path.split(".")[0] === "integrations") {
            var integrationName = path.split(".")[1];
            if (((_a = this.event.integrations) === null || _a === void 0 ? void 0 : _a[integrationName]) === false) {
              return this.event;
            }
          }
          (0, dset_1.dset)(this.event, path, val);
          return this.event;
        };
        CoreContext2.prototype.failedDelivery = function() {
          return this._failedDelivery;
        };
        CoreContext2.prototype.setFailedDelivery = function(options) {
          this._failedDelivery = options;
        };
        CoreContext2.prototype.logs = function() {
          return this.logger.logs;
        };
        CoreContext2.prototype.flush = function() {
          this.logger.flush();
          this.stats.flush();
        };
        CoreContext2.prototype.toJSON = function() {
          return {
            id: this._id,
            event: this.event,
            logs: this.logger.logs,
            metrics: this.stats.metrics
          };
        };
        return CoreContext2;
      })()
    );
    exports.CoreContext = CoreContext;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/utils/group-by.js
var require_group_by = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/utils/group-by.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.groupBy = void 0;
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    function groupBy(collection, grouper) {
      var results = {};
      collection.forEach(function(item) {
        var _a;
        var key = void 0;
        if (typeof grouper === "string") {
          var suggestedKey = item[grouper];
          key = typeof suggestedKey !== "string" ? JSON.stringify(suggestedKey) : suggestedKey;
        } else if (grouper instanceof Function) {
          key = grouper(item);
        }
        if (key === void 0) {
          return;
        }
        results[key] = tslib_1.__spreadArray(tslib_1.__spreadArray([], (_a = results[key]) !== null && _a !== void 0 ? _a : [], true), [item], false);
      });
      return results;
    }
    exports.groupBy = groupBy;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/utils/is-thenable.js
var require_is_thenable = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/utils/is-thenable.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isThenable = void 0;
    var isThenable = function(value) {
      return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
    };
    exports.isThenable = isThenable;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/task/task-group.js
var require_task_group = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/task/task-group.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createTaskGroup = void 0;
    var is_thenable_1 = require_is_thenable();
    var createTaskGroup = function() {
      var taskCompletionPromise;
      var resolvePromise;
      var count = 0;
      return {
        done: function() {
          return taskCompletionPromise;
        },
        run: function(op) {
          var returnValue = op();
          if ((0, is_thenable_1.isThenable)(returnValue)) {
            if (++count === 1) {
              taskCompletionPromise = new Promise(function(res) {
                return resolvePromise = res;
              });
            }
            returnValue.finally(function() {
              return --count === 0 && resolvePromise();
            });
          }
          return returnValue;
        }
      };
    };
    exports.createTaskGroup = createTaskGroup;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/queue/delivery.js
var require_delivery = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/queue/delivery.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ensure = exports.attempt = void 0;
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    var context_1 = require_context();
    function tryAsync(fn) {
      return tslib_1.__awaiter(this, void 0, void 0, function() {
        var err_1;
        return tslib_1.__generator(this, function(_a) {
          switch (_a.label) {
            case 0:
              _a.trys.push([0, 2, , 3]);
              return [4, fn()];
            case 1:
              return [2, _a.sent()];
            case 2:
              err_1 = _a.sent();
              return [2, Promise.reject(err_1)];
            case 3:
              return [
                2
                /*return*/
              ];
          }
        });
      });
    }
    function attempt(ctx, plugin) {
      ctx.log("debug", "plugin", { plugin: plugin.name });
      var start = (/* @__PURE__ */ new Date()).getTime();
      var hook = plugin[ctx.event.type];
      if (hook === void 0) {
        return Promise.resolve(ctx);
      }
      var newCtx = tryAsync(function() {
        return hook.apply(plugin, [ctx]);
      }).then(function(ctx2) {
        var done = (/* @__PURE__ */ new Date()).getTime() - start;
        ctx2.stats.gauge("plugin_time", done, ["plugin:".concat(plugin.name)]);
        return ctx2;
      }).catch(function(err) {
        if (err instanceof context_1.ContextCancelation && err.type === "middleware_cancellation") {
          throw err;
        }
        if (err instanceof context_1.ContextCancelation) {
          ctx.log("warn", err.type, {
            plugin: plugin.name,
            error: err
          });
          return err;
        }
        ctx.log("error", "plugin Error", {
          plugin: plugin.name,
          error: err
        });
        ctx.stats.increment("plugin_error", 1, ["plugin:".concat(plugin.name)]);
        return err;
      });
      return newCtx;
    }
    exports.attempt = attempt;
    function ensure(ctx, plugin) {
      return attempt(ctx, plugin).then(function(newContext) {
        if (newContext instanceof context_1.CoreContext) {
          return newContext;
        }
        ctx.log("debug", "Context canceled");
        ctx.stats.increment("context_canceled");
        ctx.cancel(newContext);
      });
    }
    exports.ensure = ensure;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/queue/event-queue.js
var require_event_queue = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/queue/event-queue.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CoreEventQueue = void 0;
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    var group_by_1 = require_group_by();
    var priority_queue_1 = require_priority_queue();
    var context_1 = require_context();
    var analytics_generic_utils_1 = require_cjs2();
    var task_group_1 = require_task_group();
    var delivery_1 = require_delivery();
    var CoreEventQueue = (
      /** @class */
      (function(_super) {
        tslib_1.__extends(CoreEventQueue2, _super);
        function CoreEventQueue2(priorityQueue) {
          var _this = _super.call(this) || this;
          _this.criticalTasks = (0, task_group_1.createTaskGroup)();
          _this.plugins = [];
          _this.failedInitializations = [];
          _this.flushing = false;
          _this.queue = priorityQueue;
          _this.queue.on(priority_queue_1.ON_REMOVE_FROM_FUTURE, function() {
            _this.scheduleFlush(0);
          });
          return _this;
        }
        CoreEventQueue2.prototype.register = function(ctx, plugin, instance) {
          return tslib_1.__awaiter(this, void 0, void 0, function() {
            var handleLoadError, err_1;
            var _this = this;
            return tslib_1.__generator(this, function(_a) {
              switch (_a.label) {
                case 0:
                  this.plugins.push(plugin);
                  handleLoadError = function(err) {
                    _this.failedInitializations.push(plugin.name);
                    _this.emit("initialization_failure", plugin);
                    console.warn(plugin.name, err);
                    ctx.log("warn", "Failed to load destination", {
                      plugin: plugin.name,
                      error: err
                    });
                    _this.plugins = _this.plugins.filter(function(p5) {
                      return p5 !== plugin;
                    });
                  };
                  if (!(plugin.type === "destination" && plugin.name !== "Segment.io")) return [3, 1];
                  plugin.load(ctx, instance).catch(handleLoadError);
                  return [3, 4];
                case 1:
                  _a.trys.push([1, 3, , 4]);
                  return [4, plugin.load(ctx, instance)];
                case 2:
                  _a.sent();
                  return [3, 4];
                case 3:
                  err_1 = _a.sent();
                  handleLoadError(err_1);
                  return [3, 4];
                case 4:
                  return [
                    2
                    /*return*/
                  ];
              }
            });
          });
        };
        CoreEventQueue2.prototype.deregister = function(ctx, plugin, instance) {
          return tslib_1.__awaiter(this, void 0, void 0, function() {
            var e_1;
            return tslib_1.__generator(this, function(_a) {
              switch (_a.label) {
                case 0:
                  _a.trys.push([0, 3, , 4]);
                  if (!plugin.unload) return [3, 2];
                  return [4, Promise.resolve(plugin.unload(ctx, instance))];
                case 1:
                  _a.sent();
                  _a.label = 2;
                case 2:
                  this.plugins = this.plugins.filter(function(p5) {
                    return p5.name !== plugin.name;
                  });
                  return [3, 4];
                case 3:
                  e_1 = _a.sent();
                  ctx.log("warn", "Failed to unload destination", {
                    plugin: plugin.name,
                    error: e_1
                  });
                  return [3, 4];
                case 4:
                  return [
                    2
                    /*return*/
                  ];
              }
            });
          });
        };
        CoreEventQueue2.prototype.dispatch = function(ctx) {
          return tslib_1.__awaiter(this, void 0, void 0, function() {
            var willDeliver;
            return tslib_1.__generator(this, function(_a) {
              ctx.log("debug", "Dispatching");
              ctx.stats.increment("message_dispatched");
              this.queue.push(ctx);
              willDeliver = this.subscribeToDelivery(ctx);
              this.scheduleFlush(0);
              return [2, willDeliver];
            });
          });
        };
        CoreEventQueue2.prototype.subscribeToDelivery = function(ctx) {
          return tslib_1.__awaiter(this, void 0, void 0, function() {
            var _this = this;
            return tslib_1.__generator(this, function(_a) {
              return [2, new Promise(function(resolve) {
                var onDeliver = function(flushed, delivered) {
                  if (flushed.isSame(ctx)) {
                    _this.off("flush", onDeliver);
                    if (delivered) {
                      resolve(flushed);
                    } else {
                      resolve(flushed);
                    }
                  }
                };
                _this.on("flush", onDeliver);
              })];
            });
          });
        };
        CoreEventQueue2.prototype.dispatchSingle = function(ctx) {
          return tslib_1.__awaiter(this, void 0, void 0, function() {
            var _this = this;
            return tslib_1.__generator(this, function(_a) {
              ctx.log("debug", "Dispatching");
              ctx.stats.increment("message_dispatched");
              this.queue.updateAttempts(ctx);
              ctx.attempts = 1;
              return [2, this.deliver(ctx).catch(function(err) {
                var accepted = _this.enqueuRetry(err, ctx);
                if (!accepted) {
                  ctx.setFailedDelivery({ reason: err });
                  return ctx;
                }
                return _this.subscribeToDelivery(ctx);
              })];
            });
          });
        };
        CoreEventQueue2.prototype.isEmpty = function() {
          return this.queue.length === 0;
        };
        CoreEventQueue2.prototype.scheduleFlush = function(timeout) {
          var _this = this;
          if (timeout === void 0) {
            timeout = 500;
          }
          if (this.flushing) {
            return;
          }
          this.flushing = true;
          setTimeout(function() {
            _this.flush().then(function() {
              setTimeout(function() {
                _this.flushing = false;
                if (_this.queue.length) {
                  _this.scheduleFlush(0);
                }
              }, 0);
            });
          }, timeout);
        };
        CoreEventQueue2.prototype.deliver = function(ctx) {
          var _a;
          return tslib_1.__awaiter(this, void 0, void 0, function() {
            var start, done, failure, error, err_2, error;
            return tslib_1.__generator(this, function(_b) {
              switch (_b.label) {
                case 0:
                  return [4, this.criticalTasks.done()];
                case 1:
                  _b.sent();
                  start = Date.now();
                  _b.label = 2;
                case 2:
                  _b.trys.push([2, 4, , 5]);
                  return [4, this.flushOne(ctx)];
                case 3:
                  ctx = _b.sent();
                  done = Date.now() - start;
                  failure = ctx.failedDelivery();
                  if (failure) {
                    error = failure.reason instanceof Error ? failure.reason : new Error(String((_a = failure.reason) !== null && _a !== void 0 ? _a : "Unknown delivery failure"));
                    ctx.log("error", "Failed to deliver", error);
                    this.emit("delivery_failure", ctx, error);
                    ctx.stats.increment("delivery_failed");
                    return [2, ctx];
                  }
                  this.emit("delivery_success", ctx);
                  ctx.stats.gauge("delivered", done);
                  ctx.log("debug", "Delivered", ctx.event);
                  return [2, ctx];
                case 4:
                  err_2 = _b.sent();
                  error = err_2;
                  ctx.log("error", "Failed to deliver", error);
                  this.emit("delivery_failure", ctx, error);
                  ctx.stats.increment("delivery_failed");
                  throw err_2;
                case 5:
                  return [
                    2
                    /*return*/
                  ];
              }
            });
          });
        };
        CoreEventQueue2.prototype.enqueuRetry = function(err, ctx) {
          var retriable = !(err instanceof context_1.ContextCancelation) || err.retry;
          if (!retriable) {
            return false;
          }
          return this.queue.pushWithBackoff(ctx);
        };
        CoreEventQueue2.prototype.flush = function() {
          return tslib_1.__awaiter(this, void 0, void 0, function() {
            var ctx, delivered, err_3, accepted;
            return tslib_1.__generator(this, function(_a) {
              switch (_a.label) {
                case 0:
                  if (this.queue.length === 0) {
                    return [2, []];
                  }
                  ctx = this.queue.pop();
                  if (!ctx) {
                    return [2, []];
                  }
                  ctx.attempts = this.queue.getAttempts(ctx);
                  _a.label = 1;
                case 1:
                  _a.trys.push([1, 3, , 4]);
                  return [
                    4,
                    this.deliver(ctx)
                    // deliver() now handles failedDelivery state internally without throwing,
                    // so we check ctx.failedDelivery() to determine the correct flush status
                  ];
                case 2:
                  ctx = _a.sent();
                  delivered = !ctx.failedDelivery();
                  this.emit("flush", ctx, delivered);
                  return [3, 4];
                case 3:
                  err_3 = _a.sent();
                  accepted = this.enqueuRetry(err_3, ctx);
                  if (!accepted) {
                    ctx.setFailedDelivery({ reason: err_3 });
                    this.emit("flush", ctx, false);
                  }
                  return [2, []];
                case 4:
                  return [2, [ctx]];
              }
            });
          });
        };
        CoreEventQueue2.prototype.isReady = function() {
          return true;
        };
        CoreEventQueue2.prototype.availableExtensions = function(denyList) {
          var available = this.plugins.filter(function(p5) {
            var _a2, _b2, _c2;
            if (p5.type !== "destination" && p5.name !== "Segment.io") {
              return true;
            }
            var alternativeNameMatch = void 0;
            (_a2 = p5.alternativeNames) === null || _a2 === void 0 ? void 0 : _a2.forEach(function(name) {
              if (denyList[name] !== void 0) {
                alternativeNameMatch = denyList[name];
              }
            });
            return (_c2 = (_b2 = denyList[p5.name]) !== null && _b2 !== void 0 ? _b2 : alternativeNameMatch) !== null && _c2 !== void 0 ? _c2 : (p5.name === "Segment.io" ? true : denyList.All) !== false;
          });
          var _a = (0, group_by_1.groupBy)(available, "type"), _b = _a.before, before = _b === void 0 ? [] : _b, _c = _a.enrichment, enrichment = _c === void 0 ? [] : _c, _d = _a.destination, destination = _d === void 0 ? [] : _d, _e = _a.after, after = _e === void 0 ? [] : _e;
          return {
            before,
            enrichment,
            destinations: destination,
            after
          };
        };
        CoreEventQueue2.prototype.flushOne = function(ctx) {
          var _a, _b;
          return tslib_1.__awaiter(this, void 0, void 0, function() {
            var _c, before, enrichment, _i, before_1, beforeWare, temp, _d, enrichment_1, enrichmentWare, temp, _e, destinations, after, afterCalls;
            return tslib_1.__generator(this, function(_f) {
              switch (_f.label) {
                case 0:
                  if (!this.isReady()) {
                    throw new Error("Not ready");
                  }
                  if (ctx.attempts > 1) {
                    this.emit("delivery_retry", ctx);
                  }
                  _c = this.availableExtensions((_a = ctx.event.integrations) !== null && _a !== void 0 ? _a : {}), before = _c.before, enrichment = _c.enrichment;
                  _i = 0, before_1 = before;
                  _f.label = 1;
                case 1:
                  if (!(_i < before_1.length)) return [3, 4];
                  beforeWare = before_1[_i];
                  return [4, (0, delivery_1.ensure)(ctx, beforeWare)];
                case 2:
                  temp = _f.sent();
                  if (temp instanceof context_1.CoreContext) {
                    ctx = temp;
                  }
                  this.emit("message_enriched", ctx, beforeWare);
                  _f.label = 3;
                case 3:
                  _i++;
                  return [3, 1];
                case 4:
                  _d = 0, enrichment_1 = enrichment;
                  _f.label = 5;
                case 5:
                  if (!(_d < enrichment_1.length)) return [3, 8];
                  enrichmentWare = enrichment_1[_d];
                  return [4, (0, delivery_1.attempt)(ctx, enrichmentWare)];
                case 6:
                  temp = _f.sent();
                  if (temp instanceof context_1.CoreContext) {
                    ctx = temp;
                  }
                  this.emit("message_enriched", ctx, enrichmentWare);
                  _f.label = 7;
                case 7:
                  _d++;
                  return [3, 5];
                case 8:
                  _e = this.availableExtensions((_b = ctx.event.integrations) !== null && _b !== void 0 ? _b : {}), destinations = _e.destinations, after = _e.after;
                  return [4, new Promise(function(resolve, reject) {
                    setTimeout(function() {
                      var attempts = destinations.map(function(destination) {
                        return (0, delivery_1.attempt)(ctx, destination);
                      });
                      Promise.all(attempts).then(resolve).catch(reject);
                    }, 0);
                  })];
                case 9:
                  _f.sent();
                  ctx.stats.increment("message_delivered");
                  this.emit("message_delivered", ctx);
                  afterCalls = after.map(function(after2) {
                    return (0, delivery_1.attempt)(ctx, after2);
                  });
                  return [4, Promise.all(afterCalls)];
                case 10:
                  _f.sent();
                  return [2, ctx];
              }
            });
          });
        };
        return CoreEventQueue2;
      })(analytics_generic_utils_1.Emitter)
    );
    exports.CoreEventQueue = CoreEventQueue;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/analytics/index.js
var require_analytics = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/analytics/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/@segment/analytics-core/dist/cjs/analytics/dispatch.js
var require_dispatch = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/analytics/dispatch.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.dispatch = exports.getDelay = void 0;
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    var callback_1 = require_callback();
    var getDelay = function(startTimeInEpochMS, timeoutInMS) {
      var elapsedTime = Date.now() - startTimeInEpochMS;
      return Math.max((timeoutInMS !== null && timeoutInMS !== void 0 ? timeoutInMS : 300) - elapsedTime, 0);
    };
    exports.getDelay = getDelay;
    function dispatch(ctx, queue, emitter, options) {
      return tslib_1.__awaiter(this, void 0, void 0, function() {
        var startTime, dispatched;
        return tslib_1.__generator(this, function(_a) {
          switch (_a.label) {
            case 0:
              emitter.emit("dispatch_start", ctx);
              startTime = Date.now();
              if (!queue.isEmpty()) return [3, 2];
              return [4, queue.dispatchSingle(ctx)];
            case 1:
              dispatched = _a.sent();
              return [3, 4];
            case 2:
              return [4, queue.dispatch(ctx)];
            case 3:
              dispatched = _a.sent();
              _a.label = 4;
            case 4:
              if (!(options === null || options === void 0 ? void 0 : options.callback)) return [3, 6];
              return [4, (0, callback_1.invokeCallback)(dispatched, options.callback, (0, exports.getDelay)(startTime, options.timeout))];
            case 5:
              dispatched = _a.sent();
              _a.label = 6;
            case 6:
              if (options === null || options === void 0 ? void 0 : options.debug) {
                dispatched.flush();
              }
              return [2, dispatched];
          }
        });
      });
    }
    exports.dispatch = dispatch;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/utils/bind-all.js
var require_bind_all = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/utils/bind-all.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.bindAll = void 0;
    function bindAll(obj) {
      var proto = obj.constructor.prototype;
      for (var _i = 0, _a = Object.getOwnPropertyNames(proto); _i < _a.length; _i++) {
        var key = _a[_i];
        if (key !== "constructor") {
          var desc = Object.getOwnPropertyDescriptor(obj.constructor.prototype, key);
          if (!!desc && typeof desc.value === "function") {
            obj[key] = obj[key].bind(obj);
          }
        }
      }
      return obj;
    }
    exports.bindAll = bindAll;
  }
});

// node_modules/@segment/analytics-core/dist/cjs/index.js
var require_cjs3 = __commonJS({
  "node_modules/@segment/analytics-core/dist/cjs/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CoreLogger = exports.backoff = void 0;
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    tslib_1.__exportStar(require_interface(), exports);
    tslib_1.__exportStar(require_plugins(), exports);
    tslib_1.__exportStar(require_interfaces(), exports);
    tslib_1.__exportStar(require_events(), exports);
    tslib_1.__exportStar(require_callback(), exports);
    tslib_1.__exportStar(require_priority_queue(), exports);
    var backoff_1 = require_backoff();
    Object.defineProperty(exports, "backoff", { enumerable: true, get: function() {
      return backoff_1.backoff;
    } });
    tslib_1.__exportStar(require_context(), exports);
    tslib_1.__exportStar(require_event_queue(), exports);
    tslib_1.__exportStar(require_analytics(), exports);
    tslib_1.__exportStar(require_dispatch(), exports);
    tslib_1.__exportStar(require_helpers(), exports);
    tslib_1.__exportStar(require_errors(), exports);
    tslib_1.__exportStar(require_assertions(), exports);
    tslib_1.__exportStar(require_bind_all(), exports);
    tslib_1.__exportStar(require_stats(), exports);
    var logger_1 = require_logger();
    Object.defineProperty(exports, "CoreLogger", { enumerable: true, get: function() {
      return logger_1.CoreLogger;
    } });
    tslib_1.__exportStar(require_delivery(), exports);
  }
});

// node_modules/@segment/analytics-node/dist/cjs/app/settings.js
var require_settings = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/app/settings.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateSettings = void 0;
    var analytics_core_1 = require_cjs3();
    var validateSettings = (settings) => {
      if (!settings.writeKey) {
        throw new analytics_core_1.ValidationError("writeKey", "writeKey is missing.");
      }
    };
    exports.validateSettings = validateSettings;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/generated/version.js
var require_version = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/generated/version.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.version = void 0;
    exports.version = "3.1.0";
  }
});

// node_modules/@segment/analytics-node/dist/cjs/lib/create-url.js
var require_create_url = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/lib/create-url.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.tryCreateFormattedUrl = void 0;
    var stripTrailingSlash = (str) => str.replace(/\/$/, "");
    var tryCreateFormattedUrl = (host, path) => {
      return stripTrailingSlash(new URL(path || "", host).href);
    };
    exports.tryCreateFormattedUrl = tryCreateFormattedUrl;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/lib/uuid.js
var require_uuid = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/lib/uuid.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.uuid = void 0;
    var uuid_1 = require_dist2();
    Object.defineProperty(exports, "uuid", { enumerable: true, get: function() {
      return uuid_1.v4;
    } });
  }
});

// node_modules/@segment/analytics-node/dist/cjs/plugins/segmentio/context-batch.js
var require_context_batch = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/plugins/segmentio/context-batch.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ContextBatch = void 0;
    var uuid_1 = require_uuid();
    var MAX_EVENT_SIZE_IN_KB = 32;
    var MAX_BATCH_SIZE_IN_KB = 480;
    var ContextBatch = class {
      id = (0, uuid_1.uuid)();
      items = [];
      sizeInBytes = 0;
      maxEventCount;
      constructor(maxEventCount) {
        this.maxEventCount = Math.max(1, maxEventCount);
      }
      tryAdd(item) {
        if (this.length === this.maxEventCount)
          return {
            success: false,
            message: `Event limit of ${this.maxEventCount} has been exceeded.`
          };
        const eventSize = this.calculateSize(item.context);
        if (eventSize > MAX_EVENT_SIZE_IN_KB * 1024) {
          return {
            success: false,
            message: `Event exceeds maximum event size of ${MAX_EVENT_SIZE_IN_KB} KB`
          };
        }
        if (this.sizeInBytes + eventSize > MAX_BATCH_SIZE_IN_KB * 1024) {
          return {
            success: false,
            message: `Event has caused batch size to exceed ${MAX_BATCH_SIZE_IN_KB} KB`
          };
        }
        this.items.push(item);
        this.sizeInBytes += eventSize;
        return { success: true };
      }
      get length() {
        return this.items.length;
      }
      calculateSize(ctx) {
        return encodeURI(JSON.stringify(ctx.event)).split(/%..|i/).length;
      }
      getEvents() {
        const events = this.items.map(({ context }) => context.event);
        return events;
      }
      getContexts() {
        return this.items.map((item) => item.context);
      }
      resolveEvents() {
        this.items.forEach(({ resolver, context }) => resolver(context));
      }
    };
    exports.ContextBatch = ContextBatch;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/digest.js
var require_digest = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/digest.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var node_crypto_1 = __require("node:crypto");
    var digest = (algorithm, data) => (0, node_crypto_1.createHash)(algorithm).update(data).digest();
    exports.default = digest;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/buffer_utils.js
var require_buffer_utils = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/buffer_utils.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decoder = exports.encoder = void 0;
    exports.concat = concat3;
    exports.p2s = p2s;
    exports.uint64be = uint64be;
    exports.uint32be = uint32be;
    exports.lengthAndInput = lengthAndInput;
    exports.concatKdf = concatKdf;
    var digest_js_1 = require_digest();
    exports.encoder = new TextEncoder();
    exports.decoder = new TextDecoder();
    var MAX_INT32 = 2 ** 32;
    function concat3(...buffers) {
      const size5 = buffers.reduce((acc, { length }) => acc + length, 0);
      const buf = new Uint8Array(size5);
      let i5 = 0;
      for (const buffer2 of buffers) {
        buf.set(buffer2, i5);
        i5 += buffer2.length;
      }
      return buf;
    }
    function p2s(alg, p2sInput) {
      return concat3(exports.encoder.encode(alg), new Uint8Array([0]), p2sInput);
    }
    function writeUInt32BE(buf, value, offset) {
      if (value < 0 || value >= MAX_INT32) {
        throw new RangeError(`value must be >= 0 and <= ${MAX_INT32 - 1}. Received ${value}`);
      }
      buf.set([value >>> 24, value >>> 16, value >>> 8, value & 255], offset);
    }
    function uint64be(value) {
      const high = Math.floor(value / MAX_INT32);
      const low = value % MAX_INT32;
      const buf = new Uint8Array(8);
      writeUInt32BE(buf, high, 0);
      writeUInt32BE(buf, low, 4);
      return buf;
    }
    function uint32be(value) {
      const buf = new Uint8Array(4);
      writeUInt32BE(buf, value);
      return buf;
    }
    function lengthAndInput(input) {
      return concat3(uint32be(input.length), input);
    }
    async function concatKdf(secret, bits, value) {
      const iterations = Math.ceil((bits >> 3) / 32);
      const res = new Uint8Array(iterations * 32);
      for (let iter = 0; iter < iterations; iter++) {
        const buf = new Uint8Array(4 + secret.length + value.length);
        buf.set(uint32be(iter + 1));
        buf.set(secret, 4);
        buf.set(value, 4 + secret.length);
        res.set(await (0, digest_js_1.default)("sha256", buf), iter * 32);
      }
      return res.slice(0, bits >> 3);
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/base64url.js
var require_base64url = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/base64url.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decode = exports.encode = exports.encodeBase64 = exports.decodeBase64 = void 0;
    var node_buffer_1 = __require("node:buffer");
    var buffer_utils_js_1 = require_buffer_utils();
    function normalize(input) {
      let encoded = input;
      if (encoded instanceof Uint8Array) {
        encoded = buffer_utils_js_1.decoder.decode(encoded);
      }
      return encoded;
    }
    var encode4 = (input) => node_buffer_1.Buffer.from(input).toString("base64url");
    exports.encode = encode4;
    var decodeBase64 = (input) => new Uint8Array(node_buffer_1.Buffer.from(input, "base64"));
    exports.decodeBase64 = decodeBase64;
    var encodeBase64 = (input) => node_buffer_1.Buffer.from(input).toString("base64");
    exports.encodeBase64 = encodeBase64;
    var decode2 = (input) => new Uint8Array(node_buffer_1.Buffer.from(normalize(input), "base64url"));
    exports.decode = decode2;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/util/errors.js
var require_errors2 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/util/errors.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.JWSSignatureVerificationFailed = exports.JWKSTimeout = exports.JWKSMultipleMatchingKeys = exports.JWKSNoMatchingKey = exports.JWKSInvalid = exports.JWKInvalid = exports.JWTInvalid = exports.JWSInvalid = exports.JWEInvalid = exports.JWEDecryptionFailed = exports.JOSENotSupported = exports.JOSEAlgNotAllowed = exports.JWTExpired = exports.JWTClaimValidationFailed = exports.JOSEError = void 0;
    var JOSEError = class extends Error {
      static code = "ERR_JOSE_GENERIC";
      code = "ERR_JOSE_GENERIC";
      constructor(message, options) {
        super(message, options);
        this.name = this.constructor.name;
        Error.captureStackTrace?.(this, this.constructor);
      }
    };
    exports.JOSEError = JOSEError;
    var JWTClaimValidationFailed = class extends JOSEError {
      static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
      code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
      claim;
      reason;
      payload;
      constructor(message, payload, claim = "unspecified", reason = "unspecified") {
        super(message, { cause: { claim, reason, payload } });
        this.claim = claim;
        this.reason = reason;
        this.payload = payload;
      }
    };
    exports.JWTClaimValidationFailed = JWTClaimValidationFailed;
    var JWTExpired = class extends JOSEError {
      static code = "ERR_JWT_EXPIRED";
      code = "ERR_JWT_EXPIRED";
      claim;
      reason;
      payload;
      constructor(message, payload, claim = "unspecified", reason = "unspecified") {
        super(message, { cause: { claim, reason, payload } });
        this.claim = claim;
        this.reason = reason;
        this.payload = payload;
      }
    };
    exports.JWTExpired = JWTExpired;
    var JOSEAlgNotAllowed = class extends JOSEError {
      static code = "ERR_JOSE_ALG_NOT_ALLOWED";
      code = "ERR_JOSE_ALG_NOT_ALLOWED";
    };
    exports.JOSEAlgNotAllowed = JOSEAlgNotAllowed;
    var JOSENotSupported = class extends JOSEError {
      static code = "ERR_JOSE_NOT_SUPPORTED";
      code = "ERR_JOSE_NOT_SUPPORTED";
    };
    exports.JOSENotSupported = JOSENotSupported;
    var JWEDecryptionFailed = class extends JOSEError {
      static code = "ERR_JWE_DECRYPTION_FAILED";
      code = "ERR_JWE_DECRYPTION_FAILED";
      constructor(message = "decryption operation failed", options) {
        super(message, options);
      }
    };
    exports.JWEDecryptionFailed = JWEDecryptionFailed;
    var JWEInvalid = class extends JOSEError {
      static code = "ERR_JWE_INVALID";
      code = "ERR_JWE_INVALID";
    };
    exports.JWEInvalid = JWEInvalid;
    var JWSInvalid = class extends JOSEError {
      static code = "ERR_JWS_INVALID";
      code = "ERR_JWS_INVALID";
    };
    exports.JWSInvalid = JWSInvalid;
    var JWTInvalid = class extends JOSEError {
      static code = "ERR_JWT_INVALID";
      code = "ERR_JWT_INVALID";
    };
    exports.JWTInvalid = JWTInvalid;
    var JWKInvalid = class extends JOSEError {
      static code = "ERR_JWK_INVALID";
      code = "ERR_JWK_INVALID";
    };
    exports.JWKInvalid = JWKInvalid;
    var JWKSInvalid = class extends JOSEError {
      static code = "ERR_JWKS_INVALID";
      code = "ERR_JWKS_INVALID";
    };
    exports.JWKSInvalid = JWKSInvalid;
    var JWKSNoMatchingKey = class extends JOSEError {
      static code = "ERR_JWKS_NO_MATCHING_KEY";
      code = "ERR_JWKS_NO_MATCHING_KEY";
      constructor(message = "no applicable key found in the JSON Web Key Set", options) {
        super(message, options);
      }
    };
    exports.JWKSNoMatchingKey = JWKSNoMatchingKey;
    var JWKSMultipleMatchingKeys = class extends JOSEError {
      [Symbol.asyncIterator];
      static code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
      code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
      constructor(message = "multiple matching keys found in the JSON Web Key Set", options) {
        super(message, options);
      }
    };
    exports.JWKSMultipleMatchingKeys = JWKSMultipleMatchingKeys;
    var JWKSTimeout = class extends JOSEError {
      static code = "ERR_JWKS_TIMEOUT";
      code = "ERR_JWKS_TIMEOUT";
      constructor(message = "request timed out", options) {
        super(message, options);
      }
    };
    exports.JWKSTimeout = JWKSTimeout;
    var JWSSignatureVerificationFailed = class extends JOSEError {
      static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
      code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
      constructor(message = "signature verification failed", options) {
        super(message, options);
      }
    };
    exports.JWSSignatureVerificationFailed = JWSSignatureVerificationFailed;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/random.js
var require_random = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/random.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = void 0;
    var node_crypto_1 = __require("node:crypto");
    Object.defineProperty(exports, "default", { enumerable: true, get: function() {
      return node_crypto_1.randomFillSync;
    } });
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/iv.js
var require_iv = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/iv.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.bitLength = bitLength;
    var errors_js_1 = require_errors2();
    var random_js_1 = require_random();
    function bitLength(alg) {
      switch (alg) {
        case "A128GCM":
        case "A128GCMKW":
        case "A192GCM":
        case "A192GCMKW":
        case "A256GCM":
        case "A256GCMKW":
          return 96;
        case "A128CBC-HS256":
        case "A192CBC-HS384":
        case "A256CBC-HS512":
          return 128;
        default:
          throw new errors_js_1.JOSENotSupported(`Unsupported JWE Algorithm: ${alg}`);
      }
    }
    exports.default = (alg) => (0, random_js_1.default)(new Uint8Array(bitLength(alg) >> 3));
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/check_iv_length.js
var require_check_iv_length = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/check_iv_length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var errors_js_1 = require_errors2();
    var iv_js_1 = require_iv();
    var checkIvLength = (enc, iv) => {
      if (iv.length << 3 !== (0, iv_js_1.bitLength)(enc)) {
        throw new errors_js_1.JWEInvalid("Invalid Initialization Vector length");
      }
    };
    exports.default = checkIvLength;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/is_key_object.js
var require_is_key_object = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/is_key_object.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util = __require("node:util");
    exports.default = (obj) => util.types.isKeyObject(obj);
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/check_cek_length.js
var require_check_cek_length = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/check_cek_length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var errors_js_1 = require_errors2();
    var is_key_object_js_1 = require_is_key_object();
    var checkCekLength = (enc, cek) => {
      let expected;
      switch (enc) {
        case "A128CBC-HS256":
        case "A192CBC-HS384":
        case "A256CBC-HS512":
          expected = parseInt(enc.slice(-3), 10);
          break;
        case "A128GCM":
        case "A192GCM":
        case "A256GCM":
          expected = parseInt(enc.slice(1, 4), 10);
          break;
        default:
          throw new errors_js_1.JOSENotSupported(`Content Encryption Algorithm ${enc} is not supported either by JOSE or your javascript runtime`);
      }
      if (cek instanceof Uint8Array) {
        const actual = cek.byteLength << 3;
        if (actual !== expected) {
          throw new errors_js_1.JWEInvalid(`Invalid Content Encryption Key length. Expected ${expected} bits, got ${actual} bits`);
        }
        return;
      }
      if ((0, is_key_object_js_1.default)(cek) && cek.type === "secret") {
        const actual = cek.symmetricKeySize << 3;
        if (actual !== expected) {
          throw new errors_js_1.JWEInvalid(`Invalid Content Encryption Key length. Expected ${expected} bits, got ${actual} bits`);
        }
        return;
      }
      throw new TypeError("Invalid Content Encryption Key type");
    };
    exports.default = checkCekLength;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/timing_safe_equal.js
var require_timing_safe_equal = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/timing_safe_equal.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var node_crypto_1 = __require("node:crypto");
    var timingSafeEqual = node_crypto_1.timingSafeEqual;
    exports.default = timingSafeEqual;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/cbc_tag.js
var require_cbc_tag = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/cbc_tag.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = cbcTag;
    var node_crypto_1 = __require("node:crypto");
    var buffer_utils_js_1 = require_buffer_utils();
    function cbcTag(aad, iv, ciphertext, macSize, macKey, keySize) {
      const macData = (0, buffer_utils_js_1.concat)(aad, iv, ciphertext, (0, buffer_utils_js_1.uint64be)(aad.length << 3));
      const hmac = (0, node_crypto_1.createHmac)(`sha${macSize}`, macKey);
      hmac.update(macData);
      return hmac.digest().slice(0, keySize >> 3);
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/webcrypto.js
var require_webcrypto = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/webcrypto.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isCryptoKey = void 0;
    var crypto = __require("node:crypto");
    var util = __require("node:util");
    var webcrypto = crypto.webcrypto;
    exports.default = webcrypto;
    var isCryptoKey = (key) => util.types.isCryptoKey(key);
    exports.isCryptoKey = isCryptoKey;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/crypto_key.js
var require_crypto_key = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/crypto_key.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.checkSigCryptoKey = checkSigCryptoKey;
    exports.checkEncCryptoKey = checkEncCryptoKey;
    function unusable(name, prop = "algorithm.name") {
      return new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`);
    }
    function isAlgorithm(algorithm, name) {
      return algorithm.name === name;
    }
    function getHashLength(hash2) {
      return parseInt(hash2.name.slice(4), 10);
    }
    function getNamedCurve(alg) {
      switch (alg) {
        case "ES256":
          return "P-256";
        case "ES384":
          return "P-384";
        case "ES512":
          return "P-521";
        default:
          throw new Error("unreachable");
      }
    }
    function checkUsage(key, usages) {
      if (usages.length && !usages.some((expected) => key.usages.includes(expected))) {
        let msg = "CryptoKey does not support this operation, its usages must include ";
        if (usages.length > 2) {
          const last = usages.pop();
          msg += `one of ${usages.join(", ")}, or ${last}.`;
        } else if (usages.length === 2) {
          msg += `one of ${usages[0]} or ${usages[1]}.`;
        } else {
          msg += `${usages[0]}.`;
        }
        throw new TypeError(msg);
      }
    }
    function checkSigCryptoKey(key, alg, ...usages) {
      switch (alg) {
        case "HS256":
        case "HS384":
        case "HS512": {
          if (!isAlgorithm(key.algorithm, "HMAC"))
            throw unusable("HMAC");
          const expected = parseInt(alg.slice(2), 10);
          const actual = getHashLength(key.algorithm.hash);
          if (actual !== expected)
            throw unusable(`SHA-${expected}`, "algorithm.hash");
          break;
        }
        case "RS256":
        case "RS384":
        case "RS512": {
          if (!isAlgorithm(key.algorithm, "RSASSA-PKCS1-v1_5"))
            throw unusable("RSASSA-PKCS1-v1_5");
          const expected = parseInt(alg.slice(2), 10);
          const actual = getHashLength(key.algorithm.hash);
          if (actual !== expected)
            throw unusable(`SHA-${expected}`, "algorithm.hash");
          break;
        }
        case "PS256":
        case "PS384":
        case "PS512": {
          if (!isAlgorithm(key.algorithm, "RSA-PSS"))
            throw unusable("RSA-PSS");
          const expected = parseInt(alg.slice(2), 10);
          const actual = getHashLength(key.algorithm.hash);
          if (actual !== expected)
            throw unusable(`SHA-${expected}`, "algorithm.hash");
          break;
        }
        case "EdDSA": {
          if (key.algorithm.name !== "Ed25519" && key.algorithm.name !== "Ed448") {
            throw unusable("Ed25519 or Ed448");
          }
          break;
        }
        case "Ed25519": {
          if (!isAlgorithm(key.algorithm, "Ed25519"))
            throw unusable("Ed25519");
          break;
        }
        case "ES256":
        case "ES384":
        case "ES512": {
          if (!isAlgorithm(key.algorithm, "ECDSA"))
            throw unusable("ECDSA");
          const expected = getNamedCurve(alg);
          const actual = key.algorithm.namedCurve;
          if (actual !== expected)
            throw unusable(expected, "algorithm.namedCurve");
          break;
        }
        default:
          throw new TypeError("CryptoKey does not support this operation");
      }
      checkUsage(key, usages);
    }
    function checkEncCryptoKey(key, alg, ...usages) {
      switch (alg) {
        case "A128GCM":
        case "A192GCM":
        case "A256GCM": {
          if (!isAlgorithm(key.algorithm, "AES-GCM"))
            throw unusable("AES-GCM");
          const expected = parseInt(alg.slice(1, 4), 10);
          const actual = key.algorithm.length;
          if (actual !== expected)
            throw unusable(expected, "algorithm.length");
          break;
        }
        case "A128KW":
        case "A192KW":
        case "A256KW": {
          if (!isAlgorithm(key.algorithm, "AES-KW"))
            throw unusable("AES-KW");
          const expected = parseInt(alg.slice(1, 4), 10);
          const actual = key.algorithm.length;
          if (actual !== expected)
            throw unusable(expected, "algorithm.length");
          break;
        }
        case "ECDH": {
          switch (key.algorithm.name) {
            case "ECDH":
            case "X25519":
            case "X448":
              break;
            default:
              throw unusable("ECDH, X25519, or X448");
          }
          break;
        }
        case "PBES2-HS256+A128KW":
        case "PBES2-HS384+A192KW":
        case "PBES2-HS512+A256KW":
          if (!isAlgorithm(key.algorithm, "PBKDF2"))
            throw unusable("PBKDF2");
          break;
        case "RSA-OAEP":
        case "RSA-OAEP-256":
        case "RSA-OAEP-384":
        case "RSA-OAEP-512": {
          if (!isAlgorithm(key.algorithm, "RSA-OAEP"))
            throw unusable("RSA-OAEP");
          const expected = parseInt(alg.slice(9), 10) || 1;
          const actual = getHashLength(key.algorithm.hash);
          if (actual !== expected)
            throw unusable(`SHA-${expected}`, "algorithm.hash");
          break;
        }
        default:
          throw new TypeError("CryptoKey does not support this operation");
      }
      checkUsage(key, usages);
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/invalid_key_input.js
var require_invalid_key_input = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/invalid_key_input.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.withAlg = withAlg;
    function message(msg, actual, ...types) {
      types = types.filter(Boolean);
      if (types.length > 2) {
        const last = types.pop();
        msg += `one of type ${types.join(", ")}, or ${last}.`;
      } else if (types.length === 2) {
        msg += `one of type ${types[0]} or ${types[1]}.`;
      } else {
        msg += `of type ${types[0]}.`;
      }
      if (actual == null) {
        msg += ` Received ${actual}`;
      } else if (typeof actual === "function" && actual.name) {
        msg += ` Received function ${actual.name}`;
      } else if (typeof actual === "object" && actual != null) {
        if (actual.constructor?.name) {
          msg += ` Received an instance of ${actual.constructor.name}`;
        }
      }
      return msg;
    }
    exports.default = (actual, ...types) => {
      return message("Key must be ", actual, ...types);
    };
    function withAlg(alg, actual, ...types) {
      return message(`Key for the ${alg} algorithm must be `, actual, ...types);
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/ciphers.js
var require_ciphers = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/ciphers.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var node_crypto_1 = __require("node:crypto");
    var ciphers;
    exports.default = (algorithm) => {
      ciphers ||= new Set((0, node_crypto_1.getCiphers)());
      return ciphers.has(algorithm);
    };
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/is_key_like.js
var require_is_key_like = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/is_key_like.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.types = void 0;
    var webcrypto_js_1 = require_webcrypto();
    var is_key_object_js_1 = require_is_key_object();
    exports.default = (key) => (0, is_key_object_js_1.default)(key) || (0, webcrypto_js_1.isCryptoKey)(key);
    var types = ["KeyObject"];
    exports.types = types;
    if (globalThis.CryptoKey || webcrypto_js_1.default?.CryptoKey) {
      types.push("CryptoKey");
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/decrypt.js
var require_decrypt = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/decrypt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var node_crypto_1 = __require("node:crypto");
    var check_iv_length_js_1 = require_check_iv_length();
    var check_cek_length_js_1 = require_check_cek_length();
    var buffer_utils_js_1 = require_buffer_utils();
    var errors_js_1 = require_errors2();
    var timing_safe_equal_js_1 = require_timing_safe_equal();
    var cbc_tag_js_1 = require_cbc_tag();
    var webcrypto_js_1 = require_webcrypto();
    var crypto_key_js_1 = require_crypto_key();
    var is_key_object_js_1 = require_is_key_object();
    var invalid_key_input_js_1 = require_invalid_key_input();
    var ciphers_js_1 = require_ciphers();
    var is_key_like_js_1 = require_is_key_like();
    function cbcDecrypt(enc, cek, ciphertext, iv, tag, aad) {
      const keySize = parseInt(enc.slice(1, 4), 10);
      if ((0, is_key_object_js_1.default)(cek)) {
        cek = cek.export();
      }
      const encKey = cek.subarray(keySize >> 3);
      const macKey = cek.subarray(0, keySize >> 3);
      const macSize = parseInt(enc.slice(-3), 10);
      const algorithm = `aes-${keySize}-cbc`;
      if (!(0, ciphers_js_1.default)(algorithm)) {
        throw new errors_js_1.JOSENotSupported(`alg ${enc} is not supported by your javascript runtime`);
      }
      const expectedTag = (0, cbc_tag_js_1.default)(aad, iv, ciphertext, macSize, macKey, keySize);
      let macCheckPassed;
      try {
        macCheckPassed = (0, timing_safe_equal_js_1.default)(tag, expectedTag);
      } catch {
      }
      if (!macCheckPassed) {
        throw new errors_js_1.JWEDecryptionFailed();
      }
      let plaintext;
      try {
        const decipher = (0, node_crypto_1.createDecipheriv)(algorithm, encKey, iv);
        plaintext = (0, buffer_utils_js_1.concat)(decipher.update(ciphertext), decipher.final());
      } catch {
      }
      if (!plaintext) {
        throw new errors_js_1.JWEDecryptionFailed();
      }
      return plaintext;
    }
    function gcmDecrypt(enc, cek, ciphertext, iv, tag, aad) {
      const keySize = parseInt(enc.slice(1, 4), 10);
      const algorithm = `aes-${keySize}-gcm`;
      if (!(0, ciphers_js_1.default)(algorithm)) {
        throw new errors_js_1.JOSENotSupported(`alg ${enc} is not supported by your javascript runtime`);
      }
      try {
        const decipher = (0, node_crypto_1.createDecipheriv)(algorithm, cek, iv, { authTagLength: 16 });
        decipher.setAuthTag(tag);
        if (aad.byteLength) {
          decipher.setAAD(aad, { plaintextLength: ciphertext.length });
        }
        const plaintext = decipher.update(ciphertext);
        decipher.final();
        return plaintext;
      } catch {
        throw new errors_js_1.JWEDecryptionFailed();
      }
    }
    var decrypt = (enc, cek, ciphertext, iv, tag, aad) => {
      let key;
      if ((0, webcrypto_js_1.isCryptoKey)(cek)) {
        (0, crypto_key_js_1.checkEncCryptoKey)(cek, enc, "decrypt");
        key = node_crypto_1.KeyObject.from(cek);
      } else if (cek instanceof Uint8Array || (0, is_key_object_js_1.default)(cek)) {
        key = cek;
      } else {
        throw new TypeError((0, invalid_key_input_js_1.default)(cek, ...is_key_like_js_1.types, "Uint8Array"));
      }
      if (!iv) {
        throw new errors_js_1.JWEInvalid("JWE Initialization Vector missing");
      }
      if (!tag) {
        throw new errors_js_1.JWEInvalid("JWE Authentication Tag missing");
      }
      (0, check_cek_length_js_1.default)(enc, key);
      (0, check_iv_length_js_1.default)(enc, iv);
      switch (enc) {
        case "A128CBC-HS256":
        case "A192CBC-HS384":
        case "A256CBC-HS512":
          return cbcDecrypt(enc, key, ciphertext, iv, tag, aad);
        case "A128GCM":
        case "A192GCM":
        case "A256GCM":
          return gcmDecrypt(enc, key, ciphertext, iv, tag, aad);
        default:
          throw new errors_js_1.JOSENotSupported("Unsupported JWE Content Encryption Algorithm");
      }
    };
    exports.default = decrypt;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/is_disjoint.js
var require_is_disjoint = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/is_disjoint.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var isDisjoint = (...headers) => {
      const sources = headers.filter(Boolean);
      if (sources.length === 0 || sources.length === 1) {
        return true;
      }
      let acc;
      for (const header of sources) {
        const parameters = Object.keys(header);
        if (!acc || acc.size === 0) {
          acc = new Set(parameters);
          continue;
        }
        for (const parameter of parameters) {
          if (acc.has(parameter)) {
            return false;
          }
          acc.add(parameter);
        }
      }
      return true;
    };
    exports.default = isDisjoint;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/is_object.js
var require_is_object = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/is_object.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = isObject;
    function isObjectLike(value) {
      return typeof value === "object" && value !== null;
    }
    function isObject(input) {
      if (!isObjectLike(input) || Object.prototype.toString.call(input) !== "[object Object]") {
        return false;
      }
      if (Object.getPrototypeOf(input) === null) {
        return true;
      }
      let proto = input;
      while (Object.getPrototypeOf(proto) !== null) {
        proto = Object.getPrototypeOf(proto);
      }
      return Object.getPrototypeOf(input) === proto;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/aeskw.js
var require_aeskw = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/aeskw.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.unwrap = exports.wrap = void 0;
    var node_buffer_1 = __require("node:buffer");
    var node_crypto_1 = __require("node:crypto");
    var errors_js_1 = require_errors2();
    var buffer_utils_js_1 = require_buffer_utils();
    var webcrypto_js_1 = require_webcrypto();
    var crypto_key_js_1 = require_crypto_key();
    var is_key_object_js_1 = require_is_key_object();
    var invalid_key_input_js_1 = require_invalid_key_input();
    var ciphers_js_1 = require_ciphers();
    var is_key_like_js_1 = require_is_key_like();
    function checkKeySize(key, alg) {
      if (key.symmetricKeySize << 3 !== parseInt(alg.slice(1, 4), 10)) {
        throw new TypeError(`Invalid key size for alg: ${alg}`);
      }
    }
    function ensureKeyObject(key, alg, usage) {
      if ((0, is_key_object_js_1.default)(key)) {
        return key;
      }
      if (key instanceof Uint8Array) {
        return (0, node_crypto_1.createSecretKey)(key);
      }
      if ((0, webcrypto_js_1.isCryptoKey)(key)) {
        (0, crypto_key_js_1.checkEncCryptoKey)(key, alg, usage);
        return node_crypto_1.KeyObject.from(key);
      }
      throw new TypeError((0, invalid_key_input_js_1.default)(key, ...is_key_like_js_1.types, "Uint8Array"));
    }
    var wrap3 = (alg, key, cek) => {
      const size5 = parseInt(alg.slice(1, 4), 10);
      const algorithm = `aes${size5}-wrap`;
      if (!(0, ciphers_js_1.default)(algorithm)) {
        throw new errors_js_1.JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
      }
      const keyObject = ensureKeyObject(key, alg, "wrapKey");
      checkKeySize(keyObject, alg);
      const cipher = (0, node_crypto_1.createCipheriv)(algorithm, keyObject, node_buffer_1.Buffer.alloc(8, 166));
      return (0, buffer_utils_js_1.concat)(cipher.update(cek), cipher.final());
    };
    exports.wrap = wrap3;
    var unwrap3 = (alg, key, encryptedKey) => {
      const size5 = parseInt(alg.slice(1, 4), 10);
      const algorithm = `aes${size5}-wrap`;
      if (!(0, ciphers_js_1.default)(algorithm)) {
        throw new errors_js_1.JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
      }
      const keyObject = ensureKeyObject(key, alg, "unwrapKey");
      checkKeySize(keyObject, alg);
      const cipher = (0, node_crypto_1.createDecipheriv)(algorithm, keyObject, node_buffer_1.Buffer.alloc(8, 166));
      return (0, buffer_utils_js_1.concat)(cipher.update(encryptedKey), cipher.final());
    };
    exports.unwrap = unwrap3;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/is_jwk.js
var require_is_jwk = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/is_jwk.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isJWK = isJWK;
    exports.isPrivateJWK = isPrivateJWK;
    exports.isPublicJWK = isPublicJWK;
    exports.isSecretJWK = isSecretJWK;
    var is_object_js_1 = require_is_object();
    function isJWK(key) {
      return (0, is_object_js_1.default)(key) && typeof key.kty === "string";
    }
    function isPrivateJWK(key) {
      return key.kty !== "oct" && typeof key.d === "string";
    }
    function isPublicJWK(key) {
      return key.kty !== "oct" && typeof key.d === "undefined";
    }
    function isSecretJWK(key) {
      return isJWK(key) && key.kty === "oct" && typeof key.k === "string";
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/get_named_curve.js
var require_get_named_curve = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/get_named_curve.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.weakMap = void 0;
    var node_crypto_1 = __require("node:crypto");
    var errors_js_1 = require_errors2();
    var webcrypto_js_1 = require_webcrypto();
    var is_key_object_js_1 = require_is_key_object();
    var invalid_key_input_js_1 = require_invalid_key_input();
    var is_key_like_js_1 = require_is_key_like();
    var is_jwk_js_1 = require_is_jwk();
    exports.weakMap = /* @__PURE__ */ new WeakMap();
    var namedCurveToJOSE = (namedCurve) => {
      switch (namedCurve) {
        case "prime256v1":
          return "P-256";
        case "secp384r1":
          return "P-384";
        case "secp521r1":
          return "P-521";
        case "secp256k1":
          return "secp256k1";
        default:
          throw new errors_js_1.JOSENotSupported("Unsupported key curve for this operation");
      }
    };
    var getNamedCurve = (kee, raw) => {
      let key;
      if ((0, webcrypto_js_1.isCryptoKey)(kee)) {
        key = node_crypto_1.KeyObject.from(kee);
      } else if ((0, is_key_object_js_1.default)(kee)) {
        key = kee;
      } else if ((0, is_jwk_js_1.isJWK)(kee)) {
        return kee.crv;
      } else {
        throw new TypeError((0, invalid_key_input_js_1.default)(kee, ...is_key_like_js_1.types));
      }
      if (key.type === "secret") {
        throw new TypeError('only "private" or "public" type keys can be used for this operation');
      }
      switch (key.asymmetricKeyType) {
        case "ed25519":
        case "ed448":
          return `Ed${key.asymmetricKeyType.slice(2)}`;
        case "x25519":
        case "x448":
          return `X${key.asymmetricKeyType.slice(1)}`;
        case "ec": {
          const namedCurve = key.asymmetricKeyDetails.namedCurve;
          if (raw) {
            return namedCurve;
          }
          return namedCurveToJOSE(namedCurve);
        }
        default:
          throw new TypeError("Invalid asymmetric key type for this operation");
      }
    };
    exports.default = getNamedCurve;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/ecdhes.js
var require_ecdhes = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/ecdhes.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ecdhAllowed = void 0;
    exports.deriveKey = deriveKey;
    exports.generateEpk = generateEpk;
    var node_crypto_1 = __require("node:crypto");
    var node_util_1 = __require("node:util");
    var get_named_curve_js_1 = require_get_named_curve();
    var buffer_utils_js_1 = require_buffer_utils();
    var errors_js_1 = require_errors2();
    var webcrypto_js_1 = require_webcrypto();
    var crypto_key_js_1 = require_crypto_key();
    var is_key_object_js_1 = require_is_key_object();
    var invalid_key_input_js_1 = require_invalid_key_input();
    var is_key_like_js_1 = require_is_key_like();
    var generateKeyPair = (0, node_util_1.promisify)(node_crypto_1.generateKeyPair);
    async function deriveKey(publicKee, privateKee, algorithm, keyLength, apu = new Uint8Array(0), apv = new Uint8Array(0)) {
      let publicKey;
      if ((0, webcrypto_js_1.isCryptoKey)(publicKee)) {
        (0, crypto_key_js_1.checkEncCryptoKey)(publicKee, "ECDH");
        publicKey = node_crypto_1.KeyObject.from(publicKee);
      } else if ((0, is_key_object_js_1.default)(publicKee)) {
        publicKey = publicKee;
      } else {
        throw new TypeError((0, invalid_key_input_js_1.default)(publicKee, ...is_key_like_js_1.types));
      }
      let privateKey;
      if ((0, webcrypto_js_1.isCryptoKey)(privateKee)) {
        (0, crypto_key_js_1.checkEncCryptoKey)(privateKee, "ECDH", "deriveBits");
        privateKey = node_crypto_1.KeyObject.from(privateKee);
      } else if ((0, is_key_object_js_1.default)(privateKee)) {
        privateKey = privateKee;
      } else {
        throw new TypeError((0, invalid_key_input_js_1.default)(privateKee, ...is_key_like_js_1.types));
      }
      const value = (0, buffer_utils_js_1.concat)((0, buffer_utils_js_1.lengthAndInput)(buffer_utils_js_1.encoder.encode(algorithm)), (0, buffer_utils_js_1.lengthAndInput)(apu), (0, buffer_utils_js_1.lengthAndInput)(apv), (0, buffer_utils_js_1.uint32be)(keyLength));
      const sharedSecret = (0, node_crypto_1.diffieHellman)({ privateKey, publicKey });
      return (0, buffer_utils_js_1.concatKdf)(sharedSecret, keyLength, value);
    }
    async function generateEpk(kee) {
      let key;
      if ((0, webcrypto_js_1.isCryptoKey)(kee)) {
        key = node_crypto_1.KeyObject.from(kee);
      } else if ((0, is_key_object_js_1.default)(kee)) {
        key = kee;
      } else {
        throw new TypeError((0, invalid_key_input_js_1.default)(kee, ...is_key_like_js_1.types));
      }
      switch (key.asymmetricKeyType) {
        case "x25519":
          return generateKeyPair("x25519");
        case "x448": {
          return generateKeyPair("x448");
        }
        case "ec": {
          const namedCurve = (0, get_named_curve_js_1.default)(key);
          return generateKeyPair("ec", { namedCurve });
        }
        default:
          throw new errors_js_1.JOSENotSupported("Invalid or unsupported EPK");
      }
    }
    var ecdhAllowed = (key) => ["P-256", "P-384", "P-521", "X25519", "X448"].includes((0, get_named_curve_js_1.default)(key));
    exports.ecdhAllowed = ecdhAllowed;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/check_p2s.js
var require_check_p2s = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/check_p2s.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = checkP2s;
    var errors_js_1 = require_errors2();
    function checkP2s(p2s) {
      if (!(p2s instanceof Uint8Array) || p2s.length < 8) {
        throw new errors_js_1.JWEInvalid("PBES2 Salt Input must be 8 or more octets");
      }
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/pbes2kw.js
var require_pbes2kw = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/pbes2kw.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decrypt = exports.encrypt = void 0;
    var node_util_1 = __require("node:util");
    var node_crypto_1 = __require("node:crypto");
    var random_js_1 = require_random();
    var buffer_utils_js_1 = require_buffer_utils();
    var base64url_js_1 = require_base64url();
    var aeskw_js_1 = require_aeskw();
    var check_p2s_js_1 = require_check_p2s();
    var webcrypto_js_1 = require_webcrypto();
    var crypto_key_js_1 = require_crypto_key();
    var is_key_object_js_1 = require_is_key_object();
    var invalid_key_input_js_1 = require_invalid_key_input();
    var is_key_like_js_1 = require_is_key_like();
    var pbkdf2 = (0, node_util_1.promisify)(node_crypto_1.pbkdf2);
    function getPassword(key, alg) {
      if ((0, is_key_object_js_1.default)(key)) {
        return key.export();
      }
      if (key instanceof Uint8Array) {
        return key;
      }
      if ((0, webcrypto_js_1.isCryptoKey)(key)) {
        (0, crypto_key_js_1.checkEncCryptoKey)(key, alg, "deriveBits", "deriveKey");
        return node_crypto_1.KeyObject.from(key).export();
      }
      throw new TypeError((0, invalid_key_input_js_1.default)(key, ...is_key_like_js_1.types, "Uint8Array"));
    }
    var encrypt = async (alg, key, cek, p2c = 2048, p2s = (0, random_js_1.default)(new Uint8Array(16))) => {
      (0, check_p2s_js_1.default)(p2s);
      const salt = (0, buffer_utils_js_1.p2s)(alg, p2s);
      const keylen = parseInt(alg.slice(13, 16), 10) >> 3;
      const password = getPassword(key, alg);
      const derivedKey = await pbkdf2(password, salt, p2c, keylen, `sha${alg.slice(8, 11)}`);
      const encryptedKey = await (0, aeskw_js_1.wrap)(alg.slice(-6), derivedKey, cek);
      return { encryptedKey, p2c, p2s: (0, base64url_js_1.encode)(p2s) };
    };
    exports.encrypt = encrypt;
    var decrypt = async (alg, key, encryptedKey, p2c, p2s) => {
      (0, check_p2s_js_1.default)(p2s);
      const salt = (0, buffer_utils_js_1.p2s)(alg, p2s);
      const keylen = parseInt(alg.slice(13, 16), 10) >> 3;
      const password = getPassword(key, alg);
      const derivedKey = await pbkdf2(password, salt, p2c, keylen, `sha${alg.slice(8, 11)}`);
      return (0, aeskw_js_1.unwrap)(alg.slice(-6), derivedKey, encryptedKey);
    };
    exports.decrypt = decrypt;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/check_key_length.js
var require_check_key_length = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/check_key_length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var node_crypto_1 = __require("node:crypto");
    exports.default = (key, alg) => {
      let modulusLength;
      try {
        if (key instanceof node_crypto_1.KeyObject) {
          modulusLength = key.asymmetricKeyDetails?.modulusLength;
        } else {
          modulusLength = Buffer.from(key.n, "base64url").byteLength << 3;
        }
      } catch {
      }
      if (typeof modulusLength !== "number" || modulusLength < 2048) {
        throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
      }
    };
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/rsaes.js
var require_rsaes = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/rsaes.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decrypt = exports.encrypt = void 0;
    var node_crypto_1 = __require("node:crypto");
    var node_util_1 = __require("node:util");
    var check_key_length_js_1 = require_check_key_length();
    var webcrypto_js_1 = require_webcrypto();
    var crypto_key_js_1 = require_crypto_key();
    var is_key_object_js_1 = require_is_key_object();
    var invalid_key_input_js_1 = require_invalid_key_input();
    var is_key_like_js_1 = require_is_key_like();
    var checkKey = (key, alg) => {
      if (key.asymmetricKeyType !== "rsa") {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be rsa");
      }
      (0, check_key_length_js_1.default)(key, alg);
    };
    var RSA1_5 = (0, node_util_1.deprecate)(() => node_crypto_1.constants.RSA_PKCS1_PADDING, 'The RSA1_5 "alg" (JWE Algorithm) is deprecated and will be removed in the next major revision.');
    var resolvePadding = (alg) => {
      switch (alg) {
        case "RSA-OAEP":
        case "RSA-OAEP-256":
        case "RSA-OAEP-384":
        case "RSA-OAEP-512":
          return node_crypto_1.constants.RSA_PKCS1_OAEP_PADDING;
        case "RSA1_5":
          return RSA1_5();
        default:
          return void 0;
      }
    };
    var resolveOaepHash = (alg) => {
      switch (alg) {
        case "RSA-OAEP":
          return "sha1";
        case "RSA-OAEP-256":
          return "sha256";
        case "RSA-OAEP-384":
          return "sha384";
        case "RSA-OAEP-512":
          return "sha512";
        default:
          return void 0;
      }
    };
    function ensureKeyObject(key, alg, ...usages) {
      if ((0, is_key_object_js_1.default)(key)) {
        return key;
      }
      if ((0, webcrypto_js_1.isCryptoKey)(key)) {
        (0, crypto_key_js_1.checkEncCryptoKey)(key, alg, ...usages);
        return node_crypto_1.KeyObject.from(key);
      }
      throw new TypeError((0, invalid_key_input_js_1.default)(key, ...is_key_like_js_1.types));
    }
    var encrypt = (alg, key, cek) => {
      const padding = resolvePadding(alg);
      const oaepHash = resolveOaepHash(alg);
      const keyObject = ensureKeyObject(key, alg, "wrapKey", "encrypt");
      checkKey(keyObject, alg);
      return (0, node_crypto_1.publicEncrypt)({ key: keyObject, oaepHash, padding }, cek);
    };
    exports.encrypt = encrypt;
    var decrypt = (alg, key, encryptedKey) => {
      const padding = resolvePadding(alg);
      const oaepHash = resolveOaepHash(alg);
      const keyObject = ensureKeyObject(key, alg, "unwrapKey", "decrypt");
      checkKey(keyObject, alg);
      return (0, node_crypto_1.privateDecrypt)({ key: keyObject, oaepHash, padding }, encryptedKey);
    };
    exports.decrypt = decrypt;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/normalize_key.js
var require_normalize_key = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/normalize_key.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = {};
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/cek.js
var require_cek = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/cek.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.bitLength = bitLength;
    var errors_js_1 = require_errors2();
    var random_js_1 = require_random();
    function bitLength(alg) {
      switch (alg) {
        case "A128GCM":
          return 128;
        case "A192GCM":
          return 192;
        case "A256GCM":
        case "A128CBC-HS256":
          return 256;
        case "A192CBC-HS384":
          return 384;
        case "A256CBC-HS512":
          return 512;
        default:
          throw new errors_js_1.JOSENotSupported(`Unsupported JWE Algorithm: ${alg}`);
      }
    }
    exports.default = (alg) => (0, random_js_1.default)(new Uint8Array(bitLength(alg) >> 3));
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/asn1.js
var require_asn1 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/asn1.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fromX509 = exports.fromSPKI = exports.fromPKCS8 = exports.toPKCS8 = exports.toSPKI = void 0;
    var node_crypto_1 = __require("node:crypto");
    var node_buffer_1 = __require("node:buffer");
    var webcrypto_js_1 = require_webcrypto();
    var is_key_object_js_1 = require_is_key_object();
    var invalid_key_input_js_1 = require_invalid_key_input();
    var is_key_like_js_1 = require_is_key_like();
    var genericExport = (keyType, keyFormat, key) => {
      let keyObject;
      if ((0, webcrypto_js_1.isCryptoKey)(key)) {
        if (!key.extractable) {
          throw new TypeError("CryptoKey is not extractable");
        }
        keyObject = node_crypto_1.KeyObject.from(key);
      } else if ((0, is_key_object_js_1.default)(key)) {
        keyObject = key;
      } else {
        throw new TypeError((0, invalid_key_input_js_1.default)(key, ...is_key_like_js_1.types));
      }
      if (keyObject.type !== keyType) {
        throw new TypeError(`key is not a ${keyType} key`);
      }
      return keyObject.export({ format: "pem", type: keyFormat });
    };
    var toSPKI = (key) => {
      return genericExport("public", "spki", key);
    };
    exports.toSPKI = toSPKI;
    var toPKCS8 = (key) => {
      return genericExport("private", "pkcs8", key);
    };
    exports.toPKCS8 = toPKCS8;
    var fromPKCS8 = (pem) => (0, node_crypto_1.createPrivateKey)({
      key: node_buffer_1.Buffer.from(pem.replace(/(?:-----(?:BEGIN|END) PRIVATE KEY-----|\s)/g, ""), "base64"),
      type: "pkcs8",
      format: "der"
    });
    exports.fromPKCS8 = fromPKCS8;
    var fromSPKI = (pem) => (0, node_crypto_1.createPublicKey)({
      key: node_buffer_1.Buffer.from(pem.replace(/(?:-----(?:BEGIN|END) PUBLIC KEY-----|\s)/g, ""), "base64"),
      type: "spki",
      format: "der"
    });
    exports.fromSPKI = fromSPKI;
    var fromX509 = (pem) => (0, node_crypto_1.createPublicKey)({
      key: pem,
      type: "spki",
      format: "pem"
    });
    exports.fromX509 = fromX509;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/jwk_to_key.js
var require_jwk_to_key = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/jwk_to_key.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var node_crypto_1 = __require("node:crypto");
    var parse = (key) => {
      if (key.d) {
        return (0, node_crypto_1.createPrivateKey)({ format: "jwk", key });
      }
      return (0, node_crypto_1.createPublicKey)({ format: "jwk", key });
    };
    exports.default = parse;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/key/import.js
var require_import = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/key/import.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.importSPKI = importSPKI;
    exports.importX509 = importX509;
    exports.importPKCS8 = importPKCS8;
    exports.importJWK = importJWK;
    var base64url_js_1 = require_base64url();
    var asn1_js_1 = require_asn1();
    var jwk_to_key_js_1 = require_jwk_to_key();
    var errors_js_1 = require_errors2();
    var is_object_js_1 = require_is_object();
    async function importSPKI(spki, alg, options) {
      if (typeof spki !== "string" || spki.indexOf("-----BEGIN PUBLIC KEY-----") !== 0) {
        throw new TypeError('"spki" must be SPKI formatted string');
      }
      return (0, asn1_js_1.fromSPKI)(spki, alg, options);
    }
    async function importX509(x509, alg, options) {
      if (typeof x509 !== "string" || x509.indexOf("-----BEGIN CERTIFICATE-----") !== 0) {
        throw new TypeError('"x509" must be X.509 formatted string');
      }
      return (0, asn1_js_1.fromX509)(x509, alg, options);
    }
    async function importPKCS8(pkcs8, alg, options) {
      if (typeof pkcs8 !== "string" || pkcs8.indexOf("-----BEGIN PRIVATE KEY-----") !== 0) {
        throw new TypeError('"pkcs8" must be PKCS#8 formatted string');
      }
      return (0, asn1_js_1.fromPKCS8)(pkcs8, alg, options);
    }
    async function importJWK(jwk, alg) {
      if (!(0, is_object_js_1.default)(jwk)) {
        throw new TypeError("JWK must be an object");
      }
      alg ||= jwk.alg;
      switch (jwk.kty) {
        case "oct":
          if (typeof jwk.k !== "string" || !jwk.k) {
            throw new TypeError('missing "k" (Key Value) Parameter value');
          }
          return (0, base64url_js_1.decode)(jwk.k);
        case "RSA":
          if ("oth" in jwk && jwk.oth !== void 0) {
            throw new errors_js_1.JOSENotSupported('RSA JWK "oth" (Other Primes Info) Parameter value is not supported');
          }
        case "EC":
        case "OKP":
          return (0, jwk_to_key_js_1.default)({ ...jwk, alg });
        default:
          throw new errors_js_1.JOSENotSupported('Unsupported "kty" (Key Type) Parameter value');
      }
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/check_key_type.js
var require_check_key_type = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/check_key_type.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.checkKeyTypeWithJwk = void 0;
    var invalid_key_input_js_1 = require_invalid_key_input();
    var is_key_like_js_1 = require_is_key_like();
    var jwk = require_is_jwk();
    var tag = (key) => key?.[Symbol.toStringTag];
    var jwkMatchesOp = (alg, key, usage) => {
      if (key.use !== void 0 && key.use !== "sig") {
        throw new TypeError("Invalid key for this operation, when present its use must be sig");
      }
      if (key.key_ops !== void 0 && key.key_ops.includes?.(usage) !== true) {
        throw new TypeError(`Invalid key for this operation, when present its key_ops must include ${usage}`);
      }
      if (key.alg !== void 0 && key.alg !== alg) {
        throw new TypeError(`Invalid key for this operation, when present its alg must be ${alg}`);
      }
      return true;
    };
    var symmetricTypeCheck = (alg, key, usage, allowJwk) => {
      if (key instanceof Uint8Array)
        return;
      if (allowJwk && jwk.isJWK(key)) {
        if (jwk.isSecretJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present`);
      }
      if (!(0, is_key_like_js_1.default)(key)) {
        throw new TypeError((0, invalid_key_input_js_1.withAlg)(alg, key, ...is_key_like_js_1.types, "Uint8Array", allowJwk ? "JSON Web Key" : null));
      }
      if (key.type !== "secret") {
        throw new TypeError(`${tag(key)} instances for symmetric algorithms must be of type "secret"`);
      }
    };
    var asymmetricTypeCheck = (alg, key, usage, allowJwk) => {
      if (allowJwk && jwk.isJWK(key)) {
        switch (usage) {
          case "sign":
            if (jwk.isPrivateJWK(key) && jwkMatchesOp(alg, key, usage))
              return;
            throw new TypeError(`JSON Web Key for this operation be a private JWK`);
          case "verify":
            if (jwk.isPublicJWK(key) && jwkMatchesOp(alg, key, usage))
              return;
            throw new TypeError(`JSON Web Key for this operation be a public JWK`);
        }
      }
      if (!(0, is_key_like_js_1.default)(key)) {
        throw new TypeError((0, invalid_key_input_js_1.withAlg)(alg, key, ...is_key_like_js_1.types, allowJwk ? "JSON Web Key" : null));
      }
      if (key.type === "secret") {
        throw new TypeError(`${tag(key)} instances for asymmetric algorithms must not be of type "secret"`);
      }
      if (usage === "sign" && key.type === "public") {
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm signing must be of type "private"`);
      }
      if (usage === "decrypt" && key.type === "public") {
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm decryption must be of type "private"`);
      }
      if (key.algorithm && usage === "verify" && key.type === "private") {
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm verifying must be of type "public"`);
      }
      if (key.algorithm && usage === "encrypt" && key.type === "private") {
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm encryption must be of type "public"`);
      }
    };
    function checkKeyType(allowJwk, alg, key, usage) {
      const symmetric = alg.startsWith("HS") || alg === "dir" || alg.startsWith("PBES2") || /^A\d{3}(?:GCM)?KW$/.test(alg);
      if (symmetric) {
        symmetricTypeCheck(alg, key, usage, allowJwk);
      } else {
        asymmetricTypeCheck(alg, key, usage, allowJwk);
      }
    }
    exports.default = checkKeyType.bind(void 0, false);
    exports.checkKeyTypeWithJwk = checkKeyType.bind(void 0, true);
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/encrypt.js
var require_encrypt = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/encrypt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var node_crypto_1 = __require("node:crypto");
    var check_iv_length_js_1 = require_check_iv_length();
    var check_cek_length_js_1 = require_check_cek_length();
    var buffer_utils_js_1 = require_buffer_utils();
    var cbc_tag_js_1 = require_cbc_tag();
    var webcrypto_js_1 = require_webcrypto();
    var crypto_key_js_1 = require_crypto_key();
    var is_key_object_js_1 = require_is_key_object();
    var invalid_key_input_js_1 = require_invalid_key_input();
    var iv_js_1 = require_iv();
    var errors_js_1 = require_errors2();
    var ciphers_js_1 = require_ciphers();
    var is_key_like_js_1 = require_is_key_like();
    function cbcEncrypt(enc, plaintext, cek, iv, aad) {
      const keySize = parseInt(enc.slice(1, 4), 10);
      if ((0, is_key_object_js_1.default)(cek)) {
        cek = cek.export();
      }
      const encKey = cek.subarray(keySize >> 3);
      const macKey = cek.subarray(0, keySize >> 3);
      const algorithm = `aes-${keySize}-cbc`;
      if (!(0, ciphers_js_1.default)(algorithm)) {
        throw new errors_js_1.JOSENotSupported(`alg ${enc} is not supported by your javascript runtime`);
      }
      const cipher = (0, node_crypto_1.createCipheriv)(algorithm, encKey, iv);
      const ciphertext = (0, buffer_utils_js_1.concat)(cipher.update(plaintext), cipher.final());
      const macSize = parseInt(enc.slice(-3), 10);
      const tag = (0, cbc_tag_js_1.default)(aad, iv, ciphertext, macSize, macKey, keySize);
      return { ciphertext, tag, iv };
    }
    function gcmEncrypt(enc, plaintext, cek, iv, aad) {
      const keySize = parseInt(enc.slice(1, 4), 10);
      const algorithm = `aes-${keySize}-gcm`;
      if (!(0, ciphers_js_1.default)(algorithm)) {
        throw new errors_js_1.JOSENotSupported(`alg ${enc} is not supported by your javascript runtime`);
      }
      const cipher = (0, node_crypto_1.createCipheriv)(algorithm, cek, iv, { authTagLength: 16 });
      if (aad.byteLength) {
        cipher.setAAD(aad, { plaintextLength: plaintext.length });
      }
      const ciphertext = cipher.update(plaintext);
      cipher.final();
      const tag = cipher.getAuthTag();
      return { ciphertext, tag, iv };
    }
    var encrypt = (enc, plaintext, cek, iv, aad) => {
      let key;
      if ((0, webcrypto_js_1.isCryptoKey)(cek)) {
        (0, crypto_key_js_1.checkEncCryptoKey)(cek, enc, "encrypt");
        key = node_crypto_1.KeyObject.from(cek);
      } else if (cek instanceof Uint8Array || (0, is_key_object_js_1.default)(cek)) {
        key = cek;
      } else {
        throw new TypeError((0, invalid_key_input_js_1.default)(cek, ...is_key_like_js_1.types, "Uint8Array"));
      }
      (0, check_cek_length_js_1.default)(enc, key);
      if (iv) {
        (0, check_iv_length_js_1.default)(enc, iv);
      } else {
        iv = (0, iv_js_1.default)(enc);
      }
      switch (enc) {
        case "A128CBC-HS256":
        case "A192CBC-HS384":
        case "A256CBC-HS512":
          return cbcEncrypt(enc, plaintext, key, iv, aad);
        case "A128GCM":
        case "A192GCM":
        case "A256GCM":
          return gcmEncrypt(enc, plaintext, key, iv, aad);
        default:
          throw new errors_js_1.JOSENotSupported("Unsupported JWE Content Encryption Algorithm");
      }
    };
    exports.default = encrypt;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/aesgcmkw.js
var require_aesgcmkw = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/aesgcmkw.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.wrap = wrap3;
    exports.unwrap = unwrap3;
    var encrypt_js_1 = require_encrypt();
    var decrypt_js_1 = require_decrypt();
    var base64url_js_1 = require_base64url();
    async function wrap3(alg, key, cek, iv) {
      const jweAlgorithm = alg.slice(0, 7);
      const wrapped = await (0, encrypt_js_1.default)(jweAlgorithm, cek, key, iv, new Uint8Array(0));
      return {
        encryptedKey: wrapped.ciphertext,
        iv: (0, base64url_js_1.encode)(wrapped.iv),
        tag: (0, base64url_js_1.encode)(wrapped.tag)
      };
    }
    async function unwrap3(alg, key, encryptedKey, iv, tag) {
      const jweAlgorithm = alg.slice(0, 7);
      return (0, decrypt_js_1.default)(jweAlgorithm, key, encryptedKey, iv, tag, new Uint8Array(0));
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/decrypt_key_management.js
var require_decrypt_key_management = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/decrypt_key_management.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var aeskw_js_1 = require_aeskw();
    var ECDH = require_ecdhes();
    var pbes2kw_js_1 = require_pbes2kw();
    var rsaes_js_1 = require_rsaes();
    var base64url_js_1 = require_base64url();
    var normalize_key_js_1 = require_normalize_key();
    var errors_js_1 = require_errors2();
    var cek_js_1 = require_cek();
    var import_js_1 = require_import();
    var check_key_type_js_1 = require_check_key_type();
    var is_object_js_1 = require_is_object();
    var aesgcmkw_js_1 = require_aesgcmkw();
    async function decryptKeyManagement(alg, key, encryptedKey, joseHeader, options) {
      (0, check_key_type_js_1.default)(alg, key, "decrypt");
      key = await normalize_key_js_1.default.normalizePrivateKey?.(key, alg) || key;
      switch (alg) {
        case "dir": {
          if (encryptedKey !== void 0)
            throw new errors_js_1.JWEInvalid("Encountered unexpected JWE Encrypted Key");
          return key;
        }
        case "ECDH-ES":
          if (encryptedKey !== void 0)
            throw new errors_js_1.JWEInvalid("Encountered unexpected JWE Encrypted Key");
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW": {
          if (!(0, is_object_js_1.default)(joseHeader.epk))
            throw new errors_js_1.JWEInvalid(`JOSE Header "epk" (Ephemeral Public Key) missing or invalid`);
          if (!ECDH.ecdhAllowed(key))
            throw new errors_js_1.JOSENotSupported("ECDH with the provided key is not allowed or not supported by your javascript runtime");
          const epk = await (0, import_js_1.importJWK)(joseHeader.epk, alg);
          let partyUInfo;
          let partyVInfo;
          if (joseHeader.apu !== void 0) {
            if (typeof joseHeader.apu !== "string")
              throw new errors_js_1.JWEInvalid(`JOSE Header "apu" (Agreement PartyUInfo) invalid`);
            try {
              partyUInfo = (0, base64url_js_1.decode)(joseHeader.apu);
            } catch {
              throw new errors_js_1.JWEInvalid("Failed to base64url decode the apu");
            }
          }
          if (joseHeader.apv !== void 0) {
            if (typeof joseHeader.apv !== "string")
              throw new errors_js_1.JWEInvalid(`JOSE Header "apv" (Agreement PartyVInfo) invalid`);
            try {
              partyVInfo = (0, base64url_js_1.decode)(joseHeader.apv);
            } catch {
              throw new errors_js_1.JWEInvalid("Failed to base64url decode the apv");
            }
          }
          const sharedSecret = await ECDH.deriveKey(epk, key, alg === "ECDH-ES" ? joseHeader.enc : alg, alg === "ECDH-ES" ? (0, cek_js_1.bitLength)(joseHeader.enc) : parseInt(alg.slice(-5, -2), 10), partyUInfo, partyVInfo);
          if (alg === "ECDH-ES")
            return sharedSecret;
          if (encryptedKey === void 0)
            throw new errors_js_1.JWEInvalid("JWE Encrypted Key missing");
          return (0, aeskw_js_1.unwrap)(alg.slice(-6), sharedSecret, encryptedKey);
        }
        case "RSA1_5":
        case "RSA-OAEP":
        case "RSA-OAEP-256":
        case "RSA-OAEP-384":
        case "RSA-OAEP-512": {
          if (encryptedKey === void 0)
            throw new errors_js_1.JWEInvalid("JWE Encrypted Key missing");
          return (0, rsaes_js_1.decrypt)(alg, key, encryptedKey);
        }
        case "PBES2-HS256+A128KW":
        case "PBES2-HS384+A192KW":
        case "PBES2-HS512+A256KW": {
          if (encryptedKey === void 0)
            throw new errors_js_1.JWEInvalid("JWE Encrypted Key missing");
          if (typeof joseHeader.p2c !== "number")
            throw new errors_js_1.JWEInvalid(`JOSE Header "p2c" (PBES2 Count) missing or invalid`);
          const p2cLimit = options?.maxPBES2Count || 1e4;
          if (joseHeader.p2c > p2cLimit)
            throw new errors_js_1.JWEInvalid(`JOSE Header "p2c" (PBES2 Count) out is of acceptable bounds`);
          if (typeof joseHeader.p2s !== "string")
            throw new errors_js_1.JWEInvalid(`JOSE Header "p2s" (PBES2 Salt) missing or invalid`);
          let p2s;
          try {
            p2s = (0, base64url_js_1.decode)(joseHeader.p2s);
          } catch {
            throw new errors_js_1.JWEInvalid("Failed to base64url decode the p2s");
          }
          return (0, pbes2kw_js_1.decrypt)(alg, key, encryptedKey, joseHeader.p2c, p2s);
        }
        case "A128KW":
        case "A192KW":
        case "A256KW": {
          if (encryptedKey === void 0)
            throw new errors_js_1.JWEInvalid("JWE Encrypted Key missing");
          return (0, aeskw_js_1.unwrap)(alg, key, encryptedKey);
        }
        case "A128GCMKW":
        case "A192GCMKW":
        case "A256GCMKW": {
          if (encryptedKey === void 0)
            throw new errors_js_1.JWEInvalid("JWE Encrypted Key missing");
          if (typeof joseHeader.iv !== "string")
            throw new errors_js_1.JWEInvalid(`JOSE Header "iv" (Initialization Vector) missing or invalid`);
          if (typeof joseHeader.tag !== "string")
            throw new errors_js_1.JWEInvalid(`JOSE Header "tag" (Authentication Tag) missing or invalid`);
          let iv;
          try {
            iv = (0, base64url_js_1.decode)(joseHeader.iv);
          } catch {
            throw new errors_js_1.JWEInvalid("Failed to base64url decode the iv");
          }
          let tag;
          try {
            tag = (0, base64url_js_1.decode)(joseHeader.tag);
          } catch {
            throw new errors_js_1.JWEInvalid("Failed to base64url decode the tag");
          }
          return (0, aesgcmkw_js_1.unwrap)(alg, key, encryptedKey, iv, tag);
        }
        default: {
          throw new errors_js_1.JOSENotSupported('Invalid or unsupported "alg" (JWE Algorithm) header value');
        }
      }
    }
    exports.default = decryptKeyManagement;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/validate_crit.js
var require_validate_crit = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/validate_crit.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var errors_js_1 = require_errors2();
    function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
      if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0) {
        throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
      }
      if (!protectedHeader || protectedHeader.crit === void 0) {
        return /* @__PURE__ */ new Set();
      }
      if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input !== "string" || input.length === 0)) {
        throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
      }
      let recognized;
      if (recognizedOption !== void 0) {
        recognized = new Map([...Object.entries(recognizedOption), ...recognizedDefault.entries()]);
      } else {
        recognized = recognizedDefault;
      }
      for (const parameter of protectedHeader.crit) {
        if (!recognized.has(parameter)) {
          throw new errors_js_1.JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
        }
        if (joseHeader[parameter] === void 0) {
          throw new Err(`Extension Header Parameter "${parameter}" is missing`);
        }
        if (recognized.get(parameter) && protectedHeader[parameter] === void 0) {
          throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
        }
      }
      return new Set(protectedHeader.crit);
    }
    exports.default = validateCrit;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/validate_algorithms.js
var require_validate_algorithms = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/validate_algorithms.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var validateAlgorithms = (option, algorithms) => {
      if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s7) => typeof s7 !== "string"))) {
        throw new TypeError(`"${option}" option must be an array of strings`);
      }
      if (!algorithms) {
        return void 0;
      }
      return new Set(algorithms);
    };
    exports.default = validateAlgorithms;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/flattened/decrypt.js
var require_decrypt2 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/flattened/decrypt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.flattenedDecrypt = flattenedDecrypt;
    var base64url_js_1 = require_base64url();
    var decrypt_js_1 = require_decrypt();
    var errors_js_1 = require_errors2();
    var is_disjoint_js_1 = require_is_disjoint();
    var is_object_js_1 = require_is_object();
    var decrypt_key_management_js_1 = require_decrypt_key_management();
    var buffer_utils_js_1 = require_buffer_utils();
    var cek_js_1 = require_cek();
    var validate_crit_js_1 = require_validate_crit();
    var validate_algorithms_js_1 = require_validate_algorithms();
    async function flattenedDecrypt(jwe, key, options) {
      if (!(0, is_object_js_1.default)(jwe)) {
        throw new errors_js_1.JWEInvalid("Flattened JWE must be an object");
      }
      if (jwe.protected === void 0 && jwe.header === void 0 && jwe.unprotected === void 0) {
        throw new errors_js_1.JWEInvalid("JOSE Header missing");
      }
      if (jwe.iv !== void 0 && typeof jwe.iv !== "string") {
        throw new errors_js_1.JWEInvalid("JWE Initialization Vector incorrect type");
      }
      if (typeof jwe.ciphertext !== "string") {
        throw new errors_js_1.JWEInvalid("JWE Ciphertext missing or incorrect type");
      }
      if (jwe.tag !== void 0 && typeof jwe.tag !== "string") {
        throw new errors_js_1.JWEInvalid("JWE Authentication Tag incorrect type");
      }
      if (jwe.protected !== void 0 && typeof jwe.protected !== "string") {
        throw new errors_js_1.JWEInvalid("JWE Protected Header incorrect type");
      }
      if (jwe.encrypted_key !== void 0 && typeof jwe.encrypted_key !== "string") {
        throw new errors_js_1.JWEInvalid("JWE Encrypted Key incorrect type");
      }
      if (jwe.aad !== void 0 && typeof jwe.aad !== "string") {
        throw new errors_js_1.JWEInvalid("JWE AAD incorrect type");
      }
      if (jwe.header !== void 0 && !(0, is_object_js_1.default)(jwe.header)) {
        throw new errors_js_1.JWEInvalid("JWE Shared Unprotected Header incorrect type");
      }
      if (jwe.unprotected !== void 0 && !(0, is_object_js_1.default)(jwe.unprotected)) {
        throw new errors_js_1.JWEInvalid("JWE Per-Recipient Unprotected Header incorrect type");
      }
      let parsedProt;
      if (jwe.protected) {
        try {
          const protectedHeader2 = (0, base64url_js_1.decode)(jwe.protected);
          parsedProt = JSON.parse(buffer_utils_js_1.decoder.decode(protectedHeader2));
        } catch {
          throw new errors_js_1.JWEInvalid("JWE Protected Header is invalid");
        }
      }
      if (!(0, is_disjoint_js_1.default)(parsedProt, jwe.header, jwe.unprotected)) {
        throw new errors_js_1.JWEInvalid("JWE Protected, JWE Unprotected Header, and JWE Per-Recipient Unprotected Header Parameter names must be disjoint");
      }
      const joseHeader = {
        ...parsedProt,
        ...jwe.header,
        ...jwe.unprotected
      };
      (0, validate_crit_js_1.default)(errors_js_1.JWEInvalid, /* @__PURE__ */ new Map(), options?.crit, parsedProt, joseHeader);
      if (joseHeader.zip !== void 0) {
        throw new errors_js_1.JOSENotSupported('JWE "zip" (Compression Algorithm) Header Parameter is not supported.');
      }
      const { alg, enc } = joseHeader;
      if (typeof alg !== "string" || !alg) {
        throw new errors_js_1.JWEInvalid("missing JWE Algorithm (alg) in JWE Header");
      }
      if (typeof enc !== "string" || !enc) {
        throw new errors_js_1.JWEInvalid("missing JWE Encryption Algorithm (enc) in JWE Header");
      }
      const keyManagementAlgorithms = options && (0, validate_algorithms_js_1.default)("keyManagementAlgorithms", options.keyManagementAlgorithms);
      const contentEncryptionAlgorithms = options && (0, validate_algorithms_js_1.default)("contentEncryptionAlgorithms", options.contentEncryptionAlgorithms);
      if (keyManagementAlgorithms && !keyManagementAlgorithms.has(alg) || !keyManagementAlgorithms && alg.startsWith("PBES2")) {
        throw new errors_js_1.JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
      }
      if (contentEncryptionAlgorithms && !contentEncryptionAlgorithms.has(enc)) {
        throw new errors_js_1.JOSEAlgNotAllowed('"enc" (Encryption Algorithm) Header Parameter value not allowed');
      }
      let encryptedKey;
      if (jwe.encrypted_key !== void 0) {
        try {
          encryptedKey = (0, base64url_js_1.decode)(jwe.encrypted_key);
        } catch {
          throw new errors_js_1.JWEInvalid("Failed to base64url decode the encrypted_key");
        }
      }
      let resolvedKey = false;
      if (typeof key === "function") {
        key = await key(parsedProt, jwe);
        resolvedKey = true;
      }
      let cek;
      try {
        cek = await (0, decrypt_key_management_js_1.default)(alg, key, encryptedKey, joseHeader, options);
      } catch (err) {
        if (err instanceof TypeError || err instanceof errors_js_1.JWEInvalid || err instanceof errors_js_1.JOSENotSupported) {
          throw err;
        }
        cek = (0, cek_js_1.default)(enc);
      }
      let iv;
      let tag;
      if (jwe.iv !== void 0) {
        try {
          iv = (0, base64url_js_1.decode)(jwe.iv);
        } catch {
          throw new errors_js_1.JWEInvalid("Failed to base64url decode the iv");
        }
      }
      if (jwe.tag !== void 0) {
        try {
          tag = (0, base64url_js_1.decode)(jwe.tag);
        } catch {
          throw new errors_js_1.JWEInvalid("Failed to base64url decode the tag");
        }
      }
      const protectedHeader = buffer_utils_js_1.encoder.encode(jwe.protected ?? "");
      let additionalData;
      if (jwe.aad !== void 0) {
        additionalData = (0, buffer_utils_js_1.concat)(protectedHeader, buffer_utils_js_1.encoder.encode("."), buffer_utils_js_1.encoder.encode(jwe.aad));
      } else {
        additionalData = protectedHeader;
      }
      let ciphertext;
      try {
        ciphertext = (0, base64url_js_1.decode)(jwe.ciphertext);
      } catch {
        throw new errors_js_1.JWEInvalid("Failed to base64url decode the ciphertext");
      }
      const plaintext = await (0, decrypt_js_1.default)(enc, cek, ciphertext, iv, tag, additionalData);
      const result = { plaintext };
      if (jwe.protected !== void 0) {
        result.protectedHeader = parsedProt;
      }
      if (jwe.aad !== void 0) {
        try {
          result.additionalAuthenticatedData = (0, base64url_js_1.decode)(jwe.aad);
        } catch {
          throw new errors_js_1.JWEInvalid("Failed to base64url decode the aad");
        }
      }
      if (jwe.unprotected !== void 0) {
        result.sharedUnprotectedHeader = jwe.unprotected;
      }
      if (jwe.header !== void 0) {
        result.unprotectedHeader = jwe.header;
      }
      if (resolvedKey) {
        return { ...result, key };
      }
      return result;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/compact/decrypt.js
var require_decrypt3 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/compact/decrypt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.compactDecrypt = compactDecrypt;
    var decrypt_js_1 = require_decrypt2();
    var errors_js_1 = require_errors2();
    var buffer_utils_js_1 = require_buffer_utils();
    async function compactDecrypt(jwe, key, options) {
      if (jwe instanceof Uint8Array) {
        jwe = buffer_utils_js_1.decoder.decode(jwe);
      }
      if (typeof jwe !== "string") {
        throw new errors_js_1.JWEInvalid("Compact JWE must be a string or Uint8Array");
      }
      const { 0: protectedHeader, 1: encryptedKey, 2: iv, 3: ciphertext, 4: tag, length } = jwe.split(".");
      if (length !== 5) {
        throw new errors_js_1.JWEInvalid("Invalid Compact JWE");
      }
      const decrypted = await (0, decrypt_js_1.flattenedDecrypt)({
        ciphertext,
        iv: iv || void 0,
        protected: protectedHeader,
        tag: tag || void 0,
        encrypted_key: encryptedKey || void 0
      }, key, options);
      const result = { plaintext: decrypted.plaintext, protectedHeader: decrypted.protectedHeader };
      if (typeof key === "function") {
        return { ...result, key: decrypted.key };
      }
      return result;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/general/decrypt.js
var require_decrypt4 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/general/decrypt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.generalDecrypt = generalDecrypt;
    var decrypt_js_1 = require_decrypt2();
    var errors_js_1 = require_errors2();
    var is_object_js_1 = require_is_object();
    async function generalDecrypt(jwe, key, options) {
      if (!(0, is_object_js_1.default)(jwe)) {
        throw new errors_js_1.JWEInvalid("General JWE must be an object");
      }
      if (!Array.isArray(jwe.recipients) || !jwe.recipients.every(is_object_js_1.default)) {
        throw new errors_js_1.JWEInvalid("JWE Recipients missing or incorrect type");
      }
      if (!jwe.recipients.length) {
        throw new errors_js_1.JWEInvalid("JWE Recipients has no members");
      }
      for (const recipient of jwe.recipients) {
        try {
          return await (0, decrypt_js_1.flattenedDecrypt)({
            aad: jwe.aad,
            ciphertext: jwe.ciphertext,
            encrypted_key: recipient.encrypted_key,
            header: recipient.header,
            iv: jwe.iv,
            protected: jwe.protected,
            tag: jwe.tag,
            unprotected: jwe.unprotected
          }, key, options);
        } catch {
        }
      }
      throw new errors_js_1.JWEDecryptionFailed();
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/private_symbols.js
var require_private_symbols = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/private_symbols.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.unprotected = void 0;
    exports.unprotected = /* @__PURE__ */ Symbol();
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/key_to_jwk.js
var require_key_to_jwk = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/key_to_jwk.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var node_crypto_1 = __require("node:crypto");
    var base64url_js_1 = require_base64url();
    var errors_js_1 = require_errors2();
    var webcrypto_js_1 = require_webcrypto();
    var is_key_object_js_1 = require_is_key_object();
    var invalid_key_input_js_1 = require_invalid_key_input();
    var is_key_like_js_1 = require_is_key_like();
    var keyToJWK = (key) => {
      let keyObject;
      if ((0, webcrypto_js_1.isCryptoKey)(key)) {
        if (!key.extractable) {
          throw new TypeError("CryptoKey is not extractable");
        }
        keyObject = node_crypto_1.KeyObject.from(key);
      } else if ((0, is_key_object_js_1.default)(key)) {
        keyObject = key;
      } else if (key instanceof Uint8Array) {
        return {
          kty: "oct",
          k: (0, base64url_js_1.encode)(key)
        };
      } else {
        throw new TypeError((0, invalid_key_input_js_1.default)(key, ...is_key_like_js_1.types, "Uint8Array"));
      }
      if (keyObject.type !== "secret" && !["rsa", "ec", "ed25519", "x25519", "ed448", "x448"].includes(keyObject.asymmetricKeyType)) {
        throw new errors_js_1.JOSENotSupported("Unsupported key asymmetricKeyType");
      }
      return keyObject.export({ format: "jwk" });
    };
    exports.default = keyToJWK;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/key/export.js
var require_export = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/key/export.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.exportSPKI = exportSPKI;
    exports.exportPKCS8 = exportPKCS8;
    exports.exportJWK = exportJWK;
    var asn1_js_1 = require_asn1();
    var asn1_js_2 = require_asn1();
    var key_to_jwk_js_1 = require_key_to_jwk();
    async function exportSPKI(key) {
      return (0, asn1_js_1.toSPKI)(key);
    }
    async function exportPKCS8(key) {
      return (0, asn1_js_2.toPKCS8)(key);
    }
    async function exportJWK(key) {
      return (0, key_to_jwk_js_1.default)(key);
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/encrypt_key_management.js
var require_encrypt_key_management = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/encrypt_key_management.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var aeskw_js_1 = require_aeskw();
    var ECDH = require_ecdhes();
    var pbes2kw_js_1 = require_pbes2kw();
    var rsaes_js_1 = require_rsaes();
    var base64url_js_1 = require_base64url();
    var normalize_key_js_1 = require_normalize_key();
    var cek_js_1 = require_cek();
    var errors_js_1 = require_errors2();
    var export_js_1 = require_export();
    var check_key_type_js_1 = require_check_key_type();
    var aesgcmkw_js_1 = require_aesgcmkw();
    async function encryptKeyManagement(alg, enc, key, providedCek, providedParameters = {}) {
      let encryptedKey;
      let parameters;
      let cek;
      (0, check_key_type_js_1.default)(alg, key, "encrypt");
      key = await normalize_key_js_1.default.normalizePublicKey?.(key, alg) || key;
      switch (alg) {
        case "dir": {
          cek = key;
          break;
        }
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW": {
          if (!ECDH.ecdhAllowed(key)) {
            throw new errors_js_1.JOSENotSupported("ECDH with the provided key is not allowed or not supported by your javascript runtime");
          }
          const { apu, apv } = providedParameters;
          let { epk: ephemeralKey } = providedParameters;
          ephemeralKey ||= (await ECDH.generateEpk(key)).privateKey;
          const { x: x5, y: y5, crv, kty } = await (0, export_js_1.exportJWK)(ephemeralKey);
          const sharedSecret = await ECDH.deriveKey(key, ephemeralKey, alg === "ECDH-ES" ? enc : alg, alg === "ECDH-ES" ? (0, cek_js_1.bitLength)(enc) : parseInt(alg.slice(-5, -2), 10), apu, apv);
          parameters = { epk: { x: x5, crv, kty } };
          if (kty === "EC")
            parameters.epk.y = y5;
          if (apu)
            parameters.apu = (0, base64url_js_1.encode)(apu);
          if (apv)
            parameters.apv = (0, base64url_js_1.encode)(apv);
          if (alg === "ECDH-ES") {
            cek = sharedSecret;
            break;
          }
          cek = providedCek || (0, cek_js_1.default)(enc);
          const kwAlg = alg.slice(-6);
          encryptedKey = await (0, aeskw_js_1.wrap)(kwAlg, sharedSecret, cek);
          break;
        }
        case "RSA1_5":
        case "RSA-OAEP":
        case "RSA-OAEP-256":
        case "RSA-OAEP-384":
        case "RSA-OAEP-512": {
          cek = providedCek || (0, cek_js_1.default)(enc);
          encryptedKey = await (0, rsaes_js_1.encrypt)(alg, key, cek);
          break;
        }
        case "PBES2-HS256+A128KW":
        case "PBES2-HS384+A192KW":
        case "PBES2-HS512+A256KW": {
          cek = providedCek || (0, cek_js_1.default)(enc);
          const { p2c, p2s } = providedParameters;
          ({ encryptedKey, ...parameters } = await (0, pbes2kw_js_1.encrypt)(alg, key, cek, p2c, p2s));
          break;
        }
        case "A128KW":
        case "A192KW":
        case "A256KW": {
          cek = providedCek || (0, cek_js_1.default)(enc);
          encryptedKey = await (0, aeskw_js_1.wrap)(alg, key, cek);
          break;
        }
        case "A128GCMKW":
        case "A192GCMKW":
        case "A256GCMKW": {
          cek = providedCek || (0, cek_js_1.default)(enc);
          const { iv } = providedParameters;
          ({ encryptedKey, ...parameters } = await (0, aesgcmkw_js_1.wrap)(alg, key, cek, iv));
          break;
        }
        default: {
          throw new errors_js_1.JOSENotSupported('Invalid or unsupported "alg" (JWE Algorithm) header value');
        }
      }
      return { cek, encryptedKey, parameters };
    }
    exports.default = encryptKeyManagement;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/flattened/encrypt.js
var require_encrypt2 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/flattened/encrypt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FlattenedEncrypt = void 0;
    var base64url_js_1 = require_base64url();
    var private_symbols_js_1 = require_private_symbols();
    var encrypt_js_1 = require_encrypt();
    var encrypt_key_management_js_1 = require_encrypt_key_management();
    var errors_js_1 = require_errors2();
    var is_disjoint_js_1 = require_is_disjoint();
    var buffer_utils_js_1 = require_buffer_utils();
    var validate_crit_js_1 = require_validate_crit();
    var FlattenedEncrypt = class {
      _plaintext;
      _protectedHeader;
      _sharedUnprotectedHeader;
      _unprotectedHeader;
      _aad;
      _cek;
      _iv;
      _keyManagementParameters;
      constructor(plaintext) {
        if (!(plaintext instanceof Uint8Array)) {
          throw new TypeError("plaintext must be an instance of Uint8Array");
        }
        this._plaintext = plaintext;
      }
      setKeyManagementParameters(parameters) {
        if (this._keyManagementParameters) {
          throw new TypeError("setKeyManagementParameters can only be called once");
        }
        this._keyManagementParameters = parameters;
        return this;
      }
      setProtectedHeader(protectedHeader) {
        if (this._protectedHeader) {
          throw new TypeError("setProtectedHeader can only be called once");
        }
        this._protectedHeader = protectedHeader;
        return this;
      }
      setSharedUnprotectedHeader(sharedUnprotectedHeader) {
        if (this._sharedUnprotectedHeader) {
          throw new TypeError("setSharedUnprotectedHeader can only be called once");
        }
        this._sharedUnprotectedHeader = sharedUnprotectedHeader;
        return this;
      }
      setUnprotectedHeader(unprotectedHeader) {
        if (this._unprotectedHeader) {
          throw new TypeError("setUnprotectedHeader can only be called once");
        }
        this._unprotectedHeader = unprotectedHeader;
        return this;
      }
      setAdditionalAuthenticatedData(aad) {
        this._aad = aad;
        return this;
      }
      setContentEncryptionKey(cek) {
        if (this._cek) {
          throw new TypeError("setContentEncryptionKey can only be called once");
        }
        this._cek = cek;
        return this;
      }
      setInitializationVector(iv) {
        if (this._iv) {
          throw new TypeError("setInitializationVector can only be called once");
        }
        this._iv = iv;
        return this;
      }
      async encrypt(key, options) {
        if (!this._protectedHeader && !this._unprotectedHeader && !this._sharedUnprotectedHeader) {
          throw new errors_js_1.JWEInvalid("either setProtectedHeader, setUnprotectedHeader, or sharedUnprotectedHeader must be called before #encrypt()");
        }
        if (!(0, is_disjoint_js_1.default)(this._protectedHeader, this._unprotectedHeader, this._sharedUnprotectedHeader)) {
          throw new errors_js_1.JWEInvalid("JWE Protected, JWE Shared Unprotected and JWE Per-Recipient Header Parameter names must be disjoint");
        }
        const joseHeader = {
          ...this._protectedHeader,
          ...this._unprotectedHeader,
          ...this._sharedUnprotectedHeader
        };
        (0, validate_crit_js_1.default)(errors_js_1.JWEInvalid, /* @__PURE__ */ new Map(), options?.crit, this._protectedHeader, joseHeader);
        if (joseHeader.zip !== void 0) {
          throw new errors_js_1.JOSENotSupported('JWE "zip" (Compression Algorithm) Header Parameter is not supported.');
        }
        const { alg, enc } = joseHeader;
        if (typeof alg !== "string" || !alg) {
          throw new errors_js_1.JWEInvalid('JWE "alg" (Algorithm) Header Parameter missing or invalid');
        }
        if (typeof enc !== "string" || !enc) {
          throw new errors_js_1.JWEInvalid('JWE "enc" (Encryption Algorithm) Header Parameter missing or invalid');
        }
        let encryptedKey;
        if (this._cek && (alg === "dir" || alg === "ECDH-ES")) {
          throw new TypeError(`setContentEncryptionKey cannot be called with JWE "alg" (Algorithm) Header ${alg}`);
        }
        let cek;
        {
          let parameters;
          ({ cek, encryptedKey, parameters } = await (0, encrypt_key_management_js_1.default)(alg, enc, key, this._cek, this._keyManagementParameters));
          if (parameters) {
            if (options && private_symbols_js_1.unprotected in options) {
              if (!this._unprotectedHeader) {
                this.setUnprotectedHeader(parameters);
              } else {
                this._unprotectedHeader = { ...this._unprotectedHeader, ...parameters };
              }
            } else if (!this._protectedHeader) {
              this.setProtectedHeader(parameters);
            } else {
              this._protectedHeader = { ...this._protectedHeader, ...parameters };
            }
          }
        }
        let additionalData;
        let protectedHeader;
        let aadMember;
        if (this._protectedHeader) {
          protectedHeader = buffer_utils_js_1.encoder.encode((0, base64url_js_1.encode)(JSON.stringify(this._protectedHeader)));
        } else {
          protectedHeader = buffer_utils_js_1.encoder.encode("");
        }
        if (this._aad) {
          aadMember = (0, base64url_js_1.encode)(this._aad);
          additionalData = (0, buffer_utils_js_1.concat)(protectedHeader, buffer_utils_js_1.encoder.encode("."), buffer_utils_js_1.encoder.encode(aadMember));
        } else {
          additionalData = protectedHeader;
        }
        const { ciphertext, tag, iv } = await (0, encrypt_js_1.default)(enc, this._plaintext, cek, this._iv, additionalData);
        const jwe = {
          ciphertext: (0, base64url_js_1.encode)(ciphertext)
        };
        if (iv) {
          jwe.iv = (0, base64url_js_1.encode)(iv);
        }
        if (tag) {
          jwe.tag = (0, base64url_js_1.encode)(tag);
        }
        if (encryptedKey) {
          jwe.encrypted_key = (0, base64url_js_1.encode)(encryptedKey);
        }
        if (aadMember) {
          jwe.aad = aadMember;
        }
        if (this._protectedHeader) {
          jwe.protected = buffer_utils_js_1.decoder.decode(protectedHeader);
        }
        if (this._sharedUnprotectedHeader) {
          jwe.unprotected = this._sharedUnprotectedHeader;
        }
        if (this._unprotectedHeader) {
          jwe.header = this._unprotectedHeader;
        }
        return jwe;
      }
    };
    exports.FlattenedEncrypt = FlattenedEncrypt;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/general/encrypt.js
var require_encrypt3 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/general/encrypt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.GeneralEncrypt = void 0;
    var encrypt_js_1 = require_encrypt2();
    var private_symbols_js_1 = require_private_symbols();
    var errors_js_1 = require_errors2();
    var cek_js_1 = require_cek();
    var is_disjoint_js_1 = require_is_disjoint();
    var encrypt_key_management_js_1 = require_encrypt_key_management();
    var base64url_js_1 = require_base64url();
    var validate_crit_js_1 = require_validate_crit();
    var IndividualRecipient = class {
      parent;
      unprotectedHeader;
      key;
      options;
      constructor(enc, key, options) {
        this.parent = enc;
        this.key = key;
        this.options = options;
      }
      setUnprotectedHeader(unprotectedHeader) {
        if (this.unprotectedHeader) {
          throw new TypeError("setUnprotectedHeader can only be called once");
        }
        this.unprotectedHeader = unprotectedHeader;
        return this;
      }
      addRecipient(...args) {
        return this.parent.addRecipient(...args);
      }
      encrypt(...args) {
        return this.parent.encrypt(...args);
      }
      done() {
        return this.parent;
      }
    };
    var GeneralEncrypt = class {
      _plaintext;
      _recipients = [];
      _protectedHeader;
      _unprotectedHeader;
      _aad;
      constructor(plaintext) {
        this._plaintext = plaintext;
      }
      addRecipient(key, options) {
        const recipient = new IndividualRecipient(this, key, { crit: options?.crit });
        this._recipients.push(recipient);
        return recipient;
      }
      setProtectedHeader(protectedHeader) {
        if (this._protectedHeader) {
          throw new TypeError("setProtectedHeader can only be called once");
        }
        this._protectedHeader = protectedHeader;
        return this;
      }
      setSharedUnprotectedHeader(sharedUnprotectedHeader) {
        if (this._unprotectedHeader) {
          throw new TypeError("setSharedUnprotectedHeader can only be called once");
        }
        this._unprotectedHeader = sharedUnprotectedHeader;
        return this;
      }
      setAdditionalAuthenticatedData(aad) {
        this._aad = aad;
        return this;
      }
      async encrypt() {
        if (!this._recipients.length) {
          throw new errors_js_1.JWEInvalid("at least one recipient must be added");
        }
        if (this._recipients.length === 1) {
          const [recipient] = this._recipients;
          const flattened = await new encrypt_js_1.FlattenedEncrypt(this._plaintext).setAdditionalAuthenticatedData(this._aad).setProtectedHeader(this._protectedHeader).setSharedUnprotectedHeader(this._unprotectedHeader).setUnprotectedHeader(recipient.unprotectedHeader).encrypt(recipient.key, { ...recipient.options });
          const jwe2 = {
            ciphertext: flattened.ciphertext,
            iv: flattened.iv,
            recipients: [{}],
            tag: flattened.tag
          };
          if (flattened.aad)
            jwe2.aad = flattened.aad;
          if (flattened.protected)
            jwe2.protected = flattened.protected;
          if (flattened.unprotected)
            jwe2.unprotected = flattened.unprotected;
          if (flattened.encrypted_key)
            jwe2.recipients[0].encrypted_key = flattened.encrypted_key;
          if (flattened.header)
            jwe2.recipients[0].header = flattened.header;
          return jwe2;
        }
        let enc;
        for (let i5 = 0; i5 < this._recipients.length; i5++) {
          const recipient = this._recipients[i5];
          if (!(0, is_disjoint_js_1.default)(this._protectedHeader, this._unprotectedHeader, recipient.unprotectedHeader)) {
            throw new errors_js_1.JWEInvalid("JWE Protected, JWE Shared Unprotected and JWE Per-Recipient Header Parameter names must be disjoint");
          }
          const joseHeader = {
            ...this._protectedHeader,
            ...this._unprotectedHeader,
            ...recipient.unprotectedHeader
          };
          const { alg } = joseHeader;
          if (typeof alg !== "string" || !alg) {
            throw new errors_js_1.JWEInvalid('JWE "alg" (Algorithm) Header Parameter missing or invalid');
          }
          if (alg === "dir" || alg === "ECDH-ES") {
            throw new errors_js_1.JWEInvalid('"dir" and "ECDH-ES" alg may only be used with a single recipient');
          }
          if (typeof joseHeader.enc !== "string" || !joseHeader.enc) {
            throw new errors_js_1.JWEInvalid('JWE "enc" (Encryption Algorithm) Header Parameter missing or invalid');
          }
          if (!enc) {
            enc = joseHeader.enc;
          } else if (enc !== joseHeader.enc) {
            throw new errors_js_1.JWEInvalid('JWE "enc" (Encryption Algorithm) Header Parameter must be the same for all recipients');
          }
          (0, validate_crit_js_1.default)(errors_js_1.JWEInvalid, /* @__PURE__ */ new Map(), recipient.options.crit, this._protectedHeader, joseHeader);
          if (joseHeader.zip !== void 0) {
            throw new errors_js_1.JOSENotSupported('JWE "zip" (Compression Algorithm) Header Parameter is not supported.');
          }
        }
        const cek = (0, cek_js_1.default)(enc);
        const jwe = {
          ciphertext: "",
          iv: "",
          recipients: [],
          tag: ""
        };
        for (let i5 = 0; i5 < this._recipients.length; i5++) {
          const recipient = this._recipients[i5];
          const target = {};
          jwe.recipients.push(target);
          const joseHeader = {
            ...this._protectedHeader,
            ...this._unprotectedHeader,
            ...recipient.unprotectedHeader
          };
          const p2c = joseHeader.alg.startsWith("PBES2") ? 2048 + i5 : void 0;
          if (i5 === 0) {
            const flattened = await new encrypt_js_1.FlattenedEncrypt(this._plaintext).setAdditionalAuthenticatedData(this._aad).setContentEncryptionKey(cek).setProtectedHeader(this._protectedHeader).setSharedUnprotectedHeader(this._unprotectedHeader).setUnprotectedHeader(recipient.unprotectedHeader).setKeyManagementParameters({ p2c }).encrypt(recipient.key, {
              ...recipient.options,
              [private_symbols_js_1.unprotected]: true
            });
            jwe.ciphertext = flattened.ciphertext;
            jwe.iv = flattened.iv;
            jwe.tag = flattened.tag;
            if (flattened.aad)
              jwe.aad = flattened.aad;
            if (flattened.protected)
              jwe.protected = flattened.protected;
            if (flattened.unprotected)
              jwe.unprotected = flattened.unprotected;
            target.encrypted_key = flattened.encrypted_key;
            if (flattened.header)
              target.header = flattened.header;
            continue;
          }
          const { encryptedKey, parameters } = await (0, encrypt_key_management_js_1.default)(recipient.unprotectedHeader?.alg || this._protectedHeader?.alg || this._unprotectedHeader?.alg, enc, recipient.key, cek, { p2c });
          target.encrypted_key = (0, base64url_js_1.encode)(encryptedKey);
          if (recipient.unprotectedHeader || parameters)
            target.header = { ...recipient.unprotectedHeader, ...parameters };
        }
        return jwe;
      }
    };
    exports.GeneralEncrypt = GeneralEncrypt;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/dsa_digest.js
var require_dsa_digest = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/dsa_digest.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = dsaDigest;
    var errors_js_1 = require_errors2();
    function dsaDigest(alg) {
      switch (alg) {
        case "PS256":
        case "RS256":
        case "ES256":
        case "ES256K":
          return "sha256";
        case "PS384":
        case "RS384":
        case "ES384":
          return "sha384";
        case "PS512":
        case "RS512":
        case "ES512":
          return "sha512";
        case "Ed25519":
        case "EdDSA":
          return void 0;
        default:
          throw new errors_js_1.JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
      }
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/node_key.js
var require_node_key = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/node_key.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = keyForCrypto;
    var node_crypto_1 = __require("node:crypto");
    var get_named_curve_js_1 = require_get_named_curve();
    var errors_js_1 = require_errors2();
    var check_key_length_js_1 = require_check_key_length();
    var ecCurveAlgMap = /* @__PURE__ */ new Map([
      ["ES256", "P-256"],
      ["ES256K", "secp256k1"],
      ["ES384", "P-384"],
      ["ES512", "P-521"]
    ]);
    function keyForCrypto(alg, key) {
      let asymmetricKeyType;
      let asymmetricKeyDetails;
      let isJWK;
      if (key instanceof node_crypto_1.KeyObject) {
        asymmetricKeyType = key.asymmetricKeyType;
        asymmetricKeyDetails = key.asymmetricKeyDetails;
      } else {
        isJWK = true;
        switch (key.kty) {
          case "RSA":
            asymmetricKeyType = "rsa";
            break;
          case "EC":
            asymmetricKeyType = "ec";
            break;
          case "OKP": {
            if (key.crv === "Ed25519") {
              asymmetricKeyType = "ed25519";
              break;
            }
            if (key.crv === "Ed448") {
              asymmetricKeyType = "ed448";
              break;
            }
            throw new TypeError("Invalid key for this operation, its crv must be Ed25519 or Ed448");
          }
          default:
            throw new TypeError("Invalid key for this operation, its kty must be RSA, OKP, or EC");
        }
      }
      let options;
      switch (alg) {
        case "Ed25519":
          if (asymmetricKeyType !== "ed25519") {
            throw new TypeError(`Invalid key for this operation, its asymmetricKeyType must be ed25519`);
          }
          break;
        case "EdDSA":
          if (!["ed25519", "ed448"].includes(asymmetricKeyType)) {
            throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be ed25519 or ed448");
          }
          break;
        case "RS256":
        case "RS384":
        case "RS512":
          if (asymmetricKeyType !== "rsa") {
            throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be rsa");
          }
          (0, check_key_length_js_1.default)(key, alg);
          break;
        case "PS256":
        case "PS384":
        case "PS512":
          if (asymmetricKeyType === "rsa-pss") {
            const { hashAlgorithm, mgf1HashAlgorithm, saltLength } = asymmetricKeyDetails;
            const length = parseInt(alg.slice(-3), 10);
            if (hashAlgorithm !== void 0 && (hashAlgorithm !== `sha${length}` || mgf1HashAlgorithm !== hashAlgorithm)) {
              throw new TypeError(`Invalid key for this operation, its RSA-PSS parameters do not meet the requirements of "alg" ${alg}`);
            }
            if (saltLength !== void 0 && saltLength > length >> 3) {
              throw new TypeError(`Invalid key for this operation, its RSA-PSS parameter saltLength does not meet the requirements of "alg" ${alg}`);
            }
          } else if (asymmetricKeyType !== "rsa") {
            throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be rsa or rsa-pss");
          }
          (0, check_key_length_js_1.default)(key, alg);
          options = {
            padding: node_crypto_1.constants.RSA_PKCS1_PSS_PADDING,
            saltLength: node_crypto_1.constants.RSA_PSS_SALTLEN_DIGEST
          };
          break;
        case "ES256":
        case "ES256K":
        case "ES384":
        case "ES512": {
          if (asymmetricKeyType !== "ec") {
            throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be ec");
          }
          const actual = (0, get_named_curve_js_1.default)(key);
          const expected = ecCurveAlgMap.get(alg);
          if (actual !== expected) {
            throw new TypeError(`Invalid key curve for the algorithm, its curve must be ${expected}, got ${actual}`);
          }
          options = { dsaEncoding: "ieee-p1363" };
          break;
        }
        default:
          throw new errors_js_1.JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
      }
      if (isJWK) {
        return { format: "jwk", key, ...options };
      }
      return options ? { ...options, key } : key;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/hmac_digest.js
var require_hmac_digest = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/hmac_digest.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = hmacDigest;
    var errors_js_1 = require_errors2();
    function hmacDigest(alg) {
      switch (alg) {
        case "HS256":
          return "sha256";
        case "HS384":
          return "sha384";
        case "HS512":
          return "sha512";
        default:
          throw new errors_js_1.JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
      }
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/get_sign_verify_key.js
var require_get_sign_verify_key = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/get_sign_verify_key.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = getSignVerifyKey;
    var node_crypto_1 = __require("node:crypto");
    var webcrypto_js_1 = require_webcrypto();
    var crypto_key_js_1 = require_crypto_key();
    var invalid_key_input_js_1 = require_invalid_key_input();
    var is_key_like_js_1 = require_is_key_like();
    var jwk = require_is_jwk();
    function getSignVerifyKey(alg, key, usage) {
      if (key instanceof Uint8Array) {
        if (!alg.startsWith("HS")) {
          throw new TypeError((0, invalid_key_input_js_1.default)(key, ...is_key_like_js_1.types));
        }
        return (0, node_crypto_1.createSecretKey)(key);
      }
      if (key instanceof node_crypto_1.KeyObject) {
        return key;
      }
      if ((0, webcrypto_js_1.isCryptoKey)(key)) {
        (0, crypto_key_js_1.checkSigCryptoKey)(key, alg, usage);
        return node_crypto_1.KeyObject.from(key);
      }
      if (jwk.isJWK(key)) {
        if (alg.startsWith("HS")) {
          return (0, node_crypto_1.createSecretKey)(Buffer.from(key.k, "base64url"));
        }
        return key;
      }
      throw new TypeError((0, invalid_key_input_js_1.default)(key, ...is_key_like_js_1.types, "Uint8Array", "JSON Web Key"));
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/sign.js
var require_sign = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/sign.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var crypto = __require("node:crypto");
    var node_util_1 = __require("node:util");
    var dsa_digest_js_1 = require_dsa_digest();
    var hmac_digest_js_1 = require_hmac_digest();
    var node_key_js_1 = require_node_key();
    var get_sign_verify_key_js_1 = require_get_sign_verify_key();
    var oneShotSign = (0, node_util_1.promisify)(crypto.sign);
    var sign = async (alg, key, data) => {
      const k2 = (0, get_sign_verify_key_js_1.default)(alg, key, "sign");
      if (alg.startsWith("HS")) {
        const hmac = crypto.createHmac((0, hmac_digest_js_1.default)(alg), k2);
        hmac.update(data);
        return hmac.digest();
      }
      return oneShotSign((0, dsa_digest_js_1.default)(alg), data, (0, node_key_js_1.default)(alg, k2));
    };
    exports.default = sign;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/verify.js
var require_verify = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/verify.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var crypto = __require("node:crypto");
    var node_util_1 = __require("node:util");
    var dsa_digest_js_1 = require_dsa_digest();
    var node_key_js_1 = require_node_key();
    var sign_js_1 = require_sign();
    var get_sign_verify_key_js_1 = require_get_sign_verify_key();
    var oneShotVerify = (0, node_util_1.promisify)(crypto.verify);
    var verify = async (alg, key, signature, data) => {
      const k2 = (0, get_sign_verify_key_js_1.default)(alg, key, "verify");
      if (alg.startsWith("HS")) {
        const expected = await (0, sign_js_1.default)(alg, k2, data);
        const actual = signature;
        try {
          return crypto.timingSafeEqual(actual, expected);
        } catch {
          return false;
        }
      }
      const algorithm = (0, dsa_digest_js_1.default)(alg);
      const keyInput = (0, node_key_js_1.default)(alg, k2);
      try {
        return await oneShotVerify(algorithm, data, keyInput, signature);
      } catch {
        return false;
      }
    };
    exports.default = verify;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/flattened/verify.js
var require_verify2 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/flattened/verify.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.flattenedVerify = flattenedVerify;
    var base64url_js_1 = require_base64url();
    var verify_js_1 = require_verify();
    var errors_js_1 = require_errors2();
    var buffer_utils_js_1 = require_buffer_utils();
    var is_disjoint_js_1 = require_is_disjoint();
    var is_object_js_1 = require_is_object();
    var check_key_type_js_1 = require_check_key_type();
    var validate_crit_js_1 = require_validate_crit();
    var validate_algorithms_js_1 = require_validate_algorithms();
    var is_jwk_js_1 = require_is_jwk();
    var import_js_1 = require_import();
    async function flattenedVerify(jws, key, options) {
      if (!(0, is_object_js_1.default)(jws)) {
        throw new errors_js_1.JWSInvalid("Flattened JWS must be an object");
      }
      if (jws.protected === void 0 && jws.header === void 0) {
        throw new errors_js_1.JWSInvalid('Flattened JWS must have either of the "protected" or "header" members');
      }
      if (jws.protected !== void 0 && typeof jws.protected !== "string") {
        throw new errors_js_1.JWSInvalid("JWS Protected Header incorrect type");
      }
      if (jws.payload === void 0) {
        throw new errors_js_1.JWSInvalid("JWS Payload missing");
      }
      if (typeof jws.signature !== "string") {
        throw new errors_js_1.JWSInvalid("JWS Signature missing or incorrect type");
      }
      if (jws.header !== void 0 && !(0, is_object_js_1.default)(jws.header)) {
        throw new errors_js_1.JWSInvalid("JWS Unprotected Header incorrect type");
      }
      let parsedProt = {};
      if (jws.protected) {
        try {
          const protectedHeader = (0, base64url_js_1.decode)(jws.protected);
          parsedProt = JSON.parse(buffer_utils_js_1.decoder.decode(protectedHeader));
        } catch {
          throw new errors_js_1.JWSInvalid("JWS Protected Header is invalid");
        }
      }
      if (!(0, is_disjoint_js_1.default)(parsedProt, jws.header)) {
        throw new errors_js_1.JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
      }
      const joseHeader = {
        ...parsedProt,
        ...jws.header
      };
      const extensions = (0, validate_crit_js_1.default)(errors_js_1.JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, parsedProt, joseHeader);
      let b64 = true;
      if (extensions.has("b64")) {
        b64 = parsedProt.b64;
        if (typeof b64 !== "boolean") {
          throw new errors_js_1.JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
        }
      }
      const { alg } = joseHeader;
      if (typeof alg !== "string" || !alg) {
        throw new errors_js_1.JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
      }
      const algorithms = options && (0, validate_algorithms_js_1.default)("algorithms", options.algorithms);
      if (algorithms && !algorithms.has(alg)) {
        throw new errors_js_1.JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
      }
      if (b64) {
        if (typeof jws.payload !== "string") {
          throw new errors_js_1.JWSInvalid("JWS Payload must be a string");
        }
      } else if (typeof jws.payload !== "string" && !(jws.payload instanceof Uint8Array)) {
        throw new errors_js_1.JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
      }
      let resolvedKey = false;
      if (typeof key === "function") {
        key = await key(parsedProt, jws);
        resolvedKey = true;
        (0, check_key_type_js_1.checkKeyTypeWithJwk)(alg, key, "verify");
        if ((0, is_jwk_js_1.isJWK)(key)) {
          key = await (0, import_js_1.importJWK)(key, alg);
        }
      } else {
        (0, check_key_type_js_1.checkKeyTypeWithJwk)(alg, key, "verify");
      }
      const data = (0, buffer_utils_js_1.concat)(buffer_utils_js_1.encoder.encode(jws.protected ?? ""), buffer_utils_js_1.encoder.encode("."), typeof jws.payload === "string" ? buffer_utils_js_1.encoder.encode(jws.payload) : jws.payload);
      let signature;
      try {
        signature = (0, base64url_js_1.decode)(jws.signature);
      } catch {
        throw new errors_js_1.JWSInvalid("Failed to base64url decode the signature");
      }
      const verified = await (0, verify_js_1.default)(alg, key, signature, data);
      if (!verified) {
        throw new errors_js_1.JWSSignatureVerificationFailed();
      }
      let payload;
      if (b64) {
        try {
          payload = (0, base64url_js_1.decode)(jws.payload);
        } catch {
          throw new errors_js_1.JWSInvalid("Failed to base64url decode the payload");
        }
      } else if (typeof jws.payload === "string") {
        payload = buffer_utils_js_1.encoder.encode(jws.payload);
      } else {
        payload = jws.payload;
      }
      const result = { payload };
      if (jws.protected !== void 0) {
        result.protectedHeader = parsedProt;
      }
      if (jws.header !== void 0) {
        result.unprotectedHeader = jws.header;
      }
      if (resolvedKey) {
        return { ...result, key };
      }
      return result;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/compact/verify.js
var require_verify3 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/compact/verify.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.compactVerify = compactVerify;
    var verify_js_1 = require_verify2();
    var errors_js_1 = require_errors2();
    var buffer_utils_js_1 = require_buffer_utils();
    async function compactVerify(jws, key, options) {
      if (jws instanceof Uint8Array) {
        jws = buffer_utils_js_1.decoder.decode(jws);
      }
      if (typeof jws !== "string") {
        throw new errors_js_1.JWSInvalid("Compact JWS must be a string or Uint8Array");
      }
      const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
      if (length !== 3) {
        throw new errors_js_1.JWSInvalid("Invalid Compact JWS");
      }
      const verified = await (0, verify_js_1.flattenedVerify)({ payload, protected: protectedHeader, signature }, key, options);
      const result = { payload: verified.payload, protectedHeader: verified.protectedHeader };
      if (typeof key === "function") {
        return { ...result, key: verified.key };
      }
      return result;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/general/verify.js
var require_verify4 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/general/verify.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.generalVerify = generalVerify;
    var verify_js_1 = require_verify2();
    var errors_js_1 = require_errors2();
    var is_object_js_1 = require_is_object();
    async function generalVerify(jws, key, options) {
      if (!(0, is_object_js_1.default)(jws)) {
        throw new errors_js_1.JWSInvalid("General JWS must be an object");
      }
      if (!Array.isArray(jws.signatures) || !jws.signatures.every(is_object_js_1.default)) {
        throw new errors_js_1.JWSInvalid("JWS Signatures missing or incorrect type");
      }
      for (const signature of jws.signatures) {
        try {
          return await (0, verify_js_1.flattenedVerify)({
            header: signature.header,
            payload: jws.payload,
            protected: signature.protected,
            signature: signature.signature
          }, key, options);
        } catch {
        }
      }
      throw new errors_js_1.JWSSignatureVerificationFailed();
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/epoch.js
var require_epoch = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/epoch.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = (date) => Math.floor(date.getTime() / 1e3);
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/secs.js
var require_secs = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/secs.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var minute = 60;
    var hour = minute * 60;
    var day = hour * 24;
    var week = day * 7;
    var year = day * 365.25;
    var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
    exports.default = (str) => {
      const matched = REGEX.exec(str);
      if (!matched || matched[4] && matched[1]) {
        throw new TypeError("Invalid time period format");
      }
      const value = parseFloat(matched[2]);
      const unit = matched[3].toLowerCase();
      let numericDate;
      switch (unit) {
        case "sec":
        case "secs":
        case "second":
        case "seconds":
        case "s":
          numericDate = Math.round(value);
          break;
        case "minute":
        case "minutes":
        case "min":
        case "mins":
        case "m":
          numericDate = Math.round(value * minute);
          break;
        case "hour":
        case "hours":
        case "hr":
        case "hrs":
        case "h":
          numericDate = Math.round(value * hour);
          break;
        case "day":
        case "days":
        case "d":
          numericDate = Math.round(value * day);
          break;
        case "week":
        case "weeks":
        case "w":
          numericDate = Math.round(value * week);
          break;
        default:
          numericDate = Math.round(value * year);
          break;
      }
      if (matched[1] === "-" || matched[4] === "ago") {
        return -numericDate;
      }
      return numericDate;
    };
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/jwt_claims_set.js
var require_jwt_claims_set = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/lib/jwt_claims_set.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var errors_js_1 = require_errors2();
    var buffer_utils_js_1 = require_buffer_utils();
    var epoch_js_1 = require_epoch();
    var secs_js_1 = require_secs();
    var is_object_js_1 = require_is_object();
    var normalizeTyp = (value) => value.toLowerCase().replace(/^application\//, "");
    var checkAudiencePresence = (audPayload, audOption) => {
      if (typeof audPayload === "string") {
        return audOption.includes(audPayload);
      }
      if (Array.isArray(audPayload)) {
        return audOption.some(Set.prototype.has.bind(new Set(audPayload)));
      }
      return false;
    };
    exports.default = (protectedHeader, encodedPayload, options = {}) => {
      let payload;
      try {
        payload = JSON.parse(buffer_utils_js_1.decoder.decode(encodedPayload));
      } catch {
      }
      if (!(0, is_object_js_1.default)(payload)) {
        throw new errors_js_1.JWTInvalid("JWT Claims Set must be a top-level JSON object");
      }
      const { typ } = options;
      if (typ && (typeof protectedHeader.typ !== "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ))) {
        throw new errors_js_1.JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", "check_failed");
      }
      const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options;
      const presenceCheck = [...requiredClaims];
      if (maxTokenAge !== void 0)
        presenceCheck.push("iat");
      if (audience !== void 0)
        presenceCheck.push("aud");
      if (subject !== void 0)
        presenceCheck.push("sub");
      if (issuer !== void 0)
        presenceCheck.push("iss");
      for (const claim of new Set(presenceCheck.reverse())) {
        if (!(claim in payload)) {
          throw new errors_js_1.JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
        }
      }
      if (issuer && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss)) {
        throw new errors_js_1.JWTClaimValidationFailed('unexpected "iss" claim value', payload, "iss", "check_failed");
      }
      if (subject && payload.sub !== subject) {
        throw new errors_js_1.JWTClaimValidationFailed('unexpected "sub" claim value', payload, "sub", "check_failed");
      }
      if (audience && !checkAudiencePresence(payload.aud, typeof audience === "string" ? [audience] : audience)) {
        throw new errors_js_1.JWTClaimValidationFailed('unexpected "aud" claim value', payload, "aud", "check_failed");
      }
      let tolerance;
      switch (typeof options.clockTolerance) {
        case "string":
          tolerance = (0, secs_js_1.default)(options.clockTolerance);
          break;
        case "number":
          tolerance = options.clockTolerance;
          break;
        case "undefined":
          tolerance = 0;
          break;
        default:
          throw new TypeError("Invalid clockTolerance option type");
      }
      const { currentDate } = options;
      const now = (0, epoch_js_1.default)(currentDate || /* @__PURE__ */ new Date());
      if ((payload.iat !== void 0 || maxTokenAge) && typeof payload.iat !== "number") {
        throw new errors_js_1.JWTClaimValidationFailed('"iat" claim must be a number', payload, "iat", "invalid");
      }
      if (payload.nbf !== void 0) {
        if (typeof payload.nbf !== "number") {
          throw new errors_js_1.JWTClaimValidationFailed('"nbf" claim must be a number', payload, "nbf", "invalid");
        }
        if (payload.nbf > now + tolerance) {
          throw new errors_js_1.JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", "check_failed");
        }
      }
      if (payload.exp !== void 0) {
        if (typeof payload.exp !== "number") {
          throw new errors_js_1.JWTClaimValidationFailed('"exp" claim must be a number', payload, "exp", "invalid");
        }
        if (payload.exp <= now - tolerance) {
          throw new errors_js_1.JWTExpired('"exp" claim timestamp check failed', payload, "exp", "check_failed");
        }
      }
      if (maxTokenAge) {
        const age = now - payload.iat;
        const max = typeof maxTokenAge === "number" ? maxTokenAge : (0, secs_js_1.default)(maxTokenAge);
        if (age - tolerance > max) {
          throw new errors_js_1.JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", "check_failed");
        }
        if (age < 0 - tolerance) {
          throw new errors_js_1.JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", "check_failed");
        }
      }
      return payload;
    };
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/verify.js
var require_verify5 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/verify.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.jwtVerify = jwtVerify;
    var verify_js_1 = require_verify3();
    var jwt_claims_set_js_1 = require_jwt_claims_set();
    var errors_js_1 = require_errors2();
    async function jwtVerify(jwt, key, options) {
      const verified = await (0, verify_js_1.compactVerify)(jwt, key, options);
      if (verified.protectedHeader.crit?.includes("b64") && verified.protectedHeader.b64 === false) {
        throw new errors_js_1.JWTInvalid("JWTs MUST NOT use unencoded payload");
      }
      const payload = (0, jwt_claims_set_js_1.default)(verified.protectedHeader, verified.payload, options);
      const result = { payload, protectedHeader: verified.protectedHeader };
      if (typeof key === "function") {
        return { ...result, key: verified.key };
      }
      return result;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/decrypt.js
var require_decrypt5 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/decrypt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.jwtDecrypt = jwtDecrypt;
    var decrypt_js_1 = require_decrypt3();
    var jwt_claims_set_js_1 = require_jwt_claims_set();
    var errors_js_1 = require_errors2();
    async function jwtDecrypt(jwt, key, options) {
      const decrypted = await (0, decrypt_js_1.compactDecrypt)(jwt, key, options);
      const payload = (0, jwt_claims_set_js_1.default)(decrypted.protectedHeader, decrypted.plaintext, options);
      const { protectedHeader } = decrypted;
      if (protectedHeader.iss !== void 0 && protectedHeader.iss !== payload.iss) {
        throw new errors_js_1.JWTClaimValidationFailed('replicated "iss" claim header parameter mismatch', payload, "iss", "mismatch");
      }
      if (protectedHeader.sub !== void 0 && protectedHeader.sub !== payload.sub) {
        throw new errors_js_1.JWTClaimValidationFailed('replicated "sub" claim header parameter mismatch', payload, "sub", "mismatch");
      }
      if (protectedHeader.aud !== void 0 && JSON.stringify(protectedHeader.aud) !== JSON.stringify(payload.aud)) {
        throw new errors_js_1.JWTClaimValidationFailed('replicated "aud" claim header parameter mismatch', payload, "aud", "mismatch");
      }
      const result = { payload, protectedHeader };
      if (typeof key === "function") {
        return { ...result, key: decrypted.key };
      }
      return result;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/compact/encrypt.js
var require_encrypt4 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwe/compact/encrypt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CompactEncrypt = void 0;
    var encrypt_js_1 = require_encrypt2();
    var CompactEncrypt = class {
      _flattened;
      constructor(plaintext) {
        this._flattened = new encrypt_js_1.FlattenedEncrypt(plaintext);
      }
      setContentEncryptionKey(cek) {
        this._flattened.setContentEncryptionKey(cek);
        return this;
      }
      setInitializationVector(iv) {
        this._flattened.setInitializationVector(iv);
        return this;
      }
      setProtectedHeader(protectedHeader) {
        this._flattened.setProtectedHeader(protectedHeader);
        return this;
      }
      setKeyManagementParameters(parameters) {
        this._flattened.setKeyManagementParameters(parameters);
        return this;
      }
      async encrypt(key, options) {
        const jwe = await this._flattened.encrypt(key, options);
        return [jwe.protected, jwe.encrypted_key, jwe.iv, jwe.ciphertext, jwe.tag].join(".");
      }
    };
    exports.CompactEncrypt = CompactEncrypt;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/flattened/sign.js
var require_sign2 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/flattened/sign.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FlattenedSign = void 0;
    var base64url_js_1 = require_base64url();
    var sign_js_1 = require_sign();
    var is_disjoint_js_1 = require_is_disjoint();
    var errors_js_1 = require_errors2();
    var buffer_utils_js_1 = require_buffer_utils();
    var check_key_type_js_1 = require_check_key_type();
    var validate_crit_js_1 = require_validate_crit();
    var FlattenedSign = class {
      _payload;
      _protectedHeader;
      _unprotectedHeader;
      constructor(payload) {
        if (!(payload instanceof Uint8Array)) {
          throw new TypeError("payload must be an instance of Uint8Array");
        }
        this._payload = payload;
      }
      setProtectedHeader(protectedHeader) {
        if (this._protectedHeader) {
          throw new TypeError("setProtectedHeader can only be called once");
        }
        this._protectedHeader = protectedHeader;
        return this;
      }
      setUnprotectedHeader(unprotectedHeader) {
        if (this._unprotectedHeader) {
          throw new TypeError("setUnprotectedHeader can only be called once");
        }
        this._unprotectedHeader = unprotectedHeader;
        return this;
      }
      async sign(key, options) {
        if (!this._protectedHeader && !this._unprotectedHeader) {
          throw new errors_js_1.JWSInvalid("either setProtectedHeader or setUnprotectedHeader must be called before #sign()");
        }
        if (!(0, is_disjoint_js_1.default)(this._protectedHeader, this._unprotectedHeader)) {
          throw new errors_js_1.JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
        }
        const joseHeader = {
          ...this._protectedHeader,
          ...this._unprotectedHeader
        };
        const extensions = (0, validate_crit_js_1.default)(errors_js_1.JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, this._protectedHeader, joseHeader);
        let b64 = true;
        if (extensions.has("b64")) {
          b64 = this._protectedHeader.b64;
          if (typeof b64 !== "boolean") {
            throw new errors_js_1.JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
          }
        }
        const { alg } = joseHeader;
        if (typeof alg !== "string" || !alg) {
          throw new errors_js_1.JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
        }
        (0, check_key_type_js_1.checkKeyTypeWithJwk)(alg, key, "sign");
        let payload = this._payload;
        if (b64) {
          payload = buffer_utils_js_1.encoder.encode((0, base64url_js_1.encode)(payload));
        }
        let protectedHeader;
        if (this._protectedHeader) {
          protectedHeader = buffer_utils_js_1.encoder.encode((0, base64url_js_1.encode)(JSON.stringify(this._protectedHeader)));
        } else {
          protectedHeader = buffer_utils_js_1.encoder.encode("");
        }
        const data = (0, buffer_utils_js_1.concat)(protectedHeader, buffer_utils_js_1.encoder.encode("."), payload);
        const signature = await (0, sign_js_1.default)(alg, key, data);
        const jws = {
          signature: (0, base64url_js_1.encode)(signature),
          payload: ""
        };
        if (b64) {
          jws.payload = buffer_utils_js_1.decoder.decode(payload);
        }
        if (this._unprotectedHeader) {
          jws.header = this._unprotectedHeader;
        }
        if (this._protectedHeader) {
          jws.protected = buffer_utils_js_1.decoder.decode(protectedHeader);
        }
        return jws;
      }
    };
    exports.FlattenedSign = FlattenedSign;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/compact/sign.js
var require_sign3 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/compact/sign.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CompactSign = void 0;
    var sign_js_1 = require_sign2();
    var CompactSign = class {
      _flattened;
      constructor(payload) {
        this._flattened = new sign_js_1.FlattenedSign(payload);
      }
      setProtectedHeader(protectedHeader) {
        this._flattened.setProtectedHeader(protectedHeader);
        return this;
      }
      async sign(key, options) {
        const jws = await this._flattened.sign(key, options);
        if (jws.payload === void 0) {
          throw new TypeError("use the flattened module for creating JWS with b64: false");
        }
        return `${jws.protected}.${jws.payload}.${jws.signature}`;
      }
    };
    exports.CompactSign = CompactSign;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/general/sign.js
var require_sign4 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jws/general/sign.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.GeneralSign = void 0;
    var sign_js_1 = require_sign2();
    var errors_js_1 = require_errors2();
    var IndividualSignature = class {
      parent;
      protectedHeader;
      unprotectedHeader;
      options;
      key;
      constructor(sig, key, options) {
        this.parent = sig;
        this.key = key;
        this.options = options;
      }
      setProtectedHeader(protectedHeader) {
        if (this.protectedHeader) {
          throw new TypeError("setProtectedHeader can only be called once");
        }
        this.protectedHeader = protectedHeader;
        return this;
      }
      setUnprotectedHeader(unprotectedHeader) {
        if (this.unprotectedHeader) {
          throw new TypeError("setUnprotectedHeader can only be called once");
        }
        this.unprotectedHeader = unprotectedHeader;
        return this;
      }
      addSignature(...args) {
        return this.parent.addSignature(...args);
      }
      sign(...args) {
        return this.parent.sign(...args);
      }
      done() {
        return this.parent;
      }
    };
    var GeneralSign = class {
      _payload;
      _signatures = [];
      constructor(payload) {
        this._payload = payload;
      }
      addSignature(key, options) {
        const signature = new IndividualSignature(this, key, options);
        this._signatures.push(signature);
        return signature;
      }
      async sign() {
        if (!this._signatures.length) {
          throw new errors_js_1.JWSInvalid("at least one signature must be added");
        }
        const jws = {
          signatures: [],
          payload: ""
        };
        for (let i5 = 0; i5 < this._signatures.length; i5++) {
          const signature = this._signatures[i5];
          const flattened = new sign_js_1.FlattenedSign(this._payload);
          flattened.setProtectedHeader(signature.protectedHeader);
          flattened.setUnprotectedHeader(signature.unprotectedHeader);
          const { payload, ...rest } = await flattened.sign(signature.key, signature.options);
          if (i5 === 0) {
            jws.payload = payload;
          } else if (jws.payload !== payload) {
            throw new errors_js_1.JWSInvalid("inconsistent use of JWS Unencoded Payload (RFC7797)");
          }
          jws.signatures.push(rest);
        }
        return jws;
      }
    };
    exports.GeneralSign = GeneralSign;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/produce.js
var require_produce = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/produce.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ProduceJWT = void 0;
    var epoch_js_1 = require_epoch();
    var is_object_js_1 = require_is_object();
    var secs_js_1 = require_secs();
    function validateInput(label, input) {
      if (!Number.isFinite(input)) {
        throw new TypeError(`Invalid ${label} input`);
      }
      return input;
    }
    var ProduceJWT = class {
      _payload;
      constructor(payload = {}) {
        if (!(0, is_object_js_1.default)(payload)) {
          throw new TypeError("JWT Claims Set MUST be an object");
        }
        this._payload = payload;
      }
      setIssuer(issuer) {
        this._payload = { ...this._payload, iss: issuer };
        return this;
      }
      setSubject(subject) {
        this._payload = { ...this._payload, sub: subject };
        return this;
      }
      setAudience(audience) {
        this._payload = { ...this._payload, aud: audience };
        return this;
      }
      setJti(jwtId) {
        this._payload = { ...this._payload, jti: jwtId };
        return this;
      }
      setNotBefore(input) {
        if (typeof input === "number") {
          this._payload = { ...this._payload, nbf: validateInput("setNotBefore", input) };
        } else if (input instanceof Date) {
          this._payload = { ...this._payload, nbf: validateInput("setNotBefore", (0, epoch_js_1.default)(input)) };
        } else {
          this._payload = { ...this._payload, nbf: (0, epoch_js_1.default)(/* @__PURE__ */ new Date()) + (0, secs_js_1.default)(input) };
        }
        return this;
      }
      setExpirationTime(input) {
        if (typeof input === "number") {
          this._payload = { ...this._payload, exp: validateInput("setExpirationTime", input) };
        } else if (input instanceof Date) {
          this._payload = { ...this._payload, exp: validateInput("setExpirationTime", (0, epoch_js_1.default)(input)) };
        } else {
          this._payload = { ...this._payload, exp: (0, epoch_js_1.default)(/* @__PURE__ */ new Date()) + (0, secs_js_1.default)(input) };
        }
        return this;
      }
      setIssuedAt(input) {
        if (typeof input === "undefined") {
          this._payload = { ...this._payload, iat: (0, epoch_js_1.default)(/* @__PURE__ */ new Date()) };
        } else if (input instanceof Date) {
          this._payload = { ...this._payload, iat: validateInput("setIssuedAt", (0, epoch_js_1.default)(input)) };
        } else if (typeof input === "string") {
          this._payload = {
            ...this._payload,
            iat: validateInput("setIssuedAt", (0, epoch_js_1.default)(/* @__PURE__ */ new Date()) + (0, secs_js_1.default)(input))
          };
        } else {
          this._payload = { ...this._payload, iat: validateInput("setIssuedAt", input) };
        }
        return this;
      }
    };
    exports.ProduceJWT = ProduceJWT;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/sign.js
var require_sign5 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/sign.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SignJWT = void 0;
    var sign_js_1 = require_sign3();
    var errors_js_1 = require_errors2();
    var buffer_utils_js_1 = require_buffer_utils();
    var produce_js_1 = require_produce();
    var SignJWT = class extends produce_js_1.ProduceJWT {
      _protectedHeader;
      setProtectedHeader(protectedHeader) {
        this._protectedHeader = protectedHeader;
        return this;
      }
      async sign(key, options) {
        const sig = new sign_js_1.CompactSign(buffer_utils_js_1.encoder.encode(JSON.stringify(this._payload)));
        sig.setProtectedHeader(this._protectedHeader);
        if (Array.isArray(this._protectedHeader?.crit) && this._protectedHeader.crit.includes("b64") && this._protectedHeader.b64 === false) {
          throw new errors_js_1.JWTInvalid("JWTs MUST NOT use unencoded payload");
        }
        return sig.sign(key, options);
      }
    };
    exports.SignJWT = SignJWT;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/encrypt.js
var require_encrypt5 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/encrypt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EncryptJWT = void 0;
    var encrypt_js_1 = require_encrypt4();
    var buffer_utils_js_1 = require_buffer_utils();
    var produce_js_1 = require_produce();
    var EncryptJWT = class extends produce_js_1.ProduceJWT {
      _cek;
      _iv;
      _keyManagementParameters;
      _protectedHeader;
      _replicateIssuerAsHeader;
      _replicateSubjectAsHeader;
      _replicateAudienceAsHeader;
      setProtectedHeader(protectedHeader) {
        if (this._protectedHeader) {
          throw new TypeError("setProtectedHeader can only be called once");
        }
        this._protectedHeader = protectedHeader;
        return this;
      }
      setKeyManagementParameters(parameters) {
        if (this._keyManagementParameters) {
          throw new TypeError("setKeyManagementParameters can only be called once");
        }
        this._keyManagementParameters = parameters;
        return this;
      }
      setContentEncryptionKey(cek) {
        if (this._cek) {
          throw new TypeError("setContentEncryptionKey can only be called once");
        }
        this._cek = cek;
        return this;
      }
      setInitializationVector(iv) {
        if (this._iv) {
          throw new TypeError("setInitializationVector can only be called once");
        }
        this._iv = iv;
        return this;
      }
      replicateIssuerAsHeader() {
        this._replicateIssuerAsHeader = true;
        return this;
      }
      replicateSubjectAsHeader() {
        this._replicateSubjectAsHeader = true;
        return this;
      }
      replicateAudienceAsHeader() {
        this._replicateAudienceAsHeader = true;
        return this;
      }
      async encrypt(key, options) {
        const enc = new encrypt_js_1.CompactEncrypt(buffer_utils_js_1.encoder.encode(JSON.stringify(this._payload)));
        if (this._replicateIssuerAsHeader) {
          this._protectedHeader = { ...this._protectedHeader, iss: this._payload.iss };
        }
        if (this._replicateSubjectAsHeader) {
          this._protectedHeader = { ...this._protectedHeader, sub: this._payload.sub };
        }
        if (this._replicateAudienceAsHeader) {
          this._protectedHeader = { ...this._protectedHeader, aud: this._payload.aud };
        }
        enc.setProtectedHeader(this._protectedHeader);
        if (this._iv) {
          enc.setInitializationVector(this._iv);
        }
        if (this._cek) {
          enc.setContentEncryptionKey(this._cek);
        }
        if (this._keyManagementParameters) {
          enc.setKeyManagementParameters(this._keyManagementParameters);
        }
        return enc.encrypt(key, options);
      }
    };
    exports.EncryptJWT = EncryptJWT;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwk/thumbprint.js
var require_thumbprint = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwk/thumbprint.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.calculateJwkThumbprint = calculateJwkThumbprint;
    exports.calculateJwkThumbprintUri = calculateJwkThumbprintUri;
    var digest_js_1 = require_digest();
    var base64url_js_1 = require_base64url();
    var errors_js_1 = require_errors2();
    var buffer_utils_js_1 = require_buffer_utils();
    var is_object_js_1 = require_is_object();
    var check = (value, description) => {
      if (typeof value !== "string" || !value) {
        throw new errors_js_1.JWKInvalid(`${description} missing or invalid`);
      }
    };
    async function calculateJwkThumbprint(jwk, digestAlgorithm) {
      if (!(0, is_object_js_1.default)(jwk)) {
        throw new TypeError("JWK must be an object");
      }
      digestAlgorithm ??= "sha256";
      if (digestAlgorithm !== "sha256" && digestAlgorithm !== "sha384" && digestAlgorithm !== "sha512") {
        throw new TypeError('digestAlgorithm must one of "sha256", "sha384", or "sha512"');
      }
      let components;
      switch (jwk.kty) {
        case "EC":
          check(jwk.crv, '"crv" (Curve) Parameter');
          check(jwk.x, '"x" (X Coordinate) Parameter');
          check(jwk.y, '"y" (Y Coordinate) Parameter');
          components = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
          break;
        case "OKP":
          check(jwk.crv, '"crv" (Subtype of Key Pair) Parameter');
          check(jwk.x, '"x" (Public Key) Parameter');
          components = { crv: jwk.crv, kty: jwk.kty, x: jwk.x };
          break;
        case "RSA":
          check(jwk.e, '"e" (Exponent) Parameter');
          check(jwk.n, '"n" (Modulus) Parameter');
          components = { e: jwk.e, kty: jwk.kty, n: jwk.n };
          break;
        case "oct":
          check(jwk.k, '"k" (Key Value) Parameter');
          components = { k: jwk.k, kty: jwk.kty };
          break;
        default:
          throw new errors_js_1.JOSENotSupported('"kty" (Key Type) Parameter missing or unsupported');
      }
      const data = buffer_utils_js_1.encoder.encode(JSON.stringify(components));
      return (0, base64url_js_1.encode)(await (0, digest_js_1.default)(digestAlgorithm, data));
    }
    async function calculateJwkThumbprintUri(jwk, digestAlgorithm) {
      digestAlgorithm ??= "sha256";
      const thumbprint = await calculateJwkThumbprint(jwk, digestAlgorithm);
      return `urn:ietf:params:oauth:jwk-thumbprint:sha-${digestAlgorithm.slice(-3)}:${thumbprint}`;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwk/embedded.js
var require_embedded = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwk/embedded.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.EmbeddedJWK = EmbeddedJWK;
    var import_js_1 = require_import();
    var is_object_js_1 = require_is_object();
    var errors_js_1 = require_errors2();
    async function EmbeddedJWK(protectedHeader, token) {
      const joseHeader = {
        ...protectedHeader,
        ...token?.header
      };
      if (!(0, is_object_js_1.default)(joseHeader.jwk)) {
        throw new errors_js_1.JWSInvalid('"jwk" (JSON Web Key) Header Parameter must be a JSON object');
      }
      const key = await (0, import_js_1.importJWK)({ ...joseHeader.jwk, ext: true }, joseHeader.alg);
      if (key instanceof Uint8Array || key.type !== "public") {
        throw new errors_js_1.JWSInvalid('"jwk" (JSON Web Key) Header Parameter must be a public key');
      }
      return key;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwks/local.js
var require_local = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwks/local.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createLocalJWKSet = createLocalJWKSet;
    var import_js_1 = require_import();
    var errors_js_1 = require_errors2();
    var is_object_js_1 = require_is_object();
    function getKtyFromAlg(alg) {
      switch (typeof alg === "string" && alg.slice(0, 2)) {
        case "RS":
        case "PS":
          return "RSA";
        case "ES":
          return "EC";
        case "Ed":
          return "OKP";
        default:
          throw new errors_js_1.JOSENotSupported('Unsupported "alg" value for a JSON Web Key Set');
      }
    }
    function isJWKSLike(jwks) {
      return jwks && typeof jwks === "object" && Array.isArray(jwks.keys) && jwks.keys.every(isJWKLike);
    }
    function isJWKLike(key) {
      return (0, is_object_js_1.default)(key);
    }
    function clone(obj) {
      if (typeof structuredClone === "function") {
        return structuredClone(obj);
      }
      return JSON.parse(JSON.stringify(obj));
    }
    var LocalJWKSet = class {
      _jwks;
      _cached = /* @__PURE__ */ new WeakMap();
      constructor(jwks) {
        if (!isJWKSLike(jwks)) {
          throw new errors_js_1.JWKSInvalid("JSON Web Key Set malformed");
        }
        this._jwks = clone(jwks);
      }
      async getKey(protectedHeader, token) {
        const { alg, kid } = { ...protectedHeader, ...token?.header };
        const kty = getKtyFromAlg(alg);
        const candidates = this._jwks.keys.filter((jwk2) => {
          let candidate = kty === jwk2.kty;
          if (candidate && typeof kid === "string") {
            candidate = kid === jwk2.kid;
          }
          if (candidate && typeof jwk2.alg === "string") {
            candidate = alg === jwk2.alg;
          }
          if (candidate && typeof jwk2.use === "string") {
            candidate = jwk2.use === "sig";
          }
          if (candidate && Array.isArray(jwk2.key_ops)) {
            candidate = jwk2.key_ops.includes("verify");
          }
          if (candidate) {
            switch (alg) {
              case "ES256":
                candidate = jwk2.crv === "P-256";
                break;
              case "ES256K":
                candidate = jwk2.crv === "secp256k1";
                break;
              case "ES384":
                candidate = jwk2.crv === "P-384";
                break;
              case "ES512":
                candidate = jwk2.crv === "P-521";
                break;
              case "Ed25519":
                candidate = jwk2.crv === "Ed25519";
                break;
              case "EdDSA":
                candidate = jwk2.crv === "Ed25519" || jwk2.crv === "Ed448";
                break;
            }
          }
          return candidate;
        });
        const { 0: jwk, length } = candidates;
        if (length === 0) {
          throw new errors_js_1.JWKSNoMatchingKey();
        }
        if (length !== 1) {
          const error = new errors_js_1.JWKSMultipleMatchingKeys();
          const { _cached } = this;
          error[Symbol.asyncIterator] = async function* () {
            for (const jwk2 of candidates) {
              try {
                yield await importWithAlgCache(_cached, jwk2, alg);
              } catch {
              }
            }
          };
          throw error;
        }
        return importWithAlgCache(this._cached, jwk, alg);
      }
    };
    async function importWithAlgCache(cache, jwk, alg) {
      const cached = cache.get(jwk) || cache.set(jwk, {}).get(jwk);
      if (cached[alg] === void 0) {
        const key = await (0, import_js_1.importJWK)({ ...jwk, ext: true }, alg);
        if (key instanceof Uint8Array || key.type !== "public") {
          throw new errors_js_1.JWKSInvalid("JSON Web Key Set members must be public keys");
        }
        cached[alg] = key;
      }
      return cached[alg];
    }
    function createLocalJWKSet(jwks) {
      const set = new LocalJWKSet(jwks);
      const localJWKSet = async (protectedHeader, token) => set.getKey(protectedHeader, token);
      Object.defineProperties(localJWKSet, {
        jwks: {
          value: () => clone(set._jwks),
          enumerable: true,
          configurable: false,
          writable: false
        }
      });
      return localJWKSet;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/fetch_jwks.js
var require_fetch_jwks = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/fetch_jwks.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var http2 = __require("node:http");
    var https = __require("node:https");
    var node_events_1 = __require("node:events");
    var errors_js_1 = require_errors2();
    var buffer_utils_js_1 = require_buffer_utils();
    var fetchJwks = async (url, timeout, options) => {
      let get;
      switch (url.protocol) {
        case "https:":
          get = https.get;
          break;
        case "http:":
          get = http2.get;
          break;
        default:
          throw new TypeError("Unsupported URL protocol.");
      }
      const { agent, headers } = options;
      const req = get(url.href, {
        agent,
        timeout,
        headers
      });
      const [response] = await Promise.race([(0, node_events_1.once)(req, "response"), (0, node_events_1.once)(req, "timeout")]);
      if (!response) {
        req.destroy();
        throw new errors_js_1.JWKSTimeout();
      }
      if (response.statusCode !== 200) {
        throw new errors_js_1.JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
      }
      const parts = [];
      for await (const part of response) {
        parts.push(part);
      }
      try {
        return JSON.parse(buffer_utils_js_1.decoder.decode((0, buffer_utils_js_1.concat)(...parts)));
      } catch {
        throw new errors_js_1.JOSEError("Failed to parse the JSON Web Key Set HTTP response as JSON");
      }
    };
    exports.default = fetchJwks;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwks/remote.js
var require_remote = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwks/remote.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.experimental_jwksCache = exports.jwksCache = void 0;
    exports.createRemoteJWKSet = createRemoteJWKSet;
    var fetch_jwks_js_1 = require_fetch_jwks();
    var errors_js_1 = require_errors2();
    var local_js_1 = require_local();
    var is_object_js_1 = require_is_object();
    function isCloudflareWorkers() {
      return typeof WebSocketPair !== "undefined" || typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers" || typeof EdgeRuntime !== "undefined" && EdgeRuntime === "vercel";
    }
    var USER_AGENT;
    if (typeof navigator === "undefined" || !navigator.userAgent?.startsWith?.("Mozilla/5.0 ")) {
      const NAME = "jose";
      const VERSION = "v5.10.0";
      USER_AGENT = `${NAME}/${VERSION}`;
    }
    exports.jwksCache = /* @__PURE__ */ Symbol();
    function isFreshJwksCache(input, cacheMaxAge) {
      if (typeof input !== "object" || input === null) {
        return false;
      }
      if (!("uat" in input) || typeof input.uat !== "number" || Date.now() - input.uat >= cacheMaxAge) {
        return false;
      }
      if (!("jwks" in input) || !(0, is_object_js_1.default)(input.jwks) || !Array.isArray(input.jwks.keys) || !Array.prototype.every.call(input.jwks.keys, is_object_js_1.default)) {
        return false;
      }
      return true;
    }
    var RemoteJWKSet = class {
      _url;
      _timeoutDuration;
      _cooldownDuration;
      _cacheMaxAge;
      _jwksTimestamp;
      _pendingFetch;
      _options;
      _local;
      _cache;
      constructor(url, options) {
        if (!(url instanceof URL)) {
          throw new TypeError("url must be an instance of URL");
        }
        this._url = new URL(url.href);
        this._options = { agent: options?.agent, headers: options?.headers };
        this._timeoutDuration = typeof options?.timeoutDuration === "number" ? options?.timeoutDuration : 5e3;
        this._cooldownDuration = typeof options?.cooldownDuration === "number" ? options?.cooldownDuration : 3e4;
        this._cacheMaxAge = typeof options?.cacheMaxAge === "number" ? options?.cacheMaxAge : 6e5;
        if (options?.[exports.jwksCache] !== void 0) {
          this._cache = options?.[exports.jwksCache];
          if (isFreshJwksCache(options?.[exports.jwksCache], this._cacheMaxAge)) {
            this._jwksTimestamp = this._cache.uat;
            this._local = (0, local_js_1.createLocalJWKSet)(this._cache.jwks);
          }
        }
      }
      coolingDown() {
        return typeof this._jwksTimestamp === "number" ? Date.now() < this._jwksTimestamp + this._cooldownDuration : false;
      }
      fresh() {
        return typeof this._jwksTimestamp === "number" ? Date.now() < this._jwksTimestamp + this._cacheMaxAge : false;
      }
      async getKey(protectedHeader, token) {
        if (!this._local || !this.fresh()) {
          await this.reload();
        }
        try {
          return await this._local(protectedHeader, token);
        } catch (err) {
          if (err instanceof errors_js_1.JWKSNoMatchingKey) {
            if (this.coolingDown() === false) {
              await this.reload();
              return this._local(protectedHeader, token);
            }
          }
          throw err;
        }
      }
      async reload() {
        if (this._pendingFetch && isCloudflareWorkers()) {
          this._pendingFetch = void 0;
        }
        const headers = new Headers(this._options.headers);
        if (USER_AGENT && !headers.has("User-Agent")) {
          headers.set("User-Agent", USER_AGENT);
          this._options.headers = Object.fromEntries(headers.entries());
        }
        this._pendingFetch ||= (0, fetch_jwks_js_1.default)(this._url, this._timeoutDuration, this._options).then((json) => {
          this._local = (0, local_js_1.createLocalJWKSet)(json);
          if (this._cache) {
            this._cache.uat = Date.now();
            this._cache.jwks = json;
          }
          this._jwksTimestamp = Date.now();
          this._pendingFetch = void 0;
        }).catch((err) => {
          this._pendingFetch = void 0;
          throw err;
        });
        await this._pendingFetch;
      }
    };
    function createRemoteJWKSet(url, options) {
      const set = new RemoteJWKSet(url, options);
      const remoteJWKSet = async (protectedHeader, token) => set.getKey(protectedHeader, token);
      Object.defineProperties(remoteJWKSet, {
        coolingDown: {
          get: () => set.coolingDown(),
          enumerable: true,
          configurable: false
        },
        fresh: {
          get: () => set.fresh(),
          enumerable: true,
          configurable: false
        },
        reload: {
          value: () => set.reload(),
          enumerable: true,
          configurable: false,
          writable: false
        },
        reloading: {
          get: () => !!set._pendingFetch,
          enumerable: true,
          configurable: false
        },
        jwks: {
          value: () => set._local?.jwks(),
          enumerable: true,
          configurable: false,
          writable: false
        }
      });
      return remoteJWKSet;
    }
    exports.experimental_jwksCache = exports.jwksCache;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/unsecured.js
var require_unsecured = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/jwt/unsecured.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.UnsecuredJWT = void 0;
    var base64url = require_base64url();
    var buffer_utils_js_1 = require_buffer_utils();
    var errors_js_1 = require_errors2();
    var jwt_claims_set_js_1 = require_jwt_claims_set();
    var produce_js_1 = require_produce();
    var UnsecuredJWT = class extends produce_js_1.ProduceJWT {
      encode() {
        const header = base64url.encode(JSON.stringify({ alg: "none" }));
        const payload = base64url.encode(JSON.stringify(this._payload));
        return `${header}.${payload}.`;
      }
      static decode(jwt, options) {
        if (typeof jwt !== "string") {
          throw new errors_js_1.JWTInvalid("Unsecured JWT must be a string");
        }
        const { 0: encodedHeader, 1: encodedPayload, 2: signature, length } = jwt.split(".");
        if (length !== 3 || signature !== "") {
          throw new errors_js_1.JWTInvalid("Invalid Unsecured JWT");
        }
        let header;
        try {
          header = JSON.parse(buffer_utils_js_1.decoder.decode(base64url.decode(encodedHeader)));
          if (header.alg !== "none")
            throw new Error();
        } catch {
          throw new errors_js_1.JWTInvalid("Invalid Unsecured JWT");
        }
        const payload = (0, jwt_claims_set_js_1.default)(header, base64url.decode(encodedPayload), options);
        return { payload, header };
      }
    };
    exports.UnsecuredJWT = UnsecuredJWT;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/util/base64url.js
var require_base64url2 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/util/base64url.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decode = exports.encode = void 0;
    var base64url = require_base64url();
    exports.encode = base64url.encode;
    exports.decode = base64url.decode;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/util/decode_protected_header.js
var require_decode_protected_header = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/util/decode_protected_header.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decodeProtectedHeader = decodeProtectedHeader;
    var base64url_js_1 = require_base64url2();
    var buffer_utils_js_1 = require_buffer_utils();
    var is_object_js_1 = require_is_object();
    function decodeProtectedHeader(token) {
      let protectedB64u;
      if (typeof token === "string") {
        const parts = token.split(".");
        if (parts.length === 3 || parts.length === 5) {
          ;
          [protectedB64u] = parts;
        }
      } else if (typeof token === "object" && token) {
        if ("protected" in token) {
          protectedB64u = token.protected;
        } else {
          throw new TypeError("Token does not contain a Protected Header");
        }
      }
      try {
        if (typeof protectedB64u !== "string" || !protectedB64u) {
          throw new Error();
        }
        const result = JSON.parse(buffer_utils_js_1.decoder.decode((0, base64url_js_1.decode)(protectedB64u)));
        if (!(0, is_object_js_1.default)(result)) {
          throw new Error();
        }
        return result;
      } catch {
        throw new TypeError("Invalid Token or Protected Header formatting");
      }
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/util/decode_jwt.js
var require_decode_jwt = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/util/decode_jwt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decodeJwt = decodeJwt;
    var base64url_js_1 = require_base64url2();
    var buffer_utils_js_1 = require_buffer_utils();
    var is_object_js_1 = require_is_object();
    var errors_js_1 = require_errors2();
    function decodeJwt(jwt) {
      if (typeof jwt !== "string")
        throw new errors_js_1.JWTInvalid("JWTs must use Compact JWS serialization, JWT must be a string");
      const { 1: payload, length } = jwt.split(".");
      if (length === 5)
        throw new errors_js_1.JWTInvalid("Only JWTs using Compact JWS serialization can be decoded");
      if (length !== 3)
        throw new errors_js_1.JWTInvalid("Invalid JWT");
      if (!payload)
        throw new errors_js_1.JWTInvalid("JWTs must contain a payload");
      let decoded;
      try {
        decoded = (0, base64url_js_1.decode)(payload);
      } catch {
        throw new errors_js_1.JWTInvalid("Failed to base64url decode the payload");
      }
      let result;
      try {
        result = JSON.parse(buffer_utils_js_1.decoder.decode(decoded));
      } catch {
        throw new errors_js_1.JWTInvalid("Failed to parse the decoded payload as JSON");
      }
      if (!(0, is_object_js_1.default)(result))
        throw new errors_js_1.JWTInvalid("Invalid JWT Claims Set");
      return result;
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/generate.js
var require_generate = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/generate.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.generateSecret = generateSecret;
    exports.generateKeyPair = generateKeyPair;
    var node_crypto_1 = __require("node:crypto");
    var node_util_1 = __require("node:util");
    var random_js_1 = require_random();
    var errors_js_1 = require_errors2();
    var generate = (0, node_util_1.promisify)(node_crypto_1.generateKeyPair);
    async function generateSecret(alg, options) {
      let length;
      switch (alg) {
        case "HS256":
        case "HS384":
        case "HS512":
        case "A128CBC-HS256":
        case "A192CBC-HS384":
        case "A256CBC-HS512":
          length = parseInt(alg.slice(-3), 10);
          break;
        case "A128KW":
        case "A192KW":
        case "A256KW":
        case "A128GCMKW":
        case "A192GCMKW":
        case "A256GCMKW":
        case "A128GCM":
        case "A192GCM":
        case "A256GCM":
          length = parseInt(alg.slice(1, 4), 10);
          break;
        default:
          throw new errors_js_1.JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
      return (0, node_crypto_1.createSecretKey)((0, random_js_1.default)(new Uint8Array(length >> 3)));
    }
    async function generateKeyPair(alg, options) {
      switch (alg) {
        case "RS256":
        case "RS384":
        case "RS512":
        case "PS256":
        case "PS384":
        case "PS512":
        case "RSA-OAEP":
        case "RSA-OAEP-256":
        case "RSA-OAEP-384":
        case "RSA-OAEP-512":
        case "RSA1_5": {
          const modulusLength = options?.modulusLength ?? 2048;
          if (typeof modulusLength !== "number" || modulusLength < 2048) {
            throw new errors_js_1.JOSENotSupported("Invalid or unsupported modulusLength option provided, 2048 bits or larger keys must be used");
          }
          const keypair = await generate("rsa", {
            modulusLength,
            publicExponent: 65537
          });
          return keypair;
        }
        case "ES256":
          return generate("ec", { namedCurve: "P-256" });
        case "ES256K":
          return generate("ec", { namedCurve: "secp256k1" });
        case "ES384":
          return generate("ec", { namedCurve: "P-384" });
        case "ES512":
          return generate("ec", { namedCurve: "P-521" });
        case "Ed25519":
          return generate("ed25519");
        case "EdDSA": {
          switch (options?.crv) {
            case void 0:
            case "Ed25519":
              return generate("ed25519");
            case "Ed448":
              return generate("ed448");
            default:
              throw new errors_js_1.JOSENotSupported("Invalid or unsupported crv option provided, supported values are Ed25519 and Ed448");
          }
        }
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW": {
          const crv = options?.crv ?? "P-256";
          switch (crv) {
            case void 0:
            case "P-256":
            case "P-384":
            case "P-521":
              return generate("ec", { namedCurve: crv });
            case "X25519":
              return generate("x25519");
            case "X448":
              return generate("x448");
            default:
              throw new errors_js_1.JOSENotSupported("Invalid or unsupported crv option provided, supported values are P-256, P-384, P-521, X25519, and X448");
          }
        }
        default:
          throw new errors_js_1.JOSENotSupported('Invalid or unsupported JWK "alg" (Algorithm) Parameter value');
      }
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/key/generate_key_pair.js
var require_generate_key_pair = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/key/generate_key_pair.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.generateKeyPair = generateKeyPair;
    var generate_js_1 = require_generate();
    async function generateKeyPair(alg, options) {
      return (0, generate_js_1.generateKeyPair)(alg, options);
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/key/generate_secret.js
var require_generate_secret = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/key/generate_secret.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.generateSecret = generateSecret;
    var generate_js_1 = require_generate();
    async function generateSecret(alg, options) {
      return (0, generate_js_1.generateSecret)(alg, options);
    }
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/runtime.js
var require_runtime = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/runtime/runtime.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = "node:crypto";
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/util/runtime.js
var require_runtime2 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/util/runtime.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var runtime_js_1 = require_runtime();
    exports.default = runtime_js_1.default;
  }
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/index.js
var require_cjs4 = __commonJS({
  "node_modules/@segment/analytics-node/node_modules/jose/dist/node/cjs/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.cryptoRuntime = exports.base64url = exports.generateSecret = exports.generateKeyPair = exports.errors = exports.decodeJwt = exports.decodeProtectedHeader = exports.importJWK = exports.importX509 = exports.importPKCS8 = exports.importSPKI = exports.exportJWK = exports.exportSPKI = exports.exportPKCS8 = exports.UnsecuredJWT = exports.experimental_jwksCache = exports.jwksCache = exports.createRemoteJWKSet = exports.createLocalJWKSet = exports.EmbeddedJWK = exports.calculateJwkThumbprintUri = exports.calculateJwkThumbprint = exports.EncryptJWT = exports.SignJWT = exports.GeneralSign = exports.FlattenedSign = exports.CompactSign = exports.FlattenedEncrypt = exports.CompactEncrypt = exports.jwtDecrypt = exports.jwtVerify = exports.generalVerify = exports.flattenedVerify = exports.compactVerify = exports.GeneralEncrypt = exports.generalDecrypt = exports.flattenedDecrypt = exports.compactDecrypt = void 0;
    var decrypt_js_1 = require_decrypt3();
    Object.defineProperty(exports, "compactDecrypt", { enumerable: true, get: function() {
      return decrypt_js_1.compactDecrypt;
    } });
    var decrypt_js_2 = require_decrypt2();
    Object.defineProperty(exports, "flattenedDecrypt", { enumerable: true, get: function() {
      return decrypt_js_2.flattenedDecrypt;
    } });
    var decrypt_js_3 = require_decrypt4();
    Object.defineProperty(exports, "generalDecrypt", { enumerable: true, get: function() {
      return decrypt_js_3.generalDecrypt;
    } });
    var encrypt_js_1 = require_encrypt3();
    Object.defineProperty(exports, "GeneralEncrypt", { enumerable: true, get: function() {
      return encrypt_js_1.GeneralEncrypt;
    } });
    var verify_js_1 = require_verify3();
    Object.defineProperty(exports, "compactVerify", { enumerable: true, get: function() {
      return verify_js_1.compactVerify;
    } });
    var verify_js_2 = require_verify2();
    Object.defineProperty(exports, "flattenedVerify", { enumerable: true, get: function() {
      return verify_js_2.flattenedVerify;
    } });
    var verify_js_3 = require_verify4();
    Object.defineProperty(exports, "generalVerify", { enumerable: true, get: function() {
      return verify_js_3.generalVerify;
    } });
    var verify_js_4 = require_verify5();
    Object.defineProperty(exports, "jwtVerify", { enumerable: true, get: function() {
      return verify_js_4.jwtVerify;
    } });
    var decrypt_js_4 = require_decrypt5();
    Object.defineProperty(exports, "jwtDecrypt", { enumerable: true, get: function() {
      return decrypt_js_4.jwtDecrypt;
    } });
    var encrypt_js_2 = require_encrypt4();
    Object.defineProperty(exports, "CompactEncrypt", { enumerable: true, get: function() {
      return encrypt_js_2.CompactEncrypt;
    } });
    var encrypt_js_3 = require_encrypt2();
    Object.defineProperty(exports, "FlattenedEncrypt", { enumerable: true, get: function() {
      return encrypt_js_3.FlattenedEncrypt;
    } });
    var sign_js_1 = require_sign3();
    Object.defineProperty(exports, "CompactSign", { enumerable: true, get: function() {
      return sign_js_1.CompactSign;
    } });
    var sign_js_2 = require_sign2();
    Object.defineProperty(exports, "FlattenedSign", { enumerable: true, get: function() {
      return sign_js_2.FlattenedSign;
    } });
    var sign_js_3 = require_sign4();
    Object.defineProperty(exports, "GeneralSign", { enumerable: true, get: function() {
      return sign_js_3.GeneralSign;
    } });
    var sign_js_4 = require_sign5();
    Object.defineProperty(exports, "SignJWT", { enumerable: true, get: function() {
      return sign_js_4.SignJWT;
    } });
    var encrypt_js_4 = require_encrypt5();
    Object.defineProperty(exports, "EncryptJWT", { enumerable: true, get: function() {
      return encrypt_js_4.EncryptJWT;
    } });
    var thumbprint_js_1 = require_thumbprint();
    Object.defineProperty(exports, "calculateJwkThumbprint", { enumerable: true, get: function() {
      return thumbprint_js_1.calculateJwkThumbprint;
    } });
    Object.defineProperty(exports, "calculateJwkThumbprintUri", { enumerable: true, get: function() {
      return thumbprint_js_1.calculateJwkThumbprintUri;
    } });
    var embedded_js_1 = require_embedded();
    Object.defineProperty(exports, "EmbeddedJWK", { enumerable: true, get: function() {
      return embedded_js_1.EmbeddedJWK;
    } });
    var local_js_1 = require_local();
    Object.defineProperty(exports, "createLocalJWKSet", { enumerable: true, get: function() {
      return local_js_1.createLocalJWKSet;
    } });
    var remote_js_1 = require_remote();
    Object.defineProperty(exports, "createRemoteJWKSet", { enumerable: true, get: function() {
      return remote_js_1.createRemoteJWKSet;
    } });
    Object.defineProperty(exports, "jwksCache", { enumerable: true, get: function() {
      return remote_js_1.jwksCache;
    } });
    Object.defineProperty(exports, "experimental_jwksCache", { enumerable: true, get: function() {
      return remote_js_1.experimental_jwksCache;
    } });
    var unsecured_js_1 = require_unsecured();
    Object.defineProperty(exports, "UnsecuredJWT", { enumerable: true, get: function() {
      return unsecured_js_1.UnsecuredJWT;
    } });
    var export_js_1 = require_export();
    Object.defineProperty(exports, "exportPKCS8", { enumerable: true, get: function() {
      return export_js_1.exportPKCS8;
    } });
    Object.defineProperty(exports, "exportSPKI", { enumerable: true, get: function() {
      return export_js_1.exportSPKI;
    } });
    Object.defineProperty(exports, "exportJWK", { enumerable: true, get: function() {
      return export_js_1.exportJWK;
    } });
    var import_js_1 = require_import();
    Object.defineProperty(exports, "importSPKI", { enumerable: true, get: function() {
      return import_js_1.importSPKI;
    } });
    Object.defineProperty(exports, "importPKCS8", { enumerable: true, get: function() {
      return import_js_1.importPKCS8;
    } });
    Object.defineProperty(exports, "importX509", { enumerable: true, get: function() {
      return import_js_1.importX509;
    } });
    Object.defineProperty(exports, "importJWK", { enumerable: true, get: function() {
      return import_js_1.importJWK;
    } });
    var decode_protected_header_js_1 = require_decode_protected_header();
    Object.defineProperty(exports, "decodeProtectedHeader", { enumerable: true, get: function() {
      return decode_protected_header_js_1.decodeProtectedHeader;
    } });
    var decode_jwt_js_1 = require_decode_jwt();
    Object.defineProperty(exports, "decodeJwt", { enumerable: true, get: function() {
      return decode_jwt_js_1.decodeJwt;
    } });
    exports.errors = require_errors2();
    var generate_key_pair_js_1 = require_generate_key_pair();
    Object.defineProperty(exports, "generateKeyPair", { enumerable: true, get: function() {
      return generate_key_pair_js_1.generateKeyPair;
    } });
    var generate_secret_js_1 = require_generate_secret();
    Object.defineProperty(exports, "generateSecret", { enumerable: true, get: function() {
      return generate_secret_js_1.generateSecret;
    } });
    exports.base64url = require_base64url2();
    var runtime_js_1 = require_runtime2();
    Object.defineProperty(exports, "cryptoRuntime", { enumerable: true, get: function() {
      return runtime_js_1.default;
    } });
  }
});

// node_modules/@segment/analytics-node/dist/cjs/lib/token-manager.js
var require_token_manager = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/lib/token-manager.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TokenManager = void 0;
    var uuid_1 = require_uuid();
    var jose_1 = require_cjs4();
    var analytics_core_1 = require_cjs3();
    var analytics_generic_utils_1 = require_cjs2();
    var isAccessToken = (thing) => {
      return Boolean(thing && typeof thing === "object" && "access_token" in thing && "expires_in" in thing && typeof thing.access_token === "string" && typeof thing.expires_in === "number");
    };
    var isValidCustomResponse = (response) => {
      return typeof response.text === "function";
    };
    function convertHeaders(headers) {
      const lowercaseHeaders = {};
      if (!headers)
        return {};
      if (isHeaders(headers)) {
        for (const [name, value] of headers.entries()) {
          lowercaseHeaders[name.toLowerCase()] = value;
        }
        return lowercaseHeaders;
      }
      for (const [name, value] of Object.entries(headers)) {
        lowercaseHeaders[name.toLowerCase()] = value;
      }
      return lowercaseHeaders;
    }
    function isHeaders(thing) {
      if (typeof thing === "object" && thing !== null && "entries" in Object(thing) && typeof Object(thing).entries === "function") {
        return true;
      }
      return false;
    }
    var TokenManager = class {
      alg = "RS256";
      grantType = "client_credentials";
      clientAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
      clientId;
      clientKey;
      keyId;
      scope;
      authServer;
      httpClient;
      maxRetries;
      clockSkewInSeconds = 0;
      accessToken;
      tokenEmitter = new analytics_generic_utils_1.Emitter();
      retryCount;
      pollerTimer;
      constructor(props) {
        this.keyId = props.keyId;
        this.clientId = props.clientId;
        this.clientKey = props.clientKey;
        this.authServer = props.authServer ?? "https://oauth2.segment.io";
        this.scope = props.scope ?? "tracking_api:write";
        this.httpClient = props.httpClient;
        this.maxRetries = props.maxRetries;
        this.tokenEmitter.on("access_token", (event) => {
          if ("token" in event) {
            this.accessToken = event.token;
          }
        });
        this.retryCount = 0;
      }
      stopPoller() {
        clearTimeout(this.pollerTimer);
      }
      async pollerLoop() {
        let timeUntilRefreshInMs = 25;
        let response;
        try {
          response = await this.requestAccessToken();
        } catch (err) {
          return this.handleTransientError({ error: err });
        }
        if (!isValidCustomResponse(response)) {
          return this.handleInvalidCustomResponse();
        }
        const headers = convertHeaders(response.headers);
        if (headers["date"]) {
          this.updateClockSkew(Date.parse(headers["date"]));
        }
        if (response.status === 200) {
          try {
            const body = await response.text();
            const token = JSON.parse(body);
            if (!isAccessToken(token)) {
              throw new Error("Response did not contain a valid access_token and expires_in");
            }
            token.expires_at = Math.round(Date.now() / 1e3) + token.expires_in;
            this.tokenEmitter.emit("access_token", { token });
            this.retryCount = 0;
            timeUntilRefreshInMs = token.expires_in / 2 * 1e3;
            return this.queueNextPoll(timeUntilRefreshInMs);
          } catch (err) {
            return this.handleTransientError({ error: err, forceEmitError: true });
          }
        } else if (response.status === 429) {
          return await this.handleRateLimited(response, headers, timeUntilRefreshInMs);
        } else if ([400, 401, 415].includes(response.status)) {
          return this.handleUnrecoverableErrors(response);
        } else {
          return this.handleTransientError({
            error: new Error(`[${response.status}] ${response.statusText}`)
          });
        }
      }
      handleTransientError({ error, forceEmitError }) {
        this.incrementRetries({ error, forceEmitError });
        if (this.retryCount === 1) {
          this.queueNextPoll(0);
          return;
        }
        const timeUntilRefreshInMs = (0, analytics_core_1.backoff)({
          attempt: Math.max(this.retryCount - 1, 0),
          minTimeout: 100,
          maxTimeout: 60 * 1e3
        });
        this.queueNextPoll(timeUntilRefreshInMs);
      }
      handleInvalidCustomResponse() {
        this.tokenEmitter.emit("access_token", {
          error: new Error("HTTPClient does not implement response.text method")
        });
      }
      async handleRateLimited(response, headers, timeUntilRefreshInMs) {
        this.incrementRetries({
          error: new Error(`[${response.status}] ${response.statusText}`)
        });
        const getRateLimitWaitTime = (headerValue) => {
          const value = parseInt(headerValue, 10);
          if (!isFinite(value))
            return null;
          const clampedSeconds = Math.max(0, Math.min(value, 300));
          return Math.max(0, (clampedSeconds + this.clockSkewInSeconds) * 1e3);
        };
        const retryAfter = headers["retry-after"];
        const maxWaitMs = 5 * 60 * 1e3;
        let waitTimeMs = 5 * 1e3;
        if (retryAfter) {
          const waitTime = getRateLimitWaitTime(retryAfter);
          if (waitTime !== null) {
            waitTimeMs = Math.min(waitTime, maxWaitMs);
          }
        }
        await (0, analytics_core_1.sleep)(waitTimeMs);
        timeUntilRefreshInMs = 0;
        this.queueNextPoll(timeUntilRefreshInMs);
      }
      handleUnrecoverableErrors(response) {
        this.retryCount = 0;
        this.tokenEmitter.emit("access_token", {
          error: new Error(`[${response.status}] ${response.statusText}`)
        });
        this.stopPoller();
      }
      updateClockSkew(dateInMs) {
        this.clockSkewInSeconds = (Date.now() - dateInMs) / 1e3;
      }
      incrementRetries({ error, forceEmitError }) {
        this.retryCount++;
        if (forceEmitError || this.retryCount % this.maxRetries === 0) {
          this.retryCount = 0;
          this.tokenEmitter.emit("access_token", { error });
        }
      }
      queueNextPoll(timeUntilRefreshInMs) {
        this.pollerTimer = setTimeout(() => this.pollerLoop(), timeUntilRefreshInMs);
        if (this.pollerTimer.unref) {
          this.pollerTimer.unref();
        }
      }
      /**
       * Solely responsible for building the HTTP request and calling the token service.
       */
      async requestAccessToken() {
        const ISSUED_AT_BUFFER_IN_SECONDS = 5;
        const MAX_EXPIRY_IN_SECONDS = 60;
        const EXPIRY_IN_SECONDS = MAX_EXPIRY_IN_SECONDS - ISSUED_AT_BUFFER_IN_SECONDS;
        const jti = (0, uuid_1.uuid)();
        const currentUTCInSeconds = Math.round(Date.now() / 1e3) - this.clockSkewInSeconds;
        const jwtBody = {
          iss: this.clientId,
          sub: this.clientId,
          aud: this.authServer,
          iat: currentUTCInSeconds - ISSUED_AT_BUFFER_IN_SECONDS,
          exp: currentUTCInSeconds + EXPIRY_IN_SECONDS,
          jti
        };
        const key = await (0, jose_1.importPKCS8)(this.clientKey, "RS256");
        const signedJwt = await new jose_1.SignJWT(jwtBody).setProtectedHeader({ alg: this.alg, kid: this.keyId, typ: "JWT" }).sign(key);
        const requestBody = `grant_type=${this.grantType}&client_assertion_type=${this.clientAssertionType}&client_assertion=${signedJwt}&scope=${this.scope}`;
        const accessTokenEndpoint = `${this.authServer}/token`;
        const requestOptions = {
          method: "POST",
          url: accessTokenEndpoint,
          body: requestBody,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          httpRequestTimeout: 1e4
        };
        return this.httpClient.makeRequest(requestOptions);
      }
      async getAccessToken() {
        if (this.isValidToken(this.accessToken)) {
          return this.accessToken;
        }
        this.stopPoller();
        this.pollerLoop().catch(() => {
        });
        return new Promise((resolve, reject) => {
          this.tokenEmitter.once("access_token", (event) => {
            if ("token" in event) {
              resolve(event.token);
            } else {
              reject(event.error);
            }
          });
        });
      }
      clearToken() {
        this.accessToken = void 0;
      }
      isValidToken(token) {
        return typeof token !== "undefined" && token !== null && (token.expires_at ?? 0) > Date.now() / 1e3;
      }
    };
    exports.TokenManager = TokenManager;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/lib/base-64-encode.js
var require_base_64_encode = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/lib/base-64-encode.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.b64encode = void 0;
    var buffer_1 = __require("buffer");
    var b64encode = (str) => {
      return buffer_1.Buffer.from(str).toString("base64");
    };
    exports.b64encode = b64encode;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/plugins/segmentio/publisher.js
var require_publisher = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/plugins/segmentio/publisher.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Publisher = void 0;
    var analytics_core_1 = require_cjs3();
    var create_url_1 = require_create_url();
    var analytics_generic_utils_1 = require_cjs2();
    var context_batch_1 = require_context_batch();
    var token_manager_1 = require_token_manager();
    var base_64_encode_1 = require_base_64_encode();
    var MAX_RETRY_AFTER_SECONDS = 300;
    var MAX_RETRY_AFTER_RETRIES = 20;
    function sleep(timeoutInMs, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const timer = setTimeout(resolve, timeoutInMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        }, { once: true });
      });
    }
    function noop() {
    }
    function convertHeaders(headers) {
      const lowercaseHeaders = {};
      if (!headers)
        return lowercaseHeaders;
      if (typeof headers.entries === "function") {
        for (const [name, value] of headers.entries()) {
          lowercaseHeaders[name.toLowerCase()] = String(value);
        }
        return lowercaseHeaders;
      }
      for (const [name, value] of Object.entries(headers)) {
        lowercaseHeaders[name.toLowerCase()] = String(value);
      }
      return lowercaseHeaders;
    }
    function getRetryAfterInSeconds(headers) {
      if (!headers)
        return void 0;
      const lowercaseHeaders = convertHeaders(headers);
      const raw = lowercaseHeaders["retry-after"];
      if (!raw)
        return void 0;
      const seconds = parseInt(raw, 10);
      if (!Number.isFinite(seconds) || seconds < 0) {
        return void 0;
      }
      return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
    }
    var Publisher = class {
      pendingFlushTimeout;
      _batch;
      _flushInterval;
      _flushAt;
      _maxRetries;
      _url;
      _flushPendingItemsCount;
      _httpRequestTimeout;
      _emitter;
      _disable;
      _httpClient;
      _writeKey;
      _basicAuth;
      _tokenManager;
      _maxTotalBackoffDuration;
      _maxRateLimitDuration;
      // Rate-limit state: set when a 429 is received, cleared on success or expiry
      _rateLimitedUntil;
      _rateLimitStartTime;
      _abortController = new AbortController();
      constructor({ host, path, maxRetries, flushAt, flushInterval, writeKey, httpRequestTimeout, httpClient, disable, oauthSettings, maxTotalBackoffDuration, maxRateLimitDuration }, emitter) {
        this._emitter = emitter;
        this._maxRetries = maxRetries;
        this._flushAt = Math.max(flushAt, 1);
        this._flushInterval = flushInterval;
        this._url = (0, create_url_1.tryCreateFormattedUrl)(host ?? "https://api.segment.io", path ?? "/v1/batch");
        this._httpRequestTimeout = httpRequestTimeout ?? 1e4;
        this._disable = Boolean(disable);
        this._httpClient = httpClient;
        this._writeKey = writeKey;
        this._basicAuth = (0, base_64_encode_1.b64encode)(`${writeKey}:`);
        this._maxTotalBackoffDuration = maxTotalBackoffDuration ?? 43200;
        this._maxRateLimitDuration = maxRateLimitDuration ?? 43200;
        if (oauthSettings) {
          this._tokenManager = new token_manager_1.TokenManager({
            ...oauthSettings,
            httpClient: oauthSettings.httpClient ?? httpClient,
            maxRetries: oauthSettings.maxRetries ?? maxRetries
          });
        }
      }
      abort() {
        this._abortController.abort(new Error("Flush timeout"));
        this._abortController = new AbortController();
      }
      createBatch() {
        this.pendingFlushTimeout && clearTimeout(this.pendingFlushTimeout);
        const batch = new context_batch_1.ContextBatch(this._flushAt);
        this._batch = batch;
        this.pendingFlushTimeout = setTimeout(() => {
          if (batch === this._batch) {
            this._batch = void 0;
          }
          this.pendingFlushTimeout = void 0;
          if (batch.length) {
            this.send(batch).catch(noop);
          }
        }, this._flushInterval);
        return batch;
      }
      clearBatch() {
        this.pendingFlushTimeout && clearTimeout(this.pendingFlushTimeout);
        this._batch = void 0;
      }
      flush(pendingItemsCount) {
        if (!pendingItemsCount) {
          if (this._tokenManager) {
            this._tokenManager.stopPoller();
          }
          return;
        }
        this._flushPendingItemsCount = pendingItemsCount;
        if (!this._batch)
          return;
        const isExpectingNoMoreItems = this._batch.length === pendingItemsCount;
        if (isExpectingNoMoreItems) {
          this.send(this._batch).catch(noop).finally(() => {
            if (this._tokenManager) {
              this._tokenManager.stopPoller();
            }
          });
          this.clearBatch();
        }
      }
      /**
       * Enqueues the context for future delivery.
       * @param ctx - Context containing a Segment event.
       * @returns a promise that resolves with the context after the event has been delivered.
       */
      enqueue(ctx) {
        const batch = this._batch ?? this.createBatch();
        const { promise: ctxPromise, resolve } = (0, analytics_generic_utils_1.createDeferred)();
        const pendingItem = {
          context: ctx,
          resolver: resolve
        };
        const addStatus = batch.tryAdd(pendingItem);
        if (addStatus.success) {
          const isExpectingNoMoreItems = batch.length === this._flushPendingItemsCount;
          const isFull = batch.length === this._flushAt;
          if (isFull || isExpectingNoMoreItems) {
            this.send(batch).catch(noop);
            this.clearBatch();
          }
          return ctxPromise;
        }
        if (batch.length) {
          this.send(batch).catch(noop);
          this.clearBatch();
        }
        const fallbackBatch = this.createBatch();
        const fbAddStatus = fallbackBatch.tryAdd(pendingItem);
        if (fbAddStatus.success) {
          const isExpectingNoMoreItems = fallbackBatch.length === this._flushPendingItemsCount;
          if (isExpectingNoMoreItems) {
            this.send(fallbackBatch).catch(noop);
            this.clearBatch();
          }
          return ctxPromise;
        } else {
          ctx.setFailedDelivery({
            reason: new Error(fbAddStatus.message)
          });
          return Promise.resolve(ctx);
        }
      }
      _isRateLimited() {
        if (this._rateLimitedUntil === void 0)
          return false;
        if (this._rateLimitStartTime !== void 0 && Date.now() - this._rateLimitStartTime >= this._maxRateLimitDuration * 1e3) {
          this._rateLimitedUntil = void 0;
          this._rateLimitStartTime = void 0;
          return false;
        }
        if (Date.now() >= this._rateLimitedUntil) {
          this._rateLimitedUntil = void 0;
          return false;
        }
        return true;
      }
      _setRateLimitState(headers) {
        const retryAfterSeconds = getRetryAfterInSeconds(headers);
        if (typeof retryAfterSeconds === "number") {
          this._rateLimitedUntil = Date.now() + Math.max(retryAfterSeconds, 1) * 1e3;
        } else {
          this._rateLimitedUntil = Date.now() + 6e4;
        }
        if (this._rateLimitStartTime === void 0) {
          this._rateLimitStartTime = Date.now();
        }
      }
      _clearRateLimitState() {
        this._rateLimitedUntil = void 0;
        this._rateLimitStartTime = void 0;
      }
      async send(batch) {
        if (this._flushPendingItemsCount) {
          this._flushPendingItemsCount -= batch.length;
        }
        const events = batch.getEvents();
        const maxRetries = this._maxRetries;
        const signal = this._abortController.signal;
        let countedRetries = 0;
        let totalAttempts = 0;
        let firstFailureTime;
        while (true) {
          if (signal.aborted) {
            resolveFailedBatch(batch, signal.reason);
            return;
          }
          const wasRateLimited = this._rateLimitStartTime !== void 0;
          if (this._isRateLimited()) {
            const untilRetryAfter = Math.max(0, (this._rateLimitedUntil ?? Date.now()) - Date.now());
            const untilDurationLimit = this._rateLimitStartTime === void 0 ? untilRetryAfter : Math.max(0, this._maxRateLimitDuration * 1e3 - (Date.now() - this._rateLimitStartTime));
            const waitMs = Math.min(untilRetryAfter, untilDurationLimit);
            try {
              await sleep(waitMs, signal);
            } catch {
              resolveFailedBatch(batch, signal.reason);
              return;
            }
            continue;
          }
          if (wasRateLimited && this._rateLimitStartTime === void 0) {
            resolveFailedBatch(batch, new Error("Rate limit duration exceeded"));
            return;
          }
          let failureReason;
          let shouldRetry2 = false;
          let shouldCountTowardsMaxRetries = true;
          try {
            if (this._disable) {
              return batch.resolveEvents();
            }
            let authString = void 0;
            if (this._tokenManager) {
              const token = await this._tokenManager.getAccessToken();
              if (token && token.access_token) {
                authString = `Bearer ${token.access_token}`;
              }
            }
            totalAttempts++;
            const headers = {
              "Content-Type": "application/json",
              "User-Agent": "analytics-node-next/latest",
              ...totalAttempts > 1 ? { "X-Retry-Count": String(totalAttempts - 1) } : {},
              // Prefer OAuth Bearer token when available; otherwise fall back to Basic auth with write key.
              ...authString ? { Authorization: authString } : { Authorization: `Basic ${this._basicAuth}` }
            };
            const request = {
              url: this._url,
              method: "POST",
              headers,
              body: JSON.stringify({
                batch: events,
                writeKey: this._writeKey,
                sentAt: /* @__PURE__ */ new Date()
              }),
              httpRequestTimeout: this._httpRequestTimeout
            };
            this._emitter.emit("http_request", {
              body: request.body,
              method: request.method,
              url: request.url,
              headers: request.headers
            });
            const response = await this._httpClient.makeRequest(request);
            this._emitter.emit("http_response", {
              status: response.status,
              statusText: response.statusText,
              url: request.url,
              body: request.body,
              headers: convertHeaders(response.headers)
            });
            if (response.status >= 200 && response.status < 400) {
              this._clearRateLimitState();
              batch.resolveEvents();
              return;
            } else if (this._tokenManager && (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 511)) {
              this._tokenManager.clearToken();
            }
            const status = response.status;
            const statusText = response.statusText;
            if (status === 400) {
              resolveFailedBatch(batch, new Error(`[${status}] ${statusText}`));
              return;
            }
            failureReason = new Error(`[${status}] ${statusText}`);
            if (status === 429) {
              const retryAfterSeconds = getRetryAfterInSeconds(response.headers);
              if (typeof retryAfterSeconds === "number") {
                this._setRateLimitState(response.headers);
                shouldRetry2 = true;
                shouldCountTowardsMaxRetries = false;
              } else {
                shouldRetry2 = true;
                shouldCountTowardsMaxRetries = true;
              }
            }
            if (!shouldRetry2) {
              if (status >= 500 && status < 600) {
                if (status === 511 && this._tokenManager) {
                  shouldRetry2 = true;
                } else if (![501, 505, 511].includes(status)) {
                  shouldRetry2 = true;
                }
              } else if (status >= 400 && status < 500) {
                if ([408, 410, 429, 460].includes(status)) {
                  shouldRetry2 = true;
                } else {
                  resolveFailedBatch(batch, failureReason);
                  return;
                }
              } else {
                shouldRetry2 = true;
              }
            }
          } catch (err) {
            failureReason = err;
            shouldRetry2 = true;
          }
          if (!shouldRetry2) {
            resolveFailedBatch(batch, failureReason);
            return;
          }
          if (shouldCountTowardsMaxRetries) {
            if (!firstFailureTime)
              firstFailureTime = Date.now();
            if (Date.now() - firstFailureTime > this._maxTotalBackoffDuration * 1e3) {
              resolveFailedBatch(batch, failureReason);
              return;
            }
          }
          if (shouldCountTowardsMaxRetries) {
            countedRetries++;
            if (countedRetries > maxRetries) {
              resolveFailedBatch(batch, failureReason);
              return;
            }
          }
          if (totalAttempts > maxRetries + MAX_RETRY_AFTER_RETRIES) {
            resolveFailedBatch(batch, failureReason);
            return;
          }
          const delayMs = shouldCountTowardsMaxRetries ? (0, analytics_core_1.backoff)({
            attempt: countedRetries,
            minTimeout: 500,
            maxTimeout: 6e4
          }) : 0;
          try {
            await sleep(delayMs, signal);
          } catch {
            resolveFailedBatch(batch, signal.reason);
            return;
          }
        }
      }
    };
    exports.Publisher = Publisher;
    function resolveFailedBatch(batch, reason) {
      batch.getContexts().forEach((ctx) => ctx.setFailedDelivery({ reason }));
      batch.resolveEvents();
    }
  }
});

// node_modules/@segment/analytics-node/dist/cjs/lib/env.js
var require_env = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/lib/env.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.detectRuntime = void 0;
    var detectRuntime = () => {
      if (typeof process === "object" && process && typeof process.env === "object" && process.env && typeof process.version === "string") {
        return "node";
      }
      if (typeof window === "object") {
        return "browser";
      }
      if (typeof WebSocketPair !== "undefined") {
        return "cloudflare-worker";
      }
      if (typeof EdgeRuntime === "string") {
        return "vercel-edge";
      }
      if (
        // @ts-ignore
        typeof WorkerGlobalScope !== "undefined" && // @ts-ignore
        typeof importScripts === "function"
      ) {
        return "web-worker";
      }
      return "unknown";
    };
    exports.detectRuntime = detectRuntime;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/plugins/segmentio/index.js
var require_segmentio = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/plugins/segmentio/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createConfiguredNodePlugin = exports.createNodePlugin = void 0;
    var publisher_1 = require_publisher();
    var version_1 = require_version();
    var env_1 = require_env();
    function normalizeEvent(ctx) {
      ctx.updateEvent("context.library.name", "@segment/analytics-node");
      ctx.updateEvent("context.library.version", version_1.version);
      const runtime = (0, env_1.detectRuntime)();
      if (runtime === "node") {
        ctx.updateEvent("_metadata.nodeVersion", process.version);
      }
      ctx.updateEvent("_metadata.jsRuntime", runtime);
    }
    function createNodePlugin(publisher) {
      function action(ctx) {
        normalizeEvent(ctx);
        return publisher.enqueue(ctx);
      }
      return {
        name: "Segment.io",
        type: "destination",
        version: "1.0.0",
        isLoaded: () => true,
        load: () => Promise.resolve(),
        alias: action,
        group: action,
        identify: action,
        page: action,
        screen: action,
        track: action
      };
    }
    exports.createNodePlugin = createNodePlugin;
    var createConfiguredNodePlugin = (props, emitter) => {
      const publisher = new publisher_1.Publisher(props, emitter);
      return {
        publisher,
        plugin: createNodePlugin(publisher)
      };
    };
    exports.createConfiguredNodePlugin = createConfiguredNodePlugin;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/lib/get-message-id.js
var require_get_message_id = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/lib/get-message-id.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createMessageId = void 0;
    var uuid_1 = require_uuid();
    var createMessageId = () => {
      return `node-next-${Date.now()}-${(0, uuid_1.uuid)()}`;
    };
    exports.createMessageId = createMessageId;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/app/event-factory.js
var require_event_factory = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/app/event-factory.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NodeEventFactory = void 0;
    var analytics_core_1 = require_cjs3();
    var get_message_id_1 = require_get_message_id();
    var NodeEventFactory = class extends analytics_core_1.CoreEventFactory {
      constructor() {
        super({
          createMessageId: get_message_id_1.createMessageId,
          onFinishedEvent: (event) => {
            (0, analytics_core_1.assertUserIdentity)(event);
          }
        });
      }
    };
    exports.NodeEventFactory = NodeEventFactory;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/app/context.js
var require_context2 = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/app/context.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Context = void 0;
    var analytics_core_1 = require_cjs3();
    var Context = class extends analytics_core_1.CoreContext {
      static system() {
        return new this({ type: "track", event: "system" });
      }
    };
    exports.Context = Context;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/app/dispatch-emit.js
var require_dispatch_emit = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/app/dispatch-emit.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.dispatchAndEmit = void 0;
    var analytics_core_1 = require_cjs3();
    var context_1 = require_context2();
    var normalizeDispatchCb = (cb) => (ctx) => {
      const failedDelivery = ctx.failedDelivery();
      return failedDelivery ? cb(failedDelivery.reason, ctx) : cb(void 0, ctx);
    };
    var dispatchAndEmit = async (event, queue, emitter, callback) => {
      try {
        const context = new context_1.Context(event);
        const ctx = await (0, analytics_core_1.dispatch)(context, queue, emitter, {
          ...callback ? { callback: normalizeDispatchCb(callback) } : {}
        });
        const failedDelivery = ctx.failedDelivery();
        if (failedDelivery) {
          emitter.emit("error", {
            code: "delivery_failure",
            reason: failedDelivery.reason,
            ctx
          });
        } else {
          emitter.emit(event.type, ctx);
        }
      } catch (err) {
        emitter.emit("error", {
          code: "unknown",
          reason: err
        });
      }
    };
    exports.dispatchAndEmit = dispatchAndEmit;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/app/emitter.js
var require_emitter3 = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/app/emitter.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NodeEmitter = void 0;
    var analytics_generic_utils_1 = require_cjs2();
    var NodeEmitter = class extends analytics_generic_utils_1.Emitter {
    };
    exports.NodeEmitter = NodeEmitter;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/app/event-queue.js
var require_event_queue2 = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/app/event-queue.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NodeEventQueue = void 0;
    var analytics_core_1 = require_cjs3();
    var NodePriorityQueue = class extends analytics_core_1.PriorityQueue {
      constructor() {
        super(1, []);
      }
      // do not use an internal "seen" map
      getAttempts(ctx) {
        return ctx.attempts ?? 0;
      }
      updateAttempts(ctx) {
        ctx.attempts = this.getAttempts(ctx) + 1;
        return this.getAttempts(ctx);
      }
    };
    var NodeEventQueue = class extends analytics_core_1.CoreEventQueue {
      constructor() {
        super(new NodePriorityQueue());
      }
    };
    exports.NodeEventQueue = NodeEventQueue;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/lib/abort.js
var require_abort = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/lib/abort.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.abortSignalAfterTimeout = exports.AbortController = exports.AbortSignal = void 0;
    var analytics_generic_utils_1 = require_cjs2();
    var env_1 = require_env();
    var AbortSignal = class {
      onabort = null;
      aborted = false;
      eventEmitter = new analytics_generic_utils_1.Emitter();
      toString() {
        return "[object AbortSignal]";
      }
      get [Symbol.toStringTag]() {
        return "AbortSignal";
      }
      removeEventListener(...args) {
        this.eventEmitter.off(...args);
      }
      addEventListener(...args) {
        this.eventEmitter.on(...args);
      }
      dispatchEvent(type) {
        const event = { type, target: this };
        const handlerName = `on${type}`;
        if (typeof this[handlerName] === "function") {
          ;
          this[handlerName](event);
        }
        this.eventEmitter.emit(type, event);
      }
    };
    exports.AbortSignal = AbortSignal;
    var AbortController2 = class {
      signal = new AbortSignal();
      abort() {
        if (this.signal.aborted)
          return;
        this.signal.aborted = true;
        this.signal.dispatchEvent("abort");
      }
      toString() {
        return "[object AbortController]";
      }
      get [Symbol.toStringTag]() {
        return "AbortController";
      }
    };
    exports.AbortController = AbortController2;
    var abortSignalAfterTimeout = (timeoutMs) => {
      if ((0, env_1.detectRuntime)() === "cloudflare-worker") {
        return [];
      }
      const ac = new (globalThis.AbortController || AbortController2)();
      const timeoutId = setTimeout(() => {
        ac.abort();
      }, timeoutMs);
      timeoutId?.unref?.();
      return [ac.signal, timeoutId];
    };
    exports.abortSignalAfterTimeout = abortSignalAfterTimeout;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/lib/fetch.js
var require_fetch = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/lib/fetch.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fetch = void 0;
    var fetch2 = (...args) => {
      return globalThis.fetch(...args);
    };
    exports.fetch = fetch2;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/lib/http-client.js
var require_http_client = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/lib/http-client.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FetchHTTPClient = void 0;
    var abort_1 = require_abort();
    var fetch_1 = require_fetch();
    var FetchHTTPClient = class {
      _fetch;
      constructor(fetchFn) {
        this._fetch = fetchFn ?? fetch_1.fetch;
      }
      async makeRequest(options) {
        const [signal, timeoutId] = (0, abort_1.abortSignalAfterTimeout)(options.httpRequestTimeout);
        const requestInit = {
          url: options.url,
          method: options.method,
          headers: options.headers,
          body: options.body,
          signal
        };
        return this._fetch(options.url, requestInit).finally(() => clearTimeout(timeoutId));
      }
    };
    exports.FetchHTTPClient = FetchHTTPClient;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/app/analytics-node.js
var require_analytics_node = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/app/analytics-node.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Analytics = void 0;
    var analytics_core_1 = require_cjs3();
    var settings_1 = require_settings();
    var version_1 = require_version();
    var segmentio_1 = require_segmentio();
    var event_factory_1 = require_event_factory();
    var dispatch_emit_1 = require_dispatch_emit();
    var emitter_1 = require_emitter3();
    var context_1 = require_context2();
    var event_queue_1 = require_event_queue2();
    var http_client_1 = require_http_client();
    var Analytics = class extends emitter_1.NodeEmitter {
      _eventFactory;
      _isClosed = false;
      _pendingEvents = 0;
      _closeAndFlushDefaultTimeout;
      _publisher;
      _isFlushing = false;
      _queue;
      ready;
      constructor(settings) {
        super();
        (0, settings_1.validateSettings)(settings);
        this._eventFactory = new event_factory_1.NodeEventFactory();
        this._queue = new event_queue_1.NodeEventQueue();
        const flushInterval = settings.flushInterval ?? 1e4;
        this._closeAndFlushDefaultTimeout = Math.max(6e4, flushInterval) * 1.25;
        const { plugin, publisher } = (0, segmentio_1.createConfiguredNodePlugin)({
          writeKey: settings.writeKey,
          host: settings.host,
          path: settings.path,
          maxRetries: settings.maxRetries ?? 10,
          flushAt: settings.flushAt ?? settings.maxEventsInBatch ?? 15,
          httpRequestTimeout: settings.httpRequestTimeout,
          disable: settings.disable,
          flushInterval,
          httpClient: typeof settings.httpClient === "function" ? new http_client_1.FetchHTTPClient(settings.httpClient) : settings.httpClient ?? new http_client_1.FetchHTTPClient(),
          oauthSettings: settings.oauthSettings,
          maxTotalBackoffDuration: settings.maxTotalBackoffDuration,
          maxRateLimitDuration: settings.maxRateLimitDuration
        }, this);
        this._publisher = publisher;
        this.ready = this.register(plugin).then(() => void 0);
        this.emit("initialize", settings);
        (0, analytics_core_1.bindAll)(this);
      }
      get VERSION() {
        return version_1.version;
      }
      /**
       * Call this method to stop collecting new events and flush all existing events.
       * This method also waits for any event method-specific callbacks to be triggered,
       * and any of their subsequent promises to be resolved/rejected.
       */
      closeAndFlush({ timeout = this._closeAndFlushDefaultTimeout } = {}) {
        return this.flush({ timeout, close: true });
      }
      /**
       * Call this method to flush all existing events..
       * This method also waits for any event method-specific callbacks to be triggered,
       * and any of their subsequent promises to be resolved/rejected.
       */
      async flush({ timeout, close = false } = {}) {
        if (this._isFlushing) {
          console.warn("Overlapping flush calls detected. Please wait for the previous flush to finish before calling .flush again");
          return;
        } else {
          this._isFlushing = true;
        }
        if (close) {
          this._isClosed = true;
        }
        this._publisher.flush(this._pendingEvents);
        const promise = new Promise((resolve) => {
          if (!this._pendingEvents) {
            resolve();
          } else {
            this.once("drained", () => {
              resolve();
            });
          }
        }).finally(() => {
          this._isFlushing = false;
        });
        if (!timeout)
          return promise;
        return (0, analytics_core_1.pTimeout)(promise, timeout).catch(() => {
          this._publisher.abort();
        });
      }
      _dispatch(segmentEvent, callback) {
        if (this._isClosed) {
          this.emit("call_after_close", segmentEvent);
          return void 0;
        }
        this._pendingEvents++;
        (0, dispatch_emit_1.dispatchAndEmit)(segmentEvent, this._queue, this, callback).catch((ctx) => ctx).finally(() => {
          this._pendingEvents--;
          if (!this._pendingEvents) {
            this.emit("drained");
          }
        });
      }
      /**
       * Combines two unassociated user identities.
       * @link https://segment.com/docs/connections/sources/catalog/libraries/server/node/#alias
       */
      alias({ userId, previousId, context, timestamp, integrations, messageId }, callback) {
        const segmentEvent = this._eventFactory.alias(userId, previousId, {
          context,
          integrations,
          timestamp,
          messageId
        });
        this._dispatch(segmentEvent, callback);
      }
      /**
       * Associates an identified user with a collective.
       *  @link https://segment.com/docs/connections/sources/catalog/libraries/server/node/#group
       */
      group({ timestamp, groupId, userId, anonymousId, traits = {}, context, integrations, messageId }, callback) {
        const segmentEvent = this._eventFactory.group(groupId, traits, {
          context,
          anonymousId,
          userId,
          timestamp,
          integrations,
          messageId
        });
        this._dispatch(segmentEvent, callback);
      }
      /**
       * Includes a unique userId and (maybe anonymousId) and any optional traits you know about them.
       * @link https://segment.com/docs/connections/sources/catalog/libraries/server/node/#identify
       */
      identify({ userId, anonymousId, traits = {}, context, timestamp, integrations, messageId }, callback) {
        const segmentEvent = this._eventFactory.identify(userId, traits, {
          context,
          anonymousId,
          userId,
          timestamp,
          integrations,
          messageId
        });
        this._dispatch(segmentEvent, callback);
      }
      /**
       * The page method lets you record page views on your website, along with optional extra information about the page being viewed.
       * @link https://segment.com/docs/connections/sources/catalog/libraries/server/node/#page
       */
      page({ userId, anonymousId, category, name, properties, context, timestamp, integrations, messageId }, callback) {
        const segmentEvent = this._eventFactory.page(category ?? null, name ?? null, properties, { context, anonymousId, userId, timestamp, integrations, messageId });
        this._dispatch(segmentEvent, callback);
      }
      /**
       * Records screen views on your app, along with optional extra information
       * about the screen viewed by the user.
       *
       * TODO: This is not documented on the segment docs ATM (for node).
       */
      screen({ userId, anonymousId, category, name, properties, context, timestamp, integrations, messageId }, callback) {
        const segmentEvent = this._eventFactory.screen(category ?? null, name ?? null, properties, { context, anonymousId, userId, timestamp, integrations, messageId });
        this._dispatch(segmentEvent, callback);
      }
      /**
       * Records actions your users perform.
       * @link https://segment.com/docs/connections/sources/catalog/libraries/server/node/#track
       */
      track({ userId, anonymousId, event, properties, context, timestamp, integrations, messageId }, callback) {
        const segmentEvent = this._eventFactory.track(event, properties, {
          context,
          userId,
          anonymousId,
          timestamp,
          integrations,
          messageId
        });
        this._dispatch(segmentEvent, callback);
      }
      /**
       * Registers one or more plugins to augment Analytics functionality.
       * @param plugins
       */
      register(...plugins) {
        return this._queue.criticalTasks.run(async () => {
          const ctx = context_1.Context.system();
          const registrations = plugins.map((xt) => this._queue.register(ctx, xt, this));
          await Promise.all(registrations);
          this.emit("register", plugins.map((el) => el.name));
        });
      }
      /**
       * Deregisters one or more plugins based on their names.
       * @param pluginNames - The names of one or more plugins to deregister.
       */
      async deregister(...pluginNames) {
        const ctx = context_1.Context.system();
        const deregistrations = pluginNames.map((pl) => {
          const plugin = this._queue.plugins.find((p5) => p5.name === pl);
          if (plugin) {
            return this._queue.deregister(ctx, plugin, this);
          } else {
            ctx.log("warn", `plugin ${pl} not found`);
          }
        });
        await Promise.all(deregistrations);
        this.emit("deregister", pluginNames);
      }
    };
    exports.Analytics = Analytics;
  }
});

// node_modules/@segment/analytics-node/dist/cjs/index.common.js
var require_index_common = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/index.common.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FetchHTTPClient = exports.Context = exports.Analytics = void 0;
    var analytics_node_1 = require_analytics_node();
    Object.defineProperty(exports, "Analytics", { enumerable: true, get: function() {
      return analytics_node_1.Analytics;
    } });
    var context_1 = require_context2();
    Object.defineProperty(exports, "Context", { enumerable: true, get: function() {
      return context_1.Context;
    } });
    var http_client_1 = require_http_client();
    Object.defineProperty(exports, "FetchHTTPClient", { enumerable: true, get: function() {
      return http_client_1.FetchHTTPClient;
    } });
  }
});

// node_modules/@segment/analytics-node/dist/cjs/index.js
var require_cjs5 = __commonJS({
  "node_modules/@segment/analytics-node/dist/cjs/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var tslib_1 = (init_tslib_es6(), __toCommonJS(tslib_es6_exports));
    tslib_1.__exportStar(require_index_common(), exports);
    var index_common_1 = require_index_common();
    exports.default = index_common_1.Analytics;
  }
});

// node_modules/@metamask/agent-sdk/node_modules/@toruslabs/http-helpers/dist/lib.cjs/index.js
var require_lib = __commonJS({
  "node_modules/@metamask/agent-sdk/node_modules/@toruslabs/http-helpers/dist/lib.cjs/index.js"(exports) {
    "use strict";
    var _objectSpread = require_objectSpread2();
    var merge = require_cjs();
    var logLevel = require_loglevel();
    var log = logLevel.getLogger("http-helpers");
    log.setLevel(logLevel.levels.INFO);
    var apiKey = "torus-default";
    var embedHost = "";
    var gatewayAuthHeader = "x-api-key";
    var gatewayEmbedHostHeader = "x-embed-host";
    var sentry = null;
    var tracingOrigins = [];
    var tracingPaths = [];
    function enableSentryTracing(_sentry, _tracingOrigins, _tracingPaths) {
      sentry = _sentry;
      tracingOrigins.push(..._tracingOrigins);
      tracingPaths.push(..._tracingPaths);
    }
    function setEmbedHost(embedHost_) {
      embedHost = embedHost_;
    }
    function clearEmbedHost() {
      embedHost = "";
    }
    function getEmbedHost() {
      return embedHost;
    }
    function setAPIKey(apiKey_) {
      apiKey = apiKey_;
    }
    function clearAPIKey() {
      apiKey = "torus-default";
    }
    function getAPIKey() {
      return apiKey;
    }
    function setLogLevel(level) {
      log.setLevel(level);
    }
    async function fetchAndTrace(url, init) {
      let _url = null;
      try {
        _url = new URL(url);
      } catch {
      }
      if (sentry && _url && (tracingOrigins.includes(_url.origin) || tracingPaths.includes(_url.pathname))) {
        const result = await sentry.startSpan({
          name: url,
          op: "http.client"
        }, async () => {
          const response = await fetch(url, init);
          return response;
        });
        return result;
      }
      return fetch(url, init);
    }
    function getApiKeyHeaders() {
      const headers = {};
      if (apiKey) headers[gatewayAuthHeader] = apiKey;
      if (embedHost) headers[gatewayEmbedHostHeader] = embedHost;
      return headers;
    }
    function debugLogResponse(response) {
      log.info(`Response: ${response.status} ${response.statusText}`);
      log.info(`Url: ${response.url}`);
    }
    function logTracingHeader(response) {
      const tracingHeader = response.headers.get("x-web3-correlation-id");
      if (tracingHeader) log.info(`Request tracing with traceID = ${tracingHeader}`);
    }
    var promiseTimeout = async (ms, promise) => {
      let timeoutFunc = null;
      try {
        const timeout = new Promise((_resolve, reject) => {
          timeoutFunc = setTimeout(() => {
            reject(new Error(`Timed out in ${ms}ms`));
          }, ms);
        });
        const result = await Promise.race([promise, timeout]);
        if (timeoutFunc != null) {
          clearTimeout(timeoutFunc);
        }
        return result;
      } catch (err) {
        if (timeoutFunc != null) {
          clearTimeout(timeoutFunc);
        }
        throw err;
      }
    };
    var get = async (url, options_ = {}, customOptions = {}) => {
      const defaultOptions = {
        mode: "cors",
        headers: {}
      };
      if (customOptions.useAPIKey) {
        defaultOptions.headers = _objectSpread(_objectSpread({}, defaultOptions.headers), getApiKeyHeaders());
      }
      options_.method = "GET";
      const options = merge(defaultOptions, options_);
      const response = await fetchAndTrace(url, options);
      if (response.ok) {
        const responseContentType = response.headers.get("content-type");
        if (responseContentType !== null && responseContentType !== void 0 && responseContentType.includes("application/json")) {
          return response.json();
        }
        return response.text();
      }
      debugLogResponse(response);
      throw response;
    };
    var post = (url, data = {}, options_ = {}, customOptions = {}) => {
      const defaultOptions = {
        mode: "cors",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      };
      if (customOptions.useAPIKey) {
        defaultOptions.headers = _objectSpread(_objectSpread({}, defaultOptions.headers), getApiKeyHeaders());
      }
      options_.method = "POST";
      const options = merge(defaultOptions, options_);
      if (customOptions.isUrlEncodedData) {
        options.body = data;
        if (options.headers["Content-Type"] === "application/json; charset=utf-8") delete options.headers["Content-Type"];
      } else {
        options.body = JSON.stringify(data);
      }
      return promiseTimeout(customOptions.timeout || 6e4, fetchAndTrace(url, options).then((response) => {
        if (customOptions.logTracingHeader) {
          logTracingHeader(response);
        }
        if (response.ok) {
          const responseContentType = response.headers.get("content-type");
          if (responseContentType !== null && responseContentType !== void 0 && responseContentType.includes("application/json")) {
            return response.json();
          }
          return response.text();
        }
        debugLogResponse(response);
        throw response;
      }));
    };
    var patch = async (url, data = {}, options_ = {}, customOptions = {}) => {
      const defaultOptions = {
        mode: "cors",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      };
      if (customOptions.useAPIKey) {
        defaultOptions.headers = _objectSpread(_objectSpread({}, defaultOptions.headers), getApiKeyHeaders());
      }
      options_.method = "PATCH";
      const options = merge(defaultOptions, options_);
      if (customOptions.isUrlEncodedData) {
        options.body = data;
        if (options.headers["Content-Type"] === "application/json; charset=utf-8") delete options.headers["Content-Type"];
      } else {
        options.body = JSON.stringify(data);
      }
      const response = await fetchAndTrace(url, options);
      if (response.ok) {
        const responseContentType = response.headers.get("content-type");
        if (responseContentType !== null && responseContentType !== void 0 && responseContentType.includes("application/json")) {
          return response.json();
        }
        return response.text();
      }
      debugLogResponse(response);
      throw response;
    };
    var put = async (url, data = {}, options_ = {}, customOptions = {}) => {
      const defaultOptions = {
        mode: "cors",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      };
      if (customOptions.useAPIKey) {
        defaultOptions.headers = _objectSpread(_objectSpread({}, defaultOptions.headers), getApiKeyHeaders());
      }
      options_.method = "PUT";
      const options = merge(defaultOptions, options_);
      if (customOptions.isUrlEncodedData) {
        options.body = data;
        if (options.headers["Content-Type"] === "application/json; charset=utf-8") delete options.headers["Content-Type"];
      } else {
        options.body = JSON.stringify(data);
      }
      const response = await fetchAndTrace(url, options);
      if (response.ok) {
        const responseContentType = response.headers.get("content-type");
        if (responseContentType !== null && responseContentType !== void 0 && responseContentType.includes("application/json")) {
          return response.json();
        }
        return response.text();
      }
      debugLogResponse(response);
      throw response;
    };
    var remove = async (url, data = {}, options_ = {}, customOptions = {}) => {
      const defaultOptions = {
        mode: "cors",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      };
      if (customOptions.useAPIKey) {
        defaultOptions.headers = _objectSpread(_objectSpread({}, defaultOptions.headers), getApiKeyHeaders());
      }
      options_.method = "DELETE";
      const options = merge(defaultOptions, options_);
      if (customOptions.isUrlEncodedData) {
        options.body = data;
        if (options.headers["Content-Type"] === "application/json; charset=utf-8") delete options.headers["Content-Type"];
      } else {
        options.body = JSON.stringify(data);
      }
      const response = await fetchAndTrace(url, options);
      if (response.ok) {
        const responseContentType = response.headers.get("content-type");
        if (responseContentType !== null && responseContentType !== void 0 && responseContentType.includes("application/json")) {
          return response.json();
        }
        return response.text();
      }
      debugLogResponse(response);
      throw response;
    };
    var generateJsonRPCObject = (method, parameters) => ({
      jsonrpc: "2.0",
      method,
      id: 10,
      params: parameters
    });
    var promiseRace = (url, options, timeout = 6e4) => Promise.race([get(url, options), new Promise((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error("timed out"));
      }, timeout);
    })]);
    exports.clearAPIKey = clearAPIKey;
    exports.clearEmbedHost = clearEmbedHost;
    exports.enableSentryTracing = enableSentryTracing;
    exports.gatewayAuthHeader = gatewayAuthHeader;
    exports.gatewayEmbedHostHeader = gatewayEmbedHostHeader;
    exports.generateJsonRPCObject = generateJsonRPCObject;
    exports.get = get;
    exports.getAPIKey = getAPIKey;
    exports.getEmbedHost = getEmbedHost;
    exports.patch = patch;
    exports.post = post;
    exports.promiseRace = promiseRace;
    exports.promiseTimeout = promiseTimeout;
    exports.put = put;
    exports.remove = remove;
    exports.setAPIKey = setAPIKey;
    exports.setEmbedHost = setEmbedHost;
    exports.setLogLevel = setLogLevel;
  }
});

// node_modules/@metamask/agent-sdk/dist/lib.esm/sdkVersion-Dh9_pqaQ.js
var e = `6.1.4`;

// node_modules/@metamask/agent-sdk/dist/lib.esm/analytics-C6hqwc-Q.js
var import_analytics_node = __toESM(require_cjs5(), 1);
function i(e4) {
  let t2 = e4.length;
  for (; t2 > 0 && e4[t2 - 1] === `/`; ) --t2;
  return t2 === e4.length ? e4 : e4.slice(0, t2);
}
var a = { AWAITING: s.AWAITING_MFA, DENIED: s.DENIED, EXPIRED: s.EXPIRED };
var o = { AWAITING_MFA: `awaiting_mfa` };
var s2 = /* @__PURE__ */ new Set([s.SIGNING, s.BROADCASTING, s.BROADCASTED, s.CONFIRMED, c.SIGNED]);
function c2(e4) {
  return e4 === a.AWAITING;
}
function l(e4) {
  return e4 === a.DENIED || e4 === a.EXPIRED;
}
function u(e4) {
  return e4 !== void 0 && s2.has(e4);
}
var d = class {
  #e = false;
  #t = false;
  #n = false;
  #r = false;
  #i;
  get entered() {
    return this.#e;
  }
  get outcome() {
    return this.#i;
  }
  observeJobStatus(e4, t2) {
    if (e4) {
      if (c2(e4)) return this.#e = true, this.#t ? void 0 : (this.#t = true, t2(o.AWAITING_MFA));
      if (this.#e && !this.#i) {
        if (l(e4)) return this.#i = `rejected`, this.#r ? void 0 : (this.#r = true, t2(`mfa_rejected`));
        if (u(e4) && (this.#i = `confirmed`, !this.#n)) return this.#n = true, t2(`mfa_confirmed`);
      }
    }
  }
  resolveFinalStatus(e4) {
    return this.#i === `rejected` ? `mfa_rejected` : this.#i === `confirmed` && e4 === `success` ? `mfa_confirmed` : this.#e && !this.#i && e4 === `success` && this.#t ? o.AWAITING_MFA : e4;
  }
};
async function f(e4, t2, n = {}) {
  await E(m.SDK_OPERATION_COMPLETED, { ...n, operation: e4, status: t2 });
}
var p = { SDK_OPERATION_STARTED: `Agentic SDK Operation Started`, SDK_OPERATION_COMPLETED: `Agentic SDK Operation Completed`, METAMASK_HTTP_FETCH_JSON: `metamask_http.fetch_json`, SERVER_WALLET_REQUEST: `server_wallet.request`, SWAP_FETCH_QUOTE: `swap.fetch_quote`, SWAP_EXECUTE_QUOTE: `swap.execute_quote`, SWAP_ERC7821_BATCH_FALLBACK: `swap.erc7821_batch_fallback`, SWAP_GET_STATUS: `swap.get_status`, WALLET_LIST_WALLETS: `wallet.list_wallets`, WALLET_CREATE_WALLET: `wallet.create_wallet`, WALLET_FETCH_REMOTE_WALLETS: `wallet.fetch_remote_wallets`, WALLET_GET_BALANCE: `wallet.get_balance`, WALLET_SIGN_MESSAGE: `wallet.sign_message`, WALLET_SIGN_TYPED_DATA: `wallet.sign_typed_data`, WALLET_SUBMIT_TRANSACTION: `wallet.submit_transaction`, WALLET_TRANSFER: `wallet.transfer`, WALLET_WAIT_FOR_RECEIPT: `wallet.wait_for_receipt`, WALLET_AWAIT_JOB: `wallet.await_job`, WALLET_GET_JOB_STATUS: `wallet.get_job_status`, PERPS_GET_MARKETS: `perps.get_markets`, PERPS_GET_AVAILABLE_DEXS: `perps.get_available_dexs`, PERPS_GET_POSITIONS: `perps.get_positions`, PERPS_GET_OPEN_ORDERS: `perps.get_open_orders`, PERPS_GET_BALANCE: `perps.get_balance`, PERPS_QUOTE: `perps.quote`, PERPS_OPEN: `perps.open`, PERPS_CLOSE: `perps.close`, PERPS_MODIFY: `perps.modify`, PERPS_CANCEL: `perps.cancel`, PERPS_PREPARE_DEPOSIT: `perps.prepare_deposit`, PERPS_DEPOSIT: `perps.deposit`, PERPS_PREPARE_WITHDRAW: `perps.prepare_withdraw`, PERPS_WITHDRAW: `perps.withdraw`, PERPS_PREPARE_TRANSFER_COLLATERAL: `perps.prepare_transfer_collateral`, PERPS_TRANSFER_COLLATERAL: `perps.transfer_collateral`, PERPS_BUILDER_FEE_FALLBACK: `perps.builder_fee_fallback`, PREDICT_MARKETS: `predict.markets`, PREDICT_SEARCH_MARKETS: `predict.search_markets`, PREDICT_MARKET: `predict.market`, PREDICT_SETUP: `predict.setup`, PREDICT_AUTH: `predict.auth`, PREDICT_APPROVE: `predict.approve`, PREDICT_DEPOSIT: `predict.deposit`, PREDICT_WITHDRAW: `predict.withdraw`, PREDICT_QUOTE: `predict.quote`, PREDICT_PLACE: `predict.place`, PREDICT_CANCEL: `predict.cancel`, PREDICT_ORDERS: `predict.orders`, PREDICT_POSITIONS: `predict.positions`, PREDICT_BALANCE: `predict.balance`, PREDICT_WATCH: `predict.watch`, PREDICT_STATUS: `predict.status`, PREDICT_BOOK: `predict.book`, PREDICT_REDEEM_LIST: `predict.redeem_list`, PREDICT_REDEEM: `predict.redeem`, PREDICT_HISTORY: `predict.history`, PREDICT_HISTORY_GET: `predict.history_get`, PREDICT_PORTFOLIO: `predict.portfolio`, PREDICT_EVENTS: `predict.events`, PREDICT_EVENT: `predict.event`, PREDICT_SERIES: `predict.series`, PREDICT_SERIES_GET: `predict.series_get`, PREDICT_TAGS: `predict.tags`, PREDICT_TAG: `predict.tag`, EARN_LIST_VAULTS: `earn.list_vaults`, EARN_GET_VAULT: `earn.get_vault`, EARN_LIST_POSITIONS: `earn.list_positions`, EARN_SUPPLY: `earn.supply`, EARN_WITHDRAW: `earn.withdraw`, CLI_SESSION_STARTED: `CLI Session Started`, CLI_COMMAND_EXECUTED: `CLI Command Executed`, CLI_SESSION_ENDED: `CLI Session Ended`, TRANSACTION_SETTLED: `Transaction Settled` };
var m = p;
var h = { SDK: `agentic_sdk`, CLI: `agentic_cli` };
var g = new Set(`env.sdk_version.category.operation.status.outcome.duration_ms.api_name.http_status.error_code.error_kind.error_location.repeat_index.recovered.recovered_from_error_code.recovery_attempts.tx_hash.quote_id.quote_age_s.settlement_outcome.settlement_source.settlement_latency_ms.session_id.cli_version.os.os_version.arch.node_version.command.command_topic.command_kind.output_format.ui_mode.command_index.flags_used.wallet_mode.trading_mode.auth_method.login_method.authenticated.venue.network.side.order_type.from_chain.to_chain.leverage.dry_run.command_count.command_sequence.reason.trigger.volume_usd`.split(`.`));
var _ = /* @__PURE__ */ new Set([`flags_used`, `command_sequence`]);
var v = class {
  init() {
  }
  identify() {
  }
  track() {
  }
  setGlobalProperties() {
  }
  async flush() {
    return false;
  }
};
var y = false;
var b = new v();
var x2;
var S = class {
  #e;
  #t;
  #n;
  #r;
  #i = {};
  #a = false;
  constructor(e4) {
    this.#e = new import_analytics_node.Analytics({ writeKey: e4.writeKey, host: i(e4.host), flushAt: e4.flushAt, flushInterval: e4.flushIntervalMs, ...e4.fetchImpl ? { httpClient: e4.fetchImpl } : {} }), this.#t = e4.anonymousId, this.#n = e4.now;
  }
  init() {
  }
  identify(e4, t2) {
    let n = e4.trim();
    n && (this.#r = n, this.#a = true, this.#e.identify({ userId: n, anonymousId: this.#t, traits: R(t2), timestamp: new Date(this.#n()), context: this.#o() }));
  }
  track(e4, t2 = {}) {
    let n = P({ ...this.#i, ...t2 });
    this.#a = true, this.#e.track({ event: e4, ...this.#r ? { userId: this.#r } : {}, anonymousId: this.#t, properties: n, timestamp: new Date(this.#n()), context: this.#o() });
  }
  setGlobalProperties(e4) {
    this.#i = { ...this.#i, ...P(e4) };
  }
  async flush(e4) {
    if (!this.#a) return false;
    this.#a = false;
    try {
      let t2 = this.#e.flush(), n = typeof e4 == `number` ? await Promise.race([t2.then(() => true), new Promise((t3) => {
        setTimeout(t3, e4, false);
      })]) : await t2.then(() => true);
      return n || (this.#a = true), n;
    } catch {
      return this.#a = true, false;
    }
  }
  #o() {
    return { library: { name: `@metamask/agent-sdk`, version: e } };
  }
};
function C(t2 = {}) {
  if (y) return b instanceof S;
  x2 = t2;
  let n = t2.envVars ?? N();
  if (M(n)) return b = new v(), y = true, false;
  let r3 = (n.MM_SEGMENT_WRITE_KEY || t2.bundledWriteKey || `BXSMCuLm6uF8FN6Dn93toptUIw80CcTS`).trim();
  return r3 ? (b = new S({ writeKey: r3, host: t2.host ?? n.MM_SEGMENT_HOST ?? `https://api.segment.io`, anonymousId: t2.anonymousId ?? H(), fetchImpl: t2.fetchImpl, flushAt: t2.flushAt ?? 20, flushIntervalMs: t2.flushIntervalMs ?? 5e3, now: t2.now ?? Date.now }), b.init(), b.setGlobalProperties({ ...t2.env ? { env: t2.env } : {}, sdk_version: e, category: h.SDK }), y = true, true) : (b = new v(), y = false, false);
}
function w() {
  b = new v(), y = true;
}
async function T(e4, t2, n = {}, r3 = {}) {
  j();
  let i5 = Date.now();
  await b.track(m.SDK_OPERATION_STARTED, { ...n, operation: e4, status: `started` });
  try {
    let a4 = await t2(), o6 = r3.mfaTracker?.resolveFinalStatus(`success`) ?? `success`;
    return await b.track(m.SDK_OPERATION_COMPLETED, { ...n, ...F(r3.successProperties, a4), operation: e4, status: o6, duration_ms: Date.now() - i5 }), a4;
  } catch (t3) {
    let a4 = r3.mfaTracker?.resolveFinalStatus(`failure`) ?? `failure`;
    throw await b.track(m.SDK_OPERATION_COMPLETED, { ...n, operation: e4, status: a4, duration_ms: Date.now() - i5, ...V(t3) }), t3;
  }
}
function E(e4, t2 = {}) {
  return j(), b.track(e4, t2);
}
function j() {
  y || C(x2);
}
function M(e4) {
  return e4.MM_TELEMETRY_DISABLED === `1` || e4.DO_NOT_TRACK === `1`;
}
function N() {
  return typeof process < `u` ? process.env : {};
}
function P(e4) {
  let t2 = {};
  for (let n of g) {
    let r3 = e4[n];
    if (n === `volume_usd`) {
      L(r3) && (t2.volume_usd = r3);
      continue;
    }
    (z(r3) || _.has(n) && B(r3)) && (t2[n] = r3);
  }
  return t2;
}
function F(e4, t2) {
  if (!e4) return {};
  try {
    return P({ ...e4(t2) ?? {} });
  } catch {
    return {};
  }
}
function I(e4) {
  if (L(e4)) return { volume_usd: e4 };
}
function L(e4) {
  return typeof e4 == `number` && Number.isFinite(e4) && e4 > 0;
}
function R(e4 = {}) {
  let t2 = {};
  for (let [n, r3] of Object.entries(e4)) z(r3) && (t2[n] = r3);
  return t2;
}
function z(e4) {
  return typeof e4 == `string` || typeof e4 == `number` || typeof e4 == `boolean`;
}
function B(e4) {
  return Array.isArray(e4) && e4.every((e5) => typeof e5 == `string`);
}
function V(e4) {
  let t2 = {};
  if (e4 && typeof e4 == `object`) {
    let n = e4;
    typeof n.code == `string` ? t2.error_code = n.code : typeof n.name == `string` && n.name === `AbortError` && (t2.error_code = `ABORTED`), typeof n.status == `number` && (t2.http_status = n.status);
  }
  return t2.error_code ??= `UNKNOWN`, t2;
}
function H() {
  let e4 = globalThis.crypto;
  return e4 && `randomUUID` in e4 && typeof e4.randomUUID == `function` ? e4.randomUUID() : `agentic-sdk-${Math.random().toString(36).slice(2)}`;
}

// node_modules/@metamask/agent-sdk/dist/lib.esm/wallet-Mv--Zc-M.js
var e2 = class extends Error {
  code;
  requestId;
  terminalStatus;
  failureCode;
  constructor(e4, t2, n, r3, i5) {
    super(t2), this.code = e4, n !== void 0 && (this.requestId = n), r3 !== void 0 && (this.terminalStatus = r3), i5 !== void 0 && (this.failureCode = i5), this.name = `WalletRuntimeError`;
  }
};

// node_modules/viem/_esm/utils/getAction.js
function getAction(client, actionFn, name) {
  const action_implicit = client[actionFn.name];
  if (typeof action_implicit === "function")
    return action_implicit;
  const action_explicit = client[name];
  if (typeof action_explicit === "function")
    return action_explicit;
  return (params) => actionFn(client, params);
}

// node_modules/viem/_esm/errors/log.js
var FilterTypeNotSupportedError = class extends BaseError {
  constructor(type) {
    super(`Filter type "${type}" is not supported.`, {
      name: "FilterTypeNotSupportedError"
    });
  }
};

// node_modules/viem/_esm/utils/abi/encodeEventTopics.js
var docsPath = "/docs/contract/encodeEventTopics";
function encodeEventTopics(parameters) {
  const { abi: abi2, eventName, args } = parameters;
  let abiItem = abi2[0];
  if (eventName) {
    const item = getAbiItem({ abi: abi2, name: eventName });
    if (!item)
      throw new AbiEventNotFoundError(eventName, { docsPath });
    abiItem = item;
  }
  if (abiItem.type !== "event")
    throw new AbiEventNotFoundError(void 0, { docsPath });
  let topics = [];
  if (args && "inputs" in abiItem) {
    const indexedInputs = abiItem.inputs?.filter((param) => "indexed" in param && param.indexed);
    const args_ = Array.isArray(args) ? args : Object.values(args).length > 0 ? indexedInputs?.map((x5) => args[x5.name]) ?? [] : [];
    if (args_.length > 0) {
      topics = indexedInputs?.map((param, i5) => {
        if (Array.isArray(args_[i5]))
          return args_[i5].map((_5, j3) => encodeArg({ param, value: args_[i5][j3] }));
        return typeof args_[i5] !== "undefined" && args_[i5] !== null ? encodeArg({ param, value: args_[i5] }) : null;
      }) ?? [];
    }
  }
  if (abiItem.anonymous)
    return topics;
  const definition = formatAbiItem2(abiItem);
  const signature = toEventSelector(definition);
  return [signature, ...topics];
}
function encodeArg({ param, value }) {
  if (param.type === "string" || param.type === "bytes")
    return keccak256(toBytes(value));
  if (param.type === "tuple" || param.type.match(/^(.*)\[(\d+)?\]$/))
    throw new FilterTypeNotSupportedError(param.type);
  return encodeAbiParameters([param], [value]);
}

// node_modules/viem/_esm/utils/filters/createFilterRequestScope.js
function createFilterRequestScope(client, { method }) {
  const requestMap = {};
  if (client.transport.type === "fallback")
    client.transport.onResponse?.(({ method: method_, response: id, status, transport }) => {
      if (status === "success" && method === method_)
        requestMap[id] = transport.request;
    });
  return ((id) => requestMap[id] || client.request);
}

// node_modules/viem/_esm/actions/public/createContractEventFilter.js
async function createContractEventFilter(client, parameters) {
  const { address, abi: abi2, args, eventName, fromBlock, strict, toBlock } = parameters;
  const getRequest = createFilterRequestScope(client, {
    method: "eth_newFilter"
  });
  const topics = eventName ? encodeEventTopics({
    abi: abi2,
    args,
    eventName
  }) : void 0;
  const id = await client.request({
    method: "eth_newFilter",
    params: [
      {
        address,
        fromBlock: typeof fromBlock === "bigint" ? numberToHex(fromBlock) : fromBlock,
        toBlock: typeof toBlock === "bigint" ? numberToHex(toBlock) : toBlock,
        topics
      }
    ]
  });
  return {
    abi: abi2,
    args,
    eventName,
    id,
    request: getRequest(id),
    strict: Boolean(strict),
    type: "event"
  };
}

// node_modules/viem/_esm/utils/errors/getContractError.js
var EXECUTION_REVERTED_ERROR_CODE = 3;
function getContractError(err, { abi: abi2, address, args, docsPath: docsPath3, functionName, sender }) {
  const error = err instanceof RawContractError ? err : err instanceof BaseError ? err.walk((err2) => "data" in err2) || err.walk() : {};
  const { code, data, details, message, shortMessage } = error;
  const cause = (() => {
    if (err instanceof AbiDecodingZeroDataError)
      return new ContractFunctionZeroDataError({ functionName, cause: err });
    if ([EXECUTION_REVERTED_ERROR_CODE, InternalRpcError.code].includes(code) && (data || details || message || shortMessage) || code === InvalidInputRpcError.code && details === "execution reverted" && data) {
      return new ContractFunctionRevertedError({
        abi: abi2,
        data: typeof data === "object" ? data.data : data,
        functionName,
        message: error instanceof RpcRequestError ? details : shortMessage ?? message,
        cause: err
      });
    }
    return err;
  })();
  return new ContractFunctionExecutionError(cause, {
    abi: abi2,
    args,
    contractAddress: address,
    docsPath: docsPath3,
    functionName,
    sender
  });
}

// node_modules/viem/_esm/accounts/utils/publicKeyToAddress.js
function publicKeyToAddress(publicKey) {
  const address = keccak256(`0x${publicKey.substring(4)}`).substring(26);
  return checksumAddress(`0x${address}`);
}

// node_modules/viem/_esm/utils/signature/recoverPublicKey.js
async function recoverPublicKey({ hash: hash2, signature }) {
  const hashHex = isHex(hash2) ? hash2 : toHex(hash2);
  const { secp256k1: secp256k12 } = await import("./secp256k1-JKIM6I6Q.mjs");
  const signature_ = (() => {
    if (typeof signature === "object" && "r" in signature && "s" in signature) {
      const { r: r3, s: s7, v: v4, yParity } = signature;
      const yParityOrV2 = Number(yParity ?? v4);
      const recoveryBit2 = toRecoveryBit(yParityOrV2);
      return new secp256k12.Signature(hexToBigInt(r3), hexToBigInt(s7)).addRecoveryBit(recoveryBit2);
    }
    const signatureHex = isHex(signature) ? signature : toHex(signature);
    if (size(signatureHex) !== 65)
      throw new Error("invalid signature length");
    const yParityOrV = hexToNumber(`0x${signatureHex.slice(130)}`);
    const recoveryBit = toRecoveryBit(yParityOrV);
    return secp256k12.Signature.fromCompact(signatureHex.substring(2, 130)).addRecoveryBit(recoveryBit);
  })();
  const publicKey = signature_.recoverPublicKey(hashHex.substring(2)).toHex(false);
  return `0x${publicKey}`;
}
function toRecoveryBit(yParityOrV) {
  if (yParityOrV === 0 || yParityOrV === 1)
    return yParityOrV;
  if (yParityOrV === 27)
    return 0;
  if (yParityOrV === 28)
    return 1;
  throw new Error("Invalid yParityOrV value");
}

// node_modules/viem/_esm/utils/signature/recoverAddress.js
async function recoverAddress({ hash: hash2, signature }) {
  return publicKeyToAddress(await recoverPublicKey({ hash: hash2, signature }));
}

// node_modules/viem/_esm/utils/encoding/toRlp.js
function toRlp(bytes, to = "hex") {
  const encodable = getEncodable(bytes);
  const cursor = createCursor(new Uint8Array(encodable.length));
  encodable.encode(cursor);
  if (to === "hex")
    return bytesToHex(cursor.bytes);
  return cursor.bytes;
}
function getEncodable(bytes) {
  if (Array.isArray(bytes))
    return getEncodableList(bytes.map((x5) => getEncodable(x5)));
  return getEncodableBytes(bytes);
}
function getEncodableList(list) {
  const bodyLength = list.reduce((acc, x5) => acc + x5.length, 0);
  const sizeOfBodyLength = getSizeOfLength(bodyLength);
  const length = (() => {
    if (bodyLength <= 55)
      return 1 + bodyLength;
    return 1 + sizeOfBodyLength + bodyLength;
  })();
  return {
    length,
    encode(cursor) {
      if (bodyLength <= 55) {
        cursor.pushByte(192 + bodyLength);
      } else {
        cursor.pushByte(192 + 55 + sizeOfBodyLength);
        if (sizeOfBodyLength === 1)
          cursor.pushUint8(bodyLength);
        else if (sizeOfBodyLength === 2)
          cursor.pushUint16(bodyLength);
        else if (sizeOfBodyLength === 3)
          cursor.pushUint24(bodyLength);
        else
          cursor.pushUint32(bodyLength);
      }
      for (const { encode: encode4 } of list) {
        encode4(cursor);
      }
    }
  };
}
function getEncodableBytes(bytesOrHex) {
  const bytes = typeof bytesOrHex === "string" ? hexToBytes(bytesOrHex) : bytesOrHex;
  const sizeOfBytesLength = getSizeOfLength(bytes.length);
  const length = (() => {
    if (bytes.length === 1 && bytes[0] < 128)
      return 1;
    if (bytes.length <= 55)
      return 1 + bytes.length;
    return 1 + sizeOfBytesLength + bytes.length;
  })();
  return {
    length,
    encode(cursor) {
      if (bytes.length === 1 && bytes[0] < 128) {
        cursor.pushBytes(bytes);
      } else if (bytes.length <= 55) {
        cursor.pushByte(128 + bytes.length);
        cursor.pushBytes(bytes);
      } else {
        cursor.pushByte(128 + 55 + sizeOfBytesLength);
        if (sizeOfBytesLength === 1)
          cursor.pushUint8(bytes.length);
        else if (sizeOfBytesLength === 2)
          cursor.pushUint16(bytes.length);
        else if (sizeOfBytesLength === 3)
          cursor.pushUint24(bytes.length);
        else
          cursor.pushUint32(bytes.length);
        cursor.pushBytes(bytes);
      }
    }
  };
}
function getSizeOfLength(length) {
  if (length < 2 ** 8)
    return 1;
  if (length < 2 ** 16)
    return 2;
  if (length < 2 ** 24)
    return 3;
  if (length < 2 ** 32)
    return 4;
  throw new BaseError("Length is too large.");
}

// node_modules/viem/_esm/utils/authorization/hashAuthorization.js
function hashAuthorization(parameters) {
  const { chainId, nonce, to } = parameters;
  const address = parameters.contractAddress ?? parameters.address;
  const hash2 = keccak256(concatHex([
    "0x05",
    toRlp([
      chainId ? numberToHex(chainId) : "0x",
      address,
      nonce ? numberToHex(nonce) : "0x"
    ])
  ]));
  if (to === "bytes")
    return hexToBytes(hash2);
  return hash2;
}

// node_modules/viem/_esm/utils/authorization/recoverAuthorizationAddress.js
async function recoverAuthorizationAddress(parameters) {
  const { authorization, signature } = parameters;
  return recoverAddress({
    hash: hashAuthorization(authorization),
    signature: signature ?? authorization
  });
}

// node_modules/viem/_esm/errors/estimateGas.js
var EstimateGasExecutionError = class extends BaseError {
  constructor(cause, { account, docsPath: docsPath3, chain, data, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value }) {
    const prettyArgs = prettyPrint({
      from: account?.address,
      to,
      value: typeof value !== "undefined" && `${formatEther(value)} ${chain?.nativeCurrency?.symbol || "ETH"}`,
      data,
      gas,
      gasPrice: typeof gasPrice !== "undefined" && `${formatGwei(gasPrice)} gwei`,
      maxFeePerGas: typeof maxFeePerGas !== "undefined" && `${formatGwei(maxFeePerGas)} gwei`,
      maxPriorityFeePerGas: typeof maxPriorityFeePerGas !== "undefined" && `${formatGwei(maxPriorityFeePerGas)} gwei`,
      nonce
    });
    super(cause.shortMessage, {
      cause,
      docsPath: docsPath3,
      metaMessages: [
        ...cause.metaMessages ? [...cause.metaMessages, " "] : [],
        "Estimate Gas Arguments:",
        prettyArgs
      ].filter(Boolean),
      name: "EstimateGasExecutionError"
    });
    Object.defineProperty(this, "cause", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.cause = cause;
  }
};

// node_modules/viem/_esm/utils/errors/getEstimateGasError.js
function getEstimateGasError(err, { docsPath: docsPath3, ...args }) {
  const cause = (() => {
    const cause2 = getNodeError(err, args);
    if (cause2 instanceof UnknownNodeError)
      return err;
    return cause2;
  })();
  return new EstimateGasExecutionError(cause, {
    docsPath: docsPath3,
    ...args
  });
}

// node_modules/viem/_esm/errors/fee.js
var BaseFeeScalarError = class extends BaseError {
  constructor() {
    super("`baseFeeMultiplier` must be greater than 1.", {
      name: "BaseFeeScalarError"
    });
  }
};
var Eip1559FeesNotSupportedError = class extends BaseError {
  constructor() {
    super("Chain does not support EIP-1559 fees.", {
      name: "Eip1559FeesNotSupportedError"
    });
  }
};
var MaxFeePerGasTooLowError = class extends BaseError {
  constructor({ maxPriorityFeePerGas }) {
    super(`\`maxFeePerGas\` cannot be less than the \`maxPriorityFeePerGas\` (${formatGwei(maxPriorityFeePerGas)} gwei).`, { name: "MaxFeePerGasTooLowError" });
  }
};

// node_modules/viem/_esm/errors/block.js
var BlockNotFoundError = class extends BaseError {
  constructor({ blockHash, blockNumber }) {
    let identifier = "Block";
    if (blockHash)
      identifier = `Block at hash "${blockHash}"`;
    if (blockNumber)
      identifier = `Block at number "${blockNumber}"`;
    super(`${identifier} could not be found.`, { name: "BlockNotFoundError" });
  }
};

// node_modules/viem/_esm/utils/formatters/transaction.js
var transactionType = {
  "0x0": "legacy",
  "0x1": "eip2930",
  "0x2": "eip1559",
  "0x3": "eip4844",
  "0x4": "eip7702"
};
function formatTransaction(transaction, _5) {
  const transaction_ = {
    ...transaction,
    blockHash: transaction.blockHash ? transaction.blockHash : null,
    blockNumber: transaction.blockNumber ? BigInt(transaction.blockNumber) : null,
    ...transaction.blockTimestamp != null && {
      blockTimestamp: BigInt(transaction.blockTimestamp)
    },
    chainId: transaction.chainId ? hexToNumber(transaction.chainId) : void 0,
    gas: transaction.gas ? BigInt(transaction.gas) : void 0,
    gasPrice: transaction.gasPrice ? BigInt(transaction.gasPrice) : void 0,
    maxFeePerBlobGas: transaction.maxFeePerBlobGas ? BigInt(transaction.maxFeePerBlobGas) : void 0,
    maxFeePerGas: transaction.maxFeePerGas ? BigInt(transaction.maxFeePerGas) : void 0,
    maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ? BigInt(transaction.maxPriorityFeePerGas) : void 0,
    nonce: transaction.nonce ? hexToNumber(transaction.nonce) : void 0,
    to: transaction.to ? transaction.to : null,
    transactionIndex: transaction.transactionIndex ? Number(transaction.transactionIndex) : null,
    type: transaction.type ? transactionType[transaction.type] : void 0,
    typeHex: transaction.type ? transaction.type : void 0,
    value: transaction.value ? BigInt(transaction.value) : void 0,
    v: transaction.v ? BigInt(transaction.v) : void 0
  };
  if (transaction.authorizationList)
    transaction_.authorizationList = formatAuthorizationList(transaction.authorizationList);
  transaction_.yParity = (() => {
    if (transaction.yParity)
      return Number(transaction.yParity);
    if (typeof transaction_.v === "bigint") {
      if (transaction_.v === 0n || transaction_.v === 27n)
        return 0;
      if (transaction_.v === 1n || transaction_.v === 28n)
        return 1;
      if (transaction_.v >= 35n)
        return transaction_.v % 2n === 0n ? 1 : 0;
    }
    return void 0;
  })();
  if (transaction_.type === "legacy") {
    delete transaction_.accessList;
    delete transaction_.maxFeePerBlobGas;
    delete transaction_.maxFeePerGas;
    delete transaction_.maxPriorityFeePerGas;
    delete transaction_.yParity;
  }
  if (transaction_.type === "eip2930") {
    delete transaction_.maxFeePerBlobGas;
    delete transaction_.maxFeePerGas;
    delete transaction_.maxPriorityFeePerGas;
  }
  if (transaction_.type === "eip1559")
    delete transaction_.maxFeePerBlobGas;
  return transaction_;
}
function formatAuthorizationList(authorizationList) {
  return authorizationList.map((authorization) => ({
    address: authorization.address,
    chainId: Number(authorization.chainId),
    nonce: Number(authorization.nonce),
    r: authorization.r,
    s: authorization.s,
    yParity: Number(authorization.yParity)
  }));
}

// node_modules/viem/_esm/utils/formatters/block.js
function formatBlock(block, _5) {
  const transactions = (block.transactions ?? []).map((transaction) => {
    if (typeof transaction === "string")
      return transaction;
    return formatTransaction(transaction);
  });
  return {
    ...block,
    baseFeePerGas: block.baseFeePerGas ? BigInt(block.baseFeePerGas) : null,
    blobGasUsed: block.blobGasUsed ? BigInt(block.blobGasUsed) : void 0,
    difficulty: block.difficulty ? BigInt(block.difficulty) : void 0,
    excessBlobGas: block.excessBlobGas ? BigInt(block.excessBlobGas) : void 0,
    gasLimit: block.gasLimit ? BigInt(block.gasLimit) : void 0,
    gasUsed: block.gasUsed ? BigInt(block.gasUsed) : void 0,
    hash: block.hash ? block.hash : null,
    logsBloom: block.logsBloom ? block.logsBloom : null,
    nonce: block.nonce ? block.nonce : null,
    number: block.number ? BigInt(block.number) : null,
    size: block.size ? BigInt(block.size) : void 0,
    timestamp: block.timestamp ? BigInt(block.timestamp) : void 0,
    transactions,
    totalDifficulty: block.totalDifficulty ? BigInt(block.totalDifficulty) : null
  };
}

// node_modules/viem/_esm/actions/public/getBlock.js
async function getBlock(client, { blockHash, blockNumber, blockTag = client.experimental_blockTag ?? "latest", includeTransactions: includeTransactions_ } = {}) {
  const includeTransactions = includeTransactions_ ?? false;
  const blockNumberHex = blockNumber !== void 0 ? numberToHex(blockNumber) : void 0;
  let block = null;
  if (blockHash) {
    block = await client.request({
      method: "eth_getBlockByHash",
      params: [blockHash, includeTransactions]
    }, { dedupe: true });
  } else {
    block = await client.request({
      method: "eth_getBlockByNumber",
      params: [blockNumberHex || blockTag, includeTransactions]
    }, { dedupe: Boolean(blockNumberHex) });
  }
  if (!block)
    throw new BlockNotFoundError({ blockHash, blockNumber });
  const format2 = client.chain?.formatters?.block?.format || formatBlock;
  return format2(block, "getBlock");
}

// node_modules/viem/_esm/actions/public/getGasPrice.js
async function getGasPrice(client) {
  const gasPrice = await client.request({
    method: "eth_gasPrice"
  });
  return BigInt(gasPrice);
}

// node_modules/viem/_esm/actions/public/estimateMaxPriorityFeePerGas.js
async function estimateMaxPriorityFeePerGas(client, args) {
  return internal_estimateMaxPriorityFeePerGas(client, args);
}
async function internal_estimateMaxPriorityFeePerGas(client, args) {
  const { block: block_, chain = client.chain, request } = args || {};
  try {
    const maxPriorityFeePerGas = chain?.fees?.maxPriorityFeePerGas ?? chain?.fees?.defaultPriorityFee;
    if (typeof maxPriorityFeePerGas === "function") {
      const block = block_ || await getAction(client, getBlock, "getBlock")({});
      const maxPriorityFeePerGas_ = await maxPriorityFeePerGas({
        block,
        client,
        request
      });
      if (maxPriorityFeePerGas_ === null)
        throw new Error();
      return maxPriorityFeePerGas_;
    }
    if (typeof maxPriorityFeePerGas !== "undefined")
      return maxPriorityFeePerGas;
    const maxPriorityFeePerGasHex = await client.request({
      method: "eth_maxPriorityFeePerGas"
    });
    return hexToBigInt(maxPriorityFeePerGasHex);
  } catch {
    const [block, gasPrice] = await Promise.all([
      block_ ? Promise.resolve(block_) : getAction(client, getBlock, "getBlock")({}),
      getAction(client, getGasPrice, "getGasPrice")({})
    ]);
    if (typeof block.baseFeePerGas !== "bigint")
      throw new Eip1559FeesNotSupportedError();
    const maxPriorityFeePerGas = gasPrice - block.baseFeePerGas;
    if (maxPriorityFeePerGas < 0n)
      return 0n;
    return maxPriorityFeePerGas;
  }
}

// node_modules/viem/_esm/actions/public/estimateFeesPerGas.js
async function estimateFeesPerGas(client, args) {
  return internal_estimateFeesPerGas(client, args);
}
async function internal_estimateFeesPerGas(client, args) {
  const { block: block_, chain = client.chain, request, type = "eip1559" } = args || {};
  const baseFeeMultiplier = await (async () => {
    if (typeof chain?.fees?.baseFeeMultiplier === "function")
      return chain.fees.baseFeeMultiplier({
        block: block_,
        client,
        request
      });
    return chain?.fees?.baseFeeMultiplier ?? 1.2;
  })();
  if (baseFeeMultiplier < 1)
    throw new BaseFeeScalarError();
  const decimals = baseFeeMultiplier.toString().split(".")[1]?.length ?? 0;
  const denominator = 10 ** decimals;
  const multiply = (base) => base * BigInt(Math.round(baseFeeMultiplier * denominator)) / BigInt(denominator);
  const block = block_ ? block_ : await getAction(client, getBlock, "getBlock")({});
  if (typeof chain?.fees?.estimateFeesPerGas === "function") {
    const fees = await chain.fees.estimateFeesPerGas({
      block: block_,
      client,
      multiply,
      request,
      type
    });
    if (fees !== null)
      return fees;
  }
  if (type === "eip1559") {
    if (typeof block.baseFeePerGas !== "bigint")
      throw new Eip1559FeesNotSupportedError();
    const maxPriorityFeePerGas = typeof request?.maxPriorityFeePerGas === "bigint" ? request.maxPriorityFeePerGas : await internal_estimateMaxPriorityFeePerGas(client, {
      block,
      chain,
      request
    });
    const baseFeePerGas = multiply(block.baseFeePerGas);
    const maxFeePerGas = request?.maxFeePerGas ?? baseFeePerGas + maxPriorityFeePerGas;
    return {
      maxFeePerGas,
      maxPriorityFeePerGas
    };
  }
  const gasPrice = request?.gasPrice ?? multiply(await getAction(client, getGasPrice, "getGasPrice")({}));
  return {
    gasPrice
  };
}

// node_modules/viem/_esm/actions/public/getTransactionCount.js
async function getTransactionCount(client, { address, blockHash, blockNumber, blockTag = "latest", requireCanonical }) {
  const block = formatBlockParameter({
    blockHash,
    blockNumber,
    blockTag,
    requireCanonical
  });
  const count = await client.request({
    method: "eth_getTransactionCount",
    params: [address, block]
  }, {
    dedupe: typeof blockNumber === "bigint" || blockHash !== void 0
  });
  return hexToNumber(count);
}

// node_modules/viem/_esm/utils/blob/blobsToCommitments.js
function blobsToCommitments(parameters) {
  const { kzg } = parameters;
  const to = parameters.to ?? (typeof parameters.blobs[0] === "string" ? "hex" : "bytes");
  const blobs = typeof parameters.blobs[0] === "string" ? parameters.blobs.map((x5) => hexToBytes(x5)) : parameters.blobs;
  const commitments = [];
  for (const blob of blobs)
    commitments.push(Uint8Array.from(kzg.blobToKzgCommitment(blob)));
  return to === "bytes" ? commitments : commitments.map((x5) => bytesToHex(x5));
}

// node_modules/viem/_esm/utils/blob/blobsToProofs.js
function blobsToProofs(parameters) {
  const { kzg } = parameters;
  const to = parameters.to ?? (typeof parameters.blobs[0] === "string" ? "hex" : "bytes");
  const blobs = typeof parameters.blobs[0] === "string" ? parameters.blobs.map((x5) => hexToBytes(x5)) : parameters.blobs;
  const commitments = typeof parameters.commitments[0] === "string" ? parameters.commitments.map((x5) => hexToBytes(x5)) : parameters.commitments;
  const proofs = [];
  for (let i5 = 0; i5 < blobs.length; i5++) {
    const blob = blobs[i5];
    const commitment = commitments[i5];
    proofs.push(Uint8Array.from(kzg.computeBlobKzgProof(blob, commitment)));
  }
  return to === "bytes" ? proofs : proofs.map((x5) => bytesToHex(x5));
}

// node_modules/viem/_esm/utils/hash/sha256.js
function sha2562(value, to_) {
  const to = to_ || "hex";
  const bytes = sha256(isHex(value, { strict: false }) ? toBytes(value) : value);
  if (to === "bytes")
    return bytes;
  return toHex(bytes);
}

// node_modules/viem/_esm/utils/blob/commitmentToVersionedHash.js
function commitmentToVersionedHash(parameters) {
  const { commitment, version = 1 } = parameters;
  const to = parameters.to ?? (typeof commitment === "string" ? "hex" : "bytes");
  const versionedHash = sha2562(commitment, "bytes");
  versionedHash.set([version], 0);
  return to === "bytes" ? versionedHash : bytesToHex(versionedHash);
}

// node_modules/viem/_esm/utils/blob/commitmentsToVersionedHashes.js
function commitmentsToVersionedHashes(parameters) {
  const { commitments, version } = parameters;
  const to = parameters.to ?? (typeof commitments[0] === "string" ? "hex" : "bytes");
  const hashes = [];
  for (const commitment of commitments) {
    hashes.push(commitmentToVersionedHash({
      commitment,
      to,
      version
    }));
  }
  return hashes;
}

// node_modules/viem/_esm/constants/blob.js
var blobsPerTransaction = 6;
var bytesPerFieldElement = 32;
var fieldElementsPerBlob = 4096;
var bytesPerBlob = bytesPerFieldElement * fieldElementsPerBlob;
var maxBytesPerTransaction = bytesPerBlob * blobsPerTransaction - // terminator byte (0x80).
1 - // zero byte (0x00) appended to each field element.
1 * fieldElementsPerBlob * blobsPerTransaction;

// node_modules/viem/_esm/errors/blob.js
var BlobSizeTooLargeError = class extends BaseError {
  constructor({ maxSize, size: size5 }) {
    super("Blob size is too large.", {
      metaMessages: [`Max: ${maxSize} bytes`, `Given: ${size5} bytes`],
      name: "BlobSizeTooLargeError"
    });
  }
};
var EmptyBlobError = class extends BaseError {
  constructor() {
    super("Blob data must not be empty.", { name: "EmptyBlobError" });
  }
};

// node_modules/viem/_esm/utils/blob/toBlobs.js
function toBlobs(parameters) {
  const to = parameters.to ?? (typeof parameters.data === "string" ? "hex" : "bytes");
  const data = typeof parameters.data === "string" ? hexToBytes(parameters.data) : parameters.data;
  const size_ = size(data);
  if (!size_)
    throw new EmptyBlobError();
  if (size_ > maxBytesPerTransaction)
    throw new BlobSizeTooLargeError({
      maxSize: maxBytesPerTransaction,
      size: size_
    });
  const blobs = [];
  let active = true;
  let position = 0;
  while (active) {
    const blob = createCursor(new Uint8Array(bytesPerBlob));
    let size5 = 0;
    while (size5 < fieldElementsPerBlob) {
      const bytes = data.slice(position, position + (bytesPerFieldElement - 1));
      blob.pushByte(0);
      blob.pushBytes(bytes);
      if (bytes.length < 31) {
        blob.pushByte(128);
        active = false;
        break;
      }
      size5++;
      position += 31;
    }
    blobs.push(blob);
  }
  return to === "bytes" ? blobs.map((x5) => x5.bytes) : blobs.map((x5) => bytesToHex(x5.bytes));
}

// node_modules/viem/_esm/utils/blob/toBlobSidecars.js
function toBlobSidecars(parameters) {
  const { data, kzg, to } = parameters;
  const blobs = parameters.blobs ?? toBlobs({ data, to });
  const commitments = parameters.commitments ?? blobsToCommitments({ blobs, kzg, to });
  const proofs = parameters.proofs ?? blobsToProofs({ blobs, commitments, kzg, to });
  const sidecars = [];
  for (let i5 = 0; i5 < blobs.length; i5++)
    sidecars.push({
      blob: blobs[i5],
      commitment: commitments[i5],
      proof: proofs[i5]
    });
  return sidecars;
}

// node_modules/viem/_esm/utils/transaction/getTransactionType.js
function getTransactionType(transaction) {
  if (transaction.type)
    return transaction.type;
  if (typeof transaction.authorizationList !== "undefined")
    return "eip7702";
  if (typeof transaction.blobs !== "undefined" || typeof transaction.blobVersionedHashes !== "undefined" || typeof transaction.maxFeePerBlobGas !== "undefined" || typeof transaction.sidecars !== "undefined")
    return "eip4844";
  if (typeof transaction.maxFeePerGas !== "undefined" || typeof transaction.maxPriorityFeePerGas !== "undefined") {
    return "eip1559";
  }
  if (typeof transaction.gasPrice !== "undefined") {
    if (typeof transaction.accessList !== "undefined")
      return "eip2930";
    return "legacy";
  }
  throw new InvalidSerializableTransactionError({ transaction });
}

// node_modules/viem/_esm/utils/errors/getTransactionError.js
function getTransactionError(err, { docsPath: docsPath3, ...args }) {
  const cause = (() => {
    const cause2 = getNodeError(err, args);
    if (cause2 instanceof UnknownNodeError)
      return err;
    return cause2;
  })();
  return new TransactionExecutionError(cause, {
    docsPath: docsPath3,
    ...args
  });
}

// node_modules/viem/_esm/actions/public/getChainId.js
async function getChainId(client) {
  const chainIdHex = await client.request({
    method: "eth_chainId"
  }, { dedupe: true });
  return hexToNumber(chainIdHex);
}

// node_modules/viem/_esm/actions/public/fillTransaction.js
async function fillTransaction(client, parameters) {
  const { account = client.account, accessList, authorizationList, chain = client.chain, blobVersionedHashes, blobs, data, gas, gasPrice, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, nonce: nonce_, nonceManager, to, type, value, ...rest } = parameters;
  const nonce = await (async () => {
    if (!account)
      return nonce_;
    if (!nonceManager)
      return nonce_;
    if (typeof nonce_ !== "undefined")
      return nonce_;
    const account_ = parseAccount(account);
    const chainId = chain ? chain.id : await getAction(client, getChainId, "getChainId")({});
    return await nonceManager.consume({
      address: account_.address,
      chainId,
      client
    });
  })();
  assertRequest(parameters);
  const chainFormat = chain?.formatters?.transactionRequest?.format;
  const format2 = chainFormat || formatTransactionRequest;
  const request = format2({
    // Pick out extra data that might exist on the chain's transaction request type.
    ...extract(rest, { format: chainFormat }),
    account: account ? parseAccount(account) : void 0,
    accessList,
    authorizationList,
    blobs,
    blobVersionedHashes,
    data,
    gas,
    gasPrice,
    maxFeePerBlobGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    nonce,
    to,
    type,
    value
  }, "fillTransaction");
  try {
    const response = await client.request({
      method: "eth_fillTransaction",
      params: [request]
    });
    const format3 = chain?.formatters?.transaction?.format || formatTransaction;
    const transaction = format3(response.tx);
    delete transaction.blockHash;
    delete transaction.blockNumber;
    delete transaction.r;
    delete transaction.s;
    delete transaction.transactionIndex;
    delete transaction.v;
    delete transaction.yParity;
    transaction.data = transaction.input;
    const hasFeePayerSignature = typeof transaction.feePayerSignature !== "undefined" && transaction.feePayerSignature !== null;
    if (hasFeePayerSignature && typeof nonce !== "undefined" && transaction.nonce !== nonce)
      throw new FeePayerNonceMismatchError({
        filledNonce: transaction.nonce,
        requestedNonce: nonce
      });
    if (!hasFeePayerSignature) {
      if (transaction.gas)
        transaction.gas = parameters.gas ?? transaction.gas;
      if (transaction.gasPrice)
        transaction.gasPrice = parameters.gasPrice ?? transaction.gasPrice;
      if (transaction.maxFeePerBlobGas)
        transaction.maxFeePerBlobGas = parameters.maxFeePerBlobGas ?? transaction.maxFeePerBlobGas;
      if (transaction.maxFeePerGas)
        transaction.maxFeePerGas = parameters.maxFeePerGas ?? transaction.maxFeePerGas;
      if (transaction.maxPriorityFeePerGas)
        transaction.maxPriorityFeePerGas = parameters.maxPriorityFeePerGas ?? transaction.maxPriorityFeePerGas;
      if (typeof transaction.nonce !== "undefined")
        transaction.nonce = parameters.nonce ?? transaction.nonce;
      const feeMultiplier = await (async () => {
        if (typeof chain?.fees?.baseFeeMultiplier === "function") {
          const block = await getAction(client, getBlock, "getBlock")({});
          return chain.fees.baseFeeMultiplier({
            block,
            client,
            request: parameters
          });
        }
        return chain?.fees?.baseFeeMultiplier ?? 1.2;
      })();
      if (feeMultiplier < 1)
        throw new BaseFeeScalarError();
      const decimals = feeMultiplier.toString().split(".")[1]?.length ?? 0;
      const denominator = 10 ** decimals;
      const multiplyFee = (base) => base * BigInt(Math.round(feeMultiplier * denominator)) / BigInt(denominator);
      if (transaction.maxFeePerGas && !parameters.maxFeePerGas)
        transaction.maxFeePerGas = multiplyFee(transaction.maxFeePerGas);
      if (transaction.gasPrice && !parameters.gasPrice)
        transaction.gasPrice = multiplyFee(transaction.gasPrice);
    }
    return {
      raw: response.raw,
      transaction: {
        from: request.from,
        ...transaction
      },
      ...response.capabilities ? { capabilities: response.capabilities } : {}
    };
  } catch (err) {
    throw getTransactionError(err, {
      ...parameters,
      chain: client.chain
    });
  }
}

// node_modules/viem/_esm/actions/wallet/prepareTransactionRequest.js
var defaultParameters = [
  "blobVersionedHashes",
  "chainId",
  "fees",
  "gas",
  "nonce",
  "type"
];
var eip1559NetworkCache = /* @__PURE__ */ new Map();
var supportsFillTransaction = /* @__PURE__ */ new LruMap(128);
async function prepareTransactionRequest(client, args) {
  let request = args;
  request.account ??= client.account;
  request.parameters ??= defaultParameters;
  const { account: account_, chain = client.chain, nonceManager, parameters } = request;
  const prepareTransactionRequest2 = (() => {
    if (typeof chain?.prepareTransactionRequest === "function")
      return {
        fn: chain.prepareTransactionRequest,
        runAt: ["beforeFillTransaction"]
      };
    if (Array.isArray(chain?.prepareTransactionRequest))
      return {
        fn: chain.prepareTransactionRequest[0],
        runAt: chain.prepareTransactionRequest[1].runAt
      };
    return void 0;
  })();
  let chainId;
  async function getChainId2() {
    if (chainId)
      return chainId;
    if (typeof request.chainId !== "undefined")
      return request.chainId;
    if (chain)
      return chain.id;
    const chainId_ = await getAction(client, getChainId, "getChainId")({});
    chainId = chainId_;
    return chainId;
  }
  let account = account_ ? parseAccount(account_) : account_;
  let nonce = request.nonce;
  if (prepareTransactionRequest2?.fn && prepareTransactionRequest2.runAt?.includes("beforeFillTransaction")) {
    request = await prepareTransactionRequest2.fn({ ...request, chain }, {
      client,
      phase: "beforeFillTransaction"
    });
    nonce ??= request.nonce;
    const sender = request.account ?? request.from;
    account = sender ? parseAccount(sender) : void 0;
  }
  if (parameters.includes("nonce") && typeof nonce === "undefined" && account && nonceManager) {
    const chainId2 = await getChainId2();
    nonce = await nonceManager.consume({
      address: account.address,
      chainId: chainId2,
      client
    });
  }
  const attemptFill = (() => {
    if ((parameters.includes("blobVersionedHashes") || parameters.includes("sidecars")) && request.kzg && request.blobs)
      return false;
    if (parameters.length > 0 && "feePayer" in request && request.feePayer && !("feePayerSignature" in request && request.feePayerSignature))
      return true;
    if (supportsFillTransaction.get(client.uid) === false)
      return false;
    const shouldAttempt = ["fees", "gas"].some((parameter) => parameters.includes(parameter));
    if (!shouldAttempt)
      return false;
    if (parameters.includes("chainId") && typeof request.chainId !== "number")
      return true;
    if (parameters.includes("nonce") && typeof nonce !== "number")
      return true;
    if (parameters.includes("fees") && typeof request.gasPrice !== "bigint" && (typeof request.maxFeePerGas !== "bigint" || typeof request.maxPriorityFeePerGas !== "bigint"))
      return true;
    if (parameters.includes("gas") && typeof request.gas !== "bigint")
      return true;
    return false;
  })();
  const fillResult = attemptFill ? await getAction(client, fillTransaction, "fillTransaction")({ ...request, nonce }).then((result) => {
    const { chainId: chainId2, from: from15, gas: gas2, gasPrice, nonce: nonce2, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, type: type2, ...rest } = result.transaction;
    const feeToken = "feeToken" in rest ? rest.feeToken : void 0;
    const hasFilledFeePayerSignature = "feePayerSignature" in rest && rest.feePayerSignature !== null && typeof rest.feePayerSignature !== "undefined";
    const shouldUseFilledFeeToken = typeof feeToken !== "undefined" && feeToken !== null && (!("feeToken" in request) || hasFilledFeePayerSignature);
    supportsFillTransaction.set(client.uid, true);
    return {
      ...request,
      ...from15 ? { from: from15 } : {},
      ...type2 && !request.type ? { type: type2 } : {},
      ...typeof chainId2 !== "undefined" ? { chainId: chainId2 } : {},
      ...typeof gas2 !== "undefined" ? { gas: gas2 } : {},
      ...typeof gasPrice !== "undefined" ? { gasPrice } : {},
      ...typeof nonce2 !== "undefined" ? { nonce: nonce2 } : {},
      ...typeof maxFeePerBlobGas !== "undefined" && request.type !== "legacy" && request.type !== "eip2930" ? { maxFeePerBlobGas } : {},
      ...typeof maxFeePerGas !== "undefined" && request.type !== "legacy" && request.type !== "eip2930" ? { maxFeePerGas } : {},
      ...typeof maxPriorityFeePerGas !== "undefined" && request.type !== "legacy" && request.type !== "eip2930" ? { maxPriorityFeePerGas } : {},
      ..."nonceKey" in rest && typeof rest.nonceKey !== "undefined" ? { nonceKey: rest.nonceKey } : {},
      ..."keyAuthorization" in rest && typeof rest.keyAuthorization !== "undefined" && rest.keyAuthorization !== null && !("keyAuthorization" in request) ? { keyAuthorization: rest.keyAuthorization } : {},
      ..."feePayerSignature" in rest && typeof rest.feePayerSignature !== "undefined" && rest.feePayerSignature !== null ? { feePayerSignature: rest.feePayerSignature } : {},
      ...shouldUseFilledFeeToken ? { feeToken } : {},
      ...result.capabilities ? { _capabilities: result.capabilities } : {}
    };
  }).catch((e4) => {
    const error = e4;
    if (error.name !== "TransactionExecutionError")
      return request;
    const nonceMismatch = error.walk?.((error2) => error2 instanceof FeePayerNonceMismatchError);
    if (nonceMismatch)
      throw e4;
    const executionReverted = error.walk?.((e5) => {
      const error2 = e5;
      return error2.name === "ExecutionRevertedError";
    });
    if (executionReverted)
      throw e4;
    const unsupported = error.walk?.((e5) => {
      const error2 = e5;
      return error2.name === "MethodNotFoundRpcError" || error2.name === "MethodNotSupportedRpcError" || error2.message?.includes("eth_fillTransaction is not available");
    });
    if (unsupported)
      supportsFillTransaction.set(client.uid, false);
    return request;
  }) : request;
  nonce ??= fillResult.nonce;
  request = {
    ...fillResult,
    ...account ? { from: account?.address } : {},
    ...typeof nonce !== "undefined" ? { nonce } : {}
  };
  const { blobs, gas, kzg, type } = request;
  if (prepareTransactionRequest2?.fn && prepareTransactionRequest2.runAt?.includes("beforeFillParameters")) {
    request = await prepareTransactionRequest2.fn({ ...request, chain }, {
      client,
      phase: "beforeFillParameters"
    });
  }
  let block;
  async function getBlock2() {
    if (block)
      return block;
    block = await getAction(client, getBlock, "getBlock")({ blockTag: "latest" });
    return block;
  }
  if (parameters.includes("nonce") && typeof nonce === "undefined" && account && !nonceManager)
    request.nonce = await getAction(client, getTransactionCount, "getTransactionCount")({
      address: account.address,
      blockTag: "pending"
    });
  if ((parameters.includes("blobVersionedHashes") || parameters.includes("sidecars")) && blobs && kzg) {
    const commitments = blobsToCommitments({ blobs, kzg });
    if (parameters.includes("blobVersionedHashes")) {
      const versionedHashes = commitmentsToVersionedHashes({
        commitments,
        to: "hex"
      });
      request.blobVersionedHashes = versionedHashes;
    }
    if (parameters.includes("sidecars")) {
      const proofs = blobsToProofs({ blobs, commitments, kzg });
      const sidecars = toBlobSidecars({
        blobs,
        commitments,
        proofs,
        to: "hex"
      });
      request.sidecars = sidecars;
    }
  }
  if (parameters.includes("chainId"))
    request.chainId = await getChainId2();
  if ((parameters.includes("fees") || parameters.includes("type")) && typeof type === "undefined") {
    try {
      request.type = getTransactionType(request);
    } catch {
      let isEip1559Network = eip1559NetworkCache.get(client.uid);
      if (typeof isEip1559Network === "undefined") {
        const block2 = await getBlock2();
        isEip1559Network = typeof block2?.baseFeePerGas === "bigint";
        eip1559NetworkCache.set(client.uid, isEip1559Network);
      }
      request.type = isEip1559Network ? "eip1559" : "legacy";
    }
  }
  if (parameters.includes("fees")) {
    if (request.type !== "legacy" && request.type !== "eip2930") {
      if (typeof request.maxFeePerGas === "undefined" || typeof request.maxPriorityFeePerGas === "undefined") {
        const block2 = await getBlock2();
        const { maxFeePerGas, maxPriorityFeePerGas } = await internal_estimateFeesPerGas(client, {
          block: block2,
          chain,
          request
        });
        if (typeof request.maxPriorityFeePerGas === "undefined" && request.maxFeePerGas && request.maxFeePerGas < maxPriorityFeePerGas)
          throw new MaxFeePerGasTooLowError({
            maxPriorityFeePerGas
          });
        request.maxPriorityFeePerGas = maxPriorityFeePerGas;
        request.maxFeePerGas = maxFeePerGas;
      }
    } else {
      if (typeof request.maxFeePerGas !== "undefined" || typeof request.maxPriorityFeePerGas !== "undefined")
        throw new Eip1559FeesNotSupportedError();
      if (typeof request.gasPrice === "undefined") {
        const block2 = await getBlock2();
        const { gasPrice: gasPrice_ } = await internal_estimateFeesPerGas(client, {
          block: block2,
          chain,
          request,
          type: "legacy"
        });
        request.gasPrice = gasPrice_;
      }
    }
  }
  if (parameters.includes("gas") && typeof gas === "undefined")
    request.gas = await getAction(client, estimateGas, "estimateGas")({
      ...request,
      account,
      prepare: account?.type === "local" ? [] : ["blobVersionedHashes"]
    });
  if (prepareTransactionRequest2?.fn && prepareTransactionRequest2.runAt?.includes("afterFillParameters"))
    request = await prepareTransactionRequest2.fn({ ...request, chain }, {
      client,
      phase: "afterFillParameters"
    });
  assertRequest(request);
  delete request.parameters;
  return request;
}

// node_modules/viem/_esm/actions/public/estimateGas.js
async function estimateGas(client, args) {
  const { account: account_ = client.account, prepare = true } = args;
  const account = account_ ? parseAccount(account_) : void 0;
  const parameters = (() => {
    if (Array.isArray(prepare))
      return prepare;
    if (account?.type !== "local")
      return ["blobVersionedHashes"];
    return void 0;
  })();
  try {
    const to = await (async () => {
      if (args.to)
        return args.to;
      if (args.authorizationList && args.authorizationList.length > 0)
        return await recoverAuthorizationAddress({
          authorization: args.authorizationList[0]
        }).catch(() => {
          throw new BaseError("`to` is required. Could not infer from `authorizationList`");
        });
      return void 0;
    })();
    const { accessList, authorizationList, blobs, blobVersionedHashes, blockNumber, blockTag, data, gas, gasPrice, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, nonce, value, stateOverride, ...rest } = prepare ? await prepareTransactionRequest(client, {
      ...args,
      parameters,
      to
    }) : args;
    if (gas && args.gas !== gas)
      return gas;
    const blockNumberHex = typeof blockNumber === "bigint" ? numberToHex(blockNumber) : void 0;
    const block = blockNumberHex || blockTag;
    const rpcStateOverride = serializeStateOverride(stateOverride);
    assertRequest(args);
    const chainFormat = client.chain?.formatters?.transactionRequest?.format;
    const format2 = chainFormat || formatTransactionRequest;
    const request = format2({
      // Pick out extra data that might exist on the chain's transaction request type.
      ...extract(rest, { format: chainFormat }),
      account,
      accessList,
      authorizationList,
      blobs,
      blobVersionedHashes,
      data,
      gasPrice,
      maxFeePerBlobGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      nonce,
      to,
      value
    }, "estimateGas");
    return BigInt(await client.request({
      method: "eth_estimateGas",
      params: rpcStateOverride ? [
        request,
        block ?? client.experimental_blockTag ?? "latest",
        rpcStateOverride
      ] : block ? [request, block] : [request]
    }));
  } catch (err) {
    throw getEstimateGasError(err, {
      ...args,
      account,
      chain: client.chain
    });
  }
}

// node_modules/viem/_esm/actions/public/estimateContractGas.js
async function estimateContractGas(client, parameters) {
  const { abi: abi2, address, args, functionName, dataSuffix = typeof client.dataSuffix === "string" ? client.dataSuffix : client.dataSuffix?.value, ...request } = parameters;
  const data = encodeFunctionData({
    abi: abi2,
    args,
    functionName
  });
  try {
    const gas = await getAction(client, estimateGas, "estimateGas")({
      data: `${data}${dataSuffix ? dataSuffix.replace("0x", "") : ""}`,
      to: address,
      ...request
    });
    return gas;
  } catch (error) {
    const account = request.account ? parseAccount(request.account) : void 0;
    throw getContractError(error, {
      abi: abi2,
      address,
      args,
      docsPath: "/docs/contract/estimateContractGas",
      functionName,
      sender: account?.address
    });
  }
}

// node_modules/viem/_esm/utils/formatters/log.js
function formatLog(log, { args, eventName } = {}) {
  return {
    ...log,
    blockHash: log.blockHash ? log.blockHash : null,
    blockNumber: log.blockNumber ? BigInt(log.blockNumber) : null,
    blockTimestamp: log.blockTimestamp ? BigInt(log.blockTimestamp) : log.blockTimestamp === null ? null : void 0,
    logIndex: log.logIndex ? Number(log.logIndex) : null,
    transactionHash: log.transactionHash ? log.transactionHash : null,
    transactionIndex: log.transactionIndex ? Number(log.transactionIndex) : null,
    ...eventName ? { args, eventName } : {}
  };
}

// node_modules/viem/_esm/utils/abi/decodeEventLog.js
var docsPath2 = "/docs/contract/decodeEventLog";
function decodeEventLog(parameters) {
  const { abi: abi2, data, strict: strict_, topics } = parameters;
  const strict = strict_ ?? true;
  const [signature, ...argTopics] = topics;
  if (!signature)
    throw new AbiEventSignatureEmptyTopicsError({ docsPath: docsPath2 });
  const abiItem = abi2.find((x5) => x5.type === "event" && signature === toEventSelector(formatAbiItem2(x5)));
  if (!(abiItem && "name" in abiItem) || abiItem.type !== "event")
    throw new AbiEventSignatureNotFoundError(signature, { docsPath: docsPath2 });
  const { name, inputs } = abiItem;
  const isUnnamed = inputs?.some((x5) => !("name" in x5 && x5.name));
  const args = isUnnamed ? [] : {};
  const indexedInputs = inputs.map((x5, i5) => [x5, i5]).filter(([x5]) => "indexed" in x5 && x5.indexed);
  const missingIndexedInputs = [];
  for (let i5 = 0; i5 < indexedInputs.length; i5++) {
    const [param, argIndex] = indexedInputs[i5];
    const topic = argTopics[i5];
    if (!topic) {
      if (strict)
        throw new DecodeLogTopicsMismatch({
          abiItem,
          param
        });
      missingIndexedInputs.push([param, argIndex]);
      continue;
    }
    args[isUnnamed ? argIndex : param.name || argIndex] = decodeTopic({
      param,
      value: topic
    });
  }
  const nonIndexedInputs = inputs.filter((x5) => !("indexed" in x5 && x5.indexed));
  const inputsToDecode = strict ? nonIndexedInputs : [...missingIndexedInputs.map(([param]) => param), ...nonIndexedInputs];
  if (inputsToDecode.length > 0) {
    if (data && data !== "0x") {
      try {
        const decodedData = decodeAbiParameters(inputsToDecode, data);
        if (decodedData) {
          let dataIndex = 0;
          if (!strict) {
            for (const [param, argIndex] of missingIndexedInputs) {
              args[isUnnamed ? argIndex : param.name || argIndex] = decodedData[dataIndex++];
            }
          }
          if (isUnnamed) {
            for (let i5 = 0; i5 < inputs.length; i5++)
              if (args[i5] === void 0 && dataIndex < decodedData.length)
                args[i5] = decodedData[dataIndex++];
          } else
            for (let i5 = 0; i5 < nonIndexedInputs.length; i5++)
              args[nonIndexedInputs[i5].name] = decodedData[dataIndex++];
        }
      } catch (err) {
        if (strict) {
          if (err instanceof AbiDecodingDataSizeTooSmallError || err instanceof PositionOutOfBoundsError)
            throw new DecodeLogDataMismatch({
              abiItem,
              data,
              params: inputsToDecode,
              size: size(data)
            });
          throw err;
        }
      }
    } else if (strict) {
      throw new DecodeLogDataMismatch({
        abiItem,
        data: "0x",
        params: inputsToDecode,
        size: 0
      });
    }
  }
  return {
    eventName: name,
    args: Object.values(args).length > 0 ? args : void 0
  };
}
function decodeTopic({ param, value }) {
  if (param.type === "string" || param.type === "bytes" || param.type === "tuple" || param.type.match(/^(.*)\[(\d+)?\]$/))
    return value;
  const decodedArg = decodeAbiParameters([param], value) || [];
  return decodedArg[0];
}

// node_modules/viem/_esm/utils/abi/parseEventLogs.js
function parseEventLogs(parameters) {
  const { abi: abi2, args, logs, strict = true } = parameters;
  const eventName = (() => {
    if (!parameters.eventName)
      return void 0;
    if (Array.isArray(parameters.eventName))
      return parameters.eventName;
    return [parameters.eventName];
  })();
  const abiTopics = abi2.filter((abiItem) => abiItem.type === "event").map((abiItem) => ({
    abi: abiItem,
    selector: toEventSelector(abiItem)
  }));
  return logs.map((log) => {
    const formattedLog = typeof log.blockNumber === "string" ? formatLog(log) : log;
    const abiItems = abiTopics.filter((abiTopic) => formattedLog.topics[0] === abiTopic.selector);
    if (abiItems.length === 0)
      return null;
    let event;
    let abiItem;
    for (const item of abiItems) {
      try {
        event = decodeEventLog({
          ...formattedLog,
          abi: [item.abi],
          strict: true
        });
        abiItem = item;
        break;
      } catch {
      }
    }
    if (!event && !strict) {
      abiItem = abiItems[0];
      try {
        event = decodeEventLog({
          data: formattedLog.data,
          topics: formattedLog.topics,
          abi: [abiItem.abi],
          strict: false
        });
      } catch {
        const isUnnamed = abiItem.abi.inputs?.some((x5) => !("name" in x5 && x5.name));
        return {
          ...formattedLog,
          args: isUnnamed ? [] : {},
          eventName: abiItem.abi.name
        };
      }
    }
    if (!event || !abiItem)
      return null;
    if (eventName && !eventName.includes(event.eventName))
      return null;
    if (!includesArgs({
      args: event.args,
      inputs: abiItem.abi.inputs,
      matchArgs: args
    }))
      return null;
    return { ...event, ...formattedLog };
  }).filter(Boolean);
}
function includesArgs(parameters) {
  const { args, inputs, matchArgs } = parameters;
  if (!matchArgs)
    return true;
  if (!args)
    return false;
  function isEqual2(input, value, arg) {
    try {
      if (input.type === "address")
        return isAddressEqual(value, arg);
      if (input.type === "string" || input.type === "bytes")
        return keccak256(toBytes(value)) === arg;
      return value === arg;
    } catch {
      return false;
    }
  }
  if (Array.isArray(args) && Array.isArray(matchArgs)) {
    return matchArgs.every((value, index2) => {
      if (value === null || value === void 0)
        return true;
      const input = inputs[index2];
      if (!input)
        return false;
      const value_ = Array.isArray(value) ? value : [value];
      return value_.some((value2) => isEqual2(input, value2, args[index2]));
    });
  }
  if (typeof args === "object" && !Array.isArray(args) && typeof matchArgs === "object" && !Array.isArray(matchArgs))
    return Object.entries(matchArgs).every(([key, value]) => {
      if (value === null || value === void 0)
        return true;
      const input = inputs.find((input2) => input2.name === key);
      if (!input)
        return false;
      const value_ = Array.isArray(value) ? value : [value];
      return value_.some((value2) => isEqual2(input, value2, args[key]));
    });
  return false;
}

// node_modules/viem/_esm/actions/public/getLogs.js
async function getLogs(client, { address, blockHash, fromBlock, toBlock, event, events: events_, args, strict: strict_ } = {}) {
  const strict = strict_ ?? false;
  const events = events_ ?? (event ? [event] : void 0);
  let topics = [];
  if (events) {
    const encoded = events.flatMap((event2) => encodeEventTopics({
      abi: [event2],
      eventName: event2.name,
      args: events_ ? void 0 : args
    }));
    topics = [encoded];
    if (event)
      topics = topics[0];
  }
  let logs;
  if (blockHash) {
    logs = await client.request({
      method: "eth_getLogs",
      params: [{ address, topics, blockHash }]
    });
  } else {
    logs = await client.request({
      method: "eth_getLogs",
      params: [
        {
          address,
          topics,
          fromBlock: typeof fromBlock === "bigint" ? numberToHex(fromBlock) : fromBlock,
          toBlock: typeof toBlock === "bigint" ? numberToHex(toBlock) : toBlock
        }
      ]
    });
  }
  const formattedLogs = logs.map((log) => formatLog(log));
  if (!events)
    return formattedLogs;
  return parseEventLogs({
    abi: events,
    args,
    logs: formattedLogs,
    strict
  });
}

// node_modules/viem/_esm/actions/public/getContractEvents.js
async function getContractEvents(client, parameters) {
  const { abi: abi2, address, args, blockHash, eventName, fromBlock, toBlock, strict } = parameters;
  const event = eventName ? getAbiItem({ abi: abi2, name: eventName }) : void 0;
  const events = !event ? abi2.filter((x5) => x5.type === "event") : void 0;
  return getAction(client, getLogs, "getLogs")({
    address,
    args,
    blockHash,
    event,
    events,
    fromBlock,
    toBlock,
    strict
  });
}

// node_modules/viem/_esm/actions/public/readContract.js
async function readContract(client, parameters) {
  const { abi: abi2, address, args, functionName, ...rest } = parameters;
  const calldata = encodeFunctionData({
    abi: abi2,
    args,
    functionName
  });
  try {
    const { data } = await getAction(client, call, "call")({
      ...rest,
      data: calldata,
      to: address
    });
    return decodeFunctionResult({
      abi: abi2,
      args,
      functionName,
      data: data || "0x"
    });
  } catch (error) {
    throw getContractError(error, {
      abi: abi2,
      address,
      args,
      docsPath: "/docs/contract/readContract",
      functionName
    });
  }
}

// node_modules/viem/_esm/actions/public/simulateContract.js
async function simulateContract(client, parameters) {
  const { abi: abi2, address, args, functionName, dataSuffix = typeof client.dataSuffix === "string" ? client.dataSuffix : client.dataSuffix?.value, ...callRequest } = parameters;
  const account = callRequest.account ? parseAccount(callRequest.account) : client.account;
  const calldata = encodeFunctionData({ abi: abi2, args, functionName });
  try {
    const { data } = await getAction(client, call, "call")({
      batch: false,
      data: `${calldata}${dataSuffix ? dataSuffix.replace("0x", "") : ""}`,
      to: address,
      ...callRequest,
      account
    });
    const result = decodeFunctionResult({
      abi: abi2,
      args,
      functionName,
      data: data || "0x"
    });
    const minimizedAbi = abi2.filter((abiItem) => "name" in abiItem && abiItem.name === parameters.functionName);
    return {
      result,
      request: {
        abi: minimizedAbi,
        address,
        args,
        dataSuffix,
        functionName,
        ...callRequest,
        account
      }
    };
  } catch (error) {
    throw getContractError(error, {
      abi: abi2,
      address,
      args,
      docsPath: "/docs/contract/simulateContract",
      functionName,
      sender: account?.address
    });
  }
}

// node_modules/viem/_esm/utils/observe.js
var listenersCache = /* @__PURE__ */ new Map();
var cleanupCache = /* @__PURE__ */ new Map();
var callbackCount = 0;
function observe(observerId, callbacks, fn) {
  const callbackId = ++callbackCount;
  const getListeners = () => listenersCache.get(observerId) || [];
  const unsubscribe = () => {
    const listeners2 = getListeners();
    const nextListeners = listeners2.filter((cb) => cb.id !== callbackId);
    if (nextListeners.length === 0) {
      listenersCache.delete(observerId);
      cleanupCache.delete(observerId);
      return;
    }
    listenersCache.set(observerId, nextListeners);
  };
  const unwatch = () => {
    const listeners2 = getListeners();
    if (!listeners2.some((cb) => cb.id === callbackId))
      return;
    const cleanup2 = cleanupCache.get(observerId);
    if (listeners2.length === 1 && cleanup2) {
      const p5 = cleanup2();
      if (p5 instanceof Promise)
        p5.catch(() => {
        });
    }
    unsubscribe();
  };
  const listeners = getListeners();
  listenersCache.set(observerId, [
    ...listeners,
    { id: callbackId, fns: callbacks }
  ]);
  if (listeners && listeners.length > 0)
    return unwatch;
  const emit = {};
  for (const key in callbacks) {
    emit[key] = ((...args) => {
      const listeners2 = getListeners();
      if (listeners2.length === 0)
        return;
      for (const listener of listeners2)
        listener.fns[key]?.(...args);
    });
  }
  const cleanup = fn(emit);
  if (typeof cleanup === "function")
    cleanupCache.set(observerId, cleanup);
  return unwatch;
}

// node_modules/viem/_esm/utils/wait.js
async function wait(time, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(getAbortError(signal));
      return;
    }
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, time);
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(getAbortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// node_modules/viem/_esm/utils/poll.js
function poll(fn, { emitOnBegin, initialWaitTime, interval }) {
  let active = true;
  const unwatch = () => active = false;
  const watch = async () => {
    let data;
    if (emitOnBegin)
      data = await fn({ unpoll: unwatch });
    const initialWait = await initialWaitTime?.(data) ?? interval;
    await wait(initialWait);
    const poll2 = async () => {
      if (!active)
        return;
      await fn({ unpoll: unwatch });
      await wait(interval);
      poll2();
    };
    poll2();
  };
  watch();
  return unwatch;
}

// node_modules/viem/_esm/utils/promise/withCache.js
var promiseCache = /* @__PURE__ */ new Map();
var responseCache = /* @__PURE__ */ new Map();
function getCache(cacheKey2) {
  const buildCache = (cacheKey3, cache) => ({
    clear: () => cache.delete(cacheKey3),
    get: () => cache.get(cacheKey3),
    set: (data) => cache.set(cacheKey3, data)
  });
  const promise = buildCache(cacheKey2, promiseCache);
  const response = buildCache(cacheKey2, responseCache);
  return {
    clear: () => {
      promise.clear();
      response.clear();
    },
    promise,
    response
  };
}
async function withCache(fn, { cacheKey: cacheKey2, cacheTime = Number.POSITIVE_INFINITY }) {
  const cache = getCache(cacheKey2);
  const response = cache.response.get();
  if (response && cacheTime > 0) {
    const age = Date.now() - response.created.getTime();
    if (age < cacheTime)
      return response.data;
  }
  let promise = cache.promise.get();
  if (!promise) {
    promise = fn();
    cache.promise.set(promise);
  }
  try {
    const data = await promise;
    cache.response.set({ created: /* @__PURE__ */ new Date(), data });
    return data;
  } finally {
    cache.promise.clear();
  }
}

// node_modules/viem/_esm/actions/public/getBlockNumber.js
var cacheKey = (id) => `blockNumber.${id}`;
async function getBlockNumber(client, { cacheTime = client.cacheTime } = {}) {
  const blockNumberHex = await withCache(() => client.request({
    method: "eth_blockNumber"
  }), { cacheKey: cacheKey(client.uid), cacheTime });
  return BigInt(blockNumberHex);
}

// node_modules/viem/_esm/actions/public/getFilterChanges.js
async function getFilterChanges(_client, { filter }) {
  const strict = "strict" in filter && filter.strict;
  const logs = await filter.request({
    method: "eth_getFilterChanges",
    params: [filter.id]
  });
  if (typeof logs[0] === "string")
    return logs;
  const formattedLogs = logs.map((log) => formatLog(log));
  if (!("abi" in filter) || !filter.abi)
    return formattedLogs;
  return parseEventLogs({
    abi: filter.abi,
    logs: formattedLogs,
    strict
  });
}

// node_modules/viem/_esm/actions/public/uninstallFilter.js
async function uninstallFilter(_client, { filter }) {
  return filter.request({
    method: "eth_uninstallFilter",
    params: [filter.id]
  });
}

// node_modules/viem/_esm/actions/public/watchContractEvent.js
function watchContractEvent(client, parameters) {
  const { abi: abi2, address, args, batch = true, eventName, fromBlock, onError, onLogs, poll: poll_, pollingInterval = client.pollingInterval, strict: strict_ } = parameters;
  const enablePolling = (() => {
    if (typeof poll_ !== "undefined")
      return poll_;
    if (typeof fromBlock === "bigint")
      return true;
    if (client.transport.type === "webSocket" || client.transport.type === "ipc")
      return false;
    if (client.transport.type === "fallback" && (client.transport.transports[0].config.type === "webSocket" || client.transport.transports[0].config.type === "ipc"))
      return false;
    return true;
  })();
  const pollContractEvent = () => {
    const strict = strict_ ?? false;
    const observerId = stringify([
      "watchContractEvent",
      address,
      args,
      batch,
      client.uid,
      eventName,
      pollingInterval,
      strict,
      fromBlock
    ]);
    return observe(observerId, { onLogs, onError }, (emit) => {
      let previousBlockNumber;
      if (fromBlock !== void 0)
        previousBlockNumber = fromBlock - 1n;
      let filter;
      let initialized = false;
      const unwatch = poll(async () => {
        if (!initialized) {
          try {
            filter = await getAction(client, createContractEventFilter, "createContractEventFilter")({
              abi: abi2,
              address,
              args,
              eventName,
              strict,
              fromBlock
            });
          } catch {
          }
          initialized = true;
          return;
        }
        try {
          let logs;
          if (filter) {
            logs = await getAction(client, getFilterChanges, "getFilterChanges")({ filter });
          } else {
            const blockNumber = await getAction(client, getBlockNumber, "getBlockNumber")({});
            if (previousBlockNumber && previousBlockNumber < blockNumber) {
              logs = await getAction(client, getContractEvents, "getContractEvents")({
                abi: abi2,
                address,
                args,
                eventName,
                fromBlock: previousBlockNumber + 1n,
                toBlock: blockNumber,
                strict
              });
            } else {
              logs = [];
            }
            previousBlockNumber = blockNumber;
          }
          if (logs.length === 0)
            return;
          if (batch)
            emit.onLogs(logs);
          else
            for (const log of logs)
              emit.onLogs([log]);
        } catch (err) {
          if (filter && err instanceof InvalidInputRpcError)
            initialized = false;
          emit.onError?.(err);
        }
      }, {
        emitOnBegin: true,
        interval: pollingInterval
      });
      return async () => {
        if (filter)
          await getAction(client, uninstallFilter, "uninstallFilter")({ filter });
        unwatch();
      };
    });
  };
  const subscribeContractEvent = () => {
    const strict = strict_ ?? false;
    const observerId = stringify([
      "watchContractEvent",
      address,
      args,
      batch,
      client.uid,
      eventName,
      pollingInterval,
      strict
    ]);
    let active = true;
    let unsubscribe = () => active = false;
    return observe(observerId, { onLogs, onError }, (emit) => {
      ;
      (async () => {
        try {
          const transport = (() => {
            if (client.transport.type === "fallback") {
              const transport2 = client.transport.transports.find((transport3) => transport3.config.type === "webSocket" || transport3.config.type === "ipc");
              if (!transport2)
                return client.transport;
              return transport2.value;
            }
            return client.transport;
          })();
          const topics = eventName ? encodeEventTopics({
            abi: abi2,
            eventName,
            args
          }) : [];
          const { unsubscribe: unsubscribe_ } = await transport.subscribe({
            params: ["logs", { address, topics }],
            onData(data) {
              if (!active)
                return;
              const log = data.result;
              try {
                const { eventName: eventName2, args: args2 } = decodeEventLog({
                  abi: abi2,
                  data: log.data,
                  topics: log.topics,
                  strict: strict_
                });
                const formatted = formatLog(log, {
                  args: args2,
                  eventName: eventName2
                });
                emit.onLogs([formatted]);
              } catch (err) {
                let eventName2;
                let isUnnamed;
                if (err instanceof DecodeLogDataMismatch || err instanceof DecodeLogTopicsMismatch) {
                  if (strict_)
                    return;
                  eventName2 = err.abiItem.name;
                  isUnnamed = err.abiItem.inputs?.some((x5) => !("name" in x5 && x5.name));
                }
                const formatted = formatLog(log, {
                  args: isUnnamed ? [] : {},
                  eventName: eventName2
                });
                emit.onLogs([formatted]);
              }
            },
            onError(error) {
              emit.onError?.(error);
            }
          });
          unsubscribe = unsubscribe_;
          if (!active)
            unsubscribe();
        } catch (err) {
          onError?.(err);
        }
      })();
      return () => unsubscribe();
    });
  };
  return enablePolling ? pollContractEvent() : subscribeContractEvent();
}

// node_modules/viem/_esm/errors/account.js
var AccountNotFoundError = class extends BaseError {
  constructor({ docsPath: docsPath3 } = {}) {
    super([
      "Could not find an Account to execute with this Action.",
      "Please provide an Account with the `account` argument on the Action, or by supplying an `account` to the Client."
    ].join("\n"), {
      docsPath: docsPath3,
      docsSlug: "account",
      name: "AccountNotFoundError"
    });
  }
};

// node_modules/viem/_esm/actions/wallet/sendRawTransaction.js
async function sendRawTransaction(client, { serializedTransaction }) {
  return client.request({
    method: "eth_sendRawTransaction",
    params: [serializedTransaction]
  }, { retryCount: 0 });
}

// node_modules/viem/_esm/utils/promise/withRetry.js
function withRetry(fn, { delay: delay_ = 100, retryCount = 2, shouldRetry: shouldRetry2 = () => true, signal } = {}) {
  return new Promise((resolve, reject) => {
    const attemptRetry = async ({ count = 0 } = {}) => {
      if (signal?.aborted) {
        reject(getAbortError(signal));
        return;
      }
      const retry = async ({ error }) => {
        const delay = typeof delay_ === "function" ? delay_({ count, error }) : delay_;
        if (delay) {
          try {
            await wait(delay, { signal });
          } catch (err) {
            reject(err);
            return;
          }
        }
        return attemptRetry({ count: count + 1 });
      };
      try {
        const data = await fn();
        resolve(data);
      } catch (err) {
        if (signal?.aborted) {
          reject(getAbortError(signal));
          return;
        }
        if (isAbortError(err)) {
          reject(err);
          return;
        }
        if (count < retryCount && await shouldRetry2({ count, error: err }))
          return retry({ error: err });
        reject(err);
      }
    };
    void attemptRetry().catch(reject);
  });
}

// node_modules/viem/_esm/utils/formatters/transactionReceipt.js
var receiptStatuses = {
  "0x0": "reverted",
  "0x1": "success"
};
function formatTransactionReceipt(transactionReceipt, _5) {
  const receipt = {
    ...transactionReceipt,
    blockNumber: transactionReceipt.blockNumber ? BigInt(transactionReceipt.blockNumber) : null,
    contractAddress: transactionReceipt.contractAddress ? transactionReceipt.contractAddress : null,
    cumulativeGasUsed: transactionReceipt.cumulativeGasUsed ? BigInt(transactionReceipt.cumulativeGasUsed) : null,
    effectiveGasPrice: transactionReceipt.effectiveGasPrice ? BigInt(transactionReceipt.effectiveGasPrice) : null,
    gasUsed: transactionReceipt.gasUsed ? BigInt(transactionReceipt.gasUsed) : null,
    logs: transactionReceipt.logs ? transactionReceipt.logs.map((log) => formatLog(log)) : null,
    to: transactionReceipt.to ? transactionReceipt.to : null,
    transactionIndex: transactionReceipt.transactionIndex ? hexToNumber(transactionReceipt.transactionIndex) : null,
    status: transactionReceipt.status ? receiptStatuses[transactionReceipt.status] : null,
    type: transactionReceipt.type ? transactionType[transactionReceipt.type] || transactionReceipt.type : null
  };
  if (transactionReceipt.blobGasPrice)
    receipt.blobGasPrice = BigInt(transactionReceipt.blobGasPrice);
  if (transactionReceipt.blobGasUsed)
    receipt.blobGasUsed = BigInt(transactionReceipt.blobGasUsed);
  return receipt;
}

// node_modules/viem/_esm/utils/uid.js
var size4 = 256;
var index = size4;
var buffer;
function uid(length = 11) {
  if (!buffer || index + length > size4 * 2) {
    buffer = "";
    index = 0;
    for (let i5 = 0; i5 < size4; i5++) {
      buffer += (256 + Math.random() * 256 | 0).toString(16).substring(1);
    }
  }
  return buffer.substring(index, index++ + length);
}

// node_modules/viem/_esm/clients/createClient.js
function createClient(parameters) {
  const { batch, chain, ccipRead, dataSuffix, key = "base", name = "Base Client", tokens, type = "base" } = parameters;
  const experimental_blockTag = parameters.experimental_blockTag ?? (typeof chain?.experimental_preconfirmationTime === "number" ? "pending" : void 0);
  const blockTime = chain?.blockTime ?? 12e3;
  const defaultPollingInterval = Math.min(Math.max(Math.floor(blockTime / 2), 500), 4e3);
  const pollingInterval = parameters.pollingInterval ?? defaultPollingInterval;
  const cacheTime = parameters.cacheTime ?? pollingInterval;
  const account = parameters.account ? parseAccount(parameters.account) : void 0;
  const { config, request, value } = parameters.transport({
    account,
    chain,
    pollingInterval
  });
  const transport = { ...config, ...value };
  const client = {
    account,
    batch,
    cacheTime,
    ccipRead,
    chain,
    dataSuffix,
    key,
    name,
    pollingInterval,
    request,
    tokens,
    transport,
    type,
    uid: uid(),
    ...experimental_blockTag ? { experimental_blockTag } : {}
  };
  function extend(base) {
    return (extendFn) => {
      const extended = extendFn(base);
      for (const key2 in client)
        delete extended[key2];
      const combined = { ...base, ...extended };
      for (const key2 in extended) {
        const a4 = base[key2];
        const b4 = extended[key2];
        if (isPlainObject(a4) && isPlainObject(b4))
          combined[key2] = { ...a4, ...b4 };
      }
      return Object.assign(combined, { extend: extend(combined) });
    };
  }
  return Object.assign(client, { extend: extend(client) });
}
function isPlainObject(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function bindActionDecorators(client, action) {
  const wrapped = (parameters = {}) => action(client, parameters);
  for (const key of [
    "call",
    "calls",
    "callWithPeriod",
    "estimateGas",
    "prepare",
    "prepareRecipient",
    "predict",
    "simulate"
  ])
    if (Object.hasOwn(action, key)) {
      const helper = action[key];
      wrapped[key] = (args = {}) => {
        if (helper.length === 1)
          return helper(args);
        return helper(client, args);
      };
    }
  for (const key of ["extractEvent", "extractEvents"])
    if (Object.hasOwn(action, key))
      wrapped[key] = action[key];
  return wrapped;
}

// node_modules/viem/_esm/utils/ens/errors.js
function isNullUniversalResolverError(err) {
  if (!(err instanceof BaseError))
    return false;
  const cause = err.walk((e4) => e4 instanceof ContractFunctionRevertedError);
  if (!(cause instanceof ContractFunctionRevertedError))
    return false;
  if (cause.data?.errorName === "HttpError")
    return true;
  if (cause.data?.errorName === "ResolverError")
    return true;
  if (cause.data?.errorName === "ResolverNotContract")
    return true;
  if (cause.data?.errorName === "ResolverNotFound")
    return true;
  if (cause.data?.errorName === "ReverseAddressMismatch")
    return true;
  if (cause.data?.errorName === "UnsupportedResolverProfile")
    return true;
  return false;
}

// node_modules/viem/_esm/utils/ens/encodedLabelToLabelhash.js
function encodedLabelToLabelhash(label) {
  if (label.length !== 66)
    return null;
  if (label.indexOf("[") !== 0)
    return null;
  if (label.indexOf("]") !== 65)
    return null;
  const hash2 = `0x${label.slice(1, 65)}`;
  if (!isHex(hash2))
    return null;
  return hash2;
}

// node_modules/viem/_esm/utils/ens/namehash.js
function namehash(name) {
  let result = new Uint8Array(32).fill(0);
  if (!name)
    return bytesToHex(result);
  const labels = name.split(".");
  for (let i5 = labels.length - 1; i5 >= 0; i5 -= 1) {
    const hashFromEncodedLabel = encodedLabelToLabelhash(labels[i5]);
    const hashed = hashFromEncodedLabel ? toBytes(hashFromEncodedLabel) : keccak256(stringToBytes(labels[i5]), "bytes");
    result = keccak256(concat([result, hashed]), "bytes");
  }
  return bytesToHex(result);
}

// node_modules/viem/_esm/utils/ens/encodeLabelhash.js
function encodeLabelhash(hash2) {
  return `[${hash2.slice(2)}]`;
}

// node_modules/viem/_esm/utils/ens/labelhash.js
function labelhash(label) {
  const result = new Uint8Array(32).fill(0);
  if (!label)
    return bytesToHex(result);
  return encodedLabelToLabelhash(label) || keccak256(stringToBytes(label));
}

// node_modules/viem/_esm/utils/ens/packetToBytes.js
function packetToBytes(packet) {
  const value = packet.replace(/^\.|\.$/gm, "");
  if (value.length === 0)
    return new Uint8Array(1);
  const bytes = new Uint8Array(stringToBytes(value).byteLength + 2);
  let offset = 0;
  const list = value.split(".");
  for (let i5 = 0; i5 < list.length; i5++) {
    let encoded = stringToBytes(list[i5]);
    if (encoded.byteLength > 255)
      encoded = stringToBytes(encodeLabelhash(labelhash(list[i5])));
    bytes[offset] = encoded.length;
    bytes.set(encoded, offset + 1);
    offset += encoded.length + 1;
  }
  if (bytes.byteLength !== offset + 1)
    return bytes.slice(0, offset + 1);
  return bytes;
}

// node_modules/viem/_esm/actions/ens/getEnsAddress.js
async function getEnsAddress(client, parameters) {
  const { blockNumber, blockTag, coinType, name, gatewayUrls, strict } = parameters;
  const { chain } = client;
  const universalResolverAddress = (() => {
    if (parameters.universalResolverAddress)
      return parameters.universalResolverAddress;
    if (!chain)
      throw new Error("client chain not configured. universalResolverAddress is required.");
    return getChainContractAddress({
      blockNumber,
      chain,
      contract: "ensUniversalResolver"
    });
  })();
  const tlds = chain?.ensTlds;
  if (tlds && !tlds.some((tld) => name.endsWith(tld)))
    return null;
  const args = (() => {
    if (coinType != null)
      return [namehash(name), BigInt(coinType)];
    return [namehash(name)];
  })();
  try {
    const functionData = encodeFunctionData({
      abi: addressResolverAbi,
      functionName: "addr",
      args
    });
    const readContractParameters = {
      address: universalResolverAddress,
      abi: universalResolverResolveAbi,
      functionName: "resolveWithGateways",
      args: [
        toHex(packetToBytes(name)),
        functionData,
        gatewayUrls ?? [localBatchGatewayUrl]
      ],
      blockNumber,
      blockTag
    };
    const readContractAction = getAction(client, readContract, "readContract");
    const res = await readContractAction(readContractParameters);
    if (res[0] === "0x")
      return null;
    const address = decodeAddress({ coinType, data: res[0], args });
    if (address === "0x")
      return null;
    if (trim(address) === "0x00")
      return null;
    return address;
  } catch (err) {
    if (strict)
      throw err;
    if (isNullUniversalResolverError(err))
      return null;
    throw err;
  }
}
function decodeAddress({ coinType, data, args }) {
  try {
    return decodeFunctionResult({
      abi: addressResolverAbi,
      args,
      functionName: "addr",
      data
    });
  } catch (err) {
    if (coinType == null)
      throw err;
    const address = trim(data);
    if (size(address) === 20)
      return getAddress(address);
    throw err;
  }
}

// node_modules/viem/_esm/errors/ens.js
var EnsAvatarInvalidMetadataError = class extends BaseError {
  constructor({ data }) {
    super("Unable to extract image from metadata. The metadata may be malformed or invalid.", {
      metaMessages: [
        "- Metadata must be a JSON object with at least an `image`, `image_url` or `image_data` property.",
        "",
        `Provided data: ${JSON.stringify(data)}`
      ],
      name: "EnsAvatarInvalidMetadataError"
    });
  }
};
var EnsAvatarInvalidNftUriError = class extends BaseError {
  constructor({ reason }) {
    super(`ENS NFT avatar URI is invalid. ${reason}`, {
      name: "EnsAvatarInvalidNftUriError"
    });
  }
};
var EnsAvatarUriResolutionError = class extends BaseError {
  constructor({ uri }) {
    super(`Unable to resolve ENS avatar URI "${uri}". The URI may be malformed, invalid, or does not respond with a valid image.`, { name: "EnsAvatarUriResolutionError" });
  }
};
var EnsAvatarUnsupportedNamespaceError = class extends BaseError {
  constructor({ namespace }) {
    super(`ENS NFT avatar namespace "${namespace}" is not supported. Must be "erc721" or "erc1155".`, { name: "EnsAvatarUnsupportedNamespaceError" });
  }
};

// node_modules/viem/_esm/utils/ens/avatar/utils.js
var networkRegex = /(?<protocol>https?:\/\/[^/]*|ipfs:\/|ipns:\/|ar:\/)?(?<root>\/)?(?<subpath>ipfs\/|ipns\/)?(?<target>[\w\-.]+)(?<subtarget>\/.*)?/;
var ipfsHashRegex = /^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|b[A-Za-z2-7]{58,}|B[A-Z2-7]{58,}|z[1-9A-HJ-NP-Za-km-z]{48,}|F[0-9A-F]{50,})(\/(?<target>[\w\-.]+))?(?<subtarget>\/.*)?$/;
var base64Regex = /^data:([a-zA-Z\-/+]*);base64,([^"].*)/;
var dataURIRegex = /^data:([a-zA-Z\-/+]*)?(;[a-zA-Z0-9].*?)?(,)/;
async function isImageUri(uri) {
  try {
    const res = await fetch(uri, { method: "HEAD" });
    if (res.status === 200) {
      const contentType = res.headers.get("content-type");
      return contentType?.startsWith("image/");
    }
    return false;
  } catch (error) {
    if (typeof error === "object" && typeof error.response !== "undefined") {
      return false;
    }
    if (!Object.hasOwn(globalThis, "Image"))
      return false;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve(true);
      };
      img.onerror = () => {
        resolve(false);
      };
      img.src = uri;
    });
  }
}
function getGateway(custom, defaultGateway) {
  if (!custom)
    return defaultGateway;
  if (custom.endsWith("/"))
    return custom.slice(0, -1);
  return custom;
}
function resolveAvatarUri({ uri, gatewayUrls }) {
  const isEncoded = base64Regex.test(uri);
  if (isEncoded)
    return { uri, isOnChain: true, isEncoded };
  const ipfsGateway = getGateway(gatewayUrls?.ipfs, "https://ipfs.io");
  const arweaveGateway = getGateway(gatewayUrls?.arweave, "https://arweave.net");
  const networkRegexMatch = uri.match(networkRegex);
  const { protocol, subpath, target, subtarget = "" } = networkRegexMatch?.groups || {};
  const isIPNS = protocol === "ipns:/" || subpath === "ipns/";
  const isIPFS = protocol === "ipfs:/" || subpath === "ipfs/" || ipfsHashRegex.test(uri);
  if (uri.startsWith("http") && !isIPNS && !isIPFS) {
    let replacedUri = uri;
    if (gatewayUrls?.arweave)
      replacedUri = uri.replace(/https:\/\/arweave.net/g, gatewayUrls?.arweave);
    return { uri: replacedUri, isOnChain: false, isEncoded: false };
  }
  if ((isIPNS || isIPFS) && target) {
    return {
      uri: `${ipfsGateway}/${isIPNS ? "ipns" : "ipfs"}/${target}${subtarget}`,
      isOnChain: false,
      isEncoded: false
    };
  }
  if (protocol === "ar:/" && target) {
    return {
      uri: `${arweaveGateway}/${target}${subtarget || ""}`,
      isOnChain: false,
      isEncoded: false
    };
  }
  let parsedUri = uri.replace(dataURIRegex, "");
  if (parsedUri.startsWith("<svg")) {
    parsedUri = `data:image/svg+xml;base64,${btoa(parsedUri)}`;
  }
  if (parsedUri.startsWith("data:") || parsedUri.startsWith("{")) {
    return {
      uri: parsedUri,
      isOnChain: true,
      isEncoded: false
    };
  }
  throw new EnsAvatarUriResolutionError({ uri });
}
function getJsonImage(data) {
  if (typeof data !== "object" || !("image" in data) && !("image_url" in data) && !("image_data" in data)) {
    throw new EnsAvatarInvalidMetadataError({ data });
  }
  return data.image || data.image_url || data.image_data;
}
async function getMetadataAvatarUri({ gatewayUrls, uri }) {
  try {
    const res = await fetch(uri).then((res2) => res2.json());
    const image = await parseAvatarUri({
      gatewayUrls,
      uri: getJsonImage(res)
    });
    return image;
  } catch {
    throw new EnsAvatarUriResolutionError({ uri });
  }
}
async function parseAvatarUri({ gatewayUrls, uri }) {
  const { uri: resolvedURI, isOnChain } = resolveAvatarUri({ uri, gatewayUrls });
  if (isOnChain)
    return resolvedURI;
  const isImage = await isImageUri(resolvedURI);
  if (isImage)
    return resolvedURI;
  throw new EnsAvatarUriResolutionError({ uri });
}
function parseNftUri(uri_) {
  let uri = uri_;
  if (uri.startsWith("did:nft:")) {
    uri = uri.replace("did:nft:", "").replace(/_/g, "/");
  }
  const [reference, asset_namespace, tokenID] = uri.split("/");
  const [eip_namespace, chainID] = reference.split(":");
  const [erc_namespace, contractAddress] = asset_namespace.split(":");
  if (!eip_namespace || eip_namespace.toLowerCase() !== "eip155")
    throw new EnsAvatarInvalidNftUriError({ reason: "Only EIP-155 supported" });
  if (!chainID)
    throw new EnsAvatarInvalidNftUriError({ reason: "Chain ID not found" });
  if (!contractAddress)
    throw new EnsAvatarInvalidNftUriError({
      reason: "Contract address not found"
    });
  if (!tokenID)
    throw new EnsAvatarInvalidNftUriError({ reason: "Token ID not found" });
  if (!erc_namespace)
    throw new EnsAvatarInvalidNftUriError({ reason: "ERC namespace not found" });
  return {
    chainID: Number.parseInt(chainID, 10),
    namespace: erc_namespace.toLowerCase(),
    contractAddress,
    tokenID
  };
}
async function getNftTokenUri(client, { nft }) {
  if (nft.namespace === "erc721") {
    return readContract(client, {
      address: nft.contractAddress,
      abi: [
        {
          name: "tokenURI",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "tokenId", type: "uint256" }],
          outputs: [{ name: "", type: "string" }]
        }
      ],
      functionName: "tokenURI",
      args: [BigInt(nft.tokenID)]
    });
  }
  if (nft.namespace === "erc1155") {
    return readContract(client, {
      address: nft.contractAddress,
      abi: [
        {
          name: "uri",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "_id", type: "uint256" }],
          outputs: [{ name: "", type: "string" }]
        }
      ],
      functionName: "uri",
      args: [BigInt(nft.tokenID)]
    });
  }
  throw new EnsAvatarUnsupportedNamespaceError({ namespace: nft.namespace });
}

// node_modules/viem/_esm/utils/ens/avatar/parseAvatarRecord.js
async function parseAvatarRecord(client, { gatewayUrls, record }) {
  if (/eip155:/i.test(record))
    return parseNftAvatarUri(client, { gatewayUrls, record });
  return parseAvatarUri({ uri: record, gatewayUrls });
}
async function parseNftAvatarUri(client, { gatewayUrls, record }) {
  const nft = parseNftUri(record);
  const nftUri = await getNftTokenUri(client, { nft });
  const { uri: resolvedNftUri, isOnChain, isEncoded } = resolveAvatarUri({ uri: nftUri, gatewayUrls });
  if (isOnChain && (resolvedNftUri.includes("data:application/json;base64,") || resolvedNftUri.startsWith("{"))) {
    const encodedJson = isEncoded ? (
      // if it is encoded, decode it
      atob(resolvedNftUri.replace("data:application/json;base64,", ""))
    ) : (
      // if it isn't encoded assume it is a JSON string, but it could be anything (it will error if it is)
      resolvedNftUri
    );
    const decoded = JSON.parse(encodedJson);
    return parseAvatarUri({ uri: getJsonImage(decoded), gatewayUrls });
  }
  let uriTokenId = nft.tokenID;
  if (nft.namespace === "erc1155")
    uriTokenId = uriTokenId.replace("0x", "").padStart(64, "0");
  return getMetadataAvatarUri({
    gatewayUrls,
    uri: resolvedNftUri.replace(/(?:0x)?{id}/, uriTokenId)
  });
}

// node_modules/viem/_esm/actions/ens/getEnsText.js
async function getEnsText(client, parameters) {
  const { blockNumber, blockTag, key, name, gatewayUrls, strict } = parameters;
  const { chain } = client;
  const universalResolverAddress = (() => {
    if (parameters.universalResolverAddress)
      return parameters.universalResolverAddress;
    if (!chain)
      throw new Error("client chain not configured. universalResolverAddress is required.");
    return getChainContractAddress({
      blockNumber,
      chain,
      contract: "ensUniversalResolver"
    });
  })();
  const tlds = chain?.ensTlds;
  if (tlds && !tlds.some((tld) => name.endsWith(tld)))
    return null;
  try {
    const readContractParameters = {
      address: universalResolverAddress,
      abi: universalResolverResolveAbi,
      args: [
        toHex(packetToBytes(name)),
        encodeFunctionData({
          abi: textResolverAbi,
          functionName: "text",
          args: [namehash(name), key]
        }),
        gatewayUrls ?? [localBatchGatewayUrl]
      ],
      functionName: "resolveWithGateways",
      blockNumber,
      blockTag
    };
    const readContractAction = getAction(client, readContract, "readContract");
    const res = await readContractAction(readContractParameters);
    if (res[0] === "0x")
      return null;
    const record = decodeFunctionResult({
      abi: textResolverAbi,
      functionName: "text",
      data: res[0]
    });
    return record === "" ? null : record;
  } catch (err) {
    if (strict)
      throw err;
    if (isNullUniversalResolverError(err))
      return null;
    throw err;
  }
}

// node_modules/viem/_esm/actions/ens/getEnsAvatar.js
async function getEnsAvatar(client, { blockNumber, blockTag, assetGatewayUrls, name, gatewayUrls, strict, universalResolverAddress }) {
  const record = await getAction(client, getEnsText, "getEnsText")({
    blockNumber,
    blockTag,
    key: "avatar",
    name,
    universalResolverAddress,
    gatewayUrls,
    strict
  });
  if (!record)
    return null;
  try {
    return await parseAvatarRecord(client, {
      record,
      gatewayUrls: assetGatewayUrls
    });
  } catch {
    return null;
  }
}

// node_modules/viem/_esm/actions/ens/getEnsName.js
async function getEnsName(client, parameters) {
  const { address, blockNumber, blockTag, coinType = 60n, gatewayUrls, strict } = parameters;
  const { chain } = client;
  const universalResolverAddress = (() => {
    if (parameters.universalResolverAddress)
      return parameters.universalResolverAddress;
    if (!chain)
      throw new Error("client chain not configured. universalResolverAddress is required.");
    return getChainContractAddress({
      blockNumber,
      chain,
      contract: "ensUniversalResolver"
    });
  })();
  try {
    const readContractParameters = {
      address: universalResolverAddress,
      abi: universalResolverReverseAbi,
      args: [address, coinType, gatewayUrls ?? [localBatchGatewayUrl]],
      functionName: "reverseWithGateways",
      blockNumber,
      blockTag
    };
    const readContractAction = getAction(client, readContract, "readContract");
    const [name] = await readContractAction(readContractParameters);
    return name || null;
  } catch (err) {
    if (strict)
      throw err;
    if (isNullUniversalResolverError(err))
      return null;
    throw err;
  }
}

// node_modules/viem/_esm/actions/ens/getEnsResolver.js
async function getEnsResolver(client, parameters) {
  const { blockNumber, blockTag, name } = parameters;
  const { chain } = client;
  const universalResolverAddress = (() => {
    if (parameters.universalResolverAddress)
      return parameters.universalResolverAddress;
    if (!chain)
      throw new Error("client chain not configured. universalResolverAddress is required.");
    return getChainContractAddress({
      blockNumber,
      chain,
      contract: "ensUniversalResolver"
    });
  })();
  const tlds = chain?.ensTlds;
  if (tlds && !tlds.some((tld) => name.endsWith(tld)))
    throw new Error(`${name} is not a valid ENS TLD (${tlds?.join(", ")}) for chain "${chain.name}" (id: ${chain.id}).`);
  const [resolverAddress] = await getAction(client, readContract, "readContract")({
    address: universalResolverAddress,
    abi: [
      {
        inputs: [{ type: "bytes" }],
        name: "findResolver",
        outputs: [
          { type: "address" },
          { type: "bytes32" },
          { type: "uint256" }
        ],
        stateMutability: "view",
        type: "function"
      }
    ],
    functionName: "findResolver",
    args: [toHex(packetToBytes(name))],
    blockNumber,
    blockTag
  });
  return resolverAddress;
}

// node_modules/viem/_esm/actions/public/createAccessList.js
async function createAccessList(client, args) {
  const { account: account_ = client.account, blockNumber, blockTag = "latest", blobs, data, gas, gasPrice, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, to, value, ...rest } = args;
  const account = account_ ? parseAccount(account_) : void 0;
  try {
    assertRequest(args);
    const blockNumberHex = typeof blockNumber === "bigint" ? numberToHex(blockNumber) : void 0;
    const block = blockNumberHex || blockTag;
    const chainFormat = client.chain?.formatters?.transactionRequest?.format;
    const format2 = chainFormat || formatTransactionRequest;
    const request = format2({
      // Pick out extra data that might exist on the chain's transaction request type.
      ...extract(rest, { format: chainFormat }),
      account,
      blobs,
      data,
      gas,
      gasPrice,
      maxFeePerBlobGas,
      maxFeePerGas,
      maxPriorityFeePerGas,
      to,
      value
    }, "createAccessList");
    const response = await client.request({
      method: "eth_createAccessList",
      params: [request, block]
    });
    if (response.error)
      throw new BaseError(response.error, { details: response.error });
    return {
      accessList: response.accessList,
      gasUsed: BigInt(response.gasUsed)
    };
  } catch (err) {
    throw getCallError(err, {
      ...args,
      account,
      chain: client.chain
    });
  }
}

// node_modules/viem/_esm/actions/public/createBlockFilter.js
async function createBlockFilter(client) {
  const getRequest = createFilterRequestScope(client, {
    method: "eth_newBlockFilter"
  });
  const id = await client.request({
    method: "eth_newBlockFilter"
  });
  return { id, request: getRequest(id), type: "block" };
}

// node_modules/viem/_esm/actions/public/createEventFilter.js
async function createEventFilter(client, { address, args, event, events: events_, fromBlock, strict, toBlock } = {}) {
  const events = events_ ?? (event ? [event] : void 0);
  const getRequest = createFilterRequestScope(client, {
    method: "eth_newFilter"
  });
  let topics = [];
  if (events) {
    const encoded = events.flatMap((event2) => encodeEventTopics({
      abi: [event2],
      eventName: event2.name,
      args
    }));
    topics = [encoded];
    if (event)
      topics = topics[0];
  }
  const id = await client.request({
    method: "eth_newFilter",
    params: [
      {
        address,
        fromBlock: typeof fromBlock === "bigint" ? numberToHex(fromBlock) : fromBlock,
        toBlock: typeof toBlock === "bigint" ? numberToHex(toBlock) : toBlock,
        ...topics.length ? { topics } : {}
      }
    ]
  });
  return {
    abi: events,
    args,
    eventName: event ? event.name : void 0,
    fromBlock,
    id,
    request: getRequest(id),
    strict: Boolean(strict),
    toBlock,
    type: "event"
  };
}

// node_modules/viem/_esm/actions/public/createPendingTransactionFilter.js
async function createPendingTransactionFilter(client) {
  const getRequest = createFilterRequestScope(client, {
    method: "eth_newPendingTransactionFilter"
  });
  const id = await client.request({
    method: "eth_newPendingTransactionFilter"
  });
  return { id, request: getRequest(id), type: "transaction" };
}

// node_modules/viem/_esm/actions/public/getBalance.js
async function getBalance(client, { address, blockHash, blockNumber, blockTag = client.experimental_blockTag ?? "latest", requireCanonical }) {
  const block = formatBlockParameter({
    blockHash,
    blockNumber,
    blockTag,
    requireCanonical
  });
  if (client.batch?.multicall && client.chain?.contracts?.multicall3) {
    const multicall3Address = client.chain.contracts.multicall3.address;
    const calldata = encodeFunctionData({
      abi: multicall3Abi,
      functionName: "getEthBalance",
      args: [address]
    });
    const { data } = await getAction(client, call, "call")({
      to: multicall3Address,
      data: calldata,
      blockHash,
      blockNumber,
      blockTag,
      requireCanonical
    });
    return decodeFunctionResult({
      abi: multicall3Abi,
      functionName: "getEthBalance",
      args: [address],
      data: data || "0x"
    });
  }
  const balance = await client.request({
    method: "eth_getBalance",
    params: [address, block]
  });
  return BigInt(balance);
}

// node_modules/viem/_esm/actions/public/getBlobBaseFee.js
async function getBlobBaseFee(client) {
  const baseFee = await client.request({
    method: "eth_blobBaseFee"
  });
  return BigInt(baseFee);
}

// node_modules/viem/_esm/actions/public/getBlockReceipts.js
async function getBlockReceipts(client, { blockHash, blockNumber, blockTag = client.experimental_blockTag ?? "latest" } = {}) {
  const blockNumberHex = blockNumber !== void 0 ? numberToHex(blockNumber) : void 0;
  const receipts = await client.request({
    method: "eth_getBlockReceipts",
    params: [blockHash || blockNumberHex || blockTag]
  }, { dedupe: Boolean(blockHash || blockNumberHex) });
  if (!receipts)
    throw new BlockNotFoundError({ blockHash, blockNumber });
  const format2 = client.chain?.formatters?.transactionReceipt?.format || formatTransactionReceipt;
  return receipts.map((receipt) => format2(receipt, "getBlockReceipts"));
}

// node_modules/viem/_esm/actions/public/getBlockTransactionCount.js
async function getBlockTransactionCount(client, { blockHash, blockNumber, blockTag = "latest" } = {}) {
  const blockNumberHex = blockNumber !== void 0 ? numberToHex(blockNumber) : void 0;
  let count;
  if (blockHash) {
    count = await client.request({
      method: "eth_getBlockTransactionCountByHash",
      params: [blockHash]
    }, { dedupe: true });
  } else {
    count = await client.request({
      method: "eth_getBlockTransactionCountByNumber",
      params: [blockNumberHex || blockTag]
    }, { dedupe: Boolean(blockNumberHex) });
  }
  return hexToNumber(count);
}

// node_modules/viem/_esm/actions/public/getCode.js
async function getCode(client, { address, blockHash, blockNumber, blockTag = "latest", requireCanonical }) {
  const block = formatBlockParameter({
    blockHash,
    blockNumber,
    blockTag,
    requireCanonical
  });
  const hex = await client.request({
    method: "eth_getCode",
    params: [address, block]
  }, {
    dedupe: typeof blockNumber === "bigint" || blockHash !== void 0
  });
  if (hex === "0x")
    return void 0;
  return hex;
}

// node_modules/viem/_esm/actions/public/getDelegation.js
async function getDelegation(client, { address, blockNumber, blockTag = "latest" }) {
  const code = await getCode(client, {
    address,
    ...blockNumber !== void 0 ? { blockNumber } : { blockTag }
  });
  if (!code)
    return void 0;
  if (size(code) !== 23)
    return void 0;
  if (!code.startsWith("0xef0100"))
    return void 0;
  return getAddress(slice(code, 3, 23));
}

// node_modules/viem/_esm/errors/eip712.js
var Eip712DomainNotFoundError = class extends BaseError {
  constructor({ address }) {
    super(`No EIP-712 domain found on contract "${address}".`, {
      metaMessages: [
        "Ensure that:",
        `- The contract is deployed at the address "${address}".`,
        "- `eip712Domain()` function exists on the contract.",
        "- `eip712Domain()` function matches signature to ERC-5267 specification."
      ],
      name: "Eip712DomainNotFoundError"
    });
  }
};

// node_modules/viem/_esm/actions/public/getEip712Domain.js
async function getEip712Domain(client, parameters) {
  const { address, factory, factoryData } = parameters;
  try {
    const [fields, name, version, chainId, verifyingContract, salt, extensions] = await getAction(client, readContract, "readContract")({
      abi,
      address,
      functionName: "eip712Domain",
      factory,
      factoryData
    });
    return {
      domain: {
        name,
        version,
        chainId: Number(chainId),
        verifyingContract,
        salt
      },
      extensions,
      fields
    };
  } catch (e4) {
    const error = e4;
    if (error.name === "ContractFunctionExecutionError" && error.cause.name === "ContractFunctionZeroDataError") {
      throw new Eip712DomainNotFoundError({ address });
    }
    throw error;
  }
}
var abi = [
  {
    inputs: [],
    name: "eip712Domain",
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" }
    ],
    stateMutability: "view",
    type: "function"
  }
];

// node_modules/viem/_esm/utils/formatters/feeHistory.js
function formatFeeHistory(feeHistory) {
  return {
    baseFeePerGas: feeHistory.baseFeePerGas.map((value) => BigInt(value)),
    gasUsedRatio: feeHistory.gasUsedRatio,
    oldestBlock: BigInt(feeHistory.oldestBlock),
    reward: feeHistory.reward?.map((reward) => reward.map((value) => BigInt(value)))
  };
}

// node_modules/viem/_esm/actions/public/getFeeHistory.js
async function getFeeHistory(client, { blockCount, blockNumber, blockTag = "latest", rewardPercentiles }) {
  const blockNumberHex = typeof blockNumber === "bigint" ? numberToHex(blockNumber) : void 0;
  const feeHistory = await client.request({
    method: "eth_feeHistory",
    params: [
      numberToHex(blockCount),
      blockNumberHex || blockTag,
      rewardPercentiles
    ]
  }, { dedupe: Boolean(blockNumberHex) });
  return formatFeeHistory(feeHistory);
}

// node_modules/viem/_esm/actions/public/getFilterLogs.js
async function getFilterLogs(_client, { filter }) {
  const strict = filter.strict ?? false;
  const logs = await filter.request({
    method: "eth_getFilterLogs",
    params: [filter.id]
  });
  const formattedLogs = logs.map((log) => formatLog(log));
  if (!filter.abi)
    return formattedLogs;
  return parseEventLogs({
    abi: filter.abi,
    logs: formattedLogs,
    strict
  });
}

// node_modules/viem/_esm/utils/authorization/verifyAuthorization.js
async function verifyAuthorization({ address, authorization, signature }) {
  return isAddressEqual(getAddress(address), await recoverAuthorizationAddress({
    authorization,
    signature
  }));
}

// node_modules/viem/_esm/utils/promise/withDedupe.js
var promiseCache2 = /* @__PURE__ */ new LruMap(8192);
function withDedupe(fn, { enabled = true, id }) {
  if (!enabled || !id)
    return fn();
  if (promiseCache2.get(id))
    return promiseCache2.get(id);
  const promise = fn().finally(() => promiseCache2.delete(id));
  promiseCache2.set(id, promise);
  return promise;
}

// node_modules/viem/_esm/utils/buildRequest.js
function buildRequest(request, options = {}) {
  return async (args, overrideOptions = {}) => {
    const { dedupe = false, methods, retryDelay = 150, retryCount = 3, signal, uid: uid2 } = {
      ...options,
      ...overrideOptions
    };
    const { method } = args;
    if (methods?.exclude?.includes(method))
      throw new MethodNotSupportedRpcError(new Error("method not supported"), {
        method
      });
    if (methods?.include && !methods.include.includes(method))
      throw new MethodNotSupportedRpcError(new Error("method not supported"), {
        method
      });
    if (signal?.aborted)
      throw getAbortError(signal);
    const requestId = dedupe ? hashString(`${uid2}.${stringify(args)}`) : void 0;
    return withDedupe(() => withRetry(async () => {
      try {
        return await request(args, signal ? { signal } : void 0);
      } catch (err_) {
        if (signal?.aborted)
          throw getAbortError(signal);
        if (isAbortError(err_))
          throw err_;
        const err = err_;
        switch (err.code) {
          // -32700
          case ParseRpcError.code:
            throw new ParseRpcError(err);
          // -32600
          case InvalidRequestRpcError.code:
            throw new InvalidRequestRpcError(err);
          // -32601
          case MethodNotFoundRpcError.code:
            throw new MethodNotFoundRpcError(err, { method: args.method });
          // -32602
          case InvalidParamsRpcError.code:
            throw new InvalidParamsRpcError(err);
          // -32603
          case InternalRpcError.code:
            throw new InternalRpcError(err);
          // -32000
          case InvalidInputRpcError.code:
            throw new InvalidInputRpcError(err);
          // -32001
          case ResourceNotFoundRpcError.code:
            throw new ResourceNotFoundRpcError(err);
          // -32002
          case ResourceUnavailableRpcError.code:
            throw new ResourceUnavailableRpcError(err);
          // -32003
          case TransactionRejectedRpcError.code:
            throw new TransactionRejectedRpcError(err);
          // -32004
          case MethodNotSupportedRpcError.code:
            throw new MethodNotSupportedRpcError(err, {
              method: args.method
            });
          // -32005
          case LimitExceededRpcError.code:
            throw new LimitExceededRpcError(err);
          // -32006
          case JsonRpcVersionUnsupportedError.code:
            throw new JsonRpcVersionUnsupportedError(err);
          // 4001
          case UserRejectedRequestError.code:
            throw new UserRejectedRequestError(err);
          // 4100
          case UnauthorizedProviderError.code:
            throw new UnauthorizedProviderError(err);
          // 4200
          case UnsupportedProviderMethodError.code:
            throw new UnsupportedProviderMethodError(err);
          // 4900
          case ProviderDisconnectedError.code:
            throw new ProviderDisconnectedError(err);
          // 4901
          case ChainDisconnectedError.code:
            throw new ChainDisconnectedError(err);
          // 4902
          case SwitchChainError.code:
            throw new SwitchChainError(err);
          // 5700
          case UnsupportedNonOptionalCapabilityError.code:
            throw new UnsupportedNonOptionalCapabilityError(err);
          // 5710
          case UnsupportedChainIdError.code:
            throw new UnsupportedChainIdError(err);
          // 5720
          case DuplicateIdError.code:
            throw new DuplicateIdError(err);
          // 5730
          case UnknownBundleIdError.code:
            throw new UnknownBundleIdError(err);
          // 5740
          case BundleTooLargeError.code:
            throw new BundleTooLargeError(err);
          // 5750
          case AtomicReadyWalletRejectedUpgradeError.code:
            throw new AtomicReadyWalletRejectedUpgradeError(err);
          // 5760
          case AtomicityNotSupportedError.code:
            throw new AtomicityNotSupportedError(err);
          // CAIP-25: User Rejected Error
          // https://docs.walletconnect.com/2.0/specs/clients/sign/error-codes#rejected-caip-25
          case 5e3:
            throw new UserRejectedRequestError(err);
          // WalletConnect: Session Settlement Failed
          // https://docs.walletconnect.com/2.0/specs/clients/sign/error-codes
          case WalletConnectSessionSettlementError.code:
            throw new WalletConnectSessionSettlementError(err);
          default:
            if (err_ instanceof BaseError)
              throw err_;
            throw new UnknownRpcError(err);
        }
      }
    }, {
      delay: ({ count, error }) => {
        if (error && error instanceof HttpRequestError) {
          const retryAfter = error?.headers?.get("Retry-After");
          if (retryAfter?.match(/\d/))
            return Number.parseInt(retryAfter, 10) * 1e3;
        }
        return ~~(1 << count) * retryDelay;
      },
      retryCount,
      signal,
      shouldRetry: ({ error }) => shouldRetry(error)
    }), { enabled: dedupe, id: requestId });
  };
}
function shouldRetry(error) {
  if (isAbortError(error))
    return false;
  if ("code" in error && typeof error.code === "number") {
    if (error.code === -1)
      return true;
    if (error.code === LimitExceededRpcError.code)
      return true;
    if (error.code === InternalRpcError.code)
      return true;
    if (error.code === 429)
      return true;
    return false;
  }
  if (error instanceof HttpRequestError && error.status) {
    if (error.status === 403)
      return true;
    if (error.status === 408)
      return true;
    if (error.status === 413)
      return true;
    if (error.status === 429)
      return true;
    if (error.status === 500)
      return true;
    if (error.status === 502)
      return true;
    if (error.status === 503)
      return true;
    if (error.status === 504)
      return true;
    return false;
  }
  return true;
}
function hashString(str, seed = 0) {
  let h1 = 3735928559 ^ seed;
  let h22 = 1103547991 ^ seed;
  for (let i5 = 0; i5 < str.length; i5++) {
    const ch = str.charCodeAt(i5);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h22 = Math.imul(h22 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507);
  h1 ^= Math.imul(h22 ^ h22 >>> 16, 3266489909);
  h22 = Math.imul(h22 ^ h22 >>> 16, 2246822507);
  h22 ^= Math.imul(h1 ^ h1 >>> 16, 3266489909);
  return (4294967296 * (2097151 & h22) + (h1 >>> 0)).toString(36);
}

// node_modules/viem/_esm/utils/promise/withTimeout.js
function withTimeout(fn, { errorInstance = new Error("timed out"), timeout, signal }) {
  return new Promise((resolve, reject) => {
    ;
    (async () => {
      let timeoutId;
      const controller = new AbortController();
      try {
        if (timeout > 0) {
          timeoutId = setTimeout(() => {
            if (signal) {
              controller.abort();
            } else {
              reject(errorInstance);
            }
          }, timeout);
        }
        resolve(await fn({ signal: controller?.signal || null }));
      } catch (err) {
        if (controller?.signal.aborted && isAbortError(err)) {
          reject(errorInstance);
          return;
        }
        reject(err);
      } finally {
        clearTimeout(timeoutId);
      }
    })();
  });
}

// node_modules/viem/_esm/utils/rpc/id.js
function createIdStore() {
  return {
    current: 0,
    take() {
      return this.current++;
    },
    reset() {
      this.current = 0;
    }
  };
}
var idCache = /* @__PURE__ */ createIdStore();

// node_modules/viem/_esm/utils/rpc/http.js
var defaultMaxResponseBodySize = 10485760;
function getHttpRpcClient(url_, options = {}) {
  const { url, headers: headers_url } = parseUrl(url_);
  return {
    async request(params) {
      const { body, fetchFn = options.fetchFn ?? fetch, maxResponseBodySize = options.maxResponseBodySize ?? defaultMaxResponseBodySize, onRequest = options.onRequest, onResponse = options.onResponse, timeout = options.timeout ?? 1e4 } = params;
      const fetchOptions = {
        ...options.fetchOptions ?? {},
        ...params.fetchOptions ?? {}
      };
      const { headers, method, signal: signal_ } = fetchOptions;
      try {
        const response = await withTimeout(async ({ signal }) => {
          const init = {
            ...fetchOptions,
            body: Array.isArray(body) ? stringify(body.map((body2) => ({
              jsonrpc: "2.0",
              id: body2.id ?? idCache.take(),
              ...body2
            }))) : stringify({
              jsonrpc: "2.0",
              id: body.id ?? idCache.take(),
              ...body
            }),
            headers: {
              ...headers_url,
              "Content-Type": "application/json",
              ...headers
            },
            method: method || "POST",
            signal: signal_ || (timeout > 0 ? signal : null)
          };
          const request = new Request(url, init);
          const args = await onRequest?.(request, init) ?? { ...init, url };
          const response2 = await fetchFn(args.url ?? url, args);
          return response2;
        }, {
          errorInstance: new TimeoutError({ body, url }),
          timeout,
          signal: true
        });
        if (onResponse)
          await onResponse(response);
        let data;
        const responseBody = await readResponseBody(response, {
          maxResponseBodySize
        });
        if (response.headers.get("Content-Type")?.startsWith("application/json"))
          data = JSON.parse(responseBody);
        else {
          data = responseBody;
          try {
            data = JSON.parse(data || "{}");
          } catch (err) {
            if (response.ok)
              throw err;
            data = { error: data };
          }
        }
        if (!response.ok) {
          if (typeof data.error?.code === "number" && typeof data.error?.message === "string")
            return data;
          throw new HttpRequestError({
            body,
            details: stringify(data.error) || response.statusText,
            headers: response.headers,
            status: response.status,
            url
          });
        }
        return data;
      } catch (err) {
        if (signal_?.aborted)
          throw getAbortError(signal_);
        if (isAbortError(err))
          throw err;
        if (err instanceof HttpRequestError)
          throw err;
        if (err instanceof ResponseBodyTooLargeError)
          throw err;
        if (err instanceof TimeoutError)
          throw err;
        throw new HttpRequestError({
          body,
          cause: err,
          url
        });
      }
    }
  };
}
async function readResponseBody(response, { maxResponseBodySize }) {
  if (maxResponseBodySize === false)
    return response.text();
  const contentLength = response.headers.get("Content-Length");
  if (contentLength) {
    const size6 = Number(contentLength);
    if (size6 > maxResponseBodySize)
      throw new ResponseBodyTooLargeError({
        maxSize: maxResponseBodySize,
        size: size6
      });
  }
  if (!response.body) {
    const body2 = await response.text();
    const size6 = new TextEncoder().encode(body2).length;
    if (size6 > maxResponseBodySize)
      throw new ResponseBodyTooLargeError({
        maxSize: maxResponseBodySize,
        size: size6
      });
    return body2;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let size5 = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      size5 += value.byteLength;
      if (size5 > maxResponseBodySize) {
        await reader.cancel();
        throw new ResponseBodyTooLargeError({
          maxSize: maxResponseBodySize,
          size: size5
        });
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}
function parseUrl(url_) {
  try {
    const url = new URL(url_);
    const result = (() => {
      if (url.username) {
        const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
        url.username = "";
        url.password = "";
        return {
          url: url.toString(),
          headers: { Authorization: `Basic ${btoa(credentials)}` }
        };
      }
      return;
    })();
    return { url: url.toString(), ...result };
  } catch {
    return { url: url_ };
  }
}

// node_modules/viem/_esm/constants/strings.js
var presignMessagePrefix = "Ethereum Signed Message:\n";

// node_modules/viem/_esm/utils/signature/toPrefixedMessage.js
function toPrefixedMessage(message_) {
  const message = (() => {
    if (typeof message_ === "string")
      return stringToHex(message_);
    if (typeof message_.raw === "string")
      return message_.raw;
    return bytesToHex(message_.raw);
  })();
  const prefix = stringToHex(`${presignMessagePrefix}${size(message)}`);
  return concat([prefix, message]);
}

// node_modules/viem/_esm/utils/signature/hashMessage.js
function hashMessage(message, to_) {
  return keccak256(toPrefixedMessage(message), to_);
}

// node_modules/viem/_esm/errors/typedData.js
var InvalidDomainError = class extends BaseError {
  constructor({ domain }) {
    super(`Invalid domain "${stringify(domain)}".`, {
      metaMessages: ["Must be a valid EIP-712 domain."]
    });
  }
};
var InvalidPrimaryTypeError = class extends BaseError {
  constructor({ primaryType, types }) {
    super(`Invalid primary type \`${primaryType}\` must be one of \`${JSON.stringify(Object.keys(types))}\`.`, {
      docsPath: "/api/glossary/Errors#typeddatainvalidprimarytypeerror",
      metaMessages: ["Check that the primary type is a key in `types`."]
    });
  }
};
var InvalidStructTypeError = class extends BaseError {
  constructor({ type }) {
    super(`Struct type "${type}" is invalid.`, {
      metaMessages: ["Struct type must not be a Solidity type."],
      name: "InvalidStructTypeError"
    });
  }
};
var InvalidTypedDataTypeError = class extends BaseError {
  constructor({ type }) {
    const canonicalType = type.replace(/^(u?int)/, "$&256");
    super(`Type "${type}" is not a valid EIP-712 type.`, {
      metaMessages: [`Use "${canonicalType}" instead.`],
      name: "InvalidTypedDataTypeError"
    });
  }
};

// node_modules/viem/_esm/utils/typedData.js
function validateTypedData(parameters) {
  const { domain, message, primaryType, types } = parameters;
  const validateData = (struct, data) => {
    for (const param of struct) {
      const { name, type } = param;
      const value = data[name];
      const baseType = type.replace(/(\[[0-9]*\])+$/, "");
      if (baseType === "int" || baseType === "uint")
        throw new InvalidTypedDataTypeError({ type });
      const integerMatch = type.match(integerRegex);
      if (integerMatch && (typeof value === "number" || typeof value === "bigint")) {
        const [_type, base, size_] = integerMatch;
        numberToHex(value, {
          signed: base === "int",
          size: Number.parseInt(size_, 10) / 8
        });
      }
      if (type === "address" && typeof value === "string" && !isAddress(value))
        throw new InvalidAddressError({ address: value });
      const bytesMatch = type.match(bytesRegex);
      if (bytesMatch) {
        const [_type, size_] = bytesMatch;
        if (size_ && size(value) !== Number.parseInt(size_, 10))
          throw new BytesSizeMismatchError({
            expectedSize: Number.parseInt(size_, 10),
            givenSize: size(value)
          });
      }
      const struct2 = types[type];
      if (struct2) {
        validateReference(type);
        validateData(struct2, value);
      }
    }
  };
  if (types.EIP712Domain && domain) {
    if (typeof domain !== "object")
      throw new InvalidDomainError({ domain });
    validateData(types.EIP712Domain, domain);
  }
  if (primaryType !== "EIP712Domain") {
    if (types[primaryType])
      validateData(types[primaryType], message);
    else
      throw new InvalidPrimaryTypeError({ primaryType, types });
  }
}
function getTypesForEIP712Domain({ domain }) {
  return [
    typeof domain?.name === "string" && { name: "name", type: "string" },
    domain?.version && { name: "version", type: "string" },
    (typeof domain?.chainId === "number" || typeof domain?.chainId === "bigint") && {
      name: "chainId",
      type: "uint256"
    },
    domain?.verifyingContract && {
      name: "verifyingContract",
      type: "address"
    },
    domain?.salt && { name: "salt", type: "bytes32" }
  ].filter(Boolean);
}
function validateReference(type) {
  if (type === "address" || type === "bool" || type === "string" || type.startsWith("bytes") || type.startsWith("uint") || type.startsWith("int"))
    throw new InvalidStructTypeError({ type });
}

// node_modules/viem/_esm/utils/signature/hashTypedData.js
function hashTypedData(parameters) {
  const { domain = {}, message, primaryType } = parameters;
  const types = {
    EIP712Domain: getTypesForEIP712Domain({ domain }),
    ...parameters.types
  };
  validateTypedData({
    domain,
    message,
    primaryType,
    types
  });
  const parts = ["0x1901"];
  if (domain)
    parts.push(hashDomain({
      domain,
      types
    }));
  if (primaryType !== "EIP712Domain")
    parts.push(hashStruct({
      data: message,
      primaryType,
      types
    }));
  return keccak256(concat(parts));
}
function hashDomain({ domain, types }) {
  return hashStruct({
    data: domain,
    primaryType: "EIP712Domain",
    types
  });
}
function hashStruct({ data, primaryType, types }) {
  const encoded = encodeData({
    data,
    primaryType,
    types
  });
  return keccak256(encoded);
}
function encodeData({ data, primaryType, types }) {
  const encodedTypes = [{ type: "bytes32" }];
  const encodedValues = [hashType({ primaryType, types })];
  for (const field of types[primaryType]) {
    const [type, value] = encodeField({
      types,
      name: field.name,
      type: field.type,
      value: data[field.name]
    });
    encodedTypes.push(type);
    encodedValues.push(value);
  }
  return encodeAbiParameters(encodedTypes, encodedValues);
}
function hashType({ primaryType, types }) {
  const encodedHashType = toHex(encodeType({ primaryType, types }));
  return keccak256(encodedHashType);
}
function encodeType({ primaryType, types }) {
  let result = "";
  const unsortedDeps = findTypeDependencies({ primaryType, types });
  unsortedDeps.delete(primaryType);
  const deps = [primaryType, ...Array.from(unsortedDeps).sort()];
  for (const type of deps) {
    result += `${type}(${types[type].map(({ name, type: t2 }) => `${t2} ${name}`).join(",")})`;
  }
  return result;
}
function findTypeDependencies({ primaryType: primaryType_, types }, results = /* @__PURE__ */ new Set()) {
  const match = primaryType_.match(/^\w*/u);
  const primaryType = match?.[0];
  if (results.has(primaryType) || types[primaryType] === void 0) {
    return results;
  }
  results.add(primaryType);
  for (const field of types[primaryType]) {
    findTypeDependencies({ primaryType: field.type, types }, results);
  }
  return results;
}
function encodeField({ types, name, type, value }) {
  if (types[type] !== void 0) {
    return [
      { type: "bytes32" },
      keccak256(encodeData({ data: value, primaryType: type, types }))
    ];
  }
  if (type === "bytes")
    return [{ type: "bytes32" }, keccak256(value)];
  if (type === "string")
    return [{ type: "bytes32" }, keccak256(toHex(value))];
  if (type.lastIndexOf("]") === type.length - 1) {
    const parsedType = type.slice(0, type.lastIndexOf("["));
    const typeValuePairs = value.map((item) => encodeField({
      name,
      type: parsedType,
      types,
      value: item
    }));
    return [
      { type: "bytes32" },
      keccak256(encodeAbiParameters(typeValuePairs.map(([t2]) => t2), typeValuePairs.map(([, v4]) => v4)))
    ];
  }
  return [{ type }, value];
}

// node_modules/ox/_esm/erc8010/SignatureErc8010.js
var SignatureErc8010_exports = {};
__export(SignatureErc8010_exports, {
  InvalidWrappedSignatureError: () => InvalidWrappedSignatureError,
  assert: () => assert4,
  from: () => from9,
  magicBytes: () => magicBytes,
  suffixParameters: () => suffixParameters,
  unwrap: () => unwrap,
  validate: () => validate4,
  wrap: () => wrap
});

// node_modules/ox/_esm/core/internal/lru.js
var LruMap2 = class extends Map {
  constructor(size5) {
    super();
    Object.defineProperty(this, "maxSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.maxSize = size5;
  }
  get(key) {
    const value = super.get(key);
    if (super.has(key) && value !== void 0) {
      this.delete(key);
      super.set(key, value);
    }
    return value;
  }
  set(key, value) {
    super.set(key, value);
    if (this.maxSize && this.size > this.maxSize) {
      const firstKey = this.keys().next().value;
      if (firstKey)
        this.delete(firstKey);
    }
    return this;
  }
};

// node_modules/ox/_esm/core/Caches.js
var caches = {
  checksum: /* @__PURE__ */ new LruMap2(8192)
};
var checksum = caches.checksum;

// node_modules/ox/_esm/core/Hash.js
function keccak2562(value, options = {}) {
  const { as = typeof value === "string" ? "Hex" : "Bytes" } = options;
  const bytes = keccak_256(from(value));
  if (as === "Bytes")
    return bytes;
  return fromBytes(bytes);
}

// node_modules/ox/_esm/core/PublicKey.js
function assert(publicKey, options = {}) {
  const { compressed } = options;
  const { prefix, x: x5, y: y5 } = publicKey;
  if (compressed === false || typeof x5 === "bigint" && typeof y5 === "bigint") {
    if (prefix !== 4)
      throw new InvalidPrefixError({
        prefix,
        cause: new InvalidUncompressedPrefixError()
      });
    return;
  }
  if (compressed === true || typeof x5 === "bigint" && typeof y5 === "undefined") {
    if (prefix !== 3 && prefix !== 2)
      throw new InvalidPrefixError({
        prefix,
        cause: new InvalidCompressedPrefixError()
      });
    return;
  }
  throw new InvalidError({ publicKey });
}
function from3(value) {
  const publicKey = (() => {
    if (validate2(value))
      return fromHex2(value);
    if (validate(value))
      return fromBytes2(value);
    const { prefix, x: x5, y: y5 } = value;
    if (typeof x5 === "bigint" && typeof y5 === "bigint")
      return { prefix: prefix ?? 4, x: x5, y: y5 };
    return { prefix, x: x5 };
  })();
  assert(publicKey);
  return publicKey;
}
function fromBytes2(publicKey) {
  return fromHex2(fromBytes(publicKey));
}
function fromHex2(publicKey) {
  if (publicKey.length !== 132 && publicKey.length !== 130 && publicKey.length !== 68)
    throw new InvalidSerializedSizeError({ publicKey });
  if (publicKey.length === 130) {
    const x6 = BigInt(slice3(publicKey, 0, 32));
    const y5 = BigInt(slice3(publicKey, 32, 64));
    return {
      prefix: 4,
      x: x6,
      y: y5
    };
  }
  if (publicKey.length === 132) {
    const prefix2 = Number(slice3(publicKey, 0, 1));
    const x6 = BigInt(slice3(publicKey, 1, 33));
    const y5 = BigInt(slice3(publicKey, 33, 65));
    return {
      prefix: prefix2,
      x: x6,
      y: y5
    };
  }
  const prefix = Number(slice3(publicKey, 0, 1));
  const x5 = BigInt(slice3(publicKey, 1, 33));
  return {
    prefix,
    x: x5
  };
}
function toHex2(publicKey, options = {}) {
  assert(publicKey);
  const { prefix, x: x5, y: y5 } = publicKey;
  const { includePrefix = true } = options;
  const publicKey_ = concat2(
    includePrefix ? fromNumber(prefix, { size: 1 }) : "0x",
    fromNumber(x5, { size: 32 }),
    // If the public key is not compressed, add the y coordinate.
    typeof y5 === "bigint" ? fromNumber(y5, { size: 32 }) : "0x"
  );
  return publicKey_;
}
var InvalidError = class extends BaseError2 {
  constructor({ publicKey }) {
    super(`Value \`${stringify2(publicKey)}\` is not a valid public key.`, {
      metaMessages: [
        "Public key must contain:",
        "- an `x` and `prefix` value (compressed)",
        "- an `x`, `y`, and `prefix` value (uncompressed)"
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "PublicKey.InvalidError"
    });
  }
};
var InvalidPrefixError = class extends BaseError2 {
  constructor({ prefix, cause }) {
    super(`Prefix "${prefix}" is invalid.`, {
      cause
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "PublicKey.InvalidPrefixError"
    });
  }
};
var InvalidCompressedPrefixError = class extends BaseError2 {
  constructor() {
    super("Prefix must be 2 or 3 for compressed public keys.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "PublicKey.InvalidCompressedPrefixError"
    });
  }
};
var InvalidUncompressedPrefixError = class extends BaseError2 {
  constructor() {
    super("Prefix must be 4 for uncompressed public keys.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "PublicKey.InvalidUncompressedPrefixError"
    });
  }
};
var InvalidSerializedSizeError = class extends BaseError2 {
  constructor({ publicKey }) {
    super(`Value \`${publicKey}\` is an invalid public key size.`, {
      metaMessages: [
        "Expected: 33 bytes (compressed + prefix), 64 bytes (uncompressed) or 65 bytes (uncompressed + prefix).",
        `Received ${size3(from2(publicKey))} bytes.`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "PublicKey.InvalidSerializedSizeError"
    });
  }
};

// node_modules/ox/_esm/core/Address.js
var addressRegex = /^0x[a-fA-F0-9]{40}$/;
function assert2(value, options = {}) {
  const { strict = true } = options;
  if (!addressRegex.test(value))
    throw new InvalidAddressError2({
      address: value,
      cause: new InvalidInputError()
    });
  if (strict) {
    if (value.toLowerCase() === value)
      return;
    if (checksum2(value) !== value)
      throw new InvalidAddressError2({
        address: value,
        cause: new InvalidChecksumError()
      });
  }
}
function checksum2(address) {
  if (checksum.has(address))
    return checksum.get(address);
  assert2(address, { strict: false });
  const hexAddress = address.substring(2).toLowerCase();
  const hash2 = keccak2562(fromString(hexAddress), { as: "Bytes" });
  const characters = hexAddress.split("");
  for (let i5 = 0; i5 < 40; i5 += 2) {
    if (hash2[i5 >> 1] >> 4 >= 8 && characters[i5]) {
      characters[i5] = characters[i5].toUpperCase();
    }
    if ((hash2[i5 >> 1] & 15) >= 8 && characters[i5 + 1]) {
      characters[i5 + 1] = characters[i5 + 1].toUpperCase();
    }
  }
  const result = `0x${characters.join("")}`;
  checksum.set(address, result);
  return result;
}
function from4(address, options = {}) {
  const { checksum: checksumVal = false } = options;
  assert2(address);
  if (checksumVal)
    return checksum2(address);
  return address;
}
function fromPublicKey(publicKey, options = {}) {
  const address = keccak2562(`0x${toHex2(publicKey).slice(4)}`).substring(26);
  return from4(`0x${address}`, options);
}
function validate3(address, options = {}) {
  const { strict = true } = options ?? {};
  try {
    assert2(address, { strict });
    return true;
  } catch {
    return false;
  }
}
var InvalidAddressError2 = class extends BaseError2 {
  constructor({ address, cause }) {
    super(`Address "${address}" is invalid.`, {
      cause
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Address.InvalidAddressError"
    });
  }
};
var InvalidInputError = class extends BaseError2 {
  constructor() {
    super("Address is not a 20 byte (40 hexadecimal character) value.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Address.InvalidInputError"
    });
  }
};
var InvalidChecksumError = class extends BaseError2 {
  constructor() {
    super("Address does not match its checksum counterpart.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Address.InvalidChecksumError"
    });
  }
};

// node_modules/ox/_esm/core/Solidity.js
var arrayRegex = /^(.*)\[([0-9]*)\]$/;
var bytesRegex2 = /^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/;
var integerRegex2 = /^(u?int)(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/;
var maxInt8 = 2n ** (8n - 1n) - 1n;
var maxInt16 = 2n ** (16n - 1n) - 1n;
var maxInt24 = 2n ** (24n - 1n) - 1n;
var maxInt32 = 2n ** (32n - 1n) - 1n;
var maxInt40 = 2n ** (40n - 1n) - 1n;
var maxInt48 = 2n ** (48n - 1n) - 1n;
var maxInt56 = 2n ** (56n - 1n) - 1n;
var maxInt64 = 2n ** (64n - 1n) - 1n;
var maxInt72 = 2n ** (72n - 1n) - 1n;
var maxInt80 = 2n ** (80n - 1n) - 1n;
var maxInt88 = 2n ** (88n - 1n) - 1n;
var maxInt96 = 2n ** (96n - 1n) - 1n;
var maxInt104 = 2n ** (104n - 1n) - 1n;
var maxInt112 = 2n ** (112n - 1n) - 1n;
var maxInt120 = 2n ** (120n - 1n) - 1n;
var maxInt128 = 2n ** (128n - 1n) - 1n;
var maxInt136 = 2n ** (136n - 1n) - 1n;
var maxInt144 = 2n ** (144n - 1n) - 1n;
var maxInt152 = 2n ** (152n - 1n) - 1n;
var maxInt160 = 2n ** (160n - 1n) - 1n;
var maxInt168 = 2n ** (168n - 1n) - 1n;
var maxInt176 = 2n ** (176n - 1n) - 1n;
var maxInt184 = 2n ** (184n - 1n) - 1n;
var maxInt192 = 2n ** (192n - 1n) - 1n;
var maxInt200 = 2n ** (200n - 1n) - 1n;
var maxInt208 = 2n ** (208n - 1n) - 1n;
var maxInt216 = 2n ** (216n - 1n) - 1n;
var maxInt224 = 2n ** (224n - 1n) - 1n;
var maxInt232 = 2n ** (232n - 1n) - 1n;
var maxInt240 = 2n ** (240n - 1n) - 1n;
var maxInt248 = 2n ** (248n - 1n) - 1n;
var maxInt256 = 2n ** (256n - 1n) - 1n;
var minInt8 = -(2n ** (8n - 1n));
var minInt16 = -(2n ** (16n - 1n));
var minInt24 = -(2n ** (24n - 1n));
var minInt32 = -(2n ** (32n - 1n));
var minInt40 = -(2n ** (40n - 1n));
var minInt48 = -(2n ** (48n - 1n));
var minInt56 = -(2n ** (56n - 1n));
var minInt64 = -(2n ** (64n - 1n));
var minInt72 = -(2n ** (72n - 1n));
var minInt80 = -(2n ** (80n - 1n));
var minInt88 = -(2n ** (88n - 1n));
var minInt96 = -(2n ** (96n - 1n));
var minInt104 = -(2n ** (104n - 1n));
var minInt112 = -(2n ** (112n - 1n));
var minInt120 = -(2n ** (120n - 1n));
var minInt128 = -(2n ** (128n - 1n));
var minInt136 = -(2n ** (136n - 1n));
var minInt144 = -(2n ** (144n - 1n));
var minInt152 = -(2n ** (152n - 1n));
var minInt160 = -(2n ** (160n - 1n));
var minInt168 = -(2n ** (168n - 1n));
var minInt176 = -(2n ** (176n - 1n));
var minInt184 = -(2n ** (184n - 1n));
var minInt192 = -(2n ** (192n - 1n));
var minInt200 = -(2n ** (200n - 1n));
var minInt208 = -(2n ** (208n - 1n));
var minInt216 = -(2n ** (216n - 1n));
var minInt224 = -(2n ** (224n - 1n));
var minInt232 = -(2n ** (232n - 1n));
var minInt240 = -(2n ** (240n - 1n));
var minInt248 = -(2n ** (248n - 1n));
var minInt256 = -(2n ** (256n - 1n));
var maxUint8 = 2n ** 8n - 1n;
var maxUint16 = 2n ** 16n - 1n;
var maxUint24 = 2n ** 24n - 1n;
var maxUint32 = 2n ** 32n - 1n;
var maxUint40 = 2n ** 40n - 1n;
var maxUint48 = 2n ** 48n - 1n;
var maxUint56 = 2n ** 56n - 1n;
var maxUint64 = 2n ** 64n - 1n;
var maxUint72 = 2n ** 72n - 1n;
var maxUint80 = 2n ** 80n - 1n;
var maxUint88 = 2n ** 88n - 1n;
var maxUint96 = 2n ** 96n - 1n;
var maxUint104 = 2n ** 104n - 1n;
var maxUint112 = 2n ** 112n - 1n;
var maxUint120 = 2n ** 120n - 1n;
var maxUint128 = 2n ** 128n - 1n;
var maxUint136 = 2n ** 136n - 1n;
var maxUint144 = 2n ** 144n - 1n;
var maxUint152 = 2n ** 152n - 1n;
var maxUint160 = 2n ** 160n - 1n;
var maxUint168 = 2n ** 168n - 1n;
var maxUint176 = 2n ** 176n - 1n;
var maxUint184 = 2n ** 184n - 1n;
var maxUint192 = 2n ** 192n - 1n;
var maxUint200 = 2n ** 200n - 1n;
var maxUint208 = 2n ** 208n - 1n;
var maxUint216 = 2n ** 216n - 1n;
var maxUint224 = 2n ** 224n - 1n;
var maxUint232 = 2n ** 232n - 1n;
var maxUint240 = 2n ** 240n - 1n;
var maxUint248 = 2n ** 248n - 1n;
var maxUint256 = 2n ** 256n - 1n;

// node_modules/ox/_esm/core/internal/abiParameters.js
function decodeParameter(cursor, param, options) {
  const { checksumAddress: checksumAddress2, staticPosition } = options;
  const arrayComponents = getArrayComponents(param.type);
  if (arrayComponents) {
    const [length, type] = arrayComponents;
    return decodeArray(cursor, { ...param, type }, { checksumAddress: checksumAddress2, length, staticPosition });
  }
  if (param.type === "tuple")
    return decodeTuple(cursor, param, {
      checksumAddress: checksumAddress2,
      staticPosition
    });
  if (param.type === "address")
    return decodeAddress2(cursor, { checksum: checksumAddress2 });
  if (param.type === "bool")
    return decodeBool(cursor);
  if (param.type.startsWith("bytes"))
    return decodeBytes(cursor, param, { staticPosition });
  if (param.type.startsWith("uint") || param.type.startsWith("int"))
    return decodeNumber(cursor, param);
  if (param.type === "string")
    return decodeString(cursor, { staticPosition });
  throw new InvalidTypeError(param.type);
}
var sizeOfLength = 32;
var sizeOfOffset = 32;
function decodeAddress2(cursor, options = {}) {
  const { checksum: checksum3 = false } = options;
  const value = cursor.readBytes(32);
  const wrap3 = (address) => checksum3 ? checksum2(address) : address;
  return [wrap3(fromBytes(slice2(value, -20))), 32];
}
function decodeArray(cursor, param, options) {
  const { checksumAddress: checksumAddress2, length, staticPosition } = options;
  if (length === null) {
    const offset = toNumber(cursor.readBytes(sizeOfOffset));
    const start = staticPosition + offset;
    const startOfData = start + sizeOfLength;
    cursor.setPosition(start);
    const length2 = toNumber(cursor.readBytes(sizeOfLength));
    const dynamicChild = hasDynamicChild(param);
    let consumed2 = 0;
    const value2 = [];
    for (let i5 = 0; i5 < length2; ++i5) {
      cursor.setPosition(startOfData + (dynamicChild ? i5 * 32 : consumed2));
      const [data, consumed_] = decodeParameter(cursor, param, {
        checksumAddress: checksumAddress2,
        staticPosition: startOfData
      });
      consumed2 += consumed_;
      value2.push(data);
      if (consumed_ === 0) {
        cursor.assertReadLimit();
        cursor._touch();
      }
    }
    cursor.setPosition(staticPosition + 32);
    return [value2, 32];
  }
  if (hasDynamicChild(param)) {
    const offset = toNumber(cursor.readBytes(sizeOfOffset));
    const start = staticPosition + offset;
    const value2 = [];
    for (let i5 = 0; i5 < length; ++i5) {
      cursor.setPosition(start + i5 * 32);
      const [data] = decodeParameter(cursor, param, {
        checksumAddress: checksumAddress2,
        staticPosition: start
      });
      value2.push(data);
    }
    cursor.setPosition(staticPosition + 32);
    return [value2, 32];
  }
  let consumed = 0;
  const value = [];
  for (let i5 = 0; i5 < length; ++i5) {
    const [data, consumed_] = decodeParameter(cursor, param, {
      checksumAddress: checksumAddress2,
      staticPosition: staticPosition + consumed
    });
    consumed += consumed_;
    value.push(data);
    if (consumed_ === 0) {
      cursor.assertReadLimit();
      cursor._touch();
    }
  }
  return [value, consumed];
}
function decodeBool(cursor) {
  return [toBoolean(cursor.readBytes(32), { size: 32 }), 32];
}
function decodeBytes(cursor, param, { staticPosition }) {
  const [_5, size5] = param.type.split("bytes");
  if (!size5) {
    const offset = toNumber(cursor.readBytes(32));
    cursor.setPosition(staticPosition + offset);
    const length = toNumber(cursor.readBytes(32));
    if (length === 0) {
      cursor.setPosition(staticPosition + 32);
      return ["0x", 32];
    }
    const data = cursor.readBytes(length);
    cursor.setPosition(staticPosition + 32);
    return [fromBytes(data), 32];
  }
  const value = fromBytes(cursor.readBytes(Number.parseInt(size5, 10), 32));
  return [value, 32];
}
function decodeNumber(cursor, param) {
  const signed = param.type.startsWith("int");
  const size5 = Number.parseInt(param.type.split("int")[1] || "256", 10);
  const value = cursor.readBytes(32);
  return [
    size5 > 48 ? toBigInt(value, { signed }) : toNumber(value, { signed }),
    32
  ];
}
function decodeTuple(cursor, param, options) {
  const { checksumAddress: checksumAddress2, staticPosition } = options;
  const hasUnnamedChild = param.components.length === 0 || param.components.some(({ name }) => !name);
  const value = hasUnnamedChild ? [] : {};
  let consumed = 0;
  if (hasDynamicChild(param)) {
    const offset = toNumber(cursor.readBytes(sizeOfOffset));
    const start = staticPosition + offset;
    for (let i5 = 0; i5 < param.components.length; ++i5) {
      const component = param.components[i5];
      cursor.setPosition(start + consumed);
      const [data, consumed_] = decodeParameter(cursor, component, {
        checksumAddress: checksumAddress2,
        staticPosition: start
      });
      consumed += consumed_;
      value[hasUnnamedChild ? i5 : component?.name] = data;
    }
    cursor.setPosition(staticPosition + 32);
    return [value, 32];
  }
  for (let i5 = 0; i5 < param.components.length; ++i5) {
    const component = param.components[i5];
    const [data, consumed_] = decodeParameter(cursor, component, {
      checksumAddress: checksumAddress2,
      staticPosition
    });
    value[hasUnnamedChild ? i5 : component?.name] = data;
    consumed += consumed_;
  }
  return [value, consumed];
}
function decodeString(cursor, { staticPosition }) {
  const offset = toNumber(cursor.readBytes(32));
  const start = staticPosition + offset;
  cursor.setPosition(start);
  const length = toNumber(cursor.readBytes(32));
  if (length === 0) {
    cursor.setPosition(staticPosition + 32);
    return ["", 32];
  }
  const data = cursor.readBytes(length, 32);
  const value = toString(trimLeft(data));
  cursor.setPosition(staticPosition + 32);
  return [value, 32];
}
function prepareParameters({ checksumAddress: checksumAddress2, parameters, values }) {
  const preparedParameters = [];
  for (let i5 = 0; i5 < parameters.length; i5++) {
    preparedParameters.push(prepareParameter({
      checksumAddress: checksumAddress2,
      parameter: parameters[i5],
      value: values[i5]
    }));
  }
  return preparedParameters;
}
function prepareParameter({ checksumAddress: checksumAddress2 = false, parameter: parameter_, value }) {
  const parameter = parameter_;
  const arrayComponents = getArrayComponents(parameter.type);
  if (arrayComponents) {
    const [length, type] = arrayComponents;
    return encodeArray(value, {
      checksumAddress: checksumAddress2,
      length,
      parameter: {
        ...parameter,
        type
      }
    });
  }
  if (parameter.type === "tuple") {
    return encodeTuple(value, {
      checksumAddress: checksumAddress2,
      parameter
    });
  }
  if (parameter.type === "address") {
    return encodeAddress(value, {
      checksum: checksumAddress2
    });
  }
  if (parameter.type === "bool") {
    return encodeBoolean(value);
  }
  if (parameter.type.startsWith("uint") || parameter.type.startsWith("int")) {
    const signed = parameter.type.startsWith("int");
    const [, , size5 = "256"] = integerRegex2.exec(parameter.type) ?? [];
    return encodeNumber(value, {
      signed,
      size: Number(size5)
    });
  }
  if (parameter.type.startsWith("bytes")) {
    return encodeBytes(value, { type: parameter.type });
  }
  if (parameter.type === "string") {
    return encodeString(value);
  }
  throw new InvalidTypeError(parameter.type);
}
function encode(preparedParameters) {
  let staticSize = 0;
  for (let i5 = 0; i5 < preparedParameters.length; i5++) {
    const { dynamic, encoded } = preparedParameters[i5];
    if (dynamic)
      staticSize += 32;
    else
      staticSize += size3(encoded);
  }
  const staticParameters = [];
  const dynamicParameters = [];
  let dynamicSize = 0;
  for (let i5 = 0; i5 < preparedParameters.length; i5++) {
    const { dynamic, encoded } = preparedParameters[i5];
    if (dynamic) {
      staticParameters.push(fromNumber(staticSize + dynamicSize, { size: 32 }));
      dynamicParameters.push(encoded);
      dynamicSize += size3(encoded);
    } else {
      staticParameters.push(encoded);
    }
  }
  return concat2(...staticParameters, ...dynamicParameters);
}
function encodeAddress(value, options) {
  const { checksum: checksum3 = false } = options;
  assert2(value, { strict: checksum3 });
  return {
    dynamic: false,
    encoded: padLeft(value.toLowerCase())
  };
}
function encodeArray(value, options) {
  const { checksumAddress: checksumAddress2, length, parameter } = options;
  const dynamic = length === null;
  if (!Array.isArray(value))
    throw new InvalidArrayError(value);
  if (!dynamic && value.length !== length)
    throw new ArrayLengthMismatchError({
      expectedLength: length,
      givenLength: value.length,
      type: `${parameter.type}[${length}]`
    });
  let dynamicChild = value.length === 0 && hasDynamicChild(parameter);
  const preparedParameters = [];
  for (let i5 = 0; i5 < value.length; i5++) {
    const preparedParam = prepareParameter({
      checksumAddress: checksumAddress2,
      parameter,
      value: value[i5]
    });
    if (preparedParam.dynamic)
      dynamicChild = true;
    preparedParameters.push(preparedParam);
  }
  if (dynamic || dynamicChild) {
    const data = encode(preparedParameters);
    if (dynamic) {
      const length2 = fromNumber(preparedParameters.length, { size: 32 });
      return {
        dynamic: true,
        encoded: preparedParameters.length > 0 ? concat2(length2, data) : length2
      };
    }
    if (dynamicChild)
      return { dynamic: true, encoded: data };
  }
  return {
    dynamic: false,
    encoded: concat2(...preparedParameters.map(({ encoded }) => encoded))
  };
}
function encodeBytes(value, { type }) {
  const [, parametersize] = type.split("bytes");
  const bytesSize = size3(value);
  if (!parametersize) {
    let value_ = value;
    if (bytesSize % 32 !== 0)
      value_ = padRight(value_, Math.ceil((value.length - 2) / 2 / 32) * 32);
    return {
      dynamic: true,
      encoded: concat2(padLeft(fromNumber(bytesSize, { size: 32 })), value_)
    };
  }
  if (bytesSize !== Number.parseInt(parametersize, 10))
    throw new BytesSizeMismatchError2({
      expectedSize: Number.parseInt(parametersize, 10),
      value
    });
  return { dynamic: false, encoded: padRight(value) };
}
function encodeBoolean(value) {
  if (typeof value !== "boolean")
    throw new BaseError2(`Invalid boolean value: "${value}" (type: ${typeof value}). Expected: \`true\` or \`false\`.`);
  return { dynamic: false, encoded: padLeft(fromBoolean(value)) };
}
function encodeNumber(value, { signed, size: size5 }) {
  if (typeof size5 === "number") {
    const max = 2n ** (BigInt(size5) - (signed ? 1n : 0n)) - 1n;
    const min = signed ? -max - 1n : 0n;
    if (value > max || value < min)
      throw new IntegerOutOfRangeError({
        max: max.toString(),
        min: min.toString(),
        signed,
        size: size5 / 8,
        value: value.toString()
      });
  }
  return {
    dynamic: false,
    encoded: fromNumber(value, {
      size: 32,
      signed
    })
  };
}
function encodeString(value) {
  const hexValue = fromString2(value);
  const partsLength = Math.ceil(size3(hexValue) / 32);
  const parts = [];
  for (let i5 = 0; i5 < partsLength; i5++) {
    parts.push(padRight(slice3(hexValue, i5 * 32, (i5 + 1) * 32)));
  }
  return {
    dynamic: true,
    encoded: concat2(padRight(fromNumber(size3(hexValue), { size: 32 })), ...parts)
  };
}
function encodeTuple(value, options) {
  const { checksumAddress: checksumAddress2, parameter } = options;
  let dynamic = false;
  const preparedParameters = [];
  for (let i5 = 0; i5 < parameter.components.length; i5++) {
    const param_ = parameter.components[i5];
    const index2 = Array.isArray(value) ? i5 : param_.name;
    const preparedParam = prepareParameter({
      checksumAddress: checksumAddress2,
      parameter: param_,
      value: value[index2]
    });
    preparedParameters.push(preparedParam);
    if (preparedParam.dynamic)
      dynamic = true;
  }
  return {
    dynamic,
    encoded: dynamic ? encode(preparedParameters) : concat2(...preparedParameters.map(({ encoded }) => encoded))
  };
}
function getArrayComponents(type) {
  const matches = type.match(/^(.*)\[(\d+)?\]$/);
  return matches ? (
    // Return `null` if the array is dynamic.
    [matches[2] ? Number(matches[2]) : null, matches[1]]
  ) : void 0;
}
function hasDynamicChild(param) {
  const { type } = param;
  if (type === "string")
    return true;
  if (type === "bytes")
    return true;
  if (type.endsWith("[]"))
    return true;
  if (type === "tuple")
    return param.components?.some(hasDynamicChild);
  const arrayComponents = getArrayComponents(param.type);
  if (arrayComponents && hasDynamicChild({
    ...param,
    type: arrayComponents[1]
  }))
    return true;
  return false;
}

// node_modules/ox/_esm/core/internal/cursor.js
var staticCursor = {
  bytes: new Uint8Array(),
  dataView: new DataView(new ArrayBuffer(0)),
  position: 0,
  positionReadCount: /* @__PURE__ */ new Map(),
  recursiveReadCount: 0,
  recursiveReadLimit: Number.POSITIVE_INFINITY,
  assertReadLimit() {
    if (this.recursiveReadCount >= this.recursiveReadLimit)
      throw new RecursiveReadLimitExceededError({
        count: this.recursiveReadCount + 1,
        limit: this.recursiveReadLimit
      });
  },
  assertPosition(position) {
    if (position < 0 || position > this.bytes.length - 1)
      throw new PositionOutOfBoundsError2({
        length: this.bytes.length,
        position
      });
  },
  decrementPosition(offset) {
    if (offset < 0)
      throw new NegativeOffsetError({ offset });
    const position = this.position - offset;
    this.assertPosition(position);
    this.position = position;
  },
  getReadCount(position) {
    return this.positionReadCount.get(position || this.position) || 0;
  },
  incrementPosition(offset) {
    if (offset < 0)
      throw new NegativeOffsetError({ offset });
    const position = this.position + offset;
    this.assertPosition(position);
    this.position = position;
  },
  inspectByte(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position);
    return this.bytes[position];
  },
  inspectBytes(length, position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + length - 1);
    return this.bytes.subarray(position, position + length);
  },
  inspectUint8(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position);
    return this.bytes[position];
  },
  inspectUint16(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + 1);
    return this.dataView.getUint16(position);
  },
  inspectUint24(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + 2);
    return (this.dataView.getUint16(position) << 8) + this.dataView.getUint8(position + 2);
  },
  inspectUint32(position_) {
    const position = position_ ?? this.position;
    this.assertPosition(position + 3);
    return this.dataView.getUint32(position);
  },
  pushByte(byte) {
    this.assertPosition(this.position);
    this.bytes[this.position] = byte;
    this.position++;
  },
  pushBytes(bytes) {
    this.assertPosition(this.position + bytes.length - 1);
    this.bytes.set(bytes, this.position);
    this.position += bytes.length;
  },
  pushUint8(value) {
    this.assertPosition(this.position);
    this.bytes[this.position] = value;
    this.position++;
  },
  pushUint16(value) {
    this.assertPosition(this.position + 1);
    this.dataView.setUint16(this.position, value);
    this.position += 2;
  },
  pushUint24(value) {
    this.assertPosition(this.position + 2);
    this.dataView.setUint16(this.position, value >> 8);
    this.dataView.setUint8(this.position + 2, value & ~4294967040);
    this.position += 3;
  },
  pushUint32(value) {
    this.assertPosition(this.position + 3);
    this.dataView.setUint32(this.position, value);
    this.position += 4;
  },
  readByte() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectByte();
    this.position++;
    return value;
  },
  readBytes(length, size5) {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectBytes(length);
    this.position += size5 ?? length;
    return value;
  },
  readUint8() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint8();
    this.position += 1;
    return value;
  },
  readUint16() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint16();
    this.position += 2;
    return value;
  },
  readUint24() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint24();
    this.position += 3;
    return value;
  },
  readUint32() {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectUint32();
    this.position += 4;
    return value;
  },
  get remaining() {
    return this.bytes.length - this.position;
  },
  setPosition(position) {
    const oldPosition = this.position;
    this.assertPosition(position);
    this.position = position;
    return () => this.position = oldPosition;
  },
  _touch() {
    if (this.recursiveReadLimit === Number.POSITIVE_INFINITY)
      return;
    const count = this.getReadCount();
    this.positionReadCount.set(this.position, count + 1);
    if (count > 0)
      this.recursiveReadCount++;
  }
};
function create(bytes, { recursiveReadLimit = 8192 } = {}) {
  const cursor = Object.create(staticCursor);
  cursor.bytes = bytes;
  cursor.dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  cursor.positionReadCount = /* @__PURE__ */ new Map();
  cursor.recursiveReadLimit = recursiveReadLimit;
  return cursor;
}
var NegativeOffsetError = class extends BaseError2 {
  constructor({ offset }) {
    super(`Offset \`${offset}\` cannot be negative.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cursor.NegativeOffsetError"
    });
  }
};
var PositionOutOfBoundsError2 = class extends BaseError2 {
  constructor({ length, position }) {
    super(`Position \`${position}\` is out of bounds (\`0 < position < ${length}\`).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cursor.PositionOutOfBoundsError"
    });
  }
};
var RecursiveReadLimitExceededError = class extends BaseError2 {
  constructor({ count, limit }) {
    super(`Recursive read limit of \`${limit}\` exceeded (recursive read count: \`${count}\`).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cursor.RecursiveReadLimitExceededError"
    });
  }
};

// node_modules/ox/_esm/core/AbiParameters.js
function decode(parameters, data, options = {}) {
  const { as = "Array", checksumAddress: checksumAddress2 = false } = options;
  const bytes = typeof data === "string" ? fromHex(data) : data;
  const cursor = create(bytes);
  if (size2(bytes) === 0 && parameters.length > 0)
    throw new ZeroDataError();
  if (size2(bytes) && size2(bytes) < 32)
    throw new DataSizeTooSmallError({
      data: typeof data === "string" ? data : fromBytes(data),
      parameters,
      size: size2(bytes)
    });
  let consumed = 0;
  const values = as === "Array" ? [] : {};
  for (let i5 = 0; i5 < parameters.length; ++i5) {
    const param = parameters[i5];
    if (consumed < bytes.length)
      cursor.setPosition(consumed);
    const [data2, consumed_] = decodeParameter(cursor, param, {
      checksumAddress: checksumAddress2,
      staticPosition: 0
    });
    consumed += consumed_;
    if (as === "Array")
      values.push(data2);
    else
      values[param.name ?? i5] = data2;
  }
  return values;
}
function encode2(parameters, values, options) {
  const { checksumAddress: checksumAddress2 = false } = options ?? {};
  if (parameters.length !== values.length)
    throw new LengthMismatchError({
      expectedLength: parameters.length,
      givenLength: values.length
    });
  const preparedParameters = prepareParameters({
    checksumAddress: checksumAddress2,
    parameters,
    values
  });
  const data = encode(preparedParameters);
  if (data.length === 0)
    return "0x";
  return data;
}
function encodePacked(types, values) {
  if (types.length !== values.length)
    throw new LengthMismatchError({
      expectedLength: types.length,
      givenLength: values.length
    });
  const data = [];
  for (let i5 = 0; i5 < types.length; i5++) {
    const type = types[i5];
    const value = values[i5];
    data.push(encodePacked.encode(type, value));
  }
  return concat2(...data);
}
(function(encodePacked2) {
  function encode4(type, value, isArray = false) {
    if (type === "address") {
      const address = value;
      assert2(address);
      return padLeft(address.toLowerCase(), isArray ? 32 : 0);
    }
    if (type === "string")
      return fromString2(value);
    if (type === "bytes")
      return value;
    if (type === "bool")
      return padLeft(fromBoolean(value), isArray ? 32 : 1);
    const intMatch = type.match(integerRegex2);
    if (intMatch) {
      const [_type, baseType, bits = "256"] = intMatch;
      const size5 = Number.parseInt(bits, 10) / 8;
      return fromNumber(value, {
        size: isArray ? 32 : size5,
        signed: baseType === "int"
      });
    }
    const bytesMatch = type.match(bytesRegex2);
    if (bytesMatch) {
      const [_type, size5] = bytesMatch;
      if (Number.parseInt(size5, 10) !== (value.length - 2) / 2)
        throw new BytesSizeMismatchError2({
          expectedSize: Number.parseInt(size5, 10),
          value
        });
      return padRight(value, isArray ? 32 : 0);
    }
    const arrayMatch = type.match(arrayRegex);
    if (arrayMatch && Array.isArray(value)) {
      const [_type, childType] = arrayMatch;
      const data = [];
      for (let i5 = 0; i5 < value.length; i5++) {
        data.push(encode4(childType, value[i5], true));
      }
      if (data.length === 0)
        return "0x";
      return concat2(...data);
    }
    throw new InvalidTypeError(type);
  }
  encodePacked2.encode = encode4;
})(encodePacked || (encodePacked = {}));
function from5(parameters) {
  if (Array.isArray(parameters) && typeof parameters[0] === "string")
    return parseAbiParameters(parameters);
  if (typeof parameters === "string")
    return parseAbiParameters(parameters);
  return parameters;
}
var DataSizeTooSmallError = class extends BaseError2 {
  constructor({ data, parameters, size: size5 }) {
    super(`Data size of ${size5} bytes is too small for given parameters.`, {
      metaMessages: [
        `Params: (${formatAbiParameters(parameters)})`,
        `Data:   ${data} (${size5} bytes)`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.DataSizeTooSmallError"
    });
  }
};
var ZeroDataError = class extends BaseError2 {
  constructor() {
    super('Cannot decode zero data ("0x") with ABI parameters.');
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.ZeroDataError"
    });
  }
};
var ArrayLengthMismatchError = class extends BaseError2 {
  constructor({ expectedLength, givenLength, type }) {
    super(`Array length mismatch for type \`${type}\`. Expected: \`${expectedLength}\`. Given: \`${givenLength}\`.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.ArrayLengthMismatchError"
    });
  }
};
var BytesSizeMismatchError2 = class extends BaseError2 {
  constructor({ expectedSize, value }) {
    super(`Size of bytes "${value}" (bytes${size3(value)}) does not match expected size (bytes${expectedSize}).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.BytesSizeMismatchError"
    });
  }
};
var LengthMismatchError = class extends BaseError2 {
  constructor({ expectedLength, givenLength }) {
    super([
      "ABI encoding parameters/values length mismatch.",
      `Expected length (parameters): ${expectedLength}`,
      `Given length (values): ${givenLength}`
    ].join("\n"));
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.LengthMismatchError"
    });
  }
};
var InvalidArrayError = class extends BaseError2 {
  constructor(value) {
    super(`Value \`${value}\` is not a valid array.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.InvalidArrayError"
    });
  }
};
var InvalidTypeError = class extends BaseError2 {
  constructor(type) {
    super(`Type \`${type}\` is not a valid ABI Type.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.InvalidTypeError"
    });
  }
};

// node_modules/ox/_esm/core/Rlp.js
function from6(value, options) {
  const { as } = options;
  const encodable = getEncodable2(value);
  const cursor = create(new Uint8Array(encodable.length));
  encodable.encode(cursor);
  if (as === "Hex")
    return fromBytes(cursor.bytes);
  return cursor.bytes;
}
function fromHex3(hex, options = {}) {
  const { as = "Hex" } = options;
  return from6(hex, { as });
}
function getEncodable2(bytes) {
  if (Array.isArray(bytes))
    return getEncodableList2(bytes.map((x5) => getEncodable2(x5)));
  return getEncodableBytes2(bytes);
}
function getEncodableList2(list) {
  const bodyLength = list.reduce((acc, x5) => acc + x5.length, 0);
  const sizeOfBodyLength = getSizeOfLength2(bodyLength);
  const length = (() => {
    if (bodyLength <= 55)
      return 1 + bodyLength;
    return 1 + sizeOfBodyLength + bodyLength;
  })();
  return {
    length,
    encode(cursor) {
      if (bodyLength <= 55) {
        cursor.pushByte(192 + bodyLength);
      } else {
        cursor.pushByte(192 + 55 + sizeOfBodyLength);
        if (sizeOfBodyLength === 1)
          cursor.pushUint8(bodyLength);
        else if (sizeOfBodyLength === 2)
          cursor.pushUint16(bodyLength);
        else if (sizeOfBodyLength === 3)
          cursor.pushUint24(bodyLength);
        else
          cursor.pushUint32(bodyLength);
      }
      for (const { encode: encode4 } of list) {
        encode4(cursor);
      }
    }
  };
}
function getEncodableBytes2(bytesOrHex) {
  const bytes = typeof bytesOrHex === "string" ? fromHex(bytesOrHex) : bytesOrHex;
  const sizeOfBytesLength = getSizeOfLength2(bytes.length);
  const length = (() => {
    if (bytes.length === 1 && bytes[0] < 128)
      return 1;
    if (bytes.length <= 55)
      return 1 + bytes.length;
    return 1 + sizeOfBytesLength + bytes.length;
  })();
  return {
    length,
    encode(cursor) {
      if (bytes.length === 1 && bytes[0] < 128) {
        cursor.pushBytes(bytes);
      } else if (bytes.length <= 55) {
        cursor.pushByte(128 + bytes.length);
        cursor.pushBytes(bytes);
      } else {
        cursor.pushByte(128 + 55 + sizeOfBytesLength);
        if (sizeOfBytesLength === 1)
          cursor.pushUint8(bytes.length);
        else if (sizeOfBytesLength === 2)
          cursor.pushUint16(bytes.length);
        else if (sizeOfBytesLength === 3)
          cursor.pushUint24(bytes.length);
        else
          cursor.pushUint32(bytes.length);
        cursor.pushBytes(bytes);
      }
    }
  };
}
function getSizeOfLength2(length) {
  if (length <= 255)
    return 1;
  if (length <= 65535)
    return 2;
  if (length <= 16777215)
    return 3;
  if (length <= 4294967295)
    return 4;
  throw new BaseError2("Length is too large.");
}

// node_modules/ox/_esm/core/Signature.js
function assert3(signature, options = {}) {
  const { recovered } = options;
  if (typeof signature.r === "undefined")
    throw new MissingPropertiesError({ signature });
  if (typeof signature.s === "undefined")
    throw new MissingPropertiesError({ signature });
  if (recovered && typeof signature.yParity === "undefined")
    throw new MissingPropertiesError({ signature });
  if (signature.r < 0n || signature.r > maxUint256)
    throw new InvalidRError({ value: signature.r });
  if (signature.s < 0n || signature.s > maxUint256)
    throw new InvalidSError({ value: signature.s });
  if (typeof signature.yParity === "number" && signature.yParity !== 0 && signature.yParity !== 1)
    throw new InvalidYParityError({ value: signature.yParity });
}
function fromBytes3(signature) {
  return fromHex4(fromBytes(signature));
}
function fromHex4(signature) {
  if (signature.length !== 130 && signature.length !== 132)
    throw new InvalidSerializedSizeError2({ signature });
  const r3 = BigInt(slice3(signature, 0, 32));
  const s7 = BigInt(slice3(signature, 32, 64));
  const yParity = (() => {
    const yParity2 = Number(`0x${signature.slice(130)}`);
    if (Number.isNaN(yParity2))
      return void 0;
    try {
      return vToYParity(yParity2);
    } catch {
      throw new InvalidYParityError({ value: yParity2 });
    }
  })();
  if (typeof yParity === "undefined")
    return {
      r: r3,
      s: s7
    };
  return {
    r: r3,
    s: s7,
    yParity
  };
}
function extract2(value) {
  if (typeof value.r === "undefined")
    return void 0;
  if (typeof value.s === "undefined")
    return void 0;
  return from7(value);
}
function from7(signature) {
  const signature_ = (() => {
    if (typeof signature === "string")
      return fromHex4(signature);
    if (signature instanceof Uint8Array)
      return fromBytes3(signature);
    if (typeof signature.r === "string")
      return fromRpc(signature);
    if (signature.v)
      return fromLegacy(signature);
    return {
      r: signature.r,
      s: signature.s,
      ...typeof signature.yParity !== "undefined" ? { yParity: signature.yParity } : {}
    };
  })();
  assert3(signature_);
  return signature_;
}
function fromLegacy(signature) {
  return {
    r: signature.r,
    s: signature.s,
    yParity: vToYParity(signature.v)
  };
}
function fromRpc(signature) {
  const yParity = (() => {
    const v4 = signature.v ? Number(signature.v) : void 0;
    let yParity2 = signature.yParity ? Number(signature.yParity) : void 0;
    if (typeof v4 === "number" && typeof yParity2 !== "number")
      yParity2 = vToYParity(v4);
    if (typeof yParity2 !== "number")
      throw new InvalidYParityError({ value: signature.yParity });
    return yParity2;
  })();
  return {
    r: BigInt(signature.r),
    s: BigInt(signature.s),
    yParity
  };
}
function toTuple(signature) {
  const { r: r3, s: s7, yParity } = signature;
  return [
    yParity ? "0x01" : "0x",
    r3 === 0n ? "0x" : trimLeft2(fromNumber(r3)),
    s7 === 0n ? "0x" : trimLeft2(fromNumber(s7))
  ];
}
function vToYParity(v4) {
  if (v4 === 0 || v4 === 27)
    return 0;
  if (v4 === 1 || v4 === 28)
    return 1;
  if (v4 >= 35)
    return v4 % 2 === 0 ? 1 : 0;
  throw new InvalidVError({ value: v4 });
}
var InvalidSerializedSizeError2 = class extends BaseError2 {
  constructor({ signature }) {
    super(`Value \`${signature}\` is an invalid signature size.`, {
      metaMessages: [
        "Expected: 64 bytes or 65 bytes.",
        `Received ${size3(from2(signature))} bytes.`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.InvalidSerializedSizeError"
    });
  }
};
var MissingPropertiesError = class extends BaseError2 {
  constructor({ signature }) {
    super(`Signature \`${stringify2(signature)}\` is missing either an \`r\`, \`s\`, or \`yParity\` property.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.MissingPropertiesError"
    });
  }
};
var InvalidRError = class extends BaseError2 {
  constructor({ value }) {
    super(`Value \`${value}\` is an invalid r value. r must be a positive integer less than 2^256.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.InvalidRError"
    });
  }
};
var InvalidSError = class extends BaseError2 {
  constructor({ value }) {
    super(`Value \`${value}\` is an invalid s value. s must be a positive integer less than 2^256.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.InvalidSError"
    });
  }
};
var InvalidYParityError = class extends BaseError2 {
  constructor({ value }) {
    super(`Value \`${value}\` is an invalid y-parity value. Y-parity must be 0 or 1.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.InvalidYParityError"
    });
  }
};
var InvalidVError = class extends BaseError2 {
  constructor({ value }) {
    super(`Value \`${value}\` is an invalid v value. v must be 27, 28 or >=35.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.InvalidVError"
    });
  }
};

// node_modules/ox/_esm/core/Authorization.js
function from8(authorization, options = {}) {
  if (typeof authorization.chainId === "string")
    return fromRpc2(authorization);
  return { ...authorization, ...options.signature };
}
function fromRpc2(authorization) {
  const { address, chainId, nonce } = authorization;
  const signature = extract2(authorization);
  return {
    address,
    chainId: Number(chainId),
    nonce: BigInt(nonce),
    ...signature
  };
}
function getSignPayload(authorization) {
  return hash(authorization, { presign: true });
}
function hash(authorization, options = {}) {
  const { presign } = options;
  return keccak2562(concat2("0x05", fromHex3(toTuple2(presign ? {
    address: authorization.address,
    chainId: authorization.chainId,
    nonce: authorization.nonce
  } : authorization))));
}
function toTuple2(authorization) {
  const { address, chainId, nonce } = authorization;
  const signature = extract2(authorization);
  return [
    chainId ? fromNumber(chainId) : "0x",
    address,
    nonce ? fromNumber(nonce) : "0x",
    ...signature ? toTuple(signature) : []
  ];
}

// node_modules/ox/_esm/core/Secp256k1.js
function recoverAddress2(options) {
  return fromPublicKey(recoverPublicKey2(options));
}
function recoverPublicKey2(options) {
  const { payload, signature } = options;
  const { r: r3, s: s7, yParity } = signature;
  const signature_ = new secp256k1.Signature(BigInt(r3), BigInt(s7)).addRecoveryBit(yParity);
  const point = signature_.recoverPublicKey(from2(payload).substring(2));
  return from3(point);
}

// node_modules/ox/_esm/erc8010/SignatureErc8010.js
var magicBytes = "0x8010801080108010801080108010801080108010801080108010801080108010";
var suffixParameters = from5("(uint256 chainId, address delegation, uint256 nonce, uint8 yParity, uint256 r, uint256 s), address to, bytes data");
function assert4(value) {
  if (typeof value === "string") {
    if (slice3(value, -32) !== magicBytes)
      throw new InvalidWrappedSignatureError(value);
  } else
    assert3(value.authorization);
}
function from9(value) {
  if (typeof value === "string")
    return unwrap(value);
  return value;
}
function unwrap(wrapped) {
  assert4(wrapped);
  const suffixLength = toNumber2(slice3(wrapped, -64, -32));
  const suffix = slice3(wrapped, -suffixLength - 64, -64);
  const signature = slice3(wrapped, 0, -suffixLength - 64);
  const [auth, to, data] = decode(suffixParameters, suffix);
  const authorization = from8({
    address: auth.delegation,
    chainId: Number(auth.chainId),
    nonce: auth.nonce,
    yParity: auth.yParity,
    r: auth.r,
    s: auth.s
  });
  return {
    authorization,
    signature,
    ...data && data !== "0x" ? { data, to } : {}
  };
}
function wrap(value) {
  const { data, signature } = value;
  assert4(value);
  const self = recoverAddress2({
    payload: getSignPayload(value.authorization),
    signature: from7(value.authorization)
  });
  const suffix = encode2(suffixParameters, [
    {
      ...value.authorization,
      delegation: value.authorization.address,
      chainId: BigInt(value.authorization.chainId)
    },
    value.to ?? self,
    data ?? "0x"
  ]);
  const suffixLength = fromNumber(size3(suffix), { size: 32 });
  return concat2(signature, suffix, suffixLength, magicBytes);
}
function validate4(value) {
  try {
    assert4(value);
    return true;
  } catch {
    return false;
  }
}
var InvalidWrappedSignatureError = class extends BaseError2 {
  constructor(wrapped) {
    super(`Value \`${wrapped}\` is an invalid ERC-8010 wrapped signature.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "SignatureErc8010.InvalidWrappedSignatureError"
    });
  }
};

// node_modules/viem/_esm/utils/unit/formatUnits.js
function formatUnits(value, decimals) {
  return format(value, decimals);
}

// node_modules/viem/_esm/utils/formatters/proof.js
function formatStorageProof(storageProof) {
  return storageProof.map((proof) => ({
    ...proof,
    value: BigInt(proof.value)
  }));
}
function formatProof(proof) {
  return {
    ...proof,
    balance: proof.balance ? BigInt(proof.balance) : void 0,
    nonce: proof.nonce ? hexToNumber(proof.nonce) : void 0,
    storageProof: proof.storageProof ? formatStorageProof(proof.storageProof) : void 0
  };
}

// node_modules/viem/_esm/actions/public/getProof.js
async function getProof(client, { address, blockHash, blockNumber, blockTag = "latest", requireCanonical, storageKeys }) {
  const block = formatBlockParameter({
    blockHash,
    blockNumber,
    blockTag,
    requireCanonical
  });
  const proof = await client.request({
    method: "eth_getProof",
    params: [address, storageKeys, block]
  });
  return formatProof(proof);
}

// node_modules/viem/_esm/actions/public/getRawTransaction.js
async function getRawTransaction(client, { hash: hash2 }) {
  const rawTransaction = await client.request({
    method: "eth_getRawTransactionByHash",
    params: [hash2]
  }, { dedupe: true });
  if (!rawTransaction)
    throw new TransactionNotFoundError({ hash: hash2 });
  return rawTransaction;
}

// node_modules/viem/_esm/actions/public/getStorageAt.js
async function getStorageAt(client, { address, blockHash, blockNumber, blockTag = "latest", requireCanonical, slot }) {
  const block = formatBlockParameter({
    blockHash,
    blockNumber,
    blockTag,
    requireCanonical
  });
  const data = await client.request({
    method: "eth_getStorageAt",
    params: [address, slot, block]
  });
  return data;
}

// node_modules/viem/_esm/actions/public/getTransaction.js
async function getTransaction(client, { blockHash, blockNumber, blockTag: blockTag_, hash: hash2, index: index2, sender, nonce }) {
  const blockTag = blockTag_ || "latest";
  const blockNumberHex = blockNumber !== void 0 ? numberToHex(blockNumber) : void 0;
  let transaction = null;
  if (hash2) {
    transaction = await client.request({
      method: "eth_getTransactionByHash",
      params: [hash2]
    }, { dedupe: true });
  } else if (blockHash) {
    transaction = await client.request({
      method: "eth_getTransactionByBlockHashAndIndex",
      params: [blockHash, numberToHex(index2)]
    }, { dedupe: true });
  } else if ((blockNumberHex || blockTag) && typeof index2 === "number") {
    transaction = await client.request({
      method: "eth_getTransactionByBlockNumberAndIndex",
      params: [blockNumberHex || blockTag, numberToHex(index2)]
    }, { dedupe: Boolean(blockNumberHex) });
  } else if (sender && typeof nonce === "number") {
    transaction = await client.request({
      method: "eth_getTransactionBySenderAndNonce",
      params: [sender, numberToHex(nonce)]
    }, { dedupe: true });
  }
  if (!transaction)
    throw new TransactionNotFoundError({
      blockHash,
      blockNumber,
      blockTag,
      hash: hash2,
      index: index2
    });
  const format2 = client.chain?.formatters?.transaction?.format || formatTransaction;
  return format2(transaction, "getTransaction");
}

// node_modules/viem/_esm/actions/public/getTransactionConfirmations.js
async function getTransactionConfirmations(client, { hash: hash2, transactionReceipt }) {
  const [blockNumber, transaction] = await Promise.all([
    getAction(client, getBlockNumber, "getBlockNumber")({}),
    hash2 ? getAction(client, getTransaction, "getTransaction")({ hash: hash2 }) : void 0
  ]);
  const transactionBlockNumber = transactionReceipt?.blockNumber || transaction?.blockNumber;
  if (!transactionBlockNumber)
    return 0n;
  return blockNumber - transactionBlockNumber + 1n;
}

// node_modules/viem/_esm/actions/public/getTransactionReceipt.js
async function getTransactionReceipt(client, { hash: hash2 }) {
  const receipt = await client.request({
    method: "eth_getTransactionReceipt",
    params: [hash2]
  }, { dedupe: true });
  if (!receipt)
    throw new TransactionReceiptNotFoundError({ hash: hash2 });
  const format2 = client.chain?.formatters?.transactionReceipt?.format || formatTransactionReceipt;
  return format2(receipt, "getTransactionReceipt");
}

// node_modules/viem/_esm/actions/public/multicall.js
async function multicall(client, parameters) {
  const { account, authorizationList, allowFailure = true, blockHash, blockNumber, blockOverrides, blockTag, requireCanonical, stateOverride } = parameters;
  const contracts = parameters.contracts;
  const batch = typeof client.batch?.multicall === "object" ? client.batch.multicall : {};
  const batchSize = parameters.batchSize ?? batch.batchSize ?? 1024;
  const deployless = parameters.deployless ?? batch.deployless ?? false;
  const multicallAddress = (() => {
    if (parameters.multicallAddress)
      return parameters.multicallAddress;
    if (deployless)
      return null;
    if (client.chain) {
      return getChainContractAddress({
        blockNumber,
        chain: client.chain,
        contract: "multicall3"
      });
    }
    throw new Error("client chain not configured. multicallAddress is required.");
  })();
  const chunkedCalls = [[]];
  let currentChunk = 0;
  let currentChunkSize = 0;
  for (let i5 = 0; i5 < contracts.length; i5++) {
    const { abi: abi2, address, args, functionName } = contracts[i5];
    try {
      const callData = encodeFunctionData({ abi: abi2, args, functionName });
      currentChunkSize += (callData.length - 2) / 2;
      if (
        // Check if batching is enabled.
        batchSize > 0 && // Check if the current size of the batch exceeds the size limit.
        currentChunkSize > batchSize && // Check if the current chunk is not already empty.
        chunkedCalls[currentChunk].length > 0
      ) {
        currentChunk++;
        currentChunkSize = (callData.length - 2) / 2;
        chunkedCalls[currentChunk] = [];
      }
      chunkedCalls[currentChunk] = [
        ...chunkedCalls[currentChunk],
        {
          allowFailure: true,
          callData,
          target: address
        }
      ];
    } catch (err) {
      const error = getContractError(err, {
        abi: abi2,
        address,
        args,
        docsPath: "/docs/contract/multicall",
        functionName,
        sender: account
      });
      if (!allowFailure)
        throw error;
      chunkedCalls[currentChunk] = [
        ...chunkedCalls[currentChunk],
        {
          allowFailure: true,
          callData: "0x",
          target: address
        }
      ];
    }
  }
  const batching = Boolean(client.batch?.multicall);
  const batches = batching ? chunkedCalls.flatMap((calls) => calls.map((call2) => [call2])) : chunkedCalls;
  const aggregate3Results = await Promise.allSettled(batches.map((calls) => {
    if (batching)
      return scheduleMulticall(client, {
        account,
        authorizationList,
        batchSize,
        blockHash,
        blockNumber,
        blockOverrides,
        blockTag,
        call: calls[0],
        multicallAddress,
        requireCanonical,
        stateOverride
      }).then((result) => [result]);
    return getAction(client, readContract, "readContract")({
      ...multicallAddress === null ? { code: multicall3Bytecode } : { address: multicallAddress },
      abi: multicall3Abi,
      account,
      args: [calls],
      authorizationList,
      blockHash,
      blockNumber,
      blockOverrides,
      blockTag,
      functionName: "aggregate3",
      requireCanonical,
      stateOverride
    });
  }));
  const results = [];
  for (let i5 = 0; i5 < aggregate3Results.length; i5++) {
    const result = aggregate3Results[i5];
    if (result.status === "rejected") {
      if (!allowFailure)
        throw result.reason;
      for (let j3 = 0; j3 < batches[i5].length; j3++) {
        results.push({
          status: "failure",
          error: result.reason,
          result: void 0
        });
      }
      continue;
    }
    const aggregate3Result = result.value;
    for (let j3 = 0; j3 < aggregate3Result.length; j3++) {
      const { returnData, success } = aggregate3Result[j3];
      const { callData } = batches[i5][j3];
      const { abi: abi2, address, functionName, args } = contracts[results.length];
      try {
        if (callData === "0x")
          throw new AbiDecodingZeroDataError();
        if (!success)
          throw new RawContractError({ data: returnData });
        const result2 = decodeFunctionResult({
          abi: abi2,
          args,
          data: returnData,
          functionName
        });
        results.push(allowFailure ? { result: result2, status: "success" } : result2);
      } catch (err) {
        const error = getContractError(err, {
          abi: abi2,
          address,
          args,
          docsPath: "/docs/contract/multicall",
          functionName
        });
        if (!allowFailure)
          throw error;
        results.push({ error, result: void 0, status: "failure" });
      }
    }
  }
  if (results.length !== contracts.length)
    throw new BaseError("multicall results mismatch");
  return results;
}
async function scheduleMulticall(client, parameters) {
  const { batchSize, call: call2, multicallAddress, ...rest } = parameters;
  const { wait: wait2 = 0 } = typeof client.batch?.multicall === "object" ? client.batch.multicall : {};
  const { schedule } = createBatchScheduler({
    id: stringify(["multicall", client.uid, batchSize, multicallAddress, rest]),
    wait: wait2,
    shouldSplitBatch(calls) {
      if (batchSize === 0)
        return false;
      const size5 = calls.reduce((size6, { callData }) => size6 + (callData.length - 2) / 2, 0);
      return size5 > batchSize;
    },
    fn: (calls) => getAction(client, readContract, "readContract")({
      ...multicallAddress === null ? { code: multicall3Bytecode } : { address: multicallAddress },
      ...rest,
      abi: multicall3Abi,
      args: [calls],
      functionName: "aggregate3"
    })
  });
  const [result] = await schedule(call2);
  return result;
}

// node_modules/viem/_esm/actions/public/simulateBlocks.js
async function simulateBlocks(client, parameters) {
  const { blockNumber, blockTag = client.experimental_blockTag ?? "latest", blocks, returnFullTransactions, traceTransfers, validation } = parameters;
  try {
    const blockStateCalls = [];
    for (const block2 of blocks) {
      const blockOverrides = block2.blockOverrides ? toRpc(block2.blockOverrides) : void 0;
      const calls = block2.calls.map((call_) => {
        const call2 = call_;
        const account = call2.account ? parseAccount(call2.account) : void 0;
        const data = call2.abi ? encodeFunctionData(call2) : call2.data;
        const request = {
          ...call2,
          account,
          data: call2.dataSuffix ? concat([data || "0x", call2.dataSuffix]) : data,
          from: call2.from ?? account?.address
        };
        assertRequest(request);
        return formatTransactionRequest(request);
      });
      const stateOverrides = block2.stateOverrides ? serializeStateOverride(block2.stateOverrides) : void 0;
      blockStateCalls.push({
        blockOverrides,
        calls,
        stateOverrides
      });
    }
    const blockNumberHex = typeof blockNumber === "bigint" ? numberToHex(blockNumber) : void 0;
    const block = blockNumberHex || blockTag;
    const result = await client.request({
      method: "eth_simulateV1",
      params: [
        { blockStateCalls, returnFullTransactions, traceTransfers, validation },
        block
      ]
    });
    return result.map((block2, i5) => ({
      ...formatBlock(block2),
      calls: block2.calls.map((call2, j3) => {
        const { abi: abi2, args, functionName, to } = blocks[i5].calls[j3];
        const data = call2.error?.data ?? call2.returnData;
        const gasUsed = BigInt(call2.gasUsed);
        const logs = call2.logs?.map((log) => formatLog(log));
        const status = call2.status === "0x1" ? "success" : "failure";
        const result2 = abi2 && status === "success" && data !== "0x" ? decodeFunctionResult({
          abi: abi2,
          data,
          functionName
        }) : null;
        const error = (() => {
          if (status === "success")
            return void 0;
          let error2;
          if (data === "0x")
            error2 = new AbiDecodingZeroDataError();
          else if (data)
            error2 = new RawContractError({ data });
          if (!error2)
            return void 0;
          return getContractError(error2, {
            abi: abi2 ?? [],
            address: to ?? "0x",
            args,
            functionName: functionName ?? "<unknown>"
          });
        })();
        return {
          data,
          gasUsed,
          logs,
          status,
          ...status === "success" ? {
            result: result2
          } : {
            error
          }
        };
      })
    }));
  } catch (e4) {
    const cause = e4;
    const error = getNodeError(cause, {});
    if (error instanceof UnknownNodeError)
      throw cause;
    throw error;
  }
}

// node_modules/ox/_esm/core/internal/abiItem.js
function normalizeSignature(signature) {
  let active = true;
  let current = "";
  let level = 0;
  let result = "";
  let valid = false;
  for (let i5 = 0; i5 < signature.length; i5++) {
    const char = signature[i5];
    if (["(", ")", ","].includes(char))
      active = true;
    if (char === "(")
      level++;
    if (char === ")")
      level--;
    if (!active)
      continue;
    if (level === 0) {
      if (char === " " && ["event", "function", "error", ""].includes(result))
        result = "";
      else {
        result += char;
        if (char === ")") {
          valid = true;
          break;
        }
      }
      continue;
    }
    if (char === " ") {
      if (signature[i5 - 1] !== "," && current !== "," && current !== ",(") {
        current = "";
        active = false;
      }
      continue;
    }
    result += char;
    current += char;
  }
  if (!valid)
    throw new BaseError2("Unable to normalize signature.");
  return result;
}
function isArgOfType(arg, abiParameter) {
  const argType = typeof arg;
  const abiParameterType = abiParameter.type;
  switch (abiParameterType) {
    case "address":
      return validate3(arg, { strict: false });
    case "bool":
      return argType === "boolean";
    case "function":
      return argType === "string";
    case "string":
      return argType === "string";
    default: {
      if (abiParameterType === "tuple" && "components" in abiParameter)
        return Object.values(abiParameter.components).every((component, index2) => {
          return isArgOfType(Object.values(arg)[index2], component);
        });
      if (/^u?int(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/.test(abiParameterType))
        return argType === "number" || argType === "bigint";
      if (/^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/.test(abiParameterType))
        return argType === "string" || arg instanceof Uint8Array;
      if (/[a-z]+[1-9]{0,3}(\[[0-9]{0,}\])+$/.test(abiParameterType)) {
        return Array.isArray(arg) && arg.every((x5) => isArgOfType(x5, {
          ...abiParameter,
          // Pop off `[]` or `[M]` from end of type
          type: abiParameterType.replace(/(\[[0-9]{0,}\])$/, "")
        }));
      }
      return false;
    }
  }
}
function getAmbiguousTypes(sourceParameters, targetParameters, args) {
  for (const parameterIndex in sourceParameters) {
    const sourceParameter = sourceParameters[parameterIndex];
    const targetParameter = targetParameters[parameterIndex];
    if (sourceParameter.type === "tuple" && targetParameter.type === "tuple" && "components" in sourceParameter && "components" in targetParameter)
      return getAmbiguousTypes(sourceParameter.components, targetParameter.components, args[parameterIndex]);
    const types = [sourceParameter.type, targetParameter.type];
    const ambiguous = (() => {
      if (types.includes("address") && types.includes("bytes20"))
        return true;
      if (types.includes("address") && types.includes("string"))
        return validate3(args[parameterIndex], {
          strict: false
        });
      if (types.includes("address") && types.includes("bytes"))
        return validate3(args[parameterIndex], {
          strict: false
        });
      return false;
    })();
    if (ambiguous)
      return types;
  }
  return;
}

// node_modules/ox/_esm/core/AbiItem.js
function from10(abiItem, options = {}) {
  const { prepare = true } = options;
  const item = (() => {
    if (Array.isArray(abiItem))
      return parseAbiItem(abiItem);
    if (typeof abiItem === "string")
      return parseAbiItem(abiItem);
    return abiItem;
  })();
  return {
    ...item,
    ...prepare ? { hash: getSignatureHash(item) } : {}
  };
}
function fromAbi(abi2, name, options) {
  const { args = [], prepare = true } = options ?? {};
  const isSelector = validate2(name, { strict: false });
  const abiItems = abi2.filter((abiItem2) => {
    if (isSelector) {
      if (abiItem2.type === "function" || abiItem2.type === "error")
        return getSelector(abiItem2) === slice3(name, 0, 4);
      if (abiItem2.type === "event")
        return getSignatureHash(abiItem2) === name;
      return false;
    }
    return "name" in abiItem2 && abiItem2.name === name;
  });
  if (abiItems.length === 0)
    throw new NotFoundError({ name });
  if (abiItems.length === 1)
    return {
      ...abiItems[0],
      ...prepare ? { hash: getSignatureHash(abiItems[0]) } : {}
    };
  let matchedAbiItem;
  for (const abiItem2 of abiItems) {
    if (!("inputs" in abiItem2))
      continue;
    if (!args || args.length === 0) {
      if (!abiItem2.inputs || abiItem2.inputs.length === 0)
        return {
          ...abiItem2,
          ...prepare ? { hash: getSignatureHash(abiItem2) } : {}
        };
      continue;
    }
    if (!abiItem2.inputs)
      continue;
    if (abiItem2.inputs.length === 0)
      continue;
    if (abiItem2.inputs.length !== args.length)
      continue;
    const matched = args.every((arg, index2) => {
      const abiParameter = "inputs" in abiItem2 && abiItem2.inputs[index2];
      if (!abiParameter)
        return false;
      return isArgOfType(arg, abiParameter);
    });
    if (matched) {
      if (matchedAbiItem && "inputs" in matchedAbiItem && matchedAbiItem.inputs) {
        const ambiguousTypes = getAmbiguousTypes(abiItem2.inputs, matchedAbiItem.inputs, args);
        if (ambiguousTypes)
          throw new AmbiguityError({
            abiItem: abiItem2,
            type: ambiguousTypes[0]
          }, {
            abiItem: matchedAbiItem,
            type: ambiguousTypes[1]
          });
      }
      matchedAbiItem = abiItem2;
    }
  }
  const abiItem = (() => {
    if (matchedAbiItem)
      return matchedAbiItem;
    const [abiItem2, ...overloads] = abiItems;
    return { ...abiItem2, overloads };
  })();
  if (!abiItem)
    throw new NotFoundError({ name });
  return {
    ...abiItem,
    ...prepare ? { hash: getSignatureHash(abiItem) } : {}
  };
}
function getSelector(...parameters) {
  const abiItem = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi2, name] = parameters;
      return fromAbi(abi2, name);
    }
    return parameters[0];
  })();
  return slice3(getSignatureHash(abiItem), 0, 4);
}
function getSignature(...parameters) {
  const abiItem = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi2, name] = parameters;
      return fromAbi(abi2, name);
    }
    return parameters[0];
  })();
  const signature = (() => {
    if (typeof abiItem === "string")
      return abiItem;
    return formatAbiItem(abiItem);
  })();
  return normalizeSignature(signature);
}
function getSignatureHash(...parameters) {
  const abiItem = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi2, name] = parameters;
      return fromAbi(abi2, name);
    }
    return parameters[0];
  })();
  if (typeof abiItem !== "string" && "hash" in abiItem && abiItem.hash)
    return abiItem.hash;
  return keccak2562(fromString2(getSignature(abiItem)));
}
var AmbiguityError = class extends BaseError2 {
  constructor(x5, y5) {
    super("Found ambiguous types in overloaded ABI Items.", {
      metaMessages: [
        // TODO: abitype to add support for signature-formatted ABI items.
        `\`${x5.type}\` in \`${normalizeSignature(formatAbiItem(x5.abiItem))}\`, and`,
        `\`${y5.type}\` in \`${normalizeSignature(formatAbiItem(y5.abiItem))}\``,
        "",
        "These types encode differently and cannot be distinguished at runtime.",
        "Remove one of the ambiguous items in the ABI."
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiItem.AmbiguityError"
    });
  }
};
var NotFoundError = class extends BaseError2 {
  constructor({ name, data, type = "item" }) {
    const selector = (() => {
      if (name)
        return ` with name "${name}"`;
      if (data)
        return ` with data "${data}"`;
      return "";
    })();
    super(`ABI ${type}${selector} not found.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiItem.NotFoundError"
    });
  }
};

// node_modules/ox/_esm/core/AbiConstructor.js
function encode3(...parameters) {
  const [abiConstructor, options] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi2, options2] = parameters;
      return [fromAbi2(abi2), options2];
    }
    return parameters;
  })();
  const { bytecode, args } = options;
  return concat2(bytecode, abiConstructor.inputs?.length && args?.length ? encode2(abiConstructor.inputs, args) : "0x");
}
function from11(abiConstructor) {
  return from10(abiConstructor);
}
function fromAbi2(abi2) {
  const item = abi2.find((item2) => item2.type === "constructor");
  if (!item)
    throw new NotFoundError({ name: "constructor" });
  return item;
}

// node_modules/ox/_esm/core/AbiEvent.js
function from12(abiEvent, options = {}) {
  return from10(abiEvent, options);
}
function getSelector2(abiItem) {
  return getSignatureHash(abiItem);
}

// node_modules/ox/_esm/core/AbiFunction.js
function decodeResult(...parameters) {
  const [abiFunction, data, options = {}] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi2, name, data2, options2] = parameters;
      return [fromAbi3(abi2, name), data2, options2];
    }
    return parameters;
  })();
  const values = decode(abiFunction.outputs, data, options);
  if (values && Object.keys(values).length === 0)
    return void 0;
  if (values && Object.keys(values).length === 1) {
    if (Array.isArray(values))
      return values[0];
    return Object.values(values)[0];
  }
  return values;
}
function encodeData2(...parameters) {
  const [abiFunction, args = []] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi2, name, args3] = parameters;
      return [fromAbi3(abi2, name, { args: args3 }), args3];
    }
    const [abiFunction2, args2] = parameters;
    return [abiFunction2, args2];
  })();
  const { overloads } = abiFunction;
  const item = overloads ? fromAbi3([abiFunction, ...overloads], abiFunction.name, {
    args
  }) : abiFunction;
  const selector = getSelector3(item);
  const data = args.length > 0 ? encode2(item.inputs, args) : void 0;
  return data ? concat2(selector, data) : selector;
}
function from13(abiFunction, options = {}) {
  return from10(abiFunction, options);
}
function fromAbi3(abi2, name, options) {
  const item = fromAbi(abi2, name, options);
  if (item.type !== "function")
    throw new NotFoundError({ name, type: "function" });
  return item;
}
function getSelector3(abiItem) {
  return getSelector(abiItem);
}

// node_modules/viem/_esm/constants/address.js
var ethAddress = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
var zeroAddress = "0x0000000000000000000000000000000000000000";

// node_modules/viem/_esm/actions/public/simulateCalls.js
var getBalanceCode = "0x6080604052348015600e575f80fd5b5061016d8061001c5f395ff3fe608060405234801561000f575f80fd5b5060043610610029575f3560e01c8063f8b2cb4f1461002d575b5f80fd5b610047600480360381019061004291906100db565b61005d565b604051610054919061011e565b60405180910390f35b5f8173ffffffffffffffffffffffffffffffffffffffff16319050919050565b5f80fd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f6100aa82610081565b9050919050565b6100ba816100a0565b81146100c4575f80fd5b50565b5f813590506100d5816100b1565b92915050565b5f602082840312156100f0576100ef61007d565b5b5f6100fd848285016100c7565b91505092915050565b5f819050919050565b61011881610106565b82525050565b5f6020820190506101315f83018461010f565b9291505056fea26469706673582212203b9fe929fe995c7cf9887f0bdba8a36dd78e8b73f149b17d2d9ad7cd09d2dc6264736f6c634300081a0033";
var staticCallCode = "0x608060405234801561000f575f5ffd5b5060043610610029575f3560e01c8063fd00430c1461002d575b5f5ffd5b6100476004803603810190610042919061012b565b610049565b005b80825f375f5f825f865afa610060573d5f5f3e3d5ffd5b3d5f5f3e3d5ff35b5f5ffd5b5f5ffd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f61009982610070565b9050919050565b6100a98161008f565b81146100b3575f5ffd5b50565b5f813590506100c4816100a0565b92915050565b5f5ffd5b5f5ffd5b5f5ffd5b5f5f83601f8401126100eb576100ea6100ca565b5b8235905067ffffffffffffffff811115610108576101076100ce565b5b602083019150836001820283011115610124576101236100d2565b5b9250929050565b5f5f5f6040848603121561014257610141610068565b5b5f61014f868287016100b6565b935050602084013567ffffffffffffffff8111156101705761016f61006c565b5b61017c868287016100d6565b9250925050925092509256fea2646970667358221220635ed99185cacf3f2acba6921f23687c969cec2bbaf5f9ad599f507e6e105e6964736f6c63430008230033";
var staticCallAddressBase = 0x00000000000000000000000000000000deadbeefn;
var transferEventSelector = getSelector2(from12("event Transfer(address indexed from, address indexed to, uint256 value)"));
var balanceOfFunction = from13("function balanceOf(address) returns (uint256)");
var decimalsFunction = from13("function decimals() returns (uint256)");
var tokenUriFunction = from13("function tokenURI(uint256) returns (string)");
var symbolFunction = from13("function symbol() returns (string)");
var staticCallFunction = from13("function query(address target, bytes data)");
async function simulateCalls(client, parameters) {
  const { blockNumber, blockTag, calls, stateOverrides, traceAssetChanges, traceTransfers, validation } = parameters;
  const account = parameters.account ? parseAccount(parameters.account) : void 0;
  if (traceAssetChanges && !account)
    throw new BaseError("`account` is required when `traceAssetChanges` is true");
  const getBalanceData = account ? encode3(from11("constructor(bytes, bytes)"), {
    bytecode: deploylessCallViaBytecodeBytecode,
    args: [
      getBalanceCode,
      encodeData2(from13("function getBalance(address)"), [account.address])
    ]
  }) : void 0;
  const blockTag_ = blockTag ?? client.experimental_blockTag ?? "latest";
  let baseBlockNumber = blockNumber;
  if (traceAssetChanges && typeof baseBlockNumber !== "bigint" && blockTag_ !== "earliest" && blockTag_ !== "pending") {
    if (blockTag_ === "latest")
      baseBlockNumber = await getBlockNumber(client, { cacheTime: 0 });
    else {
      const block2 = await getBlock(client, { blockTag: blockTag_ });
      if (typeof block2.number !== "bigint")
        throw new BaseError(`Block tag \`${blockTag_}\` did not resolve to a number.`);
      baseBlockNumber = block2.number;
    }
  }
  const block_ = typeof baseBlockNumber === "bigint" ? { blockNumber: baseBlockNumber } : { blockTag: blockTag_ };
  const discovery = traceAssetChanges ? await simulateBlocks(client, {
    ...block_,
    blocks: [
      {
        calls: calls.map((call2) => ({
          ...call2,
          from: account.address
        })),
        stateOverrides
      }
    ],
    traceTransfers,
    validation
  }) : void 0;
  const assetAddresses = discovery ? [
    .../* @__PURE__ */ new Set([
      ...tokensFromLogs(discovery[0].calls.flatMap((call2) => call2.logs ?? []), account.address),
      // Included even for calls without data: contracts that mint on receiving
      // native value (WETH) emit `Deposit`, not a `Transfer` the logs would catch.
      // Candidates without code fall out at `isBalance`.
      ...parameters.calls.map((call2) => call2.to?.toLowerCase())
    ])
  ].filter((address) => Boolean(address) && address !== ethAddress && address !== zeroAddress) : [];
  const staticCallAddress = getStaticCallAddress([
    ...account ? [account.address] : [],
    ...assetAddresses,
    ...stateOverrides?.map(({ address }) => address) ?? []
  ]);
  const staticCallStateOverrides = [
    { address: staticCallAddress, code: staticCallCode }
  ];
  const [balanceCallsPre, blocks] = await Promise.all([
    traceAssetChanges ? Promise.all([
      readBalance(client, {
        account: account.address,
        ...block_,
        data: getBalanceData,
        stateOverride: stateOverrides
      }),
      ...assetAddresses.map((address) => readBalance(client, {
        account: account.address,
        address,
        ...block_,
        data: encodeData2(balanceOfFunction, [
          account.address
        ]),
        staticCallAddress,
        stateOverride: stateOverrides
      }))
    ]) : [],
    simulateBlocks(client, {
      ...block_,
      blocks: [
        {
          calls: [...calls, { to: zeroAddress }].map((call2) => ({
            ...call2,
            from: account?.address
          })),
          stateOverrides
        },
        ...traceAssetChanges ? [
          // ETH post balances
          {
            calls: [{ data: getBalanceData }]
          },
          // Asset post balances
          {
            calls: assetAddresses.map((address) => ({
              to: staticCallAddress,
              data: encodeStaticCall(address, encodeData2(balanceOfFunction, [
                account.address
              ]))
            })),
            stateOverrides: staticCallStateOverrides
          },
          // Decimals
          {
            calls: assetAddresses.map((address) => ({
              to: staticCallAddress,
              data: encodeStaticCall(address, encodeData2(decimalsFunction))
            })),
            stateOverrides: staticCallStateOverrides
          },
          // Token URI
          {
            calls: assetAddresses.map((address) => ({
              to: staticCallAddress,
              data: encodeStaticCall(address, encodeData2(tokenUriFunction, [0n]))
            })),
            stateOverrides: staticCallStateOverrides
          },
          // Symbols
          {
            calls: assetAddresses.map((address) => ({
              to: staticCallAddress,
              data: encodeStaticCall(address, encodeData2(symbolFunction))
            })),
            stateOverrides: staticCallStateOverrides
          }
        ] : []
      ],
      traceTransfers,
      validation
    })
  ]);
  const block_results = blocks[0];
  const [block_ethPost, block_assetsPost, block_decimals, block_tokenURI, block_symbols] = traceAssetChanges ? blocks.slice(1) : [];
  const { calls: block_calls, ...block } = block_results;
  const results = block_calls.slice(0, -1);
  const balancesPre = balanceCallsPre.map((call2) => isBalance(call2) ? hexToBigInt(call2.data) : null);
  const ethPost = block_ethPost?.calls ?? [];
  const assetsPost = block_assetsPost?.calls ?? [];
  const balanceCallsPost = [...ethPost, ...assetsPost];
  const balancesPost = balanceCallsPost.map((call2) => isBalance(call2) ? hexToBigInt(call2.data) : null);
  const decimals = (block_decimals?.calls ?? []).map((call2) => decodeAssetResult(call2, decimalsFunction));
  const symbols = (block_symbols?.calls ?? []).map((call2) => decodeAssetResult(call2, symbolFunction));
  const tokenURI = (block_tokenURI?.calls ?? []).map((call2) => decodeAssetResult(call2, tokenUriFunction));
  const changes = [];
  for (const [i5, balancePost] of balancesPost.entries()) {
    const balancePre_ = balancesPre[i5];
    const preCall = balanceCallsPre[i5];
    const balancePre = typeof balancePre_ === "bigint" ? balancePre_ : i5 > 0 && preCall?.status === "success" && preCall.data === "0x" ? 0n : null;
    if (typeof balancePost !== "bigint")
      continue;
    if (typeof balancePre !== "bigint")
      continue;
    const decimals_ = decimals[i5 - 1];
    const symbol_ = symbols[i5 - 1];
    const tokenURI_ = tokenURI[i5 - 1];
    const token = (() => {
      if (i5 === 0)
        return {
          address: ethAddress,
          decimals: 18,
          symbol: "ETH"
        };
      return {
        address: assetAddresses[i5 - 1],
        decimals: tokenURI_ || decimals_ ? Number(decimals_ ?? 1) : void 0,
        symbol: symbol_ ?? void 0
      };
    })();
    changes.push({
      token,
      value: {
        pre: balancePre,
        post: balancePost,
        diff: balancePost - balancePre
      }
    });
  }
  return {
    assetChanges: changes,
    block,
    results
  };
}
function encodeStaticCall(address, data) {
  return encodeData2(staticCallFunction, [address, data]);
}
function tokensFromLogs(logs, account) {
  const account_ = pad(account.toLowerCase(), { size: 32 });
  return logs.filter((log) => {
    if (log.topics[0]?.toLowerCase() !== transferEventSelector)
      return false;
    if (log.address.toLowerCase() === ethAddress)
      return false;
    return log.topics[1]?.toLowerCase() === account_ || log.topics[2]?.toLowerCase() === account_;
  }).map((log) => log.address.toLowerCase());
}
function isBalance(call2) {
  return call2.status === "success" && /^0x[\da-f]{64}$/i.test(call2.data);
}
function decodeAssetResult(call2, abiFunction) {
  if (call2.status === "failure" || call2.data === "0x")
    return null;
  try {
    return decodeResult(abiFunction, call2.data);
  } catch {
    return null;
  }
}
async function readBalance(client, parameters) {
  const { account, address, blockNumber, blockTag, data, staticCallAddress, stateOverride } = parameters;
  try {
    const result = await call({ ...client, ccipRead: false }, {
      account: address ? zeroAddress : account,
      data: address ? encodeStaticCall(address, data) : data,
      stateOverride: address && staticCallAddress ? [
        ...stateOverride ?? [],
        { address: staticCallAddress, code: staticCallCode }
      ] : stateOverride,
      ...address ? { to: staticCallAddress } : {},
      ...typeof blockNumber === "bigint" ? { blockNumber } : { blockTag }
    });
    return { data: result.data ?? "0x", status: "success" };
  } catch (error) {
    if (!(error instanceof CallExecutionError) || !(error.cause instanceof ExecutionRevertedError))
      throw error;
    return { data: "0x", status: "failure" };
  }
}
function getStaticCallAddress(addresses) {
  const occupied = new Set(addresses.map((address) => address.toLowerCase()));
  let value = staticCallAddressBase;
  while (occupied.has(`0x${value.toString(16).padStart(40, "0")}`))
    value++;
  return `0x${value.toString(16).padStart(40, "0")}`;
}

// node_modules/ox/_esm/erc6492/SignatureErc6492.js
var SignatureErc6492_exports = {};
__export(SignatureErc6492_exports, {
  InvalidWrappedSignatureError: () => InvalidWrappedSignatureError2,
  assert: () => assert5,
  from: () => from14,
  magicBytes: () => magicBytes2,
  universalSignatureValidatorAbi: () => universalSignatureValidatorAbi,
  universalSignatureValidatorBytecode: () => universalSignatureValidatorBytecode,
  unwrap: () => unwrap2,
  validate: () => validate5,
  wrap: () => wrap2
});
var magicBytes2 = "0x6492649264926492649264926492649264926492649264926492649264926492";
var universalSignatureValidatorBytecode = "0x608060405234801561001057600080fd5b5060405161069438038061069483398101604081905261002f9161051e565b600061003c848484610048565b9050806000526001601ff35b60007f64926492649264926492649264926492649264926492649264926492649264926100748361040c565b036101e7576000606080848060200190518101906100929190610577565b60405192955090935091506000906001600160a01b038516906100b69085906105dd565b6000604051808303816000865af19150503d80600081146100f3576040519150601f19603f3d011682016040523d82523d6000602084013e6100f8565b606091505b50509050876001600160a01b03163b60000361016057806101605760405162461bcd60e51b815260206004820152601e60248201527f5369676e617475726556616c696461746f723a206465706c6f796d656e74000060448201526064015b60405180910390fd5b604051630b135d3f60e11b808252906001600160a01b038a1690631626ba7e90610190908b9087906004016105f9565b602060405180830381865afa1580156101ad573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906101d19190610633565b6001600160e01b03191614945050505050610405565b6001600160a01b0384163b1561027a57604051630b135d3f60e11b808252906001600160a01b03861690631626ba7e9061022790879087906004016105f9565b602060405180830381865afa158015610244573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906102689190610633565b6001600160e01b031916149050610405565b81516041146102df5760405162461bcd60e51b815260206004820152603a602482015260008051602061067483398151915260448201527f3a20696e76616c6964207369676e6174757265206c656e6774680000000000006064820152608401610157565b6102e7610425565b5060208201516040808401518451859392600091859190811061030c5761030c61065d565b016020015160f81c9050601b811480159061032b57508060ff16601c14155b1561038c5760405162461bcd60e51b815260206004820152603b602482015260008051602061067483398151915260448201527f3a20696e76616c6964207369676e617475726520762076616c756500000000006064820152608401610157565b60408051600081526020810180835289905260ff83169181019190915260608101849052608081018390526001600160a01b0389169060019060a0016020604051602081039080840390855afa1580156103ea573d6000803e3d6000fd5b505050602060405103516001600160a01b0316149450505050505b9392505050565b600060208251101561041d57600080fd5b508051015190565b60405180606001604052806003906020820280368337509192915050565b6001600160a01b038116811461045857600080fd5b50565b634e487b7160e01b600052604160045260246000fd5b60005b8381101561048c578181015183820152602001610474565b50506000910152565b600082601f8301126104a657600080fd5b81516001600160401b038111156104bf576104bf61045b565b604051601f8201601f19908116603f011681016001600160401b03811182821017156104ed576104ed61045b565b60405281815283820160200185101561050557600080fd5b610516826020830160208701610471565b949350505050565b60008060006060848603121561053357600080fd5b835161053e81610443565b6020850151604086015191945092506001600160401b0381111561056157600080fd5b61056d86828701610495565b9150509250925092565b60008060006060848603121561058c57600080fd5b835161059781610443565b60208501519093506001600160401b038111156105b357600080fd5b6105bf86828701610495565b604086015190935090506001600160401b0381111561056157600080fd5b600082516105ef818460208701610471565b9190910192915050565b828152604060208201526000825180604084015261061e816060850160208701610471565b601f01601f1916919091016060019392505050565b60006020828403121561064557600080fd5b81516001600160e01b03198116811461040557600080fd5b634e487b7160e01b600052603260045260246000fdfe5369676e617475726556616c696461746f72237265636f7665725369676e6572";
var universalSignatureValidatorAbi = [
  {
    inputs: [
      {
        name: "_signer",
        type: "address"
      },
      {
        name: "_hash",
        type: "bytes32"
      },
      {
        name: "_signature",
        type: "bytes"
      }
    ],
    stateMutability: "nonpayable",
    type: "constructor"
  },
  {
    inputs: [
      {
        name: "_signer",
        type: "address"
      },
      {
        name: "_hash",
        type: "bytes32"
      },
      {
        name: "_signature",
        type: "bytes"
      }
    ],
    outputs: [
      {
        type: "bool"
      }
    ],
    stateMutability: "nonpayable",
    type: "function",
    name: "isValidSig"
  }
];
function assert5(wrapped) {
  if (slice3(wrapped, -32) !== magicBytes2)
    throw new InvalidWrappedSignatureError2(wrapped);
}
function from14(wrapped) {
  if (typeof wrapped === "string")
    return unwrap2(wrapped);
  return wrapped;
}
function unwrap2(wrapped) {
  assert5(wrapped);
  const [to, data, signature] = decode(from5("address, bytes, bytes"), wrapped);
  return { data, signature, to };
}
function wrap2(value) {
  const { data, signature, to } = value;
  return concat2(encode2(from5("address, bytes, bytes"), [
    to,
    data,
    signature
  ]), magicBytes2);
}
function validate5(wrapped) {
  try {
    assert5(wrapped);
    return true;
  } catch {
    return false;
  }
}
var InvalidWrappedSignatureError2 = class extends BaseError2 {
  constructor(wrapped) {
    super(`Value \`${wrapped}\` is an invalid ERC-6492 wrapped signature.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "SignatureErc6492.InvalidWrappedSignatureError"
    });
  }
};

// node_modules/viem/_esm/utils/signature/serializeSignature.js
function serializeSignature({ r: r3, s: s7, to = "hex", v: v4, yParity }) {
  const yParity_ = (() => {
    if (yParity === 0 || yParity === 1)
      return yParity;
    if (v4 && (v4 === 27n || v4 === 28n || v4 >= 35n))
      return v4 % 2n === 0n ? 1 : 0;
    throw new Error("Invalid `v` or `yParity` value");
  })();
  const signature = `0x${new secp256k1.Signature(hexToBigInt(r3), hexToBigInt(s7)).toCompactHex()}${yParity_ === 0 ? "1b" : "1c"}`;
  if (to === "hex")
    return signature;
  return hexToBytes(signature);
}

// node_modules/viem/_esm/actions/public/verifyHash.js
async function verifyHash(client, parameters) {
  const { address, chain = client.chain, hash: hash2, erc6492VerifierAddress: verifierAddress = parameters.universalSignatureVerifierAddress ?? chain?.contracts?.erc6492Verifier?.address, multicallAddress = parameters.multicallAddress ?? chain?.contracts?.multicall3?.address, mode = "auto" } = parameters;
  if (chain?.verifyHash)
    return await chain.verifyHash(client, parameters);
  const signature = (() => {
    const signature2 = parameters.signature;
    if (isHex(signature2))
      return signature2;
    if (typeof signature2 === "object" && "r" in signature2 && "s" in signature2)
      return serializeSignature(signature2);
    return bytesToHex(signature2);
  })();
  try {
    if (mode === "eoa") {
      try {
        const verified = isAddressEqual(getAddress(address), await recoverAddress({ hash: hash2, signature }));
        if (verified)
          return true;
      } catch {
      }
    }
    if (SignatureErc8010_exports.validate(signature))
      return await verifyErc8010(client, {
        ...parameters,
        multicallAddress,
        signature
      });
    return await verifyErc6492(client, {
      ...parameters,
      verifierAddress,
      signature
    });
  } catch (error) {
    if (mode !== "eoa") {
      try {
        const verified = isAddressEqual(getAddress(address), await recoverAddress({ hash: hash2, signature }));
        if (verified)
          return true;
      } catch {
      }
    }
    if (error instanceof VerificationError) {
      return false;
    }
    throw error;
  }
}
async function verifyErc8010(client, parameters) {
  const { address, blockHash, blockNumber, blockTag, hash: hash2, multicallAddress, requireCanonical } = parameters;
  const { authorization: authorization_ox, data: initData, signature, to } = SignatureErc8010_exports.unwrap(parameters.signature);
  const code = await getCode(client, {
    address,
    blockHash,
    blockNumber,
    blockTag,
    requireCanonical
  });
  if (code === concatHex(["0xef0100", authorization_ox.address]))
    return await verifyErc1271(client, {
      ...parameters,
      signature
    });
  const authorization = {
    address: authorization_ox.address,
    chainId: Number(authorization_ox.chainId),
    nonce: Number(authorization_ox.nonce),
    r: numberToHex(authorization_ox.r, { size: 32 }),
    s: numberToHex(authorization_ox.s, { size: 32 }),
    yParity: authorization_ox.yParity
  };
  const valid = await verifyAuthorization({
    address,
    authorization
  });
  if (!valid)
    throw new VerificationError();
  const results = await getAction(client, readContract, "readContract")({
    ...multicallAddress ? { address: multicallAddress } : { code: multicall3Bytecode },
    authorizationList: [authorization],
    abi: multicall3Abi,
    blockHash,
    blockNumber,
    blockTag: "pending",
    functionName: "aggregate3",
    requireCanonical,
    args: [
      [
        ...initData ? [
          {
            allowFailure: true,
            target: to ?? address,
            callData: initData
          }
        ] : [],
        {
          allowFailure: true,
          target: address,
          callData: encodeFunctionData({
            abi: erc1271Abi,
            functionName: "isValidSignature",
            args: [hash2, signature]
          })
        }
      ]
    ]
  });
  const data = results[results.length - 1]?.returnData;
  if (data?.startsWith("0x1626ba7e"))
    return true;
  throw new VerificationError();
}
async function verifyErc6492(client, parameters) {
  const { address, factory, factoryData, hash: hash2, signature, verifierAddress, ...rest } = parameters;
  const wrappedSignature = await (async () => {
    if (!factory && !factoryData)
      return signature;
    if (SignatureErc6492_exports.validate(signature))
      return signature;
    return SignatureErc6492_exports.wrap({
      data: factoryData,
      signature,
      to: factory
    });
  })();
  const args = verifierAddress ? {
    to: verifierAddress,
    data: encodeFunctionData({
      abi: erc6492SignatureValidatorAbi,
      functionName: "isValidSig",
      args: [address, hash2, wrappedSignature]
    }),
    ...rest
  } : {
    data: encodeDeployData({
      abi: erc6492SignatureValidatorAbi,
      args: [address, hash2, wrappedSignature],
      bytecode: erc6492SignatureValidatorByteCode
    }),
    ...rest
  };
  const { data } = await getAction(client, call, "call")(args).catch((error) => {
    if (error instanceof CallExecutionError)
      throw new VerificationError();
    throw error;
  });
  if (hexToBool(data ?? "0x0"))
    return true;
  throw new VerificationError();
}
async function verifyErc1271(client, parameters) {
  const { address, blockHash, blockNumber, blockTag, hash: hash2, requireCanonical, signature } = parameters;
  const result = await getAction(client, readContract, "readContract")({
    address,
    abi: erc1271Abi,
    args: [hash2, signature],
    blockHash,
    blockNumber,
    blockTag,
    functionName: "isValidSignature",
    requireCanonical
  }).catch((error) => {
    if (error instanceof ContractFunctionExecutionError)
      throw new VerificationError();
    throw error;
  });
  if (result.startsWith("0x1626ba7e"))
    return true;
  throw new VerificationError();
}
var VerificationError = class extends Error {
};

// node_modules/viem/_esm/actions/public/verifyMessage.js
async function verifyMessage(client, { address, message, factory, factoryData, signature, ...callRequest }) {
  const hash2 = hashMessage(message);
  return getAction(client, verifyHash, "verifyHash")({
    address,
    factory,
    factoryData,
    hash: hash2,
    signature,
    ...callRequest
  });
}

// node_modules/viem/_esm/actions/public/verifyTypedData.js
async function verifyTypedData(client, parameters) {
  const { address, factory, factoryData, signature, message, primaryType, types, domain, ...callRequest } = parameters;
  const hash2 = hashTypedData({ message, primaryType, types, domain });
  return getAction(client, verifyHash, "verifyHash")({
    address,
    factory,
    factoryData,
    hash: hash2,
    signature,
    ...callRequest
  });
}

// node_modules/viem/_esm/actions/public/watchBlockNumber.js
function watchBlockNumber(client, { emitOnBegin = false, emitMissed = false, onBlockNumber, onError, poll: poll_, pollingInterval = client.pollingInterval }) {
  const enablePolling = (() => {
    if (typeof poll_ !== "undefined")
      return poll_;
    if (client.transport.type === "webSocket" || client.transport.type === "ipc")
      return false;
    if (client.transport.type === "fallback" && (client.transport.transports[0].config.type === "webSocket" || client.transport.transports[0].config.type === "ipc"))
      return false;
    return true;
  })();
  let prevBlockNumber;
  const pollBlockNumber = () => {
    const observerId = stringify([
      "watchBlockNumber",
      client.uid,
      emitOnBegin,
      emitMissed,
      pollingInterval
    ]);
    return observe(observerId, { onBlockNumber, onError }, (emit) => poll(async () => {
      try {
        const blockNumber = await getAction(client, getBlockNumber, "getBlockNumber")({ cacheTime: 0 });
        if (prevBlockNumber !== void 0) {
          if (blockNumber === prevBlockNumber)
            return;
          if (blockNumber - prevBlockNumber > 1 && emitMissed) {
            for (let i5 = prevBlockNumber + 1n; i5 < blockNumber; i5++) {
              emit.onBlockNumber(i5, prevBlockNumber);
              prevBlockNumber = i5;
            }
          }
        }
        if (prevBlockNumber === void 0 || blockNumber > prevBlockNumber) {
          emit.onBlockNumber(blockNumber, prevBlockNumber);
          prevBlockNumber = blockNumber;
        }
      } catch (err) {
        emit.onError?.(err);
      }
    }, {
      emitOnBegin,
      interval: pollingInterval
    }));
  };
  const subscribeBlockNumber = () => {
    const observerId = stringify([
      "watchBlockNumber",
      client.uid,
      emitOnBegin,
      emitMissed
    ]);
    return observe(observerId, { onBlockNumber, onError }, (emit) => {
      let active = true;
      let unsubscribe = () => active = false;
      (async () => {
        try {
          const transport = (() => {
            if (client.transport.type === "fallback") {
              const transport2 = client.transport.transports.find((transport3) => transport3.config.type === "webSocket" || transport3.config.type === "ipc");
              if (!transport2)
                return client.transport;
              return transport2.value;
            }
            return client.transport;
          })();
          const { unsubscribe: unsubscribe_ } = await transport.subscribe({
            params: ["newHeads"],
            onData(data) {
              if (!active)
                return;
              const blockNumber = hexToBigInt(data.result?.number);
              emit.onBlockNumber(blockNumber, prevBlockNumber);
              prevBlockNumber = blockNumber;
            },
            onError(error) {
              emit.onError?.(error);
            }
          });
          unsubscribe = unsubscribe_;
          if (!active)
            unsubscribe();
        } catch (err) {
          onError?.(err);
        }
      })();
      return () => unsubscribe();
    });
  };
  return enablePolling ? pollBlockNumber() : subscribeBlockNumber();
}

// node_modules/viem/_esm/actions/public/waitForTransactionReceipt.js
async function waitForTransactionReceipt(client, parameters) {
  const {
    checkReplacement = client.chain?.supportsTransactionReplacementDetection ?? true,
    confirmations = 1,
    hash: hash2,
    onReplaced,
    retryCount = 6,
    retryDelay = ({ count }) => ~~(1 << count) * 200,
    // exponential backoff
    timeout = 18e4
  } = parameters;
  const observerId = stringify(["waitForTransactionReceipt", client.uid, hash2]);
  const pollingInterval = (() => {
    if (parameters.pollingInterval)
      return parameters.pollingInterval;
    if (client.chain?.experimental_preconfirmationTime)
      return client.chain.experimental_preconfirmationTime;
    return client.pollingInterval;
  })();
  let transaction;
  let replacedTransaction;
  let receipt;
  let retrying = false;
  let _unobserve;
  let _unwatch;
  const { promise, resolve, reject } = withResolvers();
  const timer = timeout ? setTimeout(() => {
    _unwatch?.();
    _unobserve?.();
    reject(new WaitForTransactionReceiptTimeoutError({ hash: hash2 }));
  }, timeout) : void 0;
  _unobserve = observe(observerId, { onReplaced, resolve, reject }, async (emit) => {
    receipt = await getAction(client, getTransactionReceipt, "getTransactionReceipt")({ hash: hash2 }).catch(() => void 0);
    if (receipt && confirmations <= 1) {
      clearTimeout(timer);
      emit.resolve(receipt);
      _unobserve?.();
      return;
    }
    _unwatch = getAction(client, watchBlockNumber, "watchBlockNumber")({
      emitMissed: true,
      emitOnBegin: true,
      poll: true,
      pollingInterval,
      async onBlockNumber(blockNumber_) {
        const done = (fn) => {
          clearTimeout(timer);
          _unwatch?.();
          fn();
          _unobserve?.();
        };
        let blockNumber = blockNumber_;
        if (retrying)
          return;
        try {
          if (receipt) {
            if (confirmations > 1 && (!receipt.blockNumber || blockNumber - receipt.blockNumber + 1n < confirmations))
              return;
            done(() => emit.resolve(receipt));
            return;
          }
          if (checkReplacement && !transaction) {
            retrying = true;
            await withRetry(async () => {
              transaction = await getAction(client, getTransaction, "getTransaction")({ hash: hash2 });
              if (transaction.blockNumber)
                blockNumber = transaction.blockNumber;
            }, {
              delay: retryDelay,
              retryCount
            });
            retrying = false;
          }
          receipt = await getAction(client, getTransactionReceipt, "getTransactionReceipt")({ hash: hash2 });
          if (confirmations > 1 && (!receipt.blockNumber || blockNumber - receipt.blockNumber + 1n < confirmations))
            return;
          done(() => emit.resolve(receipt));
        } catch (err) {
          if (err instanceof TransactionNotFoundError || err instanceof TransactionReceiptNotFoundError) {
            if (!transaction) {
              retrying = false;
              return;
            }
            try {
              replacedTransaction = transaction;
              retrying = true;
              const block = await withRetry(() => getAction(client, getBlock, "getBlock")({
                blockNumber,
                includeTransactions: true
              }), {
                delay: retryDelay,
                retryCount,
                shouldRetry: ({ error }) => error instanceof BlockNotFoundError
              });
              retrying = false;
              const replacementTransaction = block.transactions.find(({ from: from15, nonce }) => from15 === replacedTransaction.from && nonce === replacedTransaction.nonce);
              if (!replacementTransaction)
                return;
              receipt = await getAction(client, getTransactionReceipt, "getTransactionReceipt")({
                hash: replacementTransaction.hash
              });
              if (confirmations > 1 && (!receipt.blockNumber || blockNumber - receipt.blockNumber + 1n < confirmations))
                return;
              let reason = "replaced";
              if (replacementTransaction.to === replacedTransaction.to && replacementTransaction.value === replacedTransaction.value && replacementTransaction.input === replacedTransaction.input) {
                reason = "repriced";
              } else if (replacementTransaction.from === replacementTransaction.to && replacementTransaction.value === 0n) {
                reason = "cancelled";
              }
              done(() => {
                emit.onReplaced?.({
                  reason,
                  replacedTransaction,
                  transaction: replacementTransaction,
                  transactionReceipt: receipt
                });
                emit.resolve(receipt);
              });
            } catch (err_) {
              done(() => emit.reject(err_));
            }
          } else {
            done(() => emit.reject(err));
          }
        }
      }
    });
  });
  return promise;
}

// node_modules/viem/_esm/actions/public/watchBlockHeaders.js
var blockFields = [
  "size",
  "totalDifficulty",
  "transactions",
  "uncles",
  "withdrawals"
];
function watchBlockHeaders(client, { onBlockHeader, onError }) {
  let prevBlockHeader;
  const observerId = stringify(["watchBlockHeaders", client.uid]);
  return observe(observerId, { onBlockHeader, onError }, (emit) => {
    let active = true;
    let subscribed = false;
    let unsubscribe = () => active = false;
    (async () => {
      try {
        const transport = (() => {
          if (client.transport.type === "fallback") {
            const transport2 = client.transport.transports.find((transport3) => transport3.config.type === "webSocket" || transport3.config.type === "ipc");
            if (!transport2)
              return client.transport;
            return transport2.value;
          }
          return client.transport;
        })();
        const { unsubscribe: unsubscribe_ } = await transport.subscribe({
          params: ["newHeads"],
          onData(data) {
            if (!active)
              return;
            const blockHeader = (client.chain?.formatters?.block?.format || formatBlock)(data.result, "watchBlockHeaders");
            for (const field of blockFields)
              delete blockHeader[field];
            emit.onBlockHeader(blockHeader, prevBlockHeader);
            prevBlockHeader = blockHeader;
          },
          onError(error) {
            if (subscribed)
              emit.onError?.(error);
          }
        });
        subscribed = true;
        unsubscribe = unsubscribe_;
        if (!active)
          unsubscribe();
      } catch (err) {
        emit.onError?.(err);
      }
    })();
    return () => unsubscribe();
  });
}

// node_modules/viem/_esm/actions/public/watchBlocks.js
function watchBlocks(client, { blockTag = client.experimental_blockTag ?? "latest", emitMissed = false, emitOnBegin = false, onBlock, onError, includeTransactions: includeTransactions_, poll: poll_, pollingInterval = client.pollingInterval }) {
  const enablePolling = (() => {
    if (typeof poll_ !== "undefined")
      return poll_;
    if (client.transport.type === "webSocket" || client.transport.type === "ipc")
      return false;
    if (client.transport.type === "fallback" && (client.transport.transports[0].config.type === "webSocket" || client.transport.transports[0].config.type === "ipc"))
      return false;
    return true;
  })();
  const includeTransactions = includeTransactions_ ?? false;
  let prevBlock;
  const pollBlocks = () => {
    const observerId = stringify([
      "watchBlocks",
      client.uid,
      blockTag,
      emitMissed,
      emitOnBegin,
      includeTransactions,
      pollingInterval
    ]);
    return observe(observerId, { onBlock, onError }, (emit) => poll(async () => {
      try {
        const block = await getAction(client, getBlock, "getBlock")({
          blockTag,
          includeTransactions
        });
        if (block.number !== null && prevBlock?.number != null) {
          if (block.number === prevBlock.number)
            return;
          if (block.number - prevBlock.number > 1 && emitMissed) {
            for (let i5 = prevBlock?.number + 1n; i5 < block.number; i5++) {
              const block2 = await getAction(client, getBlock, "getBlock")({
                blockNumber: i5,
                includeTransactions
              });
              emit.onBlock(block2, prevBlock);
              prevBlock = block2;
            }
          }
        }
        if (
          // If no previous block exists, emit.
          prevBlock?.number == null || // If the block tag is "pending" with no block number, emit.
          blockTag === "pending" && block?.number == null || // If the next block number is greater than the previous block number, emit.
          // We don't want to emit blocks in the past.
          block.number !== null && block.number > prevBlock.number
        ) {
          emit.onBlock(block, prevBlock);
          prevBlock = block;
        }
      } catch (err) {
        emit.onError?.(err);
      }
    }, {
      emitOnBegin,
      interval: pollingInterval
    }));
  };
  const subscribeBlocks = () => {
    let active = true;
    let emitFetched = true;
    let unsubscribe = () => active = false;
    (async () => {
      try {
        if (emitOnBegin) {
          getAction(client, getBlock, "getBlock")({
            blockTag,
            includeTransactions
          }).then((block) => {
            if (!active)
              return;
            if (!emitFetched)
              return;
            onBlock(block, void 0);
            emitFetched = false;
          }).catch(onError);
        }
        const transport = (() => {
          if (client.transport.type === "fallback") {
            const transport2 = client.transport.transports.find((transport3) => transport3.config.type === "webSocket" || transport3.config.type === "ipc");
            if (!transport2)
              return client.transport;
            return transport2.value;
          }
          return client.transport;
        })();
        const { unsubscribe: unsubscribe_ } = await transport.subscribe({
          params: ["newHeads"],
          async onData(data) {
            if (!active)
              return;
            const block = await getAction(client, getBlock, "getBlock")({
              blockNumber: data.result?.number,
              includeTransactions
            }).catch(() => {
            });
            if (!active)
              return;
            onBlock(block, prevBlock);
            emitFetched = false;
            prevBlock = block;
          },
          onError(error) {
            onError?.(error);
          }
        });
        unsubscribe = unsubscribe_;
        if (!active)
          unsubscribe();
      } catch (err) {
        onError?.(err);
      }
    })();
    return () => unsubscribe();
  };
  return enablePolling ? pollBlocks() : subscribeBlocks();
}

// node_modules/viem/_esm/actions/public/watchEvent.js
function watchEvent(client, { address, args, batch = true, event, events, fromBlock, onError, onLogs, poll: poll_, pollingInterval = client.pollingInterval, strict: strict_ }) {
  const enablePolling = (() => {
    if (typeof poll_ !== "undefined")
      return poll_;
    if (typeof fromBlock === "bigint")
      return true;
    if (client.transport.type === "webSocket" || client.transport.type === "ipc")
      return false;
    if (client.transport.type === "fallback" && (client.transport.transports[0].config.type === "webSocket" || client.transport.transports[0].config.type === "ipc"))
      return false;
    return true;
  })();
  const strict = strict_ ?? false;
  const pollEvent = () => {
    const observerId = stringify([
      "watchEvent",
      address,
      args,
      batch,
      client.uid,
      event,
      pollingInterval,
      fromBlock
    ]);
    return observe(observerId, { onLogs, onError }, (emit) => {
      let previousBlockNumber;
      if (fromBlock !== void 0)
        previousBlockNumber = fromBlock - 1n;
      let filter;
      let initialized = false;
      const unwatch = poll(async () => {
        if (!initialized) {
          try {
            filter = await getAction(client, createEventFilter, "createEventFilter")({
              address,
              args,
              event,
              events,
              strict,
              fromBlock
            });
          } catch {
          }
          initialized = true;
          return;
        }
        try {
          let logs;
          if (filter) {
            logs = await getAction(client, getFilterChanges, "getFilterChanges")({ filter });
          } else {
            const blockNumber = await getAction(client, getBlockNumber, "getBlockNumber")({});
            if (previousBlockNumber && previousBlockNumber !== blockNumber) {
              logs = await getAction(client, getLogs, "getLogs")({
                address,
                args,
                event,
                events,
                fromBlock: previousBlockNumber + 1n,
                toBlock: blockNumber
              });
            } else {
              logs = [];
            }
            previousBlockNumber = blockNumber;
          }
          if (logs.length === 0)
            return;
          if (batch)
            emit.onLogs(logs);
          else
            for (const log of logs)
              emit.onLogs([log]);
        } catch (err) {
          if (filter && err instanceof InvalidInputRpcError)
            initialized = false;
          emit.onError?.(err);
        }
      }, {
        emitOnBegin: true,
        interval: pollingInterval
      });
      return async () => {
        if (filter)
          await getAction(client, uninstallFilter, "uninstallFilter")({ filter });
        unwatch();
      };
    });
  };
  const subscribeEvent = () => {
    let active = true;
    let unsubscribe = () => active = false;
    (async () => {
      try {
        const transport = (() => {
          if (client.transport.type === "fallback") {
            const transport2 = client.transport.transports.find((transport3) => transport3.config.type === "webSocket" || transport3.config.type === "ipc");
            if (!transport2)
              return client.transport;
            return transport2.value;
          }
          return client.transport;
        })();
        const events_ = events ?? (event ? [event] : void 0);
        let topics = [];
        if (events_) {
          const encoded = events_.flatMap((event2) => encodeEventTopics({
            abi: [event2],
            eventName: event2.name,
            args
          }));
          topics = [encoded];
          if (event)
            topics = topics[0];
        }
        const { unsubscribe: unsubscribe_ } = await transport.subscribe({
          params: ["logs", { address, topics }],
          onData(data) {
            if (!active)
              return;
            const log = data.result;
            try {
              const { eventName, args: args2 } = decodeEventLog({
                abi: events_ ?? [],
                data: log.data,
                topics: log.topics,
                strict
              });
              const formatted = formatLog(log, { args: args2, eventName });
              onLogs([formatted]);
            } catch (err) {
              let eventName;
              let isUnnamed;
              if (err instanceof DecodeLogDataMismatch || err instanceof DecodeLogTopicsMismatch) {
                if (strict_)
                  return;
                eventName = err.abiItem.name;
                isUnnamed = err.abiItem.inputs?.some((x5) => !("name" in x5 && x5.name));
              }
              const formatted = formatLog(log, {
                args: isUnnamed ? [] : {},
                eventName
              });
              onLogs([formatted]);
            }
          },
          onError(error) {
            onError?.(error);
          }
        });
        unsubscribe = unsubscribe_;
        if (!active)
          unsubscribe();
      } catch (err) {
        onError?.(err);
      }
    })();
    return () => unsubscribe();
  };
  return enablePolling ? pollEvent() : subscribeEvent();
}

// node_modules/viem/_esm/actions/public/watchPendingTransactions.js
function watchPendingTransactions(client, { batch = true, onError, onTransactions, poll: poll_, pollingInterval = client.pollingInterval }) {
  const enablePolling = typeof poll_ !== "undefined" ? poll_ : client.transport.type !== "webSocket" && client.transport.type !== "ipc";
  const pollPendingTransactions = () => {
    const observerId = stringify([
      "watchPendingTransactions",
      client.uid,
      batch,
      pollingInterval
    ]);
    return observe(observerId, { onTransactions, onError }, (emit) => {
      let filter;
      const unwatch = poll(async () => {
        try {
          if (!filter) {
            try {
              filter = await getAction(client, createPendingTransactionFilter, "createPendingTransactionFilter")({});
              return;
            } catch (err) {
              unwatch();
              throw err;
            }
          }
          const hashes = await getAction(client, getFilterChanges, "getFilterChanges")({ filter });
          if (hashes.length === 0)
            return;
          if (batch)
            emit.onTransactions(hashes);
          else
            for (const hash2 of hashes)
              emit.onTransactions([hash2]);
        } catch (err) {
          emit.onError?.(err);
        }
      }, {
        emitOnBegin: true,
        interval: pollingInterval
      });
      return async () => {
        if (filter)
          await getAction(client, uninstallFilter, "uninstallFilter")({ filter });
        unwatch();
      };
    });
  };
  const subscribePendingTransactions = () => {
    let active = true;
    let unsubscribe = () => active = false;
    (async () => {
      try {
        const { unsubscribe: unsubscribe_ } = await client.transport.subscribe({
          params: ["newPendingTransactions"],
          onData(data) {
            if (!active)
              return;
            const transaction = data.result;
            onTransactions([transaction]);
          },
          onError(error) {
            onError?.(error);
          }
        });
        unsubscribe = unsubscribe_;
        if (!active)
          unsubscribe();
      } catch (err) {
        onError?.(err);
      }
    })();
    return () => unsubscribe();
  };
  return enablePolling ? pollPendingTransactions() : subscribePendingTransactions();
}

// node_modules/viem/_esm/utils/siwe/parseSiweMessage.js
var siweDateTimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function isValidSiweDateTime(value) {
  if (!siweDateTimeRegex.test(value))
    return false;
  return !Number.isNaN(new Date(value).getTime());
}
function parseSiweDateTime(value) {
  if (!isValidSiweDateTime(value))
    return new Date(Number.NaN);
  return new Date(value);
}
function parseSiweMessage(message) {
  const { scheme, statement, ...prefix } = message.match(prefixRegex)?.groups ?? {};
  const { chainId, expirationTime, issuedAt, notBefore, requestId, ...suffix } = message.match(suffixRegex)?.groups ?? {};
  const resources = message.split("Resources:")[1]?.split("\n- ").slice(1);
  return {
    ...prefix,
    ...suffix,
    ...chainId ? { chainId: Number(chainId) } : {},
    ...expirationTime ? { expirationTime: parseSiweDateTime(expirationTime) } : {},
    ...issuedAt ? { issuedAt: parseSiweDateTime(issuedAt) } : {},
    ...notBefore ? { notBefore: parseSiweDateTime(notBefore) } : {},
    ...requestId ? { requestId } : {},
    ...resources ? { resources } : {},
    ...scheme ? { scheme } : {},
    ...statement ? { statement } : {}
  };
}
var prefixRegex = /^(?:(?<scheme>[a-zA-Z][a-zA-Z0-9+-.]*):\/\/)?(?<domain>[a-zA-Z0-9+-.]*(?::[0-9]{1,5})?) (?:wants you to sign in with your Ethereum account:\n)(?<address>0x[a-fA-F0-9]{40})\n\n(?:(?<statement>.*)\n\n)?/;
var suffixRegex = /(?:URI: (?<uri>.+))\n(?:Version: (?<version>.+))\n(?:Chain ID: (?<chainId>\d+))\n(?:Nonce: (?<nonce>[a-zA-Z0-9]+))\n(?:Issued At: (?<issuedAt>.+))(?:\nExpiration Time: (?<expirationTime>.+))?(?:\nNot Before: (?<notBefore>.+))?(?:\nRequest ID: (?<requestId>.+))?/;

// node_modules/viem/_esm/utils/siwe/validateSiweMessage.js
function validateSiweMessage(parameters) {
  const { address, domain, message, nonce, scheme, time = /* @__PURE__ */ new Date() } = parameters;
  if (domain && message.domain !== domain)
    return false;
  if (nonce && message.nonce !== nonce)
    return false;
  if (scheme && message.scheme !== scheme)
    return false;
  if (Number.isNaN(time.getTime()))
    return false;
  if (message.expirationTime) {
    if (Number.isNaN(message.expirationTime.getTime()))
      return false;
    if (time >= message.expirationTime)
      return false;
  }
  if (message.notBefore) {
    if (Number.isNaN(message.notBefore.getTime()))
      return false;
    if (time < message.notBefore)
      return false;
  }
  try {
    if (!message.address)
      return false;
    if (!isAddress(message.address, { strict: false }))
      return false;
    if (address && !isAddressEqual(message.address, address))
      return false;
  } catch {
    return false;
  }
  return true;
}

// node_modules/viem/_esm/actions/siwe/verifySiweMessage.js
async function verifySiweMessage(client, parameters) {
  const { address, domain, message, nonce, scheme, signature, time = /* @__PURE__ */ new Date(), ...callRequest } = parameters;
  const parsed = parseSiweMessage(message);
  if (!parsed.address)
    return false;
  const isValid = validateSiweMessage({
    address,
    domain,
    message: parsed,
    nonce,
    scheme,
    time
  });
  if (!isValid)
    return false;
  const hash2 = hashMessage(message);
  return verifyHash(client, {
    address: parsed.address,
    hash: hash2,
    signature,
    ...callRequest
  });
}

// node_modules/viem/_esm/actions/token/internal.js
function toAmount(amount, decimals) {
  return { amount, decimals, formatted: formatUnits(amount, decimals) };
}
function resolveToken(client, parameters) {
  const { decimals, token } = parameters;
  const declared = findDeclaredToken(client, token);
  if (declared)
    return {
      address: declared.address,
      decimals: decimals ?? declared.decimals
    };
  if (isAddress(token, { strict: false }))
    return {
      address: token,
      decimals: decimals ?? inferDecimals(client, token)
    };
  throw new Error(`Token "${token}" is not a declared ERC-20 token on the client's \`tokens\` array (with an address for the client's chain), and is not a valid address.`);
}
function findDeclaredToken(client, token) {
  const tokens = client.tokens;
  const chainId = client.chain?.id;
  if (!tokens || chainId === void 0)
    return void 0;
  const bySymbol = findTokenBySymbol(tokens, token);
  if (bySymbol)
    return resolveTokenForChain(bySymbol, chainId);
  if (isAddress(token, { strict: false }))
    for (const token_ of tokens) {
      const resolved = resolveTokenForChain(token_, chainId);
      if (resolved && isAddressEqual(resolved.address, token))
        return resolved;
    }
  return void 0;
}
function resolveTokenForChain(token, chainId) {
  const address = token.addresses[chainId];
  if (!address)
    return void 0;
  return {
    address,
    currency: token.currency,
    decimals: token.decimals,
    name: token.name,
    popular: token.popular,
    symbol: token.symbol
  };
}
function findTokenBySymbol(tokens, symbol) {
  const lowerSymbol = symbol.toLowerCase();
  for (const token of tokens) {
    if (token.symbol?.toLowerCase() === lowerSymbol)
      return token;
  }
  return void 0;
}
function inferDecimals(client, address) {
  const tokens = client.tokens;
  const chainId = client.chain?.id;
  if (tokens && chainId !== void 0)
    for (const token of tokens) {
      const resolved = resolveTokenForChain(token, chainId);
      if (resolved && isAddressEqual(resolved.address, address))
        return resolved.decimals;
    }
  return void 0;
}
async function resolveTokenWithDecimals(client, parameters) {
  const { address, decimals } = resolveToken(client, parameters);
  if (decimals !== void 0)
    return { address, decimals };
  return {
    address,
    decimals: await readContract(client, {
      abi: erc20Abi,
      address,
      functionName: "decimals"
    })
  };
}
function defineCall(call2) {
  return {
    ...call2,
    data: encodeFunctionData(call2),
    to: call2.address
  };
}

// node_modules/viem/_esm/actions/wallet/sendRawTransactionSync.js
async function sendRawTransactionSync(client, { serializedTransaction, throwOnReceiptRevert, timeout }) {
  const receipt = await client.request({
    method: "eth_sendRawTransactionSync",
    params: timeout ? [serializedTransaction, timeout] : [serializedTransaction]
  }, { retryCount: 0 });
  const format2 = client.chain?.formatters?.transactionReceipt?.format || formatTransactionReceipt;
  const formatted = format2(receipt);
  if (formatted.status === "reverted" && throwOnReceiptRevert)
    throw new TransactionReceiptRevertedError({ receipt: formatted });
  return formatted;
}

// node_modules/viem/_esm/actions/token/getAllowance.js
async function getAllowance(client, parameters) {
  const { account, decimals, spender, token, ...rest } = parameters;
  const [amount, { decimals: resolved }] = await Promise.all([
    readContract(client, {
      ...rest,
      ...getAllowance.call(client, { account, spender, token })
    }),
    resolveTokenWithDecimals(client, {
      decimals,
      token
    })
  ]);
  return toAmount(amount, resolved);
}
(function(getAllowance2) {
  function call2(client, args) {
    return defineCall({
      address: resolveToken(client, args).address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [args.account, args.spender]
    });
  }
  getAllowance2.call = call2;
})(getAllowance || (getAllowance = {}));

// node_modules/viem/_esm/actions/token/getBalance.js
async function getBalance2(client, parameters) {
  const { account: account_ = client.account, decimals, token, ...rest } = parameters;
  if (!account_)
    throw new AccountNotFoundError();
  const account = parseAccount(account_).address;
  const [amount, { decimals: resolved }] = await Promise.all([
    readContract(client, {
      ...rest,
      ...getBalance2.call(client, { account, token })
    }),
    resolveTokenWithDecimals(client, {
      decimals,
      token
    })
  ]);
  return toAmount(amount, resolved);
}
(function(getBalance3) {
  function call2(client, args) {
    const account_ = args.account ?? client.account;
    if (!account_)
      throw new AccountNotFoundError();
    const account = parseAccount(account_).address;
    return defineCall({
      address: resolveToken(client, args).address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account]
    });
  }
  getBalance3.call = call2;
})(getBalance2 || (getBalance2 = {}));

// node_modules/viem/_esm/actions/token/getMetadata.js
async function getMetadata(client, parameters) {
  const { token, ...rest } = parameters;
  const { address } = resolveToken(client, { token });
  const declared = findDeclaredToken(client, token);
  const [decimals_, name, symbol] = await Promise.all([
    declared?.decimals ?? readContract(client, {
      ...rest,
      abi: erc20Abi,
      address,
      functionName: "decimals"
    }),
    declared?.name ?? readContract(client, {
      ...rest,
      abi: erc20Abi,
      address,
      functionName: "name"
    }),
    declared?.symbol ?? readContract(client, {
      ...rest,
      abi: erc20Abi,
      address,
      functionName: "symbol"
    })
  ]);
  return {
    decimals: decimals_,
    name,
    symbol
  };
}

// node_modules/viem/_esm/actions/token/getTotalSupply.js
async function getTotalSupply(client, parameters) {
  const { decimals, token, ...rest } = parameters;
  const [amount, { decimals: resolved }] = await Promise.all([
    readContract(client, {
      ...rest,
      ...getTotalSupply.call(client, { token })
    }),
    resolveTokenWithDecimals(client, {
      decimals,
      token
    })
  ]);
  return toAmount(amount, resolved);
}
(function(getTotalSupply2) {
  function call2(client, args) {
    return defineCall({
      address: resolveToken(client, args).address,
      abi: erc20Abi,
      args: [],
      functionName: "totalSupply"
    });
  }
  getTotalSupply2.call = call2;
})(getTotalSupply || (getTotalSupply = {}));

// node_modules/viem/_esm/clients/decorators/public.js
function publicActions(client) {
  return {
    call: (args) => call(client, args),
    createAccessList: (args) => createAccessList(client, args),
    createBlockFilter: () => createBlockFilter(client),
    createContractEventFilter: (args) => createContractEventFilter(client, args),
    createEventFilter: (args) => createEventFilter(client, args),
    createPendingTransactionFilter: () => createPendingTransactionFilter(client),
    estimateContractGas: (args) => estimateContractGas(client, args),
    estimateGas: (args) => estimateGas(client, args),
    getBalance: (args) => getBalance(client, args),
    getBlobBaseFee: () => getBlobBaseFee(client),
    getBlock: (args) => getBlock(client, args),
    getBlockNumber: (args) => getBlockNumber(client, args),
    getBlockReceipts: (args) => getBlockReceipts(client, args),
    getBlockTransactionCount: (args) => getBlockTransactionCount(client, args),
    getBytecode: (args) => getCode(client, args),
    getChainId: () => getChainId(client),
    getCode: (args) => getCode(client, args),
    getContractEvents: (args) => getContractEvents(client, args),
    getDelegation: (args) => getDelegation(client, args),
    getEip712Domain: (args) => getEip712Domain(client, args),
    getEnsAddress: (args) => getEnsAddress(client, args),
    getEnsAvatar: (args) => getEnsAvatar(client, args),
    getEnsName: (args) => getEnsName(client, args),
    getEnsResolver: (args) => getEnsResolver(client, args),
    getEnsText: (args) => getEnsText(client, args),
    getFeeHistory: (args) => getFeeHistory(client, args),
    estimateFeesPerGas: (args) => estimateFeesPerGas(client, args),
    getFilterChanges: (args) => getFilterChanges(client, args),
    getFilterLogs: (args) => getFilterLogs(client, args),
    getGasPrice: () => getGasPrice(client),
    getLogs: (args) => getLogs(client, args),
    getProof: (args) => getProof(client, args),
    estimateMaxPriorityFeePerGas: (args) => estimateMaxPriorityFeePerGas(client, args),
    fillTransaction: (args) => fillTransaction(client, args),
    getRawTransaction: (args) => getRawTransaction(client, args),
    getStorageAt: (args) => getStorageAt(client, args),
    getTransaction: (args) => getTransaction(client, args),
    getTransactionConfirmations: (args) => getTransactionConfirmations(client, args),
    getTransactionCount: (args) => getTransactionCount(client, args),
    getTransactionReceipt: (args) => getTransactionReceipt(client, args),
    multicall: (args) => multicall(client, args),
    prepareTransactionRequest: (args) => prepareTransactionRequest(client, args),
    readContract: (args) => readContract(client, args),
    sendRawTransaction: (args) => sendRawTransaction(client, args),
    sendRawTransactionSync: (args) => sendRawTransactionSync(client, args),
    simulate: (args) => simulateBlocks(client, args),
    simulateBlocks: (args) => simulateBlocks(client, args),
    simulateCalls: (args) => simulateCalls(client, args),
    simulateContract: (args) => simulateContract(client, args),
    verifyHash: (args) => verifyHash(client, args),
    verifyMessage: (args) => verifyMessage(client, args),
    verifySiweMessage: (args) => verifySiweMessage(client, args),
    verifyTypedData: (args) => verifyTypedData(client, args),
    uninstallFilter: (args) => uninstallFilter(client, args),
    waitForTransactionReceipt: (args) => waitForTransactionReceipt(client, args),
    watchBlockHeaders: (args) => watchBlockHeaders(client, args),
    watchBlocks: (args) => watchBlocks(client, args),
    watchBlockNumber: (args) => watchBlockNumber(client, args),
    watchContractEvent: (args) => watchContractEvent(client, args),
    watchEvent: (args) => watchEvent(client, args),
    watchPendingTransactions: (args) => watchPendingTransactions(client, args),
    token: bindPublicToken(client)
  };
}
function bindPublicToken(client) {
  return {
    getAllowance: bindActionDecorators(client, getAllowance),
    getBalance: bindActionDecorators(client, getBalance2),
    getMetadata: bindActionDecorators(client, getMetadata),
    getTotalSupply: bindActionDecorators(client, getTotalSupply)
  };
}

// node_modules/viem/_esm/clients/createPublicClient.js
function createPublicClient(parameters) {
  const { key = "public", name = "Public Client" } = parameters;
  const client = createClient({
    ...parameters,
    key,
    name,
    type: "publicClient"
  });
  return client.extend(publicActions);
}

// node_modules/viem/_esm/clients/transports/createTransport.js
function createTransport({ key, methods, name, request, retryCount = 3, retryDelay = 150, timeout, type }, value) {
  const uid2 = uid();
  return {
    config: {
      key,
      methods,
      name,
      request,
      retryCount,
      retryDelay,
      timeout,
      type
    },
    request: buildRequest(request, { methods, retryCount, retryDelay, uid: uid2 }),
    value
  };
}

// node_modules/viem/_esm/errors/transport.js
var UrlRequiredError = class extends BaseError {
  constructor() {
    super("No URL was provided to the Transport. Please provide a valid RPC URL to the Transport.", {
      docsPath: "/docs/clients/intro",
      name: "UrlRequiredError"
    });
  }
};

// node_modules/viem/_esm/clients/transports/http.js
var signalId = 0;
var signalIds = /* @__PURE__ */ new WeakMap();
function getSignalId(signal) {
  if (!signal)
    return "default";
  const id = signalIds.get(signal);
  if (id !== void 0)
    return id;
  const nextId = signalId++;
  signalIds.set(signal, nextId);
  return nextId;
}
function http(url, config = {}) {
  const { batch, fetchFn, fetchOptions, key = "http", maxResponseBodySize, methods, name = "HTTP JSON-RPC", onFetchRequest, onFetchResponse, retryDelay, raw } = config;
  return ({ chain, retryCount: retryCount_, timeout: timeout_ }) => {
    const { batchSize = 1e3, wait: wait2 = 0 } = typeof batch === "object" ? batch : {};
    const retryCount = config.retryCount ?? retryCount_;
    const timeout = timeout_ ?? config.timeout ?? 1e4;
    const url_ = url || chain?.rpcUrls.default.http[0];
    if (!url_)
      throw new UrlRequiredError();
    const rpcClient = getHttpRpcClient(url_, {
      fetchFn,
      fetchOptions,
      maxResponseBodySize,
      onRequest: onFetchRequest,
      onResponse: onFetchResponse,
      timeout
    });
    return createTransport({
      key,
      methods,
      name,
      async request({ method, params }, options) {
        const body = { method, params };
        const fetchOptions2 = options?.signal ? { signal: options.signal } : void 0;
        const { schedule } = createBatchScheduler({
          id: `${url_}.${getSignalId(options?.signal)}`,
          wait: wait2,
          shouldSplitBatch(requests) {
            return requests.length > batchSize;
          },
          fn: (body2) => rpcClient.request({
            body: body2,
            fetchOptions: fetchOptions2
          }),
          sort: (a4, b4) => a4.id - b4.id
        });
        const fn = async (body2) => batch ? schedule(body2) : [
          await rpcClient.request({
            body: body2,
            fetchOptions: fetchOptions2
          })
        ];
        const [{ error, result }] = await fn(body);
        if (raw)
          return { error, result };
        if (error)
          throw new RpcRequestError({
            body,
            error,
            url: url_
          });
        return result;
      },
      retryCount,
      retryDelay,
      timeout,
      type: "http"
    }, {
      fetchOptions,
      url: url_
    });
  };
}

// node_modules/@metamask/agent-sdk/dist/lib.esm/queries-BvN3_url.js
var i2 = { Aborted: `RELAY_ABORTED`, Timeout: `RELAY_TIMEOUT`, Failed: `RELAY_FAILED`, UnsupportedChain: `GASLESS_UNSUPPORTED_CHAIN`, FeeTokenUnsupported: `GASLESS_FEE_TOKEN_UNSUPPORTED`, NetworksFetchFailed: `GASLESS_NETWORKS_FETCH_FAILED` };
function a2(t2) {
  let n = t2.failureDescription?.trim() || `ended in status ${t2.status}`, r3 = `Gasless relay failed (requestId: ${t2.requestId}): ${n}`;
  return new e2(i2.Failed, r3, t2.requestId);
}
function o2(e4) {
  return e4.status === s.CONFIRMED || e4.status === s.BROADCASTED;
}
function s3(n, r3) {
  return n instanceof x ? n : c3(n) ? new e2(i2.Aborted, `Gasless relay request aborted (requestId: ${r3})`, r3) : l2(n) ? new e2(i2.Timeout, `Gasless relay request timed out (requestId: ${r3})`, r3) : n instanceof Error ? n : Error(String(n));
}
function c3(e4) {
  if (!(e4 instanceof Error)) return false;
  if (e4.name === `AbortError`) return true;
  let t2 = e4.code;
  return t2 === `ABORTED` || t2 === `ABORT_ERROR` ? true : /\baborted\b/i.test(e4.message);
}
function l2(e4) {
  if (!(e4 instanceof Error)) return false;
  if (e4.name === `TimeoutError`) return true;
  let t2 = e4.code;
  return t2 === `TIMEOUT` || t2 === `ETIMEDOUT` ? true : /timed?\s*out/i.test(e4.message);
}
var u2 = (function(e4) {
  return e4.Eip155 = `eip155`, e4.Solana = `solana`, e4;
})({});
var d2 = 1440 * 60 * 1e3;
function p2(e4) {
  return e4.trim().toLowerCase();
}
function _2(e4) {
  return e4.serverWallet.networks;
}
function v2(e4) {
  return e4.balance.fullSupport.map(p2);
}
function y2(e4) {
  return new Set(v2(e4));
}
function S2(e4, t2) {
  return e4.serverWallet.networks.find((e5) => e5.chainId === t2)?.relaySupported;
}

// node_modules/@metamask/agent-sdk/dist/lib.esm/conversions-DulgS7tz.js
var import_http_helpers = __toESM(require_lib(), 1);
var o3 = `https://gas.api.cx.metamask.io`;
var s4 = { eip1559: `${o3}/networks/<chain_id>/suggestedGasFees?minPriorityFeeLow=0&minPriorityFeeMedium=0&minPriorityFeeHigh=0`, legacy: `${o3}/networks/<chain_id>/gasPrices` };
var c4 = /* @__PURE__ */ new Set([1]);
function l3(e4) {
  return c4.has(e4) ? s4 : void 0;
}
var u3 = { prod: { agenticProxyHost: `https://agentic-proxy.workers.cx.metamask.io`, oidcIssuer: `https://oidc.api.cx.metamask.io`, oidcClientId: `cli-agent-client`, introspectUrl: `https://authentication.api.cx.metamask.io/api/v2/token/introspect`, serverWalletBaseUrl: `https://agentic-mimir-service.api.cx.metamask.io`, mwpRelayUrl: `wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket`, dashboardUrl: `https://developer.metamask.io`, accountsApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/accounts`, priceApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/price`, predictRelayerUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/predict`, tokenApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/token`, bridgeApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/bridge`, lifiEarnApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/lifi-earn`, lifiQuoteApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/lifi-quote`, infuraRpcBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/infura-service/v1` }, dev: { agenticProxyHost: `https://dev-agentic-proxy.workers.cx.metamask.io`, oidcIssuer: `https://oidc.dev-api.cx.metamask.io`, oidcClientId: `cli-agent-client`, introspectUrl: `https://authentication.dev-api.cx.metamask.io/api/v2/token/introspect`, serverWalletBaseUrl: `https://agentic-mimir-service.dev-api.cx.metamask.io`, mwpRelayUrl: `wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket`, dashboardUrl: `https://develop-developer.metamask.io`, accountsApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/accounts`, priceApiBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/price`, predictRelayerUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/predict`, tokenApiBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/token`, bridgeApiBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/bridge`, lifiEarnApiBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/lifi-earn`, lifiQuoteApiBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/lifi-quote`, infuraRpcBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/infura-service/v1` }, uat: { agenticProxyHost: `https://uat-agentic-proxy.workers.cx.metamask.io`, oidcIssuer: `https://oidc.uat-api.cx.metamask.io`, oidcClientId: `cli-agent-client`, introspectUrl: `https://authentication.uat-api.cx.metamask.io/api/v2/token/introspect`, serverWalletBaseUrl: `https://agentic-mimir-service.uat-api.cx.metamask.io`, mwpRelayUrl: `wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket`, dashboardUrl: `https://staging-developer.metamask.io`, accountsApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/accounts`, priceApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/price`, tokenApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/token`, predictRelayerUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/predict`, bridgeApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/bridge`, lifiEarnApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/lifi-earn`, lifiQuoteApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/lifi-quote`, infuraRpcBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/infura-service/v1` } };
var d3 = { agenticProxyHost: `MM_AGENTIC_PROXY_HOST`, oidcIssuer: `MM_OIDC_ISSUER`, introspectUrl: `MM_INTROSPECT_URL`, serverWalletBaseUrl: `MM_SERVER_WALLET_BASE_URL`, bridgeApiBaseUrl: `MM_BRIDGE_API_BASE_URL`, accountsApiBaseUrl: `MM_ACCOUNTS_API_BASE_URL`, priceApiBaseUrl: `MM_PRICE_API_BASE_URL`, tokenApiBaseUrl: `MM_TOKEN_API_BASE_URL`, predictRelayerUrl: `MM_PREDICT_RELAYER_URL`, infuraRpcBaseUrl: `MM_INFURA_RPC_BASE_URL`, lifiEarnApiBaseUrl: `MM_LIFI_EARN_API_BASE_URL`, lifiQuoteApiBaseUrl: `MM_LIFI_QUOTE_API_BASE_URL` };
function f2(e4, t2) {
  let n = { ...e4 };
  for (let [e5, r4] of Object.entries(d3)) {
    let i5 = t2[r4]?.trim();
    i5 && (n[e5] = i5);
  }
  let r3 = t2.BRIDGE_API_BASE_URL?.trim();
  return r3 && !t2.MM_BRIDGE_API_BASE_URL?.trim() && (n.bridgeApiBaseUrl = r3), n;
}
function p3(e4, t2 = process.env) {
  return { env: e4, ...f2(u3[e4], t2) };
}
var h2 = { 1: `ethereum-mainnet`, 10: `optimism-mainnet`, 56: `bsc-mainnet`, 137: `polygon-mainnet`, 143: `monad-mainnet`, 999: `hyperevm-mainnet`, 1329: `sei-mainnet`, 4326: `megaeth-mainnet`, 4663: `robinhood-mainnet`, 8453: `base-mainnet`, 84532: `base-sepolia`, 42161: `arbitrum-mainnet`, 43114: `avalanche-mainnet`, 59144: `linea-mainnet`, 11155111: `ethereum-sepolia` };
function g2(e4) {
  return e4 === `prod` ? `prd` : e4;
}
function _3(e4) {
  let t2 = h2[e4];
  return t2 ? `tx-sentinel-${t2}` : null;
}
function v3(e4, t2, n) {
  let r3 = _3(n);
  return r3 ? `${e4.replace(/\/$/, ``)}/proxy/${g2(t2)}/${r3}` : null;
}
function y3(e4, t2, n, r3) {
  let i5 = v3(e4, t2, n);
  return i5 ? `${i5}/${r3.replace(/^\//, ``)}` : null;
}
function b2(e4) {
  return e4.getHeaders?.() ?? {};
}
function x3(e4, t2) {
  return { from: e4, to: t2.target, data: t2.callData, value: toHex(t2.value) };
}
function S3(e4) {
  return [{ address: `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`, from: e4 }];
}
var C2 = { low: 0, medium: 1, high: 2 };
function w2(e4, t2 = `low`) {
  if (!e4?.length) return;
  let n = C2[t2];
  return e4[n] ?? e4[Math.min(n, e4.length - 1)];
}
function T2(e4) {
  return !e4.error && !!e4.balanceNeededToken && !!e4.feeRecipient;
}
function E2(e4, t2) {
  if (t2) return e4.find((e5) => e5.token.address.toLowerCase() === t2.toLowerCase());
  let n = e4.filter(T2);
  if (n.length === 0) return e4.find((e5) => !e5.error) ?? e4[0];
  let r3 = n.reduce((e5, t3) => {
    let n2 = BigInt(t3.balanceNeededToken);
    return n2 < e5 ? n2 : e5;
  }, BigInt(n[0].balanceNeededToken)), i5 = n.filter((e5) => BigInt(e5.balanceNeededToken) === r3);
  return i5.length === 1 ? i5[0] : i5.find((e5) => e5.token.symbol.toLowerCase() === `musd`) ?? i5[0];
}
function D(e4) {
  let t2 = /* @__PURE__ */ new Set(), n = [];
  for (let r3 of e4) {
    let e5 = r3.token.address.toLowerCase();
    if (t2.has(e5)) continue;
    t2.add(e5);
    let i5 = r3.token.symbol?.trim();
    n.push(i5 || r3.token.address);
  }
  return n.join(`, `);
}
function O(n, r3) {
  let i5 = n.transactions?.length ? n.transactions.length - 1 : 0, a4 = w2(n.transactions?.[i5]?.fees)?.tokenFees ?? [], o6 = E2(a4, r3);
  if (!o6) {
    if (r3 && a4.length > 0) {
      let n2 = D(a4);
      throw new e2(i2.FeeTokenUnsupported, `Gas token ${r3} is not supported for gasless relay fees. Supported tokens: ${n2}.`);
    }
    throw new e2(`GASLESS_FEE_QUOTE_FAILED`, `Insufficient balance to cover the transfer and gasless relay fee.`);
  }
  if (o6.error) throw new e2(`GASLESS_FEE_QUOTE_FAILED`, o6.error);
  if (!o6.balanceNeededToken || !o6.feeRecipient) throw new e2(`GASLESS_FEE_QUOTE_FAILED`, `Sentinel fee quote response missing required fields.`);
  return { feeToken: o6.token.address, feeAmount: BigInt(o6.balanceNeededToken), feeRecipient: o6.feeRecipient, feeDecimals: o6.token.decimals, feeTokenSymbol: o6.token.symbol };
}
async function k(n, r3) {
  let i5 = y3(n.host, n.env, 1, `networks`);
  if (!i5) return /* @__PURE__ */ new Map();
  let a4 = await fetch(i5, { method: `GET`, headers: b2(n), ...r3 ? { signal: r3 } : {} });
  if (!a4.ok) throw new e2(i2.NetworksFetchFailed, `tx-sentinel /networks request failed with status ${a4.status}`);
  let o6 = await a4.json(), s7 = /* @__PURE__ */ new Map();
  for (let [e4, t2] of Object.entries(o6)) {
    let n2 = Number(e4);
    Number.isFinite(n2) && s7.set(n2, t2?.relayTransactions === true);
  }
  return s7;
}
async function A(e4, t2, r3) {
  if (r3) return S2(r3, t2) === true;
  try {
    return (await k(e4)).get(t2) === true;
  } catch {
    return false;
  }
}
async function j2(n, a4) {
  let o6 = v3(n.host, n.env, a4.chainId);
  if (!o6) throw new e2(i2.UnsupportedChain, `No tx-sentinel deployment for chain ${a4.chainId}.`);
  if (a4.executions.length === 0) throw new e2(`GASLESS_FEE_QUOTE_FAILED`, `At least one execution is required for a fee quote.`);
  let s7 = a4.authorizationList ?? S3(a4.from), c7 = await (0, import_http_helpers.post)(o6, (0, import_http_helpers.generateJsonRPCObject)(`infura_simulateTransactions`, [{ transactions: a4.executions.map((e4) => ({ ...x3(a4.from, e4), authorizationList: s7 })), suggestFees: { withTransfer: true, withFeeTransfer: true, with7702: true } }]), { headers: b2(n), method: `POST` });
  if (c7.error) throw new e2(`GASLESS_FEE_QUOTE_FAILED`, c7.error.message ?? `Sentinel fee quote failed.`);
  if (!c7.result) throw new e2(`GASLESS_FEE_QUOTE_FAILED`, `Sentinel fee quote response missing result.`);
  return O(c7.result, a4.feeToken);
}
var M2 = { ServerWallet: `server-wallet`, Byok: `byok` };
var R2 = 900 * 1e3;

// node_modules/@metamask/agent-sdk/dist/lib.esm/MetaMaskHttpClient-CEmf1UQF.js
var r2 = { accept: `application/json` };
var i4 = { accept: `text/event-stream` };
var a3 = `metamask`;
var o4 = class extends e2 {
  constructor(e4, t2, n) {
    super(e4, t2), this.status = n;
  }
};
var s5 = class {
  #e;
  #t;
  #n;
  #r;
  constructor(e4 = {}) {
    this.#e = e4.apiName ?? a3, this.#t = c5(this.#e), this.#n = e4.headers, this.#r = e4.getAuthTokenFn;
  }
  async fetchJson(n, i5) {
    return T(p.METAMASK_HTTP_FETCH_JSON, async () => {
      u4(i5.signal);
      let e4 = i5.useAuthToken && this.#r ? { authorization: `Bearer ${this.#r()}` } : void 0, t2 = await globalThis.fetch(n, { ...i5.init, headers: l4(r2, e4, this.#n, i5.init?.headers), signal: i5.signal });
      if (!t2.ok) throw new o4(this.#t, `${i5.label} request failed with HTTP ${t2.status}.`, t2.status);
      let a4 = await t2.text();
      if (a4.trim() !== ``) return JSON.parse(a4);
    }, { api_name: this.#e });
  }
  async fetchSse(n, r3) {
    return T(p.METAMASK_HTTP_FETCH_JSON, async () => {
      u4(r3.signal);
      let e4 = r3.useAuthToken && this.#r ? { authorization: `Bearer ${this.#r()}` } : void 0, t2 = await globalThis.fetch(n, { ...r3.init, headers: l4(i4, e4, this.#n, r3.init?.headers), signal: r3.signal });
      if (!t2.ok || !t2.body) throw new o4(this.#t, `${r3.label} request failed with HTTP ${t2.status}.`, t2.status);
      let a4 = t2.body.getReader(), s7 = new TextDecoder(), c7 = ``;
      try {
        for (; ; ) {
          u4(r3.signal);
          let { done: e5, value: t3 } = await a4.read();
          if (e5) break;
          c7 += s7.decode(t3, { stream: true }), c7 = d4(c7, this.#t, r3);
        }
        c7 += s7.decode(), c7.length > 0 && d4(`${c7}

`, this.#t, r3);
      } finally {
        a4.releaseLock();
      }
      r3.onClose?.();
    }, { api_name: this.#e });
  }
};
function c5(e4 = a3) {
  return `${e4.toUpperCase()}_API_ERROR`;
}
function l4(...e4) {
  let t2 = new Headers();
  for (let n of e4) n && new Headers(n).forEach((e5, n2) => {
    t2.set(n2, e5);
  });
  return t2;
}
function u4(e4) {
  if (e4?.aborted) throw typeof DOMException == `function` ? new DOMException(`Aborted`, `AbortError`) : Object.assign(Error(`Aborted`), { name: `AbortError` });
}
function d4(e4, t2, n) {
  let r3 = e4.split(`

`), i5 = r3.pop() ?? ``;
  for (let e5 of r3) {
    if (!e5.trim()) continue;
    let { eventName: r4, dataLines: i6 } = f3(e5);
    if (i6.length === 0) continue;
    let a4 = i6.join(`
`);
    if (r4 === `error`) throw new o4(t2, a4, 0);
    n.onMessage(JSON.parse(a4), r4);
  }
  return i5;
}
function f3(e4) {
  let t2 = `message`, n = [];
  for (let r3 of e4.split(`
`)) if (!r3.startsWith(`:`)) {
    if (r3.startsWith(`event:`)) {
      t2 = r3.slice(6).trim();
      continue;
    }
    r3.startsWith(`data:`) && n.push(r3.slice(5).trimStart());
  }
  return { eventName: t2, dataLines: n };
}

// node_modules/@metamask/agent-sdk/dist/lib.esm/migrations-DHWx6Iig.js
function o5(e4) {
  return e4 instanceof Error ? e4.message : String(e4);
}
async function s6(e4, n) {
  let { serverWalletBaseUrl: r3 } = p3(e4), i5 = `${d5(r3)}/v1/supportedNetworks`, a4 = await globalThis.fetch(i5, { headers: { accept: `application/json` }, signal: n });
  if (!a4.ok) throw Error(`Server wallet supported networks request failed with status ${a4.status}.`);
  let o6 = await a4.json();
  if (!Array.isArray(o6.networks)) throw Error(`Server wallet supported networks response is missing a networks array.`);
  return o6.networks;
}
async function c6(e4, n) {
  let { accountsApiBaseUrl: i5 } = p3(e4), a4 = new URL(`v2/supportedNetworks`, f4(i5)), o6 = await new s5({ apiName: `balance` }).fetchJson(a4, { label: `Supported networks (v2)`, signal: n });
  return { fullSupport: p4(o6.fullSupport), partialSupport: p4(o6.partialSupport) };
}
async function l5(n, r3, i5) {
  let { agenticProxyHost: a4 } = p3(n);
  return k({ host: a4, env: n, ...i5 ? { getHeaders: () => ({ Authorization: `Bearer ${i5()}` }) } : {} }, r3);
}
function u5(e4, t2) {
  return e4.map((e5) => ({ ...e5, relaySupported: t2.get(e5.chainId) === true }));
}
function d5(e4) {
  return e4.endsWith(`/`) ? e4.slice(0, -1) : e4;
}
function f4(e4) {
  return e4.endsWith(`/`) ? e4 : `${e4}/`;
}
function p4(e4) {
  return Array.isArray(e4) ? e4.map(p2) : e4 && typeof e4 == `object` ? Object.keys(e4).map(p2) : [];
}
var m2 = class {
  #e;
  #t;
  #n;
  #r;
  #i;
  constructor(e4) {
    this.#e = e4.env, this.#t = e4.storage, this.#n = e4.logger, this.#r = e4.getAuthTokenFn;
  }
  async getSnapshot(e4) {
    let t2 = this.#a();
    if (t2 && !_4(t2)) return this.#i = t2, t2;
    try {
      let { snapshot: n, complete: r3 } = await this.#o(e4, t2 ?? void 0);
      return r3 && (this.#i = n, this.#t.write(n)), n;
    } catch (e5) {
      if (t2) return this.#n?.warn(`Supported networks refresh failed; using stale cache. ${o5(e5)}`), this.#i = t2, t2;
      throw e5;
    }
  }
  #a() {
    return g3(this.#i ?? this.#t.read());
  }
  async #o(e4, t2) {
    let n = (/* @__PURE__ */ new Date()).toISOString(), r3 = false, i5 = false, [a4, d6, f5] = await Promise.all([s6(this.#e, e4), c6(this.#e, e4).catch((e5) => (this.#n?.warn(`Accounts supported networks fetch failed; balance capabilities unavailable. ${o5(e5)}`), r3 = true, null)), l5(this.#e, e4, this.#r).catch((e5) => (this.#n?.warn(`Gasless relay capability refresh failed; using server-wallet networks without relay flags. ${o5(e5)}`), i5 = true, null))]);
    return { snapshot: { refreshedAt: n, serverWallet: { networks: f5 ? u5(a4, f5) : h3(a4, t2) }, balance: d6 ?? t2?.balance ?? { fullSupport: [], partialSupport: [] } }, complete: !r3 && !i5 };
  }
};
function h3(e4, t2) {
  let n = new Map((t2?.serverWallet.networks ?? []).map((e5) => [e5.chainId, e5.relaySupported]));
  return e4.map((e5) => ({ ...e5, relaySupported: n.get(e5.chainId) ?? e5.relaySupported ?? false }));
}
function g3(e4) {
  if (!e4 || typeof e4 != `object` || !(`refreshedAt` in e4) || !(`serverWallet` in e4) || !(`balance` in e4)) return null;
  let t2 = e4;
  return !Array.isArray(t2.serverWallet.networks) || !Array.isArray(t2.balance.fullSupport) || !Array.isArray(t2.balance.partialSupport) ? null : t2;
}
function _4(e4) {
  let t2 = Date.parse(e4.refreshedAt);
  return Number.isFinite(t2) ? Date.now() - t2 >= d2 : true;
}
var y4 = { spotPrices: `v3/spot-prices`, supportedNetworks: `v2/supportedNetworks`, supportedVsCurrencies: `v1/supportedVsCurrencies`, historicalPrices: `v3/historical-prices` };
var b3 = { AssetIds: `assetIds`, VsCurrency: `vsCurrency`, IncludeMarketData: `includeMarketData`, CacheOnly: `cacheOnly`, UseExternalProviders: `useExternalProviders` };
var x4 = { TimePeriod: `timePeriod`, From: `from`, To: `to`, VsCurrency: `vsCurrency`, Interval: `interval` };
var S4 = class {
  #e;
  #t;
  constructor(e4, n) {
    let { priceApiBaseUrl: i5 } = p3(e4);
    this.#e = i5, this.#t = new s5({ apiName: `price`, getAuthTokenFn: n });
  }
  async getSpotPrices(e4) {
    if (!e4.assetIds || e4.assetIds.length === 0) throw new e2(`PRICE_SPOT_NO_ASSET_IDS`, `At least one CAIP asset id is required to fetch spot prices.`);
    let t2 = this.#n(y4.spotPrices), { searchParams: r3 } = t2;
    return r3.set(b3.AssetIds, e4.assetIds.join(`,`)), r3.set(b3.VsCurrency, e4.vsCurrency ?? `usd`), r3.set(b3.IncludeMarketData, String(e4.includeMarketData ?? false)), r3.set(b3.CacheOnly, String(e4.cacheOnly ?? false)), r3.set(b3.UseExternalProviders, String(e4.useExternalProviders ?? false)), this.#t.fetchJson(t2, { label: `Spot prices`, signal: e4.signal, useAuthToken: true });
  }
  async getSupportedNetworksV2(e4 = {}) {
    let t2 = this.#n(y4.supportedNetworks);
    return this.#t.fetchJson(t2, { label: `Supported networks (v2)`, signal: e4.signal, useAuthToken: true });
  }
  async getSupportedVsCurrencies(e4 = {}) {
    let t2 = this.#n(y4.supportedVsCurrencies);
    return this.#t.fetchJson(t2, { label: `Supported vs currencies`, signal: e4.signal, useAuthToken: true });
  }
  async getHistoricalPricesByCaipAssetId(e4) {
    if (!e4.chainId) throw new e2(`PRICE_HISTORICAL_NO_CHAIN_ID`, `chainId is required to fetch historical prices.`);
    if (!e4.assetType) throw new e2(`PRICE_HISTORICAL_NO_ASSET_TYPE`, `assetType is required to fetch historical prices.`);
    let t2 = `${y4.historicalPrices}/${encodeURIComponent(e4.chainId)}/${encodeURIComponent(e4.assetType)}`, r3 = this.#n(t2), { searchParams: i5 } = r3;
    return e4.timePeriod !== void 0 && i5.set(x4.TimePeriod, e4.timePeriod), e4.from !== void 0 && i5.set(x4.From, String(e4.from)), e4.to !== void 0 && i5.set(x4.To, String(e4.to)), i5.set(x4.VsCurrency, e4.vsCurrency ?? `usd`), e4.interval !== void 0 && i5.set(x4.Interval, e4.interval), this.#t.fetchJson(r3, { label: `Historical prices`, signal: e4.signal, useAuthToken: true });
  }
  #n(e4) {
    return new URL(e4, `${this.#e}/`);
  }
};
var T3 = `0.0.1`;
var E3 = [];

// node_modules/@metamask/agent-sdk/dist/lib.esm/wallet-state-DE2tXA-Y.js
var e3 = { BYOK: `byok`, Server: `server` };

export {
  i,
  o,
  d,
  f,
  p,
  w,
  T,
  I,
  e2 as e,
  formatUnits,
  zeroAddress,
  createPublicClient,
  http,
  a2 as a,
  o2,
  s3 as s,
  _2 as _,
  y2 as y,
  l3 as l,
  A,
  j2 as j,
  M2 as M,
  s5 as s2,
  m2 as m,
  S4 as S,
  T3 as T2,
  E3 as E,
  e3 as e2
};
