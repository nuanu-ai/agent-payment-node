import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  c2 as c,
  s,
  x
} from "./chunk-IXRUFS4W.mjs";
import {
  require_cjs
} from "./chunk-CW2DSIM7.mjs";
import {
  require_objectSpread2
} from "./chunk-ITJRA3TR.mjs";
import {
  toHex
} from "./chunk-FXOPQFK3.mjs";
import {
  require_loglevel
} from "./chunk-E2KNBJAZ.mjs";
import {
  __esm,
  __toESM
} from "./chunk-B7AVLEE2.mjs";

// node_modules/tslib/tslib.es6.mjs
function __extends(d6, b4) {
  if (typeof b4 !== "function" && b4 !== null)
    throw new TypeError("Class extends value " + String(b4) + " is not a constructor or null");
  extendStatics(d6, b4);
  function __() {
    this.constructor = d6;
  }
  d6.prototype = b4 === null ? Object.create(b4) : (__.prototype = b4.prototype, new __());
}
function __rest(s7, e4) {
  var t = {};
  for (var p5 in s7) if (Object.prototype.hasOwnProperty.call(s7, p5) && e4.indexOf(p5) < 0)
    t[p5] = s7[p5];
  if (s7 != null && typeof Object.getOwnPropertySymbols === "function")
    for (var i4 = 0, p5 = Object.getOwnPropertySymbols(s7); i4 < p5.length; i4++) {
      if (e4.indexOf(p5[i4]) < 0 && Object.prototype.propertyIsEnumerable.call(s7, p5[i4]))
        t[p5[i4]] = s7[p5[i4]];
    }
  return t;
}
function __awaiter(thisArg, _arguments, P2, generator) {
  function adopt(value) {
    return value instanceof P2 ? value : new P2(function(resolve) {
      resolve(value);
    });
  }
  return new (P2 || (P2 = Promise))(function(resolve, reject) {
    function fulfilled(value) {
      try {
        step(generator.next(value));
      } catch (e4) {
        reject(e4);
      }
    }
    function rejected(value) {
      try {
        step(generator["throw"](value));
      } catch (e4) {
        reject(e4);
      }
    }
    function step(result) {
      result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
    }
    step((generator = generator.apply(thisArg, _arguments || [])).next());
  });
}
function __generator(thisArg, body) {
  var _5 = { label: 0, sent: function() {
    if (t[0] & 1) throw t[1];
    return t[1];
  }, trys: [], ops: [] }, f5, y5, t, g4 = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
  return g4.next = verb(0), g4["throw"] = verb(1), g4["return"] = verb(2), typeof Symbol === "function" && (g4[Symbol.iterator] = function() {
    return this;
  }), g4;
  function verb(n) {
    return function(v5) {
      return step([n, v5]);
    };
  }
  function step(op) {
    if (f5) throw new TypeError("Generator is already executing.");
    while (g4 && (g4 = 0, op[0] && (_5 = 0)), _5) try {
      if (f5 = 1, y5 && (t = op[0] & 2 ? y5["return"] : op[0] ? y5["throw"] || ((t = y5["return"]) && t.call(y5), 0) : y5.next) && !(t = t.call(y5, op[1])).done) return t;
      if (y5 = 0, t) op = [op[0] & 2, t.value];
      switch (op[0]) {
        case 0:
        case 1:
          t = op;
          break;
        case 4:
          _5.label++;
          return { value: op[1], done: false };
        case 5:
          _5.label++;
          y5 = op[1];
          op = [0];
          continue;
        case 7:
          op = _5.ops.pop();
          _5.trys.pop();
          continue;
        default:
          if (!(t = _5.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) {
            _5 = 0;
            continue;
          }
          if (op[0] === 3 && (!t || op[1] > t[0] && op[1] < t[3])) {
            _5.label = op[1];
            break;
          }
          if (op[0] === 6 && _5.label < t[1]) {
            _5.label = t[1];
            t = op;
            break;
          }
          if (t && _5.label < t[2]) {
            _5.label = t[2];
            _5.ops.push(op);
            break;
          }
          if (t[2]) _5.ops.pop();
          _5.trys.pop();
          continue;
      }
      op = body.call(thisArg, _5);
    } catch (e4) {
      op = [6, e4];
      y5 = 0;
    } finally {
      f5 = t = 0;
    }
    if (op[0] & 5) throw op[1];
    return { value: op[0] ? op[1] : void 0, done: true };
  }
}
function __spreadArray(to, from, pack) {
  if (pack || arguments.length === 2) for (var i4 = 0, l6 = from.length, ar; i4 < l6; i4++) {
    if (ar || !(i4 in from)) {
      if (!ar) ar = Array.prototype.slice.call(from, 0, i4);
      ar[i4] = from[i4];
    }
  }
  return to.concat(ar || Array.prototype.slice.call(from));
}
var extendStatics, __assign;
var init_tslib_es6 = __esm({
  "node_modules/tslib/tslib.es6.mjs"() {
    extendStatics = function(d6, b4) {
      extendStatics = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(d7, b5) {
        d7.__proto__ = b5;
      } || function(d7, b5) {
        for (var p5 in b5) if (Object.prototype.hasOwnProperty.call(b5, p5)) d7[p5] = b5[p5];
      };
      return extendStatics(d6, b4);
    };
    __assign = function() {
      __assign = Object.assign || function __assign2(t) {
        for (var s7, i4 = 1, n = arguments.length; i4 < n; i4++) {
          s7 = arguments[i4];
          for (var p5 in s7) if (Object.prototype.hasOwnProperty.call(s7, p5)) t[p5] = s7[p5];
        }
        return t;
      };
      return __assign.apply(this, arguments);
    };
  }
});

// node_modules/@metamask/agent-sdk/dist/lib.esm/sdkVersion-Dh9_pqaQ.js
var e = `6.1.4`;

// node_modules/@segment/analytics-core/dist/esm/events/index.js
init_tslib_es6();

// node_modules/dset/dist/index.mjs
function dset(obj, keys, val) {
  keys.split && (keys = keys.split("."));
  var i4 = 0, l6 = keys.length, t = obj, x5, k2;
  while (i4 < l6) {
    k2 = "" + keys[i4++];
    if (k2 === "__proto__" || k2 === "constructor" || k2 === "prototype") break;
    t = t[k2] = i4 === l6 ? val : typeof (x5 = t[k2]) === typeof keys ? x5 : keys[i4] * 0 !== 0 || !!~("" + keys[i4]).indexOf(".") ? {} : [];
  }
}

// node_modules/@segment/analytics-core/dist/esm/utils/pick.js
var pickBy = function(obj, fn) {
  return Object.keys(obj).filter(function(k2) {
    return fn(k2, obj[k2]);
  }).reduce(function(acc, key) {
    return acc[key] = obj[key], acc;
  }, {});
};

// node_modules/@segment/analytics-core/dist/esm/validation/errors.js
init_tslib_es6();
var ValidationError = (
  /** @class */
  (function(_super) {
    __extends(ValidationError2, _super);
    function ValidationError2(field, message2) {
      var _this = _super.call(this, "".concat(field, " ").concat(message2)) || this;
      _this.field = field;
      return _this;
    }
    return ValidationError2;
  })(Error)
);

// node_modules/@segment/analytics-core/dist/esm/validation/helpers.js
function isString(obj) {
  return typeof obj === "string";
}
function exists(val) {
  return val !== void 0 && val !== null;
}
function isPlainObject(obj) {
  return Object.prototype.toString.call(obj).slice(8, -1).toLowerCase() === "object";
}

// node_modules/@segment/analytics-core/dist/esm/validation/assertions.js
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
  if (!exists(id)) {
    throw new ValidationError(USER_FIELD_NAME, nilError);
  } else if (!isString(id)) {
    throw new ValidationError(USER_FIELD_NAME, stringError);
  }
}
function assertEventExists(event) {
  if (!exists(event)) {
    throw new ValidationError("Event", nilError);
  }
  if (typeof event !== "object") {
    throw new ValidationError("Event", objError);
  }
}
function assertEventType(event) {
  if (!isString(event.type)) {
    throw new ValidationError(".type", stringError);
  }
}
function assertTrackEventName(event) {
  if (!isString(event.event)) {
    throw new ValidationError(".event", stringError);
  }
}
function assertTrackEventProperties(event) {
  if (!isPlainObject(event.properties)) {
    throw new ValidationError(".properties", objError);
  }
}
function assertTraits(event) {
  if (!isPlainObject(event.traits)) {
    throw new ValidationError(".traits", objError);
  }
}
function assertMessageId(event) {
  if (!isString(event.messageId)) {
    throw new ValidationError(".messageId", stringError);
  }
}
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

