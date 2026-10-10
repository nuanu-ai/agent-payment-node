import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  pbkdf2,
  pbkdf2Async
} from "./chunk-R3CE7L2C.mjs";
import {
  HDKey,
  ripemd160,
  sha256 as sha2562,
  utils,
  wordlist,
  wordlist10,
  wordlist2,
  wordlist3,
  wordlist4,
  wordlist5,
  wordlist6,
  wordlist7,
  wordlist8,
  wordlist9
} from "./chunk-23SLZEUA.mjs";
import {
  formatAbi,
  formatAbiItem,
  formatAbiParameters,
  parseAbi,
  parseAbiItem,
  parseAbiParameters
} from "./chunk-GBOH3J37.mjs";
import {
  Field,
  FpInvertBatch,
  FpLegendre,
  FpPow,
  SHA256_IV,
  createCurve,
  createHasher,
  getMinHashLength,
  isNegativeLE,
  isogenyMap,
  mapHashToField,
  mapToCurveSimpleSWU,
  mod,
  pippenger,
  pow2,
  secp256k1,
  sha256,
  sha384,
  sha512,
  validateBasic,
  wNAF,
  weierstrassPoints
} from "./chunk-PN5QSJPY.mjs";
import {
  keccak_256
} from "./chunk-QI5RJC2T.mjs";
import {
  Hash,
  aInRange,
  abool,
  abytes,
  aexists,
  anumber,
  aoutput,
  asyncLoop,
  bitGet,
  bitLen,
  bitMask,
  bytesToHex2 as bytesToHex,
  bytesToNumberBE,
  bytesToNumberLE,
  checkOpts,
  clean,
  concatBytes2 as concatBytes,
  createXOFer,
  ensureBytes,
  equalBytes,
  fromBig,
  memoized,
  notImplemented,
  numberToBytesBE,
  numberToBytesLE,
  randomBytes,
  rotl,
  rotr,
  swap32IfBE,
  swap8IfBE,
  toBytes,
  u32,
  u8,
  validateObject
} from "./chunk-YQQOMOUG.mjs";
import {
  __commonJS,
  __export,
  __toESM
} from "./chunk-B7AVLEE2.mjs";

// node_modules/eventemitter3/index.js
var require_eventemitter3 = __commonJS({
  "node_modules/eventemitter3/index.js"(exports, module) {
    "use strict";
    var has = Object.prototype.hasOwnProperty;
    var prefix = "~";
    function Events() {
    }
    if (Object.create) {
      Events.prototype = /* @__PURE__ */ Object.create(null);
      if (!new Events().__proto__) prefix = false;
    }
    function EE(fn, context, once) {
      this.fn = fn;
      this.context = context;
      this.once = once || false;
    }
    function addListener(emitter, event, fn, context, once) {
      if (typeof fn !== "function") {
        throw new TypeError("The listener must be a function");
      }
      var listener = new EE(fn, context || emitter, once), evt = prefix ? prefix + event : event;
      if (!emitter._events[evt]) emitter._events[evt] = listener, emitter._eventsCount++;
      else if (!emitter._events[evt].fn) emitter._events[evt].push(listener);
      else emitter._events[evt] = [emitter._events[evt], listener];
      return emitter;
    }
    function clearEvent(emitter, evt) {
      if (--emitter._eventsCount === 0) emitter._events = new Events();
      else delete emitter._events[evt];
    }
    function EventEmitter2() {
      this._events = new Events();
      this._eventsCount = 0;
    }
    EventEmitter2.prototype.eventNames = function eventNames() {
      var names = [], events, name;
      if (this._eventsCount === 0) return names;
      for (name in events = this._events) {
        if (has.call(events, name)) names.push(prefix ? name.slice(1) : name);
      }
      if (Object.getOwnPropertySymbols) {
        return names.concat(Object.getOwnPropertySymbols(events));
      }
      return names;
    };
    EventEmitter2.prototype.listeners = function listeners(event) {
      var evt = prefix ? prefix + event : event, handlers = this._events[evt];
      if (!handlers) return [];
      if (handlers.fn) return [handlers.fn];
      for (var i = 0, l = handlers.length, ee = new Array(l); i < l; i++) {
        ee[i] = handlers[i].fn;
      }
      return ee;
    };
    EventEmitter2.prototype.listenerCount = function listenerCount(event) {
      var evt = prefix ? prefix + event : event, listeners = this._events[evt];
      if (!listeners) return 0;
      if (listeners.fn) return 1;
      return listeners.length;
    };
    EventEmitter2.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt]) return false;
      var listeners = this._events[evt], len = arguments.length, args, i;
      if (listeners.fn) {
        if (listeners.once) this.removeListener(event, listeners.fn, void 0, true);
        switch (len) {
          case 1:
            return listeners.fn.call(listeners.context), true;
          case 2:
            return listeners.fn.call(listeners.context, a1), true;
          case 3:
            return listeners.fn.call(listeners.context, a1, a2), true;
          case 4:
            return listeners.fn.call(listeners.context, a1, a2, a3), true;
          case 5:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
          case 6:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
        }
        for (i = 1, args = new Array(len - 1); i < len; i++) {
          args[i - 1] = arguments[i];
        }
        listeners.fn.apply(listeners.context, args);
      } else {
        var length = listeners.length, j;
        for (i = 0; i < length; i++) {
          if (listeners[i].once) this.removeListener(event, listeners[i].fn, void 0, true);
          switch (len) {
            case 1:
              listeners[i].fn.call(listeners[i].context);
              break;
            case 2:
              listeners[i].fn.call(listeners[i].context, a1);
              break;
            case 3:
              listeners[i].fn.call(listeners[i].context, a1, a2);
              break;
            case 4:
              listeners[i].fn.call(listeners[i].context, a1, a2, a3);
              break;
            default:
              if (!args) for (j = 1, args = new Array(len - 1); j < len; j++) {
                args[j - 1] = arguments[j];
              }
              listeners[i].fn.apply(listeners[i].context, args);
          }
        }
      }
      return true;
    };
    EventEmitter2.prototype.on = function on(event, fn, context) {
      return addListener(this, event, fn, context, false);
    };
    EventEmitter2.prototype.once = function once(event, fn, context) {
      return addListener(this, event, fn, context, true);
    };
    EventEmitter2.prototype.removeListener = function removeListener(event, fn, context, once) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt]) return this;
      if (!fn) {
        clearEvent(this, evt);
        return this;
      }
      var listeners = this._events[evt];
      if (listeners.fn) {
        if (listeners.fn === fn && (!once || listeners.once) && (!context || listeners.context === context)) {
          clearEvent(this, evt);
        }
      } else {
        for (var i = 0, events = [], length = listeners.length; i < length; i++) {
          if (listeners[i].fn !== fn || once && !listeners[i].once || context && listeners[i].context !== context) {
            events.push(listeners[i]);
          }
        }
        if (events.length) this._events[evt] = events.length === 1 ? events[0] : events;
        else clearEvent(this, evt);
      }
      return this;
    };
    EventEmitter2.prototype.removeAllListeners = function removeAllListeners(event) {
      var evt;
      if (event) {
        evt = prefix ? prefix + event : event;
        if (this._events[evt]) clearEvent(this, evt);
      } else {
        this._events = new Events();
        this._eventsCount = 0;
      }
      return this;
    };
    EventEmitter2.prototype.off = EventEmitter2.prototype.removeListener;
    EventEmitter2.prototype.addListener = EventEmitter2.prototype.on;
    EventEmitter2.prefixed = prefix;
    EventEmitter2.EventEmitter = EventEmitter2;
    if ("undefined" !== typeof module) {
      module.exports = EventEmitter2;
    }
  }
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Abi.js
var Abi_exports = {};
__export(Abi_exports, {
  format: () => format,
  from: () => from
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/abi.js
function isSignatures(value) {
  for (const item of value) {
    if (typeof item !== "string")
      return false;
  }
  return true;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Abi.js
function format(abi) {
  return formatAbi(abi);
}
function from(abi) {
  if (isSignatures(abi))
    return parseAbi(abi);
  return abi;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AbiConstructor.js
var AbiConstructor_exports = {};
__export(AbiConstructor_exports, {
  decode: () => decode2,
  encode: () => encode3,
  format: () => format4,
  from: () => from8,
  fromAbi: () => fromAbi2
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AbiItem.js
var AbiItem_exports = {};
__export(AbiItem_exports, {
  AmbiguityError: () => AmbiguityError,
  InvalidSelectorSizeError: () => InvalidSelectorSizeError,
  NotFoundError: () => NotFoundError,
  format: () => format2,
  from: () => from6,
  fromAbi: () => fromAbi,
  getSelector: () => getSelector,
  getSignature: () => getSignature,
  getSignatureHash: () => getSignatureHash
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Errors.js
var Errors_exports = {};
__export(Errors_exports, {
  BaseError: () => BaseError
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/version.js
var version = "0.1.1";

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/errors.js
function getUrl(url) {
  return url;
}
function getVersion() {
  return version;
}
function prettyPrint(args) {
  if (!args)
    return "";
  const entries = Object.entries(args).map(([key, value]) => {
    if (value === void 0 || value === false)
      return null;
    return [key, value];
  }).filter(Boolean);
  const maxLength = entries.reduce((acc, [key]) => Math.max(acc, key.length), 0);
  return entries.map(([key, value]) => `  ${`${key}:`.padEnd(maxLength + 1)}  ${value}`).join("\n");
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Errors.js
var BaseError = class _BaseError extends Error {
  static setStaticOptions(options) {
    _BaseError.prototype.docsOrigin = options.docsOrigin;
    _BaseError.prototype.showVersion = options.showVersion;
    _BaseError.prototype.version = options.version;
  }
  constructor(shortMessage, options = {}) {
    const details = (() => {
      if (options.cause instanceof _BaseError) {
        if (options.cause.details)
          return options.cause.details;
        if (options.cause.shortMessage)
          return options.cause.shortMessage;
      }
      if (options.cause && "details" in options.cause && typeof options.cause.details === "string")
        return options.cause.details;
      if (options.cause?.message)
        return options.cause.message;
      return options.details;
    })();
    const docsPath = (() => {
      if (options.cause instanceof _BaseError)
        return options.cause.docsPath || options.docsPath;
      return options.docsPath;
    })();
    const docsBaseUrl = options.docsOrigin ?? _BaseError.prototype.docsOrigin;
    const docs = `${docsBaseUrl}${docsPath ?? ""}`;
    const showVersion = Boolean(options.version ?? _BaseError.prototype.showVersion);
    const version2 = options.version ?? _BaseError.prototype.version;
    const message = [
      shortMessage || "An error occurred.",
      ...options.metaMessages ? ["", ...options.metaMessages] : [],
      ...details || docsPath || showVersion ? [
        "",
        details ? `Details: ${details}` : void 0,
        docsPath ? `See: ${docs}` : void 0,
        showVersion ? `Version: ${version2}` : void 0
      ] : []
    ].filter((x) => typeof x === "string").join("\n");
    super(message, options.cause ? { cause: options.cause } : void 0);
    Object.defineProperty(this, "details", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "docs", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "docsOrigin", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "docsPath", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "shortMessage", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "showVersion", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "version", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "cause", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "BaseError"
    });
    this.cause = options.cause;
    this.details = details;
    this.docs = docs;
    this.docsOrigin = docsBaseUrl;
    this.docsPath = docsPath;
    this.shortMessage = shortMessage;
    this.showVersion = showVersion;
    this.version = version2;
  }
  walk(fn) {
    return walk(this, fn);
  }
};
Object.defineProperty(BaseError, "defaultStaticOptions", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: {
    docsOrigin: "https://oxlib.sh",
    showVersion: false,
    version: `ox@${getVersion()}`
  }
});
(() => {
  BaseError.setStaticOptions(BaseError.defaultStaticOptions);
})();
function walk(err, fn) {
  if (fn?.(err))
    return err;
  if (err && typeof err === "object" && "cause" in err && err.cause)
    return walk(err.cause, fn);
  return fn ? null : err;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Hash.js
var Hash_exports = {};
__export(Hash_exports, {
  keccak256: () => keccak256,
  ripemd160: () => ripemd1602,
  sha256: () => sha2563,
  validate: () => validate3
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Bytes.js
var Bytes_exports = {};
__export(Bytes_exports, {
  InvalidBytesBooleanError: () => InvalidBytesBooleanError,
  InvalidBytesTypeError: () => InvalidBytesTypeError,
  SizeExceedsPaddingSizeError: () => SizeExceedsPaddingSizeError,
  SizeOverflowError: () => SizeOverflowError,
  SliceOffsetOutOfBoundsError: () => SliceOffsetOutOfBoundsError,
  assert: () => assert2,
  concat: () => concat2,
  from: () => from3,
  fromArray: () => fromArray,
  fromBoolean: () => fromBoolean2,
  fromHex: () => fromHex,
  fromNumber: () => fromNumber2,
  fromString: () => fromString2,
  isEqual: () => isEqual2,
  padLeft: () => padLeft2,
  padRight: () => padRight2,
  random: () => random,
  size: () => size,
  slice: () => slice2,
  toBigInt: () => toBigInt2,
  toBoolean: () => toBoolean2,
  toHex: () => toHex,
  toNumber: () => toNumber2,
  toString: () => toString2,
  trimLeft: () => trimLeft2,
  trimRight: () => trimRight,
  validate: () => validate2
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Hex.js
var Hex_exports = {};
__export(Hex_exports, {
  IntegerOutOfRangeError: () => IntegerOutOfRangeError,
  InvalidHexBooleanError: () => InvalidHexBooleanError,
  InvalidHexTypeError: () => InvalidHexTypeError,
  InvalidHexValueError: () => InvalidHexValueError,
  InvalidLengthError: () => InvalidLengthError,
  SizeExceedsPaddingSizeError: () => SizeExceedsPaddingSizeError2,
  SizeOverflowError: () => SizeOverflowError2,
  SliceOffsetOutOfBoundsError: () => SliceOffsetOutOfBoundsError2,
  assert: () => assert,
  concat: () => concat,
  from: () => from2,
  fromBoolean: () => fromBoolean,
  fromBytes: () => fromBytes,
  fromNumber: () => fromNumber,
  fromString: () => fromString,
  isEqual: () => isEqual,
  padLeft: () => padLeft,
  padRight: () => padRight,
  random: () => random2,
  size: () => size2,
  slice: () => slice,
  toBigInt: () => toBigInt,
  toBoolean: () => toBoolean,
  toBytes: () => toBytes2,
  toNumber: () => toNumber,
  toString: () => toString,
  trimLeft: () => trimLeft,
  trimRight: () => trimRight2,
  validate: () => validate
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/bytes.js
function assertSize(bytes, size_) {
  if (size(bytes) > size_)
    throw new SizeOverflowError({
      givenSize: size(bytes),
      maxSize: size_
    });
}
function assertStartOffset(value, start) {
  if (typeof start === "number" && start > 0 && start > size(value) - 1)
    throw new SliceOffsetOutOfBoundsError({
      offset: start,
      position: "start",
      size: size(value)
    });
}
function assertEndOffset(value, start, end) {
  if (typeof start === "number" && typeof end === "number" && size(value) !== end - start) {
    throw new SliceOffsetOutOfBoundsError({
      offset: end,
      position: "end",
      size: size(value)
    });
  }
}
var charCodeMap = {
  zero: 48,
  nine: 57,
  A: 65,
  F: 70,
  a: 97,
  f: 102
};
function charCodeToBase16(char) {
  if (char >= charCodeMap.zero && char <= charCodeMap.nine)
    return char - charCodeMap.zero;
  if (char >= charCodeMap.A && char <= charCodeMap.F)
    return char - (charCodeMap.A - 10);
  if (char >= charCodeMap.a && char <= charCodeMap.f)
    return char - (charCodeMap.a - 10);
  return void 0;
}
function pad(bytes, options = {}) {
  const { dir, size: size4 = 32 } = options;
  if (size4 === 0)
    return bytes;
  if (bytes.length > size4)
    throw new SizeExceedsPaddingSizeError({
      size: bytes.length,
      targetSize: size4,
      type: "Bytes"
    });
  const paddedBytes = new Uint8Array(size4);
  for (let i = 0; i < size4; i++) {
    const padEnd = dir === "right";
    paddedBytes[padEnd ? i : size4 - i - 1] = bytes[padEnd ? i : bytes.length - i - 1];
  }
  return paddedBytes;
}
function trim(value, options = {}) {
  const { dir = "left" } = options;
  let data = value;
  let sliceLength = 0;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[dir === "left" ? i : data.length - i - 1].toString() === "0")
      sliceLength++;
    else
      break;
  }
  data = dir === "left" ? data.slice(sliceLength) : data.slice(0, data.length - sliceLength);
  return data;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/hex.js
function assertSize2(hex, size_) {
  if (size2(hex) > size_)
    throw new SizeOverflowError2({
      givenSize: size2(hex),
      maxSize: size_
    });
}
function assertStartOffset2(value, start) {
  if (typeof start === "number" && start > 0 && start > size2(value) - 1)
    throw new SliceOffsetOutOfBoundsError2({
      offset: start,
      position: "start",
      size: size2(value)
    });
}
function assertEndOffset2(value, start, end) {
  if (typeof start === "number" && typeof end === "number" && size2(value) !== end - start) {
    throw new SliceOffsetOutOfBoundsError2({
      offset: end,
      position: "end",
      size: size2(value)
    });
  }
}
function pad2(hex_, options = {}) {
  const { dir, size: size4 = 32 } = options;
  if (size4 === 0)
    return hex_;
  const hex = hex_.replace("0x", "");
  if (hex.length > size4 * 2)
    throw new SizeExceedsPaddingSizeError2({
      size: Math.ceil(hex.length / 2),
      targetSize: size4,
      type: "Hex"
    });
  return `0x${hex[dir === "right" ? "padEnd" : "padStart"](size4 * 2, "0")}`;
}
function trim2(value, options = {}) {
  const { dir = "left" } = options;
  let data = value.replace("0x", "");
  let sliceLength = 0;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[dir === "left" ? i : data.length - i - 1].toString() === "0")
      sliceLength++;
    else
      break;
  }
  data = dir === "left" ? data.slice(sliceLength) : data.slice(0, data.length - sliceLength);
  if (data === "0")
    return "0x";
  if (dir === "right" && data.length % 2 === 1)
    return `0x${data}0`;
  return `0x${data}`;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Json.js
var Json_exports = {};
__export(Json_exports, {
  parse: () => parse,
  stringify: () => stringify
});
var bigIntSuffix = "#__bigint";
function parse(string, reviver) {
  return JSON.parse(string, (key, value_) => {
    const value = value_;
    if (typeof value === "string" && value.endsWith(bigIntSuffix))
      return BigInt(value.slice(0, -bigIntSuffix.length));
    return typeof reviver === "function" ? reviver(key, value) : value;
  });
}
function stringify(value, replacer, space) {
  return JSON.stringify(value, (key, value2) => {
    if (typeof replacer === "function")
      return replacer(key, value2);
    if (typeof value2 === "bigint")
      return value2.toString() + bigIntSuffix;
    return value2;
  }, space);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Hex.js
var encoder = /* @__PURE__ */ new TextEncoder();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_v, i) => i.toString(16).padStart(2, "0"));
function assert(value, options = {}) {
  const { strict = false } = options;
  if (!value)
    throw new InvalidHexTypeError(value);
  if (typeof value !== "string")
    throw new InvalidHexTypeError(value);
  if (strict) {
    if (!/^0x[0-9a-fA-F]*$/.test(value))
      throw new InvalidHexValueError(value);
  }
  if (!value.startsWith("0x"))
    throw new InvalidHexValueError(value);
}
function concat(...values) {
  return `0x${values.reduce((acc, x) => acc + x.replace("0x", ""), "")}`;
}
function from2(value) {
  if (value instanceof Uint8Array)
    return fromBytes(value);
  if (Array.isArray(value))
    return fromBytes(new Uint8Array(value));
  return value;
}
function fromBoolean(value, options = {}) {
  const hex = `0x${Number(value)}`;
  if (typeof options.size === "number") {
    assertSize2(hex, options.size);
    return padLeft(hex, options.size);
  }
  return hex;
}
function fromBytes(value, options = {}) {
  let string = "";
  for (let i = 0; i < value.length; i++)
    string += hexes[value[i]];
  const hex = `0x${string}`;
  if (typeof options.size === "number") {
    assertSize2(hex, options.size);
    return padRight(hex, options.size);
  }
  return hex;
}
function fromNumber(value, options = {}) {
  const { signed: signed2, size: size4 } = options;
  const value_ = BigInt(value);
  let maxValue;
  if (size4) {
    if (signed2)
      maxValue = (1n << BigInt(size4) * 8n - 1n) - 1n;
    else
      maxValue = 2n ** (BigInt(size4) * 8n) - 1n;
  } else if (typeof value === "number") {
    maxValue = BigInt(Number.MAX_SAFE_INTEGER);
  }
  const minValue = typeof maxValue === "bigint" && signed2 ? -maxValue - 1n : 0;
  if (maxValue && value_ > maxValue || value_ < minValue) {
    const suffix = typeof value === "bigint" ? "n" : "";
    throw new IntegerOutOfRangeError({
      max: maxValue ? `${maxValue}${suffix}` : void 0,
      min: `${minValue}${suffix}`,
      signed: signed2,
      size: size4,
      value: `${value}${suffix}`
    });
  }
  const stringValue = (signed2 && value_ < 0 ? BigInt.asUintN(size4 * 8, BigInt(value_)) : value_).toString(16);
  const hex = `0x${stringValue}`;
  if (size4)
    return padLeft(hex, size4);
  return hex;
}
function fromString(value, options = {}) {
  return fromBytes(encoder.encode(value), options);
}
function isEqual(hexA, hexB) {
  return equalBytes(fromHex(hexA), fromHex(hexB));
}
function padLeft(value, size4) {
  return pad2(value, { dir: "left", size: size4 });
}
function padRight(value, size4) {
  return pad2(value, { dir: "right", size: size4 });
}
function random2(length) {
  return fromBytes(random(length));
}
function slice(value, start, end, options = {}) {
  const { strict } = options;
  assertStartOffset2(value, start);
  const value_ = `0x${value.replace("0x", "").slice((start ?? 0) * 2, (end ?? value.length) * 2)}`;
  if (strict)
    assertEndOffset2(value_, start, end);
  return value_;
}
function size2(value) {
  return Math.ceil((value.length - 2) / 2);
}
function trimLeft(value) {
  return trim2(value, { dir: "left" });
}
function trimRight2(value) {
  return trim2(value, { dir: "right" });
}
function toBigInt(hex, options = {}) {
  const { signed: signed2 } = options;
  if (options.size)
    assertSize2(hex, options.size);
  const value = BigInt(hex);
  if (!signed2)
    return value;
  const size4 = (hex.length - 2) / 2;
  const max_unsigned = (1n << BigInt(size4) * 8n) - 1n;
  const max_signed = max_unsigned >> 1n;
  if (value <= max_signed)
    return value;
  return value - max_unsigned - 1n;
}
function toBoolean(hex, options = {}) {
  if (options.size)
    assertSize2(hex, options.size);
  const hex_ = trimLeft(hex);
  if (hex_ === "0x")
    return false;
  if (hex_ === "0x1")
    return true;
  throw new InvalidHexBooleanError(hex);
}
function toBytes2(hex, options = {}) {
  return fromHex(hex, options);
}
function toNumber(hex, options = {}) {
  const { signed: signed2, size: size4 } = options;
  if (!signed2 && !size4)
    return Number(hex);
  return Number(toBigInt(hex, options));
}
function toString(hex, options = {}) {
  const { size: size4 } = options;
  let bytes = fromHex(hex);
  if (size4) {
    assertSize(bytes, size4);
    bytes = trimRight(bytes);
  }
  return new TextDecoder().decode(bytes);
}
function validate(value, options = {}) {
  const { strict = false } = options;
  try {
    assert(value, { strict });
    return true;
  } catch {
    return false;
  }
}
var IntegerOutOfRangeError = class extends BaseError {
  constructor({ max, min, signed: signed2, size: size4, value }) {
    super(`Number \`${value}\` is not in safe${size4 ? ` ${size4 * 8}-bit` : ""}${signed2 ? " signed" : " unsigned"} integer range ${max ? `(\`${min}\` to \`${max}\`)` : `(above \`${min}\`)`}`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Hex.IntegerOutOfRangeError"
    });
  }
};
var InvalidHexBooleanError = class extends BaseError {
  constructor(hex) {
    super(`Hex value \`"${hex}"\` is not a valid boolean.`, {
      metaMessages: [
        'The hex value must be `"0x0"` (false) or `"0x1"` (true).'
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Hex.InvalidHexBooleanError"
    });
  }
};
var InvalidHexTypeError = class extends BaseError {
  constructor(value) {
    super(`Value \`${typeof value === "object" ? stringify(value) : value}\` of type \`${typeof value}\` is an invalid hex type.`, {
      metaMessages: ['Hex types must be represented as `"0x${string}"`.']
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Hex.InvalidHexTypeError"
    });
  }
};
var InvalidHexValueError = class extends BaseError {
  constructor(value) {
    super(`Value \`${value}\` is an invalid hex value.`, {
      metaMessages: [
        'Hex values must start with `"0x"` and contain only hexadecimal characters (0-9, a-f, A-F).'
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Hex.InvalidHexValueError"
    });
  }
};
var InvalidLengthError = class extends BaseError {
  constructor(value) {
    super(`Hex value \`"${value}"\` is an odd length (${value.length - 2} nibbles).`, {
      metaMessages: ["It must be an even length."]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Hex.InvalidLengthError"
    });
  }
};
var SizeOverflowError2 = class extends BaseError {
  constructor({ givenSize, maxSize }) {
    super(`Size cannot exceed \`${maxSize}\` bytes. Given size: \`${givenSize}\` bytes.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Hex.SizeOverflowError"
    });
  }
};
var SliceOffsetOutOfBoundsError2 = class extends BaseError {
  constructor({ offset, position, size: size4 }) {
    super(`Slice ${position === "start" ? "starting" : "ending"} at offset \`${offset}\` is out-of-bounds (size: \`${size4}\`).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Hex.SliceOffsetOutOfBoundsError"
    });
  }
};
var SizeExceedsPaddingSizeError2 = class extends BaseError {
  constructor({ size: size4, targetSize, type: type6 }) {
    super(`${type6.charAt(0).toUpperCase()}${type6.slice(1).toLowerCase()} size (\`${size4}\`) exceeds padding size (\`${targetSize}\`).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Hex.SizeExceedsPaddingSizeError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Bytes.js
var decoder = /* @__PURE__ */ new TextDecoder();
var encoder2 = /* @__PURE__ */ new TextEncoder();
function assert2(value) {
  if (value instanceof Uint8Array)
    return;
  if (!value)
    throw new InvalidBytesTypeError(value);
  if (typeof value !== "object")
    throw new InvalidBytesTypeError(value);
  if (!("BYTES_PER_ELEMENT" in value))
    throw new InvalidBytesTypeError(value);
  if (value.BYTES_PER_ELEMENT !== 1 || value.constructor.name !== "Uint8Array")
    throw new InvalidBytesTypeError(value);
}
function concat2(...values) {
  let length = 0;
  for (const arr of values) {
    length += arr.length;
  }
  const result = new Uint8Array(length);
  for (let i = 0, index2 = 0; i < values.length; i++) {
    const arr = values[i];
    result.set(arr, index2);
    index2 += arr.length;
  }
  return result;
}
function from3(value) {
  if (value instanceof Uint8Array)
    return value;
  if (typeof value === "string")
    return fromHex(value);
  return fromArray(value);
}
function fromArray(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}
function fromBoolean2(value, options = {}) {
  const { size: size4 } = options;
  const bytes = new Uint8Array(1);
  bytes[0] = Number(value);
  if (typeof size4 === "number") {
    assertSize(bytes, size4);
    return padLeft2(bytes, size4);
  }
  return bytes;
}
function fromHex(value, options = {}) {
  const { size: size4 } = options;
  let hex = value;
  if (size4) {
    assertSize2(value, size4);
    hex = padRight(value, size4);
  }
  let hexString = hex.slice(2);
  if (hexString.length % 2)
    hexString = `0${hexString}`;
  const length = hexString.length / 2;
  const bytes = new Uint8Array(length);
  for (let index2 = 0, j = 0; index2 < length; index2++) {
    const nibbleLeft = charCodeToBase16(hexString.charCodeAt(j++));
    const nibbleRight = charCodeToBase16(hexString.charCodeAt(j++));
    if (nibbleLeft === void 0 || nibbleRight === void 0) {
      throw new BaseError(`Invalid byte sequence ("${hexString[j - 2]}${hexString[j - 1]}" in "${hexString}").`);
    }
    bytes[index2] = nibbleLeft << 4 | nibbleRight;
  }
  return bytes;
}
function fromNumber2(value, options) {
  const hex = fromNumber(value, options);
  return fromHex(hex);
}
function fromString2(value, options = {}) {
  const { size: size4 } = options;
  const bytes = encoder2.encode(value);
  if (typeof size4 === "number") {
    assertSize(bytes, size4);
    return padRight2(bytes, size4);
  }
  return bytes;
}
function isEqual2(bytesA, bytesB) {
  return equalBytes(bytesA, bytesB);
}
function padLeft2(value, size4) {
  return pad(value, { dir: "left", size: size4 });
}
function padRight2(value, size4) {
  return pad(value, { dir: "right", size: size4 });
}
function random(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}
function size(value) {
  return value.length;
}
function slice2(value, start, end, options = {}) {
  const { strict } = options;
  assertStartOffset(value, start);
  const value_ = value.slice(start, end);
  if (strict)
    assertEndOffset(value_, start, end);
  return value_;
}
function toBigInt2(bytes, options = {}) {
  const { size: size4 } = options;
  if (typeof size4 !== "undefined")
    assertSize(bytes, size4);
  const hex = fromBytes(bytes, options);
  return toBigInt(hex, options);
}
function toBoolean2(bytes, options = {}) {
  const { size: size4 } = options;
  let bytes_ = bytes;
  if (typeof size4 !== "undefined") {
    assertSize(bytes_, size4);
    bytes_ = trimLeft2(bytes_);
  }
  if (bytes_.length > 1 || bytes_[0] > 1)
    throw new InvalidBytesBooleanError(bytes_);
  return Boolean(bytes_[0]);
}
function toHex(value, options = {}) {
  return fromBytes(value, options);
}
function toNumber2(bytes, options = {}) {
  const { size: size4 } = options;
  if (typeof size4 !== "undefined")
    assertSize(bytes, size4);
  const hex = fromBytes(bytes, options);
  return toNumber(hex, options);
}
function toString2(bytes, options = {}) {
  const { size: size4 } = options;
  let bytes_ = bytes;
  if (typeof size4 !== "undefined") {
    assertSize(bytes_, size4);
    bytes_ = trimRight(bytes_);
  }
  return decoder.decode(bytes_);
}
function trimLeft2(value) {
  return trim(value, { dir: "left" });
}
function trimRight(value) {
  return trim(value, { dir: "right" });
}
function validate2(value) {
  try {
    assert2(value);
    return true;
  } catch {
    return false;
  }
}
var InvalidBytesBooleanError = class extends BaseError {
  constructor(bytes) {
    super(`Bytes value \`${bytes}\` is not a valid boolean.`, {
      metaMessages: [
        "The bytes array must contain a single byte of either a `0` or `1` value."
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Bytes.InvalidBytesBooleanError"
    });
  }
};
var InvalidBytesTypeError = class extends BaseError {
  constructor(value) {
    super(`Value \`${typeof value === "object" ? stringify(value) : value}\` of type \`${typeof value}\` is an invalid Bytes value.`, {
      metaMessages: ["Bytes values must be of type `Bytes`."]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Bytes.InvalidBytesTypeError"
    });
  }
};
var SizeOverflowError = class extends BaseError {
  constructor({ givenSize, maxSize }) {
    super(`Size cannot exceed \`${maxSize}\` bytes. Given size: \`${givenSize}\` bytes.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Bytes.SizeOverflowError"
    });
  }
};
var SliceOffsetOutOfBoundsError = class extends BaseError {
  constructor({ offset, position, size: size4 }) {
    super(`Slice ${position === "start" ? "starting" : "ending"} at offset \`${offset}\` is out-of-bounds (size: \`${size4}\`).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Bytes.SliceOffsetOutOfBoundsError"
    });
  }
};
var SizeExceedsPaddingSizeError = class extends BaseError {
  constructor({ size: size4, targetSize, type: type6 }) {
    super(`${type6.charAt(0).toUpperCase()}${type6.slice(1).toLowerCase()} size (\`${size4}\`) exceeds padding size (\`${targetSize}\`).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Bytes.SizeExceedsPaddingSizeError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Hash.js
function keccak256(value, options = {}) {
  const { as = typeof value === "string" ? "Hex" : "Bytes" } = options;
  const bytes = keccak_256(from3(value));
  if (as === "Bytes")
    return bytes;
  return fromBytes(bytes);
}
function ripemd1602(value, options = {}) {
  const { as = typeof value === "string" ? "Hex" : "Bytes" } = options;
  const bytes = ripemd160(from3(value));
  if (as === "Bytes")
    return bytes;
  return fromBytes(bytes);
}
function sha2563(value, options = {}) {
  const { as = typeof value === "string" ? "Hex" : "Bytes" } = options;
  const bytes = sha2562(from3(value));
  if (as === "Bytes")
    return bytes;
  return fromBytes(bytes);
}
function validate3(value) {
  return validate(value) && size2(value) === 32;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Address.js
var Address_exports = {};
__export(Address_exports, {
  InvalidAddressError: () => InvalidAddressError,
  InvalidChecksumError: () => InvalidChecksumError,
  InvalidInputError: () => InvalidInputError,
  assert: () => assert4,
  checksum: () => checksum2,
  from: () => from5,
  fromPublicKey: () => fromPublicKey,
  isEqual: () => isEqual3,
  validate: () => validate5
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Caches.js
var Caches_exports = {};
__export(Caches_exports, {
  checksum: () => checksum,
  clear: () => clear
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/lru.js
var LruMap = class extends Map {
  constructor(size4) {
    super();
    Object.defineProperty(this, "maxSize", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.maxSize = size4;
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

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Caches.js
var caches = {
  checksum: /* @__PURE__ */ new LruMap(8192)
};
var checksum = caches.checksum;
function clear() {
  for (const cache of Object.values(caches))
    cache.clear();
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/PublicKey.js
var PublicKey_exports = {};
__export(PublicKey_exports, {
  InvalidCompressedPrefixError: () => InvalidCompressedPrefixError,
  InvalidError: () => InvalidError,
  InvalidPrefixError: () => InvalidPrefixError,
  InvalidSerializedSizeError: () => InvalidSerializedSizeError,
  InvalidUncompressedPrefixError: () => InvalidUncompressedPrefixError,
  assert: () => assert3,
  compress: () => compress,
  from: () => from4,
  fromBytes: () => fromBytes2,
  fromHex: () => fromHex2,
  toBytes: () => toBytes3,
  toHex: () => toHex2,
  validate: () => validate4
});
function assert3(publicKey, options = {}) {
  const { compressed } = options;
  const { prefix, x, y } = publicKey;
  if (compressed === false || typeof x === "bigint" && typeof y === "bigint") {
    if (prefix !== 4)
      throw new InvalidPrefixError({
        prefix,
        cause: new InvalidUncompressedPrefixError()
      });
    return;
  }
  if (compressed === true || typeof x === "bigint" && typeof y === "undefined") {
    if (prefix !== 3 && prefix !== 2)
      throw new InvalidPrefixError({
        prefix,
        cause: new InvalidCompressedPrefixError()
      });
    return;
  }
  throw new InvalidError({ publicKey });
}
function compress(publicKey) {
  const { x, y } = publicKey;
  return {
    prefix: y % 2n === 0n ? 2 : 3,
    x
  };
}
function from4(value) {
  const publicKey = (() => {
    if (validate(value))
      return fromHex2(value);
    if (validate2(value))
      return fromBytes2(value);
    const { prefix, x, y } = value;
    if (typeof x === "bigint" && typeof y === "bigint")
      return { prefix: prefix ?? 4, x, y };
    return { prefix, x };
  })();
  assert3(publicKey);
  return publicKey;
}
function fromBytes2(publicKey) {
  return fromHex2(fromBytes(publicKey));
}
function fromHex2(publicKey) {
  if (publicKey.length !== 132 && publicKey.length !== 130 && publicKey.length !== 68)
    throw new InvalidSerializedSizeError({ publicKey });
  if (publicKey.length === 130) {
    const x2 = BigInt(slice(publicKey, 0, 32));
    const y = BigInt(slice(publicKey, 32, 64));
    return {
      prefix: 4,
      x: x2,
      y
    };
  }
  if (publicKey.length === 132) {
    const prefix2 = Number(slice(publicKey, 0, 1));
    const x2 = BigInt(slice(publicKey, 1, 33));
    const y = BigInt(slice(publicKey, 33, 65));
    return {
      prefix: prefix2,
      x: x2,
      y
    };
  }
  const prefix = Number(slice(publicKey, 0, 1));
  const x = BigInt(slice(publicKey, 1, 33));
  return {
    prefix,
    x
  };
}
function toBytes3(publicKey, options = {}) {
  return fromHex(toHex2(publicKey, options));
}
function toHex2(publicKey, options = {}) {
  assert3(publicKey);
  const { prefix, x, y } = publicKey;
  const { includePrefix = true } = options;
  const publicKey_ = concat(
    includePrefix ? fromNumber(prefix, { size: 1 }) : "0x",
    fromNumber(x, { size: 32 }),
    // If the public key is not compressed, add the y coordinate.
    typeof y === "bigint" ? fromNumber(y, { size: 32 }) : "0x"
  );
  return publicKey_;
}
function validate4(publicKey, options = {}) {
  try {
    assert3(publicKey, options);
    return true;
  } catch (_error) {
    return false;
  }
}
var InvalidError = class extends BaseError {
  constructor({ publicKey }) {
    super(`Value \`${stringify(publicKey)}\` is not a valid public key.`, {
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
var InvalidPrefixError = class extends BaseError {
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
var InvalidCompressedPrefixError = class extends BaseError {
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
var InvalidUncompressedPrefixError = class extends BaseError {
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
var InvalidSerializedSizeError = class extends BaseError {
  constructor({ publicKey }) {
    super(`Value \`${publicKey}\` is an invalid public key size.`, {
      metaMessages: [
        "Expected: 33 bytes (compressed + prefix), 64 bytes (uncompressed) or 65 bytes (uncompressed + prefix).",
        `Received ${size2(from2(publicKey))} bytes.`
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

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Address.js
var addressRegex = /^0x[a-fA-F0-9]{40}$/;
function assert4(value, options = {}) {
  const { strict = true } = options;
  if (!addressRegex.test(value))
    throw new InvalidAddressError({
      address: value,
      cause: new InvalidInputError()
    });
  if (strict) {
    if (value.toLowerCase() === value)
      return;
    if (checksum2(value) !== value)
      throw new InvalidAddressError({
        address: value,
        cause: new InvalidChecksumError()
      });
  }
}
function checksum2(address) {
  if (checksum.has(address))
    return checksum.get(address);
  assert4(address, { strict: false });
  const hexAddress = address.substring(2).toLowerCase();
  const hash8 = keccak256(fromString2(hexAddress), { as: "Bytes" });
  const characters = hexAddress.split("");
  for (let i = 0; i < 40; i += 2) {
    if (hash8[i >> 1] >> 4 >= 8 && characters[i]) {
      characters[i] = characters[i].toUpperCase();
    }
    if ((hash8[i >> 1] & 15) >= 8 && characters[i + 1]) {
      characters[i + 1] = characters[i + 1].toUpperCase();
    }
  }
  const result = `0x${characters.join("")}`;
  checksum.set(address, result);
  return result;
}
function from5(address, options = {}) {
  const { checksum: checksumVal = false } = options;
  assert4(address);
  if (checksumVal)
    return checksum2(address);
  return address;
}
function fromPublicKey(publicKey, options = {}) {
  const address = keccak256(`0x${toHex2(publicKey).slice(4)}`).substring(26);
  return from5(`0x${address}`, options);
}
function isEqual3(addressA, addressB) {
  assert4(addressA, { strict: false });
  assert4(addressB, { strict: false });
  return addressA.toLowerCase() === addressB.toLowerCase();
}
function validate5(address, options = {}) {
  const { strict = true } = options ?? {};
  try {
    assert4(address, { strict });
    return true;
  } catch {
    return false;
  }
}
var InvalidAddressError = class extends BaseError {
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
var InvalidInputError = class extends BaseError {
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
var InvalidChecksumError = class extends BaseError {
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

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/abiItem.js
function normalizeSignature(signature) {
  let active = true;
  let current = "";
  let level = 0;
  let result = "";
  let valid = false;
  for (let i = 0; i < signature.length; i++) {
    const char = signature[i];
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
      if (signature[i - 1] !== "," && current !== "," && current !== ",(") {
        current = "";
        active = false;
      }
      continue;
    }
    result += char;
    current += char;
  }
  if (!valid)
    throw new BaseError("Unable to normalize signature.");
  return result;
}
function isArgOfType(arg, abiParameter) {
  const argType = typeof arg;
  const abiParameterType = abiParameter.type;
  switch (abiParameterType) {
    case "address":
      return validate5(arg, { strict: false });
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
        return Array.isArray(arg) && arg.every((x) => isArgOfType(x, {
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
        return validate5(args[parameterIndex], {
          strict: false
        });
      if (types.includes("address") && types.includes("bytes"))
        return validate5(args[parameterIndex], {
          strict: false
        });
      return false;
    })();
    if (ambiguous)
      return types;
  }
  return;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AbiItem.js
function format2(abiItem) {
  return formatAbiItem(abiItem);
}
function from6(abiItem, options = {}) {
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
function fromAbi(abi, name, options) {
  const { args = [], prepare = true } = options ?? {};
  const isSelector = validate(name, { strict: false });
  const abiItems = abi.filter((abiItem2) => {
    if (isSelector) {
      if (abiItem2.type === "function" || abiItem2.type === "error")
        return getSelector(abiItem2) === slice(name, 0, 4);
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
      const [abi, name] = parameters;
      return fromAbi(abi, name);
    }
    return parameters[0];
  })();
  return slice(getSignatureHash(abiItem), 0, 4);
}
function getSignature(...parameters) {
  const abiItem = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi, name] = parameters;
      return fromAbi(abi, name);
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
      const [abi, name] = parameters;
      return fromAbi(abi, name);
    }
    return parameters[0];
  })();
  if (typeof abiItem !== "string" && "hash" in abiItem && abiItem.hash)
    return abiItem.hash;
  return keccak256(fromString(getSignature(abiItem)));
}
var AmbiguityError = class extends BaseError {
  constructor(x, y) {
    super("Found ambiguous types in overloaded ABI Items.", {
      metaMessages: [
        // TODO: abitype to add support for signature-formatted ABI items.
        `\`${x.type}\` in \`${normalizeSignature(formatAbiItem(x.abiItem))}\`, and`,
        `\`${y.type}\` in \`${normalizeSignature(formatAbiItem(y.abiItem))}\``,
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
var NotFoundError = class extends BaseError {
  constructor({ name, data, type: type6 = "item" }) {
    const selector = (() => {
      if (name)
        return ` with name "${name}"`;
      if (data)
        return ` with data "${data}"`;
      return "";
    })();
    super(`ABI ${type6}${selector} not found.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiItem.NotFoundError"
    });
  }
};
var InvalidSelectorSizeError = class extends BaseError {
  constructor({ data }) {
    super(`Selector size is invalid. Expected 4 bytes. Received ${size2(data)} bytes ("${data}").`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiItem.InvalidSelectorSizeError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AbiParameters.js
var AbiParameters_exports = {};
__export(AbiParameters_exports, {
  ArrayLengthMismatchError: () => ArrayLengthMismatchError,
  BytesSizeMismatchError: () => BytesSizeMismatchError,
  DataSizeTooSmallError: () => DataSizeTooSmallError,
  InvalidArrayError: () => InvalidArrayError,
  InvalidTypeError: () => InvalidTypeError,
  LengthMismatchError: () => LengthMismatchError,
  ZeroDataError: () => ZeroDataError,
  decode: () => decode,
  encode: () => encode2,
  encodePacked: () => encodePacked,
  format: () => format3,
  from: () => from7
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Solidity.js
var Solidity_exports = {};
__export(Solidity_exports, {
  arrayRegex: () => arrayRegex,
  bytesRegex: () => bytesRegex,
  integerRegex: () => integerRegex,
  maxInt104: () => maxInt104,
  maxInt112: () => maxInt112,
  maxInt120: () => maxInt120,
  maxInt128: () => maxInt128,
  maxInt136: () => maxInt136,
  maxInt144: () => maxInt144,
  maxInt152: () => maxInt152,
  maxInt16: () => maxInt16,
  maxInt160: () => maxInt160,
  maxInt168: () => maxInt168,
  maxInt176: () => maxInt176,
  maxInt184: () => maxInt184,
  maxInt192: () => maxInt192,
  maxInt200: () => maxInt200,
  maxInt208: () => maxInt208,
  maxInt216: () => maxInt216,
  maxInt224: () => maxInt224,
  maxInt232: () => maxInt232,
  maxInt24: () => maxInt24,
  maxInt240: () => maxInt240,
  maxInt248: () => maxInt248,
  maxInt256: () => maxInt256,
  maxInt32: () => maxInt32,
  maxInt40: () => maxInt40,
  maxInt48: () => maxInt48,
  maxInt56: () => maxInt56,
  maxInt64: () => maxInt64,
  maxInt72: () => maxInt72,
  maxInt8: () => maxInt8,
  maxInt80: () => maxInt80,
  maxInt88: () => maxInt88,
  maxInt96: () => maxInt96,
  maxUint104: () => maxUint104,
  maxUint112: () => maxUint112,
  maxUint120: () => maxUint120,
  maxUint128: () => maxUint128,
  maxUint136: () => maxUint136,
  maxUint144: () => maxUint144,
  maxUint152: () => maxUint152,
  maxUint16: () => maxUint16,
  maxUint160: () => maxUint160,
  maxUint168: () => maxUint168,
  maxUint176: () => maxUint176,
  maxUint184: () => maxUint184,
  maxUint192: () => maxUint192,
  maxUint200: () => maxUint200,
  maxUint208: () => maxUint208,
  maxUint216: () => maxUint216,
  maxUint224: () => maxUint224,
  maxUint232: () => maxUint232,
  maxUint24: () => maxUint24,
  maxUint240: () => maxUint240,
  maxUint248: () => maxUint248,
  maxUint256: () => maxUint256,
  maxUint32: () => maxUint32,
  maxUint40: () => maxUint40,
  maxUint48: () => maxUint48,
  maxUint56: () => maxUint56,
  maxUint64: () => maxUint64,
  maxUint72: () => maxUint72,
  maxUint8: () => maxUint8,
  maxUint80: () => maxUint80,
  maxUint88: () => maxUint88,
  maxUint96: () => maxUint96,
  minInt104: () => minInt104,
  minInt112: () => minInt112,
  minInt120: () => minInt120,
  minInt128: () => minInt128,
  minInt136: () => minInt136,
  minInt144: () => minInt144,
  minInt152: () => minInt152,
  minInt16: () => minInt16,
  minInt160: () => minInt160,
  minInt168: () => minInt168,
  minInt176: () => minInt176,
  minInt184: () => minInt184,
  minInt192: () => minInt192,
  minInt200: () => minInt200,
  minInt208: () => minInt208,
  minInt216: () => minInt216,
  minInt224: () => minInt224,
  minInt232: () => minInt232,
  minInt24: () => minInt24,
  minInt240: () => minInt240,
  minInt248: () => minInt248,
  minInt256: () => minInt256,
  minInt32: () => minInt32,
  minInt40: () => minInt40,
  minInt48: () => minInt48,
  minInt56: () => minInt56,
  minInt64: () => minInt64,
  minInt72: () => minInt72,
  minInt8: () => minInt8,
  minInt80: () => minInt80,
  minInt88: () => minInt88,
  minInt96: () => minInt96
});
var arrayRegex = /^(.*)\[([0-9]*)\]$/;
var bytesRegex = /^bytes([1-9]|1[0-9]|2[0-9]|3[0-2])?$/;
var integerRegex = /^(u?int)(8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/;
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

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/abiParameters.js
function decodeParameter(cursor, param, options) {
  const { checksumAddress, staticPosition } = options;
  const arrayComponents = getArrayComponents(param.type);
  if (arrayComponents) {
    const [length, type6] = arrayComponents;
    return decodeArray(cursor, { ...param, type: type6 }, { checksumAddress, length, staticPosition });
  }
  if (param.type === "tuple")
    return decodeTuple(cursor, param, {
      checksumAddress,
      staticPosition
    });
  if (param.type === "address")
    return decodeAddress(cursor, { checksum: checksumAddress });
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
function decodeAddress(cursor, options = {}) {
  const { checksum: checksum3 = false } = options;
  const value = cursor.readBytes(32);
  const wrap = (address) => checksum3 ? checksum2(address) : address;
  return [wrap(fromBytes(slice2(value, -20))), 32];
}
function decodeArray(cursor, param, options) {
  const { checksumAddress, length, staticPosition } = options;
  if (!length) {
    const offset = toNumber2(cursor.readBytes(sizeOfOffset));
    const start = staticPosition + offset;
    const startOfData = start + sizeOfLength;
    cursor.setPosition(start);
    const length2 = toNumber2(cursor.readBytes(sizeOfLength));
    const dynamicChild = hasDynamicChild(param);
    let consumed2 = 0;
    const value2 = [];
    for (let i = 0; i < length2; ++i) {
      cursor.setPosition(startOfData + (dynamicChild ? i * 32 : consumed2));
      const [data, consumed_] = decodeParameter(cursor, param, {
        checksumAddress,
        staticPosition: startOfData
      });
      consumed2 += consumed_;
      value2.push(data);
    }
    cursor.setPosition(staticPosition + 32);
    return [value2, 32];
  }
  if (hasDynamicChild(param)) {
    const offset = toNumber2(cursor.readBytes(sizeOfOffset));
    const start = staticPosition + offset;
    const value2 = [];
    for (let i = 0; i < length; ++i) {
      cursor.setPosition(start + i * 32);
      const [data] = decodeParameter(cursor, param, {
        checksumAddress,
        staticPosition: start
      });
      value2.push(data);
    }
    cursor.setPosition(staticPosition + 32);
    return [value2, 32];
  }
  let consumed = 0;
  const value = [];
  for (let i = 0; i < length; ++i) {
    const [data, consumed_] = decodeParameter(cursor, param, {
      checksumAddress,
      staticPosition: staticPosition + consumed
    });
    consumed += consumed_;
    value.push(data);
  }
  return [value, consumed];
}
function decodeBool(cursor) {
  return [toBoolean2(cursor.readBytes(32), { size: 32 }), 32];
}
function decodeBytes(cursor, param, { staticPosition }) {
  const [_, size4] = param.type.split("bytes");
  if (!size4) {
    const offset = toNumber2(cursor.readBytes(32));
    cursor.setPosition(staticPosition + offset);
    const length = toNumber2(cursor.readBytes(32));
    if (length === 0) {
      cursor.setPosition(staticPosition + 32);
      return ["0x", 32];
    }
    const data = cursor.readBytes(length);
    cursor.setPosition(staticPosition + 32);
    return [fromBytes(data), 32];
  }
  const value = fromBytes(cursor.readBytes(Number.parseInt(size4, 10), 32));
  return [value, 32];
}
function decodeNumber(cursor, param) {
  const signed2 = param.type.startsWith("int");
  const size4 = Number.parseInt(param.type.split("int")[1] || "256", 10);
  const value = cursor.readBytes(32);
  return [
    size4 > 48 ? toBigInt2(value, { signed: signed2 }) : toNumber2(value, { signed: signed2 }),
    32
  ];
}
function decodeTuple(cursor, param, options) {
  const { checksumAddress, staticPosition } = options;
  const hasUnnamedChild = param.components.length === 0 || param.components.some(({ name }) => !name);
  const value = hasUnnamedChild ? [] : {};
  let consumed = 0;
  if (hasDynamicChild(param)) {
    const offset = toNumber2(cursor.readBytes(sizeOfOffset));
    const start = staticPosition + offset;
    for (let i = 0; i < param.components.length; ++i) {
      const component = param.components[i];
      cursor.setPosition(start + consumed);
      const [data, consumed_] = decodeParameter(cursor, component, {
        checksumAddress,
        staticPosition: start
      });
      consumed += consumed_;
      value[hasUnnamedChild ? i : component?.name] = data;
    }
    cursor.setPosition(staticPosition + 32);
    return [value, 32];
  }
  for (let i = 0; i < param.components.length; ++i) {
    const component = param.components[i];
    const [data, consumed_] = decodeParameter(cursor, component, {
      checksumAddress,
      staticPosition
    });
    value[hasUnnamedChild ? i : component?.name] = data;
    consumed += consumed_;
  }
  return [value, consumed];
}
function decodeString(cursor, { staticPosition }) {
  const offset = toNumber2(cursor.readBytes(32));
  const start = staticPosition + offset;
  cursor.setPosition(start);
  const length = toNumber2(cursor.readBytes(32));
  if (length === 0) {
    cursor.setPosition(staticPosition + 32);
    return ["", 32];
  }
  const data = cursor.readBytes(length, 32);
  const value = toString2(trimLeft2(data));
  cursor.setPosition(staticPosition + 32);
  return [value, 32];
}
function prepareParameters({ checksumAddress, parameters, values }) {
  const preparedParameters = [];
  for (let i = 0; i < parameters.length; i++) {
    preparedParameters.push(prepareParameter({
      checksumAddress,
      parameter: parameters[i],
      value: values[i]
    }));
  }
  return preparedParameters;
}
function prepareParameter({ checksumAddress = false, parameter: parameter_, value }) {
  const parameter = parameter_;
  const arrayComponents = getArrayComponents(parameter.type);
  if (arrayComponents) {
    const [length, type6] = arrayComponents;
    return encodeArray(value, {
      checksumAddress,
      length,
      parameter: {
        ...parameter,
        type: type6
      }
    });
  }
  if (parameter.type === "tuple") {
    return encodeTuple(value, {
      checksumAddress,
      parameter
    });
  }
  if (parameter.type === "address") {
    return encodeAddress(value, {
      checksum: checksumAddress
    });
  }
  if (parameter.type === "bool") {
    return encodeBoolean(value);
  }
  if (parameter.type.startsWith("uint") || parameter.type.startsWith("int")) {
    const signed2 = parameter.type.startsWith("int");
    const [, , size4 = "256"] = integerRegex.exec(parameter.type) ?? [];
    return encodeNumber(value, {
      signed: signed2,
      size: Number(size4)
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
  for (let i = 0; i < preparedParameters.length; i++) {
    const { dynamic, encoded } = preparedParameters[i];
    if (dynamic)
      staticSize += 32;
    else
      staticSize += size2(encoded);
  }
  const staticParameters = [];
  const dynamicParameters = [];
  let dynamicSize = 0;
  for (let i = 0; i < preparedParameters.length; i++) {
    const { dynamic, encoded } = preparedParameters[i];
    if (dynamic) {
      staticParameters.push(fromNumber(staticSize + dynamicSize, { size: 32 }));
      dynamicParameters.push(encoded);
      dynamicSize += size2(encoded);
    } else {
      staticParameters.push(encoded);
    }
  }
  return concat(...staticParameters, ...dynamicParameters);
}
function encodeAddress(value, options) {
  const { checksum: checksum3 = false } = options;
  assert4(value, { strict: checksum3 });
  return {
    dynamic: false,
    encoded: padLeft(value.toLowerCase())
  };
}
function encodeArray(value, options) {
  const { checksumAddress, length, parameter } = options;
  const dynamic = length === null;
  if (!Array.isArray(value))
    throw new InvalidArrayError(value);
  if (!dynamic && value.length !== length)
    throw new ArrayLengthMismatchError({
      expectedLength: length,
      givenLength: value.length,
      type: `${parameter.type}[${length}]`
    });
  let dynamicChild = false;
  const preparedParameters = [];
  for (let i = 0; i < value.length; i++) {
    const preparedParam = prepareParameter({
      checksumAddress,
      parameter,
      value: value[i]
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
        encoded: preparedParameters.length > 0 ? concat(length2, data) : length2
      };
    }
    if (dynamicChild)
      return { dynamic: true, encoded: data };
  }
  return {
    dynamic: false,
    encoded: concat(...preparedParameters.map(({ encoded }) => encoded))
  };
}
function encodeBytes(value, { type: type6 }) {
  const [, parametersize] = type6.split("bytes");
  const bytesSize = size2(value);
  if (!parametersize) {
    let value_ = value;
    if (bytesSize % 32 !== 0)
      value_ = padRight(value_, Math.ceil((value.length - 2) / 2 / 32) * 32);
    return {
      dynamic: true,
      encoded: concat(padLeft(fromNumber(bytesSize, { size: 32 })), value_)
    };
  }
  if (bytesSize !== Number.parseInt(parametersize, 10))
    throw new BytesSizeMismatchError({
      expectedSize: Number.parseInt(parametersize, 10),
      value
    });
  return { dynamic: false, encoded: padRight(value) };
}
function encodeBoolean(value) {
  if (typeof value !== "boolean")
    throw new BaseError(`Invalid boolean value: "${value}" (type: ${typeof value}). Expected: \`true\` or \`false\`.`);
  return { dynamic: false, encoded: padLeft(fromBoolean(value)) };
}
function encodeNumber(value, { signed: signed2, size: size4 }) {
  if (typeof size4 === "number") {
    const max = 2n ** (BigInt(size4) - (signed2 ? 1n : 0n)) - 1n;
    const min = signed2 ? -max - 1n : 0n;
    if (value > max || value < min)
      throw new IntegerOutOfRangeError({
        max: max.toString(),
        min: min.toString(),
        signed: signed2,
        size: size4 / 8,
        value: value.toString()
      });
  }
  return {
    dynamic: false,
    encoded: fromNumber(value, {
      size: 32,
      signed: signed2
    })
  };
}
function encodeString(value) {
  const hexValue = fromString(value);
  const partsLength = Math.ceil(size2(hexValue) / 32);
  const parts = [];
  for (let i = 0; i < partsLength; i++) {
    parts.push(padRight(slice(hexValue, i * 32, (i + 1) * 32)));
  }
  return {
    dynamic: true,
    encoded: concat(padRight(fromNumber(size2(hexValue), { size: 32 })), ...parts)
  };
}
function encodeTuple(value, options) {
  const { checksumAddress, parameter } = options;
  let dynamic = false;
  const preparedParameters = [];
  for (let i = 0; i < parameter.components.length; i++) {
    const param_ = parameter.components[i];
    const index2 = Array.isArray(value) ? i : param_.name;
    const preparedParam = prepareParameter({
      checksumAddress,
      parameter: param_,
      value: value[index2]
    });
    preparedParameters.push(preparedParam);
    if (preparedParam.dynamic)
      dynamic = true;
  }
  return {
    dynamic,
    encoded: dynamic ? encode(preparedParameters) : concat(...preparedParameters.map(({ encoded }) => encoded))
  };
}
function getArrayComponents(type6) {
  const matches = type6.match(/^(.*)\[(\d+)?\]$/);
  return matches ? (
    // Return `null` if the array is dynamic.
    [matches[2] ? Number(matches[2]) : null, matches[1]]
  ) : void 0;
}
function hasDynamicChild(param) {
  const { type: type6 } = param;
  if (type6 === "string")
    return true;
  if (type6 === "bytes")
    return true;
  if (type6.endsWith("[]"))
    return true;
  if (type6 === "tuple")
    return param.components?.some(hasDynamicChild);
  const arrayComponents = getArrayComponents(param.type);
  if (arrayComponents && hasDynamicChild({
    ...param,
    type: arrayComponents[1]
  }))
    return true;
  return false;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/cursor.js
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
      throw new PositionOutOfBoundsError({
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
  readBytes(length, size4) {
    this.assertReadLimit();
    this._touch();
    const value = this.inspectBytes(length);
    this.position += size4 ?? length;
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
var NegativeOffsetError = class extends BaseError {
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
var PositionOutOfBoundsError = class extends BaseError {
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
var RecursiveReadLimitExceededError = class extends BaseError {
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

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AbiParameters.js
function decode(parameters, data, options = {}) {
  const { as = "Array", checksumAddress = false } = options;
  const bytes = typeof data === "string" ? fromHex(data) : data;
  const cursor = create(bytes);
  if (size(bytes) === 0 && parameters.length > 0)
    throw new ZeroDataError();
  if (size(bytes) && size(bytes) < 32)
    throw new DataSizeTooSmallError({
      data: typeof data === "string" ? data : fromBytes(data),
      parameters,
      size: size(bytes)
    });
  let consumed = 0;
  const values = as === "Array" ? [] : {};
  for (let i = 0; i < parameters.length; ++i) {
    const param = parameters[i];
    cursor.setPosition(consumed);
    const [data2, consumed_] = decodeParameter(cursor, param, {
      checksumAddress,
      staticPosition: 0
    });
    consumed += consumed_;
    if (as === "Array")
      values.push(data2);
    else
      values[param.name ?? i] = data2;
  }
  return values;
}
function encode2(parameters, values, options) {
  const { checksumAddress = false } = options ?? {};
  if (parameters.length !== values.length)
    throw new LengthMismatchError({
      expectedLength: parameters.length,
      givenLength: values.length
    });
  const preparedParameters = prepareParameters({
    checksumAddress,
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
  for (let i = 0; i < types.length; i++) {
    const type6 = types[i];
    const value = values[i];
    data.push(encodePacked.encode(type6, value));
  }
  return concat(...data);
}
(function(encodePacked2) {
  function encode10(type6, value, isArray = false) {
    if (type6 === "address") {
      const address = value;
      assert4(address);
      return padLeft(address.toLowerCase(), isArray ? 32 : 0);
    }
    if (type6 === "string")
      return fromString(value);
    if (type6 === "bytes")
      return value;
    if (type6 === "bool")
      return padLeft(fromBoolean(value), isArray ? 32 : 1);
    const intMatch = type6.match(integerRegex);
    if (intMatch) {
      const [_type, baseType, bits = "256"] = intMatch;
      const size4 = Number.parseInt(bits, 10) / 8;
      return fromNumber(value, {
        size: isArray ? 32 : size4,
        signed: baseType === "int"
      });
    }
    const bytesMatch = type6.match(bytesRegex);
    if (bytesMatch) {
      const [_type, size4] = bytesMatch;
      if (Number.parseInt(size4, 10) !== (value.length - 2) / 2)
        throw new BytesSizeMismatchError({
          expectedSize: Number.parseInt(size4, 10),
          value
        });
      return padRight(value, isArray ? 32 : 0);
    }
    const arrayMatch = type6.match(arrayRegex);
    if (arrayMatch && Array.isArray(value)) {
      const [_type, childType] = arrayMatch;
      const data = [];
      for (let i = 0; i < value.length; i++) {
        data.push(encode10(childType, value[i], true));
      }
      if (data.length === 0)
        return "0x";
      return concat(...data);
    }
    throw new InvalidTypeError(type6);
  }
  encodePacked2.encode = encode10;
})(encodePacked || (encodePacked = {}));
function format3(parameters) {
  return formatAbiParameters(parameters);
}
function from7(parameters) {
  if (Array.isArray(parameters) && typeof parameters[0] === "string")
    return parseAbiParameters(parameters);
  if (typeof parameters === "string")
    return parseAbiParameters(parameters);
  return parameters;
}
var DataSizeTooSmallError = class extends BaseError {
  constructor({ data, parameters, size: size4 }) {
    super(`Data size of ${size4} bytes is too small for given parameters.`, {
      metaMessages: [
        `Params: (${formatAbiParameters(parameters)})`,
        `Data:   ${data} (${size4} bytes)`
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
var ZeroDataError = class extends BaseError {
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
var ArrayLengthMismatchError = class extends BaseError {
  constructor({ expectedLength, givenLength, type: type6 }) {
    super(`Array length mismatch for type \`${type6}\`. Expected: \`${expectedLength}\`. Given: \`${givenLength}\`.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.ArrayLengthMismatchError"
    });
  }
};
var BytesSizeMismatchError = class extends BaseError {
  constructor({ expectedSize, value }) {
    super(`Size of bytes "${value}" (bytes${size2(value)}) does not match expected size (bytes${expectedSize}).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.BytesSizeMismatchError"
    });
  }
};
var LengthMismatchError = class extends BaseError {
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
var InvalidArrayError = class extends BaseError {
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
var InvalidTypeError = class extends BaseError {
  constructor(type6) {
    super(`Type \`${type6}\` is not a valid ABI Type.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiParameters.InvalidTypeError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AbiConstructor.js
function decode2(...parameters) {
  const [abiConstructor, options] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi, options2] = parameters;
      return [fromAbi2(abi), options2];
    }
    return parameters;
  })();
  const { bytecode } = options;
  if (abiConstructor.inputs?.length === 0)
    return void 0;
  const data = options.data.replace(bytecode, "0x");
  return decode(abiConstructor.inputs, data);
}
function encode3(...parameters) {
  const [abiConstructor, options] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi, options2] = parameters;
      return [fromAbi2(abi), options2];
    }
    return parameters;
  })();
  const { bytecode, args } = options;
  return concat(bytecode, abiConstructor.inputs?.length && args?.length ? encode2(abiConstructor.inputs, args) : "0x");
}
function format4(abiConstructor) {
  return formatAbiItem(abiConstructor);
}
function from8(abiConstructor) {
  return from6(abiConstructor);
}
function fromAbi2(abi) {
  const item = abi.find((item2) => item2.type === "constructor");
  if (!item)
    throw new NotFoundError({ name: "constructor" });
  return item;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AbiError.js
var AbiError_exports = {};
__export(AbiError_exports, {
  decode: () => decode3,
  encode: () => encode4,
  format: () => format5,
  from: () => from9,
  fromAbi: () => fromAbi3,
  getSelector: () => getSelector2,
  panicReasons: () => panicReasons,
  solidityError: () => solidityError,
  solidityErrorSelector: () => solidityErrorSelector,
  solidityPanic: () => solidityPanic,
  solidityPanicSelector: () => solidityPanicSelector
});
function decode3(...parameters) {
  const [abiError, data, options = {}] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi, name, data2, options2] = parameters;
      return [fromAbi3(abi, name), data2, options2];
    }
    return parameters;
  })();
  if (size2(data) < 4)
    throw new InvalidSelectorSizeError({ data });
  if (abiError.inputs?.length === 0)
    return void 0;
  const values = decode(abiError.inputs, slice(data, 4), options);
  if (values && Object.keys(values).length === 1) {
    if (Array.isArray(values))
      return values[0];
    return Object.values(values)[0];
  }
  return values;
}
function encode4(...parameters) {
  const [abiError, args] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi, name, ...args3] = parameters;
      return [fromAbi3(abi, name), args3];
    }
    const [abiError2, ...args2] = parameters;
    return [abiError2, args2];
  })();
  const selector = getSelector2(abiError);
  const data = args.length > 0 ? encode2(abiError.inputs, args[0]) : void 0;
  return data ? concat(selector, data) : selector;
}
function format5(abiError) {
  return formatAbiItem(abiError);
}
function from9(abiError, options = {}) {
  return from6(abiError, options);
}
function fromAbi3(abi, name, options) {
  if (name === "Error")
    return solidityError;
  if (name === "Panic")
    return solidityPanic;
  if (validate(name, { strict: false })) {
    const selector = slice(name, 0, 4);
    if (selector === solidityErrorSelector)
      return solidityError;
    if (selector === solidityPanicSelector)
      return solidityPanic;
  }
  const item = fromAbi(abi, name, options);
  if (item.type !== "error")
    throw new NotFoundError({ name, type: "error" });
  return item;
}
function getSelector2(abiItem) {
  return getSelector(abiItem);
}
var panicReasons = {
  1: "An `assert` condition failed.",
  17: "Arithmetic operation resulted in underflow or overflow.",
  18: "Division or modulo by zero (e.g. `5 / 0` or `23 % 0`).",
  33: "Attempted to convert to an invalid type.",
  34: "Attempted to access a storage byte array that is incorrectly encoded.",
  49: "Performed `.pop()` on an empty array",
  50: "Array index is out of bounds.",
  65: "Allocated too much memory or created an array which is too large.",
  81: "Attempted to call a zero-initialized variable of internal function type."
};
var solidityError = /* @__PURE__ */ from9({
  inputs: [
    {
      name: "message",
      type: "string"
    }
  ],
  name: "Error",
  type: "error"
});
var solidityErrorSelector = "0x08c379a0";
var solidityPanic = /* @__PURE__ */ from9({
  inputs: [
    {
      name: "reason",
      type: "uint8"
    }
  ],
  name: "Panic",
  type: "error"
});
var solidityPanicSelector = "0x4e487b71";

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AbiEvent.js
var AbiEvent_exports = {};
__export(AbiEvent_exports, {
  ArgsMismatchError: () => ArgsMismatchError,
  DataMismatchError: () => DataMismatchError,
  FilterTypeNotSupportedError: () => FilterTypeNotSupportedError,
  InputNotFoundError: () => InputNotFoundError,
  SelectorTopicMismatchError: () => SelectorTopicMismatchError,
  TopicsMismatchError: () => TopicsMismatchError,
  assertArgs: () => assertArgs,
  decode: () => decode4,
  encode: () => encode5,
  format: () => format6,
  from: () => from10,
  fromAbi: () => fromAbi4,
  getSelector: () => getSelector3
});
function assertArgs(abiEvent, args, matchArgs) {
  if (!args || !matchArgs)
    throw new ArgsMismatchError({
      abiEvent,
      expected: args,
      given: matchArgs
    });
  function isEqual4(input, value, arg) {
    if (input.type === "address")
      return isEqual3(value, arg);
    if (input.type === "string")
      return keccak256(fromString2(value)) === arg;
    if (input.type === "bytes")
      return keccak256(value) === arg;
    return value === arg;
  }
  if (Array.isArray(args) && Array.isArray(matchArgs)) {
    for (const [index2, value] of matchArgs.entries()) {
      if (value === null || value === void 0)
        continue;
      const input = abiEvent.inputs[index2];
      if (!input)
        throw new InputNotFoundError({
          abiEvent,
          name: `${index2}`
        });
      const value_ = Array.isArray(value) ? value : [value];
      let equal = false;
      for (const value2 of value_) {
        if (isEqual4(input, value2, args[index2]))
          equal = true;
      }
      if (!equal)
        throw new ArgsMismatchError({
          abiEvent,
          expected: args,
          given: matchArgs
        });
    }
  }
  if (typeof args === "object" && !Array.isArray(args) && typeof matchArgs === "object" && !Array.isArray(matchArgs))
    for (const [key, value] of Object.entries(matchArgs)) {
      if (value === null || value === void 0)
        continue;
      const input = abiEvent.inputs.find((input2) => input2.name === key);
      if (!input)
        throw new InputNotFoundError({ abiEvent, name: key });
      const value_ = Array.isArray(value) ? value : [value];
      let equal = false;
      for (const value2 of value_) {
        if (isEqual4(input, value2, args[key]))
          equal = true;
      }
      if (!equal)
        throw new ArgsMismatchError({
          abiEvent,
          expected: args,
          given: matchArgs
        });
    }
}
function decode4(...parameters) {
  const [abiEvent, log] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi, name, log2] = parameters;
      return [fromAbi4(abi, name), log2];
    }
    return parameters;
  })();
  const { data, topics } = log;
  const [selector_, ...argTopics] = topics;
  const selector = getSelector3(abiEvent);
  if (selector_ !== selector)
    throw new SelectorTopicMismatchError({
      abiEvent,
      actual: selector_,
      expected: selector
    });
  const { inputs } = abiEvent;
  const isUnnamed = inputs?.every((x) => !("name" in x && x.name));
  let args = isUnnamed ? [] : {};
  const indexedInputs = inputs.filter((x) => "indexed" in x && x.indexed);
  for (let i = 0; i < indexedInputs.length; i++) {
    const param = indexedInputs[i];
    const topic = argTopics[i];
    if (!topic)
      throw new TopicsMismatchError({
        abiEvent,
        param
      });
    args[isUnnamed ? i : param.name || i] = (() => {
      if (param.type === "string" || param.type === "bytes" || param.type === "tuple" || param.type.match(/^(.*)\[(\d+)?\]$/))
        return topic;
      const decoded = decode([param], topic) || [];
      return decoded[0];
    })();
  }
  const nonIndexedInputs = inputs.filter((x) => !("indexed" in x && x.indexed));
  if (nonIndexedInputs.length > 0) {
    if (data && data !== "0x") {
      try {
        const decodedData = decode(nonIndexedInputs, data);
        if (decodedData) {
          if (isUnnamed)
            args = [...args, ...decodedData];
          else {
            for (let i = 0; i < nonIndexedInputs.length; i++) {
              const index2 = inputs.indexOf(nonIndexedInputs[i]);
              args[nonIndexedInputs[i].name || index2] = decodedData[i];
            }
          }
        }
      } catch (err) {
        if (err instanceof DataSizeTooSmallError || err instanceof PositionOutOfBoundsError)
          throw new DataMismatchError({
            abiEvent,
            data,
            parameters: nonIndexedInputs,
            size: size2(data)
          });
        throw err;
      }
    } else {
      throw new DataMismatchError({
        abiEvent,
        data: "0x",
        parameters: nonIndexedInputs,
        size: 0
      });
    }
  }
  return Object.values(args).length > 0 ? args : void 0;
}
function encode5(...parameters) {
  const [abiEvent, args] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi, name, args3] = parameters;
      return [fromAbi4(abi, name), args3];
    }
    const [abiEvent2, args2] = parameters;
    return [abiEvent2, args2];
  })();
  let topics = [];
  if (args && abiEvent.inputs) {
    const indexedInputs = abiEvent.inputs.filter((param) => "indexed" in param && param.indexed);
    const args_ = Array.isArray(args) ? args : Object.values(args).length > 0 ? indexedInputs?.map((x, i) => args[x.name ?? i]) ?? [] : [];
    if (args_.length > 0) {
      const encode10 = (param, value) => {
        if (param.type === "string")
          return keccak256(fromString(value));
        if (param.type === "bytes")
          return keccak256(value);
        if (param.type === "tuple" || param.type.match(/^(.*)\[(\d+)?\]$/))
          throw new FilterTypeNotSupportedError(param.type);
        return encode2([param], [value]);
      };
      topics = indexedInputs?.map((param, i) => {
        if (Array.isArray(args_[i]))
          return args_[i].map((_, j) => encode10(param, args_[i][j]));
        return typeof args_[i] !== "undefined" && args_[i] !== null ? encode10(param, args_[i]) : null;
      }) ?? [];
    }
  }
  const selector = (() => {
    if (abiEvent.hash)
      return abiEvent.hash;
    return getSelector3(abiEvent);
  })();
  return { topics: [selector, ...topics] };
}
function format6(abiEvent) {
  return formatAbiItem(abiEvent);
}
function from10(abiEvent, options = {}) {
  return from6(abiEvent, options);
}
function fromAbi4(abi, name, options) {
  const item = fromAbi(abi, name, options);
  if (item.type !== "event")
    throw new NotFoundError({ name, type: "event" });
  return item;
}
function getSelector3(abiItem) {
  return getSignatureHash(abiItem);
}
var ArgsMismatchError = class extends BaseError {
  constructor({ abiEvent, expected, given }) {
    super("Given arguments do not match the expected arguments.", {
      metaMessages: [
        `Event: ${format6(abiEvent)}`,
        `Expected Arguments: ${!expected ? "None" : ""}`,
        expected ? prettyPrint(expected) : void 0,
        `Given Arguments: ${!given ? "None" : ""}`,
        given ? prettyPrint(given) : void 0
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiEvent.ArgsMismatchError"
    });
  }
};
var InputNotFoundError = class extends BaseError {
  constructor({ abiEvent, name }) {
    super(`Parameter "${name}" not found on \`${format6(abiEvent)}\`.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiEvent.InputNotFoundError"
    });
  }
};
var DataMismatchError = class extends BaseError {
  constructor({ abiEvent, data, parameters, size: size4 }) {
    super([
      `Data size of ${size4} bytes is too small for non-indexed event parameters.`
    ].join("\n"), {
      metaMessages: [
        `Non-indexed Parameters: (${format3(parameters)})`,
        `Data:   ${data} (${size4} bytes)`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiEvent.DataMismatchError"
    });
    Object.defineProperty(this, "abiEvent", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "data", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "parameters", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "size", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.abiEvent = abiEvent;
    this.data = data;
    this.parameters = parameters;
    this.size = size4;
  }
};
var TopicsMismatchError = class extends BaseError {
  constructor({ abiEvent, param }) {
    super([
      `Expected a topic for indexed event parameter${param.name ? ` "${param.name}"` : ""} for "${format6(abiEvent)}".`
    ].join("\n"));
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiEvent.TopicsMismatchError"
    });
    Object.defineProperty(this, "abiEvent", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.abiEvent = abiEvent;
  }
};
var SelectorTopicMismatchError = class extends BaseError {
  constructor({ abiEvent, actual, expected }) {
    super(`topics[0]="${actual}" does not match the expected topics[0]="${expected}".`, {
      metaMessages: [`Event: ${format6(abiEvent)}`, `Selector: ${expected}`]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiEvent.SelectorTopicMismatchError"
    });
  }
};
var FilterTypeNotSupportedError = class extends BaseError {
  constructor(type6) {
    super(`Filter type "${type6}" is not supported.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AbiEvent.FilterTypeNotSupportedError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AbiFunction.js
var AbiFunction_exports = {};
__export(AbiFunction_exports, {
  decodeData: () => decodeData,
  decodeResult: () => decodeResult,
  encodeData: () => encodeData,
  encodeResult: () => encodeResult,
  format: () => format7,
  from: () => from11,
  fromAbi: () => fromAbi5,
  getSelector: () => getSelector4
});
function decodeData(...parameters) {
  const [abiFunction, data] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi, name, data2] = parameters;
      return [fromAbi5(abi, name), data2];
    }
    return parameters;
  })();
  const { overloads } = abiFunction;
  if (size2(data) < 4)
    throw new InvalidSelectorSizeError({ data });
  if (abiFunction.inputs?.length === 0)
    return void 0;
  const item = overloads ? fromAbi5([abiFunction, ...overloads], data) : abiFunction;
  if (size2(data) <= 4)
    return void 0;
  return decode(item.inputs, slice(data, 4));
}
function decodeResult(...parameters) {
  const [abiFunction, data, options = {}] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi, name, data2, options2] = parameters;
      return [fromAbi5(abi, name), data2, options2];
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
function encodeData(...parameters) {
  const [abiFunction, args = []] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi, name, args3] = parameters;
      return [fromAbi5(abi, name, { args: args3 }), args3];
    }
    const [abiFunction2, args2] = parameters;
    return [abiFunction2, args2];
  })();
  const { overloads } = abiFunction;
  const item = overloads ? fromAbi5([abiFunction, ...overloads], abiFunction.name, {
    args
  }) : abiFunction;
  const selector = getSelector4(item);
  const data = args.length > 0 ? encode2(item.inputs, args) : void 0;
  return data ? concat(selector, data) : selector;
}
function encodeResult(...parameters) {
  const [abiFunction, output, options = {}] = (() => {
    if (Array.isArray(parameters[0])) {
      const [abi, name, output2, options2] = parameters;
      return [fromAbi5(abi, name), output2, options2];
    }
    return parameters;
  })();
  const { as = "Array" } = options;
  const values = (() => {
    if (abiFunction.outputs.length === 1)
      return [output];
    if (Array.isArray(output))
      return output;
    if (as === "Object")
      return Object.values(output);
    return [output];
  })();
  return encode2(abiFunction.outputs, values);
}
function format7(abiFunction) {
  return formatAbiItem(abiFunction);
}
function from11(abiFunction, options = {}) {
  return from6(abiFunction, options);
}
function fromAbi5(abi, name, options) {
  const item = fromAbi(abi, name, options);
  if (item.type !== "function")
    throw new NotFoundError({ name, type: "function" });
  return item;
}
function getSelector4(abiItem) {
  return getSelector(abiItem);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AccessList.js
var AccessList_exports = {};
__export(AccessList_exports, {
  InvalidStorageKeySizeError: () => InvalidStorageKeySizeError,
  fromTupleList: () => fromTupleList,
  toTupleList: () => toTupleList
});
function fromTupleList(accessList) {
  const list = [];
  for (let i = 0; i < accessList.length; i++) {
    const [address, storageKeys] = accessList[i];
    if (address)
      assert4(address, { strict: false });
    list.push({
      address,
      storageKeys: storageKeys.map((key) => validate3(key) ? key : trimLeft(key))
    });
  }
  return list;
}
function toTupleList(accessList) {
  if (!accessList || accessList.length === 0)
    return [];
  const tuple = [];
  for (const { address, storageKeys } of accessList) {
    for (let j = 0; j < storageKeys.length; j++)
      if (size2(storageKeys[j]) !== 32)
        throw new InvalidStorageKeySizeError({
          storageKey: storageKeys[j]
        });
    if (address)
      assert4(address, { strict: false });
    tuple.push([address, storageKeys]);
  }
  return tuple;
}
var InvalidStorageKeySizeError = class extends BaseError {
  constructor({ storageKey }) {
    super(`Size for storage key "${storageKey}" is invalid. Expected 32 bytes. Got ${size2(storageKey)} bytes.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "AccessList.InvalidStorageKeySizeError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AccountProof.js
var AccountProof_exports = {};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/AesGcm.js
var AesGcm_exports = {};
__export(AesGcm_exports, {
  decrypt: () => decrypt,
  encrypt: () => encrypt,
  getKey: () => getKey,
  ivLength: () => ivLength,
  randomSalt: () => randomSalt
});
var ivLength = 16;
async function decrypt(value, key, options = {}) {
  const { as = typeof value === "string" ? "Hex" : "Bytes" } = options;
  const encrypted = from3(value);
  const iv = encrypted.slice(0, ivLength);
  const data = encrypted.slice(ivLength);
  const decrypted = await globalThis.crypto.subtle.decrypt({
    name: "AES-GCM",
    iv
  }, key, from3(data));
  const result = new Uint8Array(decrypted);
  if (as === "Bytes")
    return result;
  return from2(result);
}
async function encrypt(value, key, options = {}) {
  const { as = typeof value === "string" ? "Hex" : "Bytes" } = options;
  const iv = random(ivLength);
  const encrypted = await globalThis.crypto.subtle.encrypt({
    name: "AES-GCM",
    iv
  }, key, from3(value));
  const result = concat2(iv, new Uint8Array(encrypted));
  if (as === "Bytes")
    return result;
  return from2(result);
}
async function getKey(options) {
  const { iterations = 9e5, password, salt = randomSalt(32) } = options;
  const baseKey = await globalThis.crypto.subtle.importKey("raw", fromString2(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
  const key = await globalThis.crypto.subtle.deriveKey({
    name: "PBKDF2",
    salt,
    iterations,
    hash: "SHA-256"
  }, baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return key;
}
function randomSalt(size4 = 32) {
  return random(size4);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Authorization.js
var Authorization_exports = {};
__export(Authorization_exports, {
  from: () => from14,
  fromRpc: () => fromRpc2,
  fromRpcList: () => fromRpcList,
  fromTuple: () => fromTuple2,
  fromTupleList: () => fromTupleList2,
  getSignPayload: () => getSignPayload,
  hash: () => hash,
  toRpc: () => toRpc2,
  toRpcList: () => toRpcList,
  toTuple: () => toTuple2,
  toTupleList: () => toTupleList2
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Rlp.js
var Rlp_exports = {};
__export(Rlp_exports, {
  decodeRlpCursor: () => decodeRlpCursor,
  from: () => from12,
  fromBytes: () => fromBytes3,
  fromHex: () => fromHex3,
  readLength: () => readLength,
  readList: () => readList,
  to: () => to,
  toBytes: () => toBytes4,
  toHex: () => toHex3
});
function toBytes4(value) {
  return to(value, "Bytes");
}
function toHex3(value) {
  return to(value, "Hex");
}
function to(value, to3) {
  const to_ = to3 ?? (typeof value === "string" ? "Hex" : "Bytes");
  const bytes = (() => {
    if (typeof value === "string") {
      if (value.length > 3 && value.length % 2 !== 0)
        throw new InvalidLengthError(value);
      return fromHex(value);
    }
    return value;
  })();
  const cursor = create(bytes, {
    recursiveReadLimit: Number.POSITIVE_INFINITY
  });
  const result = decodeRlpCursor(cursor, to_);
  return result;
}
function decodeRlpCursor(cursor, to3 = "Hex") {
  if (cursor.bytes.length === 0)
    return to3 === "Hex" ? fromBytes(cursor.bytes) : cursor.bytes;
  const prefix = cursor.readByte();
  if (prefix < 128)
    cursor.decrementPosition(1);
  if (prefix < 192) {
    const length2 = readLength(cursor, prefix, 128);
    const bytes = cursor.readBytes(length2);
    return to3 === "Hex" ? fromBytes(bytes) : bytes;
  }
  const length = readLength(cursor, prefix, 192);
  return readList(cursor, length, to3);
}
function readLength(cursor, prefix, offset) {
  if (offset === 128 && prefix < 128)
    return 1;
  if (prefix <= offset + 55)
    return prefix - offset;
  if (prefix === offset + 55 + 1)
    return cursor.readUint8();
  if (prefix === offset + 55 + 2)
    return cursor.readUint16();
  if (prefix === offset + 55 + 3)
    return cursor.readUint24();
  if (prefix === offset + 55 + 4)
    return cursor.readUint32();
  throw new BaseError("Invalid RLP prefix");
}
function readList(cursor, length, to3) {
  const position = cursor.position;
  const value = [];
  while (cursor.position - position < length)
    value.push(decodeRlpCursor(cursor, to3));
  return value;
}
function from12(value, options) {
  const { as } = options;
  const encodable = getEncodable(value);
  const cursor = create(new Uint8Array(encodable.length));
  encodable.encode(cursor);
  if (as === "Hex")
    return fromBytes(cursor.bytes);
  return cursor.bytes;
}
function fromBytes3(bytes, options = {}) {
  const { as = "Bytes" } = options;
  return from12(bytes, { as });
}
function fromHex3(hex, options = {}) {
  const { as = "Hex" } = options;
  return from12(hex, { as });
}
function getEncodable(bytes) {
  if (Array.isArray(bytes))
    return getEncodableList(bytes.map((x) => getEncodable(x)));
  return getEncodableBytes(bytes);
}
function getEncodableList(list) {
  const bodyLength = list.reduce((acc, x) => acc + x.length, 0);
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
      for (const { encode: encode10 } of list) {
        encode10(cursor);
      }
    }
  };
}
function getEncodableBytes(bytesOrHex) {
  const bytes = typeof bytesOrHex === "string" ? fromHex(bytesOrHex) : bytesOrHex;
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
  if (length <= 255)
    return 1;
  if (length <= 65535)
    return 2;
  if (length <= 16777215)
    return 3;
  if (length <= 4294967295)
    return 4;
  throw new BaseError("Length is too large.");
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Signature.js
var Signature_exports = {};
__export(Signature_exports, {
  InvalidRError: () => InvalidRError,
  InvalidSError: () => InvalidSError,
  InvalidSerializedSizeError: () => InvalidSerializedSizeError2,
  InvalidVError: () => InvalidVError,
  InvalidYParityError: () => InvalidYParityError,
  MissingPropertiesError: () => MissingPropertiesError,
  assert: () => assert5,
  extract: () => extract,
  from: () => from13,
  fromBytes: () => fromBytes4,
  fromDerBytes: () => fromDerBytes,
  fromDerHex: () => fromDerHex,
  fromHex: () => fromHex4,
  fromLegacy: () => fromLegacy,
  fromRpc: () => fromRpc,
  fromTuple: () => fromTuple,
  toBytes: () => toBytes5,
  toDerBytes: () => toDerBytes,
  toDerHex: () => toDerHex,
  toHex: () => toHex4,
  toLegacy: () => toLegacy,
  toRpc: () => toRpc,
  toTuple: () => toTuple,
  vToYParity: () => vToYParity,
  validate: () => validate6,
  yParityToV: () => yParityToV
});
function assert5(signature, options = {}) {
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
function fromBytes4(signature) {
  return fromHex4(fromBytes(signature));
}
function fromHex4(signature) {
  if (signature.length !== 130 && signature.length !== 132)
    throw new InvalidSerializedSizeError2({ signature });
  const r = BigInt(slice(signature, 0, 32));
  const s = BigInt(slice(signature, 32, 64));
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
      r,
      s
    };
  return {
    r,
    s,
    yParity
  };
}
function extract(value) {
  if (typeof value.r === "undefined")
    return void 0;
  if (typeof value.s === "undefined")
    return void 0;
  return from13(value);
}
function from13(signature) {
  const signature_ = (() => {
    if (typeof signature === "string")
      return fromHex4(signature);
    if (signature instanceof Uint8Array)
      return fromBytes4(signature);
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
  assert5(signature_);
  return signature_;
}
function fromDerBytes(signature) {
  return fromDerHex(fromBytes(signature));
}
function fromDerHex(signature) {
  const { r, s } = secp256k1.Signature.fromDER(from2(signature).slice(2));
  return { r, s };
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
    const v = signature.v ? Number(signature.v) : void 0;
    let yParity2 = signature.yParity ? Number(signature.yParity) : void 0;
    if (typeof v === "number" && typeof yParity2 !== "number")
      yParity2 = vToYParity(v);
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
function fromTuple(tuple) {
  const [yParity, r, s] = tuple;
  return from13({
    r: r === "0x" ? 0n : BigInt(r),
    s: s === "0x" ? 0n : BigInt(s),
    yParity: yParity === "0x" ? 0 : Number(yParity)
  });
}
function toBytes5(signature) {
  return fromHex(toHex4(signature));
}
function toHex4(signature) {
  assert5(signature);
  const r = signature.r;
  const s = signature.s;
  const signature_ = concat(
    fromNumber(r, { size: 32 }),
    fromNumber(s, { size: 32 }),
    // If the signature is recovered, add the recovery byte to the signature.
    typeof signature.yParity === "number" ? fromNumber(yParityToV(signature.yParity), { size: 1 }) : "0x"
  );
  return signature_;
}
function toDerBytes(signature) {
  const sig = new secp256k1.Signature(signature.r, signature.s);
  return sig.toDERRawBytes();
}
function toDerHex(signature) {
  const sig = new secp256k1.Signature(signature.r, signature.s);
  return `0x${sig.toDERHex()}`;
}
function toLegacy(signature) {
  return {
    r: signature.r,
    s: signature.s,
    v: yParityToV(signature.yParity)
  };
}
function toRpc(signature) {
  const { r, s, yParity } = signature;
  return {
    r: fromNumber(r, { size: 32 }),
    s: fromNumber(s, { size: 32 }),
    yParity: yParity === 0 ? "0x0" : "0x1"
  };
}
function toTuple(signature) {
  const { r, s, yParity } = signature;
  return [
    yParity ? "0x01" : "0x",
    r === 0n ? "0x" : trimLeft(fromNumber(r)),
    s === 0n ? "0x" : trimLeft(fromNumber(s))
  ];
}
function validate6(signature, options = {}) {
  try {
    assert5(signature, options);
    return true;
  } catch {
    return false;
  }
}
function vToYParity(v) {
  if (v === 0 || v === 27)
    return 0;
  if (v === 1 || v === 28)
    return 1;
  if (v >= 35)
    return v % 2 === 0 ? 1 : 0;
  throw new InvalidVError({ value: v });
}
function yParityToV(yParity) {
  if (yParity === 0)
    return 27;
  if (yParity === 1)
    return 28;
  throw new InvalidYParityError({ value: yParity });
}
var InvalidSerializedSizeError2 = class extends BaseError {
  constructor({ signature }) {
    super(`Value \`${signature}\` is an invalid signature size.`, {
      metaMessages: [
        "Expected: 64 bytes or 65 bytes.",
        `Received ${size2(from2(signature))} bytes.`
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
var MissingPropertiesError = class extends BaseError {
  constructor({ signature }) {
    super(`Signature \`${stringify(signature)}\` is missing either an \`r\`, \`s\`, or \`yParity\` property.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Signature.MissingPropertiesError"
    });
  }
};
var InvalidRError = class extends BaseError {
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
var InvalidSError = class extends BaseError {
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
var InvalidYParityError = class extends BaseError {
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
var InvalidVError = class extends BaseError {
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

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Authorization.js
function from14(authorization, options = {}) {
  if (typeof authorization.chainId === "string")
    return fromRpc2(authorization);
  return { ...authorization, ...options.signature };
}
function fromRpc2(authorization) {
  const { address, chainId, nonce } = authorization;
  const signature = extract(authorization);
  return {
    address,
    chainId: Number(chainId),
    nonce: BigInt(nonce),
    ...signature
  };
}
function fromRpcList(authorizationList) {
  return authorizationList.map(fromRpc2);
}
function fromTuple2(tuple) {
  const [chainId, address, nonce, yParity, r, s] = tuple;
  let args = {
    address,
    chainId: chainId === "0x" ? 0 : Number(chainId),
    nonce: nonce === "0x" ? 0n : BigInt(nonce)
  };
  if (yParity && r && s)
    args = { ...args, ...fromTuple([yParity, r, s]) };
  return from14(args);
}
function fromTupleList2(tupleList) {
  const list = [];
  for (const tuple of tupleList)
    list.push(fromTuple2(tuple));
  return list;
}
function getSignPayload(authorization) {
  return hash(authorization, { presign: true });
}
function hash(authorization, options = {}) {
  const { presign } = options;
  return keccak256(concat("0x05", fromHex3(toTuple2(presign ? {
    address: authorization.address,
    chainId: authorization.chainId,
    nonce: authorization.nonce
  } : authorization))));
}
function toRpc2(authorization) {
  const { address, chainId, nonce, ...signature } = authorization;
  return {
    address,
    chainId: fromNumber(chainId),
    nonce: fromNumber(nonce),
    ...toRpc(signature)
  };
}
function toRpcList(authorizationList) {
  return authorizationList.map(toRpc2);
}
function toTuple2(authorization) {
  const { address, chainId, nonce } = authorization;
  const signature = extract(authorization);
  return [
    chainId ? fromNumber(chainId) : "0x",
    address,
    nonce ? fromNumber(nonce) : "0x",
    ...signature ? toTuple(signature) : []
  ];
}
function toTupleList2(list) {
  if (!list || list.length === 0)
    return [];
  const tupleList = [];
  for (const authorization of list)
    tupleList.push(toTuple2(authorization));
  return tupleList;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Base58.js
var Base58_exports = {};
__export(Base58_exports, {
  fromBytes: () => fromBytes5,
  fromHex: () => fromHex5,
  fromString: () => fromString3,
  toBytes: () => toBytes6,
  toHex: () => toHex5,
  toString: () => toString3
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/base58.js
var integerToAlphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
var alphabetToInteger = (
  /* __PURE__ */
  Object.freeze({
    1: 0n,
    2: 1n,
    3: 2n,
    4: 3n,
    5: 4n,
    6: 5n,
    7: 6n,
    8: 7n,
    9: 8n,
    A: 9n,
    B: 10n,
    C: 11n,
    D: 12n,
    E: 13n,
    F: 14n,
    G: 15n,
    H: 16n,
    J: 17n,
    K: 18n,
    L: 19n,
    M: 20n,
    N: 21n,
    P: 22n,
    Q: 23n,
    R: 24n,
    S: 25n,
    T: 26n,
    U: 27n,
    V: 28n,
    W: 29n,
    X: 30n,
    Y: 31n,
    Z: 32n,
    a: 33n,
    b: 34n,
    c: 35n,
    d: 36n,
    e: 37n,
    f: 38n,
    g: 39n,
    h: 40n,
    i: 41n,
    j: 42n,
    k: 43n,
    m: 44n,
    n: 45n,
    o: 46n,
    p: 47n,
    q: 48n,
    r: 49n,
    s: 50n,
    t: 51n,
    u: 52n,
    v: 53n,
    w: 54n,
    x: 55n,
    y: 56n,
    z: 57n
  })
);
function from15(value) {
  let bytes = from3(value);
  let integer = (() => {
    let hex = value;
    if (value instanceof Uint8Array)
      hex = fromBytes(bytes);
    return BigInt(hex);
  })();
  let result = "";
  while (integer > 0n) {
    const remainder = Number(integer % 58n);
    integer = integer / 58n;
    result = integerToAlphabet[remainder] + result;
  }
  while (bytes.length > 1 && bytes[0] === 0) {
    result = "1" + result;
    bytes = bytes.slice(1);
  }
  return result;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Base58.js
function fromBytes5(value) {
  return from15(value);
}
function fromHex5(value) {
  return from15(value);
}
function fromString3(value) {
  return from15(fromString2(value));
}
function toBytes6(value) {
  return fromHex(toHex5(value));
}
function toHex5(value) {
  let integer = BigInt(0);
  let pad3 = 0;
  let checkPad = true;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (checkPad && char === "1")
      pad3++;
    else
      checkPad = false;
    if (typeof alphabetToInteger[char] !== "bigint")
      throw new Error("invalid base58 character: " + char);
    integer = integer * 58n;
    integer = integer + alphabetToInteger[char];
  }
  if (!pad3)
    return `0x${integer.toString(16)}`;
  return `0x${"0".repeat(pad3 * 2)}${integer.toString(16)}`;
}
function toString3(value) {
  return toString(toHex5(value));
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Base64.js
var Base64_exports = {};
__export(Base64_exports, {
  fromBytes: () => fromBytes6,
  fromHex: () => fromHex6,
  fromString: () => fromString4,
  toBytes: () => toBytes7,
  toHex: () => toHex6,
  toString: () => toString4
});
var encoder3 = /* @__PURE__ */ new TextEncoder();
var decoder2 = /* @__PURE__ */ new TextDecoder();
var integerToCharacter = /* @__PURE__ */ Object.fromEntries(Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/").map((a, i) => [i, a.charCodeAt(0)]));
var characterToInteger = {
  ...Object.fromEntries(Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/").map((a, i) => [a.charCodeAt(0), i])),
  ["=".charCodeAt(0)]: 0,
  ["-".charCodeAt(0)]: 62,
  ["_".charCodeAt(0)]: 63
};
function fromBytes6(value, options = {}) {
  const { pad: pad3 = true, url = false } = options;
  const encoded = new Uint8Array(Math.ceil(value.length / 3) * 4);
  for (let i = 0, j = 0; j < value.length; i += 4, j += 3) {
    const y = (value[j] << 16) + (value[j + 1] << 8) + (value[j + 2] | 0);
    encoded[i] = integerToCharacter[y >> 18];
    encoded[i + 1] = integerToCharacter[y >> 12 & 63];
    encoded[i + 2] = integerToCharacter[y >> 6 & 63];
    encoded[i + 3] = integerToCharacter[y & 63];
  }
  const k = value.length % 3;
  const end = Math.floor(value.length / 3) * 4 + (k && k + 1);
  let base64 = decoder2.decode(new Uint8Array(encoded.buffer, 0, end));
  if (pad3 && k === 1)
    base64 += "==";
  if (pad3 && k === 2)
    base64 += "=";
  if (url)
    base64 = base64.replaceAll("+", "-").replaceAll("/", "_");
  return base64;
}
function fromHex6(value, options = {}) {
  return fromBytes6(fromHex(value), options);
}
function fromString4(value, options = {}) {
  return fromBytes6(fromString2(value), options);
}
function toBytes7(value) {
  const base64 = value.replace(/=+$/, "");
  const size4 = base64.length;
  const decoded = new Uint8Array(size4 + 3);
  encoder3.encodeInto(base64 + "===", decoded);
  for (let i = 0, j = 0; i < base64.length; i += 4, j += 3) {
    const x = (characterToInteger[decoded[i]] << 18) + (characterToInteger[decoded[i + 1]] << 12) + (characterToInteger[decoded[i + 2]] << 6) + characterToInteger[decoded[i + 3]];
    decoded[j] = x >> 16;
    decoded[j + 1] = x >> 8 & 255;
    decoded[j + 2] = x & 255;
  }
  const decodedSize = (size4 >> 2) * 3 + (size4 % 4 && size4 % 4 - 1);
  return new Uint8Array(decoded.buffer, 0, decodedSize);
}
function toHex6(value) {
  return fromBytes(toBytes7(value));
}
function toString4(value) {
  return toString2(toBytes7(value));
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/BinaryStateTree.js
var BinaryStateTree_exports = {};
__export(BinaryStateTree_exports, {
  create: () => create2,
  insert: () => insert,
  merkelize: () => merkelize
});

// node_modules/@noble/hashes/esm/_blake.js
function G1s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr(d ^ a, 16);
  c = c + d | 0;
  b = rotr(b ^ c, 12);
  return { a, b, c, d };
}
function G2s(a, b, c, d, x) {
  a = a + b + x | 0;
  d = rotr(d ^ a, 8);
  c = c + d | 0;
  b = rotr(b ^ c, 7);
  return { a, b, c, d };
}

// node_modules/@noble/hashes/esm/blake2.js
var BLAKE2 = class extends Hash {
  constructor(blockLen, outputLen) {
    super();
    this.finished = false;
    this.destroyed = false;
    this.length = 0;
    this.pos = 0;
    anumber(blockLen);
    anumber(outputLen);
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.buffer = new Uint8Array(blockLen);
    this.buffer32 = u32(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { blockLen, buffer: buffer2, buffer32 } = this;
    const len = data.length;
    const offset = data.byteOffset;
    const buf = data.buffer;
    for (let pos = 0; pos < len; ) {
      if (this.pos === blockLen) {
        swap32IfBE(buffer32);
        this.compress(buffer32, 0, false);
        swap32IfBE(buffer32);
        this.pos = 0;
      }
      const take = Math.min(blockLen - this.pos, len - pos);
      const dataOffset = offset + pos;
      if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
        const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
        swap32IfBE(data32);
        for (let pos32 = 0; pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
          this.length += blockLen;
          this.compress(data32, pos32, false);
        }
        swap32IfBE(data32);
        continue;
      }
      buffer2.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      this.length += take;
      pos += take;
    }
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    const { pos, buffer32 } = this;
    this.finished = true;
    clean(this.buffer.subarray(pos));
    swap32IfBE(buffer32);
    this.compress(buffer32, 0, true);
    swap32IfBE(buffer32);
    const out32 = u32(out);
    this.get().forEach((v, i) => out32[i] = swap8IfBE(v));
  }
  digest() {
    const { buffer: buffer2, outputLen } = this;
    this.digestInto(buffer2);
    const res = buffer2.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to3) {
    const { buffer: buffer2, length, finished, destroyed, outputLen, pos } = this;
    to3 || (to3 = new this.constructor({ dkLen: outputLen }));
    to3.set(...this.get());
    to3.buffer.set(buffer2);
    to3.destroyed = destroyed;
    to3.finished = finished;
    to3.length = length;
    to3.pos = pos;
    to3.outputLen = outputLen;
    return to3;
  }
  clone() {
    return this._cloneInto();
  }
};
function compress2(s, offset, msg, rounds, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15) {
  let j = 0;
  for (let i = 0; i < rounds; i++) {
    ({ a: v0, b: v4, c: v8, d: v12 } = G1s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v0, b: v4, c: v8, d: v12 } = G2s(v0, v4, v8, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G1s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v1, b: v5, c: v9, d: v13 } = G2s(v1, v5, v9, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G1s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v2, b: v6, c: v10, d: v14 } = G2s(v2, v6, v10, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G1s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v3, b: v7, c: v11, d: v15 } = G2s(v3, v7, v11, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G1s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v0, b: v5, c: v10, d: v15 } = G2s(v0, v5, v10, v15, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G1s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v1, b: v6, c: v11, d: v12 } = G2s(v1, v6, v11, v12, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G1s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v2, b: v7, c: v8, d: v13 } = G2s(v2, v7, v8, v13, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G1s(v3, v4, v9, v14, msg[offset + s[j++]]));
    ({ a: v3, b: v4, c: v9, d: v14 } = G2s(v3, v4, v9, v14, msg[offset + s[j++]]));
  }
  return { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 };
}

// node_modules/@noble/hashes/esm/blake3.js
var B3_Flags = {
  CHUNK_START: 1,
  CHUNK_END: 2,
  PARENT: 4,
  ROOT: 8,
  KEYED_HASH: 16,
  DERIVE_KEY_CONTEXT: 32,
  DERIVE_KEY_MATERIAL: 64
};
var B3_IV = SHA256_IV.slice();
var B3_SIGMA = /* @__PURE__ */ (() => {
  const Id = Array.from({ length: 16 }, (_, i) => i);
  const permute = (arr) => [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8].map((i) => arr[i]);
  const res = [];
  for (let i = 0, v = Id; i < 7; i++, v = permute(v))
    res.push(...v);
  return Uint8Array.from(res);
})();
var BLAKE3 = class _BLAKE3 extends BLAKE2 {
  constructor(opts = {}, flags = 0) {
    super(64, opts.dkLen === void 0 ? 32 : opts.dkLen);
    this.chunkPos = 0;
    this.chunksDone = 0;
    this.flags = 0 | 0;
    this.stack = [];
    this.posOut = 0;
    this.bufferOut32 = new Uint32Array(16);
    this.chunkOut = 0;
    this.enableXOF = true;
    const { key, context } = opts;
    const hasContext = context !== void 0;
    if (key !== void 0) {
      if (hasContext)
        throw new Error('Only "key" or "context" can be specified at same time');
      const k = toBytes(key).slice();
      abytes(k, 32);
      this.IV = u32(k);
      swap32IfBE(this.IV);
      this.flags = flags | B3_Flags.KEYED_HASH;
    } else if (hasContext) {
      const ctx = toBytes(context);
      const contextKey = new _BLAKE3({ dkLen: 32 }, B3_Flags.DERIVE_KEY_CONTEXT).update(ctx).digest();
      this.IV = u32(contextKey);
      swap32IfBE(this.IV);
      this.flags = flags | B3_Flags.DERIVE_KEY_MATERIAL;
    } else {
      this.IV = B3_IV.slice();
      this.flags = flags;
    }
    this.state = this.IV.slice();
    this.bufferOut = u8(this.bufferOut32);
  }
  // Unused
  get() {
    return [];
  }
  set() {
  }
  b2Compress(counter, flags, buf, bufPos = 0) {
    const { state: s, pos } = this;
    const { h, l } = fromBig(BigInt(counter), true);
    const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = compress2(B3_SIGMA, bufPos, buf, 7, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], B3_IV[0], B3_IV[1], B3_IV[2], B3_IV[3], h, l, pos, flags);
    s[0] = v0 ^ v8;
    s[1] = v1 ^ v9;
    s[2] = v2 ^ v10;
    s[3] = v3 ^ v11;
    s[4] = v4 ^ v12;
    s[5] = v5 ^ v13;
    s[6] = v6 ^ v14;
    s[7] = v7 ^ v15;
  }
  compress(buf, bufPos = 0, isLast = false) {
    let flags = this.flags;
    if (!this.chunkPos)
      flags |= B3_Flags.CHUNK_START;
    if (this.chunkPos === 15 || isLast)
      flags |= B3_Flags.CHUNK_END;
    if (!isLast)
      this.pos = this.blockLen;
    this.b2Compress(this.chunksDone, flags, buf, bufPos);
    this.chunkPos += 1;
    if (this.chunkPos === 16 || isLast) {
      let chunk = this.state;
      this.state = this.IV.slice();
      for (let last, chunks = this.chunksDone + 1; isLast || !(chunks & 1); chunks >>= 1) {
        if (!(last = this.stack.pop()))
          break;
        this.buffer32.set(last, 0);
        this.buffer32.set(chunk, 8);
        this.pos = this.blockLen;
        this.b2Compress(0, this.flags | B3_Flags.PARENT, this.buffer32, 0);
        chunk = this.state;
        this.state = this.IV.slice();
      }
      this.chunksDone++;
      this.chunkPos = 0;
      this.stack.push(chunk);
    }
    this.pos = 0;
  }
  _cloneInto(to3) {
    to3 = super._cloneInto(to3);
    const { IV, flags, state, chunkPos, posOut, chunkOut, stack, chunksDone } = this;
    to3.state.set(state.slice());
    to3.stack = stack.map((i) => Uint32Array.from(i));
    to3.IV.set(IV);
    to3.flags = flags;
    to3.chunkPos = chunkPos;
    to3.chunksDone = chunksDone;
    to3.posOut = posOut;
    to3.chunkOut = chunkOut;
    to3.enableXOF = this.enableXOF;
    to3.bufferOut32.set(this.bufferOut32);
    return to3;
  }
  destroy() {
    this.destroyed = true;
    clean(this.state, this.buffer32, this.IV, this.bufferOut32);
    clean(...this.stack);
  }
  // Same as b2Compress, but doesn't modify state and returns 16 u32 array (instead of 8)
  b2CompressOut() {
    const { state: s, pos, flags, buffer32, bufferOut32: out32 } = this;
    const { h, l } = fromBig(BigInt(this.chunkOut++));
    swap32IfBE(buffer32);
    const { v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15 } = compress2(B3_SIGMA, 0, buffer32, 7, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], B3_IV[0], B3_IV[1], B3_IV[2], B3_IV[3], l, h, pos, flags);
    out32[0] = v0 ^ v8;
    out32[1] = v1 ^ v9;
    out32[2] = v2 ^ v10;
    out32[3] = v3 ^ v11;
    out32[4] = v4 ^ v12;
    out32[5] = v5 ^ v13;
    out32[6] = v6 ^ v14;
    out32[7] = v7 ^ v15;
    out32[8] = s[0] ^ v8;
    out32[9] = s[1] ^ v9;
    out32[10] = s[2] ^ v10;
    out32[11] = s[3] ^ v11;
    out32[12] = s[4] ^ v12;
    out32[13] = s[5] ^ v13;
    out32[14] = s[6] ^ v14;
    out32[15] = s[7] ^ v15;
    swap32IfBE(buffer32);
    swap32IfBE(out32);
    this.posOut = 0;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    clean(this.buffer.subarray(this.pos));
    let flags = this.flags | B3_Flags.ROOT;
    if (this.stack.length) {
      flags |= B3_Flags.PARENT;
      swap32IfBE(this.buffer32);
      this.compress(this.buffer32, 0, true);
      swap32IfBE(this.buffer32);
      this.chunksDone = 0;
      this.pos = this.blockLen;
    } else {
      flags |= (!this.chunkPos ? B3_Flags.CHUNK_START : 0) | B3_Flags.CHUNK_END;
    }
    this.flags = flags;
    this.b2CompressOut();
  }
  writeInto(out) {
    aexists(this, false);
    abytes(out);
    this.finish();
    const { blockLen, bufferOut } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.b2CompressOut();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible after digest call");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.enableXOF = false;
    this.writeInto(out);
    this.destroy();
    return out;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
};
var blake3 = /* @__PURE__ */ createXOFer((opts) => new BLAKE3(opts));

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/BinaryStateTree.js
function create2() {
  return {
    root: emptyNode()
  };
}
function insert(tree, key, value) {
  const stem = slice2(key, 0, 31);
  const subIndex = slice2(key, 31)[0];
  if (tree.root.type === "empty") {
    tree.root = stemNode(stem);
    tree.root.values[subIndex] = value;
    return;
  }
  function inner(node_, stem2, subIndex2, value2, depth) {
    let node = node_;
    if (node.type === "empty") {
      node = stemNode(stem2);
      node.values[subIndex2] = value2;
      return node;
    }
    const stemBits = bytesToBits(stem2);
    if (node.type === "stem") {
      if (isEqual2(node.stem, stem2)) {
        node.values[subIndex2] = value2;
        return node;
      }
      const existingStemBits = bytesToBits(node.stem);
      return splitLeaf(node, stemBits, existingStemBits, subIndex2, value2, depth);
    }
    if (node.type === "internal") {
      const bit = stemBits[depth];
      if (bit === 0) {
        node.left = inner(node.left, stem2, subIndex2, value2, depth + 1);
      } else {
        node.right = inner(node.right, stem2, subIndex2, value2, depth + 1);
      }
      return node;
    }
    return emptyNode();
  }
  tree.root = inner(tree.root, stem, subIndex, value, 0);
}
function merkelize(tree) {
  function inner(node) {
    if (node.type === "empty")
      return new Uint8Array(32).fill(0);
    if (node.type === "internal") {
      const hash_left = inner(node.left);
      const hash_right = inner(node.right);
      return hash2(concat2(hash_left, hash_right));
    }
    let level = node.values.map(hash2);
    while (level.length > 1) {
      const level_ = [];
      for (let i = 0; i < level.length; i += 2)
        level_.push(hash2(concat2(level[i], level[i + 1])));
      level = level_;
    }
    return hash2(concat2(node.stem, new Uint8Array(1).fill(0), level[0]));
  }
  return inner(tree.root);
}
function splitLeaf(leaf, stemBits, existingStemBits, subIndex, value, depth) {
  if (stemBits[depth] === existingStemBits[depth]) {
    const internal2 = internalNode();
    const bit2 = stemBits[depth];
    if (bit2 === 0) {
      internal2.left = splitLeaf(leaf, stemBits, existingStemBits, subIndex, value, depth + 1);
    } else {
      internal2.right = splitLeaf(leaf, stemBits, existingStemBits, subIndex, value, depth + 1);
    }
    return internal2;
  }
  const internal = internalNode();
  const bit = stemBits[depth];
  const stem = bitsToBytes(stemBits);
  if (bit === 0) {
    internal.left = stemNode(stem);
    internal.left.values[subIndex] = value;
    internal.right = leaf;
  } else {
    internal.right = stemNode(stem);
    internal.right.values[subIndex] = value;
    internal.left = leaf;
  }
  return internal;
}
function emptyNode() {
  return {
    type: "empty"
  };
}
function internalNode() {
  return {
    left: emptyNode(),
    right: emptyNode(),
    type: "internal"
  };
}
function stemNode(stem) {
  return {
    stem,
    values: Array.from({ length: 256 }, () => void 0),
    type: "stem"
  };
}
function bytesToBits(bytes) {
  const bits = [];
  for (const byte of bytes)
    for (let i = 0; i < 8; i++)
      bits.push(byte >> 7 - i & 1);
  return bits;
}
function bitsToBytes(bits) {
  const byte_data = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++)
      byte |= bits[i + j] << 7 - j;
    byte_data[i / 8] = byte;
  }
  return byte_data;
}
function hash2(bytes) {
  if (!bytes)
    return new Uint8Array(32).fill(0);
  if (!bytes.some((byte) => byte !== 0))
    return new Uint8Array(32).fill(0);
  return blake3(bytes);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Blobs.js
var Blobs_exports = {};
__export(Blobs_exports, {
  BlobSizeTooLargeError: () => BlobSizeTooLargeError,
  EmptyBlobError: () => EmptyBlobError,
  EmptyBlobVersionedHashesError: () => EmptyBlobVersionedHashesError,
  InvalidVersionedHashSizeError: () => InvalidVersionedHashSizeError,
  InvalidVersionedHashVersionError: () => InvalidVersionedHashVersionError,
  bytesPerBlob: () => bytesPerBlob,
  bytesPerFieldElement: () => bytesPerFieldElement,
  commitmentToVersionedHash: () => commitmentToVersionedHash,
  commitmentsToVersionedHashes: () => commitmentsToVersionedHashes,
  fieldElementsPerBlob: () => fieldElementsPerBlob,
  from: () => from17,
  maxBytesPerTransaction: () => maxBytesPerTransaction,
  sidecarsToVersionedHashes: () => sidecarsToVersionedHashes,
  to: () => to2,
  toBytes: () => toBytes8,
  toCommitments: () => toCommitments,
  toHex: () => toHex7,
  toProofs: () => toProofs,
  toSidecars: () => toSidecars,
  toVersionedHashes: () => toVersionedHashes
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Kzg.js
var Kzg_exports = {};
__export(Kzg_exports, {
  from: () => from16,
  versionedHashVersion: () => versionedHashVersion
});
var versionedHashVersion = 1;
function from16(value) {
  const { blobToKzgCommitment, computeBlobKzgProof } = value;
  return {
    blobToKzgCommitment,
    computeBlobKzgProof
  };
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Blobs.js
var blobsPerTransaction = 6;
var bytesPerFieldElement = 32;
var fieldElementsPerBlob = 4096;
var bytesPerBlob = bytesPerFieldElement * fieldElementsPerBlob;
var maxBytesPerTransaction = bytesPerBlob * blobsPerTransaction - // terminator byte (0x80).
1 - // zero byte (0x00) appended to each field element.
1 * fieldElementsPerBlob * blobsPerTransaction;
function commitmentsToVersionedHashes(commitments, options = {}) {
  const { version: version2 } = options;
  const as = options.as ?? (typeof commitments[0] === "string" ? "Hex" : "Bytes");
  const hashes = [];
  for (const commitment of commitments) {
    hashes.push(commitmentToVersionedHash(commitment, {
      as,
      version: version2
    }));
  }
  return hashes;
}
function commitmentToVersionedHash(commitment, options = {}) {
  const { version: version2 = 1 } = options;
  const as = options.as ?? (typeof commitment === "string" ? "Hex" : "Bytes");
  const versionedHash = sha2563(commitment, { as: "Bytes" });
  versionedHash.set([version2], 0);
  return as === "Bytes" ? versionedHash : fromBytes(versionedHash);
}
function from17(data, options = {}) {
  const as = options.as ?? (typeof data === "string" ? "Hex" : "Bytes");
  const data_ = typeof data === "string" ? fromHex(data) : data;
  const size_ = size(data_);
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
    const blob = create(new Uint8Array(bytesPerBlob));
    let size4 = 0;
    while (size4 < fieldElementsPerBlob) {
      const bytes = data_.slice(position, position + (bytesPerFieldElement - 1));
      blob.pushByte(0);
      blob.pushBytes(bytes);
      if (bytes.length < 31) {
        blob.pushByte(128);
        active = false;
        break;
      }
      size4++;
      position += 31;
    }
    blobs.push(blob);
  }
  return as === "Bytes" ? blobs.map((x) => x.bytes) : blobs.map((x) => fromBytes(x.bytes));
}
function sidecarsToVersionedHashes(sidecars, options = {}) {
  const { version: version2 } = options;
  const as = options.as ?? (typeof sidecars[0].blob === "string" ? "Hex" : "Bytes");
  const hashes = [];
  for (const { commitment } of sidecars) {
    hashes.push(commitmentToVersionedHash(commitment, {
      as,
      version: version2
    }));
  }
  return hashes;
}
function to2(blobs, to3) {
  const to_ = to3 ?? (typeof blobs[0] === "string" ? "Hex" : "Bytes");
  const blobs_ = typeof blobs[0] === "string" ? blobs.map((x) => fromHex(x)) : blobs;
  const length = blobs_.reduce((length2, blob) => length2 + blob.length, 0);
  const data = create(new Uint8Array(length));
  let active = true;
  for (const blob of blobs_) {
    const cursor = create(blob);
    while (active && cursor.position < blob.length) {
      cursor.incrementPosition(1);
      let consume = 31;
      if (blob.length - cursor.position < 31)
        consume = blob.length - cursor.position;
      for (const _ in Array.from({ length: consume })) {
        const byte = cursor.readByte();
        const isTerminator = byte === 128 && !cursor.inspectBytes(cursor.remaining).includes(128);
        if (isTerminator) {
          active = false;
          break;
        }
        data.pushByte(byte);
      }
    }
  }
  const trimmedData = data.bytes.slice(0, data.position);
  return to_ === "Hex" ? fromBytes(trimmedData) : trimmedData;
}
function toHex7(blobs) {
  return to2(blobs, "Hex");
}
function toBytes8(blobs) {
  return to2(blobs, "Bytes");
}
function toCommitments(blobs, options) {
  const { kzg } = options;
  const as = options.as ?? (typeof blobs[0] === "string" ? "Hex" : "Bytes");
  const blobs_ = typeof blobs[0] === "string" ? blobs.map((x) => fromHex(x)) : blobs;
  const commitments = [];
  for (const blob of blobs_)
    commitments.push(Uint8Array.from(kzg.blobToKzgCommitment(blob)));
  return as === "Bytes" ? commitments : commitments.map((x) => fromBytes(x));
}
function toProofs(blobs, options) {
  const { kzg } = options;
  const as = options.as ?? (typeof blobs[0] === "string" ? "Hex" : "Bytes");
  const blobs_ = typeof blobs[0] === "string" ? blobs.map((x) => fromHex(x)) : blobs;
  const commitments = typeof options.commitments[0] === "string" ? options.commitments.map((x) => fromHex(x)) : options.commitments;
  const proofs = [];
  for (let i = 0; i < blobs_.length; i++) {
    const blob = blobs_[i];
    const commitment = commitments[i];
    proofs.push(Uint8Array.from(kzg.computeBlobKzgProof(blob, commitment)));
  }
  return as === "Bytes" ? proofs : proofs.map((x) => fromBytes(x));
}
function toSidecars(blobs, options) {
  const { kzg } = options;
  const commitments = options.commitments ?? toCommitments(blobs, { kzg });
  const proofs = options.proofs ?? toProofs(blobs, { commitments, kzg });
  const sidecars = [];
  for (let i = 0; i < blobs.length; i++)
    sidecars.push({
      blob: blobs[i],
      commitment: commitments[i],
      proof: proofs[i]
    });
  return sidecars;
}
function toVersionedHashes(blobs, options) {
  const commitments = toCommitments(blobs, options);
  return commitmentsToVersionedHashes(commitments, options);
}
var BlobSizeTooLargeError = class extends BaseError {
  constructor({ maxSize, size: size4 }) {
    super("Blob size is too large.", {
      metaMessages: [`Max: ${maxSize} bytes`, `Given: ${size4} bytes`]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Blobs.BlobSizeTooLargeError"
    });
  }
};
var EmptyBlobError = class extends BaseError {
  constructor() {
    super("Blob data must not be empty.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Blobs.EmptyBlobError"
    });
  }
};
var EmptyBlobVersionedHashesError = class extends BaseError {
  constructor() {
    super("Blob versioned hashes must not be empty.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Blobs.EmptyBlobVersionedHashesError"
    });
  }
};
var InvalidVersionedHashSizeError = class extends BaseError {
  constructor({ hash: hash8, size: size4 }) {
    super(`Versioned hash "${hash8}" size is invalid.`, {
      metaMessages: ["Expected: 32", `Received: ${size4}`]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Blobs.InvalidVersionedHashSizeError"
    });
  }
};
var InvalidVersionedHashVersionError = class extends BaseError {
  constructor({ hash: hash8, version: version2 }) {
    super(`Versioned hash "${hash8}" version is invalid.`, {
      metaMessages: [
        `Expected: ${versionedHashVersion}`,
        `Received: ${version2}`
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Blobs.InvalidVersionedHashVersionError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Block.js
var Block_exports = {};
__export(Block_exports, {
  fromRpc: () => fromRpc5,
  toRpc: () => toRpc5
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Transaction.js
var Transaction_exports = {};
__export(Transaction_exports, {
  fromRpc: () => fromRpc3,
  fromRpcType: () => fromRpcType,
  toRpc: () => toRpc3,
  toRpcType: () => toRpcType
});
var toRpcType = {
  legacy: "0x0",
  eip2930: "0x1",
  eip1559: "0x2",
  eip4844: "0x3",
  eip7702: "0x4"
};
var fromRpcType = {
  "0x0": "legacy",
  "0x1": "eip2930",
  "0x2": "eip1559",
  "0x3": "eip4844",
  "0x4": "eip7702"
};
function fromRpc3(transaction, _options = {}) {
  if (!transaction)
    return null;
  const signature = extract(transaction);
  const transaction_ = {
    ...transaction,
    ...signature
  };
  transaction_.blockNumber = transaction.blockNumber ? BigInt(transaction.blockNumber) : null;
  transaction_.data = transaction.input;
  transaction_.gas = BigInt(transaction.gas ?? 0n);
  transaction_.nonce = BigInt(transaction.nonce ?? 0n);
  transaction_.transactionIndex = transaction.transactionIndex ? Number(transaction.transactionIndex) : null;
  transaction_.value = BigInt(transaction.value ?? 0n);
  if (transaction.authorizationList)
    transaction_.authorizationList = fromRpcList(transaction.authorizationList);
  if (transaction.chainId)
    transaction_.chainId = Number(transaction.chainId);
  if (transaction.gasPrice)
    transaction_.gasPrice = BigInt(transaction.gasPrice);
  if (transaction.maxFeePerBlobGas)
    transaction_.maxFeePerBlobGas = BigInt(transaction.maxFeePerBlobGas);
  if (transaction.maxFeePerGas)
    transaction_.maxFeePerGas = BigInt(transaction.maxFeePerGas);
  if (transaction.maxPriorityFeePerGas)
    transaction_.maxPriorityFeePerGas = BigInt(transaction.maxPriorityFeePerGas);
  if (transaction.type)
    transaction_.type = fromRpcType[transaction.type] ?? transaction.type;
  if (signature)
    transaction_.v = yParityToV(signature.yParity);
  return transaction_;
}
function toRpc3(transaction, _options) {
  const rpc = {};
  rpc.blockHash = transaction.blockHash;
  rpc.blockNumber = typeof transaction.blockNumber === "bigint" ? fromNumber(transaction.blockNumber) : null;
  rpc.from = transaction.from;
  rpc.gas = fromNumber(transaction.gas ?? 0n);
  rpc.hash = transaction.hash;
  rpc.input = transaction.input;
  rpc.nonce = fromNumber(transaction.nonce ?? 0n);
  rpc.to = transaction.to;
  rpc.transactionIndex = transaction.transactionIndex ? fromNumber(transaction.transactionIndex) : null;
  rpc.type = toRpcType[transaction.type] ?? transaction.type;
  rpc.value = fromNumber(transaction.value ?? 0n);
  if (transaction.accessList)
    rpc.accessList = transaction.accessList;
  if (transaction.authorizationList)
    rpc.authorizationList = toRpcList(transaction.authorizationList);
  if (transaction.blobVersionedHashes)
    rpc.blobVersionedHashes = transaction.blobVersionedHashes;
  if (transaction.chainId)
    rpc.chainId = fromNumber(transaction.chainId);
  if (typeof transaction.gasPrice === "bigint")
    rpc.gasPrice = fromNumber(transaction.gasPrice);
  if (typeof transaction.maxFeePerBlobGas === "bigint")
    rpc.maxFeePerBlobGas = fromNumber(transaction.maxFeePerBlobGas);
  if (typeof transaction.maxFeePerGas === "bigint")
    rpc.maxFeePerGas = fromNumber(transaction.maxFeePerGas);
  if (typeof transaction.maxPriorityFeePerGas === "bigint")
    rpc.maxPriorityFeePerGas = fromNumber(transaction.maxPriorityFeePerGas);
  if (typeof transaction.r === "bigint")
    rpc.r = fromNumber(transaction.r, { size: 32 });
  if (typeof transaction.s === "bigint")
    rpc.s = fromNumber(transaction.s, { size: 32 });
  if (typeof transaction.v === "number")
    rpc.v = fromNumber(transaction.v, { size: 1 });
  if (typeof transaction.yParity === "number")
    rpc.yParity = transaction.yParity === 0 ? "0x0" : "0x1";
  return rpc;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Withdrawal.js
var Withdrawal_exports = {};
__export(Withdrawal_exports, {
  fromRpc: () => fromRpc4,
  toRpc: () => toRpc4
});
function fromRpc4(withdrawal) {
  return {
    ...withdrawal,
    amount: BigInt(withdrawal.amount),
    index: Number(withdrawal.index),
    validatorIndex: Number(withdrawal.validatorIndex)
  };
}
function toRpc4(withdrawal) {
  return {
    address: withdrawal.address,
    amount: fromNumber(withdrawal.amount),
    index: fromNumber(withdrawal.index),
    validatorIndex: fromNumber(withdrawal.validatorIndex)
  };
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Block.js
function toRpc5(block, _options = {}) {
  const transactions = block.transactions.map((transaction) => {
    if (typeof transaction === "string")
      return transaction;
    return toRpc3(transaction);
  });
  return {
    baseFeePerGas: typeof block.baseFeePerGas === "bigint" ? fromNumber(block.baseFeePerGas) : void 0,
    blobGasUsed: typeof block.blobGasUsed === "bigint" ? fromNumber(block.blobGasUsed) : void 0,
    excessBlobGas: typeof block.excessBlobGas === "bigint" ? fromNumber(block.excessBlobGas) : void 0,
    extraData: block.extraData,
    difficulty: typeof block.difficulty === "bigint" ? fromNumber(block.difficulty) : void 0,
    gasLimit: fromNumber(block.gasLimit),
    gasUsed: fromNumber(block.gasUsed),
    hash: block.hash,
    logsBloom: block.logsBloom,
    miner: block.miner,
    mixHash: block.mixHash,
    nonce: block.nonce,
    number: typeof block.number === "bigint" ? fromNumber(block.number) : null,
    parentBeaconBlockRoot: block.parentBeaconBlockRoot,
    parentHash: block.parentHash,
    receiptsRoot: block.receiptsRoot,
    sealFields: block.sealFields,
    sha3Uncles: block.sha3Uncles,
    size: fromNumber(block.size),
    stateRoot: block.stateRoot,
    timestamp: fromNumber(block.timestamp),
    totalDifficulty: typeof block.totalDifficulty === "bigint" ? fromNumber(block.totalDifficulty) : void 0,
    transactions,
    transactionsRoot: block.transactionsRoot,
    uncles: block.uncles,
    withdrawals: block.withdrawals?.map(toRpc4),
    withdrawalsRoot: block.withdrawalsRoot
  };
}
function fromRpc5(block, _options = {}) {
  if (!block)
    return null;
  const transactions = block.transactions.map((transaction) => {
    if (typeof transaction === "string")
      return transaction;
    return fromRpc3(transaction);
  });
  return {
    ...block,
    baseFeePerGas: block.baseFeePerGas ? BigInt(block.baseFeePerGas) : void 0,
    blobGasUsed: block.blobGasUsed ? BigInt(block.blobGasUsed) : void 0,
    difficulty: block.difficulty ? BigInt(block.difficulty) : void 0,
    excessBlobGas: block.excessBlobGas ? BigInt(block.excessBlobGas) : void 0,
    gasLimit: BigInt(block.gasLimit ?? 0n),
    gasUsed: BigInt(block.gasUsed ?? 0n),
    number: block.number ? BigInt(block.number) : null,
    size: BigInt(block.size ?? 0n),
    stateRoot: block.stateRoot,
    timestamp: BigInt(block.timestamp ?? 0n),
    totalDifficulty: BigInt(block.totalDifficulty ?? 0n),
    transactions,
    withdrawals: block.withdrawals?.map(fromRpc4)
  };
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/BlockOverrides.js
var BlockOverrides_exports = {};
__export(BlockOverrides_exports, {
  fromRpc: () => fromRpc6,
  toRpc: () => toRpc6
});
function fromRpc6(rpcBlockOverrides) {
  return {
    ...rpcBlockOverrides.baseFeePerGas && {
      baseFeePerGas: BigInt(rpcBlockOverrides.baseFeePerGas)
    },
    ...rpcBlockOverrides.blobBaseFee && {
      blobBaseFee: BigInt(rpcBlockOverrides.blobBaseFee)
    },
    ...rpcBlockOverrides.feeRecipient && {
      feeRecipient: rpcBlockOverrides.feeRecipient
    },
    ...rpcBlockOverrides.gasLimit && {
      gasLimit: BigInt(rpcBlockOverrides.gasLimit)
    },
    ...rpcBlockOverrides.number && {
      number: BigInt(rpcBlockOverrides.number)
    },
    ...rpcBlockOverrides.prevRandao && {
      prevRandao: BigInt(rpcBlockOverrides.prevRandao)
    },
    ...rpcBlockOverrides.time && {
      time: BigInt(rpcBlockOverrides.time)
    },
    ...rpcBlockOverrides.withdrawals && {
      withdrawals: rpcBlockOverrides.withdrawals.map(fromRpc4)
    }
  };
}
function toRpc6(blockOverrides) {
  return {
    ...typeof blockOverrides.baseFeePerGas === "bigint" && {
      baseFeePerGas: fromNumber(blockOverrides.baseFeePerGas)
    },
    ...typeof blockOverrides.blobBaseFee === "bigint" && {
      blobBaseFee: fromNumber(blockOverrides.blobBaseFee)
    },
    ...typeof blockOverrides.feeRecipient === "string" && {
      feeRecipient: blockOverrides.feeRecipient
    },
    ...typeof blockOverrides.gasLimit === "bigint" && {
      gasLimit: fromNumber(blockOverrides.gasLimit)
    },
    ...typeof blockOverrides.number === "bigint" && {
      number: fromNumber(blockOverrides.number)
    },
    ...typeof blockOverrides.prevRandao === "bigint" && {
      prevRandao: fromNumber(blockOverrides.prevRandao)
    },
    ...typeof blockOverrides.time === "bigint" && {
      time: fromNumber(blockOverrides.time)
    },
    ...blockOverrides.withdrawals && {
      withdrawals: blockOverrides.withdrawals.map(toRpc4)
    }
  };
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Bloom.js
var Bloom_exports = {};
__export(Bloom_exports, {
  contains: () => contains,
  validate: () => validate7
});
function contains(bloom, input) {
  const filter = fromHex(bloom);
  const hash8 = keccak256(input, { as: "Bytes" });
  for (const i of [0, 2, 4]) {
    const bit = hash8[i + 1] + (hash8[i] << 8) & 2047;
    if ((filter[256 - 1 - Math.floor(bit / 8)] & 1 << bit % 8) === 0)
      return false;
  }
  return true;
}
function validate7(value) {
  return validate(value) && size2(value) === 256;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Bls.js
var Bls_exports = {};
__export(Bls_exports, {
  aggregate: () => aggregate,
  createKeyPair: () => createKeyPair,
  getPublicKey: () => getPublicKey,
  noble: () => noble,
  randomPrivateKey: () => randomPrivateKey,
  sign: () => sign,
  verify: () => verify
});

// node_modules/@noble/curves/esm/abstract/bls.js
var _0n = BigInt(0);
var _1n = BigInt(1);
var _2n = BigInt(2);
var _3n = BigInt(3);
function NAfDecomposition(a) {
  const res = [];
  for (; a > _1n; a >>= _1n) {
    if ((a & _1n) === _0n)
      res.unshift(0);
    else if ((a & _3n) === _3n) {
      res.unshift(-1);
      a += _1n;
    } else
      res.unshift(1);
  }
  return res;
}
function bls(CURVE) {
  const { Fp: Fp4, Fr: Fr2, Fp2: Fp22, Fp6: Fp62, Fp12: Fp122 } = CURVE.fields;
  const BLS_X_IS_NEGATIVE = CURVE.params.xNegative;
  const TWIST = CURVE.params.twistType;
  const G1_ = weierstrassPoints({ n: Fr2.ORDER, ...CURVE.G1 });
  const G1 = Object.assign(G1_, createHasher(G1_.ProjectivePoint, CURVE.G1.mapToCurve, {
    ...CURVE.htfDefaults,
    ...CURVE.G1.htfDefaults
  }));
  const G2_ = weierstrassPoints({ n: Fr2.ORDER, ...CURVE.G2 });
  const G2 = Object.assign(G2_, createHasher(G2_.ProjectivePoint, CURVE.G2.mapToCurve, {
    ...CURVE.htfDefaults,
    ...CURVE.G2.htfDefaults
  }));
  let lineFunction;
  if (TWIST === "multiplicative") {
    lineFunction = (c0, c1, c2, f, Px, Py) => Fp122.mul014(f, c0, Fp22.mul(c1, Px), Fp22.mul(c2, Py));
  } else if (TWIST === "divisive") {
    lineFunction = (c0, c1, c2, f, Px, Py) => Fp122.mul034(f, Fp22.mul(c2, Py), Fp22.mul(c1, Px), c0);
  } else
    throw new Error("bls: unknown twist type");
  const Fp2div2 = Fp22.div(Fp22.ONE, Fp22.mul(Fp22.ONE, _2n));
  function pointDouble(ell, Rx, Ry, Rz) {
    const t0 = Fp22.sqr(Ry);
    const t1 = Fp22.sqr(Rz);
    const t2 = Fp22.mulByB(Fp22.mul(t1, _3n));
    const t3 = Fp22.mul(t2, _3n);
    const t4 = Fp22.sub(Fp22.sub(Fp22.sqr(Fp22.add(Ry, Rz)), t1), t0);
    const c0 = Fp22.sub(t2, t0);
    const c1 = Fp22.mul(Fp22.sqr(Rx), _3n);
    const c2 = Fp22.neg(t4);
    ell.push([c0, c1, c2]);
    Rx = Fp22.mul(Fp22.mul(Fp22.mul(Fp22.sub(t0, t3), Rx), Ry), Fp2div2);
    Ry = Fp22.sub(Fp22.sqr(Fp22.mul(Fp22.add(t0, t3), Fp2div2)), Fp22.mul(Fp22.sqr(t2), _3n));
    Rz = Fp22.mul(t0, t4);
    return { Rx, Ry, Rz };
  }
  function pointAdd(ell, Rx, Ry, Rz, Qx, Qy) {
    const t0 = Fp22.sub(Ry, Fp22.mul(Qy, Rz));
    const t1 = Fp22.sub(Rx, Fp22.mul(Qx, Rz));
    const c0 = Fp22.sub(Fp22.mul(t0, Qx), Fp22.mul(t1, Qy));
    const c1 = Fp22.neg(t0);
    const c2 = t1;
    ell.push([c0, c1, c2]);
    const t2 = Fp22.sqr(t1);
    const t3 = Fp22.mul(t2, t1);
    const t4 = Fp22.mul(t2, Rx);
    const t5 = Fp22.add(Fp22.sub(t3, Fp22.mul(t4, _2n)), Fp22.mul(Fp22.sqr(t0), Rz));
    Rx = Fp22.mul(t1, t5);
    Ry = Fp22.sub(Fp22.mul(Fp22.sub(t4, t5), t0), Fp22.mul(t3, Ry));
    Rz = Fp22.mul(Rz, t3);
    return { Rx, Ry, Rz };
  }
  const ATE_NAF = NAfDecomposition(CURVE.params.ateLoopSize);
  const calcPairingPrecomputes = memoized((point) => {
    const p = point;
    const { x, y } = p.toAffine();
    const Qx = x, Qy = y, negQy = Fp22.neg(y);
    let Rx = Qx, Ry = Qy, Rz = Fp22.ONE;
    const ell = [];
    for (const bit of ATE_NAF) {
      const cur = [];
      ({ Rx, Ry, Rz } = pointDouble(cur, Rx, Ry, Rz));
      if (bit)
        ({ Rx, Ry, Rz } = pointAdd(cur, Rx, Ry, Rz, Qx, bit === -1 ? negQy : Qy));
      ell.push(cur);
    }
    if (CURVE.postPrecompute) {
      const last = ell[ell.length - 1];
      CURVE.postPrecompute(Rx, Ry, Rz, Qx, Qy, pointAdd.bind(null, last));
    }
    return ell;
  });
  function millerLoopBatch(pairs, withFinalExponent = false) {
    let f12 = Fp122.ONE;
    if (pairs.length) {
      const ellLen = pairs[0][0].length;
      for (let i = 0; i < ellLen; i++) {
        f12 = Fp122.sqr(f12);
        for (const [ell, Px, Py] of pairs) {
          for (const [c0, c1, c2] of ell[i])
            f12 = lineFunction(c0, c1, c2, f12, Px, Py);
        }
      }
    }
    if (BLS_X_IS_NEGATIVE)
      f12 = Fp122.conjugate(f12);
    return withFinalExponent ? Fp122.finalExponentiate(f12) : f12;
  }
  function pairingBatch(pairs, withFinalExponent = true) {
    const res = [];
    G1.ProjectivePoint.normalizeZ(pairs.map(({ g1 }) => g1));
    G2.ProjectivePoint.normalizeZ(pairs.map(({ g2 }) => g2));
    for (const { g1, g2 } of pairs) {
      if (g1.equals(G1.ProjectivePoint.ZERO) || g2.equals(G2.ProjectivePoint.ZERO))
        throw new Error("pairing is not available for ZERO point");
      g1.assertValidity();
      g2.assertValidity();
      const Qa = g1.toAffine();
      res.push([calcPairingPrecomputes(g2), Qa.x, Qa.y]);
    }
    return millerLoopBatch(res, withFinalExponent);
  }
  function pairing(Q, P, withFinalExponent = true) {
    return pairingBatch([{ g1: Q, g2: P }], withFinalExponent);
  }
  const utils2 = {
    randomPrivateKey: () => {
      const length = getMinHashLength(Fr2.ORDER);
      return mapHashToField(CURVE.randomBytes(length), Fr2.ORDER);
    },
    calcPairingPrecomputes
  };
  const { ShortSignature } = CURVE.G1;
  const { Signature } = CURVE.G2;
  function normP1(point) {
    return point instanceof G1.ProjectivePoint ? point : G1.ProjectivePoint.fromHex(point);
  }
  function normP1Hash(point, htfOpts) {
    return point instanceof G1.ProjectivePoint ? point : G1.hashToCurve(ensureBytes("point", point), htfOpts);
  }
  function normP2(point) {
    return point instanceof G2.ProjectivePoint ? point : Signature.fromHex(point);
  }
  function normP2Hash(point, htfOpts) {
    return point instanceof G2.ProjectivePoint ? point : G2.hashToCurve(ensureBytes("point", point), htfOpts);
  }
  function getPublicKey6(privateKey) {
    return G1.ProjectivePoint.fromPrivateKey(privateKey).toRawBytes(true);
  }
  function getPublicKeyForShortSignatures(privateKey) {
    return G2.ProjectivePoint.fromPrivateKey(privateKey).toRawBytes(true);
  }
  function sign7(message, privateKey, htfOpts) {
    const msgPoint = normP2Hash(message, htfOpts);
    msgPoint.assertValidity();
    const sigPoint = msgPoint.multiply(G1.normPrivateKeyToScalar(privateKey));
    if (message instanceof G2.ProjectivePoint)
      return sigPoint;
    return Signature.toRawBytes(sigPoint);
  }
  function signShortSignature(message, privateKey, htfOpts) {
    const msgPoint = normP1Hash(message, htfOpts);
    msgPoint.assertValidity();
    const sigPoint = msgPoint.multiply(G1.normPrivateKeyToScalar(privateKey));
    if (message instanceof G1.ProjectivePoint)
      return sigPoint;
    return ShortSignature.toRawBytes(sigPoint);
  }
  function verify7(signature, message, publicKey, htfOpts) {
    const P = normP1(publicKey);
    const Hm = normP2Hash(message, htfOpts);
    const G = G1.ProjectivePoint.BASE;
    const S = normP2(signature);
    const exp = pairingBatch([
      { g1: P.negate(), g2: Hm },
      // ePHM = pairing(P.negate(), Hm, false);
      { g1: G, g2: S }
      // eGS = pairing(G, S, false);
    ]);
    return Fp122.eql(exp, Fp122.ONE);
  }
  function verifyShortSignature(signature, message, publicKey, htfOpts) {
    const P = normP2(publicKey);
    const Hm = normP1Hash(message, htfOpts);
    const G = G2.ProjectivePoint.BASE;
    const S = normP1(signature);
    const exp = pairingBatch([
      { g1: Hm, g2: P },
      // eHmP = pairing(Hm, P, false);
      { g1: S, g2: G.negate() }
      // eSG = pairing(S, G.negate(), false);
    ]);
    return Fp122.eql(exp, Fp122.ONE);
  }
  function aNonEmpty(arr) {
    if (!Array.isArray(arr) || arr.length === 0)
      throw new Error("expected non-empty array");
  }
  function aggregatePublicKeys(publicKeys) {
    aNonEmpty(publicKeys);
    const agg = publicKeys.map(normP1).reduce((sum, p) => sum.add(p), G1.ProjectivePoint.ZERO);
    const aggAffine = agg;
    if (publicKeys[0] instanceof G1.ProjectivePoint) {
      aggAffine.assertValidity();
      return aggAffine;
    }
    return aggAffine.toRawBytes(true);
  }
  function aggregateSignatures(signatures) {
    aNonEmpty(signatures);
    const agg = signatures.map(normP2).reduce((sum, s) => sum.add(s), G2.ProjectivePoint.ZERO);
    const aggAffine = agg;
    if (signatures[0] instanceof G2.ProjectivePoint) {
      aggAffine.assertValidity();
      return aggAffine;
    }
    return Signature.toRawBytes(aggAffine);
  }
  function aggregateShortSignatures(signatures) {
    aNonEmpty(signatures);
    const agg = signatures.map(normP1).reduce((sum, s) => sum.add(s), G1.ProjectivePoint.ZERO);
    const aggAffine = agg;
    if (signatures[0] instanceof G1.ProjectivePoint) {
      aggAffine.assertValidity();
      return aggAffine;
    }
    return ShortSignature.toRawBytes(aggAffine);
  }
  function verifyBatch(signature, messages, publicKeys, htfOpts) {
    aNonEmpty(messages);
    if (publicKeys.length !== messages.length)
      throw new Error("amount of public keys and messages should be equal");
    const sig = normP2(signature);
    const nMessages = messages.map((i) => normP2Hash(i, htfOpts));
    const nPublicKeys = publicKeys.map(normP1);
    const messagePubKeyMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < nPublicKeys.length; i++) {
      const pub = nPublicKeys[i];
      const msg = nMessages[i];
      let keys = messagePubKeyMap.get(msg);
      if (keys === void 0) {
        keys = [];
        messagePubKeyMap.set(msg, keys);
      }
      keys.push(pub);
    }
    const paired = [];
    try {
      for (const [msg, keys] of messagePubKeyMap) {
        const groupPublicKey = keys.reduce((acc, msg2) => acc.add(msg2));
        paired.push({ g1: groupPublicKey, g2: msg });
      }
      paired.push({ g1: G1.ProjectivePoint.BASE.negate(), g2: sig });
      return Fp122.eql(pairingBatch(paired), Fp122.ONE);
    } catch {
      return false;
    }
  }
  G1.ProjectivePoint.BASE._setWindowSize(4);
  return {
    getPublicKey: getPublicKey6,
    getPublicKeyForShortSignatures,
    sign: sign7,
    signShortSignature,
    verify: verify7,
    verifyBatch,
    verifyShortSignature,
    aggregatePublicKeys,
    aggregateSignatures,
    aggregateShortSignatures,
    millerLoopBatch,
    pairing,
    pairingBatch,
    G1,
    G2,
    Signature,
    ShortSignature,
    fields: {
      Fr: Fr2,
      Fp: Fp4,
      Fp2: Fp22,
      Fp6: Fp62,
      Fp12: Fp122
    },
    params: {
      ateLoopSize: CURVE.params.ateLoopSize,
      r: CURVE.params.r,
      G1b: CURVE.G1.b,
      G2b: CURVE.G2.b
    },
    utils: utils2
  };
}

// node_modules/@noble/curves/esm/abstract/tower.js
var _0n2 = BigInt(0);
var _1n2 = BigInt(1);
var _2n2 = BigInt(2);
var _3n2 = BigInt(3);
function calcFrobeniusCoefficients(Fp4, nonResidue, modulus, degree, num = 1, divisor) {
  const _divisor = BigInt(divisor === void 0 ? degree : divisor);
  const towerModulus = modulus ** BigInt(degree);
  const res = [];
  for (let i = 0; i < num; i++) {
    const a = BigInt(i + 1);
    const powers = [];
    for (let j = 0, qPower = _1n2; j < degree; j++) {
      const power = (a * qPower - a) / _divisor % towerModulus;
      powers.push(Fp4.pow(nonResidue, power));
      qPower *= modulus;
    }
    res.push(powers);
  }
  return res;
}
function psiFrobenius(Fp4, Fp22, base) {
  const PSI_X = Fp22.pow(base, (Fp4.ORDER - _1n2) / _3n2);
  const PSI_Y = Fp22.pow(base, (Fp4.ORDER - _1n2) / _2n2);
  function psi(x, y) {
    const x2 = Fp22.mul(Fp22.frobeniusMap(x, 1), PSI_X);
    const y2 = Fp22.mul(Fp22.frobeniusMap(y, 1), PSI_Y);
    return [x2, y2];
  }
  const PSI2_X = Fp22.pow(base, (Fp4.ORDER ** _2n2 - _1n2) / _3n2);
  const PSI2_Y = Fp22.pow(base, (Fp4.ORDER ** _2n2 - _1n2) / _2n2);
  if (!Fp22.eql(PSI2_Y, Fp22.neg(Fp22.ONE)))
    throw new Error("psiFrobenius: PSI2_Y!==-1");
  function psi2(x, y) {
    return [Fp22.mul(x, PSI2_X), Fp22.neg(y)];
  }
  const mapAffine = (fn) => (c, P) => {
    const affine = P.toAffine();
    const p = fn(affine.x, affine.y);
    return c.fromAffine({ x: p[0], y: p[1] });
  };
  const G2psi3 = mapAffine(psi);
  const G2psi22 = mapAffine(psi2);
  return { psi, psi2, G2psi: G2psi3, G2psi2: G2psi22, PSI_X, PSI_Y, PSI2_X, PSI2_Y };
}
function tower12(opts) {
  const { ORDER } = opts;
  const Fp4 = Field(ORDER);
  const FpNONRESIDUE = Fp4.create(opts.NONRESIDUE || BigInt(-1));
  const Fpdiv2 = Fp4.div(Fp4.ONE, _2n2);
  const FP2_FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp4, FpNONRESIDUE, Fp4.ORDER, 2)[0];
  const Fp2Add = ({ c0, c1 }, { c0: r0, c1: r1 }) => ({
    c0: Fp4.add(c0, r0),
    c1: Fp4.add(c1, r1)
  });
  const Fp2Subtract = ({ c0, c1 }, { c0: r0, c1: r1 }) => ({
    c0: Fp4.sub(c0, r0),
    c1: Fp4.sub(c1, r1)
  });
  const Fp2Multiply = ({ c0, c1 }, rhs) => {
    if (typeof rhs === "bigint")
      return { c0: Fp4.mul(c0, rhs), c1: Fp4.mul(c1, rhs) };
    const { c0: r0, c1: r1 } = rhs;
    let t1 = Fp4.mul(c0, r0);
    let t2 = Fp4.mul(c1, r1);
    const o0 = Fp4.sub(t1, t2);
    const o1 = Fp4.sub(Fp4.mul(Fp4.add(c0, c1), Fp4.add(r0, r1)), Fp4.add(t1, t2));
    return { c0: o0, c1: o1 };
  };
  const Fp2Square = ({ c0, c1 }) => {
    const a = Fp4.add(c0, c1);
    const b = Fp4.sub(c0, c1);
    const c = Fp4.add(c0, c0);
    return { c0: Fp4.mul(a, b), c1: Fp4.mul(c, c1) };
  };
  const Fp2fromBigTuple = (tuple) => {
    if (tuple.length !== 2)
      throw new Error("invalid tuple");
    const fps = tuple.map((n) => Fp4.create(n));
    return { c0: fps[0], c1: fps[1] };
  };
  const FP2_ORDER = ORDER * ORDER;
  const Fp2Nonresidue = Fp2fromBigTuple(opts.FP2_NONRESIDUE);
  const Fp22 = {
    ORDER: FP2_ORDER,
    isLE: Fp4.isLE,
    NONRESIDUE: Fp2Nonresidue,
    BITS: bitLen(FP2_ORDER),
    BYTES: Math.ceil(bitLen(FP2_ORDER) / 8),
    MASK: bitMask(bitLen(FP2_ORDER)),
    ZERO: { c0: Fp4.ZERO, c1: Fp4.ZERO },
    ONE: { c0: Fp4.ONE, c1: Fp4.ZERO },
    create: (num) => num,
    isValid: ({ c0, c1 }) => typeof c0 === "bigint" && typeof c1 === "bigint",
    is0: ({ c0, c1 }) => Fp4.is0(c0) && Fp4.is0(c1),
    eql: ({ c0, c1 }, { c0: r0, c1: r1 }) => Fp4.eql(c0, r0) && Fp4.eql(c1, r1),
    neg: ({ c0, c1 }) => ({ c0: Fp4.neg(c0), c1: Fp4.neg(c1) }),
    pow: (num, power) => FpPow(Fp22, num, power),
    invertBatch: (nums) => FpInvertBatch(Fp22, nums),
    // Normalized
    add: Fp2Add,
    sub: Fp2Subtract,
    mul: Fp2Multiply,
    sqr: Fp2Square,
    // NonNormalized stuff
    addN: Fp2Add,
    subN: Fp2Subtract,
    mulN: Fp2Multiply,
    sqrN: Fp2Square,
    // Why inversion for bigint inside Fp instead of Fp2? it is even used in that context?
    div: (lhs, rhs) => Fp22.mul(lhs, typeof rhs === "bigint" ? Fp4.inv(Fp4.create(rhs)) : Fp22.inv(rhs)),
    inv: ({ c0: a, c1: b }) => {
      const factor = Fp4.inv(Fp4.create(a * a + b * b));
      return { c0: Fp4.mul(factor, Fp4.create(a)), c1: Fp4.mul(factor, Fp4.create(-b)) };
    },
    sqrt: (num) => {
      if (opts.Fp2sqrt)
        return opts.Fp2sqrt(num);
      const { c0, c1 } = num;
      if (Fp4.is0(c1)) {
        if (FpLegendre(Fp4, c0) === 1)
          return Fp22.create({ c0: Fp4.sqrt(c0), c1: Fp4.ZERO });
        else
          return Fp22.create({ c0: Fp4.ZERO, c1: Fp4.sqrt(Fp4.div(c0, FpNONRESIDUE)) });
      }
      const a = Fp4.sqrt(Fp4.sub(Fp4.sqr(c0), Fp4.mul(Fp4.sqr(c1), FpNONRESIDUE)));
      let d = Fp4.mul(Fp4.add(a, c0), Fpdiv2);
      const legendre = FpLegendre(Fp4, d);
      if (legendre === -1)
        d = Fp4.sub(d, a);
      const a0 = Fp4.sqrt(d);
      const candidateSqrt = Fp22.create({ c0: a0, c1: Fp4.div(Fp4.mul(c1, Fpdiv2), a0) });
      if (!Fp22.eql(Fp22.sqr(candidateSqrt), num))
        throw new Error("Cannot find square root");
      const x1 = candidateSqrt;
      const x2 = Fp22.neg(x1);
      const { re: re1, im: im1 } = Fp22.reim(x1);
      const { re: re2, im: im2 } = Fp22.reim(x2);
      if (im1 > im2 || im1 === im2 && re1 > re2)
        return x1;
      return x2;
    },
    // Same as sgn0_m_eq_2 in RFC 9380
    isOdd: (x) => {
      const { re: x0, im: x1 } = Fp22.reim(x);
      const sign_0 = x0 % _2n2;
      const zero_0 = x0 === _0n2;
      const sign_1 = x1 % _2n2;
      return BigInt(sign_0 || zero_0 && sign_1) == _1n2;
    },
    // Bytes util
    fromBytes(b) {
      if (b.length !== Fp22.BYTES)
        throw new Error("fromBytes invalid length=" + b.length);
      return { c0: Fp4.fromBytes(b.subarray(0, Fp4.BYTES)), c1: Fp4.fromBytes(b.subarray(Fp4.BYTES)) };
    },
    toBytes: ({ c0, c1 }) => concatBytes(Fp4.toBytes(c0), Fp4.toBytes(c1)),
    cmov: ({ c0, c1 }, { c0: r0, c1: r1 }, c) => ({
      c0: Fp4.cmov(c0, r0, c),
      c1: Fp4.cmov(c1, r1, c)
    }),
    reim: ({ c0, c1 }) => ({ re: c0, im: c1 }),
    // multiply by u + 1
    mulByNonresidue: ({ c0, c1 }) => Fp22.mul({ c0, c1 }, Fp2Nonresidue),
    mulByB: opts.Fp2mulByB,
    fromBigTuple: Fp2fromBigTuple,
    frobeniusMap: ({ c0, c1 }, power) => ({
      c0,
      c1: Fp4.mul(c1, FP2_FROBENIUS_COEFFICIENTS[power % 2])
    })
  };
  const Fp6Add = ({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) => ({
    c0: Fp22.add(c0, r0),
    c1: Fp22.add(c1, r1),
    c2: Fp22.add(c2, r2)
  });
  const Fp6Subtract = ({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) => ({
    c0: Fp22.sub(c0, r0),
    c1: Fp22.sub(c1, r1),
    c2: Fp22.sub(c2, r2)
  });
  const Fp6Multiply = ({ c0, c1, c2 }, rhs) => {
    if (typeof rhs === "bigint") {
      return {
        c0: Fp22.mul(c0, rhs),
        c1: Fp22.mul(c1, rhs),
        c2: Fp22.mul(c2, rhs)
      };
    }
    const { c0: r0, c1: r1, c2: r2 } = rhs;
    const t0 = Fp22.mul(c0, r0);
    const t1 = Fp22.mul(c1, r1);
    const t2 = Fp22.mul(c2, r2);
    return {
      // t0 + (c1 + c2) * (r1 * r2) - (T1 + T2) * (u + 1)
      c0: Fp22.add(t0, Fp22.mulByNonresidue(Fp22.sub(Fp22.mul(Fp22.add(c1, c2), Fp22.add(r1, r2)), Fp22.add(t1, t2)))),
      // (c0 + c1) * (r0 + r1) - (T0 + T1) + T2 * (u + 1)
      c1: Fp22.add(Fp22.sub(Fp22.mul(Fp22.add(c0, c1), Fp22.add(r0, r1)), Fp22.add(t0, t1)), Fp22.mulByNonresidue(t2)),
      // T1 + (c0 + c2) * (r0 + r2) - T0 + T2
      c2: Fp22.sub(Fp22.add(t1, Fp22.mul(Fp22.add(c0, c2), Fp22.add(r0, r2))), Fp22.add(t0, t2))
    };
  };
  const Fp6Square = ({ c0, c1, c2 }) => {
    let t0 = Fp22.sqr(c0);
    let t1 = Fp22.mul(Fp22.mul(c0, c1), _2n2);
    let t3 = Fp22.mul(Fp22.mul(c1, c2), _2n2);
    let t4 = Fp22.sqr(c2);
    return {
      c0: Fp22.add(Fp22.mulByNonresidue(t3), t0),
      // T3 * (u + 1) + T0
      c1: Fp22.add(Fp22.mulByNonresidue(t4), t1),
      // T4 * (u + 1) + T1
      // T1 + (c0 - c1 + c2)² + T3 - T0 - T4
      c2: Fp22.sub(Fp22.sub(Fp22.add(Fp22.add(t1, Fp22.sqr(Fp22.add(Fp22.sub(c0, c1), c2))), t3), t0), t4)
    };
  };
  const [FP6_FROBENIUS_COEFFICIENTS_1, FP6_FROBENIUS_COEFFICIENTS_2] = calcFrobeniusCoefficients(Fp22, Fp2Nonresidue, Fp4.ORDER, 6, 2, 3);
  const Fp62 = {
    ORDER: Fp22.ORDER,
    // TODO: unused, but need to verify
    isLE: Fp22.isLE,
    BITS: 3 * Fp22.BITS,
    BYTES: 3 * Fp22.BYTES,
    MASK: bitMask(3 * Fp22.BITS),
    ZERO: { c0: Fp22.ZERO, c1: Fp22.ZERO, c2: Fp22.ZERO },
    ONE: { c0: Fp22.ONE, c1: Fp22.ZERO, c2: Fp22.ZERO },
    create: (num) => num,
    isValid: ({ c0, c1, c2 }) => Fp22.isValid(c0) && Fp22.isValid(c1) && Fp22.isValid(c2),
    is0: ({ c0, c1, c2 }) => Fp22.is0(c0) && Fp22.is0(c1) && Fp22.is0(c2),
    neg: ({ c0, c1, c2 }) => ({ c0: Fp22.neg(c0), c1: Fp22.neg(c1), c2: Fp22.neg(c2) }),
    eql: ({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }) => Fp22.eql(c0, r0) && Fp22.eql(c1, r1) && Fp22.eql(c2, r2),
    sqrt: notImplemented,
    // Do we need division by bigint at all? Should be done via order:
    div: (lhs, rhs) => Fp62.mul(lhs, typeof rhs === "bigint" ? Fp4.inv(Fp4.create(rhs)) : Fp62.inv(rhs)),
    pow: (num, power) => FpPow(Fp62, num, power),
    invertBatch: (nums) => FpInvertBatch(Fp62, nums),
    // Normalized
    add: Fp6Add,
    sub: Fp6Subtract,
    mul: Fp6Multiply,
    sqr: Fp6Square,
    // NonNormalized stuff
    addN: Fp6Add,
    subN: Fp6Subtract,
    mulN: Fp6Multiply,
    sqrN: Fp6Square,
    inv: ({ c0, c1, c2 }) => {
      let t0 = Fp22.sub(Fp22.sqr(c0), Fp22.mulByNonresidue(Fp22.mul(c2, c1)));
      let t1 = Fp22.sub(Fp22.mulByNonresidue(Fp22.sqr(c2)), Fp22.mul(c0, c1));
      let t2 = Fp22.sub(Fp22.sqr(c1), Fp22.mul(c0, c2));
      let t4 = Fp22.inv(Fp22.add(Fp22.mulByNonresidue(Fp22.add(Fp22.mul(c2, t1), Fp22.mul(c1, t2))), Fp22.mul(c0, t0)));
      return { c0: Fp22.mul(t4, t0), c1: Fp22.mul(t4, t1), c2: Fp22.mul(t4, t2) };
    },
    // Bytes utils
    fromBytes: (b) => {
      if (b.length !== Fp62.BYTES)
        throw new Error("fromBytes invalid length=" + b.length);
      return {
        c0: Fp22.fromBytes(b.subarray(0, Fp22.BYTES)),
        c1: Fp22.fromBytes(b.subarray(Fp22.BYTES, 2 * Fp22.BYTES)),
        c2: Fp22.fromBytes(b.subarray(2 * Fp22.BYTES))
      };
    },
    toBytes: ({ c0, c1, c2 }) => concatBytes(Fp22.toBytes(c0), Fp22.toBytes(c1), Fp22.toBytes(c2)),
    cmov: ({ c0, c1, c2 }, { c0: r0, c1: r1, c2: r2 }, c) => ({
      c0: Fp22.cmov(c0, r0, c),
      c1: Fp22.cmov(c1, r1, c),
      c2: Fp22.cmov(c2, r2, c)
    }),
    fromBigSix: (t) => {
      if (!Array.isArray(t) || t.length !== 6)
        throw new Error("invalid Fp6 usage");
      return {
        c0: Fp22.fromBigTuple(t.slice(0, 2)),
        c1: Fp22.fromBigTuple(t.slice(2, 4)),
        c2: Fp22.fromBigTuple(t.slice(4, 6))
      };
    },
    frobeniusMap: ({ c0, c1, c2 }, power) => ({
      c0: Fp22.frobeniusMap(c0, power),
      c1: Fp22.mul(Fp22.frobeniusMap(c1, power), FP6_FROBENIUS_COEFFICIENTS_1[power % 6]),
      c2: Fp22.mul(Fp22.frobeniusMap(c2, power), FP6_FROBENIUS_COEFFICIENTS_2[power % 6])
    }),
    mulByFp2: ({ c0, c1, c2 }, rhs) => ({
      c0: Fp22.mul(c0, rhs),
      c1: Fp22.mul(c1, rhs),
      c2: Fp22.mul(c2, rhs)
    }),
    mulByNonresidue: ({ c0, c1, c2 }) => ({ c0: Fp22.mulByNonresidue(c2), c1: c0, c2: c1 }),
    // Sparse multiplication
    mul1: ({ c0, c1, c2 }, b1) => ({
      c0: Fp22.mulByNonresidue(Fp22.mul(c2, b1)),
      c1: Fp22.mul(c0, b1),
      c2: Fp22.mul(c1, b1)
    }),
    // Sparse multiplication
    mul01({ c0, c1, c2 }, b0, b1) {
      let t0 = Fp22.mul(c0, b0);
      let t1 = Fp22.mul(c1, b1);
      return {
        // ((c1 + c2) * b1 - T1) * (u + 1) + T0
        c0: Fp22.add(Fp22.mulByNonresidue(Fp22.sub(Fp22.mul(Fp22.add(c1, c2), b1), t1)), t0),
        // (b0 + b1) * (c0 + c1) - T0 - T1
        c1: Fp22.sub(Fp22.sub(Fp22.mul(Fp22.add(b0, b1), Fp22.add(c0, c1)), t0), t1),
        // (c0 + c2) * b0 - T0 + T1
        c2: Fp22.add(Fp22.sub(Fp22.mul(Fp22.add(c0, c2), b0), t0), t1)
      };
    }
  };
  const FP12_FROBENIUS_COEFFICIENTS = calcFrobeniusCoefficients(Fp22, Fp2Nonresidue, Fp4.ORDER, 12, 1, 6)[0];
  const Fp12Add = ({ c0, c1 }, { c0: r0, c1: r1 }) => ({
    c0: Fp62.add(c0, r0),
    c1: Fp62.add(c1, r1)
  });
  const Fp12Subtract = ({ c0, c1 }, { c0: r0, c1: r1 }) => ({
    c0: Fp62.sub(c0, r0),
    c1: Fp62.sub(c1, r1)
  });
  const Fp12Multiply = ({ c0, c1 }, rhs) => {
    if (typeof rhs === "bigint")
      return { c0: Fp62.mul(c0, rhs), c1: Fp62.mul(c1, rhs) };
    let { c0: r0, c1: r1 } = rhs;
    let t1 = Fp62.mul(c0, r0);
    let t2 = Fp62.mul(c1, r1);
    return {
      c0: Fp62.add(t1, Fp62.mulByNonresidue(t2)),
      // T1 + T2 * v
      // (c0 + c1) * (r0 + r1) - (T1 + T2)
      c1: Fp62.sub(Fp62.mul(Fp62.add(c0, c1), Fp62.add(r0, r1)), Fp62.add(t1, t2))
    };
  };
  const Fp12Square = ({ c0, c1 }) => {
    let ab = Fp62.mul(c0, c1);
    return {
      // (c1 * v + c0) * (c0 + c1) - AB - AB * v
      c0: Fp62.sub(Fp62.sub(Fp62.mul(Fp62.add(Fp62.mulByNonresidue(c1), c0), Fp62.add(c0, c1)), ab), Fp62.mulByNonresidue(ab)),
      c1: Fp62.add(ab, ab)
    };
  };
  function Fp4Square2(a, b) {
    const a2 = Fp22.sqr(a);
    const b2 = Fp22.sqr(b);
    return {
      first: Fp22.add(Fp22.mulByNonresidue(b2), a2),
      // b² * Nonresidue + a²
      second: Fp22.sub(Fp22.sub(Fp22.sqr(Fp22.add(a, b)), a2), b2)
      // (a + b)² - a² - b²
    };
  }
  const Fp122 = {
    ORDER: Fp22.ORDER,
    // TODO: unused, but need to verify
    isLE: Fp62.isLE,
    BITS: 2 * Fp62.BITS,
    BYTES: 2 * Fp62.BYTES,
    MASK: bitMask(2 * Fp62.BITS),
    ZERO: { c0: Fp62.ZERO, c1: Fp62.ZERO },
    ONE: { c0: Fp62.ONE, c1: Fp62.ZERO },
    create: (num) => num,
    isValid: ({ c0, c1 }) => Fp62.isValid(c0) && Fp62.isValid(c1),
    is0: ({ c0, c1 }) => Fp62.is0(c0) && Fp62.is0(c1),
    neg: ({ c0, c1 }) => ({ c0: Fp62.neg(c0), c1: Fp62.neg(c1) }),
    eql: ({ c0, c1 }, { c0: r0, c1: r1 }) => Fp62.eql(c0, r0) && Fp62.eql(c1, r1),
    sqrt: notImplemented,
    inv: ({ c0, c1 }) => {
      let t = Fp62.inv(Fp62.sub(Fp62.sqr(c0), Fp62.mulByNonresidue(Fp62.sqr(c1))));
      return { c0: Fp62.mul(c0, t), c1: Fp62.neg(Fp62.mul(c1, t)) };
    },
    div: (lhs, rhs) => Fp122.mul(lhs, typeof rhs === "bigint" ? Fp4.inv(Fp4.create(rhs)) : Fp122.inv(rhs)),
    pow: (num, power) => FpPow(Fp122, num, power),
    invertBatch: (nums) => FpInvertBatch(Fp122, nums),
    // Normalized
    add: Fp12Add,
    sub: Fp12Subtract,
    mul: Fp12Multiply,
    sqr: Fp12Square,
    // NonNormalized stuff
    addN: Fp12Add,
    subN: Fp12Subtract,
    mulN: Fp12Multiply,
    sqrN: Fp12Square,
    // Bytes utils
    fromBytes: (b) => {
      if (b.length !== Fp122.BYTES)
        throw new Error("fromBytes invalid length=" + b.length);
      return {
        c0: Fp62.fromBytes(b.subarray(0, Fp62.BYTES)),
        c1: Fp62.fromBytes(b.subarray(Fp62.BYTES))
      };
    },
    toBytes: ({ c0, c1 }) => concatBytes(Fp62.toBytes(c0), Fp62.toBytes(c1)),
    cmov: ({ c0, c1 }, { c0: r0, c1: r1 }, c) => ({
      c0: Fp62.cmov(c0, r0, c),
      c1: Fp62.cmov(c1, r1, c)
    }),
    // Utils
    // toString() {
    //   return '' + 'Fp12(' + this.c0 + this.c1 + '* w');
    // },
    // fromTuple(c: [Fp6, Fp6]) {
    //   return new Fp12(...c);
    // }
    fromBigTwelve: (t) => ({
      c0: Fp62.fromBigSix(t.slice(0, 6)),
      c1: Fp62.fromBigSix(t.slice(6, 12))
    }),
    // Raises to q**i -th power
    frobeniusMap(lhs, power) {
      const { c0, c1, c2 } = Fp62.frobeniusMap(lhs.c1, power);
      const coeff = FP12_FROBENIUS_COEFFICIENTS[power % 12];
      return {
        c0: Fp62.frobeniusMap(lhs.c0, power),
        c1: Fp62.create({
          c0: Fp22.mul(c0, coeff),
          c1: Fp22.mul(c1, coeff),
          c2: Fp22.mul(c2, coeff)
        })
      };
    },
    mulByFp2: ({ c0, c1 }, rhs) => ({
      c0: Fp62.mulByFp2(c0, rhs),
      c1: Fp62.mulByFp2(c1, rhs)
    }),
    conjugate: ({ c0, c1 }) => ({ c0, c1: Fp62.neg(c1) }),
    // Sparse multiplication
    mul014: ({ c0, c1 }, o0, o1, o4) => {
      let t0 = Fp62.mul01(c0, o0, o1);
      let t1 = Fp62.mul1(c1, o4);
      return {
        c0: Fp62.add(Fp62.mulByNonresidue(t1), t0),
        // T1 * v + T0
        // (c1 + c0) * [o0, o1+o4] - T0 - T1
        c1: Fp62.sub(Fp62.sub(Fp62.mul01(Fp62.add(c1, c0), o0, Fp22.add(o1, o4)), t0), t1)
      };
    },
    mul034: ({ c0, c1 }, o0, o3, o4) => {
      const a = Fp62.create({
        c0: Fp22.mul(c0.c0, o0),
        c1: Fp22.mul(c0.c1, o0),
        c2: Fp22.mul(c0.c2, o0)
      });
      const b = Fp62.mul01(c1, o3, o4);
      const e = Fp62.mul01(Fp62.add(c0, c1), Fp22.add(o0, o3), o4);
      return {
        c0: Fp62.add(Fp62.mulByNonresidue(b), a),
        c1: Fp62.sub(e, Fp62.add(a, b))
      };
    },
    // A cyclotomic group is a subgroup of Fp^n defined by
    //   GΦₙ(p) = {α ∈ Fpⁿ : α^Φₙ(p) = 1}
    // The result of any pairing is in a cyclotomic subgroup
    // https://eprint.iacr.org/2009/565.pdf
    _cyclotomicSquare: opts.Fp12cyclotomicSquare,
    _cyclotomicExp: opts.Fp12cyclotomicExp,
    // https://eprint.iacr.org/2010/354.pdf
    // https://eprint.iacr.org/2009/565.pdf
    finalExponentiate: opts.Fp12finalExponentiate
  };
  return { Fp: Fp4, Fp2: Fp22, Fp6: Fp62, Fp4Square: Fp4Square2, Fp12: Fp122 };
}

// node_modules/@noble/curves/esm/bls12-381.js
var _0n3 = BigInt(0);
var _1n3 = BigInt(1);
var _2n3 = BigInt(2);
var _3n3 = BigInt(3);
var _4n = BigInt(4);
var BLS_X = BigInt("0xd201000000010000");
var BLS_X_LEN = bitLen(BLS_X);
var { Fp, Fp2, Fp6, Fp4Square, Fp12 } = tower12({
  // Order of Fp
  ORDER: BigInt("0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab"),
  // Finite extension field over irreducible polynominal.
  // Fp(u) / (u² - β) where β = -1
  FP2_NONRESIDUE: [_1n3, _1n3],
  Fp2mulByB: ({ c0, c1 }) => {
    const t0 = Fp.mul(c0, _4n);
    const t1 = Fp.mul(c1, _4n);
    return { c0: Fp.sub(t0, t1), c1: Fp.add(t0, t1) };
  },
  // Fp12
  // A cyclotomic group is a subgroup of Fp^n defined by
  //   GΦₙ(p) = {α ∈ Fpⁿ : α^Φₙ(p) = 1}
  // The result of any pairing is in a cyclotomic subgroup
  // https://eprint.iacr.org/2009/565.pdf
  Fp12cyclotomicSquare: ({ c0, c1 }) => {
    const { c0: c0c0, c1: c0c1, c2: c0c2 } = c0;
    const { c0: c1c0, c1: c1c1, c2: c1c2 } = c1;
    const { first: t3, second: t4 } = Fp4Square(c0c0, c1c1);
    const { first: t5, second: t6 } = Fp4Square(c1c0, c0c2);
    const { first: t7, second: t8 } = Fp4Square(c0c1, c1c2);
    const t9 = Fp2.mulByNonresidue(t8);
    return {
      c0: Fp6.create({
        c0: Fp2.add(Fp2.mul(Fp2.sub(t3, c0c0), _2n3), t3),
        // 2 * (T3 - c0c0)  + T3
        c1: Fp2.add(Fp2.mul(Fp2.sub(t5, c0c1), _2n3), t5),
        // 2 * (T5 - c0c1)  + T5
        c2: Fp2.add(Fp2.mul(Fp2.sub(t7, c0c2), _2n3), t7)
      }),
      // 2 * (T7 - c0c2)  + T7
      c1: Fp6.create({
        c0: Fp2.add(Fp2.mul(Fp2.add(t9, c1c0), _2n3), t9),
        // 2 * (T9 + c1c0) + T9
        c1: Fp2.add(Fp2.mul(Fp2.add(t4, c1c1), _2n3), t4),
        // 2 * (T4 + c1c1) + T4
        c2: Fp2.add(Fp2.mul(Fp2.add(t6, c1c2), _2n3), t6)
      })
    };
  },
  Fp12cyclotomicExp(num, n) {
    let z = Fp12.ONE;
    for (let i = BLS_X_LEN - 1; i >= 0; i--) {
      z = Fp12._cyclotomicSquare(z);
      if (bitGet(n, i))
        z = Fp12.mul(z, num);
    }
    return z;
  },
  // https://eprint.iacr.org/2010/354.pdf
  // https://eprint.iacr.org/2009/565.pdf
  Fp12finalExponentiate: (num) => {
    const x = BLS_X;
    const t0 = Fp12.div(Fp12.frobeniusMap(num, 6), num);
    const t1 = Fp12.mul(Fp12.frobeniusMap(t0, 2), t0);
    const t2 = Fp12.conjugate(Fp12._cyclotomicExp(t1, x));
    const t3 = Fp12.mul(Fp12.conjugate(Fp12._cyclotomicSquare(t1)), t2);
    const t4 = Fp12.conjugate(Fp12._cyclotomicExp(t3, x));
    const t5 = Fp12.conjugate(Fp12._cyclotomicExp(t4, x));
    const t6 = Fp12.mul(Fp12.conjugate(Fp12._cyclotomicExp(t5, x)), Fp12._cyclotomicSquare(t2));
    const t7 = Fp12.conjugate(Fp12._cyclotomicExp(t6, x));
    const t2_t5_pow_q2 = Fp12.frobeniusMap(Fp12.mul(t2, t5), 2);
    const t4_t1_pow_q3 = Fp12.frobeniusMap(Fp12.mul(t4, t1), 3);
    const t6_t1c_pow_q1 = Fp12.frobeniusMap(Fp12.mul(t6, Fp12.conjugate(t1)), 1);
    const t7_t3c_t1 = Fp12.mul(Fp12.mul(t7, Fp12.conjugate(t3)), t1);
    return Fp12.mul(Fp12.mul(Fp12.mul(t2_t5_pow_q2, t4_t1_pow_q3), t6_t1c_pow_q1), t7_t3c_t1);
  }
});
var Fr = Field(BigInt("0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001"));
var isogenyMapG2 = isogenyMap(Fp2, [
  // xNum
  [
    [
      "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6",
      "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97d6"
    ],
    [
      "0x0",
      "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71a"
    ],
    [
      "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71e",
      "0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38d"
    ],
    [
      "0x171d6541fa38ccfaed6dea691f5fb614cb14b4e7f4e810aa22d6108f142b85757098e38d0f671c7188e2aaaaaaaa5ed1",
      "0x0"
    ]
  ],
  // xDen
  [
    [
      "0x0",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa63"
    ],
    [
      "0xc",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa9f"
    ],
    ["0x1", "0x0"]
    // LAST 1
  ],
  // yNum
  [
    [
      "0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706",
      "0x1530477c7ab4113b59a4c18b076d11930f7da5d4a07f649bf54439d87d27e500fc8c25ebf8c92f6812cfc71c71c6d706"
    ],
    [
      "0x0",
      "0x5c759507e8e333ebb5b7a9a47d7ed8532c52d39fd3a042a88b58423c50ae15d5c2638e343d9c71c6238aaaaaaaa97be"
    ],
    [
      "0x11560bf17baa99bc32126fced787c88f984f87adf7ae0c7f9a208c6b4f20a4181472aaa9cb8d555526a9ffffffffc71c",
      "0x8ab05f8bdd54cde190937e76bc3e447cc27c3d6fbd7063fcd104635a790520c0a395554e5c6aaaa9354ffffffffe38f"
    ],
    [
      "0x124c9ad43b6cf79bfbf7043de3811ad0761b0f37a1e26286b0e977c69aa274524e79097a56dc4bd9e1b371c71c718b10",
      "0x0"
    ]
  ],
  // yDen
  [
    [
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa8fb"
    ],
    [
      "0x0",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffa9d3"
    ],
    [
      "0x12",
      "0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaa99"
    ],
    ["0x1", "0x0"]
    // LAST 1
  ]
].map((i) => i.map((pair) => Fp2.fromBigTuple(pair.map(BigInt)))));
var isogenyMapG1 = isogenyMap(Fp, [
  // xNum
  [
    "0x11a05f2b1e833340b809101dd99815856b303e88a2d7005ff2627b56cdb4e2c85610c2d5f2e62d6eaeac1662734649b7",
    "0x17294ed3e943ab2f0588bab22147a81c7c17e75b2f6a8417f565e33c70d1e86b4838f2a6f318c356e834eef1b3cb83bb",
    "0xd54005db97678ec1d1048c5d10a9a1bce032473295983e56878e501ec68e25c958c3e3d2a09729fe0179f9dac9edcb0",
    "0x1778e7166fcc6db74e0609d307e55412d7f5e4656a8dbf25f1b33289f1b330835336e25ce3107193c5b388641d9b6861",
    "0xe99726a3199f4436642b4b3e4118e5499db995a1257fb3f086eeb65982fac18985a286f301e77c451154ce9ac8895d9",
    "0x1630c3250d7313ff01d1201bf7a74ab5db3cb17dd952799b9ed3ab9097e68f90a0870d2dcae73d19cd13c1c66f652983",
    "0xd6ed6553fe44d296a3726c38ae652bfb11586264f0f8ce19008e218f9c86b2a8da25128c1052ecaddd7f225a139ed84",
    "0x17b81e7701abdbe2e8743884d1117e53356de5ab275b4db1a682c62ef0f2753339b7c8f8c8f475af9ccb5618e3f0c88e",
    "0x80d3cf1f9a78fc47b90b33563be990dc43b756ce79f5574a2c596c928c5d1de4fa295f296b74e956d71986a8497e317",
    "0x169b1f8e1bcfa7c42e0c37515d138f22dd2ecb803a0c5c99676314baf4bb1b7fa3190b2edc0327797f241067be390c9e",
    "0x10321da079ce07e272d8ec09d2565b0dfa7dccdde6787f96d50af36003b14866f69b771f8c285decca67df3f1605fb7b",
    "0x6e08c248e260e70bd1e962381edee3d31d79d7e22c837bc23c0bf1bc24c6b68c24b1b80b64d391fa9c8ba2e8ba2d229"
  ],
  // xDen
  [
    "0x8ca8d548cff19ae18b2e62f4bd3fa6f01d5ef4ba35b48ba9c9588617fc8ac62b558d681be343df8993cf9fa40d21b1c",
    "0x12561a5deb559c4348b4711298e536367041e8ca0cf0800c0126c2588c48bf5713daa8846cb026e9e5c8276ec82b3bff",
    "0xb2962fe57a3225e8137e629bff2991f6f89416f5a718cd1fca64e00b11aceacd6a3d0967c94fedcfcc239ba5cb83e19",
    "0x3425581a58ae2fec83aafef7c40eb545b08243f16b1655154cca8abc28d6fd04976d5243eecf5c4130de8938dc62cd8",
    "0x13a8e162022914a80a6f1d5f43e7a07dffdfc759a12062bb8d6b44e833b306da9bd29ba81f35781d539d395b3532a21e",
    "0xe7355f8e4e667b955390f7f0506c6e9395735e9ce9cad4d0a43bcef24b8982f7400d24bc4228f11c02df9a29f6304a5",
    "0x772caacf16936190f3e0c63e0596721570f5799af53a1894e2e073062aede9cea73b3538f0de06cec2574496ee84a3a",
    "0x14a7ac2a9d64a8b230b3f5b074cf01996e7f63c21bca68a81996e1cdf9822c580fa5b9489d11e2d311f7d99bbdcc5a5e",
    "0xa10ecf6ada54f825e920b3dafc7a3cce07f8d1d7161366b74100da67f39883503826692abba43704776ec3a79a1d641",
    "0x95fc13ab9e92ad4476d6e3eb3a56680f682b4ee96f7d03776df533978f31c1593174e4b4b7865002d6384d168ecdd0a",
    "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
    // LAST 1
  ],
  // yNum
  [
    "0x90d97c81ba24ee0259d1f094980dcfa11ad138e48a869522b52af6c956543d3cd0c7aee9b3ba3c2be9845719707bb33",
    "0x134996a104ee5811d51036d776fb46831223e96c254f383d0f906343eb67ad34d6c56711962fa8bfe097e75a2e41c696",
    "0xcc786baa966e66f4a384c86a3b49942552e2d658a31ce2c344be4b91400da7d26d521628b00523b8dfe240c72de1f6",
    "0x1f86376e8981c217898751ad8746757d42aa7b90eeb791c09e4a3ec03251cf9de405aba9ec61deca6355c77b0e5f4cb",
    "0x8cc03fdefe0ff135caf4fe2a21529c4195536fbe3ce50b879833fd221351adc2ee7f8dc099040a841b6daecf2e8fedb",
    "0x16603fca40634b6a2211e11db8f0a6a074a7d0d4afadb7bd76505c3d3ad5544e203f6326c95a807299b23ab13633a5f0",
    "0x4ab0b9bcfac1bbcb2c977d027796b3ce75bb8ca2be184cb5231413c4d634f3747a87ac2460f415ec961f8855fe9d6f2",
    "0x987c8d5333ab86fde9926bd2ca6c674170a05bfe3bdd81ffd038da6c26c842642f64550fedfe935a15e4ca31870fb29",
    "0x9fc4018bd96684be88c9e221e4da1bb8f3abd16679dc26c1e8b6e6a1f20cabe69d65201c78607a360370e577bdba587",
    "0xe1bba7a1186bdb5223abde7ada14a23c42a0ca7915af6fe06985e7ed1e4d43b9b3f7055dd4eba6f2bafaaebca731c30",
    "0x19713e47937cd1be0dfd0b8f1d43fb93cd2fcbcb6caf493fd1183e416389e61031bf3a5cce3fbafce813711ad011c132",
    "0x18b46a908f36f6deb918c143fed2edcc523559b8aaf0c2462e6bfe7f911f643249d9cdf41b44d606ce07c8a4d0074d8e",
    "0xb182cac101b9399d155096004f53f447aa7b12a3426b08ec02710e807b4633f06c851c1919211f20d4c04f00b971ef8",
    "0x245a394ad1eca9b72fc00ae7be315dc757b3b080d4c158013e6632d3c40659cc6cf90ad1c232a6442d9d3f5db980133",
    "0x5c129645e44cf1102a159f748c4a3fc5e673d81d7e86568d9ab0f5d396a7ce46ba1049b6579afb7866b1e715475224b",
    "0x15e6be4e990f03ce4ea50b3b42df2eb5cb181d8f84965a3957add4fa95af01b2b665027efec01c7704b456be69c8b604"
  ],
  // yDen
  [
    "0x16112c4c3a9c98b252181140fad0eae9601a6de578980be6eec3232b5be72e7a07f3688ef60c206d01479253b03663c1",
    "0x1962d75c2381201e1a0cbd6c43c348b885c84ff731c4d59ca4a10356f453e01f78a4260763529e3532f6102c2e49a03d",
    "0x58df3306640da276faaae7d6e8eb15778c4855551ae7f310c35a5dd279cd2eca6757cd636f96f891e2538b53dbf67f2",
    "0x16b7d288798e5395f20d23bf89edb4d1d115c5dbddbcd30e123da489e726af41727364f2c28297ada8d26d98445f5416",
    "0xbe0e079545f43e4b00cc912f8228ddcc6d19c9f0f69bbb0542eda0fc9dec916a20b15dc0fd2ededda39142311a5001d",
    "0x8d9e5297186db2d9fb266eaac783182b70152c65550d881c5ecd87b6f0f5a6449f38db9dfa9cce202c6477faaf9b7ac",
    "0x166007c08a99db2fc3ba8734ace9824b5eecfdfa8d0cf8ef5dd365bc400a0051d5fa9c01a58b1fb93d1a1399126a775c",
    "0x16a3ef08be3ea7ea03bcddfabba6ff6ee5a4375efa1f4fd7feb34fd206357132b920f5b00801dee460ee415a15812ed9",
    "0x1866c8ed336c61231a1be54fd1d74cc4f9fb0ce4c6af5920abc5750c4bf39b4852cfe2f7bb9248836b233d9d55535d4a",
    "0x167a55cda70a6e1cea820597d94a84903216f763e13d87bb5308592e7ea7d4fbc7385ea3d529b35e346ef48bb8913f55",
    "0x4d2f259eea405bd48f010a01ad2911d9c6dd039bb61a6290e591b36e636a5c871a5c29f4f83060400f8b49cba8f6aa8",
    "0xaccbb67481d033ff5852c1e48c50c477f94ff8aefce42d28c0f9a88cea7913516f968986f7ebbea9684b529e2561092",
    "0xad6b9514c767fe3c3613144b45f1496543346d98adf02267d5ceef9a00d9b8693000763e3b90ac11e99b138573345cc",
    "0x2660400eb2e4f3b628bdd0d53cd76f2bf565b94e72927c1cb748df27942480e420517bd8714cc80d1fadc1326ed06f7",
    "0xe0fa1d816ddc03e6b24255e0d7819c171c40f65e273b853324efcd6356caa205ca2f570f13497804415473a1d634b8f",
    "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
    // LAST 1
  ]
].map((i) => i.map((j) => BigInt(j))));
var G2_SWU = mapToCurveSimpleSWU(Fp2, {
  A: Fp2.create({ c0: Fp.create(_0n3), c1: Fp.create(BigInt(240)) }),
  // A' = 240 * I
  B: Fp2.create({ c0: Fp.create(BigInt(1012)), c1: Fp.create(BigInt(1012)) }),
  // B' = 1012 * (1 + I)
  Z: Fp2.create({ c0: Fp.create(BigInt(-2)), c1: Fp.create(BigInt(-1)) })
  // Z: -(2 + I)
});
var G1_SWU = mapToCurveSimpleSWU(Fp, {
  A: Fp.create(BigInt("0x144698a3b8e9433d693a02c96d4982b0ea985383ee66a8d8e8981aefd881ac98936f8da0e0f97f5cf428082d584c1d")),
  B: Fp.create(BigInt("0x12e2908d11688030018b12e8753eee3b2016c1f0f24f4070a0b9c14fcef35ef55a23215a316ceaa5d1cc48e98e172be0")),
  Z: Fp.create(BigInt(11))
});
var { G2psi, G2psi2 } = psiFrobenius(Fp, Fp2, Fp2.div(Fp2.ONE, Fp2.NONRESIDUE));
var htfDefaults = Object.freeze({
  // DST: a domain separation tag
  // defined in section 2.2.5
  // Use utils.getDSTLabel(), utils.setDSTLabel(value)
  DST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
  encodeDST: "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_",
  // p: the characteristic of F
  //    where F is a finite field of characteristic p and order q = p^m
  p: Fp.ORDER,
  // m: the extension degree of F, m >= 1
  //     where F is a finite field of characteristic p and order q = p^m
  m: 2,
  // k: the target security level for the suite in bits
  // defined in section 5.1
  k: 128,
  // option to use a message that has already been processed by
  // expand_message_xmd
  expand: "xmd",
  // Hash functions for: expand_message_xmd is appropriate for use with a
  // wide range of hash functions, including SHA-2, SHA-3, BLAKE2, and others.
  // BBS+ uses blake2: https://github.com/hyperledger/aries-framework-go/issues/2247
  hash: sha256
});
var COMPRESSED_ZERO = setMask(Fp.toBytes(_0n3), { infinity: true, compressed: true });
function parseMask(bytes) {
  bytes = bytes.slice();
  const mask = bytes[0] & 224;
  const compressed = !!(mask >> 7 & 1);
  const infinity = !!(mask >> 6 & 1);
  const sort = !!(mask >> 5 & 1);
  bytes[0] &= 31;
  return { compressed, infinity, sort, value: bytes };
}
function setMask(bytes, mask) {
  if (bytes[0] & 224)
    throw new Error("setMask: non-empty mask");
  if (mask.compressed)
    bytes[0] |= 128;
  if (mask.infinity)
    bytes[0] |= 64;
  if (mask.sort)
    bytes[0] |= 32;
  return bytes;
}
function signatureG1ToRawBytes(point) {
  point.assertValidity();
  const isZero = point.equals(bls12_381.G1.ProjectivePoint.ZERO);
  const { x, y } = point.toAffine();
  if (isZero)
    return COMPRESSED_ZERO.slice();
  const P = Fp.ORDER;
  const sort = Boolean(y * _2n3 / P);
  return setMask(numberToBytesBE(x, Fp.BYTES), { compressed: true, sort });
}
function signatureG2ToRawBytes(point) {
  point.assertValidity();
  const len = Fp.BYTES;
  if (point.equals(bls12_381.G2.ProjectivePoint.ZERO))
    return concatBytes(COMPRESSED_ZERO, numberToBytesBE(_0n3, len));
  const { x, y } = point.toAffine();
  const { re: x0, im: x1 } = Fp2.reim(x);
  const { re: y0, im: y1 } = Fp2.reim(y);
  const tmp = y1 > _0n3 ? y1 * _2n3 : y0 * _2n3;
  const sort = Boolean(tmp / Fp.ORDER & _1n3);
  const z2 = x0;
  return concatBytes(setMask(numberToBytesBE(x1, len), { sort, compressed: true }), numberToBytesBE(z2, len));
}
var bls12_381 = bls({
  // Fields
  fields: {
    Fp,
    Fp2,
    Fp6,
    Fp12,
    Fr
  },
  // G1 is the order-q subgroup of E1(Fp) : y² = x³ + 4, #E1(Fp) = h1q, where
  // characteristic; z + (z⁴ - z² + 1)(z - 1)²/3
  G1: {
    Fp,
    // cofactor; (z - 1)²/3
    h: BigInt("0x396c8c005555e1568c00aaab0000aaab"),
    // generator's coordinates
    // x = 3685416753713387016781088315183077757961620795782546409894578378688607592378376318836054947676345821548104185464507
    // y = 1339506544944476473020471379941921221584933875938349620426543736416511423956333506472724655353366534992391756441569
    Gx: BigInt("0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb"),
    Gy: BigInt("0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1"),
    a: Fp.ZERO,
    b: _4n,
    htfDefaults: { ...htfDefaults, m: 1, DST: "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_" },
    wrapPrivateKey: true,
    allowInfinityPoint: true,
    // Checks is the point resides in prime-order subgroup.
    // point.isTorsionFree() should return true for valid points
    // It returns false for shitty points.
    // https://eprint.iacr.org/2021/1130.pdf
    isTorsionFree: (c, point) => {
      const beta = BigInt("0x5f19672fdf76ce51ba69c6076a0f77eaddb3a93be6f89688de17d813620a00022e01fffffffefffe");
      const phi = new c(Fp.mul(point.px, beta), point.py, point.pz);
      const xP = point.multiplyUnsafe(BLS_X).negate();
      const u2P = xP.multiplyUnsafe(BLS_X);
      return u2P.equals(phi);
    },
    // Clear cofactor of G1
    // https://eprint.iacr.org/2019/403
    clearCofactor: (_c, point) => {
      return point.multiplyUnsafe(BLS_X).add(point);
    },
    mapToCurve: (scalars) => {
      const { x, y } = G1_SWU(Fp.create(scalars[0]));
      return isogenyMapG1(x, y);
    },
    fromBytes: (bytes) => {
      const { compressed, infinity, sort, value } = parseMask(bytes);
      if (value.length === 48 && compressed) {
        const P = Fp.ORDER;
        const compressedValue = bytesToNumberBE(value);
        const x = Fp.create(compressedValue & Fp.MASK);
        if (infinity) {
          if (x !== _0n3)
            throw new Error("G1: non-empty compressed point at infinity");
          return { x: _0n3, y: _0n3 };
        }
        const right = Fp.add(Fp.pow(x, _3n3), Fp.create(bls12_381.params.G1b));
        let y = Fp.sqrt(right);
        if (!y)
          throw new Error("invalid compressed G1 point");
        if (y * _2n3 / P !== BigInt(sort))
          y = Fp.neg(y);
        return { x: Fp.create(x), y: Fp.create(y) };
      } else if (value.length === 96 && !compressed) {
        const x = bytesToNumberBE(value.subarray(0, Fp.BYTES));
        const y = bytesToNumberBE(value.subarray(Fp.BYTES));
        if (infinity) {
          if (x !== _0n3 || y !== _0n3)
            throw new Error("G1: non-empty point at infinity");
          return bls12_381.G1.ProjectivePoint.ZERO.toAffine();
        }
        return { x: Fp.create(x), y: Fp.create(y) };
      } else {
        throw new Error("invalid point G1, expected 48/96 bytes");
      }
    },
    toBytes: (c, point, isCompressed) => {
      const isZero = point.equals(c.ZERO);
      const { x, y } = point.toAffine();
      if (isCompressed) {
        if (isZero)
          return COMPRESSED_ZERO.slice();
        const P = Fp.ORDER;
        const sort = Boolean(y * _2n3 / P);
        return setMask(numberToBytesBE(x, Fp.BYTES), { compressed: true, sort });
      } else {
        if (isZero) {
          const x2 = concatBytes(new Uint8Array([64]), new Uint8Array(2 * Fp.BYTES - 1));
          return x2;
        } else {
          return concatBytes(numberToBytesBE(x, Fp.BYTES), numberToBytesBE(y, Fp.BYTES));
        }
      }
    },
    ShortSignature: {
      fromHex(hex) {
        const { infinity, sort, value } = parseMask(ensureBytes("signatureHex", hex, 48));
        const P = Fp.ORDER;
        const compressedValue = bytesToNumberBE(value);
        if (infinity)
          return bls12_381.G1.ProjectivePoint.ZERO;
        const x = Fp.create(compressedValue & Fp.MASK);
        const right = Fp.add(Fp.pow(x, _3n3), Fp.create(bls12_381.params.G1b));
        let y = Fp.sqrt(right);
        if (!y)
          throw new Error("invalid compressed G1 point");
        const aflag = BigInt(sort);
        if (y * _2n3 / P !== aflag)
          y = Fp.neg(y);
        const point = bls12_381.G1.ProjectivePoint.fromAffine({ x, y });
        point.assertValidity();
        return point;
      },
      toRawBytes(point) {
        return signatureG1ToRawBytes(point);
      },
      toHex(point) {
        return bytesToHex(signatureG1ToRawBytes(point));
      }
    }
  },
  // G2 is the order-q subgroup of E2(Fp²) : y² = x³+4(1+√−1),
  // where Fp2 is Fp[√−1]/(x2+1). #E2(Fp2 ) = h2q, where
  // G² - 1
  // h2q
  G2: {
    Fp: Fp2,
    // cofactor
    h: BigInt("0x5d543a95414e7f1091d50792876a202cd91de4547085abaa68a205b2e5a7ddfa628f1cb4d9e82ef21537e293a6691ae1616ec6e786f0c70cf1c38e31c7238e5"),
    Gx: Fp2.fromBigTuple([
      BigInt("0x024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8"),
      BigInt("0x13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e")
    ]),
    // y =
    // 927553665492332455747201965776037880757740193453592970025027978793976877002675564980949289727957565575433344219582,
    // 1985150602287291935568054521177171638300868978215655730859378665066344726373823718423869104263333984641494340347905
    Gy: Fp2.fromBigTuple([
      BigInt("0x0ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801"),
      BigInt("0x0606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be")
    ]),
    a: Fp2.ZERO,
    b: Fp2.fromBigTuple([_4n, _4n]),
    hEff: BigInt("0xbc69f08f2ee75b3584c6a0ea91b352888e2a8e9145ad7689986ff031508ffe1329c2f178731db956d82bf015d1212b02ec0ec69d7477c1ae954cbc06689f6a359894c0adebbf6b4e8020005aaa95551"),
    htfDefaults: { ...htfDefaults },
    wrapPrivateKey: true,
    allowInfinityPoint: true,
    mapToCurve: (scalars) => {
      const { x, y } = G2_SWU(Fp2.fromBigTuple(scalars));
      return isogenyMapG2(x, y);
    },
    // Checks is the point resides in prime-order subgroup.
    // point.isTorsionFree() should return true for valid points
    // It returns false for shitty points.
    // https://eprint.iacr.org/2021/1130.pdf
    // Older version: https://eprint.iacr.org/2019/814.pdf
    isTorsionFree: (c, P) => {
      return P.multiplyUnsafe(BLS_X).negate().equals(G2psi(c, P));
    },
    // Maps the point into the prime-order subgroup G2.
    // clear_cofactor_bls12381_g2 from RFC 9380.
    // https://eprint.iacr.org/2017/419.pdf
    // prettier-ignore
    clearCofactor: (c, P) => {
      const x = BLS_X;
      let t1 = P.multiplyUnsafe(x).negate();
      let t2 = G2psi(c, P);
      let t3 = P.double();
      t3 = G2psi2(c, t3);
      t3 = t3.subtract(t2);
      t2 = t1.add(t2);
      t2 = t2.multiplyUnsafe(x).negate();
      t3 = t3.add(t2);
      t3 = t3.subtract(t1);
      const Q = t3.subtract(P);
      return Q;
    },
    fromBytes: (bytes) => {
      const { compressed, infinity, sort, value } = parseMask(bytes);
      if (!compressed && !infinity && sort || // 00100000
      !compressed && infinity && sort || // 01100000
      sort && infinity && compressed) {
        throw new Error("invalid encoding flag: " + (bytes[0] & 224));
      }
      const L = Fp.BYTES;
      const slc = (b, from29, to3) => bytesToNumberBE(b.slice(from29, to3));
      if (value.length === 96 && compressed) {
        const b = bls12_381.params.G2b;
        const P = Fp.ORDER;
        if (infinity) {
          if (value.reduce((p, c) => p !== 0 ? c + 1 : c, 0) > 0) {
            throw new Error("invalid compressed G2 point");
          }
          return { x: Fp2.ZERO, y: Fp2.ZERO };
        }
        const x_1 = slc(value, 0, L);
        const x_0 = slc(value, L, 2 * L);
        const x = Fp2.create({ c0: Fp.create(x_0), c1: Fp.create(x_1) });
        const right = Fp2.add(Fp2.pow(x, _3n3), b);
        let y = Fp2.sqrt(right);
        const Y_bit = y.c1 === _0n3 ? y.c0 * _2n3 / P : y.c1 * _2n3 / P ? _1n3 : _0n3;
        y = sort && Y_bit > 0 ? y : Fp2.neg(y);
        return { x, y };
      } else if (value.length === 192 && !compressed) {
        if (infinity) {
          if (value.reduce((p, c) => p !== 0 ? c + 1 : c, 0) > 0) {
            throw new Error("invalid uncompressed G2 point");
          }
          return { x: Fp2.ZERO, y: Fp2.ZERO };
        }
        const x1 = slc(value, 0, L);
        const x0 = slc(value, L, 2 * L);
        const y1 = slc(value, 2 * L, 3 * L);
        const y0 = slc(value, 3 * L, 4 * L);
        return { x: Fp2.fromBigTuple([x0, x1]), y: Fp2.fromBigTuple([y0, y1]) };
      } else {
        throw new Error("invalid point G2, expected 96/192 bytes");
      }
    },
    toBytes: (c, point, isCompressed) => {
      const { BYTES: len, ORDER: P } = Fp;
      const isZero = point.equals(c.ZERO);
      const { x, y } = point.toAffine();
      if (isCompressed) {
        if (isZero)
          return concatBytes(COMPRESSED_ZERO, numberToBytesBE(_0n3, len));
        const flag = Boolean(y.c1 === _0n3 ? y.c0 * _2n3 / P : y.c1 * _2n3 / P);
        return concatBytes(setMask(numberToBytesBE(x.c1, len), { compressed: true, sort: flag }), numberToBytesBE(x.c0, len));
      } else {
        if (isZero)
          return concatBytes(new Uint8Array([64]), new Uint8Array(4 * len - 1));
        const { re: x0, im: x1 } = Fp2.reim(x);
        const { re: y0, im: y1 } = Fp2.reim(y);
        return concatBytes(numberToBytesBE(x1, len), numberToBytesBE(x0, len), numberToBytesBE(y1, len), numberToBytesBE(y0, len));
      }
    },
    Signature: {
      // TODO: Optimize, it's very slow because of sqrt.
      fromHex(hex) {
        const { infinity, sort, value } = parseMask(ensureBytes("signatureHex", hex));
        const P = Fp.ORDER;
        const half = value.length / 2;
        if (half !== 48 && half !== 96)
          throw new Error("invalid compressed signature length, must be 96 or 192");
        const z1 = bytesToNumberBE(value.slice(0, half));
        const z2 = bytesToNumberBE(value.slice(half));
        if (infinity)
          return bls12_381.G2.ProjectivePoint.ZERO;
        const x1 = Fp.create(z1 & Fp.MASK);
        const x2 = Fp.create(z2);
        const x = Fp2.create({ c0: x2, c1: x1 });
        const y2 = Fp2.add(Fp2.pow(x, _3n3), bls12_381.params.G2b);
        let y = Fp2.sqrt(y2);
        if (!y)
          throw new Error("Failed to find a square root");
        const { re: y0, im: y1 } = Fp2.reim(y);
        const aflag1 = BigInt(sort);
        const isGreater = y1 > _0n3 && y1 * _2n3 / P !== aflag1;
        const isZero = y1 === _0n3 && y0 * _2n3 / P !== aflag1;
        if (isGreater || isZero)
          y = Fp2.neg(y);
        const point = bls12_381.G2.ProjectivePoint.fromAffine({ x, y });
        point.assertValidity();
        return point;
      },
      toRawBytes(point) {
        return signatureG2ToRawBytes(point);
      },
      toHex(point) {
        return bytesToHex(signatureG2ToRawBytes(point));
      }
    }
  },
  params: {
    ateLoopSize: BLS_X,
    // The BLS parameter x for BLS12-381
    r: Fr.ORDER,
    // order; z⁴ − z² + 1; CURVE.n from other curves
    xNegative: true,
    twistType: "multiplicative"
  },
  htfDefaults,
  hash: sha256,
  randomBytes
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Bls.js
var noble = bls12_381;
function aggregate(points) {
  const group = typeof points[0]?.x === "bigint" ? bls12_381.G1 : bls12_381.G2;
  const point = points.reduce((acc, point2) => acc.add(new group.ProjectivePoint(point2.x, point2.y, point2.z)), group.ProjectivePoint.ZERO);
  return {
    x: point.px,
    y: point.py,
    z: point.pz
  };
}
function createKeyPair(options = {}) {
  const { as = "Hex", size: size4 = "short-key:long-sig" } = options;
  const privateKey = randomPrivateKey({ as });
  const publicKey = getPublicKey({ privateKey, size: size4 });
  return {
    privateKey,
    publicKey
  };
}
function getPublicKey(options) {
  const { privateKey, size: size4 = "short-key:long-sig" } = options;
  const group = size4 === "short-key:long-sig" ? bls12_381.G1 : bls12_381.G2;
  const { px, py, pz } = group.ProjectivePoint.fromPrivateKey(from2(privateKey).slice(2));
  return { x: px, y: py, z: pz };
}
function randomPrivateKey(options = {}) {
  const { as = "Hex" } = options;
  const bytes = bls12_381.utils.randomPrivateKey();
  if (as === "Hex")
    return fromBytes(bytes);
  return bytes;
}
function sign(options) {
  const { payload, privateKey, suite, size: size4 = "short-key:long-sig" } = options;
  const payloadGroup = size4 === "short-key:long-sig" ? bls12_381.G2 : bls12_381.G1;
  const payloadPoint = payloadGroup.hashToCurve(from3(payload), suite ? { DST: fromString2(suite) } : void 0);
  const privateKeyGroup = size4 === "short-key:long-sig" ? bls12_381.G1 : bls12_381.G2;
  const signature = payloadPoint.multiply(privateKeyGroup.normPrivateKeyToScalar(privateKey.slice(2)));
  return {
    x: signature.px,
    y: signature.py,
    z: signature.pz
  };
}
function verify(options) {
  const { payload, suite } = options;
  const publicKey = options.publicKey;
  const signature = options.signature;
  const isShortSig = typeof signature.x === "bigint";
  const group = isShortSig ? bls12_381.G1 : bls12_381.G2;
  const payloadPoint = group.hashToCurve(from3(payload), suite ? { DST: fromString2(suite) } : void 0);
  const shortSigPairing = () => bls12_381.pairingBatch([
    {
      g1: payloadPoint,
      g2: new bls12_381.G2.ProjectivePoint(publicKey.x, publicKey.y, publicKey.z)
    },
    {
      g1: new bls12_381.G1.ProjectivePoint(signature.x, signature.y, signature.z),
      g2: bls12_381.G2.ProjectivePoint.BASE.negate()
    }
  ]);
  const longSigPairing = () => bls12_381.pairingBatch([
    {
      g1: new bls12_381.G1.ProjectivePoint(publicKey.x, publicKey.y, publicKey.z).negate(),
      g2: payloadPoint
    },
    {
      g1: bls12_381.G1.ProjectivePoint.BASE,
      g2: new bls12_381.G2.ProjectivePoint(signature.x, signature.y, signature.z)
    }
  ]);
  return bls12_381.fields.Fp12.eql(isShortSig ? shortSigPairing() : longSigPairing(), bls12_381.fields.Fp12.ONE);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/BlsPoint.js
var BlsPoint_exports = {};
__export(BlsPoint_exports, {
  fromBytes: () => fromBytes7,
  fromHex: () => fromHex7,
  toBytes: () => toBytes9,
  toHex: () => toHex8
});
function toBytes9(point) {
  const group = typeof point.z === "bigint" ? bls12_381.G1 : bls12_381.G2;
  return new group.ProjectivePoint(point.x, point.y, point.z).toRawBytes();
}
function toHex8(point) {
  return fromBytes(toBytes9(point));
}
function fromBytes7(bytes) {
  const group = bytes.length === 48 ? bls12_381.G1 : bls12_381.G2;
  const point = group.ProjectivePoint.fromHex(bytes);
  return {
    x: point.px,
    y: point.py,
    z: point.pz
  };
}
function fromHex7(hex, group) {
  return fromBytes7(toBytes2(hex), group);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Cbor.js
var Cbor_exports = {};
__export(Cbor_exports, {
  ArrayTooLargeError: () => ArrayTooLargeError,
  ByteStringTooLargeError: () => ByteStringTooLargeError,
  InvalidAdditionalInfoError: () => InvalidAdditionalInfoError,
  InvalidIndefiniteLengthChunkError: () => InvalidIndefiniteLengthChunkError,
  InvalidMajorTypeError: () => InvalidMajorTypeError,
  InvalidSimpleValueError: () => InvalidSimpleValueError,
  NumberTooLargeError: () => NumberTooLargeError,
  ObjectTooLargeError: () => ObjectTooLargeError,
  StringTooLargeError: () => StringTooLargeError,
  UnexpectedTokenError: () => UnexpectedTokenError,
  Unsupported64BitIntegerError: () => Unsupported64BitIntegerError,
  UnsupportedBigIntError: () => UnsupportedBigIntError,
  UnsupportedTagError: () => UnsupportedTagError,
  decode: () => decode5,
  encode: () => encode6
});
function encode6(data, options = {}) {
  const { as = "Hex" } = options;
  const encodable = getEncodable2(data);
  const cursor = create(new Uint8Array(encodable.length));
  encodable.encode(cursor);
  if (as === "Hex")
    return fromBytes(cursor.bytes);
  return cursor.bytes;
}
function decode5(data) {
  const bytes = (() => {
    if (typeof data === "string") {
      if (data.length > 3 && data.length % 2 !== 0)
        throw new InvalidLengthError(data);
      return fromHex(data);
    }
    return data;
  })();
  const cursor = create(bytes);
  return decodeCursor(cursor);
}
var InvalidMajorTypeError = class extends BaseError {
  constructor({ majorType }) {
    super(`Invalid CBOR major type: ${majorType}`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.InvalidMajorTypeError"
    });
  }
};
var InvalidAdditionalInfoError = class extends BaseError {
  constructor({ additionalInfo }) {
    super(`Invalid CBOR additional info: ${additionalInfo}`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.InvalidAdditionalInfoError"
    });
  }
};
var Unsupported64BitIntegerError = class extends BaseError {
  constructor() {
    super("64-bit integers are not supported in CBOR decoding.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.Unsupported64BitIntegerError"
    });
  }
};
var UnsupportedTagError = class extends BaseError {
  constructor({ tag }) {
    super(`CBOR tagged data (tag ${tag}) is not yet supported.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.UnsupportedTagError"
    });
  }
};
var InvalidIndefiniteLengthChunkError = class extends BaseError {
  constructor({ type: type6 }) {
    super(`Invalid chunk type in indefinite-length ${type6}`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.InvalidIndefiniteLengthChunkError"
    });
  }
};
var InvalidSimpleValueError = class extends BaseError {
  constructor({ value }) {
    super(`Invalid CBOR simple value: ${value}`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.InvalidSimpleValueError"
    });
  }
};
var UnsupportedBigIntError = class extends BaseError {
  constructor() {
    super("BigInt values are not supported in CBOR encoding.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.UnsupportedBigIntError"
    });
  }
};
var UnexpectedTokenError = class extends BaseError {
  constructor({ token }) {
    super(`Unexpected token: ${token}`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.UnexpectedTokenError"
    });
  }
};
var NumberTooLargeError = class extends BaseError {
  constructor({ number }) {
    super(`Number exceeds maximum safe integer (${Number.MAX_SAFE_INTEGER}): ${number}`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.NumberTooLargeError"
    });
  }
};
var StringTooLargeError = class extends BaseError {
  constructor({ size: size4 }) {
    super(`String length exceeds maximum (4294967295): ${size4}`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.StringTooLargeError"
    });
  }
};
var ArrayTooLargeError = class extends BaseError {
  constructor({ size: size4 }) {
    super(`Array length exceeds maximum (4294967295): ${size4}`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.ArrayTooLargeError"
    });
  }
};
var ObjectTooLargeError = class extends BaseError {
  constructor({ size: size4 }) {
    super(`Object size exceeds maximum (4294967295): ${size4}`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.ObjectTooLargeError"
    });
  }
};
var ByteStringTooLargeError = class extends BaseError {
  constructor({ size: size4 }) {
    super(`Byte string length exceeds maximum (4294967295): ${size4}`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Cbor.ByteStringTooLargeError"
    });
  }
};
function getEncodable2(value) {
  if (typeof value === "undefined")
    return { length: 1, encode: (cursor) => cursor.pushUint8(247) };
  if (value === null)
    return { length: 1, encode: (cursor) => cursor.pushUint8(246) };
  if (typeof value === "boolean")
    return {
      length: 1,
      encode: (cursor) => cursor.pushUint8(value ? 245 : 244)
    };
  if (typeof value === "number")
    return getEncodable2.number(value);
  if (typeof value === "bigint")
    throw new UnsupportedBigIntError();
  if (typeof value === "string")
    return getEncodable2.string(value);
  if (Array.isArray(value))
    return getEncodable2.array(value);
  if (value instanceof Uint8Array)
    return getEncodable2.byteString(value);
  if (value instanceof ArrayBuffer)
    return getEncodable2.byteString(new Uint8Array(value));
  if (ArrayBuffer.isView(value))
    return getEncodable2.byteString(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  if (typeof value === "object")
    return getEncodable2.object(value);
  throw new UnexpectedTokenError({ token: String(value) });
}
(function(getEncodable3) {
  function number(value) {
    if (!Number.isSafeInteger(value)) {
      const float32 = Math.fround(value);
      if (Number.isNaN(value) || value === float32)
        return {
          length: 5,
          // 1 byte prefix + 4 bytes float32
          encode(cursor) {
            cursor.pushUint8(250);
            cursor.dataView.setFloat32(cursor.position, value, false);
            cursor.position += 4;
          }
        };
      return {
        length: 9,
        // 1 byte prefix + 8 bytes float64
        encode(cursor) {
          cursor.pushUint8(251);
          cursor.dataView.setFloat64(cursor.position, value, false);
          cursor.position += 8;
        }
      };
    }
    if (value >= 0) {
      if (value <= 23)
        return { length: 1, encode: (cursor) => cursor.pushUint8(value) };
      if (value <= 255)
        return {
          length: 2,
          // 1 byte prefix + 1 byte uint8
          encode: (cursor) => {
            cursor.pushUint8(24);
            cursor.pushUint8(value);
          }
        };
      if (value <= 65535)
        return {
          length: 3,
          // 1 byte prefix + 2 bytes uint16
          encode: (cursor) => {
            cursor.pushUint8(25);
            cursor.pushUint16(value);
          }
        };
      if (value <= 4294967295)
        return {
          length: 5,
          // 1 byte prefix + 4 bytes uint32
          encode: (cursor) => {
            cursor.pushUint8(26);
            cursor.pushUint32(value);
          }
        };
      throw new NumberTooLargeError({ number: value.toString(10) });
    }
    const positiveNumber = -1 - value;
    if (value >= -24)
      return {
        length: 1,
        encode: (cursor) => cursor.pushUint8(32 + positiveNumber)
      };
    if (positiveNumber <= 255)
      return {
        length: 2,
        // 1 byte prefix + 1 byte uint8
        encode: (cursor) => {
          cursor.pushUint8(56);
          cursor.pushUint8(positiveNumber);
        }
      };
    if (positiveNumber <= 65535)
      return {
        length: 3,
        // 1 byte prefix + 2 bytes uint16
        encode: (cursor) => {
          cursor.pushUint8(57);
          cursor.pushUint16(positiveNumber);
        }
      };
    if (positiveNumber <= 4294967295)
      return {
        length: 5,
        // 1 byte prefix + 4 bytes uint32
        encode: (cursor) => {
          cursor.pushUint8(58);
          cursor.pushUint32(positiveNumber);
        }
      };
    throw new NumberTooLargeError({ number: value.toString(10) });
  }
  getEncodable3.number = number;
  function string(value) {
    const encoded = fromString2(value);
    const size4 = encoded.length;
    if (size4 <= 23)
      return {
        length: 1 + size4,
        // 1 byte prefix + size bytes
        encode(cursor) {
          cursor.pushUint8(96 + size4);
          if (size4 > 0)
            cursor.pushBytes(encoded);
        }
      };
    if (size4 <= 255)
      return {
        length: 2 + size4,
        // 1 byte prefix + 1 byte uint8 + size bytes
        encode(cursor) {
          cursor.pushUint8(120);
          cursor.pushUint8(size4);
          cursor.pushBytes(encoded);
        }
      };
    if (size4 <= 65535)
      return {
        length: 3 + size4,
        // 1 byte prefix + 2 bytes uint16 + size bytes
        encode(cursor) {
          cursor.pushUint8(121);
          cursor.pushUint16(size4);
          cursor.pushBytes(encoded);
        }
      };
    if (size4 <= 4294967295)
      return {
        length: 5 + size4,
        // 1 byte prefix + 4 bytes uint32 + size bytes
        encode(cursor) {
          cursor.pushUint8(122);
          cursor.pushUint32(size4);
          cursor.pushBytes(encoded);
        }
      };
    throw new StringTooLargeError({ size: size4 });
  }
  getEncodable3.string = string;
  function array(value) {
    const items = value.map((item) => getEncodable3(item));
    const bodyLength = items.reduce((acc, item) => acc + item.length, 0);
    const size4 = value.length;
    if (size4 <= 23)
      return {
        length: 1 + bodyLength,
        // 1 byte prefix + body length
        encode(cursor) {
          cursor.pushUint8(128 + size4);
          for (const item of items)
            item.encode(cursor);
        }
      };
    if (size4 <= 255)
      return {
        length: 2 + bodyLength,
        // 1 byte prefix + 1 byte uint8 + body length
        encode(cursor) {
          cursor.pushUint8(152);
          cursor.pushUint8(size4);
          for (const item of items)
            item.encode(cursor);
        }
      };
    if (size4 <= 65535)
      return {
        length: 3 + bodyLength,
        // 1 byte prefix + 2 bytes uint16 + body length
        encode(cursor) {
          cursor.pushUint8(153);
          cursor.pushUint16(size4);
          for (const item of items)
            item.encode(cursor);
        }
      };
    if (size4 <= 4294967295)
      return {
        length: 5 + bodyLength,
        // 1 byte prefix + 4 bytes uint32 + body length
        encode(cursor) {
          cursor.pushUint8(154);
          cursor.pushUint32(size4);
          for (const item of items)
            item.encode(cursor);
        }
      };
    throw new ArrayTooLargeError({ size: size4 });
  }
  getEncodable3.array = array;
  function byteString(value) {
    const size4 = value.byteLength;
    if (size4 <= 23)
      return {
        length: 1 + size4,
        // 1 byte prefix + size bytes
        encode(cursor) {
          cursor.pushUint8(64 + size4);
          cursor.pushBytes(value);
        }
      };
    if (size4 <= 255)
      return {
        length: 2 + size4,
        // 1 byte prefix + 1 byte uint8 + size bytes
        encode(cursor) {
          cursor.pushUint8(88);
          cursor.pushUint8(size4);
          cursor.pushBytes(value);
        }
      };
    if (size4 <= 65535)
      return {
        length: 3 + size4,
        // 1 byte prefix + 2 bytes uint16 + size bytes
        encode(cursor) {
          cursor.pushUint8(89);
          cursor.pushUint16(size4);
          cursor.pushBytes(value);
        }
      };
    if (size4 <= 4294967295)
      return {
        length: 5 + size4,
        // 1 byte prefix + 4 bytes uint32 + size bytes
        encode(cursor) {
          cursor.pushUint8(90);
          cursor.pushUint32(size4);
          cursor.pushBytes(value);
        }
      };
    throw new ByteStringTooLargeError({ size: size4 });
  }
  getEncodable3.byteString = byteString;
  function object(value) {
    const keys = Object.keys(value);
    const entries = keys.map((key) => ({
      key: getEncodable3(key),
      value: getEncodable3(value[key])
    }));
    const bodyLength = entries.reduce((acc, entry) => acc + entry.key.length + entry.value.length, 0);
    const size4 = keys.length;
    if (size4 <= 23)
      return {
        length: 1 + bodyLength,
        // 1 byte prefix + body length
        encode(cursor) {
          cursor.pushUint8(160 + size4);
          for (const entry of entries) {
            entry.key.encode(cursor);
            entry.value.encode(cursor);
          }
        }
      };
    if (size4 <= 255)
      return {
        length: 2 + bodyLength,
        // 1 byte prefix + 1 byte uint8 + body length
        encode(cursor) {
          cursor.pushUint8(184);
          cursor.pushUint8(size4);
          for (const entry of entries) {
            entry.key.encode(cursor);
            entry.value.encode(cursor);
          }
        }
      };
    if (size4 <= 65535)
      return {
        length: 3 + bodyLength,
        // 1 byte prefix + 2 bytes uint16 + body length
        encode(cursor) {
          cursor.pushUint8(185);
          cursor.pushUint16(size4);
          for (const entry of entries) {
            entry.key.encode(cursor);
            entry.value.encode(cursor);
          }
        }
      };
    if (size4 <= 4294967295)
      return {
        length: 5 + bodyLength,
        // 1 byte prefix + 4 bytes uint32 + body length
        encode(cursor) {
          cursor.pushUint8(186);
          cursor.pushUint32(size4);
          for (const entry of entries) {
            entry.key.encode(cursor);
            entry.value.encode(cursor);
          }
        }
      };
    throw new ObjectTooLargeError({ size: size4 });
  }
  getEncodable3.object = object;
})(getEncodable2 || (getEncodable2 = {}));
function decodeCursor(cursor) {
  const initialByte = cursor.readUint8();
  const majorType = initialByte >> 5;
  const additionalInfo = initialByte & 31;
  switch (majorType) {
    // Major type 0: Unsigned integer
    case 0:
      return decodeCursor.readUnsignedInteger(cursor, additionalInfo);
    // Major type 1: Negative integer
    case 1:
      return decodeCursor.readNegativeInteger(cursor, additionalInfo);
    // Major type 2: Byte string
    case 2:
      return decodeCursor.readByteString(cursor, additionalInfo);
    // Major type 3: Text string
    case 3:
      return decodeCursor.readTextString(cursor, additionalInfo);
    // Major type 4: Array
    case 4:
      return decodeCursor.readArray(cursor, additionalInfo);
    // Major type 5: Map
    case 5:
      return decodeCursor.readMap(cursor, additionalInfo);
    // Major type 6: Tagged data (not yet supported)
    case 6:
      throw new UnsupportedTagError({ tag: additionalInfo });
    // Major type 7: Simple values and floats
    case 7:
      return decodeCursor.readSimpleOrFloat(cursor, additionalInfo);
    default:
      throw new InvalidMajorTypeError({ majorType });
  }
}
(function(decodeCursor2) {
  function readLength2(cursor, additionalInfo) {
    if (additionalInfo < 24)
      return additionalInfo;
    if (additionalInfo === 24)
      return cursor.readUint8();
    if (additionalInfo === 25)
      return cursor.readUint16();
    if (additionalInfo === 26)
      return cursor.readUint32();
    if (additionalInfo === 27)
      throw new Unsupported64BitIntegerError();
    throw new InvalidAdditionalInfoError({ additionalInfo });
  }
  function readUnsignedInteger(cursor, additionalInfo) {
    return readLength2(cursor, additionalInfo);
  }
  decodeCursor2.readUnsignedInteger = readUnsignedInteger;
  function readNegativeInteger(cursor, additionalInfo) {
    const value = readLength2(cursor, additionalInfo);
    return -1 - value;
  }
  decodeCursor2.readNegativeInteger = readNegativeInteger;
  function readByteString(cursor, additionalInfo) {
    if (additionalInfo === 31) {
      const chunks = [];
      let totalLength = 0;
      while (true) {
        const byte = cursor.inspectUint8();
        if (byte === 255) {
          cursor.readUint8();
          break;
        }
        const chunk = decodeCursor2(cursor);
        if (!(chunk instanceof Uint8Array))
          throw new InvalidIndefiniteLengthChunkError({ type: "byte string" });
        chunks.push(chunk);
        totalLength += chunk.length;
      }
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    }
    const length = readLength2(cursor, additionalInfo);
    return cursor.readBytes(length);
  }
  decodeCursor2.readByteString = readByteString;
  function readTextString(cursor, additionalInfo) {
    if (additionalInfo === 31) {
      const chunks = [];
      while (true) {
        const byte = cursor.inspectUint8();
        if (byte === 255) {
          cursor.readUint8();
          break;
        }
        const chunk = decodeCursor2(cursor);
        if (typeof chunk !== "string")
          throw new InvalidIndefiniteLengthChunkError({ type: "text string" });
        chunks.push(chunk);
      }
      return chunks.join("");
    }
    const length = readLength2(cursor, additionalInfo);
    const bytes = cursor.readBytes(length);
    return toString2(bytes);
  }
  decodeCursor2.readTextString = readTextString;
  function readArray(cursor, additionalInfo) {
    if (additionalInfo === 31) {
      const result2 = [];
      while (true) {
        const byte = cursor.inspectUint8();
        if (byte === 255) {
          cursor.readUint8();
          break;
        }
        result2.push(decodeCursor2(cursor));
      }
      return result2;
    }
    const length = readLength2(cursor, additionalInfo);
    const result = [];
    for (let i = 0; i < length; i++) {
      result.push(decodeCursor2(cursor));
    }
    return result;
  }
  decodeCursor2.readArray = readArray;
  function readMap(cursor, additionalInfo) {
    if (additionalInfo === 31) {
      const result2 = {};
      while (true) {
        const byte = cursor.inspectUint8();
        if (byte === 255) {
          cursor.readUint8();
          break;
        }
        const key = decodeCursor2(cursor);
        const keyStr = typeof key === "string" ? key : typeof key === "number" ? String(key) : String(key);
        const value = decodeCursor2(cursor);
        result2[keyStr] = value;
      }
      return result2;
    }
    const length = readLength2(cursor, additionalInfo);
    const result = {};
    for (let i = 0; i < length; i++) {
      const key = decodeCursor2(cursor);
      const keyStr = typeof key === "string" ? key : typeof key === "number" ? String(key) : String(key);
      const value = decodeCursor2(cursor);
      result[keyStr] = value;
    }
    return result;
  }
  decodeCursor2.readMap = readMap;
  function readSimpleOrFloat(cursor, additionalInfo) {
    if (additionalInfo === 20)
      return false;
    if (additionalInfo === 21)
      return true;
    if (additionalInfo === 22)
      return null;
    if (additionalInfo === 23)
      return void 0;
    if (additionalInfo === 25) {
      const bits = cursor.readUint16();
      return getFloat16(bits);
    }
    if (additionalInfo === 26) {
      const value = cursor.dataView.getFloat32(cursor.position, false);
      cursor.position += 4;
      return value;
    }
    if (additionalInfo === 27) {
      const value = cursor.dataView.getFloat64(cursor.position, false);
      cursor.position += 8;
      return value;
    }
    if (additionalInfo === 24) {
      const simpleValue = cursor.readUint8();
      if (simpleValue < 32)
        throw new InvalidSimpleValueError({ value: simpleValue });
      return void 0;
    }
    throw new InvalidAdditionalInfoError({ additionalInfo });
  }
  decodeCursor2.readSimpleOrFloat = readSimpleOrFloat;
  function getFloat16(bits) {
    const sign7 = bits >> 15 & 1;
    const exponent = bits >> 10 & 31;
    const fraction = bits & 1023;
    if (exponent === 0) {
      if (fraction === 0)
        return sign7 ? -0 : 0;
      const value2 = 2 ** -14 * (fraction / 1024);
      return sign7 ? -value2 : value2;
    }
    if (exponent === 31) {
      if (fraction === 0)
        return sign7 ? -Infinity : Infinity;
      return NaN;
    }
    const value = 2 ** (exponent - 15) * (1 + fraction / 1024);
    return sign7 ? -value : value;
  }
})(decodeCursor || (decodeCursor = {}));

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/ContractAddress.js
var ContractAddress_exports = {};
__export(ContractAddress_exports, {
  from: () => from18,
  fromCreate: () => fromCreate,
  fromCreate2: () => fromCreate2
});
function from18(options) {
  if (options.salt)
    return fromCreate2(options);
  return fromCreate(options);
}
function fromCreate(options) {
  const from29 = fromHex(from5(options.from));
  let nonce = fromNumber2(options.nonce);
  if (nonce[0] === 0)
    nonce = new Uint8Array([]);
  return from5(`0x${keccak256(fromBytes3([from29, nonce], { as: "Hex" })).slice(26)}`);
}
function fromCreate2(options) {
  const from29 = fromHex(from5(options.from));
  const salt = padLeft2(validate2(options.salt) ? options.salt : fromHex(options.salt), 32);
  const bytecodeHash = (() => {
    if ("bytecodeHash" in options) {
      if (validate2(options.bytecodeHash))
        return options.bytecodeHash;
      return fromHex(options.bytecodeHash);
    }
    return keccak256(options.bytecode, { as: "Bytes" });
  })();
  return from5(slice(keccak256(concat2(fromHex("0xff"), from29, salt, bytecodeHash), { as: "Hex" }), 12));
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Ed25519.js
var Ed25519_exports = {};
__export(Ed25519_exports, {
  createKeyPair: () => createKeyPair2,
  getPublicKey: () => getPublicKey2,
  noble: () => noble2,
  randomPrivateKey: () => randomPrivateKey2,
  sign: () => sign2,
  verify: () => verify2
});

// node_modules/@noble/curves/esm/abstract/edwards.js
var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
var _2n4 = BigInt(2);
var _8n = BigInt(8);
var VERIFY_DEFAULT = { zip215: true };
function validateOpts(curve) {
  const opts = validateBasic(curve);
  validateObject(curve, {
    hash: "function",
    a: "bigint",
    d: "bigint",
    randomBytes: "function"
  }, {
    adjustScalarBytes: "function",
    domain: "function",
    uvRatio: "function",
    mapToCurve: "function"
  });
  return Object.freeze({ ...opts });
}
function twistedEdwards(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { Fp: Fp4, n: CURVE_ORDER, prehash, hash: cHash, randomBytes: randomBytes2, nByteLength, h: cofactor } = CURVE;
  const MASK = _2n4 << BigInt(nByteLength * 8) - _1n4;
  const modP = Fp4.create;
  const Fn = Field(CURVE.n, CURVE.nBitLength);
  function isEdValidXY(x, y) {
    const x2 = Fp4.sqr(x);
    const y2 = Fp4.sqr(y);
    const left = Fp4.add(Fp4.mul(CURVE.a, x2), y2);
    const right = Fp4.add(Fp4.ONE, Fp4.mul(CURVE.d, Fp4.mul(x2, y2)));
    return Fp4.eql(left, right);
  }
  if (!isEdValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const uvRatio2 = CURVE.uvRatio || ((u, v) => {
    try {
      return { isValid: true, value: Fp4.sqrt(u * Fp4.inv(v)) };
    } catch (e) {
      return { isValid: false, value: _0n4 };
    }
  });
  const adjustScalarBytes2 = CURVE.adjustScalarBytes || ((bytes) => bytes);
  const domain = CURVE.domain || ((data, ctx, phflag) => {
    abool("phflag", phflag);
    if (ctx.length || phflag)
      throw new Error("Contexts/pre-hash are not supported");
    return data;
  });
  function aCoordinate(title, n, banZero = false) {
    const min = banZero ? _1n4 : _0n4;
    aInRange("coordinate " + title, n, min, MASK);
  }
  function aextpoint(other) {
    if (!(other instanceof Point))
      throw new Error("ExtendedPoint expected");
  }
  const toAffineMemo = memoized((p, iz) => {
    const { ex: x, ey: y, ez: z } = p;
    const is0 = p.is0();
    if (iz == null)
      iz = is0 ? _8n : Fp4.inv(z);
    const ax = modP(x * iz);
    const ay = modP(y * iz);
    const zz = modP(z * iz);
    if (is0)
      return { x: _0n4, y: _1n4 };
    if (zz !== _1n4)
      throw new Error("invZ was invalid");
    return { x: ax, y: ay };
  });
  const assertValidMemo = memoized((p) => {
    const { a, d } = CURVE;
    if (p.is0())
      throw new Error("bad point: ZERO");
    const { ex: X, ey: Y, ez: Z, et: T } = p;
    const X2 = modP(X * X);
    const Y2 = modP(Y * Y);
    const Z2 = modP(Z * Z);
    const Z4 = modP(Z2 * Z2);
    const aX2 = modP(X2 * a);
    const left = modP(Z2 * modP(aX2 + Y2));
    const right = modP(Z4 + modP(d * modP(X2 * Y2)));
    if (left !== right)
      throw new Error("bad point: equation left != right (1)");
    const XY = modP(X * Y);
    const ZT = modP(Z * T);
    if (XY !== ZT)
      throw new Error("bad point: equation left != right (2)");
    return true;
  });
  class Point {
    constructor(ex, ey, ez, et) {
      aCoordinate("x", ex);
      aCoordinate("y", ey);
      aCoordinate("z", ez, true);
      aCoordinate("t", et);
      this.ex = ex;
      this.ey = ey;
      this.ez = ez;
      this.et = et;
      Object.freeze(this);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    static fromAffine(p) {
      if (p instanceof Point)
        throw new Error("extended point not allowed");
      const { x, y } = p || {};
      aCoordinate("x", x);
      aCoordinate("y", y);
      return new Point(x, y, _1n4, modP(x * y));
    }
    static normalizeZ(points) {
      const toInv = FpInvertBatch(Fp4, points.map((p) => p.ez));
      return points.map((p, i) => p.toAffine(toInv[i])).map(Point.fromAffine);
    }
    // Multiscalar Multiplication
    static msm(points, scalars) {
      return pippenger(Point, Fn, points, scalars);
    }
    // "Private method", don't use it directly
    _setWindowSize(windowSize) {
      wnaf.setWindowSize(this, windowSize);
    }
    // Not required for fromHex(), which always creates valid points.
    // Could be useful for fromAffine().
    assertValidity() {
      assertValidMemo(this);
    }
    // Compare one point to another.
    equals(other) {
      aextpoint(other);
      const { ex: X1, ey: Y1, ez: Z1 } = this;
      const { ex: X2, ey: Y2, ez: Z2 } = other;
      const X1Z2 = modP(X1 * Z2);
      const X2Z1 = modP(X2 * Z1);
      const Y1Z2 = modP(Y1 * Z2);
      const Y2Z1 = modP(Y2 * Z1);
      return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    negate() {
      return new Point(modP(-this.ex), this.ey, this.ez, modP(-this.et));
    }
    // Fast algo for doubling Extended Point.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
    // Cost: 4M + 4S + 1*a + 6add + 1*2.
    double() {
      const { a } = CURVE;
      const { ex: X1, ey: Y1, ez: Z1 } = this;
      const A = modP(X1 * X1);
      const B = modP(Y1 * Y1);
      const C = modP(_2n4 * modP(Z1 * Z1));
      const D = modP(a * A);
      const x1y1 = X1 + Y1;
      const E = modP(modP(x1y1 * x1y1) - A - B);
      const G2 = D + B;
      const F = G2 - C;
      const H = D - B;
      const X3 = modP(E * F);
      const Y3 = modP(G2 * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G2);
      return new Point(X3, Y3, Z3, T3);
    }
    // Fast algo for adding 2 Extended Points.
    // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
    // Cost: 9M + 1*a + 1*d + 7add.
    add(other) {
      aextpoint(other);
      const { a, d } = CURVE;
      const { ex: X1, ey: Y1, ez: Z1, et: T12 } = this;
      const { ex: X2, ey: Y2, ez: Z2, et: T2 } = other;
      const A = modP(X1 * X2);
      const B = modP(Y1 * Y2);
      const C = modP(T12 * d * T2);
      const D = modP(Z1 * Z2);
      const E = modP((X1 + Y1) * (X2 + Y2) - A - B);
      const F = D - C;
      const G2 = D + C;
      const H = modP(B - a * A);
      const X3 = modP(E * F);
      const Y3 = modP(G2 * H);
      const T3 = modP(E * H);
      const Z3 = modP(F * G2);
      return new Point(X3, Y3, Z3, T3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    wNAF(n) {
      return wnaf.wNAFCached(this, n, Point.normalizeZ);
    }
    // Constant-time multiplication.
    multiply(scalar) {
      const n = scalar;
      aInRange("scalar", n, _1n4, CURVE_ORDER);
      const { p, f } = this.wNAF(n);
      return Point.normalizeZ([p, f])[0];
    }
    // Non-constant-time multiplication. Uses double-and-add algorithm.
    // It's faster, but should only be used when you don't care about
    // an exposed private key e.g. sig verification.
    // Does NOT allow scalars higher than CURVE.n.
    // Accepts optional accumulator to merge with multiply (important for sparse scalars)
    multiplyUnsafe(scalar, acc = Point.ZERO) {
      const n = scalar;
      aInRange("scalar", n, _0n4, CURVE_ORDER);
      if (n === _0n4)
        return I;
      if (this.is0() || n === _1n4)
        return this;
      return wnaf.wNAFCachedUnsafe(this, n, Point.normalizeZ, acc);
    }
    // Checks if point is of small order.
    // If you add something to small order point, you will have "dirty"
    // point with torsion component.
    // Multiplies point by cofactor and checks if the result is 0.
    isSmallOrder() {
      return this.multiplyUnsafe(cofactor).is0();
    }
    // Multiplies point by curve order and checks if the result is 0.
    // Returns `false` is the point is dirty.
    isTorsionFree() {
      return wnaf.unsafeLadder(this, CURVE_ORDER).is0();
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    toAffine(iz) {
      return toAffineMemo(this, iz);
    }
    clearCofactor() {
      const { h: cofactor2 } = CURVE;
      if (cofactor2 === _1n4)
        return this;
      return this.multiplyUnsafe(cofactor2);
    }
    // Converts hash string or Uint8Array to Point.
    // Uses algo from RFC8032 5.1.3.
    static fromHex(hex, zip215 = false) {
      const { d, a } = CURVE;
      const len = Fp4.BYTES;
      hex = ensureBytes("pointHex", hex, len);
      abool("zip215", zip215);
      const normed = hex.slice();
      const lastByte = hex[len - 1];
      normed[len - 1] = lastByte & ~128;
      const y = bytesToNumberLE(normed);
      const max = zip215 ? MASK : Fp4.ORDER;
      aInRange("pointHex.y", y, _0n4, max);
      const y2 = modP(y * y);
      const u = modP(y2 - _1n4);
      const v = modP(d * y2 - a);
      let { isValid, value: x } = uvRatio2(u, v);
      if (!isValid)
        throw new Error("Point.fromHex: invalid y coordinate");
      const isXOdd = (x & _1n4) === _1n4;
      const isLastByteOdd = (lastByte & 128) !== 0;
      if (!zip215 && x === _0n4 && isLastByteOdd)
        throw new Error("Point.fromHex: x=0 and x_0=1");
      if (isLastByteOdd !== isXOdd)
        x = modP(-x);
      return Point.fromAffine({ x, y });
    }
    static fromPrivateKey(privKey) {
      const { scalar } = getPrivateScalar(privKey);
      return G.multiply(scalar);
    }
    toRawBytes() {
      const { x, y } = this.toAffine();
      const bytes = numberToBytesLE(y, Fp4.BYTES);
      bytes[bytes.length - 1] |= x & _1n4 ? 128 : 0;
      return bytes;
    }
    toHex() {
      return bytesToHex(this.toRawBytes());
    }
  }
  Point.BASE = new Point(CURVE.Gx, CURVE.Gy, _1n4, modP(CURVE.Gx * CURVE.Gy));
  Point.ZERO = new Point(_0n4, _1n4, _1n4, _0n4);
  const { BASE: G, ZERO: I } = Point;
  const wnaf = wNAF(Point, nByteLength * 8);
  function modN(a) {
    return mod(a, CURVE_ORDER);
  }
  function modN_LE(hash8) {
    return modN(bytesToNumberLE(hash8));
  }
  function getPrivateScalar(key) {
    const len = Fp4.BYTES;
    key = ensureBytes("private key", key, len);
    const hashed = ensureBytes("hashed private key", cHash(key), 2 * len);
    const head = adjustScalarBytes2(hashed.slice(0, len));
    const prefix = hashed.slice(len, 2 * len);
    const scalar = modN_LE(head);
    return { head, prefix, scalar };
  }
  function getExtendedPublicKey(key) {
    const { head, prefix, scalar } = getPrivateScalar(key);
    const point = G.multiply(scalar);
    const pointBytes = point.toRawBytes();
    return { head, prefix, scalar, point, pointBytes };
  }
  function getPublicKey6(privKey) {
    return getExtendedPublicKey(privKey).pointBytes;
  }
  function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
    const msg = concatBytes(...msgs);
    return modN_LE(cHash(domain(msg, ensureBytes("context", context), !!prehash)));
  }
  function sign7(msg, privKey, options = {}) {
    msg = ensureBytes("message", msg);
    if (prehash)
      msg = prehash(msg);
    const { prefix, scalar, pointBytes } = getExtendedPublicKey(privKey);
    const r = hashDomainToScalar(options.context, prefix, msg);
    const R = G.multiply(r).toRawBytes();
    const k = hashDomainToScalar(options.context, R, pointBytes, msg);
    const s = modN(r + k * scalar);
    aInRange("signature.s", s, _0n4, CURVE_ORDER);
    const res = concatBytes(R, numberToBytesLE(s, Fp4.BYTES));
    return ensureBytes("result", res, Fp4.BYTES * 2);
  }
  const verifyOpts = VERIFY_DEFAULT;
  function verify7(sig, msg, publicKey, options = verifyOpts) {
    const { context, zip215 } = options;
    const len = Fp4.BYTES;
    sig = ensureBytes("signature", sig, 2 * len);
    msg = ensureBytes("message", msg);
    publicKey = ensureBytes("publicKey", publicKey, len);
    if (zip215 !== void 0)
      abool("zip215", zip215);
    if (prehash)
      msg = prehash(msg);
    const s = bytesToNumberLE(sig.slice(len, 2 * len));
    let A, R, SB;
    try {
      A = Point.fromHex(publicKey, zip215);
      R = Point.fromHex(sig.slice(0, len), zip215);
      SB = G.multiplyUnsafe(s);
    } catch (error) {
      return false;
    }
    if (!zip215 && A.isSmallOrder())
      return false;
    const k = hashDomainToScalar(context, R.toRawBytes(), A.toRawBytes(), msg);
    const RkA = R.add(A.multiplyUnsafe(k));
    return RkA.subtract(SB).clearCofactor().equals(Point.ZERO);
  }
  G._setWindowSize(8);
  const utils2 = {
    getExtendedPublicKey,
    /** ed25519 priv keys are uniform 32b. No need to check for modulo bias, like in secp256k1. */
    randomPrivateKey: () => randomBytes2(Fp4.BYTES),
    /**
     * We're doing scalar multiplication (used in getPublicKey etc) with precomputed BASE_POINT
     * values. This slows down first getPublicKey() by milliseconds (see Speed section),
     * but allows to speed-up subsequent getPublicKey() calls up to 20x.
     * @param windowSize 2, 4, 8, 16
     */
    precompute(windowSize = 8, point = Point.BASE) {
      point._setWindowSize(windowSize);
      point.multiply(BigInt(3));
      return point;
    }
  };
  return {
    CURVE,
    getPublicKey: getPublicKey6,
    sign: sign7,
    verify: verify7,
    ExtendedPoint: Point,
    utils: utils2
  };
}

// node_modules/@noble/curves/esm/abstract/montgomery.js
var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
var _2n5 = BigInt(2);
function validateOpts2(curve) {
  validateObject(curve, {
    adjustScalarBytes: "function",
    powPminus2: "function"
  });
  return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
  const CURVE = validateOpts2(curveDef);
  const { P, type: type6, adjustScalarBytes: adjustScalarBytes2, powPminus2 } = CURVE;
  const is25519 = type6 === "x25519";
  if (!is25519 && type6 !== "x448")
    throw new Error("invalid type");
  const montgomeryBits = is25519 ? 255 : 448;
  const fieldLen = is25519 ? 32 : 56;
  const Gu = is25519 ? BigInt(9) : BigInt(5);
  const a24 = is25519 ? BigInt(121665) : BigInt(39081);
  const minScalar = is25519 ? _2n5 ** BigInt(254) : _2n5 ** BigInt(447);
  const maxAdded = is25519 ? BigInt(8) * _2n5 ** BigInt(251) - _1n5 : BigInt(4) * _2n5 ** BigInt(445) - _1n5;
  const maxScalar = minScalar + maxAdded + _1n5;
  const modP = (n) => mod(n, P);
  const GuBytes = encodeU(Gu);
  function encodeU(u) {
    return numberToBytesLE(modP(u), fieldLen);
  }
  function decodeU(u) {
    const _u = ensureBytes("u coordinate", u, fieldLen);
    if (is25519)
      _u[31] &= 127;
    return modP(bytesToNumberLE(_u));
  }
  function decodeScalar(scalar) {
    return bytesToNumberLE(adjustScalarBytes2(ensureBytes("scalar", scalar, fieldLen)));
  }
  function scalarMult(scalar, u) {
    const pu = montgomeryLadder(decodeU(u), decodeScalar(scalar));
    if (pu === _0n5)
      throw new Error("invalid private or public key received");
    return encodeU(pu);
  }
  function scalarMultBase(scalar) {
    return scalarMult(scalar, GuBytes);
  }
  function cswap(swap, x_2, x_3) {
    const dummy = modP(swap * (x_2 - x_3));
    x_2 = modP(x_2 - dummy);
    x_3 = modP(x_3 + dummy);
    return { x_2, x_3 };
  }
  function montgomeryLadder(u, scalar) {
    aInRange("u", u, _0n5, P);
    aInRange("scalar", scalar, minScalar, maxScalar);
    const k = scalar;
    const x_1 = u;
    let x_2 = _1n5;
    let z_2 = _0n5;
    let x_3 = u;
    let z_3 = _1n5;
    let swap = _0n5;
    for (let t = BigInt(montgomeryBits - 1); t >= _0n5; t--) {
      const k_t = k >> t & _1n5;
      swap ^= k_t;
      ({ x_2, x_3 } = cswap(swap, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
      swap = k_t;
      const A = x_2 + z_2;
      const AA = modP(A * A);
      const B = x_2 - z_2;
      const BB = modP(B * B);
      const E = AA - BB;
      const C = x_3 + z_3;
      const D = x_3 - z_3;
      const DA = modP(D * A);
      const CB = modP(C * B);
      const dacb = DA + CB;
      const da_cb = DA - CB;
      x_3 = modP(dacb * dacb);
      z_3 = modP(x_1 * modP(da_cb * da_cb));
      x_2 = modP(AA * BB);
      z_2 = modP(E * (AA + modP(a24 * E)));
    }
    ({ x_2, x_3 } = cswap(swap, x_2, x_3));
    ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
    const z2 = powPminus2(z_2);
    return modP(x_2 * z2);
  }
  return {
    scalarMult,
    scalarMultBase,
    getSharedSecret: (privateKey, publicKey) => scalarMult(privateKey, publicKey),
    getPublicKey: (privateKey) => scalarMultBase(privateKey),
    utils: { randomPrivateKey: () => CURVE.randomBytes(fieldLen) },
    GuBytes: GuBytes.slice()
  };
}

// node_modules/@noble/curves/esm/ed25519.js
var ED25519_P = BigInt("57896044618658097711785492504343953926634992332820282019728792003956564819949");
var ED25519_SQRT_M1 = /* @__PURE__ */ BigInt("19681161376707505956807079304988542015446066515923890162744021073123829784752");
var _0n6 = BigInt(0);
var _1n6 = BigInt(1);
var _2n6 = BigInt(2);
var _3n4 = BigInt(3);
var _5n = BigInt(5);
var _8n2 = BigInt(8);
function ed25519_pow_2_252_3(x) {
  const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
  const P = ED25519_P;
  const x2 = x * x % P;
  const b2 = x2 * x % P;
  const b4 = pow2(b2, _2n6, P) * b2 % P;
  const b5 = pow2(b4, _1n6, P) * x % P;
  const b10 = pow2(b5, _5n, P) * b5 % P;
  const b20 = pow2(b10, _10n, P) * b10 % P;
  const b40 = pow2(b20, _20n, P) * b20 % P;
  const b80 = pow2(b40, _40n, P) * b40 % P;
  const b160 = pow2(b80, _80n, P) * b80 % P;
  const b240 = pow2(b160, _80n, P) * b80 % P;
  const b250 = pow2(b240, _10n, P) * b10 % P;
  const pow_p_5_8 = pow2(b250, _2n6, P) * x % P;
  return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
  bytes[0] &= 248;
  bytes[31] &= 127;
  bytes[31] |= 64;
  return bytes;
}
function uvRatio(u, v) {
  const P = ED25519_P;
  const v3 = mod(v * v * v, P);
  const v7 = mod(v3 * v3 * v, P);
  const pow = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
  let x = mod(u * v3 * pow, P);
  const vx2 = mod(v * x * x, P);
  const root1 = x;
  const root2 = mod(x * ED25519_SQRT_M1, P);
  const useRoot1 = vx2 === u;
  const useRoot2 = vx2 === mod(-u, P);
  const noRoot = vx2 === mod(-u * ED25519_SQRT_M1, P);
  if (useRoot1)
    x = root1;
  if (useRoot2 || noRoot)
    x = root2;
  if (isNegativeLE(x, P))
    x = mod(-x, P);
  return { isValid: useRoot1 || useRoot2, value: x };
}
var Fp3 = /* @__PURE__ */ (() => Field(ED25519_P, void 0, true))();
var ed25519Defaults = /* @__PURE__ */ (() => ({
  // Removing Fp.create() will still work, and is 10% faster on sign
  a: Fp3.create(BigInt(-1)),
  // d is -121665/121666 a.k.a. Fp.neg(121665 * Fp.inv(121666))
  d: BigInt("37095705934669439343138083508754565189542113879843219016388785533085940283555"),
  // Finite field 2n**255n - 19n
  Fp: Fp3,
  // Subgroup order 2n**252n + 27742317777372353535851937790883648493n;
  n: BigInt("7237005577332262213973186563042994240857116359379907606001950938285454250989"),
  h: _8n2,
  Gx: BigInt("15112221349535400772501151409588531511454012693041857206046113283949847762202"),
  Gy: BigInt("46316835694926478169428394003475163141307993866256225615783033603165251855960"),
  hash: sha512,
  randomBytes,
  adjustScalarBytes,
  // dom2
  // Ratio of u to v. Allows us to combine inversion and square root. Uses algo from RFC8032 5.1.3.
  // Constant-time, u/√v
  uvRatio
}))();
var ed25519 = /* @__PURE__ */ (() => twistedEdwards(ed25519Defaults))();
var x25519 = /* @__PURE__ */ (() => montgomery({
  P: ED25519_P,
  type: "x25519",
  powPminus2: (x) => {
    const P = ED25519_P;
    const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
    return mod(pow2(pow_p_5_8, _3n4, P) * b2, P);
  },
  adjustScalarBytes,
  randomBytes
}))();

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Ed25519.js
var noble2 = ed25519;
function createKeyPair2(options = {}) {
  const { as = "Hex" } = options;
  const privateKey = randomPrivateKey2({ as });
  const publicKey = getPublicKey2({ privateKey, as });
  return {
    privateKey,
    publicKey
  };
}
function getPublicKey2(options) {
  const { as = "Hex", privateKey } = options;
  const privateKeyBytes = from3(privateKey);
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  if (as === "Hex")
    return fromBytes(publicKeyBytes);
  return publicKeyBytes;
}
function randomPrivateKey2(options = {}) {
  const { as = "Hex" } = options;
  const bytes = ed25519.utils.randomPrivateKey();
  if (as === "Hex")
    return fromBytes(bytes);
  return bytes;
}
function sign2(options) {
  const { as = "Hex", payload, privateKey } = options;
  const payloadBytes = from3(payload);
  const privateKeyBytes = from3(privateKey);
  const signatureBytes = ed25519.sign(payloadBytes, privateKeyBytes);
  if (as === "Hex")
    return fromBytes(signatureBytes);
  return signatureBytes;
}
function verify2(options) {
  const { payload, publicKey, signature } = options;
  const payloadBytes = from3(payload);
  const publicKeyBytes = from3(publicKey);
  const signatureBytes = from3(signature);
  return ed25519.verify(signatureBytes, payloadBytes, publicKeyBytes);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Ens.js
var Ens_exports = {};
__export(Ens_exports, {
  labelhash: () => labelhash,
  namehash: () => namehash,
  normalize: () => normalize
});

// node_modules/@adraffy/ens-normalize/dist/index.mjs
var COMPRESSED$1 = "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";
var FENCED = /* @__PURE__ */ new Map([[8217, "apostrophe"], [8260, "fraction slash"], [12539, "middle dot"]]);
var NSM_MAX = 4;
function decode_arithmetic(bytes) {
  let pos = 0;
  function u16() {
    return bytes[pos++] << 8 | bytes[pos++];
  }
  let symbol_count = u16();
  let total = 1;
  let acc = [0, 1];
  for (let i = 1; i < symbol_count; i++) {
    acc.push(total += u16());
  }
  let skip = u16();
  let pos_payload = pos;
  pos += skip;
  let read_width = 0;
  let read_buffer = 0;
  function read_bit() {
    if (read_width == 0) {
      read_buffer = read_buffer << 8 | bytes[pos++];
      read_width = 8;
    }
    return read_buffer >> --read_width & 1;
  }
  const N = 31;
  const FULL = 2 ** N;
  const HALF = FULL >>> 1;
  const QRTR = HALF >> 1;
  const MASK = FULL - 1;
  let register = 0;
  for (let i = 0; i < N; i++) register = register << 1 | read_bit();
  let symbols = [];
  let low = 0;
  let range = FULL;
  while (true) {
    let value = Math.floor(((register - low + 1) * total - 1) / range);
    let start = 0;
    let end = symbol_count;
    while (end - start > 1) {
      let mid = start + end >>> 1;
      if (value < acc[mid]) {
        end = mid;
      } else {
        start = mid;
      }
    }
    if (start == 0) break;
    symbols.push(start);
    let a = low + Math.floor(range * acc[start] / total);
    let b = low + Math.floor(range * acc[start + 1] / total) - 1;
    while (((a ^ b) & HALF) == 0) {
      register = register << 1 & MASK | read_bit();
      a = a << 1 & MASK;
      b = b << 1 & MASK | 1;
    }
    while (a & ~b & QRTR) {
      register = register & HALF | register << 1 & MASK >>> 1 | read_bit();
      a = a << 1 ^ HALF;
      b = (b ^ HALF) << 1 | HALF | 1;
    }
    low = a;
    range = 1 + b - a;
  }
  let offset = symbol_count - 4;
  return symbols.map((x) => {
    switch (x - offset) {
      case 3:
        return offset + 65792 + (bytes[pos_payload++] << 16 | bytes[pos_payload++] << 8 | bytes[pos_payload++]);
      case 2:
        return offset + 256 + (bytes[pos_payload++] << 8 | bytes[pos_payload++]);
      case 1:
        return offset + bytes[pos_payload++];
      default:
        return x - 1;
    }
  });
}
function read_payload(v) {
  let pos = 0;
  return () => v[pos++];
}
function read_compressed_payload(s) {
  return read_payload(decode_arithmetic(unsafe_atob(s)));
}
function unsafe_atob(s) {
  let lookup = [];
  [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].forEach((c, i) => lookup[c.charCodeAt(0)] = i);
  let n = s.length;
  let ret = new Uint8Array(6 * n >> 3);
  for (let i = 0, pos = 0, width = 0, carry = 0; i < n; i++) {
    carry = carry << 6 | lookup[s.charCodeAt(i)];
    width += 6;
    if (width >= 8) {
      ret[pos++] = carry >> (width -= 8);
    }
  }
  return ret;
}
function signed(i) {
  return i & 1 ? ~i >> 1 : i >> 1;
}
function read_deltas(n, next) {
  let v = Array(n);
  for (let i = 0, x = 0; i < n; i++) v[i] = x += signed(next());
  return v;
}
function read_sorted(next, prev = 0) {
  let ret = [];
  while (true) {
    let x = next();
    let n = next();
    if (!n) break;
    prev += x;
    for (let i = 0; i < n; i++) {
      ret.push(prev + i);
    }
    prev += n + 1;
  }
  return ret;
}
function read_sorted_arrays(next) {
  return read_array_while(() => {
    let v = read_sorted(next);
    if (v.length) return v;
  });
}
function read_mapped(next) {
  let ret = [];
  while (true) {
    let w = next();
    if (w == 0) break;
    ret.push(read_linear_table(w, next));
  }
  while (true) {
    let w = next() - 1;
    if (w < 0) break;
    ret.push(read_replacement_table(w, next));
  }
  return ret.flat();
}
function read_array_while(next) {
  let v = [];
  while (true) {
    let x = next(v.length);
    if (!x) break;
    v.push(x);
  }
  return v;
}
function read_transposed(n, w, next) {
  let m = Array(n).fill().map(() => []);
  for (let i = 0; i < w; i++) {
    read_deltas(n, next).forEach((x, j) => m[j].push(x));
  }
  return m;
}
function read_linear_table(w, next) {
  let dx = 1 + next();
  let dy = next();
  let vN = read_array_while(next);
  let m = read_transposed(vN.length, 1 + w, next);
  return m.flatMap((v, i) => {
    let [x, ...ys] = v;
    return Array(vN[i]).fill().map((_, j) => {
      let j_dy = j * dy;
      return [x + j * dx, ys.map((y) => y + j_dy)];
    });
  });
}
function read_replacement_table(w, next) {
  let n = 1 + next();
  let m = read_transposed(n, 1 + w, next);
  return m.map((v) => [v[0], v.slice(1)]);
}
function read_trie(next) {
  let ret = [];
  let sorted = read_sorted(next);
  expand(decode6([]), []);
  return ret;
  function decode6(Q) {
    let S = next();
    let B = read_array_while(() => {
      let cps = read_sorted(next).map((i) => sorted[i]);
      if (cps.length) return decode6(cps);
    });
    return { S, B, Q };
  }
  function expand({ S, B }, cps, saved) {
    if (S & 4 && saved === cps[cps.length - 1]) return;
    if (S & 2) saved = cps[cps.length - 1];
    if (S & 1) ret.push(cps);
    for (let br of B) {
      for (let cp of br.Q) {
        expand(br, [...cps, cp], saved);
      }
    }
  }
}
function hex_cp(cp) {
  return cp.toString(16).toUpperCase().padStart(2, "0");
}
function quote_cp(cp) {
  return `{${hex_cp(cp)}}`;
}
function explode_cp(s) {
  let cps = [];
  for (let pos = 0, len = s.length; pos < len; ) {
    let cp = s.codePointAt(pos);
    pos += cp < 65536 ? 1 : 2;
    cps.push(cp);
  }
  return cps;
}
function str_from_cps(cps) {
  const chunk = 4096;
  let len = cps.length;
  if (len < chunk) return String.fromCodePoint(...cps);
  let buf = [];
  for (let i = 0; i < len; ) {
    buf.push(String.fromCodePoint(...cps.slice(i, i += chunk)));
  }
  return buf.join("");
}
function compare_arrays(a, b) {
  let n = a.length;
  let c = n - b.length;
  for (let i = 0; c == 0 && i < n; i++) c = a[i] - b[i];
  return c;
}
var COMPRESSED = "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";
var S0 = 44032;
var L0 = 4352;
var V0 = 4449;
var T0 = 4519;
var L_COUNT = 19;
var V_COUNT = 21;
var T_COUNT = 28;
var N_COUNT = V_COUNT * T_COUNT;
var S_COUNT = L_COUNT * N_COUNT;
var S1 = S0 + S_COUNT;
var L1 = L0 + L_COUNT;
var V1 = V0 + V_COUNT;
var T1 = T0 + T_COUNT;
function unpack_cc(packed) {
  return packed >> 24 & 255;
}
function unpack_cp(packed) {
  return packed & 16777215;
}
var SHIFTED_RANK;
var EXCLUSIONS;
var DECOMP;
var RECOMP;
function init$1() {
  let r = read_compressed_payload(COMPRESSED);
  SHIFTED_RANK = new Map(read_sorted_arrays(r).flatMap((v, i) => v.map((x) => [x, i + 1 << 24])));
  EXCLUSIONS = new Set(read_sorted(r));
  DECOMP = /* @__PURE__ */ new Map();
  RECOMP = /* @__PURE__ */ new Map();
  for (let [cp, cps] of read_mapped(r)) {
    if (!EXCLUSIONS.has(cp) && cps.length == 2) {
      let [a, b] = cps;
      let bucket = RECOMP.get(a);
      if (!bucket) {
        bucket = /* @__PURE__ */ new Map();
        RECOMP.set(a, bucket);
      }
      bucket.set(b, cp);
    }
    DECOMP.set(cp, cps.reverse());
  }
}
function is_hangul(cp) {
  return cp >= S0 && cp < S1;
}
function compose_pair(a, b) {
  if (a >= L0 && a < L1 && b >= V0 && b < V1) {
    return S0 + (a - L0) * N_COUNT + (b - V0) * T_COUNT;
  } else if (is_hangul(a) && b > T0 && b < T1 && (a - S0) % T_COUNT == 0) {
    return a + (b - T0);
  } else {
    let recomp = RECOMP.get(a);
    if (recomp) {
      recomp = recomp.get(b);
      if (recomp) {
        return recomp;
      }
    }
    return -1;
  }
}
function decomposed(cps) {
  if (!SHIFTED_RANK) init$1();
  let ret = [];
  let buf = [];
  let check_order = false;
  function add(cp) {
    let cc = SHIFTED_RANK.get(cp);
    if (cc) {
      check_order = true;
      cp |= cc;
    }
    ret.push(cp);
  }
  for (let cp of cps) {
    while (true) {
      if (cp < 128) {
        ret.push(cp);
      } else if (is_hangul(cp)) {
        let s_index = cp - S0;
        let l_index = s_index / N_COUNT | 0;
        let v_index = s_index % N_COUNT / T_COUNT | 0;
        let t_index = s_index % T_COUNT;
        add(L0 + l_index);
        add(V0 + v_index);
        if (t_index > 0) add(T0 + t_index);
      } else {
        let mapped = DECOMP.get(cp);
        if (mapped) {
          buf.push(...mapped);
        } else {
          add(cp);
        }
      }
      if (!buf.length) break;
      cp = buf.pop();
    }
  }
  if (check_order && ret.length > 1) {
    let prev_cc = unpack_cc(ret[0]);
    for (let i = 1; i < ret.length; i++) {
      let cc = unpack_cc(ret[i]);
      if (cc == 0 || prev_cc <= cc) {
        prev_cc = cc;
        continue;
      }
      let j = i - 1;
      while (true) {
        let tmp = ret[j + 1];
        ret[j + 1] = ret[j];
        ret[j] = tmp;
        if (!j) break;
        prev_cc = unpack_cc(ret[--j]);
        if (prev_cc <= cc) break;
      }
      prev_cc = unpack_cc(ret[i]);
    }
  }
  return ret;
}
function composed_from_decomposed(v) {
  let ret = [];
  let stack = [];
  let prev_cp = -1;
  let prev_cc = 0;
  for (let packed of v) {
    let cc = unpack_cc(packed);
    let cp = unpack_cp(packed);
    if (prev_cp == -1) {
      if (cc == 0) {
        prev_cp = cp;
      } else {
        ret.push(cp);
      }
    } else if (prev_cc > 0 && prev_cc >= cc) {
      if (cc == 0) {
        ret.push(prev_cp, ...stack);
        stack.length = 0;
        prev_cp = cp;
      } else {
        stack.push(cp);
      }
      prev_cc = cc;
    } else {
      let composed = compose_pair(prev_cp, cp);
      if (composed >= 0) {
        prev_cp = composed;
      } else if (prev_cc == 0 && cc == 0) {
        ret.push(prev_cp);
        prev_cp = cp;
      } else {
        stack.push(cp);
        prev_cc = cc;
      }
    }
  }
  if (prev_cp >= 0) {
    ret.push(prev_cp, ...stack);
  }
  return ret;
}
function nfd(cps) {
  return decomposed(cps).map(unpack_cp);
}
function nfc(cps) {
  return composed_from_decomposed(decomposed(cps));
}
var HYPHEN = 45;
var STOP_CH = ".";
var FE0F = 65039;
var UNIQUE_PH = 1;
var Array_from = (x) => Array.from(x);
function group_has_cp(g, cp) {
  return g.P.has(cp) || g.Q.has(cp);
}
var Emoji = class extends Array {
  get is_emoji() {
    return true;
  }
  // free tagging system
};
var MAPPED;
var IGNORED;
var CM;
var NSM;
var ESCAPE;
var NFC_CHECK;
var GROUPS;
var WHOLE_VALID;
var WHOLE_MAP;
var VALID;
var EMOJI_LIST;
var EMOJI_ROOT;
function init() {
  if (MAPPED) return;
  let r = read_compressed_payload(COMPRESSED$1);
  const read_sorted_array = () => read_sorted(r);
  const read_sorted_set = () => new Set(read_sorted_array());
  const set_add_many = (set, v) => v.forEach((x) => set.add(x));
  MAPPED = new Map(read_mapped(r));
  IGNORED = read_sorted_set();
  CM = read_sorted_array();
  NSM = new Set(read_sorted_array().map((i) => CM[i]));
  CM = new Set(CM);
  ESCAPE = read_sorted_set();
  NFC_CHECK = read_sorted_set();
  let chunks = read_sorted_arrays(r);
  let unrestricted = r();
  const read_chunked = () => {
    let set = /* @__PURE__ */ new Set();
    read_sorted_array().forEach((i) => set_add_many(set, chunks[i]));
    set_add_many(set, read_sorted_array());
    return set;
  };
  GROUPS = read_array_while((i) => {
    let N = read_array_while(r).map((x) => x + 96);
    if (N.length) {
      let R = i >= unrestricted;
      N[0] -= 32;
      N = str_from_cps(N);
      if (R) N = `Restricted[${N}]`;
      let P = read_chunked();
      let Q = read_chunked();
      let M = !r();
      return { N, P, Q, M, R };
    }
  });
  WHOLE_VALID = read_sorted_set();
  WHOLE_MAP = /* @__PURE__ */ new Map();
  let wholes = read_sorted_array().concat(Array_from(WHOLE_VALID)).sort((a, b) => a - b);
  wholes.forEach((cp, i) => {
    let d = r();
    let w = wholes[i] = d ? wholes[i - d] : { V: [], M: /* @__PURE__ */ new Map() };
    w.V.push(cp);
    if (!WHOLE_VALID.has(cp)) {
      WHOLE_MAP.set(cp, w);
    }
  });
  for (let { V, M } of new Set(WHOLE_MAP.values())) {
    let recs = [];
    for (let cp of V) {
      let gs = GROUPS.filter((g) => group_has_cp(g, cp));
      let rec = recs.find(({ G }) => gs.some((g) => G.has(g)));
      if (!rec) {
        rec = { G: /* @__PURE__ */ new Set(), V: [] };
        recs.push(rec);
      }
      rec.V.push(cp);
      set_add_many(rec.G, gs);
    }
    let union = recs.flatMap((x) => Array_from(x.G));
    for (let { G, V: V2 } of recs) {
      let complement = new Set(union.filter((g) => !G.has(g)));
      for (let cp of V2) {
        M.set(cp, complement);
      }
    }
  }
  VALID = /* @__PURE__ */ new Set();
  let multi = /* @__PURE__ */ new Set();
  const add_to_union = (cp) => VALID.has(cp) ? multi.add(cp) : VALID.add(cp);
  for (let g of GROUPS) {
    for (let cp of g.P) add_to_union(cp);
    for (let cp of g.Q) add_to_union(cp);
  }
  for (let cp of VALID) {
    if (!WHOLE_MAP.has(cp) && !multi.has(cp)) {
      WHOLE_MAP.set(cp, UNIQUE_PH);
    }
  }
  set_add_many(VALID, nfd(VALID));
  EMOJI_LIST = read_trie(r).map((v) => Emoji.from(v)).sort(compare_arrays);
  EMOJI_ROOT = /* @__PURE__ */ new Map();
  for (let cps of EMOJI_LIST) {
    let prev = [EMOJI_ROOT];
    for (let cp of cps) {
      let next = prev.map((node) => {
        let child = node.get(cp);
        if (!child) {
          child = /* @__PURE__ */ new Map();
          node.set(cp, child);
        }
        return child;
      });
      if (cp === FE0F) {
        prev.push(...next);
      } else {
        prev = next;
      }
    }
    for (let x of prev) {
      x.V = cps;
    }
  }
}
function quoted_cp(cp) {
  return (should_escape(cp) ? "" : `${bidi_qq(safe_str_from_cps([cp]))} `) + quote_cp(cp);
}
function bidi_qq(s) {
  return `"${s}"\u200E`;
}
function check_label_extension(cps) {
  if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) {
    throw new Error(`invalid label extension: "${str_from_cps(cps.slice(0, 4))}"`);
  }
}
function check_leading_underscore(cps) {
  const UNDERSCORE = 95;
  for (let i = cps.lastIndexOf(UNDERSCORE); i > 0; ) {
    if (cps[--i] !== UNDERSCORE) {
      throw new Error("underscore allowed only at start");
    }
  }
}
function check_fenced(cps) {
  let cp = cps[0];
  let prev = FENCED.get(cp);
  if (prev) throw error_placement(`leading ${prev}`);
  let n = cps.length;
  let last = -1;
  for (let i = 1; i < n; i++) {
    cp = cps[i];
    let match = FENCED.get(cp);
    if (match) {
      if (last == i) throw error_placement(`${prev} + ${match}`);
      last = i + 1;
      prev = match;
    }
  }
  if (last == n) throw error_placement(`trailing ${prev}`);
}
function safe_str_from_cps(cps, max = Infinity, quoter = quote_cp) {
  let buf = [];
  if (is_combining_mark(cps[0])) buf.push("\u25CC");
  if (cps.length > max) {
    max >>= 1;
    cps = [...cps.slice(0, max), 8230, ...cps.slice(-max)];
  }
  let prev = 0;
  let n = cps.length;
  for (let i = 0; i < n; i++) {
    let cp = cps[i];
    if (should_escape(cp)) {
      buf.push(str_from_cps(cps.slice(prev, i)));
      buf.push(quoter(cp));
      prev = i + 1;
    }
  }
  buf.push(str_from_cps(cps.slice(prev, n)));
  return buf.join("");
}
function is_combining_mark(cp, only_nsm) {
  init();
  return only_nsm ? NSM.has(cp) : CM.has(cp);
}
function should_escape(cp) {
  init();
  return ESCAPE.has(cp);
}
function ens_normalize(name) {
  return flatten(split(name, nfc, filter_fe0f));
}
function split(name, nf, ef) {
  if (!name) return [];
  init();
  let offset = 0;
  return name.split(STOP_CH).map((label) => {
    let input = explode_cp(label);
    let info = {
      input,
      offset
      // codepoint, not substring!
    };
    offset += input.length + 1;
    try {
      let tokens = info.tokens = tokens_from_str(input, nf, ef);
      let token_count = tokens.length;
      let type6;
      if (!token_count) {
        throw new Error(`empty label`);
      }
      let norm = info.output = tokens.flat();
      check_leading_underscore(norm);
      let emoji = info.emoji = token_count > 1 || tokens[0].is_emoji;
      if (!emoji && norm.every((cp) => cp < 128)) {
        check_label_extension(norm);
        type6 = "ASCII";
      } else {
        let chars = tokens.flatMap((x) => x.is_emoji ? [] : x);
        if (!chars.length) {
          type6 = "Emoji";
        } else {
          if (CM.has(norm[0])) throw error_placement("leading combining mark");
          for (let i = 1; i < token_count; i++) {
            let cps = tokens[i];
            if (!cps.is_emoji && CM.has(cps[0])) {
              throw error_placement(`emoji + combining mark: "${str_from_cps(tokens[i - 1])} + ${safe_str_from_cps([cps[0]])}"`);
            }
          }
          check_fenced(norm);
          let unique = Array_from(new Set(chars));
          let [g] = determine_group(unique);
          check_group(g, chars);
          check_whole(g, unique);
          type6 = g.N;
        }
      }
      info.type = type6;
    } catch (err) {
      info.error = err;
    }
    return info;
  });
}
function check_whole(group, unique) {
  let maker;
  let shared = [];
  for (let cp of unique) {
    let whole = WHOLE_MAP.get(cp);
    if (whole === UNIQUE_PH) return;
    if (whole) {
      let set = whole.M.get(cp);
      maker = maker ? maker.filter((g) => set.has(g)) : Array_from(set);
      if (!maker.length) return;
    } else {
      shared.push(cp);
    }
  }
  if (maker) {
    for (let g of maker) {
      if (shared.every((cp) => group_has_cp(g, cp))) {
        throw new Error(`whole-script confusable: ${group.N}/${g.N}`);
      }
    }
  }
}
function determine_group(unique) {
  let groups = GROUPS;
  for (let cp of unique) {
    let gs = groups.filter((g) => group_has_cp(g, cp));
    if (!gs.length) {
      if (!GROUPS.some((g) => group_has_cp(g, cp))) {
        throw error_disallowed(cp);
      } else {
        throw error_group_member(groups[0], cp);
      }
    }
    groups = gs;
    if (gs.length == 1) break;
  }
  return groups;
}
function flatten(split2) {
  return split2.map(({ input, error, output }) => {
    if (error) {
      let msg = error.message;
      throw new Error(split2.length == 1 ? msg : `Invalid label ${bidi_qq(safe_str_from_cps(input, 63))}: ${msg}`);
    }
    return str_from_cps(output);
  }).join(STOP_CH);
}
function error_disallowed(cp) {
  return new Error(`disallowed character: ${quoted_cp(cp)}`);
}
function error_group_member(g, cp) {
  let quoted = quoted_cp(cp);
  let gg = GROUPS.find((g2) => g2.P.has(cp));
  if (gg) {
    quoted = `${gg.N} ${quoted}`;
  }
  return new Error(`illegal mixture: ${g.N} + ${quoted}`);
}
function error_placement(where) {
  return new Error(`illegal placement: ${where}`);
}
function check_group(g, cps) {
  for (let cp of cps) {
    if (!group_has_cp(g, cp)) {
      throw error_group_member(g, cp);
    }
  }
  if (g.M) {
    let decomposed2 = nfd(cps);
    for (let i = 1, e = decomposed2.length; i < e; i++) {
      if (NSM.has(decomposed2[i])) {
        let j = i + 1;
        for (let cp; j < e && NSM.has(cp = decomposed2[j]); j++) {
          for (let k = i; k < j; k++) {
            if (decomposed2[k] == cp) {
              throw new Error(`duplicate non-spacing marks: ${quoted_cp(cp)}`);
            }
          }
        }
        if (j - i > NSM_MAX) {
          throw new Error(`excessive non-spacing marks: ${bidi_qq(safe_str_from_cps(decomposed2.slice(i - 1, j)))} (${j - i}/${NSM_MAX})`);
        }
        i = j;
      }
    }
  }
}
function tokens_from_str(input, nf, ef) {
  let ret = [];
  let chars = [];
  input = input.slice().reverse();
  while (input.length) {
    let emoji = consume_emoji_reversed(input);
    if (emoji) {
      if (chars.length) {
        ret.push(nf(chars));
        chars = [];
      }
      ret.push(ef(emoji));
    } else {
      let cp = input.pop();
      if (VALID.has(cp)) {
        chars.push(cp);
      } else {
        let cps = MAPPED.get(cp);
        if (cps) {
          chars.push(...cps);
        } else if (!IGNORED.has(cp)) {
          throw error_disallowed(cp);
        }
      }
    }
  }
  if (chars.length) {
    ret.push(nf(chars));
  }
  return ret;
}
function filter_fe0f(cps) {
  return cps.filter((cp) => cp != FE0F);
}
function consume_emoji_reversed(cps, eaten) {
  let node = EMOJI_ROOT;
  let emoji;
  let pos = cps.length;
  while (pos) {
    node = node.get(cps[--pos]);
    if (!node) break;
    let { V } = node;
    if (V) {
      emoji = V;
      if (eaten) eaten.push(...cps.slice(pos).reverse());
      cps.length = pos;
    }
  }
  return emoji;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/ens.js
function unwrapLabelhash(label) {
  if (label.length !== 66)
    return null;
  if (label.indexOf("[") !== 0)
    return null;
  if (label.indexOf("]") !== 65)
    return null;
  const hash8 = `0x${label.slice(1, 65)}`;
  if (!validate(hash8, { strict: true }))
    return null;
  return hash8;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Ens.js
function labelhash(label) {
  const result = new Uint8Array(32).fill(0);
  if (!label)
    return fromBytes(result);
  return unwrapLabelhash(label) || keccak256(fromString(label));
}
function namehash(name) {
  let result = new Uint8Array(32).fill(0);
  if (!name)
    return fromBytes(result);
  const labels = name.split(".");
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const hashFromEncodedLabel = unwrapLabelhash(labels[i]);
    const hashed = hashFromEncodedLabel ? fromHex(hashFromEncodedLabel) : keccak256(fromString2(labels[i]), { as: "Bytes" });
    result = keccak256(concat2(result, hashed), { as: "Bytes" });
  }
  return fromBytes(result);
}
function normalize(name) {
  return ens_normalize(name);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Fee.js
var Fee_exports = {};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Filter.js
var Filter_exports = {};
__export(Filter_exports, {
  fromRpc: () => fromRpc7,
  toRpc: () => toRpc7
});
function fromRpc7(filter) {
  const { fromBlock, toBlock } = filter;
  return {
    ...filter,
    ...fromBlock && {
      fromBlock: validate(fromBlock, { strict: false }) ? BigInt(fromBlock) : fromBlock
    },
    ...toBlock && {
      toBlock: validate(toBlock, { strict: false }) ? BigInt(toBlock) : toBlock
    }
  };
}
function toRpc7(filter) {
  const { address, topics, fromBlock, toBlock } = filter;
  return {
    ...address && { address },
    ...topics && { topics },
    ...typeof fromBlock !== "undefined" ? {
      fromBlock: typeof fromBlock === "bigint" ? fromNumber(fromBlock) : fromBlock
    } : {},
    ...typeof toBlock !== "undefined" ? {
      toBlock: typeof toBlock === "bigint" ? fromNumber(toBlock) : toBlock
    } : {}
  };
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/HdKey.js
var HdKey_exports = {};
__export(HdKey_exports, {
  fromExtendedKey: () => fromExtendedKey,
  fromJson: () => fromJson,
  fromSeed: () => fromSeed,
  path: () => path
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Secp256k1.js
var Secp256k1_exports = {};
__export(Secp256k1_exports, {
  createKeyPair: () => createKeyPair3,
  getPublicKey: () => getPublicKey3,
  getSharedSecret: () => getSharedSecret,
  noble: () => noble3,
  randomPrivateKey: () => randomPrivateKey3,
  recoverAddress: () => recoverAddress,
  recoverPublicKey: () => recoverPublicKey,
  sign: () => sign3,
  verify: () => verify3
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/entropy.js
var extraEntropy = false;

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Secp256k1.js
var noble3 = secp256k1;
function createKeyPair3(options = {}) {
  const { as = "Hex" } = options;
  const privateKey = randomPrivateKey3({ as });
  const publicKey = getPublicKey3({ privateKey });
  return {
    privateKey,
    publicKey
  };
}
function getPublicKey3(options) {
  const { privateKey } = options;
  const point = secp256k1.ProjectivePoint.fromPrivateKey(from2(privateKey).slice(2));
  return from4(point);
}
function getSharedSecret(options) {
  const { as = "Hex", privateKey, publicKey } = options;
  const point = secp256k1.ProjectivePoint.fromHex(toHex2(publicKey).slice(2));
  const sharedPoint = point.multiply(secp256k1.utils.normPrivateKeyToScalar(from2(privateKey).slice(2)));
  const sharedSecret = sharedPoint.toRawBytes(true);
  if (as === "Hex")
    return fromBytes(sharedSecret);
  return sharedSecret;
}
function randomPrivateKey3(options = {}) {
  const { as = "Hex" } = options;
  const bytes = secp256k1.utils.randomPrivateKey();
  if (as === "Hex")
    return fromBytes(bytes);
  return bytes;
}
function recoverAddress(options) {
  return fromPublicKey(recoverPublicKey(options));
}
function recoverPublicKey(options) {
  const { payload, signature } = options;
  const { r, s, yParity } = signature;
  const signature_ = new secp256k1.Signature(BigInt(r), BigInt(s)).addRecoveryBit(yParity);
  const point = signature_.recoverPublicKey(from2(payload).substring(2));
  return from4(point);
}
function sign3(options) {
  const { extraEntropy: extraEntropy2 = extraEntropy, hash: hash8, payload, privateKey } = options;
  const { r, s, recovery } = secp256k1.sign(from3(payload), from3(privateKey), {
    extraEntropy: typeof extraEntropy2 === "boolean" ? extraEntropy2 : from2(extraEntropy2).slice(2),
    lowS: true,
    ...hash8 ? { prehash: true } : {}
  });
  return {
    r,
    s,
    yParity: recovery
  };
}
function verify3(options) {
  const { address, hash: hash8, payload, publicKey, signature } = options;
  if (address)
    return isEqual3(address, recoverAddress({ payload, signature }));
  return secp256k1.verify(signature, from3(payload), toBytes3(publicKey), ...hash8 ? [{ prehash: true, lowS: true }] : []);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/hdKey.js
function fromScure(key) {
  return {
    derive: (path2) => fromScure(key.derive(path2)),
    depth: key.depth,
    identifier: fromBytes(key.identifier),
    index: key.index,
    privateKey: fromBytes(key.privateKey),
    privateExtendedKey: key.privateExtendedKey,
    publicKey: getPublicKey3({ privateKey: key.privateKey }),
    publicExtendedKey: key.publicExtendedKey,
    versions: key.versions
  };
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/HdKey.js
function fromExtendedKey(extendedKey) {
  const key = HDKey.fromExtendedKey(extendedKey);
  return fromScure(key);
}
function fromJson(json) {
  return fromScure(HDKey.fromJSON(json));
}
function fromSeed(seed, options = {}) {
  const { versions } = options;
  const key = HDKey.fromMasterSeed(from3(seed), versions);
  return fromScure(key);
}
function path(options = {}) {
  const { account = 0, change = 0, index: index2 = 0 } = options;
  return `m/44'/60'/${account}'/${change}/${index2}`;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Keystore.js
var Keystore_exports = {};
__export(Keystore_exports, {
  decrypt: () => decrypt2,
  encrypt: () => encrypt3,
  pbkdf2: () => pbkdf22,
  pbkdf2Async: () => pbkdf2Async2,
  scrypt: () => scrypt2,
  scryptAsync: () => scryptAsync2,
  toKey: () => toKey,
  toKeyAsync: () => toKeyAsync
});

// node_modules/@noble/ciphers/esm/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes2(b, ...lengths) {
  if (!isBytes(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function u82(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u322(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean2(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function overlapBytes(a, b) {
  return a.buffer === b.buffer && // best we can do, may fail with an obscure Proxy
  a.byteOffset < b.byteOffset + b.byteLength && // a starts before b end
  b.byteOffset < a.byteOffset + a.byteLength;
}
function complexOverlapBytes(input, output) {
  if (overlapBytes(input, output) && input.byteOffset < output.byteOffset)
    throw new Error("complex overlap of input and output is not supported");
}
var wrapCipher = /* @__NO_SIDE_EFFECTS__ */ (params, constructor) => {
  function wrappedCipher(key, ...args) {
    abytes2(key);
    if (!isLE)
      throw new Error("Non little-endian hardware is not yet supported");
    if (params.nonceLength !== void 0) {
      const nonce = args[0];
      if (!nonce)
        throw new Error("nonce / iv required");
      if (params.varSizeNonce)
        abytes2(nonce);
      else
        abytes2(nonce, params.nonceLength);
    }
    const tagl = params.tagLength;
    if (tagl && args[1] !== void 0) {
      abytes2(args[1]);
    }
    const cipher = constructor(key, ...args);
    const checkOutput = (fnLength, output) => {
      if (output !== void 0) {
        if (fnLength !== 2)
          throw new Error("cipher output not supported");
        abytes2(output);
      }
    };
    let called = false;
    const wrCipher = {
      encrypt(data, output) {
        if (called)
          throw new Error("cannot encrypt() twice with same key + nonce");
        called = true;
        abytes2(data);
        checkOutput(cipher.encrypt.length, output);
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes2(data);
        if (tagl && data.length < tagl)
          throw new Error("invalid ciphertext length: smaller than tagLength=" + tagl);
        checkOutput(cipher.decrypt.length, output);
        return cipher.decrypt(data, output);
      }
    };
    return wrCipher;
  }
  Object.assign(wrappedCipher, params);
  return wrappedCipher;
};
function getOutput(expectedLength, out, onlyAligned = true) {
  if (out === void 0)
    return new Uint8Array(expectedLength);
  if (out.length !== expectedLength)
    throw new Error("invalid output length, expected " + expectedLength + ", got: " + out.length);
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
  return out;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(bytes);
}

// node_modules/@noble/ciphers/esm/aes.js
var BLOCK_SIZE = 16;
var BLOCK_SIZE32 = 4;
var POLY = 283;
function mul2(n) {
  return n << 1 ^ POLY & -(n >> 7);
}
function mul(a, b) {
  let res = 0;
  for (; b > 0; b >>= 1) {
    res ^= a & -(b & 1);
    a = mul2(a);
  }
  return res;
}
var sbox = /* @__PURE__ */ (() => {
  const t = new Uint8Array(256);
  for (let i = 0, x = 1; i < 256; i++, x ^= mul2(x))
    t[i] = x;
  const box = new Uint8Array(256);
  box[0] = 99;
  for (let i = 0; i < 255; i++) {
    let x = t[255 - i];
    x |= x << 8;
    box[t[i]] = (x ^ x >> 4 ^ x >> 5 ^ x >> 6 ^ x >> 7 ^ 99) & 255;
  }
  clean2(t);
  return box;
})();
var rotr32_8 = (n) => n << 24 | n >>> 8;
var rotl32_8 = (n) => n << 8 | n >>> 24;
function genTtable(sbox2, fn) {
  if (sbox2.length !== 256)
    throw new Error("Wrong sbox length");
  const T02 = new Uint32Array(256).map((_, j) => fn(sbox2[j]));
  const T12 = T02.map(rotl32_8);
  const T2 = T12.map(rotl32_8);
  const T3 = T2.map(rotl32_8);
  const T01 = new Uint32Array(256 * 256);
  const T23 = new Uint32Array(256 * 256);
  const sbox22 = new Uint16Array(256 * 256);
  for (let i = 0; i < 256; i++) {
    for (let j = 0; j < 256; j++) {
      const idx = i * 256 + j;
      T01[idx] = T02[i] ^ T12[j];
      T23[idx] = T2[i] ^ T3[j];
      sbox22[idx] = sbox2[i] << 8 | sbox2[j];
    }
  }
  return { sbox: sbox2, sbox2: sbox22, T0: T02, T1: T12, T2, T3, T01, T23 };
}
var tableEncoding = /* @__PURE__ */ genTtable(sbox, (s) => mul(s, 3) << 24 | s << 16 | s << 8 | mul(s, 2));
var xPowers = /* @__PURE__ */ (() => {
  const p = new Uint8Array(16);
  for (let i = 0, x = 1; i < 16; i++, x = mul2(x))
    p[i] = x;
  return p;
})();
function expandKeyLE(key) {
  abytes2(key);
  const len = key.length;
  if (![16, 24, 32].includes(len))
    throw new Error("aes: invalid key size, should be 16, 24 or 32, got " + len);
  const { sbox2 } = tableEncoding;
  const toClean = [];
  if (!isAligned32(key))
    toClean.push(key = copyBytes(key));
  const k32 = u322(key);
  const Nk = k32.length;
  const subByte = (n) => applySbox(sbox2, n, n, n, n);
  const xk = new Uint32Array(len + 28);
  xk.set(k32);
  for (let i = Nk; i < xk.length; i++) {
    let t = xk[i - 1];
    if (i % Nk === 0)
      t = subByte(rotr32_8(t)) ^ xPowers[i / Nk - 1];
    else if (Nk > 6 && i % Nk === 4)
      t = subByte(t);
    xk[i] = xk[i - Nk] ^ t;
  }
  clean2(...toClean);
  return xk;
}
function apply0123(T01, T23, s0, s1, s2, s3) {
  return T01[s0 << 8 & 65280 | s1 >>> 8 & 255] ^ T23[s2 >>> 8 & 65280 | s3 >>> 24 & 255];
}
function applySbox(sbox2, s0, s1, s2, s3) {
  return sbox2[s0 & 255 | s1 & 65280] | sbox2[s2 >>> 16 & 255 | s3 >>> 16 & 65280] << 16;
}
function encrypt2(xk, s0, s1, s2, s3) {
  const { sbox2, T01, T23 } = tableEncoding;
  let k = 0;
  s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
  const rounds = xk.length / 4 - 2;
  for (let i = 0; i < rounds; i++) {
    const t02 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
    const t12 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
    const t22 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
    const t32 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
    s0 = t02, s1 = t12, s2 = t22, s3 = t32;
  }
  const t0 = xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3);
  const t1 = xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0);
  const t2 = xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1);
  const t3 = xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2);
  return { s0: t0, s1: t1, s2: t2, s3: t3 };
}
function ctrCounter(xk, nonce, src, dst) {
  abytes2(nonce, BLOCK_SIZE);
  abytes2(src);
  const srcLen = src.length;
  dst = getOutput(srcLen, dst);
  complexOverlapBytes(src, dst);
  const ctr2 = nonce;
  const c32 = u322(ctr2);
  let { s0, s1, s2, s3 } = encrypt2(xk, c32[0], c32[1], c32[2], c32[3]);
  const src32 = u322(src);
  const dst32 = u322(dst);
  for (let i = 0; i + 4 <= src32.length; i += 4) {
    dst32[i + 0] = src32[i + 0] ^ s0;
    dst32[i + 1] = src32[i + 1] ^ s1;
    dst32[i + 2] = src32[i + 2] ^ s2;
    dst32[i + 3] = src32[i + 3] ^ s3;
    let carry = 1;
    for (let i2 = ctr2.length - 1; i2 >= 0; i2--) {
      carry = carry + (ctr2[i2] & 255) | 0;
      ctr2[i2] = carry & 255;
      carry >>>= 8;
    }
    ({ s0, s1, s2, s3 } = encrypt2(xk, c32[0], c32[1], c32[2], c32[3]));
  }
  const start = BLOCK_SIZE * Math.floor(src32.length / BLOCK_SIZE32);
  if (start < srcLen) {
    const b32 = new Uint32Array([s0, s1, s2, s3]);
    const buf = u82(b32);
    for (let i = start, pos = 0; i < srcLen; i++, pos++)
      dst[i] = src[i] ^ buf[pos];
    clean2(b32);
  }
  return dst;
}
var ctr = /* @__PURE__ */ wrapCipher({ blockSize: 16, nonceLength: 16 }, function aesctr(key, nonce) {
  function processCtr(buf, dst) {
    abytes2(buf);
    if (dst !== void 0) {
      abytes2(dst);
      if (!isAligned32(dst))
        throw new Error("unaligned destination");
    }
    const xk = expandKeyLE(key);
    const n = copyBytes(nonce);
    const toClean = [xk, n];
    if (!isAligned32(buf))
      toClean.push(buf = copyBytes(buf));
    const out = ctrCounter(xk, n, buf, dst);
    clean2(...toClean);
    return out;
  }
  return {
    encrypt: (plaintext, dst) => processCtr(plaintext, dst),
    decrypt: (ciphertext, dst) => processCtr(ciphertext, dst)
  };
});

// node_modules/@noble/hashes/esm/scrypt.js
function XorAndSalsa(prev, pi, input, ii, out, oi) {
  let y00 = prev[pi++] ^ input[ii++], y01 = prev[pi++] ^ input[ii++];
  let y02 = prev[pi++] ^ input[ii++], y03 = prev[pi++] ^ input[ii++];
  let y04 = prev[pi++] ^ input[ii++], y05 = prev[pi++] ^ input[ii++];
  let y06 = prev[pi++] ^ input[ii++], y07 = prev[pi++] ^ input[ii++];
  let y08 = prev[pi++] ^ input[ii++], y09 = prev[pi++] ^ input[ii++];
  let y10 = prev[pi++] ^ input[ii++], y11 = prev[pi++] ^ input[ii++];
  let y12 = prev[pi++] ^ input[ii++], y13 = prev[pi++] ^ input[ii++];
  let y14 = prev[pi++] ^ input[ii++], y15 = prev[pi++] ^ input[ii++];
  let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
  for (let i = 0; i < 8; i += 2) {
    x04 ^= rotl(x00 + x12 | 0, 7);
    x08 ^= rotl(x04 + x00 | 0, 9);
    x12 ^= rotl(x08 + x04 | 0, 13);
    x00 ^= rotl(x12 + x08 | 0, 18);
    x09 ^= rotl(x05 + x01 | 0, 7);
    x13 ^= rotl(x09 + x05 | 0, 9);
    x01 ^= rotl(x13 + x09 | 0, 13);
    x05 ^= rotl(x01 + x13 | 0, 18);
    x14 ^= rotl(x10 + x06 | 0, 7);
    x02 ^= rotl(x14 + x10 | 0, 9);
    x06 ^= rotl(x02 + x14 | 0, 13);
    x10 ^= rotl(x06 + x02 | 0, 18);
    x03 ^= rotl(x15 + x11 | 0, 7);
    x07 ^= rotl(x03 + x15 | 0, 9);
    x11 ^= rotl(x07 + x03 | 0, 13);
    x15 ^= rotl(x11 + x07 | 0, 18);
    x01 ^= rotl(x00 + x03 | 0, 7);
    x02 ^= rotl(x01 + x00 | 0, 9);
    x03 ^= rotl(x02 + x01 | 0, 13);
    x00 ^= rotl(x03 + x02 | 0, 18);
    x06 ^= rotl(x05 + x04 | 0, 7);
    x07 ^= rotl(x06 + x05 | 0, 9);
    x04 ^= rotl(x07 + x06 | 0, 13);
    x05 ^= rotl(x04 + x07 | 0, 18);
    x11 ^= rotl(x10 + x09 | 0, 7);
    x08 ^= rotl(x11 + x10 | 0, 9);
    x09 ^= rotl(x08 + x11 | 0, 13);
    x10 ^= rotl(x09 + x08 | 0, 18);
    x12 ^= rotl(x15 + x14 | 0, 7);
    x13 ^= rotl(x12 + x15 | 0, 9);
    x14 ^= rotl(x13 + x12 | 0, 13);
    x15 ^= rotl(x14 + x13 | 0, 18);
  }
  out[oi++] = y00 + x00 | 0;
  out[oi++] = y01 + x01 | 0;
  out[oi++] = y02 + x02 | 0;
  out[oi++] = y03 + x03 | 0;
  out[oi++] = y04 + x04 | 0;
  out[oi++] = y05 + x05 | 0;
  out[oi++] = y06 + x06 | 0;
  out[oi++] = y07 + x07 | 0;
  out[oi++] = y08 + x08 | 0;
  out[oi++] = y09 + x09 | 0;
  out[oi++] = y10 + x10 | 0;
  out[oi++] = y11 + x11 | 0;
  out[oi++] = y12 + x12 | 0;
  out[oi++] = y13 + x13 | 0;
  out[oi++] = y14 + x14 | 0;
  out[oi++] = y15 + x15 | 0;
}
function BlockMix(input, ii, out, oi, r) {
  let head = oi + 0;
  let tail = oi + 16 * r;
  for (let i = 0; i < 16; i++)
    out[tail + i] = input[ii + (2 * r - 1) * 16 + i];
  for (let i = 0; i < r; i++, head += 16, ii += 16) {
    XorAndSalsa(out, tail, input, ii, out, head);
    if (i > 0)
      tail += 16;
    XorAndSalsa(out, head, input, ii += 16, out, tail);
  }
}
function scryptInit(password, salt, _opts) {
  const opts = checkOpts({
    dkLen: 32,
    asyncTick: 10,
    maxmem: 1024 ** 3 + 1024
  }, _opts);
  const { N, r, p, dkLen, asyncTick, maxmem, onProgress } = opts;
  anumber(N);
  anumber(r);
  anumber(p);
  anumber(dkLen);
  anumber(asyncTick);
  anumber(maxmem);
  if (onProgress !== void 0 && typeof onProgress !== "function")
    throw new Error("progressCb should be function");
  const blockSize = 128 * r;
  const blockSize32 = blockSize / 4;
  const pow32 = Math.pow(2, 32);
  if (N <= 1 || (N & N - 1) !== 0 || N > pow32) {
    throw new Error("Scrypt: N must be larger than 1, a power of 2, and less than 2^32");
  }
  if (p < 0 || p > (pow32 - 1) * 32 / blockSize) {
    throw new Error("Scrypt: p must be a positive integer less than or equal to ((2^32 - 1) * 32) / (128 * r)");
  }
  if (dkLen < 0 || dkLen > (pow32 - 1) * 32) {
    throw new Error("Scrypt: dkLen should be positive integer less than or equal to (2^32 - 1) * 32");
  }
  const memUsed = blockSize * (N + p);
  if (memUsed > maxmem) {
    throw new Error("Scrypt: memused is bigger than maxMem. Expected 128 * r * (N + p) > maxmem of " + maxmem);
  }
  const B = pbkdf2(sha256, password, salt, { c: 1, dkLen: blockSize * p });
  const B32 = u32(B);
  const V = u32(new Uint8Array(blockSize * N));
  const tmp = u32(new Uint8Array(blockSize));
  let blockMixCb = () => {
  };
  if (onProgress) {
    const totalBlockMix = 2 * N * p;
    const callbackPer = Math.max(Math.floor(totalBlockMix / 1e4), 1);
    let blockMixCnt = 0;
    blockMixCb = () => {
      blockMixCnt++;
      if (onProgress && (!(blockMixCnt % callbackPer) || blockMixCnt === totalBlockMix))
        onProgress(blockMixCnt / totalBlockMix);
    };
  }
  return { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, asyncTick };
}
function scryptOutput(password, dkLen, B, V, tmp) {
  const res = pbkdf2(sha256, password, B, { c: 1, dkLen });
  clean(B, V, tmp);
  return res;
}
function scrypt(password, salt, opts) {
  const { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb } = scryptInit(password, salt, opts);
  swap32IfBE(B32);
  for (let pi = 0; pi < p; pi++) {
    const Pi = blockSize32 * pi;
    for (let i = 0; i < blockSize32; i++)
      V[i] = B32[Pi + i];
    for (let i = 0, pos = 0; i < N - 1; i++) {
      BlockMix(V, pos, V, pos += blockSize32, r);
      blockMixCb();
    }
    BlockMix(V, (N - 1) * blockSize32, B32, Pi, r);
    blockMixCb();
    for (let i = 0; i < N; i++) {
      const j = B32[Pi + blockSize32 - 16] % N;
      for (let k = 0; k < blockSize32; k++)
        tmp[k] = B32[Pi + k] ^ V[j * blockSize32 + k];
      BlockMix(tmp, 0, B32, Pi, r);
      blockMixCb();
    }
  }
  swap32IfBE(B32);
  return scryptOutput(password, dkLen, B, V, tmp);
}
async function scryptAsync(password, salt, opts) {
  const { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, asyncTick } = scryptInit(password, salt, opts);
  swap32IfBE(B32);
  for (let pi = 0; pi < p; pi++) {
    const Pi = blockSize32 * pi;
    for (let i = 0; i < blockSize32; i++)
      V[i] = B32[Pi + i];
    let pos = 0;
    await asyncLoop(N - 1, asyncTick, () => {
      BlockMix(V, pos, V, pos += blockSize32, r);
      blockMixCb();
    });
    BlockMix(V, (N - 1) * blockSize32, B32, Pi, r);
    blockMixCb();
    await asyncLoop(N, asyncTick, () => {
      const j = B32[Pi + blockSize32 - 16] % N;
      for (let k = 0; k < blockSize32; k++)
        tmp[k] = B32[Pi + k] ^ V[j * blockSize32 + k];
      BlockMix(tmp, 0, B32, Pi, r);
      blockMixCb();
    });
  }
  swap32IfBE(B32);
  return scryptOutput(password, dkLen, B, V, tmp);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Keystore.js
function decrypt2(keystore, key, options = {}) {
  const { as = "Hex" } = options;
  const key_ = from3(typeof key === "function" ? key() : key);
  const encKey = slice2(key_, 0, 16);
  const macKey = slice2(key_, 16, 32);
  const ciphertext = from3(`0x${keystore.crypto.ciphertext}`);
  const mac = keccak256(concat2(macKey, ciphertext));
  if (!isEqual2(mac, from3(`0x${keystore.crypto.mac}`)))
    throw new Error("corrupt keystore");
  const data = ctr(encKey, from3(`0x${keystore.crypto.cipherparams.iv}`)).decrypt(ciphertext);
  if (as === "Hex")
    return toHex(data);
  return data;
}
function encrypt3(privateKey, key, options) {
  const { id = crypto.randomUUID(), kdf, kdfparams, iv } = options;
  const key_ = from3(typeof key === "function" ? key() : key);
  const value_ = from3(privateKey);
  const encKey = slice2(key_, 0, 16);
  const macKey = slice2(key_, 16, 32);
  const ciphertext = ctr(encKey, iv).encrypt(value_);
  const mac = keccak256(concat2(macKey, ciphertext));
  return {
    crypto: {
      cipher: "aes-128-ctr",
      ciphertext: toHex(ciphertext).slice(2),
      cipherparams: { iv: toHex(iv).slice(2) },
      kdf,
      kdfparams,
      mac: toHex(mac).slice(2)
    },
    id,
    version: 3
  };
}
function pbkdf22(options) {
  const { iv, iterations = 262144, password } = options;
  const salt = options.salt ? from3(options.salt) : random(32);
  const key = toHex(pbkdf2(sha256, password, salt, { c: iterations, dkLen: 32 }));
  return defineKey(() => key, {
    iv,
    kdfparams: {
      c: iterations,
      dklen: 32,
      prf: "hmac-sha256",
      salt: toHex(salt).slice(2)
    },
    kdf: "pbkdf2"
  });
}
async function pbkdf2Async2(options) {
  const { iv, iterations = 262144, password } = options;
  const salt = options.salt ? from3(options.salt) : random(32);
  const key = toHex(await pbkdf2Async(sha256, password, salt, {
    c: iterations,
    dkLen: 32
  }));
  return defineKey(() => key, {
    iv,
    kdfparams: {
      c: iterations,
      dklen: 32,
      prf: "hmac-sha256",
      salt: toHex(salt).slice(2)
    },
    kdf: "pbkdf2"
  });
}
function scrypt2(options) {
  const { iv, n = 262144, password, p = 8, r = 1 } = options;
  const salt = options.salt ? from3(options.salt) : random(32);
  const key = toHex(scrypt(password, salt, { N: n, dkLen: 32, r, p }));
  return defineKey(() => key, {
    iv,
    kdfparams: {
      dklen: 32,
      n,
      p,
      r,
      salt: toHex(salt).slice(2)
    },
    kdf: "scrypt"
  });
}
async function scryptAsync2(options) {
  const { iv, n = 262144, password } = options;
  const p = 8;
  const r = 1;
  const salt = options.salt ? from3(options.salt) : random(32);
  const key = toHex(await scryptAsync(password, salt, { N: n, dkLen: 32, r, p }));
  return defineKey(() => key, {
    iv,
    kdfparams: {
      dklen: 32,
      n,
      p,
      r,
      salt: toHex(salt).slice(2)
    },
    kdf: "scrypt"
  });
}
function toKey(keystore, options) {
  const { crypto: crypto2 } = keystore;
  const { password } = options;
  const { cipherparams, kdf, kdfparams } = crypto2;
  const { iv } = cipherparams;
  const { c, n, p, r, salt } = kdfparams;
  const [key] = (() => {
    switch (kdf) {
      case "scrypt":
        return scrypt2({
          iv: from3(`0x${iv}`),
          n,
          p,
          r,
          salt: from3(`0x${salt}`),
          password
        });
      case "pbkdf2":
        return pbkdf22({
          iv: from3(`0x${iv}`),
          iterations: c,
          password,
          salt: from3(`0x${salt}`)
        });
      default:
        throw new Error("unsupported kdf");
    }
  })();
  return key;
}
async function toKeyAsync(keystore, options) {
  const { crypto: crypto2 } = keystore;
  const { password } = options;
  const { cipherparams, kdf, kdfparams } = crypto2;
  const { iv } = cipherparams;
  const { c, n, p, r, salt } = kdfparams;
  const [key] = await (async () => {
    switch (kdf) {
      case "scrypt":
        return await scryptAsync2({
          iv: from3(`0x${iv}`),
          n,
          p,
          r,
          salt: from3(`0x${salt}`),
          password
        });
      case "pbkdf2":
        return await pbkdf22({
          iv: from3(`0x${iv}`),
          iterations: c,
          password,
          salt: from3(`0x${salt}`)
        });
      default:
        throw new Error("unsupported kdf");
    }
  })();
  return key;
}
function defineKey(key, options) {
  const iv = options.iv ? from3(options.iv) : random(16);
  return [key, { ...options, iv }];
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Log.js
var Log_exports = {};
__export(Log_exports, {
  fromRpc: () => fromRpc8,
  toRpc: () => toRpc8
});
function fromRpc8(log, _options = {}) {
  return {
    ...log,
    blockNumber: log.blockNumber ? BigInt(log.blockNumber) : null,
    logIndex: log.logIndex ? Number(log.logIndex) : null,
    transactionIndex: log.transactionIndex ? Number(log.transactionIndex) : null
  };
}
function toRpc8(log, _options = {}) {
  return {
    address: log.address,
    blockHash: log.blockHash,
    blockNumber: typeof log.blockNumber === "bigint" ? fromNumber(log.blockNumber) : null,
    data: log.data,
    logIndex: typeof log.logIndex === "number" ? fromNumber(log.logIndex) : null,
    topics: log.topics,
    transactionHash: log.transactionHash,
    transactionIndex: typeof log.transactionIndex === "number" ? fromNumber(log.transactionIndex) : null,
    removed: log.removed
  };
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Mnemonic.js
var Mnemonic_exports = {};
__export(Mnemonic_exports, {
  czech: () => wordlist,
  english: () => wordlist2,
  french: () => wordlist3,
  italian: () => wordlist4,
  japanese: () => wordlist5,
  korean: () => wordlist6,
  path: () => path,
  portuguese: () => wordlist7,
  random: () => random3,
  simplifiedChinese: () => wordlist8,
  spanish: () => wordlist9,
  toHdKey: () => toHdKey,
  toPrivateKey: () => toPrivateKey,
  toSeed: () => toSeed,
  traditionalChinese: () => wordlist10,
  validate: () => validate8
});

// node_modules/@scure/bip39/esm/index.js
var isJapanese = (wordlist11) => wordlist11[0] === "\u3042\u3044\u3053\u304F\u3057\u3093";
function nfkd(str) {
  if (typeof str !== "string")
    throw new TypeError("invalid mnemonic type: " + typeof str);
  return str.normalize("NFKD");
}
function normalize2(str) {
  const norm = nfkd(str);
  const words = norm.split(" ");
  if (![12, 15, 18, 21, 24].includes(words.length))
    throw new Error("Invalid mnemonic");
  return { nfkd: norm, words };
}
function aentropy(ent) {
  abytes(ent, 16, 20, 24, 28, 32);
}
function generateMnemonic(wordlist11, strength = 128) {
  anumber(strength);
  if (strength % 32 !== 0 || strength > 256)
    throw new TypeError("Invalid entropy");
  return entropyToMnemonic(randomBytes(strength / 8), wordlist11);
}
var calcChecksum = (entropy) => {
  const bitsLeft = 8 - entropy.length / 4;
  return new Uint8Array([sha256(entropy)[0] >> bitsLeft << bitsLeft]);
};
function getCoder(wordlist11) {
  if (!Array.isArray(wordlist11) || wordlist11.length !== 2048 || typeof wordlist11[0] !== "string")
    throw new Error("Wordlist: expected array of 2048 strings");
  wordlist11.forEach((i) => {
    if (typeof i !== "string")
      throw new Error("wordlist: non-string element: " + i);
  });
  return utils.chain(utils.checksum(1, calcChecksum), utils.radix2(11, true), utils.alphabet(wordlist11));
}
function mnemonicToEntropy(mnemonic, wordlist11) {
  const { words } = normalize2(mnemonic);
  const entropy = getCoder(wordlist11).decode(words);
  aentropy(entropy);
  return entropy;
}
function entropyToMnemonic(entropy, wordlist11) {
  aentropy(entropy);
  const words = getCoder(wordlist11).encode(entropy);
  return words.join(isJapanese(wordlist11) ? "\u3000" : " ");
}
function validateMnemonic(mnemonic, wordlist11) {
  try {
    mnemonicToEntropy(mnemonic, wordlist11);
  } catch (e) {
    return false;
  }
  return true;
}
var psalt = (passphrase) => nfkd("mnemonic" + passphrase);
function mnemonicToSeedSync(mnemonic, passphrase = "") {
  return pbkdf2(sha512, normalize2(mnemonic).nfkd, psalt(passphrase), { c: 2048, dkLen: 64 });
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Mnemonic.js
function random3(wordlist11, options = {}) {
  const { strength = 128 } = options;
  return generateMnemonic(wordlist11, strength);
}
function toHdKey(mnemonic, options = {}) {
  const { passphrase } = options;
  const seed = toSeed(mnemonic, { passphrase });
  return fromSeed(seed);
}
function toPrivateKey(mnemonic, options = {}) {
  const { path: path2 = path(), passphrase } = options;
  const hdKey = toHdKey(mnemonic, { passphrase }).derive(path2);
  if (options.as === "Bytes")
    return from3(hdKey.privateKey);
  return hdKey.privateKey;
}
function toSeed(mnemonic, options = {}) {
  const { passphrase } = options;
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
  if (options.as === "Hex")
    return toHex(seed);
  return seed;
}
function validate8(mnemonic, wordlist11) {
  return validateMnemonic(mnemonic, wordlist11);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/P256.js
var P256_exports = {};
__export(P256_exports, {
  createKeyPair: () => createKeyPair4,
  getPublicKey: () => getPublicKey4,
  getSharedSecret: () => getSharedSecret2,
  noble: () => noble4,
  randomPrivateKey: () => randomPrivateKey4,
  recoverPublicKey: () => recoverPublicKey2,
  sign: () => sign4,
  verify: () => verify4
});

// node_modules/@noble/curves/esm/nist.js
var Fp256 = Field(BigInt("0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"));
var p256_a = Fp256.create(BigInt("-3"));
var p256_b = BigInt("0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b");
var p256 = createCurve({
  a: p256_a,
  b: p256_b,
  Fp: Fp256,
  n: BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"),
  Gx: BigInt("0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"),
  Gy: BigInt("0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5"),
  h: BigInt(1),
  lowS: false
}, sha256);
var Fp384 = Field(BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff"));
var p384_a = Fp384.create(BigInt("-3"));
var p384_b = BigInt("0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef");
var p384 = createCurve({
  a: p384_a,
  b: p384_b,
  Fp: Fp384,
  n: BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973"),
  Gx: BigInt("0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7"),
  Gy: BigInt("0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f"),
  h: BigInt(1),
  lowS: false
}, sha384);
var Fp521 = Field(BigInt("0x1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"));
var p521_a = Fp521.create(BigInt("-3"));
var p521_b = BigInt("0x0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00");
var p521 = createCurve({
  a: p521_a,
  b: p521_b,
  Fp: Fp521,
  n: BigInt("0x01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409"),
  Gx: BigInt("0x00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66"),
  Gy: BigInt("0x011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650"),
  h: BigInt(1),
  lowS: false,
  allowedPrivateKeyLengths: [130, 131, 132]
  // P521 keys are variable-length. Normalize to 132b
}, sha512);

// node_modules/@noble/curves/esm/p256.js
var p2562 = p256;
var secp256r1 = p256;

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/P256.js
var noble4 = secp256r1;
function createKeyPair4(options = {}) {
  const { as = "Hex" } = options;
  const privateKey = randomPrivateKey4({ as });
  const publicKey = getPublicKey4({ privateKey });
  return {
    privateKey,
    publicKey
  };
}
function getPublicKey4(options) {
  const { privateKey } = options;
  const point = secp256r1.ProjectivePoint.fromPrivateKey(typeof privateKey === "string" ? privateKey.slice(2) : fromBytes(privateKey).slice(2));
  return from4(point);
}
function getSharedSecret2(options) {
  const { as = "Hex", privateKey, publicKey } = options;
  const point = secp256r1.ProjectivePoint.fromHex(toHex2(publicKey).slice(2));
  const privateKeyHex = typeof privateKey === "string" ? privateKey.slice(2) : fromBytes(privateKey).slice(2);
  const sharedPoint = point.multiply(secp256r1.utils.normPrivateKeyToScalar(privateKeyHex));
  const sharedSecret = sharedPoint.toRawBytes(true);
  if (as === "Hex")
    return fromBytes(sharedSecret);
  return sharedSecret;
}
function randomPrivateKey4(options = {}) {
  const { as = "Hex" } = options;
  const bytes = secp256r1.utils.randomPrivateKey();
  if (as === "Hex")
    return fromBytes(bytes);
  return bytes;
}
function recoverPublicKey2(options) {
  const { payload, signature } = options;
  const { r, s, yParity } = signature;
  const signature_ = new secp256r1.Signature(BigInt(r), BigInt(s)).addRecoveryBit(yParity);
  const payload_ = payload instanceof Uint8Array ? fromBytes(payload) : payload;
  const point = signature_.recoverPublicKey(payload_.substring(2));
  return from4(point);
}
function sign4(options) {
  const { extraEntropy: extraEntropy2 = extraEntropy, hash: hash8, payload, privateKey } = options;
  const { r, s, recovery } = secp256r1.sign(payload instanceof Uint8Array ? payload : fromHex(payload), privateKey instanceof Uint8Array ? privateKey : fromHex(privateKey), {
    extraEntropy: typeof extraEntropy2 === "boolean" ? extraEntropy2 : from2(extraEntropy2).slice(2),
    lowS: true,
    ...hash8 ? { prehash: true } : {}
  });
  return {
    r,
    s,
    yParity: recovery
  };
}
function verify4(options) {
  const { hash: hash8, payload, publicKey, signature } = options;
  return secp256r1.verify(signature, payload instanceof Uint8Array ? payload : fromHex(payload), toHex2(publicKey).substring(2), ...hash8 ? [{ prehash: true, lowS: true }] : []);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/PersonalMessage.js
var PersonalMessage_exports = {};
__export(PersonalMessage_exports, {
  encode: () => encode7,
  getSignPayload: () => getSignPayload2
});
function encode7(data) {
  const message = from2(data);
  return concat(
    // Personal Sign Format: `0x19 ‖ "Ethereum Signed Message:\n" ‖ message.length ‖ message`
    "0x19",
    fromString("Ethereum Signed Message:\n" + size2(message)),
    message
  );
}
function getSignPayload2(data) {
  return keccak256(encode7(data));
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Provider.js
var Provider_exports = {};
__export(Provider_exports, {
  AtomicReadyWalletRejectedUpgradeError: () => AtomicReadyWalletRejectedUpgradeError,
  AtomicityNotSupportedError: () => AtomicityNotSupportedError,
  BundleTooLargeError: () => BundleTooLargeError,
  ChainDisconnectedError: () => ChainDisconnectedError,
  DisconnectedError: () => DisconnectedError,
  DuplicateIdError: () => DuplicateIdError,
  IsUndefinedError: () => IsUndefinedError,
  ProviderRpcError: () => ProviderRpcError,
  SwitchChainError: () => SwitchChainError,
  UnauthorizedError: () => UnauthorizedError,
  UnknownBundleIdError: () => UnknownBundleIdError,
  UnsupportedChainIdError: () => UnsupportedChainIdError,
  UnsupportedMethodError: () => UnsupportedMethodError,
  UnsupportedNonOptionalCapabilityError: () => UnsupportedNonOptionalCapabilityError,
  UserRejectedRequestError: () => UserRejectedRequestError,
  createEmitter: () => createEmitter,
  from: () => from20,
  parseError: () => parseError2
});

// node_modules/eventemitter3/index.mjs
var import_index = __toESM(require_eventemitter3(), 1);

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/RpcResponse.js
var RpcResponse_exports = {};
__export(RpcResponse_exports, {
  BaseError: () => BaseError2,
  InternalError: () => InternalError,
  InvalidInputError: () => InvalidInputError2,
  InvalidParamsError: () => InvalidParamsError,
  InvalidRequestError: () => InvalidRequestError,
  LimitExceededError: () => LimitExceededError,
  MethodNotFoundError: () => MethodNotFoundError,
  MethodNotSupportedError: () => MethodNotSupportedError,
  ParseError: () => ParseError,
  ResourceNotFoundError: () => ResourceNotFoundError,
  ResourceUnavailableError: () => ResourceUnavailableError,
  TransactionRejectedError: () => TransactionRejectedError,
  VersionNotSupportedError: () => VersionNotSupportedError,
  from: () => from19,
  parse: () => parse2,
  parseError: () => parseError
});
function from19(response, options = {}) {
  const { request } = options;
  return {
    ...response,
    id: response.id ?? request?.id,
    jsonrpc: response.jsonrpc ?? request.jsonrpc
  };
}
function parse2(response, options = {}) {
  const { raw = false } = options;
  const response_ = response;
  if (raw)
    return response;
  if (response_.error)
    throw parseError(response_.error);
  return response_.result;
}
function parseError(error) {
  const error_ = error;
  if (error_ instanceof Error && !("code" in error_))
    return new InternalError({
      cause: error_,
      data: error_,
      message: error_.message,
      stack: error_.stack
    });
  const { code } = error_;
  if (code === InternalError.code)
    return new InternalError(error_);
  if (code === InvalidInputError2.code)
    return new InvalidInputError2(error_);
  if (code === InvalidParamsError.code)
    return new InvalidParamsError(error_);
  if (code === InvalidRequestError.code)
    return new InvalidRequestError(error_);
  if (code === LimitExceededError.code)
    return new LimitExceededError(error_);
  if (code === MethodNotFoundError.code)
    return new MethodNotFoundError(error_);
  if (code === MethodNotSupportedError.code)
    return new MethodNotSupportedError(error_);
  if (code === ParseError.code)
    return new ParseError(error_);
  if (code === ResourceNotFoundError.code)
    return new ResourceNotFoundError(error_);
  if (code === ResourceUnavailableError.code)
    return new ResourceUnavailableError(error_);
  if (code === TransactionRejectedError.code)
    return new TransactionRejectedError(error_);
  if (code === VersionNotSupportedError.code)
    return new VersionNotSupportedError(error_);
  return new InternalError({
    cause: error_ instanceof Error ? error_ : void 0,
    data: error_,
    message: error_.message,
    stack: error_ instanceof Error ? error_.stack : void 0
  });
}
var BaseError2 = class extends Error {
  constructor(errorObject) {
    const { cause, code, message, data, stack } = errorObject;
    super(message, { cause });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.BaseError"
    });
    Object.defineProperty(this, "cause", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "stack", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "data", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.cause = cause;
    this.code = code;
    this.data = data;
    this.stack = stack ?? "";
  }
};
var InvalidInputError2 = class _InvalidInputError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      code: _InvalidInputError.code,
      data: parameters.data,
      message: parameters.message ?? "Missing or invalid parameters."
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32e3
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.InvalidInputError"
    });
  }
};
Object.defineProperty(InvalidInputError2, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32e3
});
var ResourceNotFoundError = class _ResourceNotFoundError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      code: _ResourceNotFoundError.code,
      data: parameters.data,
      message: parameters.message ?? "Requested resource not found."
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32001
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.ResourceNotFoundError"
    });
  }
};
Object.defineProperty(ResourceNotFoundError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32001
});
var ResourceUnavailableError = class _ResourceUnavailableError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      code: _ResourceUnavailableError.code,
      data: parameters.data,
      message: parameters.message ?? "Requested resource not available."
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32002
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.ResourceUnavailableError"
    });
  }
};
Object.defineProperty(ResourceUnavailableError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32002
});
var TransactionRejectedError = class _TransactionRejectedError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      code: _TransactionRejectedError.code,
      data: parameters.data,
      message: parameters.message ?? "Transaction creation failed."
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32003
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.TransactionRejectedError"
    });
  }
};
Object.defineProperty(TransactionRejectedError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32003
});
var MethodNotSupportedError = class _MethodNotSupportedError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      code: _MethodNotSupportedError.code,
      data: parameters.data,
      message: parameters.message ?? "Method is not implemented."
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32004
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.MethodNotSupportedError"
    });
  }
};
Object.defineProperty(MethodNotSupportedError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32004
});
var LimitExceededError = class _LimitExceededError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      code: _LimitExceededError.code,
      data: parameters.data,
      message: parameters.message ?? "Rate limit exceeded."
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32005
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.LimitExceededError"
    });
  }
};
Object.defineProperty(LimitExceededError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32005
});
var VersionNotSupportedError = class _VersionNotSupportedError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      code: _VersionNotSupportedError.code,
      data: parameters.data,
      message: parameters.message ?? "JSON-RPC version not supported."
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32006
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.VersionNotSupportedError"
    });
  }
};
Object.defineProperty(VersionNotSupportedError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32006
});
var InvalidRequestError = class _InvalidRequestError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      code: _InvalidRequestError.code,
      data: parameters.data,
      message: parameters.message ?? "Input is not a valid JSON-RPC request."
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32600
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.InvalidRequestError"
    });
  }
};
Object.defineProperty(InvalidRequestError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32600
});
var MethodNotFoundError = class _MethodNotFoundError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      code: _MethodNotFoundError.code,
      data: parameters.data,
      message: parameters.message ?? "Method does not exist."
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32601
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.MethodNotFoundError"
    });
  }
};
Object.defineProperty(MethodNotFoundError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32601
});
var InvalidParamsError = class _InvalidParamsError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      code: _InvalidParamsError.code,
      data: parameters.data,
      message: parameters.message ?? "Invalid method parameters."
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32602
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.InvalidParamsError"
    });
  }
};
Object.defineProperty(InvalidParamsError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32602
});
var InternalError = class _InternalError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      cause: parameters.cause,
      code: _InternalError.code,
      data: parameters.data,
      message: parameters.message ?? "Internal JSON-RPC error.",
      stack: parameters.stack
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32603
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.InternalError"
    });
  }
};
Object.defineProperty(InternalError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32603
});
var ParseError = class _ParseError extends BaseError2 {
  constructor(parameters = {}) {
    super({
      code: _ParseError.code,
      data: parameters.data,
      message: parameters.message ?? "Failed to parse JSON-RPC response."
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: -32700
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcResponse.ParseError"
    });
  }
};
Object.defineProperty(ParseError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: -32700
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Provider.js
var ProviderRpcError = class extends Error {
  constructor(code, message) {
    super(message);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "ProviderRpcError"
    });
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    Object.defineProperty(this, "details", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: void 0
    });
    this.code = code;
    this.details = message;
  }
};
var UserRejectedRequestError = class extends ProviderRpcError {
  constructor({ message = "The user rejected the request." } = {}) {
    super(4001, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 4001
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.UserRejectedRequestError"
    });
  }
};
Object.defineProperty(UserRejectedRequestError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 4001
});
var UnauthorizedError = class extends ProviderRpcError {
  constructor({ message = "The requested method and/or account has not been authorized by the user." } = {}) {
    super(4100, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 4100
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.UnauthorizedError"
    });
  }
};
Object.defineProperty(UnauthorizedError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 4100
});
var UnsupportedMethodError = class extends ProviderRpcError {
  constructor({ message = "The provider does not support the requested method." } = {}) {
    super(4200, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 4200
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.UnsupportedMethodError"
    });
  }
};
Object.defineProperty(UnsupportedMethodError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 4200
});
var DisconnectedError = class extends ProviderRpcError {
  constructor({ message = "The provider is disconnected from all chains." } = {}) {
    super(4900, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 4900
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.DisconnectedError"
    });
  }
};
Object.defineProperty(DisconnectedError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 4900
});
var ChainDisconnectedError = class extends ProviderRpcError {
  constructor({ message = "The provider is not connected to the requested chain." } = {}) {
    super(4901, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 4901
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.ChainDisconnectedError"
    });
  }
};
Object.defineProperty(ChainDisconnectedError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 4901
});
var SwitchChainError = class extends ProviderRpcError {
  constructor({ message = "An error occurred when attempting to switch chain." } = {}) {
    super(4902, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 4902
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.SwitchChainError"
    });
  }
};
Object.defineProperty(SwitchChainError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 4902
});
var UnsupportedNonOptionalCapabilityError = class extends ProviderRpcError {
  constructor({ message = "This Wallet does not support a capability that was not marked as optional." } = {}) {
    super(5700, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 5700
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.UnsupportedNonOptionalCapabilityError"
    });
  }
};
Object.defineProperty(UnsupportedNonOptionalCapabilityError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 5700
});
var UnsupportedChainIdError = class extends ProviderRpcError {
  constructor({ message = "This Wallet does not support the requested chain ID." } = {}) {
    super(5710, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 5710
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.UnsupportedChainIdError"
    });
  }
};
Object.defineProperty(UnsupportedChainIdError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 5710
});
var DuplicateIdError = class extends ProviderRpcError {
  constructor({ message = "There is already a bundle submitted with this ID." } = {}) {
    super(5720, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 5720
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.DuplicateIdError"
    });
  }
};
Object.defineProperty(DuplicateIdError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 5720
});
var UnknownBundleIdError = class extends ProviderRpcError {
  constructor({ message = "This bundle id is unknown / has not been submitted." } = {}) {
    super(5730, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 5730
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.UnknownBundleIdError"
    });
  }
};
Object.defineProperty(UnknownBundleIdError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 5730
});
var BundleTooLargeError = class extends ProviderRpcError {
  constructor({ message = "The call bundle is too large for the Wallet to process." } = {}) {
    super(5740, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 5740
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.BundleTooLargeError"
    });
  }
};
Object.defineProperty(BundleTooLargeError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 5740
});
var AtomicReadyWalletRejectedUpgradeError = class extends ProviderRpcError {
  constructor({ message = "The Wallet can support atomicity after an upgrade, but the user rejected the upgrade." } = {}) {
    super(5750, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 5750
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.AtomicReadyWalletRejectedUpgradeError"
    });
  }
};
Object.defineProperty(AtomicReadyWalletRejectedUpgradeError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 5750
});
var AtomicityNotSupportedError = class extends ProviderRpcError {
  constructor({ message = "The wallet does not support atomic execution but the request requires it." } = {}) {
    super(5760, message);
    Object.defineProperty(this, "code", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: 5760
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.AtomicityNotSupportedError"
    });
  }
};
Object.defineProperty(AtomicityNotSupportedError, "code", {
  enumerable: true,
  configurable: true,
  writable: true,
  value: 5760
});
function createEmitter() {
  const emitter = new import_index.default();
  return {
    get eventNames() {
      return emitter.eventNames.bind(emitter);
    },
    get listenerCount() {
      return emitter.listenerCount.bind(emitter);
    },
    get listeners() {
      return emitter.listeners.bind(emitter);
    },
    addListener: emitter.addListener.bind(emitter),
    emit: emitter.emit.bind(emitter),
    off: emitter.off.bind(emitter),
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    removeAllListeners: emitter.removeAllListeners.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter)
  };
}
function from20(provider, _options = {}) {
  if (!provider)
    throw new IsUndefinedError();
  return {
    ...provider,
    async request(args) {
      try {
        const result = await provider.request(args);
        if (result && typeof result === "object" && "jsonrpc" in result)
          return parse2(result);
        return result;
      } catch (error) {
        throw parseError2(error);
      }
    }
  };
}
function parseError2(error) {
  const error_ = parseError(error);
  if (error_ instanceof InternalError) {
    if (!error_.data)
      return error_;
    const { code } = error_.data;
    if (code === DisconnectedError.code)
      return new DisconnectedError(error_);
    if (code === ChainDisconnectedError.code)
      return new ChainDisconnectedError(error_);
    if (code === UserRejectedRequestError.code)
      return new UserRejectedRequestError(error_);
    if (code === UnauthorizedError.code)
      return new UnauthorizedError(error_);
    if (code === UnsupportedMethodError.code)
      return new UnsupportedMethodError(error_);
    if (code === SwitchChainError.code)
      return new SwitchChainError(error_);
    if (code === AtomicReadyWalletRejectedUpgradeError.code)
      return new AtomicReadyWalletRejectedUpgradeError(error_);
    if (code === AtomicityNotSupportedError.code)
      return new AtomicityNotSupportedError(error_);
    if (code === BundleTooLargeError.code)
      return new BundleTooLargeError(error_);
    if (code === UnknownBundleIdError.code)
      return new UnknownBundleIdError(error_);
    if (code === DuplicateIdError.code)
      return new DuplicateIdError(error_);
    if (code === UnsupportedChainIdError.code)
      return new UnsupportedChainIdError(error_);
    if (code === UnsupportedNonOptionalCapabilityError.code)
      return new UnsupportedNonOptionalCapabilityError(error_);
  }
  return error_;
}
var IsUndefinedError = class extends BaseError {
  constructor() {
    super("`provider` is undefined.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Provider.IsUndefinedError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/RpcRequest.js
var RpcRequest_exports = {};
__export(RpcRequest_exports, {
  createStore: () => createStore,
  from: () => from21
});
function createStore(options = {}) {
  let id = options.id ?? 0;
  return {
    prepare(options2) {
      return from21({
        id: id++,
        ...options2
      });
    },
    get id() {
      return id;
    }
  };
}
function from21(options) {
  return {
    ...options,
    jsonrpc: "2.0"
  };
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/RpcSchema.js
var RpcSchema_exports = {};
__export(RpcSchema_exports, {
  from: () => from22
});
function from22() {
  return null;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/RpcTransport.js
var RpcTransport_exports = {};
__export(RpcTransport_exports, {
  HttpError: () => HttpError,
  MalformedResponseError: () => MalformedResponseError,
  fromHttp: () => fromHttp
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/promise.js
function withTimeout(fn, options) {
  const { errorInstance = new TimeoutError(), timeout, signal } = options;
  return new Promise((resolve, reject) => {
    ;
    (async () => {
      let timeoutId;
      try {
        const controller = new AbortController();
        if (timeout > 0)
          timeoutId = setTimeout(() => {
            if (signal) {
              controller.abort();
            } else {
              reject(errorInstance);
            }
          }, timeout);
        resolve(await fn({ signal: controller.signal }));
      } catch (err) {
        if (err?.name === "AbortError")
          reject(errorInstance);
        reject(err);
      } finally {
        clearTimeout(timeoutId);
      }
    })();
  });
}
var TimeoutError = class extends BaseError {
  constructor() {
    super("Operation timed out.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Promise.TimeoutError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/rpcTransport.js
function create3(transport, options_root) {
  const requestStore = createStore();
  return {
    request: async ({ method, params }, options = {}) => {
      const body = requestStore.prepare({ method, params });
      const data = await transport.request(body, options);
      return parse2(data, {
        raw: options.raw ?? options_root?.raw
      });
    }
  };
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/RpcTransport.js
function fromHttp(url, options = {}) {
  return create3({
    async request(body_, options_) {
      const { fetchFn = options.fetchFn ?? fetch, fetchOptions: fetchOptions_ = options.fetchOptions, timeout = options.timeout ?? 1e4 } = options_;
      const body = JSON.stringify(body_);
      const fetchOptions = typeof fetchOptions_ === "function" ? await fetchOptions_(body_) : fetchOptions_;
      const response = await withTimeout(({ signal }) => {
        const init2 = {
          ...fetchOptions,
          body,
          headers: {
            "Content-Type": "application/json",
            ...fetchOptions?.headers
          },
          method: fetchOptions?.method ?? "POST",
          signal: fetchOptions?.signal ?? (timeout > 0 ? signal : null)
        };
        const request = new Request(url, init2);
        return fetchFn(request);
      }, {
        timeout,
        signal: true
      });
      const data = await (async () => {
        if (response.headers.get("Content-Type")?.startsWith("application/json"))
          return response.json();
        return response.text().then((data2) => {
          try {
            return JSON.parse(data2 || "{}");
          } catch (_err) {
            if (response.ok)
              throw new MalformedResponseError({
                response: data2
              });
            return { error: data2 };
          }
        });
      })();
      if (!response.ok)
        throw new HttpError({
          body,
          details: JSON.stringify(data.error) ?? response.statusText,
          response,
          url
        });
      return data;
    }
  }, { raw: options.raw });
}
var HttpError = class extends BaseError {
  constructor({ body, details, response, url }) {
    super("HTTP request failed.", {
      details,
      metaMessages: [
        `Status: ${response.status}`,
        `URL: ${getUrl(url)}`,
        body ? `Body: ${JSON.stringify(body)}` : void 0
      ]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcTransport.HttpError"
    });
  }
};
var MalformedResponseError = class extends BaseError {
  constructor({ response }) {
    super("HTTP Response could not be parsed as JSON.", {
      metaMessages: [`Response: ${response}`]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "RpcTransport.MalformedResponseError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Siwe.js
var Siwe_exports = {};
__export(Siwe_exports, {
  InvalidMessageFieldError: () => InvalidMessageFieldError,
  createMessage: () => createMessage,
  domainRegex: () => domainRegex,
  generateNonce: () => generateNonce,
  ipRegex: () => ipRegex,
  isUri: () => isUri,
  localhostRegex: () => localhostRegex,
  nonceRegex: () => nonceRegex,
  parseMessage: () => parseMessage,
  prefixRegex: () => prefixRegex,
  schemeRegex: () => schemeRegex,
  suffixRegex: () => suffixRegex,
  validateMessage: () => validateMessage
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/uid.js
var size3 = 256;
var index = size3;
var buffer;
function uid(length = 11) {
  if (!buffer || index + length > size3 * 2) {
    buffer = "";
    index = 0;
    for (let i = 0; i < size3; i++) {
      buffer += (256 + Math.random() * 256 | 0).toString(16).substring(1);
    }
  }
  return buffer.substring(index, index++ + length);
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Siwe.js
var domainRegex = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(:[0-9]{1,5})?$/;
var ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(:[0-9]{1,5})?$/;
var localhostRegex = /^localhost(:[0-9]{1,5})?$/;
var nonceRegex = /^[a-zA-Z0-9]{8,}$/;
var schemeRegex = /^([a-zA-Z][a-zA-Z0-9+-.]*)$/;
var prefixRegex = /^(?:(?<scheme>[a-zA-Z][a-zA-Z0-9+-.]*):\/\/)?(?<domain>[a-zA-Z0-9+-.]*(?::[0-9]{1,5})?) (?:wants you to sign in with your Ethereum account:\n)(?<address>0x[a-fA-F0-9]{40})\n\n(?:(?<statement>.*)\n\n)?/;
var suffixRegex = /(?:URI: (?<uri>.+))\n(?:Version: (?<version>.+))\n(?:Chain ID: (?<chainId>\d+))\n(?:Nonce: (?<nonce>[a-zA-Z0-9]+))\n(?:Issued At: (?<issuedAt>.+))(?:\nExpiration Time: (?<expirationTime>.+))?(?:\nNot Before: (?<notBefore>.+))?(?:\nRequest ID: (?<requestId>.+))?/;
function createMessage(value) {
  const { chainId, domain, expirationTime, issuedAt = /* @__PURE__ */ new Date(), nonce, notBefore, requestId, resources, scheme, uri, version: version2 } = value;
  {
    if (chainId !== Math.floor(chainId))
      throw new InvalidMessageFieldError({
        field: "chainId",
        metaMessages: [
          "- Chain ID must be a EIP-155 chain ID.",
          "- See https://eips.ethereum.org/EIPS/eip-155",
          "",
          `Provided value: ${chainId}`
        ]
      });
    if (!(domainRegex.test(domain) || ipRegex.test(domain) || localhostRegex.test(domain)))
      throw new InvalidMessageFieldError({
        field: "domain",
        metaMessages: [
          "- Domain must be an RFC 3986 authority.",
          "- See https://www.rfc-editor.org/rfc/rfc3986",
          "",
          `Provided value: ${domain}`
        ]
      });
    if (!nonceRegex.test(nonce))
      throw new InvalidMessageFieldError({
        field: "nonce",
        metaMessages: [
          "- Nonce must be at least 8 characters.",
          "- Nonce must be alphanumeric.",
          "",
          `Provided value: ${nonce}`
        ]
      });
    if (!isUri(uri))
      throw new InvalidMessageFieldError({
        field: "uri",
        metaMessages: [
          "- URI must be a RFC 3986 URI referring to the resource that is the subject of the signing.",
          "- See https://www.rfc-editor.org/rfc/rfc3986",
          "",
          `Provided value: ${uri}`
        ]
      });
    if (version2 !== "1")
      throw new InvalidMessageFieldError({
        field: "version",
        metaMessages: [
          "- Version must be '1'.",
          "",
          `Provided value: ${version2}`
        ]
      });
    if (scheme && !schemeRegex.test(scheme))
      throw new InvalidMessageFieldError({
        field: "scheme",
        metaMessages: [
          "- Scheme must be an RFC 3986 URI scheme.",
          "- See https://www.rfc-editor.org/rfc/rfc3986#section-3.1",
          "",
          `Provided value: ${scheme}`
        ]
      });
    const statement2 = value.statement;
    if (statement2?.includes("\n"))
      throw new InvalidMessageFieldError({
        field: "statement",
        metaMessages: [
          "- Statement must not include '\\n'.",
          "",
          `Provided value: ${statement2}`
        ]
      });
  }
  const address = from5(value.address, { checksum: true });
  const origin = (() => {
    if (scheme)
      return `${scheme}://${domain}`;
    return domain;
  })();
  const statement = (() => {
    if (!value.statement)
      return "";
    return `${value.statement}
`;
  })();
  const prefix = `${origin} wants you to sign in with your Ethereum account:
${address}

${statement}`;
  let suffix = `URI: ${uri}
Version: ${version2}
Chain ID: ${chainId}
Nonce: ${nonce}
Issued At: ${issuedAt.toISOString()}`;
  if (expirationTime)
    suffix += `
Expiration Time: ${expirationTime.toISOString()}`;
  if (notBefore)
    suffix += `
Not Before: ${notBefore.toISOString()}`;
  if (requestId)
    suffix += `
Request ID: ${requestId}`;
  if (resources) {
    let content = "\nResources:";
    for (const resource of resources) {
      if (!isUri(resource))
        throw new InvalidMessageFieldError({
          field: "resources",
          metaMessages: [
            "- Every resource must be a RFC 3986 URI.",
            "- See https://www.rfc-editor.org/rfc/rfc3986",
            "",
            `Provided value: ${resource}`
          ]
        });
      content += `
- ${resource}`;
    }
    suffix += content;
  }
  return `${prefix}
${suffix}`;
}
function generateNonce() {
  return uid(96);
}
function isUri(value) {
  if (/[^a-z0-9:/?#[\]@!$&'()*+,;=.\-_~%]/i.test(value))
    return false;
  if (/%[^0-9a-f]/i.test(value))
    return false;
  if (/%[0-9a-f](:?[^0-9a-f]|$)/i.test(value))
    return false;
  const splitted = splitUri(value);
  const scheme = splitted[1];
  const authority = splitted[2];
  const path2 = splitted[3];
  const query = splitted[4];
  const fragment = splitted[5];
  if (!(scheme?.length && path2 && path2.length >= 0))
    return false;
  if (authority?.length) {
    if (!(path2.length === 0 || /^\//.test(path2)))
      return false;
  } else {
    if (/^\/\//.test(path2))
      return false;
  }
  if (!/^[a-z][a-z0-9+\-.]*$/.test(scheme.toLowerCase()))
    return false;
  let out = "";
  out += `${scheme}:`;
  if (authority?.length)
    out += `//${authority}`;
  out += path2;
  if (query?.length)
    out += `?${query}`;
  if (fragment?.length)
    out += `#${fragment}`;
  return out;
}
function splitUri(value) {
  return value.match(/(?:([^:/?#]+):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?/);
}
function parseMessage(message) {
  const { scheme, statement, ...prefix } = message.match(prefixRegex)?.groups ?? {};
  const { chainId, expirationTime, issuedAt, notBefore, requestId, ...suffix } = message.match(suffixRegex)?.groups ?? {};
  const resources = message.split("Resources:")[1]?.split("\n- ").slice(1);
  return {
    ...prefix,
    ...suffix,
    ...chainId ? { chainId: Number(chainId) } : {},
    ...expirationTime ? { expirationTime: new Date(expirationTime) } : {},
    ...issuedAt ? { issuedAt: new Date(issuedAt) } : {},
    ...notBefore ? { notBefore: new Date(notBefore) } : {},
    ...requestId ? { requestId } : {},
    ...resources ? { resources } : {},
    ...scheme ? { scheme } : {},
    ...statement ? { statement } : {}
  };
}
function validateMessage(value) {
  const { address, domain, message, nonce, scheme, time = /* @__PURE__ */ new Date() } = value;
  if (domain && message.domain !== domain)
    return false;
  if (nonce && message.nonce !== nonce)
    return false;
  if (scheme && message.scheme !== scheme)
    return false;
  if (message.expirationTime && time >= message.expirationTime)
    return false;
  if (message.notBefore && time < message.notBefore)
    return false;
  try {
    if (!message.address)
      return false;
    if (address && !isEqual3(message.address, address))
      return false;
  } catch {
    return false;
  }
  return true;
}
var InvalidMessageFieldError = class extends BaseError {
  constructor(parameters) {
    const { field, metaMessages } = parameters;
    super(`Invalid Sign-In with Ethereum message field "${field}".`, {
      metaMessages
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Siwe.InvalidMessageFieldError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/StateOverrides.js
var StateOverrides_exports = {};
__export(StateOverrides_exports, {
  fromRpc: () => fromRpc9,
  toRpc: () => toRpc9
});
function fromRpc9(rpcStateOverrides) {
  const stateOverrides = {};
  for (const [address, accountOverridesRpc] of Object.entries(rpcStateOverrides)) {
    const accountOverrides = {};
    if (accountOverridesRpc.balance)
      accountOverrides.balance = BigInt(accountOverridesRpc.balance);
    if (accountOverridesRpc.code)
      accountOverrides.code = accountOverridesRpc.code;
    if (accountOverridesRpc.movePrecompileToAddress)
      accountOverrides.movePrecompileToAddress = accountOverridesRpc.movePrecompileToAddress;
    if (accountOverridesRpc.nonce)
      accountOverrides.nonce = BigInt(accountOverridesRpc.nonce);
    if (accountOverridesRpc.state)
      accountOverrides.state = accountOverridesRpc.state;
    if (accountOverridesRpc.stateDiff)
      accountOverrides.stateDiff = accountOverridesRpc.stateDiff;
    stateOverrides[address] = accountOverrides;
  }
  return stateOverrides;
}
function toRpc9(stateOverrides) {
  const rpcStateOverrides = {};
  for (const [address, accountOverrides] of Object.entries(stateOverrides)) {
    const accountOverridesRpc = {};
    if (typeof accountOverrides.balance === "bigint")
      accountOverridesRpc.balance = fromNumber(accountOverrides.balance);
    if (accountOverrides.code)
      accountOverridesRpc.code = accountOverrides.code;
    if (accountOverrides.movePrecompileToAddress)
      accountOverridesRpc.movePrecompileToAddress = accountOverrides.movePrecompileToAddress;
    if (typeof accountOverrides.nonce === "bigint")
      accountOverridesRpc.nonce = fromNumber(accountOverrides.nonce);
    if (accountOverrides.state)
      accountOverridesRpc.state = accountOverrides.state;
    if (accountOverrides.stateDiff)
      accountOverridesRpc.stateDiff = accountOverrides.stateDiff;
    rpcStateOverrides[address] = accountOverridesRpc;
  }
  return rpcStateOverrides;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/TransactionReceipt.js
var TransactionReceipt_exports = {};
__export(TransactionReceipt_exports, {
  fromRpc: () => fromRpc10,
  fromRpcStatus: () => fromRpcStatus,
  fromRpcType: () => fromRpcType2,
  toRpc: () => toRpc10,
  toRpcStatus: () => toRpcStatus,
  toRpcType: () => toRpcType2
});
var fromRpcStatus = {
  "0x0": "reverted",
  "0x1": "success"
};
var toRpcStatus = {
  reverted: "0x0",
  success: "0x1"
};
var fromRpcType2 = {
  "0x0": "legacy",
  "0x1": "eip2930",
  "0x2": "eip1559",
  "0x3": "eip4844",
  "0x4": "eip7702"
};
var toRpcType2 = {
  legacy: "0x0",
  eip2930: "0x1",
  eip1559: "0x2",
  eip4844: "0x3",
  eip7702: "0x4"
};
function fromRpc10(receipt) {
  if (!receipt)
    return null;
  return {
    ...receipt,
    blobGasPrice: receipt.blobGasPrice ? BigInt(receipt.blobGasPrice) : void 0,
    blobGasUsed: receipt.blobGasUsed ? BigInt(receipt.blobGasUsed) : void 0,
    blockNumber: BigInt(receipt.blockNumber ?? 0n),
    cumulativeGasUsed: BigInt(receipt.cumulativeGasUsed ?? 0n),
    effectiveGasPrice: BigInt(receipt.effectiveGasPrice ?? 0n),
    gasUsed: BigInt(receipt.gasUsed ?? 0n),
    logs: receipt.logs.map((log) => fromRpc8(log, { pending: false })),
    status: fromRpcStatus[receipt.status],
    transactionIndex: Number(receipt.transactionIndex ?? 0),
    type: fromRpcType2[receipt.type] || receipt.type
  };
}
function toRpc10(receipt) {
  return {
    blobGasPrice: receipt.blobGasPrice ? fromNumber(receipt.blobGasPrice) : void 0,
    blobGasUsed: receipt.blobGasUsed ? fromNumber(receipt.blobGasUsed) : void 0,
    blockHash: receipt.blockHash,
    blockNumber: fromNumber(receipt.blockNumber),
    contractAddress: receipt.contractAddress,
    cumulativeGasUsed: fromNumber(receipt.cumulativeGasUsed),
    effectiveGasPrice: fromNumber(receipt.effectiveGasPrice),
    from: receipt.from,
    gasUsed: fromNumber(receipt.gasUsed),
    logs: receipt.logs.map(toRpc8),
    logsBloom: receipt.logsBloom,
    root: receipt.root,
    status: toRpcStatus[receipt.status],
    to: receipt.to,
    transactionHash: receipt.transactionHash,
    transactionIndex: fromNumber(receipt.transactionIndex),
    type: toRpcType2[receipt.type] ?? receipt.type
  };
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/TransactionRequest.js
var TransactionRequest_exports = {};
__export(TransactionRequest_exports, {
  fromRpc: () => fromRpc11,
  toRpc: () => toRpc11
});
function fromRpc11(request) {
  const request_ = request;
  if (typeof request.authorizationList !== "undefined")
    request_.authorizationList = fromRpcList(request.authorizationList);
  if (typeof request.chainId !== "undefined")
    request_.chainId = toNumber(request.chainId);
  if (typeof request.gas !== "undefined")
    request_.gas = toBigInt(request.gas);
  if (typeof request.gasPrice !== "undefined")
    request_.gasPrice = toBigInt(request.gasPrice);
  if (typeof request.maxFeePerBlobGas !== "undefined")
    request_.maxFeePerBlobGas = toBigInt(request.maxFeePerBlobGas);
  if (typeof request.maxFeePerGas !== "undefined")
    request_.maxFeePerGas = toBigInt(request.maxFeePerGas);
  if (typeof request.maxPriorityFeePerGas !== "undefined")
    request_.maxPriorityFeePerGas = toBigInt(request.maxPriorityFeePerGas);
  if (typeof request.nonce !== "undefined")
    request_.nonce = toBigInt(request.nonce);
  if (typeof request.type !== "undefined")
    request_.type = fromRpcType[request.type] || request.type;
  if (typeof request.value !== "undefined")
    request_.value = toBigInt(request.value);
  return request_;
}
function toRpc11(request) {
  const request_rpc = {};
  if (typeof request.accessList !== "undefined")
    request_rpc.accessList = request.accessList;
  if (typeof request.authorizationList !== "undefined")
    request_rpc.authorizationList = toRpcList(request.authorizationList);
  if (typeof request.blobVersionedHashes !== "undefined")
    request_rpc.blobVersionedHashes = request.blobVersionedHashes;
  if (typeof request.blobs !== "undefined")
    request_rpc.blobs = request.blobs;
  if (typeof request.chainId !== "undefined")
    request_rpc.chainId = fromNumber(request.chainId);
  if (typeof request.data !== "undefined") {
    request_rpc.data = request.data;
    request_rpc.input = request.data;
  } else if (typeof request.input !== "undefined") {
    request_rpc.data = request.input;
    request_rpc.input = request.input;
  }
  if (typeof request.from !== "undefined")
    request_rpc.from = request.from;
  if (typeof request.gas !== "undefined")
    request_rpc.gas = fromNumber(request.gas);
  if (typeof request.gasPrice !== "undefined")
    request_rpc.gasPrice = fromNumber(request.gasPrice);
  if (typeof request.maxFeePerBlobGas !== "undefined")
    request_rpc.maxFeePerBlobGas = fromNumber(request.maxFeePerBlobGas);
  if (typeof request.maxFeePerGas !== "undefined")
    request_rpc.maxFeePerGas = fromNumber(request.maxFeePerGas);
  if (typeof request.maxPriorityFeePerGas !== "undefined")
    request_rpc.maxPriorityFeePerGas = fromNumber(request.maxPriorityFeePerGas);
  if (typeof request.maxPriorityFeePerGas !== "undefined")
    request_rpc.maxPriorityFeePerGas = fromNumber(request.maxPriorityFeePerGas);
  if (typeof request.nonce !== "undefined")
    request_rpc.nonce = fromNumber(request.nonce);
  if (typeof request.to !== "undefined")
    request_rpc.to = request.to;
  if (typeof request.type !== "undefined")
    request_rpc.type = toRpcType[request.type] || request.type;
  if (typeof request.value !== "undefined")
    request_rpc.value = fromNumber(request.value);
  return request_rpc;
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/TxEnvelope.js
var TxEnvelope_exports = {};
__export(TxEnvelope_exports, {
  FeeCapTooHighError: () => FeeCapTooHighError,
  GasPriceTooHighError: () => GasPriceTooHighError,
  InvalidChainIdError: () => InvalidChainIdError,
  InvalidSerializedError: () => InvalidSerializedError,
  TipAboveFeeCapError: () => TipAboveFeeCapError
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/Value.js
var Value_exports = {};
__export(Value_exports, {
  InvalidDecimalNumberError: () => InvalidDecimalNumberError,
  exponents: () => exponents,
  format: () => format8,
  formatEther: () => formatEther,
  formatGwei: () => formatGwei,
  from: () => from23,
  fromEther: () => fromEther,
  fromGwei: () => fromGwei
});
var exponents = {
  wei: 0,
  gwei: 9,
  szabo: 12,
  finney: 15,
  ether: 18
};
function format8(value, decimals = 0) {
  let display = value.toString();
  const negative = display.startsWith("-");
  if (negative)
    display = display.slice(1);
  display = display.padStart(decimals, "0");
  let [integer, fraction] = [
    display.slice(0, display.length - decimals),
    display.slice(display.length - decimals)
  ];
  fraction = fraction.replace(/(0+)$/, "");
  return `${negative ? "-" : ""}${integer || "0"}${fraction ? `.${fraction}` : ""}`;
}
function formatEther(wei, unit = "wei") {
  return format8(wei, exponents.ether - exponents[unit]);
}
function formatGwei(wei, unit = "wei") {
  return format8(wei, exponents.gwei - exponents[unit]);
}
function from23(value, decimals = 0) {
  if (!/^(-?)([0-9]*)\.?([0-9]*)$/.test(value))
    throw new InvalidDecimalNumberError({ value });
  let [integer = "", fraction = "0"] = value.split(".");
  const negative = integer.startsWith("-");
  if (negative)
    integer = integer.slice(1);
  fraction = fraction.replace(/(0+)$/, "");
  if (decimals === 0) {
    if (Math.round(Number(`.${fraction}`)) === 1)
      integer = `${BigInt(integer) + 1n}`;
    fraction = "";
  } else if (fraction.length > decimals) {
    const [left, unit, right] = [
      fraction.slice(0, decimals - 1),
      fraction.slice(decimals - 1, decimals),
      fraction.slice(decimals)
    ];
    const rounded = Math.round(Number(`${unit}.${right}`));
    if (rounded > 9)
      fraction = `${BigInt(left) + BigInt(1)}0`.padStart(left.length + 1, "0");
    else
      fraction = `${left}${rounded}`;
    if (fraction.length > decimals) {
      fraction = fraction.slice(1);
      integer = `${BigInt(integer) + 1n}`;
    }
    fraction = fraction.slice(0, decimals);
  } else {
    fraction = fraction.padEnd(decimals, "0");
  }
  return BigInt(`${negative ? "-" : ""}${integer}${fraction}`);
}
function fromEther(ether, unit = "wei") {
  return from23(ether, exponents.ether - exponents[unit]);
}
function fromGwei(gwei, unit = "wei") {
  return from23(gwei, exponents.gwei - exponents[unit]);
}
var InvalidDecimalNumberError = class extends BaseError {
  constructor({ value }) {
    super(`Value \`${value}\` is not a valid decimal number.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "Value.InvalidDecimalNumberError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/TxEnvelope.js
var FeeCapTooHighError = class extends BaseError {
  constructor({ feeCap } = {}) {
    super(`The fee cap (\`maxFeePerGas\`/\`maxPriorityFeePerGas\`${feeCap ? ` = ${formatGwei(feeCap)} gwei` : ""}) cannot be higher than the maximum allowed value (2^256-1).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "TransactionEnvelope.FeeCapTooHighError"
    });
  }
};
var GasPriceTooHighError = class extends BaseError {
  constructor({ gasPrice } = {}) {
    super(`The gas price (\`gasPrice\`${gasPrice ? ` = ${formatGwei(gasPrice)} gwei` : ""}) cannot be higher than the maximum allowed value (2^256-1).`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "TransactionEnvelope.GasPriceTooHighError"
    });
  }
};
var InvalidChainIdError = class extends BaseError {
  constructor({ chainId }) {
    super(typeof chainId !== "undefined" ? `Chain ID "${chainId}" is invalid.` : "Chain ID is invalid.");
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "TransactionEnvelope.InvalidChainIdError"
    });
  }
};
var InvalidSerializedError = class extends BaseError {
  constructor({ attributes, serialized, type: type6 }) {
    const missing = Object.entries(attributes).map(([key, value]) => typeof value === "undefined" ? key : void 0).filter(Boolean);
    super(`Invalid serialized transaction of type "${type6}" was provided.`, {
      metaMessages: [
        `Serialized Transaction: "${serialized}"`,
        missing.length > 0 ? `Missing Attributes: ${missing.join(", ")}` : ""
      ].filter(Boolean)
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "TransactionEnvelope.InvalidSerializedError"
    });
  }
};
var TipAboveFeeCapError = class extends BaseError {
  constructor({ maxPriorityFeePerGas, maxFeePerGas } = {}) {
    super([
      `The provided tip (\`maxPriorityFeePerGas\`${maxPriorityFeePerGas ? ` = ${formatGwei(maxPriorityFeePerGas)} gwei` : ""}) cannot be higher than the fee cap (\`maxFeePerGas\`${maxFeePerGas ? ` = ${formatGwei(maxFeePerGas)} gwei` : ""}).`
    ].join("\n"));
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "TransactionEnvelope.TipAboveFeeCapError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/TxEnvelopeEip1559.js
var TxEnvelopeEip1559_exports = {};
__export(TxEnvelopeEip1559_exports, {
  assert: () => assert6,
  deserialize: () => deserialize,
  from: () => from24,
  getSignPayload: () => getSignPayload3,
  hash: () => hash3,
  serialize: () => serialize,
  serializedType: () => serializedType,
  toRpc: () => toRpc12,
  type: () => type,
  validate: () => validate9
});
var serializedType = "0x02";
var type = "eip1559";
function assert6(envelope) {
  const { chainId, maxPriorityFeePerGas, maxFeePerGas, to: to3 } = envelope;
  if (chainId <= 0)
    throw new InvalidChainIdError({ chainId });
  if (to3)
    assert4(to3, { strict: false });
  if (maxFeePerGas && BigInt(maxFeePerGas) > 2n ** 256n - 1n)
    throw new FeeCapTooHighError({ feeCap: maxFeePerGas });
  if (maxPriorityFeePerGas && maxFeePerGas && maxPriorityFeePerGas > maxFeePerGas)
    throw new TipAboveFeeCapError({
      maxFeePerGas,
      maxPriorityFeePerGas
    });
}
function deserialize(serialized) {
  const transactionArray = toHex3(slice(serialized, 1));
  const [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to3, value, data, accessList, yParity, r, s] = transactionArray;
  if (!(transactionArray.length === 9 || transactionArray.length === 12))
    throw new InvalidSerializedError({
      attributes: {
        chainId,
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gas,
        to: to3,
        value,
        data,
        accessList,
        ...transactionArray.length > 9 ? {
          yParity,
          r,
          s
        } : {}
      },
      serialized,
      type
    });
  let transaction = {
    chainId: Number(chainId),
    type
  };
  if (validate(to3) && to3 !== "0x")
    transaction.to = to3;
  if (validate(gas) && gas !== "0x")
    transaction.gas = BigInt(gas);
  if (validate(data) && data !== "0x")
    transaction.data = data;
  if (validate(nonce))
    transaction.nonce = nonce === "0x" ? 0n : BigInt(nonce);
  if (validate(value) && value !== "0x")
    transaction.value = BigInt(value);
  if (validate(maxFeePerGas) && maxFeePerGas !== "0x")
    transaction.maxFeePerGas = BigInt(maxFeePerGas);
  if (validate(maxPriorityFeePerGas) && maxPriorityFeePerGas !== "0x")
    transaction.maxPriorityFeePerGas = BigInt(maxPriorityFeePerGas);
  if (accessList.length !== 0 && accessList !== "0x")
    transaction.accessList = fromTupleList(accessList);
  const signature = r && s && yParity ? fromTuple([yParity, r, s]) : void 0;
  if (signature)
    transaction = {
      ...transaction,
      ...signature
    };
  assert6(transaction);
  return transaction;
}
function from24(envelope, options = {}) {
  const { signature } = options;
  const envelope_ = typeof envelope === "string" ? deserialize(envelope) : envelope;
  assert6(envelope_);
  return {
    ...envelope_,
    ...signature ? from13(signature) : {},
    type: "eip1559"
  };
}
function getSignPayload3(envelope) {
  return hash3(envelope, { presign: true });
}
function hash3(envelope, options = {}) {
  const { presign } = options;
  return keccak256(serialize({
    ...envelope,
    ...presign ? {
      r: void 0,
      s: void 0,
      yParity: void 0,
      v: void 0
    } : {}
  }));
}
function serialize(envelope, options = {}) {
  const { chainId, gas, nonce, to: to3, value, maxFeePerGas, maxPriorityFeePerGas, accessList, data, input } = envelope;
  assert6(envelope);
  const accessTupleList = toTupleList(accessList);
  const signature = extract(options.signature || envelope);
  const serialized = [
    fromNumber(chainId),
    nonce ? fromNumber(nonce) : "0x",
    maxPriorityFeePerGas ? fromNumber(maxPriorityFeePerGas) : "0x",
    maxFeePerGas ? fromNumber(maxFeePerGas) : "0x",
    gas ? fromNumber(gas) : "0x",
    to3 ?? "0x",
    value ? fromNumber(value) : "0x",
    data ?? input ?? "0x",
    accessTupleList,
    ...signature ? toTuple(signature) : []
  ];
  return concat(serializedType, fromHex3(serialized));
}
function toRpc12(envelope) {
  const signature = extract(envelope);
  return {
    ...envelope,
    chainId: fromNumber(envelope.chainId),
    data: envelope.data ?? envelope.input,
    type: "0x2",
    ...typeof envelope.gas === "bigint" ? { gas: fromNumber(envelope.gas) } : {},
    ...typeof envelope.nonce === "bigint" ? { nonce: fromNumber(envelope.nonce) } : {},
    ...typeof envelope.value === "bigint" ? { value: fromNumber(envelope.value) } : {},
    ...typeof envelope.maxFeePerGas === "bigint" ? { maxFeePerGas: fromNumber(envelope.maxFeePerGas) } : {},
    ...typeof envelope.maxPriorityFeePerGas === "bigint" ? {
      maxPriorityFeePerGas: fromNumber(envelope.maxPriorityFeePerGas)
    } : {},
    ...signature ? toRpc(signature) : {}
  };
}
function validate9(envelope) {
  try {
    assert6(envelope);
    return true;
  } catch {
    return false;
  }
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/TxEnvelopeEip2930.js
var TxEnvelopeEip2930_exports = {};
__export(TxEnvelopeEip2930_exports, {
  assert: () => assert7,
  deserialize: () => deserialize2,
  from: () => from25,
  getSignPayload: () => getSignPayload4,
  hash: () => hash4,
  serialize: () => serialize2,
  serializedType: () => serializedType2,
  toRpc: () => toRpc13,
  type: () => type2,
  validate: () => validate10
});
var serializedType2 = "0x01";
var type2 = "eip2930";
function assert7(envelope) {
  const { chainId, gasPrice, to: to3 } = envelope;
  if (chainId <= 0)
    throw new InvalidChainIdError({ chainId });
  if (to3)
    assert4(to3, { strict: false });
  if (gasPrice && BigInt(gasPrice) > 2n ** 256n - 1n)
    throw new GasPriceTooHighError({ gasPrice });
}
function deserialize2(serialized) {
  const transactionArray = toHex3(slice(serialized, 1));
  const [chainId, nonce, gasPrice, gas, to3, value, data, accessList, yParity, r, s] = transactionArray;
  if (!(transactionArray.length === 8 || transactionArray.length === 11))
    throw new InvalidSerializedError({
      attributes: {
        chainId,
        nonce,
        gasPrice,
        gas,
        to: to3,
        value,
        data,
        accessList,
        ...transactionArray.length > 8 ? {
          yParity,
          r,
          s
        } : {}
      },
      serialized,
      type: type2
    });
  let transaction = {
    chainId: Number(chainId),
    type: type2
  };
  if (validate(to3) && to3 !== "0x")
    transaction.to = to3;
  if (validate(gas) && gas !== "0x")
    transaction.gas = BigInt(gas);
  if (validate(data) && data !== "0x")
    transaction.data = data;
  if (validate(nonce))
    transaction.nonce = nonce === "0x" ? 0n : BigInt(nonce);
  if (validate(value) && value !== "0x")
    transaction.value = BigInt(value);
  if (validate(gasPrice) && gasPrice !== "0x")
    transaction.gasPrice = BigInt(gasPrice);
  if (accessList.length !== 0 && accessList !== "0x")
    transaction.accessList = fromTupleList(accessList);
  const signature = r && s && yParity ? fromTuple([yParity, r, s]) : void 0;
  if (signature)
    transaction = {
      ...transaction,
      ...signature
    };
  assert7(transaction);
  return transaction;
}
function from25(envelope, options = {}) {
  const { signature } = options;
  const envelope_ = typeof envelope === "string" ? deserialize2(envelope) : envelope;
  assert7(envelope_);
  return {
    ...envelope_,
    ...signature ? from13(signature) : {},
    type: "eip2930"
  };
}
function getSignPayload4(envelope) {
  return hash4(envelope, { presign: true });
}
function hash4(envelope, options = {}) {
  const { presign } = options;
  return keccak256(serialize2({
    ...envelope,
    ...presign ? {
      r: void 0,
      s: void 0,
      yParity: void 0,
      v: void 0
    } : {}
  }));
}
function serialize2(envelope, options = {}) {
  const { chainId, gas, data, input, nonce, to: to3, value, accessList, gasPrice } = envelope;
  assert7(envelope);
  const accessTupleList = toTupleList(accessList);
  const signature = extract(options.signature || envelope);
  const serialized = [
    fromNumber(chainId),
    nonce ? fromNumber(nonce) : "0x",
    gasPrice ? fromNumber(gasPrice) : "0x",
    gas ? fromNumber(gas) : "0x",
    to3 ?? "0x",
    value ? fromNumber(value) : "0x",
    data ?? input ?? "0x",
    accessTupleList,
    ...signature ? toTuple(signature) : []
  ];
  return concat("0x01", fromHex3(serialized));
}
function toRpc13(envelope) {
  const signature = extract(envelope);
  return {
    ...envelope,
    chainId: fromNumber(envelope.chainId),
    data: envelope.data ?? envelope.input,
    ...typeof envelope.gas === "bigint" ? { gas: fromNumber(envelope.gas) } : {},
    ...typeof envelope.nonce === "bigint" ? { nonce: fromNumber(envelope.nonce) } : {},
    ...typeof envelope.value === "bigint" ? { value: fromNumber(envelope.value) } : {},
    ...typeof envelope.gasPrice === "bigint" ? { gasPrice: fromNumber(envelope.gasPrice) } : {},
    type: "0x1",
    ...signature ? toRpc(signature) : {}
  };
}
function validate10(envelope) {
  try {
    assert7(envelope);
    return true;
  } catch {
    return false;
  }
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/TxEnvelopeEip4844.js
var TxEnvelopeEip4844_exports = {};
__export(TxEnvelopeEip4844_exports, {
  assert: () => assert8,
  deserialize: () => deserialize3,
  from: () => from26,
  getSignPayload: () => getSignPayload5,
  hash: () => hash5,
  serialize: () => serialize3,
  serializedType: () => serializedType3,
  toRpc: () => toRpc14,
  type: () => type3,
  validate: () => validate11
});
var serializedType3 = "0x03";
var type3 = "eip4844";
function assert8(envelope) {
  const { blobVersionedHashes } = envelope;
  if (blobVersionedHashes) {
    if (blobVersionedHashes.length === 0)
      throw new EmptyBlobVersionedHashesError();
    for (const hash8 of blobVersionedHashes) {
      const size4 = size2(hash8);
      const version2 = toNumber(slice(hash8, 0, 1));
      if (size4 !== 32)
        throw new InvalidVersionedHashSizeError({ hash: hash8, size: size4 });
      if (version2 !== versionedHashVersion)
        throw new InvalidVersionedHashVersionError({
          hash: hash8,
          version: version2
        });
    }
  }
  assert6(envelope);
}
function deserialize3(serialized) {
  const transactionOrWrapperArray = toHex3(slice(serialized, 1));
  const hasNetworkWrapper = transactionOrWrapperArray.length === 4;
  const transactionArray = hasNetworkWrapper ? transactionOrWrapperArray[0] : transactionOrWrapperArray;
  const wrapperArray = hasNetworkWrapper ? transactionOrWrapperArray.slice(1) : [];
  const [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to3, value, data, accessList, maxFeePerBlobGas, blobVersionedHashes, yParity, r, s] = transactionArray;
  const [blobs, commitments, proofs] = wrapperArray;
  if (!(transactionArray.length === 11 || transactionArray.length === 14))
    throw new InvalidSerializedError({
      attributes: {
        chainId,
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gas,
        to: to3,
        value,
        data,
        accessList,
        ...transactionArray.length > 9 ? {
          yParity,
          r,
          s
        } : {}
      },
      serialized,
      type: type3
    });
  let transaction = {
    blobVersionedHashes,
    chainId: Number(chainId),
    type: type3
  };
  if (validate(to3) && to3 !== "0x")
    transaction.to = to3;
  if (validate(gas) && gas !== "0x")
    transaction.gas = BigInt(gas);
  if (validate(data) && data !== "0x")
    transaction.data = data;
  if (validate(nonce))
    transaction.nonce = nonce === "0x" ? 0n : BigInt(nonce);
  if (validate(value) && value !== "0x")
    transaction.value = BigInt(value);
  if (validate(maxFeePerBlobGas) && maxFeePerBlobGas !== "0x")
    transaction.maxFeePerBlobGas = BigInt(maxFeePerBlobGas);
  if (validate(maxFeePerGas) && maxFeePerGas !== "0x")
    transaction.maxFeePerGas = BigInt(maxFeePerGas);
  if (validate(maxPriorityFeePerGas) && maxPriorityFeePerGas !== "0x")
    transaction.maxPriorityFeePerGas = BigInt(maxPriorityFeePerGas);
  if (accessList?.length !== 0 && accessList !== "0x")
    transaction.accessList = fromTupleList(accessList);
  if (blobs && commitments && proofs)
    transaction.sidecars = toSidecars(blobs, {
      commitments,
      proofs
    });
  const signature = r && s && yParity ? fromTuple([yParity, r, s]) : void 0;
  if (signature)
    transaction = {
      ...transaction,
      ...signature
    };
  assert8(transaction);
  return transaction;
}
function from26(envelope, options = {}) {
  const { signature } = options;
  const envelope_ = typeof envelope === "string" ? deserialize3(envelope) : envelope;
  assert8(envelope_);
  return {
    ...envelope_,
    ...signature ? from13(signature) : {},
    type: "eip4844"
  };
}
function getSignPayload5(envelope) {
  return hash5(envelope, { presign: true });
}
function hash5(envelope, options = {}) {
  const { presign } = options;
  return keccak256(serialize3({
    ...envelope,
    ...presign ? {
      sidecars: void 0,
      r: void 0,
      s: void 0,
      yParity: void 0,
      v: void 0
    } : {}
  }));
}
function serialize3(envelope, options = {}) {
  const { blobVersionedHashes, chainId, gas, nonce, to: to3, value, maxFeePerBlobGas, maxFeePerGas, maxPriorityFeePerGas, accessList, data } = envelope;
  assert8(envelope);
  const accessTupleList = toTupleList(accessList);
  const signature = extract(options.signature || envelope);
  const serialized = [
    fromNumber(chainId),
    nonce ? fromNumber(nonce) : "0x",
    maxPriorityFeePerGas ? fromNumber(maxPriorityFeePerGas) : "0x",
    maxFeePerGas ? fromNumber(maxFeePerGas) : "0x",
    gas ? fromNumber(gas) : "0x",
    to3 ?? "0x",
    value ? fromNumber(value) : "0x",
    data ?? "0x",
    accessTupleList,
    maxFeePerBlobGas ? fromNumber(maxFeePerBlobGas) : "0x",
    blobVersionedHashes ?? [],
    ...signature ? toTuple(signature) : []
  ];
  const sidecars = options.sidecars || envelope.sidecars;
  const blobs = [];
  const commitments = [];
  const proofs = [];
  if (sidecars)
    for (let i = 0; i < sidecars.length; i++) {
      const { blob, commitment, proof } = sidecars[i];
      blobs.push(blob);
      commitments.push(commitment);
      proofs.push(proof);
    }
  return concat("0x03", sidecars ? (
    // If sidecars are provided, envelope turns into a "network wrapper":
    fromHex3([serialized, blobs, commitments, proofs])
  ) : (
    // Otherwise, standard envelope is used:
    fromHex3(serialized)
  ));
}
function toRpc14(envelope) {
  const signature = extract(envelope);
  return {
    ...envelope,
    chainId: fromNumber(envelope.chainId),
    data: envelope.data ?? envelope.input,
    ...typeof envelope.gas === "bigint" ? { gas: fromNumber(envelope.gas) } : {},
    ...typeof envelope.nonce === "bigint" ? { nonce: fromNumber(envelope.nonce) } : {},
    ...typeof envelope.value === "bigint" ? { value: fromNumber(envelope.value) } : {},
    ...typeof envelope.maxFeePerBlobGas === "bigint" ? { maxFeePerBlobGas: fromNumber(envelope.maxFeePerBlobGas) } : {},
    ...typeof envelope.maxFeePerGas === "bigint" ? { maxFeePerGas: fromNumber(envelope.maxFeePerGas) } : {},
    ...typeof envelope.maxPriorityFeePerGas === "bigint" ? { maxPriorityFeePerGas: fromNumber(envelope.maxPriorityFeePerGas) } : {},
    type: "0x3",
    ...signature ? toRpc(signature) : {}
  };
}
function validate11(envelope) {
  try {
    assert8(envelope);
    return true;
  } catch {
    return false;
  }
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/TxEnvelopeEip7702.js
var TxEnvelopeEip7702_exports = {};
__export(TxEnvelopeEip7702_exports, {
  assert: () => assert9,
  deserialize: () => deserialize4,
  from: () => from27,
  getSignPayload: () => getSignPayload6,
  hash: () => hash6,
  serialize: () => serialize4,
  serializedType: () => serializedType4,
  type: () => type4,
  validate: () => validate12
});
var serializedType4 = "0x04";
var type4 = "eip7702";
function assert9(envelope) {
  const { authorizationList } = envelope;
  if (authorizationList) {
    for (const authorization of authorizationList) {
      const { address, chainId } = authorization;
      if (address)
        assert4(address, { strict: false });
      if (Number(chainId) < 0)
        throw new InvalidChainIdError({ chainId });
    }
  }
  assert6(envelope);
}
function deserialize4(serialized) {
  const transactionArray = toHex3(slice(serialized, 1));
  const [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to3, value, data, accessList, authorizationList, yParity, r, s] = transactionArray;
  if (!(transactionArray.length === 10 || transactionArray.length === 13))
    throw new InvalidSerializedError({
      attributes: {
        chainId,
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gas,
        to: to3,
        value,
        data,
        accessList,
        authorizationList,
        ...transactionArray.length > 9 ? {
          yParity,
          r,
          s
        } : {}
      },
      serialized,
      type: type4
    });
  let transaction = {
    chainId: Number(chainId),
    type: type4
  };
  if (validate(to3) && to3 !== "0x")
    transaction.to = to3;
  if (validate(gas) && gas !== "0x")
    transaction.gas = BigInt(gas);
  if (validate(data) && data !== "0x")
    transaction.data = data;
  if (validate(nonce))
    transaction.nonce = nonce === "0x" ? 0n : BigInt(nonce);
  if (validate(value) && value !== "0x")
    transaction.value = BigInt(value);
  if (validate(maxFeePerGas) && maxFeePerGas !== "0x")
    transaction.maxFeePerGas = BigInt(maxFeePerGas);
  if (validate(maxPriorityFeePerGas) && maxPriorityFeePerGas !== "0x")
    transaction.maxPriorityFeePerGas = BigInt(maxPriorityFeePerGas);
  if (accessList.length !== 0 && accessList !== "0x")
    transaction.accessList = fromTupleList(accessList);
  if (authorizationList !== "0x")
    transaction.authorizationList = fromTupleList2(authorizationList);
  const signature = r && s && yParity ? fromTuple([yParity, r, s]) : void 0;
  if (signature)
    transaction = {
      ...transaction,
      ...signature
    };
  assert9(transaction);
  return transaction;
}
function from27(envelope, options = {}) {
  const { signature } = options;
  const envelope_ = typeof envelope === "string" ? deserialize4(envelope) : envelope;
  assert9(envelope_);
  return {
    ...envelope_,
    ...signature ? from13(signature) : {},
    type: "eip7702"
  };
}
function getSignPayload6(envelope) {
  return hash6(envelope, { presign: true });
}
function hash6(envelope, options = {}) {
  const { presign } = options;
  return keccak256(serialize4({
    ...envelope,
    ...presign ? {
      r: void 0,
      s: void 0,
      yParity: void 0
    } : {}
  }));
}
function serialize4(envelope, options = {}) {
  const { authorizationList, chainId, gas, nonce, to: to3, value, maxFeePerGas, maxPriorityFeePerGas, accessList, data, input } = envelope;
  assert9(envelope);
  const accessTupleList = toTupleList(accessList);
  const authorizationTupleList = toTupleList2(authorizationList);
  const signature = extract(options.signature || envelope);
  const serialized = [
    fromNumber(chainId),
    nonce ? fromNumber(nonce) : "0x",
    maxPriorityFeePerGas ? fromNumber(maxPriorityFeePerGas) : "0x",
    maxFeePerGas ? fromNumber(maxFeePerGas) : "0x",
    gas ? fromNumber(gas) : "0x",
    to3 ?? "0x",
    value ? fromNumber(value) : "0x",
    data ?? input ?? "0x",
    accessTupleList,
    authorizationTupleList,
    ...signature ? toTuple(signature) : []
  ];
  return concat(serializedType4, fromHex3(serialized));
}
function validate12(envelope) {
  try {
    assert9(envelope);
    return true;
  } catch {
    return false;
  }
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/TxEnvelopeLegacy.js
var TxEnvelopeLegacy_exports = {};
__export(TxEnvelopeLegacy_exports, {
  assert: () => assert10,
  deserialize: () => deserialize5,
  from: () => from28,
  getSignPayload: () => getSignPayload7,
  hash: () => hash7,
  serialize: () => serialize5,
  toRpc: () => toRpc15,
  type: () => type5,
  validate: () => validate13
});
var type5 = "legacy";
function assert10(envelope) {
  const { chainId, gasPrice, to: to3 } = envelope;
  if (to3)
    assert4(to3, { strict: false });
  if (typeof chainId !== "undefined" && chainId <= 0)
    throw new InvalidChainIdError({ chainId });
  if (gasPrice && BigInt(gasPrice) > 2n ** 256n - 1n)
    throw new GasPriceTooHighError({ gasPrice });
}
function deserialize5(serialized) {
  const tuple = toHex3(serialized);
  const [nonce, gasPrice, gas, to3, value, data, chainIdOrV_, r, s] = tuple;
  if (!(tuple.length === 6 || tuple.length === 9))
    throw new InvalidSerializedError({
      attributes: {
        nonce,
        gasPrice,
        gas,
        to: to3,
        value,
        data,
        ...tuple.length > 6 ? {
          v: chainIdOrV_,
          r,
          s
        } : {}
      },
      serialized,
      type: type5
    });
  const transaction = {
    type: type5
  };
  if (validate(to3) && to3 !== "0x")
    transaction.to = to3;
  if (validate(gas) && gas !== "0x")
    transaction.gas = BigInt(gas);
  if (validate(data) && data !== "0x")
    transaction.data = data;
  if (validate(nonce))
    transaction.nonce = nonce === "0x" ? 0n : BigInt(nonce);
  if (validate(value) && value !== "0x")
    transaction.value = BigInt(value);
  if (validate(gasPrice) && gasPrice !== "0x")
    transaction.gasPrice = BigInt(gasPrice);
  if (tuple.length === 6)
    return transaction;
  const chainIdOrV = validate(chainIdOrV_) && chainIdOrV_ !== "0x" ? Number(chainIdOrV_) : 0;
  if (s === "0x" && r === "0x") {
    if (chainIdOrV > 0)
      transaction.chainId = Number(chainIdOrV);
    return transaction;
  }
  const v = chainIdOrV;
  const chainId = Math.floor((v - 35) / 2);
  if (chainId > 0)
    transaction.chainId = chainId;
  else if (v !== 27 && v !== 28)
    throw new InvalidVError({ value: v });
  transaction.yParity = vToYParity(v);
  transaction.v = v;
  transaction.s = s === "0x" ? 0n : BigInt(s);
  transaction.r = r === "0x" ? 0n : BigInt(r);
  assert10(transaction);
  return transaction;
}
function from28(envelope, options = {}) {
  const { signature } = options;
  const envelope_ = typeof envelope === "string" ? deserialize5(envelope) : envelope;
  assert10(envelope_);
  const signature_ = (() => {
    if (!signature)
      return {};
    const s = from13(signature);
    s.v = yParityToV(s.yParity);
    return s;
  })();
  return {
    ...envelope_,
    ...signature_,
    type: "legacy"
  };
}
function getSignPayload7(envelope) {
  return hash7(envelope, { presign: true });
}
function hash7(envelope, options = {}) {
  const { presign } = options;
  return keccak256(serialize5({
    ...envelope,
    ...presign ? {
      r: void 0,
      s: void 0,
      yParity: void 0,
      v: void 0
    } : {}
  }));
}
function serialize5(envelope, options = {}) {
  const { chainId = 0, gas, data, input, nonce, to: to3, value, gasPrice } = envelope;
  assert10(envelope);
  let serialized = [
    nonce ? fromNumber(nonce) : "0x",
    gasPrice ? fromNumber(gasPrice) : "0x",
    gas ? fromNumber(gas) : "0x",
    to3 ?? "0x",
    value ? fromNumber(value) : "0x",
    data ?? input ?? "0x"
  ];
  const signature = (() => {
    if (options.signature)
      return {
        r: options.signature.r,
        s: options.signature.s,
        v: yParityToV(options.signature.yParity)
      };
    if (typeof envelope.r === "undefined" || typeof envelope.s === "undefined")
      return void 0;
    return {
      r: envelope.r,
      s: envelope.s,
      v: envelope.v
    };
  })();
  if (signature) {
    const v = (() => {
      if (signature.v >= 35) {
        const inferredChainId = Math.floor((signature.v - 35) / 2);
        if (inferredChainId > 0)
          return signature.v;
        return 27 + (signature.v === 35 ? 0 : 1);
      }
      if (chainId > 0)
        return chainId * 2 + 35 + signature.v - 27;
      const v2 = 27 + (signature.v === 27 ? 0 : 1);
      if (signature.v !== v2)
        throw new InvalidVError({ value: signature.v });
      return v2;
    })();
    serialized = [
      ...serialized,
      fromNumber(v),
      signature.r === 0n ? "0x" : trimLeft(fromNumber(signature.r)),
      signature.s === 0n ? "0x" : trimLeft(fromNumber(signature.s))
    ];
  } else if (chainId > 0)
    serialized = [...serialized, fromNumber(chainId), "0x", "0x"];
  return fromHex3(serialized);
}
function toRpc15(envelope) {
  const signature = extract(envelope);
  return {
    ...envelope,
    chainId: typeof envelope.chainId === "number" ? fromNumber(envelope.chainId) : void 0,
    data: envelope.data ?? envelope.input,
    type: "0x0",
    ...typeof envelope.gas === "bigint" ? { gas: fromNumber(envelope.gas) } : {},
    ...typeof envelope.nonce === "bigint" ? { nonce: fromNumber(envelope.nonce) } : {},
    ...typeof envelope.value === "bigint" ? { value: fromNumber(envelope.value) } : {},
    ...typeof envelope.gasPrice === "bigint" ? { gasPrice: fromNumber(envelope.gasPrice) } : {},
    ...signature ? {
      ...toRpc(signature),
      v: signature.yParity === 0 ? "0x1b" : "0x1c"
    } : {}
  };
}
function validate13(envelope) {
  try {
    assert10(envelope);
    return true;
  } catch {
    return false;
  }
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/TypedData.js
var TypedData_exports = {};
__export(TypedData_exports, {
  BytesSizeMismatchError: () => BytesSizeMismatchError2,
  InvalidDomainError: () => InvalidDomainError,
  InvalidPrimaryTypeError: () => InvalidPrimaryTypeError,
  InvalidStructTypeError: () => InvalidStructTypeError,
  assert: () => assert11,
  domainSeparator: () => domainSeparator,
  encode: () => encode8,
  encodeData: () => encodeData2,
  encodeField: () => encodeField,
  encodeType: () => encodeType,
  extractEip712DomainTypes: () => extractEip712DomainTypes,
  findTypeDependencies: () => findTypeDependencies,
  getSignPayload: () => getSignPayload8,
  hashDomain: () => hashDomain,
  hashStruct: () => hashStruct,
  hashType: () => hashType,
  serialize: () => serialize6,
  validate: () => validate14
});
function assert11(value) {
  const { domain, message, primaryType, types } = value;
  const validateData = (struct, data) => {
    for (const param of struct) {
      const { name, type: type6 } = param;
      const value2 = data[name];
      const integerMatch = type6.match(integerRegex);
      if (integerMatch && (typeof value2 === "number" || typeof value2 === "bigint")) {
        const [, base, size_] = integerMatch;
        fromNumber(value2, {
          signed: base === "int",
          size: Number.parseInt(size_ ?? "", 10) / 8
        });
      }
      if (type6 === "address" && typeof value2 === "string" && !validate5(value2))
        throw new InvalidAddressError({
          address: value2,
          cause: new InvalidInputError()
        });
      const bytesMatch = type6.match(bytesRegex);
      if (bytesMatch) {
        const [, size4] = bytesMatch;
        if (size4 && size2(value2) !== Number.parseInt(size4, 10))
          throw new BytesSizeMismatchError2({
            expectedSize: Number.parseInt(size4, 10),
            givenSize: size2(value2)
          });
      }
      const struct2 = types[type6];
      if (struct2) {
        validateReference(type6);
        validateData(struct2, value2);
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
function domainSeparator(domain) {
  return hashDomain({
    domain
  });
}
function encode8(value) {
  const { domain = {}, message, primaryType } = value;
  const types = {
    EIP712Domain: extractEip712DomainTypes(domain),
    ...value.types
  };
  assert11({
    domain,
    message,
    primaryType,
    types
  });
  const parts = ["0x19", "0x01"];
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
  return concat(...parts);
}
function encodeType(value) {
  const { primaryType, types } = value;
  let result = "";
  const unsortedDeps = findTypeDependencies({ primaryType, types });
  unsortedDeps.delete(primaryType);
  const deps = [primaryType, ...Array.from(unsortedDeps).sort()];
  for (const type6 of deps) {
    result += `${type6}(${(types[type6] ?? []).map(({ name, type: t }) => `${t} ${name}`).join(",")})`;
  }
  return result;
}
function extractEip712DomainTypes(domain) {
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
function getSignPayload8(value) {
  return keccak256(encode8(value));
}
function hashDomain(value) {
  const { domain, types } = value;
  return hashStruct({
    data: domain,
    primaryType: "EIP712Domain",
    types: {
      ...types,
      EIP712Domain: types?.EIP712Domain || extractEip712DomainTypes(domain)
    }
  });
}
function hashStruct(value) {
  const { data, primaryType, types } = value;
  const encoded = encodeData2({
    data,
    primaryType,
    types
  });
  return keccak256(encoded);
}
function serialize6(value) {
  const { domain: domain_, message: message_, primaryType, types } = value;
  const normalizeData = (struct, value2) => {
    const data = { ...value2 };
    for (const param of struct) {
      const { name, type: type6 } = param;
      if (type6 === "address")
        data[name] = data[name].toLowerCase();
    }
    return data;
  };
  const domain = (() => {
    if (!domain_)
      return {};
    const type6 = types.EIP712Domain ?? extractEip712DomainTypes(domain_);
    return normalizeData(type6, domain_);
  })();
  const message = (() => {
    if (primaryType === "EIP712Domain")
      return void 0;
    if (!types[primaryType])
      return {};
    return normalizeData(types[primaryType], message_);
  })();
  return stringify({ domain, message, primaryType, types }, (_, value2) => {
    if (typeof value2 === "bigint")
      return value2.toString();
    return value2;
  });
}
function validate14(value) {
  try {
    assert11(value);
    return true;
  } catch {
    return false;
  }
}
var BytesSizeMismatchError2 = class extends BaseError {
  constructor({ expectedSize, givenSize }) {
    super(`Expected bytes${expectedSize}, got bytes${givenSize}.`);
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "TypedData.BytesSizeMismatchError"
    });
  }
};
var InvalidDomainError = class extends BaseError {
  constructor({ domain }) {
    super(`Invalid domain "${stringify(domain)}".`, {
      metaMessages: ["Must be a valid EIP-712 domain."]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "TypedData.InvalidDomainError"
    });
  }
};
var InvalidPrimaryTypeError = class extends BaseError {
  constructor({ primaryType, types }) {
    super(`Invalid primary type \`${primaryType}\` must be one of \`${JSON.stringify(Object.keys(types))}\`.`, {
      metaMessages: ["Check that the primary type is a key in `types`."]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "TypedData.InvalidPrimaryTypeError"
    });
  }
};
var InvalidStructTypeError = class extends BaseError {
  constructor({ type: type6 }) {
    super(`Struct type "${type6}" is invalid.`, {
      metaMessages: ["Struct type must not be a Solidity type."]
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "TypedData.InvalidStructTypeError"
    });
  }
};
function encodeData2(value) {
  const { data, primaryType, types } = value;
  const encodedTypes = [{ type: "bytes32" }];
  const encodedValues = [hashType({ primaryType, types })];
  for (const field of types[primaryType] ?? []) {
    const [type6, value2] = encodeField({
      types,
      name: field.name,
      type: field.type,
      value: data[field.name]
    });
    encodedTypes.push(type6);
    encodedValues.push(value2);
  }
  return encode2(encodedTypes, encodedValues);
}
function hashType(value) {
  const { primaryType, types } = value;
  const encodedHashType = fromString(encodeType({ primaryType, types }));
  return keccak256(encodedHashType);
}
function encodeField(properties) {
  let { types, name, type: type6, value } = properties;
  if (types[type6] !== void 0)
    return [
      { type: "bytes32" },
      keccak256(encodeData2({ data: value, primaryType: type6, types }))
    ];
  if (type6 === "bytes") {
    const prepend = value.length % 2 ? "0" : "";
    value = `0x${prepend + value.slice(2)}`;
    return [{ type: "bytes32" }, keccak256(value, { as: "Hex" })];
  }
  if (type6 === "string")
    return [
      { type: "bytes32" },
      keccak256(fromString2(value), { as: "Hex" })
    ];
  if (type6.lastIndexOf("]") === type6.length - 1) {
    const parsedType = type6.slice(0, type6.lastIndexOf("["));
    const typeValuePairs = value.map((item) => encodeField({
      name,
      type: parsedType,
      types,
      value: item
    }));
    return [
      { type: "bytes32" },
      keccak256(encode2(typeValuePairs.map(([t]) => t), typeValuePairs.map(([, v]) => v)))
    ];
  }
  return [{ type: type6 }, value];
}
function findTypeDependencies(value, results = /* @__PURE__ */ new Set()) {
  const { primaryType: primaryType_, types } = value;
  const match = primaryType_.match(/^\w*/u);
  const primaryType = match?.[0];
  if (results.has(primaryType) || types[primaryType] === void 0)
    return results;
  results.add(primaryType);
  for (const field of types[primaryType])
    findTypeDependencies({ primaryType: field.type, types }, results);
  return results;
}
function validateReference(type6) {
  if (type6 === "address" || type6 === "bool" || type6 === "string" || type6.startsWith("bytes") || type6.startsWith("uint") || type6.startsWith("int"))
    throw new InvalidStructTypeError({ type: type6 });
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/ValidatorData.js
var ValidatorData_exports = {};
__export(ValidatorData_exports, {
  encode: () => encode9,
  getSignPayload: () => getSignPayload9
});
function encode9(value) {
  const { data, validator } = value;
  return concat(
    // Validator Data Format: `0x19 ‖ 0x00 ‖ <intended validator address> ‖ <data to sign>`
    "0x19",
    "0x00",
    validator,
    from2(data)
  );
}
function getSignPayload9(value) {
  return keccak256(encode9(value));
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/WebAuthnP256.js
var WebAuthnP256_exports = {};
__export(WebAuthnP256_exports, {
  CredentialCreationFailedError: () => CredentialCreationFailedError,
  CredentialRequestFailedError: () => CredentialRequestFailedError,
  createChallenge: () => createChallenge,
  createCredential: () => createCredential,
  getAuthenticatorData: () => getAuthenticatorData,
  getClientDataJSON: () => getClientDataJSON,
  getCredentialCreationOptions: () => getCredentialCreationOptions,
  getCredentialRequestOptions: () => getCredentialRequestOptions,
  getSignPayload: () => getSignPayload10,
  sign: () => sign5,
  verify: () => verify5
});

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/internal/webauthn.js
function parseAsn1Signature(bytes) {
  const r_start = bytes[4] === 0 ? 5 : 4;
  const r_end = r_start + 32;
  const s_start = bytes[r_end + 2] === 0 ? r_end + 3 : r_end + 2;
  const r = BigInt(fromBytes(bytes.slice(r_start, r_end)));
  const s = BigInt(fromBytes(bytes.slice(s_start)));
  return {
    r,
    s: s > p2562.CURVE.n / 2n ? p2562.CURVE.n - s : s
  };
}
async function parseCredentialPublicKey(response) {
  try {
    const publicKeyBuffer = response.getPublicKey();
    if (!publicKeyBuffer)
      throw new CredentialCreationFailedError();
    const publicKeyBytes = new Uint8Array(publicKeyBuffer);
    const cryptoKey = await crypto.subtle.importKey("spki", new Uint8Array(publicKeyBytes), {
      name: "ECDSA",
      namedCurve: "P-256",
      hash: "SHA-256"
    }, true, ["verify"]);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", cryptoKey));
    return from4(publicKey);
  } catch (error) {
    if (error.message !== "Permission denied to access object")
      throw error;
    const data = new Uint8Array(response.attestationObject);
    const coordinateLength = 32;
    const cborPrefix = 88;
    const findStart = (key) => {
      const coordinate = new Uint8Array([key, cborPrefix, coordinateLength]);
      for (let i = 0; i < data.length - coordinate.length; i++)
        if (coordinate.every((byte, j) => data[i + j] === byte))
          return i + coordinate.length;
      throw new CredentialCreationFailedError();
    };
    const xStart = findStart(33);
    const yStart = findStart(34);
    return from4(new Uint8Array([
      4,
      ...data.slice(xStart, xStart + coordinateLength),
      ...data.slice(yStart, yStart + coordinateLength)
    ]));
  }
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/WebAuthnP256.js
var createChallenge = Uint8Array.from([
  105,
  171,
  180,
  181,
  160,
  222,
  75,
  198,
  42,
  42,
  32,
  31,
  141,
  37,
  186,
  233
]);
async function createCredential(options) {
  const { createFn = window.navigator.credentials.create.bind(window.navigator.credentials), ...rest } = options;
  const creationOptions = getCredentialCreationOptions(rest);
  try {
    const credential = await createFn(creationOptions);
    if (!credential)
      throw new CredentialCreationFailedError();
    const response = credential.response;
    const publicKey = await parseCredentialPublicKey(response);
    return {
      id: credential.id,
      publicKey,
      raw: credential
    };
  } catch (error) {
    throw new CredentialCreationFailedError({
      cause: error
    });
  }
}
function getAuthenticatorData(options = {}) {
  const { flag = 5, rpId = window.location.hostname, signCount = 0 } = options;
  const rpIdHash = sha2563(fromString(rpId));
  const flag_bytes = fromNumber(flag, { size: 1 });
  const signCount_bytes = fromNumber(signCount, { size: 4 });
  return concat(rpIdHash, flag_bytes, signCount_bytes);
}
function getClientDataJSON(options) {
  const { challenge, crossOrigin = false, extraClientData, origin = window.location.origin } = options;
  return JSON.stringify({
    type: "webauthn.get",
    challenge: fromHex6(challenge, { url: true, pad: false }),
    origin,
    crossOrigin,
    ...extraClientData
  });
}
function getCredentialCreationOptions(options) {
  const { attestation = "none", authenticatorSelection = {
    residentKey: "preferred",
    requireResidentKey: false,
    userVerification: "required"
  }, challenge = createChallenge, excludeCredentialIds, extensions, name: name_, rp = {
    id: window.location.hostname,
    name: window.document.title
  }, user } = options;
  const name = user?.name ?? name_;
  return {
    publicKey: {
      attestation,
      authenticatorSelection,
      challenge: typeof challenge === "string" ? fromHex(challenge) : challenge,
      ...excludeCredentialIds ? {
        excludeCredentials: excludeCredentialIds?.map((id) => ({
          id: toBytes7(id),
          type: "public-key"
        }))
      } : {},
      pubKeyCredParams: [
        {
          type: "public-key",
          alg: -7
          // p256
        }
      ],
      ...extensions && { extensions },
      rp,
      user: {
        id: user?.id ?? keccak256(fromString2(name), { as: "Bytes" }),
        name,
        displayName: user?.displayName ?? name
      }
    }
  };
}
function getCredentialRequestOptions(options) {
  const { credentialId, challenge, extensions, rpId = window.location.hostname, userVerification = "required" } = options;
  return {
    publicKey: {
      ...credentialId ? {
        allowCredentials: Array.isArray(credentialId) ? credentialId.map((id) => ({
          id: toBytes7(id),
          type: "public-key"
        })) : [
          {
            id: toBytes7(credentialId),
            type: "public-key"
          }
        ]
      } : {},
      challenge: fromHex(challenge),
      ...extensions && { extensions },
      rpId,
      userVerification
    }
  };
}
function getSignPayload10(options) {
  const { challenge, crossOrigin, extraClientData, flag, origin, rpId, signCount, userVerification = "required" } = options;
  const authenticatorData = getAuthenticatorData({
    flag,
    rpId,
    signCount
  });
  const clientDataJSON = getClientDataJSON({
    challenge,
    crossOrigin,
    extraClientData,
    origin
  });
  const clientDataJSONHash = sha2563(fromString(clientDataJSON));
  const challengeIndex = clientDataJSON.indexOf('"challenge"');
  const typeIndex = clientDataJSON.indexOf('"type"');
  const metadata = {
    authenticatorData,
    clientDataJSON,
    challengeIndex,
    typeIndex,
    userVerificationRequired: userVerification === "required"
  };
  const payload = concat(authenticatorData, clientDataJSONHash);
  return { metadata, payload };
}
async function sign5(options) {
  const { getFn = window.navigator.credentials.get.bind(window.navigator.credentials), ...rest } = options;
  const requestOptions = getCredentialRequestOptions(rest);
  try {
    const credential = await getFn(requestOptions);
    if (!credential)
      throw new CredentialRequestFailedError();
    const response = credential.response;
    const clientDataJSON = String.fromCharCode(...new Uint8Array(response.clientDataJSON));
    const challengeIndex = clientDataJSON.indexOf('"challenge"');
    const typeIndex = clientDataJSON.indexOf('"type"');
    const signature = parseAsn1Signature(new Uint8Array(response.signature));
    return {
      metadata: {
        authenticatorData: fromBytes(new Uint8Array(response.authenticatorData)),
        clientDataJSON,
        challengeIndex,
        typeIndex,
        userVerificationRequired: requestOptions.publicKey.userVerification === "required"
      },
      signature,
      raw: credential
    };
  } catch (error) {
    throw new CredentialRequestFailedError({
      cause: error
    });
  }
}
function verify5(options) {
  const { challenge, hash: hash8 = true, metadata, publicKey, signature } = options;
  const { authenticatorData, challengeIndex, clientDataJSON, typeIndex, userVerificationRequired } = metadata;
  const authenticatorDataBytes = fromHex(authenticatorData);
  if (authenticatorDataBytes.length < 37)
    return false;
  const flag = authenticatorDataBytes[32];
  if ((flag & 1) !== 1)
    return false;
  if (userVerificationRequired && (flag & 4) !== 4)
    return false;
  if ((flag & 8) !== 8 && (flag & 16) === 16)
    return false;
  if (typeIndex !== void 0) {
    const type6 = '"type":"webauthn.get"';
    if (type6 !== clientDataJSON.slice(Number(typeIndex), type6.length + 1))
      return false;
  }
  const challengeMatch = challengeIndex !== void 0 ? clientDataJSON.slice(Number(challengeIndex)).match(/^"challenge":"(.*?)"/) : clientDataJSON.match(/"challenge":"(.*?)"/);
  if (!challengeMatch)
    return false;
  const [_, challenge_extracted] = challengeMatch;
  if (fromBytes(toBytes7(challenge_extracted)) !== challenge)
    return false;
  const clientDataJSONHash = sha2563(fromString2(clientDataJSON), {
    as: "Bytes"
  });
  const payload = concat2(authenticatorDataBytes, clientDataJSONHash);
  return verify4({
    hash: hash8,
    payload,
    publicKey,
    signature
  });
}
var CredentialCreationFailedError = class extends BaseError {
  constructor({ cause } = {}) {
    super("Failed to create credential.", {
      cause
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "WebAuthnP256.CredentialCreationFailedError"
    });
  }
};
var CredentialRequestFailedError = class extends BaseError {
  constructor({ cause } = {}) {
    super("Failed to request credential.", {
      cause
    });
    Object.defineProperty(this, "name", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: "WebAuthnP256.CredentialRequestFailedError"
    });
  }
};

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/WebCryptoP256.js
var WebCryptoP256_exports = {};
__export(WebCryptoP256_exports, {
  createKeyPair: () => createKeyPair5,
  createKeyPairECDH: () => createKeyPairECDH,
  getSharedSecret: () => getSharedSecret3,
  sign: () => sign6,
  verify: () => verify6
});
async function createKeyPair5(options = {}) {
  const { extractable = false } = options;
  const keypair = await globalThis.crypto.subtle.generateKey({
    name: "ECDSA",
    namedCurve: "P-256"
  }, extractable, ["sign", "verify"]);
  const publicKey_raw = await globalThis.crypto.subtle.exportKey("raw", keypair.publicKey);
  const publicKey = from4(new Uint8Array(publicKey_raw));
  return {
    privateKey: keypair.privateKey,
    publicKey
  };
}
async function createKeyPairECDH(options = {}) {
  const { extractable = false } = options;
  const keypair = await globalThis.crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, extractable, ["deriveKey", "deriveBits"]);
  const publicKey_raw = await globalThis.crypto.subtle.exportKey("raw", keypair.publicKey);
  const publicKey = from4(new Uint8Array(publicKey_raw));
  return {
    privateKey: keypair.privateKey,
    publicKey
  };
}
async function getSharedSecret3(options) {
  const { as = "Hex", privateKey, publicKey } = options;
  if (privateKey.algorithm.name === "ECDSA") {
    throw new Error("privateKey is not compatible with ECDH. please use `createKeyPairECDH` to create an ECDH key.");
  }
  const publicKeyCrypto = await globalThis.crypto.subtle.importKey("raw", toBytes3(publicKey), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecretBuffer = await globalThis.crypto.subtle.deriveBits({
    name: "ECDH",
    public: publicKeyCrypto
  }, privateKey, 256);
  const sharedSecret = new Uint8Array(sharedSecretBuffer);
  if (as === "Hex")
    return fromBytes(sharedSecret);
  return sharedSecret;
}
async function sign6(options) {
  const { payload, privateKey } = options;
  const signature = await globalThis.crypto.subtle.sign({
    name: "ECDSA",
    hash: "SHA-256"
  }, privateKey, from3(payload));
  const signature_bytes = fromArray(new Uint8Array(signature));
  const r = toBigInt2(slice2(signature_bytes, 0, 32));
  let s = toBigInt2(slice2(signature_bytes, 32, 64));
  if (s > p2562.CURVE.n / 2n)
    s = p2562.CURVE.n - s;
  return { r, s };
}
async function verify6(options) {
  const { payload, signature } = options;
  const publicKey = await globalThis.crypto.subtle.importKey("raw", toBytes3(options.publicKey), { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  return await globalThis.crypto.subtle.verify({
    name: "ECDSA",
    hash: "SHA-256"
  }, publicKey, concat2(fromNumber2(signature.r), fromNumber2(signature.s)), from3(payload));
}

// node_modules/@toruslabs/ethereum-controllers/node_modules/ox/_esm/core/X25519.js
var X25519_exports = {};
__export(X25519_exports, {
  createKeyPair: () => createKeyPair6,
  getPublicKey: () => getPublicKey5,
  getSharedSecret: () => getSharedSecret4,
  noble: () => noble5,
  randomPrivateKey: () => randomPrivateKey5
});
var noble5 = x25519;
function createKeyPair6(options = {}) {
  const { as = "Hex" } = options;
  const privateKey = randomPrivateKey5({ as });
  const publicKey = getPublicKey5({ privateKey, as });
  return {
    privateKey,
    publicKey
  };
}
function getPublicKey5(options) {
  const { as = "Hex", privateKey } = options;
  const privateKeyBytes = from3(privateKey);
  const publicKeyBytes = x25519.getPublicKey(privateKeyBytes);
  if (as === "Hex")
    return fromBytes(publicKeyBytes);
  return publicKeyBytes;
}
function getSharedSecret4(options) {
  const { as = "Hex", privateKey, publicKey } = options;
  const privateKeyBytes = from3(privateKey);
  const publicKeyBytes = from3(publicKey);
  const sharedSecretBytes = x25519.getSharedSecret(privateKeyBytes, publicKeyBytes);
  if (as === "Hex")
    return fromBytes(sharedSecretBytes);
  return sharedSecretBytes;
}
function randomPrivateKey5(options = {}) {
  const { as = "Hex" } = options;
  const bytes = x25519.utils.randomPrivateKey();
  if (as === "Hex")
    return fromBytes(bytes);
  return bytes;
}
export {
  Abi_exports as Abi,
  AbiConstructor_exports as AbiConstructor,
  AbiError_exports as AbiError,
  AbiEvent_exports as AbiEvent,
  AbiFunction_exports as AbiFunction,
  AbiItem_exports as AbiItem,
  AbiParameters_exports as AbiParameters,
  AccessList_exports as AccessList,
  AccountProof_exports as AccountProof,
  Address_exports as Address,
  AesGcm_exports as AesGcm,
  Authorization_exports as Authorization,
  Base58_exports as Base58,
  Base64_exports as Base64,
  BinaryStateTree_exports as BinaryStateTree,
  Blobs_exports as Blobs,
  Block_exports as Block,
  BlockOverrides_exports as BlockOverrides,
  Bloom_exports as Bloom,
  Bls_exports as Bls,
  BlsPoint_exports as BlsPoint,
  Bytes_exports as Bytes,
  Caches_exports as Caches,
  Cbor_exports as Cbor,
  ContractAddress_exports as ContractAddress,
  Ed25519_exports as Ed25519,
  Ens_exports as Ens,
  Errors_exports as Errors,
  Fee_exports as Fee,
  Filter_exports as Filter,
  Hash_exports as Hash,
  HdKey_exports as HdKey,
  Hex_exports as Hex,
  Json_exports as Json,
  Keystore_exports as Keystore,
  Kzg_exports as Kzg,
  Log_exports as Log,
  Mnemonic_exports as Mnemonic,
  P256_exports as P256,
  PersonalMessage_exports as PersonalMessage,
  Provider_exports as Provider,
  PublicKey_exports as PublicKey,
  Rlp_exports as Rlp,
  RpcRequest_exports as RpcRequest,
  RpcResponse_exports as RpcResponse,
  RpcSchema_exports as RpcSchema,
  RpcTransport_exports as RpcTransport,
  Secp256k1_exports as Secp256k1,
  Signature_exports as Signature,
  Siwe_exports as Siwe,
  Solidity_exports as Solidity,
  StateOverrides_exports as StateOverrides,
  Transaction_exports as Transaction,
  TxEnvelope_exports as TransactionEnvelope,
  TransactionReceipt_exports as TransactionReceipt,
  TransactionRequest_exports as TransactionRequest,
  TxEnvelopeEip1559_exports as TxEnvelopeEip1559,
  TxEnvelopeEip2930_exports as TxEnvelopeEip2930,
  TxEnvelopeEip4844_exports as TxEnvelopeEip4844,
  TxEnvelopeEip7702_exports as TxEnvelopeEip7702,
  TxEnvelopeLegacy_exports as TxEnvelopeLegacy,
  TypedData_exports as TypedData,
  ValidatorData_exports as ValidatorData,
  Value_exports as Value,
  WebAuthnP256_exports as WebAuthnP256,
  WebCryptoP256_exports as WebCryptoP256,
  Withdrawal_exports as Withdrawal,
  X25519_exports as X25519
};
