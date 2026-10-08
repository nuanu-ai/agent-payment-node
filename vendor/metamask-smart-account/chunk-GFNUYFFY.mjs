import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  bytesToHex,
  hexToBytes,
  isHexString,
  remove0x,
  require_lodash
} from "./chunk-T6VOGCFD.mjs";
import {
  keccak_256
} from "./chunk-ZSEVIWSW.mjs";
import {
  __commonJS,
  __require,
  __toESM
} from "./chunk-GQCBBNZL.mjs";

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
        const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
        for (const ns of split) {
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
        if (["TRAVIS", "CIRCLECI", "APPVEYOR", "GITLAB_CI", "GITHUB_ACTIONS", "BUILDKITE", "DRONE"].some((sign) => sign in env) || env.CI_NAME === "codeship") {
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

// node_modules/@metamask/scure-bip39/dist/wordlists/english.js
var require_english = __commonJS({
  "node_modules/@metamask/scure-bip39/dist/wordlists/english.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.wordlist = void 0;
    exports.wordlist = `abandon
ability
able
about
above
absent
absorb
abstract
absurd
abuse
access
accident
account
accuse
achieve
acid
acoustic
acquire
across
act
action
actor
actress
actual
adapt
add
addict
address
adjust
admit
adult
advance
advice
aerobic
affair
afford
afraid
again
age
agent
agree
ahead
aim
air
airport
aisle
alarm
album
alcohol
alert
alien
all
alley
allow
almost
alone
alpha
already
also
alter
always
amateur
amazing
among
amount
amused
analyst
anchor
ancient
anger
angle
angry
animal
ankle
announce
annual
another
answer
antenna
antique
anxiety
any
apart
apology
appear
apple
approve
april
arch
arctic
area
arena
argue
arm
armed
armor
army
around
arrange
arrest
arrive
arrow
art
artefact
artist
artwork
ask
aspect
assault
asset
assist
assume
asthma
athlete
atom
attack
attend
attitude
attract
auction
audit
august
aunt
author
auto
autumn
average
avocado
avoid
awake
aware
away
awesome
awful
awkward
axis
baby
bachelor
bacon
badge
bag
balance
balcony
ball
bamboo
banana
banner
bar
barely
bargain
barrel
base
basic
basket
battle
beach
bean
beauty
because
become
beef
before
begin
behave
behind
believe
below
belt
bench
benefit
best
betray
better
between
beyond
bicycle
bid
bike
bind
biology
bird
birth
bitter
black
blade
blame
blanket
blast
bleak
bless
blind
blood
blossom
blouse
blue
blur
blush
board
boat
body
boil
bomb
bone
bonus
book
boost
border
boring
borrow
boss
bottom
bounce
box
boy
bracket
brain
brand
brass
brave
bread
breeze
brick
bridge
brief
bright
bring
brisk
broccoli
broken
bronze
broom
brother
brown
brush
bubble
buddy
budget
buffalo
build
bulb
bulk
bullet
bundle
bunker
burden
burger
burst
bus
business
busy
butter
buyer
buzz
cabbage
cabin
cable
cactus
cage
cake
call
calm
camera
camp
can
canal
cancel
candy
cannon
canoe
canvas
canyon
capable
capital
captain
car
carbon
card
cargo
carpet
carry
cart
case
cash
casino
castle
casual
cat
catalog
catch
category
cattle
caught
cause
caution
cave
ceiling
celery
cement
census
century
cereal
certain
chair
chalk
champion
change
chaos
chapter
charge
chase
chat
cheap
check
cheese
chef
cherry
chest
chicken
chief
child
chimney
choice
choose
chronic
chuckle
chunk
churn
cigar
cinnamon
circle
citizen
city
civil
claim
clap
clarify
claw
clay
clean
clerk
clever
click
client
cliff
climb
clinic
clip
clock
clog
close
cloth
cloud
clown
club
clump
cluster
clutch
coach
coast
coconut
code
coffee
coil
coin
collect
color
column
combine
come
comfort
comic
common
company
concert
conduct
confirm
congress
connect
consider
control
convince
cook
cool
copper
copy
coral
core
corn
correct
cost
cotton
couch
country
couple
course
cousin
cover
coyote
crack
cradle
craft
cram
crane
crash
crater
crawl
crazy
cream
credit
creek
crew
cricket
crime
crisp
critic
crop
cross
crouch
crowd
crucial
cruel
cruise
crumble
crunch
crush
cry
crystal
cube
culture
cup
cupboard
curious
current
curtain
curve
cushion
custom
cute
cycle
dad
damage
damp
dance
danger
daring
dash
daughter
dawn
day
deal
debate
debris
decade
december
decide
decline
decorate
decrease
deer
defense
define
defy
degree
delay
deliver
demand
demise
denial
dentist
deny
depart
depend
deposit
depth
deputy
derive
describe
desert
design
desk
despair
destroy
detail
detect
develop
device
devote
diagram
dial
diamond
diary
dice
diesel
diet
differ
digital
dignity
dilemma
dinner
dinosaur
direct
dirt
disagree
discover
disease
dish
dismiss
disorder
display
distance
divert
divide
divorce
dizzy
doctor
document
dog
doll
dolphin
domain
donate
donkey
donor
door
dose
double
dove
draft
dragon
drama
drastic
draw
dream
dress
drift
drill
drink
drip
drive
drop
drum
dry
duck
dumb
dune
during
dust
dutch
duty
dwarf
dynamic
eager
eagle
early
earn
earth
easily
east
easy
echo
ecology
economy
edge
edit
educate
effort
egg
eight
either
elbow
elder
electric
elegant
element
elephant
elevator
elite
else
embark
embody
embrace
emerge
emotion
employ
empower
empty
enable
enact
end
endless
endorse
enemy
energy
enforce
engage
engine
enhance
enjoy
enlist
enough
enrich
enroll
ensure
enter
entire
entry
envelope
episode
equal
equip
era
erase
erode
erosion
error
erupt
escape
essay
essence
estate
eternal
ethics
evidence
evil
evoke
evolve
exact
example
excess
exchange
excite
exclude
excuse
execute
exercise
exhaust
exhibit
exile
exist
exit
exotic
expand
expect
expire
explain
expose
express
extend
extra
eye
eyebrow
fabric
face
faculty
fade
faint
faith
fall
false
fame
family
famous
fan
fancy
fantasy
farm
fashion
fat
fatal
father
fatigue
fault
favorite
feature
february
federal
fee
feed
feel
female
fence
festival
fetch
fever
few
fiber
fiction
field
figure
file
film
filter
final
find
fine
finger
finish
fire
firm
first
fiscal
fish
fit
fitness
fix
flag
flame
flash
flat
flavor
flee
flight
flip
float
flock
floor
flower
fluid
flush
fly
foam
focus
fog
foil
fold
follow
food
foot
force
forest
forget
fork
fortune
forum
forward
fossil
foster
found
fox
fragile
frame
frequent
fresh
friend
fringe
frog
front
frost
frown
frozen
fruit
fuel
fun
funny
furnace
fury
future
gadget
gain
galaxy
gallery
game
gap
garage
garbage
garden
garlic
garment
gas
gasp
gate
gather
gauge
gaze
general
genius
genre
gentle
genuine
gesture
ghost
giant
gift
giggle
ginger
giraffe
girl
give
glad
glance
glare
glass
glide
glimpse
globe
gloom
glory
glove
glow
glue
goat
goddess
gold
good
goose
gorilla
gospel
gossip
govern
gown
grab
grace
grain
grant
grape
grass
gravity
great
green
grid
grief
grit
grocery
group
grow
grunt
guard
guess
guide
guilt
guitar
gun
gym
habit
hair
half
hammer
hamster
hand
happy
harbor
hard
harsh
harvest
hat
have
hawk
hazard
head
health
heart
heavy
hedgehog
height
hello
helmet
help
hen
hero
hidden
high
hill
hint
hip
hire
history
hobby
hockey
hold
hole
holiday
hollow
home
honey
hood
hope
horn
horror
horse
hospital
host
hotel
hour
hover
hub
huge
human
humble
humor
hundred
hungry
hunt
hurdle
hurry
hurt
husband
hybrid
ice
icon
idea
identify
idle
ignore
ill
illegal
illness
image
imitate
immense
immune
impact
impose
improve
impulse
inch
include
income
increase
index
indicate
indoor
industry
infant
inflict
inform
inhale
inherit
initial
inject
injury
inmate
inner
innocent
input
inquiry
insane
insect
inside
inspire
install
intact
interest
into
invest
invite
involve
iron
island
isolate
issue
item
ivory
jacket
jaguar
jar
jazz
jealous
jeans
jelly
jewel
job
join
joke
journey
joy
judge
juice
jump
jungle
junior
junk
just
kangaroo
keen
keep
ketchup
key
kick
kid
kidney
kind
kingdom
kiss
kit
kitchen
kite
kitten
kiwi
knee
knife
knock
know
lab
label
labor
ladder
lady
lake
lamp
language
laptop
large
later
latin
laugh
laundry
lava
law
lawn
lawsuit
layer
lazy
leader
leaf
learn
leave
lecture
left
leg
legal
legend
leisure
lemon
lend
length
lens
leopard
lesson
letter
level
liar
liberty
library
license
life
lift
light
like
limb
limit
link
lion
liquid
list
little
live
lizard
load
loan
lobster
local
lock
logic
lonely
long
loop
lottery
loud
lounge
love
loyal
lucky
luggage
lumber
lunar
lunch
luxury
lyrics
machine
mad
magic
magnet
maid
mail
main
major
make
mammal
man
manage
mandate
mango
mansion
manual
maple
marble
march
margin
marine
market
marriage
mask
mass
master
match
material
math
matrix
matter
maximum
maze
meadow
mean
measure
meat
mechanic
medal
media
melody
melt
member
memory
mention
menu
mercy
merge
merit
merry
mesh
message
metal
method
middle
midnight
milk
million
mimic
mind
minimum
minor
minute
miracle
mirror
misery
miss
mistake
mix
mixed
mixture
mobile
model
modify
mom
moment
monitor
monkey
monster
month
moon
moral
more
morning
mosquito
mother
motion
motor
mountain
mouse
move
movie
much
muffin
mule
multiply
muscle
museum
mushroom
music
must
mutual
myself
mystery
myth
naive
name
napkin
narrow
nasty
nation
nature
near
neck
need
negative
neglect
neither
nephew
nerve
nest
net
network
neutral
never
news
next
nice
night
noble
noise
nominee
noodle
normal
north
nose
notable
note
nothing
notice
novel
now
nuclear
number
nurse
nut
oak
obey
object
oblige
obscure
observe
obtain
obvious
occur
ocean
october
odor
off
offer
office
often
oil
okay
old
olive
olympic
omit
once
one
onion
online
only
open
opera
opinion
oppose
option
orange
orbit
orchard
order
ordinary
organ
orient
original
orphan
ostrich
other
outdoor
outer
output
outside
oval
oven
over
own
owner
oxygen
oyster
ozone
pact
paddle
page
pair
palace
palm
panda
panel
panic
panther
paper
parade
parent
park
parrot
party
pass
patch
path
patient
patrol
pattern
pause
pave
payment
peace
peanut
pear
peasant
pelican
pen
penalty
pencil
people
pepper
perfect
permit
person
pet
phone
photo
phrase
physical
piano
picnic
picture
piece
pig
pigeon
pill
pilot
pink
pioneer
pipe
pistol
pitch
pizza
place
planet
plastic
plate
play
please
pledge
pluck
plug
plunge
poem
poet
point
polar
pole
police
pond
pony
pool
popular
portion
position
possible
post
potato
pottery
poverty
powder
power
practice
praise
predict
prefer
prepare
present
pretty
prevent
price
pride
primary
print
priority
prison
private
prize
problem
process
produce
profit
program
project
promote
proof
property
prosper
protect
proud
provide
public
pudding
pull
pulp
pulse
pumpkin
punch
pupil
puppy
purchase
purity
purpose
purse
push
put
puzzle
pyramid
quality
quantum
quarter
question
quick
quit
quiz
quote
rabbit
raccoon
race
rack
radar
radio
rail
rain
raise
rally
ramp
ranch
random
range
rapid
rare
rate
rather
raven
raw
razor
ready
real
reason
rebel
rebuild
recall
receive
recipe
record
recycle
reduce
reflect
reform
refuse
region
regret
regular
reject
relax
release
relief
rely
remain
remember
remind
remove
render
renew
rent
reopen
repair
repeat
replace
report
require
rescue
resemble
resist
resource
response
result
retire
retreat
return
reunion
reveal
review
reward
rhythm
rib
ribbon
rice
rich
ride
ridge
rifle
right
rigid
ring
riot
ripple
risk
ritual
rival
river
road
roast
robot
robust
rocket
romance
roof
rookie
room
rose
rotate
rough
round
route
royal
rubber
rude
rug
rule
run
runway
rural
sad
saddle
sadness
safe
sail
salad
salmon
salon
salt
salute
same
sample
sand
satisfy
satoshi
sauce
sausage
save
say
scale
scan
scare
scatter
scene
scheme
school
science
scissors
scorpion
scout
scrap
screen
script
scrub
sea
search
season
seat
second
secret
section
security
seed
seek
segment
select
sell
seminar
senior
sense
sentence
series
service
session
settle
setup
seven
shadow
shaft
shallow
share
shed
shell
sheriff
shield
shift
shine
ship
shiver
shock
shoe
shoot
shop
short
shoulder
shove
shrimp
shrug
shuffle
shy
sibling
sick
side
siege
sight
sign
silent
silk
silly
silver
similar
simple
since
sing
siren
sister
situate
six
size
skate
sketch
ski
skill
skin
skirt
skull
slab
slam
sleep
slender
slice
slide
slight
slim
slogan
slot
slow
slush
small
smart
smile
smoke
smooth
snack
snake
snap
sniff
snow
soap
soccer
social
sock
soda
soft
solar
soldier
solid
solution
solve
someone
song
soon
sorry
sort
soul
sound
soup
source
south
space
spare
spatial
spawn
speak
special
speed
spell
spend
sphere
spice
spider
spike
spin
spirit
split
spoil
sponsor
spoon
sport
spot
spray
spread
spring
spy
square
squeeze
squirrel
stable
stadium
staff
stage
stairs
stamp
stand
start
state
stay
steak
steel
stem
step
stereo
stick
still
sting
stock
stomach
stone
stool
story
stove
strategy
street
strike
strong
struggle
student
stuff
stumble
style
subject
submit
subway
success
such
sudden
suffer
sugar
suggest
suit
summer
sun
sunny
sunset
super
supply
supreme
sure
surface
surge
surprise
surround
survey
suspect
sustain
swallow
swamp
swap
swarm
swear
sweet
swift
swim
swing
switch
sword
symbol
symptom
syrup
system
table
tackle
tag
tail
talent
talk
tank
tape
target
task
taste
tattoo
taxi
teach
team
tell
ten
tenant
tennis
tent
term
test
text
thank
that
theme
then
theory
there
they
thing
this
thought
three
thrive
throw
thumb
thunder
ticket
tide
tiger
tilt
timber
time
tiny
tip
tired
tissue
title
toast
tobacco
today
toddler
toe
together
toilet
token
tomato
tomorrow
tone
tongue
tonight
tool
tooth
top
topic
topple
torch
tornado
tortoise
toss
total
tourist
toward
tower
town
toy
track
trade
traffic
tragic
train
transfer
trap
trash
travel
tray
treat
tree
trend
trial
tribe
trick
trigger
trim
trip
trophy
trouble
truck
true
truly
trumpet
trust
truth
try
tube
tuition
tumble
tuna
tunnel
turkey
turn
turtle
twelve
twenty
twice
twin
twist
two
type
typical
ugly
umbrella
unable
unaware
uncle
uncover
under
undo
unfair
unfold
unhappy
uniform
unique
unit
universe
unknown
unlock
until
unusual
unveil
update
upgrade
uphold
upon
upper
upset
urban
urge
usage
use
used
useful
useless
usual
utility
vacant
vacuum
vague
valid
valley
valve
van
vanish
vapor
various
vast
vault
vehicle
velvet
vendor
venture
venue
verb
verify
version
very
vessel
veteran
viable
vibrant
vicious
victory
video
view
village
vintage
violin
virtual
virus
visa
visit
visual
vital
vivid
vocal
voice
void
volcano
volume
vote
voyage
wage
wagon
wait
walk
wall
walnut
want
warfare
warm
warrior
wash
wasp
waste
water
wave
way
wealth
weapon
wear
weasel
weather
web
wedding
weekend
weird
welcome
west
wet
whale
what
wheat
wheel
when
where
whip
whisper
wide
width
wife
wild
will
win
window
wine
wing
wink
winner
winter
wire
wisdom
wise
wish
witness
wolf
woman
wonder
wood
wool
word
work
world
worry
worth
wrap
wreck
wrestle
wrist
write
wrong
yard
year
yellow
you
young
youth
zebra
zero
zone
zoo`.split("\n");
  }
});

// node_modules/semver/internal/constants.js
var require_constants = __commonJS({
  "node_modules/semver/internal/constants.js"(exports, module) {
    "use strict";
    var SEMVER_SPEC_VERSION = "2.0.0";
    var MAX_LENGTH = 256;
    var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
    9007199254740991;
    var MAX_SAFE_COMPONENT_LENGTH = 16;
    var MAX_SAFE_BUILD_LENGTH = MAX_LENGTH - 6;
    var RELEASE_TYPES = [
      "major",
      "premajor",
      "minor",
      "preminor",
      "patch",
      "prepatch",
      "prerelease"
    ];
    module.exports = {
      MAX_LENGTH,
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_SAFE_INTEGER,
      RELEASE_TYPES,
      SEMVER_SPEC_VERSION,
      FLAG_INCLUDE_PRERELEASE: 1,
      FLAG_LOOSE: 2
    };
  }
});

// node_modules/semver/internal/debug.js
var require_debug = __commonJS({
  "node_modules/semver/internal/debug.js"(exports, module) {
    "use strict";
    var debug = typeof process === "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {
    };
    module.exports = debug;
  }
});

// node_modules/semver/internal/re.js
var require_re = __commonJS({
  "node_modules/semver/internal/re.js"(exports, module) {
    "use strict";
    var {
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_LENGTH
    } = require_constants();
    var debug = require_debug();
    exports = module.exports = {};
    var re = exports.re = [];
    var safeRe = exports.safeRe = [];
    var src = exports.src = [];
    var safeSrc = exports.safeSrc = [];
    var t = exports.t = {};
    var R = 0;
    var LETTERDASHNUMBER = "[a-zA-Z0-9-]";
    var safeRegexReplacements = [
      ["\\s", 1],
      ["\\d", MAX_LENGTH],
      [LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH]
    ];
    var makeSafeRegex = (value) => {
      for (const [token, max] of safeRegexReplacements) {
        value = value.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
      }
      return value;
    };
    var createToken = (name, value, isGlobal) => {
      const safe = makeSafeRegex(value);
      const index = R++;
      debug(name, index, value);
      t[name] = index;
      src[index] = value;
      safeSrc[index] = safe;
      re[index] = new RegExp(value, isGlobal ? "g" : void 0);
      safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
    };
    createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
    createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
    createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
    createToken("MAINVERSION", `(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})`);
    createToken("MAINVERSIONLOOSE", `(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASEIDENTIFIER", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIER]})`);
    createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASE", `(?:-(${src[t.PRERELEASEIDENTIFIER]}(?:\\.${src[t.PRERELEASEIDENTIFIER]})*))`);
    createToken("PRERELEASELOOSE", `(?:-?(${src[t.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src[t.PRERELEASEIDENTIFIERLOOSE]})*))`);
    createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
    createToken("BUILD", `(?:\\+(${src[t.BUILDIDENTIFIER]}(?:\\.${src[t.BUILDIDENTIFIER]})*))`);
    createToken("FULLPLAIN", `v?${src[t.MAINVERSION]}${src[t.PRERELEASE]}?${src[t.BUILD]}?`);
    createToken("FULL", `^${src[t.FULLPLAIN]}$`);
    createToken("LOOSEPLAIN", `[v=\\s]*${src[t.MAINVERSIONLOOSE]}${src[t.PRERELEASELOOSE]}?${src[t.BUILD]}?`);
    createToken("LOOSE", `^${src[t.LOOSEPLAIN]}$`);
    createToken("GTLT", "((?:<|>)?=?)");
    createToken("XRANGEIDENTIFIERLOOSE", `${src[t.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
    createToken("XRANGEIDENTIFIER", `${src[t.NUMERICIDENTIFIER]}|x|X|\\*`);
    createToken("XRANGEPLAIN", `[v=\\s]*(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:${src[t.PRERELEASE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:${src[t.PRERELEASELOOSE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAIN]}$`);
    createToken("XRANGELOOSE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COERCEPLAIN", `${"(^|[^\\d])(\\d{1,"}${MAX_SAFE_COMPONENT_LENGTH}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?`);
    createToken("COERCE", `${src[t.COERCEPLAIN]}(?:$|[^\\d])`);
    createToken("COERCEFULL", src[t.COERCEPLAIN] + `(?:${src[t.PRERELEASE]})?(?:${src[t.BUILD]})?(?:$|[^\\d])`);
    createToken("COERCERTL", src[t.COERCE], true);
    createToken("COERCERTLFULL", src[t.COERCEFULL], true);
    createToken("LONETILDE", "(?:~>?)");
    createToken("TILDETRIM", `(\\s*)${src[t.LONETILDE]}\\s+`, true);
    exports.tildeTrimReplace = "$1~";
    createToken("TILDE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAIN]}$`);
    createToken("TILDELOOSE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("LONECARET", "(?:\\^)");
    createToken("CARETTRIM", `(\\s*)${src[t.LONECARET]}\\s+`, true);
    exports.caretTrimReplace = "$1^";
    createToken("CARET", `^${src[t.LONECARET]}${src[t.XRANGEPLAIN]}$`);
    createToken("CARETLOOSE", `^${src[t.LONECARET]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COMPARATORLOOSE", `^${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]})$|^$`);
    createToken("COMPARATOR", `^${src[t.GTLT]}\\s*(${src[t.FULLPLAIN]})$|^$`);
    createToken("COMPARATORTRIM", `(\\s*)${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]}|${src[t.XRANGEPLAIN]})`, true);
    exports.comparatorTrimReplace = "$1$2$3";
    createToken("HYPHENRANGE", `^\\s*(${src[t.XRANGEPLAIN]})\\s+-\\s+(${src[t.XRANGEPLAIN]})\\s*$`);
    createToken("HYPHENRANGELOOSE", `^\\s*(${src[t.XRANGEPLAINLOOSE]})\\s+-\\s+(${src[t.XRANGEPLAINLOOSE]})\\s*$`);
    createToken("STAR", "(<|>)?=?\\s*\\*");
    createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
    createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
  }
});

// node_modules/semver/internal/parse-options.js
var require_parse_options = __commonJS({
  "node_modules/semver/internal/parse-options.js"(exports, module) {
    "use strict";
    var looseOption = Object.freeze({ loose: true });
    var emptyOpts = Object.freeze({});
    var parseOptions = (options) => {
      if (!options) {
        return emptyOpts;
      }
      if (typeof options !== "object") {
        return looseOption;
      }
      return options;
    };
    module.exports = parseOptions;
  }
});

// node_modules/semver/internal/identifiers.js
var require_identifiers = __commonJS({
  "node_modules/semver/internal/identifiers.js"(exports, module) {
    "use strict";
    var numeric = /^[0-9]+$/;
    var compareIdentifiers = (a, b) => {
      if (typeof a === "number" && typeof b === "number") {
        return a === b ? 0 : a < b ? -1 : 1;
      }
      const anum = numeric.test(a);
      const bnum = numeric.test(b);
      if (anum && bnum) {
        a = +a;
        b = +b;
      }
      return a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
    };
    var rcompareIdentifiers = (a, b) => compareIdentifiers(b, a);
    module.exports = {
      compareIdentifiers,
      rcompareIdentifiers
    };
  }
});

// node_modules/semver/classes/semver.js
var require_semver = __commonJS({
  "node_modules/semver/classes/semver.js"(exports, module) {
    "use strict";
    var debug = require_debug();
    var { MAX_LENGTH, MAX_SAFE_INTEGER } = require_constants();
    var { safeRe: re, t } = require_re();
    var parseOptions = require_parse_options();
    var { compareIdentifiers } = require_identifiers();
    var isPrereleaseIdentifier = (prerelease, identifier) => {
      const identifiers = identifier.split(".");
      if (identifiers.length > prerelease.length) {
        return false;
      }
      for (let i = 0; i < identifiers.length; i++) {
        if (compareIdentifiers(prerelease[i], identifiers[i]) !== 0) {
          return false;
        }
      }
      return true;
    };
    var SemVer = class _SemVer {
      constructor(version, options) {
        options = parseOptions(options);
        if (version instanceof _SemVer) {
          if (version.loose === !!options.loose && version.includePrerelease === !!options.includePrerelease) {
            return version;
          } else {
            version = version.version;
          }
        } else if (typeof version !== "string") {
          throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
        }
        if (version.length > MAX_LENGTH) {
          throw new TypeError(
            `version is longer than ${MAX_LENGTH} characters`
          );
        }
        debug("SemVer", version, options);
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        const m = version.trim().match(options.loose ? re[t.LOOSE] : re[t.FULL]);
        if (!m) {
          throw new TypeError(`Invalid Version: ${version}`);
        }
        this.raw = version;
        this.major = +m[1];
        this.minor = +m[2];
        this.patch = +m[3];
        if (this.major > MAX_SAFE_INTEGER || this.major < 0) {
          throw new TypeError("Invalid major version");
        }
        if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) {
          throw new TypeError("Invalid minor version");
        }
        if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) {
          throw new TypeError("Invalid patch version");
        }
        if (!m[4]) {
          this.prerelease = [];
        } else {
          this.prerelease = m[4].split(".").map((id) => {
            if (/^[0-9]+$/.test(id)) {
              const num = +id;
              if (num >= 0 && num < MAX_SAFE_INTEGER) {
                return num;
              }
            }
            return id;
          });
        }
        this.build = m[5] ? m[5].split(".") : [];
        this.format();
      }
      format() {
        this.version = `${this.major}.${this.minor}.${this.patch}`;
        if (this.prerelease.length) {
          this.version += `-${this.prerelease.join(".")}`;
        }
        return this.version;
      }
      toString() {
        return this.version;
      }
      compare(other) {
        debug("SemVer.compare", this.version, this.options, other);
        if (!(other instanceof _SemVer)) {
          if (typeof other === "string" && other === this.version) {
            return 0;
          }
          other = new _SemVer(other, this.options);
        }
        if (other.version === this.version) {
          return 0;
        }
        return this.compareMain(other) || this.comparePre(other);
      }
      compareMain(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.major < other.major) {
          return -1;
        }
        if (this.major > other.major) {
          return 1;
        }
        if (this.minor < other.minor) {
          return -1;
        }
        if (this.minor > other.minor) {
          return 1;
        }
        if (this.patch < other.patch) {
          return -1;
        }
        if (this.patch > other.patch) {
          return 1;
        }
        return 0;
      }
      comparePre(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.prerelease.length && !other.prerelease.length) {
          return -1;
        } else if (!this.prerelease.length && other.prerelease.length) {
          return 1;
        } else if (!this.prerelease.length && !other.prerelease.length) {
          return 0;
        }
        let i = 0;
        do {
          const a = this.prerelease[i];
          const b = other.prerelease[i];
          debug("prerelease compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      compareBuild(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        let i = 0;
        do {
          const a = this.build[i];
          const b = other.build[i];
          debug("build compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      // preminor will bump the version up to the next minor release, and immediately
      // down to pre-release. premajor and prepatch work the same way.
      inc(release, identifier, identifierBase) {
        if (release.startsWith("pre")) {
          if (!identifier && identifierBase === false) {
            throw new Error("invalid increment argument: identifier is empty");
          }
          if (identifier) {
            const match = `-${identifier}`.match(this.options.loose ? re[t.PRERELEASELOOSE] : re[t.PRERELEASE]);
            if (!match || match[1] !== identifier) {
              throw new Error(`invalid identifier: ${identifier}`);
            }
          }
        }
        switch (release) {
          case "premajor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor = 0;
            this.major++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "preminor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "prepatch":
            this.prerelease.length = 0;
            this.inc("patch", identifier, identifierBase);
            this.inc("pre", identifier, identifierBase);
            break;
          // If the input is a non-prerelease version, this acts the same as
          // prepatch.
          case "prerelease":
            if (this.prerelease.length === 0) {
              this.inc("patch", identifier, identifierBase);
            }
            this.inc("pre", identifier, identifierBase);
            break;
          case "release":
            if (this.prerelease.length === 0) {
              throw new Error(`version ${this.raw} is not a prerelease`);
            }
            this.prerelease.length = 0;
            break;
          case "major":
            if (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) {
              this.major++;
            }
            this.minor = 0;
            this.patch = 0;
            this.prerelease = [];
            break;
          case "minor":
            if (this.patch !== 0 || this.prerelease.length === 0) {
              this.minor++;
            }
            this.patch = 0;
            this.prerelease = [];
            break;
          case "patch":
            if (this.prerelease.length === 0) {
              this.patch++;
            }
            this.prerelease = [];
            break;
          // This probably shouldn't be used publicly.
          // 1.0.0 'pre' would become 1.0.0-0 which is the wrong direction.
          case "pre": {
            const base = Number(identifierBase) ? 1 : 0;
            if (this.prerelease.length === 0) {
              this.prerelease = [base];
            } else {
              let i = this.prerelease.length;
              while (--i >= 0) {
                if (typeof this.prerelease[i] === "number") {
                  this.prerelease[i]++;
                  i = -2;
                }
              }
              if (i === -1) {
                if (identifier === this.prerelease.join(".") && identifierBase === false) {
                  throw new Error("invalid increment argument: identifier already exists");
                }
                this.prerelease.push(base);
              }
            }
            if (identifier) {
              let prerelease = [identifier, base];
              if (identifierBase === false) {
                prerelease = [identifier];
              }
              if (isPrereleaseIdentifier(this.prerelease, identifier)) {
                const prereleaseBase = this.prerelease[identifier.split(".").length];
                if (isNaN(prereleaseBase)) {
                  this.prerelease = prerelease;
                }
              } else {
                this.prerelease = prerelease;
              }
            }
            break;
          }
          default:
            throw new Error(`invalid increment argument: ${release}`);
        }
        this.raw = this.format();
        if (this.build.length) {
          this.raw += `+${this.build.join(".")}`;
        }
        return this;
      }
    };
    module.exports = SemVer;
  }
});

// node_modules/semver/functions/parse.js
var require_parse = __commonJS({
  "node_modules/semver/functions/parse.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var parse = (version, options, throwErrors = false) => {
      if (version instanceof SemVer) {
        return version;
      }
      try {
        return new SemVer(version, options);
      } catch (er) {
        if (!throwErrors) {
          return null;
        }
        throw er;
      }
    };
    module.exports = parse;
  }
});

// node_modules/semver/functions/valid.js
var require_valid = __commonJS({
  "node_modules/semver/functions/valid.js"(exports, module) {
    "use strict";
    var parse = require_parse();
    var valid = (version, options) => {
      const v = parse(version, options);
      return v ? v.version : null;
    };
    module.exports = valid;
  }
});

// node_modules/semver/functions/clean.js
var require_clean = __commonJS({
  "node_modules/semver/functions/clean.js"(exports, module) {
    "use strict";
    var parse = require_parse();
    var clean = (version, options) => {
      const s = parse(version.trim().replace(/^[=v]+/, ""), options);
      return s ? s.version : null;
    };
    module.exports = clean;
  }
});

// node_modules/semver/functions/inc.js
var require_inc = __commonJS({
  "node_modules/semver/functions/inc.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var inc = (version, release, options, identifier, identifierBase) => {
      if (typeof options === "string") {
        identifierBase = identifier;
        identifier = options;
        options = void 0;
      }
      try {
        return new SemVer(
          version instanceof SemVer ? version.version : version,
          options
        ).inc(release, identifier, identifierBase).version;
      } catch (er) {
        return null;
      }
    };
    module.exports = inc;
  }
});

// node_modules/semver/functions/diff.js
var require_diff = __commonJS({
  "node_modules/semver/functions/diff.js"(exports, module) {
    "use strict";
    var parse = require_parse();
    var diff = (version1, version2) => {
      const v1 = parse(version1, null, true);
      const v2 = parse(version2, null, true);
      const comparison = v1.compare(v2);
      if (comparison === 0) {
        return null;
      }
      const v1Higher = comparison > 0;
      const highVersion = v1Higher ? v1 : v2;
      const lowVersion = v1Higher ? v2 : v1;
      const highHasPre = !!highVersion.prerelease.length;
      const lowHasPre = !!lowVersion.prerelease.length;
      if (lowHasPre && !highHasPre) {
        if (!lowVersion.patch && !lowVersion.minor) {
          return "major";
        }
        if (lowVersion.compareMain(highVersion) === 0) {
          if (lowVersion.minor && !lowVersion.patch) {
            return "minor";
          }
          return "patch";
        }
      }
      const prefix = highHasPre ? "pre" : "";
      if (v1.major !== v2.major) {
        return prefix + "major";
      }
      if (v1.minor !== v2.minor) {
        return prefix + "minor";
      }
      if (v1.patch !== v2.patch) {
        return prefix + "patch";
      }
      return "prerelease";
    };
    module.exports = diff;
  }
});

// node_modules/semver/functions/major.js
var require_major = __commonJS({
  "node_modules/semver/functions/major.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var major = (a, loose) => new SemVer(a, loose).major;
    module.exports = major;
  }
});

// node_modules/semver/functions/minor.js
var require_minor = __commonJS({
  "node_modules/semver/functions/minor.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var minor = (a, loose) => new SemVer(a, loose).minor;
    module.exports = minor;
  }
});

// node_modules/semver/functions/patch.js
var require_patch = __commonJS({
  "node_modules/semver/functions/patch.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var patch = (a, loose) => new SemVer(a, loose).patch;
    module.exports = patch;
  }
});

// node_modules/semver/functions/prerelease.js
var require_prerelease = __commonJS({
  "node_modules/semver/functions/prerelease.js"(exports, module) {
    "use strict";
    var parse = require_parse();
    var prerelease = (version, options) => {
      const parsed = parse(version, options);
      return parsed && parsed.prerelease.length ? parsed.prerelease : null;
    };
    module.exports = prerelease;
  }
});

// node_modules/semver/functions/compare.js
var require_compare = __commonJS({
  "node_modules/semver/functions/compare.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var compare = (a, b, loose) => new SemVer(a, loose).compare(new SemVer(b, loose));
    module.exports = compare;
  }
});

// node_modules/semver/functions/rcompare.js
var require_rcompare = __commonJS({
  "node_modules/semver/functions/rcompare.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var rcompare = (a, b, loose) => compare(b, a, loose);
    module.exports = rcompare;
  }
});

// node_modules/semver/functions/compare-loose.js
var require_compare_loose = __commonJS({
  "node_modules/semver/functions/compare-loose.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var compareLoose = (a, b) => compare(a, b, true);
    module.exports = compareLoose;
  }
});

// node_modules/semver/functions/compare-build.js
var require_compare_build = __commonJS({
  "node_modules/semver/functions/compare-build.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var compareBuild = (a, b, loose) => {
      const versionA = new SemVer(a, loose);
      const versionB = new SemVer(b, loose);
      return versionA.compare(versionB) || versionA.compareBuild(versionB);
    };
    module.exports = compareBuild;
  }
});

// node_modules/semver/functions/sort.js
var require_sort = __commonJS({
  "node_modules/semver/functions/sort.js"(exports, module) {
    "use strict";
    var compareBuild = require_compare_build();
    var sort = (list, loose) => list.sort((a, b) => compareBuild(a, b, loose));
    module.exports = sort;
  }
});

// node_modules/semver/functions/rsort.js
var require_rsort = __commonJS({
  "node_modules/semver/functions/rsort.js"(exports, module) {
    "use strict";
    var compareBuild = require_compare_build();
    var rsort = (list, loose) => list.sort((a, b) => compareBuild(b, a, loose));
    module.exports = rsort;
  }
});

// node_modules/semver/functions/gt.js
var require_gt = __commonJS({
  "node_modules/semver/functions/gt.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var gt = (a, b, loose) => compare(a, b, loose) > 0;
    module.exports = gt;
  }
});

// node_modules/semver/functions/lt.js
var require_lt = __commonJS({
  "node_modules/semver/functions/lt.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var lt = (a, b, loose) => compare(a, b, loose) < 0;
    module.exports = lt;
  }
});

// node_modules/semver/functions/eq.js
var require_eq = __commonJS({
  "node_modules/semver/functions/eq.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var eq = (a, b, loose) => compare(a, b, loose) === 0;
    module.exports = eq;
  }
});

// node_modules/semver/functions/neq.js
var require_neq = __commonJS({
  "node_modules/semver/functions/neq.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var neq = (a, b, loose) => compare(a, b, loose) !== 0;
    module.exports = neq;
  }
});

// node_modules/semver/functions/gte.js
var require_gte = __commonJS({
  "node_modules/semver/functions/gte.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var gte = (a, b, loose) => compare(a, b, loose) >= 0;
    module.exports = gte;
  }
});

// node_modules/semver/functions/lte.js
var require_lte = __commonJS({
  "node_modules/semver/functions/lte.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var lte = (a, b, loose) => compare(a, b, loose) <= 0;
    module.exports = lte;
  }
});

// node_modules/semver/functions/cmp.js
var require_cmp = __commonJS({
  "node_modules/semver/functions/cmp.js"(exports, module) {
    "use strict";
    var eq = require_eq();
    var neq = require_neq();
    var gt = require_gt();
    var gte = require_gte();
    var lt = require_lt();
    var lte = require_lte();
    var cmp = (a, op, b, loose) => {
      switch (op) {
        case "===":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a === b;
        case "!==":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a !== b;
        case "":
        case "=":
        case "==":
          return eq(a, b, loose);
        case "!=":
          return neq(a, b, loose);
        case ">":
          return gt(a, b, loose);
        case ">=":
          return gte(a, b, loose);
        case "<":
          return lt(a, b, loose);
        case "<=":
          return lte(a, b, loose);
        default:
          throw new TypeError(`Invalid operator: ${op}`);
      }
    };
    module.exports = cmp;
  }
});

// node_modules/semver/functions/coerce.js
var require_coerce = __commonJS({
  "node_modules/semver/functions/coerce.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var parse = require_parse();
    var { safeRe: re, t } = require_re();
    var coerce = (version, options) => {
      if (version instanceof SemVer) {
        return version;
      }
      if (typeof version === "number") {
        version = String(version);
      }
      if (typeof version !== "string") {
        return null;
      }
      options = options || {};
      let match = null;
      if (!options.rtl) {
        match = version.match(options.includePrerelease ? re[t.COERCEFULL] : re[t.COERCE]);
      } else {
        const coerceRtlRegex = options.includePrerelease ? re[t.COERCERTLFULL] : re[t.COERCERTL];
        let next;
        while ((next = coerceRtlRegex.exec(version)) && (!match || match.index + match[0].length !== version.length)) {
          if (!match || next.index + next[0].length !== match.index + match[0].length) {
            match = next;
          }
          coerceRtlRegex.lastIndex = next.index + next[1].length + next[2].length;
        }
        coerceRtlRegex.lastIndex = -1;
      }
      if (match === null) {
        return null;
      }
      const major = match[2];
      const minor = match[3] || "0";
      const patch = match[4] || "0";
      const prerelease = options.includePrerelease && match[5] ? `-${match[5]}` : "";
      const build = options.includePrerelease && match[6] ? `+${match[6]}` : "";
      return parse(`${major}.${minor}.${patch}${prerelease}${build}`, options);
    };
    module.exports = coerce;
  }
});

// node_modules/semver/functions/truncate.js
var require_truncate = __commonJS({
  "node_modules/semver/functions/truncate.js"(exports, module) {
    "use strict";
    var parse = require_parse();
    var constants = require_constants();
    var SemVer = require_semver();
    var truncate = (version, truncation, options) => {
      if (!constants.RELEASE_TYPES.includes(truncation)) {
        return null;
      }
      const clonedVersion = cloneInputVersion(version, options);
      return clonedVersion && doTruncation(clonedVersion, truncation);
    };
    var cloneInputVersion = (version, options) => {
      const versionStringToParse = version instanceof SemVer ? version.version : version;
      return parse(versionStringToParse, options);
    };
    var doTruncation = (version, truncation) => {
      if (isPrerelease(truncation)) {
        return version.version;
      }
      version.prerelease = [];
      switch (truncation) {
        case "major":
          version.minor = 0;
          version.patch = 0;
          break;
        case "minor":
          version.patch = 0;
          break;
      }
      return version.format();
    };
    var isPrerelease = (type) => {
      return type.startsWith("pre");
    };
    module.exports = truncate;
  }
});

// node_modules/semver/internal/lrucache.js
var require_lrucache = __commonJS({
  "node_modules/semver/internal/lrucache.js"(exports, module) {
    "use strict";
    var LRUCache = class {
      constructor() {
        this.max = 1e3;
        this.map = /* @__PURE__ */ new Map();
      }
      get(key) {
        const value = this.map.get(key);
        if (value === void 0) {
          return void 0;
        } else {
          this.map.delete(key);
          this.map.set(key, value);
          return value;
        }
      }
      delete(key) {
        return this.map.delete(key);
      }
      set(key, value) {
        const deleted = this.delete(key);
        if (!deleted && value !== void 0) {
          if (this.map.size >= this.max) {
            const firstKey = this.map.keys().next().value;
            this.delete(firstKey);
          }
          this.map.set(key, value);
        }
        return this;
      }
    };
    module.exports = LRUCache;
  }
});

// node_modules/semver/classes/range.js
var require_range = __commonJS({
  "node_modules/semver/classes/range.js"(exports, module) {
    "use strict";
    var SPACE_CHARACTERS = /\s+/g;
    var Range = class _Range {
      constructor(range, options) {
        options = parseOptions(options);
        if (range instanceof _Range) {
          if (range.loose === !!options.loose && range.includePrerelease === !!options.includePrerelease) {
            return range;
          } else {
            return new _Range(range.raw, options);
          }
        }
        if (range instanceof Comparator) {
          this.raw = range.value;
          this.set = [[range]];
          this.formatted = void 0;
          return this;
        }
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        this.raw = range.trim().replace(SPACE_CHARACTERS, " ");
        this.set = this.raw.split("||").map((r) => this.parseRange(r.trim())).filter((c) => c.length);
        if (!this.set.length) {
          throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
        }
        if (this.set.length > 1) {
          const first = this.set[0];
          this.set = this.set.filter((c) => !isNullSet(c[0]));
          if (this.set.length === 0) {
            this.set = [first];
          } else if (this.set.length > 1) {
            for (const c of this.set) {
              if (c.length === 1 && isAny(c[0])) {
                this.set = [c];
                break;
              }
            }
          }
        }
        this.formatted = void 0;
      }
      get range() {
        if (this.formatted === void 0) {
          this.formatted = "";
          for (let i = 0; i < this.set.length; i++) {
            if (i > 0) {
              this.formatted += "||";
            }
            const comps = this.set[i];
            for (let k = 0; k < comps.length; k++) {
              if (k > 0) {
                this.formatted += " ";
              }
              this.formatted += comps[k].toString().trim();
            }
          }
        }
        return this.formatted;
      }
      format() {
        return this.range;
      }
      toString() {
        return this.range;
      }
      parseRange(range) {
        range = range.replace(BUILDSTRIPRE, "");
        const memoOpts = (this.options.includePrerelease && FLAG_INCLUDE_PRERELEASE) | (this.options.loose && FLAG_LOOSE);
        const memoKey = memoOpts + ":" + range;
        const cached = cache.get(memoKey);
        if (cached) {
          return cached;
        }
        const loose = this.options.loose;
        const hr = loose ? re[t.HYPHENRANGELOOSE] : re[t.HYPHENRANGE];
        range = range.replace(hr, hyphenReplace(this.options.includePrerelease));
        debug("hyphen replace", range);
        range = range.replace(re[t.COMPARATORTRIM], comparatorTrimReplace);
        debug("comparator trim", range);
        range = range.replace(re[t.TILDETRIM], tildeTrimReplace);
        debug("tilde trim", range);
        range = range.replace(re[t.CARETTRIM], caretTrimReplace);
        debug("caret trim", range);
        let rangeList = range.split(" ").map((comp) => parseComparator(comp, this.options)).join(" ").split(/\s+/).map((comp) => replaceGTE0(comp, this.options));
        if (loose) {
          rangeList = rangeList.filter((comp) => {
            debug("loose invalid filter", comp, this.options);
            return !!comp.match(re[t.COMPARATORLOOSE]);
          });
        }
        debug("range list", rangeList);
        const rangeMap = /* @__PURE__ */ new Map();
        const comparators = rangeList.map((comp) => new Comparator(comp, this.options));
        for (const comp of comparators) {
          if (isNullSet(comp)) {
            return [comp];
          }
          rangeMap.set(comp.value, comp);
        }
        if (rangeMap.size > 1 && rangeMap.has("")) {
          rangeMap.delete("");
        }
        const result = [...rangeMap.values()];
        cache.set(memoKey, result);
        return result;
      }
      intersects(range, options) {
        if (!(range instanceof _Range)) {
          throw new TypeError("a Range is required");
        }
        return this.set.some((thisComparators) => {
          return isSatisfiable(thisComparators, options) && range.set.some((rangeComparators) => {
            return isSatisfiable(rangeComparators, options) && thisComparators.every((thisComparator) => {
              return rangeComparators.every((rangeComparator) => {
                return thisComparator.intersects(rangeComparator, options);
              });
            });
          });
        });
      }
      // if ANY of the sets match ALL of its comparators, then pass
      test(version) {
        if (!version) {
          return false;
        }
        if (typeof version === "string") {
          try {
            version = new SemVer(version, this.options);
          } catch (er) {
            return false;
          }
        }
        for (let i = 0; i < this.set.length; i++) {
          if (testSet(this.set[i], version, this.options)) {
            return true;
          }
        }
        return false;
      }
    };
    module.exports = Range;
    var LRU = require_lrucache();
    var cache = new LRU();
    var parseOptions = require_parse_options();
    var Comparator = require_comparator();
    var debug = require_debug();
    var SemVer = require_semver();
    var {
      safeRe: re,
      src,
      t,
      comparatorTrimReplace,
      tildeTrimReplace,
      caretTrimReplace
    } = require_re();
    var { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = require_constants();
    var BUILDSTRIPRE = new RegExp(src[t.BUILD], "g");
    var isNullSet = (c) => c.value === "<0.0.0-0";
    var isAny = (c) => c.value === "";
    var isSatisfiable = (comparators, options) => {
      let result = true;
      const remainingComparators = comparators.slice();
      let testComparator = remainingComparators.pop();
      while (result && remainingComparators.length) {
        result = remainingComparators.every((otherComparator) => {
          return testComparator.intersects(otherComparator, options);
        });
        testComparator = remainingComparators.pop();
      }
      return result;
    };
    var parseComparator = (comp, options) => {
      comp = comp.replace(re[t.BUILD], "");
      debug("comp", comp, options);
      comp = replaceCarets(comp, options);
      debug("caret", comp);
      comp = replaceTildes(comp, options);
      debug("tildes", comp);
      comp = replaceXRanges(comp, options);
      debug("xrange", comp);
      comp = replaceStars(comp, options);
      debug("stars", comp);
      return comp;
    };
    var isX = (id) => !id || id.toLowerCase() === "x" || id === "*";
    var invalidXRangeOrder = (M, m, p) => isX(M) && !isX(m) || isX(m) && p && !isX(p);
    var replaceTildes = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceTilde(c, options)).join(" ");
    };
    var replaceTilde = (comp, options) => {
      const r = options.loose ? re[t.TILDELOOSE] : re[t.TILDE];
      const z = options.includePrerelease ? "-0" : "";
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("tilde", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
        } else if (pr) {
          debug("replaceTilde pr", pr);
          ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
        } else {
          ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
        }
        debug("tilde return", ret);
        return ret;
      });
    };
    var replaceCarets = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceCaret(c, options)).join(" ");
    };
    var replaceCaret = (comp, options) => {
      debug("caret", comp, options);
      const r = options.loose ? re[t.CARETLOOSE] : re[t.CARET];
      const z = options.includePrerelease ? "-0" : "";
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("caret", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          if (M === "0") {
            ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
          } else {
            ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
          }
        } else if (pr) {
          debug("replaceCaret pr", pr);
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
          }
        } else {
          debug("no pr");
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
          }
        }
        debug("caret return", ret);
        return ret;
      });
    };
    var replaceXRanges = (comp, options) => {
      debug("replaceXRanges", comp, options);
      return comp.split(/\s+/).map((c) => replaceXRange(c, options)).join(" ");
    };
    var replaceXRange = (comp, options) => {
      comp = comp.trim();
      const r = options.loose ? re[t.XRANGELOOSE] : re[t.XRANGE];
      return comp.replace(r, (ret, gtlt, M, m, p, pr) => {
        debug("xRange", comp, ret, gtlt, M, m, p, pr);
        if (invalidXRangeOrder(M, m, p)) {
          return comp;
        }
        const xM = isX(M);
        const xm = xM || isX(m);
        const xp = xm || isX(p);
        const anyX = xp;
        if (gtlt === "=" && anyX) {
          gtlt = "";
        }
        pr = options.includePrerelease ? "-0" : "";
        if (xM) {
          if (gtlt === ">" || gtlt === "<") {
            ret = "<0.0.0-0";
          } else {
            ret = "*";
          }
        } else if (gtlt && anyX) {
          if (xm) {
            m = 0;
          }
          p = 0;
          if (gtlt === ">") {
            gtlt = ">=";
            if (xm) {
              M = +M + 1;
              m = 0;
              p = 0;
            } else {
              m = +m + 1;
              p = 0;
            }
          } else if (gtlt === "<=") {
            gtlt = "<";
            if (xm) {
              M = +M + 1;
            } else {
              m = +m + 1;
            }
          }
          if (gtlt === "<") {
            pr = "-0";
          }
          ret = `${gtlt + M}.${m}.${p}${pr}`;
        } else if (xm) {
          ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
        } else if (xp) {
          ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
        }
        debug("xRange return", ret);
        return ret;
      });
    };
    var replaceStars = (comp, options) => {
      debug("replaceStars", comp, options);
      return comp.trim().replace(re[t.STAR], "");
    };
    var replaceGTE0 = (comp, options) => {
      debug("replaceGTE0", comp, options);
      return comp.trim().replace(re[options.includePrerelease ? t.GTE0PRE : t.GTE0], "");
    };
    var hyphenReplace = (incPr) => ($0, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr) => {
      if (isX(fM)) {
        from = "";
      } else if (isX(fm)) {
        from = `>=${fM}.0.0${incPr ? "-0" : ""}`;
      } else if (isX(fp)) {
        from = `>=${fM}.${fm}.0${incPr ? "-0" : ""}`;
      } else if (fpr) {
        from = `>=${from}`;
      } else {
        from = `>=${from}${incPr ? "-0" : ""}`;
      }
      if (isX(tM)) {
        to = "";
      } else if (isX(tm)) {
        to = `<${+tM + 1}.0.0-0`;
      } else if (isX(tp)) {
        to = `<${tM}.${+tm + 1}.0-0`;
      } else if (tpr) {
        to = `<=${tM}.${tm}.${tp}-${tpr}`;
      } else if (incPr) {
        to = `<${tM}.${tm}.${+tp + 1}-0`;
      } else {
        to = `<=${to}`;
      }
      return `${from} ${to}`.trim();
    };
    var testSet = (set, version, options) => {
      for (let i = 0; i < set.length; i++) {
        if (!set[i].test(version)) {
          return false;
        }
      }
      if (version.prerelease.length && !options.includePrerelease) {
        for (let i = 0; i < set.length; i++) {
          debug(set[i].semver);
          if (set[i].semver === Comparator.ANY) {
            continue;
          }
          if (set[i].semver.prerelease.length > 0) {
            const allowed = set[i].semver;
            if (allowed.major === version.major && allowed.minor === version.minor && allowed.patch === version.patch) {
              return true;
            }
          }
        }
        return false;
      }
      return true;
    };
  }
});

// node_modules/semver/classes/comparator.js
var require_comparator = __commonJS({
  "node_modules/semver/classes/comparator.js"(exports, module) {
    "use strict";
    var ANY = /* @__PURE__ */ Symbol("SemVer ANY");
    var Comparator = class _Comparator {
      static get ANY() {
        return ANY;
      }
      constructor(comp, options) {
        options = parseOptions(options);
        if (comp instanceof _Comparator) {
          if (comp.loose === !!options.loose) {
            return comp;
          } else {
            comp = comp.value;
          }
        }
        comp = comp.trim().split(/\s+/).join(" ");
        debug("comparator", comp, options);
        this.options = options;
        this.loose = !!options.loose;
        this.parse(comp);
        if (this.semver === ANY) {
          this.value = "";
        } else {
          this.value = this.operator + this.semver.version;
        }
        debug("comp", this);
      }
      parse(comp) {
        const r = this.options.loose ? re[t.COMPARATORLOOSE] : re[t.COMPARATOR];
        const m = comp.match(r);
        if (!m) {
          throw new TypeError(`Invalid comparator: ${comp}`);
        }
        this.operator = m[1] !== void 0 ? m[1] : "";
        if (this.operator === "=") {
          this.operator = "";
        }
        if (!m[2]) {
          this.semver = ANY;
        } else {
          this.semver = new SemVer(m[2], this.options.loose);
        }
      }
      toString() {
        return this.value;
      }
      test(version) {
        debug("Comparator.test", version, this.options.loose);
        if (this.semver === ANY || version === ANY) {
          return true;
        }
        if (typeof version === "string") {
          try {
            version = new SemVer(version, this.options);
          } catch (er) {
            return false;
          }
        }
        return cmp(version, this.operator, this.semver, this.options);
      }
      intersects(comp, options) {
        if (!(comp instanceof _Comparator)) {
          throw new TypeError("a Comparator is required");
        }
        if (this.operator === "") {
          if (this.value === "") {
            return true;
          }
          return new Range(comp.value, options).test(this.value);
        } else if (comp.operator === "") {
          if (comp.value === "") {
            return true;
          }
          return new Range(this.value, options).test(comp.semver);
        }
        options = parseOptions(options);
        if (options.includePrerelease && (this.value === "<0.0.0-0" || comp.value === "<0.0.0-0")) {
          return false;
        }
        if (!options.includePrerelease && (this.value.startsWith("<0.0.0") || comp.value.startsWith("<0.0.0"))) {
          return false;
        }
        if (this.operator.startsWith(">") && comp.operator.startsWith(">")) {
          return true;
        }
        if (this.operator.startsWith("<") && comp.operator.startsWith("<")) {
          return true;
        }
        if (this.semver.version === comp.semver.version && this.operator.includes("=") && comp.operator.includes("=")) {
          return true;
        }
        if (cmp(this.semver, "<", comp.semver, options) && this.operator.startsWith(">") && comp.operator.startsWith("<")) {
          return true;
        }
        if (cmp(this.semver, ">", comp.semver, options) && this.operator.startsWith("<") && comp.operator.startsWith(">")) {
          return true;
        }
        return false;
      }
    };
    module.exports = Comparator;
    var parseOptions = require_parse_options();
    var { safeRe: re, t } = require_re();
    var cmp = require_cmp();
    var debug = require_debug();
    var SemVer = require_semver();
    var Range = require_range();
  }
});

// node_modules/semver/functions/satisfies.js
var require_satisfies = __commonJS({
  "node_modules/semver/functions/satisfies.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var satisfies = (version, range, options) => {
      try {
        range = new Range(range, options);
      } catch (er) {
        return false;
      }
      return range.test(version);
    };
    module.exports = satisfies;
  }
});

// node_modules/semver/ranges/to-comparators.js
var require_to_comparators = __commonJS({
  "node_modules/semver/ranges/to-comparators.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var toComparators = (range, options) => new Range(range, options).set.map((comp) => comp.map((c) => c.value).join(" ").trim().split(" "));
    module.exports = toComparators;
  }
});

// node_modules/semver/ranges/max-satisfying.js
var require_max_satisfying = __commonJS({
  "node_modules/semver/ranges/max-satisfying.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var maxSatisfying = (versions, range, options) => {
      let max = null;
      let maxSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!max || maxSV.compare(v) === -1) {
            max = v;
            maxSV = new SemVer(max, options);
          }
        }
      });
      return max;
    };
    module.exports = maxSatisfying;
  }
});

// node_modules/semver/ranges/min-satisfying.js
var require_min_satisfying = __commonJS({
  "node_modules/semver/ranges/min-satisfying.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var minSatisfying = (versions, range, options) => {
      let min = null;
      let minSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!min || minSV.compare(v) === 1) {
            min = v;
            minSV = new SemVer(min, options);
          }
        }
      });
      return min;
    };
    module.exports = minSatisfying;
  }
});

// node_modules/semver/ranges/min-version.js
var require_min_version = __commonJS({
  "node_modules/semver/ranges/min-version.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var gt = require_gt();
    var minVersion = (range, loose) => {
      range = new Range(range, loose);
      let minver = new SemVer("0.0.0");
      if (range.test(minver)) {
        return minver;
      }
      minver = new SemVer("0.0.0-0");
      if (range.test(minver)) {
        return minver;
      }
      minver = null;
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let setMin = null;
        comparators.forEach((comparator) => {
          const compver = new SemVer(comparator.semver.version);
          switch (comparator.operator) {
            case ">":
              if (compver.prerelease.length === 0) {
                compver.patch++;
              } else {
                compver.prerelease.push(0);
              }
              compver.raw = compver.format();
            /* fallthrough */
            case "":
            case ">=":
              if (!setMin || gt(compver, setMin)) {
                setMin = compver;
              }
              break;
            case "<":
            case "<=":
              break;
            /* istanbul ignore next */
            default:
              throw new Error(`Unexpected operation: ${comparator.operator}`);
          }
        });
        if (setMin && (!minver || gt(minver, setMin))) {
          minver = setMin;
        }
      }
      if (minver && range.test(minver)) {
        return minver;
      }
      return null;
    };
    module.exports = minVersion;
  }
});

// node_modules/semver/ranges/valid.js
var require_valid2 = __commonJS({
  "node_modules/semver/ranges/valid.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var validRange = (range, options) => {
      try {
        return new Range(range, options).range || "*";
      } catch (er) {
        return null;
      }
    };
    module.exports = validRange;
  }
});

// node_modules/semver/ranges/outside.js
var require_outside = __commonJS({
  "node_modules/semver/ranges/outside.js"(exports, module) {
    "use strict";
    var SemVer = require_semver();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var Range = require_range();
    var satisfies = require_satisfies();
    var gt = require_gt();
    var lt = require_lt();
    var lte = require_lte();
    var gte = require_gte();
    var outside = (version, range, hilo, options) => {
      version = new SemVer(version, options);
      range = new Range(range, options);
      let gtfn, ltefn, ltfn, comp, ecomp;
      switch (hilo) {
        case ">":
          gtfn = gt;
          ltefn = lte;
          ltfn = lt;
          comp = ">";
          ecomp = ">=";
          break;
        case "<":
          gtfn = lt;
          ltefn = gte;
          ltfn = gt;
          comp = "<";
          ecomp = "<=";
          break;
        default:
          throw new TypeError('Must provide a hilo val of "<" or ">"');
      }
      if (satisfies(version, range, options)) {
        return false;
      }
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let high = null;
        let low = null;
        comparators.forEach((comparator) => {
          if (comparator.semver === ANY) {
            comparator = new Comparator(">=0.0.0");
          }
          high = high || comparator;
          low = low || comparator;
          if (gtfn(comparator.semver, high.semver, options)) {
            high = comparator;
          } else if (ltfn(comparator.semver, low.semver, options)) {
            low = comparator;
          }
        });
        if (high.operator === comp || high.operator === ecomp) {
          return false;
        }
        if ((!low.operator || low.operator === comp) && ltefn(version, low.semver)) {
          return false;
        } else if (low.operator === ecomp && ltfn(version, low.semver)) {
          return false;
        }
      }
      return true;
    };
    module.exports = outside;
  }
});

// node_modules/semver/ranges/gtr.js
var require_gtr = __commonJS({
  "node_modules/semver/ranges/gtr.js"(exports, module) {
    "use strict";
    var outside = require_outside();
    var gtr = (version, range, options) => outside(version, range, ">", options);
    module.exports = gtr;
  }
});

// node_modules/semver/ranges/ltr.js
var require_ltr = __commonJS({
  "node_modules/semver/ranges/ltr.js"(exports, module) {
    "use strict";
    var outside = require_outside();
    var ltr = (version, range, options) => outside(version, range, "<", options);
    module.exports = ltr;
  }
});

// node_modules/semver/ranges/intersects.js
var require_intersects = __commonJS({
  "node_modules/semver/ranges/intersects.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var intersects = (r1, r2, options) => {
      r1 = new Range(r1, options);
      r2 = new Range(r2, options);
      return r1.intersects(r2, options);
    };
    module.exports = intersects;
  }
});

// node_modules/semver/ranges/simplify.js
var require_simplify = __commonJS({
  "node_modules/semver/ranges/simplify.js"(exports, module) {
    "use strict";
    var satisfies = require_satisfies();
    var compare = require_compare();
    module.exports = (versions, range, options) => {
      const set = [];
      let first = null;
      let prev = null;
      const v = versions.sort((a, b) => compare(a, b, options));
      for (const version of v) {
        const included = satisfies(version, range, options);
        if (included) {
          prev = version;
          if (!first) {
            first = version;
          }
        } else {
          if (prev) {
            set.push([first, prev]);
          }
          prev = null;
          first = null;
        }
      }
      if (first) {
        set.push([first, null]);
      }
      const ranges = [];
      for (const [min, max] of set) {
        if (min === max) {
          ranges.push(min);
        } else if (!max && min === v[0]) {
          ranges.push("*");
        } else if (!max) {
          ranges.push(`>=${min}`);
        } else if (min === v[0]) {
          ranges.push(`<=${max}`);
        } else {
          ranges.push(`${min} - ${max}`);
        }
      }
      const simplified = ranges.join(" || ");
      const original = typeof range.raw === "string" ? range.raw : String(range);
      return simplified.length < original.length ? simplified : range;
    };
  }
});

// node_modules/semver/ranges/subset.js
var require_subset = __commonJS({
  "node_modules/semver/ranges/subset.js"(exports, module) {
    "use strict";
    var Range = require_range();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var satisfies = require_satisfies();
    var compare = require_compare();
    var subset = (sub, dom, options = {}) => {
      if (sub === dom) {
        return true;
      }
      sub = new Range(sub, options);
      dom = new Range(dom, options);
      let sawNonNull = false;
      OUTER: for (const simpleSub of sub.set) {
        for (const simpleDom of dom.set) {
          const isSub = simpleSubset(simpleSub, simpleDom, options);
          sawNonNull = sawNonNull || isSub !== null;
          if (isSub) {
            continue OUTER;
          }
        }
        if (sawNonNull) {
          return false;
        }
      }
      return true;
    };
    var minimumVersionWithPreRelease = [new Comparator(">=0.0.0-0")];
    var minimumVersion = [new Comparator(">=0.0.0")];
    var simpleSubset = (sub, dom, options) => {
      if (sub === dom) {
        return true;
      }
      if (sub.length === 1 && sub[0].semver === ANY) {
        if (dom.length === 1 && dom[0].semver === ANY) {
          return true;
        } else if (options.includePrerelease) {
          sub = minimumVersionWithPreRelease;
        } else {
          sub = minimumVersion;
        }
      }
      if (dom.length === 1 && dom[0].semver === ANY) {
        if (options.includePrerelease) {
          return true;
        } else {
          dom = minimumVersion;
        }
      }
      const eqSet = /* @__PURE__ */ new Set();
      let gt, lt;
      for (const c of sub) {
        if (c.operator === ">" || c.operator === ">=") {
          gt = higherGT(gt, c, options);
        } else if (c.operator === "<" || c.operator === "<=") {
          lt = lowerLT(lt, c, options);
        } else {
          eqSet.add(c.semver);
        }
      }
      if (eqSet.size > 1) {
        return null;
      }
      let gtltComp;
      if (gt && lt) {
        gtltComp = compare(gt.semver, lt.semver, options);
        if (gtltComp > 0) {
          return null;
        } else if (gtltComp === 0 && (gt.operator !== ">=" || lt.operator !== "<=")) {
          return null;
        }
      }
      for (const eq of eqSet) {
        if (gt && !satisfies(eq, String(gt), options)) {
          return null;
        }
        if (lt && !satisfies(eq, String(lt), options)) {
          return null;
        }
        for (const c of dom) {
          if (!satisfies(eq, String(c), options)) {
            return false;
          }
        }
        return true;
      }
      let higher, lower;
      let hasDomLT, hasDomGT;
      let needDomLTPre = lt && !options.includePrerelease && lt.semver.prerelease.length ? lt.semver : false;
      let needDomGTPre = gt && !options.includePrerelease && gt.semver.prerelease.length ? gt.semver : false;
      if (needDomLTPre && needDomLTPre.prerelease.length === 1 && lt.operator === "<" && needDomLTPre.prerelease[0] === 0) {
        needDomLTPre = false;
      }
      for (const c of dom) {
        hasDomGT = hasDomGT || c.operator === ">" || c.operator === ">=";
        hasDomLT = hasDomLT || c.operator === "<" || c.operator === "<=";
        if (gt) {
          if (needDomGTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomGTPre.major && c.semver.minor === needDomGTPre.minor && c.semver.patch === needDomGTPre.patch) {
              needDomGTPre = false;
            }
          }
          if (c.operator === ">" || c.operator === ">=") {
            higher = higherGT(gt, c, options);
            if (higher === c && higher !== gt) {
              return false;
            }
          } else if (gt.operator === ">=" && !c.test(gt.semver)) {
            return false;
          }
        }
        if (lt) {
          if (needDomLTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomLTPre.major && c.semver.minor === needDomLTPre.minor && c.semver.patch === needDomLTPre.patch) {
              needDomLTPre = false;
            }
          }
          if (c.operator === "<" || c.operator === "<=") {
            lower = lowerLT(lt, c, options);
            if (lower === c && lower !== lt) {
              return false;
            }
          } else if (lt.operator === "<=" && !c.test(lt.semver)) {
            return false;
          }
        }
        if (!c.operator && (lt || gt) && gtltComp !== 0) {
          return false;
        }
      }
      if (gt && hasDomLT && !lt && gtltComp !== 0) {
        return false;
      }
      if (lt && hasDomGT && !gt && gtltComp !== 0) {
        return false;
      }
      if (needDomGTPre || needDomLTPre) {
        return false;
      }
      return true;
    };
    var higherGT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare(a.semver, b.semver, options);
      return comp > 0 ? a : comp < 0 ? b : b.operator === ">" && a.operator === ">=" ? b : a;
    };
    var lowerLT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare(a.semver, b.semver, options);
      return comp < 0 ? a : comp > 0 ? b : b.operator === "<" && a.operator === "<=" ? b : a;
    };
    module.exports = subset;
  }
});

// node_modules/semver/index.js
var require_semver2 = __commonJS({
  "node_modules/semver/index.js"(exports, module) {
    "use strict";
    var internalRe = require_re();
    var constants = require_constants();
    var SemVer = require_semver();
    var identifiers = require_identifiers();
    var parse = require_parse();
    var valid = require_valid();
    var clean = require_clean();
    var inc = require_inc();
    var diff = require_diff();
    var major = require_major();
    var minor = require_minor();
    var patch = require_patch();
    var prerelease = require_prerelease();
    var compare = require_compare();
    var rcompare = require_rcompare();
    var compareLoose = require_compare_loose();
    var compareBuild = require_compare_build();
    var sort = require_sort();
    var rsort = require_rsort();
    var gt = require_gt();
    var lt = require_lt();
    var eq = require_eq();
    var neq = require_neq();
    var gte = require_gte();
    var lte = require_lte();
    var cmp = require_cmp();
    var coerce = require_coerce();
    var truncate = require_truncate();
    var Comparator = require_comparator();
    var Range = require_range();
    var satisfies = require_satisfies();
    var toComparators = require_to_comparators();
    var maxSatisfying = require_max_satisfying();
    var minSatisfying = require_min_satisfying();
    var minVersion = require_min_version();
    var validRange = require_valid2();
    var outside = require_outside();
    var gtr = require_gtr();
    var ltr = require_ltr();
    var intersects = require_intersects();
    var simplifyRange = require_simplify();
    var subset = require_subset();
    module.exports = {
      parse,
      valid,
      clean,
      inc,
      diff,
      major,
      minor,
      patch,
      prerelease,
      compare,
      rcompare,
      compareLoose,
      compareBuild,
      sort,
      rsort,
      gt,
      lt,
      eq,
      neq,
      gte,
      lte,
      cmp,
      coerce,
      truncate,
      Comparator,
      Range,
      satisfies,
      toComparators,
      maxSatisfying,
      minSatisfying,
      minVersion,
      validRange,
      outside,
      gtr,
      ltr,
      intersects,
      simplifyRange,
      subset,
      SemVer,
      re: internalRe.re,
      src: internalRe.src,
      tokens: internalRe.t,
      SEMVER_SPEC_VERSION: constants.SEMVER_SPEC_VERSION,
      RELEASE_TYPES: constants.RELEASE_TYPES,
      compareIdentifiers: identifiers.compareIdentifiers,
      rcompareIdentifiers: identifiers.rcompareIdentifiers
    };
  }
});

// node_modules/@metamask/superstruct/dist/error.cjs
var require_error = __commonJS({
  "node_modules/@metamask/superstruct/dist/error.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.StructError = void 0;
    var StructError = class extends TypeError {
      constructor(failure, failures) {
        let cached;
        const { message, explanation, ...rest } = failure;
        const { path } = failure;
        const cause = path.length === 0 ? message : `At path: ${path.join(".")} -- ${message}`;
        super(explanation ?? cause);
        if (explanation !== null && explanation !== void 0) {
          this.cause = cause;
        }
        Object.assign(this, rest);
        this.name = this.constructor.name;
        this.failures = () => {
          return cached ?? (cached = [failure, ...failures()]);
        };
      }
    };
    exports.StructError = StructError;
  }
});

// node_modules/@metamask/superstruct/dist/utils.cjs
var require_utils = __commonJS({
  "node_modules/@metamask/superstruct/dist/utils.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.run = exports.toFailures = exports.toFailure = exports.shiftIterator = exports.print = exports.isPlainObject = exports.isObject = void 0;
    function isIterable(value) {
      return isObject(value) && typeof value[Symbol.iterator] === "function";
    }
    function isObject(value) {
      return typeof value === "object" && value !== null;
    }
    exports.isObject = isObject;
    function isPlainObject(value) {
      if (Object.prototype.toString.call(value) !== "[object Object]") {
        return false;
      }
      const prototype = Object.getPrototypeOf(value);
      return prototype === null || prototype === Object.prototype;
    }
    exports.isPlainObject = isPlainObject;
    function print(value) {
      if (typeof value === "symbol") {
        return value.toString();
      }
      return typeof value === "string" ? JSON.stringify(value) : `${value}`;
    }
    exports.print = print;
    function shiftIterator(input) {
      const { done, value } = input.next();
      return done ? void 0 : value;
    }
    exports.shiftIterator = shiftIterator;
    function toFailure(result, context, struct, value) {
      if (result === true) {
        return void 0;
      } else if (result === false) {
        result = {};
      } else if (typeof result === "string") {
        result = { message: result };
      }
      const { path, branch } = context;
      const { type } = struct;
      const { refinement, message = `Expected a value of type \`${type}\`${refinement ? ` with refinement \`${refinement}\`` : ""}, but received: \`${print(value)}\`` } = result;
      return {
        value,
        type,
        refinement,
        key: path[path.length - 1],
        path,
        branch,
        ...result,
        message
      };
    }
    exports.toFailure = toFailure;
    function* toFailures(result, context, struct, value) {
      if (!isIterable(result)) {
        result = [result];
      }
      for (const validationResult of result) {
        const failure = toFailure(validationResult, context, struct, value);
        if (failure) {
          yield failure;
        }
      }
    }
    exports.toFailures = toFailures;
    function* run(value, struct, options = {}) {
      const { path = [], branch = [value], coerce = false, mask = false } = options;
      const context = { path, branch };
      if (coerce) {
        value = struct.coercer(value, context);
        if (mask && struct.type !== "type" && isObject(struct.schema) && isObject(value) && !Array.isArray(value)) {
          for (const key in value) {
            if (struct.schema[key] === void 0) {
              delete value[key];
            }
          }
        }
      }
      let status = "valid";
      for (const failure of struct.validator(value, context)) {
        failure.explanation = options.message;
        status = "not_valid";
        yield [failure, void 0];
      }
      for (let [innerKey, innerValue, innerStruct] of struct.entries(value, context)) {
        const iterable = run(innerValue, innerStruct, {
          path: innerKey === void 0 ? path : [...path, innerKey],
          branch: innerKey === void 0 ? branch : [...branch, innerValue],
          coerce,
          mask,
          message: options.message
        });
        for (const result of iterable) {
          if (result[0]) {
            status = result[0].refinement === null || result[0].refinement === void 0 ? "not_valid" : "not_refined";
            yield [result[0], void 0];
          } else if (coerce) {
            innerValue = result[1];
            if (innerKey === void 0) {
              value = innerValue;
            } else if (value instanceof Map) {
              value.set(innerKey, innerValue);
            } else if (value instanceof Set) {
              value.add(innerValue);
            } else if (isObject(value)) {
              if (innerValue !== void 0 || innerKey in value) {
                value[innerKey] = innerValue;
              }
            }
          }
        }
      }
      if (status !== "not_valid") {
        for (const failure of struct.refiner(value, context)) {
          failure.explanation = options.message;
          status = "not_refined";
          yield [failure, void 0];
        }
      }
      if (status === "valid") {
        yield [void 0, value];
      }
    }
    exports.run = run;
  }
});

// node_modules/@metamask/superstruct/dist/struct.cjs
var require_struct = __commonJS({
  "node_modules/@metamask/superstruct/dist/struct.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validate = exports.is = exports.mask = exports.create = exports.assert = exports.ExactOptionalStruct = exports.Struct = void 0;
    var error_js_1 = require_error();
    var utils_js_1 = require_utils();
    var Struct = class {
      constructor(props) {
        const { type, schema, validator, refiner, coercer = (value) => value, entries = function* () {
        } } = props;
        this.type = type;
        this.schema = schema;
        this.entries = entries;
        this.coercer = coercer;
        if (validator) {
          this.validator = (value, context) => {
            const result = validator(value, context);
            return (0, utils_js_1.toFailures)(result, context, this, value);
          };
        } else {
          this.validator = () => [];
        }
        if (refiner) {
          this.refiner = (value, context) => {
            const result = refiner(value, context);
            return (0, utils_js_1.toFailures)(result, context, this, value);
          };
        } else {
          this.refiner = () => [];
        }
        for (const sym of Object.getOwnPropertySymbols(props)) {
          Object.defineProperty(
            this,
            sym,
            // No need to check for undefined, since we are iterating over
            // `Object.getOwnPropertySymbols`.
            Object.getOwnPropertyDescriptor(props, sym)
          );
        }
      }
      /**
       * Assert that a value passes the struct's validation, throwing if it doesn't.
       */
      assert(value, message) {
        return assert(value, this, message);
      }
      /**
       * Create a value with the struct's coercion logic, then validate it.
       */
      create(value, message) {
        return create(value, this, message);
      }
      /**
       * Check if a value passes the struct's validation.
       */
      is(value) {
        return is(value, this);
      }
      /**
       * Mask a value, coercing and validating it, but returning only the subset of
       * properties defined by the struct's schema.
       */
      mask(value, message) {
        return mask(value, this, message);
      }
      /**
       * Validate a value with the struct's validation logic, returning a tuple
       * representing the result.
       *
       * You may optionally pass `true` for the `withCoercion` argument to coerce
       * the value before attempting to validate it. If you do, the result will
       * contain the coerced result when successful.
       */
      validate(value, options = {}) {
        return validate(value, this, options);
      }
    };
    exports.Struct = Struct;
    var ExactOptionalBrand = "EXACT_OPTIONAL";
    var ExactOptionalStruct = class extends Struct {
      constructor(props) {
        super({
          ...props,
          type: `exact optional ${props.type}`
        });
        this.brand = ExactOptionalBrand;
      }
      static isExactOptional(value) {
        return (0, utils_js_1.isObject)(value) && "brand" in value && value.brand === ExactOptionalBrand;
      }
    };
    exports.ExactOptionalStruct = ExactOptionalStruct;
    function assert(value, struct, message) {
      const result = validate(value, struct, { message });
      if (result[0]) {
        throw result[0];
      }
    }
    exports.assert = assert;
    function create(value, struct, message) {
      const result = validate(value, struct, { coerce: true, message });
      if (result[0]) {
        throw result[0];
      } else {
        return result[1];
      }
    }
    exports.create = create;
    function mask(value, struct, message) {
      const result = validate(value, struct, { coerce: true, mask: true, message });
      if (result[0]) {
        throw result[0];
      } else {
        return result[1];
      }
    }
    exports.mask = mask;
    function is(value, struct) {
      const result = validate(value, struct);
      return !result[0];
    }
    exports.is = is;
    function validate(value, struct, options = {}) {
      const tuples = (0, utils_js_1.run)(value, struct, options);
      const tuple = (0, utils_js_1.shiftIterator)(tuples);
      if (tuple[0]) {
        const error = new error_js_1.StructError(tuple[0], function* () {
          for (const innerTuple of tuples) {
            if (innerTuple[0]) {
              yield innerTuple[0];
            }
          }
        });
        return [error, void 0];
      }
      const validatedValue = tuple[1];
      return [void 0, validatedValue];
    }
    exports.validate = validate;
  }
});

// node_modules/@metamask/superstruct/dist/structs/sensitive.cjs
var require_sensitive = __commonJS({
  "node_modules/@metamask/superstruct/dist/structs/sensitive.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sensitive = exports.withRedactedBranch = exports.isSensitiveStruct = void 0;
    var struct_js_1 = require_struct();
    var utils_js_1 = require_utils();
    var SENSITIVE_REDACTED = "***";
    var SENSITIVE_BRAND = /* @__PURE__ */ Symbol.for("superstruct.sensitive");
    function isSensitiveStruct(struct) {
      return Object.prototype.hasOwnProperty.call(struct, SENSITIVE_BRAND);
    }
    exports.isSensitiveStruct = isSensitiveStruct;
    function redactKeys(sourceObj, keys) {
      const redacted = { ...sourceObj };
      for (const key of keys) {
        if (key in redacted) {
          redacted[key] = SENSITIVE_REDACTED;
        }
      }
      return redacted;
    }
    function wrapWithRedaction(struct) {
      function* redact(failures) {
        for (const failure of failures) {
          yield {
            ...failure,
            value: SENSITIVE_REDACTED,
            // We cannot safely preserve `failure.message` even for refiner
            // failures: a refiner that returns `false` gets a default message from
            // `toFailure` that embeds the raw value. There is no field on `Failure`
            // that distinguishes a custom refiner string from that generated
            // default, so preserving the original message risks leaking the
            // sensitive value. We rebuild the template from scratch, mirroring
            // `toFailure`'s own default, and include the refinement name when
            // present so callers can still tell which constraint failed.
            message: `Expected a value of type \`${struct.type}\`${failure.refinement ? ` with refinement \`${failure.refinement}\`` : ""}, but received: \`${SENSITIVE_REDACTED}\``,
            branch: new Array(failure.branch.length).fill(SENSITIVE_REDACTED)
          };
        }
      }
      return new struct_js_1.Struct({
        ...struct,
        validator(value, context) {
          return redact(struct.validator(value, context));
        },
        refiner(value, context) {
          return redact(struct.refiner(value, context));
        },
        *entries(value, context) {
          for (const [key, val, fieldStruct] of struct.entries(value, context)) {
            yield [key, val, wrapWithRedaction(fieldStruct)];
          }
        }
      });
    }
    function withRedactedBranch(struct, parentObj, sensitiveKeys) {
      function* redactBranch(failures) {
        for (const failure of failures) {
          if (!(0, utils_js_1.isObject)(parentObj)) {
            yield failure;
            continue;
          }
          const parentIndex = failure.branch.indexOf(parentObj);
          if (parentIndex === -1) {
            yield failure;
            continue;
          }
          const branch = [...failure.branch];
          branch[parentIndex] = redactKeys(parentObj, sensitiveKeys);
          for (let ancestorIndex = parentIndex - 1; ancestorIndex >= 0; ancestorIndex--) {
            const ancestor = branch[ancestorIndex];
            if (!(0, utils_js_1.isObject)(ancestor)) {
              break;
            }
            const child = failure.branch[ancestorIndex + 1];
            const childSanitized = branch[ancestorIndex + 1];
            if (Array.isArray(ancestor)) {
              const childIndex = ancestor.indexOf(child);
              if (childIndex === -1) {
                break;
              }
              const copy = [...ancestor];
              copy[childIndex] = childSanitized;
              branch[ancestorIndex] = copy;
            } else if (ancestor instanceof Map) {
              let childFound = false;
              let childKey;
              for (const [entryKey, entryValue] of ancestor) {
                if (entryValue === child) {
                  childKey = entryKey;
                  childFound = true;
                  break;
                }
              }
              if (!childFound) {
                break;
              }
              const copy = new Map(ancestor);
              copy.set(childKey, childSanitized);
              branch[ancestorIndex] = copy;
            } else {
              const childKey = Object.keys(ancestor).find((key) => ancestor[key] === child);
              if (childKey === void 0) {
                break;
              }
              branch[ancestorIndex] = { ...ancestor, [childKey]: childSanitized };
            }
          }
          yield { ...failure, branch };
        }
      }
      return new struct_js_1.Struct({
        ...struct,
        validator(value, context) {
          return redactBranch(struct.validator(value, context));
        },
        refiner(value, context) {
          return redactBranch(struct.refiner(value, context));
        },
        // Propagate branch redaction recursively so that failures originating from
        // any depth inside a sibling struct are also sanitised.
        *entries(value, context) {
          for (const entry of struct.entries(value, context)) {
            const [fieldKey, fieldValue, fieldStruct] = entry;
            yield [
              fieldKey,
              fieldValue,
              // `AnyStruct` is `Struct<any, any>`, while the tuple narrows only to
              // `Struct<any> | Struct<never>` (second generic left as `unknown`).
              // The cast is safe because both forms represent untyped structs at runtime.
              withRedactedBranch(fieldStruct, parentObj, sensitiveKeys)
            ];
          }
        }
      });
    }
    exports.withRedactedBranch = withRedactedBranch;
    function sensitive(struct) {
      const wrapped = wrapWithRedaction(struct);
      Object.defineProperty(wrapped, SENSITIVE_BRAND, {
        value: true,
        enumerable: true,
        configurable: true,
        writable: false
      });
      return wrapped;
    }
    exports.sensitive = sensitive;
  }
});

// node_modules/@metamask/superstruct/dist/structs/utilities.cjs
var require_utilities = __commonJS({
  "node_modules/@metamask/superstruct/dist/structs/utilities.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.pick = exports.partial = exports.omit = exports.lazy = exports.dynamic = exports.deprecated = exports.define = exports.assign = void 0;
    var struct_js_1 = require_struct();
    var types_js_1 = require_types();
    function assign(...Structs) {
      const isType = Structs[0]?.type === "type";
      const schemas = Structs.map(({ schema: schema2 }) => schema2);
      const schema = Object.assign({}, ...schemas);
      return isType ? (0, types_js_1.type)(schema) : (0, types_js_1.object)(schema);
    }
    exports.assign = assign;
    function define(name, validator) {
      return new struct_js_1.Struct({ type: name, schema: null, validator });
    }
    exports.define = define;
    function deprecated(struct, log) {
      return new struct_js_1.Struct({
        ...struct,
        refiner: (value, ctx) => value === void 0 || struct.refiner(value, ctx),
        validator(value, ctx) {
          if (value === void 0) {
            return true;
          }
          log(value, ctx);
          return struct.validator(value, ctx);
        }
      });
    }
    exports.deprecated = deprecated;
    function dynamic(fn) {
      return new struct_js_1.Struct({
        type: "dynamic",
        schema: null,
        *entries(value, ctx) {
          const struct = fn(value, ctx);
          yield* struct.entries(value, ctx);
        },
        validator(value, ctx) {
          const struct = fn(value, ctx);
          return struct.validator(value, ctx);
        },
        coercer(value, ctx) {
          const struct = fn(value, ctx);
          return struct.coercer(value, ctx);
        },
        refiner(value, ctx) {
          const struct = fn(value, ctx);
          return struct.refiner(value, ctx);
        }
      });
    }
    exports.dynamic = dynamic;
    function lazy(fn) {
      let struct;
      return new struct_js_1.Struct({
        type: "lazy",
        schema: null,
        *entries(value, ctx) {
          struct ?? (struct = fn());
          yield* struct.entries(value, ctx);
        },
        validator(value, ctx) {
          struct ?? (struct = fn());
          return struct.validator(value, ctx);
        },
        coercer(value, ctx) {
          struct ?? (struct = fn());
          return struct.coercer(value, ctx);
        },
        refiner(value, ctx) {
          struct ?? (struct = fn());
          return struct.refiner(value, ctx);
        }
      });
    }
    exports.lazy = lazy;
    function omit(struct, keys) {
      const { schema } = struct;
      const subschema = { ...schema };
      for (const key of keys) {
        delete subschema[key];
      }
      switch (struct.type) {
        case "type":
          return (0, types_js_1.type)(subschema);
        default:
          return (0, types_js_1.object)(subschema);
      }
    }
    exports.omit = omit;
    function partial(struct) {
      const isStruct = struct instanceof struct_js_1.Struct;
      const schema = isStruct ? { ...struct.schema } : { ...struct };
      for (const key in schema) {
        schema[key] = (0, types_js_1.optional)(schema[key]);
      }
      if (isStruct && struct.type === "type") {
        return (0, types_js_1.type)(schema);
      }
      return (0, types_js_1.object)(schema);
    }
    exports.partial = partial;
    function pick(struct, keys) {
      const { schema } = struct;
      const subschema = {};
      for (const key of keys) {
        subschema[key] = schema[key];
      }
      switch (struct.type) {
        case "type":
          return (0, types_js_1.type)(subschema);
        default:
          return (0, types_js_1.object)(subschema);
      }
    }
    exports.pick = pick;
  }
});

// node_modules/@metamask/superstruct/dist/structs/types.cjs
var require_types = __commonJS({
  "node_modules/@metamask/superstruct/dist/structs/types.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.unknown = exports.union = exports.type = exports.tuple = exports.string = exports.set = exports.regexp = exports.record = exports.exactOptional = exports.optional = exports.object = exports.number = exports.nullable = exports.never = exports.map = exports.literal = exports.intersection = exports.integer = exports.instance = exports.func = exports.enums = exports.date = exports.boolean = exports.bigint = exports.array = exports.any = void 0;
    var struct_js_1 = require_struct();
    var utils_js_1 = require_utils();
    var sensitive_js_1 = require_sensitive();
    var utilities_js_1 = require_utilities();
    function withSensitiveEntries(base, schema) {
      const sensitiveKeys = Object.keys(schema).filter(
        // `noUncheckedIndexedAccess` makes `schema[key]` return `AnyStruct |
        // undefined`. After the `!== undefined` guard, TypeScript still treats the
        // second `schema[key]` access as potentially undefined (it does not
        // re-narrow repeated index reads), so the cast to `AnyStruct` is required.
        (key) => schema[key] !== void 0 && (0, sensitive_js_1.isSensitiveStruct)(schema[key])
      );
      if (sensitiveKeys.length === 0) {
        return base;
      }
      return new struct_js_1.Struct({
        ...base,
        *entries(value, context) {
          const parentInBranch = context.branch[context.branch.length - 1] ?? value;
          for (const entry of base.entries(value, context)) {
            const [fieldKey, fieldValue, fieldStruct] = entry;
            yield [
              fieldKey,
              fieldValue,
              (0, sensitive_js_1.withRedactedBranch)(fieldStruct, parentInBranch, sensitiveKeys)
            ];
          }
        }
      });
    }
    function any() {
      return (0, utilities_js_1.define)("any", () => true);
    }
    exports.any = any;
    function array(Element) {
      return new struct_js_1.Struct({
        type: "array",
        schema: Element,
        *entries(value) {
          if (Element && Array.isArray(value)) {
            for (const [index, arrayValue] of value.entries()) {
              yield [index, arrayValue, Element];
            }
          }
        },
        coercer(value) {
          return Array.isArray(value) ? value.slice() : value;
        },
        validator(value) {
          return Array.isArray(value) || `Expected an array value, but received: ${(0, utils_js_1.print)(value)}`;
        }
      });
    }
    exports.array = array;
    function bigint() {
      return (0, utilities_js_1.define)("bigint", (value) => {
        return typeof value === "bigint";
      });
    }
    exports.bigint = bigint;
    function boolean() {
      return (0, utilities_js_1.define)("boolean", (value) => {
        return typeof value === "boolean";
      });
    }
    exports.boolean = boolean;
    function date() {
      return (0, utilities_js_1.define)("date", (value) => {
        return value instanceof Date && !isNaN(value.getTime()) || `Expected a valid \`Date\` object, but received: ${(0, utils_js_1.print)(value)}`;
      });
    }
    exports.date = date;
    function enums(values) {
      const schema = {};
      const description = values.map((value) => (0, utils_js_1.print)(value)).join();
      for (const key of values) {
        schema[key] = key;
      }
      return new struct_js_1.Struct({
        type: "enums",
        schema,
        validator(value) {
          return values.includes(value) || `Expected one of \`${description}\`, but received: ${(0, utils_js_1.print)(value)}`;
        }
      });
    }
    exports.enums = enums;
    function func() {
      return (0, utilities_js_1.define)("func", (value) => {
        return typeof value === "function" || `Expected a function, but received: ${(0, utils_js_1.print)(value)}`;
      });
    }
    exports.func = func;
    function instance(Class) {
      return (0, utilities_js_1.define)("instance", (value) => {
        return value instanceof Class || `Expected a \`${Class.name}\` instance, but received: ${(0, utils_js_1.print)(value)}`;
      });
    }
    exports.instance = instance;
    function integer() {
      return (0, utilities_js_1.define)("integer", (value) => {
        return typeof value === "number" && !isNaN(value) && Number.isInteger(value) || `Expected an integer, but received: ${(0, utils_js_1.print)(value)}`;
      });
    }
    exports.integer = integer;
    function intersection(Structs) {
      return new struct_js_1.Struct({
        type: "intersection",
        schema: null,
        *entries(value, context) {
          for (const { entries } of Structs) {
            yield* entries(value, context);
          }
        },
        *validator(value, context) {
          for (const { validator } of Structs) {
            yield* validator(value, context);
          }
        },
        *refiner(value, context) {
          for (const { refiner } of Structs) {
            yield* refiner(value, context);
          }
        }
      });
    }
    exports.intersection = intersection;
    function literal(constant) {
      const description = (0, utils_js_1.print)(constant);
      const valueType = typeof constant;
      return new struct_js_1.Struct({
        type: "literal",
        schema: valueType === "string" || valueType === "number" || valueType === "boolean" ? constant : null,
        validator(value) {
          return value === constant || `Expected the literal \`${description}\`, but received: ${(0, utils_js_1.print)(value)}`;
        }
      });
    }
    exports.literal = literal;
    function map(Key, Value) {
      return new struct_js_1.Struct({
        type: "map",
        schema: null,
        *entries(value) {
          if (Key && Value && value instanceof Map) {
            for (const [mapKey, mapValue] of value.entries()) {
              yield [mapKey, mapKey, Key];
              yield [mapKey, mapValue, Value];
            }
          }
        },
        coercer(value) {
          return value instanceof Map ? new Map(value) : value;
        },
        validator(value) {
          return value instanceof Map || `Expected a \`Map\` object, but received: ${(0, utils_js_1.print)(value)}`;
        }
      });
    }
    exports.map = map;
    function never() {
      return (0, utilities_js_1.define)("never", () => false);
    }
    exports.never = never;
    function nullable(struct) {
      return new struct_js_1.Struct({
        ...struct,
        validator: (value, ctx) => value === null || struct.validator(value, ctx),
        refiner: (value, ctx) => value === null || struct.refiner(value, ctx)
      });
    }
    exports.nullable = nullable;
    function number() {
      return (0, utilities_js_1.define)("number", (value) => {
        return typeof value === "number" && !isNaN(value) || `Expected a number, but received: ${(0, utils_js_1.print)(value)}`;
      });
    }
    exports.number = number;
    function object(schema) {
      const knowns = schema ? Object.keys(schema) : [];
      const Never = never();
      const base = new struct_js_1.Struct({
        type: "object",
        schema: schema ?? null,
        *entries(value) {
          if (schema && (0, utils_js_1.isObject)(value)) {
            const unknowns = new Set(Object.keys(value));
            for (const key of knowns) {
              unknowns.delete(key);
              const propertySchema = schema[key];
              if (struct_js_1.ExactOptionalStruct.isExactOptional(propertySchema) && !Object.prototype.hasOwnProperty.call(value, key)) {
                continue;
              }
              yield [key, value[key], schema[key]];
            }
            for (const key of unknowns) {
              yield [key, value[key], Never];
            }
          }
        },
        validator(value) {
          return (0, utils_js_1.isObject)(value) || `Expected an object, but received: ${(0, utils_js_1.print)(value)}`;
        },
        coercer(value) {
          return (0, utils_js_1.isObject)(value) ? { ...value } : value;
        }
      });
      if (!schema) {
        return base;
      }
      return withSensitiveEntries(base, schema);
    }
    exports.object = object;
    function optional(struct) {
      return new struct_js_1.Struct({
        ...struct,
        validator: (value, ctx) => value === void 0 || struct.validator(value, ctx),
        refiner: (value, ctx) => value === void 0 || struct.refiner(value, ctx)
      });
    }
    exports.optional = optional;
    function exactOptional(struct) {
      return new struct_js_1.ExactOptionalStruct(struct);
    }
    exports.exactOptional = exactOptional;
    function record(Key, Value) {
      return new struct_js_1.Struct({
        type: "record",
        schema: null,
        *entries(value) {
          if ((0, utils_js_1.isObject)(value)) {
            for (const objectKey in value) {
              const objectValue = value[objectKey];
              yield [objectKey, objectKey, Key];
              yield [objectKey, objectValue, Value];
            }
          }
        },
        validator(value) {
          return (0, utils_js_1.isObject)(value) || `Expected an object, but received: ${(0, utils_js_1.print)(value)}`;
        }
      });
    }
    exports.record = record;
    function regexp() {
      return (0, utilities_js_1.define)("regexp", (value) => {
        return value instanceof RegExp;
      });
    }
    exports.regexp = regexp;
    function set(Element) {
      return new struct_js_1.Struct({
        type: "set",
        schema: null,
        *entries(value) {
          if (Element && value instanceof Set) {
            for (const setValue of value) {
              yield [setValue, setValue, Element];
            }
          }
        },
        coercer(value) {
          return value instanceof Set ? new Set(value) : value;
        },
        validator(value) {
          return value instanceof Set || `Expected a \`Set\` object, but received: ${(0, utils_js_1.print)(value)}`;
        }
      });
    }
    exports.set = set;
    function string() {
      return (0, utilities_js_1.define)("string", (value) => {
        return typeof value === "string" || `Expected a string, but received: ${(0, utils_js_1.print)(value)}`;
      });
    }
    exports.string = string;
    function tuple(Structs) {
      const Never = never();
      return new struct_js_1.Struct({
        type: "tuple",
        schema: null,
        *entries(value) {
          if (Array.isArray(value)) {
            const length = Math.max(Structs.length, value.length);
            for (let i = 0; i < length; i++) {
              yield [i, value[i], Structs[i] || Never];
            }
          }
        },
        validator(value) {
          return Array.isArray(value) || `Expected an array, but received: ${(0, utils_js_1.print)(value)}`;
        }
      });
    }
    exports.tuple = tuple;
    function type(schema) {
      const keys = Object.keys(schema);
      const base = new struct_js_1.Struct({
        type: "type",
        schema,
        *entries(value) {
          if ((0, utils_js_1.isObject)(value)) {
            for (const k of keys) {
              if (struct_js_1.ExactOptionalStruct.isExactOptional(schema[k]) && !Object.prototype.hasOwnProperty.call(value, k)) {
                continue;
              }
              yield [k, value[k], schema[k]];
            }
          }
        },
        validator(value) {
          return (0, utils_js_1.isObject)(value) || `Expected an object, but received: ${(0, utils_js_1.print)(value)}`;
        },
        coercer(value) {
          return (0, utils_js_1.isObject)(value) ? { ...value } : value;
        }
      });
      return withSensitiveEntries(base, schema);
    }
    exports.type = type;
    function union(Structs) {
      const description = Structs.map((struct) => struct.type).join(" | ");
      return new struct_js_1.Struct({
        type: "union",
        schema: null,
        coercer(value) {
          for (const InnerStruct of Structs) {
            const [error, coerced] = InnerStruct.validate(value, { coerce: true });
            if (!error) {
              return coerced;
            }
          }
          return value;
        },
        validator(value, ctx) {
          const failures = [];
          for (const InnerStruct of Structs) {
            const [...tuples] = (0, utils_js_1.run)(value, InnerStruct, ctx);
            const [first] = tuples;
            if (!first?.[0]) {
              return [];
            }
            for (const [failure] of tuples) {
              if (failure) {
                failures.push(failure);
              }
            }
          }
          return [
            `Expected the value to satisfy a union of \`${description}\`, but received: ${(0, utils_js_1.print)(value)}`,
            ...failures
          ];
        }
      });
    }
    exports.union = union;
    function unknown() {
      return (0, utilities_js_1.define)("unknown", () => true);
    }
    exports.unknown = unknown;
  }
});

// node_modules/@metamask/superstruct/dist/structs/coercions.cjs
var require_coercions = __commonJS({
  "node_modules/@metamask/superstruct/dist/structs/coercions.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.trimmed = exports.defaulted = exports.coerce = void 0;
    var struct_js_1 = require_struct();
    var utils_js_1 = require_utils();
    var types_js_1 = require_types();
    function coerce(struct, condition, coercer) {
      return new struct_js_1.Struct({
        ...struct,
        coercer: (value, ctx) => {
          return (0, struct_js_1.is)(value, condition) ? struct.coercer(coercer(value, ctx), ctx) : struct.coercer(value, ctx);
        }
      });
    }
    exports.coerce = coerce;
    function defaulted(struct, fallback, options = {}) {
      return coerce(struct, (0, types_js_1.unknown)(), (value) => {
        const result = typeof fallback === "function" ? fallback() : fallback;
        if (value === void 0) {
          return result;
        }
        if (!options.strict && (0, utils_js_1.isPlainObject)(value) && (0, utils_js_1.isPlainObject)(result)) {
          const ret = { ...value };
          let changed = false;
          for (const key in result) {
            if (ret[key] === void 0) {
              ret[key] = result[key];
              changed = true;
            }
          }
          if (changed) {
            return ret;
          }
        }
        return value;
      });
    }
    exports.defaulted = defaulted;
    function trimmed(struct) {
      return coerce(struct, (0, types_js_1.string)(), (value) => value.trim());
    }
    exports.trimmed = trimmed;
  }
});

// node_modules/@metamask/superstruct/dist/structs/refinements.cjs
var require_refinements = __commonJS({
  "node_modules/@metamask/superstruct/dist/structs/refinements.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.refine = exports.size = exports.pattern = exports.nonempty = exports.min = exports.max = exports.empty = void 0;
    var struct_js_1 = require_struct();
    var utils_js_1 = require_utils();
    function empty(struct) {
      return refine(struct, "empty", (value) => {
        const size2 = getSize(value);
        return size2 === 0 || `Expected an empty ${struct.type} but received one with a size of \`${size2}\``;
      });
    }
    exports.empty = empty;
    function getSize(value) {
      if (value instanceof Map || value instanceof Set) {
        return value.size;
      }
      return value.length;
    }
    function max(struct, threshold, options = {}) {
      const { exclusive } = options;
      return refine(struct, "max", (value) => {
        return exclusive ? value < threshold : value <= threshold || `Expected a ${struct.type} less than ${exclusive ? "" : "or equal to "}${threshold} but received \`${value}\``;
      });
    }
    exports.max = max;
    function min(struct, threshold, options = {}) {
      const { exclusive } = options;
      return refine(struct, "min", (value) => {
        return exclusive ? value > threshold : value >= threshold || `Expected a ${struct.type} greater than ${exclusive ? "" : "or equal to "}${threshold} but received \`${value}\``;
      });
    }
    exports.min = min;
    function nonempty(struct) {
      return refine(struct, "nonempty", (value) => {
        const size2 = getSize(value);
        return size2 > 0 || `Expected a nonempty ${struct.type} but received an empty one`;
      });
    }
    exports.nonempty = nonempty;
    function pattern(struct, regexp) {
      return refine(struct, "pattern", (value) => {
        return regexp.test(value) || `Expected a ${struct.type} matching \`/${regexp.source}/\` but received "${value}"`;
      });
    }
    exports.pattern = pattern;
    function size(struct, minimum, maximum = minimum) {
      const expected = `Expected a ${struct.type}`;
      const of = minimum === maximum ? `of \`${minimum}\`` : `between \`${minimum}\` and \`${maximum}\``;
      return refine(struct, "size", (value) => {
        if (typeof value === "number" || value instanceof Date) {
          return minimum <= value && value <= maximum || // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          `${expected} ${of} but received \`${value}\``;
        } else if (value instanceof Map || value instanceof Set) {
          const { size: size2 } = value;
          return minimum <= size2 && size2 <= maximum || `${expected} with a size ${of} but received one with a size of \`${size2}\``;
        }
        const { length } = value;
        return minimum <= length && length <= maximum || `${expected} with a length ${of} but received one with a length of \`${length}\``;
      });
    }
    exports.size = size;
    function refine(struct, name, refiner) {
      return new struct_js_1.Struct({
        ...struct,
        *refiner(value, ctx) {
          yield* struct.refiner(value, ctx);
          const result = refiner(value, ctx);
          const failures = (0, utils_js_1.toFailures)(result, ctx, struct, value);
          for (const failure of failures) {
            yield { ...failure, refinement: name };
          }
        }
      });
    }
    exports.refine = refine;
  }
});

// node_modules/@metamask/superstruct/dist/index.cjs
var require_dist = __commonJS({
  "node_modules/@metamask/superstruct/dist/index.cjs"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_error(), exports);
    __exportStar(require_struct(), exports);
    __exportStar(require_coercions(), exports);
    __exportStar(require_refinements(), exports);
    __exportStar(require_sensitive(), exports);
    __exportStar(require_types(), exports);
    __exportStar(require_utilities(), exports);
  }
});

// node_modules/pony-cause/lib/error-with-cause.js
var require_error_with_cause = __commonJS({
  "node_modules/pony-cause/lib/error-with-cause.js"(exports, module) {
    "use strict";
    var ErrorWithCause = class _ErrorWithCause extends Error {
      // linemod-prefix-with: export
      /**
       * @param {string} message
       * @param {{ cause?: T }} options
       */
      constructor(message, { cause } = {}) {
        super(message);
        this.name = _ErrorWithCause.name;
        if (cause) {
          this.cause = cause;
        }
        this.message = message;
      }
    };
    module.exports = {
      // linemod-remove
      ErrorWithCause
      // linemod-remove
    };
  }
});

// node_modules/pony-cause/lib/helpers.js
var require_helpers = __commonJS({
  "node_modules/pony-cause/lib/helpers.js"(exports, module) {
    "use strict";
    var findCauseByReference = (err, reference) => {
      if (!err || !reference) return;
      if (!(err instanceof Error)) return;
      if (!(reference.prototype instanceof Error) && // @ts-ignore
      reference !== Error) return;
      const seen = /* @__PURE__ */ new Set();
      let currentErr = err;
      while (currentErr && !seen.has(currentErr)) {
        seen.add(currentErr);
        if (currentErr instanceof reference) {
          return currentErr;
        }
        currentErr = getErrorCause(currentErr);
      }
    };
    var getErrorCause = (err) => {
      if (!err || typeof err !== "object" || !("cause" in err)) {
        return;
      }
      if (typeof err.cause === "function") {
        const causeResult = err.cause();
        return causeResult instanceof Error ? causeResult : void 0;
      } else {
        return err.cause instanceof Error ? err.cause : void 0;
      }
    };
    var _stackWithCauses = (err, seen) => {
      if (!(err instanceof Error)) return "";
      const stack = err.stack || "";
      if (seen.has(err)) {
        return stack + "\ncauses have become circular...";
      }
      const cause = getErrorCause(err);
      if (cause) {
        seen.add(err);
        return stack + "\ncaused by: " + _stackWithCauses(cause, seen);
      } else {
        return stack;
      }
    };
    var stackWithCauses = (err) => _stackWithCauses(err, /* @__PURE__ */ new Set());
    var _messageWithCauses = (err, seen, skip) => {
      if (!(err instanceof Error)) return "";
      const message = skip ? "" : err.message || "";
      if (seen.has(err)) {
        return message + ": ...";
      }
      const cause = getErrorCause(err);
      if (cause) {
        seen.add(err);
        const skipIfVErrorStyleCause = "cause" in err && typeof err.cause === "function";
        return message + (skipIfVErrorStyleCause ? "" : ": ") + _messageWithCauses(cause, seen, skipIfVErrorStyleCause);
      } else {
        return message;
      }
    };
    var messageWithCauses = (err) => _messageWithCauses(err, /* @__PURE__ */ new Set());
    module.exports = {
      // linemod-remove
      findCauseByReference,
      // linemod-remove
      getErrorCause,
      // linemod-remove
      stackWithCauses,
      // linemod-remove
      messageWithCauses
      // linemod-remove
    };
  }
});

// node_modules/pony-cause/index.js
var require_pony_cause = __commonJS({
  "node_modules/pony-cause/index.js"(exports, module) {
    "use strict";
    var { ErrorWithCause } = require_error_with_cause();
    var {
      // linemod-replace-with: export {
      findCauseByReference,
      getErrorCause,
      messageWithCauses,
      stackWithCauses
    } = require_helpers();
    module.exports = {
      // linemod-remove
      ErrorWithCause,
      // linemod-remove
      findCauseByReference,
      // linemod-remove
      getErrorCause,
      // linemod-remove
      stackWithCauses,
      // linemod-remove
      messageWithCauses
      // linemod-remove
    };
  }
});

// node_modules/@metamask/utils/dist/misc.cjs
var require_misc = __commonJS({
  "node_modules/@metamask/utils/dist/misc.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.calculateNumberSize = exports.calculateStringSize = exports.isASCII = exports.isPlainObject = exports.ESCAPE_CHARACTERS_REGEXP = exports.JsonSize = exports.getKnownPropertyNames = exports.hasProperty = exports.isObject = exports.isNullOrUndefined = exports.isNonEmptyArray = void 0;
    function isNonEmptyArray(value) {
      return Array.isArray(value) && value.length > 0;
    }
    exports.isNonEmptyArray = isNonEmptyArray;
    function isNullOrUndefined(value) {
      return value === null || value === void 0;
    }
    exports.isNullOrUndefined = isNullOrUndefined;
    function isObject(value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }
    exports.isObject = isObject;
    var hasProperty = (objectToCheck, name) => Object.hasOwnProperty.call(objectToCheck, name);
    exports.hasProperty = hasProperty;
    function getKnownPropertyNames(object) {
      return Object.getOwnPropertyNames(object);
    }
    exports.getKnownPropertyNames = getKnownPropertyNames;
    var JsonSize;
    (function(JsonSize2) {
      JsonSize2[JsonSize2["Null"] = 4] = "Null";
      JsonSize2[JsonSize2["Comma"] = 1] = "Comma";
      JsonSize2[JsonSize2["Wrapper"] = 1] = "Wrapper";
      JsonSize2[JsonSize2["True"] = 4] = "True";
      JsonSize2[JsonSize2["False"] = 5] = "False";
      JsonSize2[JsonSize2["Quote"] = 1] = "Quote";
      JsonSize2[JsonSize2["Colon"] = 1] = "Colon";
      JsonSize2[JsonSize2["Date"] = 24] = "Date";
    })(JsonSize = exports.JsonSize || (exports.JsonSize = {}));
    exports.ESCAPE_CHARACTERS_REGEXP = /"|\\|\n|\r|\t/gu;
    function isPlainObject(value) {
      if (typeof value !== "object" || value === null) {
        return false;
      }
      try {
        let proto = value;
        while (Object.getPrototypeOf(proto) !== null) {
          proto = Object.getPrototypeOf(proto);
        }
        return Object.getPrototypeOf(value) === proto;
      } catch (_) {
        return false;
      }
    }
    exports.isPlainObject = isPlainObject;
    function isASCII(character) {
      return character.charCodeAt(0) <= 127;
    }
    exports.isASCII = isASCII;
    function calculateStringSize(value) {
      const size = value.split("").reduce((total, character) => {
        if (isASCII(character)) {
          return total + 1;
        }
        return total + 2;
      }, 0);
      return size + (value.match(exports.ESCAPE_CHARACTERS_REGEXP) ?? []).length;
    }
    exports.calculateStringSize = calculateStringSize;
    function calculateNumberSize(value) {
      return value.toString().length;
    }
    exports.calculateNumberSize = calculateNumberSize;
  }
});

// node_modules/@metamask/utils/dist/errors.cjs
var require_errors = __commonJS({
  "node_modules/@metamask/utils/dist/errors.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ensureError = exports.wrapError = exports.getErrorMessage = exports.isErrorWithStack = exports.isErrorWithMessage = exports.isErrorWithCode = void 0;
    var pony_cause_1 = require_pony_cause();
    var misc_1 = require_misc();
    function isError(error) {
      return error instanceof Error || (0, misc_1.isObject)(error) && error.constructor.name === "Error";
    }
    function isErrorWithCode(error) {
      return typeof error === "object" && error !== null && "code" in error;
    }
    exports.isErrorWithCode = isErrorWithCode;
    function isErrorWithMessage(error) {
      return typeof error === "object" && error !== null && "message" in error;
    }
    exports.isErrorWithMessage = isErrorWithMessage;
    function isErrorWithStack(error) {
      return typeof error === "object" && error !== null && "stack" in error;
    }
    exports.isErrorWithStack = isErrorWithStack;
    function getErrorMessage(error) {
      if (isErrorWithMessage(error) && typeof error.message === "string") {
        return error.message;
      }
      if ((0, misc_1.isNullOrUndefined)(error)) {
        return "";
      }
      return String(error);
    }
    exports.getErrorMessage = getErrorMessage;
    function wrapError(originalError, message) {
      if (isError(originalError)) {
        let error;
        if (Error.length === 2) {
          error = new Error(message, { cause: originalError });
        } else {
          error = new pony_cause_1.ErrorWithCause(message, { cause: originalError });
        }
        if (isErrorWithCode(originalError)) {
          error.code = originalError.code;
        }
        return error;
      }
      if (message.length > 0) {
        return new Error(`${String(originalError)}: ${message}`);
      }
      return new Error(String(originalError));
    }
    exports.wrapError = wrapError;
    function ensureError(error) {
      if (isError(error)) {
        return error;
      }
      const newError = new Error("Unknown error");
      newError.cause = error;
      return newError;
    }
    exports.ensureError = ensureError;
  }
});

// node_modules/@metamask/utils/dist/assert.cjs
var require_assert = __commonJS({
  "node_modules/@metamask/utils/dist/assert.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.assertExhaustive = exports.assertStruct = exports.assert = exports.AssertionError = void 0;
    var superstruct_1 = require_dist();
    var errors_1 = require_errors();
    function isConstructable(fn) {
      return Boolean(typeof fn?.prototype?.constructor?.name === "string");
    }
    function getErrorMessageWithoutTrailingPeriod(error) {
      return (0, errors_1.getErrorMessage)(error).replace(/\.$/u, "");
    }
    function getError(ErrorWrapper, message) {
      if (isConstructable(ErrorWrapper)) {
        return new ErrorWrapper({
          message
        });
      }
      return ErrorWrapper({
        message
      });
    }
    var AssertionError = class extends Error {
      constructor(options) {
        super(options.message);
        this.code = "ERR_ASSERTION";
      }
    };
    exports.AssertionError = AssertionError;
    function assert(value, message = "Assertion failed.", ErrorWrapper = AssertionError) {
      if (!value) {
        if (message instanceof Error) {
          throw message;
        }
        throw getError(ErrorWrapper, message);
      }
    }
    exports.assert = assert;
    function assertStruct(value, struct, errorPrefix = "Assertion failed", ErrorWrapper = AssertionError) {
      try {
        (0, superstruct_1.assert)(value, struct);
      } catch (error) {
        throw getError(ErrorWrapper, `${errorPrefix}: ${getErrorMessageWithoutTrailingPeriod(error)}.`);
      }
    }
    exports.assertStruct = assertStruct;
    function assertExhaustive(_object) {
      throw new Error("Invalid branch reached. Should be detected during compilation.");
    }
    exports.assertExhaustive = assertExhaustive;
  }
});

// node_modules/@metamask/utils/dist/base64.cjs
var require_base64 = __commonJS({
  "node_modules/@metamask/utils/dist/base64.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.base64 = void 0;
    var superstruct_1 = require_dist();
    var assert_1 = require_assert();
    var base64 = (struct, options = {}) => {
      const paddingRequired = options.paddingRequired ?? false;
      const characterSet = options.characterSet ?? "base64";
      let letters;
      if (characterSet === "base64") {
        letters = String.raw`[A-Za-z0-9+\/]`;
      } else {
        (0, assert_1.assert)(characterSet === "base64url");
        letters = String.raw`[-_A-Za-z0-9]`;
      }
      let re;
      if (paddingRequired) {
        re = new RegExp(`^(?:${letters}{4})*(?:${letters}{3}=|${letters}{2}==)?$`, "u");
      } else {
        re = new RegExp(`^(?:${letters}{4})*(?:${letters}{2,3}|${letters}{3}=|${letters}{2}==)?$`, "u");
      }
      return (0, superstruct_1.pattern)(struct, re);
    };
    exports.base64 = base64;
  }
});

// node_modules/@scure/base/lib/index.js
var require_lib = __commonJS({
  "node_modules/@scure/base/lib/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.bytes = exports.stringToBytes = exports.str = exports.bytesToString = exports.hex = exports.utf8 = exports.bech32m = exports.bech32 = exports.base58check = exports.createBase58check = exports.base58xmr = exports.base58xrp = exports.base58flickr = exports.base58 = exports.base64urlnopad = exports.base64url = exports.base64nopad = exports.base64 = exports.base32crockford = exports.base32hexnopad = exports.base32hex = exports.base32nopad = exports.base32 = exports.base16 = exports.utils = void 0;
    function isBytes(a) {
      return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
    }
    function abytes(b, ...lengths) {
      if (!isBytes(b))
        throw new Error("Uint8Array expected");
      if (lengths.length > 0 && !lengths.includes(b.length))
        throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
    }
    function isArrayOf(isString, arr) {
      if (!Array.isArray(arr))
        return false;
      if (arr.length === 0)
        return true;
      if (isString) {
        return arr.every((item) => typeof item === "string");
      } else {
        return arr.every((item) => Number.isSafeInteger(item));
      }
    }
    function afn(input) {
      if (typeof input !== "function")
        throw new Error("function expected");
      return true;
    }
    function astr(label, input) {
      if (typeof input !== "string")
        throw new Error(`${label}: string expected`);
      return true;
    }
    function anumber(n) {
      if (!Number.isSafeInteger(n))
        throw new Error(`invalid integer: ${n}`);
    }
    function aArr(input) {
      if (!Array.isArray(input))
        throw new Error("array expected");
    }
    function astrArr(label, input) {
      if (!isArrayOf(true, input))
        throw new Error(`${label}: array of strings expected`);
    }
    function anumArr(label, input) {
      if (!isArrayOf(false, input))
        throw new Error(`${label}: array of numbers expected`);
    }
    // @__NO_SIDE_EFFECTS__
    function chain(...args) {
      const id = (a) => a;
      const wrap = (a, b) => (c) => a(b(c));
      const encode2 = args.map((x) => x.encode).reduceRight(wrap, id);
      const decode = args.map((x) => x.decode).reduce(wrap, id);
      return { encode: encode2, decode };
    }
    // @__NO_SIDE_EFFECTS__
    function alphabet(letters) {
      const lettersA = typeof letters === "string" ? letters.split("") : letters;
      const len = lettersA.length;
      astrArr("alphabet", lettersA);
      const indexes = new Map(lettersA.map((l, i) => [l, i]));
      return {
        encode: (digits) => {
          aArr(digits);
          return digits.map((i) => {
            if (!Number.isSafeInteger(i) || i < 0 || i >= len)
              throw new Error(`alphabet.encode: digit index outside alphabet "${i}". Allowed: ${letters}`);
            return lettersA[i];
          });
        },
        decode: (input) => {
          aArr(input);
          return input.map((letter) => {
            astr("alphabet.decode", letter);
            const i = indexes.get(letter);
            if (i === void 0)
              throw new Error(`Unknown letter: "${letter}". Allowed: ${letters}`);
            return i;
          });
        }
      };
    }
    // @__NO_SIDE_EFFECTS__
    function join(separator = "") {
      astr("join", separator);
      return {
        encode: (from) => {
          astrArr("join.decode", from);
          return from.join(separator);
        },
        decode: (to) => {
          astr("join.decode", to);
          return to.split(separator);
        }
      };
    }
    // @__NO_SIDE_EFFECTS__
    function padding(bits, chr = "=") {
      anumber(bits);
      astr("padding", chr);
      return {
        encode(data) {
          astrArr("padding.encode", data);
          while (data.length * bits % 8)
            data.push(chr);
          return data;
        },
        decode(input) {
          astrArr("padding.decode", input);
          let end = input.length;
          if (end * bits % 8)
            throw new Error("padding: invalid, string should have whole number of bytes");
          for (; end > 0 && input[end - 1] === chr; end--) {
            const last = end - 1;
            const byte = last * bits;
            if (byte % 8 === 0)
              throw new Error("padding: invalid, string has too much padding");
          }
          return input.slice(0, end);
        }
      };
    }
    // @__NO_SIDE_EFFECTS__
    function normalize(fn) {
      afn(fn);
      return { encode: (from) => from, decode: (to) => fn(to) };
    }
    function convertRadix(data, from, to) {
      if (from < 2)
        throw new Error(`convertRadix: invalid from=${from}, base cannot be less than 2`);
      if (to < 2)
        throw new Error(`convertRadix: invalid to=${to}, base cannot be less than 2`);
      aArr(data);
      if (!data.length)
        return [];
      let pos = 0;
      const res = [];
      const digits = Array.from(data, (d) => {
        anumber(d);
        if (d < 0 || d >= from)
          throw new Error(`invalid integer: ${d}`);
        return d;
      });
      const dlen = digits.length;
      while (true) {
        let carry = 0;
        let done = true;
        for (let i = pos; i < dlen; i++) {
          const digit = digits[i];
          const fromCarry = from * carry;
          const digitBase = fromCarry + digit;
          if (!Number.isSafeInteger(digitBase) || fromCarry / from !== carry || digitBase - digit !== fromCarry) {
            throw new Error("convertRadix: carry overflow");
          }
          const div = digitBase / to;
          carry = digitBase % to;
          const rounded = Math.floor(div);
          digits[i] = rounded;
          if (!Number.isSafeInteger(rounded) || rounded * to + carry !== digitBase)
            throw new Error("convertRadix: carry overflow");
          if (!done)
            continue;
          else if (!rounded)
            pos = i;
          else
            done = false;
        }
        res.push(carry);
        if (done)
          break;
      }
      for (let i = 0; i < data.length - 1 && data[i] === 0; i++)
        res.push(0);
      return res.reverse();
    }
    var gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
    var radix2carry = /* @__NO_SIDE_EFFECTS__ */ (from, to) => from + (to - gcd(from, to));
    var powers = /* @__PURE__ */ (() => {
      let res = [];
      for (let i = 0; i < 40; i++)
        res.push(2 ** i);
      return res;
    })();
    function convertRadix2(data, from, to, padding2) {
      aArr(data);
      if (from <= 0 || from > 32)
        throw new Error(`convertRadix2: wrong from=${from}`);
      if (to <= 0 || to > 32)
        throw new Error(`convertRadix2: wrong to=${to}`);
      if (/* @__PURE__ */ radix2carry(from, to) > 32) {
        throw new Error(`convertRadix2: carry overflow from=${from} to=${to} carryBits=${/* @__PURE__ */ radix2carry(from, to)}`);
      }
      let carry = 0;
      let pos = 0;
      const max = powers[from];
      const mask = powers[to] - 1;
      const res = [];
      for (const n of data) {
        anumber(n);
        if (n >= max)
          throw new Error(`convertRadix2: invalid data word=${n} from=${from}`);
        carry = carry << from | n;
        if (pos + from > 32)
          throw new Error(`convertRadix2: carry overflow pos=${pos} from=${from}`);
        pos += from;
        for (; pos >= to; pos -= to)
          res.push((carry >> pos - to & mask) >>> 0);
        const pow = powers[pos];
        if (pow === void 0)
          throw new Error("invalid carry");
        carry &= pow - 1;
      }
      carry = carry << to - pos & mask;
      if (!padding2 && pos >= from)
        throw new Error("Excess padding");
      if (!padding2 && carry > 0)
        throw new Error(`Non-zero padding: ${carry}`);
      if (padding2 && pos > 0)
        res.push(carry >>> 0);
      return res;
    }
    // @__NO_SIDE_EFFECTS__
    function radix(num) {
      anumber(num);
      const _256 = 2 ** 8;
      return {
        encode: (bytes) => {
          if (!isBytes(bytes))
            throw new Error("radix.encode input should be Uint8Array");
          return convertRadix(Array.from(bytes), _256, num);
        },
        decode: (digits) => {
          anumArr("radix.decode", digits);
          return Uint8Array.from(convertRadix(digits, num, _256));
        }
      };
    }
    // @__NO_SIDE_EFFECTS__
    function radix2(bits, revPadding = false) {
      anumber(bits);
      if (bits <= 0 || bits > 32)
        throw new Error("radix2: bits should be in (0..32]");
      if (/* @__PURE__ */ radix2carry(8, bits) > 32 || /* @__PURE__ */ radix2carry(bits, 8) > 32)
        throw new Error("radix2: carry overflow");
      return {
        encode: (bytes) => {
          if (!isBytes(bytes))
            throw new Error("radix2.encode input should be Uint8Array");
          return convertRadix2(Array.from(bytes), 8, bits, !revPadding);
        },
        decode: (digits) => {
          anumArr("radix2.decode", digits);
          return Uint8Array.from(convertRadix2(digits, bits, 8, revPadding));
        }
      };
    }
    function unsafeWrapper(fn) {
      afn(fn);
      return function(...args) {
        try {
          return fn.apply(null, args);
        } catch (e) {
        }
      };
    }
    function checksum(len, fn) {
      anumber(len);
      afn(fn);
      return {
        encode(data) {
          if (!isBytes(data))
            throw new Error("checksum.encode: input should be Uint8Array");
          const sum = fn(data).slice(0, len);
          const res = new Uint8Array(data.length + len);
          res.set(data);
          res.set(sum, data.length);
          return res;
        },
        decode(data) {
          if (!isBytes(data))
            throw new Error("checksum.decode: input should be Uint8Array");
          const payload = data.slice(0, -len);
          const oldChecksum = data.slice(-len);
          const newChecksum = fn(payload).slice(0, len);
          for (let i = 0; i < len; i++)
            if (newChecksum[i] !== oldChecksum[i])
              throw new Error("Invalid checksum");
          return payload;
        }
      };
    }
    exports.utils = {
      alphabet,
      chain,
      checksum,
      convertRadix,
      convertRadix2,
      radix,
      radix2,
      join,
      padding
    };
    exports.base16 = /* @__PURE__ */ chain(/* @__PURE__ */ radix2(4), /* @__PURE__ */ alphabet("0123456789ABCDEF"), /* @__PURE__ */ join(""));
    exports.base32 = /* @__PURE__ */ chain(/* @__PURE__ */ radix2(5), /* @__PURE__ */ alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), /* @__PURE__ */ padding(5), /* @__PURE__ */ join(""));
    exports.base32nopad = /* @__PURE__ */ chain(/* @__PURE__ */ radix2(5), /* @__PURE__ */ alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), /* @__PURE__ */ join(""));
    exports.base32hex = /* @__PURE__ */ chain(/* @__PURE__ */ radix2(5), /* @__PURE__ */ alphabet("0123456789ABCDEFGHIJKLMNOPQRSTUV"), /* @__PURE__ */ padding(5), /* @__PURE__ */ join(""));
    exports.base32hexnopad = /* @__PURE__ */ chain(/* @__PURE__ */ radix2(5), /* @__PURE__ */ alphabet("0123456789ABCDEFGHIJKLMNOPQRSTUV"), /* @__PURE__ */ join(""));
    exports.base32crockford = /* @__PURE__ */ chain(/* @__PURE__ */ radix2(5), /* @__PURE__ */ alphabet("0123456789ABCDEFGHJKMNPQRSTVWXYZ"), /* @__PURE__ */ join(""), /* @__PURE__ */ normalize((s) => s.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1")));
    var hasBase64Builtin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toBase64 === "function" && typeof Uint8Array.fromBase64 === "function")();
    var decodeBase64Builtin = (s, isUrl) => {
      astr("base64", s);
      const re = isUrl ? /^[A-Za-z0-9=_-]+$/ : /^[A-Za-z0-9=+/]+$/;
      const alphabet2 = isUrl ? "base64url" : "base64";
      if (s.length > 0 && !re.test(s))
        throw new Error("invalid base64");
      return Uint8Array.fromBase64(s, { alphabet: alphabet2, lastChunkHandling: "strict" });
    };
    exports.base64 = hasBase64Builtin ? {
      encode(b) {
        abytes(b);
        return b.toBase64();
      },
      decode(s) {
        return decodeBase64Builtin(s, false);
      }
    } : /* @__PURE__ */ chain(/* @__PURE__ */ radix2(6), /* @__PURE__ */ alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), /* @__PURE__ */ padding(6), /* @__PURE__ */ join(""));
    exports.base64nopad = /* @__PURE__ */ chain(/* @__PURE__ */ radix2(6), /* @__PURE__ */ alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), /* @__PURE__ */ join(""));
    exports.base64url = hasBase64Builtin ? {
      encode(b) {
        abytes(b);
        return b.toBase64({ alphabet: "base64url" });
      },
      decode(s) {
        return decodeBase64Builtin(s, true);
      }
    } : /* @__PURE__ */ chain(/* @__PURE__ */ radix2(6), /* @__PURE__ */ alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"), /* @__PURE__ */ padding(6), /* @__PURE__ */ join(""));
    exports.base64urlnopad = /* @__PURE__ */ chain(/* @__PURE__ */ radix2(6), /* @__PURE__ */ alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"), /* @__PURE__ */ join(""));
    var genBase58 = /* @__NO_SIDE_EFFECTS__ */ (abc) => /* @__PURE__ */ chain(/* @__PURE__ */ radix(58), /* @__PURE__ */ alphabet(abc), /* @__PURE__ */ join(""));
    exports.base58 = /* @__PURE__ */ genBase58("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz");
    exports.base58flickr = /* @__PURE__ */ genBase58("123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ");
    exports.base58xrp = /* @__PURE__ */ genBase58("rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz");
    var XMR_BLOCK_LEN = [0, 2, 3, 5, 6, 7, 9, 10, 11];
    exports.base58xmr = {
      encode(data) {
        let res = "";
        for (let i = 0; i < data.length; i += 8) {
          const block = data.subarray(i, i + 8);
          res += exports.base58.encode(block).padStart(XMR_BLOCK_LEN[block.length], "1");
        }
        return res;
      },
      decode(str) {
        let res = [];
        for (let i = 0; i < str.length; i += 11) {
          const slice = str.slice(i, i + 11);
          const blockLen = XMR_BLOCK_LEN.indexOf(slice.length);
          const block = exports.base58.decode(slice);
          for (let j = 0; j < block.length - blockLen; j++) {
            if (block[j] !== 0)
              throw new Error("base58xmr: wrong padding");
          }
          res = res.concat(Array.from(block.slice(block.length - blockLen)));
        }
        return Uint8Array.from(res);
      }
    };
    var createBase58check = (sha256) => /* @__PURE__ */ chain(checksum(4, (data) => sha256(sha256(data))), exports.base58);
    exports.createBase58check = createBase58check;
    exports.base58check = exports.createBase58check;
    var BECH_ALPHABET = /* @__PURE__ */ chain(/* @__PURE__ */ alphabet("qpzry9x8gf2tvdw0s3jn54khce6mua7l"), /* @__PURE__ */ join(""));
    var POLYMOD_GENERATORS = [996825010, 642813549, 513874426, 1027748829, 705979059];
    function bech32Polymod(pre) {
      const b = pre >> 25;
      let chk = (pre & 33554431) << 5;
      for (let i = 0; i < POLYMOD_GENERATORS.length; i++) {
        if ((b >> i & 1) === 1)
          chk ^= POLYMOD_GENERATORS[i];
      }
      return chk;
    }
    function bechChecksum(prefix, words, encodingConst = 1) {
      const len = prefix.length;
      let chk = 1;
      for (let i = 0; i < len; i++) {
        const c = prefix.charCodeAt(i);
        if (c < 33 || c > 126)
          throw new Error(`Invalid prefix (${prefix})`);
        chk = bech32Polymod(chk) ^ c >> 5;
      }
      chk = bech32Polymod(chk);
      for (let i = 0; i < len; i++)
        chk = bech32Polymod(chk) ^ prefix.charCodeAt(i) & 31;
      for (let v of words)
        chk = bech32Polymod(chk) ^ v;
      for (let i = 0; i < 6; i++)
        chk = bech32Polymod(chk);
      chk ^= encodingConst;
      return BECH_ALPHABET.encode(convertRadix2([chk % powers[30]], 30, 5, false));
    }
    // @__NO_SIDE_EFFECTS__
    function genBech32(encoding) {
      const ENCODING_CONST = encoding === "bech32" ? 1 : 734539939;
      const _words = /* @__PURE__ */ radix2(5);
      const fromWords = _words.decode;
      const toWords = _words.encode;
      const fromWordsUnsafe = unsafeWrapper(fromWords);
      function encode2(prefix, words, limit = 90) {
        astr("bech32.encode prefix", prefix);
        if (isBytes(words))
          words = Array.from(words);
        anumArr("bech32.encode", words);
        const plen = prefix.length;
        if (plen === 0)
          throw new TypeError(`Invalid prefix length ${plen}`);
        const actualLength = plen + 7 + words.length;
        if (limit !== false && actualLength > limit)
          throw new TypeError(`Length ${actualLength} exceeds limit ${limit}`);
        const lowered = prefix.toLowerCase();
        const sum = bechChecksum(lowered, words, ENCODING_CONST);
        return `${lowered}1${BECH_ALPHABET.encode(words)}${sum}`;
      }
      function decode(str, limit = 90) {
        astr("bech32.decode input", str);
        const slen = str.length;
        if (slen < 8 || limit !== false && slen > limit)
          throw new TypeError(`invalid string length: ${slen} (${str}). Expected (8..${limit})`);
        const lowered = str.toLowerCase();
        if (str !== lowered && str !== str.toUpperCase())
          throw new Error(`String must be lowercase or uppercase`);
        const sepIndex = lowered.lastIndexOf("1");
        if (sepIndex === 0 || sepIndex === -1)
          throw new Error(`Letter "1" must be present between prefix and data only`);
        const prefix = lowered.slice(0, sepIndex);
        const data = lowered.slice(sepIndex + 1);
        if (data.length < 6)
          throw new Error("Data must be at least 6 characters long");
        const words = BECH_ALPHABET.decode(data).slice(0, -6);
        const sum = bechChecksum(prefix, words, ENCODING_CONST);
        if (!data.endsWith(sum))
          throw new Error(`Invalid checksum in ${str}: expected "${sum}"`);
        return { prefix, words };
      }
      const decodeUnsafe = unsafeWrapper(decode);
      function decodeToBytes(str) {
        const { prefix, words } = decode(str, false);
        return { prefix, words, bytes: fromWords(words) };
      }
      function encodeFromBytes(prefix, bytes) {
        return encode2(prefix, toWords(bytes));
      }
      return {
        encode: encode2,
        decode,
        encodeFromBytes,
        decodeToBytes,
        decodeUnsafe,
        fromWords,
        fromWordsUnsafe,
        toWords
      };
    }
    exports.bech32 = /* @__PURE__ */ genBech32("bech32");
    exports.bech32m = /* @__PURE__ */ genBech32("bech32m");
    exports.utf8 = {
      encode: (data) => new TextDecoder().decode(data),
      decode: (str) => new TextEncoder().encode(str)
    };
    var hasHexBuiltin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
    var hexBuiltin = {
      encode(data) {
        abytes(data);
        return data.toHex();
      },
      decode(s) {
        astr("hex", s);
        return Uint8Array.fromHex(s);
      }
    };
    exports.hex = hasHexBuiltin ? hexBuiltin : /* @__PURE__ */ chain(/* @__PURE__ */ radix2(4), /* @__PURE__ */ alphabet("0123456789abcdef"), /* @__PURE__ */ join(""), /* @__PURE__ */ normalize((s) => {
      if (typeof s !== "string" || s.length % 2 !== 0)
        throw new TypeError(`hex.decode: expected string, got ${typeof s} with length ${s.length}`);
      return s.toLowerCase();
    }));
    var CODERS = {
      utf8: exports.utf8,
      hex: exports.hex,
      base16: exports.base16,
      base32: exports.base32,
      base64: exports.base64,
      base64url: exports.base64url,
      base58: exports.base58,
      base58xmr: exports.base58xmr
    };
    var coderTypeError = "Invalid encoding type. Available types: utf8, hex, base16, base32, base64, base64url, base58, base58xmr";
    var bytesToString = (type, bytes) => {
      if (typeof type !== "string" || !CODERS.hasOwnProperty(type))
        throw new TypeError(coderTypeError);
      if (!isBytes(bytes))
        throw new TypeError("bytesToString() expects Uint8Array");
      return CODERS[type].encode(bytes);
    };
    exports.bytesToString = bytesToString;
    exports.str = exports.bytesToString;
    var stringToBytes = (type, str) => {
      if (!CODERS.hasOwnProperty(type))
        throw new TypeError(coderTypeError);
      if (typeof str !== "string")
        throw new TypeError("stringToBytes() expects string");
      return CODERS[type].decode(str);
    };
    exports.stringToBytes = stringToBytes;
    exports.bytes = exports.stringToBytes;
  }
});

// node_modules/@noble/hashes/_u64.js
var require_u64 = __commonJS({
  "node_modules/@noble/hashes/_u64.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.toBig = exports.shrSL = exports.shrSH = exports.rotrSL = exports.rotrSH = exports.rotrBL = exports.rotrBH = exports.rotr32L = exports.rotr32H = exports.rotlSL = exports.rotlSH = exports.rotlBL = exports.rotlBH = exports.add5L = exports.add5H = exports.add4L = exports.add4H = exports.add3L = exports.add3H = void 0;
    exports.add = add;
    exports.fromBig = fromBig;
    exports.split = split;
    var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
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
    var toBig = (h, l) => BigInt(h >>> 0) << _32n | BigInt(l >>> 0);
    exports.toBig = toBig;
    var shrSH = (h, _l, s) => h >>> s;
    exports.shrSH = shrSH;
    var shrSL = (h, l, s) => h << 32 - s | l >>> s;
    exports.shrSL = shrSL;
    var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
    exports.rotrSH = rotrSH;
    var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
    exports.rotrSL = rotrSL;
    var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
    exports.rotrBH = rotrBH;
    var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
    exports.rotrBL = rotrBL;
    var rotr32H = (_h, l) => l;
    exports.rotr32H = rotr32H;
    var rotr32L = (h, _l) => h;
    exports.rotr32L = rotr32L;
    var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
    exports.rotlSH = rotlSH;
    var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
    exports.rotlSL = rotlSL;
    var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
    exports.rotlBH = rotlBH;
    var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;
    exports.rotlBL = rotlBL;
    function add(Ah, Al, Bh, Bl) {
      const l = (Al >>> 0) + (Bl >>> 0);
      return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
    }
    var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
    exports.add3L = add3L;
    var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
    exports.add3H = add3H;
    var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
    exports.add4L = add4L;
    var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
    exports.add4H = add4H;
    var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
    exports.add5L = add5L;
    var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;
    exports.add5H = add5H;
    var u64 = {
      fromBig,
      split,
      toBig,
      shrSH,
      shrSL,
      rotrSH,
      rotrSL,
      rotrBH,
      rotrBL,
      rotr32H,
      rotr32L,
      rotlSH,
      rotlSL,
      rotlBH,
      rotlBL,
      add,
      add3L,
      add3H,
      add4L,
      add4H,
      add5H,
      add5L
    };
    exports.default = u64;
  }
});

// node_modules/@noble/hashes/cryptoNode.js
var require_cryptoNode = __commonJS({
  "node_modules/@noble/hashes/cryptoNode.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.crypto = void 0;
    var nc = __require("node:crypto");
    exports.crypto = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : nc && typeof nc === "object" && "randomBytes" in nc ? nc : void 0;
  }
});

// node_modules/@noble/hashes/utils.js
var require_utils2 = __commonJS({
  "node_modules/@noble/hashes/utils.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.wrapXOFConstructorWithOpts = exports.wrapConstructorWithOpts = exports.wrapConstructor = exports.Hash = exports.nextTick = exports.swap32IfBE = exports.byteSwapIfBE = exports.swap8IfBE = exports.isLE = void 0;
    exports.isBytes = isBytes;
    exports.anumber = anumber;
    exports.abytes = abytes;
    exports.ahash = ahash;
    exports.aexists = aexists;
    exports.aoutput = aoutput;
    exports.u8 = u8;
    exports.u32 = u32;
    exports.clean = clean;
    exports.createView = createView;
    exports.rotr = rotr;
    exports.rotl = rotl;
    exports.byteSwap = byteSwap;
    exports.byteSwap32 = byteSwap32;
    exports.bytesToHex = bytesToHex2;
    exports.hexToBytes = hexToBytes2;
    exports.asyncLoop = asyncLoop;
    exports.utf8ToBytes = utf8ToBytes;
    exports.bytesToUtf8 = bytesToUtf8;
    exports.toBytes = toBytes;
    exports.kdfInputToBytes = kdfInputToBytes;
    exports.concatBytes = concatBytes;
    exports.checkOpts = checkOpts;
    exports.createHasher = createHasher;
    exports.createOptHasher = createOptHasher;
    exports.createXOFer = createXOFer;
    exports.randomBytes = randomBytes;
    var crypto_1 = require_cryptoNode();
    function isBytes(a) {
      return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
    }
    function anumber(n) {
      if (!Number.isSafeInteger(n) || n < 0)
        throw new Error("positive integer expected, got " + n);
    }
    function abytes(b, ...lengths) {
      if (!isBytes(b))
        throw new Error("Uint8Array expected");
      if (lengths.length > 0 && !lengths.includes(b.length))
        throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
    }
    function ahash(h) {
      if (typeof h !== "function" || typeof h.create !== "function")
        throw new Error("Hash should be wrapped by utils.createHasher");
      anumber(h.outputLen);
      anumber(h.blockLen);
    }
    function aexists(instance, checkFinished = true) {
      if (instance.destroyed)
        throw new Error("Hash instance has been destroyed");
      if (checkFinished && instance.finished)
        throw new Error("Hash#digest() has already been called");
    }
    function aoutput(out, instance) {
      abytes(out);
      const min = instance.outputLen;
      if (out.length < min) {
        throw new Error("digestInto() expects output buffer of length at least " + min);
      }
    }
    function u8(arr) {
      return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
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
    function rotl(word, shift) {
      return word << shift | word >>> 32 - shift >>> 0;
    }
    exports.isLE = (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
    function byteSwap(word) {
      return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
    }
    exports.swap8IfBE = exports.isLE ? (n) => n : (n) => byteSwap(n);
    exports.byteSwapIfBE = exports.swap8IfBE;
    function byteSwap32(arr) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = byteSwap(arr[i]);
      }
      return arr;
    }
    exports.swap32IfBE = exports.isLE ? (u) => u : byteSwap32;
    var hasHexBuiltin = /* @__PURE__ */ (() => (
      // @ts-ignore
      typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
    ))();
    var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
    function bytesToHex2(bytes) {
      abytes(bytes);
      if (hasHexBuiltin)
        return bytes.toHex();
      let hex = "";
      for (let i = 0; i < bytes.length; i++) {
        hex += hexes[bytes[i]];
      }
      return hex;
    }
    var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
    function asciiToBase16(ch) {
      if (ch >= asciis._0 && ch <= asciis._9)
        return ch - asciis._0;
      if (ch >= asciis.A && ch <= asciis.F)
        return ch - (asciis.A - 10);
      if (ch >= asciis.a && ch <= asciis.f)
        return ch - (asciis.a - 10);
      return;
    }
    function hexToBytes2(hex) {
      if (typeof hex !== "string")
        throw new Error("hex string expected, got " + typeof hex);
      if (hasHexBuiltin)
        return Uint8Array.fromHex(hex);
      const hl = hex.length;
      const al = hl / 2;
      if (hl % 2)
        throw new Error("hex string expected, got unpadded hex of length " + hl);
      const array = new Uint8Array(al);
      for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
        const n1 = asciiToBase16(hex.charCodeAt(hi));
        const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
        if (n1 === void 0 || n2 === void 0) {
          const char = hex[hi] + hex[hi + 1];
          throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
        }
        array[ai] = n1 * 16 + n2;
      }
      return array;
    }
    var nextTick = async () => {
    };
    exports.nextTick = nextTick;
    async function asyncLoop(iters, tick, cb) {
      let ts = Date.now();
      for (let i = 0; i < iters; i++) {
        cb(i);
        const diff = Date.now() - ts;
        if (diff >= 0 && diff < tick)
          continue;
        await (0, exports.nextTick)();
        ts += diff;
      }
    }
    function utf8ToBytes(str) {
      if (typeof str !== "string")
        throw new Error("string expected");
      return new Uint8Array(new TextEncoder().encode(str));
    }
    function bytesToUtf8(bytes) {
      return new TextDecoder().decode(bytes);
    }
    function toBytes(data) {
      if (typeof data === "string")
        data = utf8ToBytes(data);
      abytes(data);
      return data;
    }
    function kdfInputToBytes(data) {
      if (typeof data === "string")
        data = utf8ToBytes(data);
      abytes(data);
      return data;
    }
    function concatBytes(...arrays) {
      let sum = 0;
      for (let i = 0; i < arrays.length; i++) {
        const a = arrays[i];
        abytes(a);
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
    function checkOpts(defaults, opts) {
      if (opts !== void 0 && {}.toString.call(opts) !== "[object Object]")
        throw new Error("options should be object or undefined");
      const merged = Object.assign(defaults, opts);
      return merged;
    }
    var Hash = class {
    };
    exports.Hash = Hash;
    function createHasher(hashCons) {
      const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
      const tmp = hashCons();
      hashC.outputLen = tmp.outputLen;
      hashC.blockLen = tmp.blockLen;
      hashC.create = () => hashCons();
      return hashC;
    }
    function createOptHasher(hashCons) {
      const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
      const tmp = hashCons({});
      hashC.outputLen = tmp.outputLen;
      hashC.blockLen = tmp.blockLen;
      hashC.create = (opts) => hashCons(opts);
      return hashC;
    }
    function createXOFer(hashCons) {
      const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
      const tmp = hashCons({});
      hashC.outputLen = tmp.outputLen;
      hashC.blockLen = tmp.blockLen;
      hashC.create = (opts) => hashCons(opts);
      return hashC;
    }
    exports.wrapConstructor = createHasher;
    exports.wrapConstructorWithOpts = createOptHasher;
    exports.wrapXOFConstructorWithOpts = createXOFer;
    function randomBytes(bytesLength = 32) {
      if (crypto_1.crypto && typeof crypto_1.crypto.getRandomValues === "function") {
        return crypto_1.crypto.getRandomValues(new Uint8Array(bytesLength));
      }
      if (crypto_1.crypto && typeof crypto_1.crypto.randomBytes === "function") {
        return Uint8Array.from(crypto_1.crypto.randomBytes(bytesLength));
      }
      throw new Error("crypto.getRandomValues must be defined");
    }
  }
});

// node_modules/@noble/hashes/sha3.js
var require_sha3 = __commonJS({
  "node_modules/@noble/hashes/sha3.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.shake256 = exports.shake128 = exports.keccak_512 = exports.keccak_384 = exports.keccak_256 = exports.keccak_224 = exports.sha3_512 = exports.sha3_384 = exports.sha3_256 = exports.sha3_224 = exports.Keccak = void 0;
    exports.keccakP = keccakP;
    var _u64_ts_1 = require_u64();
    var utils_ts_1 = require_utils2();
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
          t ^= _1n << (_1n << /* @__PURE__ */ BigInt(j)) - _1n;
      }
      _SHA3_IOTA.push(t);
    }
    var IOTAS = (0, _u64_ts_1.split)(_SHA3_IOTA, true);
    var SHA3_IOTA_H = IOTAS[0];
    var SHA3_IOTA_L = IOTAS[1];
    var rotlH = (h, l, s) => s > 32 ? (0, _u64_ts_1.rotlBH)(h, l, s) : (0, _u64_ts_1.rotlSH)(h, l, s);
    var rotlL = (h, l, s) => s > 32 ? (0, _u64_ts_1.rotlBL)(h, l, s) : (0, _u64_ts_1.rotlSL)(h, l, s);
    function keccakP(s, rounds = 24) {
      const B = new Uint32Array(5 * 2);
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
          for (let x = 0; x < 10; x++)
            B[x] = s[y + x];
          for (let x = 0; x < 10; x++)
            s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
        }
        s[0] ^= SHA3_IOTA_H[round];
        s[1] ^= SHA3_IOTA_L[round];
      }
      (0, utils_ts_1.clean)(B);
    }
    var Keccak = class _Keccak extends utils_ts_1.Hash {
      // NOTE: we accept arguments in bytes instead of bits here.
      constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
        super();
        this.pos = 0;
        this.posOut = 0;
        this.finished = false;
        this.destroyed = false;
        this.enableXOF = false;
        this.blockLen = blockLen;
        this.suffix = suffix;
        this.outputLen = outputLen;
        this.enableXOF = enableXOF;
        this.rounds = rounds;
        (0, utils_ts_1.anumber)(outputLen);
        if (!(0 < blockLen && blockLen < 200))
          throw new Error("only keccak-f1600 function is supported");
        this.state = new Uint8Array(200);
        this.state32 = (0, utils_ts_1.u32)(this.state);
      }
      clone() {
        return this._cloneInto();
      }
      keccak() {
        (0, utils_ts_1.swap32IfBE)(this.state32);
        keccakP(this.state32, this.rounds);
        (0, utils_ts_1.swap32IfBE)(this.state32);
        this.posOut = 0;
        this.pos = 0;
      }
      update(data) {
        (0, utils_ts_1.aexists)(this);
        data = (0, utils_ts_1.toBytes)(data);
        (0, utils_ts_1.abytes)(data);
        const { blockLen, state } = this;
        const len = data.length;
        for (let pos = 0; pos < len; ) {
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
        (0, utils_ts_1.aexists)(this, false);
        (0, utils_ts_1.abytes)(out);
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
          throw new Error("XOF is not possible for this instance");
        return this.writeInto(out);
      }
      xof(bytes) {
        (0, utils_ts_1.anumber)(bytes);
        return this.xofInto(new Uint8Array(bytes));
      }
      digestInto(out) {
        (0, utils_ts_1.aoutput)(out, this);
        if (this.finished)
          throw new Error("digest() was already called");
        this.writeInto(out);
        this.destroy();
        return out;
      }
      digest() {
        return this.digestInto(new Uint8Array(this.outputLen));
      }
      destroy() {
        this.destroyed = true;
        (0, utils_ts_1.clean)(this.state);
      }
      _cloneInto(to) {
        const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
        to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
        to.state32.set(this.state32);
        to.pos = this.pos;
        to.posOut = this.posOut;
        to.finished = this.finished;
        to.rounds = rounds;
        to.suffix = suffix;
        to.outputLen = outputLen;
        to.enableXOF = enableXOF;
        to.destroyed = this.destroyed;
        return to;
      }
    };
    exports.Keccak = Keccak;
    var gen = (suffix, blockLen, outputLen) => (0, utils_ts_1.createHasher)(() => new Keccak(blockLen, suffix, outputLen));
    exports.sha3_224 = (() => gen(6, 144, 224 / 8))();
    exports.sha3_256 = (() => gen(6, 136, 256 / 8))();
    exports.sha3_384 = (() => gen(6, 104, 384 / 8))();
    exports.sha3_512 = (() => gen(6, 72, 512 / 8))();
    exports.keccak_224 = (() => gen(1, 144, 224 / 8))();
    exports.keccak_256 = (() => gen(1, 136, 256 / 8))();
    exports.keccak_384 = (() => gen(1, 104, 384 / 8))();
    exports.keccak_512 = (() => gen(1, 72, 512 / 8))();
    var genShake = (suffix, blockLen, outputLen) => (0, utils_ts_1.createXOFer)((opts = {}) => new Keccak(blockLen, suffix, opts.dkLen === void 0 ? outputLen : opts.dkLen, true));
    exports.shake128 = (() => genShake(31, 168, 128 / 8))();
    exports.shake256 = (() => genShake(31, 136, 256 / 8))();
  }
});

// node_modules/@metamask/utils/dist/hex.cjs
var require_hex = __commonJS({
  "node_modules/@metamask/utils/dist/hex.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.remove0x = exports.add0x = exports.isValidHexAddress = exports.isValidHexAddressUnmemoized = exports.isValidChecksumAddress = exports.isValidChecksumAddressUnmemoized = exports.getChecksumAddress = exports.getChecksumAddressUnmemoized = exports.assertIsStrictHexString = exports.assertIsHexString = exports.isHexChecksumAddress = exports.isHexAddress = exports.isStrictHexString = exports.isHexString = exports.HexChecksumAddressStruct = exports.HexAddressStruct = exports.StrictHexStruct = exports.HexStruct = void 0;
    var superstruct_1 = require_dist();
    var sha3_1 = require_sha3();
    var lodash_1 = require_lodash();
    var assert_1 = require_assert();
    var HEX_REGEX = /^(?:0x)?[0-9a-f]+$/iu;
    var STRICT_HEX_REGEX = /^0x[0-9a-f]+$/iu;
    var HEX_ADDRESS_REGEX = /^0x[0-9a-f]{40}$/u;
    var HEX_CHECKSUM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/u;
    exports.HexStruct = (0, superstruct_1.pattern)((0, superstruct_1.string)(), HEX_REGEX);
    exports.StrictHexStruct = (0, superstruct_1.pattern)((0, superstruct_1.string)(), STRICT_HEX_REGEX);
    exports.HexAddressStruct = (0, superstruct_1.pattern)((0, superstruct_1.string)(), HEX_ADDRESS_REGEX);
    exports.HexChecksumAddressStruct = (0, superstruct_1.pattern)((0, superstruct_1.string)(), HEX_CHECKSUM_ADDRESS_REGEX);
    var isString = (value) => typeof value === "string";
    function isHexString2(value) {
      return isString(value) && HEX_REGEX.test(value);
    }
    exports.isHexString = isHexString2;
    function isStrictHexString(value) {
      return isString(value) && STRICT_HEX_REGEX.test(value);
    }
    exports.isStrictHexString = isStrictHexString;
    function isHexAddress(value) {
      return isString(value) && HEX_ADDRESS_REGEX.test(value);
    }
    exports.isHexAddress = isHexAddress;
    function isHexChecksumAddress(value) {
      return isString(value) && HEX_CHECKSUM_ADDRESS_REGEX.test(value);
    }
    exports.isHexChecksumAddress = isHexChecksumAddress;
    function assertIsHexString(value) {
      (0, assert_1.assert)(isHexString2(value), "Value must be a hexadecimal string.");
    }
    exports.assertIsHexString = assertIsHexString;
    function assertIsStrictHexString(value) {
      (0, assert_1.assert)(isStrictHexString(value), 'Value must be a hexadecimal string, starting with "0x".');
    }
    exports.assertIsStrictHexString = assertIsStrictHexString;
    function getChecksumAddressUnmemoized(hexAddress) {
      (0, assert_1.assert)(isHexChecksumAddress(hexAddress), "Invalid hex address.");
      const address = remove0x2(hexAddress).toLowerCase();
      const hashBytes = (0, sha3_1.keccak_256)(address);
      const { length } = address;
      const result = new Array(length);
      for (let i = 0; i < length; i++) {
        const byteIndex = i >> 1;
        const nibbleIndex = i & 1;
        const byte = hashBytes[byteIndex];
        const nibble = nibbleIndex === 0 ? byte >> 4 : byte & 15;
        result[i] = nibble >= 8 ? address[i].toUpperCase() : address[i];
      }
      return `0x${result.join("")}`;
    }
    exports.getChecksumAddressUnmemoized = getChecksumAddressUnmemoized;
    exports.getChecksumAddress = (0, lodash_1.memoize)(getChecksumAddressUnmemoized);
    function isValidChecksumAddressUnmemoized(possibleChecksum) {
      if (!isHexChecksumAddress(possibleChecksum)) {
        return false;
      }
      return (0, exports.getChecksumAddress)(possibleChecksum) === possibleChecksum;
    }
    exports.isValidChecksumAddressUnmemoized = isValidChecksumAddressUnmemoized;
    exports.isValidChecksumAddress = (0, lodash_1.memoize)(isValidChecksumAddressUnmemoized);
    function isValidHexAddressUnmemoized(possibleAddress) {
      return isHexAddress(possibleAddress) || (0, exports.isValidChecksumAddress)(possibleAddress);
    }
    exports.isValidHexAddressUnmemoized = isValidHexAddressUnmemoized;
    exports.isValidHexAddress = (0, lodash_1.memoize)(isValidHexAddressUnmemoized);
    function add0x(hexadecimal) {
      if (hexadecimal.startsWith("0x")) {
        return hexadecimal;
      }
      if (hexadecimal.startsWith("0X")) {
        return `0x${hexadecimal.substring(2)}`;
      }
      return `0x${hexadecimal}`;
    }
    exports.add0x = add0x;
    function remove0x2(hexadecimal) {
      if (hexadecimal.startsWith("0x") || hexadecimal.startsWith("0X")) {
        return hexadecimal.substring(2);
      }
      return hexadecimal;
    }
    exports.remove0x = remove0x2;
  }
});

// node_modules/@metamask/utils/dist/bytes.cjs
var require_bytes = __commonJS({
  "node_modules/@metamask/utils/dist/bytes.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.areUint8ArraysEqual = exports.createDataView = exports.concatBytes = exports.valueToBytes = exports.base64ToBytes = exports.stringToBytes = exports.numberToBytes = exports.signedBigIntToBytes = exports.bigIntToBytes = exports.hexToBytes = exports.bytesToBase64 = exports.bytesToString = exports.bytesToNumber = exports.bytesToSignedBigInt = exports.bytesToBigInt = exports.bytesToHex = exports.assertIsBytes = exports.isBytes = void 0;
    var base_1 = require_lib();
    var assert_1 = require_assert();
    var hex_1 = require_hex();
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
    function isBytes(value) {
      return value instanceof Uint8Array;
    }
    exports.isBytes = isBytes;
    function assertIsBytes(value) {
      (0, assert_1.assert)(isBytes(value), "Value must be a Uint8Array.");
    }
    exports.assertIsBytes = assertIsBytes;
    function bytesToHex2(bytes) {
      assertIsBytes(bytes);
      if (bytes.length === 0) {
        return "0x";
      }
      const lookupTable = getPrecomputedHexValues();
      const hexadecimal = new Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) {
        hexadecimal[i] = lookupTable[bytes[i]];
      }
      return (0, hex_1.add0x)(hexadecimal.join(""));
    }
    exports.bytesToHex = bytesToHex2;
    function bytesToBigInt(bytes) {
      assertIsBytes(bytes);
      const hexadecimal = bytesToHex2(bytes);
      return BigInt(hexadecimal);
    }
    exports.bytesToBigInt = bytesToBigInt;
    function bytesToSignedBigInt(bytes) {
      assertIsBytes(bytes);
      let value = BigInt(0);
      for (const byte of bytes) {
        value = (value << BigInt(8)) + BigInt(byte);
      }
      return BigInt.asIntN(bytes.length * 8, value);
    }
    exports.bytesToSignedBigInt = bytesToSignedBigInt;
    function bytesToNumber(bytes) {
      assertIsBytes(bytes);
      const bigint = bytesToBigInt(bytes);
      (0, assert_1.assert)(bigint <= BigInt(Number.MAX_SAFE_INTEGER), "Number is not a safe integer. Use `bytesToBigInt` instead.");
      return Number(bigint);
    }
    exports.bytesToNumber = bytesToNumber;
    function bytesToString(bytes) {
      assertIsBytes(bytes);
      return new TextDecoder().decode(bytes);
    }
    exports.bytesToString = bytesToString;
    function bytesToBase64(bytes) {
      assertIsBytes(bytes);
      return base_1.base64.encode(bytes);
    }
    exports.bytesToBase64 = bytesToBase64;
    function hexToBytes2(value) {
      if (value?.toLowerCase?.() === "0x") {
        return new Uint8Array();
      }
      (0, hex_1.assertIsHexString)(value);
      const strippedValue = (0, hex_1.remove0x)(value).toLowerCase();
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
    exports.hexToBytes = hexToBytes2;
    function bigIntToBytes(value) {
      (0, assert_1.assert)(typeof value === "bigint", "Value must be a bigint.");
      (0, assert_1.assert)(value >= BigInt(0), "Value must be a non-negative bigint.");
      const hexadecimal = value.toString(16);
      return hexToBytes2(hexadecimal);
    }
    exports.bigIntToBytes = bigIntToBytes;
    function bigIntFits(value, bytes) {
      (0, assert_1.assert)(bytes > 0);
      const mask = value >> BigInt(31);
      return !((~value & mask) + (value & ~mask) >> BigInt(bytes * 8 + ~0));
    }
    function signedBigIntToBytes(value, byteLength) {
      (0, assert_1.assert)(typeof value === "bigint", "Value must be a bigint.");
      (0, assert_1.assert)(typeof byteLength === "number", "Byte length must be a number.");
      (0, assert_1.assert)(byteLength > 0, "Byte length must be greater than 0.");
      (0, assert_1.assert)(bigIntFits(value, byteLength), "Byte length is too small to represent the given value.");
      let numberValue = value;
      const bytes = new Uint8Array(byteLength);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Number(BigInt.asUintN(8, numberValue));
        numberValue >>= BigInt(8);
      }
      return bytes.reverse();
    }
    exports.signedBigIntToBytes = signedBigIntToBytes;
    function numberToBytes(value) {
      (0, assert_1.assert)(typeof value === "number", "Value must be a number.");
      (0, assert_1.assert)(value >= 0, "Value must be a non-negative number.");
      (0, assert_1.assert)(Number.isSafeInteger(value), "Value is not a safe integer. Use `bigIntToBytes` instead.");
      const hexadecimal = value.toString(16);
      return hexToBytes2(hexadecimal);
    }
    exports.numberToBytes = numberToBytes;
    function stringToBytes(value) {
      (0, assert_1.assert)(typeof value === "string", "Value must be a string.");
      return new TextEncoder().encode(value);
    }
    exports.stringToBytes = stringToBytes;
    function base64ToBytes(value) {
      (0, assert_1.assert)(typeof value === "string", "Value must be a string.");
      return base_1.base64.decode(value);
    }
    exports.base64ToBytes = base64ToBytes;
    function valueToBytes(value) {
      if (typeof value === "bigint") {
        return bigIntToBytes(value);
      }
      if (typeof value === "number") {
        return numberToBytes(value);
      }
      if (typeof value === "string") {
        if (value.startsWith("0x")) {
          return hexToBytes2(value);
        }
        return stringToBytes(value);
      }
      if (isBytes(value)) {
        return value;
      }
      throw new TypeError(`Unsupported value type: "${typeof value}".`);
    }
    exports.valueToBytes = valueToBytes;
    function concatBytes(values) {
      const normalizedValues = new Array(values.length);
      let byteLength = 0;
      for (let i = 0; i < values.length; i++) {
        const value = valueToBytes(values[i]);
        normalizedValues[i] = value;
        byteLength += value.length;
      }
      const bytes = new Uint8Array(byteLength);
      for (let i = 0, offset = 0; i < normalizedValues.length; i++) {
        bytes.set(normalizedValues[i], offset);
        offset += normalizedValues[i].length;
      }
      return bytes;
    }
    exports.concatBytes = concatBytes;
    function createDataView(bytes) {
      if (typeof Buffer !== "undefined" && bytes instanceof Buffer) {
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return new DataView(buffer);
      }
      return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    exports.createDataView = createDataView;
    function areUint8ArraysEqual(a, b) {
      let diff = a.byteLength ^ b.byteLength;
      const len = Math.max(a.byteLength, b.byteLength);
      for (let i = 0; i < len; i++) {
        const aByte = a[i] ?? 0;
        const bByte = b[i] ?? 0;
        diff |= aByte ^ bByte;
      }
      return diff === 0;
    }
    exports.areUint8ArraysEqual = areUint8ArraysEqual;
  }
});

// node_modules/@metamask/utils/dist/superstruct.cjs
var require_superstruct = __commonJS({
  "node_modules/@metamask/utils/dist/superstruct.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.definePattern = void 0;
    var superstruct_1 = require_dist();
    function definePattern(name, pattern) {
      return (0, superstruct_1.define)(name, (value) => {
        return typeof value === "string" && pattern.test(value);
      });
    }
    exports.definePattern = definePattern;
  }
});

// node_modules/@metamask/utils/dist/caip-types.cjs
var require_caip_types = __commonJS({
  "node_modules/@metamask/utils/dist/caip-types.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.toCaipAssetId = exports.toCaipAssetType = exports.toCaipAccountId = exports.toCaipChainId = exports.parseCaipAssetId = exports.parseCaipAssetType = exports.parseCaipAccountId = exports.parseCaipChainId = exports.isCaipAssetId = exports.isCaipAssetType = exports.isCaipTokenId = exports.isCaipAssetReference = exports.isCaipAssetNamespace = exports.isCaipAccountAddress = exports.isCaipAccountId = exports.isCaipReference = exports.isCaipNamespace = exports.isCaipChainId = exports.KnownCaipNamespace = exports.CaipAssetTypeOrIdStruct = exports.CaipAssetIdStruct = exports.CaipAssetTypeStruct = exports.CaipTokenIdStruct = exports.CaipAssetReferenceStruct = exports.CaipAssetNamespaceStruct = exports.CaipAccountAddressStruct = exports.CaipAccountIdStruct = exports.CaipReferenceStruct = exports.CaipNamespaceStruct = exports.CaipChainIdStruct = exports.CAIP_ASSET_ID_REGEX = exports.CAIP_ASSET_TYPE_REGEX = exports.CAIP_TOKEN_ID_REGEX = exports.CAIP_ASSET_REFERENCE_REGEX = exports.CAIP_ASSET_NAMESPACE_REGEX = exports.CAIP_ACCOUNT_ADDRESS_REGEX = exports.CAIP_ACCOUNT_ID_REGEX = exports.CAIP_REFERENCE_REGEX = exports.CAIP_NAMESPACE_REGEX = exports.CAIP_CHAIN_ID_REGEX = void 0;
    var superstruct_1 = require_superstruct();
    exports.CAIP_CHAIN_ID_REGEX = /^(?<namespace>[-a-z0-9]{3,8}):(?<reference>[-_a-zA-Z0-9]{1,32})$/u;
    exports.CAIP_NAMESPACE_REGEX = /^[-a-z0-9]{3,8}$/u;
    exports.CAIP_REFERENCE_REGEX = /^[-_a-zA-Z0-9]{1,32}$/u;
    exports.CAIP_ACCOUNT_ID_REGEX = /^(?<chainId>(?<namespace>[-a-z0-9]{3,8}):(?<reference>[-_a-zA-Z0-9]{1,32})):(?<accountAddress>[-.%a-zA-Z0-9]{1,128})$/u;
    exports.CAIP_ACCOUNT_ADDRESS_REGEX = /^[-.%a-zA-Z0-9]{1,128}$/u;
    exports.CAIP_ASSET_NAMESPACE_REGEX = /^[-a-z0-9]{3,8}$/u;
    exports.CAIP_ASSET_REFERENCE_REGEX = /^[-.%a-zA-Z0-9]{1,128}$/u;
    exports.CAIP_TOKEN_ID_REGEX = /^[-.%a-zA-Z0-9]{1,78}$/u;
    exports.CAIP_ASSET_TYPE_REGEX = /^(?<chainId>(?<namespace>[-a-z0-9]{3,8}):(?<reference>[-_a-zA-Z0-9]{1,32}))\/(?<assetNamespace>[-a-z0-9]{3,8}):(?<assetReference>[-.%a-zA-Z0-9]{1,128})$/u;
    exports.CAIP_ASSET_ID_REGEX = /^(?<chainId>(?<namespace>[-a-z0-9]{3,8}):(?<reference>[-_a-zA-Z0-9]{1,32}))\/(?<assetNamespace>[-a-z0-9]{3,8}):(?<assetReference>[-.%a-zA-Z0-9]{1,128})\/(?<tokenId>[-.%a-zA-Z0-9]{1,78})$/u;
    var CAIP_ASSET_TYPE_OR_ID_REGEX = /^(?<chainId>(?<namespace>[-a-z0-9]{3,8}):(?<reference>[-_a-zA-Z0-9]{1,32}))\/(?<assetNamespace>[-a-z0-9]{3,8}):(?<assetReference>[-.%a-zA-Z0-9]{1,128})(\/(?<tokenId>[-.%a-zA-Z0-9]{1,78}))?$/u;
    exports.CaipChainIdStruct = (0, superstruct_1.definePattern)("CaipChainId", exports.CAIP_CHAIN_ID_REGEX);
    exports.CaipNamespaceStruct = (0, superstruct_1.definePattern)("CaipNamespace", exports.CAIP_NAMESPACE_REGEX);
    exports.CaipReferenceStruct = (0, superstruct_1.definePattern)("CaipReference", exports.CAIP_REFERENCE_REGEX);
    exports.CaipAccountIdStruct = (0, superstruct_1.definePattern)("CaipAccountId", exports.CAIP_ACCOUNT_ID_REGEX);
    exports.CaipAccountAddressStruct = (0, superstruct_1.definePattern)("CaipAccountAddress", exports.CAIP_ACCOUNT_ADDRESS_REGEX);
    exports.CaipAssetNamespaceStruct = (0, superstruct_1.definePattern)("CaipAssetNamespace", exports.CAIP_ASSET_NAMESPACE_REGEX);
    exports.CaipAssetReferenceStruct = (0, superstruct_1.definePattern)("CaipAssetReference", exports.CAIP_ASSET_REFERENCE_REGEX);
    exports.CaipTokenIdStruct = (0, superstruct_1.definePattern)("CaipTokenId", exports.CAIP_TOKEN_ID_REGEX);
    exports.CaipAssetTypeStruct = (0, superstruct_1.definePattern)("CaipAssetType", exports.CAIP_ASSET_TYPE_REGEX);
    exports.CaipAssetIdStruct = (0, superstruct_1.definePattern)("CaipAssetId", exports.CAIP_ASSET_ID_REGEX);
    exports.CaipAssetTypeOrIdStruct = (0, superstruct_1.definePattern)("CaipAssetTypeOrId", CAIP_ASSET_TYPE_OR_ID_REGEX);
    var KnownCaipNamespace;
    (function(KnownCaipNamespace2) {
      KnownCaipNamespace2["Bip122"] = "bip122";
      KnownCaipNamespace2["Solana"] = "solana";
      KnownCaipNamespace2["Stellar"] = "stellar";
      KnownCaipNamespace2["Tron"] = "tron";
      KnownCaipNamespace2["Eip155"] = "eip155";
      KnownCaipNamespace2["Wallet"] = "wallet";
    })(KnownCaipNamespace = exports.KnownCaipNamespace || (exports.KnownCaipNamespace = {}));
    function isCaipChainId(value) {
      return typeof value === "string" && exports.CAIP_CHAIN_ID_REGEX.test(value);
    }
    exports.isCaipChainId = isCaipChainId;
    function isCaipNamespace(value) {
      return typeof value === "string" && exports.CAIP_NAMESPACE_REGEX.test(value);
    }
    exports.isCaipNamespace = isCaipNamespace;
    function isCaipReference(value) {
      return typeof value === "string" && exports.CAIP_REFERENCE_REGEX.test(value);
    }
    exports.isCaipReference = isCaipReference;
    function isCaipAccountId(value) {
      return typeof value === "string" && exports.CAIP_ACCOUNT_ID_REGEX.test(value);
    }
    exports.isCaipAccountId = isCaipAccountId;
    function isCaipAccountAddress(value) {
      return typeof value === "string" && exports.CAIP_ACCOUNT_ADDRESS_REGEX.test(value);
    }
    exports.isCaipAccountAddress = isCaipAccountAddress;
    function isCaipAssetNamespace(value) {
      return typeof value === "string" && exports.CAIP_ASSET_NAMESPACE_REGEX.test(value);
    }
    exports.isCaipAssetNamespace = isCaipAssetNamespace;
    function isCaipAssetReference(value) {
      return typeof value === "string" && exports.CAIP_ASSET_REFERENCE_REGEX.test(value);
    }
    exports.isCaipAssetReference = isCaipAssetReference;
    function isCaipTokenId(value) {
      return typeof value === "string" && exports.CAIP_TOKEN_ID_REGEX.test(value);
    }
    exports.isCaipTokenId = isCaipTokenId;
    function isCaipAssetType(value) {
      return typeof value === "string" && exports.CAIP_ASSET_TYPE_REGEX.test(value);
    }
    exports.isCaipAssetType = isCaipAssetType;
    function isCaipAssetId(value) {
      return typeof value === "string" && exports.CAIP_ASSET_ID_REGEX.test(value);
    }
    exports.isCaipAssetId = isCaipAssetId;
    function parseCaipChainId(caipChainId) {
      const match = exports.CAIP_CHAIN_ID_REGEX.exec(caipChainId);
      if (!match?.groups) {
        throw new Error("Invalid CAIP chain ID.");
      }
      return {
        namespace: match.groups.namespace,
        reference: match.groups.reference
      };
    }
    exports.parseCaipChainId = parseCaipChainId;
    function parseCaipAccountId(caipAccountId) {
      const match = exports.CAIP_ACCOUNT_ID_REGEX.exec(caipAccountId);
      if (!match?.groups) {
        throw new Error("Invalid CAIP account ID.");
      }
      return {
        address: match.groups.accountAddress,
        chainId: match.groups.chainId,
        chain: {
          namespace: match.groups.namespace,
          reference: match.groups.reference
        }
      };
    }
    exports.parseCaipAccountId = parseCaipAccountId;
    function parseCaipAssetType(caipAssetType) {
      const match = exports.CAIP_ASSET_TYPE_REGEX.exec(caipAssetType);
      if (!match?.groups) {
        throw new Error("Invalid CAIP asset type.");
      }
      return {
        assetNamespace: match.groups.assetNamespace,
        assetReference: match.groups.assetReference,
        chainId: match.groups.chainId,
        chain: {
          namespace: match.groups.namespace,
          reference: match.groups.reference
        }
      };
    }
    exports.parseCaipAssetType = parseCaipAssetType;
    function parseCaipAssetId(caipAssetId) {
      const match = exports.CAIP_ASSET_ID_REGEX.exec(caipAssetId);
      if (!match?.groups) {
        throw new Error("Invalid CAIP asset ID.");
      }
      return {
        assetNamespace: match.groups.assetNamespace,
        assetReference: match.groups.assetReference,
        tokenId: match.groups.tokenId,
        chainId: match.groups.chainId,
        chain: {
          namespace: match.groups.namespace,
          reference: match.groups.reference
        }
      };
    }
    exports.parseCaipAssetId = parseCaipAssetId;
    function toCaipChainId(namespace, reference) {
      if (!isCaipNamespace(namespace)) {
        throw new Error(`Invalid "namespace", must match: ${exports.CAIP_NAMESPACE_REGEX.toString()}`);
      }
      if (!isCaipReference(reference)) {
        throw new Error(`Invalid "reference", must match: ${exports.CAIP_REFERENCE_REGEX.toString()}`);
      }
      return `${namespace}:${reference}`;
    }
    exports.toCaipChainId = toCaipChainId;
    function toCaipAccountId(namespace, reference, accountAddress) {
      if (!isCaipNamespace(namespace)) {
        throw new Error(`Invalid "namespace", must match: ${exports.CAIP_NAMESPACE_REGEX.toString()}`);
      }
      if (!isCaipReference(reference)) {
        throw new Error(`Invalid "reference", must match: ${exports.CAIP_REFERENCE_REGEX.toString()}`);
      }
      if (!isCaipAccountAddress(accountAddress)) {
        throw new Error(`Invalid "accountAddress", must match: ${exports.CAIP_ACCOUNT_ADDRESS_REGEX.toString()}`);
      }
      return `${namespace}:${reference}:${accountAddress}`;
    }
    exports.toCaipAccountId = toCaipAccountId;
    function toCaipAssetType(namespace, reference, assetNamespace, assetReference) {
      if (!isCaipNamespace(namespace)) {
        throw new Error(`Invalid "namespace", must match: ${exports.CAIP_NAMESPACE_REGEX.toString()}`);
      }
      if (!isCaipReference(reference)) {
        throw new Error(`Invalid "reference", must match: ${exports.CAIP_REFERENCE_REGEX.toString()}`);
      }
      if (!isCaipAssetNamespace(assetNamespace)) {
        throw new Error(`Invalid "assetNamespace", must match: ${exports.CAIP_ASSET_NAMESPACE_REGEX.toString()}`);
      }
      if (!isCaipAssetReference(assetReference)) {
        throw new Error(`Invalid "assetReference", must match: ${exports.CAIP_ASSET_REFERENCE_REGEX.toString()}`);
      }
      return `${namespace}:${reference}/${assetNamespace}:${assetReference}`;
    }
    exports.toCaipAssetType = toCaipAssetType;
    function toCaipAssetId(namespace, reference, assetNamespace, assetReference, tokenId) {
      if (!isCaipNamespace(namespace)) {
        throw new Error(`Invalid "namespace", must match: ${exports.CAIP_NAMESPACE_REGEX.toString()}`);
      }
      if (!isCaipReference(reference)) {
        throw new Error(`Invalid "reference", must match: ${exports.CAIP_REFERENCE_REGEX.toString()}`);
      }
      if (!isCaipAssetNamespace(assetNamespace)) {
        throw new Error(`Invalid "assetNamespace", must match: ${exports.CAIP_ASSET_NAMESPACE_REGEX.toString()}`);
      }
      if (!isCaipAssetReference(assetReference)) {
        throw new Error(`Invalid "assetReference", must match: ${exports.CAIP_ASSET_REFERENCE_REGEX.toString()}`);
      }
      if (!isCaipTokenId(tokenId)) {
        throw new Error(`Invalid "tokenId", must match: ${exports.CAIP_TOKEN_ID_REGEX.toString()}`);
      }
      return `${namespace}:${reference}/${assetNamespace}:${assetReference}/${tokenId}`;
    }
    exports.toCaipAssetId = toCaipAssetId;
  }
});

// node_modules/@metamask/utils/dist/checksum.cjs
var require_checksum = __commonJS({
  "node_modules/@metamask/utils/dist/checksum.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ChecksumStruct = void 0;
    var superstruct_1 = require_dist();
    var base64_1 = require_base64();
    exports.ChecksumStruct = (0, superstruct_1.size)((0, base64_1.base64)((0, superstruct_1.string)(), { paddingRequired: true }), 44, 44);
  }
});

// node_modules/@metamask/utils/dist/coercers.cjs
var require_coercers = __commonJS({
  "node_modules/@metamask/utils/dist/coercers.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createHex = exports.createBytes = exports.createBigInt = exports.createNumber = void 0;
    var superstruct_1 = require_dist();
    var assert_1 = require_assert();
    var bytes_1 = require_bytes();
    var hex_1 = require_hex();
    var NumberLikeStruct = (0, superstruct_1.union)([(0, superstruct_1.number)(), (0, superstruct_1.bigint)(), (0, superstruct_1.string)(), hex_1.StrictHexStruct]);
    var NumberCoercer = (0, superstruct_1.coerce)((0, superstruct_1.number)(), NumberLikeStruct, Number);
    var BigIntCoercer = (0, superstruct_1.coerce)((0, superstruct_1.bigint)(), NumberLikeStruct, BigInt);
    var BytesLikeStruct = (0, superstruct_1.union)([hex_1.StrictHexStruct, (0, superstruct_1.instance)(Uint8Array)]);
    var BytesCoercer = (0, superstruct_1.coerce)((0, superstruct_1.instance)(Uint8Array), (0, superstruct_1.union)([hex_1.StrictHexStruct]), bytes_1.hexToBytes);
    var HexCoercer = (0, superstruct_1.coerce)(hex_1.StrictHexStruct, (0, superstruct_1.instance)(Uint8Array), bytes_1.bytesToHex);
    function createNumber(value) {
      try {
        const result = (0, superstruct_1.create)(value, NumberCoercer);
        (0, assert_1.assert)(Number.isFinite(result), `Expected a number-like value, got "${value}".`);
        return result;
      } catch (error) {
        if (error instanceof superstruct_1.StructError) {
          throw new Error(`Expected a number-like value, got "${value}".`);
        }
        throw error;
      }
    }
    exports.createNumber = createNumber;
    function createBigInt(value) {
      try {
        return (0, superstruct_1.create)(value, BigIntCoercer);
      } catch (error) {
        if (error instanceof superstruct_1.StructError) {
          throw new Error(`Expected a number-like value, got "${String(error.value)}".`);
        }
        throw error;
      }
    }
    exports.createBigInt = createBigInt;
    function createBytes(value) {
      if (typeof value === "string" && value.toLowerCase() === "0x") {
        return new Uint8Array();
      }
      try {
        return (0, superstruct_1.create)(value, BytesCoercer);
      } catch (error) {
        if (error instanceof superstruct_1.StructError) {
          throw new Error(`Expected a bytes-like value, got "${String(error.value)}".`);
        }
        throw error;
      }
    }
    exports.createBytes = createBytes;
    function createHex(value) {
      if (value instanceof Uint8Array && value.length === 0 || typeof value === "string" && value.toLowerCase() === "0x") {
        return "0x";
      }
      try {
        return (0, superstruct_1.create)(value, HexCoercer);
      } catch (error) {
        if (error instanceof superstruct_1.StructError) {
          throw new Error(`Expected a bytes-like value, got "${String(error.value)}".`);
        }
        throw error;
      }
    }
    exports.createHex = createHex;
  }
});

// node_modules/@metamask/utils/dist/collections.cjs
var require_collections = __commonJS({
  "node_modules/@metamask/utils/dist/collections.cjs"(exports) {
    "use strict";
    var __classPrivateFieldGet = exports && exports.__classPrivateFieldGet || function(receiver, state, kind, f) {
      if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
      if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
      return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
    };
    var __classPrivateFieldSet = exports && exports.__classPrivateFieldSet || function(receiver, state, value, kind, f) {
      if (kind === "m") throw new TypeError("Private method is not writable");
      if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
      if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
      return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
    };
    var _FrozenMap_map;
    var _FrozenSet_set;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.FrozenSet = exports.FrozenMap = void 0;
    var FrozenMap = class {
      get size() {
        return __classPrivateFieldGet(this, _FrozenMap_map, "f").size;
      }
      [(_FrozenMap_map = /* @__PURE__ */ new WeakMap(), Symbol.iterator)]() {
        return __classPrivateFieldGet(this, _FrozenMap_map, "f")[Symbol.iterator]();
      }
      constructor(entries) {
        _FrozenMap_map.set(this, void 0);
        __classPrivateFieldSet(this, _FrozenMap_map, new Map(entries), "f");
        Object.freeze(this);
      }
      entries() {
        return __classPrivateFieldGet(this, _FrozenMap_map, "f").entries();
      }
      forEach(callbackfn, thisArg) {
        return __classPrivateFieldGet(this, _FrozenMap_map, "f").forEach((value, key, _map) => callbackfn.call(thisArg, value, key, this));
      }
      get(key) {
        return __classPrivateFieldGet(this, _FrozenMap_map, "f").get(key);
      }
      has(key) {
        return __classPrivateFieldGet(this, _FrozenMap_map, "f").has(key);
      }
      keys() {
        return __classPrivateFieldGet(this, _FrozenMap_map, "f").keys();
      }
      values() {
        return __classPrivateFieldGet(this, _FrozenMap_map, "f").values();
      }
      toString() {
        return `FrozenMap(${this.size}) {${this.size > 0 ? ` ${[...this.entries()].map(([key, value]) => `${String(key)} => ${String(value)}`).join(", ")} ` : ""}}`;
      }
    };
    exports.FrozenMap = FrozenMap;
    var FrozenSet = class {
      get size() {
        return __classPrivateFieldGet(this, _FrozenSet_set, "f").size;
      }
      [(_FrozenSet_set = /* @__PURE__ */ new WeakMap(), Symbol.iterator)]() {
        return __classPrivateFieldGet(this, _FrozenSet_set, "f")[Symbol.iterator]();
      }
      constructor(values) {
        _FrozenSet_set.set(this, void 0);
        __classPrivateFieldSet(this, _FrozenSet_set, new Set(values), "f");
        Object.freeze(this);
      }
      entries() {
        return __classPrivateFieldGet(this, _FrozenSet_set, "f").entries();
      }
      forEach(callbackfn, thisArg) {
        return __classPrivateFieldGet(this, _FrozenSet_set, "f").forEach((value, value2, _set) => callbackfn.call(thisArg, value, value2, this));
      }
      has(value) {
        return __classPrivateFieldGet(this, _FrozenSet_set, "f").has(value);
      }
      keys() {
        return __classPrivateFieldGet(this, _FrozenSet_set, "f").keys();
      }
      values() {
        return __classPrivateFieldGet(this, _FrozenSet_set, "f").values();
      }
      toString() {
        return `FrozenSet(${this.size}) {${this.size > 0 ? ` ${[...this.values()].map((member) => String(member)).join(", ")} ` : ""}}`;
      }
    };
    exports.FrozenSet = FrozenSet;
    Object.freeze(FrozenMap);
    Object.freeze(FrozenMap.prototype);
    Object.freeze(FrozenSet);
    Object.freeze(FrozenSet.prototype);
  }
});

// node_modules/@metamask/utils/dist/encryption-types.cjs
var require_encryption_types = __commonJS({
  "node_modules/@metamask/utils/dist/encryption-types.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/@noble/hashes/_md.js
var require_md = __commonJS({
  "node_modules/@noble/hashes/_md.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SHA512_IV = exports.SHA384_IV = exports.SHA224_IV = exports.SHA256_IV = exports.HashMD = void 0;
    exports.setBigUint64 = setBigUint64;
    exports.Chi = Chi;
    exports.Maj = Maj;
    var utils_ts_1 = require_utils2();
    function setBigUint64(view, byteOffset, value, isLE) {
      if (typeof view.setBigUint64 === "function")
        return view.setBigUint64(byteOffset, value, isLE);
      const _32n = BigInt(32);
      const _u32_max = BigInt(4294967295);
      const wh = Number(value >> _32n & _u32_max);
      const wl = Number(value & _u32_max);
      const h = isLE ? 4 : 0;
      const l = isLE ? 0 : 4;
      view.setUint32(byteOffset + h, wh, isLE);
      view.setUint32(byteOffset + l, wl, isLE);
    }
    function Chi(a, b, c) {
      return a & b ^ ~a & c;
    }
    function Maj(a, b, c) {
      return a & b ^ a & c ^ b & c;
    }
    var HashMD = class extends utils_ts_1.Hash {
      constructor(blockLen, outputLen, padOffset, isLE) {
        super();
        this.finished = false;
        this.length = 0;
        this.pos = 0;
        this.destroyed = false;
        this.blockLen = blockLen;
        this.outputLen = outputLen;
        this.padOffset = padOffset;
        this.isLE = isLE;
        this.buffer = new Uint8Array(blockLen);
        this.view = (0, utils_ts_1.createView)(this.buffer);
      }
      update(data) {
        (0, utils_ts_1.aexists)(this);
        data = (0, utils_ts_1.toBytes)(data);
        (0, utils_ts_1.abytes)(data);
        const { view, buffer, blockLen } = this;
        const len = data.length;
        for (let pos = 0; pos < len; ) {
          const take = Math.min(blockLen - this.pos, len - pos);
          if (take === blockLen) {
            const dataView = (0, utils_ts_1.createView)(data);
            for (; blockLen <= len - pos; pos += blockLen)
              this.process(dataView, pos);
            continue;
          }
          buffer.set(data.subarray(pos, pos + take), this.pos);
          this.pos += take;
          pos += take;
          if (this.pos === blockLen) {
            this.process(view, 0);
            this.pos = 0;
          }
        }
        this.length += data.length;
        this.roundClean();
        return this;
      }
      digestInto(out) {
        (0, utils_ts_1.aexists)(this);
        (0, utils_ts_1.aoutput)(out, this);
        this.finished = true;
        const { buffer, view, blockLen, isLE } = this;
        let { pos } = this;
        buffer[pos++] = 128;
        (0, utils_ts_1.clean)(this.buffer.subarray(pos));
        if (this.padOffset > blockLen - pos) {
          this.process(view, 0);
          pos = 0;
        }
        for (let i = pos; i < blockLen; i++)
          buffer[i] = 0;
        setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
        this.process(view, 0);
        const oview = (0, utils_ts_1.createView)(out);
        const len = this.outputLen;
        if (len % 4)
          throw new Error("_sha2: outputLen should be aligned to 32bit");
        const outLen = len / 4;
        const state = this.get();
        if (outLen > state.length)
          throw new Error("_sha2: outputLen bigger than state");
        for (let i = 0; i < outLen; i++)
          oview.setUint32(4 * i, state[i], isLE);
      }
      digest() {
        const { buffer, outputLen } = this;
        this.digestInto(buffer);
        const res = buffer.slice(0, outputLen);
        this.destroy();
        return res;
      }
      _cloneInto(to) {
        to || (to = new this.constructor());
        to.set(...this.get());
        const { blockLen, buffer, length, finished, destroyed, pos } = this;
        to.destroyed = destroyed;
        to.finished = finished;
        to.length = length;
        to.pos = pos;
        if (length % blockLen)
          to.buffer.set(buffer);
        return to;
      }
      clone() {
        return this._cloneInto();
      }
    };
    exports.HashMD = HashMD;
    exports.SHA256_IV = Uint32Array.from([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
    exports.SHA224_IV = Uint32Array.from([
      3238371032,
      914150663,
      812702999,
      4144912697,
      4290775857,
      1750603025,
      1694076839,
      3204075428
    ]);
    exports.SHA384_IV = Uint32Array.from([
      3418070365,
      3238371032,
      1654270250,
      914150663,
      2438529370,
      812702999,
      355462360,
      4144912697,
      1731405415,
      4290775857,
      2394180231,
      1750603025,
      3675008525,
      1694076839,
      1203062813,
      3204075428
    ]);
    exports.SHA512_IV = Uint32Array.from([
      1779033703,
      4089235720,
      3144134277,
      2227873595,
      1013904242,
      4271175723,
      2773480762,
      1595750129,
      1359893119,
      2917565137,
      2600822924,
      725511199,
      528734635,
      4215389547,
      1541459225,
      327033209
    ]);
  }
});

// node_modules/@noble/hashes/sha2.js
var require_sha2 = __commonJS({
  "node_modules/@noble/hashes/sha2.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sha512_224 = exports.sha512_256 = exports.sha384 = exports.sha512 = exports.sha224 = exports.sha256 = exports.SHA512_256 = exports.SHA512_224 = exports.SHA384 = exports.SHA512 = exports.SHA224 = exports.SHA256 = void 0;
    var _md_ts_1 = require_md();
    var u64 = require_u64();
    var utils_ts_1 = require_utils2();
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
    var SHA256 = class extends _md_ts_1.HashMD {
      constructor(outputLen = 32) {
        super(64, outputLen, 8, false);
        this.A = _md_ts_1.SHA256_IV[0] | 0;
        this.B = _md_ts_1.SHA256_IV[1] | 0;
        this.C = _md_ts_1.SHA256_IV[2] | 0;
        this.D = _md_ts_1.SHA256_IV[3] | 0;
        this.E = _md_ts_1.SHA256_IV[4] | 0;
        this.F = _md_ts_1.SHA256_IV[5] | 0;
        this.G = _md_ts_1.SHA256_IV[6] | 0;
        this.H = _md_ts_1.SHA256_IV[7] | 0;
      }
      get() {
        const { A, B, C, D, E, F, G, H } = this;
        return [A, B, C, D, E, F, G, H];
      }
      // prettier-ignore
      set(A, B, C, D, E, F, G, H) {
        this.A = A | 0;
        this.B = B | 0;
        this.C = C | 0;
        this.D = D | 0;
        this.E = E | 0;
        this.F = F | 0;
        this.G = G | 0;
        this.H = H | 0;
      }
      process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4)
          SHA256_W[i] = view.getUint32(offset, false);
        for (let i = 16; i < 64; i++) {
          const W15 = SHA256_W[i - 15];
          const W2 = SHA256_W[i - 2];
          const s0 = (0, utils_ts_1.rotr)(W15, 7) ^ (0, utils_ts_1.rotr)(W15, 18) ^ W15 >>> 3;
          const s1 = (0, utils_ts_1.rotr)(W2, 17) ^ (0, utils_ts_1.rotr)(W2, 19) ^ W2 >>> 10;
          SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
        }
        let { A, B, C, D, E, F, G, H } = this;
        for (let i = 0; i < 64; i++) {
          const sigma1 = (0, utils_ts_1.rotr)(E, 6) ^ (0, utils_ts_1.rotr)(E, 11) ^ (0, utils_ts_1.rotr)(E, 25);
          const T1 = H + sigma1 + (0, _md_ts_1.Chi)(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
          const sigma0 = (0, utils_ts_1.rotr)(A, 2) ^ (0, utils_ts_1.rotr)(A, 13) ^ (0, utils_ts_1.rotr)(A, 22);
          const T2 = sigma0 + (0, _md_ts_1.Maj)(A, B, C) | 0;
          H = G;
          G = F;
          F = E;
          E = D + T1 | 0;
          D = C;
          C = B;
          B = A;
          A = T1 + T2 | 0;
        }
        A = A + this.A | 0;
        B = B + this.B | 0;
        C = C + this.C | 0;
        D = D + this.D | 0;
        E = E + this.E | 0;
        F = F + this.F | 0;
        G = G + this.G | 0;
        H = H + this.H | 0;
        this.set(A, B, C, D, E, F, G, H);
      }
      roundClean() {
        (0, utils_ts_1.clean)(SHA256_W);
      }
      destroy() {
        this.set(0, 0, 0, 0, 0, 0, 0, 0);
        (0, utils_ts_1.clean)(this.buffer);
      }
    };
    exports.SHA256 = SHA256;
    var SHA224 = class extends SHA256 {
      constructor() {
        super(28);
        this.A = _md_ts_1.SHA224_IV[0] | 0;
        this.B = _md_ts_1.SHA224_IV[1] | 0;
        this.C = _md_ts_1.SHA224_IV[2] | 0;
        this.D = _md_ts_1.SHA224_IV[3] | 0;
        this.E = _md_ts_1.SHA224_IV[4] | 0;
        this.F = _md_ts_1.SHA224_IV[5] | 0;
        this.G = _md_ts_1.SHA224_IV[6] | 0;
        this.H = _md_ts_1.SHA224_IV[7] | 0;
      }
    };
    exports.SHA224 = SHA224;
    var K512 = /* @__PURE__ */ (() => u64.split([
      "0x428a2f98d728ae22",
      "0x7137449123ef65cd",
      "0xb5c0fbcfec4d3b2f",
      "0xe9b5dba58189dbbc",
      "0x3956c25bf348b538",
      "0x59f111f1b605d019",
      "0x923f82a4af194f9b",
      "0xab1c5ed5da6d8118",
      "0xd807aa98a3030242",
      "0x12835b0145706fbe",
      "0x243185be4ee4b28c",
      "0x550c7dc3d5ffb4e2",
      "0x72be5d74f27b896f",
      "0x80deb1fe3b1696b1",
      "0x9bdc06a725c71235",
      "0xc19bf174cf692694",
      "0xe49b69c19ef14ad2",
      "0xefbe4786384f25e3",
      "0x0fc19dc68b8cd5b5",
      "0x240ca1cc77ac9c65",
      "0x2de92c6f592b0275",
      "0x4a7484aa6ea6e483",
      "0x5cb0a9dcbd41fbd4",
      "0x76f988da831153b5",
      "0x983e5152ee66dfab",
      "0xa831c66d2db43210",
      "0xb00327c898fb213f",
      "0xbf597fc7beef0ee4",
      "0xc6e00bf33da88fc2",
      "0xd5a79147930aa725",
      "0x06ca6351e003826f",
      "0x142929670a0e6e70",
      "0x27b70a8546d22ffc",
      "0x2e1b21385c26c926",
      "0x4d2c6dfc5ac42aed",
      "0x53380d139d95b3df",
      "0x650a73548baf63de",
      "0x766a0abb3c77b2a8",
      "0x81c2c92e47edaee6",
      "0x92722c851482353b",
      "0xa2bfe8a14cf10364",
      "0xa81a664bbc423001",
      "0xc24b8b70d0f89791",
      "0xc76c51a30654be30",
      "0xd192e819d6ef5218",
      "0xd69906245565a910",
      "0xf40e35855771202a",
      "0x106aa07032bbd1b8",
      "0x19a4c116b8d2d0c8",
      "0x1e376c085141ab53",
      "0x2748774cdf8eeb99",
      "0x34b0bcb5e19b48a8",
      "0x391c0cb3c5c95a63",
      "0x4ed8aa4ae3418acb",
      "0x5b9cca4f7763e373",
      "0x682e6ff3d6b2b8a3",
      "0x748f82ee5defb2fc",
      "0x78a5636f43172f60",
      "0x84c87814a1f0ab72",
      "0x8cc702081a6439ec",
      "0x90befffa23631e28",
      "0xa4506cebde82bde9",
      "0xbef9a3f7b2c67915",
      "0xc67178f2e372532b",
      "0xca273eceea26619c",
      "0xd186b8c721c0c207",
      "0xeada7dd6cde0eb1e",
      "0xf57d4f7fee6ed178",
      "0x06f067aa72176fba",
      "0x0a637dc5a2c898a6",
      "0x113f9804bef90dae",
      "0x1b710b35131c471b",
      "0x28db77f523047d84",
      "0x32caab7b40c72493",
      "0x3c9ebe0a15c9bebc",
      "0x431d67c49c100d4c",
      "0x4cc5d4becb3e42b6",
      "0x597f299cfc657e2a",
      "0x5fcb6fab3ad6faec",
      "0x6c44198c4a475817"
    ].map((n) => BigInt(n))))();
    var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
    var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
    var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
    var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
    var SHA512 = class extends _md_ts_1.HashMD {
      constructor(outputLen = 64) {
        super(128, outputLen, 16, false);
        this.Ah = _md_ts_1.SHA512_IV[0] | 0;
        this.Al = _md_ts_1.SHA512_IV[1] | 0;
        this.Bh = _md_ts_1.SHA512_IV[2] | 0;
        this.Bl = _md_ts_1.SHA512_IV[3] | 0;
        this.Ch = _md_ts_1.SHA512_IV[4] | 0;
        this.Cl = _md_ts_1.SHA512_IV[5] | 0;
        this.Dh = _md_ts_1.SHA512_IV[6] | 0;
        this.Dl = _md_ts_1.SHA512_IV[7] | 0;
        this.Eh = _md_ts_1.SHA512_IV[8] | 0;
        this.El = _md_ts_1.SHA512_IV[9] | 0;
        this.Fh = _md_ts_1.SHA512_IV[10] | 0;
        this.Fl = _md_ts_1.SHA512_IV[11] | 0;
        this.Gh = _md_ts_1.SHA512_IV[12] | 0;
        this.Gl = _md_ts_1.SHA512_IV[13] | 0;
        this.Hh = _md_ts_1.SHA512_IV[14] | 0;
        this.Hl = _md_ts_1.SHA512_IV[15] | 0;
      }
      // prettier-ignore
      get() {
        const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
      }
      // prettier-ignore
      set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
        this.Ah = Ah | 0;
        this.Al = Al | 0;
        this.Bh = Bh | 0;
        this.Bl = Bl | 0;
        this.Ch = Ch | 0;
        this.Cl = Cl | 0;
        this.Dh = Dh | 0;
        this.Dl = Dl | 0;
        this.Eh = Eh | 0;
        this.El = El | 0;
        this.Fh = Fh | 0;
        this.Fl = Fl | 0;
        this.Gh = Gh | 0;
        this.Gl = Gl | 0;
        this.Hh = Hh | 0;
        this.Hl = Hl | 0;
      }
      process(view, offset) {
        for (let i = 0; i < 16; i++, offset += 4) {
          SHA512_W_H[i] = view.getUint32(offset);
          SHA512_W_L[i] = view.getUint32(offset += 4);
        }
        for (let i = 16; i < 80; i++) {
          const W15h = SHA512_W_H[i - 15] | 0;
          const W15l = SHA512_W_L[i - 15] | 0;
          const s0h = u64.rotrSH(W15h, W15l, 1) ^ u64.rotrSH(W15h, W15l, 8) ^ u64.shrSH(W15h, W15l, 7);
          const s0l = u64.rotrSL(W15h, W15l, 1) ^ u64.rotrSL(W15h, W15l, 8) ^ u64.shrSL(W15h, W15l, 7);
          const W2h = SHA512_W_H[i - 2] | 0;
          const W2l = SHA512_W_L[i - 2] | 0;
          const s1h = u64.rotrSH(W2h, W2l, 19) ^ u64.rotrBH(W2h, W2l, 61) ^ u64.shrSH(W2h, W2l, 6);
          const s1l = u64.rotrSL(W2h, W2l, 19) ^ u64.rotrBL(W2h, W2l, 61) ^ u64.shrSL(W2h, W2l, 6);
          const SUMl = u64.add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
          const SUMh = u64.add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
          SHA512_W_H[i] = SUMh | 0;
          SHA512_W_L[i] = SUMl | 0;
        }
        let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        for (let i = 0; i < 80; i++) {
          const sigma1h = u64.rotrSH(Eh, El, 14) ^ u64.rotrSH(Eh, El, 18) ^ u64.rotrBH(Eh, El, 41);
          const sigma1l = u64.rotrSL(Eh, El, 14) ^ u64.rotrSL(Eh, El, 18) ^ u64.rotrBL(Eh, El, 41);
          const CHIh = Eh & Fh ^ ~Eh & Gh;
          const CHIl = El & Fl ^ ~El & Gl;
          const T1ll = u64.add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
          const T1h = u64.add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
          const T1l = T1ll | 0;
          const sigma0h = u64.rotrSH(Ah, Al, 28) ^ u64.rotrBH(Ah, Al, 34) ^ u64.rotrBH(Ah, Al, 39);
          const sigma0l = u64.rotrSL(Ah, Al, 28) ^ u64.rotrBL(Ah, Al, 34) ^ u64.rotrBL(Ah, Al, 39);
          const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
          const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
          Hh = Gh | 0;
          Hl = Gl | 0;
          Gh = Fh | 0;
          Gl = Fl | 0;
          Fh = Eh | 0;
          Fl = El | 0;
          ({ h: Eh, l: El } = u64.add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
          Dh = Ch | 0;
          Dl = Cl | 0;
          Ch = Bh | 0;
          Cl = Bl | 0;
          Bh = Ah | 0;
          Bl = Al | 0;
          const All = u64.add3L(T1l, sigma0l, MAJl);
          Ah = u64.add3H(All, T1h, sigma0h, MAJh);
          Al = All | 0;
        }
        ({ h: Ah, l: Al } = u64.add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
        ({ h: Bh, l: Bl } = u64.add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
        ({ h: Ch, l: Cl } = u64.add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
        ({ h: Dh, l: Dl } = u64.add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
        ({ h: Eh, l: El } = u64.add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
        ({ h: Fh, l: Fl } = u64.add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
        ({ h: Gh, l: Gl } = u64.add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
        ({ h: Hh, l: Hl } = u64.add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
        this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
      }
      roundClean() {
        (0, utils_ts_1.clean)(SHA512_W_H, SHA512_W_L);
      }
      destroy() {
        (0, utils_ts_1.clean)(this.buffer);
        this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      }
    };
    exports.SHA512 = SHA512;
    var SHA384 = class extends SHA512 {
      constructor() {
        super(48);
        this.Ah = _md_ts_1.SHA384_IV[0] | 0;
        this.Al = _md_ts_1.SHA384_IV[1] | 0;
        this.Bh = _md_ts_1.SHA384_IV[2] | 0;
        this.Bl = _md_ts_1.SHA384_IV[3] | 0;
        this.Ch = _md_ts_1.SHA384_IV[4] | 0;
        this.Cl = _md_ts_1.SHA384_IV[5] | 0;
        this.Dh = _md_ts_1.SHA384_IV[6] | 0;
        this.Dl = _md_ts_1.SHA384_IV[7] | 0;
        this.Eh = _md_ts_1.SHA384_IV[8] | 0;
        this.El = _md_ts_1.SHA384_IV[9] | 0;
        this.Fh = _md_ts_1.SHA384_IV[10] | 0;
        this.Fl = _md_ts_1.SHA384_IV[11] | 0;
        this.Gh = _md_ts_1.SHA384_IV[12] | 0;
        this.Gl = _md_ts_1.SHA384_IV[13] | 0;
        this.Hh = _md_ts_1.SHA384_IV[14] | 0;
        this.Hl = _md_ts_1.SHA384_IV[15] | 0;
      }
    };
    exports.SHA384 = SHA384;
    var T224_IV = /* @__PURE__ */ Uint32Array.from([
      2352822216,
      424955298,
      1944164710,
      2312950998,
      502970286,
      855612546,
      1738396948,
      1479516111,
      258812777,
      2077511080,
      2011393907,
      79989058,
      1067287976,
      1780299464,
      286451373,
      2446758561
    ]);
    var T256_IV = /* @__PURE__ */ Uint32Array.from([
      573645204,
      4230739756,
      2673172387,
      3360449730,
      596883563,
      1867755857,
      2520282905,
      1497426621,
      2519219938,
      2827943907,
      3193839141,
      1401305490,
      721525244,
      746961066,
      246885852,
      2177182882
    ]);
    var SHA512_224 = class extends SHA512 {
      constructor() {
        super(28);
        this.Ah = T224_IV[0] | 0;
        this.Al = T224_IV[1] | 0;
        this.Bh = T224_IV[2] | 0;
        this.Bl = T224_IV[3] | 0;
        this.Ch = T224_IV[4] | 0;
        this.Cl = T224_IV[5] | 0;
        this.Dh = T224_IV[6] | 0;
        this.Dl = T224_IV[7] | 0;
        this.Eh = T224_IV[8] | 0;
        this.El = T224_IV[9] | 0;
        this.Fh = T224_IV[10] | 0;
        this.Fl = T224_IV[11] | 0;
        this.Gh = T224_IV[12] | 0;
        this.Gl = T224_IV[13] | 0;
        this.Hh = T224_IV[14] | 0;
        this.Hl = T224_IV[15] | 0;
      }
    };
    exports.SHA512_224 = SHA512_224;
    var SHA512_256 = class extends SHA512 {
      constructor() {
        super(32);
        this.Ah = T256_IV[0] | 0;
        this.Al = T256_IV[1] | 0;
        this.Bh = T256_IV[2] | 0;
        this.Bl = T256_IV[3] | 0;
        this.Ch = T256_IV[4] | 0;
        this.Cl = T256_IV[5] | 0;
        this.Dh = T256_IV[6] | 0;
        this.Dl = T256_IV[7] | 0;
        this.Eh = T256_IV[8] | 0;
        this.El = T256_IV[9] | 0;
        this.Fh = T256_IV[10] | 0;
        this.Fl = T256_IV[11] | 0;
        this.Gh = T256_IV[12] | 0;
        this.Gl = T256_IV[13] | 0;
        this.Hh = T256_IV[14] | 0;
        this.Hl = T256_IV[15] | 0;
      }
    };
    exports.SHA512_256 = SHA512_256;
    exports.sha256 = (0, utils_ts_1.createHasher)(() => new SHA256());
    exports.sha224 = (0, utils_ts_1.createHasher)(() => new SHA224());
    exports.sha512 = (0, utils_ts_1.createHasher)(() => new SHA512());
    exports.sha384 = (0, utils_ts_1.createHasher)(() => new SHA384());
    exports.sha512_256 = (0, utils_ts_1.createHasher)(() => new SHA512_256());
    exports.sha512_224 = (0, utils_ts_1.createHasher)(() => new SHA512_224());
  }
});

// node_modules/@noble/hashes/sha256.js
var require_sha256 = __commonJS({
  "node_modules/@noble/hashes/sha256.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sha224 = exports.SHA224 = exports.sha256 = exports.SHA256 = void 0;
    var sha2_ts_1 = require_sha2();
    exports.SHA256 = sha2_ts_1.SHA256;
    exports.sha256 = sha2_ts_1.sha256;
    exports.SHA224 = sha2_ts_1.SHA224;
    exports.sha224 = sha2_ts_1.sha224;
  }
});

// node_modules/@noble/hashes/sha512.js
var require_sha512 = __commonJS({
  "node_modules/@noble/hashes/sha512.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sha512_256 = exports.SHA512_256 = exports.sha512_224 = exports.SHA512_224 = exports.sha384 = exports.SHA384 = exports.sha512 = exports.SHA512 = void 0;
    var sha2_ts_1 = require_sha2();
    exports.SHA512 = sha2_ts_1.SHA512;
    exports.sha512 = sha2_ts_1.sha512;
    exports.SHA384 = sha2_ts_1.SHA384;
    exports.sha384 = sha2_ts_1.sha384;
    exports.SHA512_224 = sha2_ts_1.SHA512_224;
    exports.sha512_224 = sha2_ts_1.sha512_224;
    exports.SHA512_256 = sha2_ts_1.SHA512_256;
    exports.sha512_256 = sha2_ts_1.sha512_256;
  }
});

// node_modules/@metamask/utils/dist/hashing.cjs
var require_hashing = __commonJS({
  "node_modules/@metamask/utils/dist/hashing.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.sha384 = exports.sha512 = exports.sha256 = void 0;
    var sha256_1 = require_sha256();
    var sha512_1 = require_sha512();
    async function sha256(bytes) {
      if ("crypto" in globalThis && typeof globalThis.crypto === "object" && // eslint-disable-next-line no-restricted-globals
      globalThis.crypto.subtle?.digest) {
        return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
      }
      return (0, sha256_1.sha256)(bytes);
    }
    exports.sha256 = sha256;
    async function sha512(bytes) {
      if ("crypto" in globalThis && typeof globalThis.crypto === "object" && // eslint-disable-next-line no-restricted-globals
      globalThis.crypto.subtle?.digest) {
        return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-512", bytes));
      }
      return (0, sha512_1.sha512)(bytes);
    }
    exports.sha512 = sha512;
    async function sha384(bytes) {
      if ("crypto" in globalThis && typeof globalThis.crypto === "object" && // eslint-disable-next-line no-restricted-globals
      globalThis.crypto.subtle?.digest) {
        return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-384", bytes));
      }
      return (0, sha512_1.sha384)(bytes);
    }
    exports.sha384 = sha384;
  }
});

// node_modules/@metamask/utils/dist/json.cjs
var require_json = __commonJS({
  "node_modules/@metamask/utils/dist/json.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getJsonRpcIdValidator = exports.assertIsJsonRpcError = exports.isJsonRpcError = exports.assertIsJsonRpcFailure = exports.isJsonRpcFailure = exports.assertIsJsonRpcSuccess = exports.isJsonRpcSuccess = exports.assertIsJsonRpcResponse = exports.isJsonRpcResponse = exports.assertIsPendingJsonRpcResponse = exports.isPendingJsonRpcResponse = exports.JsonRpcResponseStruct = exports.JsonRpcFailureStruct = exports.JsonRpcSuccessStruct = exports.PendingJsonRpcResponseStruct = exports.assertIsJsonRpcRequest = exports.isJsonRpcRequest = exports.assertIsJsonRpcNotification = exports.isJsonRpcNotification = exports.JsonRpcNotificationStruct = exports.JsonRpcRequestStruct = exports.JsonRpcParamsStruct = exports.JsonRpcErrorStruct = exports.JsonRpcIdStruct = exports.JsonRpcVersionStruct = exports.jsonrpc2 = exports.getJsonSize = exports.getSafeJson = exports.isValidJson = exports.JsonStruct = exports.UnsafeJsonStruct = exports.exactOptional = exports.object = void 0;
    var superstruct_1 = require_dist();
    var assert_1 = require_assert();
    var misc_1 = require_misc();
    var object = (schema) => (
      // The type is slightly different from a regular object struct, because we
      // want to make properties with `undefined` in their type optional, but not
      // `undefined` itself. This means that we need a type cast.
      (0, superstruct_1.object)(schema)
    );
    exports.object = object;
    function hasOptional({ path, branch }) {
      const field = path[path.length - 1];
      return (0, misc_1.hasProperty)(branch[branch.length - 2], field);
    }
    function exactOptional(struct) {
      return new superstruct_1.Struct({
        ...struct,
        type: `optional ${struct.type}`,
        validator: (value, context) => !hasOptional(context) || struct.validator(value, context),
        refiner: (value, context) => !hasOptional(context) || struct.refiner(value, context)
      });
    }
    exports.exactOptional = exactOptional;
    function validateJson(json) {
      if (json === null || typeof json === "boolean" || typeof json === "string") {
        return true;
      }
      if (typeof json === "number" && Number.isFinite(json)) {
        return true;
      }
      if (typeof json === "object") {
        let every = true;
        if (Array.isArray(json)) {
          for (let i = 0; i < json.length; i++) {
            if (!validateJson(json[i])) {
              every = false;
              break;
            }
          }
          return every;
        }
        const entries = Object.entries(json);
        for (let i = 0; i < entries.length; i++) {
          if (typeof entries[i][0] !== "string" || !validateJson(entries[i][1])) {
            every = false;
            break;
          }
        }
        return every;
      }
      return false;
    }
    exports.UnsafeJsonStruct = (0, superstruct_1.define)("JSON", (json) => validateJson(json));
    exports.JsonStruct = (0, superstruct_1.coerce)(exports.UnsafeJsonStruct, (0, superstruct_1.refine)((0, superstruct_1.any)(), "JSON", (value) => (0, superstruct_1.is)(value, exports.UnsafeJsonStruct)), (value) => JSON.parse(JSON.stringify(value, (propKey, propValue) => {
      if (propKey === "__proto__" || propKey === "constructor") {
        return void 0;
      }
      return propValue;
    })));
    function isValidJson(value) {
      try {
        getSafeJson(value);
        return true;
      } catch {
        return false;
      }
    }
    exports.isValidJson = isValidJson;
    function getSafeJson(value) {
      return (0, superstruct_1.create)(value, exports.JsonStruct);
    }
    exports.getSafeJson = getSafeJson;
    function getJsonSize(value) {
      (0, assert_1.assertStruct)(value, exports.JsonStruct, "Invalid JSON value");
      const json = JSON.stringify(value);
      return new TextEncoder().encode(json).byteLength;
    }
    exports.getJsonSize = getJsonSize;
    exports.jsonrpc2 = "2.0";
    exports.JsonRpcVersionStruct = (0, superstruct_1.literal)(exports.jsonrpc2);
    exports.JsonRpcIdStruct = (0, superstruct_1.nullable)((0, superstruct_1.union)([(0, superstruct_1.number)(), (0, superstruct_1.string)()]));
    exports.JsonRpcErrorStruct = (0, exports.object)({
      code: (0, superstruct_1.integer)(),
      message: (0, superstruct_1.string)(),
      data: exactOptional(exports.JsonStruct),
      stack: exactOptional((0, superstruct_1.string)())
    });
    exports.JsonRpcParamsStruct = (0, superstruct_1.union)([(0, superstruct_1.record)((0, superstruct_1.string)(), exports.JsonStruct), (0, superstruct_1.array)(exports.JsonStruct)]);
    exports.JsonRpcRequestStruct = (0, exports.object)({
      id: exports.JsonRpcIdStruct,
      jsonrpc: exports.JsonRpcVersionStruct,
      method: (0, superstruct_1.string)(),
      params: exactOptional(exports.JsonRpcParamsStruct)
    });
    exports.JsonRpcNotificationStruct = (0, exports.object)({
      jsonrpc: exports.JsonRpcVersionStruct,
      method: (0, superstruct_1.string)(),
      params: exactOptional(exports.JsonRpcParamsStruct)
    });
    function isJsonRpcNotification(value) {
      return (0, superstruct_1.is)(value, exports.JsonRpcNotificationStruct);
    }
    exports.isJsonRpcNotification = isJsonRpcNotification;
    function assertIsJsonRpcNotification(value, ErrorWrapper) {
      (0, assert_1.assertStruct)(value, exports.JsonRpcNotificationStruct, "Invalid JSON-RPC notification", ErrorWrapper);
    }
    exports.assertIsJsonRpcNotification = assertIsJsonRpcNotification;
    function isJsonRpcRequest(value) {
      return (0, superstruct_1.is)(value, exports.JsonRpcRequestStruct);
    }
    exports.isJsonRpcRequest = isJsonRpcRequest;
    function assertIsJsonRpcRequest(value, ErrorWrapper) {
      (0, assert_1.assertStruct)(value, exports.JsonRpcRequestStruct, "Invalid JSON-RPC request", ErrorWrapper);
    }
    exports.assertIsJsonRpcRequest = assertIsJsonRpcRequest;
    exports.PendingJsonRpcResponseStruct = (0, superstruct_1.object)({
      id: exports.JsonRpcIdStruct,
      jsonrpc: exports.JsonRpcVersionStruct,
      result: (0, superstruct_1.optional)((0, superstruct_1.unknown)()),
      error: (0, superstruct_1.optional)(exports.JsonRpcErrorStruct)
    });
    exports.JsonRpcSuccessStruct = (0, exports.object)({
      id: exports.JsonRpcIdStruct,
      jsonrpc: exports.JsonRpcVersionStruct,
      result: exports.JsonStruct
    });
    exports.JsonRpcFailureStruct = (0, exports.object)({
      id: exports.JsonRpcIdStruct,
      jsonrpc: exports.JsonRpcVersionStruct,
      error: exports.JsonRpcErrorStruct
    });
    exports.JsonRpcResponseStruct = (0, superstruct_1.union)([
      exports.JsonRpcSuccessStruct,
      exports.JsonRpcFailureStruct
    ]);
    function isPendingJsonRpcResponse(response) {
      return (0, superstruct_1.is)(response, exports.PendingJsonRpcResponseStruct);
    }
    exports.isPendingJsonRpcResponse = isPendingJsonRpcResponse;
    function assertIsPendingJsonRpcResponse(response, ErrorWrapper) {
      (0, assert_1.assertStruct)(response, exports.PendingJsonRpcResponseStruct, "Invalid pending JSON-RPC response", ErrorWrapper);
    }
    exports.assertIsPendingJsonRpcResponse = assertIsPendingJsonRpcResponse;
    function isJsonRpcResponse(response) {
      return (0, superstruct_1.is)(response, exports.JsonRpcResponseStruct);
    }
    exports.isJsonRpcResponse = isJsonRpcResponse;
    function assertIsJsonRpcResponse(value, ErrorWrapper) {
      (0, assert_1.assertStruct)(value, exports.JsonRpcResponseStruct, "Invalid JSON-RPC response", ErrorWrapper);
    }
    exports.assertIsJsonRpcResponse = assertIsJsonRpcResponse;
    function isJsonRpcSuccess(value) {
      return (0, superstruct_1.is)(value, exports.JsonRpcSuccessStruct);
    }
    exports.isJsonRpcSuccess = isJsonRpcSuccess;
    function assertIsJsonRpcSuccess(value, ErrorWrapper) {
      (0, assert_1.assertStruct)(value, exports.JsonRpcSuccessStruct, "Invalid JSON-RPC success response", ErrorWrapper);
    }
    exports.assertIsJsonRpcSuccess = assertIsJsonRpcSuccess;
    function isJsonRpcFailure(value) {
      return (0, superstruct_1.is)(value, exports.JsonRpcFailureStruct);
    }
    exports.isJsonRpcFailure = isJsonRpcFailure;
    function assertIsJsonRpcFailure(value, ErrorWrapper) {
      (0, assert_1.assertStruct)(value, exports.JsonRpcFailureStruct, "Invalid JSON-RPC failure response", ErrorWrapper);
    }
    exports.assertIsJsonRpcFailure = assertIsJsonRpcFailure;
    function isJsonRpcError(value) {
      return (0, superstruct_1.is)(value, exports.JsonRpcErrorStruct);
    }
    exports.isJsonRpcError = isJsonRpcError;
    function assertIsJsonRpcError(value, ErrorWrapper) {
      (0, assert_1.assertStruct)(value, exports.JsonRpcErrorStruct, "Invalid JSON-RPC error", ErrorWrapper);
    }
    exports.assertIsJsonRpcError = assertIsJsonRpcError;
    function getJsonRpcIdValidator(options) {
      const { permitEmptyString, permitFractions, permitNull } = {
        permitEmptyString: true,
        permitFractions: false,
        permitNull: true,
        ...options
      };
      const isValidJsonRpcId = (id) => {
        return Boolean(typeof id === "number" && (permitFractions || Number.isInteger(id)) || typeof id === "string" && (permitEmptyString || id.length > 0) || permitNull && id === null);
      };
      return isValidJsonRpcId;
    }
    exports.getJsonRpcIdValidator = getJsonRpcIdValidator;
  }
});

// node_modules/@metamask/utils/dist/keyring.cjs
var require_keyring = __commonJS({
  "node_modules/@metamask/utils/dist/keyring.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/@metamask/utils/dist/logging.cjs
var require_logging = __commonJS({
  "node_modules/@metamask/utils/dist/logging.cjs"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createModuleLogger = exports.createProjectLogger = void 0;
    var debug_1 = __importDefault(require_src());
    var globalLogger = (0, debug_1.default)("metamask");
    function createProjectLogger(projectName) {
      return globalLogger.extend(projectName);
    }
    exports.createProjectLogger = createProjectLogger;
    function createModuleLogger(projectLogger, moduleName) {
      return projectLogger.extend(moduleName);
    }
    exports.createModuleLogger = createModuleLogger;
  }
});

// node_modules/@metamask/utils/dist/mnemonic.cjs
var require_mnemonic = __commonJS({
  "node_modules/@metamask/utils/dist/mnemonic.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.convertMnemonicToWordlistIndices = exports.uint8ArrayToMnemonic = void 0;
    var english_1 = require_english();
    function uint8ArrayToMnemonic(uint8Array) {
      if (uint8Array.length === 0) {
        throw new Error("The method uint8ArrayToMnemonic expects a non-empty array");
      }
      const recoveredIndices = Array.from(new Uint16Array(new Uint8Array(uint8Array).buffer));
      return recoveredIndices.map((i) => english_1.wordlist[i]).join(" ");
    }
    exports.uint8ArrayToMnemonic = uint8ArrayToMnemonic;
    function convertMnemonicToWordlistIndices(mnemonic) {
      const indices = mnemonic.split(" ").map((word) => english_1.wordlist.indexOf(word));
      return new Uint8Array(new Uint16Array(indices).buffer);
    }
    exports.convertMnemonicToWordlistIndices = convertMnemonicToWordlistIndices;
  }
});

// node_modules/@metamask/utils/dist/number.cjs
var require_number = __commonJS({
  "node_modules/@metamask/utils/dist/number.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.hexToBigInt = exports.hexToNumber = exports.bigIntToHex = exports.numberToHex = void 0;
    var assert_1 = require_assert();
    var hex_1 = require_hex();
    var numberToHex = (value) => {
      (0, assert_1.assert)(typeof value === "number", "Value must be a number.");
      (0, assert_1.assert)(value >= 0, "Value must be a non-negative number.");
      (0, assert_1.assert)(Number.isSafeInteger(value), "Value is not a safe integer. Use `bigIntToHex` instead.");
      return (0, hex_1.add0x)(value.toString(16));
    };
    exports.numberToHex = numberToHex;
    var bigIntToHex = (value) => {
      (0, assert_1.assert)(typeof value === "bigint", "Value must be a bigint.");
      (0, assert_1.assert)(value >= 0, "Value must be a non-negative bigint.");
      return (0, hex_1.add0x)(value.toString(16));
    };
    exports.bigIntToHex = bigIntToHex;
    var hexToNumber = (value) => {
      (0, hex_1.assertIsHexString)(value);
      const numberValue = parseInt(value, 16);
      (0, assert_1.assert)(Number.isSafeInteger(numberValue), "Value is not a safe integer. Use `hexToBigInt` instead.");
      return numberValue;
    };
    exports.hexToNumber = hexToNumber;
    var hexToBigInt = (value) => {
      (0, hex_1.assertIsHexString)(value);
      return BigInt((0, hex_1.add0x)(value));
    };
    exports.hexToBigInt = hexToBigInt;
  }
});

// node_modules/@metamask/utils/dist/opaque.cjs
var require_opaque = __commonJS({
  "node_modules/@metamask/utils/dist/opaque.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/@metamask/utils/dist/promise.cjs
var require_promise = __commonJS({
  "node_modules/@metamask/utils/dist/promise.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createDeferredPromise = void 0;
    function createDeferredPromise({ suppressUnhandledRejection = false } = {}) {
      let resolve;
      let reject;
      const promise = new Promise((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
      });
      if (suppressUnhandledRejection) {
        promise.catch((_error) => {
        });
      }
      return { promise, resolve, reject };
    }
    exports.createDeferredPromise = createDeferredPromise;
  }
});

// node_modules/@metamask/utils/dist/time.cjs
var require_time = __commonJS({
  "node_modules/@metamask/utils/dist/time.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.timeSince = exports.inMilliseconds = exports.Duration = void 0;
    var Duration;
    (function(Duration2) {
      Duration2[Duration2["Millisecond"] = 1] = "Millisecond";
      Duration2[Duration2["Second"] = 1e3] = "Second";
      Duration2[Duration2["Minute"] = 6e4] = "Minute";
      Duration2[Duration2["Hour"] = 36e5] = "Hour";
      Duration2[Duration2["Day"] = 864e5] = "Day";
      Duration2[Duration2["Week"] = 6048e5] = "Week";
      Duration2[Duration2["Year"] = 31536e6] = "Year";
    })(Duration = exports.Duration || (exports.Duration = {}));
    var isNonNegativeInteger = (number) => Number.isInteger(number) && number >= 0;
    var assertIsNonNegativeInteger = (number, name) => {
      if (!isNonNegativeInteger(number)) {
        throw new Error(`"${name}" must be a non-negative integer. Received: "${number}".`);
      }
    };
    function inMilliseconds(count, duration) {
      assertIsNonNegativeInteger(count, "count");
      return count * duration;
    }
    exports.inMilliseconds = inMilliseconds;
    function timeSince(timestamp) {
      assertIsNonNegativeInteger(timestamp, "timestamp");
      return Date.now() - timestamp;
    }
    exports.timeSince = timeSince;
  }
});

// node_modules/@metamask/utils/dist/transaction-types.cjs
var require_transaction_types = __commonJS({
  "node_modules/@metamask/utils/dist/transaction-types.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/@metamask/utils/dist/versions.cjs
var require_versions = __commonJS({
  "node_modules/@metamask/utils/dist/versions.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.satisfiesVersionRange = exports.gtRange = exports.gtVersion = exports.assertIsSemVerRange = exports.assertIsSemVerVersion = exports.isValidSemVerRange = exports.isValidSemVerVersion = exports.VersionRangeStruct = exports.VersionStruct = void 0;
    var superstruct_1 = require_dist();
    var semver_1 = require_semver2();
    var assert_1 = require_assert();
    exports.VersionStruct = (0, superstruct_1.refine)((0, superstruct_1.string)(), "Version", (value) => {
      if ((0, semver_1.valid)(value) === null) {
        return `Expected SemVer version, got "${value}"`;
      }
      return true;
    });
    exports.VersionRangeStruct = (0, superstruct_1.refine)((0, superstruct_1.string)(), "Version range", (value) => {
      if ((0, semver_1.validRange)(value) === null) {
        return `Expected SemVer range, got "${value}"`;
      }
      return true;
    });
    function isValidSemVerVersion(version) {
      return (0, superstruct_1.is)(version, exports.VersionStruct);
    }
    exports.isValidSemVerVersion = isValidSemVerVersion;
    function isValidSemVerRange(versionRange) {
      return (0, superstruct_1.is)(versionRange, exports.VersionRangeStruct);
    }
    exports.isValidSemVerRange = isValidSemVerRange;
    function assertIsSemVerVersion(version) {
      (0, assert_1.assertStruct)(version, exports.VersionStruct);
    }
    exports.assertIsSemVerVersion = assertIsSemVerVersion;
    function assertIsSemVerRange(range) {
      (0, assert_1.assertStruct)(range, exports.VersionRangeStruct);
    }
    exports.assertIsSemVerRange = assertIsSemVerRange;
    function gtVersion(version1, version2) {
      return (0, semver_1.gt)(version1, version2);
    }
    exports.gtVersion = gtVersion;
    function gtRange(version, range) {
      return (0, semver_1.gtr)(version, range);
    }
    exports.gtRange = gtRange;
    function satisfiesVersionRange(version, versionRange) {
      return (0, semver_1.satisfies)(version, versionRange, {
        includePrerelease: true
      });
    }
    exports.satisfiesVersionRange = satisfiesVersionRange;
  }
});

// node_modules/@metamask/utils/dist/unitsConversion.cjs
var require_unitsConversion = __commonJS({
  "node_modules/@metamask/utils/dist/unitsConversion.cjs"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.toWei = exports.fromWei = exports.numberToString = exports.getValueOfUnit = exports.unitMap = exports.numericToBigInt = void 0;
    var zero = BigInt(0);
    var negative1 = BigInt(-1);
    function numericToBigInt(arg) {
      if (typeof arg === "string") {
        return BigInt(arg);
      }
      if (typeof arg === "number") {
        return BigInt(arg);
      }
      if (typeof arg === "bigint") {
        return arg;
      }
      throw new Error(`Cannot convert ${typeof arg} to BigInt`);
    }
    exports.numericToBigInt = numericToBigInt;
    exports.unitMap = {
      noether: "0",
      wei: "1",
      kwei: "1000",
      Kwei: "1000",
      babbage: "1000",
      femtoether: "1000",
      mwei: "1000000",
      Mwei: "1000000",
      lovelace: "1000000",
      picoether: "1000000",
      gwei: "1000000000",
      Gwei: "1000000000",
      shannon: "1000000000",
      nanoether: "1000000000",
      nano: "1000000000",
      szabo: "1000000000000",
      microether: "1000000000000",
      micro: "1000000000000",
      finney: "1000000000000000",
      milliether: "1000000000000000",
      milli: "1000000000000000",
      ether: "1000000000000000000",
      kether: "1000000000000000000000",
      grand: "1000000000000000000000",
      mether: "1000000000000000000000000",
      gether: "1000000000000000000000000000",
      tether: "1000000000000000000000000000000"
    };
    var unitMapBigInt = Object.fromEntries(Object.entries(exports.unitMap).map(([key, value]) => [key, BigInt(value)]));
    var unitLengths = Object.fromEntries(Object.entries(exports.unitMap).map(([key, value]) => [key, value.length - 1 || 1]));
    var NUMBER_REGEX = /^-?[0-9.]+$/u;
    var FRACTION_REGEX = /^([0-9]*[1-9]|0)(0*)/u;
    var COMMIFY_REGEX = /\B(?=(\d{3})+(?!\d))/gu;
    function getValueOfUnit(unitInput = "ether") {
      const unit = unitInput.toLowerCase();
      const unitValue = unitMapBigInt[unit];
      if (unitValue === void 0) {
        throw new Error(`The unit provided ${unitInput} doesn't exist, please use the one of the following units ${JSON.stringify(exports.unitMap, null, 2)}`);
      }
      return unitValue;
    }
    exports.getValueOfUnit = getValueOfUnit;
    function numberToString(arg) {
      if (typeof arg === "string") {
        if (!NUMBER_REGEX.test(arg)) {
          throw new Error(`while converting number to string, invalid number value '${arg}', should be a number matching (^-?[0-9.]+).`);
        }
        return arg;
      }
      if (typeof arg === "number") {
        return String(arg);
      }
      if (typeof arg === "bigint") {
        return arg.toString();
      }
      throw new Error(`while converting number to string, invalid number value '${String(arg)}' type ${typeof arg}.`);
    }
    exports.numberToString = numberToString;
    function fromWei(weiInput, unit, optionsInput) {
      let wei = numericToBigInt(weiInput);
      const negative = wei < zero;
      const unitLower = unit.toLowerCase();
      const base = unitMapBigInt[unitLower];
      const baseLength = unitLengths[unitLower];
      const options = optionsInput ?? {};
      if (base === void 0) {
        throw new Error(`The unit provided ${unit} doesn't exist, please use the one of the following units ${JSON.stringify(exports.unitMap, null, 2)}`);
      }
      if (base === zero) {
        return negative ? "-0" : "0";
      }
      if (negative) {
        wei = wei * negative1;
      }
      let fraction = (wei % base).toString();
      fraction = fraction.padStart(baseLength, "0");
      if (!options.pad) {
        const fractionMatch = fraction.match(FRACTION_REGEX);
        fraction = fractionMatch?.[1] ?? "0";
      }
      let whole = (wei / base).toString();
      if (options.commify) {
        whole = whole.replace(COMMIFY_REGEX, ",");
      }
      let value = `${whole}${fraction === "0" ? "" : `.${fraction}`}`;
      if (negative) {
        value = `-${value}`;
      }
      return value;
    }
    exports.fromWei = fromWei;
    function toWei(etherInput, unit) {
      const unitLower = unit.toLowerCase();
      const base = unitMapBigInt[unitLower];
      const baseLength = unitLengths[unitLower];
      if (base === void 0) {
        throw new Error(`The unit provided ${unit} doesn't exist, please use the one of the following units ${JSON.stringify(exports.unitMap, null, 2)}`);
      }
      if (base === zero) {
        return zero;
      }
      if (typeof etherInput === "bigint" && unitLower === "wei") {
        return etherInput;
      }
      if (typeof etherInput === "bigint") {
        return etherInput * base;
      }
      let ether = numberToString(etherInput);
      const negative = ether.startsWith("-");
      if (negative) {
        ether = ether.substring(1);
      }
      if (ether === ".") {
        throw new Error(`While converting number ${etherInput} to wei, invalid value`);
      }
      const comps = ether.split(".");
      if (comps.length > 2) {
        throw new Error(`While converting number ${etherInput} to wei,  too many decimal points`);
      }
      let whole = comps[0];
      let fraction = comps[1];
      if (!whole) {
        whole = "0";
      }
      if (!fraction) {
        fraction = "0";
      }
      if (fraction.length > baseLength) {
        throw new Error(`While converting number ${etherInput} to wei, too many decimal places`);
      }
      fraction = fraction.padEnd(baseLength, "0");
      const wholeBigInt = BigInt(whole);
      const fractionBigInt = BigInt(fraction);
      let wei = wholeBigInt * base + fractionBigInt;
      if (negative) {
        wei = wei * negative1;
      }
      return wei;
    }
    exports.toWei = toWei;
  }
});

// node_modules/@metamask/utils/dist/index.cjs
var require_dist2 = __commonJS({
  "node_modules/@metamask/utils/dist/index.cjs"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.unitMap = exports.getValueOfUnit = exports.numberToString = exports.fromWei = exports.toWei = exports.remove0x = exports.add0x = exports.isValidChecksumAddress = exports.getChecksumAddress = exports.isValidHexAddress = exports.assertIsStrictHexString = exports.assertIsHexString = exports.isHexChecksumAddress = exports.isHexAddress = exports.isStrictHexString = exports.isHexString = exports.HexChecksumAddressStruct = exports.HexAddressStruct = exports.StrictHexStruct = exports.HexStruct = void 0;
    __exportStar(require_assert(), exports);
    __exportStar(require_base64(), exports);
    __exportStar(require_bytes(), exports);
    __exportStar(require_caip_types(), exports);
    __exportStar(require_checksum(), exports);
    __exportStar(require_coercers(), exports);
    __exportStar(require_collections(), exports);
    __exportStar(require_encryption_types(), exports);
    __exportStar(require_errors(), exports);
    __exportStar(require_hashing(), exports);
    var hex_1 = require_hex();
    Object.defineProperty(exports, "HexStruct", { enumerable: true, get: function() {
      return hex_1.HexStruct;
    } });
    Object.defineProperty(exports, "StrictHexStruct", { enumerable: true, get: function() {
      return hex_1.StrictHexStruct;
    } });
    Object.defineProperty(exports, "HexAddressStruct", { enumerable: true, get: function() {
      return hex_1.HexAddressStruct;
    } });
    Object.defineProperty(exports, "HexChecksumAddressStruct", { enumerable: true, get: function() {
      return hex_1.HexChecksumAddressStruct;
    } });
    Object.defineProperty(exports, "isHexString", { enumerable: true, get: function() {
      return hex_1.isHexString;
    } });
    Object.defineProperty(exports, "isStrictHexString", { enumerable: true, get: function() {
      return hex_1.isStrictHexString;
    } });
    Object.defineProperty(exports, "isHexAddress", { enumerable: true, get: function() {
      return hex_1.isHexAddress;
    } });
    Object.defineProperty(exports, "isHexChecksumAddress", { enumerable: true, get: function() {
      return hex_1.isHexChecksumAddress;
    } });
    Object.defineProperty(exports, "assertIsHexString", { enumerable: true, get: function() {
      return hex_1.assertIsHexString;
    } });
    Object.defineProperty(exports, "assertIsStrictHexString", { enumerable: true, get: function() {
      return hex_1.assertIsStrictHexString;
    } });
    Object.defineProperty(exports, "isValidHexAddress", { enumerable: true, get: function() {
      return hex_1.isValidHexAddress;
    } });
    Object.defineProperty(exports, "getChecksumAddress", { enumerable: true, get: function() {
      return hex_1.getChecksumAddress;
    } });
    Object.defineProperty(exports, "isValidChecksumAddress", { enumerable: true, get: function() {
      return hex_1.isValidChecksumAddress;
    } });
    Object.defineProperty(exports, "add0x", { enumerable: true, get: function() {
      return hex_1.add0x;
    } });
    Object.defineProperty(exports, "remove0x", { enumerable: true, get: function() {
      return hex_1.remove0x;
    } });
    __exportStar(require_json(), exports);
    __exportStar(require_keyring(), exports);
    __exportStar(require_logging(), exports);
    __exportStar(require_misc(), exports);
    __exportStar(require_mnemonic(), exports);
    __exportStar(require_number(), exports);
    __exportStar(require_opaque(), exports);
    __exportStar(require_promise(), exports);
    __exportStar(require_superstruct(), exports);
    __exportStar(require_time(), exports);
    __exportStar(require_transaction_types(), exports);
    __exportStar(require_versions(), exports);
    var unitsConversion_1 = require_unitsConversion();
    Object.defineProperty(exports, "toWei", { enumerable: true, get: function() {
      return unitsConversion_1.toWei;
    } });
    Object.defineProperty(exports, "fromWei", { enumerable: true, get: function() {
      return unitsConversion_1.fromWei;
    } });
    Object.defineProperty(exports, "numberToString", { enumerable: true, get: function() {
      return unitsConversion_1.numberToString;
    } });
    Object.defineProperty(exports, "getValueOfUnit", { enumerable: true, get: function() {
      return unitsConversion_1.getValueOfUnit;
    } });
    Object.defineProperty(exports, "unitMap", { enumerable: true, get: function() {
      return unitsConversion_1.unitMap;
    } });
  }
});

// node_modules/@metamask/abi-utils/dist/errors.js
var require_errors2 = __commonJS({
  "node_modules/@metamask/abi-utils/dist/errors.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ParserError = exports.getErrorStack = exports.getErrorMessage = void 0;
    var utils_1 = require_dist2();
    var getErrorMessage = (error) => {
      if (typeof error === "string") {
        return error;
      }
      if (error instanceof Error) {
        return error.message;
      }
      if ((0, utils_1.isObject)(error) && (0, utils_1.hasProperty)(error, "message") && typeof error.message === "string") {
        return error.message;
      }
      return "Unknown error.";
    };
    exports.getErrorMessage = getErrorMessage;
    var getErrorStack = (error) => {
      if (error instanceof Error) {
        return error.stack;
      }
      return void 0;
    };
    exports.getErrorStack = getErrorStack;
    var ParserError = class extends Error {
      constructor(message, originalError) {
        super(message);
        this.name = "ParserError";
        const originalStack = (0, exports.getErrorStack)(originalError);
        if (originalStack) {
          this.stack = originalStack;
        }
      }
    };
    exports.ParserError = ParserError;
  }
});

// node_modules/@metamask/abi-utils/dist/iterator.js
var require_iterator = __commonJS({
  "node_modules/@metamask/abi-utils/dist/iterator.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.iterate = void 0;
    var utils_1 = require_dist2();
    var iterate = function* (buffer, size = 32) {
      for (let pointer = 0; pointer < buffer.length; pointer += size) {
        const skip = (length) => {
          (0, utils_1.assert)(length >= 0, "Cannot skip a negative number of bytes.");
          (0, utils_1.assert)(length % size === 0, "Length must be a multiple of the size.");
          pointer += length;
        };
        const value = buffer.subarray(pointer);
        yield { skip, value };
      }
      return {
        skip: () => void 0,
        value: new Uint8Array()
      };
    };
    exports.iterate = iterate;
  }
});

// node_modules/@metamask/abi-utils/dist/utils/buffer.js
var require_buffer = __commonJS({
  "node_modules/@metamask/abi-utils/dist/utils/buffer.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.padEnd = exports.padStart = exports.set = void 0;
    var utils_1 = require_dist2();
    var BUFFER_WIDTH = 32;
    var set = (target, buffer, position) => {
      return (0, utils_1.concatBytes)([
        target.subarray(0, position),
        buffer,
        target.subarray(position + buffer.length)
      ]);
    };
    exports.set = set;
    var padStart = (buffer, length = BUFFER_WIDTH) => {
      const padding = new Uint8Array(Math.max(length - buffer.length, 0)).fill(0);
      return (0, utils_1.concatBytes)([padding, buffer]);
    };
    exports.padStart = padStart;
    var padEnd = (buffer, length = BUFFER_WIDTH) => {
      const padding = new Uint8Array(Math.max(length - buffer.length, 0)).fill(0);
      return (0, utils_1.concatBytes)([buffer, padding]);
    };
    exports.padEnd = padEnd;
  }
});

// node_modules/@metamask/abi-utils/dist/utils/index.js
var require_utils3 = __commonJS({
  "node_modules/@metamask/abi-utils/dist/utils/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_buffer(), exports);
  }
});

// node_modules/@metamask/abi-utils/dist/parsers/address.js
var require_address = __commonJS({
  "node_modules/@metamask/abi-utils/dist/parsers/address.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.address = exports.getAddress = void 0;
    var utils_1 = require_dist2();
    var errors_1 = require_errors2();
    var utils_2 = require_utils3();
    var getAddress = (value) => {
      const bytesValue = (0, utils_1.createBytes)(value);
      (0, utils_1.assert)(bytesValue.length <= 20, new errors_1.ParserError(`Invalid address value. Expected address to be 20 bytes long, but received ${bytesValue.length} bytes.`));
      return (0, utils_2.padStart)(bytesValue, 20);
    };
    exports.getAddress = getAddress;
    exports.address = {
      isDynamic: false,
      /**
       * Get if the given value is a valid address type. Since `address` is a simple
       * type, this is just a check that the value is "address".
       *
       * @param type - The type to check.
       * @returns Whether the type is a valid address type.
       */
      isType: (type) => type === "address",
      /**
       * Get the byte length of an encoded address. Since `address` is a simple
       * type, this always returns 32.
       *
       * Note that actual addresses are only 20 bytes long, but the encoding of
       * the `address` type is always 32 bytes long.
       *
       * @returns The byte length of an encoded address.
       */
      getByteLength() {
        return 32;
      },
      /**
       * Encode the given address to a 32-byte-long byte array.
       *
       * @param args - The encoding arguments.
       * @param args.buffer - The byte array to add to.
       * @param args.value - The address to encode.
       * @param args.packed - Whether to use packed encoding.
       * @returns The bytes with the encoded address added to it.
       */
      encode({ buffer, value, packed }) {
        const addressValue = (0, exports.getAddress)(value);
        if (packed) {
          return (0, utils_1.concatBytes)([buffer, addressValue]);
        }
        const addressBuffer = (0, utils_2.padStart)(addressValue);
        return (0, utils_1.concatBytes)([buffer, addressBuffer]);
      },
      /**
       * Decode the given byte array to an address.
       *
       * @param args - The decoding arguments.
       * @param args.value - The byte array to decode.
       * @returns The decoded address as a hexadecimal string, starting with the
       * "0x"-prefix.
       */
      decode({ value }) {
        return (0, utils_1.add0x)((0, utils_1.bytesToHex)(value.slice(12, 32)));
      }
    };
  }
});

// node_modules/@metamask/abi-utils/dist/parsers/fixed-bytes.js
var require_fixed_bytes = __commonJS({
  "node_modules/@metamask/abi-utils/dist/parsers/fixed-bytes.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fixedBytes = exports.getByteLength = void 0;
    var utils_1 = require_dist2();
    var errors_1 = require_errors2();
    var utils_2 = require_utils3();
    var BYTES_REGEX = /^bytes([0-9]{1,2})$/u;
    var getByteLength2 = (type) => {
      const bytes = type.match(BYTES_REGEX)?.[1];
      (0, utils_1.assert)(bytes, `Invalid byte length. Expected a number between 1 and 32, but received "${type}".`);
      const length = Number(bytes);
      (0, utils_1.assert)(length > 0 && length <= 32, new errors_1.ParserError(`Invalid byte length. Expected a number between 1 and 32, but received "${type}".`));
      return length;
    };
    exports.getByteLength = getByteLength2;
    exports.fixedBytes = {
      isDynamic: false,
      /**
       * Check if a type is a fixed bytes type.
       *
       * @param type - The type to check.
       * @returns Whether the type is a fixed bytes type.
       */
      isType(type) {
        return BYTES_REGEX.test(type);
      },
      /**
       * Get the byte length of an encoded fixed bytes type.
       *
       * @returns The byte length of the type.
       */
      getByteLength() {
        return 32;
      },
      /**
       * Encode a fixed bytes value.
       *
       * @param args - The arguments to encode.
       * @param args.type - The type of the value.
       * @param args.buffer - The byte array to add to.
       * @param args.value - The value to encode.
       * @param args.packed - Whether to use packed encoding.
       * @returns The bytes with the encoded value added to it.
       */
      encode({ type, buffer, value, packed }) {
        const length = (0, exports.getByteLength)(type);
        const bufferValue = (0, utils_1.createBytes)(value);
        (0, utils_1.assert)(bufferValue.length <= length, new errors_1.ParserError(`Expected a value of length ${length}, but received a value of length ${bufferValue.length}.`));
        if (packed) {
          return (0, utils_1.concatBytes)([buffer, (0, utils_2.padEnd)(bufferValue, length)]);
        }
        return (0, utils_1.concatBytes)([buffer, (0, utils_2.padEnd)(bufferValue)]);
      },
      /**
       * Decode a fixed bytes value.
       *
       * @param args - The arguments to decode.
       * @param args.type - The type of the value.
       * @param args.value - The value to decode.
       * @returns The decoded value as a `Uint8Array`.
       */
      decode({ type, value }) {
        const length = (0, exports.getByteLength)(type);
        return value.slice(0, length);
      }
    };
  }
});

// node_modules/@metamask/abi-utils/dist/parsers/tuple.js
var require_tuple = __commonJS({
  "node_modules/@metamask/abi-utils/dist/parsers/tuple.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.tuple = exports.getTupleElements = void 0;
    var utils_1 = require_dist2();
    var errors_1 = require_errors2();
    var packer_1 = require_packer();
    var TUPLE_REGEX = /^\((.+)\)$/u;
    var isTupleType = (type) => TUPLE_REGEX.test(type);
    var getTupleElements = (type) => {
      (0, utils_1.assert)(type.startsWith("(") && type.endsWith(")"), new errors_1.ParserError(`Invalid tuple type. Expected tuple type, but received "${type}".`));
      const elements = [];
      let current = "";
      let depth = 0;
      for (let i = 1; i < type.length - 1; i++) {
        const char = type[i];
        if (char === "," && depth === 0) {
          elements.push(current.trim());
          current = "";
        } else {
          current += char;
          if (char === "(") {
            depth += 1;
          } else if (char === ")") {
            depth -= 1;
          }
        }
      }
      if (current.trim()) {
        elements.push(current.trim());
      }
      return elements;
    };
    exports.getTupleElements = getTupleElements;
    exports.tuple = {
      /**
       * Check if the tuple is dynamic. Tuples are dynamic if one or more elements
       * of the tuple are dynamic.
       *
       * @param type - The type to check.
       * @returns Whether the tuple is dynamic.
       */
      isDynamic(type) {
        const elements = (0, exports.getTupleElements)(type);
        return elements.some((element) => {
          const parser = (0, packer_1.getParser)(element);
          return (0, packer_1.isDynamicParser)(parser, element);
        });
      },
      /**
       * Check if a type is a tuple type.
       *
       * @param type - The type to check.
       * @returns Whether the type is a tuple type.
       */
      isType(type) {
        return isTupleType(type);
      },
      /**
       * Get the byte length of a tuple type. If the tuple is dynamic, this will
       * always return 32. If the tuple is static, this will return the sum of the
       * byte lengths of the tuple elements.
       *
       * @param type - The type to get the byte length for.
       * @returns The byte length of the tuple type.
       */
      getByteLength(type) {
        if ((0, packer_1.isDynamicParser)(this, type)) {
          return 32;
        }
        const elements = (0, exports.getTupleElements)(type);
        return elements.reduce((total, element) => {
          return total + (0, packer_1.getParser)(element).getByteLength(element);
        }, 0);
      },
      /**
       * Encode a tuple value.
       *
       * @param args - The encoding arguments.
       * @param args.type - The type of the value.
       * @param args.buffer - The byte array to add to.
       * @param args.value - The value to encode.
       * @param args.packed - Whether to use non-standard packed encoding.
       * @param args.tight - Whether to use non-standard tight encoding.
       * @returns The bytes with the encoded value added to it.
       */
      encode({ type, buffer, value, packed, tight }) {
        const elements = (0, exports.getTupleElements)(type);
        return (0, packer_1.pack)({
          types: elements,
          values: value,
          byteArray: buffer,
          packed,
          tight
        });
      },
      /**
       * Decode a tuple value.
       *
       * @param args - The decoding arguments.
       * @param args.type - The type of the value.
       * @param args.value - The value to decode.
       * @param args.skip - A function to skip a number of bytes.
       * @returns The decoded value.
       */
      decode({ type, value, skip }) {
        const elements = (0, exports.getTupleElements)(type);
        const length = this.getByteLength(type) - 32;
        skip(length);
        return (0, packer_1.unpack)(elements, value);
      }
    };
  }
});

// node_modules/@metamask/abi-utils/dist/parsers/array.js
var require_array = __commonJS({
  "node_modules/@metamask/abi-utils/dist/parsers/array.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.array = exports.getTupleType = exports.getArrayType = exports.isArrayType = void 0;
    var utils_1 = require_dist2();
    var errors_1 = require_errors2();
    var packer_1 = require_packer();
    var utils_2 = require_utils3();
    var fixed_bytes_1 = require_fixed_bytes();
    var tuple_1 = require_tuple();
    var ARRAY_REGEX = /^(?<type>.*)\[(?<length>\d*?)\]$/u;
    var isArrayType = (type) => ARRAY_REGEX.test(type);
    exports.isArrayType = isArrayType;
    var getArrayType = (type) => {
      const match = type.match(ARRAY_REGEX);
      (0, utils_1.assert)(match?.groups?.type, new errors_1.ParserError(`Invalid array type. Expected an array type, but received "${type}".`));
      return [
        match.groups.type,
        match.groups.length ? parseInt(match.groups.length, 10) : void 0
      ];
    };
    exports.getArrayType = getArrayType;
    var getTupleType = (innerType, length) => {
      return `(${new Array(length).fill(innerType).join(",")})`;
    };
    exports.getTupleType = getTupleType;
    exports.array = {
      /**
       * Check if the array is dynamic. Arrays are dynamic if the array does not
       * have a fixed length, or if the array type is dynamic.
       *
       * @param type - The type to check.
       * @returns Whether the array is dynamic.
       */
      isDynamic(type) {
        const [innerType, length] = (0, exports.getArrayType)(type);
        return (
          // `T[]` is dynamic for any `T`. `T[k]` is dynamic for any dynamic `T` and
          // any `k >= 0`.
          length === void 0 || (0, packer_1.isDynamicParser)((0, packer_1.getParser)(innerType), innerType)
        );
      },
      /**
       * Check if a type is an array type.
       *
       * @param type - The type to check.
       * @returns Whether the type is an array type.
       */
      isType(type) {
        return (0, exports.isArrayType)(type);
      },
      /**
       * Get the byte length of an encoded array. If the array is dynamic, this
       * returns 32, i.e., the length of the pointer to the array. If the array is
       * static, this returns the byte length of the resulting tuple type.
       *
       * @param type - The type to get the byte length for.
       * @returns The byte length of an encoded array.
       */
      getByteLength(type) {
        (0, utils_1.assert)((0, exports.isArrayType)(type), new errors_1.ParserError(`Expected an array type, but received "${type}".`));
        const [innerType, length] = (0, exports.getArrayType)(type);
        if (!(0, packer_1.isDynamicParser)(this, type) && length !== void 0) {
          return tuple_1.tuple.getByteLength((0, exports.getTupleType)(innerType, length));
        }
        return 32;
      },
      /**
       * Encode the given array to a byte array. If the array is static, this uses
       * the tuple encoder.
       *
       * @param args - The encoding arguments.
       * @param args.type - The type of the array.
       * @param args.buffer - The byte array to add to.
       * @param args.value - The array to encode.
       * @param args.packed - Whether to use non-standard packed encoding.
       * @param args.tight - Whether to use non-standard tight encoding.
       * @returns The bytes with the encoded array added to it.
       */
      encode({ type, buffer, value, packed, tight }) {
        const [arrayType, fixedLength] = (0, exports.getArrayType)(type);
        (0, utils_1.assert)(!packed || !(0, exports.isArrayType)(arrayType), new errors_1.ParserError(`Cannot pack nested arrays.`));
        if (packed && (0, packer_1.isDynamicParser)((0, packer_1.getParser)(arrayType), arrayType)) {
          return (0, packer_1.pack)({
            types: new Array(value.length).fill(arrayType),
            values: value,
            byteArray: buffer,
            packed,
            arrayPacked: true,
            tight
          });
        }
        if (fixedLength) {
          (0, utils_1.assert)(fixedLength === value.length, new errors_1.ParserError(`Array length does not match type length. Expected a length of ${fixedLength}, but received ${value.length}.`));
          return tuple_1.tuple.encode({
            type: (0, exports.getTupleType)(arrayType, fixedLength),
            buffer,
            value,
            // In "tight" mode, we don't pad the values to 32 bytes if the value is
            // of type `bytesN`. This is an edge case in `ethereumjs-abi` that we
            // support to provide compatibility with it.
            packed: fixed_bytes_1.fixedBytes.isType(arrayType) && tight,
            tight
          });
        }
        if (packed) {
          return (0, packer_1.pack)({
            types: new Array(value.length).fill(arrayType),
            values: value,
            byteArray: buffer,
            // In "tight" mode, we don't pad the values to 32 bytes if the value is
            // of type `bytesN`. This is an edge case in `ethereumjs-abi` that we
            // support to provide compatibility with it.
            packed: fixed_bytes_1.fixedBytes.isType(arrayType) && tight,
            arrayPacked: true,
            tight
          });
        }
        const arrayLength = (0, utils_2.padStart)((0, utils_1.numberToBytes)(value.length));
        return (0, packer_1.pack)({
          types: new Array(value.length).fill(arrayType),
          values: value,
          byteArray: (0, utils_1.concatBytes)([buffer, arrayLength]),
          packed,
          tight
        });
      },
      /**
       * Decode an array from the given byte array.
       *
       * @param args - The decoding arguments.
       * @param args.type - The type of the array.
       * @param args.value - The byte array to decode.
       * @returns The decoded array.
       */
      decode({ type, value, ...rest }) {
        const [arrayType, fixedLength] = (0, exports.getArrayType)(type);
        if (fixedLength) {
          const result = tuple_1.tuple.decode({
            type: (0, exports.getTupleType)(arrayType, fixedLength),
            value,
            ...rest
          });
          (0, utils_1.assert)(result.length === fixedLength, new errors_1.ParserError(`Array length does not match type length. Expected a length of ${fixedLength}, but received ${result.length}.`));
          return result;
        }
        const arrayLength = (0, utils_1.bytesToNumber)(value.subarray(0, 32));
        return (0, packer_1.unpack)(new Array(arrayLength).fill(arrayType), value.subarray(32));
      }
    };
  }
});

// node_modules/@metamask/abi-utils/dist/parsers/number.js
var require_number2 = __commonJS({
  "node_modules/@metamask/abi-utils/dist/parsers/number.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.number = exports.getBigInt = exports.assertNumberLength = exports.getLength = exports.isSigned = void 0;
    var utils_1 = require_dist2();
    var errors_1 = require_errors2();
    var utils_2 = require_utils3();
    var NUMBER_REGEX = /^u?int(?<length>[0-9]*)?$/u;
    var isSigned = (type) => {
      return !type.startsWith("u");
    };
    exports.isSigned = isSigned;
    var getLength = (type) => {
      if (type === "int" || type === "uint") {
        return 256;
      }
      const match = type.match(NUMBER_REGEX);
      (0, utils_1.assert)(match?.groups?.length, new errors_1.ParserError(`Invalid number type. Expected a number type, but received "${type}".`));
      const length = parseInt(match.groups.length, 10);
      (0, utils_1.assert)(length >= 8 && length <= 256, new errors_1.ParserError(`Invalid number length. Expected a number between 8 and 256, but received "${type}".`));
      (0, utils_1.assert)(length % 8 === 0, new errors_1.ParserError(`Invalid number length. Expected a multiple of 8, but received "${type}".`));
      return length;
    };
    exports.getLength = getLength;
    var assertNumberLength = (value, type) => {
      const length = (0, exports.getLength)(type);
      const maxValue = BigInt(2) ** BigInt(length - ((0, exports.isSigned)(type) ? 1 : 0)) - BigInt(1);
      if ((0, exports.isSigned)(type)) {
        (0, utils_1.assert)(value >= -(maxValue + BigInt(1)) && value <= maxValue, new errors_1.ParserError(`Number "${value}" is out of range for type "${type}".`));
        return;
      }
      (0, utils_1.assert)(value <= maxValue, new errors_1.ParserError(`Number "${value}" is out of range for type "${type}".`));
    };
    exports.assertNumberLength = assertNumberLength;
    var getBigInt = (value) => {
      try {
        return (0, utils_1.createBigInt)(value);
      } catch {
        throw new errors_1.ParserError(`Invalid number. Expected a valid number value, but received "${value}".`);
      }
    };
    exports.getBigInt = getBigInt;
    exports.number = {
      isDynamic: false,
      /**
       * Check if a type is a number type.
       *
       * @param type - The type to check.
       * @returns Whether the type is a number type.
       */
      isType(type) {
        return NUMBER_REGEX.test(type);
      },
      /**
       * Get the byte length of an encoded number type. Since `int` and `uint` are
       * simple types, this will always return 32.
       *
       * @returns The byte length of the type.
       */
      getByteLength() {
        return 32;
      },
      /**
       * Encode a number value.
       *
       * @param args - The arguments to encode.
       * @param args.type - The type of the value.
       * @param args.buffer - The byte array to add to.
       * @param args.value - The value to encode.
       * @param args.packed - Whether to use packed encoding.
       * @returns The bytes with the encoded value added to it.
       */
      encode({ type, buffer, value, packed }) {
        const bigIntValue = (0, exports.getBigInt)(value);
        (0, exports.assertNumberLength)(bigIntValue, type);
        if ((0, exports.isSigned)(type)) {
          if (packed) {
            const length = (0, exports.getLength)(type) / 8;
            return (0, utils_1.concatBytes)([buffer, (0, utils_1.signedBigIntToBytes)(bigIntValue, length)]);
          }
          return (0, utils_1.concatBytes)([
            buffer,
            (0, utils_2.padStart)((0, utils_1.signedBigIntToBytes)(bigIntValue, 32))
          ]);
        }
        if (packed) {
          const length = (0, exports.getLength)(type) / 8;
          return (0, utils_1.concatBytes)([
            buffer,
            (0, utils_2.padStart)((0, utils_1.bigIntToBytes)(bigIntValue), length)
          ]);
        }
        return (0, utils_1.concatBytes)([buffer, (0, utils_2.padStart)((0, utils_1.bigIntToBytes)(bigIntValue))]);
      },
      /**
       * Decode a number value.
       *
       * @param args - The decoding arguments.
       * @param args.type - The type of the value.
       * @param args.value - The value to decode.
       * @returns The decoded value.
       */
      decode({ type, value }) {
        const buffer = value.subarray(0, 32);
        if ((0, exports.isSigned)(type)) {
          const numberValue2 = (0, utils_1.bytesToSignedBigInt)(buffer);
          (0, exports.assertNumberLength)(numberValue2, type);
          return numberValue2;
        }
        const numberValue = (0, utils_1.bytesToBigInt)(buffer);
        (0, exports.assertNumberLength)(numberValue, type);
        return numberValue;
      }
    };
  }
});

// node_modules/@metamask/abi-utils/dist/parsers/bool.js
var require_bool = __commonJS({
  "node_modules/@metamask/abi-utils/dist/parsers/bool.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.bool = exports.getBooleanValue = void 0;
    var superstruct_1 = require_dist();
    var utils_1 = require_dist2();
    var errors_1 = require_errors2();
    var number_1 = require_number2();
    var BooleanCoercer = (0, superstruct_1.coerce)((0, superstruct_1.boolean)(), (0, superstruct_1.union)([(0, superstruct_1.literal)("true"), (0, superstruct_1.literal)("false")]), (value) => value === "true");
    var getBooleanValue = (value) => {
      try {
        const booleanValue = (0, superstruct_1.create)(value, BooleanCoercer);
        if (booleanValue) {
          return BigInt(1);
        }
        return BigInt(0);
      } catch {
        throw new errors_1.ParserError(`Invalid boolean value. Expected a boolean literal, or the string "true" or "false", but received "${value}".`);
      }
    };
    exports.getBooleanValue = getBooleanValue;
    exports.bool = {
      isDynamic: false,
      /**
       * Get if the given value is a valid boolean type. Since `bool` is a simple
       * type, this is just a check that the value is "bool".
       *
       * @param type - The type to check.
       * @returns Whether the type is a valid boolean type.
       */
      isType: (type) => type === "bool",
      /**
       * Get the byte length of an encoded boolean. Since `bool` is a simple
       * type, this always returns 32.
       *
       * Note that actual booleans are only 1 byte long, but the encoding of
       * the `bool` type is always 32 bytes long.
       *
       * @returns The byte length of an encoded boolean.
       */
      getByteLength() {
        return 32;
      },
      /**
       * Encode the given boolean to a byte array.
       *
       * @param args - The encoding arguments.
       * @param args.buffer - The byte array to add to.
       * @param args.value - The boolean to encode.
       * @param args.packed - Whether the value is packed.
       * @param args.tight - Whether to use non-standard tight encoding.
       * @returns The bytes with the encoded boolean added to it.
       */
      encode({ buffer, value, packed, tight }) {
        const booleanValue = (0, exports.getBooleanValue)(value);
        if (packed) {
          return (0, utils_1.concatBytes)([buffer, (0, utils_1.bigIntToBytes)(booleanValue)]);
        }
        return number_1.number.encode({
          type: "uint256",
          buffer,
          value: booleanValue,
          packed,
          tight
        });
      },
      /**
       * Decode the given byte array to a boolean.
       *
       * @param args - The decoding arguments.
       * @returns The decoded boolean.
       */
      decode(args) {
        return number_1.number.decode({ ...args, type: "uint256" }) === BigInt(1);
      }
    };
  }
});

// node_modules/@metamask/abi-utils/dist/parsers/bytes.js
var require_bytes2 = __commonJS({
  "node_modules/@metamask/abi-utils/dist/parsers/bytes.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.bytes = void 0;
    var utils_1 = require_dist2();
    var utils_2 = require_utils3();
    exports.bytes = {
      isDynamic: true,
      /**
       * Check if a type is a bytes type. Since `bytes` is a simple type, this is
       * just a check that the type is "bytes".
       *
       * @param type - The type to check.
       * @returns Whether the type is a bytes type.
       */
      isType: (type) => type === "bytes",
      /**
       * Get the byte length of an encoded bytes value. Since `bytes` is a simple
       * type, this always returns 32.
       *
       * Note that actual length of a bytes value is variable, but the encoded
       * static value (pointer) is always 32 bytes long.
       *
       * @returns The byte length of an encoded bytes value.
       */
      getByteLength() {
        return 32;
      },
      /**
       * Encode the given bytes value to a byte array.
       *
       * @param args - The encoding arguments.
       * @param args.buffer - The byte array to add to.
       * @param args.value - The bytes value to encode.
       * @param args.packed - Whether to use packed encoding.
       * @returns The bytes with the encoded bytes value added to it.
       */
      encode({ buffer, value, packed }) {
        const bufferValue = (0, utils_1.createBytes)(value);
        if (packed) {
          return (0, utils_1.concatBytes)([buffer, bufferValue]);
        }
        const paddedSize = Math.ceil(bufferValue.byteLength / 32) * 32;
        return (0, utils_1.concatBytes)([
          buffer,
          (0, utils_2.padStart)((0, utils_1.numberToBytes)(bufferValue.byteLength)),
          (0, utils_2.padEnd)(bufferValue, paddedSize)
        ]);
      },
      /**
       * Decode the given byte array to a bytes value.
       *
       * @param args - The decoding arguments.
       * @param args.value - The byte array to decode.
       * @returns The decoded bytes value as a `Uint8Array`.
       */
      decode({ value }) {
        const bytesValue = value.subarray(0, 32);
        const length = (0, utils_1.bytesToNumber)(bytesValue);
        return value.slice(32, 32 + length);
      }
    };
  }
});

// node_modules/@metamask/abi-utils/dist/parsers/function.js
var require_function = __commonJS({
  "node_modules/@metamask/abi-utils/dist/parsers/function.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.fn = exports.getFunction = void 0;
    var superstruct_1 = require_dist();
    var utils_1 = require_dist2();
    var errors_1 = require_errors2();
    var fixed_bytes_1 = require_fixed_bytes();
    var FunctionStruct = (0, superstruct_1.coerce)((0, superstruct_1.object)({
      address: utils_1.StrictHexStruct,
      selector: utils_1.StrictHexStruct
    }), (0, superstruct_1.union)([utils_1.StrictHexStruct, (0, superstruct_1.instance)(Uint8Array)]), (value) => {
      const bytes = (0, utils_1.createBytes)(value);
      (0, utils_1.assert)(bytes.length === 24, new errors_1.ParserError(`Invalid Solidity function. Expected function to be 24 bytes long, but received ${bytes.length} bytes.`));
      return {
        address: (0, utils_1.bytesToHex)(bytes.subarray(0, 20)),
        selector: (0, utils_1.bytesToHex)(bytes.subarray(20, 24))
      };
    });
    var getFunction = (input) => {
      const value = (0, superstruct_1.create)(input, FunctionStruct);
      return (0, utils_1.concatBytes)([(0, utils_1.hexToBytes)(value.address), (0, utils_1.hexToBytes)(value.selector)]);
    };
    exports.getFunction = getFunction;
    exports.fn = {
      isDynamic: false,
      /**
       * Check if a type is a function type. Since `function` is a simple type, this
       * is just a check that the type is "function".
       *
       * @param type - The type to check.
       * @returns Whether the type is a function type.
       */
      isType: (type) => type === "function",
      /**
       * Get the byte length of an encoded function. Since `function` is a simple
       * type, this always returns 32.
       *
       * Note that actual functions are only 24 bytes long, but the encoding of
       * the `function` type is always 32 bytes long.
       *
       * @returns The byte length of an encoded function.
       */
      getByteLength() {
        return 32;
      },
      /**
       * Encode the given function to a byte array.
       *
       * @param args - The encoding arguments.
       * @param args.buffer - The byte array to add to.
       * @param args.value - The function to encode.
       * @param args.packed - Whether to use packed encoding.
       * @param args.tight - Whether to use non-standard tight encoding.
       * @returns The bytes with the encoded function added to it.
       */
      encode({ buffer, value, packed, tight }) {
        const fnValue = (0, exports.getFunction)(value);
        return fixed_bytes_1.fixedBytes.encode({
          type: "bytes24",
          buffer,
          value: fnValue,
          packed,
          tight
        });
      },
      /**
       * Decode the given byte array to a function.
       *
       * @param args - The decoding arguments.
       * @param args.value - The byte array to decode.
       * @returns The decoded function as a {@link SolidityFunction} object.
       */
      decode({ value }) {
        return {
          address: (0, utils_1.bytesToHex)(value.slice(0, 20)),
          selector: (0, utils_1.bytesToHex)(value.slice(20, 24))
        };
      }
    };
  }
});

// node_modules/@metamask/abi-utils/dist/parsers/parser.js
var require_parser = __commonJS({
  "node_modules/@metamask/abi-utils/dist/parsers/parser.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/@metamask/abi-utils/dist/parsers/string.js
var require_string = __commonJS({
  "node_modules/@metamask/abi-utils/dist/parsers/string.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.string = void 0;
    var utils_1 = require_dist2();
    var bytes_1 = require_bytes2();
    exports.string = {
      isDynamic: true,
      /**
       * Check if a type is a string type. Since `string` is a simple type, this
       * is just a check if the type is "string".
       *
       * @param type - The type to check.
       * @returns Whether the type is a string type.
       */
      isType: (type) => type === "string",
      /**
       * Get the byte length of an encoded string type. Since `string` is a simple
       * type, this will always return 32.
       *
       * Note that actual strings are variable in length, but the encoded static
       * value (pointer) is always 32 bytes long.
       *
       * @returns The byte length of an encoded string.
       */
      getByteLength() {
        return 32;
      },
      /**
       * Encode the given string value to a byte array.
       *
       * @param args - The encoding arguments.
       * @param args.buffer - The byte array to add to.
       * @param args.value - The string value to encode.
       * @param args.packed - Whether to use packed encoding.
       * @param args.tight - Whether to use non-standard tight encoding.
       * @returns The bytes with the encoded string value added to it.
       */
      encode({ buffer, value, packed, tight }) {
        return bytes_1.bytes.encode({
          type: "bytes",
          buffer,
          value: (0, utils_1.stringToBytes)(value),
          packed,
          tight
        });
      },
      /**
       * Decode the given byte array to a string value.
       *
       * @param args - The decoding arguments.
       * @returns The decoded string value.
       */
      decode(args) {
        return (0, utils_1.bytesToString)(bytes_1.bytes.decode(args));
      }
    };
  }
});

// node_modules/@metamask/abi-utils/dist/parsers/index.js
var require_parsers = __commonJS({
  "node_modules/@metamask/abi-utils/dist/parsers/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_address(), exports);
    __exportStar(require_array(), exports);
    __exportStar(require_bool(), exports);
    __exportStar(require_bytes2(), exports);
    __exportStar(require_fixed_bytes(), exports);
    __exportStar(require_function(), exports);
    __exportStar(require_number2(), exports);
    __exportStar(require_parser(), exports);
    __exportStar(require_string(), exports);
    __exportStar(require_tuple(), exports);
  }
});

// node_modules/@metamask/abi-utils/dist/packer.js
var require_packer = __commonJS({
  "node_modules/@metamask/abi-utils/dist/packer.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.unpack = exports.pack = exports.isDynamicParser = exports.getParser = void 0;
    var utils_1 = require_dist2();
    var errors_1 = require_errors2();
    var iterator_1 = require_iterator();
    var parsers_1 = require_parsers();
    var utils_2 = require_utils3();
    var getParser = (type) => {
      const parsers = {
        address: parsers_1.address,
        array: parsers_1.array,
        bool: parsers_1.bool,
        bytes: parsers_1.bytes,
        fixedBytes: parsers_1.fixedBytes,
        function: parsers_1.fn,
        number: parsers_1.number,
        string: parsers_1.string,
        tuple: parsers_1.tuple
      };
      const staticParser = parsers[type];
      if (staticParser) {
        return staticParser;
      }
      const parser = Object.values(parsers).find((value) => value.isType(type));
      if (parser) {
        return parser;
      }
      throw new errors_1.ParserError(`The type "${type}" is not supported.`);
    };
    exports.getParser = getParser;
    var isDynamicParser = (parser, type) => {
      const { isDynamic } = parser;
      if (typeof isDynamic === "function") {
        return isDynamic(type);
      }
      return isDynamic;
    };
    exports.isDynamicParser = isDynamicParser;
    var pack = ({ types, values, packed = false, tight = false, arrayPacked = false, byteArray = new Uint8Array() }) => {
      (0, utils_1.assert)(types.length === values.length, new errors_1.ParserError(`The number of types (${types.length}) does not match the number of values (${values.length}).`));
      const { staticBuffer, dynamicBuffer, pointers } = types.reduce(
        // eslint-disable-next-line @typescript-eslint/no-shadow
        ({ staticBuffer: staticBuffer2, dynamicBuffer: dynamicBuffer2, pointers: pointers2 }, type, index) => {
          const parser = (0, exports.getParser)(type);
          const value = values[index];
          if (packed || arrayPacked || !(0, exports.isDynamicParser)(parser, type)) {
            return {
              staticBuffer: parser.encode({
                buffer: staticBuffer2,
                value,
                type,
                packed,
                tight
              }),
              dynamicBuffer: dynamicBuffer2,
              pointers: pointers2
            };
          }
          const newStaticBuffer = (0, utils_1.concatBytes)([staticBuffer2, new Uint8Array(32)]);
          const newDynamicBuffer = parser.encode({
            buffer: dynamicBuffer2,
            value,
            type,
            packed,
            tight
          });
          return {
            staticBuffer: newStaticBuffer,
            dynamicBuffer: newDynamicBuffer,
            pointers: [
              ...pointers2,
              { position: staticBuffer2.length, pointer: dynamicBuffer2.length }
            ]
          };
        },
        {
          staticBuffer: new Uint8Array(),
          dynamicBuffer: new Uint8Array(),
          pointers: []
        }
      );
      (0, utils_1.assert)(!packed && !arrayPacked || dynamicBuffer.length === 0, new errors_1.ParserError("Invalid pack state."));
      const dynamicStart = staticBuffer.length;
      const updatedBuffer = pointers.reduce((target, { pointer, position }) => {
        const offset = (0, utils_2.padStart)((0, utils_1.numberToBytes)(dynamicStart + pointer));
        return (0, utils_2.set)(target, offset, position);
      }, staticBuffer);
      return (0, utils_1.concatBytes)([byteArray, updatedBuffer, dynamicBuffer]);
    };
    exports.pack = pack;
    var unpack = (types, buffer) => {
      const iterator = (0, iterator_1.iterate)(buffer);
      return types.map((type) => {
        const { value: { value, skip }, done } = iterator.next();
        (0, utils_1.assert)(!done, new errors_1.ParserError(`The encoded value is invalid for the provided types. Reached end of buffer while attempting to parse "${type}".`));
        const parser = (0, exports.getParser)(type);
        const isDynamic = (0, exports.isDynamicParser)(parser, type);
        if (isDynamic) {
          const pointer = (0, utils_1.bytesToNumber)(value.subarray(0, 32));
          const target = buffer.subarray(pointer);
          return parser.decode({ type, value: target, skip });
        }
        return parser.decode({ type, value, skip });
      });
    };
    exports.unpack = unpack;
  }
});

// node_modules/@metamask/abi-utils/dist/abi.js
var require_abi = __commonJS({
  "node_modules/@metamask/abi-utils/dist/abi.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.decodeSingle = exports.decode = exports.encodePacked = exports.encodeSingle = exports.encode = void 0;
    var utils_1 = require_dist2();
    var errors_1 = require_errors2();
    var packer_1 = require_packer();
    var encode2 = (types, values, packed, tight) => {
      try {
        return (0, packer_1.pack)({ types, values, packed, tight });
      } catch (error) {
        if (error instanceof errors_1.ParserError) {
          throw new errors_1.ParserError(`Unable to encode value: ${error.message}`, error);
        }
        throw new errors_1.ParserError(`An unexpected error occurred: ${(0, errors_1.getErrorMessage)(error)}`, error);
      }
    };
    exports.encode = encode2;
    var encodeSingle3 = (type, value) => {
      return (0, exports.encode)([type], [value]);
    };
    exports.encodeSingle = encodeSingle3;
    var encodePacked = (types, values, tight) => {
      return (0, exports.encode)(types, values, true, tight);
    };
    exports.encodePacked = encodePacked;
    var decode = (types, value) => {
      const bytes = (0, utils_1.createBytes)(value);
      try {
        return (0, packer_1.unpack)(types, bytes);
      } catch (error) {
        if (error instanceof errors_1.ParserError) {
          throw new errors_1.ParserError(`Unable to decode value: ${error.message}`, error);
        }
        throw new errors_1.ParserError(`An unexpected error occurred: ${(0, errors_1.getErrorMessage)(error)}`, error);
      }
    };
    exports.decode = decode;
    var decodeSingle3 = (type, value) => {
      const result = (0, exports.decode)([type], value);
      (0, utils_1.assert)(result.length === 1, new errors_1.ParserError("Decoded value array has unexpected length."));
      return result[0];
    };
    exports.decodeSingle = decodeSingle3;
  }
});

// node_modules/@metamask/abi-utils/dist/types/abi.js
var require_abi2 = __commonJS({
  "node_modules/@metamask/abi-utils/dist/types/abi.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
  }
});

// node_modules/@metamask/abi-utils/dist/types/index.js
var require_types2 = __commonJS({
  "node_modules/@metamask/abi-utils/dist/types/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_abi2(), exports);
  }
});

// node_modules/@metamask/abi-utils/dist/index.js
var require_dist3 = __commonJS({
  "node_modules/@metamask/abi-utils/dist/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    __exportStar(require_abi(), exports);
    __exportStar(require_errors2(), exports);
    __exportStar(require_types2(), exports);
  }
});

// node_modules/@metamask/delegation-core/dist/index.mjs
var import_abi_utils = __toESM(require_dist3(), 1);
var import_abi_utils2 = __toESM(require_dist3(), 1);
var import_abi_utils3 = __toESM(require_dist3(), 1);
var BalanceChangeType = /* @__PURE__ */ ((BalanceChangeType2) => {
  BalanceChangeType2[BalanceChangeType2["Increase"] = 0] = "Increase";
  BalanceChangeType2[BalanceChangeType2["Decrease"] = 1] = "Decrease";
  return BalanceChangeType2;
})(BalanceChangeType || {});
var toHexString = ({
  value,
  size
}) => {
  return value.toString(16).padStart(size * 2, "0");
};
var normalizeHex = (value, errorMessage) => {
  if (typeof value === "string") {
    if (!isHexString(value)) {
      throw new Error(errorMessage);
    }
    return value;
  }
  return bytesToHex(value);
};
var normalizeAddress = (value, errorMessage) => {
  if (typeof value === "string") {
    if (!isHexString(value) || value.length !== 42) {
      throw new Error(errorMessage);
    }
    return value;
  }
  if (value.length !== 20) {
    throw new Error(errorMessage);
  }
  return bytesToHex(value);
};
var normalizeAddressLowercase = (value, errorMessage) => {
  if (typeof value === "string") {
    if (!isHexString(value) || value.length !== 42) {
      throw new Error(errorMessage);
    }
    return bytesToHex(hexToBytes(value));
  }
  if (value.length !== 20) {
    throw new Error(errorMessage);
  }
  return bytesToHex(value);
};
var concatHex = (parts) => {
  return `0x${parts.map(remove0x).join("")}`;
};
var extractBigInt = (value, offset, size) => {
  const start = 2 + offset * 2;
  const end = start + size * 2;
  const slice = value.slice(start, end);
  return BigInt(`0x${slice}`);
};
var extractNumber = (value, offset, size) => {
  const bigIntValue = extractBigInt(value, offset, size);
  if (bigIntValue > Number.MAX_SAFE_INTEGER) {
    throw new Error("Number is too large");
  }
  return Number(bigIntValue);
};
var extractAddress = (value, offset) => {
  const start = 2 + offset * 2;
  const end = start + 40;
  return `0x${value.slice(start, end)}`;
};
var extractRemainingHex = (value, offset) => {
  const start = 2 + offset * 2;
  return `0x${value.slice(start)}`;
};
function getByteLength(value) {
  return (value.length - 2) / 2;
}
function assertHexByteExactLength(hexTerms, expectedBytes, errorMessage) {
  if (getByteLength(hexTerms) !== expectedBytes) {
    throw new Error(errorMessage);
  }
}
function assertHexByteLengthAtLeastOneMultipleOf(hexTerms, unitBytes, errorMessage) {
  const byteLength = getByteLength(hexTerms);
  if (byteLength === 0 || byteLength % unitBytes !== 0) {
    throw new Error(errorMessage);
  }
}
function assertHexBytesMinLength(hexTerms, minBytes, errorMessage) {
  if (getByteLength(hexTerms) < minBytes) {
    throw new Error(errorMessage);
  }
}
var defaultOptions = { out: "hex" };
function prepareResult(result, options) {
  if (options.out === "hex") {
    const hexValue = typeof result === "string" ? result : bytesToHex(result);
    return hexValue.startsWith("0x") ? hexValue : `0x${hexValue}`;
  }
  const bytesValue = result instanceof Uint8Array ? result : hexToBytes(result);
  return bytesValue;
}
var bytesLikeToHex = (bytesLike) => {
  if (typeof bytesLike === "string") {
    return bytesLike;
  }
  return bytesToHex(bytesLike);
};
var bytesLikeToBytes = (bytesLike) => {
  if (typeof bytesLike === "string") {
    return hexToBytes(bytesLike);
  }
  return bytesLike;
};
function createValueLteTerms(terms, options = defaultOptions) {
  const { maxValue } = terms;
  if (maxValue < 0n) {
    throw new Error("Invalid maxValue: must be greater than or equal to zero");
  }
  const hexValue = toHexString({ value: maxValue, size: 32 });
  return prepareResult(hexValue, options);
}
function decodeValueLteTerms(terms) {
  const hexTerms = bytesLikeToHex(terms);
  assertHexByteExactLength(
    hexTerms,
    32,
    "Invalid ValueLte terms: must be exactly 32 bytes"
  );
  const maxValue = extractBigInt(hexTerms, 0, 32);
  return { maxValue };
}
var TIMESTAMP_UPPER_BOUND_SECONDS = 253402300799;
function createTimestampTerms(terms, encodingOptions = defaultOptions) {
  const { afterThreshold, beforeThreshold } = terms;
  if (afterThreshold < 0) {
    throw new Error("Invalid afterThreshold: must be zero or positive");
  }
  if (beforeThreshold < 0) {
    throw new Error("Invalid beforeThreshold: must be zero or positive");
  }
  if (beforeThreshold > TIMESTAMP_UPPER_BOUND_SECONDS) {
    throw new Error(
      `Invalid beforeThreshold: must be less than or equal to ${TIMESTAMP_UPPER_BOUND_SECONDS}`
    );
  }
  if (afterThreshold > TIMESTAMP_UPPER_BOUND_SECONDS) {
    throw new Error(
      `Invalid afterThreshold: must be less than or equal to ${TIMESTAMP_UPPER_BOUND_SECONDS}`
    );
  }
  if (beforeThreshold !== 0 && afterThreshold >= beforeThreshold) {
    throw new Error(
      "Invalid thresholds: beforeThreshold must be greater than afterThreshold when both are specified"
    );
  }
  const afterThresholdHex = toHexString({
    value: afterThreshold,
    size: 16
  });
  const beforeThresholdHex = toHexString({
    value: beforeThreshold,
    size: 16
  });
  const hexValue = `0x${afterThresholdHex}${beforeThresholdHex}`;
  return prepareResult(hexValue, encodingOptions);
}
function decodeTimestampTerms(terms) {
  const hexTerms = bytesLikeToHex(terms);
  assertHexByteExactLength(
    hexTerms,
    32,
    "Invalid Timestamp terms: must be exactly 32 bytes"
  );
  const afterThreshold = extractNumber(hexTerms, 0, 16);
  const beforeThreshold = extractNumber(hexTerms, 16, 16);
  return { afterThreshold, beforeThreshold };
}
function createNativeTokenPeriodTransferTerms(terms, encodingOptions = defaultOptions) {
  const { periodAmount, periodDuration, startDate } = terms;
  if (periodAmount <= 0n) {
    throw new Error("Invalid periodAmount: must be a positive number");
  }
  if (periodDuration <= 0) {
    throw new Error("Invalid periodDuration: must be a positive number");
  }
  if (startDate <= 0) {
    throw new Error("Invalid startDate: must be a positive number");
  }
  const periodAmountHex = toHexString({ value: periodAmount, size: 32 });
  const periodDurationHex = toHexString({ value: periodDuration, size: 32 });
  const startDateHex = toHexString({ value: startDate, size: 32 });
  const hexValue = `0x${periodAmountHex}${periodDurationHex}${startDateHex}`;
  return prepareResult(hexValue, encodingOptions);
}
function decodeNativeTokenPeriodTransferTerms(terms) {
  const hexTerms = bytesLikeToHex(terms);
  assertHexByteExactLength(
    hexTerms,
    96,
    "Invalid NativeTokenPeriodTransfer terms: must be exactly 96 bytes"
  );
  const periodAmount = extractBigInt(hexTerms, 0, 32);
  const periodDuration = extractNumber(hexTerms, 32, 32);
  const startDate = extractNumber(hexTerms, 64, 32);
  return { periodAmount, periodDuration, startDate };
}
function createExactCalldataTerms(terms, encodingOptions = defaultOptions) {
  const { calldata } = terms;
  if (calldata === void 0 || calldata === null) {
    throw new Error("Invalid calldata: calldata is required");
  }
  if (typeof calldata === "string" && !calldata.startsWith("0x")) {
    throw new Error("Invalid calldata: must be a hex string starting with 0x");
  }
  return prepareResult(calldata, encodingOptions);
}
var EXECUTION_ARRAY_ABI = "(address,uint256,bytes)[]";
function createExactCalldataBatchTerms(terms, encodingOptions = defaultOptions) {
  const { executions } = terms;
  if (executions.length === 0) {
    throw new Error("Invalid executions: array cannot be empty");
  }
  const encodableExecutions = executions.map((execution) => {
    const targetHex = normalizeAddress(
      execution.target,
      "Invalid target: must be a valid address"
    );
    if (execution.value < 0n) {
      throw new Error("Invalid value: must be a non-negative number");
    }
    let callDataHex;
    if (typeof execution.callData === "string") {
      if (!execution.callData.startsWith("0x")) {
        throw new Error(
          "Invalid calldata: must be a hex string starting with 0x"
        );
      }
      callDataHex = execution.callData;
    } else {
      callDataHex = bytesToHex(execution.callData);
    }
    return [targetHex, execution.value, callDataHex];
  });
  const hexValue = (0, import_abi_utils.encodeSingle)(EXECUTION_ARRAY_ABI, encodableExecutions);
  return prepareResult(hexValue, encodingOptions);
}
function createExactExecutionTerms(terms, encodingOptions = defaultOptions) {
  const { execution } = terms;
  const targetHex = normalizeAddress(
    execution.target,
    "Invalid target: must be a valid address"
  );
  if (execution.value < 0n) {
    throw new Error("Invalid value: must be a non-negative number");
  }
  let callDataHex;
  if (typeof execution.callData === "string") {
    if (!execution.callData.startsWith("0x")) {
      throw new Error(
        "Invalid calldata: must be a hex string starting with 0x"
      );
    }
    callDataHex = execution.callData;
  } else {
    callDataHex = bytesToHex(execution.callData);
  }
  const valueHex = `0x${toHexString({ value: execution.value, size: 32 })}`;
  const hexValue = concatHex([targetHex, valueHex, callDataHex]);
  return prepareResult(hexValue, encodingOptions);
}
var EXECUTION_ARRAY_ABI2 = "(address,uint256,bytes)[]";
function createExactExecutionBatchTerms(terms, encodingOptions = defaultOptions) {
  const { executions } = terms;
  if (executions.length === 0) {
    throw new Error("Invalid executions: array cannot be empty");
  }
  const encodableExecutions = executions.map((execution) => {
    const targetHex = normalizeAddress(
      execution.target,
      "Invalid target: must be a valid address"
    );
    if (execution.value < 0n) {
      throw new Error("Invalid value: must be a non-negative number");
    }
    let callDataHex;
    if (typeof execution.callData === "string") {
      if (!execution.callData.startsWith("0x")) {
        throw new Error(
          "Invalid calldata: must be a hex string starting with 0x"
        );
      }
      callDataHex = execution.callData;
    } else {
      callDataHex = bytesToHex(execution.callData);
    }
    return [targetHex, execution.value, callDataHex];
  });
  const hexValue = (0, import_abi_utils2.encodeSingle)(EXECUTION_ARRAY_ABI2, encodableExecutions);
  return prepareResult(hexValue, encodingOptions);
}
var TIMESTAMP_UPPER_BOUND_SECONDS2 = 253402300799;
function createNativeTokenStreamingTerms(terms, encodingOptions = defaultOptions) {
  const { initialAmount, maxAmount, amountPerSecond, startTime } = terms;
  if (initialAmount < 0n) {
    throw new Error("Invalid initialAmount: must be greater than zero");
  }
  if (maxAmount <= 0n) {
    throw new Error("Invalid maxAmount: must be a positive number");
  }
  if (maxAmount < initialAmount) {
    throw new Error("Invalid maxAmount: must be greater than initialAmount");
  }
  if (amountPerSecond <= 0n) {
    throw new Error("Invalid amountPerSecond: must be a positive number");
  }
  if (startTime <= 0) {
    throw new Error("Invalid startTime: must be a positive number");
  }
  if (startTime > TIMESTAMP_UPPER_BOUND_SECONDS2) {
    throw new Error(
      "Invalid startTime: must be less than or equal to 253402300799"
    );
  }
  const initialAmountHex = toHexString({ value: initialAmount, size: 32 });
  const maxAmountHex = toHexString({ value: maxAmount, size: 32 });
  const amountPerSecondHex = toHexString({ value: amountPerSecond, size: 32 });
  const startTimeHex = toHexString({ value: startTime, size: 32 });
  const hexValue = `0x${initialAmountHex}${maxAmountHex}${amountPerSecondHex}${startTimeHex}`;
  return prepareResult(hexValue, encodingOptions);
}
function decodeNativeTokenStreamingTerms(terms) {
  const hexTerms = bytesLikeToHex(terms);
  assertHexByteExactLength(
    hexTerms,
    128,
    "Invalid NativeTokenStreaming terms: must be exactly 128 bytes"
  );
  const initialAmount = extractBigInt(hexTerms, 0, 32);
  const maxAmount = extractBigInt(hexTerms, 32, 32);
  const amountPerSecond = extractBigInt(hexTerms, 64, 32);
  const startTime = extractNumber(hexTerms, 96, 32);
  return { initialAmount, maxAmount, amountPerSecond, startTime };
}
function createNativeTokenTransferAmountTerms(terms, encodingOptions = defaultOptions) {
  const { maxAmount } = terms;
  if (maxAmount < 0n) {
    throw new Error("Invalid maxAmount: must be zero or positive");
  }
  const hexValue = `0x${toHexString({ value: maxAmount, size: 32 })}`;
  return prepareResult(hexValue, encodingOptions);
}
function createNativeTokenPaymentTerms(terms, encodingOptions = defaultOptions) {
  const { recipient, amount } = terms;
  const recipientHex = normalizeAddressLowercase(
    recipient,
    "Invalid recipient: must be a valid address"
  );
  if (amount <= 0n) {
    throw new Error("Invalid amount: must be positive");
  }
  const amountHex = `0x${toHexString({ value: amount, size: 32 })}`;
  const hexValue = concatHex([recipientHex, amountHex]);
  return prepareResult(hexValue, encodingOptions);
}
function createNativeBalanceChangeTerms(terms, encodingOptions = defaultOptions) {
  const { recipient, balance, changeType } = terms;
  const recipientHex = normalizeAddressLowercase(
    recipient,
    "Invalid recipient: must be a valid Address"
  );
  if (balance <= 0n) {
    throw new Error("Invalid balance: must be a positive number");
  }
  if (changeType !== 0 && changeType !== 1) {
    throw new Error("Invalid changeType: must be either Increase or Decrease");
  }
  const changeTypeHex = `0x${toHexString({ value: changeType, size: 1 })}`;
  const balanceHex = `0x${toHexString({ value: balance, size: 32 })}`;
  const hexValue = concatHex([changeTypeHex, recipientHex, balanceHex]);
  return prepareResult(hexValue, encodingOptions);
}
var TIMESTAMP_UPPER_BOUND_SECONDS3 = 253402300799;
function createERC20StreamingTerms(terms, encodingOptions = defaultOptions) {
  const { tokenAddress, initialAmount, maxAmount, amountPerSecond, startTime } = terms;
  if (!tokenAddress) {
    throw new Error("Invalid tokenAddress: must be a valid address");
  }
  let prefixedTokenAddressHex;
  if (typeof tokenAddress === "string") {
    if (!isHexString(tokenAddress) || tokenAddress.length !== 42) {
      throw new Error("Invalid tokenAddress: must be a valid address");
    }
    prefixedTokenAddressHex = tokenAddress;
  } else {
    if (tokenAddress.length !== 20) {
      throw new Error("Invalid tokenAddress: must be a valid address");
    }
    prefixedTokenAddressHex = bytesToHex(tokenAddress);
  }
  if (initialAmount < 0n) {
    throw new Error("Invalid initialAmount: must be greater than zero");
  }
  if (maxAmount <= 0n) {
    throw new Error("Invalid maxAmount: must be a positive number");
  }
  if (maxAmount < initialAmount) {
    throw new Error("Invalid maxAmount: must be greater than initialAmount");
  }
  if (amountPerSecond <= 0n) {
    throw new Error("Invalid amountPerSecond: must be a positive number");
  }
  if (startTime <= 0) {
    throw new Error("Invalid startTime: must be a positive number");
  }
  if (startTime > TIMESTAMP_UPPER_BOUND_SECONDS3) {
    throw new Error(
      "Invalid startTime: must be less than or equal to 253402300799"
    );
  }
  const initialAmountHex = toHexString({ value: initialAmount, size: 32 });
  const maxAmountHex = toHexString({ value: maxAmount, size: 32 });
  const amountPerSecondHex = toHexString({ value: amountPerSecond, size: 32 });
  const startTimeHex = toHexString({ value: startTime, size: 32 });
  const hexValue = `${prefixedTokenAddressHex}${initialAmountHex}${maxAmountHex}${amountPerSecondHex}${startTimeHex}`;
  return prepareResult(hexValue, encodingOptions);
}
function decodeERC20StreamingTerms(terms, encodingOptions = defaultOptions) {
  const hexTerms = bytesLikeToHex(terms);
  assertHexByteExactLength(
    hexTerms,
    148,
    "Invalid ERC20Streaming terms: must be exactly 148 bytes"
  );
  const tokenAddressHex = extractAddress(hexTerms, 0);
  const initialAmount = extractBigInt(hexTerms, 20, 32);
  const maxAmount = extractBigInt(hexTerms, 52, 32);
  const amountPerSecond = extractBigInt(hexTerms, 84, 32);
  const startTime = extractNumber(hexTerms, 116, 32);
  return {
    tokenAddress: prepareResult(tokenAddressHex, encodingOptions),
    initialAmount,
    maxAmount,
    amountPerSecond,
    startTime
  };
}
function createERC20TokenPeriodTransferTerms(terms, encodingOptions = defaultOptions) {
  const { tokenAddress, periodAmount, periodDuration, startDate } = terms;
  if (!tokenAddress) {
    throw new Error("Invalid tokenAddress: must be a valid address");
  }
  let prefixedTokenAddressHex;
  if (typeof tokenAddress === "string") {
    if (!isHexString(tokenAddress) || tokenAddress.length !== 42) {
      throw new Error("Invalid tokenAddress: must be a valid address");
    }
    prefixedTokenAddressHex = tokenAddress;
  } else {
    if (tokenAddress.length !== 20) {
      throw new Error("Invalid tokenAddress: must be a valid address");
    }
    prefixedTokenAddressHex = bytesToHex(tokenAddress);
  }
  if (periodAmount <= 0n) {
    throw new Error("Invalid periodAmount: must be a positive number");
  }
  if (periodDuration <= 0) {
    throw new Error("Invalid periodDuration: must be a positive number");
  }
  if (startDate <= 0) {
    throw new Error("Invalid startDate: must be a positive number");
  }
  const periodAmountHex = toHexString({ value: periodAmount, size: 32 });
  const periodDurationHex = toHexString({ value: periodDuration, size: 32 });
  const startDateHex = toHexString({ value: startDate, size: 32 });
  const hexValue = `${prefixedTokenAddressHex}${periodAmountHex}${periodDurationHex}${startDateHex}`;
  return prepareResult(hexValue, encodingOptions);
}
function decodeERC20TokenPeriodTransferTerms(terms, encodingOptions = defaultOptions) {
  const hexTerms = bytesLikeToHex(terms);
  assertHexByteExactLength(
    hexTerms,
    116,
    "Invalid ERC20TokenPeriodTransfer terms: must be exactly 116 bytes"
  );
  const tokenAddressHex = extractAddress(hexTerms, 0);
  const periodAmount = extractBigInt(hexTerms, 20, 32);
  const periodDuration = extractNumber(hexTerms, 52, 32);
  const startDate = extractNumber(hexTerms, 84, 32);
  return {
    tokenAddress: prepareResult(tokenAddressHex, encodingOptions),
    periodAmount,
    periodDuration,
    startDate
  };
}
function createERC20TransferAmountTerms(terms, encodingOptions = defaultOptions) {
  const { tokenAddress, maxAmount } = terms;
  const tokenAddressHex = normalizeAddress(
    tokenAddress,
    "Invalid tokenAddress: must be a valid address"
  );
  if (maxAmount <= 0n) {
    throw new Error("Invalid maxAmount: must be a positive number");
  }
  const maxAmountHex = `0x${toHexString({ value: maxAmount, size: 32 })}`;
  const hexValue = concatHex([tokenAddressHex, maxAmountHex]);
  return prepareResult(hexValue, encodingOptions);
}
function decodeERC20TransferAmountTerms(terms, encodingOptions = defaultOptions) {
  const hexTerms = bytesLikeToHex(terms);
  assertHexByteExactLength(
    hexTerms,
    52,
    "Invalid ERC20TransferAmount terms: must be exactly 52 bytes"
  );
  const tokenAddressHex = extractAddress(hexTerms, 0);
  const maxAmount = extractBigInt(hexTerms, 20, 32);
  return {
    tokenAddress: prepareResult(tokenAddressHex, encodingOptions),
    maxAmount
  };
}
function createERC20BalanceChangeTerms(terms, encodingOptions = defaultOptions) {
  const { tokenAddress, recipient, balance, changeType } = terms;
  const tokenAddressHex = normalizeAddressLowercase(
    tokenAddress,
    "Invalid tokenAddress: must be a valid address"
  );
  const recipientHex = normalizeAddressLowercase(
    recipient,
    "Invalid recipient: must be a valid address"
  );
  if (balance <= 0n) {
    throw new Error("Invalid balance: must be a positive number");
  }
  if (changeType !== 0 && changeType !== 1) {
    throw new Error("Invalid changeType: must be either Increase or Decrease");
  }
  const changeTypeHex = `0x${toHexString({ value: changeType, size: 1 })}`;
  const balanceHex = `0x${toHexString({ value: balance, size: 32 })}`;
  const hexValue = concatHex([
    changeTypeHex,
    tokenAddressHex,
    recipientHex,
    balanceHex
  ]);
  return prepareResult(hexValue, encodingOptions);
}
function createERC721BalanceChangeTerms(terms, encodingOptions = defaultOptions) {
  const { tokenAddress, recipient, amount, changeType } = terms;
  const tokenAddressHex = normalizeAddressLowercase(
    tokenAddress,
    "Invalid tokenAddress: must be a valid address"
  );
  const recipientHex = normalizeAddressLowercase(
    recipient,
    "Invalid recipient: must be a valid address"
  );
  if (amount <= 0n) {
    throw new Error("Invalid balance: must be a positive number");
  }
  if (changeType !== 0 && changeType !== 1) {
    throw new Error("Invalid changeType: must be either Increase or Decrease");
  }
  const changeTypeHex = `0x${toHexString({ value: changeType, size: 1 })}`;
  const amountHex = `0x${toHexString({ value: amount, size: 32 })}`;
  const hexValue = concatHex([
    changeTypeHex,
    tokenAddressHex,
    recipientHex,
    amountHex
  ]);
  return prepareResult(hexValue, encodingOptions);
}
function createERC721TransferTerms(terms, encodingOptions = defaultOptions) {
  const { tokenAddress, tokenId } = terms;
  const tokenAddressHex = normalizeAddress(
    tokenAddress,
    "Invalid tokenAddress: must be a valid address"
  );
  if (tokenId < 0n) {
    throw new Error("Invalid tokenId: must be a non-negative number");
  }
  const tokenIdHex = `0x${toHexString({ value: tokenId, size: 32 })}`;
  const hexValue = concatHex([tokenAddressHex, tokenIdHex]);
  return prepareResult(hexValue, encodingOptions);
}
function createERC1155BalanceChangeTerms(terms, encodingOptions = defaultOptions) {
  const { tokenAddress, recipient, tokenId, balance, changeType } = terms;
  const tokenAddressHex = normalizeAddressLowercase(
    tokenAddress,
    "Invalid tokenAddress: must be a valid address"
  );
  const recipientHex = normalizeAddressLowercase(
    recipient,
    "Invalid recipient: must be a valid address"
  );
  if (balance <= 0n) {
    throw new Error("Invalid balance: must be a positive number");
  }
  if (tokenId < 0n) {
    throw new Error("Invalid tokenId: must be a non-negative number");
  }
  if (changeType !== 0 && changeType !== 1) {
    throw new Error("Invalid changeType: must be either Increase or Decrease");
  }
  const changeTypeHex = `0x${toHexString({ value: changeType, size: 1 })}`;
  const tokenIdHex = `0x${toHexString({ value: tokenId, size: 32 })}`;
  const balanceHex = `0x${toHexString({ value: balance, size: 32 })}`;
  const hexValue = concatHex([
    changeTypeHex,
    tokenAddressHex,
    recipientHex,
    tokenIdHex,
    balanceHex
  ]);
  return prepareResult(hexValue, encodingOptions);
}
var MAX_NONCE_STRING_LENGTH = 66;
function createNonceTerms(terms, encodingOptions = defaultOptions) {
  const { nonce } = terms;
  if (nonce instanceof Uint8Array && nonce.length === 0) {
    throw new Error("Invalid nonce: Uint8Array must not be empty");
  }
  if (typeof nonce === "string" && !nonce.startsWith("0x")) {
    throw new Error("Invalid nonce: string must have 0x prefix");
  }
  const hexNonce = bytesLikeToHex(nonce);
  if (hexNonce === "0x") {
    throw new Error("Invalid nonce: must not be empty");
  }
  if (!isHexString(hexNonce)) {
    throw new Error("Invalid nonce: must be a valid BytesLike value");
  }
  if (hexNonce.length > MAX_NONCE_STRING_LENGTH) {
    throw new Error("Invalid nonce: must be 32 bytes or less in length");
  }
  const nonceWithoutPrefix = hexNonce.slice(2);
  const paddedNonce = nonceWithoutPrefix.padStart(64, "0");
  const hexValue = `0x${paddedNonce}`;
  return prepareResult(hexValue, encodingOptions);
}
function createAllowedCalldataTerms(terms, encodingOptions = defaultOptions) {
  const { startIndex, value } = terms;
  if (startIndex < 0) {
    throw new Error("Invalid startIndex: must be zero or positive");
  }
  if (!Number.isInteger(startIndex)) {
    throw new Error("Invalid startIndex: must be a whole number");
  }
  let unprefixedValue;
  if (typeof value === "string") {
    if (!value.startsWith("0x")) {
      throw new Error("Invalid value: must be a hex string starting with 0x");
    }
    unprefixedValue = remove0x(value);
  } else {
    unprefixedValue = remove0x(bytesToHex(value));
  }
  const indexHex = toHexString({ value: startIndex, size: 32 });
  return prepareResult(`0x${indexHex}${unprefixedValue}`, encodingOptions);
}
function decodeAllowedCalldataTerms(terms, encodingOptions = defaultOptions) {
  const hexTerms = bytesLikeToHex(terms);
  assertHexBytesMinLength(
    hexTerms,
    32,
    "Invalid AllowedCalldata terms: must be at least 32 bytes"
  );
  const startIndex = extractNumber(hexTerms, 0, 32);
  const valueHex = extractRemainingHex(hexTerms, 32);
  const value = prepareResult(valueHex, encodingOptions);
  return { startIndex, value };
}
var FUNCTION_SELECTOR_STRING_LENGTH = 10;
var INVALID_SELECTOR_ERROR = "Invalid selector: must be a 4 byte hex string, abi function signature, or AbiFunction";
function createAllowedMethodsTerms(terms, encodingOptions = defaultOptions) {
  const { selectors } = terms;
  if (!selectors || selectors.length === 0) {
    throw new Error("Invalid selectors: must provide at least one selector");
  }
  const normalizedSelectors = selectors.map((selector) => {
    if (typeof selector === "string") {
      if (isHexString(selector) && selector.length === FUNCTION_SELECTOR_STRING_LENGTH) {
        return selector;
      }
      throw new Error(INVALID_SELECTOR_ERROR);
    }
    if (selector.length !== 4) {
      throw new Error(INVALID_SELECTOR_ERROR);
    }
    return bytesToHex(selector);
  });
  const hexValue = concatHex(normalizedSelectors);
  return prepareResult(hexValue, encodingOptions);
}
function createAllowedTargetsTerms(terms, encodingOptions = defaultOptions) {
  const { targets } = terms;
  if (!targets || targets.length === 0) {
    throw new Error(
      "Invalid targets: must provide at least one target address"
    );
  }
  const normalizedTargets = targets.map(
    (target) => normalizeAddress(target, "Invalid targets: must be valid addresses")
  );
  const hexValue = concatHex(normalizedTargets);
  return prepareResult(hexValue, encodingOptions);
}
function decodeAllowedTargetsTerms(terms, encodingOptions = defaultOptions) {
  const hexTerms = bytesLikeToHex(terms);
  const addressSize = 20;
  assertHexByteLengthAtLeastOneMultipleOf(
    hexTerms,
    addressSize,
    "Invalid targets: must be a multiple of 20"
  );
  const addressCount = getByteLength(hexTerms) / addressSize;
  const targets = [];
  for (let i = 0; i < addressCount; i++) {
    const target = extractAddress(hexTerms, i * addressSize);
    targets.push(prepareResult(target, encodingOptions));
  }
  return { targets };
}
var BIT_ERC20_APPROVE_ZERO = 1;
var BIT_ERC721_PER_TOKEN_CLEAR = 2;
var BIT_SET_APPROVAL_FOR_ALL_REVOKE = 4;
var BIT_PERMIT2_APPROVE_ZERO = 8;
var BIT_PERMIT2_LOCKDOWN = 16;
var BIT_PERMIT2_INVALIDATE_NONCES = 32;
var ALLOWED_APPROVAL_REVOCATION_MAX_MASK = BIT_ERC20_APPROVE_ZERO | BIT_ERC721_PER_TOKEN_CLEAR | BIT_SET_APPROVAL_FOR_ALL_REVOKE | BIT_PERMIT2_APPROVE_ZERO | BIT_PERMIT2_LOCKDOWN | BIT_PERMIT2_INVALIDATE_NONCES;
var NO_FLAGS_SET_ERROR = "Invalid ApprovalRevocation terms: at least one revocation primitive must be enabled";
function termsToMask(terms) {
  let mask = 0;
  if (terms.erc20Approve) {
    mask |= BIT_ERC20_APPROVE_ZERO;
  }
  if (terms.erc721Approve) {
    mask |= BIT_ERC721_PER_TOKEN_CLEAR;
  }
  if (terms.erc721SetApprovalForAll) {
    mask |= BIT_SET_APPROVAL_FOR_ALL_REVOKE;
  }
  if (terms.permit2Approve) {
    mask |= BIT_PERMIT2_APPROVE_ZERO;
  }
  if (terms.permit2Lockdown) {
    mask |= BIT_PERMIT2_LOCKDOWN;
  }
  if (terms.permit2InvalidateNonces) {
    mask |= BIT_PERMIT2_INVALIDATE_NONCES;
  }
  if (mask === 0) {
    throw new Error(NO_FLAGS_SET_ERROR);
  }
  return mask;
}
function maskToTerms(mask) {
  if (mask > ALLOWED_APPROVAL_REVOCATION_MAX_MASK) {
    throw new Error(
      "Invalid ApprovalRevocation terms: reserved bits must be zero (only bits 0-5 are defined)"
    );
  }
  if (mask === 0) {
    throw new Error(NO_FLAGS_SET_ERROR);
  }
  return {
    erc20Approve: (mask & BIT_ERC20_APPROVE_ZERO) !== 0,
    erc721Approve: (mask & BIT_ERC721_PER_TOKEN_CLEAR) !== 0,
    erc721SetApprovalForAll: (mask & BIT_SET_APPROVAL_FOR_ALL_REVOKE) !== 0,
    permit2Approve: (mask & BIT_PERMIT2_APPROVE_ZERO) !== 0,
    permit2Lockdown: (mask & BIT_PERMIT2_LOCKDOWN) !== 0,
    permit2InvalidateNonces: (mask & BIT_PERMIT2_INVALIDATE_NONCES) !== 0
  };
}
function createApprovalRevocationTerms(terms, encodingOptions = defaultOptions) {
  const mask = termsToMask(terms);
  const hexValue = `0x${toHexString({ value: mask, size: 1 })}`;
  return prepareResult(hexValue, encodingOptions);
}
function decodeApprovalRevocationTerms(terms) {
  const hexTerms = bytesLikeToHex(terms);
  assertHexByteExactLength(
    hexTerms,
    1,
    "Invalid ApprovalRevocation terms: must be exactly 1 byte"
  );
  const mask = extractNumber(hexTerms, 0, 1);
  return maskToTerms(mask);
}
function createArgsEqualityCheckTerms(terms, encodingOptions = defaultOptions) {
  const { args } = terms;
  if (typeof args === "string" && args === "0x") {
    return prepareResult(args, encodingOptions);
  }
  const hexValue = normalizeHex(
    args,
    "Invalid config: args must be a valid hex string"
  );
  return prepareResult(hexValue, encodingOptions);
}
function createBlockNumberTerms(terms, encodingOptions = defaultOptions) {
  const { afterThreshold, beforeThreshold } = terms;
  if (afterThreshold < 0n || beforeThreshold < 0n) {
    throw new Error("Invalid thresholds: block numbers must be non-negative");
  }
  if (afterThreshold === 0n && beforeThreshold === 0n) {
    throw new Error(
      "Invalid thresholds: At least one of afterThreshold or beforeThreshold must be specified"
    );
  }
  if (beforeThreshold !== 0n && afterThreshold >= beforeThreshold) {
    throw new Error(
      "Invalid thresholds: afterThreshold must be less than beforeThreshold if both are specified"
    );
  }
  const afterThresholdHex = toHexString({ value: afterThreshold, size: 16 });
  const beforeThresholdHex = toHexString({ value: beforeThreshold, size: 16 });
  const hexValue = `0x${afterThresholdHex}${beforeThresholdHex}`;
  return prepareResult(hexValue, encodingOptions);
}
function createDeployedTerms(terms, encodingOptions = defaultOptions) {
  const { contractAddress, salt, bytecode } = terms;
  const contractAddressHex = normalizeAddress(
    contractAddress,
    "Invalid contractAddress: must be a valid Ethereum address"
  );
  const saltHex = normalizeHex(
    salt,
    "Invalid salt: must be a valid hexadecimal string"
  );
  const bytecodeHex = normalizeHex(
    bytecode,
    "Invalid bytecode: must be a valid hexadecimal string"
  );
  const unprefixedSalt = remove0x(saltHex);
  if (unprefixedSalt.length > 64) {
    throw new Error("Invalid salt: must be a valid hexadecimal string");
  }
  const paddedSalt = `0x${unprefixedSalt.padStart(64, "0")}`;
  const hexValue = concatHex([contractAddressHex, paddedSalt, bytecodeHex]);
  return prepareResult(hexValue, encodingOptions);
}
var MAX_UINT256 = BigInt(`0x${"f".repeat(64)}`);
function createIdTerms(terms, encodingOptions = defaultOptions) {
  const { id } = terms;
  let idBigInt;
  if (typeof id === "number") {
    if (!Number.isInteger(id)) {
      throw new Error("Invalid id: must be an integer");
    }
    idBigInt = BigInt(id);
  } else if (typeof id === "bigint") {
    idBigInt = id;
  } else {
    throw new Error("Invalid id: must be a bigint or number");
  }
  if (idBigInt < 0n) {
    throw new Error("Invalid id: must be a non-negative number");
  }
  if (idBigInt > MAX_UINT256) {
    throw new Error("Invalid id: must be less than 2^256");
  }
  const hexValue = `0x${toHexString({ value: idBigInt, size: 32 })}`;
  return prepareResult(hexValue, encodingOptions);
}
function createLimitedCallsTerms(terms, encodingOptions = defaultOptions) {
  const { limit } = terms;
  if (!Number.isInteger(limit)) {
    throw new Error("Invalid limit: must be an integer");
  }
  if (limit <= 0) {
    throw new Error("Invalid limit: must be a positive integer");
  }
  const hexValue = `0x${toHexString({ value: limit, size: 32 })}`;
  return prepareResult(hexValue, encodingOptions);
}
function createMultiTokenPeriodTerms(terms, encodingOptions = defaultOptions) {
  const { tokenConfigs } = terms;
  if (!tokenConfigs || tokenConfigs.length === 0) {
    throw new Error(
      "MultiTokenPeriodBuilder: tokenConfigs array cannot be empty"
    );
  }
  const hexParts = [];
  for (const tokenConfig of tokenConfigs) {
    const tokenHex = normalizeAddress(
      tokenConfig.token,
      `Invalid token address: ${String(tokenConfig.token)}`
    );
    if (tokenConfig.periodAmount <= 0n) {
      throw new Error("Invalid period amount: must be greater than 0");
    }
    if (tokenConfig.periodDuration <= 0) {
      throw new Error("Invalid period duration: must be greater than 0");
    }
    if (tokenConfig.startDate <= 0) {
      throw new Error("Invalid start date: must be greater than 0");
    }
    hexParts.push(
      tokenHex,
      `0x${toHexString({ value: tokenConfig.periodAmount, size: 32 })}`,
      `0x${toHexString({ value: tokenConfig.periodDuration, size: 32 })}`,
      `0x${toHexString({ value: tokenConfig.startDate, size: 32 })}`
    );
  }
  const hexValue = concatHex(hexParts);
  return prepareResult(hexValue, encodingOptions);
}
function createOwnershipTransferTerms(terms, encodingOptions = defaultOptions) {
  const { contractAddress } = terms;
  const contractAddressHex = normalizeAddress(
    contractAddress,
    "Invalid contractAddress: must be a valid address"
  );
  return prepareResult(contractAddressHex, encodingOptions);
}
function createRedeemerTerms(terms, encodingOptions = defaultOptions) {
  const { redeemers } = terms;
  if (!redeemers || redeemers.length === 0) {
    throw new Error(
      "Invalid redeemers: must specify at least one redeemer address"
    );
  }
  const normalizedRedeemers = redeemers.map(
    (redeemer) => normalizeAddress(redeemer, "Invalid redeemers: must be a valid address")
  );
  const hexValue = concatHex(normalizedRedeemers);
  return prepareResult(hexValue, encodingOptions);
}
function decodeRedeemerTerms(terms, encodingOptions = defaultOptions) {
  const hexTerms = bytesLikeToHex(terms);
  const addressSize = 20;
  assertHexByteLengthAtLeastOneMultipleOf(
    hexTerms,
    addressSize,
    "Invalid redeemers: must be a multiple of 20"
  );
  const addressCount = getByteLength(hexTerms) / addressSize;
  const redeemers = [];
  for (let i = 0; i < addressCount; i++) {
    const redeemer = extractAddress(hexTerms, i * addressSize);
    redeemers.push(prepareResult(redeemer, encodingOptions));
  }
  return { redeemers };
}
function createSpecificActionERC20TransferBatchTerms(terms, encodingOptions = defaultOptions) {
  const { tokenAddress, recipient, amount, target, calldata } = terms;
  const tokenAddressHex = normalizeAddress(
    tokenAddress,
    "Invalid tokenAddress: must be a valid address"
  );
  const recipientHex = normalizeAddress(
    recipient,
    "Invalid recipient: must be a valid address"
  );
  const targetHex = normalizeAddress(
    target,
    "Invalid target: must be a valid address"
  );
  let calldataHex;
  if (typeof calldata === "string") {
    if (!calldata.startsWith("0x")) {
      throw new Error(
        "Invalid calldata: must be a hex string starting with 0x"
      );
    }
    calldataHex = calldata;
  } else {
    calldataHex = bytesToHex(calldata);
  }
  if (amount <= 0n) {
    throw new Error("Invalid amount: must be a positive number");
  }
  const amountHex = `0x${toHexString({ value: amount, size: 32 })}`;
  const hexValue = concatHex([
    tokenAddressHex,
    recipientHex,
    amountHex,
    targetHex,
    calldataHex
  ]);
  return prepareResult(hexValue, encodingOptions);
}
var ANY_BENEFICIARY = "0x0000000000000000000000000000000000000a11";
var ROOT_AUTHORITY = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
var DELEGATION_TYPEHASH = "0x88c1d2ecf185adf710588203a5f263f0ff61be0d33da39792cde19ba9aa4331e";
var CAVEAT_TYPEHASH = "0x80ad7e1b04ee6d994a125f4714ca0720908bd80ed16063ec8aee4b88e9253e2d";
var DELEGATION_ARRAY_ABI_TYPES = "(address,address,bytes32,(address,bytes,bytes)[],uint256,bytes)[]";
function encodeDelegations(delegations, options = defaultOptions) {
  let result;
  if (delegations.length === 0) {
    result = new Uint8Array(64);
    result[31] = 32;
  } else {
    const encodableStructs = delegations.map((struct) => [
      struct.delegate,
      struct.delegator,
      struct.authority,
      struct.caveats.map((caveat) => [
        caveat.enforcer,
        caveat.terms,
        caveat.args
      ]),
      struct.salt,
      struct.signature
    ]);
    result = (0, import_abi_utils3.encodeSingle)(DELEGATION_ARRAY_ABI_TYPES, encodableStructs);
  }
  return prepareResult(result, options);
}
var delegationFromDecodedDelegation = (decodedDelegation, convertFn) => {
  const [delegate, delegator, authority, caveats, salt, signature] = decodedDelegation;
  return {
    delegate: convertFn(delegate),
    delegator: convertFn(delegator),
    authority: convertFn(authority),
    caveats: caveats.map(([enforcer, terms, args]) => ({
      enforcer: convertFn(enforcer),
      terms: convertFn(terms),
      args: convertFn(args)
    })),
    salt,
    signature: convertFn(signature)
  };
};
function decodeDelegations(encoded, options = defaultOptions) {
  const decodedStructs = (0, import_abi_utils3.decodeSingle)(
    DELEGATION_ARRAY_ABI_TYPES,
    encoded
    // return types cannot be inferred from complex ABI types, so we must assert the type
  );
  if (options.out === "bytes") {
    return decodedStructs.map(
      (struct) => delegationFromDecodedDelegation(struct, bytesLikeToBytes)
    );
  }
  return decodedStructs.map(
    (struct) => delegationFromDecodedDelegation(struct, bytesLikeToHex)
  );
}
function hashDelegation(delegation, options = defaultOptions) {
  const encoded = (0, import_abi_utils3.encode)(
    ["bytes32", "address", "address", "bytes32", "bytes32", "uint256"],
    [
      DELEGATION_TYPEHASH,
      delegation.delegate,
      delegation.delegator,
      delegation.authority,
      getCaveatsArrayHash(delegation.caveats),
      delegation.salt
    ]
  );
  const hash = keccak_256(encoded);
  return prepareResult(hash, options);
}
function getCaveatsArrayHash(caveats) {
  const byteLength = 32 * caveats.length;
  const encoded = new Uint8Array(byteLength);
  for (let i = 0; i < caveats.length; i++) {
    const caveat = caveats[i];
    if (!caveat) {
      throw new Error(`Caveat was undefined at index ${i}`);
    }
    const caveatHash = getCaveatHash(caveat);
    encoded.set(caveatHash, i * 32);
  }
  return keccak_256(encoded);
}
function getCaveatHash(caveat) {
  const termsBytes = typeof caveat.terms === "string" ? hexToBytes(caveat.terms) : caveat.terms;
  const termsHash = keccak_256(termsBytes);
  const encoded = (0, import_abi_utils3.encode)(
    ["bytes32", "address", "bytes32"],
    [CAVEAT_TYPEHASH, caveat.enforcer, termsHash]
  );
  const hash = keccak_256(encoded);
  return hash;
}

export {
  BalanceChangeType,
  createValueLteTerms,
  decodeValueLteTerms,
  createTimestampTerms,
  decodeTimestampTerms,
  createNativeTokenPeriodTransferTerms,
  decodeNativeTokenPeriodTransferTerms,
  createExactCalldataTerms,
  createExactCalldataBatchTerms,
  createExactExecutionTerms,
  createExactExecutionBatchTerms,
  createNativeTokenStreamingTerms,
  decodeNativeTokenStreamingTerms,
  createNativeTokenTransferAmountTerms,
  createNativeTokenPaymentTerms,
  createNativeBalanceChangeTerms,
  createERC20StreamingTerms,
  decodeERC20StreamingTerms,
  createERC20TokenPeriodTransferTerms,
  decodeERC20TokenPeriodTransferTerms,
  createERC20TransferAmountTerms,
  decodeERC20TransferAmountTerms,
  createERC20BalanceChangeTerms,
  createERC721BalanceChangeTerms,
  createERC721TransferTerms,
  createERC1155BalanceChangeTerms,
  createNonceTerms,
  createAllowedCalldataTerms,
  decodeAllowedCalldataTerms,
  createAllowedMethodsTerms,
  createAllowedTargetsTerms,
  decodeAllowedTargetsTerms,
  createApprovalRevocationTerms,
  decodeApprovalRevocationTerms,
  createArgsEqualityCheckTerms,
  createBlockNumberTerms,
  createDeployedTerms,
  createIdTerms,
  createLimitedCallsTerms,
  createMultiTokenPeriodTerms,
  createOwnershipTransferTerms,
  createRedeemerTerms,
  decodeRedeemerTerms,
  createSpecificActionERC20TransferBatchTerms,
  ANY_BENEFICIARY,
  ROOT_AUTHORITY,
  encodeDelegations,
  decodeDelegations,
  hashDelegation
};