// node_modules/@segment/analytics-core/dist/esm/events/index.js
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
      return this.normalize(__assign(__assign({}, this.baseEvent()), { event, type: "track", properties: properties !== null && properties !== void 0 ? properties : {}, options: __assign({}, options), integrations: __assign({}, integrationOptions) }));
    };
    CoreEventFactory2.prototype.page = function(category, page, properties, options, integrationOptions) {
      var _a;
      this.settings.onEventMethodCall({ type: "page", options });
      var event = {
        type: "page",
        properties: __assign({}, properties),
        options: __assign({}, options),
        integrations: __assign({}, integrationOptions)
      };
      if (category !== null) {
        event.category = category;
        event.properties = (_a = event.properties) !== null && _a !== void 0 ? _a : {};
        event.properties.category = category;
      }
      if (page !== null) {
        event.name = page;
      }
      return this.normalize(__assign(__assign({}, this.baseEvent()), event));
    };
    CoreEventFactory2.prototype.screen = function(category, screen, properties, options, integrationOptions) {
      this.settings.onEventMethodCall({ type: "screen", options });
      var event = {
        type: "screen",
        properties: __assign({}, properties),
        options: __assign({}, options),
        integrations: __assign({}, integrationOptions)
      };
      if (category !== null) {
        event.category = category;
      }
      if (screen !== null) {
        event.name = screen;
      }
      return this.normalize(__assign(__assign({}, this.baseEvent()), event));
    };
    CoreEventFactory2.prototype.identify = function(userId, traits, options, integrationsOptions) {
      this.settings.onEventMethodCall({ type: "identify", options });
      return this.normalize(__assign(__assign({}, this.baseEvent()), { type: "identify", userId, traits: traits !== null && traits !== void 0 ? traits : {}, options: __assign({}, options), integrations: integrationsOptions }));
    };
    CoreEventFactory2.prototype.group = function(groupId, traits, options, integrationOptions) {
      this.settings.onEventMethodCall({ type: "group", options });
      return this.normalize(__assign(__assign({}, this.baseEvent()), {
        type: "group",
        traits: traits !== null && traits !== void 0 ? traits : {},
        options: __assign({}, options),
        integrations: __assign({}, integrationOptions),
        //
        groupId
      }));
    };
    CoreEventFactory2.prototype.alias = function(to, from, options, integrationOptions) {
      this.settings.onEventMethodCall({ type: "alias", options });
      var base = {
        userId: to,
        type: "alias",
        options: __assign({}, options),
        integrations: __assign({}, integrationOptions)
      };
      if (from !== null) {
        base.previousId = from;
      }
      if (to === void 0) {
        return this.normalize(__assign(__assign({}, base), this.baseEvent()));
      }
      return this.normalize(__assign(__assign({}, this.baseEvent()), base));
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
          dset(eventOverrides, key, options[key]);
        } else {
          dset(context, key, options[key]);
        }
      });
      return [context, eventOverrides];
    };
    CoreEventFactory2.prototype.normalize = function(event) {
      var _a, _b;
      var integrationBooleans = Object.keys((_a = event.integrations) !== null && _a !== void 0 ? _a : {}).reduce(function(integrationNames, name) {
        var _a2;
        var _b2;
        return __assign(__assign({}, integrationNames), (_a2 = {}, _a2[name] = Boolean((_b2 = event.integrations) === null || _b2 === void 0 ? void 0 : _b2[name]), _a2));
      }, {});
      event.options = pickBy(event.options || {}, function(_5, value) {
        return value !== void 0;
      });
      var allIntegrations = __assign(__assign({}, integrationBooleans), (_b = event.options) === null || _b === void 0 ? void 0 : _b.integrations);
      var _c = event.options ? this.context(event.options) : [], context = _c[0], overrides = _c[1];
      var options = event.options, rest = __rest(event, ["options"]);
      var evt = __assign(__assign(__assign(__assign({ timestamp: /* @__PURE__ */ new Date() }, rest), { context, integrations: allIntegrations }), overrides), { messageId: options.messageId || this.settings.createMessageId() });
      this.settings.onFinishedEvent(evt);
      validateEvent(evt);
      return evt;
    };
    return CoreEventFactory2;
  })()
);

// node_modules/@segment/analytics-core/dist/esm/callback/index.js
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
function sleep(timeoutInMs) {
  return new Promise(function(resolve) {
    return setTimeout(resolve, timeoutInMs);
  });
}
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

// node_modules/@segment/analytics-core/dist/esm/priority-queue/index.js
init_tslib_es6();

// node_modules/@segment/analytics-generic-utils/dist/esm/create-deferred/create-deferred.js
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

// node_modules/@segment/analytics-generic-utils/dist/esm/emitter/emitter.js
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

// node_modules/@segment/analytics-core/dist/esm/priority-queue/backoff.js
function backoff(params) {
  var random = Math.random() + 1;
  var _a = params.minTimeout, minTimeout = _a === void 0 ? 500 : _a, _b = params.factor, factor = _b === void 0 ? 2 : _b, attempt2 = params.attempt, _c = params.maxTimeout, maxTimeout = _c === void 0 ? Infinity : _c;
  return Math.min(random * minTimeout * Math.pow(factor, attempt2), maxTimeout);
}

