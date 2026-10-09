import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  __commonJS,
  __require
} from "./chunk-B7AVLEE2.mjs";

// node_modules/@babel/runtime/helpers/typeof.js
var require_typeof = __commonJS({
  "node_modules/@babel/runtime/helpers/typeof.js"(exports, module) {
    function _typeof(o) {
      "@babel/helpers - typeof";
      return module.exports = _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
        return typeof o2;
      } : function(o2) {
        return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
      }, module.exports.__esModule = true, module.exports["default"] = module.exports, _typeof(o);
    }
    module.exports = _typeof, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/toPrimitive.js
var require_toPrimitive = __commonJS({
  "node_modules/@babel/runtime/helpers/toPrimitive.js"(exports, module) {
    var _typeof = require_typeof()["default"];
    function toPrimitive(t, r) {
      if ("object" != _typeof(t) || !t) return t;
      var e = t[Symbol.toPrimitive];
      if (void 0 !== e) {
        var i = e.call(t, r || "default");
        if ("object" != _typeof(i)) return i;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return ("string" === r ? String : Number)(t);
    }
    module.exports = toPrimitive, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/toPropertyKey.js
var require_toPropertyKey = __commonJS({
  "node_modules/@babel/runtime/helpers/toPropertyKey.js"(exports, module) {
    var _typeof = require_typeof()["default"];
    var toPrimitive = require_toPrimitive();
    function toPropertyKey(t) {
      var i = toPrimitive(t, "string");
      return "symbol" == _typeof(i) ? i : i + "";
    }
    module.exports = toPropertyKey, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/defineProperty.js
var require_defineProperty = __commonJS({
  "node_modules/@babel/runtime/helpers/defineProperty.js"(exports, module) {
    var toPropertyKey = require_toPropertyKey();
    function _defineProperty(e, r, t) {
      return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
        value: t,
        enumerable: true,
        configurable: true,
        writable: true
      }) : e[r] = t, e;
    }
    module.exports = _defineProperty, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/@babel/runtime/helpers/objectSpread2.js
var require_objectSpread2 = __commonJS({
  "node_modules/@babel/runtime/helpers/objectSpread2.js"(exports, module) {
    var defineProperty = require_defineProperty();
    function ownKeys(e, r) {
      var t = Object.keys(e);
      if (Object.getOwnPropertySymbols) {
        var o = Object.getOwnPropertySymbols(e);
        r && (o = o.filter(function(r2) {
          return Object.getOwnPropertyDescriptor(e, r2).enumerable;
        })), t.push.apply(t, o);
      }
      return t;
    }
    function _objectSpread2(e) {
      for (var r = 1; r < arguments.length; r++) {
        var t = null != arguments[r] ? arguments[r] : {};
        r % 2 ? ownKeys(Object(t), true).forEach(function(r2) {
          defineProperty(e, r2, t[r2]);
        }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r2) {
          Object.defineProperty(e, r2, Object.getOwnPropertyDescriptor(t, r2));
        });
      }
      return e;
    }
    module.exports = _objectSpread2, module.exports.__esModule = true, module.exports["default"] = module.exports;
  }
});

// node_modules/ms/index.js
var require_ms = __commonJS({
  "node_modules/ms/index.js"(exports, module) {
    var s = 1e3;
    var m = s * 60;
    var h = m * 60;
    var d = h * 24;
    var w = d * 7;
    var y = d * 365.25;
    module.exports = function(val, options) {
      options = options || {};
      var type = typeof val;
      if (type === "string" && val.length > 0) {
        return parse(val);
      } else if (type === "number" && isFinite(val)) {
        return options.long ? fmtLong(val) : fmtShort(val);
      }
      throw new Error(
        "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
      );
    };
    function parse(str) {
      str = String(str);
      if (str.length > 100) {
        return;
      }
      var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        str
      );
      if (!match) {
        return;
      }
      var n = parseFloat(match[1]);
      var type = (match[2] || "ms").toLowerCase();
      switch (type) {
        case "years":
        case "year":
        case "yrs":
        case "yr":
        case "y":
          return n * y;
        case "weeks":
        case "week":
        case "w":
          return n * w;
        case "days":
        case "day":
        case "d":
          return n * d;
        case "hours":
        case "hour":
        case "hrs":
        case "hr":
        case "h":
          return n * h;
        case "minutes":
        case "minute":
        case "mins":
        case "min":
        case "m":
          return n * m;
        case "seconds":
        case "second":
        case "secs":
        case "sec":
        case "s":
          return n * s;
        case "milliseconds":
        case "millisecond":
        case "msecs":
        case "msec":
        case "ms":
          return n;
        default:
          return void 0;
      }
    }
    function fmtShort(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return Math.round(ms / d) + "d";
      }
      if (msAbs >= h) {
        return Math.round(ms / h) + "h";
      }
      if (msAbs >= m) {
        return Math.round(ms / m) + "m";
      }
      if (msAbs >= s) {
        return Math.round(ms / s) + "s";
      }
      return ms + "ms";
    }
    function fmtLong(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return plural(ms, msAbs, d, "day");
      }
      if (msAbs >= h) {
        return plural(ms, msAbs, h, "hour");
      }
      if (msAbs >= m) {
        return plural(ms, msAbs, m, "minute");
      }
      if (msAbs >= s) {
        return plural(ms, msAbs, s, "second");
      }
      return ms + " ms";
    }
    function plural(ms, msAbs, n, name) {
      var isPlural = msAbs >= n * 1.5;
      return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
    }
  }
});

// node_modules/debug/src/common.js
var require_common = __commonJS({
  "node_modules/debug/src/common.js"(exports, module) {
    function setup(env) {
      createDebug.debug = createDebug;
      createDebug.default = createDebug;
      createDebug.coerce = coerce;
      createDebug.disable = disable;
      createDebug.enable = enable;
      createDebug.enabled = enabled;
      createDebug.humanize = require_ms();
      createDebug.destroy = destroy;
      Object.keys(env).forEach((key) => {
        createDebug[key] = env[key];
      });
      createDebug.names = [];
      createDebug.skips = [];
      createDebug.formatters = {};
      function selectColor(namespace) {
        let hash = 0;
        for (let i = 0; i < namespace.length; i++) {
          hash = (hash << 5) - hash + namespace.charCodeAt(i);
          hash |= 0;
        }
        return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
      }
      createDebug.selectColor = selectColor;
      function createDebug(namespace) {
        let prevTime;
        let enableOverride = null;
        let namespacesCache;
        let enabledCache;
        function debug(...args) {
          if (!debug.enabled) {
            return;
          }
          const self = debug;
          const curr = Number(/* @__PURE__ */ new Date());
          const ms = curr - (prevTime || curr);
          self.diff = ms;
          self.prev = prevTime;
          self.curr = curr;
          prevTime = curr;
          args[0] = createDebug.coerce(args[0]);
          if (typeof args[0] !== "string") {
            args.unshift("%O");
          }
          let index = 0;
          args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
            if (match === "%%") {
              return "%";
            }
            index++;
            const formatter = createDebug.formatters[format];
            if (typeof formatter === "function") {
              const val = args[index];
              match = formatter.call(self, val);
              args.splice(index, 1);
              index--;
            }
            return match;
          });
          createDebug.formatArgs.call(self, args);
          const logFn = self.log || createDebug.log;
          logFn.apply(self, args);
        }
        debug.namespace = namespace;
        debug.useColors = createDebug.useColors();
        debug.color = createDebug.selectColor(namespace);
        debug.extend = extend;
        debug.destroy = createDebug.destroy;
        Object.defineProperty(debug, "enabled", {
          enumerable: true,
          configurable: false,
          get: () => {
            if (enableOverride !== null) {
              return enableOverride;
            }
            if (namespacesCache !== createDebug.namespaces) {
              namespacesCache = createDebug.namespaces;
              enabledCache = createDebug.enabled(namespace);
            }
            return enabledCache;
          },
          set: (v) => {
            enableOverride = v;
          }
        });
        if (typeof createDebug.init === "function") {
          createDebug.init(debug);
        }
        return debug;
      }
      function extend(namespace, delimiter) {
        const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
        newDebug.log = this.log;
        return newDebug;
      }
      function enable(namespaces) {
        createDebug.save(namespaces);
        createDebug.namespaces = namespaces;
        createDebug.names = [];
        createDebug.skips = [];
        const split2 = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
        for (const ns of split2) {
          if (ns[0] === "-") {
            createDebug.skips.push(ns.slice(1));
          } else {
            createDebug.names.push(ns);
          }
        }
      }
      function matchesTemplate(search, template) {
        let searchIndex = 0;
        let templateIndex = 0;
        let starIndex = -1;
        let matchIndex = 0;
        while (searchIndex < search.length) {
          if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) {
            if (template[templateIndex] === "*") {
              starIndex = templateIndex;
              matchIndex = searchIndex;
              templateIndex++;
            } else {
              searchIndex++;
              templateIndex++;
            }
          } else if (starIndex !== -1) {
            templateIndex = starIndex + 1;
            matchIndex++;
            searchIndex = matchIndex;
          } else {
            return false;
          }
        }
        while (templateIndex < template.length && template[templateIndex] === "*") {
          templateIndex++;
        }
        return templateIndex === template.length;
      }
      function disable() {
        const namespaces = [
          ...createDebug.names,
          ...createDebug.skips.map((namespace) => "-" + namespace)
        ].join(",");
        createDebug.enable("");
        return namespaces;
      }
      function enabled(name) {
        for (const skip of createDebug.skips) {
          if (matchesTemplate(name, skip)) {
            return false;
          }
        }
        for (const ns of createDebug.names) {
          if (matchesTemplate(name, ns)) {
            return true;
          }
        }
        return false;
      }
      function coerce(val) {
        if (val instanceof Error) {
          return val.stack || val.message;
        }
        return val;
      }
      function destroy() {
        console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
      }
      createDebug.enable(createDebug.load());
      return createDebug;
    }
    module.exports = setup;
  }
});

// node_modules/debug/src/browser.js
var require_browser = __commonJS({
  "node_modules/debug/src/browser.js"(exports, module) {
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.storage = localstorage();
    exports.destroy = /* @__PURE__ */ (() => {
      let warned = false;
      return () => {
        if (!warned) {
          warned = true;
          console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
        }
      };
    })();
    exports.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
        return true;
      }
      if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
        return false;
      }
      let m;
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function formatArgs(args) {
      args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
      if (!this.useColors) {
        return;
      }
      const c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      let index = 0;
      let lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, (match) => {
        if (match === "%%") {
          return;
        }
        index++;
        if (match === "%c") {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c);
    }
    exports.log = console.debug || console.log || (() => {
    });
    function save(namespaces) {
      try {
        if (namespaces) {
          exports.storage.setItem("debug", namespaces);
        } else {
          exports.storage.removeItem("debug");
        }
      } catch (error) {
      }
    }
    function load() {
      let r;
      try {
        r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
      } catch (error) {
      }
      if (!r && typeof process !== "undefined" && "env" in process) {
        r = process.env.DEBUG;
      }
      return r;
    }
    function localstorage() {
      try {
        return localStorage;
      } catch (error) {
      }
    }
    module.exports = require_common()(exports);
    var { formatters } = module.exports;
    formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (error) {
        return "[UnexpectedJSONParseError]: " + error.message;
      }
    };
  }
});

// node_modules/has-flag/index.js
var require_has_flag = __commonJS({
  "node_modules/has-flag/index.js"(exports, module) {
    "use strict";
    module.exports = (flag, argv = process.argv) => {
      const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
      const position = argv.indexOf(prefix + flag);
      const terminatorPosition = argv.indexOf("--");
      return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
    };
  }
});

// node_modules/supports-color/index.js
var require_supports_color = __commonJS({
  "node_modules/supports-color/index.js"(exports, module) {
    "use strict";
    var os = __require("os");
    var tty = __require("tty");
    var hasFlag = require_has_flag();
    var { env } = process;
    var flagForceColor;
    if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never")) {
      flagForceColor = 0;
    } else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) {
      flagForceColor = 1;
    }
    function envForceColor() {
      if ("FORCE_COLOR" in env) {
        if (env.FORCE_COLOR === "true") {
          return 1;
        }
        if (env.FORCE_COLOR === "false") {
          return 0;
        }
        return env.FORCE_COLOR.length === 0 ? 1 : Math.min(Number.parseInt(env.FORCE_COLOR, 10), 3);
      }
    }
    function translateLevel(level) {
      if (level === 0) {
        return false;
      }
      return {
        level,
        hasBasic: true,
        has256: level >= 2,
        has16m: level >= 3
      };
    }
    function supportsColor(haveStream, { streamIsTTY, sniffFlags = true } = {}) {
      const noFlagForceColor = envForceColor();
      if (noFlagForceColor !== void 0) {
        flagForceColor = noFlagForceColor;
      }
      const forceColor = sniffFlags ? flagForceColor : noFlagForceColor;
      if (forceColor === 0) {
        return 0;
      }
      if (sniffFlags) {
        if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) {
          return 3;
        }
        if (hasFlag("color=256")) {
          return 2;
        }
      }
      if (haveStream && !streamIsTTY && forceColor === void 0) {
        return 0;
      }
      const min = forceColor || 0;
      if (env.TERM === "dumb") {
        return min;
      }
      if (process.platform === "win32") {
        const osRelease = os.release().split(".");
        if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
          return Number(osRelease[2]) >= 14931 ? 3 : 2;
        }
        return 1;
      }
      if ("CI" in env) {
        if (["TRAVIS", "CIRCLECI", "APPVEYOR", "GITLAB_CI", "GITHUB_ACTIONS", "BUILDKITE", "DRONE"].some((sign2) => sign2 in env) || env.CI_NAME === "codeship") {
          return 1;
        }
        return min;
      }
      if ("TEAMCITY_VERSION" in env) {
        return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
      }
      if (env.COLORTERM === "truecolor") {
        return 3;
      }
      if ("TERM_PROGRAM" in env) {
        const version = Number.parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
        switch (env.TERM_PROGRAM) {
          case "iTerm.app":
            return version >= 3 ? 3 : 2;
          case "Apple_Terminal":
            return 2;
        }
      }
      if (/-256(color)?$/i.test(env.TERM)) {
        return 2;
      }
      if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
        return 1;
      }
      if ("COLORTERM" in env) {
        return 1;
      }
      return min;
    }
    function getSupportLevel(stream, options = {}) {
      const level = supportsColor(stream, {
        streamIsTTY: stream && stream.isTTY,
        ...options
      });
      return translateLevel(level);
    }
    module.exports = {
      supportsColor: getSupportLevel,
      stdout: getSupportLevel({ isTTY: tty.isatty(1) }),
      stderr: getSupportLevel({ isTTY: tty.isatty(2) })
    };
  }
});

// node_modules/debug/src/node.js
var require_node = __commonJS({
  "node_modules/debug/src/node.js"(exports, module) {
    var tty = __require("tty");
    var util = __require("util");
    exports.init = init;
    exports.log = log;
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.destroy = util.deprecate(
      () => {
      },
      "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."
    );
    exports.colors = [6, 2, 3, 4, 5, 1];
    try {
      const supportsColor = require_supports_color();
      if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) {
        exports.colors = [
          20,
          21,
          26,
          27,
          32,
          33,
          38,
          39,
          40,
          41,
          42,
          43,
          44,
          45,
          56,
          57,
          62,
          63,
          68,
          69,
          74,
          75,
          76,
          77,
          78,
          79,
          80,
          81,
          92,
          93,
          98,
          99,
          112,
          113,
          128,
          129,
          134,
          135,
          148,
          149,
          160,
          161,
          162,
          163,
          164,
          165,
          166,
          167,
          168,
          169,
          170,
          171,
          172,
          173,
          178,
          179,
          184,
          185,
          196,
          197,
          198,
          199,
          200,
          201,
          202,
          203,
          204,
          205,
          206,
          207,
          208,
          209,
          214,
          215,
          220,
          221
        ];
      }
    } catch (error) {
    }
    exports.inspectOpts = Object.keys(process.env).filter((key) => {
      return /^debug_/i.test(key);
    }).reduce((obj, key) => {
      const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => {
        return k.toUpperCase();
      });
      let val = process.env[key];
      if (/^(yes|on|true|enabled)$/i.test(val)) {
        val = true;
      } else if (/^(no|off|false|disabled)$/i.test(val)) {
        val = false;
      } else if (val === "null") {
        val = null;
      } else {
        val = Number(val);
      }
      obj[prop] = val;
      return obj;
    }, {});
    function useColors() {
      return "colors" in exports.inspectOpts ? Boolean(exports.inspectOpts.colors) : tty.isatty(process.stderr.fd);
    }
    function formatArgs(args) {
      const { namespace: name, useColors: useColors2 } = this;
      if (useColors2) {
        const c = this.color;
        const colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c);
        const prefix = `  ${colorCode};1m${name} \x1B[0m`;
        args[0] = prefix + args[0].split("\n").join("\n" + prefix);
        args.push(colorCode + "m+" + module.exports.humanize(this.diff) + "\x1B[0m");
      } else {
        args[0] = getDate() + name + " " + args[0];
      }
    }
    function getDate() {
      if (exports.inspectOpts.hideDate) {
        return "";
      }
      return (/* @__PURE__ */ new Date()).toISOString() + " ";
    }
    function log(...args) {
      return process.stderr.write(util.formatWithOptions(exports.inspectOpts, ...args) + "\n");
    }
    function save(namespaces) {
      if (namespaces) {
        process.env.DEBUG = namespaces;
      } else {
        delete process.env.DEBUG;
      }
    }
    function load() {
      return process.env.DEBUG;
    }
    function init(debug) {
      debug.inspectOpts = {};
      const keys = Object.keys(exports.inspectOpts);
      for (let i = 0; i < keys.length; i++) {
        debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
      }
    }
    module.exports = require_common()(exports);
    var { formatters } = module.exports;
    formatters.o = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts).split("\n").map((str) => str.trim()).join(" ");
    };
    formatters.O = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts);
    };
  }
});

// node_modules/debug/src/index.js
var require_src = __commonJS({
  "node_modules/debug/src/index.js"(exports, module) {
    if (typeof process === "undefined" || process.type === "renderer" || process.browser === true || process.__nwjs) {
      module.exports = require_browser();
    } else {
      module.exports = require_node();
    }
  }
});

// node_modules/@toruslabs/metadata-helpers/node_modules/@scure/base/index.js
var freeze = (fn) => Object.freeze(fn());
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
function abytes(b) {
  if (!isBytes(b))
    throw new TypeError("Uint8Array expected");
}
function astr(label, input) {
  if (typeof input !== "string")
    throw new TypeError(`${label}: string expected`);
  return true;
}
function anumber(n, title = "number") {
  if (typeof n !== "number")
    throw new TypeError(`${title}: expected number, got ${typeof n}`);
  if (!Number.isSafeInteger(n))
    throw new RangeError(`${title}: expected safe integer, got ${n}`);
}
function chain(...args) {
  const id = (a) => a;
  const wrap = (a, b) => (c) => a(b(c));
  const encode = args.map((x) => x.encode).reduceRight(wrap, id);
  const decode = args.map((x) => x.decode).reduce(wrap, id);
  return { encode, decode };
}
var powers = /* @__PURE__ */ (() => {
  let res = [];
  for (let i = 0; i < 40; i++)
    res.push(2 ** i);
  return res;
})();
var asciiDecoder = /* @__PURE__ */ (() => {
  try {
    const decoder = new TextDecoder();
    return decoder.decode(Uint8Array.of(65, 48, 43, 127)) === "A0+\x7F" ? decoder : void 0;
  } catch (e) {
    return void 0;
  }
})();
var B2S_CHUNK = 8192;
function charcodesToString(codes) {
  const len = codes.length;
  if (asciiDecoder !== void 0 && len >= 12)
    return asciiDecoder.decode(codes);
  if (len <= B2S_CHUNK)
    return String.fromCharCode.apply(null, codes);
  let res = "";
  for (let i = 0; i < len; i += B2S_CHUNK)
    res += String.fromCharCode.apply(null, codes.subarray(i, i + B2S_CHUNK));
  return res;
}
function radix2(bits) {
  anumber(bits);
  if (bits <= 0 || bits > 8)
    throw new RangeError("radix2: bits should be in (0..8]");
  const mask = powers[bits] - 1;
  return {
    encode: (bytes) => {
      abytes(bytes);
      const len = bytes.length;
      const res = new Uint8Array(Math.ceil(len * 8 / bits));
      let carry = 0;
      let pos = 0;
      let j = 0;
      for (let i = 0; i < len; ) {
        if (i + 2 < len) {
          carry = carry << 24 | bytes[i] << 16 | bytes[i + 1] << 8 | bytes[i + 2];
          pos += 24;
          i += 3;
        } else {
          carry = (carry << 8 | bytes[i]) & 65535;
          pos += 8;
          i++;
        }
        for (; ; ) {
          pos -= bits;
          res[j++] = carry >> pos & mask;
          if (pos < bits)
            break;
        }
      }
      if (pos > 0)
        res[j] = carry << bits - pos & mask;
      return res;
    },
    decode: (digits) => {
      const len = digits.length;
      const res = new Uint8Array(Math.floor(len * bits / 8));
      let carry = 0;
      let pos = 0;
      let j = 0;
      for (let i = 0; i < len; i++) {
        carry = (carry << bits | digits[i]) & 65535;
        pos += bits;
        for (; pos >= 8; pos -= 8)
          res[j++] = carry >> pos - 8 & 255;
      }
      carry = carry << 8 - pos & 255;
      if (pos >= bits)
        throw new Error("Excess padding");
      if (carry > 0)
        throw new Error(`Non-zero padding: ${carry}`);
      return res;
    }
  };
}
function alphabet(letters, aliases) {
  const len = letters.length;
  if (len > 128)
    throw new Error("alphabet: max 128 letters");
  const encTable = new Uint8Array(len);
  const decTable = new Int8Array(128).fill(-1);
  for (let i = 0; i < len; i++) {
    const code = letters.charCodeAt(i);
    if (letters.codePointAt(i) !== code || code > 127)
      throw new Error("alphabet: single-char ASCII letters only");
    encTable[i] = code;
    decTable[code] = i;
  }
  if (aliases !== void 0) {
    for (const alias of Object.keys(aliases)) {
      const code = alias.charCodeAt(0);
      const target = decTable[aliases[alias].charCodeAt(0)];
      if (alias.length !== 1 || code > 127 || target === void 0 || target === -1)
        throw new Error(`alphabet: invalid alias ${alias}`);
      decTable[code] = target;
    }
  }
  return {
    encode: (digits) => {
      const codes = new Uint8Array(digits.length);
      for (let i = 0; i < digits.length; i++) {
        const d = digits[i];
        const code = encTable[d];
        if (code === void 0)
          throw new Error(`alphabet.encode: invalid digit ${d}`);
        codes[i] = code;
      }
      return charcodesToString(codes);
    },
    decode: (input) => {
      astr("decode", input);
      const slen = input.length;
      const digits = new Uint8Array(slen);
      for (let i = 0; i < slen; i++) {
        const code = input.charCodeAt(i);
        const digit = code < 128 ? decTable[code] : -1;
        if (digit === -1)
          throw new Error(`Unknown letter "${input[i]}". Allowed: ${letters}`);
        digits[i] = digit;
      }
      return digits;
    }
  };
}
function padding(bits, chr = "=") {
  anumber(bits);
  astr("padding", chr);
  return {
    encode(data) {
      while (data.length * bits % 8)
        data += chr;
      return data;
    },
    decode(input) {
      astr("decode", input);
      let end = input.length;
      if (end * bits % 8)
        throw new Error("padding: invalid length");
      for (; end > 0 && input[end - 1] === chr; end--) {
        const byte = (end - 1) * bits;
        if (byte % 8 === 0)
          throw new Error("padding: excess padding");
      }
      return input.slice(0, end);
    }
  };
}
var hasBase64Builtin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toBase64 === "function" && typeof Uint8Array.fromBase64 === "function")();
var ASCII_WHITESPACE = /[\t\n\f\r ]/;
var decodeBase64Builtin = (s, isUrl) => {
  astr("base64", s);
  const alphabet2 = isUrl ? "base64url" : "base64";
  if (s.length > 0 && ASCII_WHITESPACE.test(s))
    throw new Error("invalid base64");
  return Uint8Array.fromBase64(s, { alphabet: alphabet2, lastChunkHandling: "strict" });
};
var base64Fallback = /* @__PURE__ */ freeze(() => chain(radix2(6), alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), padding(6)));
var base64 = /* @__PURE__ */ freeze(() => hasBase64Builtin ? {
  encode(b) {
    abytes(b);
    return b.toBase64();
  },
  decode(s) {
    return decodeBase64Builtin(s, false);
  }
} : base64Fallback);