// node_modules/@segment/analytics-core/dist/esm/priority-queue/index.js
var ON_REMOVE_FROM_FUTURE = "onRemoveFromFuture";
var PriorityQueue = (
  /** @class */
  (function(_super) {
    __extends(PriorityQueue2, _super);
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
      var timeout = backoff({ attempt: this.getAttempts(item) });
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
      var attempt2 = this.updateAttempts(item);
      if (attempt2 > this.maxAttempts || this.includes(item)) {
        return false;
      }
      setTimeout(function() {
        _this.queue.push(item);
        _this.future = _this.future.filter(function(f5) {
          return f5.id !== item.id;
        });
        _this.emit(ON_REMOVE_FROM_FUTURE);
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
      return this.queue.includes(item) || this.future.includes(item) || Boolean(this.queue.find(function(i4) {
        return i4.id === item.id;
      })) || Boolean(this.future.find(function(i4) {
        return i4.id === item.id;
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
  })(Emitter)
);

// node_modules/@lukeed/uuid/dist/index.mjs
var IDX = 256;
var HEX = [];
var BUFFER;
while (IDX--) HEX[IDX] = (IDX + 256).toString(16).substring(1);
function v4() {
  var i4 = 0, num, out = "";
  if (!BUFFER || IDX + 16 > 256) {
    BUFFER = Array(i4 = 256);
    while (i4--) BUFFER[i4] = 256 * Math.random() | 0;
    i4 = IDX = 0;
  }
  for (; i4 < 16; i4++) {
    num = BUFFER[IDX + i4];
    if (i4 == 6) out += HEX[num & 15 | 64];
    else if (i4 == 8) out += HEX[num & 63 | 128];
    else out += HEX[num];
    if (i4 & 1 && i4 > 1 && i4 < 11) out += "-";
  }
  IDX++;
  return out;
}

// node_modules/@segment/analytics-core/dist/esm/logger/index.js
init_tslib_es6();
var CoreLogger = (
  /** @class */
  (function() {
    function CoreLogger2() {
      this._logs = [];
    }
    CoreLogger2.prototype.log = function(level, message2, extras) {
      var time = /* @__PURE__ */ new Date();
      this._logs.push({
        level,
        message: message2,
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
        var formatted = this._logs.reduce(function(logs, log2) {
          var _a;
          var _b, _c;
          var line = __assign(__assign({}, log2), { json: JSON.stringify(log2.extras, null, " "), extras: log2.extras });
          delete line["time"];
          var key = (_c = (_b = log2.time) === null || _b === void 0 ? void 0 : _b.toISOString()) !== null && _c !== void 0 ? _c : "";
          if (logs[key]) {
            key = "".concat(key, "-").concat(Math.random());
          }
          return __assign(__assign({}, logs), (_a = {}, _a[key] = line, _a));
        }, {});
        if (console.table) {
          console.table(formatted);
        } else {
          console.log(formatted);
        }
      } else {
        this.logs.forEach(function(logEntry) {
          var level = logEntry.level, message2 = logEntry.message, extras = logEntry.extras;
          if (level === "info" || level === "debug") {
            console.log(message2, extras !== null && extras !== void 0 ? extras : "");
          } else {
            console[level](message2, extras !== null && extras !== void 0 ? extras : "");
          }
        });
      }
      this._logs = [];
    };
    return CoreLogger2;
  })()
);

// node_modules/@segment/analytics-core/dist/esm/stats/index.js
init_tslib_es6();
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
        return __assign(__assign({}, m3), { tags: m3.tags.join(",") });
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
var NullStats = (
  /** @class */
  (function(_super) {
    __extends(NullStats2, _super);
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

// node_modules/@segment/analytics-core/dist/esm/context/index.js
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
var CoreContext = (
  /** @class */
  (function() {
    function CoreContext2(event, id, stats, logger) {
      if (id === void 0) {
        id = v4();
      }
      if (stats === void 0) {
        stats = new NullStats();
      }
      if (logger === void 0) {
        logger = new CoreLogger();
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
    CoreContext2.prototype.log = function(level, message2, extras) {
      this.logger.log(level, message2, extras);
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
      dset(this.event, path, val);
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

// node_modules/@segment/analytics-core/dist/esm/queue/event-queue.js
init_tslib_es6();

// node_modules/@segment/analytics-core/dist/esm/utils/group-by.js
init_tslib_es6();
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
    results[key] = __spreadArray(__spreadArray([], (_a = results[key]) !== null && _a !== void 0 ? _a : [], true), [item], false);
  });
  return results;
}

// node_modules/@segment/analytics-core/dist/esm/utils/is-thenable.js
var isThenable = function(value) {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
};

// node_modules/@segment/analytics-core/dist/esm/task/task-group.js
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
      if (isThenable(returnValue)) {
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

// node_modules/@segment/analytics-core/dist/esm/queue/delivery.js
init_tslib_es6();
function tryAsync(fn) {
  return __awaiter(this, void 0, void 0, function() {
    var err_1;
    return __generator(this, function(_a) {
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
    if (err instanceof ContextCancelation && err.type === "middleware_cancellation") {
      throw err;
    }
    if (err instanceof ContextCancelation) {
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
function ensure(ctx, plugin) {
  return attempt(ctx, plugin).then(function(newContext) {
    if (newContext instanceof CoreContext) {
      return newContext;
    }
    ctx.log("debug", "Context canceled");
    ctx.stats.increment("context_canceled");
    ctx.cancel(newContext);
  });
}

// node_modules/@segment/analytics-core/dist/esm/queue/event-queue.js
var CoreEventQueue = (
  /** @class */
  (function(_super) {
    __extends(CoreEventQueue2, _super);
    function CoreEventQueue2(priorityQueue) {
      var _this = _super.call(this) || this;
      _this.criticalTasks = createTaskGroup();
      _this.plugins = [];
      _this.failedInitializations = [];
      _this.flushing = false;
      _this.queue = priorityQueue;
      _this.queue.on(ON_REMOVE_FROM_FUTURE, function() {
        _this.scheduleFlush(0);
      });
      return _this;
    }
    CoreEventQueue2.prototype.register = function(ctx, plugin, instance) {
      return __awaiter(this, void 0, void 0, function() {
        var handleLoadError, err_1;
        var _this = this;
        return __generator(this, function(_a) {
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
      return __awaiter(this, void 0, void 0, function() {
        var e_1;
        return __generator(this, function(_a) {
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
      return __awaiter(this, void 0, void 0, function() {
        var willDeliver;
        return __generator(this, function(_a) {
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
      return __awaiter(this, void 0, void 0, function() {
        var _this = this;
        return __generator(this, function(_a) {
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
      return __awaiter(this, void 0, void 0, function() {
        var _this = this;
        return __generator(this, function(_a) {
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
      return __awaiter(this, void 0, void 0, function() {
        var start, done, failure, error, err_2, error;
        return __generator(this, function(_b) {
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
      var retriable = !(err instanceof ContextCancelation) || err.retry;
      if (!retriable) {
        return false;
      }
      return this.queue.pushWithBackoff(ctx);
    };
    CoreEventQueue2.prototype.flush = function() {
      return __awaiter(this, void 0, void 0, function() {
        var ctx, delivered, err_3, accepted;
        return __generator(this, function(_a) {
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
      var _a = groupBy(available, "type"), _b = _a.before, before = _b === void 0 ? [] : _b, _c = _a.enrichment, enrichment = _c === void 0 ? [] : _c, _d = _a.destination, destination = _d === void 0 ? [] : _d, _e = _a.after, after = _e === void 0 ? [] : _e;
      return {
        before,
        enrichment,
        destinations: destination,
        after
      };
    };
    CoreEventQueue2.prototype.flushOne = function(ctx) {
      var _a, _b;
      return __awaiter(this, void 0, void 0, function() {
        var _c, before, enrichment, _i, before_1, beforeWare, temp, _d, enrichment_1, enrichmentWare, temp, _e, destinations, after, afterCalls;
        return __generator(this, function(_f) {
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
              return [4, ensure(ctx, beforeWare)];
            case 2:
              temp = _f.sent();
              if (temp instanceof CoreContext) {
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
              return [4, attempt(ctx, enrichmentWare)];
            case 6:
              temp = _f.sent();
              if (temp instanceof CoreContext) {
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
                    return attempt(ctx, destination);
                  });
                  Promise.all(attempts).then(resolve).catch(reject);
                }, 0);
              })];
            case 9:
              _f.sent();
              ctx.stats.increment("message_delivered");
              this.emit("message_delivered", ctx);
              afterCalls = after.map(function(after2) {
                return attempt(ctx, after2);
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
  })(Emitter)
);

// node_modules/@segment/analytics-core/dist/esm/analytics/dispatch.js
init_tslib_es6();
var getDelay = function(startTimeInEpochMS, timeoutInMS) {
  var elapsedTime = Date.now() - startTimeInEpochMS;
  return Math.max((timeoutInMS !== null && timeoutInMS !== void 0 ? timeoutInMS : 300) - elapsedTime, 0);
};
function dispatch(ctx, queue, emitter, options) {
  return __awaiter(this, void 0, void 0, function() {
    var startTime, dispatched;
    return __generator(this, function(_a) {
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
          return [4, invokeCallback(dispatched, options.callback, getDelay(startTime, options.timeout))];
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

// node_modules/@segment/analytics-core/dist/esm/utils/bind-all.js
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

// node_modules/@segment/analytics-node/dist/esm/app/settings.js
var validateSettings = (settings) => {
  if (!settings.writeKey) {
    throw new ValidationError("writeKey", "writeKey is missing.");
  }
};

// node_modules/@segment/analytics-node/dist/esm/generated/version.js
var version = "3.1.0";

// node_modules/@segment/analytics-node/dist/esm/lib/create-url.js
var stripTrailingSlash = (str) => str.replace(/\/$/, "");
var tryCreateFormattedUrl = (host, path) => {
  return stripTrailingSlash(new URL(path || "", host).href);
};

// node_modules/@segment/analytics-node/dist/esm/plugins/segmentio/context-batch.js
var MAX_EVENT_SIZE_IN_KB = 32;
var MAX_BATCH_SIZE_IN_KB = 480;
var ContextBatch = class {
  id = v4();
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

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/base64url.js
import { Buffer as Buffer2 } from "node:buffer";

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0);
  const buf = new Uint8Array(size);
  let i4 = 0;
  for (const buffer of buffers) {
    buf.set(buffer, i4);
    i4 += buffer.length;
  }
  return buf;
}

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/base64url.js
var encode = (input) => Buffer2.from(input).toString("base64url");

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/util/errors.js
var JOSEError = class extends Error {
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var JOSENotSupported = class extends JOSEError {
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWSInvalid = class extends JOSEError {
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/is_key_object.js
import * as util from "node:util";
var is_key_object_default = (obj) => util.types.isKeyObject(obj);

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/webcrypto.js
import * as crypto from "node:crypto";
import * as util2 from "node:util";
var webcrypto2 = crypto.webcrypto;
var webcrypto_default = webcrypto2;
var isCryptoKey = (key) => util2.types.isCryptoKey(key);

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/lib/crypto_key.js
function unusable(name, prop = "algorithm.name") {
  return new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`);
}
function isAlgorithm(algorithm, name) {
  return algorithm.name === name;
}
function getHashLength(hash) {
  return parseInt(hash.name.slice(4), 10);
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

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/lib/invalid_key_input.js
function message(msg, actual, ...types4) {
  types4 = types4.filter(Boolean);
  if (types4.length > 2) {
    const last = types4.pop();
    msg += `one of type ${types4.join(", ")}, or ${last}.`;
  } else if (types4.length === 2) {
    msg += `one of type ${types4[0]} or ${types4[1]}.`;
  } else {
    msg += `of type ${types4[0]}.`;
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
var invalid_key_input_default = (actual, ...types4) => {
  return message("Key must be ", actual, ...types4);
};
function withAlg(alg, actual, ...types4) {
  return message(`Key for the ${alg} algorithm must be `, actual, ...types4);
}

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/is_key_like.js
var is_key_like_default = (key) => is_key_object_default(key) || isCryptoKey(key);
var types3 = ["KeyObject"];
if (globalThis.CryptoKey || webcrypto_default?.CryptoKey) {
  types3.push("CryptoKey");
}

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/lib/is_disjoint.js
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
var is_disjoint_default = isDisjoint;

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/lib/is_object.js
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

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/get_named_curve.js
import { KeyObject } from "node:crypto";

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/lib/is_jwk.js
function isJWK(key) {
  return isObject(key) && typeof key.kty === "string";
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

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/get_named_curve.js
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
      throw new JOSENotSupported("Unsupported key curve for this operation");
  }
};
var getNamedCurve2 = (kee, raw) => {
  let key;
  if (isCryptoKey(kee)) {
    key = KeyObject.from(kee);
  } else if (is_key_object_default(kee)) {
    key = kee;
  } else if (isJWK(kee)) {
    return kee.crv;
  } else {
    throw new TypeError(invalid_key_input_default(kee, ...types3));
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
var get_named_curve_default = getNamedCurve2;

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/check_key_length.js
import { KeyObject as KeyObject2 } from "node:crypto";
var check_key_length_default = (key, alg) => {
  let modulusLength;
  try {
    if (key instanceof KeyObject2) {
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

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/asn1.js
import { createPrivateKey, createPublicKey, KeyObject as KeyObject3 } from "node:crypto";
import { Buffer as Buffer3 } from "node:buffer";
var fromPKCS8 = (pem) => createPrivateKey({
  key: Buffer3.from(pem.replace(/(?:-----(?:BEGIN|END) PRIVATE KEY-----|\s)/g, ""), "base64"),
  type: "pkcs8",
  format: "der"
});

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/key/import.js
async function importPKCS8(pkcs8, alg, options) {
  if (typeof pkcs8 !== "string" || pkcs8.indexOf("-----BEGIN PRIVATE KEY-----") !== 0) {
    throw new TypeError('"pkcs8" must be PKCS#8 formatted string');
  }
  return fromPKCS8(pkcs8, alg, options);
}

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/lib/check_key_type.js
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
  if (allowJwk && isJWK(key)) {
    if (isSecretJWK(key) && jwkMatchesOp(alg, key, usage))
      return;
    throw new TypeError(`JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present`);
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types3, "Uint8Array", allowJwk ? "JSON Web Key" : null));
  }
  if (key.type !== "secret") {
    throw new TypeError(`${tag(key)} instances for symmetric algorithms must be of type "secret"`);
  }
};
var asymmetricTypeCheck = (alg, key, usage, allowJwk) => {
  if (allowJwk && isJWK(key)) {
    switch (usage) {
      case "sign":
        if (isPrivateJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a private JWK`);
      case "verify":
        if (isPublicJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a public JWK`);
    }
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types3, allowJwk ? "JSON Web Key" : null));
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
var check_key_type_default = checkKeyType.bind(void 0, false);
var checkKeyTypeWithJwk = checkKeyType.bind(void 0, true);

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/lib/validate_crit.js
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
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
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
var validate_crit_default = validateCrit;

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/dsa_digest.js
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
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/node_key.js
import { constants, KeyObject as KeyObject4 } from "node:crypto";
var ecCurveAlgMap = /* @__PURE__ */ new Map([
  ["ES256", "P-256"],
  ["ES256K", "secp256k1"],
  ["ES384", "P-384"],
  ["ES512", "P-521"]
]);
function keyForCrypto(alg, key) {
  let asymmetricKeyType;
  let asymmetricKeyDetails;
  let isJWK2;
  if (key instanceof KeyObject4) {
    asymmetricKeyType = key.asymmetricKeyType;
    asymmetricKeyDetails = key.asymmetricKeyDetails;
  } else {
    isJWK2 = true;
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
      check_key_length_default(key, alg);
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
      check_key_length_default(key, alg);
      options = {
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST
      };
      break;
    case "ES256":
    case "ES256K":
    case "ES384":
    case "ES512": {
      if (asymmetricKeyType !== "ec") {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be ec");
      }
      const actual = get_named_curve_default(key);
      const expected = ecCurveAlgMap.get(alg);
      if (actual !== expected) {
        throw new TypeError(`Invalid key curve for the algorithm, its curve must be ${expected}, got ${actual}`);
      }
      options = { dsaEncoding: "ieee-p1363" };
      break;
    }
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
  if (isJWK2) {
    return { format: "jwk", key, ...options };
  }
  return options ? { ...options, key } : key;
}

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/sign.js
import * as crypto2 from "node:crypto";
import { promisify } from "node:util";

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/hmac_digest.js
function hmacDigest(alg) {
  switch (alg) {
    case "HS256":
      return "sha256";
    case "HS384":
      return "sha384";
    case "HS512":
      return "sha512";
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/get_sign_verify_key.js
import { KeyObject as KeyObject5, createSecretKey } from "node:crypto";
function getSignVerifyKey(alg, key, usage) {
  if (key instanceof Uint8Array) {
    if (!alg.startsWith("HS")) {
      throw new TypeError(invalid_key_input_default(key, ...types3));
    }
    return createSecretKey(key);
  }
  if (key instanceof KeyObject5) {
    return key;
  }
  if (isCryptoKey(key)) {
    checkSigCryptoKey(key, alg, usage);
    return KeyObject5.from(key);
  }
  if (isJWK(key)) {
    if (alg.startsWith("HS")) {
      return createSecretKey(Buffer.from(key.k, "base64url"));
    }
    return key;
  }
  throw new TypeError(invalid_key_input_default(key, ...types3, "Uint8Array", "JSON Web Key"));
}

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/runtime/sign.js
var oneShotSign = promisify(crypto2.sign);
var sign2 = async (alg, key, data) => {
  const k2 = getSignVerifyKey(alg, key, "sign");
  if (alg.startsWith("HS")) {
    const hmac = crypto2.createHmac(hmacDigest(alg), k2);
    hmac.update(data);
    return hmac.digest();
  }
  return oneShotSign(dsaDigest(alg), data, keyForCrypto(alg, k2));
};
var sign_default = sign2;

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/lib/epoch.js
var epoch_default = (date) => Math.floor(date.getTime() / 1e3);

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/lib/secs.js
var minute = 60;
var hour = minute * 60;
var day = hour * 24;
var week = day * 7;
var year = day * 365.25;
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var secs_default = (str) => {
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

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/jws/flattened/sign.js
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
      throw new JWSInvalid("either setProtectedHeader or setUnprotectedHeader must be called before #sign()");
    }
    if (!is_disjoint_default(this._protectedHeader, this._unprotectedHeader)) {
      throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
    }
    const joseHeader = {
      ...this._protectedHeader,
      ...this._unprotectedHeader
    };
    const extensions = validate_crit_default(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, this._protectedHeader, joseHeader);
    let b64 = true;
    if (extensions.has("b64")) {
      b64 = this._protectedHeader.b64;
      if (typeof b64 !== "boolean") {
        throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
      }
    }
    const { alg } = joseHeader;
    if (typeof alg !== "string" || !alg) {
      throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
    }
    checkKeyTypeWithJwk(alg, key, "sign");
    let payload = this._payload;
    if (b64) {
      payload = encoder.encode(encode(payload));
    }
    let protectedHeader;
    if (this._protectedHeader) {
      protectedHeader = encoder.encode(encode(JSON.stringify(this._protectedHeader)));
    } else {
      protectedHeader = encoder.encode("");
    }
    const data = concat(protectedHeader, encoder.encode("."), payload);
    const signature = await sign_default(alg, key, data);
    const jws = {
      signature: encode(signature),
      payload: ""
    };
    if (b64) {
      jws.payload = decoder.decode(payload);
    }
    if (this._unprotectedHeader) {
      jws.header = this._unprotectedHeader;
    }
    if (this._protectedHeader) {
      jws.protected = decoder.decode(protectedHeader);
    }
    return jws;
  }
};

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/jws/compact/sign.js
var CompactSign = class {
  _flattened;
  constructor(payload) {
    this._flattened = new FlattenedSign(payload);
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

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/jwt/produce.js
function validateInput(label, input) {
  if (!Number.isFinite(input)) {
    throw new TypeError(`Invalid ${label} input`);
  }
  return input;
}
var ProduceJWT = class {
  _payload;
  constructor(payload = {}) {
    if (!isObject(payload)) {
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
      this._payload = { ...this._payload, nbf: validateInput("setNotBefore", epoch_default(input)) };
    } else {
      this._payload = { ...this._payload, nbf: epoch_default(/* @__PURE__ */ new Date()) + secs_default(input) };
    }
    return this;
  }
  setExpirationTime(input) {
    if (typeof input === "number") {
      this._payload = { ...this._payload, exp: validateInput("setExpirationTime", input) };
    } else if (input instanceof Date) {
      this._payload = { ...this._payload, exp: validateInput("setExpirationTime", epoch_default(input)) };
    } else {
      this._payload = { ...this._payload, exp: epoch_default(/* @__PURE__ */ new Date()) + secs_default(input) };
    }
    return this;
  }
  setIssuedAt(input) {
    if (typeof input === "undefined") {
      this._payload = { ...this._payload, iat: epoch_default(/* @__PURE__ */ new Date()) };
    } else if (input instanceof Date) {
      this._payload = { ...this._payload, iat: validateInput("setIssuedAt", epoch_default(input)) };
    } else if (typeof input === "string") {
      this._payload = {
        ...this._payload,
        iat: validateInput("setIssuedAt", epoch_default(/* @__PURE__ */ new Date()) + secs_default(input))
      };
    } else {
      this._payload = { ...this._payload, iat: validateInput("setIssuedAt", input) };
    }
    return this;
  }
};

// node_modules/@segment/analytics-node/node_modules/jose/dist/node/esm/jwt/sign.js
var SignJWT = class extends ProduceJWT {
  _protectedHeader;
  setProtectedHeader(protectedHeader) {
    this._protectedHeader = protectedHeader;
    return this;
  }
  async sign(key, options) {
    const sig = new CompactSign(encoder.encode(JSON.stringify(this._payload)));
    sig.setProtectedHeader(this._protectedHeader);
    if (Array.isArray(this._protectedHeader?.crit) && this._protectedHeader.crit.includes("b64") && this._protectedHeader.b64 === false) {
      throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
    }
    return sig.sign(key, options);
  }
};

// node_modules/@segment/analytics-node/dist/esm/lib/token-manager.js
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
  tokenEmitter = new Emitter();
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
    const timeUntilRefreshInMs = backoff({
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
    await sleep(waitTimeMs);
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
    const jti = v4();
    const currentUTCInSeconds = Math.round(Date.now() / 1e3) - this.clockSkewInSeconds;
    const jwtBody = {
      iss: this.clientId,
      sub: this.clientId,
      aud: this.authServer,
      iat: currentUTCInSeconds - ISSUED_AT_BUFFER_IN_SECONDS,
      exp: currentUTCInSeconds + EXPIRY_IN_SECONDS,
      jti
    };
    const key = await importPKCS8(this.clientKey, "RS256");
    const signedJwt = await new SignJWT(jwtBody).setProtectedHeader({ alg: this.alg, kid: this.keyId, typ: "JWT" }).sign(key);
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

// node_modules/@segment/analytics-node/dist/esm/lib/base-64-encode.js
import { Buffer as Buffer4 } from "buffer";
var b64encode = (str) => {
  return Buffer4.from(str).toString("base64");
};

// node_modules/@segment/analytics-node/dist/esm/plugins/segmentio/publisher.js
var MAX_RETRY_AFTER_SECONDS = 300;
var MAX_RETRY_AFTER_RETRIES = 20;
function sleep2(timeoutInMs, signal) {
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
function convertHeaders2(headers) {
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
  const lowercaseHeaders = convertHeaders2(headers);
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
    this._url = tryCreateFormattedUrl(host ?? "https://api.segment.io", path ?? "/v1/batch");
    this._httpRequestTimeout = httpRequestTimeout ?? 1e4;
    this._disable = Boolean(disable);
    this._httpClient = httpClient;
    this._writeKey = writeKey;
    this._basicAuth = b64encode(`${writeKey}:`);
    this._maxTotalBackoffDuration = maxTotalBackoffDuration ?? 43200;
    this._maxRateLimitDuration = maxRateLimitDuration ?? 43200;
    if (oauthSettings) {
      this._tokenManager = new TokenManager({
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
    const batch = new ContextBatch(this._flushAt);
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
    const { promise: ctxPromise, resolve } = createDeferred();
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
          await sleep2(waitMs, signal);
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
      let shouldRetry = false;
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
          headers: convertHeaders2(response.headers)
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
            shouldRetry = true;
            shouldCountTowardsMaxRetries = false;
          } else {
            shouldRetry = true;
            shouldCountTowardsMaxRetries = true;
          }
        }
        if (!shouldRetry) {
          if (status >= 500 && status < 600) {
            if (status === 511 && this._tokenManager) {
              shouldRetry = true;
            } else if (![501, 505, 511].includes(status)) {
              shouldRetry = true;
            }
          } else if (status >= 400 && status < 500) {
            if ([408, 410, 429, 460].includes(status)) {
              shouldRetry = true;
            } else {
              resolveFailedBatch(batch, failureReason);
              return;
            }
          } else {
            shouldRetry = true;
          }
        }
      } catch (err) {
        failureReason = err;
        shouldRetry = true;
      }
      if (!shouldRetry) {
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
      const delayMs = shouldCountTowardsMaxRetries ? backoff({
        attempt: countedRetries,
        minTimeout: 500,
        maxTimeout: 6e4
      }) : 0;
      try {
        await sleep2(delayMs, signal);
      } catch {
        resolveFailedBatch(batch, signal.reason);
        return;
      }
    }
  }
};
function resolveFailedBatch(batch, reason) {
  batch.getContexts().forEach((ctx) => ctx.setFailedDelivery({ reason }));
  batch.resolveEvents();
}

// node_modules/@segment/analytics-node/dist/esm/lib/env.js
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

// node_modules/@segment/analytics-node/dist/esm/plugins/segmentio/index.js
function normalizeEvent(ctx) {
  ctx.updateEvent("context.library.name", "@segment/analytics-node");
  ctx.updateEvent("context.library.version", version);
  const runtime = detectRuntime();
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
var createConfiguredNodePlugin = (props, emitter) => {
  const publisher = new Publisher(props, emitter);
  return {
    publisher,
    plugin: createNodePlugin(publisher)
  };
};

// node_modules/@segment/analytics-node/dist/esm/lib/get-message-id.js
var createMessageId = () => {
  return `node-next-${Date.now()}-${v4()}`;
};

// node_modules/@segment/analytics-node/dist/esm/app/event-factory.js
var NodeEventFactory = class extends CoreEventFactory {
  constructor() {
    super({
      createMessageId,
      onFinishedEvent: (event) => {
        assertUserIdentity(event);
      }
    });
  }
};

// node_modules/@segment/analytics-node/dist/esm/app/context.js
var Context = class extends CoreContext {
  static system() {
    return new this({ type: "track", event: "system" });
  }
};

// node_modules/@segment/analytics-node/dist/esm/app/dispatch-emit.js
var normalizeDispatchCb = (cb) => (ctx) => {
  const failedDelivery = ctx.failedDelivery();
  return failedDelivery ? cb(failedDelivery.reason, ctx) : cb(void 0, ctx);
};
var dispatchAndEmit = async (event, queue, emitter, callback) => {
  try {
    const context = new Context(event);
    const ctx = await dispatch(context, queue, emitter, {
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

// node_modules/@segment/analytics-node/dist/esm/app/emitter.js
var NodeEmitter = class extends Emitter {
};

// node_modules/@segment/analytics-node/dist/esm/app/event-queue.js
var NodePriorityQueue = class extends PriorityQueue {
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
var NodeEventQueue = class extends CoreEventQueue {
  constructor() {
    super(new NodePriorityQueue());
  }
};

// node_modules/@segment/analytics-node/dist/esm/lib/abort.js
var AbortSignal = class {
  onabort = null;
  aborted = false;
  eventEmitter = new Emitter();
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
var abortSignalAfterTimeout = (timeoutMs) => {
  if (detectRuntime() === "cloudflare-worker") {
    return [];
  }
  const ac = new (globalThis.AbortController || AbortController2)();
  const timeoutId = setTimeout(() => {
    ac.abort();
  }, timeoutMs);
  timeoutId?.unref?.();
  return [ac.signal, timeoutId];
};

// node_modules/@segment/analytics-node/dist/esm/lib/fetch.js
var fetch2 = (...args) => {
  return globalThis.fetch(...args);
};

// node_modules/@segment/analytics-node/dist/esm/lib/http-client.js
var FetchHTTPClient = class {
  _fetch;
  constructor(fetchFn) {
    this._fetch = fetchFn ?? fetch2;
  }
  async makeRequest(options) {
    const [signal, timeoutId] = abortSignalAfterTimeout(options.httpRequestTimeout);
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

// node_modules/@segment/analytics-node/dist/esm/app/analytics-node.js
var Analytics = class extends NodeEmitter {
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
    validateSettings(settings);
    this._eventFactory = new NodeEventFactory();
    this._queue = new NodeEventQueue();
    const flushInterval = settings.flushInterval ?? 1e4;
    this._closeAndFlushDefaultTimeout = Math.max(6e4, flushInterval) * 1.25;
    const { plugin, publisher } = createConfiguredNodePlugin({
      writeKey: settings.writeKey,
      host: settings.host,
      path: settings.path,
      maxRetries: settings.maxRetries ?? 10,
      flushAt: settings.flushAt ?? settings.maxEventsInBatch ?? 15,
      httpRequestTimeout: settings.httpRequestTimeout,
      disable: settings.disable,
      flushInterval,
      httpClient: typeof settings.httpClient === "function" ? new FetchHTTPClient(settings.httpClient) : settings.httpClient ?? new FetchHTTPClient(),
      oauthSettings: settings.oauthSettings,
      maxTotalBackoffDuration: settings.maxTotalBackoffDuration,
      maxRateLimitDuration: settings.maxRateLimitDuration
    }, this);
    this._publisher = publisher;
    this.ready = this.register(plugin).then(() => void 0);
    this.emit("initialize", settings);
    bindAll(this);
  }
  get VERSION() {
    return version;
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
    return pTimeout(promise, timeout).catch(() => {
      this._publisher.abort();
    });
  }
  _dispatch(segmentEvent, callback) {
    if (this._isClosed) {
      this.emit("call_after_close", segmentEvent);
      return void 0;
    }
    this._pendingEvents++;
    dispatchAndEmit(segmentEvent, this._queue, this, callback).catch((ctx) => ctx).finally(() => {
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
      const ctx = Context.system();
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
    const ctx = Context.system();
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

// node_modules/@metamask/agent-sdk/dist/lib.esm/analytics-C6hqwc-Q.js
function i(e4) {
  let t = e4.length;
  for (; t > 0 && e4[t - 1] === `/`; ) --t;
  return t === e4.length ? e4 : e4.slice(0, t);
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
  observeJobStatus(e4, t) {
    if (e4) {
      if (c2(e4)) return this.#e = true, this.#t ? void 0 : (this.#t = true, t(o.AWAITING_MFA));
      if (this.#e && !this.#i) {
        if (l(e4)) return this.#i = `rejected`, this.#r ? void 0 : (this.#r = true, t(`mfa_rejected`));
        if (u(e4) && (this.#i = `confirmed`, !this.#n)) return this.#n = true, t(`mfa_confirmed`);
      }
    }
  }
  resolveFinalStatus(e4) {
    return this.#i === `rejected` ? `mfa_rejected` : this.#i === `confirmed` && e4 === `success` ? `mfa_confirmed` : this.#e && !this.#i && e4 === `success` && this.#t ? o.AWAITING_MFA : e4;
  }
};
async function f(e4, t, n = {}) {
  await E(m.SDK_OPERATION_COMPLETED, { ...n, operation: e4, status: t });
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
    this.#e = new Analytics({ writeKey: e4.writeKey, host: i(e4.host), flushAt: e4.flushAt, flushInterval: e4.flushIntervalMs, ...e4.fetchImpl ? { httpClient: e4.fetchImpl } : {} }), this.#t = e4.anonymousId, this.#n = e4.now;
  }
  init() {
  }
  identify(e4, t) {
    let n = e4.trim();
    n && (this.#r = n, this.#a = true, this.#e.identify({ userId: n, anonymousId: this.#t, traits: R(t), timestamp: new Date(this.#n()), context: this.#o() }));
  }
  track(e4, t = {}) {
    let n = P({ ...this.#i, ...t });
    this.#a = true, this.#e.track({ event: e4, ...this.#r ? { userId: this.#r } : {}, anonymousId: this.#t, properties: n, timestamp: new Date(this.#n()), context: this.#o() });
  }
  setGlobalProperties(e4) {
    this.#i = { ...this.#i, ...P(e4) };
  }
  async flush(e4) {
    if (!this.#a) return false;
    this.#a = false;
    try {
      let t = this.#e.flush(), n = typeof e4 == `number` ? await Promise.race([t.then(() => true), new Promise((t2) => {
        setTimeout(t2, e4, false);
      })]) : await t.then(() => true);
      return n || (this.#a = true), n;
    } catch {
      return this.#a = true, false;
    }
  }
  #o() {
    return { library: { name: `@metamask/agent-sdk`, version: e } };
  }
};
function C(t = {}) {
  if (y) return b instanceof S;
  x2 = t;
  let n = t.envVars ?? N();
  if (M(n)) return b = new v(), y = true, false;
  let r2 = (n.MM_SEGMENT_WRITE_KEY || t.bundledWriteKey || `BXSMCuLm6uF8FN6Dn93toptUIw80CcTS`).trim();
  return r2 ? (b = new S({ writeKey: r2, host: t.host ?? n.MM_SEGMENT_HOST ?? `https://api.segment.io`, anonymousId: t.anonymousId ?? H(), fetchImpl: t.fetchImpl, flushAt: t.flushAt ?? 20, flushIntervalMs: t.flushIntervalMs ?? 5e3, now: t.now ?? Date.now }), b.init(), b.setGlobalProperties({ ...t.env ? { env: t.env } : {}, sdk_version: e, category: h.SDK }), y = true, true) : (b = new v(), y = false, false);
}
function w() {
  b = new v(), y = true;
}
async function T(e4, t, n = {}, r2 = {}) {
  j();
  let i4 = Date.now();
  await b.track(m.SDK_OPERATION_STARTED, { ...n, operation: e4, status: `started` });
  try {
    let a4 = await t(), o6 = r2.mfaTracker?.resolveFinalStatus(`success`) ?? `success`;
    return await b.track(m.SDK_OPERATION_COMPLETED, { ...n, ...F(r2.successProperties, a4), operation: e4, status: o6, duration_ms: Date.now() - i4 }), a4;
  } catch (t2) {
    let a4 = r2.mfaTracker?.resolveFinalStatus(`failure`) ?? `failure`;
    throw await b.track(m.SDK_OPERATION_COMPLETED, { ...n, operation: e4, status: a4, duration_ms: Date.now() - i4, ...V(t2) }), t2;
  }
}
function E(e4, t = {}) {
  return j(), b.track(e4, t);
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
  let t = {};
  for (let n of g) {
    let r2 = e4[n];
    if (n === `volume_usd`) {
      L(r2) && (t.volume_usd = r2);
      continue;
    }
    (z(r2) || _.has(n) && B(r2)) && (t[n] = r2);
  }
  return t;
}
function F(e4, t) {
  if (!e4) return {};
  try {
    return P({ ...e4(t) ?? {} });
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
  let t = {};
  for (let [n, r2] of Object.entries(e4)) z(r2) && (t[n] = r2);
  return t;
}
function z(e4) {
  return typeof e4 == `string` || typeof e4 == `number` || typeof e4 == `boolean`;
}
function B(e4) {
  return Array.isArray(e4) && e4.every((e5) => typeof e5 == `string`);
}
function V(e4) {
  let t = {};
  if (e4 && typeof e4 == `object`) {
    let n = e4;
    typeof n.code == `string` ? t.error_code = n.code : typeof n.name == `string` && n.name === `AbortError` && (t.error_code = `ABORTED`), typeof n.status == `number` && (t.http_status = n.status);
  }
  return t.error_code ??= `UNKNOWN`, t;
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
  constructor(e4, t, n, r2, i4) {
    super(t), this.code = e4, n !== void 0 && (this.requestId = n), r2 !== void 0 && (this.terminalStatus = r2), i4 !== void 0 && (this.failureCode = i4), this.name = `WalletRuntimeError`;
  }
};

// node_modules/@metamask/agent-sdk/dist/lib.esm/queries-BvN3_url.js
var i2 = { Aborted: `RELAY_ABORTED`, Timeout: `RELAY_TIMEOUT`, Failed: `RELAY_FAILED`, UnsupportedChain: `GASLESS_UNSUPPORTED_CHAIN`, FeeTokenUnsupported: `GASLESS_FEE_TOKEN_UNSUPPORTED`, NetworksFetchFailed: `GASLESS_NETWORKS_FETCH_FAILED` };
function a2(t) {
  let n = t.failureDescription?.trim() || `ended in status ${t.status}`, r2 = `Gasless relay failed (requestId: ${t.requestId}): ${n}`;
  return new e2(i2.Failed, r2, t.requestId);
}
function o2(e4) {
  return e4.status === s.CONFIRMED || e4.status === s.BROADCASTED;
}
function s3(n, r2) {
  return n instanceof x ? n : c3(n) ? new e2(i2.Aborted, `Gasless relay request aborted (requestId: ${r2})`, r2) : l2(n) ? new e2(i2.Timeout, `Gasless relay request timed out (requestId: ${r2})`, r2) : n instanceof Error ? n : Error(String(n));
}
function c3(e4) {
  if (!(e4 instanceof Error)) return false;
  if (e4.name === `AbortError`) return true;
  let t = e4.code;
  return t === `ABORTED` || t === `ABORT_ERROR` ? true : /\baborted\b/i.test(e4.message);
}
function l2(e4) {
  if (!(e4 instanceof Error)) return false;
  if (e4.name === `TimeoutError`) return true;
  let t = e4.code;
  return t === `TIMEOUT` || t === `ETIMEDOUT` ? true : /timed?\s*out/i.test(e4.message);
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
function S2(e4, t) {
  return e4.serverWallet.networks.find((e5) => e5.chainId === t)?.relaySupported;
}

// node_modules/@metamask/agent-sdk/node_modules/@toruslabs/http-helpers/dist/lib.esm/index.js
var import_objectSpread2 = __toESM(require_objectSpread2());
var import_deepmerge = __toESM(require_cjs());
var import_loglevel = __toESM(require_loglevel());
var log = import_loglevel.default.getLogger("http-helpers");
log.setLevel(import_loglevel.levels.INFO);
var apiKey = "torus-default";
var embedHost = "";
var gatewayAuthHeader = "x-api-key";
var gatewayEmbedHostHeader = "x-embed-host";
var sentry = null;
var tracingOrigins = [];
var tracingPaths = [];
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
var post = (url, data = {}, options_ = {}, customOptions = {}) => {
  const defaultOptions = {
    mode: "cors",
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  };
  if (customOptions.useAPIKey) {
    defaultOptions.headers = (0, import_objectSpread2.default)((0, import_objectSpread2.default)({}, defaultOptions.headers), getApiKeyHeaders());
  }
  options_.method = "POST";
  const options = (0, import_deepmerge.default)(defaultOptions, options_);
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
var generateJsonRPCObject = (method, parameters) => ({
  jsonrpc: "2.0",
  method,
  id: 10,
  params: parameters
});

// node_modules/@metamask/agent-sdk/dist/lib.esm/conversions-DulgS7tz.js
var o3 = `https://gas.api.cx.metamask.io`;
var s4 = { eip1559: `${o3}/networks/<chain_id>/suggestedGasFees?minPriorityFeeLow=0&minPriorityFeeMedium=0&minPriorityFeeHigh=0`, legacy: `${o3}/networks/<chain_id>/gasPrices` };
var c4 = /* @__PURE__ */ new Set([1]);
function l3(e4) {
  return c4.has(e4) ? s4 : void 0;
}
var u3 = { prod: { agenticProxyHost: `https://agentic-proxy.workers.cx.metamask.io`, oidcIssuer: `https://oidc.api.cx.metamask.io`, oidcClientId: `cli-agent-client`, introspectUrl: `https://authentication.api.cx.metamask.io/api/v2/token/introspect`, serverWalletBaseUrl: `https://agentic-mimir-service.api.cx.metamask.io`, mwpRelayUrl: `wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket`, dashboardUrl: `https://developer.metamask.io`, accountsApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/accounts`, priceApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/price`, predictRelayerUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/predict`, tokenApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/token`, bridgeApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/bridge`, lifiEarnApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/lifi-earn`, lifiQuoteApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/lifi-quote`, infuraRpcBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/infura-service/v1` }, dev: { agenticProxyHost: `https://dev-agentic-proxy.workers.cx.metamask.io`, oidcIssuer: `https://oidc.dev-api.cx.metamask.io`, oidcClientId: `cli-agent-client`, introspectUrl: `https://authentication.dev-api.cx.metamask.io/api/v2/token/introspect`, serverWalletBaseUrl: `https://agentic-mimir-service.dev-api.cx.metamask.io`, mwpRelayUrl: `wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket`, dashboardUrl: `https://develop-developer.metamask.io`, accountsApiBaseUrl: `https://agentic-proxy.workers.cx.metamask.io/proxy/prd/accounts`, priceApiBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/price`, predictRelayerUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/predict`, tokenApiBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/token`, bridgeApiBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/bridge`, lifiEarnApiBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/lifi-earn`, lifiQuoteApiBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/proxy/dev/lifi-quote`, infuraRpcBaseUrl: `https://dev-agentic-proxy.workers.cx.metamask.io/infura-service/v1` }, uat: { agenticProxyHost: `https://uat-agentic-proxy.workers.cx.metamask.io`, oidcIssuer: `https://oidc.uat-api.cx.metamask.io`, oidcClientId: `cli-agent-client`, introspectUrl: `https://authentication.uat-api.cx.metamask.io/api/v2/token/introspect`, serverWalletBaseUrl: `https://agentic-mimir-service.uat-api.cx.metamask.io`, mwpRelayUrl: `wss://mm-sdk-relay.api.cx.metamask.io/connection/websocket`, dashboardUrl: `https://staging-developer.metamask.io`, accountsApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/accounts`, priceApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/price`, tokenApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/token`, predictRelayerUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/predict`, bridgeApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/bridge`, lifiEarnApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/lifi-earn`, lifiQuoteApiBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/proxy/uat/lifi-quote`, infuraRpcBaseUrl: `https://uat-agentic-proxy.workers.cx.metamask.io/infura-service/v1` } };
var d3 = { agenticProxyHost: `MM_AGENTIC_PROXY_HOST`, oidcIssuer: `MM_OIDC_ISSUER`, introspectUrl: `MM_INTROSPECT_URL`, serverWalletBaseUrl: `MM_SERVER_WALLET_BASE_URL`, bridgeApiBaseUrl: `MM_BRIDGE_API_BASE_URL`, accountsApiBaseUrl: `MM_ACCOUNTS_API_BASE_URL`, priceApiBaseUrl: `MM_PRICE_API_BASE_URL`, tokenApiBaseUrl: `MM_TOKEN_API_BASE_URL`, predictRelayerUrl: `MM_PREDICT_RELAYER_URL`, infuraRpcBaseUrl: `MM_INFURA_RPC_BASE_URL`, lifiEarnApiBaseUrl: `MM_LIFI_EARN_API_BASE_URL`, lifiQuoteApiBaseUrl: `MM_LIFI_QUOTE_API_BASE_URL` };
function f2(e4, t) {
  let n = { ...e4 };
  for (let [e5, r3] of Object.entries(d3)) {
    let i4 = t[r3]?.trim();
    i4 && (n[e5] = i4);
  }
  let r2 = t.BRIDGE_API_BASE_URL?.trim();
  return r2 && !t.MM_BRIDGE_API_BASE_URL?.trim() && (n.bridgeApiBaseUrl = r2), n;
}
function p3(e4, t = process.env) {
  return { env: e4, ...f2(u3[e4], t) };
}
var h2 = { 1: `ethereum-mainnet`, 10: `optimism-mainnet`, 56: `bsc-mainnet`, 137: `polygon-mainnet`, 143: `monad-mainnet`, 999: `hyperevm-mainnet`, 1329: `sei-mainnet`, 4326: `megaeth-mainnet`, 4663: `robinhood-mainnet`, 8453: `base-mainnet`, 84532: `base-sepolia`, 42161: `arbitrum-mainnet`, 43114: `avalanche-mainnet`, 59144: `linea-mainnet`, 11155111: `ethereum-sepolia` };
function g2(e4) {
  return e4 === `prod` ? `prd` : e4;
}
function _3(e4) {
  let t = h2[e4];
  return t ? `tx-sentinel-${t}` : null;
}
function v3(e4, t, n) {
  let r2 = _3(n);
  return r2 ? `${e4.replace(/\/$/, ``)}/proxy/${g2(t)}/${r2}` : null;
}
function y3(e4, t, n, r2) {
  let i4 = v3(e4, t, n);
  return i4 ? `${i4}/${r2.replace(/^\//, ``)}` : null;
}
function b2(e4) {
  return e4.getHeaders?.() ?? {};
}
function x3(e4, t) {
  return { from: e4, to: t.target, data: t.callData, value: toHex(t.value) };
}
function S3(e4) {
  return [{ address: `0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B`, from: e4 }];
}
var C2 = { low: 0, medium: 1, high: 2 };
function w2(e4, t = `low`) {
  if (!e4?.length) return;
  let n = C2[t];
  return e4[n] ?? e4[Math.min(n, e4.length - 1)];
}
function T2(e4) {
  return !e4.error && !!e4.balanceNeededToken && !!e4.feeRecipient;
}
function E2(e4, t) {
  if (t) return e4.find((e5) => e5.token.address.toLowerCase() === t.toLowerCase());
  let n = e4.filter(T2);
  if (n.length === 0) return e4.find((e5) => !e5.error) ?? e4[0];
  let r2 = n.reduce((e5, t2) => {
    let n2 = BigInt(t2.balanceNeededToken);
    return n2 < e5 ? n2 : e5;
  }, BigInt(n[0].balanceNeededToken)), i4 = n.filter((e5) => BigInt(e5.balanceNeededToken) === r2);
  return i4.length === 1 ? i4[0] : i4.find((e5) => e5.token.symbol.toLowerCase() === `musd`) ?? i4[0];
}
function D(e4) {
  let t = /* @__PURE__ */ new Set(), n = [];
  for (let r2 of e4) {
    let e5 = r2.token.address.toLowerCase();
    if (t.has(e5)) continue;
    t.add(e5);
    let i4 = r2.token.symbol?.trim();
    n.push(i4 || r2.token.address);
  }
  return n.join(`, `);
}
function O(n, r2) {
  let i4 = n.transactions?.length ? n.transactions.length - 1 : 0, a4 = w2(n.transactions?.[i4]?.fees)?.tokenFees ?? [], o6 = E2(a4, r2);
  if (!o6) {
    if (r2 && a4.length > 0) {
      let n2 = D(a4);
      throw new e2(i2.FeeTokenUnsupported, `Gas token ${r2} is not supported for gasless relay fees. Supported tokens: ${n2}.`);
    }
    throw new e2(`GASLESS_FEE_QUOTE_FAILED`, `Insufficient balance to cover the transfer and gasless relay fee.`);
  }
  if (o6.error) throw new e2(`GASLESS_FEE_QUOTE_FAILED`, o6.error);
  if (!o6.balanceNeededToken || !o6.feeRecipient) throw new e2(`GASLESS_FEE_QUOTE_FAILED`, `Sentinel fee quote response missing required fields.`);
  return { feeToken: o6.token.address, feeAmount: BigInt(o6.balanceNeededToken), feeRecipient: o6.feeRecipient, feeDecimals: o6.token.decimals, feeTokenSymbol: o6.token.symbol };
}
async function k(n, r2) {
  let i4 = y3(n.host, n.env, 1, `networks`);
  if (!i4) return /* @__PURE__ */ new Map();
  let a4 = await fetch(i4, { method: `GET`, headers: b2(n), ...r2 ? { signal: r2 } : {} });
  if (!a4.ok) throw new e2(i2.NetworksFetchFailed, `tx-sentinel /networks request failed with status ${a4.status}`);
  let o6 = await a4.json(), s7 = /* @__PURE__ */ new Map();
  for (let [e4, t] of Object.entries(o6)) {
    let n2 = Number(e4);
    Number.isFinite(n2) && s7.set(n2, t?.relayTransactions === true);
  }
  return s7;
}
async function A(e4, t, r2) {
  if (r2) return S2(r2, t) === true;
  try {
    return (await k(e4)).get(t) === true;
  } catch {
    return false;
  }
}
async function j2(n, a4) {
  let o6 = v3(n.host, n.env, a4.chainId);
  if (!o6) throw new e2(i2.UnsupportedChain, `No tx-sentinel deployment for chain ${a4.chainId}.`);
  if (a4.executions.length === 0) throw new e2(`GASLESS_FEE_QUOTE_FAILED`, `At least one execution is required for a fee quote.`);
  let s7 = a4.authorizationList ?? S3(a4.from), c7 = await post(o6, generateJsonRPCObject(`infura_simulateTransactions`, [{ transactions: a4.executions.map((e4) => ({ ...x3(a4.from, e4), authorizationList: s7 })), suggestFees: { withTransfer: true, withFeeTransfer: true, with7702: true } }]), { headers: b2(n), method: `POST` });
  if (c7.error) throw new e2(`GASLESS_FEE_QUOTE_FAILED`, c7.error.message ?? `Sentinel fee quote failed.`);
  if (!c7.result) throw new e2(`GASLESS_FEE_QUOTE_FAILED`, `Sentinel fee quote response missing result.`);
  return O(c7.result, a4.feeToken);
}
var M2 = { ServerWallet: `server-wallet`, Byok: `byok` };
var R2 = 900 * 1e3;

// node_modules/@metamask/agent-sdk/dist/lib.esm/MetaMaskHttpClient-CEmf1UQF.js
var r = { accept: `application/json` };
var i3 = { accept: `text/event-stream` };
var a3 = `metamask`;
var o4 = class extends e2 {
  constructor(e4, t, n) {
    super(e4, t), this.status = n;
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
  async fetchJson(n, i4) {
    return T(p.METAMASK_HTTP_FETCH_JSON, async () => {
      u4(i4.signal);
      let e4 = i4.useAuthToken && this.#r ? { authorization: `Bearer ${this.#r()}` } : void 0, t = await globalThis.fetch(n, { ...i4.init, headers: l4(r, e4, this.#n, i4.init?.headers), signal: i4.signal });
      if (!t.ok) throw new o4(this.#t, `${i4.label} request failed with HTTP ${t.status}.`, t.status);
      let a4 = await t.text();
      if (a4.trim() !== ``) return JSON.parse(a4);
    }, { api_name: this.#e });
  }
  async fetchSse(n, r2) {
    return T(p.METAMASK_HTTP_FETCH_JSON, async () => {
      u4(r2.signal);
      let e4 = r2.useAuthToken && this.#r ? { authorization: `Bearer ${this.#r()}` } : void 0, t = await globalThis.fetch(n, { ...r2.init, headers: l4(i3, e4, this.#n, r2.init?.headers), signal: r2.signal });
      if (!t.ok || !t.body) throw new o4(this.#t, `${r2.label} request failed with HTTP ${t.status}.`, t.status);
      let a4 = t.body.getReader(), s7 = new TextDecoder(), c7 = ``;
      try {
        for (; ; ) {
          u4(r2.signal);
          let { done: e5, value: t2 } = await a4.read();
          if (e5) break;
          c7 += s7.decode(t2, { stream: true }), c7 = d4(c7, this.#t, r2);
        }
        c7 += s7.decode(), c7.length > 0 && d4(`${c7}

`, this.#t, r2);
      } finally {
        a4.releaseLock();
      }
      r2.onClose?.();
    }, { api_name: this.#e });
  }
};
function c5(e4 = a3) {
  return `${e4.toUpperCase()}_API_ERROR`;
}
function l4(...e4) {
  let t = new Headers();
  for (let n of e4) n && new Headers(n).forEach((e5, n2) => {
    t.set(n2, e5);
  });
  return t;
}
function u4(e4) {
  if (e4?.aborted) throw typeof DOMException == `function` ? new DOMException(`Aborted`, `AbortError`) : Object.assign(Error(`Aborted`), { name: `AbortError` });
}
function d4(e4, t, n) {
  let r2 = e4.split(`

`), i4 = r2.pop() ?? ``;
  for (let e5 of r2) {
    if (!e5.trim()) continue;
    let { eventName: r3, dataLines: i5 } = f3(e5);
    if (i5.length === 0) continue;
    let a4 = i5.join(`
`);
    if (r3 === `error`) throw new o4(t, a4, 0);
    n.onMessage(JSON.parse(a4), r3);
  }
  return i4;
}
function f3(e4) {
  let t = `message`, n = [];
  for (let r2 of e4.split(`
`)) if (!r2.startsWith(`:`)) {
    if (r2.startsWith(`event:`)) {
      t = r2.slice(6).trim();
      continue;
    }
    r2.startsWith(`data:`) && n.push(r2.slice(5).trimStart());
  }
  return { eventName: t, dataLines: n };
}

// node_modules/@metamask/agent-sdk/dist/lib.esm/migrations-DHWx6Iig.js
function o5(e4) {
  return e4 instanceof Error ? e4.message : String(e4);
}
async function s6(e4, n) {
  let { serverWalletBaseUrl: r2 } = p3(e4), i4 = `${d5(r2)}/v1/supportedNetworks`, a4 = await globalThis.fetch(i4, { headers: { accept: `application/json` }, signal: n });
  if (!a4.ok) throw Error(`Server wallet supported networks request failed with status ${a4.status}.`);
  let o6 = await a4.json();
  if (!Array.isArray(o6.networks)) throw Error(`Server wallet supported networks response is missing a networks array.`);
  return o6.networks;
}
async function c6(e4, n) {
  let { accountsApiBaseUrl: i4 } = p3(e4), a4 = new URL(`v2/supportedNetworks`, f4(i4)), o6 = await new s5({ apiName: `balance` }).fetchJson(a4, { label: `Supported networks (v2)`, signal: n });
  return { fullSupport: p4(o6.fullSupport), partialSupport: p4(o6.partialSupport) };
}
async function l5(n, r2, i4) {
  let { agenticProxyHost: a4 } = p3(n);
  return k({ host: a4, env: n, ...i4 ? { getHeaders: () => ({ Authorization: `Bearer ${i4()}` }) } : {} }, r2);
}
function u5(e4, t) {
  return e4.map((e5) => ({ ...e5, relaySupported: t.get(e5.chainId) === true }));
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
    let t = this.#a();
    if (t && !_4(t)) return this.#i = t, t;
    try {
      let { snapshot: n, complete: r2 } = await this.#o(e4, t ?? void 0);
      return r2 && (this.#i = n, this.#t.write(n)), n;
    } catch (e5) {
      if (t) return this.#n?.warn(`Supported networks refresh failed; using stale cache. ${o5(e5)}`), this.#i = t, t;
      throw e5;
    }
  }
  #a() {
    return g3(this.#i ?? this.#t.read());
  }
  async #o(e4, t) {
    let n = (/* @__PURE__ */ new Date()).toISOString(), r2 = false, i4 = false, [a4, d6, f5] = await Promise.all([s6(this.#e, e4), c6(this.#e, e4).catch((e5) => (this.#n?.warn(`Accounts supported networks fetch failed; balance capabilities unavailable. ${o5(e5)}`), r2 = true, null)), l5(this.#e, e4, this.#r).catch((e5) => (this.#n?.warn(`Gasless relay capability refresh failed; using server-wallet networks without relay flags. ${o5(e5)}`), i4 = true, null))]);
    return { snapshot: { refreshedAt: n, serverWallet: { networks: f5 ? u5(a4, f5) : h3(a4, t) }, balance: d6 ?? t?.balance ?? { fullSupport: [], partialSupport: [] } }, complete: !r2 && !i4 };
  }
};
function h3(e4, t) {
  let n = new Map((t?.serverWallet.networks ?? []).map((e5) => [e5.chainId, e5.relaySupported]));
  return e4.map((e5) => ({ ...e5, relaySupported: n.get(e5.chainId) ?? e5.relaySupported ?? false }));
}
function g3(e4) {
  if (!e4 || typeof e4 != `object` || !(`refreshedAt` in e4) || !(`serverWallet` in e4) || !(`balance` in e4)) return null;
  let t = e4;
  return !Array.isArray(t.serverWallet.networks) || !Array.isArray(t.balance.fullSupport) || !Array.isArray(t.balance.partialSupport) ? null : t;
}
function _4(e4) {
  let t = Date.parse(e4.refreshedAt);
  return Number.isFinite(t) ? Date.now() - t >= d2 : true;
}
var y4 = { spotPrices: `v3/spot-prices`, supportedNetworks: `v2/supportedNetworks`, supportedVsCurrencies: `v1/supportedVsCurrencies`, historicalPrices: `v3/historical-prices` };
var b3 = { AssetIds: `assetIds`, VsCurrency: `vsCurrency`, IncludeMarketData: `includeMarketData`, CacheOnly: `cacheOnly`, UseExternalProviders: `useExternalProviders` };
var x4 = { TimePeriod: `timePeriod`, From: `from`, To: `to`, VsCurrency: `vsCurrency`, Interval: `interval` };
var S4 = class {
  #e;
  #t;
  constructor(e4, n) {
    let { priceApiBaseUrl: i4 } = p3(e4);
    this.#e = i4, this.#t = new s5({ apiName: `price`, getAuthTokenFn: n });
  }
  async getSpotPrices(e4) {
    if (!e4.assetIds || e4.assetIds.length === 0) throw new e2(`PRICE_SPOT_NO_ASSET_IDS`, `At least one CAIP asset id is required to fetch spot prices.`);
    let t = this.#n(y4.spotPrices), { searchParams: r2 } = t;
    return r2.set(b3.AssetIds, e4.assetIds.join(`,`)), r2.set(b3.VsCurrency, e4.vsCurrency ?? `usd`), r2.set(b3.IncludeMarketData, String(e4.includeMarketData ?? false)), r2.set(b3.CacheOnly, String(e4.cacheOnly ?? false)), r2.set(b3.UseExternalProviders, String(e4.useExternalProviders ?? false)), this.#t.fetchJson(t, { label: `Spot prices`, signal: e4.signal, useAuthToken: true });
  }
  async getSupportedNetworksV2(e4 = {}) {
    let t = this.#n(y4.supportedNetworks);
    return this.#t.fetchJson(t, { label: `Supported networks (v2)`, signal: e4.signal, useAuthToken: true });
  }
  async getSupportedVsCurrencies(e4 = {}) {
    let t = this.#n(y4.supportedVsCurrencies);
    return this.#t.fetchJson(t, { label: `Supported vs currencies`, signal: e4.signal, useAuthToken: true });
  }
  async getHistoricalPricesByCaipAssetId(e4) {
    if (!e4.chainId) throw new e2(`PRICE_HISTORICAL_NO_CHAIN_ID`, `chainId is required to fetch historical prices.`);
    if (!e4.assetType) throw new e2(`PRICE_HISTORICAL_NO_ASSET_TYPE`, `assetType is required to fetch historical prices.`);
    let t = `${y4.historicalPrices}/${encodeURIComponent(e4.chainId)}/${encodeURIComponent(e4.assetType)}`, r2 = this.#n(t), { searchParams: i4 } = r2;
    return e4.timePeriod !== void 0 && i4.set(x4.TimePeriod, e4.timePeriod), e4.from !== void 0 && i4.set(x4.From, String(e4.from)), e4.to !== void 0 && i4.set(x4.To, String(e4.to)), i4.set(x4.VsCurrency, e4.vsCurrency ?? `usd`), e4.interval !== void 0 && i4.set(x4.Interval, e4.interval), this.#t.fetchJson(r2, { label: `Historical prices`, signal: e4.signal, useAuthToken: true });
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