// node_modules/@toruslabs/metadata-helpers/dist/lib.esm/helpers/assert.js
function assert(value, message = "Assertion failed.") {
  if (!value) {
    if (message instanceof Error) {
      throw message;
    }
    throw new Error(message);
  }
}

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/hashes/_u64.js
var U32_MASK64 = /* @__PURE__ */ (() => BigInt(2 ** 32 - 1))();
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  const len = lst.length;
  let Ah = new Uint32Array(len);
  let Al = new Uint32Array(len);
  for (let i = 0; i < len; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var fromNumH = (n) => n / 2 ** 32 | 0;
var fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE2) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE2 ? l : h, isLE2);
  view.setUint32(byteOffset + 4, isLE2 ? h : l, isLE2);
}

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/hashes/utils.js
function isBytes2(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle = (title) => title ? `"${title}" ` : "";
function anumber2(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
  return n;
}
function abool(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abytes2(value, length, title = "") {
  if (isBytes2(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber2(length, "length");
  const bytes = isBytes2(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function ahash(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("expected hash wrapped by utils.createHasher");
  anumber2(h.outputLen);
  anumber2(h.blockLen);
  if (h.outputLen < 1 || h.blockLen < 1)
    throw new Error("hash blockLen / outputLen must be >= 1");
}
var aobject = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
var aopts = (value, label) => {
  aobject(value, label);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes2(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
var hasHexBuiltin = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes) {
  abytes2(bytes);
  if (hasHexBuiltin)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes[bytes[i]];
  }
  return hex;
}
function asciiToBase16(ch) {
  return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - (65 - 10) : ch >= 97 && ch <= 102 ? ch - (97 - 10) : void 0;
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin) {
    try {
      return Uint8Array.fromHex(hex);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase16(hex.charCodeAt(hi));
    const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function concatBytes(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes2(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function checkOpts(defaults, opts, title = "opts") {
  aopts(defaults, "defaults");
  if (opts !== void 0)
    aopts(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes(bytesLength = 32) {
  anumber2(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/hashes/sha3.js
var _0n = BigInt(0);
var _1n = BigInt(1);
var _2n = BigInt(2);
var _7n = BigInt(7);
var _256n = BigInt(256);
var _0x71n = BigInt(113);
var SHA3_PI = [];
var SHA3_ROTL = [];
var _SHA3_IOTA = [];
for (let round = 0, R = _1n, x = 1, y = 0; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
  let t = _0n;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n;
    if (R & _2n)
      t ^= _1n << (_1n << BigInt(j)) - _1n;
  }
  _SHA3_IOTA.push(t);
}
var IOTAS = split(_SHA3_IOTA, true);
var SHA3_IOTA_H = IOTAS[0];
var SHA3_IOTA_L = IOTAS[1];
var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
var B = new Uint32Array(5 * 2);
function keccakP(s, rounds = 24) {
  if (!(s instanceof Uint32Array))
    throw new TypeError('"s" expected Uint32Array(50), got type=' + typeof s);
  if (s.length !== 50)
    throw new RangeError('"s" expected Uint32Array(50), got length=' + s.length);
  anumber2(rounds, "rounds");
  if (rounds < 1 || rounds > 24)
    throw new Error('"rounds" expected integer 1..24');
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      const b0 = s[y], b1 = s[y + 1], b2 = s[y + 2], b3 = s[y + 3];
      s[y] ^= ~s[y + 2] & s[y + 4];
      s[y + 1] ^= ~s[y + 3] & s[y + 5];
      s[y + 2] ^= ~s[y + 4] & s[y + 6];
      s[y + 3] ^= ~s[y + 5] & s[y + 7];
      s[y + 4] ^= ~s[y + 6] & s[y + 8];
      s[y + 5] ^= ~s[y + 7] & s[y + 9];
      s[y + 6] ^= ~s[y + 8] & b0;
      s[y + 7] ^= ~s[y + 9] & b1;
      s[y + 8] ^= ~b0 & b2;
      s[y + 9] ^= ~b1 & b3;
    }
    s[0] ^= SHA3_IOTA_H[round];
    s[1] ^= SHA3_IOTA_L[round];
  }
  clean(B);
}
var Keccak = class _Keccak {
  state;
  pos = 0;
  posOut = 0;
  finished = false;
  state32;
  destroyed = false;
  blockLen;
  suffix;
  outputLen;
  canXOF;
  enableXOF = false;
  rounds;
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    anumber2(blockLen, "blockLen");
    anumber2(suffix, "suffix");
    anumber2(rounds, "rounds");
    abool(enableXOF, "enableXOF");
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.canXOF = enableXOF;
    this.rounds = rounds;
    anumber2(outputLen, "outputLen");
    if (!(0 < blockLen && blockLen < 200))
      throw new Error('"blockLen" must be 1..199');
    this.state = new Uint8Array(200);
    this.state32 = u32(this.state);
  }
  clone() {
    return this._cloneInto();
  }
  keccak() {
    swap32IfBE(this.state32);
    keccakP(this.state32, this.rounds);
    swap32IfBE(this.state32);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    aexists(this);
    abytes2(data);
    const { blockLen, state, state32 } = this;
    const len = data.length;
    const canUseU32 = blockLen % 4 === 0 && data.byteOffset % 4 === 0;
    const blockLen32 = blockLen / 4;
    const data32 = canUseU32 && len >= blockLen ? u32(data) : void 0;
    for (let pos = 0; pos < len; ) {
      if (data32 !== void 0 && this.pos === 0 && pos % 4 === 0 && len - pos >= blockLen) {
        for (let i = 0, o = pos / 4; i < blockLen32; i++)
          state32[i] ^= data32[o + i];
        pos += blockLen;
        this.pos = blockLen;
        this.keccak();
        continue;
      }
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state, suffix, pos, blockLen } = this;
    state[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    aexists(this, false);
    abytes2(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not enabled");
    return this.writeInto(out);
  }
  xof(bytes) {
    anumber2(bytes);
    return this.xofInto(new Uint8Array(bytes));
  }
  digestInto(out) {
    aoutput(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out.length === this.outputLen ? out : out.subarray(0, this.outputLen));
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.outputLen);
    this.digestInto(out);
    return out;
  }
  destroy() {
    this.destroyed = true;
    clean(this.state);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to ||= new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds);
    to.blockLen = blockLen;
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.canXOF = this.canXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var genKeccak = (suffix, blockLen, outputLen, info = {}) => createHasher(() => new Keccak(blockLen, suffix, outputLen), info);
var keccak_256 = /* @__PURE__ */ genKeccak(1, 136, 32);

// node_modules/@toruslabs/metadata-helpers/dist/lib.esm/helpers/hex.js
var HEX_REGEX = /^(?:0x)?[0-9a-f]+$/iu;
var isString = (value) => typeof value === "string";
function isHexString(value) {
  return isString(value) && HEX_REGEX.test(value);
}
function assertIsHexString(value) {
  assert(isHexString(value), "Value must be a hexadecimal string.");
}
function add0x(hexadecimal) {
  if (hexadecimal.startsWith("0x")) {
    return hexadecimal;
  }
  if (hexadecimal.startsWith("0X")) {
    return `0x${hexadecimal.substring(2)}`;
  }
  return `0x${hexadecimal}`;
}
function remove0x(hexadecimal) {
  if (hexadecimal.startsWith("0x") || hexadecimal.startsWith("0X")) {
    return hexadecimal.substring(2);
  }
  return hexadecimal;
}

// node_modules/@toruslabs/metadata-helpers/dist/lib.esm/helpers/bytes.js
var HEX_MINIMUM_NUMBER_CHARACTER = 48;
var HEX_MAXIMUM_NUMBER_CHARACTER = 58;
var HEX_CHARACTER_OFFSET = 87;
function getPrecomputedHexValuesBuilder() {
  const lookupTable = [];
  return () => {
    if (lookupTable.length === 0) {
      for (let i = 0; i < 256; i++) {
        lookupTable.push(i.toString(16).padStart(2, "0"));
      }
    }
    return lookupTable;
  };
}
var getPrecomputedHexValues = getPrecomputedHexValuesBuilder();
function isBytes3(value) {
  return value instanceof Uint8Array;
}
function assertIsBytes(value) {
  assert(isBytes3(value), "Value must be a Uint8Array.");
}
function bytesToUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}
function utf8ToBytes(value) {
  return new TextEncoder().encode(value);
}
function bytesToBase64(bytes) {
  assertIsBytes(bytes);
  return base64.encode(bytes);
}
function hexToBytes2(value) {
  var _value$toLowerCase;
  if ((value === null || value === void 0 || (_value$toLowerCase = value.toLowerCase) === null || _value$toLowerCase === void 0 ? void 0 : _value$toLowerCase.call(value)) === "0x") {
    return new Uint8Array();
  }
  assertIsHexString(value);
  const strippedValue = remove0x(value).toLowerCase();
  const normalizedValue = strippedValue.length % 2 === 0 ? strippedValue : `0${strippedValue}`;
  const bytes = new Uint8Array(normalizedValue.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const c1 = normalizedValue.charCodeAt(i * 2);
    const c2 = normalizedValue.charCodeAt(i * 2 + 1);
    const n1 = c1 - (c1 < HEX_MAXIMUM_NUMBER_CHARACTER ? HEX_MINIMUM_NUMBER_CHARACTER : HEX_CHARACTER_OFFSET);
    const n2 = c2 - (c2 < HEX_MAXIMUM_NUMBER_CHARACTER ? HEX_MINIMUM_NUMBER_CHARACTER : HEX_CHARACTER_OFFSET);
    bytes[i] = n1 * 16 + n2;
  }
  return bytes;
}
function base64ToBytes(value) {
  assert(typeof value === "string", "Value must be a string.");
  const segmentLength = 4;
  const diff = value.length % segmentLength;
  const padded = diff ? value + "=".repeat(segmentLength - diff) : value;
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
  return base64.decode(normalized);
}

// node_modules/@toruslabs/metadata-helpers/dist/lib.esm/helpers/base64url.js
function padString(input) {
  const segmentLength = 4;
  const diff = input.length % segmentLength;
  if (!diff) {
    return input;
  }
  return input + "=".repeat(segmentLength - diff);
}
function encodeBase64Url(input) {
  const bytes = typeof input === "string" ? utf8ToBytes(input) : input;
  return fromBase64(bytesToBase64(bytes));
}
function decodeBase64Url(base64url) {
  return bytesToUtf8(base64ToBytes(toBase64(base64url)));
}
function toBase64(base64url) {
  const urlString = base64url instanceof Uint8Array ? bytesToUtf8(base64url) : base64url;
  return padString(urlString).replace(/-/g, "+").replace(/_/g, "/");
}
function fromBase64(base642) {
  return base642.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function toBufferLike(base64url) {
  return base64ToBytes(toBase64(base64url));
}

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/hashes/_md.js
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE2) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE2;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes2(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE2 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE2);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE2);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/hashes/sha2.js
var SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B = class extends HashMD {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and makes sha256 3x slower (measured).
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B: B2, C, D, E, F, G, H } = this;
    return [A, B2, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B2, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B2 | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B: B2, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B2, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B2;
      B2 = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B2 = B2 + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B2, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
};
var _SHA256 = class extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV);
  }
};
var sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/curves/utils.js
function aarray(item, title, inner = () => {
}) {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0; i < item.length; i++)
    inner(item[i], `${title}[${i}]`);
  return item;
}
var abytes3 = (value, length, title) => abytes2(value, length, title);
var anumber3 = anumber2;
function astring(value, title = "") {
  if (typeof value !== "string") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected string, got type=" + typeof value);
  }
  return value;
}
function aobject2(value, title = "object") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function afunction(value, title) {
  if (typeof value !== "function")
    throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
  return value;
}
var bytesToHex2 = bytesToHex;
var concatBytes2 = (...arrays) => concatBytes(...arrays);
var hexToBytes3 = (hex) => hexToBytes(hex);
var isBytes4 = isBytes2;
var randomBytes2 = (bytesLength) => randomBytes(bytesLength);
var _0n2 = /* @__PURE__ */ BigInt(0);
var _1n2 = /* @__PURE__ */ BigInt(1);
var atitle2 = (title) => title ? `"${title}" ` : "";
function abool2(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle2(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abignumber(n) {
  if (typeof n === "bigint") {
    if (!isPosBig(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber3(n);
  return n;
}
function asafenumber(value, title = "") {
  if (typeof value !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function numberToHexUnpadded(num) {
  const hex = abignumber(num).toString(16);
  return hex.length & 1 ? "0" + hex : hex;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n2 : BigInt("0x" + hex);
}
function bytesToNumberBE(bytes) {
  return hexToNumber(bytesToHex(bytes));
}
function bytesToNumberLE(bytes) {
  return hexToNumber(bytesToHex(copyBytes(abytes2(bytes)).reverse()));
}
function numberToBytesBE(n, len) {
  anumber2(len);
  if (len === 0)
    throw new Error("zero output length is invalid");
  n = abignumber(n);
  const expectedLen = len * 2;
  const hex = n.toString(16);
  if (hex.length > expectedLen)
    throw new RangeError("number is too large");
  return hexToBytes(hex.padStart(expectedLen, "0"));
}
function numberToBytesLE(n, len) {
  return numberToBytesBE(n, len).reverse();
}
function copyBytes(bytes) {
  return Uint8Array.from(abytes3(bytes));
}
function isPosBig(n) {
  return typeof n === "bigint" && _0n2 <= n;
}
function inRange(n, min, max) {
  return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
function aInRange(title, n, min, max) {
  if (!inRange(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen(n) {
  if (n < _0n2)
    throw new Error("expected non-negative bigint, got " + n);
  return n === _0n2 ? 0 : n.toString(2).length;
}
var bitMask = (n) => {
  asafenumber(n, "n");
  return (_1n2 << BigInt(n)) - _1n2;
};
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
  anumber2(hashLen, "hashLen");
  anumber2(qByteLen, "qByteLen");
  if (typeof hmacFn !== "function")
    throw new TypeError("hmacFn must be a function");
  const u8n = (len) => new Uint8Array(len);
  const NULL = Uint8Array.of();
  const byte0 = Uint8Array.of(0);
  const byte1 = Uint8Array.of(1);
  const _maxDrbgIters = 1e3;
  let v = u8n(hashLen);
  let k = u8n(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...msgs) => hmacFn(k, concatBytes2(v, ...msgs));
  const reseed = (seed = NULL) => {
    k = h(byte0, seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(byte1, seed);
    v = h();
  };
  const gen = () => {
    if (i++ >= _maxDrbgIters)
      throw new Error("drbg: tried max amount of iterations");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes2(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = void 0;
    while ((res = pred(gen())) === void 0)
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
function validateObject(object, fields = {}, optFields = {}, title = "object") {
  aobject2(object, title);
  aobject2(fields, "fields");
  aobject2(optFields, "optFields");
  function checkField(fieldName, expectedType, isOpt) {
    const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
    const val = object[fieldName];
    if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== void 0 : expectedType !== "function")) {
      throw new TypeError(`${label} is invalid: expected own property`);
    }
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/curves/abstract/modular.js
var _0n3 = /* @__PURE__ */ BigInt(0);
var _1n3 = /* @__PURE__ */ BigInt(1);
var _2n2 = /* @__PURE__ */ BigInt(2);
var _3n = /* @__PURE__ */ BigInt(3);
var _4n = /* @__PURE__ */ BigInt(4);
var _5n = /* @__PURE__ */ BigInt(5);
var _7n2 = /* @__PURE__ */ BigInt(7);
var _8n = /* @__PURE__ */ BigInt(8);
var _9n = /* @__PURE__ */ BigInt(9);
var _15n = /* @__PURE__ */ BigInt(15);
var _16n = /* @__PURE__ */ BigInt(16);
var POW_WINDOWED_MIN = /* @__PURE__ */ BigInt("0x10000000000000000");
function mod(a, b) {
  if (b <= _0n3)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n3 ? result : b + result;
}
function pow(num, power, modulo) {
  if (modulo <= _1n3)
    throw new Error("pow: expected modulus > 1, got " + modulo);
  if (typeof power !== "bigint")
    throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
  if (power < _0n3)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n3)
    return _1n3;
  if (power === _1n3)
    return num;
  let d = num % modulo;
  if (d < _0n3)
    d += modulo;
  if (power < POW_WINDOWED_MIN) {
    let p2 = _1n3;
    while (power > _0n3) {
      if (power & _1n3)
        p2 = p2 * d % modulo;
      d = d * d % modulo;
      power >>= _1n3;
    }
    return p2;
  }
  const digits = [];
  while (power > _0n3) {
    digits.push(Number(power & _15n));
    power >>= _4n;
  }
  const table = new Array(16);
  table[0] = _1n3;
  table[1] = d;
  for (let i = 2; i < 16; i++)
    table[i] = table[i - 1] * d % modulo;
  let p = table[digits[digits.length - 1]];
  for (let w = digits.length - 2; w >= 0; w--) {
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    const digit = digits[w];
    if (digit !== 0)
      p = p * table[digit] % modulo;
  }
  return p;
}
function pow2(x, power, modulo) {
  if (modulo <= _1n3)
    throw new Error("pow2: expected modulus > 1, got " + modulo);
  if (power < _0n3)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n3) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number, modulo) {
  if (number === _0n3)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _1n3)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = mod(number, modulo);
  let b = modulo;
  let x = _0n3, u = _1n3;
  while (a !== _0n3) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  const gcd = b;
  if (gcd !== _1n3)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function invertCt(a, prime) {
  if (prime <= _1n3)
    throw new Error("invertCt: expected prime modulus > 1, got " + prime);
  const an = mod(a, prime);
  if (an === _0n3)
    throw new Error("invertCt: expected non-zero number");
  const inverse = pow(an, prime - _2n2, prime);
  if (mod(an * inverse, prime) !== _1n3)
    throw new Error("invertCt: does not exist");
  return inverse;
}
function assertIsSquare(Fp, root, n) {
  const F = Fp;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function aoddModulus(order, fnName) {
  if ((order & _1n3) === _0n3)
    throw new Error(fnName + ": expected odd modulus, got " + order);
}
function sqrt3mod4(Fp, n) {
  const F = Fp;
  const p1div4 = (F.ORDER + _1n3) / _4n;
  const root = F.pow(n, p1div4);
  assertIsSquare(F, root, n);
  return root;
}
function sqrt5mod8(Fp, n) {
  const F = Fp;
  const p5div8 = (F.ORDER - _5n) / _8n;
  const n2 = F.mul(n, _2n2);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n2), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare(F, root, n);
  return root;
}
function sqrt9mod16(P) {
  const Fp_ = Field(P);
  const tn = tonelliShanks(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n2) / _16n;
  return ((Fp, n) => {
    const F = Fp;
    let tv1 = F.pow(n, c4);
    let tv2 = F.mul(tv1, c1);
    const tv3 = F.mul(tv1, c2);
    const tv4 = F.mul(tv1, c3);
    const e1 = F.eql(F.sqr(tv2), n);
    const e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1);
    tv2 = F.cmov(tv4, tv3, e2);
    const e3 = F.eql(F.sqr(tv2), n);
    const root = F.cmov(tv1, tv2, e3);
    assertIsSquare(F, root, n);
    return root;
  });
}
function tonelliShanks(P) {
  if (P < _3n)
    throw new Error("sqrt is not defined for small field");
  aoddModulus(P, "tonelliShanks");
  let Q = P - _1n3;
  let S = 0;
  while (Q % _2n2 === _0n3) {
    Q /= _2n2;
    S++;
  }
  let Z = _2n2;
  const _Fp = Field(P);
  while (FpLegendre(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod4;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n3) / _2n2;
  return function tonelliSlow(Fp, n) {
    const F = Fp;
    if (F.is0(n))
      return n;
    if (FpLegendre(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        throw new Error("Cannot find square root: probably non-prime P");
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n3 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt(P) {
  aoddModulus(P, "Fp.sqrt");
  if (P % _4n === _3n)
    return sqrt3mod4;
  if (P % _8n === _5n)
    return sqrt5mod8;
  if (P % _16n === _9n)
    return sqrt9mod16(P);
  return tonelliShanks(P);
}
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  aobject2(field, "field");
  if (typeof field.ORDER !== "bigint")
    throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
  asafenumber(field.BYTES, "BYTES");
  asafenumber(field.BITS, "BITS");
  for (const name of FIELD_FIELDS)
    afunction(field[name], "field." + name);
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n3)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpInvertBatch(Fp, nums, passZero = false) {
  validateField(Fp);
  aarray(nums, "nums");
  abool2(passZero, "passZero");
  const F = Fp;
  const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = acc;
    return F.mul(acc, num);
  }, F.ONE);
  const invertedAcc = F.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = F.mul(acc, inverted[i]);
    return F.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre(Fp, n) {
  validateField(Fp);
  const F = Fp;
  aoddModulus(F.ORDER, "FpLegendre");
  const p1mod2 = (F.ORDER - _1n3) / _2n2;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber3(nBitLength);
  if (n <= _0n3)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n3;
  ONE = _1n3;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _1n3)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength = void 0;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = Object.freeze(opts.allowedLengths.slice());
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num) {
    return mod(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n3 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n3;
  }
  // is valid and invertible
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n3) === _1n3;
  }
  neg(num) {
    return mod(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return pow(num, power, this.ORDER);
  }
  div(lhs, rhs) {
    return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT.get(this);
    if (!sqrt)
      FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
    return sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes3(bytes);
    const { _lengths: allowedLengths, BYTES, isLE: isLE2, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE2 ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE2 ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
    if (modFromBytes)
      scalar = mod(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch(this, lst, true);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool2(condition, "condition");
    return condition ? b : a;
  }
};
function Field(ORDER, opts = {}) {
  Object.freeze(_Field.prototype);
  return new _Field(ORDER, opts);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  if (fieldOrder <= _1n3)
    throw new Error("field order must be greater than 1");
  const bitLength = bitLen(fieldOrder - _1n3);
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE2 = false) {
  abytes3(key);
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = Math.max(getMinHashLength(fieldOrder), 16);
  if (len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE2 ? bytesToNumberLE(key) : bytesToNumberBE(key);
  const reduced = mod(num, fieldOrder - _1n3) + _1n3;
  return isLE2 ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/curves/abstract/curve.js
var _0n4 = /* @__PURE__ */ BigInt(0);
var _1n4 = /* @__PURE__ */ BigInt(1);
var _4n2 = /* @__PURE__ */ BigInt(4);
var BLIND_BYTES = 16;
var BLIND_BITS = 128;
var FW_WINDOW = 5;
var TABLE_BYTES_MAX = /* @__PURE__ */ (() => 2 ** 31)();
function validatePointCons(Point) {
  const pc = Point;
  if (typeof pc !== "function")
    throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
  afunction(pc.fromAffine, "Point.fromAffine");
  afunction(pc.fromBytes, "Point.fromBytes");
  afunction(pc.fromHex, "Point.fromHex");
  aobject2(pc.BASE, "Point.BASE");
  aobject2(pc.ZERO, "Point.ZERO");
  validateField(pc.Fp);
  validateField(pc.Fn);
}
function normalizeZ(c, points) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits, min = 1) {
  if (!Number.isSafeInteger(W) || W < min || W > bits)
    throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
}
function validateTableBytes(numPoints, fpBytes) {
  const bytes = numPoints * (4 * fpBytes + 128);
  if (bytes > TABLE_BYTES_MAX)
    throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX / 2 ** 20 + " MiB");
}
function probeRandomBytes(randomBytes6, length) {
  if (randomBytes6 === void 0)
    return void 0;
  afunction(randomBytes6, "randomBytes");
  try {
    const probe = randomBytes6(length);
    if (!isBytes4(probe) || probe.length !== length)
      return void 0;
  } catch {
    return void 0;
  }
  return randomBytes6;
}
function validateMSMPoints(points, c) {
  aarray(points, "points");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars(scalars, field, maxScalar) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    const ok = maxScalar === void 0 ? field.isValid(s) : isPosBig(s) && s < maxScalar;
    if (!ok)
      throw new Error("invalid scalar at index " + i);
  });
}
var pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getWindowSize(P) {
  return pointWindowSizes.get(P) || 1;
}
function oddMultiples(p, size) {
  const dbl = p.double();
  const t = [p];
  for (let j = 1; j < size; j++)
    t.push(t[j - 1].add(dbl));
  return t;
}
function wnafDigits(n, W) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const d = [];
  while (n > _0n4) {
    let w = 0;
    if (n & _1n4) {
      w = Number(n & mask);
      if (w >= half)
        w -= size;
      n -= BigInt(w);
    }
    d.push(w);
    n >>= _1n4;
  }
  return d;
}
function signedWindowDigits(n, W, windows) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const shiftBy = BigInt(W);
  const d = [];
  for (let w = 0; w < windows; w++) {
    let v = Number(n & mask);
    n >>= shiftBy;
    if (v > half) {
      v -= size;
      n += _1n4;
    }
    d.push(v);
  }
  if (n !== _0n4)
    throw new Error("invalid wnaf");
  return d;
}
function wnafWalk(zero, tables, digits) {
  let max = 0;
  for (const d of digits)
    max = Math.max(max, d.length);
  let acc = zero;
  for (let bit = max - 1; bit >= 0; bit--) {
    if (bit !== max - 1)
      acc = acc.double();
    for (let i = 0; i < digits.length; i++) {
      const w = digits[i][bit];
      if (w) {
        const item = tables[i][Math.abs(w) - 1 >> 1];
        acc = acc.add(w < 0 ? item.negate() : item);
      }
    }
  }
  return acc;
}
var ScalarMultiplier = class {
  Point;
  BASE;
  ZERO;
  randomBytes;
  wnafPrecomputes = /* @__PURE__ */ new WeakMap();
  baseCanBeBlinded;
  bits;
  // Parametrized with a given Point class (not individual point)
  constructor(Point, randomBytes6) {
    validatePointCons(Point);
    this.randomBytes = probeRandomBytes(randomBytes6, BLIND_BYTES);
    this.Point = Point;
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.bits = Point.Fn.BITS;
  }
  /**
   * Creates a signed fixed-window wNAF precomputation table: for every window w, the
   * multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
   * so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
   * window absorbs the final carry of signed-digit recoding.
   * For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
   * @param point - Point instance
   * @param W - window size
   * @param bits - scalar bitlength the table must cover
   */
  buildWnafTable(point, W, bits) {
    const windows = Math.ceil(bits / W) + 1;
    const half = 2 ** (W - 1);
    const comp = [];
    let base = point;
    for (let w = 0; w < windows; w++) {
      let acc = base;
      for (let i = 0; i < half; i++) {
        comp.push(acc);
        acc = acc.add(base);
      }
      base = comp[comp.length - 1].double();
    }
    return { W, bits, windows, comp };
  }
  /**
   * Implements ec multiplication using precomputed signed fixed-window wNAF tables.
   * Constant-time: fixed window count with one table addition per window — zero digits feed
   * the fake accumulator — and no doublings; the lookup scans the whole window slice.
   * Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
   * {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
   * signedWindowDigits throws if `n` exceeds the table.
   * @returns real and fake (for const-time) points
   */
  wnafCachedCT(precomputes, n) {
    const { W, windows, comp } = precomputes;
    const half = 2 ** (W - 1);
    const digits = signedWindowDigits(n, W, windows);
    let p = this.ZERO;
    let f = this.BASE;
    for (let w = 0; w < windows; w++) {
      const digit = digits[w];
      const start = w * half;
      const idx = Math.abs(digit) - 1;
      let sel = comp[start];
      for (let i = 1; i < half; i++)
        sel = i === idx ? comp[start + i] : sel;
      const neg = sel.negate();
      if (digit === 0)
        f = f.add(comp[start]);
      else
        p = p.add(digit < 0 ? neg : sel);
    }
    return { p, f };
  }
  // Cache key is point identity plus (W, bits); at most two entries exist per point (public-width
  // `Fn.BITS` and blinded `Fn.BITS + BLIND_BITS`). Callers must not reuse the same point with
  // incompatible `transform(...)` layouts and expect a separate cache entry.
  getWnafPrecomputes(W, point, bits, transform) {
    let entries = this.wnafPrecomputes.get(point);
    let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
    if (!comp) {
      comp = this.buildWnafTable(point, W, bits);
      if (typeof transform === "function")
        comp = { ...comp, comp: transform(comp.comp) };
      if (!entries) {
        entries = [];
        this.wnafPrecomputes.set(point, entries);
      }
      entries.push(comp);
    }
    return comp;
  }
  assertPoint(point) {
    if (!(point instanceof this.Point))
      throw new TypeError('"point" expected Point instance, got type=' + typeof point);
  }
  // Shared prologue of the constant-time entry points. Rejects scalar 0: in key/signature-style
  // callers a zero scalar means broken upstream plumbing, and concrete Points already reject it.
  // Uses inRange instead of Fn.isValidNot0: validateField() only certifies the arithmetic subset.
  validateMulInput(point, scalar) {
    this.assertPoint(point);
    if (!inRange(scalar, _1n4, this.Point.Fn.ORDER))
      throw new Error("invalid scalar");
  }
  // Constant-time dispatch shared by mulCT / mulCTBlinded. Un-precomputed points (W===1, e.g.
  // ECDH peer keys) skip building a throwaway cached table in favor of a small fixed-window
  // multiply. `n` must be < 2^bits.
  runCT(point, n, bits, transform) {
    const W = getWindowSize(point);
    if (W === 1)
      return this.fixedWindowCT(point, n, bits);
    return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
  }
  mulCT(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    return this.runCT(point, scalar, this.bits, transform);
  }
  mulCTBlinded(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    if (this.randomBytes === void 0)
      throw new Error("randomBytes is required for scalar blinding");
    const bits = this.Point.Fn.BITS + BLIND_BITS;
    const blind = this.randomBytes(BLIND_BYTES);
    if (!isBytes4(blind) || blind.length !== BLIND_BYTES)
      throw new Error("randomBytes returned invalid byte array");
    blind[0] = blind[0] & 63 | 128;
    const n = scalar + bytesToNumberBE(blind) * this.Point.Fn.ORDER;
    return this.runCT(point, n, bits, transform);
  }
  /**
   * Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
   * A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
   * far cheaper to build for a single use. The point-operation sequence is independent of `n`:
   * build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
   * every table entry, and one addition (adds the identity when the window digit is 0 — never
   * skipped).
   *
   * `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
   * add), which holds for the Weierstrass/Edwards point types used here. The table is left in
   * projective form (no normalizeZ): normalizing this small a table costs more than the
   * mixed-add savings it would buy for a single multiply.
   * @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
   * (this path needs no fake accumulator — its op-count is already scalar-independent).
   */
  fixedWindowCT(point, n, bits) {
    const W = FW_WINDOW;
    const size = 1 << W;
    const mask = bitMask(W);
    const table = new Array(size);
    table[0] = this.ZERO;
    for (let i = 1; i < size; i++)
      table[i] = table[i - 1].add(point);
    const windows = Math.ceil(bits / W);
    let acc = this.ZERO;
    for (let window2 = windows - 1; window2 >= 0; window2--) {
      if (window2 !== windows - 1)
        for (let d = 0; d < W; d++)
          acc = acc.double();
      const digit = Number(n >> BigInt(window2 * W) & mask);
      let sel = table[0];
      for (let i = 1; i < size; i++)
        sel = i === digit ? table[i] : sel;
      acc = acc.add(sel);
    }
    return { p: acc, f: acc };
  }
  shouldBlind(point, cofactor) {
    if (this.randomBytes === void 0)
      return false;
    if (cofactor === _1n4)
      return true;
    if (point !== this.BASE)
      return false;
    if (this.baseCanBeBlinded === void 0)
      this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
    return this.baseCanBeBlinded;
  }
  mulSecret(point, scalar, cofactor, transform) {
    return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
  }
  mulUnsafe(point, scalar, transform) {
    this.assertPoint(point);
    if (!isPosBig(scalar))
      throw new Error("invalid scalar");
    const W = getWindowSize(point);
    if (W === 1 || scalar >= this.Point.Fn.ORDER)
      return mulAddUnsafe(this.Point, [point], [scalar], true);
    const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
    return this.wnafCachedCT(precomputes, scalar).p;
  }
  // Remembers the window size used for precomputed wNAF multiplication of the given point
  // and drops any previously built tables. Usually only the base point is precomputed.
  // W=1 resets the point to the un-precomputed (table-less) paths.
  // W is additionally capped so tables stay under ~2 GiB ({@link TABLE_BYTES_MAX}).
  setWindowSize(point, W) {
    this.assertPoint(point);
    validateW(W, this.bits);
    const windows = Math.ceil((this.bits + BLIND_BITS) / W) + 1;
    validateTableBytes(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
    pointWindowSizes.set(point, W);
    this.wnafPrecomputes.delete(point);
  }
  // True when a window size is set: tables themselves are built lazily on first multiply.
  hasWindowSize(point) {
    return getWindowSize(point) !== 1;
  }
};
function mulAddUnsafe(c, points, scalars, allowOversized = false) {
  validatePointCons(c);
  validateMSMPoints(points, c);
  abool2(allowOversized, "allowOversized");
  validateMSMScalars(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n2 : void 0);
  if (points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  const tables = points.map((p) => oddMultiples(p, 4));
  const digits = scalars.map((n) => wnafDigits(n, 4));
  return wnafWalk(c.ZERO, tables, digits);
}
function createField(order, field, isLE2) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField(field);
    return field;
  } else {
    return Field(order, { isLE: isLE2 });
  }
}
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
  if (type !== "weierstrass" && type !== "edwards")
    throw new Error('expected curve type "weierstrass" or "edwards"');
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  validateObject(curveOpts);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(isPosBig(val) && val !== _0n4))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp, Fn };
}
function createKeygen(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/hashes/hmac.js
var _HMAC = class {
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash(hash);
    abytes2(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("expected Hash instance");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean(pad);
  }
  update(buf) {
    aexists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const buf = out.subarray(0, this.outputLen);
    this.iHash.digestInto(buf);
    this.oHash.update(buf);
    this.oHash.digestInto(buf);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to ||= Object.create(Object.getPrototypeOf(this), {});
    const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.canXOF = canXOF;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = /* @__PURE__ */ (() => {
  const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
  hmac_.create = (hash, key) => new _HMAC(hash, key);
  return hmac_;
})();

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/curves/abstract/der.js
var _0n5 = /* @__PURE__ */ BigInt(0);
var DERErr = class extends Error {
  constructor(m = "") {
    super(m);
  }
};
var _DER = {
  // asn.1 DER encoding utils
  Err: DERErr,
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (tag, data) => {
      const { Err: E } = _DER;
      asafenumber(tag, "tag");
      if (tag < 0 || tag > 255)
        throw new E("tlv.encode: wrong tag");
      astring(data, "data");
      if (data.length & 1)
        throw new E("tlv.encode: unpadded data");
      const dataLen = data.length / 2;
      const len = numberToHexUnpadded(dataLen);
      if (len.length / 2 & 128)
        throw new E("tlv.encode: long form length too big");
      const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
      const t = numberToHexUnpadded(tag);
      return t + lenLen + len + data;
    },
    // v - value, l - left bytes (unparsed)
    decode(tag, data) {
      const { Err: E } = _DER;
      data = abytes3(data, void 0, "DER data");
      let pos = 0;
      if (tag < 0 || tag > 255)
        throw new E("tlv.decode: wrong tag");
      if (data.length < 2 || data[pos++] !== tag)
        throw new E("tlv.decode: wrong tlv");
      const first = data[pos++];
      const isLong = !!(first & 128);
      let length = 0;
      if (!isLong)
        length = first;
      else {
        const lenLen = first & 127;
        if (!lenLen)
          throw new E("tlv.decode(long): indefinite length not supported");
        if (lenLen > 4)
          throw new E("tlv.decode(long): byte length is too big");
        const lengthBytes = data.subarray(pos, pos + lenLen);
        if (lengthBytes.length !== lenLen)
          throw new E("tlv.decode: length bytes not complete");
        if (lengthBytes[0] === 0)
          throw new E("tlv.decode(long): zero leftmost byte");
        for (const b of lengthBytes)
          length = length << 8 | b;
        pos += lenLen;
        if (length < 128)
          throw new E("tlv.decode(long): not minimal encoding");
      }
      const v = data.subarray(pos, pos + length);
      if (v.length !== length)
        throw new E("tlv.decode: wrong value length");
      return { v, l: data.subarray(pos + length) };
    }
  },
  // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
  // since we always use positive integers here. It must always be empty:
  // - add zero byte if exists
  // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
  _int: {
    encode(num) {
      const { Err: E } = _DER;
      abignumber(num);
      if (num < _0n5)
        throw new E("integer: negative integers are not allowed");
      let hex = numberToHexUnpadded(num);
      if (Number.parseInt(hex[0], 16) & 8)
        hex = "00" + hex;
      if (hex.length & 1)
        throw new E("unexpected DER parsing assertion: unpadded hex");
      return hex;
    },
    decode(data) {
      const { Err: E } = _DER;
      if (data.length < 1)
        throw new E("invalid signature integer: empty");
      if (data[0] & 128)
        throw new E("invalid signature integer: negative");
      if (data.length > 1 && data[0] === 0 && !(data[1] & 128))
        throw new E("invalid signature integer: unnecessary leading zero");
      return bytesToNumberBE(data);
    }
  },
  toSig(bytes, maxScalarBytes) {
    const { Err: E, _int: int, _tlv: tlv } = _DER;
    if (maxScalarBytes !== void 0) {
      asafenumber(maxScalarBytes, "maxScalarBytes");
      if (maxScalarBytes < 1)
        throw new E("invalid signature: maxScalarBytes must be positive");
    }
    const data = abytes3(bytes, void 0, "signature");
    const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
    if (seqLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
    const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
    if (sLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    if (maxScalarBytes !== void 0 && (rBytes.length > maxScalarBytes || sBytes.length > maxScalarBytes))
      throw new E("invalid signature: integer too large");
    return { r: int.decode(rBytes), s: int.decode(sBytes) };
  },
  hexFromSig(sig) {
    const { _tlv: tlv, _int: int } = _DER;
    validateObject(sig, { r: "bigint", s: "bigint" }, {}, "sig");
    const rs = tlv.encode(2, int.encode(sig.r));
    const ss = tlv.encode(2, int.encode(sig.s));
    const seq = rs + ss;
    return tlv.encode(48, seq);
  }
};
var DER = /* @__PURE__ */ (() => {
  Object.freeze(_DER._tlv);
  Object.freeze(_DER._int);
  return Object.freeze(_DER);
})();

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/curves/abstract/weierstrass.js
var divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n3) / den;
function _splitEndoScalar(k, basis, n) {
  aInRange("scalar", k, _0n6, n);
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest(b2 * k, n);
  const c2 = divNearest(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n6;
  const k2neg = k2 < _0n6;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n5;
  if (k1 < _0n6 || k1 >= MAX_NUM || k2 < _0n6 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed for k");
  }
  return { k1neg, k1, k2neg, k2 };
}
function validateSigFormat(format) {
  if (!["compact", "recovered", "der"].includes(format))
    throw new Error('Signature format must be "compact", "recovered", or "der"');
  return format;
}
function validateSigOpts(opts, def) {
  validateObject(opts);
  const optsn = {};
  for (let optName of Object.keys(def)) {
    optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
  }
  abool2(optsn.lowS, "lowS");
  abool2(optsn.prehash, "prehash");
  if (optsn.format !== void 0)
    validateSigFormat(optsn.format);
  return optsn;
}
var _0n6 = /* @__PURE__ */ BigInt(0);
var _1n5 = /* @__PURE__ */ BigInt(1);
var _2n3 = /* @__PURE__ */ BigInt(2);
var _3n2 = /* @__PURE__ */ BigInt(3);
var _4n3 = /* @__PURE__ */ BigInt(4);
function weierstrass(params, extraOpts = {}) {
  const validated = createCurveFields("weierstrass", params, extraOpts);
  const Fp = validated.Fp;
  const Fn = validated.Fn;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  validateObject(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object",
    randomBytes: "function"
  });
  const { endo: endoOpts, allowInfinityPoint, clearCofactor, isTorsionFree, fromBytes, toBytes } = extraOpts;
  const randomBytes6 = extraOpts.randomBytes === void 0 ? randomBytes2 : extraOpts.randomBytes;
  if (endoOpts) {
    if (!Fp.is0(CURVE.a) || typeof endoOpts.beta !== "bigint" || !Array.isArray(endoOpts.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const endo = endoOpts ? {
    beta: endoOpts.beta,
    basises: endoOpts.basises.map((basis) => [...basis])
  } : void 0;
  const lengths = getWLengths(Fp, Fn);
  function assertCompressionIsSupported() {
    if (!Fp.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes(_c, point, isCompressed) {
    if (point.is0()) {
      if (!allowInfinityPoint)
        throw new Error("bad point: ZERO");
      return Uint8Array.of(0);
    }
    const { x, y } = point.toAffine();
    const bx = Fp.toBytes(x);
    abool2(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp.isOdd(y);
      return concatBytes2(pprefix(hasEvenY), bx);
    } else {
      return concatBytes2(Uint8Array.of(4), bx, Fp.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    abytes3(bytes, void 0, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (allowInfinityPoint && length === 1 && head === 0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (length === comp && (head === 2 || head === 3)) {
      const x = Fp.fromBytes(tail);
      if (!Fp.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp.sqrt(y2);
      } catch (sqrtError) {
        const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err);
      }
      assertCompressionIsSupported();
      const evenY = Fp.isOdd(y);
      const evenH = (head & 1) === 1;
      if (evenH !== evenY)
        y = Fp.neg(y);
      return { x, y };
    } else if (length === uncomp && head === 4) {
      const L = Fp.BYTES;
      const x = Fp.fromBytes(tail.subarray(0, L));
      const y = Fp.fromBytes(tail.subarray(L, L * 2));
      if (!isValidXY(x, y))
        throw new Error("bad point: is not on curve");
      return { x, y };
    } else {
      throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
    }
  }
  const encodePoint = toBytes === void 0 ? pointToBytes : toBytes;
  const decodePoint = fromBytes === void 0 ? pointFromBytes : fromBytes;
  const b3 = Fp.mul(CURVE.b, _3n2);
  const mulA = Fp.is0(CURVE.a) ? (_) => Fp.ZERO : (x) => Fp.mul(CURVE.a, x);
  function weierstrassEquation(x) {
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    return Fp.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n2), _4n3);
  const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
  if (Fp.is0(Fp.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp.isValid(n) || banZero && Fp.is0(n))
      throw new Error(`bad point coordinate ${title}`);
    return typeof n === "object" && n !== null ? Fp.create(n) : n;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("Weierstrass Point expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar(k, endo.basises, Fn.ORDER);
  }
  function pushWnafPair(points, scalars, p, k) {
    if (!Fn.isValid(k))
      throw new RangeError("invalid scalar: out of range");
    if (endo) {
      const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(k);
      const psi = new Point(Fp.mul(p.X, endo.beta), p.Y, p.Z);
      points.push(k1neg ? p.negate() : p, k2neg ? psi.negate() : psi);
      scalars.push(k1, k2);
    } else {
      points.push(p);
      scalars.push(k);
    }
  }
  const validityCache = /* @__PURE__ */ new WeakSet();
  class Point {
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
    static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
    static Fp = Fp;
    static Fn = Fn;
    X;
    Y;
    Z;
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    constructor(X, Y, Z) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y, true);
      this.Z = acoord("z", Z);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp.is0(x) && Fp.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp.ONE);
    }
    static fromBytes(bytes) {
      const P = Point.fromAffine(decodePoint(abytes3(bytes, void 0, "point")));
      P.assertValidity();
      return P;
    }
    static fromHex(hex) {
      return Point.fromBytes(hexToBytes3(hex));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     * @param isLazy - true will defer table computation until the first multiplication
     */
    precompute(windowSize = 6, isLazy = true) {
      wnaf.setWindowSize(this, windowSize);
      if (!isLazy)
        this.multiply(_3n2);
      return this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      const p = this;
      if (p.is0()) {
        if (allowInfinityPoint && Fp.is0(p.X) && Fp.eql(p.Y, Fp.ONE) && Fp.is0(p.Z))
          return;
        throw new Error("bad point: ZERO");
      }
      if (validityCache.has(p))
        return;
      const { x, y } = p.toAffine();
      if (!Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("bad point: x or y not field elements");
      if (!isValidXY(x, y))
        throw new Error("bad point: equation left != right");
      if (!p.isTorsionFree())
        throw new Error("bad point: not in prime-order subgroup");
      validityCache.add(p);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp.isOdd(y);
    }
    /** Compare one point to another. */
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
    negate() {
      return new Point(this.X, Fp.neg(this.Y), this.Z);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = mulA(Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = mulA(t2);
      t3 = Fp.sub(t0, t2);
      t3 = mulA(t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = mulA(t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = mulA(t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = mulA(t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      aprjpoint(other);
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    /**
     * Constant time multiplication.
     * Uses precomputed tables (signed fixed-window wNAF) when available.
     * Uses scalar blinding and avoids endomorphism splitting in the secret-scalar path.
     * @param scalar - by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new RangeError("invalid scalar: out of range");
      const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    /**
     * Non-constant-time multiplication. Uses width-4 wNAF with GLV endomorphism splitting
     * when available (two half-width scalars sharing one halved doubling chain).
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(scalar) {
      const p = this;
      const sc = scalar;
      if (!Fn.isValid(sc))
        throw new RangeError("invalid scalar: out of range");
      if (sc === _0n6 || p.is0())
        return Point.ZERO;
      if (sc === _1n5)
        return p;
      if (wnaf.hasWindowSize(this))
        return wnaf.mulUnsafe(p, sc, normalize);
      const points = [];
      const scalars = [];
      pushWnafPair(points, scalars, p, sc);
      return mulAddUnsafe(Point, points, scalars);
    }
    /**
     * Non-constant-time double-scalar multiplication `a⋅this + b⋅other` (Strauss–Shamir).
     * Both walks share one doubling chain via {@link mulAddUnsafe}, and GLV endomorphism
     * (when available) halves the chain again by splitting each scalar into two half-width
     * parts. Used by ECDSA verification and public-key recovery for `R = u1⋅G + u2⋅P`.
     * Only for public scalars.
     */
    mulAddUnsafe(a, other, b) {
      aprjpoint(other);
      const points = [];
      const scalars = [];
      pushWnafPair(points, scalars, this, a);
      pushWnafPair(points, scalars, other, b);
      return mulAddUnsafe(Point, points, scalars);
    }
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * (X, Y, Z) ∋ (x=X/Z, y=Y/Z).
     * @param invertedZ - Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      if (iz != null && !Fp.isValid(iz))
        throw new RangeError('"invertedZ" expected valid field element');
      const { X, Y, Z } = p;
      if (Fp.eql(Z, Fp.ONE))
        return { x: X, y: Y };
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.ONE : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ZERO };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      if (cofactor === _1n5)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.mulUnsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      if (cofactor === _1n5)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      if (cofactor === _1n5)
        return this.is0();
      return this.clearCofactor().is0();
    }
    toBytes(isCompressed = true) {
      abool2(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex2(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const normalize = (points) => normalizeZ(Point, points);
  const wnaf = new ScalarMultiplier(Point, randomBytes6);
  if (wnaf.bits >= 6)
    Point.BASE.precompute(6);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}
function pprefix(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function getWLengths(Fp, Fn) {
  return {
    secretKey: Fn.BYTES,
    publicKey: 1 + Fp.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp.BYTES,
    publicKeyHasPrefix: true,
    // Raw compact `(r || s)` signature width; DER and recovered signatures use
    // different lengths outside this helper.
    signature: 2 * Fn.BYTES
  };
}
function ecdh(Point, ecdhOpts = {}) {
  validatePointCons(Point);
  const { Fn } = Point;
  const randomBytes_ = ecdhOpts.randomBytes === void 0 ? randomBytes2 : ecdhOpts.randomBytes;
  const lengths = Object.assign(getWLengths(Point.Fp, Fn), {
    seed: Math.max(getMinHashLength(Fn.ORDER), 16)
  });
  function isValidSecretKey(secretKey) {
    try {
      const num = Fn.fromBytes(secretKey);
      return Fn.isValidNot0(num);
    } catch (error) {
      return false;
    }
  }
  function isValidPublicKey(publicKey, isCompressed) {
    const { publicKey: comp, publicKeyUncompressed } = lengths;
    try {
      const l = publicKey.length;
      if (isCompressed === true && l !== comp)
        return false;
      if (isCompressed === false && l !== publicKeyUncompressed)
        return false;
      return !Point.fromBytes(publicKey).is0();
    } catch (error) {
      return false;
    }
  }
  function randomSecretKey(seed) {
    seed = seed === void 0 ? randomBytes_(lengths.seed) : seed;
    return mapHashToField(abytes3(seed, lengths.seed, "seed"), Fn.ORDER);
  }
  function getPublicKey(secretKey, isCompressed = true) {
    return Point.BASE.multiply(Fn.fromBytes(secretKey)).toBytes(isCompressed);
  }
  function isProbPub(item) {
    const { secretKey, publicKey, publicKeyUncompressed } = lengths;
    const allowedLengths = Fn._lengths;
    if (!isBytes4(item))
      return void 0;
    const l = abytes3(item, void 0, "key").length;
    const isPub = l === publicKey || l === publicKeyUncompressed;
    const isSec = l === secretKey || !!allowedLengths?.includes(l);
    if (isPub && isSec)
      return void 0;
    return isPub;
  }
  function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
    if (isProbPub(secretKeyA) === true)
      throw new Error("first arg must be private key");
    if (isProbPub(publicKeyB) === false)
      throw new Error("second arg must be public key");
    const s = Fn.fromBytes(secretKeyA);
    const b = Point.fromBytes(publicKeyB);
    if (b.is0())
      throw new Error("invalid public key: point at infinity");
    return b.multiply(s).toBytes(isCompressed);
  }
  const utils = {
    isValidSecretKey,
    isValidPublicKey,
    randomSecretKey
  };
  const keygen = createKeygen(randomSecretKey, getPublicKey);
  Object.freeze(utils);
  Object.freeze(lengths);
  return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
}
function ecdsa(Point, hash, ecdsaOpts = {}) {
  validatePointCons(Point);
  const hash_ = hash;
  ahash(hash_);
  validateObject(ecdsaOpts, {}, {
    hmac: "function",
    lowS: "boolean",
    randomBytes: "function",
    bits2int: "function",
    bits2int_modN: "function"
  });
  const opts = Object.assign({}, ecdsaOpts);
  const randomBytes6 = opts.randomBytes === void 0 ? randomBytes2 : opts.randomBytes;
  const hmac3 = opts.hmac === void 0 ? (key, msg) => hmac(hash_, key, msg) : opts.hmac;
  const { Fp, Fn } = Point;
  const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
  const blindLength = getMinHashLength(CURVE_ORDER);
  const csprng = probeRandomBytes(randomBytes6, blindLength);
  const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, opts);
  const defaultSigOpts = {
    prehash: true,
    lowS: typeof opts.lowS === "boolean" ? opts.lowS : true,
    format: "compact",
    extraEntropy: false
  };
  const hasLargeRecoveryLifts = CURVE_ORDER * _2n3 + _1n5 < Fp.ORDER;
  function isBiggerThanHalfOrder(number) {
    const HALF = CURVE_ORDER >> _1n5;
    return number > HALF;
  }
  function validateRS(title, num) {
    if (!Fn.isValidNot0(num))
      throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
    return num;
  }
  function assertFieldSignIsSupported() {
    if (!Fp.isOdd)
      throw new Error("Field doesn't support isOdd");
  }
  function getRecoveryBit(x, y, r) {
    assertFieldSignIsSupported();
    return (x === r ? 0 : 2) | Number(Fp.isOdd(y));
  }
  function assertRecoverableCurve() {
    if (hasLargeRecoveryLifts)
      throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
  }
  function validateSigLength(bytes, format) {
    validateSigFormat(format);
    const size = lengths.signature;
    const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : void 0;
    return abytes3(bytes, sizer);
  }
  class Signature {
    r;
    s;
    recovery;
    constructor(r, s, recovery) {
      this.r = validateRS("r", r);
      this.s = validateRS("s", s);
      if (recovery != null) {
        assertRecoverableCurve();
        if (![0, 1, 2, 3].includes(recovery))
          throw new Error("invalid recovery id");
        this.recovery = recovery;
      }
      Object.freeze(this);
    }
    static fromBytes(bytes, format = defaultSigOpts.format) {
      validateSigLength(bytes, format);
      let recid;
      if (format === "der") {
        if (bytes.length > 2 * Fn.BYTES + 16)
          throw new DER.Err("invalid signature: DER signature too long");
        const { r: r2, s: s2 } = DER.toSig(abytes3(bytes), Fn.BYTES + 1);
        return new Signature(r2, s2);
      }
      if (format === "recovered") {
        recid = bytes[0];
        format = "compact";
        bytes = bytes.subarray(1);
      }
      const L = lengths.signature / 2;
      const r = bytes.subarray(0, L);
      const s = bytes.subarray(L, L * 2);
      return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
    }
    static fromHex(hex, format) {
      return this.fromBytes(hexToBytes3(hex), format);
    }
    assertRecovery() {
      const { recovery } = this;
      if (recovery == null)
        throw new Error("invalid recovery id: must be present");
      return recovery;
    }
    addRecoveryBit(recovery) {
      return new Signature(this.r, this.s, recovery);
    }
    // Unlike the top-level helper below, this method expects a digest that has
    // already been hashed to the curve's message representative.
    recoverPublicKey(messageHash) {
      const { r, s } = this;
      const recovery = this.assertRecovery();
      const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
      if (!Fp.isValid(radj))
        throw new Error("invalid recovery id: sig.r+curve.n != R.x");
      const x = Fp.toBytes(radj);
      const R = Point.fromBytes(concatBytes2(pprefix((recovery & 1) === 0), x));
      const ir = Fn.inv(radj);
      const h = bits2int_modN(abytes3(messageHash, void 0, "msgHash"));
      const u1 = Fn.create(-h * ir);
      const u2 = Fn.create(s * ir);
      const Q = Point.BASE.mulAddUnsafe(u1, R, u2);
      if (Q.is0())
        throw new Error("invalid recovery: point at infinify");
      Q.assertValidity();
      return Q;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    toBytes(format = defaultSigOpts.format) {
      validateSigFormat(format);
      if (format === "der")
        return hexToBytes3(DER.hexFromSig(this));
      const { r, s } = this;
      const rb = Fn.toBytes(r);
      const sb = Fn.toBytes(s);
      if (format === "recovered") {
        assertRecoverableCurve();
        return concatBytes2(Uint8Array.of(this.assertRecovery()), rb, sb);
      }
      return concatBytes2(rb, sb);
    }
    toHex(format) {
      return bytesToHex2(this.toBytes(format));
    }
  }
  Object.freeze(Signature.prototype);
  Object.freeze(Signature);
  const bits2int = opts.bits2int === void 0 ? function bits2int_def(bytes) {
    if (bytes.length > 8192)
      throw new Error("input is too large");
    const num = bytesToNumberBE(bytes);
    const delta = bytes.length * 8 - fnBits;
    return delta > 0 ? num >> BigInt(delta) : num;
  } : opts.bits2int;
  const bits2int_modN = opts.bits2int_modN === void 0 ? function bits2int_modN_def(bytes) {
    return Fn.create(bits2int(bytes));
  } : opts.bits2int_modN;
  const ORDER_MASK = bitMask(fnBits);
  function int2octets(num) {
    aInRange("num < 2^" + fnBits, num, _0n6, ORDER_MASK);
    return Fn.toBytes(num);
  }
  function validateMsgAndHash(message, prehash) {
    abytes3(message, void 0, "message");
    return prehash ? abytes3(hash_(message), void 0, "prehashed message") : message;
  }
  function prepSig(message, secretKey, opts2) {
    const { lowS, prehash, extraEntropy } = validateSigOpts(opts2, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    const h1int = bits2int_modN(message);
    const d = Fn.fromBytes(secretKey);
    if (!Fn.isValidNot0(d))
      throw new Error("invalid private key");
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (extraEntropy != null && extraEntropy !== false) {
      const e = extraEntropy === true ? randomBytes6(lengths.secretKey) : extraEntropy;
      seedArgs.push(abytes3(e, void 0, "extraEntropy"));
    }
    const seed = concatBytes2(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int(kBytes);
      if (!Fn.isValidNot0(k))
        return;
      const q = Point.BASE.multiply(k).toAffine();
      const r = Fn.create(q.x);
      if (r === _0n6)
        return;
      let s;
      if (csprng !== void 0) {
        const b = bytesToNumberBE(mapHashToField(csprng(blindLength), CURVE_ORDER));
        const ibk = Fn.inv(Fn.mul(b, k));
        const bm = Fn.mul(b, m);
        const bd = Fn.mul(b, d);
        s = Fn.create(ibk * Fn.create(bm + bd * r));
      } else {
        const ik = invertCt(k, CURVE_ORDER);
        s = Fn.create(ik * Fn.create(m + r * d));
      }
      if (s === _0n6)
        return;
      let recovery = getRecoveryBit(q.x, q.y, r);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = Fn.neg(s);
        recovery ^= 1;
      }
      return new Signature(r, normS, hasLargeRecoveryLifts ? void 0 : recovery);
    }
    return { seed, k2sig };
  }
  function sign2(message, secretKey, opts2 = {}) {
    const { seed, k2sig } = prepSig(message, secretKey, opts2);
    const drbg = createHmacDrbg(hash_.outputLen, Fn.BYTES, hmac3);
    const sig = drbg(seed, k2sig);
    return sig.toBytes(opts2.format);
  }
  function verify(signature, message, publicKey, opts2 = {}) {
    const { lowS, prehash, format } = validateSigOpts(opts2, defaultSigOpts);
    publicKey = abytes3(publicKey, void 0, "publicKey");
    message = validateMsgAndHash(message, prehash);
    if (!isBytes4(signature)) {
      const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
      throw new Error("verify expects Uint8Array signature" + end);
    }
    validateSigLength(signature, format);
    try {
      const sig = Signature.fromBytes(signature, format);
      const P = Point.fromBytes(publicKey);
      if (P.is0())
        return false;
      if (lowS && sig.hasHighS())
        return false;
      const { r, s } = sig;
      const h = bits2int_modN(message);
      const is = Fn.inv(s);
      const u1 = Fn.create(h * is);
      const u2 = Fn.create(r * is);
      const R = Point.BASE.mulAddUnsafe(u1, P, u2);
      if (R.is0())
        return false;
      const q = R.toAffine();
      const v = Fn.create(q.x);
      if (v !== r)
        return false;
      if (format === "recovered" && sig.recovery !== getRecoveryBit(q.x, q.y, r))
        return false;
      return true;
    } catch (e) {
      return false;
    }
  }
  function recoverPublicKey(signature, message, opts2 = {}) {
    const { prehash } = validateSigOpts(opts2, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
  }
  return Object.freeze({
    keygen,
    getPublicKey,
    getSharedSecret,
    utils,
    lengths,
    Point,
    sign: sign2,
    verify,
    recoverPublicKey,
    Signature,
    hash: hash_
  });
}

// node_modules/@toruslabs/metadata-helpers/node_modules/@noble/curves/secp256k1.js
var secp256k1_CURVE = {
  p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
  n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
  h: BigInt(1),
  a: BigInt(0),
  b: BigInt(7),
  Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
  Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
};
var secp256k1_ENDO = {
  beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
  basises: [
    [BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],
    [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]
  ]
};
var _2n4 = /* @__PURE__ */ BigInt(2);
function sqrtMod(y) {
  const P = secp256k1_CURVE.p;
  const _3n5 = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
  const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
  const b2 = y * y * y % P;
  const b3 = b2 * b2 * y % P;
  const b6 = pow2(b3, _3n5, P) * b3 % P;
  const b9 = pow2(b6, _3n5, P) * b3 % P;
  const b11 = pow2(b9, _2n4, P) * b2 % P;
  const b22 = pow2(b11, _11n, P) * b11 % P;
  const b44 = pow2(b22, _22n, P) * b22 % P;
  const b88 = pow2(b44, _44n, P) * b44 % P;
  const b176 = pow2(b88, _88n, P) * b88 % P;
  const b220 = pow2(b176, _44n, P) * b44 % P;
  const b223 = pow2(b220, _3n5, P) * b3 % P;
  const t1 = pow2(b223, _23n, P) * b22 % P;
  const t2 = pow2(t1, _6n, P) * b2 % P;
  const root = pow2(t2, _2n4, P);
  if (!Fpk1.eql(Fpk1.sqr(root), y))
    throw new Error("Cannot find square root");
  return root;
}
var Fpk1 = /* @__PURE__ */ Field(secp256k1_CURVE.p, { sqrt: sqrtMod });
var Pointk1 = /* @__PURE__ */ weierstrass(secp256k1_CURVE, {
  Fp: Fpk1,
  endo: secp256k1_ENDO
});
var secp256k1 = /* @__PURE__ */ ecdsa(Pointk1, sha256);

// node_modules/@toruslabs/eccrypto/node_modules/@noble/hashes/_u64.js
var fromNumH2 = (n) => n / 2 ** 32 | 0;
var fromNumL2 = (n) => n >>> 0;
function setU64FromNum2(view, byteOffset, n, isLE2) {
  const h = fromNumH2(n);
  const l = fromNumL2(n);
  view.setUint32(byteOffset, isLE2 ? l : h, isLE2);
  view.setUint32(byteOffset + 4, isLE2 ? h : l, isLE2);
}

// node_modules/@toruslabs/eccrypto/node_modules/@noble/hashes/utils.js
function isBytes5(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
var atitle3 = (title) => title ? `"${title}" ` : "";
function anumber4(n, title = "") {
  if (typeof n !== "number")
    throw new TypeError(atitle3(title) + "expected number, got " + typeof n);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(atitle3(title) + "expected integer >= 0, got " + n);
  return n;
}
function abytes4(value, length, title = "") {
  if (isBytes5(value) && (length === void 0 || value.length === length))
    return value;
  if (length !== void 0)
    anumber4(length, "length");
  const bytes = isBytes5(value);
  const ofLen = length !== void 0 ? ` of length ${length}` : "";
  const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
  const message = atitle3(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
function ahash2(h) {
  if (typeof h !== "function" || typeof h.create !== "function")
    throw new TypeError("expected hash wrapped by utils.createHasher");
  anumber4(h.outputLen);
  anumber4(h.blockLen);
  if (h.outputLen < 1 || h.blockLen < 1)
    throw new Error("hash blockLen / outputLen must be >= 1");
}
var aobject3 = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
};
var aopts2 = (value, label) => {
  aobject3(value, label);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists2(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput2(out, instance) {
  abytes4(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function clean2(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView2(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr2(word, shift) {
  return word << 32 - shift | word >>> shift;
}
var hasHexBuiltin2 = /* @__PURE__ */ (() => (
  // @ts-ignore
  typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
))();
var hexes2 = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex3(bytes) {
  abytes4(bytes);
  if (hasHexBuiltin2)
    return bytes.toHex();
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += hexes2[bytes[i]];
  }
  return hex;
}
function asciiToBase162(ch) {
  return ch >= 48 && ch <= 57 ? ch - 48 : ch >= 65 && ch <= 70 ? ch - (65 - 10) : ch >= 97 && ch <= 102 ? ch - (97 - 10) : void 0;
}
function hexToBytes4(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  if (hasHexBuiltin2) {
    try {
      return Uint8Array.fromHex(hex);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RangeError(error.message);
      throw error;
    }
  }
  const hl = hex.length;
  const al = hl / 2;
  if (hl % 2)
    throw new RangeError("hex string expected, got unpadded hex of length " + hl);
  const array = new Uint8Array(al);
  for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
    const n1 = asciiToBase162(hex.charCodeAt(hi));
    const n2 = asciiToBase162(hex.charCodeAt(hi + 1));
    if (n1 === void 0 || n2 === void 0) {
      const char = hex[hi] + hex[hi + 1];
      throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
    }
    array[ai] = n1 * 16 + n2;
  }
  return array;
}
function concatBytes3(...arrays) {
  let sum = 0;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    abytes4(a);
    sum += a.length;
  }
  const res = new Uint8Array(sum);
  for (let i = 0, pad = 0; i < arrays.length; i++) {
    const a = arrays[i];
    res.set(a, pad);
    pad += a.length;
  }
  return res;
}
function checkOpts2(defaults, opts, title = "opts") {
  aopts2(defaults, "defaults");
  if (opts !== void 0)
    aopts2(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
function createHasher2(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts2({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
function randomBytes3(bytesLength = 32) {
  anumber4(bytesLength, "bytesLength");
  const cr = typeof globalThis === "object" ? globalThis.crypto : null;
  if (typeof cr?.getRandomValues !== "function")
    throw new Error("crypto.getRandomValues must be defined");
  if (bytesLength > 65536)
    throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
  return cr.getRandomValues(new Uint8Array(bytesLength));
}
var oidNist2 = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});

// node_modules/@toruslabs/eccrypto/node_modules/@noble/hashes/_md.js
function Chi2(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj2(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
var HashMD2 = class {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE2) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE2;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView2(this.buffer);
  }
  update(data) {
    aexists2(this);
    abytes4(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView2(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE: isLE2 } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum2(view, blockLen - 8, this.length * 8, isLE2);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView2(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE2);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var SHA256_IV2 = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);

// node_modules/@toruslabs/eccrypto/node_modules/@noble/hashes/sha2.js
var SHA256_K2 = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var SHA256_W2 = /* @__PURE__ */ new Uint32Array(64);
var SHA2_32B2 = class extends HashMD2 {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and makes sha256 3x slower (measured).
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B: B2, C, D, E, F, G, H } = this;
    return [A, B2, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B2, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B2 | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W2[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W2[i - 15];
      const W2 = SHA256_W2[i - 2];
      const s0 = rotr2(W15, 7) ^ rotr2(W15, 18) ^ W15 >>> 3;
      const s1 = rotr2(W2, 17) ^ rotr2(W2, 19) ^ W2 >>> 10;
      SHA256_W2[i] = s1 + SHA256_W2[i - 7] + s0 + SHA256_W2[i - 16] | 0;
    }
    let { A, B: B2, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr2(E, 6) ^ rotr2(E, 11) ^ rotr2(E, 25);
      const T1 = H + sigma1 + Chi2(E, F, G) + SHA256_K2[i] + SHA256_W2[i] | 0;
      const sigma0 = rotr2(A, 2) ^ rotr2(A, 13) ^ rotr2(A, 22);
      const T2 = sigma0 + Maj2(A, B2, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B2;
      B2 = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B2 = B2 + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B2, C, D, E, F, G, H);
  }
  roundClean() {
    clean2(SHA256_W2);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean2(this.buffer);
  }
};
var _SHA2562 = class extends SHA2_32B2 {
  constructor() {
    super(32, SHA256_IV2);
  }
};
var sha2562 = /* @__PURE__ */ createHasher2(
  () => new _SHA2562(),
  /* @__PURE__ */ oidNist2(1)
);

// node_modules/@toruslabs/eccrypto/node_modules/@noble/curves/utils.js
function aarray2(item, title, inner = () => {
}) {
  if (!Array.isArray(item))
    throw new TypeError(`"${title}" expected array, got type=${typeof item}`);
  for (let i = 0; i < item.length; i++)
    inner(item[i], `${title}[${i}]`);
  return item;
}
var abytes5 = (value, length, title) => abytes4(value, length, title);
var anumber5 = anumber4;
function astring2(value, title = "") {
  if (typeof value !== "string") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected string, got type=" + typeof value);
  }
  return value;
}
function aobject4(value, title = "object") {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(title === "object" ? "expected valid options object" : `"${title}" expected object, got type=${typeof value}`);
  return value;
}
function afunction2(value, title) {
  if (typeof value !== "function")
    throw new TypeError(`"${title}" is invalid: expected function, got ${typeof value}`);
  return value;
}
var bytesToHex4 = bytesToHex3;
var concatBytes4 = (...arrays) => concatBytes3(...arrays);
var hexToBytes5 = (hex) => hexToBytes4(hex);
var isBytes6 = isBytes5;
var randomBytes4 = (bytesLength) => randomBytes3(bytesLength);
var _0n7 = /* @__PURE__ */ BigInt(0);
var _1n6 = /* @__PURE__ */ BigInt(1);
var atitle4 = (title) => title ? `"${title}" ` : "";
function abool3(value, title = "") {
  if (typeof value !== "boolean")
    throw new TypeError(atitle4(title) + "expected boolean, got type=" + typeof value);
  return value;
}
function abignumber2(n) {
  if (typeof n === "bigint") {
    if (!isPosBig2(n))
      throw new RangeError("positive bigint expected, got " + n);
  } else
    anumber5(n);
  return n;
}
function asafenumber2(value, title = "") {
  if (typeof value !== "number") {
    const prefix = title && `"${title}" `;
    throw new TypeError(prefix + "expected number, got type=" + typeof value);
  }
  if (!Number.isSafeInteger(value)) {
    const prefix = title && `"${title}" `;
    throw new RangeError(prefix + "expected safe integer, got " + value);
  }
}
function numberToHexUnpadded2(num) {
  const hex = abignumber2(num).toString(16);
  return hex.length & 1 ? "0" + hex : hex;
}
function hexToNumber2(hex) {
  if (typeof hex !== "string")
    throw new TypeError("hex string expected, got " + typeof hex);
  return hex === "" ? _0n7 : BigInt("0x" + hex);
}
function bytesToNumberBE2(bytes) {
  return hexToNumber2(bytesToHex3(bytes));
}
function bytesToNumberLE2(bytes) {
  return hexToNumber2(bytesToHex3(copyBytes2(abytes4(bytes)).reverse()));
}
function numberToBytesBE2(n, len) {
  anumber4(len);
  if (len === 0)
    throw new Error("zero output length is invalid");
  n = abignumber2(n);
  const expectedLen = len * 2;
  const hex = n.toString(16);
  if (hex.length > expectedLen)
    throw new RangeError("number is too large");
  return hexToBytes4(hex.padStart(expectedLen, "0"));
}
function numberToBytesLE2(n, len) {
  return numberToBytesBE2(n, len).reverse();
}
function equalBytes(a, b) {
  a = abytes5(a);
  b = abytes5(b);
  if (a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++)
    diff |= a[i] ^ b[i];
  return diff === 0;
}
function copyBytes2(bytes) {
  return Uint8Array.from(abytes5(bytes));
}
function isPosBig2(n) {
  return typeof n === "bigint" && _0n7 <= n;
}
function inRange2(n, min, max) {
  return isPosBig2(n) && isPosBig2(min) && isPosBig2(max) && min <= n && n < max;
}
function aInRange2(title, n, min, max) {
  if (!inRange2(n, min, max))
    throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
function bitLen2(n) {
  if (n < _0n7)
    throw new Error("expected non-negative bigint, got " + n);
  return n === _0n7 ? 0 : n.toString(2).length;
}
var bitMask2 = (n) => {
  asafenumber2(n, "n");
  return (_1n6 << BigInt(n)) - _1n6;
};
function createHmacDrbg2(hashLen, qByteLen, hmacFn) {
  anumber4(hashLen, "hashLen");
  anumber4(qByteLen, "qByteLen");
  if (typeof hmacFn !== "function")
    throw new TypeError("hmacFn must be a function");
  const u8n = (len) => new Uint8Array(len);
  const NULL = Uint8Array.of();
  const byte0 = Uint8Array.of(0);
  const byte1 = Uint8Array.of(1);
  const _maxDrbgIters = 1e3;
  let v = u8n(hashLen);
  let k = u8n(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...msgs) => hmacFn(k, concatBytes4(v, ...msgs));
  const reseed = (seed = NULL) => {
    k = h(byte0, seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(byte1, seed);
    v = h();
  };
  const gen = () => {
    if (i++ >= _maxDrbgIters)
      throw new Error("drbg: tried max amount of iterations");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes4(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = void 0;
    while ((res = pred(gen())) === void 0)
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
function validateObject2(object, fields = {}, optFields = {}, title = "object") {
  aobject4(object, title);
  aobject4(fields, "fields");
  aobject4(optFields, "optFields");
  function checkField(fieldName, expectedType, isOpt) {
    const label = title === "object" ? `param "${String(fieldName)}"` : `"${title}.${String(fieldName)}"`;
    const val = object[fieldName];
    if (!Object.hasOwn(object, fieldName) && (isOpt ? val !== void 0 : expectedType !== "function")) {
      throw new TypeError(`${label} is invalid: expected own property`);
    }
    if (isOpt && val === void 0)
      return;
    const current = typeof val;
    if (current !== expectedType || val === null)
      throw new TypeError(`${label} is invalid: expected ${expectedType}, got ${current}`);
  }
  const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
  iter(fields, false);
  iter(optFields, true);
}

// node_modules/@toruslabs/eccrypto/node_modules/@noble/curves/abstract/modular.js
var _0n8 = /* @__PURE__ */ BigInt(0);
var _1n7 = /* @__PURE__ */ BigInt(1);
var _2n5 = /* @__PURE__ */ BigInt(2);
var _3n3 = /* @__PURE__ */ BigInt(3);
var _4n4 = /* @__PURE__ */ BigInt(4);
var _5n2 = /* @__PURE__ */ BigInt(5);
var _7n3 = /* @__PURE__ */ BigInt(7);
var _8n2 = /* @__PURE__ */ BigInt(8);
var _9n2 = /* @__PURE__ */ BigInt(9);
var _15n2 = /* @__PURE__ */ BigInt(15);
var _16n2 = /* @__PURE__ */ BigInt(16);
var POW_WINDOWED_MIN2 = /* @__PURE__ */ BigInt("0x10000000000000000");
function mod2(a, b) {
  if (b <= _0n8)
    throw new Error("mod: expected positive modulus, got " + b);
  const result = a % b;
  return result >= _0n8 ? result : b + result;
}
function pow3(num, power, modulo) {
  if (modulo <= _1n7)
    throw new Error("pow: expected modulus > 1, got " + modulo);
  if (typeof power !== "bigint")
    throw new TypeError("invalid exponent: expected bigint, got " + typeof power);
  if (power < _0n8)
    throw new Error("invalid exponent, negatives unsupported");
  if (power === _0n8)
    return _1n7;
  if (power === _1n7)
    return num;
  let d = num % modulo;
  if (d < _0n8)
    d += modulo;
  if (power < POW_WINDOWED_MIN2) {
    let p2 = _1n7;
    while (power > _0n8) {
      if (power & _1n7)
        p2 = p2 * d % modulo;
      d = d * d % modulo;
      power >>= _1n7;
    }
    return p2;
  }
  const digits = [];
  while (power > _0n8) {
    digits.push(Number(power & _15n2));
    power >>= _4n4;
  }
  const table = new Array(16);
  table[0] = _1n7;
  table[1] = d;
  for (let i = 2; i < 16; i++)
    table[i] = table[i - 1] * d % modulo;
  let p = table[digits[digits.length - 1]];
  for (let w = digits.length - 2; w >= 0; w--) {
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    p = p * p % modulo;
    const digit = digits[w];
    if (digit !== 0)
      p = p * table[digit] % modulo;
  }
  return p;
}
function pow22(x, power, modulo) {
  if (modulo <= _1n7)
    throw new Error("pow2: expected modulus > 1, got " + modulo);
  if (power < _0n8)
    throw new Error("pow2: expected non-negative exponent, got " + power);
  let res = x;
  while (power-- > _0n8) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert2(number, modulo) {
  if (number === _0n8)
    throw new Error("invert: expected non-zero number");
  if (modulo <= _1n7)
    throw new Error("invert: expected modulus > 1, got " + modulo);
  let a = mod2(number, modulo);
  let b = modulo;
  let x = _0n8, u = _1n7;
  while (a !== _0n8) {
    const q = b / a;
    const r = b - a * q;
    const m = x - u * q;
    b = a, a = r, x = u, u = m;
  }
  const gcd = b;
  if (gcd !== _1n7)
    throw new Error("invert: does not exist");
  return mod2(x, modulo);
}
function invertCt2(a, prime) {
  if (prime <= _1n7)
    throw new Error("invertCt: expected prime modulus > 1, got " + prime);
  const an = mod2(a, prime);
  if (an === _0n8)
    throw new Error("invertCt: expected non-zero number");
  const inverse = pow3(an, prime - _2n5, prime);
  if (mod2(an * inverse, prime) !== _1n7)
    throw new Error("invertCt: does not exist");
  return inverse;
}
function assertIsSquare2(Fp, root, n) {
  const F = Fp;
  if (!F.eql(F.sqr(root), n))
    throw new Error("Cannot find square root");
}
function aoddModulus2(order, fnName) {
  if ((order & _1n7) === _0n8)
    throw new Error(fnName + ": expected odd modulus, got " + order);
}
function sqrt3mod42(Fp, n) {
  const F = Fp;
  const p1div4 = (F.ORDER + _1n7) / _4n4;
  const root = F.pow(n, p1div4);
  assertIsSquare2(F, root, n);
  return root;
}
function sqrt5mod82(Fp, n) {
  const F = Fp;
  const p5div8 = (F.ORDER - _5n2) / _8n2;
  const n2 = F.mul(n, _2n5);
  const v = F.pow(n2, p5div8);
  const nv = F.mul(n, v);
  const i = F.mul(F.mul(nv, _2n5), v);
  const root = F.mul(nv, F.sub(i, F.ONE));
  assertIsSquare2(F, root, n);
  return root;
}
function sqrt9mod162(P) {
  const Fp_ = Field2(P);
  const tn = tonelliShanks2(P);
  const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
  const c2 = tn(Fp_, c1);
  const c3 = tn(Fp_, Fp_.neg(c1));
  const c4 = (P + _7n3) / _16n2;
  return ((Fp, n) => {
    const F = Fp;
    let tv1 = F.pow(n, c4);
    let tv2 = F.mul(tv1, c1);
    const tv3 = F.mul(tv1, c2);
    const tv4 = F.mul(tv1, c3);
    const e1 = F.eql(F.sqr(tv2), n);
    const e2 = F.eql(F.sqr(tv3), n);
    tv1 = F.cmov(tv1, tv2, e1);
    tv2 = F.cmov(tv4, tv3, e2);
    const e3 = F.eql(F.sqr(tv2), n);
    const root = F.cmov(tv1, tv2, e3);
    assertIsSquare2(F, root, n);
    return root;
  });
}
function tonelliShanks2(P) {
  if (P < _3n3)
    throw new Error("sqrt is not defined for small field");
  aoddModulus2(P, "tonelliShanks");
  let Q = P - _1n7;
  let S = 0;
  while (Q % _2n5 === _0n8) {
    Q /= _2n5;
    S++;
  }
  let Z = _2n5;
  const _Fp = Field2(P);
  while (FpLegendre2(_Fp, Z) === 1) {
    if (Z++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  }
  if (S === 1)
    return sqrt3mod42;
  let cc = _Fp.pow(Z, Q);
  const Q1div2 = (Q + _1n7) / _2n5;
  return function tonelliSlow(Fp, n) {
    const F = Fp;
    if (F.is0(n))
      return n;
    if (FpLegendre2(F, n) !== 1)
      throw new Error("Cannot find square root");
    let M = S;
    let c = F.mul(F.ONE, cc);
    let t = F.pow(n, Q);
    let R = F.pow(n, Q1div2);
    while (!F.eql(t, F.ONE)) {
      if (F.is0(t))
        throw new Error("Cannot find square root: probably non-prime P");
      let i = 1;
      let t_tmp = F.sqr(t);
      while (!F.eql(t_tmp, F.ONE)) {
        i++;
        t_tmp = F.sqr(t_tmp);
        if (i === M)
          throw new Error("Cannot find square root");
      }
      const exponent = _1n7 << BigInt(M - i - 1);
      const b = F.pow(c, exponent);
      M = i;
      c = F.sqr(b);
      t = F.mul(t, c);
      R = F.mul(R, b);
    }
    return R;
  };
}
function FpSqrt2(P) {
  aoddModulus2(P, "Fp.sqrt");
  if (P % _4n4 === _3n3)
    return sqrt3mod42;
  if (P % _8n2 === _5n2)
    return sqrt5mod82;
  if (P % _16n2 === _9n2)
    return sqrt9mod162(P);
  return tonelliShanks2(P);
}
var FIELD_FIELDS2 = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField2(field) {
  aobject4(field, "field");
  if (typeof field.ORDER !== "bigint")
    throw new TypeError('param "ORDER" is invalid: expected bigint, got ' + typeof field.ORDER);
  asafenumber2(field.BYTES, "BYTES");
  asafenumber2(field.BITS, "BITS");
  for (const name of FIELD_FIELDS2)
    afunction2(field[name], "field." + name);
  if (field.BYTES < 1 || field.BITS < 1)
    throw new Error("invalid field: expected BYTES/BITS > 0");
  if (field.ORDER <= _1n7)
    throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
  return field;
}
function FpInvertBatch2(Fp, nums, passZero = false) {
  validateField2(Fp);
  aarray2(nums, "nums");
  abool3(passZero, "passZero");
  const F = Fp;
  const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
  const multipliedAcc = nums.reduce((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = acc;
    return F.mul(acc, num);
  }, F.ONE);
  const invertedAcc = F.inv(multipliedAcc);
  nums.reduceRight((acc, num, i) => {
    if (F.is0(num))
      return acc;
    inverted[i] = F.mul(acc, inverted[i]);
    return F.mul(acc, num);
  }, invertedAcc);
  return inverted;
}
function FpLegendre2(Fp, n) {
  validateField2(Fp);
  const F = Fp;
  aoddModulus2(F.ORDER, "FpLegendre");
  const p1mod2 = (F.ORDER - _1n7) / _2n5;
  const powered = F.pow(n, p1mod2);
  const yes = F.eql(powered, F.ONE);
  const zero = F.eql(powered, F.ZERO);
  const no = F.eql(powered, F.neg(F.ONE));
  if (!yes && !zero && !no)
    throw new Error("invalid Legendre symbol result");
  return yes ? 1 : zero ? 0 : -1;
}
function nLength2(n, nBitLength) {
  if (nBitLength !== void 0)
    anumber5(nBitLength);
  if (n <= _0n8)
    throw new Error("invalid n length: expected positive n, got " + n);
  if (nBitLength !== void 0 && nBitLength < 1)
    throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
  const bits = bitLen2(n);
  if (nBitLength !== void 0 && nBitLength < bits)
    throw new Error(`invalid n length: expected nBitLength (${nBitLength}) >= bitLen(n) (${bits})`);
  const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
var FIELD_SQRT2 = /* @__PURE__ */ new WeakMap();
var _Field2 = class {
  ORDER;
  BITS;
  BYTES;
  isLE;
  ZERO = _0n8;
  ONE = _1n7;
  _lengths;
  _mod;
  constructor(ORDER, opts = {}) {
    if (ORDER <= _1n7)
      throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
    let _nbitLength = void 0;
    this.isLE = false;
    if (opts != null && typeof opts === "object") {
      if (typeof opts.BITS === "number")
        _nbitLength = opts.BITS;
      if (typeof opts.sqrt === "function")
        Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
      if (typeof opts.isLE === "boolean")
        this.isLE = opts.isLE;
      if (opts.allowedLengths)
        this._lengths = Object.freeze(opts.allowedLengths.slice());
      if (typeof opts.modFromBytes === "boolean")
        this._mod = opts.modFromBytes;
    }
    const { nBitLength, nByteLength } = nLength2(ORDER, _nbitLength);
    if (nByteLength > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = ORDER;
    this.BITS = nBitLength;
    this.BYTES = nByteLength;
    Object.freeze(this);
  }
  create(num) {
    return mod2(num, this.ORDER);
  }
  isValid(num) {
    if (typeof num !== "bigint")
      throw new TypeError("invalid field element: expected bigint, got " + typeof num);
    return _0n8 <= num && num < this.ORDER;
  }
  is0(num) {
    return num === _0n8;
  }
  // is valid and invertible
  isValidNot0(num) {
    return !this.is0(num) && this.isValid(num);
  }
  isOdd(num) {
    return (num & _1n7) === _1n7;
  }
  neg(num) {
    return mod2(-num, this.ORDER);
  }
  eql(lhs, rhs) {
    return lhs === rhs;
  }
  sqr(num) {
    return mod2(num * num, this.ORDER);
  }
  add(lhs, rhs) {
    return mod2(lhs + rhs, this.ORDER);
  }
  sub(lhs, rhs) {
    return mod2(lhs - rhs, this.ORDER);
  }
  mul(lhs, rhs) {
    return mod2(lhs * rhs, this.ORDER);
  }
  pow(num, power) {
    return pow3(num, power, this.ORDER);
  }
  div(lhs, rhs) {
    return mod2(lhs * invert2(rhs, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(num) {
    return num * num;
  }
  addN(lhs, rhs) {
    return lhs + rhs;
  }
  subN(lhs, rhs) {
    return lhs - rhs;
  }
  mulN(lhs, rhs) {
    return lhs * rhs;
  }
  inv(num) {
    return invert2(num, this.ORDER);
  }
  sqrt(num) {
    let sqrt = FIELD_SQRT2.get(this);
    if (!sqrt)
      FIELD_SQRT2.set(this, sqrt = FpSqrt2(this.ORDER));
    return sqrt(this, num);
  }
  toBytes(num) {
    return this.isLE ? numberToBytesLE2(num, this.BYTES) : numberToBytesBE2(num, this.BYTES);
  }
  fromBytes(bytes, skipValidation = false) {
    abytes5(bytes);
    const { _lengths: allowedLengths, BYTES, isLE: isLE2, ORDER, _mod: modFromBytes } = this;
    if (allowedLengths) {
      if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
        throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
      }
      const padded = new Uint8Array(BYTES);
      padded.set(bytes, isLE2 ? 0 : padded.length - bytes.length);
      bytes = padded;
    }
    if (bytes.length !== BYTES)
      throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
    let scalar = isLE2 ? bytesToNumberLE2(bytes) : bytesToNumberBE2(bytes);
    if (modFromBytes)
      scalar = mod2(scalar, ORDER);
    if (!skipValidation) {
      if (!this.isValid(scalar))
        throw new Error("invalid field element: outside of range 0..ORDER");
    }
    return scalar;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(lst) {
    return FpInvertBatch2(this, lst, true);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(a, b, condition) {
    abool3(condition, "condition");
    return condition ? b : a;
  }
};
function Field2(ORDER, opts = {}) {
  Object.freeze(_Field2.prototype);
  return new _Field2(ORDER, opts);
}
function getFieldBytesLength2(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  if (fieldOrder <= _1n7)
    throw new Error("field order must be greater than 1");
  const bitLength = bitLen2(fieldOrder - _1n7);
  return Math.ceil(bitLength / 8);
}
function getMinHashLength2(fieldOrder) {
  const length = getFieldBytesLength2(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField2(key, fieldOrder, isLE2 = false) {
  abytes5(key);
  const len = key.length;
  const fieldLen = getFieldBytesLength2(fieldOrder);
  const minLen = Math.max(getMinHashLength2(fieldOrder), 16);
  if (len < minLen || len > 1024)
    throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
  const num = isLE2 ? bytesToNumberLE2(key) : bytesToNumberBE2(key);
  const reduced = mod2(num, fieldOrder - _1n7) + _1n7;
  return isLE2 ? numberToBytesLE2(reduced, fieldLen) : numberToBytesBE2(reduced, fieldLen);
}

// node_modules/@toruslabs/eccrypto/node_modules/@noble/curves/abstract/curve.js
var _0n9 = /* @__PURE__ */ BigInt(0);
var _1n8 = /* @__PURE__ */ BigInt(1);
var _4n5 = /* @__PURE__ */ BigInt(4);
var BLIND_BYTES2 = 16;
var BLIND_BITS2 = 128;
var FW_WINDOW2 = 5;
var TABLE_BYTES_MAX2 = /* @__PURE__ */ (() => 2 ** 31)();
function validatePointCons2(Point) {
  const pc = Point;
  if (typeof pc !== "function")
    throw new TypeError('"Point" expected constructor, got type=' + typeof Point);
  afunction2(pc.fromAffine, "Point.fromAffine");
  afunction2(pc.fromBytes, "Point.fromBytes");
  afunction2(pc.fromHex, "Point.fromHex");
  aobject4(pc.BASE, "Point.BASE");
  aobject4(pc.ZERO, "Point.ZERO");
  validateField2(pc.Fp);
  validateField2(pc.Fn);
}
function normalizeZ2(c, points) {
  validatePointCons2(c);
  validateMSMPoints2(points, c);
  const invertedZs = FpInvertBatch2(c.Fp, points.map((p) => p.Z));
  return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW2(W, bits, min = 1) {
  if (!Number.isSafeInteger(W) || W < min || W > bits)
    throw new Error("invalid window size, expected [" + min + ".." + bits + "], got W=" + W);
}
function validateTableBytes2(numPoints, fpBytes) {
  const bytes = numPoints * (4 * fpBytes + 128);
  if (bytes > TABLE_BYTES_MAX2)
    throw new Error("invalid window size: table would need ~" + Math.ceil(bytes / 2 ** 20) + " MiB, max " + TABLE_BYTES_MAX2 / 2 ** 20 + " MiB");
}
function probeRandomBytes2(randomBytes6, length) {
  if (randomBytes6 === void 0)
    return void 0;
  afunction2(randomBytes6, "randomBytes");
  try {
    const probe = randomBytes6(length);
    if (!isBytes6(probe) || probe.length !== length)
      return void 0;
  } catch {
    return void 0;
  }
  return randomBytes6;
}
function validateMSMPoints2(points, c) {
  aarray2(points, "points");
  points.forEach((p, i) => {
    if (!(p instanceof c))
      throw new Error("invalid point at index " + i);
  });
}
function validateMSMScalars2(scalars, field, maxScalar) {
  if (!Array.isArray(scalars))
    throw new Error("array of scalars expected");
  scalars.forEach((s, i) => {
    const ok = maxScalar === void 0 ? field.isValid(s) : isPosBig2(s) && s < maxScalar;
    if (!ok)
      throw new Error("invalid scalar at index " + i);
  });
}
var pointWindowSizes2 = /* @__PURE__ */ new WeakMap();
function getWindowSize2(P) {
  return pointWindowSizes2.get(P) || 1;
}
function oddMultiples2(p, size) {
  const dbl = p.double();
  const t = [p];
  for (let j = 1; j < size; j++)
    t.push(t[j - 1].add(dbl));
  return t;
}
function wnafDigits2(n, W) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const d = [];
  while (n > _0n9) {
    let w = 0;
    if (n & _1n8) {
      w = Number(n & mask);
      if (w >= half)
        w -= size;
      n -= BigInt(w);
    }
    d.push(w);
    n >>= _1n8;
  }
  return d;
}
function signedWindowDigits2(n, W, windows) {
  const size = 2 ** W;
  const half = size / 2;
  const mask = BigInt(size - 1);
  const shiftBy = BigInt(W);
  const d = [];
  for (let w = 0; w < windows; w++) {
    let v = Number(n & mask);
    n >>= shiftBy;
    if (v > half) {
      v -= size;
      n += _1n8;
    }
    d.push(v);
  }
  if (n !== _0n9)
    throw new Error("invalid wnaf");
  return d;
}
function wnafWalk2(zero, tables, digits) {
  let max = 0;
  for (const d of digits)
    max = Math.max(max, d.length);
  let acc = zero;
  for (let bit = max - 1; bit >= 0; bit--) {
    if (bit !== max - 1)
      acc = acc.double();
    for (let i = 0; i < digits.length; i++) {
      const w = digits[i][bit];
      if (w) {
        const item = tables[i][Math.abs(w) - 1 >> 1];
        acc = acc.add(w < 0 ? item.negate() : item);
      }
    }
  }
  return acc;
}
var ScalarMultiplier2 = class {
  Point;
  BASE;
  ZERO;
  randomBytes;
  wnafPrecomputes = /* @__PURE__ */ new WeakMap();
  baseCanBeBlinded;
  bits;
  // Parametrized with a given Point class (not individual point)
  constructor(Point, randomBytes6) {
    validatePointCons2(Point);
    this.randomBytes = probeRandomBytes2(randomBytes6, BLIND_BYTES2);
    this.Point = Point;
    this.BASE = Point.BASE;
    this.ZERO = Point.ZERO;
    this.bits = Point.Fn.BITS;
  }
  /**
   * Creates a signed fixed-window wNAF precomputation table: for every window w, the
   * multiples `[1..2^(W−1)]⋅2^(w⋅W)⋅P`, flattened. All doublings are baked into the table,
   * so cached multiplication is additions-only. `windows = ceil(bits/W) + 1`: the extra
   * window absorbs the final carry of signed-digit recoding.
   * For a 256-bit curve and W=6, the table is 44⋅32 = 1408 points.
   * @param point - Point instance
   * @param W - window size
   * @param bits - scalar bitlength the table must cover
   */
  buildWnafTable(point, W, bits) {
    const windows = Math.ceil(bits / W) + 1;
    const half = 2 ** (W - 1);
    const comp = [];
    let base = point;
    for (let w = 0; w < windows; w++) {
      let acc = base;
      for (let i = 0; i < half; i++) {
        comp.push(acc);
        acc = acc.add(base);
      }
      base = comp[comp.length - 1].double();
    }
    return { W, bits, windows, comp };
  }
  /**
   * Implements ec multiplication using precomputed signed fixed-window wNAF tables.
   * Constant-time: fixed window count with one table addition per window — zero digits feed
   * the fake accumulator — and no doublings; the lookup scans the whole window slice.
   * Scalar bounds are validated by the public entry points ({@link ScalarMultiplier.mulCT},
   * {@link ScalarMultiplier.mulCTBlinded}, {@link ScalarMultiplier.mulUnsafe});
   * signedWindowDigits throws if `n` exceeds the table.
   * @returns real and fake (for const-time) points
   */
  wnafCachedCT(precomputes, n) {
    const { W, windows, comp } = precomputes;
    const half = 2 ** (W - 1);
    const digits = signedWindowDigits2(n, W, windows);
    let p = this.ZERO;
    let f = this.BASE;
    for (let w = 0; w < windows; w++) {
      const digit = digits[w];
      const start = w * half;
      const idx = Math.abs(digit) - 1;
      let sel = comp[start];
      for (let i = 1; i < half; i++)
        sel = i === idx ? comp[start + i] : sel;
      const neg = sel.negate();
      if (digit === 0)
        f = f.add(comp[start]);
      else
        p = p.add(digit < 0 ? neg : sel);
    }
    return { p, f };
  }
  // Cache key is point identity plus (W, bits); at most two entries exist per point (public-width
  // `Fn.BITS` and blinded `Fn.BITS + BLIND_BITS`). Callers must not reuse the same point with
  // incompatible `transform(...)` layouts and expect a separate cache entry.
  getWnafPrecomputes(W, point, bits, transform) {
    let entries = this.wnafPrecomputes.get(point);
    let comp = entries?.find((entry) => entry.W === W && entry.bits === bits);
    if (!comp) {
      comp = this.buildWnafTable(point, W, bits);
      if (typeof transform === "function")
        comp = { ...comp, comp: transform(comp.comp) };
      if (!entries) {
        entries = [];
        this.wnafPrecomputes.set(point, entries);
      }
      entries.push(comp);
    }
    return comp;
  }
  assertPoint(point) {
    if (!(point instanceof this.Point))
      throw new TypeError('"point" expected Point instance, got type=' + typeof point);
  }
  // Shared prologue of the constant-time entry points. Rejects scalar 0: in key/signature-style
  // callers a zero scalar means broken upstream plumbing, and concrete Points already reject it.
  // Uses inRange instead of Fn.isValidNot0: validateField() only certifies the arithmetic subset.
  validateMulInput(point, scalar) {
    this.assertPoint(point);
    if (!inRange2(scalar, _1n8, this.Point.Fn.ORDER))
      throw new Error("invalid scalar");
  }
  // Constant-time dispatch shared by mulCT / mulCTBlinded. Un-precomputed points (W===1, e.g.
  // ECDH peer keys) skip building a throwaway cached table in favor of a small fixed-window
  // multiply. `n` must be < 2^bits.
  runCT(point, n, bits, transform) {
    const W = getWindowSize2(point);
    if (W === 1)
      return this.fixedWindowCT(point, n, bits);
    return this.wnafCachedCT(this.getWnafPrecomputes(W, point, bits, transform), n);
  }
  mulCT(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    return this.runCT(point, scalar, this.bits, transform);
  }
  mulCTBlinded(point, scalar, transform) {
    this.validateMulInput(point, scalar);
    if (this.randomBytes === void 0)
      throw new Error("randomBytes is required for scalar blinding");
    const bits = this.Point.Fn.BITS + BLIND_BITS2;
    const blind = this.randomBytes(BLIND_BYTES2);
    if (!isBytes6(blind) || blind.length !== BLIND_BYTES2)
      throw new Error("randomBytes returned invalid byte array");
    blind[0] = blind[0] & 63 | 128;
    const n = scalar + bytesToNumberBE2(blind) * this.Point.Fn.ORDER;
    return this.runCT(point, n, bits, transform);
  }
  /**
   * Constant-time multiplication `n*point` for an un-precomputed point, via a small fixed window.
   * A cached wNAF table only pays off when reused; a flat 2^FW_WINDOW table (`size-1` adds) is
   * far cheaper to build for a single use. The point-operation sequence is independent of `n`:
   * build the table, then per window exactly FW_WINDOW doublings, a data-oblivious scan over
   * every table entry, and one addition (adds the identity when the window digit is 0 — never
   * skipped).
   *
   * `n` must be `< 2^bits`. Assumes complete addition (adding the identity costs the same as any
   * add), which holds for the Weierstrass/Edwards point types used here. The table is left in
   * projective form (no normalizeZ): normalizing this small a table costs more than the
   * mixed-add savings it would buy for a single multiply.
   * @returns real point `p`; `f` duplicates it only to match {@link wnafCachedCT}'s return shape
   * (this path needs no fake accumulator — its op-count is already scalar-independent).
   */
  fixedWindowCT(point, n, bits) {
    const W = FW_WINDOW2;
    const size = 1 << W;
    const mask = bitMask2(W);
    const table = new Array(size);
    table[0] = this.ZERO;
    for (let i = 1; i < size; i++)
      table[i] = table[i - 1].add(point);
    const windows = Math.ceil(bits / W);
    let acc = this.ZERO;
    for (let window2 = windows - 1; window2 >= 0; window2--) {
      if (window2 !== windows - 1)
        for (let d = 0; d < W; d++)
          acc = acc.double();
      const digit = Number(n >> BigInt(window2 * W) & mask);
      let sel = table[0];
      for (let i = 1; i < size; i++)
        sel = i === digit ? table[i] : sel;
      acc = acc.add(sel);
    }
    return { p: acc, f: acc };
  }
  shouldBlind(point, cofactor) {
    if (this.randomBytes === void 0)
      return false;
    if (cofactor === _1n8)
      return true;
    if (point !== this.BASE)
      return false;
    if (this.baseCanBeBlinded === void 0)
      this.baseCanBeBlinded = this.mulUnsafe(this.BASE, this.Point.Fn.ORDER).is0();
    return this.baseCanBeBlinded;
  }
  mulSecret(point, scalar, cofactor, transform) {
    return this.shouldBlind(point, cofactor) ? this.mulCTBlinded(point, scalar, transform) : this.mulCT(point, scalar, transform);
  }
  mulUnsafe(point, scalar, transform) {
    this.assertPoint(point);
    if (!isPosBig2(scalar))
      throw new Error("invalid scalar");
    const W = getWindowSize2(point);
    if (W === 1 || scalar >= this.Point.Fn.ORDER)
      return mulAddUnsafe2(this.Point, [point], [scalar], true);
    const precomputes = this.getWnafPrecomputes(W, point, this.bits, transform);
    return this.wnafCachedCT(precomputes, scalar).p;
  }
  // Remembers the window size used for precomputed wNAF multiplication of the given point
  // and drops any previously built tables. Usually only the base point is precomputed.
  // W=1 resets the point to the un-precomputed (table-less) paths.
  // W is additionally capped so tables stay under ~2 GiB ({@link TABLE_BYTES_MAX}).
  setWindowSize(point, W) {
    this.assertPoint(point);
    validateW2(W, this.bits);
    const windows = Math.ceil((this.bits + BLIND_BITS2) / W) + 1;
    validateTableBytes2(windows * 2 ** (W - 1), this.Point.Fp.BYTES);
    pointWindowSizes2.set(point, W);
    this.wnafPrecomputes.delete(point);
  }
  // True when a window size is set: tables themselves are built lazily on first multiply.
  hasWindowSize(point) {
    return getWindowSize2(point) !== 1;
  }
};
function mulAddUnsafe2(c, points, scalars, allowOversized = false) {
  validatePointCons2(c);
  validateMSMPoints2(points, c);
  abool3(allowOversized, "allowOversized");
  validateMSMScalars2(scalars, c.Fn, allowOversized ? c.Fn.ORDER ** _4n5 : void 0);
  if (points.length !== scalars.length)
    throw new Error("arrays of points and scalars must have equal length");
  const tables = points.map((p) => oddMultiples2(p, 4));
  const digits = scalars.map((n) => wnafDigits2(n, 4));
  return wnafWalk2(c.ZERO, tables, digits);
}
function createField2(order, field, isLE2) {
  if (field) {
    if (field.ORDER !== order)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    validateField2(field);
    return field;
  } else {
    return Field2(order, { isLE: isLE2 });
  }
}
function createCurveFields2(type, CURVE, curveOpts = {}, FpFnLE) {
  if (type !== "weierstrass" && type !== "edwards")
    throw new Error('expected curve type "weierstrass" or "edwards"');
  if (FpFnLE === void 0)
    FpFnLE = type === "edwards";
  if (!CURVE || typeof CURVE !== "object")
    throw new Error(`expected valid ${type} CURVE object`);
  validateObject2(curveOpts);
  for (const p of ["p", "n", "h"]) {
    const val = CURVE[p];
    if (!(isPosBig2(val) && val !== _0n9))
      throw new Error(`CURVE.${p} must be positive bigint`);
  }
  const Fp = createField2(CURVE.p, curveOpts.Fp, FpFnLE);
  const Fn = createField2(CURVE.n, curveOpts.Fn, FpFnLE);
  const _b = type === "weierstrass" ? "b" : "d";
  const params = ["Gx", "Gy", "a", _b];
  for (const p of params) {
    if (!Fp.isValid(CURVE[p]))
      throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
  }
  CURVE = Object.freeze(Object.assign({}, CURVE));
  return { CURVE, Fp, Fn };
}
function createKeygen2(randomSecretKey, getPublicKey) {
  return function keygen(seed) {
    const secretKey = randomSecretKey(seed);
    return { secretKey, publicKey: getPublicKey(secretKey) };
  };
}

// node_modules/@toruslabs/eccrypto/node_modules/@noble/hashes/hmac.js
var _HMAC2 = class {
  oHash;
  iHash;
  blockLen;
  outputLen;
  canXOF = false;
  finished = false;
  destroyed = false;
  constructor(hash, key) {
    ahash2(hash);
    abytes4(key, void 0, "key");
    this.iHash = hash.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("expected Hash instance");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    clean2(pad);
  }
  update(buf) {
    aexists2(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    aexists2(this);
    aoutput2(out, this);
    this.finished = true;
    const buf = out.subarray(0, this.outputLen);
    this.iHash.digestInto(buf);
    this.oHash.update(buf);
    this.oHash.digestInto(buf);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to ||= Object.create(Object.getPrototypeOf(this), {});
    const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.canXOF = canXOF;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac2 = /* @__PURE__ */ (() => {
  const hmac_ = ((hash, key, message) => new _HMAC2(hash, key).update(message).digest());
  hmac_.create = (hash, key) => new _HMAC2(hash, key);
  return hmac_;
})();

// node_modules/@toruslabs/eccrypto/node_modules/@noble/curves/abstract/der.js
var _0n10 = /* @__PURE__ */ BigInt(0);
var DERErr2 = class extends Error {
  constructor(m = "") {
    super(m);
  }
};
var _DER2 = {
  // asn.1 DER encoding utils
  Err: DERErr2,
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (tag, data) => {
      const { Err: E } = _DER2;
      asafenumber2(tag, "tag");
      if (tag < 0 || tag > 255)
        throw new E("tlv.encode: wrong tag");
      astring2(data, "data");
      if (data.length & 1)
        throw new E("tlv.encode: unpadded data");
      const dataLen = data.length / 2;
      const len = numberToHexUnpadded2(dataLen);
      if (len.length / 2 & 128)
        throw new E("tlv.encode: long form length too big");
      const lenLen = dataLen > 127 ? numberToHexUnpadded2(len.length / 2 | 128) : "";
      const t = numberToHexUnpadded2(tag);
      return t + lenLen + len + data;
    },
    // v - value, l - left bytes (unparsed)
    decode(tag, data) {
      const { Err: E } = _DER2;
      data = abytes5(data, void 0, "DER data");
      let pos = 0;
      if (tag < 0 || tag > 255)
        throw new E("tlv.decode: wrong tag");
      if (data.length < 2 || data[pos++] !== tag)
        throw new E("tlv.decode: wrong tlv");
      const first = data[pos++];
      const isLong = !!(first & 128);
      let length = 0;
      if (!isLong)
        length = first;
      else {
        const lenLen = first & 127;
        if (!lenLen)
          throw new E("tlv.decode(long): indefinite length not supported");
        if (lenLen > 4)
          throw new E("tlv.decode(long): byte length is too big");
        const lengthBytes = data.subarray(pos, pos + lenLen);
        if (lengthBytes.length !== lenLen)
          throw new E("tlv.decode: length bytes not complete");
        if (lengthBytes[0] === 0)
          throw new E("tlv.decode(long): zero leftmost byte");
        for (const b of lengthBytes)
          length = length << 8 | b;
        pos += lenLen;
        if (length < 128)
          throw new E("tlv.decode(long): not minimal encoding");
      }
      const v = data.subarray(pos, pos + length);
      if (v.length !== length)
        throw new E("tlv.decode: wrong value length");
      return { v, l: data.subarray(pos + length) };
    }
  },
  // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
  // since we always use positive integers here. It must always be empty:
  // - add zero byte if exists
  // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
  _int: {
    encode(num) {
      const { Err: E } = _DER2;
      abignumber2(num);
      if (num < _0n10)
        throw new E("integer: negative integers are not allowed");
      let hex = numberToHexUnpadded2(num);
      if (Number.parseInt(hex[0], 16) & 8)
        hex = "00" + hex;
      if (hex.length & 1)
        throw new E("unexpected DER parsing assertion: unpadded hex");
      return hex;
    },
    decode(data) {
      const { Err: E } = _DER2;
      if (data.length < 1)
        throw new E("invalid signature integer: empty");
      if (data[0] & 128)
        throw new E("invalid signature integer: negative");
      if (data.length > 1 && data[0] === 0 && !(data[1] & 128))
        throw new E("invalid signature integer: unnecessary leading zero");
      return bytesToNumberBE2(data);
    }
  },
  toSig(bytes, maxScalarBytes) {
    const { Err: E, _int: int, _tlv: tlv } = _DER2;
    if (maxScalarBytes !== void 0) {
      asafenumber2(maxScalarBytes, "maxScalarBytes");
      if (maxScalarBytes < 1)
        throw new E("invalid signature: maxScalarBytes must be positive");
    }
    const data = abytes5(bytes, void 0, "signature");
    const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
    if (seqLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
    const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
    if (sLeftBytes.length)
      throw new E("invalid signature: left bytes after parsing");
    if (maxScalarBytes !== void 0 && (rBytes.length > maxScalarBytes || sBytes.length > maxScalarBytes))
      throw new E("invalid signature: integer too large");
    return { r: int.decode(rBytes), s: int.decode(sBytes) };
  },
  hexFromSig(sig) {
    const { _tlv: tlv, _int: int } = _DER2;
    validateObject2(sig, { r: "bigint", s: "bigint" }, {}, "sig");
    const rs = tlv.encode(2, int.encode(sig.r));
    const ss = tlv.encode(2, int.encode(sig.s));
    const seq = rs + ss;
    return tlv.encode(48, seq);
  }
};
var DER2 = /* @__PURE__ */ (() => {
  Object.freeze(_DER2._tlv);
  Object.freeze(_DER2._int);
  return Object.freeze(_DER2);
})();

// node_modules/@toruslabs/eccrypto/node_modules/@noble/curves/abstract/weierstrass.js
var divNearest2 = (num, den) => (num + (num >= 0 ? den : -den) / _2n6) / den;
function _splitEndoScalar2(k, basis, n) {
  aInRange2("scalar", k, _0n11, n);
  const [[a1, b1], [a2, b2]] = basis;
  const c1 = divNearest2(b2 * k, n);
  const c2 = divNearest2(-b1 * k, n);
  let k1 = k - c1 * a1 - c2 * a2;
  let k2 = -c1 * b1 - c2 * b2;
  const k1neg = k1 < _0n11;
  const k2neg = k2 < _0n11;
  if (k1neg)
    k1 = -k1;
  if (k2neg)
    k2 = -k2;
  const MAX_NUM = bitMask2(Math.ceil(bitLen2(n) / 2)) + _1n9;
  if (k1 < _0n11 || k1 >= MAX_NUM || k2 < _0n11 || k2 >= MAX_NUM) {
    throw new Error("splitScalar (endomorphism): failed for k");
  }
  return { k1neg, k1, k2neg, k2 };
}
function validateSigFormat2(format) {
  if (!["compact", "recovered", "der"].includes(format))
    throw new Error('Signature format must be "compact", "recovered", or "der"');
  return format;
}
function validateSigOpts2(opts, def) {
  validateObject2(opts);
  const optsn = {};
  for (let optName of Object.keys(def)) {
    optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
  }
  abool3(optsn.lowS, "lowS");
  abool3(optsn.prehash, "prehash");
  if (optsn.format !== void 0)
    validateSigFormat2(optsn.format);
  return optsn;
}
var _0n11 = /* @__PURE__ */ BigInt(0);
var _1n9 = /* @__PURE__ */ BigInt(1);
var _2n6 = /* @__PURE__ */ BigInt(2);
var _3n4 = /* @__PURE__ */ BigInt(3);
var _4n6 = /* @__PURE__ */ BigInt(4);
function weierstrass2(params, extraOpts = {}) {
  const validated = createCurveFields2("weierstrass", params, extraOpts);
  const Fp = validated.Fp;
  const Fn = validated.Fn;
  let CURVE = validated.CURVE;
  const { h: cofactor, n: CURVE_ORDER } = CURVE;
  validateObject2(extraOpts, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object",
    randomBytes: "function"
  });
  const { endo: endoOpts, allowInfinityPoint, clearCofactor, isTorsionFree, fromBytes, toBytes } = extraOpts;
  const randomBytes6 = extraOpts.randomBytes === void 0 ? randomBytes4 : extraOpts.randomBytes;
  if (endoOpts) {
    if (!Fp.is0(CURVE.a) || typeof endoOpts.beta !== "bigint" || !Array.isArray(endoOpts.basises)) {
      throw new Error('invalid endo: expected "beta": bigint and "basises": array');
    }
  }
  const endo = endoOpts ? {
    beta: endoOpts.beta,
    basises: endoOpts.basises.map((basis) => [...basis])
  } : void 0;
  const lengths = getWLengths2(Fp, Fn);
  function assertCompressionIsSupported() {
    if (!Fp.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function pointToBytes(_c, point, isCompressed) {
    if (point.is0()) {
      if (!allowInfinityPoint)
        throw new Error("bad point: ZERO");
      return Uint8Array.of(0);
    }
    const { x, y } = point.toAffine();
    const bx = Fp.toBytes(x);
    abool3(isCompressed, "isCompressed");
    if (isCompressed) {
      assertCompressionIsSupported();
      const hasEvenY = !Fp.isOdd(y);
      return concatBytes4(pprefix2(hasEvenY), bx);
    } else {
      return concatBytes4(Uint8Array.of(4), bx, Fp.toBytes(y));
    }
  }
  function pointFromBytes(bytes) {
    abytes5(bytes, void 0, "Point");
    const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
    const length = bytes.length;
    const head = bytes[0];
    const tail = bytes.subarray(1);
    if (allowInfinityPoint && length === 1 && head === 0)
      return { x: Fp.ZERO, y: Fp.ZERO };
    if (length === comp && (head === 2 || head === 3)) {
      const x = Fp.fromBytes(tail);
      if (!Fp.isValid(x))
        throw new Error("bad point: is not on curve, wrong x");
      const y2 = weierstrassEquation(x);
      let y;
      try {
        y = Fp.sqrt(y2);
      } catch (sqrtError) {
        const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + err);
      }
      assertCompressionIsSupported();
      const evenY = Fp.isOdd(y);
      const evenH = (head & 1) === 1;
      if (evenH !== evenY)
        y = Fp.neg(y);
      return { x, y };
    } else if (length === uncomp && head === 4) {
      const L = Fp.BYTES;
      const x = Fp.fromBytes(tail.subarray(0, L));
      const y = Fp.fromBytes(tail.subarray(L, L * 2));
      if (!isValidXY(x, y))
        throw new Error("bad point: is not on curve");
      return { x, y };
    } else {
      throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
    }
  }
  const encodePoint = toBytes === void 0 ? pointToBytes : toBytes;
  const decodePoint = fromBytes === void 0 ? pointFromBytes : fromBytes;
  const b3 = Fp.mul(CURVE.b, _3n4);
  const mulA = Fp.is0(CURVE.a) ? (_) => Fp.ZERO : (x) => Fp.mul(CURVE.a, x);
  function weierstrassEquation(x) {
    const x2 = Fp.sqr(x);
    const x3 = Fp.mul(x2, x);
    return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
  }
  function isValidXY(x, y) {
    const left = Fp.sqr(y);
    const right = weierstrassEquation(x);
    return Fp.eql(left, right);
  }
  if (!isValidXY(CURVE.Gx, CURVE.Gy))
    throw new Error("bad curve params: generator point");
  const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n4), _4n6);
  const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
  if (Fp.is0(Fp.add(_4a3, _27b2)))
    throw new Error("bad curve params: a or b");
  function acoord(title, n, banZero = false) {
    if (!Fp.isValid(n) || banZero && Fp.is0(n))
      throw new Error(`bad point coordinate ${title}`);
    return typeof n === "object" && n !== null ? Fp.create(n) : n;
  }
  function aprjpoint(other) {
    if (!(other instanceof Point))
      throw new Error("Weierstrass Point expected");
  }
  function splitEndoScalarN(k) {
    if (!endo || !endo.basises)
      throw new Error("no endo");
    return _splitEndoScalar2(k, endo.basises, Fn.ORDER);
  }
  function pushWnafPair(points, scalars, p, k) {
    if (!Fn.isValid(k))
      throw new RangeError("invalid scalar: out of range");
    if (endo) {
      const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(k);
      const psi = new Point(Fp.mul(p.X, endo.beta), p.Y, p.Z);
      points.push(k1neg ? p.negate() : p, k2neg ? psi.negate() : psi);
      scalars.push(k1, k2);
    } else {
      points.push(p);
      scalars.push(k);
    }
  }
  const validityCache = /* @__PURE__ */ new WeakSet();
  class Point {
    static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
    static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
    static Fp = Fp;
    static Fn = Fn;
    X;
    Y;
    Z;
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    constructor(X, Y, Z) {
      this.X = acoord("x", X);
      this.Y = acoord("y", Y, true);
      this.Z = acoord("z", Z);
      Object.freeze(this);
    }
    static CURVE() {
      return CURVE;
    }
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point)
        throw new Error("projective point not allowed");
      if (Fp.is0(x) && Fp.is0(y))
        return Point.ZERO;
      return new Point(x, y, Fp.ONE);
    }
    static fromBytes(bytes) {
      const P = Point.fromAffine(decodePoint(abytes5(bytes, void 0, "point")));
      P.assertValidity();
      return P;
    }
    static fromHex(hex) {
      return Point.fromBytes(hexToBytes5(hex));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     * @param isLazy - true will defer table computation until the first multiplication
     */
    precompute(windowSize = 6, isLazy = true) {
      wnaf.setWindowSize(this, windowSize);
      if (!isLazy)
        this.multiply(_3n4);
      return this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      const p = this;
      if (p.is0()) {
        if (allowInfinityPoint && Fp.is0(p.X) && Fp.eql(p.Y, Fp.ONE) && Fp.is0(p.Z))
          return;
        throw new Error("bad point: ZERO");
      }
      if (validityCache.has(p))
        return;
      const { x, y } = p.toAffine();
      if (!Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("bad point: x or y not field elements");
      if (!isValidXY(x, y))
        throw new Error("bad point: equation left != right");
      if (!p.isTorsionFree())
        throw new Error("bad point: not in prime-order subgroup");
      validityCache.add(p);
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (!Fp.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !Fp.isOdd(y);
    }
    /** Compare one point to another. */
    equals(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
      const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
      return U1 && U2;
    }
    /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
    negate() {
      return new Point(this.X, Fp.neg(this.Y), this.Z);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { X: X1, Y: Y1, Z: Z1 } = this;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X1);
      let t1 = Fp.mul(Y1, Y1);
      let t2 = Fp.mul(Z1, Z1);
      let t3 = Fp.mul(X1, Y1);
      t3 = Fp.add(t3, t3);
      Z3 = Fp.mul(X1, Z1);
      Z3 = Fp.add(Z3, Z3);
      X3 = mulA(Z3);
      Y3 = Fp.mul(b3, t2);
      Y3 = Fp.add(X3, Y3);
      X3 = Fp.sub(t1, Y3);
      Y3 = Fp.add(t1, Y3);
      Y3 = Fp.mul(X3, Y3);
      X3 = Fp.mul(t3, X3);
      Z3 = Fp.mul(b3, Z3);
      t2 = mulA(t2);
      t3 = Fp.sub(t0, t2);
      t3 = mulA(t3);
      t3 = Fp.add(t3, Z3);
      Z3 = Fp.add(t0, t0);
      t0 = Fp.add(Z3, t0);
      t0 = Fp.add(t0, t2);
      t0 = Fp.mul(t0, t3);
      Y3 = Fp.add(Y3, t0);
      t2 = Fp.mul(Y1, Z1);
      t2 = Fp.add(t2, t2);
      t0 = Fp.mul(t2, t3);
      X3 = Fp.sub(X3, t0);
      Z3 = Fp.mul(t2, t1);
      Z3 = Fp.add(Z3, Z3);
      Z3 = Fp.add(Z3, Z3);
      return new Point(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      aprjpoint(other);
      const { X: X1, Y: Y1, Z: Z1 } = this;
      const { X: X2, Y: Y2, Z: Z2 } = other;
      let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
      let t0 = Fp.mul(X1, X2);
      let t1 = Fp.mul(Y1, Y2);
      let t2 = Fp.mul(Z1, Z2);
      let t3 = Fp.add(X1, Y1);
      let t4 = Fp.add(X2, Y2);
      t3 = Fp.mul(t3, t4);
      t4 = Fp.add(t0, t1);
      t3 = Fp.sub(t3, t4);
      t4 = Fp.add(X1, Z1);
      let t5 = Fp.add(X2, Z2);
      t4 = Fp.mul(t4, t5);
      t5 = Fp.add(t0, t2);
      t4 = Fp.sub(t4, t5);
      t5 = Fp.add(Y1, Z1);
      X3 = Fp.add(Y2, Z2);
      t5 = Fp.mul(t5, X3);
      X3 = Fp.add(t1, t2);
      t5 = Fp.sub(t5, X3);
      Z3 = mulA(t4);
      X3 = Fp.mul(b3, t2);
      Z3 = Fp.add(X3, Z3);
      X3 = Fp.sub(t1, Z3);
      Z3 = Fp.add(t1, Z3);
      Y3 = Fp.mul(X3, Z3);
      t1 = Fp.add(t0, t0);
      t1 = Fp.add(t1, t0);
      t2 = mulA(t2);
      t4 = Fp.mul(b3, t4);
      t1 = Fp.add(t1, t2);
      t2 = Fp.sub(t0, t2);
      t2 = mulA(t2);
      t4 = Fp.add(t4, t2);
      t0 = Fp.mul(t1, t4);
      Y3 = Fp.add(Y3, t0);
      t0 = Fp.mul(t5, t4);
      X3 = Fp.mul(t3, X3);
      X3 = Fp.sub(X3, t0);
      t0 = Fp.mul(t3, t1);
      Z3 = Fp.mul(t5, Z3);
      Z3 = Fp.add(Z3, t0);
      return new Point(X3, Y3, Z3);
    }
    subtract(other) {
      aprjpoint(other);
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point.ZERO);
    }
    /**
     * Constant time multiplication.
     * Uses precomputed tables (signed fixed-window wNAF) when available.
     * Uses scalar blinding and avoids endomorphism splitting in the secret-scalar path.
     * @param scalar - by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      if (!Fn.isValidNot0(scalar))
        throw new RangeError("invalid scalar: out of range");
      const { p, f } = wnaf.mulSecret(this, scalar, cofactor, normalize);
      return normalize([p, f])[0];
    }
    /**
     * Non-constant-time multiplication. Uses width-4 wNAF with GLV endomorphism splitting
     * when available (two half-width scalars sharing one halved doubling chain).
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(scalar) {
      const p = this;
      const sc = scalar;
      if (!Fn.isValid(sc))
        throw new RangeError("invalid scalar: out of range");
      if (sc === _0n11 || p.is0())
        return Point.ZERO;
      if (sc === _1n9)
        return p;
      if (wnaf.hasWindowSize(this))
        return wnaf.mulUnsafe(p, sc, normalize);
      const points = [];
      const scalars = [];
      pushWnafPair(points, scalars, p, sc);
      return mulAddUnsafe2(Point, points, scalars);
    }
    /**
     * Non-constant-time double-scalar multiplication `a⋅this + b⋅other` (Strauss–Shamir).
     * Both walks share one doubling chain via {@link mulAddUnsafe}, and GLV endomorphism
     * (when available) halves the chain again by splitting each scalar into two half-width
     * parts. Used by ECDSA verification and public-key recovery for `R = u1⋅G + u2⋅P`.
     * Only for public scalars.
     */
    mulAddUnsafe(a, other, b) {
      aprjpoint(other);
      const points = [];
      const scalars = [];
      pushWnafPair(points, scalars, this, a);
      pushWnafPair(points, scalars, other, b);
      return mulAddUnsafe2(Point, points, scalars);
    }
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * (X, Y, Z) ∋ (x=X/Z, y=Y/Z).
     * @param invertedZ - Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(invertedZ) {
      const p = this;
      let iz = invertedZ;
      if (iz != null && !Fp.isValid(iz))
        throw new RangeError('"invertedZ" expected valid field element');
      const { X, Y, Z } = p;
      if (Fp.eql(Z, Fp.ONE))
        return { x: X, y: Y };
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.ONE : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ZERO };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      if (cofactor === _1n9)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point, this);
      return wnaf.mulUnsafe(this, CURVE_ORDER).is0();
    }
    clearCofactor() {
      if (cofactor === _1n9)
        return this;
      if (clearCofactor)
        return clearCofactor(Point, this);
      return this.multiplyUnsafe(cofactor);
    }
    isSmallOrder() {
      if (cofactor === _1n9)
        return this.is0();
      return this.clearCofactor().is0();
    }
    toBytes(isCompressed = true) {
      abool3(isCompressed, "isCompressed");
      this.assertValidity();
      return encodePoint(Point, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex4(this.toBytes(isCompressed));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  }
  const normalize = (points) => normalizeZ2(Point, points);
  const wnaf = new ScalarMultiplier2(Point, randomBytes6);
  if (wnaf.bits >= 6)
    Point.BASE.precompute(6);
  Object.freeze(Point.prototype);
  Object.freeze(Point);
  return Point;
}
function pprefix2(hasEvenY) {
  return Uint8Array.of(hasEvenY ? 2 : 3);
}
function getWLengths2(Fp, Fn) {
  return {
    secretKey: Fn.BYTES,
    publicKey: 1 + Fp.BYTES,
    publicKeyUncompressed: 1 + 2 * Fp.BYTES,
    publicKeyHasPrefix: true,
    // Raw compact `(r || s)` signature width; DER and recovered signatures use
    // different lengths outside this helper.
    signature: 2 * Fn.BYTES
  };
}
function ecdh2(Point, ecdhOpts = {}) {
  validatePointCons2(Point);
  const { Fn } = Point;
  const randomBytes_ = ecdhOpts.randomBytes === void 0 ? randomBytes4 : ecdhOpts.randomBytes;
  const lengths = Object.assign(getWLengths2(Point.Fp, Fn), {
    seed: Math.max(getMinHashLength2(Fn.ORDER), 16)
  });
  function isValidSecretKey(secretKey) {
    try {
      const num = Fn.fromBytes(secretKey);
      return Fn.isValidNot0(num);
    } catch (error) {
      return false;
    }
  }
  function isValidPublicKey(publicKey, isCompressed) {
    const { publicKey: comp, publicKeyUncompressed } = lengths;
    try {
      const l = publicKey.length;
      if (isCompressed === true && l !== comp)
        return false;
      if (isCompressed === false && l !== publicKeyUncompressed)
        return false;
      return !Point.fromBytes(publicKey).is0();
    } catch (error) {
      return false;
    }
  }
  function randomSecretKey(seed) {
    seed = seed === void 0 ? randomBytes_(lengths.seed) : seed;
    return mapHashToField2(abytes5(seed, lengths.seed, "seed"), Fn.ORDER);
  }
  function getPublicKey(secretKey, isCompressed = true) {
    return Point.BASE.multiply(Fn.fromBytes(secretKey)).toBytes(isCompressed);
  }
  function isProbPub(item) {
    const { secretKey, publicKey, publicKeyUncompressed } = lengths;
    const allowedLengths = Fn._lengths;
    if (!isBytes6(item))
      return void 0;
    const l = abytes5(item, void 0, "key").length;
    const isPub = l === publicKey || l === publicKeyUncompressed;
    const isSec = l === secretKey || !!allowedLengths?.includes(l);
    if (isPub && isSec)
      return void 0;
    return isPub;
  }
  function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
    if (isProbPub(secretKeyA) === true)
      throw new Error("first arg must be private key");
    if (isProbPub(publicKeyB) === false)
      throw new Error("second arg must be public key");
    const s = Fn.fromBytes(secretKeyA);
    const b = Point.fromBytes(publicKeyB);
    if (b.is0())
      throw new Error("invalid public key: point at infinity");
    return b.multiply(s).toBytes(isCompressed);
  }
  const utils = {
    isValidSecretKey,
    isValidPublicKey,
    randomSecretKey
  };
  const keygen = createKeygen2(randomSecretKey, getPublicKey);
  Object.freeze(utils);
  Object.freeze(lengths);
  return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point, utils, lengths });
}
function ecdsa2(Point, hash, ecdsaOpts = {}) {
  validatePointCons2(Point);
  const hash_ = hash;
  ahash2(hash_);
  validateObject2(ecdsaOpts, {}, {
    hmac: "function",
    lowS: "boolean",
    randomBytes: "function",
    bits2int: "function",
    bits2int_modN: "function"
  });
  const opts = Object.assign({}, ecdsaOpts);
  const randomBytes6 = opts.randomBytes === void 0 ? randomBytes4 : opts.randomBytes;
  const hmac3 = opts.hmac === void 0 ? (key, msg) => hmac2(hash_, key, msg) : opts.hmac;
  const { Fp, Fn } = Point;
  const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
  const blindLength = getMinHashLength2(CURVE_ORDER);
  const csprng = probeRandomBytes2(randomBytes6, blindLength);
  const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh2(Point, opts);
  const defaultSigOpts = {
    prehash: true,
    lowS: typeof opts.lowS === "boolean" ? opts.lowS : true,
    format: "compact",
    extraEntropy: false
  };
  const hasLargeRecoveryLifts = CURVE_ORDER * _2n6 + _1n9 < Fp.ORDER;
  function isBiggerThanHalfOrder(number) {
    const HALF = CURVE_ORDER >> _1n9;
    return number > HALF;
  }
  function validateRS(title, num) {
    if (!Fn.isValidNot0(num))
      throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
    return num;
  }
  function assertFieldSignIsSupported() {
    if (!Fp.isOdd)
      throw new Error("Field doesn't support isOdd");
  }
  function getRecoveryBit(x, y, r) {
    assertFieldSignIsSupported();
    return (x === r ? 0 : 2) | Number(Fp.isOdd(y));
  }
  function assertRecoverableCurve() {
    if (hasLargeRecoveryLifts)
      throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
  }
  function validateSigLength(bytes, format) {
    validateSigFormat2(format);
    const size = lengths.signature;
    const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : void 0;
    return abytes5(bytes, sizer);
  }
  class Signature {
    r;
    s;
    recovery;
    constructor(r, s, recovery) {
      this.r = validateRS("r", r);
      this.s = validateRS("s", s);
      if (recovery != null) {
        assertRecoverableCurve();
        if (![0, 1, 2, 3].includes(recovery))
          throw new Error("invalid recovery id");
        this.recovery = recovery;
      }
      Object.freeze(this);
    }
    static fromBytes(bytes, format = defaultSigOpts.format) {
      validateSigLength(bytes, format);
      let recid;
      if (format === "der") {
        if (bytes.length > 2 * Fn.BYTES + 16)
          throw new DER2.Err("invalid signature: DER signature too long");
        const { r: r2, s: s2 } = DER2.toSig(abytes5(bytes), Fn.BYTES + 1);
        return new Signature(r2, s2);
      }
      if (format === "recovered") {
        recid = bytes[0];
        format = "compact";
        bytes = bytes.subarray(1);
      }
      const L = lengths.signature / 2;
      const r = bytes.subarray(0, L);
      const s = bytes.subarray(L, L * 2);
      return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
    }
    static fromHex(hex, format) {
      return this.fromBytes(hexToBytes5(hex), format);
    }
    assertRecovery() {
      const { recovery } = this;
      if (recovery == null)
        throw new Error("invalid recovery id: must be present");
      return recovery;
    }
    addRecoveryBit(recovery) {
      return new Signature(this.r, this.s, recovery);
    }
    // Unlike the top-level helper below, this method expects a digest that has
    // already been hashed to the curve's message representative.
    recoverPublicKey(messageHash) {
      const { r, s } = this;
      const recovery = this.assertRecovery();
      const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
      if (!Fp.isValid(radj))
        throw new Error("invalid recovery id: sig.r+curve.n != R.x");
      const x = Fp.toBytes(radj);
      const R = Point.fromBytes(concatBytes4(pprefix2((recovery & 1) === 0), x));
      const ir = Fn.inv(radj);
      const h = bits2int_modN(abytes5(messageHash, void 0, "msgHash"));
      const u1 = Fn.create(-h * ir);
      const u2 = Fn.create(s * ir);
      const Q = Point.BASE.mulAddUnsafe(u1, R, u2);
      if (Q.is0())
        throw new Error("invalid recovery: point at infinify");
      Q.assertValidity();
      return Q;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    toBytes(format = defaultSigOpts.format) {
      validateSigFormat2(format);
      if (format === "der")
        return hexToBytes5(DER2.hexFromSig(this));
      const { r, s } = this;
      const rb = Fn.toBytes(r);
      const sb = Fn.toBytes(s);
      if (format === "recovered") {
        assertRecoverableCurve();
        return concatBytes4(Uint8Array.of(this.assertRecovery()), rb, sb);
      }
      return concatBytes4(rb, sb);
    }
    toHex(format) {
      return bytesToHex4(this.toBytes(format));
    }
  }
  Object.freeze(Signature.prototype);
  Object.freeze(Signature);
  const bits2int = opts.bits2int === void 0 ? function bits2int_def(bytes) {
    if (bytes.length > 8192)
      throw new Error("input is too large");
    const num = bytesToNumberBE2(bytes);
    const delta = bytes.length * 8 - fnBits;
    return delta > 0 ? num >> BigInt(delta) : num;
  } : opts.bits2int;
  const bits2int_modN = opts.bits2int_modN === void 0 ? function bits2int_modN_def(bytes) {
    return Fn.create(bits2int(bytes));
  } : opts.bits2int_modN;
  const ORDER_MASK = bitMask2(fnBits);
  function int2octets(num) {
    aInRange2("num < 2^" + fnBits, num, _0n11, ORDER_MASK);
    return Fn.toBytes(num);
  }
  function validateMsgAndHash(message, prehash) {
    abytes5(message, void 0, "message");
    return prehash ? abytes5(hash_(message), void 0, "prehashed message") : message;
  }
  function prepSig(message, secretKey, opts2) {
    const { lowS, prehash, extraEntropy } = validateSigOpts2(opts2, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    const h1int = bits2int_modN(message);
    const d = Fn.fromBytes(secretKey);
    if (!Fn.isValidNot0(d))
      throw new Error("invalid private key");
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (extraEntropy != null && extraEntropy !== false) {
      const e = extraEntropy === true ? randomBytes6(lengths.secretKey) : extraEntropy;
      seedArgs.push(abytes5(e, void 0, "extraEntropy"));
    }
    const seed = concatBytes4(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int(kBytes);
      if (!Fn.isValidNot0(k))
        return;
      const q = Point.BASE.multiply(k).toAffine();
      const r = Fn.create(q.x);
      if (r === _0n11)
        return;
      let s;
      if (csprng !== void 0) {
        const b = bytesToNumberBE2(mapHashToField2(csprng(blindLength), CURVE_ORDER));
        const ibk = Fn.inv(Fn.mul(b, k));
        const bm = Fn.mul(b, m);
        const bd = Fn.mul(b, d);
        s = Fn.create(ibk * Fn.create(bm + bd * r));
      } else {
        const ik = invertCt2(k, CURVE_ORDER);
        s = Fn.create(ik * Fn.create(m + r * d));
      }
      if (s === _0n11)
        return;
      let recovery = getRecoveryBit(q.x, q.y, r);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = Fn.neg(s);
        recovery ^= 1;
      }
      return new Signature(r, normS, hasLargeRecoveryLifts ? void 0 : recovery);
    }
    return { seed, k2sig };
  }
  function sign2(message, secretKey, opts2 = {}) {
    const { seed, k2sig } = prepSig(message, secretKey, opts2);
    const drbg = createHmacDrbg2(hash_.outputLen, Fn.BYTES, hmac3);
    const sig = drbg(seed, k2sig);
    return sig.toBytes(opts2.format);
  }
  function verify(signature, message, publicKey, opts2 = {}) {
    const { lowS, prehash, format } = validateSigOpts2(opts2, defaultSigOpts);
    publicKey = abytes5(publicKey, void 0, "publicKey");
    message = validateMsgAndHash(message, prehash);
    if (!isBytes6(signature)) {
      const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
      throw new Error("verify expects Uint8Array signature" + end);
    }
    validateSigLength(signature, format);
    try {
      const sig = Signature.fromBytes(signature, format);
      const P = Point.fromBytes(publicKey);
      if (P.is0())
        return false;
      if (lowS && sig.hasHighS())
        return false;
      const { r, s } = sig;
      const h = bits2int_modN(message);
      const is = Fn.inv(s);
      const u1 = Fn.create(h * is);
      const u2 = Fn.create(r * is);
      const R = Point.BASE.mulAddUnsafe(u1, P, u2);
      if (R.is0())
        return false;
      const q = R.toAffine();
      const v = Fn.create(q.x);
      if (v !== r)
        return false;
      if (format === "recovered" && sig.recovery !== getRecoveryBit(q.x, q.y, r))
        return false;
      return true;
    } catch (e) {
      return false;
    }
  }
  function recoverPublicKey(signature, message, opts2 = {}) {
    const { prehash } = validateSigOpts2(opts2, defaultSigOpts);
    message = validateMsgAndHash(message, prehash);
    return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
  }
  return Object.freeze({
    keygen,
    getPublicKey,
    getSharedSecret,
    utils,
    lengths,
    Point,
    sign: sign2,
    verify,
    recoverPublicKey,
    Signature,
    hash: hash_
  });
}

// node_modules/@toruslabs/eccrypto/node_modules/@noble/curves/secp256k1.js
var secp256k1_CURVE2 = {
  p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
  n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
  h: BigInt(1),
  a: BigInt(0),
  b: BigInt(7),
  Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
  Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
};
var secp256k1_ENDO2 = {
  beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
  basises: [
    [BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],
    [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]
  ]
};
var _2n7 = /* @__PURE__ */ BigInt(2);
function sqrtMod2(y) {
  const P = secp256k1_CURVE2.p;
  const _3n5 = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
  const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
  const b2 = y * y * y % P;
  const b3 = b2 * b2 * y % P;
  const b6 = pow22(b3, _3n5, P) * b3 % P;
  const b9 = pow22(b6, _3n5, P) * b3 % P;
  const b11 = pow22(b9, _2n7, P) * b2 % P;
  const b22 = pow22(b11, _11n, P) * b11 % P;
  const b44 = pow22(b22, _22n, P) * b22 % P;
  const b88 = pow22(b44, _44n, P) * b44 % P;
  const b176 = pow22(b88, _88n, P) * b88 % P;
  const b220 = pow22(b176, _44n, P) * b44 % P;
  const b223 = pow22(b220, _3n5, P) * b3 % P;
  const t1 = pow22(b223, _23n, P) * b22 % P;
  const t2 = pow22(t1, _6n, P) * b2 % P;
  const root = pow22(t2, _2n7, P);
  if (!Fpk12.eql(Fpk12.sqr(root), y))
    throw new Error("Cannot find square root");
  return root;
}
var Fpk12 = /* @__PURE__ */ Field2(secp256k1_CURVE2.p, { sqrt: sqrtMod2 });
var Pointk12 = /* @__PURE__ */ weierstrass2(secp256k1_CURVE2, {
  Fp: Fpk12,
  endo: secp256k1_ENDO2
});
var secp256k12 = /* @__PURE__ */ ecdsa2(Pointk12, sha2562);

// node_modules/@toruslabs/eccrypto/dist/lib.esm/index.js
var browserCrypto = globalThis.crypto || globalThis.msCrypto || {};
var subtle = browserCrypto.subtle || browserCrypto.webkitSubtle;
var SECP256K1_GROUP_ORDER = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
function assert2(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}
function isValidPrivateKey(privateKey) {
  if (privateKey.length !== 32) {
    return false;
  }
  const privateKeyBigInt = bytesToNumberBE2(privateKey);
  return privateKeyBigInt > 0n && // > 0
  privateKeyBigInt < SECP256K1_GROUP_ORDER;
}
function randomBytes5(size) {
  if (typeof browserCrypto.getRandomValues === "undefined") {
    return browserCrypto.randomBytes(size);
  }
  const arr = new Uint8Array(size);
  browserCrypto.getRandomValues(arr);
  return arr;
}
async function sha512(msg) {
  if (!browserCrypto.createHash) {
    const hash2 = await subtle.digest("SHA-512", msg);
    const result2 = new Uint8Array(hash2);
    return result2;
  }
  const hash = browserCrypto.createHash("sha512");
  const result = hash.update(msg).digest();
  return new Uint8Array(result);
}
function getAes(op) {
  return async function(iv, key, data) {
    if (subtle && subtle[op] && subtle.importKey) {
      const importAlgorithm = {
        name: "AES-CBC"
      };
      const cryptoKey = await subtle.importKey("raw", key, importAlgorithm, false, [op]);
      const encAlgorithm = {
        name: "AES-CBC",
        iv
      };
      const result = await subtle[op](encAlgorithm, cryptoKey, data);
      return new Uint8Array(result);
    } else if (op === "encrypt" && browserCrypto.createCipheriv) {
      const cipher = browserCrypto.createCipheriv("aes-256-cbc", key, iv);
      const firstChunk = cipher.update(data);
      const secondChunk = cipher.final();
      return concatBytes4(firstChunk, secondChunk);
    } else if (op === "decrypt" && browserCrypto.createDecipheriv) {
      const decipher = browserCrypto.createDecipheriv("aes-256-cbc", key, iv);
      const firstChunk = decipher.update(data);
      const secondChunk = decipher.final();
      return concatBytes4(firstChunk, secondChunk);
    }
    throw new Error(`Unsupported operation: ${op}`);
  };
}
var aesCbcEncrypt = getAes("encrypt");
var aesCbcDecrypt = getAes("decrypt");
async function hmacSha256Sign(key, msg) {
  if (!browserCrypto.createHmac) {
    const importAlgorithm = {
      name: "HMAC",
      hash: {
        name: "SHA-256"
      }
    };
    const cryptoKey = await subtle.importKey("raw", key, importAlgorithm, false, ["sign", "verify"]);
    const sig = await subtle.sign("HMAC", cryptoKey, msg);
    const result2 = new Uint8Array(sig);
    return result2;
  }
  const hmac3 = browserCrypto.createHmac("sha256", key);
  hmac3.update(msg);
  const result = hmac3.digest();
  return result;
}
async function hmacSha256Verify(key, msg, sig) {
  const expectedSig = await hmacSha256Sign(key, msg);
  return equalBytes(expectedSig, sig);
}
function assertValidPrivateKey(privateKey) {
  assert2(isValidPrivateKey(privateKey), "Bad private key");
}
function assertValidPublicKey(publicKey) {
  const isValid = secp256k12.utils.isValidPublicKey(publicKey, true) || secp256k12.utils.isValidPublicKey(publicKey, false);
  assert2(isValid, "Bad public key");
}
function assertValidMessage(msg) {
  assert2(msg.length > 0, "Message should not be empty");
  assert2(msg.length <= 32, "Message is too long");
}
var getPublic = function(privateKey) {
  assertValidPrivateKey(privateKey);
  return secp256k12.getPublicKey(privateKey, false);
};
var sign = async function(privateKey, msg) {
  assertValidPrivateKey(privateKey);
  assertValidMessage(msg);
  const sig = secp256k12.sign(msg, privateKey, {
    prehash: false,
    format: "der"
  });
  return sig;
};
var derive = async function(privateKeyA, publicKeyB) {
  assertValidPrivateKey(privateKeyA);
  assertValidPublicKey(publicKeyB);
  const sharedSecret = secp256k12.getSharedSecret(privateKeyA, publicKeyB);
  const Px = sharedSecret.subarray(1);
  const i = Px.findIndex((byte) => byte !== 0);
  return Px.subarray(i);
};
var deriveUnpadded = derive;
var derivePadded = async function(privateKeyA, publicKeyB) {
  assertValidPrivateKey(privateKeyA);
  assertValidPublicKey(publicKeyB);
  const sharedSecret = secp256k12.getSharedSecret(privateKeyA, publicKeyB);
  return sharedSecret.subarray(1);
};
var encrypt = async function(publicKeyTo, msg, opts) {
  var _opts$padding;
  opts = opts || {};
  const padding2 = (_opts$padding = opts.padding) !== null && _opts$padding !== void 0 ? _opts$padding : true;
  let ephemPrivateKey = opts.ephemPrivateKey || randomBytes5(32);
  while (!isValidPrivateKey(ephemPrivateKey)) {
    ephemPrivateKey = opts.ephemPrivateKey || randomBytes5(32);
  }
  const ephemPublicKey = getPublic(ephemPrivateKey);
  const deriveLocal = padding2 ? derivePadded : deriveUnpadded;
  const Px = await deriveLocal(ephemPrivateKey, publicKeyTo);
  const hash = await sha512(Px);
  const iv = opts.iv || randomBytes5(16);
  const encryptionKey = hash.slice(0, 32);
  const macKey = hash.slice(32);
  const ciphertext = await aesCbcEncrypt(iv, encryptionKey, msg);
  const dataToMac = concatBytes4(iv, ephemPublicKey, ciphertext);
  const mac = await hmacSha256Sign(macKey, dataToMac);
  return {
    iv,
    ephemPublicKey,
    ciphertext,
    mac
  };
};
var decrypt = async function(privateKey, opts, _padding) {
  const padding2 = _padding !== null && _padding !== void 0 ? _padding : false;
  const deriveLocal = padding2 ? derivePadded : deriveUnpadded;
  const Px = await deriveLocal(privateKey, opts.ephemPublicKey);
  const hash = await sha512(Px);
  const encryptionKey = hash.slice(0, 32);
  const macKey = hash.slice(32);
  const dataToMac = concatBytes4(opts.iv, opts.ephemPublicKey, opts.ciphertext);
  const macGood = await hmacSha256Verify(macKey, dataToMac, opts.mac);
  if (!macGood && padding2 === false) {
    return decrypt(privateKey, opts, true);
  } else if (!macGood && padding2 === true) {
    throw new Error("bad MAC after trying padded");
  }
  const msg = await aesCbcDecrypt(opts.iv, encryptionKey, opts.ciphertext);
  return msg;
};

// node_modules/@toruslabs/metadata-helpers/dist/lib.esm/webAuthnShareResolver.js
function encParamsHexToBuf(encParamsHex) {
  return {
    iv: hexToBytes2(encParamsHex.iv),
    ephemPublicKey: hexToBytes2(encParamsHex.ephemPublicKey),
    ciphertext: hexToBytes2(encParamsHex.ciphertext),
    mac: hexToBytes2(encParamsHex.mac)
  };
}
function encParamsBufToHex(encParams) {
  return {
    iv: bytesToHex2(encParams.iv),
    ephemPublicKey: bytesToHex2(encParams.ephemPublicKey),
    ciphertext: bytesToHex2(encParams.ciphertext),
    mac: bytesToHex2(encParams.mac)
  };
}
async function encryptData(privKeyBytes, d) {
  const serializedData = utf8ToBytes(JSON.stringify(d));
  const encParams = await encrypt(getPublic(privKeyBytes), serializedData);
  const encParamsHex = encParamsBufToHex(encParams);
  return JSON.stringify(encParamsHex);
}
async function decryptData(privKeyBytes, d) {
  const encParamsHex = JSON.parse(d);
  const encParams = encParamsHexToBuf(encParamsHex);
  const serializedBytes = await decrypt(privKeyBytes, encParams);
  const data = JSON.parse(bytesToUtf8(serializedBytes));
  return data;
}

// node_modules/@toruslabs/metadata-helpers/dist/lib.esm/helpers/number.js
var bigIntToHexPrefixedString = (value, options) => {
  assert(typeof value === "bigint", "Value must be a bigint.");
  assert(value >= 0, "Value must be a non-negative bigint.");
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) {
    hex = "0" + hex;
  }
  return (options === null || options === void 0 ? void 0 : options.prefixed) === false ? hex : add0x(hex);
};
var hexToBigInt = (value) => {
  assertIsHexString(value);
  return BigInt(add0x(value));
};

// node_modules/@toruslabs/metadata-helpers/dist/lib.esm/helpers/crypto.js
function keccak256Bytes(a) {
  return keccak_256(a);
}

export {
  require_defineProperty,
  require_objectSpread2,
  bytesToHex2 as bytesToHex,
  secp256k1,
  isHexString,
  add0x,
  remove0x,
  utf8ToBytes,
  hexToBytes2 as hexToBytes,
  getPublic,
  sign,
  encryptData,
  decryptData,
  bigIntToHexPrefixedString,
  hexToBigInt,
  keccak256Bytes,
  encodeBase64Url,
  decodeBase64Url,
  toBase64,
  fromBase64,
  toBufferLike,
  require_src
};
