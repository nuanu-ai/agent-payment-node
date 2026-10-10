import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  A,
  I as I2,
  M,
  T as T2,
  _,
  a,
  d as d2,
  e,
  e2,
  f,
  i,
  j,
  l,
  o,
  o2,
  p,
  s as s2,
  s2 as s3,
  y as y2
} from "./chunk-IFNW6LVK.mjs";
import {
  Ct,
  X,
  Y,
  Z,
  at,
  ct,
  lt,
  wt
} from "./chunk-JQH5VL7I.mjs";
import {
  I,
  K,
  L,
  N,
  R,
  S,
  T,
  b,
  c2 as c,
  d2 as d,
  oe,
  re,
  s,
  y
} from "./chunk-IXRUFS4W.mjs";
import {
  CaipAssetTypeStruct,
  KnownCaipNamespace,
  add0x,
  createPublicClient,
  formatUnits,
  getChecksumAddress,
  getIsEip7702UpgradeSupported,
  hexToNumber,
  http,
  isCaipAssetType,
  isCaipChainId,
  isCaipReference,
  isHexChecksumAddress,
  isHexString,
  isStrictHexString,
  numberToHex,
  parseCaipChainId,
  require_lodash,
  toCaipChainId,
  zeroAddress
} from "./chunk-CW2DSIM7.mjs";
import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  isHex,
  multicall3Abi,
  stringToHex,
  toHex
} from "./chunk-FXOPQFK3.mjs";
import {
  __commonJS,
  __esm,
  __require,
  __toESM
} from "./chunk-B7AVLEE2.mjs";

// node_modules/bn.js/lib/bn.js
var require_bn = __commonJS({
  "node_modules/bn.js/lib/bn.js"(exports, module) {
    (function(module2, exports2) {
      "use strict";
      function assert(val, msg) {
        if (!val) throw new Error(msg || "Assertion failed");
      }
      function inherits(ctor, superCtor) {
        ctor.super_ = superCtor;
        var TempCtor = function() {
        };
        TempCtor.prototype = superCtor.prototype;
        ctor.prototype = new TempCtor();
        ctor.prototype.constructor = ctor;
      }
      function BN2(number, base, endian) {
        if (BN2.isBN(number)) {
          return number;
        }
        this.negative = 0;
        this.words = null;
        this.length = 0;
        this.red = null;
        if (number !== null) {
          if (base === "le" || base === "be") {
            endian = base;
            base = 10;
          }
          this._init(number || 0, base || 10, endian || "be");
        }
      }
      if (typeof module2 === "object") {
        module2.exports = BN2;
      } else {
        exports2.BN = BN2;
      }
      BN2.BN = BN2;
      BN2.wordSize = 26;
      var Buffer2;
      try {
        if (typeof window !== "undefined" && typeof window.Buffer !== "undefined") {
          Buffer2 = window.Buffer;
        } else {
          Buffer2 = __require("buffer").Buffer;
        }
      } catch (e3) {
      }
      BN2.isBN = function isBN(num) {
        if (num instanceof BN2) {
          return true;
        }
        return num !== null && typeof num === "object" && num.constructor.wordSize === BN2.wordSize && Array.isArray(num.words);
      };
      BN2.max = function max(left, right) {
        if (left.cmp(right) > 0) return left;
        return right;
      };
      BN2.min = function min(left, right) {
        if (left.cmp(right) < 0) return left;
        return right;
      };
      BN2.prototype._init = function init(number, base, endian) {
        if (typeof number === "number") {
          return this._initNumber(number, base, endian);
        }
        if (typeof number === "object") {
          return this._initArray(number, base, endian);
        }
        if (base === "hex") {
          base = 16;
        }
        assert(base === (base | 0) && base >= 2 && base <= 36);
        number = number.toString().replace(/\s+/g, "");
        var start = 0;
        if (number[0] === "-") {
          start++;
          this.negative = 1;
        }
        if (start < number.length) {
          if (base === 16) {
            this._parseHex(number, start, endian);
          } else {
            this._parseBase(number, base, start);
            if (endian === "le") {
              this._initArray(this.toArray(), base, endian);
            }
          }
        }
      };
      BN2.prototype._initNumber = function _initNumber(number, base, endian) {
        if (number < 0) {
          this.negative = 1;
          number = -number;
        }
        if (number < 67108864) {
          this.words = [number & 67108863];
          this.length = 1;
        } else if (number < 4503599627370496) {
          this.words = [
            number & 67108863,
            number / 67108864 & 67108863
          ];
          this.length = 2;
        } else {
          assert(number < 9007199254740992);
          this.words = [
            number & 67108863,
            number / 67108864 & 67108863,
            1
          ];
          this.length = 3;
        }
        if (endian !== "le") return;
        this._initArray(this.toArray(), base, endian);
      };
      BN2.prototype._initArray = function _initArray(number, base, endian) {
        assert(typeof number.length === "number");
        if (number.length <= 0) {
          this.words = [0];
          this.length = 1;
          return this;
        }
        this.length = Math.ceil(number.length / 3);
        this.words = new Array(this.length);
        for (var i2 = 0; i2 < this.length; i2++) {
          this.words[i2] = 0;
        }
        var j2, w3;
        var off = 0;
        if (endian === "be") {
          for (i2 = number.length - 1, j2 = 0; i2 >= 0; i2 -= 3) {
            w3 = number[i2] | number[i2 - 1] << 8 | number[i2 - 2] << 16;
            this.words[j2] |= w3 << off & 67108863;
            this.words[j2 + 1] = w3 >>> 26 - off & 67108863;
            off += 24;
            if (off >= 26) {
              off -= 26;
              j2++;
            }
          }
        } else if (endian === "le") {
          for (i2 = 0, j2 = 0; i2 < number.length; i2 += 3) {
            w3 = number[i2] | number[i2 + 1] << 8 | number[i2 + 2] << 16;
            this.words[j2] |= w3 << off & 67108863;
            this.words[j2 + 1] = w3 >>> 26 - off & 67108863;
            off += 24;
            if (off >= 26) {
              off -= 26;
              j2++;
            }
          }
        }
        return this._strip();
      };
      function parseHex4Bits(string, index) {
        var c3 = string.charCodeAt(index);
        if (c3 >= 48 && c3 <= 57) {
          return c3 - 48;
        } else if (c3 >= 65 && c3 <= 70) {
          return c3 - 55;
        } else if (c3 >= 97 && c3 <= 102) {
          return c3 - 87;
        } else {
          assert(false, "Invalid character in " + string);
        }
      }
      function parseHexByte(string, lowerBound, index) {
        var r = parseHex4Bits(string, index);
        if (index - 1 >= lowerBound) {
          r |= parseHex4Bits(string, index - 1) << 4;
        }
        return r;
      }
      BN2.prototype._parseHex = function _parseHex(number, start, endian) {
        this.length = Math.ceil((number.length - start) / 6);
        this.words = new Array(this.length);
        for (var i2 = 0; i2 < this.length; i2++) {
          this.words[i2] = 0;
        }
        var off = 0;
        var j2 = 0;
        var w3;
        if (endian === "be") {
          for (i2 = number.length - 1; i2 >= start; i2 -= 2) {
            w3 = parseHexByte(number, start, i2) << off;
            this.words[j2] |= w3 & 67108863;
            if (off >= 18) {
              off -= 18;
              j2 += 1;
              this.words[j2] |= w3 >>> 26;
            } else {
              off += 8;
            }
          }
        } else {
          var parseLength = number.length - start;
          for (i2 = parseLength % 2 === 0 ? start + 1 : start; i2 < number.length; i2 += 2) {
            w3 = parseHexByte(number, start, i2) << off;
            this.words[j2] |= w3 & 67108863;
            if (off >= 18) {
              off -= 18;
              j2 += 1;
              this.words[j2] |= w3 >>> 26;
            } else {
              off += 8;
            }
          }
        }
        this._strip();
      };
      function parseBase(str, start, end, mul) {
        var r = 0;
        var b4 = 0;
        var len = Math.min(str.length, end);
        for (var i2 = start; i2 < len; i2++) {
          var c3 = str.charCodeAt(i2) - 48;
          r *= mul;
          if (c3 >= 49) {
            b4 = c3 - 49 + 10;
          } else if (c3 >= 17) {
            b4 = c3 - 17 + 10;
          } else {
            b4 = c3;
          }
          assert(c3 >= 0 && b4 < mul, "Invalid character");
          r += b4;
        }
        return r;
      }
      BN2.prototype._parseBase = function _parseBase(number, base, start) {
        this.words = [0];
        this.length = 1;
        for (var limbLen = 0, limbPow = 1; limbPow <= 67108863; limbPow *= base) {
          limbLen++;
        }
        limbLen--;
        limbPow = limbPow / base | 0;
        var total = number.length - start;
        var mod = total % limbLen;
        var end = Math.min(total, total - mod) + start;
        var word = 0;
        for (var i2 = start; i2 < end; i2 += limbLen) {
          word = parseBase(number, i2, i2 + limbLen, base);
          this.imuln(limbPow);
          if (this.words[0] + word < 67108864) {
            this.words[0] += word;
          } else {
            this._iaddn(word);
          }
        }
        if (mod !== 0) {
          var pow = 1;
          word = parseBase(number, i2, number.length, base);
          for (i2 = 0; i2 < mod; i2++) {
            pow *= base;
          }
          this.imuln(pow);
          if (this.words[0] + word < 67108864) {
            this.words[0] += word;
          } else {
            this._iaddn(word);
          }
        }
        this._strip();
      };
      BN2.prototype.copy = function copy(dest) {
        dest.words = new Array(this.length);
        for (var i2 = 0; i2 < this.length; i2++) {
          dest.words[i2] = this.words[i2];
        }
        dest.length = this.length;
        dest.negative = this.negative;
        dest.red = this.red;
      };
      function move(dest, src) {
        dest.words = src.words;
        dest.length = src.length;
        dest.negative = src.negative;
        dest.red = src.red;
      }
      BN2.prototype._move = function _move(dest) {
        move(dest, this);
      };
      BN2.prototype.clone = function clone() {
        var r = new BN2(null);
        this.copy(r);
        return r;
      };
      BN2.prototype._expand = function _expand(size) {
        while (this.length < size) {
          this.words[this.length++] = 0;
        }
        return this;
      };
      BN2.prototype._strip = function strip() {
        while (this.length > 1 && this.words[this.length - 1] === 0) {
          this.length--;
        }
        return this._normSign();
      };
      BN2.prototype._normSign = function _normSign() {
        if (this.length === 1 && this.words[0] === 0) {
          this.negative = 0;
        }
        return this;
      };
      if (typeof Symbol !== "undefined" && typeof Symbol.for === "function") {
        try {
          BN2.prototype[/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")] = inspect;
        } catch (e3) {
          BN2.prototype.inspect = inspect;
        }
      } else {
        BN2.prototype.inspect = inspect;
      }
      function inspect() {
        return (this.red ? "<BN-R: " : "<BN: ") + this.toString(16) + ">";
      }
      var zeros = [
        "",
        "0",
        "00",
        "000",
        "0000",
        "00000",
        "000000",
        "0000000",
        "00000000",
        "000000000",
        "0000000000",
        "00000000000",
        "000000000000",
        "0000000000000",
        "00000000000000",
        "000000000000000",
        "0000000000000000",
        "00000000000000000",
        "000000000000000000",
        "0000000000000000000",
        "00000000000000000000",
        "000000000000000000000",
        "0000000000000000000000",
        "00000000000000000000000",
        "000000000000000000000000",
        "0000000000000000000000000"
      ];
      var groupSizes = [
        0,
        0,
        25,
        16,
        12,
        11,
        10,
        9,
        8,
        8,
        7,
        7,
        7,
        7,
        6,
        6,
        6,
        6,
        6,
        6,
        6,
        5,
        5,
        5,
        5,
        5,
        5,
        5,
        5,
        5,
        5,
        5,
        5,
        5,
        5,
        5,
        5
      ];
      var groupBases = [
        0,
        0,
        33554432,
        43046721,
        16777216,
        48828125,
        60466176,
        40353607,
        16777216,
        43046721,
        1e7,
        19487171,
        35831808,
        62748517,
        7529536,
        11390625,
        16777216,
        24137569,
        34012224,
        47045881,
        64e6,
        4084101,
        5153632,
        6436343,
        7962624,
        9765625,
        11881376,
        14348907,
        17210368,
        20511149,
        243e5,
        28629151,
        33554432,
        39135393,
        45435424,
        52521875,
        60466176
      ];
      BN2.prototype.toString = function toString(base, padding) {
        base = base || 10;
        padding = padding | 0 || 1;
        var out;
        if (base === 16 || base === "hex") {
          out = "";
          var off = 0;
          var carry = 0;
          for (var i2 = 0; i2 < this.length; i2++) {
            var w3 = this.words[i2];
            var word = ((w3 << off | carry) & 16777215).toString(16);
            carry = w3 >>> 24 - off & 16777215;
            off += 2;
            if (off >= 26) {
              off -= 26;
              i2--;
            }
            if (carry !== 0 || i2 !== this.length - 1) {
              out = zeros[6 - word.length] + word + out;
            } else {
              out = word + out;
            }
          }
          if (carry !== 0) {
            out = carry.toString(16) + out;
          }
          while (out.length % padding !== 0) {
            out = "0" + out;
          }
          if (this.negative !== 0) {
            out = "-" + out;
          }
          return out;
        }
        if (base === (base | 0) && base >= 2 && base <= 36) {
          var groupSize = groupSizes[base];
          var groupBase = groupBases[base];
          out = "";
          var c3 = this.clone();
          c3.negative = 0;
          while (!c3.isZero()) {
            var r = c3.modrn(groupBase).toString(base);
            c3 = c3.idivn(groupBase);
            if (!c3.isZero()) {
              out = zeros[groupSize - r.length] + r + out;
            } else {
              out = r + out;
            }
          }
          if (this.isZero()) {
            out = "0" + out;
          }
          while (out.length % padding !== 0) {
            out = "0" + out;
          }
          if (this.negative !== 0) {
            out = "-" + out;
          }
          return out;
        }
        assert(false, "Base should be between 2 and 36");
      };
      BN2.prototype.toNumber = function toNumber() {
        var ret = this.words[0];
        if (this.length === 2) {
          ret += this.words[1] * 67108864;
        } else if (this.length === 3 && this.words[2] === 1) {
          ret += 4503599627370496 + this.words[1] * 67108864;
        } else if (this.length > 2) {
          assert(false, "Number can only safely store up to 53 bits");
        }
        return this.negative !== 0 ? -ret : ret;
      };
      BN2.prototype.toJSON = function toJSON() {
        return this.toString(16, 2);
      };
      if (Buffer2) {
        BN2.prototype.toBuffer = function toBuffer(endian, length) {
          return this.toArrayLike(Buffer2, endian, length);
        };
      }
      BN2.prototype.toArray = function toArray(endian, length) {
        return this.toArrayLike(Array, endian, length);
      };
      var allocate = function allocate2(ArrayType, size) {
        if (ArrayType.allocUnsafe) {
          return ArrayType.allocUnsafe(size);
        }
        return new ArrayType(size);
      };
      BN2.prototype.toArrayLike = function toArrayLike(ArrayType, endian, length) {
        this._strip();
        var byteLength = this.byteLength();
        var reqLength = length || Math.max(1, byteLength);
        assert(byteLength <= reqLength, "byte array longer than desired length");
        assert(reqLength > 0, "Requested array length <= 0");
        var res = allocate(ArrayType, reqLength);
        var postfix = endian === "le" ? "LE" : "BE";
        this["_toArrayLike" + postfix](res, byteLength);
        return res;
      };
      BN2.prototype._toArrayLikeLE = function _toArrayLikeLE(res, byteLength) {
        var position = 0;
        var carry = 0;
        for (var i2 = 0, shift = 0; i2 < this.length; i2++) {
          var word = this.words[i2] << shift | carry;
          res[position++] = word & 255;
          if (position < res.length) {
            res[position++] = word >> 8 & 255;
          }
          if (position < res.length) {
            res[position++] = word >> 16 & 255;
          }
          if (shift === 6) {
            if (position < res.length) {
              res[position++] = word >> 24 & 255;
            }
            carry = 0;
            shift = 0;
          } else {
            carry = word >>> 24;
            shift += 2;
          }
        }
        if (position < res.length) {
          res[position++] = carry;
          while (position < res.length) {
            res[position++] = 0;
          }
        }
      };
      BN2.prototype._toArrayLikeBE = function _toArrayLikeBE(res, byteLength) {
        var position = res.length - 1;
        var carry = 0;
        for (var i2 = 0, shift = 0; i2 < this.length; i2++) {
          var word = this.words[i2] << shift | carry;
          res[position--] = word & 255;
          if (position >= 0) {
            res[position--] = word >> 8 & 255;
          }
          if (position >= 0) {
            res[position--] = word >> 16 & 255;
          }
          if (shift === 6) {
            if (position >= 0) {
              res[position--] = word >> 24 & 255;
            }
            carry = 0;
            shift = 0;
          } else {
            carry = word >>> 24;
            shift += 2;
          }
        }
        if (position >= 0) {
          res[position--] = carry;
          while (position >= 0) {
            res[position--] = 0;
          }
        }
      };
      if (Math.clz32) {
        BN2.prototype._countBits = function _countBits(w3) {
          return 32 - Math.clz32(w3);
        };
      } else {
        BN2.prototype._countBits = function _countBits(w3) {
          var t = w3;
          var r = 0;
          if (t >= 4096) {
            r += 13;
            t >>>= 13;
          }
          if (t >= 64) {
            r += 7;
            t >>>= 7;
          }
          if (t >= 8) {
            r += 4;
            t >>>= 4;
          }
          if (t >= 2) {
            r += 2;
            t >>>= 2;
          }
          return r + t;
        };
      }
      BN2.prototype._zeroBits = function _zeroBits(w3) {
        if (w3 === 0) return 26;
        var t = w3;
        var r = 0;
        if ((t & 8191) === 0) {
          r += 13;
          t >>>= 13;
        }
        if ((t & 127) === 0) {
          r += 7;
          t >>>= 7;
        }
        if ((t & 15) === 0) {
          r += 4;
          t >>>= 4;
        }
        if ((t & 3) === 0) {
          r += 2;
          t >>>= 2;
        }
        if ((t & 1) === 0) {
          r++;
        }
        return r;
      };
      BN2.prototype.bitLength = function bitLength() {
        var w3 = this.words[this.length - 1];
        var hi = this._countBits(w3);
        return (this.length - 1) * 26 + hi;
      };
      function toBitArray(num) {
        var w3 = new Array(num.bitLength());
        for (var bit = 0; bit < w3.length; bit++) {
          var off = bit / 26 | 0;
          var wbit = bit % 26;
          w3[bit] = num.words[off] >>> wbit & 1;
        }
        return w3;
      }
      BN2.prototype.zeroBits = function zeroBits() {
        if (this.isZero()) return 0;
        var r = 0;
        for (var i2 = 0; i2 < this.length; i2++) {
          var b4 = this._zeroBits(this.words[i2]);
          r += b4;
          if (b4 !== 26) break;
        }
        return r;
      };
      BN2.prototype.byteLength = function byteLength() {
        return Math.ceil(this.bitLength() / 8);
      };
      BN2.prototype.toTwos = function toTwos(width) {
        if (this.negative !== 0) {
          return this.abs().inotn(width).iaddn(1);
        }
        return this.clone();
      };
      BN2.prototype.fromTwos = function fromTwos(width) {
        if (this.testn(width - 1)) {
          return this.notn(width).iaddn(1).ineg();
        }
        return this.clone();
      };
      BN2.prototype.isNeg = function isNeg() {
        return this.negative !== 0;
      };
      BN2.prototype.neg = function neg() {
        return this.clone().ineg();
      };
      BN2.prototype.ineg = function ineg() {
        if (!this.isZero()) {
          this.negative ^= 1;
        }
        return this;
      };
      BN2.prototype.iuor = function iuor(num) {
        while (this.length < num.length) {
          this.words[this.length++] = 0;
        }
        for (var i2 = 0; i2 < num.length; i2++) {
          this.words[i2] = this.words[i2] | num.words[i2];
        }
        return this._strip();
      };
      BN2.prototype.ior = function ior(num) {
        assert((this.negative | num.negative) === 0);
        return this.iuor(num);
      };
      BN2.prototype.or = function or(num) {
        if (this.length > num.length) return this.clone().ior(num);
        return num.clone().ior(this);
      };
      BN2.prototype.uor = function uor(num) {
        if (this.length > num.length) return this.clone().iuor(num);
        return num.clone().iuor(this);
      };
      BN2.prototype.iuand = function iuand(num) {
        var b4;
        if (this.length > num.length) {
          b4 = num;
        } else {
          b4 = this;
        }
        for (var i2 = 0; i2 < b4.length; i2++) {
          this.words[i2] = this.words[i2] & num.words[i2];
        }
        this.length = b4.length;
        return this._strip();
      };
      BN2.prototype.iand = function iand(num) {
        assert((this.negative | num.negative) === 0);
        return this.iuand(num);
      };
      BN2.prototype.and = function and(num) {
        if (this.length > num.length) return this.clone().iand(num);
        return num.clone().iand(this);
      };
      BN2.prototype.uand = function uand(num) {
        if (this.length > num.length) return this.clone().iuand(num);
        return num.clone().iuand(this);
      };
      BN2.prototype.iuxor = function iuxor(num) {
        var a2;
        var b4;
        if (this.length > num.length) {
          a2 = this;
          b4 = num;
        } else {
          a2 = num;
          b4 = this;
        }
        for (var i2 = 0; i2 < b4.length; i2++) {
          this.words[i2] = a2.words[i2] ^ b4.words[i2];
        }
        if (this !== a2) {
          for (; i2 < a2.length; i2++) {
            this.words[i2] = a2.words[i2];
          }
        }
        this.length = a2.length;
        return this._strip();
      };
      BN2.prototype.ixor = function ixor(num) {
        assert((this.negative | num.negative) === 0);
        return this.iuxor(num);
      };
      BN2.prototype.xor = function xor(num) {
        if (this.length > num.length) return this.clone().ixor(num);
        return num.clone().ixor(this);
      };
      BN2.prototype.uxor = function uxor(num) {
        if (this.length > num.length) return this.clone().iuxor(num);
        return num.clone().iuxor(this);
      };
      BN2.prototype.inotn = function inotn(width) {
        assert(typeof width === "number" && width >= 0);
        var bytesNeeded = Math.ceil(width / 26) | 0;
        var bitsLeft = width % 26;
        this._expand(bytesNeeded);
        if (bitsLeft > 0) {
          bytesNeeded--;
        }
        for (var i2 = 0; i2 < bytesNeeded; i2++) {
          this.words[i2] = ~this.words[i2] & 67108863;
        }
        if (bitsLeft > 0) {
          this.words[i2] = ~this.words[i2] & 67108863 >> 26 - bitsLeft;
          i2++;
        }
        for (; i2 < this.length; i2++) {
          this.words[i2] = 0;
        }
        return this._strip();
      };
      BN2.prototype.notn = function notn(width) {
        return this.clone().inotn(width);
      };
      BN2.prototype.setn = function setn(bit, val) {
        assert(typeof bit === "number" && bit >= 0);
        var off = bit / 26 | 0;
        var wbit = bit % 26;
        this._expand(off + 1);
        if (val) {
          this.words[off] = this.words[off] | 1 << wbit;
        } else {
          this.words[off] = this.words[off] & ~(1 << wbit);
        }
        return this._strip();
      };
      BN2.prototype.iadd = function iadd(num) {
        var r;
        if (this.negative !== 0 && num.negative === 0) {
          this.negative = 0;
          r = this.isub(num);
          this.negative ^= 1;
          return this._normSign();
        } else if (this.negative === 0 && num.negative !== 0) {
          num.negative = 0;
          r = this.isub(num);
          num.negative = 1;
          return r._normSign();
        }
        var a2, b4;
        if (this.length > num.length) {
          a2 = this;
          b4 = num;
        } else {
          a2 = num;
          b4 = this;
        }
        var carry = 0;
        for (var i2 = 0; i2 < b4.length; i2++) {
          r = (a2.words[i2] | 0) + (b4.words[i2] | 0) + carry;
          this.words[i2] = r & 67108863;
          carry = r >>> 26;
        }
        for (; carry !== 0 && i2 < a2.length; i2++) {
          r = (a2.words[i2] | 0) + carry;
          this.words[i2] = r & 67108863;
          carry = r >>> 26;
        }
        this.length = a2.length;
        if (carry !== 0) {
          this.words[this.length] = carry;
          this.length++;
        } else if (a2 !== this) {
          for (; i2 < a2.length; i2++) {
            this.words[i2] = a2.words[i2];
          }
        }
        return this;
      };
      BN2.prototype.add = function add(num) {
        var res;
        if (num.negative !== 0 && this.negative === 0) {
          num.negative = 0;
          res = this.sub(num);
          num.negative ^= 1;
          return res;
        } else if (num.negative === 0 && this.negative !== 0) {
          this.negative = 0;
          res = num.sub(this);
          this.negative = 1;
          return res;
        }
        if (this.length > num.length) return this.clone().iadd(num);
        return num.clone().iadd(this);
      };
      BN2.prototype.isub = function isub(num) {
        if (num.negative !== 0) {
          num.negative = 0;
          var r = this.iadd(num);
          num.negative = 1;
          return r._normSign();
        } else if (this.negative !== 0) {
          this.negative = 0;
          this.iadd(num);
          this.negative = 1;
          return this._normSign();
        }
        var cmp = this.cmp(num);
        if (cmp === 0) {
          this.negative = 0;
          this.length = 1;
          this.words[0] = 0;
          return this;
        }
        var a2, b4;
        if (cmp > 0) {
          a2 = this;
          b4 = num;
        } else {
          a2 = num;
          b4 = this;
        }
        var carry = 0;
        for (var i2 = 0; i2 < b4.length; i2++) {
          r = (a2.words[i2] | 0) - (b4.words[i2] | 0) + carry;
          carry = r >> 26;
          this.words[i2] = r & 67108863;
        }
        for (; carry !== 0 && i2 < a2.length; i2++) {
          r = (a2.words[i2] | 0) + carry;
          carry = r >> 26;
          this.words[i2] = r & 67108863;
        }
        if (carry === 0 && i2 < a2.length && a2 !== this) {
          for (; i2 < a2.length; i2++) {
            this.words[i2] = a2.words[i2];
          }
        }
        this.length = Math.max(this.length, i2);
        if (a2 !== this) {
          this.negative = 1;
        }
        return this._strip();
      };
      BN2.prototype.sub = function sub(num) {
        return this.clone().isub(num);
      };
      function smallMulTo(self, num, out) {
        out.negative = num.negative ^ self.negative;
        var len = self.length + num.length | 0;
        out.length = len;
        len = len - 1 | 0;
        var a2 = self.words[0] | 0;
        var b4 = num.words[0] | 0;
        var r = a2 * b4;
        var lo = r & 67108863;
        var carry = r / 67108864 | 0;
        out.words[0] = lo;
        for (var k2 = 1; k2 < len; k2++) {
          var ncarry = carry >>> 26;
          var rword = carry & 67108863;
          var maxJ = Math.min(k2, num.length - 1);
          for (var j2 = Math.max(0, k2 - self.length + 1); j2 <= maxJ; j2++) {
            var i2 = k2 - j2 | 0;
            a2 = self.words[i2] | 0;
            b4 = num.words[j2] | 0;
            r = a2 * b4 + rword;
            ncarry += r / 67108864 | 0;
            rword = r & 67108863;
          }
          out.words[k2] = rword | 0;
          carry = ncarry | 0;
        }
        if (carry !== 0) {
          out.words[k2] = carry | 0;
        } else {
          out.length--;
        }
        return out._strip();
      }
      var comb10MulTo = function comb10MulTo2(self, num, out) {
        var a2 = self.words;
        var b4 = num.words;
        var o3 = out.words;
        var c3 = 0;
        var lo;
        var mid;
        var hi;
        var a0 = a2[0] | 0;
        var al0 = a0 & 8191;
        var ah0 = a0 >>> 13;
        var a1 = a2[1] | 0;
        var al1 = a1 & 8191;
        var ah1 = a1 >>> 13;
        var a22 = a2[2] | 0;
        var al2 = a22 & 8191;
        var ah2 = a22 >>> 13;
        var a3 = a2[3] | 0;
        var al3 = a3 & 8191;
        var ah3 = a3 >>> 13;
        var a4 = a2[4] | 0;
        var al4 = a4 & 8191;
        var ah4 = a4 >>> 13;
        var a5 = a2[5] | 0;
        var al5 = a5 & 8191;
        var ah5 = a5 >>> 13;
        var a6 = a2[6] | 0;
        var al6 = a6 & 8191;
        var ah6 = a6 >>> 13;
        var a7 = a2[7] | 0;
        var al7 = a7 & 8191;
        var ah7 = a7 >>> 13;
        var a8 = a2[8] | 0;
        var al8 = a8 & 8191;
        var ah8 = a8 >>> 13;
        var a9 = a2[9] | 0;
        var al9 = a9 & 8191;
        var ah9 = a9 >>> 13;
        var b0 = b4[0] | 0;
        var bl0 = b0 & 8191;
        var bh0 = b0 >>> 13;
        var b1 = b4[1] | 0;
        var bl1 = b1 & 8191;
        var bh1 = b1 >>> 13;
        var b22 = b4[2] | 0;
        var bl2 = b22 & 8191;
        var bh2 = b22 >>> 13;
        var b32 = b4[3] | 0;
        var bl3 = b32 & 8191;
        var bh3 = b32 >>> 13;
        var b42 = b4[4] | 0;
        var bl4 = b42 & 8191;
        var bh4 = b42 >>> 13;
        var b5 = b4[5] | 0;
        var bl5 = b5 & 8191;
        var bh5 = b5 >>> 13;
        var b6 = b4[6] | 0;
        var bl6 = b6 & 8191;
        var bh6 = b6 >>> 13;
        var b7 = b4[7] | 0;
        var bl7 = b7 & 8191;
        var bh7 = b7 >>> 13;
        var b8 = b4[8] | 0;
        var bl8 = b8 & 8191;
        var bh8 = b8 >>> 13;
        var b9 = b4[9] | 0;
        var bl9 = b9 & 8191;
        var bh9 = b9 >>> 13;
        out.negative = self.negative ^ num.negative;
        out.length = 19;
        lo = Math.imul(al0, bl0);
        mid = Math.imul(al0, bh0);
        mid = mid + Math.imul(ah0, bl0) | 0;
        hi = Math.imul(ah0, bh0);
        var w0 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w0 >>> 26) | 0;
        w0 &= 67108863;
        lo = Math.imul(al1, bl0);
        mid = Math.imul(al1, bh0);
        mid = mid + Math.imul(ah1, bl0) | 0;
        hi = Math.imul(ah1, bh0);
        lo = lo + Math.imul(al0, bl1) | 0;
        mid = mid + Math.imul(al0, bh1) | 0;
        mid = mid + Math.imul(ah0, bl1) | 0;
        hi = hi + Math.imul(ah0, bh1) | 0;
        var w1 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w1 >>> 26) | 0;
        w1 &= 67108863;
        lo = Math.imul(al2, bl0);
        mid = Math.imul(al2, bh0);
        mid = mid + Math.imul(ah2, bl0) | 0;
        hi = Math.imul(ah2, bh0);
        lo = lo + Math.imul(al1, bl1) | 0;
        mid = mid + Math.imul(al1, bh1) | 0;
        mid = mid + Math.imul(ah1, bl1) | 0;
        hi = hi + Math.imul(ah1, bh1) | 0;
        lo = lo + Math.imul(al0, bl2) | 0;
        mid = mid + Math.imul(al0, bh2) | 0;
        mid = mid + Math.imul(ah0, bl2) | 0;
        hi = hi + Math.imul(ah0, bh2) | 0;
        var w22 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w22 >>> 26) | 0;
        w22 &= 67108863;
        lo = Math.imul(al3, bl0);
        mid = Math.imul(al3, bh0);
        mid = mid + Math.imul(ah3, bl0) | 0;
        hi = Math.imul(ah3, bh0);
        lo = lo + Math.imul(al2, bl1) | 0;
        mid = mid + Math.imul(al2, bh1) | 0;
        mid = mid + Math.imul(ah2, bl1) | 0;
        hi = hi + Math.imul(ah2, bh1) | 0;
        lo = lo + Math.imul(al1, bl2) | 0;
        mid = mid + Math.imul(al1, bh2) | 0;
        mid = mid + Math.imul(ah1, bl2) | 0;
        hi = hi + Math.imul(ah1, bh2) | 0;
        lo = lo + Math.imul(al0, bl3) | 0;
        mid = mid + Math.imul(al0, bh3) | 0;
        mid = mid + Math.imul(ah0, bl3) | 0;
        hi = hi + Math.imul(ah0, bh3) | 0;
        var w3 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w3 >>> 26) | 0;
        w3 &= 67108863;
        lo = Math.imul(al4, bl0);
        mid = Math.imul(al4, bh0);
        mid = mid + Math.imul(ah4, bl0) | 0;
        hi = Math.imul(ah4, bh0);
        lo = lo + Math.imul(al3, bl1) | 0;
        mid = mid + Math.imul(al3, bh1) | 0;
        mid = mid + Math.imul(ah3, bl1) | 0;
        hi = hi + Math.imul(ah3, bh1) | 0;
        lo = lo + Math.imul(al2, bl2) | 0;
        mid = mid + Math.imul(al2, bh2) | 0;
        mid = mid + Math.imul(ah2, bl2) | 0;
        hi = hi + Math.imul(ah2, bh2) | 0;
        lo = lo + Math.imul(al1, bl3) | 0;
        mid = mid + Math.imul(al1, bh3) | 0;
        mid = mid + Math.imul(ah1, bl3) | 0;
        hi = hi + Math.imul(ah1, bh3) | 0;
        lo = lo + Math.imul(al0, bl4) | 0;
        mid = mid + Math.imul(al0, bh4) | 0;
        mid = mid + Math.imul(ah0, bl4) | 0;
        hi = hi + Math.imul(ah0, bh4) | 0;
        var w4 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w4 >>> 26) | 0;
        w4 &= 67108863;
        lo = Math.imul(al5, bl0);
        mid = Math.imul(al5, bh0);
        mid = mid + Math.imul(ah5, bl0) | 0;
        hi = Math.imul(ah5, bh0);
        lo = lo + Math.imul(al4, bl1) | 0;
        mid = mid + Math.imul(al4, bh1) | 0;
        mid = mid + Math.imul(ah4, bl1) | 0;
        hi = hi + Math.imul(ah4, bh1) | 0;
        lo = lo + Math.imul(al3, bl2) | 0;
        mid = mid + Math.imul(al3, bh2) | 0;
        mid = mid + Math.imul(ah3, bl2) | 0;
        hi = hi + Math.imul(ah3, bh2) | 0;
        lo = lo + Math.imul(al2, bl3) | 0;
        mid = mid + Math.imul(al2, bh3) | 0;
        mid = mid + Math.imul(ah2, bl3) | 0;
        hi = hi + Math.imul(ah2, bh3) | 0;
        lo = lo + Math.imul(al1, bl4) | 0;
        mid = mid + Math.imul(al1, bh4) | 0;
        mid = mid + Math.imul(ah1, bl4) | 0;
        hi = hi + Math.imul(ah1, bh4) | 0;
        lo = lo + Math.imul(al0, bl5) | 0;
        mid = mid + Math.imul(al0, bh5) | 0;
        mid = mid + Math.imul(ah0, bl5) | 0;
        hi = hi + Math.imul(ah0, bh5) | 0;
        var w5 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w5 >>> 26) | 0;
        w5 &= 67108863;
        lo = Math.imul(al6, bl0);
        mid = Math.imul(al6, bh0);
        mid = mid + Math.imul(ah6, bl0) | 0;
        hi = Math.imul(ah6, bh0);
        lo = lo + Math.imul(al5, bl1) | 0;
        mid = mid + Math.imul(al5, bh1) | 0;
        mid = mid + Math.imul(ah5, bl1) | 0;
        hi = hi + Math.imul(ah5, bh1) | 0;
        lo = lo + Math.imul(al4, bl2) | 0;
        mid = mid + Math.imul(al4, bh2) | 0;
        mid = mid + Math.imul(ah4, bl2) | 0;
        hi = hi + Math.imul(ah4, bh2) | 0;
        lo = lo + Math.imul(al3, bl3) | 0;
        mid = mid + Math.imul(al3, bh3) | 0;
        mid = mid + Math.imul(ah3, bl3) | 0;
        hi = hi + Math.imul(ah3, bh3) | 0;
        lo = lo + Math.imul(al2, bl4) | 0;
        mid = mid + Math.imul(al2, bh4) | 0;
        mid = mid + Math.imul(ah2, bl4) | 0;
        hi = hi + Math.imul(ah2, bh4) | 0;
        lo = lo + Math.imul(al1, bl5) | 0;
        mid = mid + Math.imul(al1, bh5) | 0;
        mid = mid + Math.imul(ah1, bl5) | 0;
        hi = hi + Math.imul(ah1, bh5) | 0;
        lo = lo + Math.imul(al0, bl6) | 0;
        mid = mid + Math.imul(al0, bh6) | 0;
        mid = mid + Math.imul(ah0, bl6) | 0;
        hi = hi + Math.imul(ah0, bh6) | 0;
        var w6 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w6 >>> 26) | 0;
        w6 &= 67108863;
        lo = Math.imul(al7, bl0);
        mid = Math.imul(al7, bh0);
        mid = mid + Math.imul(ah7, bl0) | 0;
        hi = Math.imul(ah7, bh0);
        lo = lo + Math.imul(al6, bl1) | 0;
        mid = mid + Math.imul(al6, bh1) | 0;
        mid = mid + Math.imul(ah6, bl1) | 0;
        hi = hi + Math.imul(ah6, bh1) | 0;
        lo = lo + Math.imul(al5, bl2) | 0;
        mid = mid + Math.imul(al5, bh2) | 0;
        mid = mid + Math.imul(ah5, bl2) | 0;
        hi = hi + Math.imul(ah5, bh2) | 0;
        lo = lo + Math.imul(al4, bl3) | 0;
        mid = mid + Math.imul(al4, bh3) | 0;
        mid = mid + Math.imul(ah4, bl3) | 0;
        hi = hi + Math.imul(ah4, bh3) | 0;
        lo = lo + Math.imul(al3, bl4) | 0;
        mid = mid + Math.imul(al3, bh4) | 0;
        mid = mid + Math.imul(ah3, bl4) | 0;
        hi = hi + Math.imul(ah3, bh4) | 0;
        lo = lo + Math.imul(al2, bl5) | 0;
        mid = mid + Math.imul(al2, bh5) | 0;
        mid = mid + Math.imul(ah2, bl5) | 0;
        hi = hi + Math.imul(ah2, bh5) | 0;
        lo = lo + Math.imul(al1, bl6) | 0;
        mid = mid + Math.imul(al1, bh6) | 0;
        mid = mid + Math.imul(ah1, bl6) | 0;
        hi = hi + Math.imul(ah1, bh6) | 0;
        lo = lo + Math.imul(al0, bl7) | 0;
        mid = mid + Math.imul(al0, bh7) | 0;
        mid = mid + Math.imul(ah0, bl7) | 0;
        hi = hi + Math.imul(ah0, bh7) | 0;
        var w7 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w7 >>> 26) | 0;
        w7 &= 67108863;
        lo = Math.imul(al8, bl0);
        mid = Math.imul(al8, bh0);
        mid = mid + Math.imul(ah8, bl0) | 0;
        hi = Math.imul(ah8, bh0);
        lo = lo + Math.imul(al7, bl1) | 0;
        mid = mid + Math.imul(al7, bh1) | 0;
        mid = mid + Math.imul(ah7, bl1) | 0;
        hi = hi + Math.imul(ah7, bh1) | 0;
        lo = lo + Math.imul(al6, bl2) | 0;
        mid = mid + Math.imul(al6, bh2) | 0;
        mid = mid + Math.imul(ah6, bl2) | 0;
        hi = hi + Math.imul(ah6, bh2) | 0;
        lo = lo + Math.imul(al5, bl3) | 0;
        mid = mid + Math.imul(al5, bh3) | 0;
        mid = mid + Math.imul(ah5, bl3) | 0;
        hi = hi + Math.imul(ah5, bh3) | 0;
        lo = lo + Math.imul(al4, bl4) | 0;
        mid = mid + Math.imul(al4, bh4) | 0;
        mid = mid + Math.imul(ah4, bl4) | 0;
        hi = hi + Math.imul(ah4, bh4) | 0;
        lo = lo + Math.imul(al3, bl5) | 0;
        mid = mid + Math.imul(al3, bh5) | 0;
        mid = mid + Math.imul(ah3, bl5) | 0;
        hi = hi + Math.imul(ah3, bh5) | 0;
        lo = lo + Math.imul(al2, bl6) | 0;
        mid = mid + Math.imul(al2, bh6) | 0;
        mid = mid + Math.imul(ah2, bl6) | 0;
        hi = hi + Math.imul(ah2, bh6) | 0;
        lo = lo + Math.imul(al1, bl7) | 0;
        mid = mid + Math.imul(al1, bh7) | 0;
        mid = mid + Math.imul(ah1, bl7) | 0;
        hi = hi + Math.imul(ah1, bh7) | 0;
        lo = lo + Math.imul(al0, bl8) | 0;
        mid = mid + Math.imul(al0, bh8) | 0;
        mid = mid + Math.imul(ah0, bl8) | 0;
        hi = hi + Math.imul(ah0, bh8) | 0;
        var w8 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w8 >>> 26) | 0;
        w8 &= 67108863;
        lo = Math.imul(al9, bl0);
        mid = Math.imul(al9, bh0);
        mid = mid + Math.imul(ah9, bl0) | 0;
        hi = Math.imul(ah9, bh0);
        lo = lo + Math.imul(al8, bl1) | 0;
        mid = mid + Math.imul(al8, bh1) | 0;
        mid = mid + Math.imul(ah8, bl1) | 0;
        hi = hi + Math.imul(ah8, bh1) | 0;
        lo = lo + Math.imul(al7, bl2) | 0;
        mid = mid + Math.imul(al7, bh2) | 0;
        mid = mid + Math.imul(ah7, bl2) | 0;
        hi = hi + Math.imul(ah7, bh2) | 0;
        lo = lo + Math.imul(al6, bl3) | 0;
        mid = mid + Math.imul(al6, bh3) | 0;
        mid = mid + Math.imul(ah6, bl3) | 0;
        hi = hi + Math.imul(ah6, bh3) | 0;
        lo = lo + Math.imul(al5, bl4) | 0;
        mid = mid + Math.imul(al5, bh4) | 0;
        mid = mid + Math.imul(ah5, bl4) | 0;
        hi = hi + Math.imul(ah5, bh4) | 0;
        lo = lo + Math.imul(al4, bl5) | 0;
        mid = mid + Math.imul(al4, bh5) | 0;
        mid = mid + Math.imul(ah4, bl5) | 0;
        hi = hi + Math.imul(ah4, bh5) | 0;
        lo = lo + Math.imul(al3, bl6) | 0;
        mid = mid + Math.imul(al3, bh6) | 0;
        mid = mid + Math.imul(ah3, bl6) | 0;
        hi = hi + Math.imul(ah3, bh6) | 0;
        lo = lo + Math.imul(al2, bl7) | 0;
        mid = mid + Math.imul(al2, bh7) | 0;
        mid = mid + Math.imul(ah2, bl7) | 0;
        hi = hi + Math.imul(ah2, bh7) | 0;
        lo = lo + Math.imul(al1, bl8) | 0;
        mid = mid + Math.imul(al1, bh8) | 0;
        mid = mid + Math.imul(ah1, bl8) | 0;
        hi = hi + Math.imul(ah1, bh8) | 0;
        lo = lo + Math.imul(al0, bl9) | 0;
        mid = mid + Math.imul(al0, bh9) | 0;
        mid = mid + Math.imul(ah0, bl9) | 0;
        hi = hi + Math.imul(ah0, bh9) | 0;
        var w9 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w9 >>> 26) | 0;
        w9 &= 67108863;
        lo = Math.imul(al9, bl1);
        mid = Math.imul(al9, bh1);
        mid = mid + Math.imul(ah9, bl1) | 0;
        hi = Math.imul(ah9, bh1);
        lo = lo + Math.imul(al8, bl2) | 0;
        mid = mid + Math.imul(al8, bh2) | 0;
        mid = mid + Math.imul(ah8, bl2) | 0;
        hi = hi + Math.imul(ah8, bh2) | 0;
        lo = lo + Math.imul(al7, bl3) | 0;
        mid = mid + Math.imul(al7, bh3) | 0;
        mid = mid + Math.imul(ah7, bl3) | 0;
        hi = hi + Math.imul(ah7, bh3) | 0;
        lo = lo + Math.imul(al6, bl4) | 0;
        mid = mid + Math.imul(al6, bh4) | 0;
        mid = mid + Math.imul(ah6, bl4) | 0;
        hi = hi + Math.imul(ah6, bh4) | 0;
        lo = lo + Math.imul(al5, bl5) | 0;
        mid = mid + Math.imul(al5, bh5) | 0;
        mid = mid + Math.imul(ah5, bl5) | 0;
        hi = hi + Math.imul(ah5, bh5) | 0;
        lo = lo + Math.imul(al4, bl6) | 0;
        mid = mid + Math.imul(al4, bh6) | 0;
        mid = mid + Math.imul(ah4, bl6) | 0;
        hi = hi + Math.imul(ah4, bh6) | 0;
        lo = lo + Math.imul(al3, bl7) | 0;
        mid = mid + Math.imul(al3, bh7) | 0;
        mid = mid + Math.imul(ah3, bl7) | 0;
        hi = hi + Math.imul(ah3, bh7) | 0;
        lo = lo + Math.imul(al2, bl8) | 0;
        mid = mid + Math.imul(al2, bh8) | 0;
        mid = mid + Math.imul(ah2, bl8) | 0;
        hi = hi + Math.imul(ah2, bh8) | 0;
        lo = lo + Math.imul(al1, bl9) | 0;
        mid = mid + Math.imul(al1, bh9) | 0;
        mid = mid + Math.imul(ah1, bl9) | 0;
        hi = hi + Math.imul(ah1, bh9) | 0;
        var w10 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w10 >>> 26) | 0;
        w10 &= 67108863;
        lo = Math.imul(al9, bl2);
        mid = Math.imul(al9, bh2);
        mid = mid + Math.imul(ah9, bl2) | 0;
        hi = Math.imul(ah9, bh2);
        lo = lo + Math.imul(al8, bl3) | 0;
        mid = mid + Math.imul(al8, bh3) | 0;
        mid = mid + Math.imul(ah8, bl3) | 0;
        hi = hi + Math.imul(ah8, bh3) | 0;
        lo = lo + Math.imul(al7, bl4) | 0;
        mid = mid + Math.imul(al7, bh4) | 0;
        mid = mid + Math.imul(ah7, bl4) | 0;
        hi = hi + Math.imul(ah7, bh4) | 0;
        lo = lo + Math.imul(al6, bl5) | 0;
        mid = mid + Math.imul(al6, bh5) | 0;
        mid = mid + Math.imul(ah6, bl5) | 0;
        hi = hi + Math.imul(ah6, bh5) | 0;
        lo = lo + Math.imul(al5, bl6) | 0;
        mid = mid + Math.imul(al5, bh6) | 0;
        mid = mid + Math.imul(ah5, bl6) | 0;
        hi = hi + Math.imul(ah5, bh6) | 0;
        lo = lo + Math.imul(al4, bl7) | 0;
        mid = mid + Math.imul(al4, bh7) | 0;
        mid = mid + Math.imul(ah4, bl7) | 0;
        hi = hi + Math.imul(ah4, bh7) | 0;
        lo = lo + Math.imul(al3, bl8) | 0;
        mid = mid + Math.imul(al3, bh8) | 0;
        mid = mid + Math.imul(ah3, bl8) | 0;
        hi = hi + Math.imul(ah3, bh8) | 0;
        lo = lo + Math.imul(al2, bl9) | 0;
        mid = mid + Math.imul(al2, bh9) | 0;
        mid = mid + Math.imul(ah2, bl9) | 0;
        hi = hi + Math.imul(ah2, bh9) | 0;
        var w11 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w11 >>> 26) | 0;
        w11 &= 67108863;
        lo = Math.imul(al9, bl3);
        mid = Math.imul(al9, bh3);
        mid = mid + Math.imul(ah9, bl3) | 0;
        hi = Math.imul(ah9, bh3);
        lo = lo + Math.imul(al8, bl4) | 0;
        mid = mid + Math.imul(al8, bh4) | 0;
        mid = mid + Math.imul(ah8, bl4) | 0;
        hi = hi + Math.imul(ah8, bh4) | 0;
        lo = lo + Math.imul(al7, bl5) | 0;
        mid = mid + Math.imul(al7, bh5) | 0;
        mid = mid + Math.imul(ah7, bl5) | 0;
        hi = hi + Math.imul(ah7, bh5) | 0;
        lo = lo + Math.imul(al6, bl6) | 0;
        mid = mid + Math.imul(al6, bh6) | 0;
        mid = mid + Math.imul(ah6, bl6) | 0;
        hi = hi + Math.imul(ah6, bh6) | 0;
        lo = lo + Math.imul(al5, bl7) | 0;
        mid = mid + Math.imul(al5, bh7) | 0;
        mid = mid + Math.imul(ah5, bl7) | 0;
        hi = hi + Math.imul(ah5, bh7) | 0;
        lo = lo + Math.imul(al4, bl8) | 0;
        mid = mid + Math.imul(al4, bh8) | 0;
        mid = mid + Math.imul(ah4, bl8) | 0;
        hi = hi + Math.imul(ah4, bh8) | 0;
        lo = lo + Math.imul(al3, bl9) | 0;
        mid = mid + Math.imul(al3, bh9) | 0;
        mid = mid + Math.imul(ah3, bl9) | 0;
        hi = hi + Math.imul(ah3, bh9) | 0;
        var w12 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w12 >>> 26) | 0;
        w12 &= 67108863;
        lo = Math.imul(al9, bl4);
        mid = Math.imul(al9, bh4);
        mid = mid + Math.imul(ah9, bl4) | 0;
        hi = Math.imul(ah9, bh4);
        lo = lo + Math.imul(al8, bl5) | 0;
        mid = mid + Math.imul(al8, bh5) | 0;
        mid = mid + Math.imul(ah8, bl5) | 0;
        hi = hi + Math.imul(ah8, bh5) | 0;
        lo = lo + Math.imul(al7, bl6) | 0;
        mid = mid + Math.imul(al7, bh6) | 0;
        mid = mid + Math.imul(ah7, bl6) | 0;
        hi = hi + Math.imul(ah7, bh6) | 0;
        lo = lo + Math.imul(al6, bl7) | 0;
        mid = mid + Math.imul(al6, bh7) | 0;
        mid = mid + Math.imul(ah6, bl7) | 0;
        hi = hi + Math.imul(ah6, bh7) | 0;
        lo = lo + Math.imul(al5, bl8) | 0;
        mid = mid + Math.imul(al5, bh8) | 0;
        mid = mid + Math.imul(ah5, bl8) | 0;
        hi = hi + Math.imul(ah5, bh8) | 0;
        lo = lo + Math.imul(al4, bl9) | 0;
        mid = mid + Math.imul(al4, bh9) | 0;
        mid = mid + Math.imul(ah4, bl9) | 0;
        hi = hi + Math.imul(ah4, bh9) | 0;
        var w13 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w13 >>> 26) | 0;
        w13 &= 67108863;
        lo = Math.imul(al9, bl5);
        mid = Math.imul(al9, bh5);
        mid = mid + Math.imul(ah9, bl5) | 0;
        hi = Math.imul(ah9, bh5);
        lo = lo + Math.imul(al8, bl6) | 0;
        mid = mid + Math.imul(al8, bh6) | 0;
        mid = mid + Math.imul(ah8, bl6) | 0;
        hi = hi + Math.imul(ah8, bh6) | 0;
        lo = lo + Math.imul(al7, bl7) | 0;
        mid = mid + Math.imul(al7, bh7) | 0;
        mid = mid + Math.imul(ah7, bl7) | 0;
        hi = hi + Math.imul(ah7, bh7) | 0;
        lo = lo + Math.imul(al6, bl8) | 0;
        mid = mid + Math.imul(al6, bh8) | 0;
        mid = mid + Math.imul(ah6, bl8) | 0;
        hi = hi + Math.imul(ah6, bh8) | 0;
        lo = lo + Math.imul(al5, bl9) | 0;
        mid = mid + Math.imul(al5, bh9) | 0;
        mid = mid + Math.imul(ah5, bl9) | 0;
        hi = hi + Math.imul(ah5, bh9) | 0;
        var w14 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w14 >>> 26) | 0;
        w14 &= 67108863;
        lo = Math.imul(al9, bl6);
        mid = Math.imul(al9, bh6);
        mid = mid + Math.imul(ah9, bl6) | 0;
        hi = Math.imul(ah9, bh6);
        lo = lo + Math.imul(al8, bl7) | 0;
        mid = mid + Math.imul(al8, bh7) | 0;
        mid = mid + Math.imul(ah8, bl7) | 0;
        hi = hi + Math.imul(ah8, bh7) | 0;
        lo = lo + Math.imul(al7, bl8) | 0;
        mid = mid + Math.imul(al7, bh8) | 0;
        mid = mid + Math.imul(ah7, bl8) | 0;
        hi = hi + Math.imul(ah7, bh8) | 0;
        lo = lo + Math.imul(al6, bl9) | 0;
        mid = mid + Math.imul(al6, bh9) | 0;
        mid = mid + Math.imul(ah6, bl9) | 0;
        hi = hi + Math.imul(ah6, bh9) | 0;
        var w15 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w15 >>> 26) | 0;
        w15 &= 67108863;
        lo = Math.imul(al9, bl7);
        mid = Math.imul(al9, bh7);
        mid = mid + Math.imul(ah9, bl7) | 0;
        hi = Math.imul(ah9, bh7);
        lo = lo + Math.imul(al8, bl8) | 0;
        mid = mid + Math.imul(al8, bh8) | 0;
        mid = mid + Math.imul(ah8, bl8) | 0;
        hi = hi + Math.imul(ah8, bh8) | 0;
        lo = lo + Math.imul(al7, bl9) | 0;
        mid = mid + Math.imul(al7, bh9) | 0;
        mid = mid + Math.imul(ah7, bl9) | 0;
        hi = hi + Math.imul(ah7, bh9) | 0;
        var w16 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w16 >>> 26) | 0;
        w16 &= 67108863;
        lo = Math.imul(al9, bl8);
        mid = Math.imul(al9, bh8);
        mid = mid + Math.imul(ah9, bl8) | 0;
        hi = Math.imul(ah9, bh8);
        lo = lo + Math.imul(al8, bl9) | 0;
        mid = mid + Math.imul(al8, bh9) | 0;
        mid = mid + Math.imul(ah8, bl9) | 0;
        hi = hi + Math.imul(ah8, bh9) | 0;
        var w17 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w17 >>> 26) | 0;
        w17 &= 67108863;
        lo = Math.imul(al9, bl9);
        mid = Math.imul(al9, bh9);
        mid = mid + Math.imul(ah9, bl9) | 0;
        hi = Math.imul(ah9, bh9);
        var w18 = (c3 + lo | 0) + ((mid & 8191) << 13) | 0;
        c3 = (hi + (mid >>> 13) | 0) + (w18 >>> 26) | 0;
        w18 &= 67108863;
        o3[0] = w0;
        o3[1] = w1;
        o3[2] = w22;
        o3[3] = w3;
        o3[4] = w4;
        o3[5] = w5;
        o3[6] = w6;
        o3[7] = w7;
        o3[8] = w8;
        o3[9] = w9;
        o3[10] = w10;
        o3[11] = w11;
        o3[12] = w12;
        o3[13] = w13;
        o3[14] = w14;
        o3[15] = w15;
        o3[16] = w16;
        o3[17] = w17;
        o3[18] = w18;
        if (c3 !== 0) {
          o3[19] = c3;
          out.length++;
        }
        return out;
      };
      if (!Math.imul) {
        comb10MulTo = smallMulTo;
      }
      function bigMulTo(self, num, out) {
        out.negative = num.negative ^ self.negative;
        out.length = self.length + num.length;
        var carry = 0;
        var hncarry = 0;
        for (var k2 = 0; k2 < out.length - 1; k2++) {
          var ncarry = hncarry;
          hncarry = 0;
          var rword = carry & 67108863;
          var maxJ = Math.min(k2, num.length - 1);
          for (var j2 = Math.max(0, k2 - self.length + 1); j2 <= maxJ; j2++) {
            var i2 = k2 - j2;
            var a2 = self.words[i2] | 0;
            var b4 = num.words[j2] | 0;
            var r = a2 * b4;
            var lo = r & 67108863;
            ncarry = ncarry + (r / 67108864 | 0) | 0;
            lo = lo + rword | 0;
            rword = lo & 67108863;
            ncarry = ncarry + (lo >>> 26) | 0;
            hncarry += ncarry >>> 26;
            ncarry &= 67108863;
          }
          out.words[k2] = rword;
          carry = ncarry;
          ncarry = hncarry;
        }
        if (carry !== 0) {
          out.words[k2] = carry;
        } else {
          out.length--;
        }
        return out._strip();
      }
      function jumboMulTo(self, num, out) {
        return bigMulTo(self, num, out);
      }
      BN2.prototype.mulTo = function mulTo(num, out) {
        var res;
        var len = this.length + num.length;
        if (this.length === 10 && num.length === 10) {
          res = comb10MulTo(this, num, out);
        } else if (len < 63) {
          res = smallMulTo(this, num, out);
        } else if (len < 1024) {
          res = bigMulTo(this, num, out);
        } else {
          res = jumboMulTo(this, num, out);
        }
        return res;
      };
      function FFTM(x2, y5) {
        this.x = x2;
        this.y = y5;
      }
      FFTM.prototype.makeRBT = function makeRBT(N2) {
        var t = new Array(N2);
        var l3 = BN2.prototype._countBits(N2) - 1;
        for (var i2 = 0; i2 < N2; i2++) {
          t[i2] = this.revBin(i2, l3, N2);
        }
        return t;
      };
      FFTM.prototype.revBin = function revBin(x2, l3, N2) {
        if (x2 === 0 || x2 === N2 - 1) return x2;
        var rb = 0;
        for (var i2 = 0; i2 < l3; i2++) {
          rb |= (x2 & 1) << l3 - i2 - 1;
          x2 >>= 1;
        }
        return rb;
      };
      FFTM.prototype.permute = function permute(rbt, rws, iws, rtws, itws, N2) {
        for (var i2 = 0; i2 < N2; i2++) {
          rtws[i2] = rws[rbt[i2]];
          itws[i2] = iws[rbt[i2]];
        }
      };
      FFTM.prototype.transform = function transform(rws, iws, rtws, itws, N2, rbt) {
        this.permute(rbt, rws, iws, rtws, itws, N2);
        for (var s4 = 1; s4 < N2; s4 <<= 1) {
          var l3 = s4 << 1;
          var rtwdf = Math.cos(2 * Math.PI / l3);
          var itwdf = Math.sin(2 * Math.PI / l3);
          for (var p4 = 0; p4 < N2; p4 += l3) {
            var rtwdf_ = rtwdf;
            var itwdf_ = itwdf;
            for (var j2 = 0; j2 < s4; j2++) {
              var re2 = rtws[p4 + j2];
              var ie2 = itws[p4 + j2];
              var ro = rtws[p4 + j2 + s4];
              var io = itws[p4 + j2 + s4];
              var rx = rtwdf_ * ro - itwdf_ * io;
              io = rtwdf_ * io + itwdf_ * ro;
              ro = rx;
              rtws[p4 + j2] = re2 + ro;
              itws[p4 + j2] = ie2 + io;
              rtws[p4 + j2 + s4] = re2 - ro;
              itws[p4 + j2 + s4] = ie2 - io;
              if (j2 !== l3) {
                rx = rtwdf * rtwdf_ - itwdf * itwdf_;
                itwdf_ = rtwdf * itwdf_ + itwdf * rtwdf_;
                rtwdf_ = rx;
              }
            }
          }
        }
      };
      FFTM.prototype.guessLen13b = function guessLen13b(n, m3) {
        var N2 = Math.max(m3, n) | 1;
        var odd = N2 & 1;
        var i2 = 0;
        for (N2 = N2 / 2 | 0; N2; N2 = N2 >>> 1) {
          i2++;
        }
        return 1 << i2 + 1 + odd;
      };
      FFTM.prototype.conjugate = function conjugate(rws, iws, N2) {
        if (N2 <= 1) return;
        for (var i2 = 0; i2 < N2 / 2; i2++) {
          var t = rws[i2];
          rws[i2] = rws[N2 - i2 - 1];
          rws[N2 - i2 - 1] = t;
          t = iws[i2];
          iws[i2] = -iws[N2 - i2 - 1];
          iws[N2 - i2 - 1] = -t;
        }
      };
      FFTM.prototype.normalize13b = function normalize13b(ws, N2) {
        var carry = 0;
        for (var i2 = 0; i2 < N2 / 2; i2++) {
          var w3 = Math.round(ws[2 * i2 + 1] / N2) * 8192 + Math.round(ws[2 * i2] / N2) + carry;
          ws[i2] = w3 & 67108863;
          if (w3 < 67108864) {
            carry = 0;
          } else {
            carry = w3 / 67108864 | 0;
          }
        }
        return ws;
      };
      FFTM.prototype.convert13b = function convert13b(ws, len, rws, N2) {
        var carry = 0;
        for (var i2 = 0; i2 < len; i2++) {
          carry = carry + (ws[i2] | 0);
          rws[2 * i2] = carry & 8191;
          carry = carry >>> 13;
          rws[2 * i2 + 1] = carry & 8191;
          carry = carry >>> 13;
        }
        for (i2 = 2 * len; i2 < N2; ++i2) {
          rws[i2] = 0;
        }
        assert(carry === 0);
        assert((carry & ~8191) === 0);
      };
      FFTM.prototype.stub = function stub(N2) {
        var ph = new Array(N2);
        for (var i2 = 0; i2 < N2; i2++) {
          ph[i2] = 0;
        }
        return ph;
      };
      FFTM.prototype.mulp = function mulp(x2, y5, out) {
        var N2 = 2 * this.guessLen13b(x2.length, y5.length);
        var rbt = this.makeRBT(N2);
        var _3 = this.stub(N2);
        var rws = new Array(N2);
        var rwst = new Array(N2);
        var iwst = new Array(N2);
        var nrws = new Array(N2);
        var nrwst = new Array(N2);
        var niwst = new Array(N2);
        var rmws = out.words;
        rmws.length = N2;
        this.convert13b(x2.words, x2.length, rws, N2);
        this.convert13b(y5.words, y5.length, nrws, N2);
        this.transform(rws, _3, rwst, iwst, N2, rbt);
        this.transform(nrws, _3, nrwst, niwst, N2, rbt);
        for (var i2 = 0; i2 < N2; i2++) {
          var rx = rwst[i2] * nrwst[i2] - iwst[i2] * niwst[i2];
          iwst[i2] = rwst[i2] * niwst[i2] + iwst[i2] * nrwst[i2];
          rwst[i2] = rx;
        }
        this.conjugate(rwst, iwst, N2);
        this.transform(rwst, iwst, rmws, _3, N2, rbt);
        this.conjugate(rmws, _3, N2);
        this.normalize13b(rmws, N2);
        out.negative = x2.negative ^ y5.negative;
        out.length = x2.length + y5.length;
        return out._strip();
      };
      BN2.prototype.mul = function mul(num) {
        var out = new BN2(null);
        out.words = new Array(this.length + num.length);
        return this.mulTo(num, out);
      };
      BN2.prototype.mulf = function mulf(num) {
        var out = new BN2(null);
        out.words = new Array(this.length + num.length);
        return jumboMulTo(this, num, out);
      };
      BN2.prototype.imul = function imul(num) {
        return this.clone().mulTo(num, this);
      };
      BN2.prototype.imuln = function imuln(num) {
        var isNegNum = num < 0;
        if (isNegNum) num = -num;
        assert(typeof num === "number");
        assert(num < 67108864);
        var carry = 0;
        for (var i2 = 0; i2 < this.length; i2++) {
          var w3 = (this.words[i2] | 0) * num;
          var lo = (w3 & 67108863) + (carry & 67108863);
          carry >>= 26;
          carry += w3 / 67108864 | 0;
          carry += lo >>> 26;
          this.words[i2] = lo & 67108863;
        }
        if (carry !== 0) {
          this.words[i2] = carry;
          this.length++;
        }
        if (num === 0) {
          this.length = 1;
          this._normSign();
        }
        return isNegNum ? this.ineg() : this;
      };
      BN2.prototype.muln = function muln(num) {
        return this.clone().imuln(num);
      };
      BN2.prototype.sqr = function sqr() {
        return this.mul(this);
      };
      BN2.prototype.isqr = function isqr() {
        return this.imul(this.clone());
      };
      BN2.prototype.pow = function pow(num) {
        var w3 = toBitArray(num);
        if (w3.length === 0) return new BN2(1);
        var res = this;
        for (var i2 = 0; i2 < w3.length; i2++, res = res.sqr()) {
          if (w3[i2] !== 0) break;
        }
        if (++i2 < w3.length) {
          for (var q3 = res.sqr(); i2 < w3.length; i2++, q3 = q3.sqr()) {
            if (w3[i2] === 0) continue;
            res = res.mul(q3);
          }
        }
        return res;
      };
      BN2.prototype.iushln = function iushln(bits) {
        assert(typeof bits === "number" && bits >= 0);
        var r = bits % 26;
        var s4 = (bits - r) / 26;
        var carryMask = 67108863 >>> 26 - r << 26 - r;
        var i2;
        if (r !== 0) {
          var carry = 0;
          for (i2 = 0; i2 < this.length; i2++) {
            var newCarry = this.words[i2] & carryMask;
            var c3 = (this.words[i2] | 0) - newCarry << r;
            this.words[i2] = c3 | carry;
            carry = newCarry >>> 26 - r;
          }
          if (carry) {
            this.words[i2] = carry;
            this.length++;
          }
        }
        if (s4 !== 0) {
          for (i2 = this.length - 1; i2 >= 0; i2--) {
            this.words[i2 + s4] = this.words[i2];
          }
          for (i2 = 0; i2 < s4; i2++) {
            this.words[i2] = 0;
          }
          this.length += s4;
        }
        return this._strip();
      };
      BN2.prototype.ishln = function ishln(bits) {
        assert(this.negative === 0);
        return this.iushln(bits);
      };
      BN2.prototype.iushrn = function iushrn(bits, hint, extended) {
        assert(typeof bits === "number" && bits >= 0);
        var h2;
        if (hint) {
          h2 = (hint - hint % 26) / 26;
        } else {
          h2 = 0;
        }
        var r = bits % 26;
        var s4 = Math.min((bits - r) / 26, this.length);
        var mask = 67108863 ^ 67108863 >>> r << r;
        var maskedWords = extended;
        h2 -= s4;
        h2 = Math.max(0, h2);
        if (maskedWords) {
          for (var i2 = 0; i2 < s4; i2++) {
            maskedWords.words[i2] = this.words[i2];
          }
          maskedWords.length = s4;
        }
        if (s4 === 0) {
        } else if (this.length > s4) {
          this.length -= s4;
          for (i2 = 0; i2 < this.length; i2++) {
            this.words[i2] = this.words[i2 + s4];
          }
        } else {
          this.words[0] = 0;
          this.length = 1;
        }
        var carry = 0;
        for (i2 = this.length - 1; i2 >= 0 && (carry !== 0 || i2 >= h2); i2--) {
          var word = this.words[i2] | 0;
          this.words[i2] = carry << 26 - r | word >>> r;
          carry = word & mask;
        }
        if (maskedWords && carry !== 0) {
          maskedWords.words[maskedWords.length++] = carry;
        }
        if (this.length === 0) {
          this.words[0] = 0;
          this.length = 1;
        }
        return this._strip();
      };
      BN2.prototype.ishrn = function ishrn(bits, hint, extended) {
        assert(this.negative === 0);
        return this.iushrn(bits, hint, extended);
      };
      BN2.prototype.shln = function shln(bits) {
        return this.clone().ishln(bits);
      };
      BN2.prototype.ushln = function ushln(bits) {
        return this.clone().iushln(bits);
      };
      BN2.prototype.shrn = function shrn(bits) {
        return this.clone().ishrn(bits);
      };
      BN2.prototype.ushrn = function ushrn(bits) {
        return this.clone().iushrn(bits);
      };
      BN2.prototype.testn = function testn(bit) {
        assert(typeof bit === "number" && bit >= 0);
        var r = bit % 26;
        var s4 = (bit - r) / 26;
        var q3 = 1 << r;
        if (this.length <= s4) return false;
        var w3 = this.words[s4];
        return !!(w3 & q3);
      };
      BN2.prototype.imaskn = function imaskn(bits) {
        assert(typeof bits === "number" && bits >= 0);
        var r = bits % 26;
        var s4 = (bits - r) / 26;
        assert(this.negative === 0, "imaskn works only with positive numbers");
        if (this.length <= s4) {
          return this;
        }
        if (r !== 0) {
          s4++;
        }
        this.length = Math.min(s4, this.length);
        if (r !== 0) {
          var mask = 67108863 ^ 67108863 >>> r << r;
          this.words[this.length - 1] &= mask;
        }
        if (this.length === 0) {
          this.words[0] = 0;
          this.length = 1;
        }
        return this._strip();
      };
      BN2.prototype.maskn = function maskn(bits) {
        return this.clone().imaskn(bits);
      };
      BN2.prototype.iaddn = function iaddn(num) {
        assert(typeof num === "number");
        assert(num < 67108864);
        if (num < 0) return this.isubn(-num);
        if (this.negative !== 0) {
          if (this.length === 1 && (this.words[0] | 0) <= num) {
            this.words[0] = num - (this.words[0] | 0);
            this.negative = 0;
            return this;
          }
          this.negative = 0;
          this.isubn(num);
          this.negative = 1;
          return this;
        }
        return this._iaddn(num);
      };
      BN2.prototype._iaddn = function _iaddn(num) {
        this.words[0] += num;
        for (var i2 = 0; i2 < this.length && this.words[i2] >= 67108864; i2++) {
          this.words[i2] -= 67108864;
          if (i2 === this.length - 1) {
            this.words[i2 + 1] = 1;
          } else {
            this.words[i2 + 1]++;
          }
        }
        this.length = Math.max(this.length, i2 + 1);
        return this;
      };
      BN2.prototype.isubn = function isubn(num) {
        assert(typeof num === "number");
        assert(num < 67108864);
        if (num < 0) return this.iaddn(-num);
        if (this.negative !== 0) {
          this.negative = 0;
          this.iaddn(num);
          this.negative = 1;
          return this;
        }
        this.words[0] -= num;
        if (this.length === 1 && this.words[0] < 0) {
          this.words[0] = -this.words[0];
          this.negative = 1;
        } else {
          for (var i2 = 0; i2 < this.length && this.words[i2] < 0; i2++) {
            this.words[i2] += 67108864;
            this.words[i2 + 1] -= 1;
          }
        }
        return this._strip();
      };
      BN2.prototype.addn = function addn(num) {
        return this.clone().iaddn(num);
      };
      BN2.prototype.subn = function subn(num) {
        return this.clone().isubn(num);
      };
      BN2.prototype.iabs = function iabs() {
        this.negative = 0;
        return this;
      };
      BN2.prototype.abs = function abs() {
        return this.clone().iabs();
      };
      BN2.prototype._ishlnsubmul = function _ishlnsubmul(num, mul, shift) {
        var len = num.length + shift;
        var i2;
        this._expand(len);
        var w3;
        var carry = 0;
        for (i2 = 0; i2 < num.length; i2++) {
          w3 = (this.words[i2 + shift] | 0) + carry;
          var right = (num.words[i2] | 0) * mul;
          w3 -= right & 67108863;
          carry = (w3 >> 26) - (right / 67108864 | 0);
          this.words[i2 + shift] = w3 & 67108863;
        }
        for (; i2 < this.length - shift; i2++) {
          w3 = (this.words[i2 + shift] | 0) + carry;
          carry = w3 >> 26;
          this.words[i2 + shift] = w3 & 67108863;
        }
        if (carry === 0) return this._strip();
        assert(carry === -1);
        carry = 0;
        for (i2 = 0; i2 < this.length; i2++) {
          w3 = -(this.words[i2] | 0) + carry;
          carry = w3 >> 26;
          this.words[i2] = w3 & 67108863;
        }
        this.negative = 1;
        return this._strip();
      };
      BN2.prototype._wordDiv = function _wordDiv(num, mode) {
        var shift = this.length - num.length;
        var a2 = this.clone();
        var b4 = num;
        var bhi = b4.words[b4.length - 1] | 0;
        var bhiBits = this._countBits(bhi);
        shift = 26 - bhiBits;
        if (shift !== 0) {
          b4 = b4.ushln(shift);
          a2.iushln(shift);
          bhi = b4.words[b4.length - 1] | 0;
        }
        var m3 = a2.length - b4.length;
        var q3;
        if (mode !== "mod") {
          q3 = new BN2(null);
          q3.length = m3 + 1;
          q3.words = new Array(q3.length);
          for (var i2 = 0; i2 < q3.length; i2++) {
            q3.words[i2] = 0;
          }
        }
        var diff = a2.clone()._ishlnsubmul(b4, 1, m3);
        if (diff.negative === 0) {
          a2 = diff;
          if (q3) {
            q3.words[m3] = 1;
          }
        }
        for (var j2 = m3 - 1; j2 >= 0; j2--) {
          var qj = (a2.words[b4.length + j2] | 0) * 67108864 + (a2.words[b4.length + j2 - 1] | 0);
          qj = Math.min(qj / bhi | 0, 67108863);
          a2._ishlnsubmul(b4, qj, j2);
          while (a2.negative !== 0) {
            qj--;
            a2.negative = 0;
            a2._ishlnsubmul(b4, 1, j2);
            if (!a2.isZero()) {
              a2.negative ^= 1;
            }
          }
          if (q3) {
            q3.words[j2] = qj;
          }
        }
        if (q3) {
          q3._strip();
        }
        a2._strip();
        if (mode !== "div" && shift !== 0) {
          a2.iushrn(shift);
        }
        return {
          div: q3 || null,
          mod: a2
        };
      };
      BN2.prototype.divmod = function divmod(num, mode, positive) {
        assert(!num.isZero());
        if (this.isZero()) {
          return {
            div: new BN2(0),
            mod: new BN2(0)
          };
        }
        var div, mod, res;
        if (this.negative !== 0 && num.negative === 0) {
          res = this.neg().divmod(num, mode);
          if (mode !== "mod") {
            div = res.div.neg();
          }
          if (mode !== "div") {
            mod = res.mod.neg();
            if (positive && mod.negative !== 0) {
              mod.iadd(num);
            }
          }
          return {
            div,
            mod
          };
        }
        if (this.negative === 0 && num.negative !== 0) {
          res = this.divmod(num.neg(), mode);
          if (mode !== "mod") {
            div = res.div.neg();
          }
          return {
            div,
            mod: res.mod
          };
        }
        if ((this.negative & num.negative) !== 0) {
          res = this.neg().divmod(num.neg(), mode);
          if (mode !== "div") {
            mod = res.mod.neg();
            if (positive && mod.negative !== 0) {
              mod.isub(num);
            }
          }
          return {
            div: res.div,
            mod
          };
        }
        if (num.length > this.length || this.cmp(num) < 0) {
          return {
            div: new BN2(0),
            mod: this
          };
        }
        if (num.length === 1) {
          if (mode === "div") {
            return {
              div: this.divn(num.words[0]),
              mod: null
            };
          }
          if (mode === "mod") {
            return {
              div: null,
              mod: new BN2(this.modrn(num.words[0]))
            };
          }
          return {
            div: this.divn(num.words[0]),
            mod: new BN2(this.modrn(num.words[0]))
          };
        }
        return this._wordDiv(num, mode);
      };
      BN2.prototype.div = function div(num) {
        return this.divmod(num, "div", false).div;
      };
      BN2.prototype.mod = function mod(num) {
        return this.divmod(num, "mod", false).mod;
      };
      BN2.prototype.umod = function umod(num) {
        return this.divmod(num, "mod", true).mod;
      };
      BN2.prototype.divRound = function divRound(num) {
        var dm = this.divmod(num);
        if (dm.mod.isZero()) return dm.div;
        var mod = dm.mod.abs();
        var half = num.abs().iushrn(1);
        var r2 = num.words[0] & 1;
        var cmp = mod.cmp(half);
        if (cmp < 0 || r2 === 1 && cmp === 0) return dm.div;
        var up = new BN2(1);
        up.negative = this.negative ^ num.negative;
        return dm.div.iadd(up);
      };
      BN2.prototype.modrn = function modrn(num) {
        var isNegNum = num < 0;
        if (isNegNum) num = -num;
        assert(num <= 67108863);
        var p4 = (1 << 26) % num;
        var acc = 0;
        for (var i2 = this.length - 1; i2 >= 0; i2--) {
          acc = (p4 * acc + (this.words[i2] | 0)) % num;
        }
        return isNegNum ? -acc : acc;
      };
      BN2.prototype.modn = function modn(num) {
        return this.modrn(num);
      };
      BN2.prototype.idivn = function idivn(num) {
        var isNegNum = num < 0;
        if (isNegNum) num = -num;
        assert(num <= 67108863);
        var carry = 0;
        for (var i2 = this.length - 1; i2 >= 0; i2--) {
          var w3 = (this.words[i2] | 0) + carry * 67108864;
          this.words[i2] = w3 / num | 0;
          carry = w3 % num;
        }
        this._strip();
        return isNegNum ? this.ineg() : this;
      };
      BN2.prototype.divn = function divn(num) {
        return this.clone().idivn(num);
      };
      BN2.prototype.egcd = function egcd(p4) {
        assert(p4.negative === 0);
        assert(!p4.isZero());
        var x2 = this;
        var y5 = p4.clone();
        if (x2.negative !== 0) {
          x2 = x2.umod(p4);
        } else {
          x2 = x2.clone();
        }
        var A3 = new BN2(1);
        var B3 = new BN2(0);
        var C3 = new BN2(0);
        var D3 = new BN2(1);
        var g2 = 0;
        while (x2.isEven() && y5.isEven()) {
          x2.iushrn(1);
          y5.iushrn(1);
          ++g2;
        }
        var yp = y5.clone();
        var xp = x2.clone();
        while (!x2.isZero()) {
          for (var i2 = 0, im = 1; (x2.words[0] & im) === 0 && i2 < 26; ++i2, im <<= 1) ;
          if (i2 > 0) {
            x2.iushrn(i2);
            while (i2-- > 0) {
              if (A3.isOdd() || B3.isOdd()) {
                A3.iadd(yp);
                B3.isub(xp);
              }
              A3.iushrn(1);
              B3.iushrn(1);
            }
          }
          for (var j2 = 0, jm = 1; (y5.words[0] & jm) === 0 && j2 < 26; ++j2, jm <<= 1) ;
          if (j2 > 0) {
            y5.iushrn(j2);
            while (j2-- > 0) {
              if (C3.isOdd() || D3.isOdd()) {
                C3.iadd(yp);
                D3.isub(xp);
              }
              C3.iushrn(1);
              D3.iushrn(1);
            }
          }
          if (x2.cmp(y5) >= 0) {
            x2.isub(y5);
            A3.isub(C3);
            B3.isub(D3);
          } else {
            y5.isub(x2);
            C3.isub(A3);
            D3.isub(B3);
          }
        }
        return {
          a: C3,
          b: D3,
          gcd: y5.iushln(g2)
        };
      };
      BN2.prototype._invmp = function _invmp(p4) {
        assert(p4.negative === 0);
        assert(!p4.isZero());
        var a2 = this;
        var b4 = p4.clone();
        if (a2.negative !== 0) {
          a2 = a2.umod(p4);
        } else {
          a2 = a2.clone();
        }
        var x1 = new BN2(1);
        var x2 = new BN2(0);
        var delta = b4.clone();
        while (a2.cmpn(1) > 0 && b4.cmpn(1) > 0) {
          for (var i2 = 0, im = 1; (a2.words[0] & im) === 0 && i2 < 26; ++i2, im <<= 1) ;
          if (i2 > 0) {
            a2.iushrn(i2);
            while (i2-- > 0) {
              if (x1.isOdd()) {
                x1.iadd(delta);
              }
              x1.iushrn(1);
            }
          }
          for (var j2 = 0, jm = 1; (b4.words[0] & jm) === 0 && j2 < 26; ++j2, jm <<= 1) ;
          if (j2 > 0) {
            b4.iushrn(j2);
            while (j2-- > 0) {
              if (x2.isOdd()) {
                x2.iadd(delta);
              }
              x2.iushrn(1);
            }
          }
          if (a2.cmp(b4) >= 0) {
            a2.isub(b4);
            x1.isub(x2);
          } else {
            b4.isub(a2);
            x2.isub(x1);
          }
        }
        var res;
        if (a2.cmpn(1) === 0) {
          res = x1;
        } else {
          res = x2;
        }
        if (res.cmpn(0) < 0) {
          res.iadd(p4);
        }
        return res;
      };
      BN2.prototype.gcd = function gcd(num) {
        if (this.isZero()) return num.abs();
        if (num.isZero()) return this.abs();
        var a2 = this.clone();
        var b4 = num.clone();
        a2.negative = 0;
        b4.negative = 0;
        for (var shift = 0; a2.isEven() && b4.isEven(); shift++) {
          a2.iushrn(1);
          b4.iushrn(1);
        }
        do {
          while (a2.isEven()) {
            a2.iushrn(1);
          }
          while (b4.isEven()) {
            b4.iushrn(1);
          }
          var r = a2.cmp(b4);
          if (r < 0) {
            var t = a2;
            a2 = b4;
            b4 = t;
          } else if (r === 0 || b4.cmpn(1) === 0) {
            break;
          }
          a2.isub(b4);
        } while (true);
        return b4.iushln(shift);
      };
      BN2.prototype.invm = function invm(num) {
        return this.egcd(num).a.umod(num);
      };
      BN2.prototype.isEven = function isEven() {
        return (this.words[0] & 1) === 0;
      };
      BN2.prototype.isOdd = function isOdd() {
        return (this.words[0] & 1) === 1;
      };
      BN2.prototype.andln = function andln(num) {
        return this.words[0] & num;
      };
      BN2.prototype.bincn = function bincn(bit) {
        assert(typeof bit === "number");
        var r = bit % 26;
        var s4 = (bit - r) / 26;
        var q3 = 1 << r;
        if (this.length <= s4) {
          this._expand(s4 + 1);
          this.words[s4] |= q3;
          return this;
        }
        var carry = q3;
        for (var i2 = s4; carry !== 0 && i2 < this.length; i2++) {
          var w3 = this.words[i2] | 0;
          w3 += carry;
          carry = w3 >>> 26;
          w3 &= 67108863;
          this.words[i2] = w3;
        }
        if (carry !== 0) {
          this.words[i2] = carry;
          this.length++;
        }
        return this;
      };
      BN2.prototype.isZero = function isZero() {
        return this.length === 1 && this.words[0] === 0;
      };
      BN2.prototype.cmpn = function cmpn(num) {
        var negative = num < 0;
        if (this.negative !== 0 && !negative) return -1;
        if (this.negative === 0 && negative) return 1;
        this._strip();
        var res;
        if (this.length > 1) {
          res = 1;
        } else {
          if (negative) {
            num = -num;
          }
          assert(num <= 67108863, "Number is too big");
          var w3 = this.words[0] | 0;
          res = w3 === num ? 0 : w3 < num ? -1 : 1;
        }
        if (this.negative !== 0) return -res | 0;
        return res;
      };
      BN2.prototype.cmp = function cmp(num) {
        if (this.negative !== 0 && num.negative === 0) return -1;
        if (this.negative === 0 && num.negative !== 0) return 1;
        var res = this.ucmp(num);
        if (this.negative !== 0) return -res | 0;
        return res;
      };
      BN2.prototype.ucmp = function ucmp(num) {
        if (this.length > num.length) return 1;
        if (this.length < num.length) return -1;
        var res = 0;
        for (var i2 = this.length - 1; i2 >= 0; i2--) {
          var a2 = this.words[i2] | 0;
          var b4 = num.words[i2] | 0;
          if (a2 === b4) continue;
          if (a2 < b4) {
            res = -1;
          } else if (a2 > b4) {
            res = 1;
          }
          break;
        }
        return res;
      };
      BN2.prototype.gtn = function gtn(num) {
        return this.cmpn(num) === 1;
      };
      BN2.prototype.gt = function gt2(num) {
        return this.cmp(num) === 1;
      };
      BN2.prototype.gten = function gten(num) {
        return this.cmpn(num) >= 0;
      };
      BN2.prototype.gte = function gte(num) {
        return this.cmp(num) >= 0;
      };
      BN2.prototype.ltn = function ltn(num) {
        return this.cmpn(num) === -1;
      };
      BN2.prototype.lt = function lt3(num) {
        return this.cmp(num) === -1;
      };
      BN2.prototype.lten = function lten(num) {
        return this.cmpn(num) <= 0;
      };
      BN2.prototype.lte = function lte(num) {
        return this.cmp(num) <= 0;
      };
      BN2.prototype.eqn = function eqn(num) {
        return this.cmpn(num) === 0;
      };
      BN2.prototype.eq = function eq(num) {
        return this.cmp(num) === 0;
      };
      BN2.red = function red(num) {
        return new Red(num);
      };
      BN2.prototype.toRed = function toRed(ctx) {
        assert(!this.red, "Already a number in reduction context");
        assert(this.negative === 0, "red works only with positives");
        return ctx.convertTo(this)._forceRed(ctx);
      };
      BN2.prototype.fromRed = function fromRed() {
        assert(this.red, "fromRed works only with numbers in reduction context");
        return this.red.convertFrom(this);
      };
      BN2.prototype._forceRed = function _forceRed(ctx) {
        this.red = ctx;
        return this;
      };
      BN2.prototype.forceRed = function forceRed(ctx) {
        assert(!this.red, "Already a number in reduction context");
        return this._forceRed(ctx);
      };
      BN2.prototype.redAdd = function redAdd(num) {
        assert(this.red, "redAdd works only with red numbers");
        return this.red.add(this, num);
      };
      BN2.prototype.redIAdd = function redIAdd(num) {
        assert(this.red, "redIAdd works only with red numbers");
        return this.red.iadd(this, num);
      };
      BN2.prototype.redSub = function redSub(num) {
        assert(this.red, "redSub works only with red numbers");
        return this.red.sub(this, num);
      };
      BN2.prototype.redISub = function redISub(num) {
        assert(this.red, "redISub works only with red numbers");
        return this.red.isub(this, num);
      };
      BN2.prototype.redShl = function redShl(num) {
        assert(this.red, "redShl works only with red numbers");
        return this.red.shl(this, num);
      };
      BN2.prototype.redMul = function redMul(num) {
        assert(this.red, "redMul works only with red numbers");
        this.red._verify2(this, num);
        return this.red.mul(this, num);
      };
      BN2.prototype.redIMul = function redIMul(num) {
        assert(this.red, "redMul works only with red numbers");
        this.red._verify2(this, num);
        return this.red.imul(this, num);
      };
      BN2.prototype.redSqr = function redSqr() {
        assert(this.red, "redSqr works only with red numbers");
        this.red._verify1(this);
        return this.red.sqr(this);
      };
      BN2.prototype.redISqr = function redISqr() {
        assert(this.red, "redISqr works only with red numbers");
        this.red._verify1(this);
        return this.red.isqr(this);
      };
      BN2.prototype.redSqrt = function redSqrt() {
        assert(this.red, "redSqrt works only with red numbers");
        this.red._verify1(this);
        return this.red.sqrt(this);
      };
      BN2.prototype.redInvm = function redInvm() {
        assert(this.red, "redInvm works only with red numbers");
        this.red._verify1(this);
        return this.red.invm(this);
      };
      BN2.prototype.redNeg = function redNeg() {
        assert(this.red, "redNeg works only with red numbers");
        this.red._verify1(this);
        return this.red.neg(this);
      };
      BN2.prototype.redPow = function redPow(num) {
        assert(this.red && !num.red, "redPow(normalNum)");
        this.red._verify1(this);
        return this.red.pow(this, num);
      };
      var primes = {
        k256: null,
        p224: null,
        p192: null,
        p25519: null
      };
      function MPrime(name2, p4) {
        this.name = name2;
        this.p = new BN2(p4, 16);
        this.n = this.p.bitLength();
        this.k = new BN2(1).iushln(this.n).isub(this.p);
        this.tmp = this._tmp();
      }
      MPrime.prototype._tmp = function _tmp() {
        var tmp = new BN2(null);
        tmp.words = new Array(Math.ceil(this.n / 13));
        return tmp;
      };
      MPrime.prototype.ireduce = function ireduce(num) {
        var r = num;
        var rlen;
        do {
          this.split(r, this.tmp);
          r = this.imulK(r);
          r = r.iadd(this.tmp);
          rlen = r.bitLength();
        } while (rlen > this.n);
        var cmp = rlen < this.n ? -1 : r.ucmp(this.p);
        if (cmp === 0) {
          r.words[0] = 0;
          r.length = 1;
        } else if (cmp > 0) {
          r.isub(this.p);
        } else {
          if (r.strip !== void 0) {
            r.strip();
          } else {
            r._strip();
          }
        }
        return r;
      };
      MPrime.prototype.split = function split(input, out) {
        input.iushrn(this.n, 0, out);
      };
      MPrime.prototype.imulK = function imulK(num) {
        return num.imul(this.k);
      };
      function K256() {
        MPrime.call(
          this,
          "k256",
          "ffffffff ffffffff ffffffff ffffffff ffffffff ffffffff fffffffe fffffc2f"
        );
      }
      inherits(K256, MPrime);
      K256.prototype.split = function split(input, output) {
        var mask = 4194303;
        var outLen = Math.min(input.length, 9);
        for (var i2 = 0; i2 < outLen; i2++) {
          output.words[i2] = input.words[i2];
        }
        output.length = outLen;
        if (input.length <= 9) {
          input.words[0] = 0;
          input.length = 1;
          return;
        }
        var prev = input.words[9];
        output.words[output.length++] = prev & mask;
        for (i2 = 10; i2 < input.length; i2++) {
          var next = input.words[i2] | 0;
          input.words[i2 - 10] = (next & mask) << 4 | prev >>> 22;
          prev = next;
        }
        prev >>>= 22;
        input.words[i2 - 10] = prev;
        if (prev === 0 && input.length > 10) {
          input.length -= 10;
        } else {
          input.length -= 9;
        }
      };
      K256.prototype.imulK = function imulK(num) {
        num.words[num.length] = 0;
        num.words[num.length + 1] = 0;
        num.length += 2;
        var lo = 0;
        for (var i2 = 0; i2 < num.length; i2++) {
          var w3 = num.words[i2] | 0;
          lo += w3 * 977;
          num.words[i2] = lo & 67108863;
          lo = w3 * 64 + (lo / 67108864 | 0);
        }
        if (num.words[num.length - 1] === 0) {
          num.length--;
          if (num.words[num.length - 1] === 0) {
            num.length--;
          }
        }
        return num;
      };
      function P224() {
        MPrime.call(
          this,
          "p224",
          "ffffffff ffffffff ffffffff ffffffff 00000000 00000000 00000001"
        );
      }
      inherits(P224, MPrime);
      function P192() {
        MPrime.call(
          this,
          "p192",
          "ffffffff ffffffff ffffffff fffffffe ffffffff ffffffff"
        );
      }
      inherits(P192, MPrime);
      function P25519() {
        MPrime.call(
          this,
          "25519",
          "7fffffffffffffff ffffffffffffffff ffffffffffffffff ffffffffffffffed"
        );
      }
      inherits(P25519, MPrime);
      P25519.prototype.imulK = function imulK(num) {
        var carry = 0;
        for (var i2 = 0; i2 < num.length; i2++) {
          var hi = (num.words[i2] | 0) * 19 + carry;
          var lo = hi & 67108863;
          hi >>>= 26;
          num.words[i2] = lo;
          carry = hi;
        }
        if (carry !== 0) {
          num.words[num.length++] = carry;
        }
        return num;
      };
      BN2._prime = function prime(name2) {
        if (primes[name2]) return primes[name2];
        var prime2;
        if (name2 === "k256") {
          prime2 = new K256();
        } else if (name2 === "p224") {
          prime2 = new P224();
        } else if (name2 === "p192") {
          prime2 = new P192();
        } else if (name2 === "p25519") {
          prime2 = new P25519();
        } else {
          throw new Error("Unknown prime " + name2);
        }
        primes[name2] = prime2;
        return prime2;
      };
      function Red(m3) {
        if (typeof m3 === "string") {
          var prime = BN2._prime(m3);
          this.m = prime.p;
          this.prime = prime;
        } else {
          assert(m3.gtn(1), "modulus must be greater than 1");
          this.m = m3;
          this.prime = null;
        }
      }
      Red.prototype._verify1 = function _verify1(a2) {
        assert(a2.negative === 0, "red works only with positives");
        assert(a2.red, "red works only with red numbers");
      };
      Red.prototype._verify2 = function _verify2(a2, b4) {
        assert((a2.negative | b4.negative) === 0, "red works only with positives");
        assert(
          a2.red && a2.red === b4.red,
          "red works only with red numbers"
        );
      };
      Red.prototype.imod = function imod(a2) {
        if (this.prime) return this.prime.ireduce(a2)._forceRed(this);
        move(a2, a2.umod(this.m)._forceRed(this));
        return a2;
      };
      Red.prototype.neg = function neg(a2) {
        if (a2.isZero()) {
          return a2.clone();
        }
        return this.m.sub(a2)._forceRed(this);
      };
      Red.prototype.add = function add(a2, b4) {
        this._verify2(a2, b4);
        var res = a2.add(b4);
        if (res.cmp(this.m) >= 0) {
          res.isub(this.m);
        }
        return res._forceRed(this);
      };
      Red.prototype.iadd = function iadd(a2, b4) {
        this._verify2(a2, b4);
        var res = a2.iadd(b4);
        if (res.cmp(this.m) >= 0) {
          res.isub(this.m);
        }
        return res;
      };
      Red.prototype.sub = function sub(a2, b4) {
        this._verify2(a2, b4);
        var res = a2.sub(b4);
        if (res.cmpn(0) < 0) {
          res.iadd(this.m);
        }
        return res._forceRed(this);
      };
      Red.prototype.isub = function isub(a2, b4) {
        this._verify2(a2, b4);
        var res = a2.isub(b4);
        if (res.cmpn(0) < 0) {
          res.iadd(this.m);
        }
        return res;
      };
      Red.prototype.shl = function shl(a2, num) {
        this._verify1(a2);
        return this.imod(a2.ushln(num));
      };
      Red.prototype.imul = function imul(a2, b4) {
        this._verify2(a2, b4);
        return this.imod(a2.imul(b4));
      };
      Red.prototype.mul = function mul(a2, b4) {
        this._verify2(a2, b4);
        return this.imod(a2.mul(b4));
      };
      Red.prototype.isqr = function isqr(a2) {
        return this.imul(a2, a2.clone());
      };
      Red.prototype.sqr = function sqr(a2) {
        return this.mul(a2, a2);
      };
      Red.prototype.sqrt = function sqrt(a2) {
        if (a2.isZero()) return a2.clone();
        var mod3 = this.m.andln(3);
        assert(mod3 % 2 === 1);
        if (mod3 === 3) {
          var pow = this.m.add(new BN2(1)).iushrn(2);
          return this.pow(a2, pow);
        }
        var q3 = this.m.subn(1);
        var s4 = 0;
        while (!q3.isZero() && q3.andln(1) === 0) {
          s4++;
          q3.iushrn(1);
        }
        assert(!q3.isZero());
        var one = new BN2(1).toRed(this);
        var nOne = one.redNeg();
        var lpow = this.m.subn(1).iushrn(1);
        var z2 = this.m.bitLength();
        z2 = new BN2(2 * z2 * z2).toRed(this);
        while (this.pow(z2, lpow).cmp(nOne) !== 0) {
          z2.redIAdd(nOne);
        }
        var c3 = this.pow(z2, q3);
        var r = this.pow(a2, q3.addn(1).iushrn(1));
        var t = this.pow(a2, q3);
        var m3 = s4;
        while (t.cmp(one) !== 0) {
          var tmp = t;
          for (var i2 = 0; tmp.cmp(one) !== 0; i2++) {
            tmp = tmp.redSqr();
          }
          assert(i2 < m3);
          var b4 = this.pow(c3, new BN2(1).iushln(m3 - i2 - 1));
          r = r.redMul(b4);
          c3 = b4.redSqr();
          t = t.redMul(c3);
          m3 = i2;
        }
        return r;
      };
      Red.prototype.invm = function invm(a2) {
        var inv = a2._invmp(this.m);
        if (inv.negative !== 0) {
          inv.negative = 0;
          return this.imod(inv).redNeg();
        } else {
          return this.imod(inv);
        }
      };
      Red.prototype.pow = function pow(a2, num) {
        if (num.isZero()) return new BN2(1).toRed(this);
        if (num.cmpn(1) === 0) return a2.clone();
        var windowSize = 4;
        var wnd = new Array(1 << windowSize);
        wnd[0] = new BN2(1).toRed(this);
        wnd[1] = a2;
        for (var i2 = 2; i2 < wnd.length; i2++) {
          wnd[i2] = this.mul(wnd[i2 - 1], a2);
        }
        var res = wnd[0];
        var current = 0;
        var currentLen = 0;
        var start = num.bitLength() % 26;
        if (start === 0) {
          start = 26;
        }
        for (i2 = num.length - 1; i2 >= 0; i2--) {
          var word = num.words[i2];
          for (var j2 = start - 1; j2 >= 0; j2--) {
            var bit = word >> j2 & 1;
            if (res !== wnd[0]) {
              res = this.sqr(res);
            }
            if (bit === 0 && current === 0) {
              currentLen = 0;
              continue;
            }
            current <<= 1;
            current |= bit;
            currentLen++;
            if (currentLen !== windowSize && (i2 !== 0 || j2 !== 0)) continue;
            res = this.mul(res, wnd[current]);
            currentLen = 0;
            current = 0;
          }
          start = 26;
        }
        return res;
      };
      Red.prototype.convertTo = function convertTo(num) {
        var r = num.umod(this.m);
        return r === num ? r.clone() : r;
      };
      Red.prototype.convertFrom = function convertFrom(num) {
        var res = num.clone();
        res.red = null;
        return res;
      };
      BN2.mont = function mont(num) {
        return new Mont(num);
      };
      function Mont(m3) {
        Red.call(this, m3);
        this.shift = this.m.bitLength();
        if (this.shift % 26 !== 0) {
          this.shift += 26 - this.shift % 26;
        }
        this.r = new BN2(1).iushln(this.shift);
        this.r2 = this.imod(this.r.sqr());
        this.rinv = this.r._invmp(this.m);
        this.minv = this.rinv.mul(this.r).isubn(1).div(this.m);
        this.minv = this.minv.umod(this.r);
        this.minv = this.r.sub(this.minv);
      }
      inherits(Mont, Red);
      Mont.prototype.convertTo = function convertTo(num) {
        return this.imod(num.ushln(this.shift));
      };
      Mont.prototype.convertFrom = function convertFrom(num) {
        var r = this.imod(num.mul(this.rinv));
        r.red = null;
        return r;
      };
      Mont.prototype.imul = function imul(a2, b4) {
        if (a2.isZero() || b4.isZero()) {
          a2.words[0] = 0;
          a2.length = 1;
          return a2;
        }
        var t = a2.imul(b4);
        var c3 = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
        var u2 = t.isub(c3).iushrn(this.shift);
        var res = u2;
        if (u2.cmp(this.m) >= 0) {
          res = u2.isub(this.m);
        } else if (u2.cmpn(0) < 0) {
          res = u2.iadd(this.m);
        }
        return res._forceRed(this);
      };
      Mont.prototype.mul = function mul(a2, b4) {
        if (a2.isZero() || b4.isZero()) return new BN2(0)._forceRed(this);
        var t = a2.mul(b4);
        var c3 = t.maskn(this.shift).mul(this.minv).imaskn(this.shift).mul(this.m);
        var u2 = t.isub(c3).iushrn(this.shift);
        var res = u2;
        if (u2.cmp(this.m) >= 0) {
          res = u2.isub(this.m);
        } else if (u2.cmpn(0) < 0) {
          res = u2.iadd(this.m);
        }
        return res._forceRed(this);
      };
      Mont.prototype.invm = function invm(a2) {
        var res = this.imod(a2._invmp(this.m).mul(this.r2));
        return res._forceRed(this);
      };
    })(typeof module === "undefined" || module, exports);
  }
});

// node_modules/@ethersproject/constants/lib.esm/addresses.js
var AddressZero;
var init_addresses = __esm({
  "node_modules/@ethersproject/constants/lib.esm/addresses.js"() {
    AddressZero = "0x0000000000000000000000000000000000000000";
  }
});

// node_modules/@ethersproject/constants/lib.esm/index.js
var init_lib = __esm({
  "node_modules/@ethersproject/constants/lib.esm/index.js"() {
    "use strict";
    init_addresses();
  }
});

// node_modules/@metamask/metamask-eth-abis/dist/abis/abiERC20.js
var require_abiERC20 = __commonJS({
  "node_modules/@metamask/metamask-eth-abis/dist/abis/abiERC20.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.abiERC20 = void 0;
    exports.abiERC20 = [
      {
        constant: true,
        inputs: [],
        name: "name",
        outputs: [
          {
            name: "",
            type: "string"
          }
        ],
        payable: false,
        type: "function"
      },
      {
        constant: false,
        inputs: [
          {
            name: "_spender",
            type: "address"
          },
          {
            name: "_value",
            type: "uint256"
          }
        ],
        name: "approve",
        outputs: [
          {
            name: "success",
            type: "bool"
          }
        ],
        payable: false,
        type: "function"
      },
      {
        constant: true,
        inputs: [],
        name: "totalSupply",
        outputs: [
          {
            name: "",
            type: "uint256"
          }
        ],
        payable: false,
        type: "function"
      },
      {
        constant: false,
        inputs: [
          {
            name: "_from",
            type: "address"
          },
          {
            name: "_to",
            type: "address"
          },
          {
            name: "_value",
            type: "uint256"
          }
        ],
        name: "transferFrom",
        outputs: [
          {
            name: "success",
            type: "bool"
          }
        ],
        payable: false,
        type: "function"
      },
      {
        constant: true,
        inputs: [],
        name: "decimals",
        outputs: [
          {
            name: "",
            type: "uint256"
          }
        ],
        payable: false,
        type: "function"
      },
      {
        constant: true,
        inputs: [],
        name: "version",
        outputs: [
          {
            name: "",
            type: "string"
          }
        ],
        payable: false,
        type: "function"
      },
      {
        constant: true,
        inputs: [
          {
            name: "_owner",
            type: "address"
          }
        ],
        name: "balanceOf",
        outputs: [
          {
            name: "balance",
            type: "uint256"
          }
        ],
        payable: false,
        type: "function"
      },
      {
        constant: true,
        inputs: [],
        name: "symbol",
        outputs: [
          {
            name: "",
            type: "string"
          }
        ],
        payable: false,
        type: "function"
      },
      {
        constant: false,
        inputs: [
          {
            name: "_to",
            type: "address"
          },
          {
            name: "_value",
            type: "uint256"
          }
        ],
        name: "transfer",
        outputs: [
          {
            name: "success",
            type: "bool"
          }
        ],
        payable: false,
        type: "function"
      },
      {
        constant: false,
        inputs: [
          {
            name: "_spender",
            type: "address"
          },
          {
            name: "_value",
            type: "uint256"
          },
          {
            name: "_extraData",
            type: "bytes"
          }
        ],
        name: "approveAndCall",
        outputs: [
          {
            name: "success",
            type: "bool"
          }
        ],
        payable: false,
        type: "function"
      },
      {
        constant: true,
        inputs: [
          {
            name: "_owner",
            type: "address"
          },
          {
            name: "_spender",
            type: "address"
          }
        ],
        name: "allowance",
        outputs: [
          {
            name: "remaining",
            type: "uint256"
          }
        ],
        payable: false,
        type: "function"
      },
      {
        inputs: [
          {
            name: "_initialAmount",
            type: "uint256"
          },
          {
            name: "_tokenName",
            type: "string"
          },
          {
            name: "_decimalUnits",
            type: "uint8"
          },
          {
            name: "_tokenSymbol",
            type: "string"
          }
        ],
        type: "constructor"
      },
      {
        payable: false,
        type: "fallback"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            name: "_from",
            type: "address"
          },
          {
            indexed: true,
            name: "_to",
            type: "address"
          },
          {
            indexed: false,
            name: "_value",
            type: "uint256"
          }
        ],
        name: "Transfer",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            name: "_owner",
            type: "address"
          },
          {
            indexed: true,
            name: "_spender",
            type: "address"
          },
          {
            indexed: false,
            name: "_value",
            type: "uint256"
          }
        ],
        name: "Approval",
        type: "event"
      }
    ];
  }
});

// node_modules/@metamask/metamask-eth-abis/dist/abis/abiERC721.js
var require_abiERC721 = __commonJS({
  "node_modules/@metamask/metamask-eth-abis/dist/abis/abiERC721.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.abiERC721 = void 0;
    exports.abiERC721 = [
      {
        constant: true,
        inputs: [
          {
            name: "interfaceID",
            type: "bytes4"
          }
        ],
        name: "supportsInterface",
        outputs: [
          {
            name: "",
            type: "bool"
          }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      },
      {
        constant: true,
        inputs: [],
        name: "name",
        outputs: [
          {
            name: "_name",
            type: "string"
          }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      },
      {
        constant: true,
        inputs: [
          {
            name: "_tokenId",
            type: "uint256"
          }
        ],
        name: "getApproved",
        outputs: [
          {
            name: "",
            type: "address"
          }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      },
      {
        constant: false,
        inputs: [
          {
            name: "_approved",
            type: "address"
          },
          {
            name: "_tokenId",
            type: "uint256"
          }
        ],
        name: "approve",
        outputs: [],
        payable: true,
        stateMutability: "payable",
        type: "function"
      },
      {
        constant: true,
        inputs: [],
        name: "totalSupply",
        outputs: [
          {
            name: "",
            type: "uint256"
          }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      },
      {
        constant: false,
        inputs: [
          {
            name: "_from",
            type: "address"
          },
          {
            name: "_to",
            type: "address"
          },
          {
            name: "_tokenId",
            type: "uint256"
          }
        ],
        name: "transferFrom",
        outputs: [],
        payable: true,
        stateMutability: "payable",
        type: "function"
      },
      {
        constant: true,
        inputs: [
          {
            name: "_owner",
            type: "address"
          },
          {
            name: "_index",
            type: "uint256"
          }
        ],
        name: "tokenOfOwnerByIndex",
        outputs: [
          {
            name: "",
            type: "uint256"
          }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      },
      {
        constant: false,
        inputs: [
          {
            name: "_from",
            type: "address"
          },
          {
            name: "_to",
            type: "address"
          },
          {
            name: "_tokenId",
            type: "uint256"
          }
        ],
        name: "safeTransferFrom",
        outputs: [],
        payable: true,
        stateMutability: "payable",
        type: "function"
      },
      {
        constant: true,
        inputs: [
          {
            name: "_index",
            type: "uint256"
          }
        ],
        name: "tokenByIndex",
        outputs: [
          {
            name: "",
            type: "uint256"
          }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      },
      {
        constant: true,
        inputs: [
          {
            name: "_tokenId",
            type: "uint256"
          }
        ],
        name: "ownerOf",
        outputs: [
          {
            name: "",
            type: "address"
          }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      },
      {
        constant: true,
        inputs: [
          {
            name: "_owner",
            type: "address"
          }
        ],
        name: "balanceOf",
        outputs: [
          {
            name: "",
            type: "uint256"
          }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      },
      {
        constant: true,
        inputs: [],
        name: "symbol",
        outputs: [
          {
            name: "_symbol",
            type: "string"
          }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      },
      {
        constant: false,
        inputs: [
          {
            name: "_operator",
            type: "address"
          },
          {
            name: "_approved",
            type: "bool"
          }
        ],
        name: "setApprovalForAll",
        outputs: [],
        payable: false,
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        constant: false,
        inputs: [
          {
            name: "_from",
            type: "address"
          },
          {
            name: "_to",
            type: "address"
          },
          {
            name: "_tokenId",
            type: "uint256"
          },
          {
            name: "data",
            type: "bytes"
          }
        ],
        name: "safeTransferFrom",
        outputs: [],
        payable: true,
        stateMutability: "payable",
        type: "function"
      },
      {
        constant: true,
        inputs: [
          {
            name: "_tokenId",
            type: "uint256"
          }
        ],
        name: "tokenURI",
        outputs: [
          {
            name: "",
            type: "string"
          }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      },
      {
        constant: true,
        inputs: [
          {
            name: "_owner",
            type: "address"
          },
          {
            name: "_operator",
            type: "address"
          }
        ],
        name: "isApprovedForAll",
        outputs: [
          {
            name: "",
            type: "bool"
          }
        ],
        payable: false,
        stateMutability: "view",
        type: "function"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            name: "_from",
            type: "address"
          },
          {
            indexed: true,
            name: "_to",
            type: "address"
          },
          {
            indexed: true,
            name: "_tokenId",
            type: "uint256"
          }
        ],
        name: "Transfer",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            name: "_owner",
            type: "address"
          },
          {
            indexed: true,
            name: "_approved",
            type: "address"
          },
          {
            indexed: true,
            name: "_tokenId",
            type: "uint256"
          }
        ],
        name: "Approval",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            name: "_owner",
            type: "address"
          },
          {
            indexed: true,
            name: "_operator",
            type: "address"
          },
          {
            indexed: false,
            name: "_approved",
            type: "bool"
          }
        ],
        name: "ApprovalForAll",
        type: "event"
      }
    ];
  }
});

// node_modules/@metamask/metamask-eth-abis/dist/abis/abiERC1155.js
var require_abiERC1155 = __commonJS({
  "node_modules/@metamask/metamask-eth-abis/dist/abis/abiERC1155.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.abiERC1155 = void 0;
    exports.abiERC1155 = [
      {
        inputs: [
          {
            internalType: "string",
            name: "uri_",
            type: "string"
          }
        ],
        stateMutability: "nonpayable",
        type: "constructor"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "account",
            type: "address"
          },
          {
            indexed: true,
            internalType: "address",
            name: "operator",
            type: "address"
          },
          {
            indexed: false,
            internalType: "bool",
            name: "approved",
            type: "bool"
          }
        ],
        name: "ApprovalForAll",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "operator",
            type: "address"
          },
          {
            indexed: true,
            internalType: "address",
            name: "from",
            type: "address"
          },
          {
            indexed: true,
            internalType: "address",
            name: "to",
            type: "address"
          },
          {
            indexed: false,
            internalType: "uint256[]",
            name: "ids",
            type: "uint256[]"
          },
          {
            indexed: false,
            internalType: "uint256[]",
            name: "values",
            type: "uint256[]"
          }
        ],
        name: "TransferBatch",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "operator",
            type: "address"
          },
          {
            indexed: true,
            internalType: "address",
            name: "from",
            type: "address"
          },
          {
            indexed: true,
            internalType: "address",
            name: "to",
            type: "address"
          },
          {
            indexed: false,
            internalType: "uint256",
            name: "id",
            type: "uint256"
          },
          {
            indexed: false,
            internalType: "uint256",
            name: "value",
            type: "uint256"
          }
        ],
        name: "TransferSingle",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: false,
            internalType: "string",
            name: "value",
            type: "string"
          },
          {
            indexed: true,
            internalType: "uint256",
            name: "id",
            type: "uint256"
          }
        ],
        name: "URI",
        type: "event"
      },
      {
        inputs: [
          {
            internalType: "address",
            name: "account",
            type: "address"
          },
          {
            internalType: "uint256",
            name: "id",
            type: "uint256"
          }
        ],
        name: "balanceOf",
        outputs: [
          {
            internalType: "uint256",
            name: "",
            type: "uint256"
          }
        ],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [
          {
            internalType: "address[]",
            name: "accounts",
            type: "address[]"
          },
          {
            internalType: "uint256[]",
            name: "ids",
            type: "uint256[]"
          }
        ],
        name: "balanceOfBatch",
        outputs: [
          {
            internalType: "uint256[]",
            name: "",
            type: "uint256[]"
          }
        ],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [
          {
            internalType: "address",
            name: "account",
            type: "address"
          },
          {
            internalType: "address",
            name: "operator",
            type: "address"
          }
        ],
        name: "isApprovedForAll",
        outputs: [
          {
            internalType: "bool",
            name: "",
            type: "bool"
          }
        ],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [
          {
            internalType: "address",
            name: "from",
            type: "address"
          },
          {
            internalType: "address",
            name: "to",
            type: "address"
          },
          {
            internalType: "uint256[]",
            name: "ids",
            type: "uint256[]"
          },
          {
            internalType: "uint256[]",
            name: "amounts",
            type: "uint256[]"
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes"
          }
        ],
        name: "safeBatchTransferFrom",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          {
            internalType: "address",
            name: "from",
            type: "address"
          },
          {
            internalType: "address",
            name: "to",
            type: "address"
          },
          {
            internalType: "uint256",
            name: "id",
            type: "uint256"
          },
          {
            internalType: "uint256",
            name: "amount",
            type: "uint256"
          },
          {
            internalType: "bytes",
            name: "data",
            type: "bytes"
          }
        ],
        name: "safeTransferFrom",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          {
            internalType: "address",
            name: "operator",
            type: "address"
          },
          {
            internalType: "bool",
            name: "approved",
            type: "bool"
          }
        ],
        name: "setApprovalForAll",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          {
            internalType: "bytes4",
            name: "interfaceId",
            type: "bytes4"
          }
        ],
        name: "supportsInterface",
        outputs: [
          {
            internalType: "bool",
            name: "",
            type: "bool"
          }
        ],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [
          {
            internalType: "uint256",
            name: "",
            type: "uint256"
          }
        ],
        name: "uri",
        outputs: [
          {
            internalType: "string",
            name: "",
            type: "string"
          }
        ],
        stateMutability: "view",
        type: "function"
      }
    ];
  }
});

// node_modules/@metamask/metamask-eth-abis/dist/abis/fiatTokenV2.js
var require_fiatTokenV2 = __commonJS({
  "node_modules/@metamask/metamask-eth-abis/dist/abis/fiatTokenV2.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.abiFiatTokenV2 = void 0;
    exports.abiFiatTokenV2 = [
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "owner",
            type: "address"
          },
          {
            indexed: true,
            internalType: "address",
            name: "spender",
            type: "address"
          },
          {
            indexed: false,
            internalType: "uint256",
            name: "value",
            type: "uint256"
          }
        ],
        name: "Approval",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "authorizer",
            type: "address"
          },
          {
            indexed: true,
            internalType: "bytes32",
            name: "nonce",
            type: "bytes32"
          }
        ],
        name: "AuthorizationCanceled",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "authorizer",
            type: "address"
          },
          {
            indexed: true,
            internalType: "bytes32",
            name: "nonce",
            type: "bytes32"
          }
        ],
        name: "AuthorizationUsed",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "_account",
            type: "address"
          }
        ],
        name: "Blacklisted",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "newBlacklister",
            type: "address"
          }
        ],
        name: "BlacklisterChanged",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "burner",
            type: "address"
          },
          {
            indexed: false,
            internalType: "uint256",
            name: "amount",
            type: "uint256"
          }
        ],
        name: "Burn",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "newMasterMinter",
            type: "address"
          }
        ],
        name: "MasterMinterChanged",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "minter",
            type: "address"
          },
          {
            indexed: true,
            internalType: "address",
            name: "to",
            type: "address"
          },
          {
            indexed: false,
            internalType: "uint256",
            name: "amount",
            type: "uint256"
          }
        ],
        name: "Mint",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "minter",
            type: "address"
          },
          {
            indexed: false,
            internalType: "uint256",
            name: "minterAllowedAmount",
            type: "uint256"
          }
        ],
        name: "MinterConfigured",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "oldMinter",
            type: "address"
          }
        ],
        name: "MinterRemoved",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: false,
            internalType: "address",
            name: "previousOwner",
            type: "address"
          },
          {
            indexed: false,
            internalType: "address",
            name: "newOwner",
            type: "address"
          }
        ],
        name: "OwnershipTransferred",
        type: "event"
      },
      { anonymous: false, inputs: [], name: "Pause", type: "event" },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "newAddress",
            type: "address"
          }
        ],
        name: "PauserChanged",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "newRescuer",
            type: "address"
          }
        ],
        name: "RescuerChanged",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "from",
            type: "address"
          },
          {
            indexed: true,
            internalType: "address",
            name: "to",
            type: "address"
          },
          {
            indexed: false,
            internalType: "uint256",
            name: "value",
            type: "uint256"
          }
        ],
        name: "Transfer",
        type: "event"
      },
      {
        anonymous: false,
        inputs: [
          {
            indexed: true,
            internalType: "address",
            name: "_account",
            type: "address"
          }
        ],
        name: "UnBlacklisted",
        type: "event"
      },
      { anonymous: false, inputs: [], name: "Unpause", type: "event" },
      {
        inputs: [],
        name: "CANCEL_AUTHORIZATION_TYPEHASH",
        outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "DOMAIN_SEPARATOR",
        outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "PERMIT_TYPEHASH",
        outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "RECEIVE_WITH_AUTHORIZATION_TYPEHASH",
        outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "TRANSFER_WITH_AUTHORIZATION_TYPEHASH",
        outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "owner", type: "address" },
          { internalType: "address", name: "spender", type: "address" }
        ],
        name: "allowance",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "spender", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" }
        ],
        name: "approve",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "authorizer", type: "address" },
          { internalType: "bytes32", name: "nonce", type: "bytes32" }
        ],
        name: "authorizationState",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [{ internalType: "address", name: "account", type: "address" }],
        name: "balanceOf",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [{ internalType: "address", name: "_account", type: "address" }],
        name: "blacklist",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [],
        name: "blacklister",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [{ internalType: "uint256", name: "_amount", type: "uint256" }],
        name: "burn",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "authorizer", type: "address" },
          { internalType: "bytes32", name: "nonce", type: "bytes32" },
          { internalType: "uint8", name: "v", type: "uint8" },
          { internalType: "bytes32", name: "r", type: "bytes32" },
          { internalType: "bytes32", name: "s", type: "bytes32" }
        ],
        name: "cancelAuthorization",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "authorizer", type: "address" },
          { internalType: "bytes32", name: "nonce", type: "bytes32" },
          { internalType: "bytes", name: "signature", type: "bytes" }
        ],
        name: "cancelAuthorization",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "minter", type: "address" },
          {
            internalType: "uint256",
            name: "minterAllowedAmount",
            type: "uint256"
          }
        ],
        name: "configureMinter",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [],
        name: "currency",
        outputs: [{ internalType: "string", name: "", type: "string" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "decimals",
        outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "spender", type: "address" },
          { internalType: "uint256", name: "decrement", type: "uint256" }
        ],
        name: "decreaseAllowance",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "spender", type: "address" },
          { internalType: "uint256", name: "increment", type: "uint256" }
        ],
        name: "increaseAllowance",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "string", name: "tokenName", type: "string" },
          { internalType: "string", name: "tokenSymbol", type: "string" },
          { internalType: "string", name: "tokenCurrency", type: "string" },
          { internalType: "uint8", name: "tokenDecimals", type: "uint8" },
          { internalType: "address", name: "newMasterMinter", type: "address" },
          { internalType: "address", name: "newPauser", type: "address" },
          { internalType: "address", name: "newBlacklister", type: "address" },
          { internalType: "address", name: "newOwner", type: "address" }
        ],
        name: "initialize",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [{ internalType: "string", name: "newName", type: "string" }],
        name: "initializeV2",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "lostAndFound", type: "address" }
        ],
        name: "initializeV2_1",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          {
            internalType: "address[]",
            name: "accountsToBlacklist",
            type: "address[]"
          },
          { internalType: "string", name: "newSymbol", type: "string" }
        ],
        name: "initializeV2_2",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [{ internalType: "address", name: "_account", type: "address" }],
        name: "isBlacklisted",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [{ internalType: "address", name: "account", type: "address" }],
        name: "isMinter",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "masterMinter",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "_to", type: "address" },
          { internalType: "uint256", name: "_amount", type: "uint256" }
        ],
        name: "mint",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [{ internalType: "address", name: "minter", type: "address" }],
        name: "minterAllowance",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "name",
        outputs: [{ internalType: "string", name: "", type: "string" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [{ internalType: "address", name: "owner", type: "address" }],
        name: "nonces",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "owner",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "pause",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [],
        name: "paused",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "pauser",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "owner", type: "address" },
          { internalType: "address", name: "spender", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" },
          { internalType: "uint256", name: "deadline", type: "uint256" },
          { internalType: "bytes", name: "signature", type: "bytes" }
        ],
        name: "permit",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "owner", type: "address" },
          { internalType: "address", name: "spender", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" },
          { internalType: "uint256", name: "deadline", type: "uint256" },
          { internalType: "uint8", name: "v", type: "uint8" },
          { internalType: "bytes32", name: "r", type: "bytes32" },
          { internalType: "bytes32", name: "s", type: "bytes32" }
        ],
        name: "permit",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "from", type: "address" },
          { internalType: "address", name: "to", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" },
          { internalType: "uint256", name: "validAfter", type: "uint256" },
          { internalType: "uint256", name: "validBefore", type: "uint256" },
          { internalType: "bytes32", name: "nonce", type: "bytes32" },
          { internalType: "bytes", name: "signature", type: "bytes" }
        ],
        name: "receiveWithAuthorization",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "from", type: "address" },
          { internalType: "address", name: "to", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" },
          { internalType: "uint256", name: "validAfter", type: "uint256" },
          { internalType: "uint256", name: "validBefore", type: "uint256" },
          { internalType: "bytes32", name: "nonce", type: "bytes32" },
          { internalType: "uint8", name: "v", type: "uint8" },
          { internalType: "bytes32", name: "r", type: "bytes32" },
          { internalType: "bytes32", name: "s", type: "bytes32" }
        ],
        name: "receiveWithAuthorization",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [{ internalType: "address", name: "minter", type: "address" }],
        name: "removeMinter",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          {
            internalType: "contract IERC20",
            name: "tokenContract",
            type: "address"
          },
          { internalType: "address", name: "to", type: "address" },
          { internalType: "uint256", name: "amount", type: "uint256" }
        ],
        name: "rescueERC20",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [],
        name: "rescuer",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "symbol",
        outputs: [{ internalType: "string", name: "", type: "string" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [],
        name: "totalSupply",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "to", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" }
        ],
        name: "transfer",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "from", type: "address" },
          { internalType: "address", name: "to", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" }
        ],
        name: "transferFrom",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [{ internalType: "address", name: "newOwner", type: "address" }],
        name: "transferOwnership",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "from", type: "address" },
          { internalType: "address", name: "to", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" },
          { internalType: "uint256", name: "validAfter", type: "uint256" },
          { internalType: "uint256", name: "validBefore", type: "uint256" },
          { internalType: "bytes32", name: "nonce", type: "bytes32" },
          { internalType: "bytes", name: "signature", type: "bytes" }
        ],
        name: "transferWithAuthorization",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "from", type: "address" },
          { internalType: "address", name: "to", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" },
          { internalType: "uint256", name: "validAfter", type: "uint256" },
          { internalType: "uint256", name: "validBefore", type: "uint256" },
          { internalType: "bytes32", name: "nonce", type: "bytes32" },
          { internalType: "uint8", name: "v", type: "uint8" },
          { internalType: "bytes32", name: "r", type: "bytes32" },
          { internalType: "bytes32", name: "s", type: "bytes32" }
        ],
        name: "transferWithAuthorization",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [{ internalType: "address", name: "_account", type: "address" }],
        name: "unBlacklist",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [],
        name: "unpause",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          { internalType: "address", name: "_newBlacklister", type: "address" }
        ],
        name: "updateBlacklister",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [
          {
            internalType: "address",
            name: "_newMasterMinter",
            type: "address"
          }
        ],
        name: "updateMasterMinter",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [{ internalType: "address", name: "_newPauser", type: "address" }],
        name: "updatePauser",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [{ internalType: "address", name: "newRescuer", type: "address" }],
        name: "updateRescuer",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
      },
      {
        inputs: [],
        name: "version",
        outputs: [{ internalType: "string", name: "", type: "string" }],
        stateMutability: "pure",
        type: "function"
      }
    ];
  }
});

// node_modules/@metamask/metamask-eth-abis/dist/index.js
var require_dist = __commonJS({
  "node_modules/@metamask/metamask-eth-abis/dist/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.abiFiatTokenV2 = exports.abiERC1155 = exports.abiERC721 = exports.abiERC20 = void 0;
    var abiERC20_1 = require_abiERC20();
    Object.defineProperty(exports, "abiERC20", { enumerable: true, get: function() {
      return abiERC20_1.abiERC20;
    } });
    var abiERC721_1 = require_abiERC721();
    Object.defineProperty(exports, "abiERC721", { enumerable: true, get: function() {
      return abiERC721_1.abiERC721;
    } });
    var abiERC1155_1 = require_abiERC1155();
    Object.defineProperty(exports, "abiERC1155", { enumerable: true, get: function() {
      return abiERC1155_1.abiERC1155;
    } });
    var fiatTokenV2_1 = require_fiatTokenV2();
    Object.defineProperty(exports, "abiFiatTokenV2", { enumerable: true, get: function() {
      return fiatTokenV2_1.abiFiatTokenV2;
    } });
  }
});

// node_modules/is-hex-prefixed/src/index.js
var require_src = __commonJS({
  "node_modules/is-hex-prefixed/src/index.js"(exports, module) {
    module.exports = function isHexPrefixed(str) {
      if (typeof str !== "string") {
        throw new Error("[is-hex-prefixed] value must be type 'string', is currently type " + typeof str + ", while checking isHexPrefixed.");
      }
      return str.slice(0, 2) === "0x";
    };
  }
});

// node_modules/strip-hex-prefix/src/index.js
var require_src2 = __commonJS({
  "node_modules/strip-hex-prefix/src/index.js"(exports, module) {
    var isHexPrefixed = require_src();
    module.exports = function stripHexPrefix(str) {
      if (typeof str !== "string") {
        return str;
      }
      return isHexPrefixed(str) ? str.slice(2) : str;
    };
  }
});

// node_modules/@metamask/number-to-bn/src/index.js
var require_src3 = __commonJS({
  "node_modules/@metamask/number-to-bn/src/index.js"(exports, module) {
    var BN2 = require_bn();
    var stripHexPrefix = require_src2();
    module.exports = function numberToBN(arg) {
      if (typeof arg === "string" || typeof arg === "number") {
        var multiplier = new BN2(1);
        var formattedString = String(arg).toLowerCase().trim();
        var isHexPrefixed = formattedString.substr(0, 2) === "0x" || formattedString.substr(0, 3) === "-0x";
        var stringArg = stripHexPrefix(formattedString);
        if (stringArg.substr(0, 1) === "-") {
          stringArg = stripHexPrefix(stringArg.slice(1));
          multiplier = new BN2(-1, 10);
        }
        stringArg = stringArg === "" ? "0" : stringArg;
        if (!stringArg.match(/^-?[0-9]+$/) && stringArg.match(/^[0-9A-Fa-f]+$/) || stringArg.match(/^[a-fA-F]+$/) || isHexPrefixed === true && stringArg.match(/^[0-9A-Fa-f]+$/)) {
          return new BN2(stringArg, 16).mul(multiplier);
        }
        if ((stringArg.match(/^-?[0-9]+$/) || stringArg === "") && isHexPrefixed === false) {
          return new BN2(stringArg, 10).mul(multiplier);
        }
      } else if (typeof arg === "object" && arg.toString && (!arg.pop && !arg.push)) {
        if (arg.toString(10).match(/^-?[0-9]+$/) && (arg.mul || arg.dividedToIntegerBy)) {
          return new BN2(arg.toString(10), 10);
        }
      }
      throw new Error("[number-to-bn] while converting number " + JSON.stringify(arg) + " to BN.js instance, error: invalid number value. Value must be an integer, hex string, BN or BigNumber instance. Note, decimals are not supported.");
    };
  }
});

// node_modules/@metamask/ethjs-unit/lib/index.js
var require_lib = __commonJS({
  "node_modules/@metamask/ethjs-unit/lib/index.js"(exports, module) {
    "use strict";
    var BN2 = require_bn();
    var numberToBN = require_src3();
    var zero = new BN2(0);
    var negative1 = new BN2(-1);
    var unitMap = {
      "noether": "0",
      // eslint-disable-line
      "wei": "1",
      // eslint-disable-line
      "kwei": "1000",
      // eslint-disable-line
      "Kwei": "1000",
      // eslint-disable-line
      "babbage": "1000",
      // eslint-disable-line
      "femtoether": "1000",
      // eslint-disable-line
      "mwei": "1000000",
      // eslint-disable-line
      "Mwei": "1000000",
      // eslint-disable-line
      "lovelace": "1000000",
      // eslint-disable-line
      "picoether": "1000000",
      // eslint-disable-line
      "gwei": "1000000000",
      // eslint-disable-line
      "Gwei": "1000000000",
      // eslint-disable-line
      "shannon": "1000000000",
      // eslint-disable-line
      "nanoether": "1000000000",
      // eslint-disable-line
      "nano": "1000000000",
      // eslint-disable-line
      "szabo": "1000000000000",
      // eslint-disable-line
      "microether": "1000000000000",
      // eslint-disable-line
      "micro": "1000000000000",
      // eslint-disable-line
      "finney": "1000000000000000",
      // eslint-disable-line
      "milliether": "1000000000000000",
      // eslint-disable-line
      "milli": "1000000000000000",
      // eslint-disable-line
      "ether": "1000000000000000000",
      // eslint-disable-line
      "kether": "1000000000000000000000",
      // eslint-disable-line
      "grand": "1000000000000000000000",
      // eslint-disable-line
      "mether": "1000000000000000000000000",
      // eslint-disable-line
      "gether": "1000000000000000000000000000",
      // eslint-disable-line
      "tether": "1000000000000000000000000000000"
      // eslint-disable-line
    };
    function getValueOfUnit(unitInput) {
      var unit = unitInput ? unitInput.toLowerCase() : "ether";
      var unitValue = unitMap[unit];
      if (typeof unitValue !== "string") {
        throw new Error("[ethjs-unit] the unit provided " + unitInput + " doesn't exists, please use the one of the following units " + JSON.stringify(unitMap, null, 2));
      }
      return new BN2(unitValue, 10);
    }
    function numberToString(arg) {
      if (typeof arg === "string") {
        if (!arg.match(/^-?[0-9.]+$/)) {
          throw new Error("while converting number to string, invalid number value '" + arg + "', should be a number matching (^-?[0-9.]+).");
        }
        return arg;
      }
      if (typeof arg === "number") {
        return String(arg);
      }
      if (typeof arg === "object" && arg.toString && (arg.toTwos || arg.dividedToIntegerBy)) {
        if (arg.toPrecision) {
          return String(arg.toPrecision());
        }
        return arg.toString(10);
      }
      throw new Error("while converting number to string, invalid number value '" + arg + "' type " + typeof arg + ".");
    }
    function fromWei2(weiInput, unit, optionsInput) {
      var wei = numberToBN(weiInput);
      var negative = wei.lt(zero);
      var base = getValueOfUnit(unit);
      var baseLength = unitMap[unit].length - 1 || 1;
      var options = optionsInput || {};
      if (negative) {
        wei = wei.mul(negative1);
      }
      var fraction = wei.mod(base).toString(10);
      while (fraction.length < baseLength) {
        fraction = "0" + fraction;
      }
      if (!options.pad) {
        fraction = fraction.match(/^([0-9]*[1-9]|0)(0*)/)[1];
      }
      var whole = wei.div(base).toString(10);
      if (options.commify) {
        whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      }
      var value = "" + whole + (fraction == "0" ? "" : "." + fraction);
      if (negative) {
        value = "-" + value;
      }
      return value;
    }
    function toWei2(etherInput, unit) {
      var ether = numberToString(etherInput);
      var base = getValueOfUnit(unit);
      var baseLength = unitMap[unit].length - 1 || 1;
      var negative = ether.substring(0, 1) === "-";
      if (negative) {
        ether = ether.substring(1);
      }
      if (ether === ".") {
        throw new Error("[ethjs-unit] while converting number " + etherInput + " to wei, invalid value");
      }
      var comps = ether.split(".");
      if (comps.length > 2) {
        throw new Error("[ethjs-unit] while converting number " + etherInput + " to wei,  too many decimal points");
      }
      var whole = comps[0], fraction = comps[1];
      if (!whole) {
        whole = "0";
      }
      if (!fraction) {
        fraction = "0";
      }
      if (fraction.length > baseLength) {
        throw new Error("[ethjs-unit] while converting number " + etherInput + " to wei, too many decimal places");
      }
      while (fraction.length < baseLength) {
        fraction += "0";
      }
      whole = new BN2(whole);
      fraction = new BN2(fraction);
      var wei = whole.mul(base).add(fraction);
      if (negative) {
        wei = wei.mul(negative1);
      }
      return new BN2(wei.toString(10), 10);
    }
    module.exports = {
      unitMap,
      numberToString,
      getValueOfUnit,
      fromWei: fromWei2,
      toWei: toWei2
    };
  }
});

// node_modules/eth-ens-namehash/node_modules/js-sha3/src/sha3.js
var require_sha3 = __commonJS({
  "node_modules/eth-ens-namehash/node_modules/js-sha3/src/sha3.js"(exports, module) {
    (function() {
      "use strict";
      var root = typeof window === "object" ? window : {};
      var NODE_JS = !root.JS_SHA3_NO_NODE_JS && typeof process === "object" && process.versions && process.versions.node;
      if (NODE_JS) {
        root = global;
      }
      var COMMON_JS = !root.JS_SHA3_NO_COMMON_JS && typeof module === "object" && module.exports;
      var HEX_CHARS = "0123456789abcdef".split("");
      var SHAKE_PADDING = [31, 7936, 2031616, 520093696];
      var KECCAK_PADDING = [1, 256, 65536, 16777216];
      var PADDING = [6, 1536, 393216, 100663296];
      var SHIFT = [0, 8, 16, 24];
      var RC = [
        1,
        0,
        32898,
        0,
        32906,
        2147483648,
        2147516416,
        2147483648,
        32907,
        0,
        2147483649,
        0,
        2147516545,
        2147483648,
        32777,
        2147483648,
        138,
        0,
        136,
        0,
        2147516425,
        0,
        2147483658,
        0,
        2147516555,
        0,
        139,
        2147483648,
        32905,
        2147483648,
        32771,
        2147483648,
        32770,
        2147483648,
        128,
        2147483648,
        32778,
        0,
        2147483658,
        2147483648,
        2147516545,
        2147483648,
        32896,
        2147483648,
        2147483649,
        0,
        2147516424,
        2147483648
      ];
      var BITS = [224, 256, 384, 512];
      var SHAKE_BITS = [128, 256];
      var OUTPUT_TYPES = ["hex", "buffer", "arrayBuffer", "array"];
      var createOutputMethod = function(bits2, padding, outputType) {
        return function(message) {
          return new Keccak(bits2, padding, bits2).update(message)[outputType]();
        };
      };
      var createShakeOutputMethod = function(bits2, padding, outputType) {
        return function(message, outputBits) {
          return new Keccak(bits2, padding, outputBits).update(message)[outputType]();
        };
      };
      var createMethod = function(bits2, padding) {
        var method = createOutputMethod(bits2, padding, "hex");
        method.create = function() {
          return new Keccak(bits2, padding, bits2);
        };
        method.update = function(message) {
          return method.create().update(message);
        };
        for (var i3 = 0; i3 < OUTPUT_TYPES.length; ++i3) {
          var type = OUTPUT_TYPES[i3];
          method[type] = createOutputMethod(bits2, padding, type);
        }
        return method;
      };
      var createShakeMethod = function(bits2, padding) {
        var method = createShakeOutputMethod(bits2, padding, "hex");
        method.create = function(outputBits) {
          return new Keccak(bits2, padding, outputBits);
        };
        method.update = function(message, outputBits) {
          return method.create(outputBits).update(message);
        };
        for (var i3 = 0; i3 < OUTPUT_TYPES.length; ++i3) {
          var type = OUTPUT_TYPES[i3];
          method[type] = createShakeOutputMethod(bits2, padding, type);
        }
        return method;
      };
      var algorithms = [
        { name: "keccak", padding: KECCAK_PADDING, bits: BITS, createMethod },
        { name: "sha3", padding: PADDING, bits: BITS, createMethod },
        { name: "shake", padding: SHAKE_PADDING, bits: SHAKE_BITS, createMethod: createShakeMethod }
      ];
      var methods = {}, methodNames = [];
      for (var i2 = 0; i2 < algorithms.length; ++i2) {
        var algorithm = algorithms[i2];
        var bits = algorithm.bits;
        for (var j2 = 0; j2 < bits.length; ++j2) {
          var methodName = algorithm.name + "_" + bits[j2];
          methodNames.push(methodName);
          methods[methodName] = algorithm.createMethod(bits[j2], algorithm.padding);
        }
      }
      function Keccak(bits2, padding, outputBits) {
        this.blocks = [];
        this.s = [];
        this.padding = padding;
        this.outputBits = outputBits;
        this.reset = true;
        this.block = 0;
        this.start = 0;
        this.blockCount = 1600 - (bits2 << 1) >> 5;
        this.byteCount = this.blockCount << 2;
        this.outputBlocks = outputBits >> 5;
        this.extraBytes = (outputBits & 31) >> 3;
        for (var i3 = 0; i3 < 50; ++i3) {
          this.s[i3] = 0;
        }
      }
      Keccak.prototype.update = function(message) {
        var notString = typeof message !== "string";
        if (notString && message.constructor === ArrayBuffer) {
          message = new Uint8Array(message);
        }
        var length = message.length, blocks = this.blocks, byteCount = this.byteCount, blockCount = this.blockCount, index = 0, s4 = this.s, i3, code;
        while (index < length) {
          if (this.reset) {
            this.reset = false;
            blocks[0] = this.block;
            for (i3 = 1; i3 < blockCount + 1; ++i3) {
              blocks[i3] = 0;
            }
          }
          if (notString) {
            for (i3 = this.start; index < length && i3 < byteCount; ++index) {
              blocks[i3 >> 2] |= message[index] << SHIFT[i3++ & 3];
            }
          } else {
            for (i3 = this.start; index < length && i3 < byteCount; ++index) {
              code = message.charCodeAt(index);
              if (code < 128) {
                blocks[i3 >> 2] |= code << SHIFT[i3++ & 3];
              } else if (code < 2048) {
                blocks[i3 >> 2] |= (192 | code >> 6) << SHIFT[i3++ & 3];
                blocks[i3 >> 2] |= (128 | code & 63) << SHIFT[i3++ & 3];
              } else if (code < 55296 || code >= 57344) {
                blocks[i3 >> 2] |= (224 | code >> 12) << SHIFT[i3++ & 3];
                blocks[i3 >> 2] |= (128 | code >> 6 & 63) << SHIFT[i3++ & 3];
                blocks[i3 >> 2] |= (128 | code & 63) << SHIFT[i3++ & 3];
              } else {
                code = 65536 + ((code & 1023) << 10 | message.charCodeAt(++index) & 1023);
                blocks[i3 >> 2] |= (240 | code >> 18) << SHIFT[i3++ & 3];
                blocks[i3 >> 2] |= (128 | code >> 12 & 63) << SHIFT[i3++ & 3];
                blocks[i3 >> 2] |= (128 | code >> 6 & 63) << SHIFT[i3++ & 3];
                blocks[i3 >> 2] |= (128 | code & 63) << SHIFT[i3++ & 3];
              }
            }
          }
          this.lastByteIndex = i3;
          if (i3 >= byteCount) {
            this.start = i3 - byteCount;
            this.block = blocks[blockCount];
            for (i3 = 0; i3 < blockCount; ++i3) {
              s4[i3] ^= blocks[i3];
            }
            f4(s4);
            this.reset = true;
          } else {
            this.start = i3;
          }
        }
        return this;
      };
      Keccak.prototype.finalize = function() {
        var blocks = this.blocks, i3 = this.lastByteIndex, blockCount = this.blockCount, s4 = this.s;
        blocks[i3 >> 2] |= this.padding[i3 & 3];
        if (this.lastByteIndex === this.byteCount) {
          blocks[0] = blocks[blockCount];
          for (i3 = 1; i3 < blockCount + 1; ++i3) {
            blocks[i3] = 0;
          }
        }
        blocks[blockCount - 1] |= 2147483648;
        for (i3 = 0; i3 < blockCount; ++i3) {
          s4[i3] ^= blocks[i3];
        }
        f4(s4);
      };
      Keccak.prototype.toString = Keccak.prototype.hex = function() {
        this.finalize();
        var blockCount = this.blockCount, s4 = this.s, outputBlocks = this.outputBlocks, extraBytes = this.extraBytes, i3 = 0, j3 = 0;
        var hex = "", block;
        while (j3 < outputBlocks) {
          for (i3 = 0; i3 < blockCount && j3 < outputBlocks; ++i3, ++j3) {
            block = s4[i3];
            hex += HEX_CHARS[block >> 4 & 15] + HEX_CHARS[block & 15] + HEX_CHARS[block >> 12 & 15] + HEX_CHARS[block >> 8 & 15] + HEX_CHARS[block >> 20 & 15] + HEX_CHARS[block >> 16 & 15] + HEX_CHARS[block >> 28 & 15] + HEX_CHARS[block >> 24 & 15];
          }
          if (j3 % blockCount === 0) {
            f4(s4);
            i3 = 0;
          }
        }
        if (extraBytes) {
          block = s4[i3];
          if (extraBytes > 0) {
            hex += HEX_CHARS[block >> 4 & 15] + HEX_CHARS[block & 15];
          }
          if (extraBytes > 1) {
            hex += HEX_CHARS[block >> 12 & 15] + HEX_CHARS[block >> 8 & 15];
          }
          if (extraBytes > 2) {
            hex += HEX_CHARS[block >> 20 & 15] + HEX_CHARS[block >> 16 & 15];
          }
        }
        return hex;
      };
      Keccak.prototype.arrayBuffer = function() {
        this.finalize();
        var blockCount = this.blockCount, s4 = this.s, outputBlocks = this.outputBlocks, extraBytes = this.extraBytes, i3 = 0, j3 = 0;
        var bytes = this.outputBits >> 3;
        var buffer;
        if (extraBytes) {
          buffer = new ArrayBuffer(outputBlocks + 1 << 2);
        } else {
          buffer = new ArrayBuffer(bytes);
        }
        var array = new Uint32Array(buffer);
        while (j3 < outputBlocks) {
          for (i3 = 0; i3 < blockCount && j3 < outputBlocks; ++i3, ++j3) {
            array[j3] = s4[i3];
          }
          if (j3 % blockCount === 0) {
            f4(s4);
          }
        }
        if (extraBytes) {
          array[i3] = s4[i3];
          buffer = buffer.slice(0, bytes);
        }
        return buffer;
      };
      Keccak.prototype.buffer = Keccak.prototype.arrayBuffer;
      Keccak.prototype.digest = Keccak.prototype.array = function() {
        this.finalize();
        var blockCount = this.blockCount, s4 = this.s, outputBlocks = this.outputBlocks, extraBytes = this.extraBytes, i3 = 0, j3 = 0;
        var array = [], offset, block;
        while (j3 < outputBlocks) {
          for (i3 = 0; i3 < blockCount && j3 < outputBlocks; ++i3, ++j3) {
            offset = j3 << 2;
            block = s4[i3];
            array[offset] = block & 255;
            array[offset + 1] = block >> 8 & 255;
            array[offset + 2] = block >> 16 & 255;
            array[offset + 3] = block >> 24 & 255;
          }
          if (j3 % blockCount === 0) {
            f4(s4);
          }
        }
        if (extraBytes) {
          offset = j3 << 2;
          block = s4[i3];
          if (extraBytes > 0) {
            array[offset] = block & 255;
          }
          if (extraBytes > 1) {
            array[offset + 1] = block >> 8 & 255;
          }
          if (extraBytes > 2) {
            array[offset + 2] = block >> 16 & 255;
          }
        }
        return array;
      };
      var f4 = function(s4) {
        var h2, l3, n, c0, c1, c22, c3, c4, c5, c6, c7, c8, c9, b0, b1, b22, b32, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15, b16, b17, b18, b19, b20, b21, b222, b23, b24, b25, b26, b27, b28, b29, b30, b31, b322, b33, b34, b35, b36, b37, b38, b39, b40, b41, b42, b43, b44, b45, b46, b47, b48, b49;
        for (n = 0; n < 48; n += 2) {
          c0 = s4[0] ^ s4[10] ^ s4[20] ^ s4[30] ^ s4[40];
          c1 = s4[1] ^ s4[11] ^ s4[21] ^ s4[31] ^ s4[41];
          c22 = s4[2] ^ s4[12] ^ s4[22] ^ s4[32] ^ s4[42];
          c3 = s4[3] ^ s4[13] ^ s4[23] ^ s4[33] ^ s4[43];
          c4 = s4[4] ^ s4[14] ^ s4[24] ^ s4[34] ^ s4[44];
          c5 = s4[5] ^ s4[15] ^ s4[25] ^ s4[35] ^ s4[45];
          c6 = s4[6] ^ s4[16] ^ s4[26] ^ s4[36] ^ s4[46];
          c7 = s4[7] ^ s4[17] ^ s4[27] ^ s4[37] ^ s4[47];
          c8 = s4[8] ^ s4[18] ^ s4[28] ^ s4[38] ^ s4[48];
          c9 = s4[9] ^ s4[19] ^ s4[29] ^ s4[39] ^ s4[49];
          h2 = c8 ^ (c22 << 1 | c3 >>> 31);
          l3 = c9 ^ (c3 << 1 | c22 >>> 31);
          s4[0] ^= h2;
          s4[1] ^= l3;
          s4[10] ^= h2;
          s4[11] ^= l3;
          s4[20] ^= h2;
          s4[21] ^= l3;
          s4[30] ^= h2;
          s4[31] ^= l3;
          s4[40] ^= h2;
          s4[41] ^= l3;
          h2 = c0 ^ (c4 << 1 | c5 >>> 31);
          l3 = c1 ^ (c5 << 1 | c4 >>> 31);
          s4[2] ^= h2;
          s4[3] ^= l3;
          s4[12] ^= h2;
          s4[13] ^= l3;
          s4[22] ^= h2;
          s4[23] ^= l3;
          s4[32] ^= h2;
          s4[33] ^= l3;
          s4[42] ^= h2;
          s4[43] ^= l3;
          h2 = c22 ^ (c6 << 1 | c7 >>> 31);
          l3 = c3 ^ (c7 << 1 | c6 >>> 31);
          s4[4] ^= h2;
          s4[5] ^= l3;
          s4[14] ^= h2;
          s4[15] ^= l3;
          s4[24] ^= h2;
          s4[25] ^= l3;
          s4[34] ^= h2;
          s4[35] ^= l3;
          s4[44] ^= h2;
          s4[45] ^= l3;
          h2 = c4 ^ (c8 << 1 | c9 >>> 31);
          l3 = c5 ^ (c9 << 1 | c8 >>> 31);
          s4[6] ^= h2;
          s4[7] ^= l3;
          s4[16] ^= h2;
          s4[17] ^= l3;
          s4[26] ^= h2;
          s4[27] ^= l3;
          s4[36] ^= h2;
          s4[37] ^= l3;
          s4[46] ^= h2;
          s4[47] ^= l3;
          h2 = c6 ^ (c0 << 1 | c1 >>> 31);
          l3 = c7 ^ (c1 << 1 | c0 >>> 31);
          s4[8] ^= h2;
          s4[9] ^= l3;
          s4[18] ^= h2;
          s4[19] ^= l3;
          s4[28] ^= h2;
          s4[29] ^= l3;
          s4[38] ^= h2;
          s4[39] ^= l3;
          s4[48] ^= h2;
          s4[49] ^= l3;
          b0 = s4[0];
          b1 = s4[1];
          b322 = s4[11] << 4 | s4[10] >>> 28;
          b33 = s4[10] << 4 | s4[11] >>> 28;
          b14 = s4[20] << 3 | s4[21] >>> 29;
          b15 = s4[21] << 3 | s4[20] >>> 29;
          b46 = s4[31] << 9 | s4[30] >>> 23;
          b47 = s4[30] << 9 | s4[31] >>> 23;
          b28 = s4[40] << 18 | s4[41] >>> 14;
          b29 = s4[41] << 18 | s4[40] >>> 14;
          b20 = s4[2] << 1 | s4[3] >>> 31;
          b21 = s4[3] << 1 | s4[2] >>> 31;
          b22 = s4[13] << 12 | s4[12] >>> 20;
          b32 = s4[12] << 12 | s4[13] >>> 20;
          b34 = s4[22] << 10 | s4[23] >>> 22;
          b35 = s4[23] << 10 | s4[22] >>> 22;
          b16 = s4[33] << 13 | s4[32] >>> 19;
          b17 = s4[32] << 13 | s4[33] >>> 19;
          b48 = s4[42] << 2 | s4[43] >>> 30;
          b49 = s4[43] << 2 | s4[42] >>> 30;
          b40 = s4[5] << 30 | s4[4] >>> 2;
          b41 = s4[4] << 30 | s4[5] >>> 2;
          b222 = s4[14] << 6 | s4[15] >>> 26;
          b23 = s4[15] << 6 | s4[14] >>> 26;
          b4 = s4[25] << 11 | s4[24] >>> 21;
          b5 = s4[24] << 11 | s4[25] >>> 21;
          b36 = s4[34] << 15 | s4[35] >>> 17;
          b37 = s4[35] << 15 | s4[34] >>> 17;
          b18 = s4[45] << 29 | s4[44] >>> 3;
          b19 = s4[44] << 29 | s4[45] >>> 3;
          b10 = s4[6] << 28 | s4[7] >>> 4;
          b11 = s4[7] << 28 | s4[6] >>> 4;
          b42 = s4[17] << 23 | s4[16] >>> 9;
          b43 = s4[16] << 23 | s4[17] >>> 9;
          b24 = s4[26] << 25 | s4[27] >>> 7;
          b25 = s4[27] << 25 | s4[26] >>> 7;
          b6 = s4[36] << 21 | s4[37] >>> 11;
          b7 = s4[37] << 21 | s4[36] >>> 11;
          b38 = s4[47] << 24 | s4[46] >>> 8;
          b39 = s4[46] << 24 | s4[47] >>> 8;
          b30 = s4[8] << 27 | s4[9] >>> 5;
          b31 = s4[9] << 27 | s4[8] >>> 5;
          b12 = s4[18] << 20 | s4[19] >>> 12;
          b13 = s4[19] << 20 | s4[18] >>> 12;
          b44 = s4[29] << 7 | s4[28] >>> 25;
          b45 = s4[28] << 7 | s4[29] >>> 25;
          b26 = s4[38] << 8 | s4[39] >>> 24;
          b27 = s4[39] << 8 | s4[38] >>> 24;
          b8 = s4[48] << 14 | s4[49] >>> 18;
          b9 = s4[49] << 14 | s4[48] >>> 18;
          s4[0] = b0 ^ ~b22 & b4;
          s4[1] = b1 ^ ~b32 & b5;
          s4[10] = b10 ^ ~b12 & b14;
          s4[11] = b11 ^ ~b13 & b15;
          s4[20] = b20 ^ ~b222 & b24;
          s4[21] = b21 ^ ~b23 & b25;
          s4[30] = b30 ^ ~b322 & b34;
          s4[31] = b31 ^ ~b33 & b35;
          s4[40] = b40 ^ ~b42 & b44;
          s4[41] = b41 ^ ~b43 & b45;
          s4[2] = b22 ^ ~b4 & b6;
          s4[3] = b32 ^ ~b5 & b7;
          s4[12] = b12 ^ ~b14 & b16;
          s4[13] = b13 ^ ~b15 & b17;
          s4[22] = b222 ^ ~b24 & b26;
          s4[23] = b23 ^ ~b25 & b27;
          s4[32] = b322 ^ ~b34 & b36;
          s4[33] = b33 ^ ~b35 & b37;
          s4[42] = b42 ^ ~b44 & b46;
          s4[43] = b43 ^ ~b45 & b47;
          s4[4] = b4 ^ ~b6 & b8;
          s4[5] = b5 ^ ~b7 & b9;
          s4[14] = b14 ^ ~b16 & b18;
          s4[15] = b15 ^ ~b17 & b19;
          s4[24] = b24 ^ ~b26 & b28;
          s4[25] = b25 ^ ~b27 & b29;
          s4[34] = b34 ^ ~b36 & b38;
          s4[35] = b35 ^ ~b37 & b39;
          s4[44] = b44 ^ ~b46 & b48;
          s4[45] = b45 ^ ~b47 & b49;
          s4[6] = b6 ^ ~b8 & b0;
          s4[7] = b7 ^ ~b9 & b1;
          s4[16] = b16 ^ ~b18 & b10;
          s4[17] = b17 ^ ~b19 & b11;
          s4[26] = b26 ^ ~b28 & b20;
          s4[27] = b27 ^ ~b29 & b21;
          s4[36] = b36 ^ ~b38 & b30;
          s4[37] = b37 ^ ~b39 & b31;
          s4[46] = b46 ^ ~b48 & b40;
          s4[47] = b47 ^ ~b49 & b41;
          s4[8] = b8 ^ ~b0 & b22;
          s4[9] = b9 ^ ~b1 & b32;
          s4[18] = b18 ^ ~b10 & b12;
          s4[19] = b19 ^ ~b11 & b13;
          s4[28] = b28 ^ ~b20 & b222;
          s4[29] = b29 ^ ~b21 & b23;
          s4[38] = b38 ^ ~b30 & b322;
          s4[39] = b39 ^ ~b31 & b33;
          s4[48] = b48 ^ ~b40 & b42;
          s4[49] = b49 ^ ~b41 & b43;
          s4[0] ^= RC[n];
          s4[1] ^= RC[n + 1];
        }
      };
      if (COMMON_JS) {
        module.exports = methods;
      } else {
        for (var i2 = 0; i2 < methodNames.length; ++i2) {
          root[methodNames[i2]] = methods[methodNames[i2]];
        }
      }
    })();
  }
});

// node_modules/punycode/punycode.js
var require_punycode = __commonJS({
  "node_modules/punycode/punycode.js"(exports, module) {
    "use strict";
    var maxInt = 2147483647;
    var base = 36;
    var tMin = 1;
    var tMax = 26;
    var skew = 38;
    var damp = 700;
    var initialBias = 72;
    var initialN = 128;
    var delimiter = "-";
    var regexPunycode = /^xn--/;
    var regexNonASCII = /[^\0-\x7F]/;
    var regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g;
    var errors = {
      "overflow": "Overflow: input needs wider integers to process",
      "not-basic": "Illegal input >= 0x80 (not a basic code point)",
      "invalid-input": "Invalid input"
    };
    var baseMinusTMin = base - tMin;
    var floor = Math.floor;
    var stringFromCharCode = String.fromCharCode;
    function error(type) {
      throw new RangeError(errors[type]);
    }
    function map(array, callback) {
      const result = [];
      let length = array.length;
      while (length--) {
        result[length] = callback(array[length]);
      }
      return result;
    }
    function mapDomain(domain, callback) {
      const parts = domain.split("@");
      let result = "";
      if (parts.length > 1) {
        result = parts[0] + "@";
        domain = parts[1];
      }
      domain = domain.replace(regexSeparators, ".");
      const labels = domain.split(".");
      const encoded = map(labels, callback).join(".");
      return result + encoded;
    }
    function ucs2decode(string) {
      const output = [];
      let counter = 0;
      const length = string.length;
      while (counter < length) {
        const value = string.charCodeAt(counter++);
        if (value >= 55296 && value <= 56319 && counter < length) {
          const extra = string.charCodeAt(counter++);
          if ((extra & 64512) == 56320) {
            output.push(((value & 1023) << 10) + (extra & 1023) + 65536);
          } else {
            output.push(value);
            counter--;
          }
        } else {
          output.push(value);
        }
      }
      return output;
    }
    var ucs2encode = (codePoints) => String.fromCodePoint(...codePoints);
    var basicToDigit = function(codePoint) {
      if (codePoint >= 48 && codePoint < 58) {
        return 26 + (codePoint - 48);
      }
      if (codePoint >= 65 && codePoint < 91) {
        return codePoint - 65;
      }
      if (codePoint >= 97 && codePoint < 123) {
        return codePoint - 97;
      }
      return base;
    };
    var digitToBasic = function(digit, flag) {
      return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
    };
    var adapt = function(delta, numPoints, firstTime) {
      let k2 = 0;
      delta = firstTime ? floor(delta / damp) : delta >> 1;
      delta += floor(delta / numPoints);
      for (; delta > baseMinusTMin * tMax >> 1; k2 += base) {
        delta = floor(delta / baseMinusTMin);
      }
      return floor(k2 + (baseMinusTMin + 1) * delta / (delta + skew));
    };
    var decode = function(input) {
      const output = [];
      const inputLength = input.length;
      let i2 = 0;
      let n = initialN;
      let bias = initialBias;
      let basic = input.lastIndexOf(delimiter);
      if (basic < 0) {
        basic = 0;
      }
      for (let j2 = 0; j2 < basic; ++j2) {
        if (input.charCodeAt(j2) >= 128) {
          error("not-basic");
        }
        output.push(input.charCodeAt(j2));
      }
      for (let index = basic > 0 ? basic + 1 : 0; index < inputLength; ) {
        const oldi = i2;
        for (let w3 = 1, k2 = base; ; k2 += base) {
          if (index >= inputLength) {
            error("invalid-input");
          }
          const digit = basicToDigit(input.charCodeAt(index++));
          if (digit >= base) {
            error("invalid-input");
          }
          if (digit > floor((maxInt - i2) / w3)) {
            error("overflow");
          }
          i2 += digit * w3;
          const t = k2 <= bias ? tMin : k2 >= bias + tMax ? tMax : k2 - bias;
          if (digit < t) {
            break;
          }
          const baseMinusT = base - t;
          if (w3 > floor(maxInt / baseMinusT)) {
            error("overflow");
          }
          w3 *= baseMinusT;
        }
        const out = output.length + 1;
        bias = adapt(i2 - oldi, out, oldi == 0);
        if (floor(i2 / out) > maxInt - n) {
          error("overflow");
        }
        n += floor(i2 / out);
        i2 %= out;
        output.splice(i2++, 0, n);
      }
      return String.fromCodePoint(...output);
    };
    var encode = function(input) {
      const output = [];
      input = ucs2decode(input);
      const inputLength = input.length;
      let n = initialN;
      let delta = 0;
      let bias = initialBias;
      for (const currentValue of input) {
        if (currentValue < 128) {
          output.push(stringFromCharCode(currentValue));
        }
      }
      const basicLength = output.length;
      let handledCPCount = basicLength;
      if (basicLength) {
        output.push(delimiter);
      }
      while (handledCPCount < inputLength) {
        let m3 = maxInt;
        for (const currentValue of input) {
          if (currentValue >= n && currentValue < m3) {
            m3 = currentValue;
          }
        }
        const handledCPCountPlusOne = handledCPCount + 1;
        if (m3 - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
          error("overflow");
        }
        delta += (m3 - n) * handledCPCountPlusOne;
        n = m3;
        for (const currentValue of input) {
          if (currentValue < n && ++delta > maxInt) {
            error("overflow");
          }
          if (currentValue === n) {
            let q3 = delta;
            for (let k2 = base; ; k2 += base) {
              const t = k2 <= bias ? tMin : k2 >= bias + tMax ? tMax : k2 - bias;
              if (q3 < t) {
                break;
              }
              const qMinusT = q3 - t;
              const baseMinusT = base - t;
              output.push(
                stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
              );
              q3 = floor(qMinusT / baseMinusT);
            }
            output.push(stringFromCharCode(digitToBasic(q3, 0)));
            bias = adapt(delta, handledCPCountPlusOne, handledCPCount === basicLength);
            delta = 0;
            ++handledCPCount;
          }
        }
        ++delta;
        ++n;
      }
      return output.join("");
    };
    var toUnicode = function(input) {
      return mapDomain(input, function(string) {
        return regexPunycode.test(string) ? decode(string.slice(4).toLowerCase()) : string;
      });
    };
    var toASCII = function(input) {
      return mapDomain(input, function(string) {
        return regexNonASCII.test(string) ? "xn--" + encode(string) : string;
      });
    };
    var punycode = {
      /**
       * A string representing the current Punycode.js version number.
       * @memberOf punycode
       * @type String
       */
      "version": "2.3.1",
      /**
       * An object of methods to convert from JavaScript's internal character
       * representation (UCS-2) to Unicode code points, and back.
       * @see <https://mathiasbynens.be/notes/javascript-encoding>
       * @memberOf punycode
       * @type Object
       */
      "ucs2": {
        "decode": ucs2decode,
        "encode": ucs2encode
      },
      "decode": decode,
      "encode": encode,
      "toASCII": toASCII,
      "toUnicode": toUnicode
    };
    module.exports = punycode;
  }
});

// node_modules/idna-uts46-hx/idna-map.js
var require_idna_map = __commonJS({
  "node_modules/idna-uts46-hx/idna-map.js"(exports, module) {
    (function(root, factory) {
      if (typeof define === "function" && define.amd) {
        define([], function() {
          return factory();
        });
      } else if (typeof exports === "object") {
        module.exports = factory();
      } else {
        root.uts46_map = factory();
      }
    })(exports, function() {
      var blocks = [
        new Uint32Array([2157250, 2157314, 2157378, 2157442, 2157506, 2157570, 2157634, 0, 2157698, 2157762, 2157826, 2157890, 2157954, 0, 2158018, 0]),
        new Uint32Array([2179041, 6291456, 2179073, 6291456, 2179105, 6291456, 2179137, 6291456, 2179169, 6291456, 2179201, 6291456, 2179233, 6291456, 2179265, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 14680064, 14680064, 14680064, 14680064, 14680064]),
        new Uint32Array([0, 2113729, 2197345, 2197377, 2113825, 2197409, 2197441, 2113921, 2197473, 2114017, 2197505, 2197537, 2197569, 2197601, 2197633, 2197665]),
        new Uint32Array([6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 23068672, 23068672, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 23068672, 23068672, 23068672, 0, 0, 0, 0, 23068672]),
        new Uint32Array([14680064, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 14680064, 14680064]),
        new Uint32Array([2196001, 2196033, 2196065, 2196097, 2196129, 2196161, 2196193, 2196225, 2196257, 2196289, 2196321, 2196353, 2196385, 2196417, 2196449, 2196481]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 6291456, 0, 0, 0, 0, 0]),
        new Uint32Array([2097281, 2105921, 2097729, 2106081, 0, 2097601, 2162337, 2106017, 2133281, 2097505, 2105889, 2097185, 2097697, 2135777, 2097633, 2097441]),
        new Uint32Array([2177025, 6291456, 2177057, 6291456, 2177089, 6291456, 2177121, 6291456, 2177153, 6291456, 2177185, 6291456, 2177217, 6291456, 2177249, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 0, 6291456, 6291456, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 6291456]),
        new Uint32Array([0, 23068672, 23068672, 23068672, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 6291456]),
        new Uint32Array([2134435, 2134531, 2134627, 2134723, 2134723, 2134819, 2134819, 2134915, 2134915, 2135011, 2105987, 2135107, 2135203, 2135299, 2131587, 2135395]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 6291456, 2168673, 2169249, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2147906, 2147970, 2148034, 2148098, 2148162, 2148226, 2148290, 2148354, 2147906, 2147970, 2148034, 2148098, 2148162, 2148226, 2148290, 2148354]),
        new Uint32Array([2125219, 2125315, 2152834, 2152898, 2125411, 2152962, 2153026, 2125506, 2125507, 2125603, 2153090, 2153154, 2153218, 2153282, 2153346, 2105348]),
        new Uint32Array([2203393, 6291456, 2203425, 6291456, 2203457, 6291456, 2203489, 6291456, 6291456, 6291456, 6291456, 2203521, 6291456, 2181281, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 23068672, 6291456, 2145538, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 6291456]),
        new Uint32Array([2139426, 2160834, 2160898, 2160962, 2134242, 2161026, 2161090, 2161154, 2161218, 2161282, 2161346, 2161410, 2138658, 2161474, 2161538, 2134722]),
        new Uint32Array([2119939, 2124930, 2125026, 2106658, 2125218, 2128962, 2129058, 2129154, 2129250, 2129346, 2129442, 2108866, 2108770, 2150466, 2150530, 2150594]),
        new Uint32Array([2201601, 6291456, 2201633, 6291456, 2201665, 6291456, 2201697, 6291456, 2201729, 6291456, 2201761, 6291456, 2201793, 6291456, 2201825, 6291456]),
        new Uint32Array([2193537, 2193569, 2193601, 2193633, 2193665, 2193697, 2193729, 2193761, 2193793, 2193825, 2193857, 2193889, 2193921, 2193953, 2193985, 2194017]),
        new Uint32Array([6291456, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([0, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2190561, 6291456, 2190593, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2190625, 6291456, 2190657, 6291456, 23068672]),
        new Uint32Array([2215905, 2215937, 2215969, 2216001, 2216033, 2216065, 2216097, 2216129, 2216161, 2216193, 2216225, 2216257, 2105441, 2216289, 2216321, 2216353]),
        new Uint32Array([23068672, 18884130, 23068672, 23068672, 23068672, 6291456, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672]),
        new Uint32Array([23068672, 23068672, 0, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2191233, 2191265, 2191297, 2191329, 2191361, 2191393, 2191425, 2117377, 2191457, 2191489, 2191521, 2191553, 2191585, 2191617, 2191649, 2117953]),
        new Uint32Array([2132227, 2132323, 2132419, 2132419, 2132515, 2132515, 2132611, 2132707, 2132707, 2132803, 2132899, 2132899, 2132995, 2132995, 2133091, 2133187]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 6291456, 0, 0]),
        new Uint32Array([2112481, 2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 10609889, 10610785, 10609921, 10610817, 2222241]),
        new Uint32Array([6291456, 6291456, 6291456, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 0, 0]),
        new Uint32Array([2219969, 2157121, 2157441, 2157505, 2157889, 2157953, 2220001, 2158465, 2158529, 10575617, 2156994, 2157058, 2129923, 2130019, 2157122, 2157186]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0]),
        new Uint32Array([2185249, 6291456, 2185281, 6291456, 2185313, 6291456, 2185345, 6291456, 2185377, 6291456, 2185409, 6291456, 2185441, 6291456, 2185473, 6291456]),
        new Uint32Array([0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 23068672, 23068672, 0, 0, 23068672, 23068672, 23068672, 6291456, 0]),
        new Uint32Array([2183361, 6291456, 2183393, 6291456, 2183425, 6291456, 2183457, 6291456, 2183489, 6291456, 2183521, 6291456, 2183553, 6291456, 2183585, 6291456]),
        new Uint32Array([2192161, 2192193, 2192225, 2192257, 2192289, 2192321, 2192353, 2192385, 2192417, 2192449, 2192481, 2192513, 2192545, 2192577, 2192609, 2192641]),
        new Uint32Array([2212001, 2212033, 2212065, 2212097, 2212129, 2212161, 2212193, 2212225, 2212257, 2212289, 2212321, 2212353, 2212385, 2212417, 2212449, 2207265]),
        new Uint32Array([2249825, 2249857, 2249889, 2249921, 2249954, 2250018, 2250082, 2250145, 2250177, 2250209, 2250241, 2250274, 2250337, 2250370, 2250433, 2250465]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2147905, 2147969, 2148033, 2148097, 2148161, 2148225, 2148289, 2148353]),
        new Uint32Array([10485857, 6291456, 2197217, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 23068672, 23068672]),
        new Uint32Array([0, 23068672, 23068672, 23068672, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456]),
        new Uint32Array([2180353, 2180385, 2144033, 2180417, 2180449, 2180481, 2180513, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2112481, 2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 10610209, 10610465, 10610241, 10610753, 10609857]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 0, 0]),
        new Uint32Array([2223842, 2223906, 2223970, 2224034, 2224098, 2224162, 2224226, 2224290, 2224354, 2224418, 2224482, 2224546, 2224610, 2224674, 2224738, 2224802]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 18923650, 23068672, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 23068672, 23068672, 18923714, 23068672, 23068672]),
        new Uint32Array([2126179, 2125538, 2126275, 2126371, 2126467, 2125634, 2126563, 2105603, 2105604, 2125346, 2126659, 2126755, 2126851, 2098179, 2098181, 2098182]),
        new Uint32Array([2227426, 2227490, 2227554, 2227618, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2192353, 2240642, 2240642, 2240705, 2240737, 2240737, 2240769, 2240802, 2240866, 2240929, 2240961, 2240993, 2241025, 2241057, 2241089, 2241121]),
        new Uint32Array([6291456, 2170881, 2170913, 2170945, 6291456, 2170977, 6291456, 2171009, 2171041, 6291456, 6291456, 6291456, 2171073, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2132226, 2132514, 2163586, 2132610, 2160386, 2133090, 2133186, 2160450, 2160514, 2160578, 2133570, 2106178, 2160642, 2133858, 2160706, 2160770]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 10532162, 10532226, 10532290, 10532354, 10532418, 10532482, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 23068672]),
        new Uint32Array([2098209, 2108353, 2108193, 2108481, 2170241, 2111713, 2105473, 2105569, 2105601, 2112289, 2112481, 2098305, 2108321, 0, 0, 0]),
        new Uint32Array([2209121, 2209153, 2209185, 2209217, 2209249, 2209281, 2209313, 2209345, 2209377, 2209409, 2209441, 2209473, 2207265, 2209505, 2209537, 2209569]),
        new Uint32Array([2189025, 6291456, 2189057, 6291456, 2189089, 6291456, 2189121, 6291456, 2189153, 6291456, 2189185, 6291456, 2189217, 6291456, 2189249, 6291456]),
        new Uint32Array([2173825, 2153473, 2173857, 2173889, 2173921, 2173953, 2173985, 2173761, 2174017, 2174049, 2174081, 2174113, 2174145, 2174177, 2149057, 2233057]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2165764, 2140004]),
        new Uint32Array([2215105, 6291456, 2215137, 6291456, 6291456, 2215169, 2215201, 6291456, 6291456, 6291456, 2215233, 2215265, 2215297, 2215329, 2215361, 2215393]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 6291456, 6291456, 6291456, 23068672, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([10505091, 10505187, 10505283, 10505379, 10505475, 10505571, 10505667, 10505763, 10505859, 10505955, 10506051, 10506147, 10506243, 10506339, 10506435, 10506531]),
        new Uint32Array([2229730, 2229794, 2229858, 2229922, 2229986, 2230050, 2230114, 2230178, 2230242, 2230306, 2230370, 2230434, 2230498, 2230562, 2230626, 2230690]),
        new Uint32Array([2105505, 2098241, 2108353, 2108417, 2105825, 0, 2100897, 2111905, 2105473, 2105569, 2105601, 2112289, 2108193, 2112481, 2112577, 2098177]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 10502115, 10502178, 10502211, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([0, 23068672, 23068672, 23068672, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456]),
        new Uint32Array([2190305, 6291456, 2190337, 6291456, 2190369, 6291456, 2190401, 6291456, 2190433, 6291456, 2190465, 6291456, 2190497, 6291456, 2190529, 6291456]),
        new Uint32Array([2173793, 2173985, 2174017, 6291456, 2173761, 2173697, 6291456, 2174689, 6291456, 2174017, 2174721, 6291456, 6291456, 2174753, 2174785, 2174817]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2099521, 2099105, 2120705, 2098369, 2120801, 2103361, 2097985, 2098433, 2121377, 2121473, 2099169, 2099873, 2098401, 2099393, 2152609, 2100033]),
        new Uint32Array([2132898, 2163842, 2163906, 2133282, 2132034, 2131938, 2137410, 2132802, 2132706, 2164866, 2133282, 2160578, 2165186, 2165186, 6291456, 6291456]),
        new Uint32Array([10500003, 10500099, 10500195, 10500291, 10500387, 10500483, 10500579, 10500675, 10500771, 10500867, 10500963, 10501059, 10501155, 10501251, 10501347, 10501443]),
        new Uint32Array([2163458, 2130978, 2131074, 2131266, 2131362, 2163522, 2160130, 2132066, 2131010, 2131106, 2106018, 2131618, 2131298, 2132034, 2131938, 2137410]),
        new Uint32Array([2212961, 2116993, 2212993, 2213025, 2213057, 2213089, 2213121, 2213153, 2213185, 2213217, 2213249, 2209633, 2213281, 2213313, 2213345, 2213377]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456]),
        new Uint32Array([2113729, 2113825, 2113921, 2114017, 2114113, 2114209, 2114305, 2114401, 2114497, 2114593, 2114689, 2114785, 2114881, 2114977, 2115073, 2115169]),
        new Uint32Array([2238177, 2238209, 2238241, 2238273, 2238305, 2238337, 2238337, 2217537, 2238369, 2238401, 2238433, 2238465, 2215649, 2238497, 2238529, 2238561]),
        new Uint32Array([2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 2098209, 2111137, 2105505, 2098241, 2108353, 2108417, 2105825, 2111713, 2100897, 2111905]),
        new Uint32Array([6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 0, 0]),
        new Uint32Array([6291456, 0, 6291456, 2145026, 0, 6291456, 2145090, 0, 6291456, 6291456, 0, 0, 23068672, 0, 23068672, 23068672]),
        new Uint32Array([2099233, 2122017, 2200673, 2098113, 2121537, 2103201, 2200705, 2104033, 2121857, 2121953, 2122401, 2099649, 2099969, 2123009, 2100129, 2100289]),
        new Uint32Array([6291456, 23068672, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 23068672, 23068672, 0, 0, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0]),
        new Uint32Array([2187681, 2187713, 2187745, 2187777, 2187809, 2187841, 2187873, 2187905, 2187937, 2187969, 2188001, 2188033, 2188065, 2188097, 2188129, 2188161]),
        new Uint32Array([0, 10554498, 10554562, 10554626, 10554690, 10554754, 10554818, 10554882, 10554946, 10555010, 10555074, 6291456, 6291456, 0, 0, 0]),
        new Uint32Array([2235170, 2235234, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2181153, 6291456, 2188897, 6291456, 6291456, 2188929, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2111905, 2100865, 2188961, 2188993]),
        new Uint32Array([2100833, 2100897, 0, 0, 2101569, 2101697, 2101825, 2101953, 2102081, 2102209, 10575617, 2187041, 10502177, 10489601, 10489697, 2112289]),
        new Uint32Array([6291456, 2172833, 6291456, 2172865, 2172897, 2172929, 2172961, 6291456, 2172993, 6291456, 2173025, 6291456, 2173057, 6291456, 2173089, 6291456]),
        new Uint32Array([6291456, 0, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 23068672, 6291456, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 2190721]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 23068672, 6291456, 6291456]),
        new Uint32Array([2184993, 6291456, 2185025, 6291456, 2185057, 6291456, 2185089, 6291456, 2185121, 6291456, 2185153, 6291456, 2185185, 6291456, 2185217, 6291456]),
        new Uint32Array([2115265, 2115361, 2115457, 2115553, 2115649, 2115745, 2115841, 2115937, 2116033, 2116129, 2116225, 2116321, 2150658, 2150722, 2200225, 6291456]),
        new Uint32Array([2168321, 6291456, 2168353, 6291456, 2168385, 6291456, 2168417, 6291456, 2168449, 6291456, 2168481, 6291456, 2168513, 6291456, 2168545, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 0, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 6291456, 6291456, 0, 6291456, 0, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 2186625, 0, 0, 6291456, 6291456, 2186657, 2186689, 2186721, 2173505, 0, 10496067, 10496163, 10496259]),
        new Uint32Array([2178785, 6291456, 2178817, 6291456, 2178849, 6291456, 2178881, 6291456, 2178913, 6291456, 2178945, 6291456, 2178977, 6291456, 2179009, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0]),
        new Uint32Array([2097152, 0, 0, 0, 2097152, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456]),
        new Uint32Array([6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([0, 0, 2197857, 2197889, 2197921, 2197953, 2197985, 2198017, 0, 0, 2198049, 2198081, 2198113, 2198145, 2198177, 2198209]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2098209, 2167297, 2111137, 6291456]),
        new Uint32Array([2171393, 6291456, 2171425, 6291456, 2171457, 6291456, 2171489, 6291456, 2171521, 6291456, 2171553, 6291456, 2171585, 6291456, 2171617, 6291456]),
        new Uint32Array([2206753, 2206785, 2195457, 2206817, 2206849, 2206881, 2206913, 2197153, 2197153, 2206945, 2117857, 2206977, 2207009, 2207041, 2207073, 2207105]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 23068672, 0, 0, 0, 0, 2144834, 2144898, 0, 2144962]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 23068672]),
        new Uint32Array([2108193, 2112481, 2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 2098209, 0, 2105505, 2098241]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 2202049, 6291456, 2202081, 6291456, 2202113, 6291456, 2202145, 6291456, 2202177, 6291456, 2202209, 6291456, 2202241, 6291456]),
        new Uint32Array([10501155, 10501251, 10501347, 10501443, 10501539, 10501635, 10501731, 10501827, 10501923, 10502019, 2141731, 2105505, 2098177, 2155586, 2166530, 0]),
        new Uint32Array([2102081, 2102209, 2100833, 2100737, 2098337, 2101441, 2101569, 2101697, 2101825, 2101953, 2102081, 2102209, 2100833, 2100737, 2098337, 2101441]),
        new Uint32Array([2146882, 2146946, 2147010, 2147074, 2147138, 2147202, 2147266, 2147330, 2146882, 2146946, 2147010, 2147074, 2147138, 2147202, 2147266, 2147330]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0]),
        new Uint32Array([10502307, 10502403, 10502499, 10502595, 10502691, 10502787, 10502883, 10502979, 10503075, 10503171, 10503267, 10503363, 10503459, 10503555, 10503651, 10503747]),
        new Uint32Array([2179937, 2179969, 2180001, 2180033, 2156545, 2180065, 2156577, 2180097, 2180129, 2180161, 2180193, 2180225, 2180257, 2180289, 2156737, 2180321]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 0, 0, 0, 6291456, 0, 0, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0]),
        new Uint32Array([2227682, 2227746, 2227810, 2227874, 2227938, 2228002, 2228066, 2228130, 2228194, 2228258, 2228322, 2228386, 2228450, 2228514, 2228578, 2228642]),
        new Uint32Array([2105601, 2169121, 2108193, 2170049, 2181025, 2181057, 2112481, 2108321, 2108289, 2181089, 2170497, 2100865, 2181121, 2173601, 2173633, 2173665]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2180641, 6291456, 6291456, 6291456]),
        new Uint32Array([0, 6291456, 6291456, 6291456, 0, 6291456, 0, 6291456, 0, 0, 6291456, 6291456, 0, 6291456, 6291456, 6291456]),
        new Uint32Array([2178273, 6291456, 2178305, 6291456, 2178337, 6291456, 2178369, 6291456, 2178401, 6291456, 2178433, 6291456, 2178465, 6291456, 2178497, 6291456]),
        new Uint32Array([6291456, 6291456, 23068672, 23068672, 23068672, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456]),
        new Uint32Array([2237377, 2237409, 2236225, 2237441, 2237473, 2217441, 2215521, 2215553, 2217473, 2237505, 2237537, 2209697, 2237569, 2215585, 2237601, 2237633]),
        new Uint32Array([2221985, 2165601, 2165601, 2165665, 2165665, 2222017, 2222017, 2165729, 2165729, 2158913, 2158913, 2158913, 2158913, 2097281, 2097281, 2105921]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 23068672, 23068672, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2149634, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2176897, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 2176929, 6291456, 2176961, 6291456, 2176993, 6291456]),
        new Uint32Array([2172641, 6291456, 2172673, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2172705, 2172737, 6291456, 2172769, 2172801, 6291456]),
        new Uint32Array([2099173, 2104196, 2121667, 2099395, 2121763, 2152258, 2152322, 2098946, 2152386, 2121859, 2121955, 2099333, 2122051, 2104324, 2099493, 2122147]),
        new Uint32Array([6291456, 6291456, 6291456, 2145794, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 2145858, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 0, 0, 6291456, 0]),
        new Uint32Array([0, 2105921, 2097729, 0, 2097377, 0, 0, 2106017, 0, 2097505, 2105889, 2097185, 2097697, 2135777, 2097633, 2097441]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2239074, 2239138, 2239201, 2239233, 2239265, 2239297, 2239329, 2239361, 0, 2239393, 2239425, 2239425, 2239458, 2239521, 2239553, 2209569]),
        new Uint32Array([14680064, 2098209, 2111137, 2105505, 2098241, 2108353, 2108417, 2105825, 2111713, 2100897, 2111905, 2105473, 2105569, 2105601, 2112289, 2108193]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 6291456, 23068672]),
        new Uint32Array([2108321, 2108289, 2113153, 2098209, 2180897, 2180929, 2180961, 2111137, 2098241, 2108353, 2170241, 2170273, 2180993, 2105825, 6291456, 2105473]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2146114, 6291456, 6291456, 6291456, 0, 0, 0]),
        new Uint32Array([2105921, 2105921, 2105921, 2222049, 2222049, 2130977, 2130977, 2130977, 2130977, 2160065, 2160065, 2160065, 2160065, 2097729, 2097729, 2097729]),
        new Uint32Array([2218145, 2214785, 2207937, 2218177, 2218209, 2192993, 2210113, 2212769, 2218241, 2218273, 2216129, 2218305, 2216161, 2218337, 2218369, 2218401]),
        new Uint32Array([0, 0, 0, 2156546, 2156610, 2156674, 2156738, 2156802, 0, 0, 0, 0, 0, 2156866, 23068672, 2156930]),
        new Uint32Array([23068672, 23068672, 23068672, 0, 0, 0, 0, 23068672, 23068672, 0, 0, 23068672, 23068672, 23068672, 0, 0]),
        new Uint32Array([2213409, 2213441, 2213473, 2213505, 2213537, 2213569, 2213601, 2213633, 2213665, 2195681, 2213697, 2213729, 2213761, 2213793, 2213825, 2213857]),
        new Uint32Array([2100033, 2099233, 2122017, 2200673, 2098113, 2121537, 2103201, 2200705, 2104033, 2121857, 2121953, 2122401, 2099649, 2099969, 2123009, 2100129]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2201857, 6291456, 2201889, 6291456, 2201921, 6291456, 2201953, 6291456, 2201985, 6291456, 2202017, 6291456, 2176193, 2176257, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 23068672, 23068672, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2188193, 2188225, 2188257, 2188289, 2188321, 2188353, 2188385, 2188417, 2188449, 2188481, 2188513, 2188545, 2188577, 2188609, 2188641, 0]),
        new Uint32Array([10554529, 2221089, 0, 10502113, 10562017, 10537921, 10538049, 2221121, 2221153, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2213889, 2213921, 2213953, 2213985, 2214017, 2214049, 2214081, 2194177, 2214113, 2214145, 2214177, 2214209, 2214241, 2214273, 2214305, 2214337]),
        new Uint32Array([2166978, 2167042, 2099169, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2180545, 6291456, 6291456, 6291456]),
        new Uint32Array([10518915, 10519011, 10519107, 10519203, 2162242, 2162306, 2159554, 2162370, 2159362, 2159618, 2105922, 2162434, 2159746, 2162498, 2159810, 2159874]),
        new Uint32Array([2161730, 2161794, 2135586, 2161858, 2161922, 2137186, 2131810, 2160290, 2135170, 2161986, 2137954, 2162050, 2162114, 2162178, 10518723, 10518819]),
        new Uint32Array([10506627, 10506723, 10506819, 10506915, 10507011, 10507107, 10507203, 10507299, 10507395, 10507491, 10507587, 10507683, 10507779, 10507875, 10507971, 10508067]),
        new Uint32Array([6291456, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 0, 0, 0, 0, 0, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0]),
        new Uint32Array([2175873, 2175905, 2175937, 2175969, 2176001, 2176033, 2176065, 2176097, 2176129, 2176161, 2176193, 2176225, 2176257, 2176289, 2176321, 2176353]),
        new Uint32Array([2140006, 2140198, 2140390, 2140582, 2140774, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672]),
        new Uint32Array([2108193, 2112481, 2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 2098209, 2111137, 2105505, 2098241]),
        new Uint32Array([0, 23068672, 0, 0, 0, 0, 0, 0, 0, 2145154, 2145218, 2145282, 6291456, 0, 2145346, 0]),
        new Uint32Array([0, 0, 0, 0, 10531458, 10495395, 2148545, 2143201, 2173473, 2148865, 2173505, 0, 2173537, 0, 2173569, 2149121]),
        new Uint32Array([10537282, 10495683, 2148738, 2148802, 2148866, 0, 6291456, 2148930, 2186593, 2173473, 2148737, 2148865, 2148802, 10495779, 10495875, 10495971]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2215425, 2215457, 2215489, 2215521, 2215553, 2215585, 2215617, 2215649, 2215681, 2215713, 2215745, 2215777, 2192033, 2215809, 2215841, 2215873]),
        new Uint32Array([2242049, 2242081, 2242113, 2242145, 2242177, 2242209, 2242241, 2242273, 2215937, 2242305, 2242338, 2242401, 2242433, 2242465, 2242497, 2216001]),
        new Uint32Array([10554529, 2221089, 0, 0, 10562017, 10502113, 10538049, 10537921, 2221185, 10489601, 10489697, 10609889, 10609921, 2141729, 2141793, 10610273]),
        new Uint32Array([2141923, 2142019, 2142115, 2142211, 2142307, 2142403, 2142499, 2142595, 2142691, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([0, 2221185, 2221217, 10609857, 10609857, 10489601, 10489697, 10609889, 10609921, 2141729, 2141793, 2221345, 2221377, 2221409, 2221441, 2187105]),
        new Uint32Array([6291456, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 18923970, 23068672, 23068672, 23068672, 0, 6291456, 6291456]),
        new Uint32Array([2183105, 6291456, 2183137, 6291456, 2183169, 6291456, 2183201, 6291456, 2183233, 6291456, 2183265, 6291456, 2183297, 6291456, 2183329, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2134434, 2134818, 2097666, 2097186, 2097474, 2097698, 2105986, 2131586, 2132450, 2131874, 2131778, 2135970, 2135778, 2161602, 2136162, 2161666]),
        new Uint32Array([2236865, 2236897, 2236930, 2236993, 2237025, 2235681, 2237058, 2237121, 2237153, 2237185, 2237217, 2217281, 2237250, 2191233, 2237313, 2237345]),
        new Uint32Array([2190049, 6291456, 2190081, 6291456, 2190113, 6291456, 2190145, 6291456, 2190177, 6291456, 2190209, 6291456, 2190241, 6291456, 2190273, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2101922, 2102050, 2102178, 2102306, 10498755, 10498851, 10498947, 10499043, 10499139, 10499235, 10499331, 10499427, 10499523, 10489604, 10489732, 10489860]),
        new Uint32Array([2166914, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0]),
        new Uint32Array([2181601, 2170561, 2181633, 2181665, 2170753, 2181697, 2172897, 2170881, 2181729, 2170913, 2172929, 2113441, 2181761, 2181793, 2171009, 2173761]),
        new Uint32Array([0, 2105921, 2097729, 2106081, 0, 2097601, 2162337, 2106017, 2133281, 2097505, 0, 2097185, 2097697, 2135777, 2097633, 2097441]),
        new Uint32Array([6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0]),
        new Uint32Array([2248001, 2248033, 2248066, 2248130, 2248193, 2248226, 2248289, 2248322, 2248385, 2248417, 2216673, 2248450, 2248514, 2248577, 2248610, 2248673]),
        new Uint32Array([6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 0, 0, 0]),
        new Uint32Array([2169729, 6291456, 2169761, 6291456, 2169793, 6291456, 2169825, 6291456, 2169857, 2169889, 6291456, 2169921, 6291456, 2143329, 6291456, 2098305]),
        new Uint32Array([2162178, 2163202, 2163266, 2135170, 2136226, 2161986, 2137954, 2159426, 2159490, 2163330, 2159554, 2163394, 2159682, 2139522, 2136450, 2159746]),
        new Uint32Array([2173953, 2173985, 0, 2174017, 2174049, 2174081, 2174113, 2174145, 2174177, 2149057, 2174209, 2174241, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 4271169, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2174273]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 6291456, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 2190785, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2189793, 6291456, 2189825, 6291456, 2189857, 6291456, 2189889, 6291456, 2189921, 6291456, 2189953, 6291456, 2189985, 6291456, 2190017, 6291456]),
        new Uint32Array([2105601, 2112289, 2108193, 2112481, 2112577, 0, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 0, 2098209, 2111137]),
        new Uint32Array([2172129, 6291456, 2172161, 6291456, 2172193, 6291456, 2172225, 6291456, 2172257, 6291456, 2172289, 6291456, 2172321, 6291456, 2172353, 6291456]),
        new Uint32Array([2214753, 6291456, 2214785, 6291456, 6291456, 2214817, 2214849, 2214881, 2214913, 2214945, 2214977, 2215009, 2215041, 2215073, 2194401, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([0, 0, 0, 0, 6291456, 6291456, 6291456, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([10610305, 10610337, 10575617, 2221761, 10610401, 10610433, 10502177, 0, 10610465, 10610497, 10610529, 10610561, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 23068672, 0, 0, 0, 0, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2187105, 2187137, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2199393, 2199425, 2199457, 2199489, 2199521, 2199553, 2199585, 2199617, 2199649, 2199681, 2199713, 2199745, 2199777, 2199809, 2199841, 0]),
        new Uint32Array([2217249, 2217281, 2217313, 2217345, 2217377, 2217409, 2217441, 2217473, 2215617, 2217505, 2217537, 2217569, 2214753, 2217601, 2217633, 2217665]),
        new Uint32Array([2170273, 2170305, 6291456, 2170337, 2170369, 6291456, 2170401, 2170433, 2170465, 6291456, 6291456, 6291456, 2170497, 2170529, 6291456, 2170561]),
        new Uint32Array([2188673, 6291456, 2188705, 2188737, 2188769, 6291456, 6291456, 2188801, 6291456, 2188833, 6291456, 2188865, 6291456, 2180929, 2181505, 2180897]),
        new Uint32Array([10489988, 10490116, 10490244, 10490372, 10490500, 10490628, 10490756, 10490884, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2147393, 2147457, 2147521, 2147585, 2147649, 2147713, 2147777, 2147841]),
        new Uint32Array([23068672, 23068672, 0, 23068672, 23068672, 0, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0]),
        new Uint32Array([2241153, 2241185, 2241217, 2215809, 2241250, 2241313, 2241345, 2241377, 2217921, 2241377, 2241409, 2215873, 2241441, 2241473, 2241505, 2241537]),
        new Uint32Array([23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2220417, 2220417, 2220449, 2220449, 2220481, 2220481, 2220513, 2220513, 2220545, 2220545, 2220577, 2220577, 2220609, 2220609, 2220641, 2220641]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2144002, 0, 6291456, 6291456, 0, 0, 6291456, 6291456, 6291456]),
        new Uint32Array([2167105, 2167137, 2167169, 2167201, 2167233, 2167265, 2167297, 2167329, 2167361, 2167393, 2167425, 2167457, 2167489, 2167521, 2167553, 2167585]),
        new Uint32Array([10575521, 2098209, 2111137, 2105505, 2098241, 2108353, 2108417, 2105825, 2111713, 2100897, 2111905, 2105473, 2105569, 2105601, 2112289, 2108193]),
        new Uint32Array([2234146, 2234210, 2234274, 2234338, 2234402, 2234466, 2234530, 2234594, 2234658, 2234722, 2234786, 2234850, 2234914, 2234978, 2235042, 2235106]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 2180577, 0, 0, 0, 0, 0, 2180609, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 6291456, 6291456]),
        new Uint32Array([2098209, 2111137, 2105505, 2098241, 2108353, 2108417, 2105825, 2111713, 2100897, 2111905, 2105473, 2105569, 2105601, 2112289, 2108193, 2112481]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2242529, 2242561, 2242593, 2242625, 2242657, 2242689, 2242721, 2242753, 2207937, 2218177, 2242785, 2242817, 2242849, 2242882, 2242945, 2242977]),
        new Uint32Array([2118049, 2105345, 2118241, 2105441, 2118433, 2118529, 2118625, 2118721, 2118817, 2200257, 2200289, 2191809, 2200321, 2200353, 2200385, 2200417]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0]),
        new Uint32Array([2185505, 6291456, 2185537, 6291456, 2185569, 6291456, 2185601, 6291456, 2185633, 6291456, 2185665, 6291456, 2185697, 6291456, 2185729, 6291456]),
        new Uint32Array([2231970, 2232034, 2232098, 2232162, 2232226, 2232290, 2232354, 2232418, 2232482, 2232546, 2232610, 2232674, 2232738, 2232802, 2232866, 2232930]),
        new Uint32Array([2218625, 2246402, 2246466, 2246530, 2246594, 2246657, 2246689, 2246689, 2218657, 2219681, 2246721, 2246753, 2246785, 2246818, 2246881, 2208481]),
        new Uint32Array([2197025, 2197057, 2197089, 2197121, 2197153, 2197185, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2219137, 2216961, 2219169, 2219201, 2219233, 2219265, 2219297, 2217025, 2215041, 2219329, 2217057, 2219361, 2217089, 2219393, 2197153, 2219426]),
        new Uint32Array([23068672, 23068672, 23068672, 0, 0, 0, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 23068672, 23068672, 0, 0]),
        new Uint32Array([2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 2098209, 2111137, 2105505, 2098241, 2108353, 2108417, 2105825, 2111713]),
        new Uint32Array([2243522, 2243585, 2243617, 2243649, 2243681, 2210113, 2243713, 2243746, 2243810, 2243874, 2243937, 2243970, 2244033, 2244065, 2244097, 2244129]),
        new Uint32Array([2178017, 6291456, 2178049, 6291456, 2178081, 6291456, 2178113, 6291456, 2178145, 6291456, 2178177, 6291456, 2178209, 6291456, 2178241, 6291456]),
        new Uint32Array([10553858, 2165314, 10518722, 6291456, 10518818, 0, 10518914, 2130690, 10519010, 2130786, 10519106, 2130882, 10519202, 2165378, 10554050, 2165506]),
        new Uint32Array([0, 0, 2135491, 2135587, 2135683, 2135779, 2135875, 2135971, 2135971, 2136067, 2136163, 2136259, 2136355, 2136355, 2136451, 2136547]),
        new Uint32Array([23068672, 23068672, 23068672, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2220033, 2220033, 2220065, 2220065, 2220065, 2220065, 2220097, 2220097, 2220097, 2220097, 2220129, 2220129, 2220129, 2220129, 2220161, 2220161]),
        new Uint32Array([6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 0, 23068672, 0, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2100897, 2100898, 2100899, 2150018, 2100865, 2100866, 2100867, 2100868, 2150082, 2108481, 2109858, 2109859, 2105569, 2105505, 2098241, 2105601]),
        new Uint32Array([2097217, 2097505, 2097505, 2097505, 2097505, 2165570, 2165570, 2165634, 2165634, 2165698, 2165698, 2097858, 2097858, 0, 0, 2097152]),
        new Uint32Array([23068672, 6291456, 23068672, 23068672, 23068672, 6291456, 6291456, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672]),
        new Uint32Array([23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0]),
        new Uint32Array([10503843, 10503939, 10504035, 10504131, 10504227, 10504323, 10504419, 10504515, 10504611, 10504707, 10504803, 10504899, 10504995, 10491140, 10491268, 0]),
        new Uint32Array([2173697, 2173729, 2148801, 2173761, 2143969, 2173793, 2173825, 2153473, 2173857, 2173889, 2173921, 2173953, 2173985, 2173761, 2174017, 2174049]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2134145, 2097153, 2134241, 2105953, 2132705, 2130977, 2160065, 2131297, 2162049, 2133089, 2160577, 2133857, 2235297, 2220769, 2235329, 2235361]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2222401, 2222433, 2222465, 10531394, 2222497, 2222529, 2222561, 0, 2222593, 2222625, 2222657, 2222689, 2222721, 2222753, 2222785, 0]),
        new Uint32Array([2184481, 6291456, 2184513, 6291456, 2184545, 6291456, 2184577, 6291456, 2184609, 6291456, 2184641, 6291456, 2184673, 6291456, 2184705, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2105570, 2156034, 2126947, 2156098, 2153666, 2127043, 2127139, 2156162, 0, 2127235, 2156226, 2156290, 2156354, 2156418, 2127331, 2127427]),
        new Uint32Array([2215905, 2207041, 2153185, 2241569, 2241601, 2241633, 2241665, 2241697, 2241730, 2241793, 2241825, 2241857, 2241889, 2241921, 2241954, 2242017]),
        new Uint32Array([2203777, 6291456, 2203809, 6291456, 2203841, 6291456, 2203873, 6291456, 2203905, 6291456, 2173121, 2180993, 2181249, 2203937, 2181313, 0]),
        new Uint32Array([2168577, 6291456, 2168609, 6291456, 2168641, 6291456, 2168673, 6291456, 2168705, 6291456, 2168737, 6291456, 2168769, 6291456, 2168801, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456, 23068672, 23068672, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 23068672, 0, 0]),
        new Uint32Array([2210113, 2195521, 2210145, 2210177, 2210209, 2210241, 2210273, 2210305, 2210337, 2210369, 2210401, 2210433, 2210465, 2210497, 2210529, 2210561]),
        new Uint32Array([6291456, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0]),
        new Uint32Array([2228706, 2228770, 2228834, 2228898, 2228962, 2229026, 2229090, 2229154, 2229218, 2229282, 2229346, 2229410, 2229474, 2229538, 2229602, 2229666]),
        new Uint32Array([23068672, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 18874368, 18874368, 18874368, 0, 0]),
        new Uint32Array([2133089, 2133281, 2133281, 2133281, 2133281, 2160577, 2160577, 2160577, 2160577, 2097441, 2097441, 2097441, 2097441, 2133857, 2133857, 2133857]),
        new Uint32Array([6291456, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2173825, 2153473, 2173857, 2173889, 2173921, 2173953, 2173985, 2174017, 2174017, 2174049, 2174081, 2174113, 2174145, 2174177, 2149057, 2233089]),
        new Uint32Array([2178529, 6291456, 2178561, 6291456, 2178593, 6291456, 2178625, 6291456, 2178657, 6291456, 2178689, 6291456, 2178721, 6291456, 2178753, 6291456]),
        new Uint32Array([2221025, 2221025, 2221057, 2221057, 2159329, 2159329, 2159329, 2159329, 2097217, 2097217, 2158914, 2158914, 2158978, 2158978, 2159042, 2159042]),
        new Uint32Array([2208161, 2208193, 2208225, 2208257, 2194433, 2208289, 2208321, 2208353, 2208385, 2208417, 2208449, 2208481, 2208513, 2208545, 2208577, 2208609]),
        new Uint32Array([2169217, 6291456, 2169249, 6291456, 2169281, 6291456, 2169313, 6291456, 2169345, 6291456, 2169377, 6291456, 2169409, 6291456, 2169441, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2133187, 2133283, 2133283, 2133379, 2133475, 2133571, 2133667, 2133667, 2133763, 2133859, 2133955, 2134051, 2134147, 2134147, 2134243, 2134339]),
        new Uint32Array([2197697, 2114113, 2114209, 2197729, 2197761, 2114305, 2197793, 2114401, 2114497, 2197825, 2114593, 2114689, 2114785, 2114881, 2114977, 0]),
        new Uint32Array([2193089, 2193121, 2193153, 2193185, 2117665, 2117569, 2193217, 2193249, 2193281, 2193313, 2193345, 2193377, 2193409, 2193441, 2193473, 2193505]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2184225, 6291456, 2184257, 6291456, 2184289, 6291456, 2184321, 6291456, 2184353, 6291456, 2184385, 6291456, 2184417, 6291456, 2184449, 6291456]),
        new Uint32Array([2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 2100833, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2098657, 2098049, 2200737, 2123489, 2123681, 2200769, 2098625, 2100321, 2098145, 2100449, 2098017, 2098753, 2200801, 2200833, 2200865, 0]),
        new Uint32Array([23068672, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 0, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0]),
        new Uint32Array([2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 2098209, 2111137, 0, 2098241, 2108353, 2108417, 2105825, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2181153, 2105505, 2181185, 2167617, 2180993]),
        new Uint32Array([2160002, 2160066, 2160130, 2160194, 2160258, 2132066, 2131010, 2131106, 2106018, 2131618, 2160322, 2131298, 2132034, 2131938, 2137410, 2132226]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6291456]),
        new Uint32Array([2183617, 6291456, 2183649, 6291456, 2183681, 6291456, 2183713, 6291456, 2183745, 6291456, 2183777, 6291456, 2183809, 6291456, 2183841, 6291456]),
        new Uint32Array([0, 6291456, 6291456, 0, 6291456, 0, 0, 6291456, 6291456, 0, 6291456, 0, 0, 6291456, 0, 0]),
        new Uint32Array([2250977, 2251009, 2251041, 2251073, 2195009, 2251106, 2251169, 2251201, 2251233, 2251265, 2251297, 2251330, 2251394, 2251457, 2251489, 2251521]),
        new Uint32Array([2205729, 2205761, 2205793, 2205825, 2205857, 2205889, 2205921, 2205953, 2205985, 2206017, 2206049, 2206081, 2206113, 2206145, 2206177, 2206209]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2143170, 2168993, 6291456, 2169025, 6291456, 2169057, 6291456, 2169089, 6291456, 2143234, 2169121, 6291456, 2169153, 6291456, 2169185, 6291456]),
        new Uint32Array([23068672, 23068672, 2190689, 6291456, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2248706, 2248769, 2248801, 2248833, 2248865, 2248897, 2248929, 2248962, 2249026, 2249090, 2249154, 2240705, 2249217, 2249249, 2249281, 2249313]),
        new Uint32Array([10485857, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 10495394, 6291456, 2098209, 6291456, 6291456, 2097152, 6291456, 10531394]),
        new Uint32Array([0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0]),
        new Uint32Array([14680064, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2173985, 2173953, 2148481, 2173601, 2173633, 2173665, 2173697, 2173729, 2148801, 2173761, 2143969, 2173793, 2173825, 2153473, 2173857, 2173889]),
        new Uint32Array([6291456, 2186977, 6291456, 6291456, 6291456, 6291456, 6291456, 10537858, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2209601, 2209633, 2209665, 2209697, 2209729, 2209761, 2209793, 2209825, 2209857, 2209889, 2209921, 2209953, 2209985, 2210017, 2210049, 2210081]),
        new Uint32Array([10501539, 10501635, 10501731, 10501827, 10501923, 10502019, 2098209, 2111137, 2105505, 2098241, 2108353, 2108417, 2105825, 2111713, 2100897, 2111905]),
        new Uint32Array([2173697, 2173729, 2148801, 2173761, 2143969, 2173793, 2173825, 2153473, 2173857, 2173889, 2173921, 2173953, 2173985, 2174017, 2174017, 2174049]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 0, 0]),
        new Uint32Array([6291456, 6291456, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2194561, 2194593, 2194625, 2119777, 2119873, 2194657, 2194689, 2194721, 2194753, 2194785, 2194817, 2194849, 2194881, 2194913, 2194945, 2194977]),
        new Uint32Array([2113153, 2108481, 2113345, 2113441, 2098209, 2111137, 2105505, 2098241, 2108353, 2108417, 2105825, 2111713, 2100897, 2111905, 2105473, 2105569]),
        new Uint32Array([2222818, 2222882, 2222946, 2223010, 2223074, 2223138, 2223202, 2223266, 2223330, 2223394, 2223458, 2223522, 2223586, 2223650, 2223714, 2223778]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672]),
        new Uint32Array([0, 2179553, 2179585, 2179617, 2179649, 2144001, 2179681, 2179713, 2179745, 2179777, 2179809, 2156705, 2179841, 2156833, 2179873, 2179905]),
        new Uint32Array([6291456, 23068672, 6291456, 2145602, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 6291456, 0, 0]),
        new Uint32Array([2196513, 2196545, 2196577, 2196609, 2196641, 2196673, 2196705, 2196737, 2196769, 2196801, 2196833, 2196865, 2196897, 2196929, 2196961, 2196993]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2177281, 6291456, 2177313, 6291456, 2177345, 6291456, 2177377, 6291456, 2177409, 6291456, 2177441, 6291456, 2177473, 6291456, 2177505, 6291456]),
        new Uint32Array([2187137, 2221473, 2221505, 2221537, 2221569, 6291456, 6291456, 10610209, 10610241, 10537986, 10537986, 10537986, 10537986, 10609857, 10609857, 10609857]),
        new Uint32Array([2243009, 2243041, 2216033, 2243074, 2243137, 2243169, 2243201, 2219617, 2243233, 2243265, 2243297, 2243329, 2243362, 2243425, 2243457, 2243489]),
        new Uint32Array([10485857, 10485857, 10485857, 10485857, 10485857, 10485857, 10485857, 10485857, 10485857, 10485857, 10485857, 2097152, 4194304, 4194304, 0, 0]),
        new Uint32Array([2143042, 6291456, 2143106, 2143106, 2168833, 6291456, 2168865, 6291456, 6291456, 2168897, 6291456, 2168929, 6291456, 2168961, 6291456, 2143170]),
        new Uint32Array([6291456, 6291456, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2204193, 2204225, 2204257, 2204289, 2204321, 2204353, 2204385, 2204417, 2204449, 2204481, 2204513, 2204545, 2204577, 2204609, 2204641, 2204673]),
        new Uint32Array([2202753, 6291456, 2202785, 6291456, 2202817, 6291456, 2202849, 6291456, 2202881, 6291456, 2202913, 6291456, 2202945, 6291456, 2202977, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2108353, 2108417, 2105825, 2111713, 2100897, 2111905, 2105473, 2105569, 2105601, 2112289, 2108193, 2112481, 2112577, 2098177, 2098305, 2108321]),
        new Uint32Array([2147394, 2147458, 2147522, 2147586, 2147650, 2147714, 2147778, 2147842, 2147394, 2147458, 2147522, 2147586, 2147650, 2147714, 2147778, 2147842]),
        new Uint32Array([2253313, 2253346, 2253409, 2253441, 2253473, 2253505, 2253537, 2253569, 2253601, 2253634, 2219393, 2253697, 2253729, 2253761, 2253793, 2253825]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456]),
        new Uint32Array([2162562, 2162626, 2131362, 2162690, 2159938, 2160002, 2162754, 2162818, 2160130, 2162882, 2160194, 2160258, 2160834, 2160898, 2161026, 2161090]),
        new Uint32Array([2175361, 2175393, 2175425, 2175457, 2175489, 2175521, 2175553, 2175585, 2175617, 2175649, 2175681, 2175713, 2175745, 2175777, 2175809, 2175841]),
        new Uint32Array([2253858, 2253921, 2253954, 2254018, 2254082, 2196737, 2254145, 2196865, 2254177, 2254209, 2254241, 2254273, 2197025, 2254306, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2202113, 2204129, 2188705, 2204161]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 0, 0]),
        new Uint32Array([2173985, 2174017, 2174017, 2174049, 2174081, 2174113, 2174145, 2174177, 2149057, 2233089, 2173697, 2173761, 2173793, 2174113, 2173985, 2173953]),
        new Uint32Array([2101569, 2101697, 2101825, 2101953, 2102081, 2102209, 2100833, 2100737, 2098337, 2101441, 2101569, 2101697, 2101825, 2101953, 2102081, 2102209]),
        new Uint32Array([2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 2098209, 2111137, 2105505, 2098241, 0, 2108417, 0, 2111713, 2100897, 2111905]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2175425, 2175489, 2175809, 2175905, 2175937, 2175937, 2176193, 2176417, 2180865, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 2143298, 2143298, 2143298, 2143362, 2143362, 2143362, 2143426, 2143426, 2143426, 2171105, 6291456, 2171137]),
        new Uint32Array([2120162, 2120258, 2151618, 2151682, 2151746, 2151810, 2151874, 2151938, 2152002, 2120035, 2120131, 2120227, 2152066, 2120323, 2152130, 2120419]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2195361, 2142433, 2236065, 2236097, 2236129, 2236161, 2118241, 2117473, 2236193, 2236225, 2236257, 2236289, 0, 0, 0, 0]),
        new Uint32Array([2189281, 6291456, 2189313, 6291456, 2189345, 6291456, 2189377, 6291456, 2189409, 6291456, 2189441, 6291456, 2189473, 6291456, 2189505, 6291456]),
        new Uint32Array([6291456, 6291456, 2145922, 6291456, 6291456, 6291456, 6291456, 2145986, 6291456, 6291456, 6291456, 6291456, 2146050, 6291456, 6291456, 6291456]),
        new Uint32Array([2100833, 2100737, 2098337, 2101441, 2101569, 2101697, 2101825, 2101953, 2102081, 2102209, 10502113, 10562017, 10610401, 10502177, 10610433, 10538049]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 2186401, 0, 2186433, 0, 2186465, 0, 2186497]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 23068672, 23068672, 23068672]),
        new Uint32Array([0, 0, 2198241, 2198273, 2198305, 2198337, 2198369, 2198401, 0, 0, 2198433, 2198465, 2198497, 0, 0, 0]),
        new Uint32Array([6291456, 0, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 0, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 23068672, 6291456, 23068672, 23068672]),
        new Uint32Array([0, 2105921, 2097729, 0, 2097377, 0, 0, 2106017, 2133281, 2097505, 2105889, 0, 2097697, 2135777, 2097633, 2097441]),
        new Uint32Array([2197889, 2197921, 2197953, 2197985, 2198017, 2198049, 2198081, 2198113, 2198145, 2198177, 2198209, 2198241, 2198273, 2198305, 2198337, 2198369]),
        new Uint32Array([2132514, 2132610, 2160386, 2133090, 2133186, 2160450, 2160514, 2133282, 2160578, 2133570, 2106178, 2160642, 2133858, 2160706, 2160770, 2134146]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 23068672, 23068672, 6291456, 23068672, 23068672, 6291456, 23068672, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2184737, 6291456, 2184769, 6291456, 2184801, 6291456, 2184833, 6291456, 2184865, 6291456, 2184897, 6291456, 2184929, 6291456, 2184961, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 0, 6291456]),
        new Uint32Array([6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 6291456, 23068672, 23068672, 23068672, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 2186753, 6291456, 6291456, 6291456, 6291456, 2186785, 2186817, 2186849, 2173569, 2186881, 10496355, 10495395, 10575521]),
        new Uint32Array([0, 0, 2097729, 0, 0, 0, 0, 2106017, 0, 2097505, 0, 2097185, 0, 2135777, 2097633, 2097441]),
        new Uint32Array([2189537, 6291456, 2189569, 6291456, 2189601, 6291456, 2189633, 6291456, 2189665, 6291456, 2189697, 6291456, 2189729, 6291456, 2189761, 6291456]),
        new Uint32Array([2202497, 6291456, 2202529, 6291456, 2202561, 6291456, 2202593, 6291456, 2202625, 6291456, 2202657, 6291456, 2202689, 6291456, 2202721, 6291456]),
        new Uint32Array([2245217, 2218369, 2245249, 2245282, 2245345, 2245377, 2245410, 2245474, 2245537, 2245569, 2245601, 2245633, 2245665, 2245665, 2245697, 2245729]),
        new Uint32Array([6291456, 0, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 0, 0, 0, 0, 0, 0, 23068672, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 6291456, 23068672, 6291456, 23068672, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672]),
        new Uint32Array([0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2097281, 2105921, 2097729, 2106081, 2097377, 2097601, 2162337, 2106017, 2133281, 2097505, 0, 2097185, 2097697, 2135777, 2097633, 2097441]),
        new Uint32Array([2176641, 6291456, 2176673, 6291456, 2176705, 6291456, 2176737, 6291456, 2176769, 6291456, 2176801, 6291456, 2176833, 6291456, 2176865, 6291456]),
        new Uint32Array([2174145, 2174177, 2149057, 2233089, 2173697, 2173761, 2173793, 2174113, 2173985, 2173953, 2174369, 2174369, 0, 0, 2100833, 2100737]),
        new Uint32Array([2116513, 2190817, 2190849, 2190881, 2190913, 2190945, 2116609, 2190977, 2191009, 2191041, 2191073, 2117185, 2191105, 2191137, 2191169, 2191201]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456]),
        new Uint32Array([0, 0, 0, 0, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456]),
        new Uint32Array([2167617, 2167649, 2167681, 2167713, 2167745, 2167777, 2167809, 6291456, 2167841, 2167873, 2167905, 2167937, 2167969, 2168001, 2168033, 4240130]),
        new Uint32Array([2165122, 2163970, 2164034, 2164098, 2164162, 2164226, 2164290, 2164354, 2164418, 2164482, 2164546, 2133122, 2134562, 2132162, 2132834, 2136866]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 2186209, 2186241, 2186273, 2186305, 2186337, 2186369, 0, 0]),
        new Uint32Array([2112481, 2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 14680064, 14680064, 14680064, 14680064, 14680064]),
        new Uint32Array([0, 0, 23068672, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 6291456, 6291456]),
        new Uint32Array([0, 10537921, 10610689, 10610273, 10610497, 10610529, 10610305, 10610721, 10489601, 10489697, 10610337, 10575617, 10554529, 2221761, 2197217, 10496577]),
        new Uint32Array([2105473, 2105569, 2105601, 2112289, 0, 2112481, 2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441]),
        new Uint32Array([2100897, 2111905, 2105473, 2105569, 2105601, 2112289, 2108193, 2112481, 2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481]),
        new Uint32Array([2125346, 2153410, 2153474, 2127394, 2153538, 2153602, 2153666, 2153730, 2105507, 2105476, 2153794, 2153858, 2153922, 2153986, 2154050, 2105794]),
        new Uint32Array([2200449, 2119681, 2200481, 2153313, 2199873, 2199905, 2199937, 2200513, 2200545, 2200577, 2200609, 2119105, 2119201, 2119297, 2119393, 2119489]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2175777, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2222273, 2197217, 2221473, 2221505, 2221089, 2222305, 2200865, 2099681, 2104481, 2222337, 2099905, 2120737, 2222369, 2103713, 2100225, 2098785]),
        new Uint32Array([2201377, 6291456, 2201409, 6291456, 2201441, 6291456, 2201473, 6291456, 2201505, 6291456, 2201537, 6291456, 2201569, 6291456, 6291456, 23068672]),
        new Uint32Array([2174081, 2174113, 2174145, 2174177, 2149057, 2233057, 2148481, 2173601, 2173633, 2173665, 2173697, 2173729, 2148801, 2173761, 2143969, 2173793]),
        new Uint32Array([2200897, 6291456, 2200929, 6291456, 2200961, 6291456, 2200993, 6291456, 2201025, 6291456, 2180865, 6291456, 2201057, 6291456, 2201089, 6291456]),
        new Uint32Array([0, 0, 0, 0, 0, 23068672, 23068672, 0, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0]),
        new Uint32Array([2161154, 2161410, 2138658, 2161474, 2161538, 2097666, 2097186, 2097474, 2162946, 2132450, 2163010, 2163074, 2136162, 2163138, 2161666, 2161730]),
        new Uint32Array([2148481, 2173601, 2173633, 2173665, 2173697, 2173729, 2148801, 2173761, 2143969, 2173793, 2173825, 2153473, 2173857, 2173889, 2173921, 2173953]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 23068672, 23068672, 0, 0, 0, 0, 2145410, 2145474, 0, 6291456]),
        new Uint32Array([2244161, 2216065, 2212769, 2244193, 2244225, 2244257, 2244290, 2244353, 2244385, 2244417, 2244449, 2218273, 2244481, 2244514, 2244577, 2244609]),
        new Uint32Array([2125730, 2125699, 2125795, 2125891, 2125987, 2154114, 2154178, 2154242, 2154306, 2154370, 2154434, 2154498, 2126082, 2126178, 2126274, 2126083]),
        new Uint32Array([2237665, 2237697, 2237697, 2237697, 2237730, 2237793, 2237825, 2237857, 2237890, 2237953, 2237985, 2238017, 2238049, 2238081, 2238113, 2238145]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2150146, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 23068672, 23068672, 0, 0, 23068672, 23068672, 23068672, 0, 0]),
        new Uint32Array([2214369, 2238593, 2238625, 2238657, 2238689, 2238721, 2238753, 2238785, 2238817, 2238850, 2238913, 2238945, 2238977, 2235457, 2239009, 2239041]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0]),
        new Uint32Array([2252066, 2252130, 2252193, 2252225, 2252257, 2252290, 2252353, 2252385, 2252417, 2252449, 2252481, 2252513, 2252545, 2252578, 2252641, 2252673]),
        new Uint32Array([2197697, 2114113, 2114209, 2197729, 2197761, 2114305, 2197793, 2114401, 2114497, 2197825, 2114593, 2114689, 2114785, 2114881, 2114977, 2197857]),
        new Uint32Array([2224866, 2224930, 2224994, 2225058, 2225122, 2225186, 2225250, 2225314, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2219490, 2219554, 2219617, 2219649, 2219681, 2219714, 2219778, 2219842, 2219905, 2219937, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 23068672, 23068672, 23068672, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456]),
        new Uint32Array([2113345, 2113441, 2098209, 2111137, 2105505, 2098241, 2108353, 2108417, 2105825, 2111713, 2100897, 2111905, 2105473, 2105569, 2105601, 2112289]),
        new Uint32Array([2174081, 2174113, 2174145, 2174177, 2149057, 2233089, 2173697, 2173761, 2173793, 2174113, 2173985, 2173953, 2148481, 2173601, 2173633, 2173665]),
        new Uint32Array([2220161, 2220161, 2220193, 2220193, 2220193, 2220193, 2220225, 2220225, 2220225, 2220225, 2220257, 2220257, 2220257, 2220257, 2220289, 2220289]),
        new Uint32Array([2192673, 2192705, 2192737, 2192769, 2192801, 2192833, 2192865, 2118049, 2192897, 2117473, 2117761, 2192929, 2192961, 2192993, 2193025, 2193057]),
        new Uint32Array([2179297, 6291456, 2179329, 6291456, 2179361, 6291456, 2179393, 6291456, 2179425, 6291456, 2179457, 6291456, 2179489, 6291456, 2179521, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 23068672, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2235745, 2235777, 2193633, 2235809, 2235841, 2235873, 2235905, 2235937, 2235969, 2116513, 2116705, 2236001, 2200513, 2199905, 2200545, 2236033]),
        new Uint32Array([2113153, 2108481, 2113345, 2113441, 2232993, 2233025, 0, 0, 2148481, 2173601, 2173633, 2173665, 2173697, 2173729, 2148801, 2173761]),
        new Uint32Array([2170593, 6291456, 2170625, 6291456, 2170657, 6291456, 2170689, 2170721, 6291456, 2170753, 6291456, 6291456, 2170785, 6291456, 2170817, 2170849]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2166786, 2166850, 0, 0, 0, 0]),
        new Uint32Array([23068672, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456]),
        new Uint32Array([2100833, 2100737, 2098337, 2101441, 2101569, 2101697, 2101825, 2101953, 2102081, 2102209, 10575617, 2187041, 10502177, 10489601, 10489697, 0]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2134562, 2132162, 2132834, 2136866, 2136482, 2164610, 2164674, 2164738, 2164802, 2132802, 2132706, 2164866, 2132898, 2164930, 2164994, 2165058]),
        new Uint32Array([6291456, 6291456, 2098337, 2101441, 10531458, 2153473, 6291456, 6291456, 10531522, 2100737, 2108193, 6291456, 2106499, 2106595, 2106691, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2233122, 2233186, 2233250, 2233314, 2233378, 2233442, 2233506, 2233570, 2233634, 2233698, 2233762, 2233826, 2233890, 2233954, 2234018, 2234082]),
        new Uint32Array([23068672, 6291456, 23068672, 23068672, 23068672, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2205217, 2205249, 2205281, 2205313, 2205345, 2205377, 2205409, 2205441, 2205473, 2205505, 2205537, 2205569, 2205601, 2205633, 2205665, 2205697]),
        new Uint32Array([6291456, 0, 6291456, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 0, 0, 23068672, 6291456, 23068672, 23068672]),
        new Uint32Array([2173601, 2173761, 2174081, 2173569, 2174241, 2174113, 2173953, 6291456, 2174305, 6291456, 2174337, 6291456, 2174369, 6291456, 2174401, 6291456]),
        new Uint32Array([6291456, 23068672, 23068672, 23068672, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456]),
        new Uint32Array([2152450, 2152514, 2099653, 2104452, 2099813, 2122243, 2099973, 2152578, 2122339, 2122435, 2122531, 2122627, 2122723, 2104580, 2122819, 2152642]),
        new Uint32Array([2236385, 2236417, 2236449, 2236482, 2236545, 2215425, 2236577, 2236609, 2236641, 2236673, 2215457, 2236705, 2236737, 2236770, 2215489, 2236833]),
        new Uint32Array([2163394, 2159746, 2163458, 2131362, 2163522, 2160130, 2163778, 2132226, 2163842, 2132898, 2163906, 2161410, 2138658, 2097666, 2136162, 2163650]),
        new Uint32Array([2218721, 2246913, 2246946, 2216385, 2247010, 2247074, 2215009, 2247137, 2247169, 2216481, 2247201, 2247233, 2247266, 2247330, 2247330, 0]),
        new Uint32Array([2129730, 2129762, 2129858, 2129731, 2129827, 2156482, 2156482, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 0, 0, 0, 0, 0, 6291456, 0, 0]),
        new Uint32Array([2203969, 2204001, 2181377, 2204033, 2204065, 6291456, 2204097, 6291456, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2169473, 6291456, 2169505, 6291456, 2169537, 6291456, 2169569, 6291456, 2169601, 6291456, 2169633, 6291456, 2169665, 6291456, 2169697, 6291456]),
        new Uint32Array([2141542, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2220801, 2220801, 2220801, 2220801, 2220833, 2220833, 2220865, 2220865, 2220865, 2220865, 2220897, 2220897, 2220897, 2220897, 2139873, 2139873]),
        new Uint32Array([0, 0, 0, 0, 0, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 6291456, 0]),
        new Uint32Array([2214849, 2218433, 2218465, 2218497, 2218529, 2218561, 2214881, 2218593, 2218625, 2218657, 2218689, 2218721, 2218753, 2216545, 2218785, 2218817]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6291456]),
        new Uint32Array([2136482, 2164610, 2164674, 2164738, 2164802, 2132802, 2132706, 2164866, 2132898, 2164930, 2164994, 2165058, 2165122, 2132802, 2132706, 2164866]),
        new Uint32Array([2207649, 2207681, 2207713, 2207745, 2207777, 2207809, 2207841, 2207873, 2207905, 2207937, 2207969, 2208001, 2208033, 2208065, 2208097, 2208129]),
        new Uint32Array([2123683, 2105092, 2152706, 2123779, 2105220, 2152770, 2100453, 2098755, 2123906, 2124002, 2124098, 2124194, 2124290, 2124386, 2124482, 2124578]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 0, 0, 0, 6291456, 0, 0, 0, 0, 0, 0, 0, 10485857]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([10508163, 10508259, 10508355, 10508451, 2200129, 2200161, 2192737, 2200193, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2203553, 6291456, 2203585, 6291456, 6291456, 6291456, 2203617, 6291456, 2203649, 6291456, 2203681, 6291456, 2203713, 6291456, 2203745, 6291456]),
        new Uint32Array([18884449, 18884065, 23068672, 18884417, 18884034, 18921185, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 18874368]),
        new Uint32Array([2247393, 2247426, 2247489, 2247521, 2247553, 2247586, 2247649, 2247681, 2247713, 2247745, 2247777, 2247810, 2247873, 2247905, 2247937, 2247969]),
        new Uint32Array([6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 23068672]),
        new Uint32Array([2134145, 2097153, 2134241, 0, 2132705, 2130977, 2160065, 2131297, 0, 2133089, 2160577, 2133857, 2235297, 0, 2235329, 0]),
        new Uint32Array([2182593, 6291456, 2182625, 6291456, 2182657, 6291456, 2182689, 6291456, 2182721, 6291456, 2182753, 6291456, 2182785, 6291456, 2182817, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2102402, 2102403, 6291456, 2110050]),
        new Uint32Array([2149890, 2108323, 2149954, 6291456, 2113441, 6291456, 2149057, 6291456, 2113441, 6291456, 2105473, 2167265, 2111137, 2105505, 6291456, 2108353]),
        new Uint32Array([2219105, 2219137, 2195233, 2251554, 2251617, 2251649, 2251681, 2251713, 2251746, 2251810, 2251873, 2251905, 2251937, 2251970, 2252033, 2219169]),
        new Uint32Array([2203009, 6291456, 2203041, 6291456, 2203073, 6291456, 2203105, 6291456, 2203137, 6291456, 2203169, 6291456, 2203201, 6291456, 2203233, 6291456]),
        new Uint32Array([2128195, 2128291, 2128387, 2128483, 2128579, 2128675, 2128771, 2128867, 2128963, 2129059, 2129155, 2129251, 2129347, 2129443, 2129539, 2129635]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2140964, 2141156, 2140966, 2141158, 2141350]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2225378, 2225442, 2225506, 2225570, 2225634, 2225698, 2225762, 2225826, 2225890, 2225954, 2226018, 2226082, 2226146, 2226210, 2226274, 2226338]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 2098209, 2111137, 2105505, 2098241, 2108353, 2108417]),
        new Uint32Array([2108353, 2108417, 0, 2105601, 2108193, 2157121, 2157313, 2157377, 2157441, 2100897, 6291456, 2108419, 2173953, 2173633, 2173633, 2173953]),
        new Uint32Array([2111713, 2173121, 2111905, 2098177, 2173153, 2173185, 2173217, 2113153, 2113345, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 2190753]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2197249, 6291456, 2117377, 2197281, 2197313, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 0, 0, 0, 0, 0, 0, 23068672, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456]),
        new Uint32Array([2098337, 2101441, 2101569, 2101697, 2101825, 2101953, 2102081, 2102209, 2100833, 2100737, 2098337, 2101441, 2101569, 2101697, 2101825, 2101953]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0]),
        new Uint32Array([0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 23068672, 23068672, 23068672]),
        new Uint32Array([2173281, 6291456, 2173313, 6291456, 2173345, 6291456, 2173377, 6291456, 0, 0, 10532546, 6291456, 6291456, 6291456, 10562017, 2173441]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 0, 0]),
        new Uint32Array([23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2159426, 2159490, 2159554, 2159362, 2159618, 2159682, 2139522, 2136450, 2159746, 2159810, 2159874, 2130978, 2131074, 2131266, 2131362, 2159938]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2203233, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2203265, 6291456, 2203297, 6291456, 2203329, 2203361, 6291456]),
        new Uint32Array([6291456, 6291456, 2148418, 2148482, 2148546, 0, 6291456, 2148610, 2186529, 2186561, 2148417, 2148545, 2148482, 10495778, 2143969, 10495778]),
        new Uint32Array([2134146, 2139426, 2160962, 2134242, 2161218, 2161282, 2161346, 2161410, 2138658, 2134722, 2134434, 2134818, 2097666, 2097346, 2097698, 2105986]),
        new Uint32Array([2198881, 2198913, 2198945, 2198977, 2199009, 2199041, 2199073, 2199105, 2199137, 2199169, 2199201, 2199233, 2199265, 2199297, 2199329, 2199361]),
        new Uint32Array([0, 23068672, 23068672, 23068672, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456]),
        new Uint32Array([10610561, 2098209, 2111137, 2105505, 2098241, 2108353, 2108417, 2105825, 2111713, 2100897, 2111905, 2105473, 2105569, 2105601, 2112289, 2108193]),
        new Uint32Array([2183873, 6291456, 2183905, 6291456, 2183937, 6291456, 2183969, 6291456, 2184001, 6291456, 2184033, 6291456, 2184065, 6291456, 2184097, 6291456]),
        new Uint32Array([2244642, 2244706, 2244769, 2244801, 2218305, 2244833, 2244865, 2244897, 2244929, 2244961, 2244993, 2245026, 2245089, 2245122, 2245185, 0]),
        new Uint32Array([6291456, 6291456, 2116513, 2116609, 2116705, 2116801, 2199873, 2199905, 2199937, 2199969, 2190913, 2200001, 2200033, 2200065, 2200097, 2191009]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 2180673, 2180705, 2180737, 2180769, 2180801, 2180833, 0, 0]),
        new Uint32Array([2098081, 2099521, 2099105, 2120705, 2098369, 2120801, 2103361, 2097985, 2098433, 2121377, 2121473, 2099169, 2099873, 2098401, 2099393, 2152609]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2150402]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 2145666, 2145730, 6291456, 6291456]),
        new Uint32Array([2173921, 2173953, 2173985, 2173761, 2174017, 2174049, 2174081, 2174113, 2174145, 2174177, 2149057, 2233057, 2148481, 2173601, 2173633, 2173665]),
        new Uint32Array([2187073, 6291456, 6291456, 6291456, 6291456, 2098241, 2098241, 2108353, 2100897, 2111905, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2102404, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2100612, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 10485857]),
        new Uint32Array([2149057, 2233057, 2148481, 2173601, 2173633, 2173665, 2173697, 2173729, 2148801, 2173761, 2143969, 2173793, 2173825, 2153473, 2173857, 2173889]),
        new Uint32Array([2217697, 2217729, 2217761, 2217793, 2217825, 2217857, 2217889, 2217921, 2217953, 2215873, 2217985, 2215905, 2218017, 2218049, 2218081, 2218113]),
        new Uint32Array([2211233, 2218849, 2216673, 2218881, 2218913, 2218945, 2218977, 2219009, 2216833, 2219041, 2215137, 2219073, 2216865, 2209505, 2219105, 2216897]),
        new Uint32Array([2240097, 2240129, 2240161, 2240193, 2240225, 2240257, 2240289, 2240321, 2240353, 2240386, 2240449, 2240481, 2240513, 2240545, 2207905, 2240578]),
        new Uint32Array([6291456, 6291456, 2202273, 6291456, 2202305, 6291456, 2202337, 6291456, 2202369, 6291456, 2202401, 6291456, 2202433, 6291456, 2202465, 6291456]),
        new Uint32Array([0, 23068672, 23068672, 18923394, 23068672, 18923458, 18923522, 18884099, 18923586, 18884195, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2201121, 6291456, 2201153, 6291456, 2201185, 6291456, 2201217, 6291456, 2201249, 6291456, 2201281, 6291456, 2201313, 6291456, 2201345, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 6291456, 6291456]),
        new Uint32Array([2211041, 2211073, 2211105, 2211137, 2211169, 2211201, 2211233, 2211265, 2211297, 2211329, 2211361, 2211393, 2211425, 2211457, 2211489, 2211521]),
        new Uint32Array([2181825, 6291456, 2181857, 6291456, 2181889, 6291456, 2181921, 6291456, 2181953, 6291456, 2181985, 6291456, 2182017, 6291456, 2182049, 6291456]),
        new Uint32Array([2162337, 2097633, 2097633, 2097633, 2097633, 2132705, 2132705, 2132705, 2132705, 2097153, 2097153, 2097153, 2097153, 2133089, 2133089, 2133089]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 2148545, 6291456, 2173473, 6291456, 2148865, 6291456, 2173505, 6291456, 2173537, 6291456, 2173569, 6291456, 2149121, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 0, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0]),
        new Uint32Array([2148801, 2173761, 2143969, 2173793, 2173825, 2153473, 2173857, 2173889, 2173921, 2173953, 2173985, 2174017, 2174017, 2174049, 2174081, 2174113]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2207137, 2207169, 2207201, 2207233, 2207265, 2207297, 2207329, 2207361, 2207393, 2207425, 2207457, 2207489, 2207521, 2207553, 2207585, 2207617]),
        new Uint32Array([6291456, 6291456, 23068672, 23068672, 23068672, 6291456, 6291456, 0, 23068672, 23068672, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2198401, 2198433, 2198465, 2198497, 0, 2198529, 2198561, 2198593, 2198625, 2198657, 2198689, 2198721, 2198753, 2198785, 2198817, 2198849]),
        new Uint32Array([2105505, 2098241, 2108353, 2108417, 2105825, 2111713, 2100897, 2111905, 2105473, 2105569, 2105601, 2112289, 2108193, 2112481, 2112577, 2098177]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 0, 0]),
        new Uint32Array([2216385, 2118721, 2216417, 2216449, 2216481, 2216513, 2216545, 2211233, 2216577, 2216609, 2216641, 2216673, 2216705, 2216737, 2216737, 2216769]),
        new Uint32Array([2216801, 2216833, 2216865, 2216897, 2216929, 2216961, 2216993, 2215169, 2217025, 2217057, 2217089, 2217121, 2217154, 2217217, 0, 0]),
        new Uint32Array([2210593, 2191809, 2210625, 2210657, 2210689, 2210721, 2210753, 2210785, 2210817, 2210849, 2191297, 2210881, 2210913, 2210945, 2210977, 2211009]),
        new Uint32Array([0, 0, 2105825, 0, 0, 2111905, 2105473, 0, 0, 2112289, 2108193, 2112481, 2112577, 0, 2098305, 2108321]),
        new Uint32Array([0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([0, 2097153, 2134241, 0, 2132705, 0, 0, 2131297, 0, 2133089, 0, 2133857, 0, 2220769, 0, 2235361]),
        new Uint32Array([14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 6291456, 6291456, 14680064]),
        new Uint32Array([23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2171873, 6291456, 2171905, 6291456, 2171937, 6291456, 2171969, 6291456, 2172001, 6291456, 2172033, 6291456, 2172065, 6291456, 2172097, 6291456]),
        new Uint32Array([2220929, 2220929, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2133857, 2134145, 2134145, 2134145, 2134145, 2134241, 2134241, 2134241, 2134241, 2105889, 2105889, 2105889, 2105889, 2097185, 2097185, 2097185]),
        new Uint32Array([2173697, 2173761, 2173793, 2174113, 2173985, 2173953, 2148481, 2173601, 2173633, 2173665, 2173697, 2173729, 2148801, 2173761, 2143969, 2173793]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10499619, 10499715, 10499811, 10499907]),
        new Uint32Array([0, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 0, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 23068672, 0, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 6291456, 23068672, 23068672]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 2144322, 2144386, 2144450, 2144514, 2144578, 2144642, 2144706, 2144770]),
        new Uint32Array([23068672, 23068672, 23068672, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2113153, 2108481, 2113345, 2113441, 2098209, 2111137, 0, 2098241, 2108353, 2108417, 2105825, 0, 0, 2111905, 2105473, 2105569]),
        new Uint32Array([2236321, 2236353, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2152194, 2121283, 2103684, 2103812, 2097986, 2098533, 2097990, 2098693, 2098595, 2098853, 2099013, 2103940, 2121379, 2121475, 2121571, 2104068]),
        new Uint32Array([2206241, 2206273, 2206305, 2206337, 2206369, 2206401, 2206433, 2206465, 2206497, 2206529, 2206561, 2206593, 2206625, 2206657, 2206689, 2206721]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 16777216, 16777216, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 23068672, 23068672, 10538818, 10538882, 6291456, 6291456, 2150338]),
        new Uint32Array([6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2214369, 2214401, 2214433, 2214465, 2214497, 2214529, 2214561, 2214593, 2194977, 2214625, 2195073, 2214657, 2214689, 2214721, 6291456, 6291456]),
        new Uint32Array([2097152, 2097152, 2097152, 2097152, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2182081, 6291456, 2182113, 6291456, 2182145, 6291456, 2182177, 6291456, 2182209, 6291456, 2182241, 6291456, 2182273, 6291456, 2182305, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2146881, 2146945, 2147009, 2147073, 2147137, 2147201, 2147265, 2147329]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456, 23068672, 23068672]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2122915, 2123011, 2123107, 2104708, 2123203, 2123299, 2123395, 2100133, 2104836, 2100290, 2100293, 2104962, 2104964, 2098052, 2123491, 2123587]),
        new Uint32Array([23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456]),
        new Uint32Array([6291456, 2171169, 6291456, 2171201, 6291456, 2171233, 6291456, 2171265, 6291456, 2171297, 6291456, 2171329, 6291456, 6291456, 2171361, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([0, 0, 2148994, 2149058, 2149122, 0, 6291456, 2149186, 2186945, 2173537, 2148993, 2149121, 2149058, 10531458, 10496066, 0]),
        new Uint32Array([2195009, 2195041, 2195073, 2195105, 2195137, 2195169, 2195201, 2195233, 2195265, 2195297, 2195329, 2195361, 2195393, 2195425, 2195457, 2195489]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 0, 0, 6291456, 6291456]),
        new Uint32Array([2182849, 6291456, 2182881, 6291456, 2182913, 6291456, 2182945, 6291456, 2182977, 6291456, 2183009, 6291456, 2183041, 6291456, 2183073, 6291456]),
        new Uint32Array([2211553, 2210081, 2211585, 2211617, 2211649, 2211681, 2211713, 2211745, 2211777, 2211809, 2209569, 2211841, 2211873, 2211905, 2211937, 2211969]),
        new Uint32Array([2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 2166594, 2127298, 2166658, 2142978, 2141827, 2166722]),
        new Uint32Array([2173985, 2173761, 2174017, 2174049, 2174081, 2174113, 2174145, 2174177, 2149057, 2233057, 2148481, 2173601, 2173633, 2173665, 2173697, 2173729]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 2185761, 2185793, 2185825, 2185857, 2185889, 2185921, 0, 0]),
        new Uint32Array([6291456, 2148481, 2173601, 2173633, 2173665, 2173697, 2173729, 2148801, 2173761, 2143969, 2173793, 2173825, 2153473, 2173857, 2173889, 2173921]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 6291456]),
        new Uint32Array([0, 0, 0, 2220961, 2220961, 2220961, 2220961, 2144193, 2144193, 2159201, 2159201, 2159265, 2159265, 2144194, 2220993, 2220993]),
        new Uint32Array([2192641, 2235393, 2235425, 2152257, 2116609, 2235457, 2235489, 2200065, 2235521, 2235553, 2235585, 2212449, 2235617, 2235649, 2235681, 2235713]),
        new Uint32Array([2194049, 2194081, 2194113, 2194145, 2194177, 2194209, 2194241, 2194273, 2194305, 2194337, 2194369, 2194401, 2194433, 2194465, 2194497, 2194529]),
        new Uint32Array([2196673, 2208641, 2208673, 2208705, 2208737, 2208769, 2208801, 2208833, 2208865, 2208897, 2208929, 2208961, 2208993, 2209025, 2209057, 2209089]),
        new Uint32Array([2191681, 2191713, 2191745, 2191777, 2153281, 2191809, 2191841, 2191873, 2191905, 2191937, 2191969, 2192001, 2192033, 2192065, 2192097, 2192129]),
        new Uint32Array([2230946, 2231010, 2231074, 2231138, 2231202, 2231266, 2231330, 2231394, 2231458, 2231522, 2231586, 2231650, 2231714, 2231778, 2231842, 2231906]),
        new Uint32Array([14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064, 14680064]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 2185953, 2185985, 2186017, 2186049, 2186081, 2186113, 2186145, 2186177]),
        new Uint32Array([2139811, 2139907, 2097284, 2105860, 2105988, 2106116, 2106244, 2097444, 2097604, 2097155, 10485778, 10486344, 2106372, 6291456, 0, 0]),
        new Uint32Array([2110051, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2172385, 6291456, 2172417, 6291456, 2172449, 6291456, 2172481, 6291456, 2172513, 6291456, 2172545, 6291456, 2172577, 6291456, 2172609, 6291456]),
        new Uint32Array([0, 0, 23068672, 23068672, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2249345, 2249377, 2249409, 2249441, 2249473, 2249505, 2249537, 2249570, 2210209, 2249633, 2249665, 2249697, 2249729, 2249761, 2249793, 2216769]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2187169, 2187201, 2187233, 2187265, 2187297, 2187329, 2187361, 2187393, 2187425, 2187457, 2187489, 2187521, 2187553, 2187585, 2187617, 2187649]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([0, 0, 0, 6291456, 6291456, 0, 0, 0, 6291456, 6291456, 6291456, 0, 0, 0, 6291456, 6291456]),
        new Uint32Array([2182337, 6291456, 2182369, 6291456, 2182401, 6291456, 2182433, 6291456, 2182465, 6291456, 2182497, 6291456, 2182529, 6291456, 2182561, 6291456]),
        new Uint32Array([2138179, 2138275, 2138371, 2138467, 2134243, 2134435, 2138563, 2138659, 2138755, 2138851, 2138947, 2139043, 2138947, 2138755, 2139139, 2139235]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([0, 0, 23068672, 23068672, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2250498, 2250562, 2250625, 2250657, 2208321, 2250689, 2250721, 2250753, 2250785, 2250817, 2250849, 2218945, 2250881, 2250913, 2250945, 0]),
        new Uint32Array([2170369, 2105569, 2098305, 2108481, 2173249, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456]),
        new Uint32Array([2100897, 2111905, 2105473, 2105569, 2105601, 0, 2108193, 0, 0, 0, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481]),
        new Uint32Array([2100897, 2100897, 2105569, 2105569, 6291456, 2112289, 2149826, 6291456, 6291456, 2112481, 2112577, 2098177, 2098177, 2098177, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 2169953, 2169985, 6291456, 2170017, 6291456, 2170049, 2170081, 6291456, 2170113, 2170145, 2170177, 6291456, 6291456, 2170209, 2170241]),
        new Uint32Array([6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2220641, 2220641, 2220673, 2220673, 2220673, 2220673, 2220705, 2220705, 2220705, 2220705, 2220737, 2220737, 2220737, 2220737, 2220769, 2220769]),
        new Uint32Array([2127650, 2127746, 2127842, 2127938, 2128034, 2128130, 2128226, 2128322, 2128418, 2127523, 2127619, 2127715, 2127811, 2127907, 2128003, 2128099]),
        new Uint32Array([2143969, 2173793, 2173825, 2153473, 2173857, 2173889, 2173921, 2173953, 2173985, 2173761, 2174017, 2174049, 2174081, 2174113, 2174145, 2174177]),
        new Uint32Array([0, 0, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([2204705, 2204737, 2204769, 2204801, 2204833, 2204865, 2204897, 2204929, 2204961, 2204993, 2205025, 2205057, 2205089, 2205121, 2205153, 2205185]),
        new Uint32Array([2176385, 6291456, 2176417, 6291456, 2176449, 6291456, 2176481, 6291456, 2176513, 6291456, 2176545, 6291456, 2176577, 6291456, 2176609, 6291456]),
        new Uint32Array([2195521, 2195553, 2195585, 2195617, 2195649, 2195681, 2117857, 2195713, 2195745, 2195777, 2195809, 2195841, 2195873, 2195905, 2195937, 2195969]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456]),
        new Uint32Array([2173921, 2173953, 2173985, 2174017, 2174017, 2174049, 2174081, 2174113, 2174145, 2174177, 2149057, 2233089, 2173697, 2173761, 2173793, 2174113]),
        new Uint32Array([2131586, 2132450, 2135970, 2135778, 2161602, 2136162, 2163650, 2161794, 2135586, 2163714, 2137186, 2131810, 2160290, 2135170, 2097506, 2159554]),
        new Uint32Array([2134145, 2097153, 2134241, 2105953, 2132705, 2130977, 2160065, 2131297, 2162049, 2133089, 2160577, 2133857, 0, 0, 0, 0]),
        new Uint32Array([2116513, 2116609, 2116705, 2116801, 2116897, 2116993, 2117089, 2117185, 2117281, 2117377, 2117473, 2117569, 2117665, 2117761, 2117857, 2117953]),
        new Uint32Array([2100737, 2098337, 2101441, 2101569, 2101697, 2101825, 2101953, 2102081, 2102209, 2100802, 2101154, 2101282, 2101410, 2101538, 2101666, 2101794]),
        new Uint32Array([2100289, 2098657, 2098049, 2200737, 2123489, 2123681, 2200769, 2098625, 2100321, 2098145, 2100449, 2098017, 2098753, 2098977, 2150241, 2150305]),
        new Uint32Array([6291456, 6291456, 6291456, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 2109955, 6291456, 6291456, 0, 0, 0, 0]),
        new Uint32Array([18874368, 18874368, 18874368, 18874368, 18874368, 18874368, 18874368, 18874368, 18874368, 18874368, 18874368, 18874368, 18874368, 18874368, 18874368, 18874368]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 6291456, 0, 6291456, 0, 0]),
        new Uint32Array([2130979, 2131075, 2131075, 2131171, 2131267, 2131363, 2131459, 2131555, 2131651, 2131651, 2131747, 2131843, 2131939, 2132035, 2132131, 2132227]),
        new Uint32Array([0, 2177793, 6291456, 2177825, 6291456, 2177857, 6291456, 2177889, 6291456, 2177921, 6291456, 2177953, 6291456, 2177985, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672]),
        new Uint32Array([6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2113345, 0, 2098209, 2111137, 2105505, 2098241, 2108353, 2108417, 2105825, 2111713, 2100897, 2111905, 2105473, 2105569, 2105601, 2112289]),
        new Uint32Array([2136643, 2136739, 2136835, 2136931, 2137027, 2137123, 2137219, 2137315, 2137411, 2137507, 2137603, 2137699, 2137795, 2137891, 2137987, 2138083]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0]),
        new Uint32Array([2174433, 6291456, 2174465, 6291456, 2174497, 6291456, 2174529, 6291456, 2174561, 6291456, 2174593, 6291456, 2174625, 6291456, 2174657, 6291456]),
        new Uint32Array([0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2105473, 2105569, 2105601, 2112289, 2108193, 2112481, 2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441]),
        new Uint32Array([10496547, 10496643, 2105505, 2149698, 6291456, 10496739, 10496835, 2170273, 6291456, 2149762, 2105825, 2111713, 2111713, 2111713, 2111713, 2168673]),
        new Uint32Array([6291456, 2143490, 2143490, 2143490, 2171649, 6291456, 2171681, 2171713, 2171745, 6291456, 2171777, 6291456, 2171809, 6291456, 2171841, 6291456]),
        new Uint32Array([2159106, 2159106, 2159170, 2159170, 2159234, 2159234, 2159298, 2159298, 2159298, 2159362, 2159362, 2159362, 2106401, 2106401, 2106401, 2106401]),
        new Uint32Array([2105601, 2112289, 2108193, 2112481, 2112577, 2098177, 2098305, 2108321, 2108289, 2100865, 2113153, 2108481, 2113345, 2113441, 2098209, 2111137]),
        new Uint32Array([2108417, 2181217, 2181249, 2181281, 2170433, 2170401, 2181313, 2181345, 2181377, 2181409, 2181441, 2181473, 2181505, 2181537, 2170529, 2181569]),
        new Uint32Array([2218433, 2245761, 2245793, 2245825, 2245857, 2245890, 2245953, 2245986, 2209665, 2246050, 2246113, 2246146, 2246210, 2246274, 2246337, 2246369]),
        new Uint32Array([2230754, 2230818, 2230882, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([6291456, 0, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 0, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2184129, 6291456, 2184161, 6291456, 2184193, 6291456, 6291456, 6291456, 6291456, 6291456, 2146818, 2183361, 6291456, 6291456, 2142978, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2135170, 2097506, 2130691, 2130787, 2130883, 2163970, 2164034, 2164098, 2164162, 2164226, 2164290, 2164354, 2164418, 2164482, 2164546, 2133122]),
        new Uint32Array([2108515, 2108611, 2100740, 2108707, 2108803, 2108899, 2108995, 2109091, 2109187, 2109283, 2109379, 2109475, 2109571, 2109667, 2109763, 2100738]),
        new Uint32Array([2102788, 2102916, 2103044, 2120515, 2103172, 2120611, 2120707, 2098373, 2103300, 2120803, 2120899, 2120995, 2103428, 2103556, 2121091, 2121187]),
        new Uint32Array([2158082, 2158146, 0, 2158210, 2158274, 0, 2158338, 2158402, 2158466, 2129922, 2158530, 2158594, 2158658, 2158722, 2158786, 2158850]),
        new Uint32Array([10499619, 10499715, 10499811, 10499907, 10500003, 10500099, 10500195, 10500291, 10500387, 10500483, 10500579, 10500675, 10500771, 10500867, 10500963, 10501059]),
        new Uint32Array([2239585, 2239618, 2239681, 2239713, 0, 2191969, 2239745, 2239777, 2192033, 2239809, 2239841, 2239874, 2239937, 2239970, 2240033, 2240065]),
        new Uint32Array([2252705, 2252738, 2252801, 2252833, 2252865, 2252897, 2252930, 2252994, 2253057, 2253089, 2253121, 2253154, 2253217, 2253250, 2219361, 2219361]),
        new Uint32Array([2105825, 2111713, 2100897, 2111905, 2105473, 2105569, 2105601, 2112289, 2108193, 2112481, 2112577, 2098177, 2098305, 2108321, 2108289, 2100865]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 10538050, 10538114, 10538178, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([2226402, 2226466, 2226530, 2226594, 2226658, 2226722, 2226786, 2226850, 2226914, 2226978, 2227042, 2227106, 2227170, 2227234, 2227298, 2227362]),
        new Uint32Array([23068672, 6291456, 6291456, 6291456, 6291456, 2144066, 2144130, 2144194, 2144258, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 23068672, 23068672, 6291456, 23068672, 23068672]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2124674, 2124770, 2123875, 2123971, 2124067, 2124163, 2124259, 2124355, 2124451, 2124547, 2124643, 2124739, 2124835, 2124931, 2125027, 2125123]),
        new Uint32Array([2168065, 6291456, 2168097, 6291456, 2168129, 6291456, 2168161, 6291456, 2168193, 6291456, 2168225, 6291456, 2168257, 6291456, 2168289, 6291456]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0]),
        new Uint32Array([23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 2100610, 2100611, 6291456, 2107842, 2107843, 6291456, 6291456, 6291456, 6291456, 10537922, 6291456, 10537986, 6291456]),
        new Uint32Array([2174849, 2174881, 2174913, 2174945, 2174977, 2175009, 2175041, 2175073, 2175105, 2175137, 2175169, 2175201, 2175233, 2175265, 2175297, 2175329]),
        new Uint32Array([2154562, 2154626, 2154690, 2154754, 2141858, 2154818, 2154882, 2127298, 2154946, 2127298, 2155010, 2155074, 2155138, 2155202, 2155266, 2155202]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 23068672, 0]),
        new Uint32Array([2200641, 2150786, 2150850, 2150914, 2150978, 2151042, 2106562, 2151106, 2150562, 2151170, 2151234, 2151298, 2151362, 2151426, 2151490, 2151554]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 0, 0, 0, 0, 0, 0, 0, 0, 6291456, 6291456]),
        new Uint32Array([2220289, 2220289, 2220321, 2220321, 2220321, 2220321, 2220353, 2220353, 2220353, 2220353, 2220385, 2220385, 2220385, 2220385, 2220417, 2220417]),
        new Uint32Array([2155330, 2155394, 0, 2155458, 2155522, 2155586, 2105732, 0, 2155650, 2155714, 2155778, 2125314, 2155842, 2155906, 2126274, 2155970]),
        new Uint32Array([23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456, 23068672, 23068672, 6291456, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2097729, 2106017, 2106017, 2106017, 2106017, 2131297, 2131297, 2131297, 2131297, 2106081, 2106081, 2162049, 2162049, 2105953, 2105953, 2162337]),
        new Uint32Array([2097185, 2097697, 2097697, 2097697, 2097697, 2135777, 2135777, 2135777, 2135777, 2097377, 2097377, 2097377, 2097377, 2097601, 2097601, 2097217]),
        new Uint32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 23068672]),
        new Uint32Array([2139331, 2139427, 2139523, 2139043, 2133571, 2132611, 2139619, 2139715, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2174113, 2174145, 2100897, 2098177, 2108289, 2100865, 2173601, 2173633, 2173985, 2174113, 2174145, 6291456, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([6291456, 6291456, 23068672, 6291456, 6291456, 6291456, 23068672, 6291456, 6291456, 6291456, 6291456, 23068672, 6291456, 6291456, 6291456, 6291456]),
        new Uint32Array([23068672, 23068672, 18923778, 23068672, 23068672, 23068672, 23068672, 18923842, 23068672, 23068672, 23068672, 23068672, 18923906, 23068672, 23068672, 23068672]),
        new Uint32Array([2134145, 2097153, 2134241, 0, 2132705, 2130977, 2160065, 2131297, 0, 2133089, 0, 2133857, 0, 0, 0, 0]),
        new Uint32Array([6291456, 6291456, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2177537, 6291456, 2177569, 6291456, 2177601, 6291456, 2177633, 6291456, 2177665, 6291456, 2177697, 6291456, 2177729, 6291456, 2177761, 6291456]),
        new Uint32Array([2212481, 2212513, 2212545, 2212577, 2197121, 2212609, 2212641, 2212673, 2212705, 2212737, 2212769, 2212801, 2212833, 2212865, 2212897, 2212929]),
        new Uint32Array([6291456, 6291456, 23068672, 23068672, 23068672, 6291456, 6291456, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        new Uint32Array([2098241, 2108353, 2170209, 2105825, 2111713, 2100897, 2111905, 2105473, 2105569, 2105601, 2112289, 6291456, 2108193, 2172417, 2112481, 2098177]),
        new Uint32Array([6291456, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 23068672, 6291456, 6291456])
      ];
      var blockIdxes = new Uint16Array([616, 616, 565, 147, 161, 411, 330, 2, 131, 131, 328, 454, 241, 408, 86, 86, 696, 113, 285, 350, 325, 301, 473, 214, 639, 232, 447, 64, 369, 598, 124, 672, 567, 223, 621, 154, 107, 86, 86, 86, 86, 86, 86, 505, 86, 68, 634, 86, 218, 218, 218, 218, 486, 218, 218, 513, 188, 608, 216, 86, 217, 463, 668, 85, 700, 360, 184, 86, 86, 86, 647, 402, 153, 10, 346, 718, 662, 260, 145, 298, 117, 1, 443, 342, 138, 54, 563, 86, 240, 572, 218, 70, 387, 86, 118, 460, 641, 602, 86, 86, 306, 218, 86, 692, 86, 86, 86, 86, 86, 162, 707, 86, 458, 26, 86, 218, 638, 86, 86, 86, 86, 86, 65, 449, 86, 86, 306, 183, 86, 58, 391, 667, 86, 157, 131, 131, 131, 131, 86, 433, 131, 406, 31, 218, 247, 86, 86, 693, 218, 581, 351, 86, 438, 295, 69, 462, 45, 126, 173, 650, 14, 295, 69, 97, 168, 187, 641, 78, 523, 390, 69, 108, 287, 664, 173, 219, 83, 295, 69, 108, 431, 426, 173, 694, 412, 115, 628, 52, 257, 398, 641, 118, 501, 121, 69, 579, 151, 423, 173, 620, 464, 121, 69, 382, 151, 476, 173, 27, 53, 121, 86, 594, 578, 226, 173, 86, 632, 130, 86, 96, 228, 268, 641, 622, 563, 86, 86, 21, 148, 650, 131, 131, 321, 43, 144, 343, 381, 531, 131, 131, 178, 20, 86, 399, 156, 375, 164, 541, 30, 60, 715, 198, 92, 118, 131, 131, 86, 86, 306, 407, 86, 280, 457, 196, 488, 358, 131, 131, 244, 86, 86, 143, 86, 86, 86, 86, 86, 667, 563, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 336, 363, 86, 86, 336, 86, 86, 380, 678, 67, 86, 86, 86, 678, 86, 86, 86, 512, 86, 307, 86, 708, 86, 86, 86, 86, 86, 528, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 563, 307, 86, 86, 86, 86, 86, 104, 450, 337, 86, 720, 86, 32, 450, 397, 86, 86, 86, 587, 218, 558, 708, 708, 293, 708, 86, 86, 86, 86, 86, 694, 205, 86, 8, 86, 86, 86, 86, 549, 86, 667, 697, 697, 679, 86, 458, 460, 86, 86, 650, 86, 708, 543, 86, 86, 86, 245, 86, 86, 86, 140, 218, 127, 708, 708, 458, 197, 131, 131, 131, 131, 500, 86, 86, 483, 251, 86, 306, 510, 515, 86, 722, 86, 86, 86, 65, 201, 86, 86, 483, 580, 470, 86, 86, 86, 368, 131, 131, 131, 694, 114, 110, 555, 86, 86, 123, 721, 163, 142, 713, 418, 86, 317, 675, 209, 218, 218, 218, 371, 545, 592, 629, 490, 603, 199, 46, 320, 525, 680, 310, 279, 388, 111, 42, 252, 593, 607, 235, 617, 410, 377, 50, 548, 135, 356, 17, 520, 189, 116, 392, 600, 349, 332, 482, 699, 690, 535, 119, 106, 451, 71, 152, 667, 131, 218, 218, 265, 671, 637, 492, 504, 533, 683, 269, 269, 658, 86, 86, 86, 86, 86, 86, 86, 86, 86, 491, 619, 86, 86, 6, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 229, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 667, 86, 86, 171, 131, 118, 131, 656, 206, 234, 571, 89, 334, 670, 246, 311, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 534, 86, 86, 86, 86, 86, 86, 82, 86, 86, 86, 86, 86, 430, 86, 86, 86, 86, 86, 86, 86, 86, 86, 599, 86, 324, 86, 470, 69, 640, 264, 131, 626, 101, 174, 86, 86, 667, 233, 105, 73, 374, 394, 221, 204, 84, 28, 326, 86, 86, 471, 86, 86, 86, 109, 573, 86, 171, 200, 200, 200, 200, 218, 218, 86, 86, 86, 86, 460, 131, 131, 131, 86, 506, 86, 86, 86, 86, 86, 220, 404, 34, 614, 47, 442, 305, 25, 612, 338, 601, 648, 7, 344, 255, 131, 131, 51, 86, 312, 507, 563, 86, 86, 86, 86, 588, 86, 86, 86, 86, 86, 530, 511, 86, 458, 3, 435, 384, 556, 522, 230, 527, 86, 118, 86, 86, 717, 86, 137, 273, 79, 181, 484, 23, 93, 112, 655, 249, 417, 703, 370, 87, 98, 313, 684, 585, 155, 465, 596, 481, 695, 18, 416, 428, 61, 701, 706, 282, 643, 495, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 549, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 549, 131, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 307, 86, 86, 86, 171, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 650, 131, 422, 542, 420, 263, 24, 172, 86, 86, 86, 86, 86, 566, 86, 86, 132, 540, 395, 353, 494, 519, 19, 485, 284, 472, 131, 131, 131, 16, 714, 86, 211, 708, 86, 86, 86, 694, 698, 86, 86, 483, 704, 708, 218, 272, 86, 86, 120, 86, 159, 478, 86, 307, 247, 86, 86, 663, 597, 459, 627, 667, 86, 86, 277, 455, 39, 302, 86, 250, 86, 86, 86, 271, 99, 452, 306, 281, 329, 400, 200, 86, 86, 362, 549, 352, 646, 461, 323, 586, 86, 86, 4, 708, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 717, 86, 518, 86, 86, 650, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 125, 554, 480, 300, 613, 72, 333, 288, 561, 544, 604, 48, 719, 91, 169, 176, 590, 224, 76, 191, 29, 559, 560, 231, 537, 166, 477, 538, 256, 437, 131, 131, 469, 167, 40, 0, 685, 266, 441, 705, 239, 642, 475, 568, 640, 610, 299, 673, 517, 318, 385, 22, 202, 180, 179, 359, 424, 215, 90, 66, 521, 653, 467, 682, 453, 409, 479, 88, 131, 661, 35, 303, 15, 262, 666, 630, 712, 131, 131, 618, 659, 175, 218, 195, 347, 193, 227, 261, 150, 165, 709, 546, 294, 569, 710, 270, 413, 376, 524, 55, 242, 38, 419, 529, 170, 657, 3, 304, 122, 379, 278, 131, 651, 86, 67, 576, 458, 458, 131, 131, 86, 86, 86, 86, 86, 86, 86, 118, 309, 86, 86, 547, 86, 86, 86, 86, 667, 650, 664, 131, 131, 86, 86, 56, 131, 131, 131, 131, 131, 131, 131, 131, 86, 307, 86, 86, 86, 664, 238, 650, 86, 86, 717, 86, 118, 86, 86, 315, 86, 59, 86, 86, 574, 549, 131, 131, 340, 57, 436, 86, 86, 86, 86, 86, 86, 458, 708, 499, 691, 62, 86, 650, 86, 86, 694, 86, 86, 86, 319, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 171, 86, 549, 694, 131, 131, 131, 131, 131, 131, 131, 131, 131, 77, 86, 86, 139, 86, 502, 86, 86, 86, 667, 595, 131, 131, 131, 86, 12, 86, 13, 86, 609, 131, 131, 131, 131, 86, 86, 86, 625, 86, 669, 86, 86, 182, 129, 86, 5, 694, 104, 86, 86, 86, 86, 131, 131, 86, 86, 386, 171, 86, 86, 86, 345, 86, 324, 86, 589, 86, 213, 36, 131, 131, 131, 131, 131, 86, 86, 86, 86, 104, 131, 131, 131, 141, 290, 80, 677, 86, 86, 86, 267, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 667, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 515, 86, 86, 33, 136, 669, 86, 711, 515, 86, 86, 550, 640, 86, 104, 708, 515, 86, 159, 372, 717, 86, 86, 444, 515, 86, 86, 663, 37, 86, 563, 460, 86, 390, 624, 702, 131, 131, 131, 131, 389, 59, 708, 86, 86, 341, 208, 708, 635, 295, 69, 108, 431, 508, 100, 190, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 649, 516, 660, 131, 131, 86, 86, 86, 218, 631, 708, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 341, 575, 238, 514, 131, 131, 86, 86, 86, 218, 291, 708, 307, 131, 86, 86, 306, 367, 708, 131, 131, 131, 86, 378, 697, 86, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 615, 253, 86, 86, 86, 292, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 104, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 69, 86, 341, 553, 549, 86, 307, 86, 86, 645, 275, 455, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 708, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 86, 667, 460, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 717, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 667, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 171, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 104, 86, 667, 459, 131, 131, 131, 131, 131, 131, 86, 458, 225, 86, 86, 86, 516, 549, 11, 390, 405, 86, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 460, 44, 218, 197, 711, 515, 131, 131, 131, 131, 664, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 307, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 308, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 640, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 86, 118, 307, 104, 286, 591, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 549, 86, 86, 681, 86, 86, 75, 185, 314, 582, 86, 358, 496, 474, 86, 104, 131, 86, 86, 86, 86, 146, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 171, 86, 640, 131, 131, 131, 131, 131, 131, 131, 131, 246, 503, 689, 339, 674, 81, 258, 415, 439, 128, 562, 366, 414, 246, 503, 689, 583, 222, 557, 316, 636, 665, 186, 355, 95, 670, 246, 503, 689, 339, 674, 557, 258, 415, 439, 186, 355, 95, 670, 246, 503, 689, 446, 644, 536, 652, 331, 532, 335, 440, 274, 421, 297, 570, 74, 425, 364, 425, 606, 552, 403, 509, 134, 365, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 218, 218, 218, 498, 218, 218, 577, 627, 551, 497, 572, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 553, 354, 236, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 296, 455, 131, 131, 456, 243, 103, 86, 41, 459, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 9, 276, 158, 716, 393, 564, 383, 489, 401, 654, 210, 654, 131, 131, 131, 640, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 650, 86, 86, 86, 86, 86, 86, 717, 667, 563, 563, 563, 86, 549, 102, 686, 133, 246, 605, 86, 448, 86, 86, 207, 307, 131, 131, 131, 641, 86, 177, 611, 445, 373, 194, 584, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 308, 307, 171, 86, 86, 86, 86, 86, 86, 86, 717, 86, 86, 86, 86, 86, 460, 131, 131, 650, 86, 86, 86, 694, 708, 86, 86, 694, 86, 458, 131, 131, 131, 131, 131, 131, 667, 694, 289, 650, 667, 131, 131, 86, 640, 131, 131, 664, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 171, 131, 131, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 460, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 458, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 86, 640, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 466, 203, 149, 429, 94, 432, 160, 687, 539, 63, 237, 283, 192, 248, 348, 259, 427, 526, 396, 676, 254, 468, 487, 212, 327, 623, 49, 633, 322, 493, 434, 688, 357, 361, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131, 131]);
      var mappingStr = "\u0635\u0644\u0649 \u0627\u0644\u0644\u0647 \u0639\u0644\u064A\u0647 \u0648\u0633\u0644\u0645\u062C\u0644 \u062C\u0644\u0627\u0644\u0647\u30AD\u30ED\u30E1\u30FC\u30C8\u30EBrad\u2215s2\u30A8\u30B9\u30AF\u30FC\u30C9\u30AD\u30ED\u30B0\u30E9\u30E0\u30AD\u30ED\u30EF\u30C3\u30C8\u30B0\u30E9\u30E0\u30C8\u30F3\u30AF\u30EB\u30BC\u30A4\u30ED\u30B5\u30F3\u30C1\u30FC\u30E0\u30D1\u30FC\u30BB\u30F3\u30C8\u30D4\u30A2\u30B9\u30C8\u30EB\u30D5\u30A1\u30E9\u30C3\u30C9\u30D6\u30C3\u30B7\u30A7\u30EB\u30D8\u30AF\u30BF\u30FC\u30EB\u30DE\u30F3\u30B7\u30E7\u30F3\u30DF\u30EA\u30D0\u30FC\u30EB\u30EC\u30F3\u30C8\u30B2\u30F3\u2032\u2032\u2032\u20321\u204410viii(10)(11)(12)(13)(14)(15)(16)(17)(18)(19)(20)\u222B\u222B\u222B\u222B(\uC624\uC804)(\uC624\uD6C4)\u30A2\u30D1\u30FC\u30C8\u30A2\u30EB\u30D5\u30A1\u30A2\u30F3\u30DA\u30A2\u30A4\u30CB\u30F3\u30B0\u30A8\u30FC\u30AB\u30FC\u30AB\u30E9\u30C3\u30C8\u30AB\u30ED\u30EA\u30FC\u30AD\u30E5\u30EA\u30FC\u30AE\u30EB\u30C0\u30FC\u30AF\u30ED\u30FC\u30CD\u30B5\u30A4\u30AF\u30EB\u30B7\u30EA\u30F3\u30B0\u30D0\u30FC\u30EC\u30EB\u30D5\u30A3\u30FC\u30C8\u30DD\u30A4\u30F3\u30C8\u30DE\u30A4\u30AF\u30ED\u30DF\u30AF\u30ED\u30F3\u30E1\u30AC\u30C8\u30F3\u30EA\u30C3\u30C8\u30EB\u30EB\u30FC\u30D6\u30EB\u682A\u5F0F\u4F1A\u793Ekcalm\u2215s2c\u2215kg\u0627\u0643\u0628\u0631\u0645\u062D\u0645\u062F\u0635\u0644\u0639\u0645\u0631\u0633\u0648\u0644\u0631\u06CC\u0627\u06441\u204441\u204423\u20444 \u0308\u0301\u0FB2\u0F71\u0F80\u0FB3\u0F71\u0F80 \u0308\u0342 \u0313\u0300 \u0313\u0301 \u0313\u0342 \u0314\u0300 \u0314\u0301 \u0314\u0342 \u0308\u0300\u2035\u2035\u2035a/ca/sc/oc/utelfax1\u204471\u204491\u204432\u204431\u204452\u204453\u204454\u204451\u204465\u204461\u204483\u204485\u204487\u20448xii0\u20443\u222E\u222E\u222E(1)(2)(3)(4)(5)(6)(7)(8)(9)(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)(m)(n)(o)(p)(q)(r)(s)(t)(u)(v)(w)(x)(y)(z)::====(\u1100)(\u1102)(\u1103)(\u1105)(\u1106)(\u1107)(\u1109)(\u110B)(\u110C)(\u110E)(\u110F)(\u1110)(\u1111)(\u1112)(\uAC00)(\uB098)(\uB2E4)(\uB77C)(\uB9C8)(\uBC14)(\uC0AC)(\uC544)(\uC790)(\uCC28)(\uCE74)(\uD0C0)(\uD30C)(\uD558)(\uC8FC)(\u4E00)(\u4E8C)(\u4E09)(\u56DB)(\u4E94)(\u516D)(\u4E03)(\u516B)(\u4E5D)(\u5341)(\u6708)(\u706B)(\u6C34)(\u6728)(\u91D1)(\u571F)(\u65E5)(\u682A)(\u6709)(\u793E)(\u540D)(\u7279)(\u8CA1)(\u795D)(\u52B4)(\u4EE3)(\u547C)(\u5B66)(\u76E3)(\u4F01)(\u8CC7)(\u5354)(\u796D)(\u4F11)(\u81EA)(\u81F3)pte10\u670811\u670812\u6708ergltd\u30A2\u30FC\u30EB\u30A4\u30F3\u30C1\u30A6\u30A9\u30F3\u30AA\u30F3\u30B9\u30AA\u30FC\u30E0\u30AB\u30A4\u30EA\u30AC\u30ED\u30F3\u30AC\u30F3\u30DE\u30AE\u30CB\u30FC\u30B1\u30FC\u30B9\u30B3\u30EB\u30CA\u30B3\u30FC\u30DD\u30BB\u30F3\u30C1\u30C0\u30FC\u30B9\u30CE\u30C3\u30C8\u30CF\u30A4\u30C4\u30D1\u30FC\u30C4\u30D4\u30AF\u30EB\u30D5\u30E9\u30F3\u30DA\u30CB\u30D2\u30D8\u30EB\u30C4\u30DA\u30F3\u30B9\u30DA\u30FC\u30B8\u30D9\u30FC\u30BF\u30DC\u30EB\u30C8\u30DD\u30F3\u30C9\u30DB\u30FC\u30EB\u30DB\u30FC\u30F3\u30DE\u30A4\u30EB\u30DE\u30C3\u30CF\u30DE\u30EB\u30AF\u30E4\u30FC\u30C9\u30E4\u30FC\u30EB\u30E6\u30A2\u30F3\u30EB\u30D4\u30FC10\u70B911\u70B912\u70B913\u70B914\u70B915\u70B916\u70B917\u70B918\u70B919\u70B920\u70B921\u70B922\u70B923\u70B924\u70B9hpabardm2dm3khzmhzghzthzmm2cm2km2mm3cm3km3kpampagpalogmilmolppmv\u2215ma\u2215m10\u65E511\u65E512\u65E513\u65E514\u65E515\u65E516\u65E517\u65E518\u65E519\u65E520\u65E521\u65E522\u65E523\u65E524\u65E525\u65E526\u65E527\u65E528\u65E529\u65E530\u65E531\u65E5galffiffl\u05E9\u05BC\u05C1\u05E9\u05BC\u05C2 \u064C\u0651 \u064D\u0651 \u064E\u0651 \u064F\u0651 \u0650\u0651 \u0651\u0670\u0640\u064E\u0651\u0640\u064F\u0651\u0640\u0650\u0651\u062A\u062C\u0645\u062A\u062D\u062C\u062A\u062D\u0645\u062A\u062E\u0645\u062A\u0645\u062C\u062A\u0645\u062D\u062A\u0645\u062E\u062C\u0645\u062D\u062D\u0645\u064A\u062D\u0645\u0649\u0633\u062D\u062C\u0633\u062C\u062D\u0633\u062C\u0649\u0633\u0645\u062D\u0633\u0645\u062C\u0633\u0645\u0645\u0635\u062D\u062D\u0635\u0645\u0645\u0634\u062D\u0645\u0634\u062C\u064A\u0634\u0645\u062E\u0634\u0645\u0645\u0636\u062D\u0649\u0636\u062E\u0645\u0637\u0645\u062D\u0637\u0645\u0645\u0637\u0645\u064A\u0639\u062C\u0645\u0639\u0645\u0645\u0639\u0645\u0649\u063A\u0645\u0645\u063A\u0645\u064A\u063A\u0645\u0649\u0641\u062E\u0645\u0642\u0645\u062D\u0642\u0645\u0645\u0644\u062D\u0645\u0644\u062D\u064A\u0644\u062D\u0649\u0644\u062C\u062C\u0644\u062E\u0645\u0644\u0645\u062D\u0645\u062D\u062C\u0645\u062D\u064A\u0645\u062C\u062D\u0645\u062C\u0645\u0645\u062E\u0645\u0645\u062C\u062E\u0647\u0645\u062C\u0647\u0645\u0645\u0646\u062D\u0645\u0646\u062D\u0649\u0646\u062C\u0645\u0646\u062C\u0649\u0646\u0645\u064A\u0646\u0645\u0649\u064A\u0645\u0645\u0628\u062E\u064A\u062A\u062C\u064A\u062A\u062C\u0649\u062A\u062E\u064A\u062A\u062E\u0649\u062A\u0645\u064A\u062A\u0645\u0649\u062C\u0645\u064A\u062C\u062D\u0649\u062C\u0645\u0649\u0633\u062E\u0649\u0635\u062D\u064A\u0634\u062D\u064A\u0636\u062D\u064A\u0644\u062C\u064A\u0644\u0645\u064A\u064A\u062D\u064A\u064A\u062C\u064A\u064A\u0645\u064A\u0645\u0645\u064A\u0642\u0645\u064A\u0646\u062D\u064A\u0639\u0645\u064A\u0643\u0645\u064A\u0646\u062C\u062D\u0645\u062E\u064A\u0644\u062C\u0645\u0643\u0645\u0645\u062C\u062D\u064A\u062D\u062C\u064A\u0645\u062C\u064A\u0641\u0645\u064A\u0628\u062D\u064A\u0633\u062E\u064A\u0646\u062C\u064A\u0635\u0644\u06D2\u0642\u0644\u06D2\u{1D158}\u{1D165}\u{1D16E}\u{1D158}\u{1D165}\u{1D16F}\u{1D158}\u{1D165}\u{1D170}\u{1D158}\u{1D165}\u{1D171}\u{1D158}\u{1D165}\u{1D172}\u{1D1B9}\u{1D165}\u{1D16E}\u{1D1BA}\u{1D165}\u{1D16E}\u{1D1B9}\u{1D165}\u{1D16F}\u{1D1BA}\u{1D165}\u{1D16F}\u3014s\u3015ppv\u3014\u672C\u3015\u3014\u4E09\u3015\u3014\u4E8C\u3015\u3014\u5B89\u3015\u3014\u70B9\u3015\u3014\u6253\u3015\u3014\u76D7\u3015\u3014\u52DD\u3015\u3014\u6557\u3015 \u0304 \u0301 \u0327ssi\u0307ijl\xB7\u02BCnd\u017Eljnjdz \u0306 \u0307 \u030A \u0328 \u0303 \u030B \u03B9\u0565\u0582\u0627\u0674\u0648\u0674\u06C7\u0674\u064A\u0674\u0915\u093C\u0916\u093C\u0917\u093C\u091C\u093C\u0921\u093C\u0922\u093C\u092B\u093C\u092F\u093C\u09A1\u09BC\u09A2\u09BC\u09AF\u09BC\u0A32\u0A3C\u0A38\u0A3C\u0A16\u0A3C\u0A17\u0A3C\u0A1C\u0A3C\u0A2B\u0A3C\u0B21\u0B3C\u0B22\u0B3C\u0E4D\u0E32\u0ECD\u0EB2\u0EAB\u0E99\u0EAB\u0EA1\u0F42\u0FB7\u0F4C\u0FB7\u0F51\u0FB7\u0F56\u0FB7\u0F5B\u0FB7\u0F40\u0FB5\u0F71\u0F72\u0F71\u0F74\u0FB2\u0F80\u0FB3\u0F80\u0F92\u0FB7\u0F9C\u0FB7\u0FA1\u0FB7\u0FA6\u0FB7\u0FAB\u0FB7\u0F90\u0FB5a\u02BE\u1F00\u03B9\u1F01\u03B9\u1F02\u03B9\u1F03\u03B9\u1F04\u03B9\u1F05\u03B9\u1F06\u03B9\u1F07\u03B9\u1F20\u03B9\u1F21\u03B9\u1F22\u03B9\u1F23\u03B9\u1F24\u03B9\u1F25\u03B9\u1F26\u03B9\u1F27\u03B9\u1F60\u03B9\u1F61\u03B9\u1F62\u03B9\u1F63\u03B9\u1F64\u03B9\u1F65\u03B9\u1F66\u03B9\u1F67\u03B9\u1F70\u03B9\u03B1\u03B9\u03AC\u03B9\u1FB6\u03B9 \u0342\u1F74\u03B9\u03B7\u03B9\u03AE\u03B9\u1FC6\u03B9\u1F7C\u03B9\u03C9\u03B9\u03CE\u03B9\u1FF6\u03B9 \u0333!! \u0305???!!?rs\xB0c\xB0fnosmtmivix\u2ADD\u0338 \u3099 \u309A\u3088\u308A\u30B3\u30C8333435\uCC38\uACE0\uC8FC\uC758363738394042444546474849503\u67084\u67085\u67086\u67087\u67088\u67089\u6708hgev\u30AE\u30AC\u30C7\u30B7\u30C9\u30EB\u30CA\u30CE\u30D4\u30B3\u30D3\u30EB\u30DA\u30BD\u30DB\u30F3\u30EA\u30E9\u30EC\u30E0daauovpciu\u5E73\u6210\u662D\u548C\u5927\u6B63\u660E\u6CBBna\u03BCakakbmbgbpfnf\u03BCf\u03BCgmg\u03BClmldlklfmnm\u03BCmpsns\u03BCsmsnv\u03BCvkvpwnw\u03BCwmwkwk\u03C9m\u03C9bqcccddbgyhainkkktlnlxphprsrsvwbst\u0574\u0576\u0574\u0565\u0574\u056B\u057E\u0576\u0574\u056D\u05D9\u05B4\u05F2\u05B7\u05E9\u05C1\u05E9\u05C2\u05D0\u05B7\u05D0\u05B8\u05D0\u05BC\u05D1\u05BC\u05D2\u05BC\u05D3\u05BC\u05D4\u05BC\u05D5\u05BC\u05D6\u05BC\u05D8\u05BC\u05D9\u05BC\u05DA\u05BC\u05DB\u05BC\u05DC\u05BC\u05DE\u05BC\u05E0\u05BC\u05E1\u05BC\u05E3\u05BC\u05E4\u05BC\u05E6\u05BC\u05E7\u05BC\u05E8\u05BC\u05EA\u05BC\u05D5\u05B9\u05D1\u05BF\u05DB\u05BF\u05E4\u05BF\u05D0\u05DC\u0626\u0627\u0626\u06D5\u0626\u0648\u0626\u06C7\u0626\u06C6\u0626\u06C8\u0626\u06D0\u0626\u0649\u0626\u062C\u0626\u062D\u0626\u0645\u0626\u064A\u0628\u062C\u0628\u0645\u0628\u0649\u0628\u064A\u062A\u0649\u062A\u064A\u062B\u062C\u062B\u0645\u062B\u0649\u062B\u064A\u062E\u062D\u0636\u062C\u0636\u0645\u0637\u062D\u0638\u0645\u063A\u062C\u0641\u062C\u0641\u062D\u0641\u0649\u0641\u064A\u0642\u062D\u0642\u0649\u0642\u064A\u0643\u0627\u0643\u062C\u0643\u062D\u0643\u062E\u0643\u0644\u0643\u0649\u0643\u064A\u0646\u062E\u0646\u0649\u0646\u064A\u0647\u062C\u0647\u0649\u0647\u064A\u064A\u0649\u0630\u0670\u0631\u0670\u0649\u0670\u0626\u0631\u0626\u0632\u0626\u0646\u0628\u0632\u0628\u0646\u062A\u0631\u062A\u0632\u062A\u0646\u062B\u0631\u062B\u0632\u062B\u0646\u0645\u0627\u0646\u0631\u0646\u0632\u0646\u0646\u064A\u0631\u064A\u0632\u0626\u062E\u0626\u0647\u0628\u0647\u062A\u0647\u0635\u062E\u0646\u0647\u0647\u0670\u062B\u0647\u0633\u0647\u0634\u0647\u0637\u0649\u0637\u064A\u0639\u0649\u0639\u064A\u063A\u0649\u063A\u064A\u0633\u0649\u0633\u064A\u0634\u0649\u0634\u064A\u0635\u0649\u0635\u064A\u0636\u0649\u0636\u064A\u0634\u062E\u0634\u0631\u0633\u0631\u0635\u0631\u0636\u0631\u0627\u064B \u064B\u0640\u064B\u0640\u0651 \u0652\u0640\u0652\u0644\u0622\u0644\u0623\u0644\u0625\u{1D157}\u{1D165}0,1,2,3,4,5,6,7,8,9,wzhvsdwcmcmddj\u307B\u304B\u30B3\u30B3\xE0\xE1\xE2\xE3\xE4\xE5\xE6\xE7\xE8\xE9\xEA\xEB\xEC\xED\xEE\xEF\xF0\xF1\xF2\xF3\xF4\xF5\xF6\xF8\xF9\xFA\xFB\xFC\xFD\xFE\u0101\u0103\u0105\u0107\u0109\u010B\u010D\u010F\u0111\u0113\u0115\u0117\u0119\u011B\u011D\u011F\u0121\u0123\u0125\u0127\u0129\u012B\u012D\u012F\u0135\u0137\u013A\u013C\u013E\u0142\u0144\u0146\u0148\u014B\u014D\u014F\u0151\u0153\u0155\u0157\u0159\u015B\u015D\u015F\u0161\u0163\u0165\u0167\u0169\u016B\u016D\u016F\u0171\u0173\u0175\u0177\xFF\u017A\u017C\u0253\u0183\u0185\u0254\u0188\u0256\u0257\u018C\u01DD\u0259\u025B\u0192\u0260\u0263\u0269\u0268\u0199\u026F\u0272\u0275\u01A1\u01A3\u01A5\u0280\u01A8\u0283\u01AD\u0288\u01B0\u028A\u028B\u01B4\u01B6\u0292\u01B9\u01BD\u01CE\u01D0\u01D2\u01D4\u01D6\u01D8\u01DA\u01DC\u01DF\u01E1\u01E3\u01E5\u01E7\u01E9\u01EB\u01ED\u01EF\u01F5\u0195\u01BF\u01F9\u01FB\u01FD\u01FF\u0201\u0203\u0205\u0207\u0209\u020B\u020D\u020F\u0211\u0213\u0215\u0217\u0219\u021B\u021D\u021F\u019E\u0223\u0225\u0227\u0229\u022B\u022D\u022F\u0231\u0233\u2C65\u023C\u019A\u2C66\u0242\u0180\u0289\u028C\u0247\u0249\u024B\u024D\u024F\u0266\u0279\u027B\u0281\u0295\u0371\u0373\u02B9\u0377;\u03F3\u03AD\u03AF\u03CC\u03CD\u03B2\u03B3\u03B4\u03B5\u03B6\u03B8\u03BA\u03BB\u03BD\u03BE\u03BF\u03C0\u03C1\u03C3\u03C4\u03C5\u03C6\u03C7\u03C8\u03CA\u03CB\u03D7\u03D9\u03DB\u03DD\u03DF\u03E1\u03E3\u03E5\u03E7\u03E9\u03EB\u03ED\u03EF\u03F8\u03FB\u037B\u037C\u037D\u0450\u0451\u0452\u0453\u0454\u0455\u0456\u0457\u0458\u0459\u045A\u045B\u045C\u045D\u045E\u045F\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437\u0438\u0439\u043A\u043B\u043C\u043D\u043E\u043F\u0440\u0441\u0442\u0443\u0444\u0445\u0446\u0447\u0448\u0449\u044A\u044B\u044C\u044D\u044E\u044F\u0461\u0463\u0465\u0467\u0469\u046B\u046D\u046F\u0471\u0473\u0475\u0477\u0479\u047B\u047D\u047F\u0481\u048B\u048D\u048F\u0491\u0493\u0495\u0497\u0499\u049B\u049D\u049F\u04A1\u04A3\u04A5\u04A7\u04A9\u04AB\u04AD\u04AF\u04B1\u04B3\u04B5\u04B7\u04B9\u04BB\u04BD\u04BF\u04C2\u04C4\u04C6\u04C8\u04CA\u04CC\u04CE\u04D1\u04D3\u04D5\u04D7\u04D9\u04DB\u04DD\u04DF\u04E1\u04E3\u04E5\u04E7\u04E9\u04EB\u04ED\u04EF\u04F1\u04F3\u04F5\u04F7\u04F9\u04FB\u04FD\u04FF\u0501\u0503\u0505\u0507\u0509\u050B\u050D\u050F\u0511\u0513\u0515\u0517\u0519\u051B\u051D\u051F\u0521\u0523\u0525\u0527\u0529\u052B\u052D\u052F\u0561\u0562\u0563\u0564\u0566\u0567\u0568\u0569\u056A\u056C\u056E\u056F\u0570\u0571\u0572\u0573\u0575\u0577\u0578\u0579\u057A\u057B\u057C\u057D\u057F\u0580\u0581\u0583\u0584\u0585\u0586\u0F0B\u2D27\u2D2D\u10DC\u13F0\u13F1\u13F2\u13F3\u13F4\u13F5\uA64B\u0250\u0251\u1D02\u025C\u1D16\u1D17\u1D1D\u1D25\u0252\u0255\u025F\u0261\u0265\u026A\u1D7B\u029D\u026D\u1D85\u029F\u0271\u0270\u0273\u0274\u0278\u0282\u01AB\u1D1C\u0290\u0291\u1E01\u1E03\u1E05\u1E07\u1E09\u1E0B\u1E0D\u1E0F\u1E11\u1E13\u1E15\u1E17\u1E19\u1E1B\u1E1D\u1E1F\u1E21\u1E23\u1E25\u1E27\u1E29\u1E2B\u1E2D\u1E2F\u1E31\u1E33\u1E35\u1E37\u1E39\u1E3B\u1E3D\u1E3F\u1E41\u1E43\u1E45\u1E47\u1E49\u1E4B\u1E4D\u1E4F\u1E51\u1E53\u1E55\u1E57\u1E59\u1E5B\u1E5D\u1E5F\u1E61\u1E63\u1E65\u1E67\u1E69\u1E6B\u1E6D\u1E6F\u1E71\u1E73\u1E75\u1E77\u1E79\u1E7B\u1E7D\u1E7F\u1E81\u1E83\u1E85\u1E87\u1E89\u1E8B\u1E8D\u1E8F\u1E91\u1E93\u1E95\u1EA1\u1EA3\u1EA5\u1EA7\u1EA9\u1EAB\u1EAD\u1EAF\u1EB1\u1EB3\u1EB5\u1EB7\u1EB9\u1EBB\u1EBD\u1EBF\u1EC1\u1EC3\u1EC5\u1EC7\u1EC9\u1ECB\u1ECD\u1ECF\u1ED1\u1ED3\u1ED5\u1ED7\u1ED9\u1EDB\u1EDD\u1EDF\u1EE1\u1EE3\u1EE5\u1EE7\u1EE9\u1EEB\u1EED\u1EEF\u1EF1\u1EF3\u1EF5\u1EF7\u1EF9\u1EFB\u1EFD\u1EFF\u1F10\u1F11\u1F12\u1F13\u1F14\u1F15\u1F30\u1F31\u1F32\u1F33\u1F34\u1F35\u1F36\u1F37\u1F40\u1F41\u1F42\u1F43\u1F44\u1F45\u1F51\u1F53\u1F55\u1F57\u1FB0\u1FB1\u1F72\u0390\u1FD0\u1FD1\u1F76\u03B0\u1FE0\u1FE1\u1F7A\u1FE5`\u1F78\u2010+\u2212\u2211\u3008\u3009\u2C30\u2C31\u2C32\u2C33\u2C34\u2C35\u2C36\u2C37\u2C38\u2C39\u2C3A\u2C3B\u2C3C\u2C3D\u2C3E\u2C3F\u2C40\u2C41\u2C42\u2C43\u2C44\u2C45\u2C46\u2C47\u2C48\u2C49\u2C4A\u2C4B\u2C4C\u2C4D\u2C4E\u2C4F\u2C50\u2C51\u2C52\u2C53\u2C54\u2C55\u2C56\u2C57\u2C58\u2C59\u2C5A\u2C5B\u2C5C\u2C5D\u2C5E\u2C61\u026B\u1D7D\u027D\u2C68\u2C6A\u2C6C\u2C73\u2C76\u023F\u0240\u2C81\u2C83\u2C85\u2C87\u2C89\u2C8B\u2C8D\u2C8F\u2C91\u2C93\u2C95\u2C97\u2C99\u2C9B\u2C9D\u2C9F\u2CA1\u2CA3\u2CA5\u2CA7\u2CA9\u2CAB\u2CAD\u2CAF\u2CB1\u2CB3\u2CB5\u2CB7\u2CB9\u2CBB\u2CBD\u2CBF\u2CC1\u2CC3\u2CC5\u2CC7\u2CC9\u2CCB\u2CCD\u2CCF\u2CD1\u2CD3\u2CD5\u2CD7\u2CD9\u2CDB\u2CDD\u2CDF\u2CE1\u2CE3\u2CEC\u2CEE\u2CF3\u2D61\u6BCD\u9F9F\u4E28\u4E36\u4E3F\u4E59\u4E85\u4EA0\u4EBA\u513F\u5165\u5182\u5196\u51AB\u51E0\u51F5\u5200\u529B\u52F9\u5315\u531A\u5338\u535C\u5369\u5382\u53B6\u53C8\u53E3\u56D7\u58EB\u5902\u590A\u5915\u5973\u5B50\u5B80\u5BF8\u5C0F\u5C22\u5C38\u5C6E\u5C71\u5DDB\u5DE5\u5DF1\u5DFE\u5E72\u5E7A\u5E7F\u5EF4\u5EFE\u5F0B\u5F13\u5F50\u5F61\u5F73\u5FC3\u6208\u6236\u624B\u652F\u6534\u6587\u6597\u65A4\u65B9\u65E0\u66F0\u6B20\u6B62\u6B79\u6BB3\u6BCB\u6BD4\u6BDB\u6C0F\u6C14\u722A\u7236\u723B\u723F\u7247\u7259\u725B\u72AC\u7384\u7389\u74DC\u74E6\u7518\u751F\u7528\u7530\u758B\u7592\u7676\u767D\u76AE\u76BF\u76EE\u77DB\u77E2\u77F3\u793A\u79B8\u79BE\u7A74\u7ACB\u7AF9\u7C73\u7CF8\u7F36\u7F51\u7F8A\u7FBD\u8001\u800C\u8012\u8033\u807F\u8089\u81E3\u81FC\u820C\u821B\u821F\u826E\u8272\u8278\u864D\u866B\u8840\u884C\u8863\u897E\u898B\u89D2\u8A00\u8C37\u8C46\u8C55\u8C78\u8C9D\u8D64\u8D70\u8DB3\u8EAB\u8ECA\u8F9B\u8FB0\u8FB5\u9091\u9149\u91C6\u91CC\u9577\u9580\u961C\u96B6\u96B9\u96E8\u9751\u975E\u9762\u9769\u97CB\u97ED\u97F3\u9801\u98A8\u98DB\u98DF\u9996\u9999\u99AC\u9AA8\u9AD8\u9ADF\u9B25\u9B2F\u9B32\u9B3C\u9B5A\u9CE5\u9E75\u9E7F\u9EA5\u9EBB\u9EC3\u9ECD\u9ED1\u9EF9\u9EFD\u9F0E\u9F13\u9F20\u9F3B\u9F4A\u9F52\u9F8D\u9F9C\u9FA0.\u3012\u5344\u5345\u1101\u11AA\u11AC\u11AD\u1104\u11B0\u11B1\u11B2\u11B3\u11B4\u11B5\u111A\u1108\u1121\u110A\u110D\u1161\u1162\u1163\u1164\u1165\u1166\u1167\u1168\u1169\u116A\u116B\u116C\u116D\u116E\u116F\u1170\u1171\u1172\u1173\u1174\u1175\u1114\u1115\u11C7\u11C8\u11CC\u11CE\u11D3\u11D7\u11D9\u111C\u11DD\u11DF\u111D\u111E\u1120\u1122\u1123\u1127\u1129\u112B\u112C\u112D\u112E\u112F\u1132\u1136\u1140\u1147\u114C\u11F1\u11F2\u1157\u1158\u1159\u1184\u1185\u1188\u1191\u1192\u1194\u119E\u11A1\u4E0A\u4E2D\u4E0B\u7532\u4E19\u4E01\u5929\u5730\u554F\u5E7C\u7B8F\uC6B0\u79D8\u7537\u9069\u512A\u5370\u6CE8\u9805\u5199\u5DE6\u53F3\u533B\u5B97\u591C\u30C6\u30CC\u30E2\u30E8\u30F0\u30F1\u30F2\uA641\uA643\uA645\uA647\uA649\uA64D\uA64F\uA651\uA653\uA655\uA657\uA659\uA65B\uA65D\uA65F\uA661\uA663\uA665\uA667\uA669\uA66B\uA66D\uA681\uA683\uA685\uA687\uA689\uA68B\uA68D\uA68F\uA691\uA693\uA695\uA697\uA699\uA69B\uA723\uA725\uA727\uA729\uA72B\uA72D\uA72F\uA733\uA735\uA737\uA739\uA73B\uA73D\uA73F\uA741\uA743\uA745\uA747\uA749\uA74B\uA74D\uA74F\uA751\uA753\uA755\uA757\uA759\uA75B\uA75D\uA75F\uA761\uA763\uA765\uA767\uA769\uA76B\uA76D\uA76F\uA77A\uA77C\u1D79\uA77F\uA781\uA783\uA785\uA787\uA78C\uA791\uA793\uA797\uA799\uA79B\uA79D\uA79F\uA7A1\uA7A3\uA7A5\uA7A7\uA7A9\u026C\u029E\u0287\uAB53\uA7B5\uA7B7\uAB37\uAB52\u13A0\u13A1\u13A2\u13A3\u13A4\u13A5\u13A6\u13A7\u13A8\u13A9\u13AA\u13AB\u13AC\u13AD\u13AE\u13AF\u13B0\u13B1\u13B2\u13B3\u13B4\u13B5\u13B6\u13B7\u13B8\u13B9\u13BA\u13BB\u13BC\u13BD\u13BE\u13BF\u13C0\u13C1\u13C2\u13C3\u13C4\u13C5\u13C6\u13C7\u13C8\u13C9\u13CA\u13CB\u13CC\u13CD\u13CE\u13CF\u13D0\u13D1\u13D2\u13D3\u13D4\u13D5\u13D6\u13D7\u13D8\u13D9\u13DA\u13DB\u13DC\u13DD\u13DE\u13DF\u13E0\u13E1\u13E2\u13E3\u13E4\u13E5\u13E6\u13E7\u13E8\u13E9\u13EA\u13EB\u13EC\u13ED\u13EE\u13EF\u8C48\u66F4\u8CC8\u6ED1\u4E32\u53E5\u5951\u5587\u5948\u61F6\u7669\u7F85\u863F\u87BA\u88F8\u908F\u6A02\u6D1B\u70D9\u73DE\u843D\u916A\u99F1\u4E82\u5375\u6B04\u721B\u862D\u9E1E\u5D50\u6FEB\u85CD\u8964\u62C9\u81D8\u881F\u5ECA\u6717\u6D6A\u72FC\u90CE\u4F86\u51B7\u52DE\u64C4\u6AD3\u7210\u76E7\u8606\u865C\u8DEF\u9732\u9B6F\u9DFA\u788C\u797F\u7DA0\u83C9\u9304\u8AD6\u58DF\u5F04\u7C60\u807E\u7262\u78CA\u8CC2\u96F7\u58D8\u5C62\u6A13\u6DDA\u6F0F\u7D2F\u7E37\u964B\u52D2\u808B\u51DC\u51CC\u7A1C\u7DBE\u83F1\u9675\u8B80\u62CF\u8AFE\u4E39\u5BE7\u6012\u7387\u7570\u5317\u78FB\u4FBF\u5FA9\u4E0D\u6CCC\u6578\u7D22\u53C3\u585E\u7701\u8449\u8AAA\u6BBA\u6C88\u62FE\u82E5\u63A0\u7565\u4EAE\u5169\u51C9\u6881\u7CE7\u826F\u8AD2\u91CF\u52F5\u5442\u5EEC\u65C5\u6FFE\u792A\u95AD\u9A6A\u9E97\u9ECE\u66C6\u6B77\u8F62\u5E74\u6190\u6200\u649A\u6F23\u7149\u7489\u79CA\u7DF4\u806F\u8F26\u84EE\u9023\u934A\u5217\u52A3\u54BD\u70C8\u88C2\u5EC9\u5FF5\u637B\u6BAE\u7C3E\u7375\u4EE4\u56F9\u5DBA\u601C\u73B2\u7469\u7F9A\u8046\u9234\u96F6\u9748\u9818\u4F8B\u79AE\u91B4\u96B8\u60E1\u4E86\u50DA\u5BEE\u5C3F\u6599\u71CE\u7642\u84FC\u907C\u6688\u962E\u5289\u677B\u67F3\u6D41\u6E9C\u7409\u7559\u786B\u7D10\u985E\u622E\u9678\u502B\u5D19\u6DEA\u8F2A\u5F8B\u6144\u6817\u9686\u5229\u540F\u5C65\u6613\u674E\u68A8\u6CE5\u7406\u75E2\u7F79\u88CF\u88E1\u96E2\u533F\u6EBA\u541D\u71D0\u7498\u85FA\u96A3\u9C57\u9E9F\u6797\u6DCB\u81E8\u7B20\u7C92\u72C0\u7099\u8B58\u4EC0\u8336\u523A\u5207\u5EA6\u62D3\u7CD6\u5B85\u6D1E\u66B4\u8F3B\u964D\u5ED3\u5140\u55C0\u585A\u6674\u51DE\u732A\u76CA\u793C\u795E\u7965\u798F\u9756\u7CBE\u8612\u8AF8\u9038\u90FD\u98EF\u98FC\u9928\u9DB4\u90DE\u96B7\u4FAE\u50E7\u514D\u52C9\u52E4\u5351\u559D\u5606\u5668\u5840\u58A8\u5C64\u6094\u6168\u618E\u61F2\u654F\u65E2\u6691\u6885\u6D77\u6E1A\u6F22\u716E\u722B\u7422\u7891\u7949\u7948\u7950\u7956\u798D\u798E\u7A40\u7A81\u7BC0\u7E09\u7E41\u7F72\u8005\u81ED\u8279\u8457\u8910\u8996\u8B01\u8B39\u8CD3\u8D08\u8FB6\u96E3\u97FF\u983B\u6075\u{242EE}\u8218\u4E26\u51B5\u5168\u4F80\u5145\u5180\u52C7\u52FA\u5555\u5599\u55E2\u58B3\u5944\u5954\u5A62\u5B28\u5ED2\u5ED9\u5F69\u5FAD\u60D8\u614E\u6108\u6160\u6234\u63C4\u641C\u6452\u6556\u671B\u6756\u6EDB\u6ECB\u701E\u77A7\u7235\u72AF\u7471\u7506\u753B\u761D\u761F\u76DB\u76F4\u774A\u7740\u78CC\u7AB1\u7C7B\u7D5B\u7F3E\u8352\u83EF\u8779\u8941\u8986\u8ABF\u8ACB\u8AED\u8B8A\u8F38\u9072\u9199\u9276\u967C\u97DB\u980B\u9B12\u{2284A}\u{22844}\u{233D5}\u3B9D\u4018\u4039\u{25249}\u{25CD0}\u{27ED3}\u9F43\u9F8E\u05E2\u05DD\u0671\u067B\u067E\u0680\u067A\u067F\u0679\u06A4\u06A6\u0684\u0683\u0686\u0687\u068D\u068C\u068E\u0688\u0698\u0691\u06A9\u06AF\u06B3\u06B1\u06BA\u06BB\u06C0\u06C1\u06BE\u06D3\u06AD\u06CB\u06C5\u06C9\u3001\u3016\u3017\u2014\u2013_{}\u3010\u3011\u300A\u300B\u300C\u300D\u300E\u300F[]#&*-<>\\$%@\u0621\u0624\u0629\"'^|~\u2985\u2986\u30FB\u30A5\u30E3\xA2\xA3\xAC\xA6\xA5\u20A9\u2502\u2190\u2191\u2192\u2193\u25A0\u25CB\u{10428}\u{10429}\u{1042A}\u{1042B}\u{1042C}\u{1042D}\u{1042E}\u{1042F}\u{10430}\u{10431}\u{10432}\u{10433}\u{10434}\u{10435}\u{10436}\u{10437}\u{10438}\u{10439}\u{1043A}\u{1043B}\u{1043C}\u{1043D}\u{1043E}\u{1043F}\u{10440}\u{10441}\u{10442}\u{10443}\u{10444}\u{10445}\u{10446}\u{10447}\u{10448}\u{10449}\u{1044A}\u{1044B}\u{1044C}\u{1044D}\u{1044E}\u{1044F}\u{104D8}\u{104D9}\u{104DA}\u{104DB}\u{104DC}\u{104DD}\u{104DE}\u{104DF}\u{104E0}\u{104E1}\u{104E2}\u{104E3}\u{104E4}\u{104E5}\u{104E6}\u{104E7}\u{104E8}\u{104E9}\u{104EA}\u{104EB}\u{104EC}\u{104ED}\u{104EE}\u{104EF}\u{104F0}\u{104F1}\u{104F2}\u{104F3}\u{104F4}\u{104F5}\u{104F6}\u{104F7}\u{104F8}\u{104F9}\u{104FA}\u{104FB}\u{10CC0}\u{10CC1}\u{10CC2}\u{10CC3}\u{10CC4}\u{10CC5}\u{10CC6}\u{10CC7}\u{10CC8}\u{10CC9}\u{10CCA}\u{10CCB}\u{10CCC}\u{10CCD}\u{10CCE}\u{10CCF}\u{10CD0}\u{10CD1}\u{10CD2}\u{10CD3}\u{10CD4}\u{10CD5}\u{10CD6}\u{10CD7}\u{10CD8}\u{10CD9}\u{10CDA}\u{10CDB}\u{10CDC}\u{10CDD}\u{10CDE}\u{10CDF}\u{10CE0}\u{10CE1}\u{10CE2}\u{10CE3}\u{10CE4}\u{10CE5}\u{10CE6}\u{10CE7}\u{10CE8}\u{10CE9}\u{10CEA}\u{10CEB}\u{10CEC}\u{10CED}\u{10CEE}\u{10CEF}\u{10CF0}\u{10CF1}\u{10CF2}\u{118C0}\u{118C1}\u{118C2}\u{118C3}\u{118C4}\u{118C5}\u{118C6}\u{118C7}\u{118C8}\u{118C9}\u{118CA}\u{118CB}\u{118CC}\u{118CD}\u{118CE}\u{118CF}\u{118D0}\u{118D1}\u{118D2}\u{118D3}\u{118D4}\u{118D5}\u{118D6}\u{118D7}\u{118D8}\u{118D9}\u{118DA}\u{118DB}\u{118DC}\u{118DD}\u{118DE}\u{118DF}\u0131\u0237\u2207\u2202\u{1E922}\u{1E923}\u{1E924}\u{1E925}\u{1E926}\u{1E927}\u{1E928}\u{1E929}\u{1E92A}\u{1E92B}\u{1E92C}\u{1E92D}\u{1E92E}\u{1E92F}\u{1E930}\u{1E931}\u{1E932}\u{1E933}\u{1E934}\u{1E935}\u{1E936}\u{1E937}\u{1E938}\u{1E939}\u{1E93A}\u{1E93B}\u{1E93C}\u{1E93D}\u{1E93E}\u{1E93F}\u{1E940}\u{1E941}\u{1E942}\u{1E943}\u066E\u06A1\u066F\u5B57\u53CC\u591A\u89E3\u4EA4\u6620\u7121\u524D\u5F8C\u518D\u65B0\u521D\u7D42\u8CA9\u58F0\u5439\u6F14\u6295\u6355\u904A\u6307\u7981\u7A7A\u5408\u6E80\u7533\u5272\u55B6\u914D\u5F97\u53EF\u4E3D\u4E38\u4E41\u{20122}\u4F60\u4FBB\u5002\u507A\u5099\u50CF\u349E\u{2063A}\u5154\u5164\u5177\u{2051C}\u34B9\u5167\u{2054B}\u5197\u51A4\u4ECC\u51AC\u{291DF}\u5203\u34DF\u523B\u5246\u5277\u3515\u5305\u5306\u5349\u535A\u5373\u537D\u537F\u{20A2C}\u7070\u53CA\u53DF\u{20B63}\u53EB\u53F1\u5406\u549E\u5438\u5448\u5468\u54A2\u54F6\u5510\u5553\u5563\u5584\u55AB\u55B3\u55C2\u5716\u5717\u5651\u5674\u58EE\u57CE\u57F4\u580D\u578B\u5832\u5831\u58AC\u{214E4}\u58F2\u58F7\u5906\u5922\u5962\u{216A8}\u{216EA}\u59EC\u5A1B\u5A27\u59D8\u5A66\u36EE\u5B08\u5B3E\u{219C8}\u5BC3\u5BD8\u5BF3\u{21B18}\u5BFF\u5C06\u3781\u5C60\u5CC0\u5C8D\u{21DE4}\u5D43\u{21DE6}\u5D6E\u5D6B\u5D7C\u5DE1\u5DE2\u382F\u5DFD\u5E28\u5E3D\u5E69\u3862\u{22183}\u387C\u5EB0\u5EB3\u5EB6\u{2A392}\u{22331}\u8201\u5F22\u38C7\u{232B8}\u{261DA}\u5F62\u5F6B\u38E3\u5F9A\u5FCD\u5FD7\u5FF9\u6081\u393A\u391C\u{226D4}\u60C7\u6148\u614C\u617A\u61B2\u61A4\u61AF\u61DE\u621B\u625D\u62B1\u62D4\u6350\u{22B0C}\u633D\u62FC\u6368\u6383\u63E4\u{22BF1}\u6422\u63C5\u63A9\u3A2E\u6469\u647E\u649D\u6477\u3A6C\u656C\u{2300A}\u65E3\u66F8\u6649\u3B19\u3B08\u3AE4\u5192\u5195\u6700\u669C\u80AD\u43D9\u6721\u675E\u6753\u{233C3}\u3B49\u67FA\u6785\u6852\u{2346D}\u688E\u681F\u6914\u6942\u69A3\u69EA\u6AA8\u{236A3}\u6ADB\u3C18\u6B21\u{238A7}\u6B54\u3C4E\u6B72\u6B9F\u6BBB\u{23A8D}\u{21D0B}\u{23AFA}\u6C4E\u{23CBC}\u6CBF\u6CCD\u6C67\u6D16\u6D3E\u6D69\u6D78\u6D85\u{23D1E}\u6D34\u6E2F\u6E6E\u3D33\u6EC7\u{23ED1}\u6DF9\u6F6E\u{23F5E}\u{23F8E}\u6FC6\u7039\u701B\u3D96\u704A\u707D\u7077\u70AD\u{20525}\u7145\u{24263}\u719C\u7228\u7250\u{24608}\u7280\u7295\u{24735}\u{24814}\u737A\u738B\u3EAC\u73A5\u3EB8\u7447\u745C\u7485\u74CA\u3F1B\u7524\u{24C36}\u753E\u{24C92}\u{2219F}\u7610\u{24FA1}\u{24FB8}\u{25044}\u3FFC\u4008\u{250F3}\u{250F2}\u{25119}\u{25133}\u771E\u771F\u778B\u4046\u4096\u{2541D}\u784E\u40E3\u{25626}\u{2569A}\u{256C5}\u79EB\u412F\u7A4A\u7A4F\u{2597C}\u{25AA7}\u4202\u{25BAB}\u7BC6\u7BC9\u4227\u{25C80}\u7CD2\u42A0\u7CE8\u7CE3\u7D00\u{25F86}\u7D63\u4301\u7DC7\u7E02\u7E45\u4334\u{26228}\u{26247}\u4359\u{262D9}\u7F7A\u{2633E}\u7F95\u7FFA\u{264DA}\u{26523}\u8060\u{265A8}\u8070\u{2335F}\u43D5\u80B2\u8103\u440B\u813E\u5AB5\u{267A7}\u{267B5}\u{23393}\u{2339C}\u8204\u8F9E\u446B\u8291\u828B\u829D\u52B3\u82B1\u82B3\u82BD\u82E6\u{26B3C}\u831D\u8363\u83AD\u8323\u83BD\u83E7\u8353\u83CA\u83CC\u83DC\u{26C36}\u{26D6B}\u{26CD5}\u452B\u84F1\u84F3\u8516\u{273CA}\u8564\u{26F2C}\u455D\u4561\u{26FB1}\u{270D2}\u456B\u8650\u8667\u8669\u86A9\u8688\u870E\u86E2\u8728\u876B\u8786\u87E1\u8801\u45F9\u8860\u{27667}\u88D7\u88DE\u4635\u88FA\u34BB\u{278AE}\u{27966}\u46BE\u46C7\u8AA0\u{27CA8}\u8CAB\u8CC1\u8D1B\u8D77\u{27F2F}\u{20804}\u8DCB\u8DBC\u8DF0\u{208DE}\u8ED4\u{285D2}\u{285ED}\u9094\u90F1\u9111\u{2872E}\u911B\u9238\u92D7\u92D8\u927C\u93F9\u9415\u{28BFA}\u958B\u4995\u95B7\u{28D77}\u49E6\u96C3\u5DB2\u9723\u{29145}\u{2921A}\u4A6E\u4A76\u97E0\u{2940A}\u4AB2\u{29496}\u9829\u{295B6}\u98E2\u4B33\u9929\u99A7\u99C2\u99FE\u4BCE\u{29B30}\u9C40\u9CFD\u4CCE\u4CED\u9D67\u{2A0CE}\u4CF8\u{2A105}\u{2A20E}\u{2A291}\u4D56\u9EFE\u9F05\u9F0F\u9F16\u{2A600}";
      function mapChar(codePoint) {
        if (codePoint >= 196608) {
          if (codePoint >= 917760 && codePoint <= 917999)
            return 18874368;
          return 0;
        }
        return blocks[blockIdxes[codePoint >> 4]][codePoint & 15];
      }
      return {
        mapStr: mappingStr,
        mapChar
      };
    });
  }
});

// node_modules/idna-uts46-hx/uts46.js
var require_uts46 = __commonJS({
  "node_modules/idna-uts46-hx/uts46.js"(exports, module) {
    (function(root, factory) {
      if (typeof define === "function" && define.amd) {
        define(["punycode", "./idna-map"], function(punycode, idna_map) {
          return factory(punycode, idna_map);
        });
      } else if (typeof exports === "object") {
        module.exports = factory(require_punycode(), require_idna_map());
      } else {
        root.uts46 = factory(root.punycode, root.idna_map);
      }
    })(exports, function(punycode, idna_map) {
      function mapLabel(label, useStd3ASCII, transitional) {
        var mapped = [];
        var chars = punycode.ucs2.decode(label);
        for (var i2 = 0; i2 < chars.length; i2++) {
          var cp = chars[i2];
          var ch = punycode.ucs2.encode([chars[i2]]);
          var composite = idna_map.mapChar(cp);
          var flags = composite >> 23;
          var kind = composite >> 21 & 3;
          var index = composite >> 5 & 65535;
          var length = composite & 31;
          var value = idna_map.mapStr.substr(index, length);
          if (kind === 0 || useStd3ASCII && flags & 1) {
            throw new Error("Illegal char " + ch);
          } else if (kind === 1) {
            mapped.push(value);
          } else if (kind === 2) {
            mapped.push(transitional ? value : ch);
          } else if (kind === 3) {
            mapped.push(ch);
          }
        }
        var newLabel = mapped.join("").normalize("NFC");
        return newLabel;
      }
      function process2(domain, transitional, useStd3ASCII) {
        if (useStd3ASCII === void 0)
          useStd3ASCII = false;
        var mappedIDNA = mapLabel(domain, useStd3ASCII, transitional);
        var labels = mappedIDNA.split(".");
        labels = labels.map(function(label) {
          if (label.startsWith("xn--")) {
            label = punycode.decode(label.substring(4));
            validateLabel(label, useStd3ASCII, false);
          } else {
            validateLabel(label, useStd3ASCII, transitional);
          }
          return label;
        });
        return labels.join(".");
      }
      function validateLabel(label, useStd3ASCII, transitional) {
        if (label[2] === "-" && label[3] === "-")
          throw new Error("Failed to validate " + label);
        if (label.startsWith("-") || label.endsWith("-"))
          throw new Error("Failed to validate " + label);
        if (label.includes("."))
          throw new Error("Failed to validate " + label);
        if (mapLabel(label, useStd3ASCII, transitional) !== label)
          throw new Error("Failed to validate " + label);
        var ch = label.codePointAt(0);
        if (idna_map.mapChar(ch) & 2 << 23)
          throw new Error("Label contains illegal character: " + ch);
      }
      function toAscii(domain, options) {
        if (options === void 0)
          options = {};
        var transitional = "transitional" in options ? options.transitional : true;
        var useStd3ASCII = "useStd3ASCII" in options ? options.useStd3ASCII : false;
        var verifyDnsLength = "verifyDnsLength" in options ? options.verifyDnsLength : false;
        var labels = process2(domain, transitional, useStd3ASCII).split(".");
        var asciiLabels = labels.map(punycode.toASCII);
        var asciiString = asciiLabels.join(".");
        var i2;
        if (verifyDnsLength) {
          if (asciiString.length < 1 || asciiString.length > 253) {
            throw new Error("DNS name has wrong length: " + asciiString);
          }
          for (i2 = 0; i2 < asciiLabels.length; i2++) {
            var label = asciiLabels[i2];
            if (label.length < 1 || label.length > 63)
              throw new Error("DNS label has wrong length: " + label);
          }
        }
        return asciiString;
      }
      function toUnicode(domain, options) {
        if (options === void 0)
          options = {};
        var useStd3ASCII = "useStd3ASCII" in options ? options.useStd3ASCII : false;
        return process2(domain, false, useStd3ASCII);
      }
      return {
        toUnicode,
        toAscii
      };
    });
  }
});

// node_modules/eth-ens-namehash/index.js
var require_eth_ens_namehash = __commonJS({
  "node_modules/eth-ens-namehash/index.js"(exports) {
    var sha3 = require_sha3().keccak_256;
    var uts46 = require_uts46();
    function namehash(inputName) {
      var node = "";
      for (var i2 = 0; i2 < 32; i2++) {
        node += "00";
      }
      name = normalize(inputName);
      if (name) {
        var labels = name.split(".");
        for (var i2 = labels.length - 1; i2 >= 0; i2--) {
          var labelSha = sha3(labels[i2]);
          node = sha3(new Buffer(node + labelSha, "hex"));
        }
      }
      return "0x" + node;
    }
    function normalize(name2) {
      return name2 ? uts46.toUnicode(name2, { useStd3ASCII: true, transitional: false }) : name2;
    }
    exports.hash = namehash;
    exports.normalize = normalize;
  }
});

// node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "node_modules/fast-deep-equal/index.js"(exports, module) {
    "use strict";
    module.exports = function equal(a2, b4) {
      if (a2 === b4) return true;
      if (a2 && b4 && typeof a2 == "object" && typeof b4 == "object") {
        if (a2.constructor !== b4.constructor) return false;
        var length, i2, keys;
        if (Array.isArray(a2)) {
          length = a2.length;
          if (length != b4.length) return false;
          for (i2 = length; i2-- !== 0; )
            if (!equal(a2[i2], b4[i2])) return false;
          return true;
        }
        if (a2.constructor === RegExp) return a2.source === b4.source && a2.flags === b4.flags;
        if (a2.valueOf !== Object.prototype.valueOf) return a2.valueOf() === b4.valueOf();
        if (a2.toString !== Object.prototype.toString) return a2.toString() === b4.toString();
        keys = Object.keys(a2);
        length = keys.length;
        if (length !== Object.keys(b4).length) return false;
        for (i2 = length; i2-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b4, keys[i2])) return false;
        for (i2 = length; i2-- !== 0; ) {
          var key = keys[i2];
          if (!equal(a2[key], b4[key])) return false;
        }
        return true;
      }
      return a2 !== a2 && b4 !== b4;
    };
  }
});

// node_modules/@metamask/agent-sdk/dist/lib.esm/intent-C0bZDfFv.js
var c2 = class extends Error {
  code = `MISSING_PROJECT_ID`;
  constructor() {
    super(`A project id is required to resolve the default EVM gateway RPC URL.`), this.name = `MissingProjectIdError`;
  }
};
var l2 = class extends Error {
  code = `SOLANA_RPC_DEFERRED`;
  constructor(e3) {
    super(e3 ? `Solana RPC is required for ${e3}; no default Solana RPC is configured.` : `Solana RPC is required; no default Solana RPC is configured.`), this.name = `SolanaRpcRequiredError`;
  }
};
function u(t) {
  let n = t.projectId?.trim();
  if (!n) throw new c2();
  let r = t.baseUrl?.trim();
  if (!r) throw Error(`EVM gateway baseUrl is required.`);
  return { baseUrl: i(r), projectId: n };
}
function d3(e3, t) {
  if (!Number.isInteger(e3) || e3 <= 0) throw Error(`Invalid EVM chain id: ${String(e3)}`);
  let n = u(t);
  return `${n.baseUrl}/${e3}/${encodeURIComponent(n.projectId)}`;
}
var f2 = [{ key: `robinhood`, chainId: 4663, caip2: `eip155:4663`, name: `Robinhood Chain`, nativeCurrency: { name: `Ethereum`, symbol: `ETH`, decimals: 18 }, blockExplorer: `https://robinhoodchain.blockscout.com` }, { key: `monad`, chainId: 143, caip2: `eip155:143`, name: `Monad`, nativeCurrency: { name: `Monad`, symbol: `MON`, decimals: 18 }, blockExplorer: `https://monadvision.com` }, { key: `hyperevm`, chainId: 999, caip2: `eip155:999`, name: `HyperEVM`, nativeCurrency: { name: `Hype`, symbol: `HYPE`, decimals: 18 }, blockExplorer: `https://hyperevmscan.io` }, { key: `sei`, chainId: 1329, caip2: `eip155:1329`, name: `Sei`, nativeCurrency: { name: `Sei`, symbol: `SEI`, decimals: 18 }, blockExplorer: `https://seiscan.io` }, { key: `megaeth`, chainId: 4326, caip2: `eip155:4326`, name: `MegaETH`, nativeCurrency: { name: `Ether`, symbol: `ETH`, decimals: 18 }, blockExplorer: `https://mega.etherscan.io` }];
var p2 = b(at, f2);
var m = new Map(p2.map((e3) => [e3.chainId, e3]));
function v(e3 = []) {
  return b(p2, e3).map((e4) => {
    if (y3(e4)) return e4;
    let t = m.get(e4.chainId);
    return t && y3(t) ? { ...e4, nativeCurrency: t.nativeCurrency } : e4;
  });
}
function y3(e3) {
  return typeof e3.nativeCurrency?.decimals == `number`;
}
function b2(e3, t) {
  return S2(e3, d3(e3.chainId, t));
}
function S2(e3, t) {
  return { ...e3, rpcTarget: t };
}
function C(e3, t) {
  return `rpcTarget` in e3 ? e3 : b2(e3, t);
}
var w = { Transfer: `transfer`, Swap: `swap`, SwapApprove: `swap.approve`, Bridge: `bridge`, BridgeApprove: `bridge.approve`, PredictApprove: `predict.approve`, PredictDeposit: `predict.deposit`, PredictWithdraw: `predict.withdraw`, PredictPlace: `predict.place`, PredictRedeem: `predict.redeem`, PerpsOpen: `perps.open`, PerpsClose: `perps.close`, PerpsModify: `perps.modify`, PerpsCancel: `perps.cancel`, PerpsDeposit: `perps.deposit`, PerpsWithdraw: `perps.withdraw`, PerpsApproveBuilderFee: `perps.approve_builder_fee`, LendingApprove: `lending.approve`, LendingSupply: `lending.supply`, LendingWithdraw: `lending.withdraw`, Call: `call`, Custom: `custom` };
var D = { transfer: (e3, t, n) => ({ action: w.Transfer, summary: `Transfer ${e3} ${t} to ${n}` }), swap: (e3, t, n, r, i2, a2) => ({ action: w.Swap, summary: `Swap ${e3} ${t} for ~${n} ${r} on ${i2} via ${a2}` }), swapApprove: (e3, t, n) => ({ action: w.SwapApprove, summary: `Approve ${e3} ${t} for swap on ${n}` }), bridge: (e3, t, n, r, i2, a2, o3) => ({ action: w.Bridge, summary: `Bridge ${e3} ${t} from ${i2} to ~${n} ${r} on ${a2} via ${o3}` }), bridgeApprove: (e3, t, n) => ({ action: w.BridgeApprove, summary: `Approve ${e3} ${t} for bridge on ${n}` }), predictApprove: (e3) => ({ action: w.PredictApprove, summary: `Approve ${e3} USDC.e for Polymarket deposit` }), predictDeposit: (e3) => ({ action: w.PredictDeposit, summary: `Deposit ${e3} USDC.e to Polymarket as pUSD` }), predictWithdraw: (e3, t) => ({ action: w.PredictWithdraw, summary: `Withdraw ${e3} pUSD from Polymarket to ${t}` }), predictPlace: (e3) => ({ action: w.PredictPlace, summary: `Place ${e3.side} ${e3.size}${e3.outcome ? ` ${e3.outcome}` : ``} shares at $${e3.price}${e3.question ? ` on "${e3.question}"` : ` on Polymarket`}`, details: { side: e3.side, size: String(e3.size), price: `$${e3.price}`, outcome: e3.outcome, question: e3.question, conditionId: e3.conditionId } }), predictRedeem: (e3) => ({ action: w.PredictRedeem, summary: `Redeem winnings${e3.question ? ` on "${e3.question}"` : ``} from Polymarket`, details: { conditionId: e3.conditionId, negRisk: String(e3.negRisk) } }), perpsOpen: (e3) => ({ action: w.PerpsOpen, summary: `Open ${e3.size} ${e3.symbol} ${e3.side} at ${e3.leverage}x on ${e3.venue}` }), perpsClose: (e3) => ({ action: w.PerpsClose, summary: e3.symbols.length === 1 ? `Close ${e3.symbols[0]} position on ${e3.venue}` : `Close ${e3.symbols.length} positions on ${e3.venue}` }), perpsSetLeverage: (e3) => ({ action: w.PerpsModify, summary: `Set ${e3.symbol} leverage to ${e3.leverage}x on ${e3.venue}` }), perpsUpdateTpsl: (e3) => ({ action: w.PerpsModify, summary: `Update ${e3.symbol} TP/SL on ${e3.venue}` }), perpsCancel: (e3) => ({ action: w.PerpsCancel, summary: `Cancel order ${e3.orderId} (${e3.symbol}) on ${e3.venue}` }), perpsDeposit: (e3) => ({ action: w.PerpsDeposit, summary: `Deposit ${e3.amount} USDC to ${e3.venue}` }), perpsWithdraw: (e3) => ({ action: w.PerpsWithdraw, summary: `Withdraw ${e3.amount} USDC from ${e3.venue} to ${e3.destination}` }), perpsApproveBuilderFee: (e3) => ({ action: w.PerpsApproveBuilderFee, summary: `Approve ${e3.venue} builder fee up to ${e3.maxFeeRate} for ${e3.builder}` }), lendingApprove: (e3) => ({ action: w.LendingApprove, summary: `Approve ${e3.token}${e3.protocol ? ` for ${e3.protocol}` : ``} lending` }), lendingSupply: (e3) => ({ action: w.LendingSupply, summary: `Supply ${e3.amount} ${e3.token}${e3.protocol ? ` to ${e3.protocol}` : ``}` }), lendingWithdraw: (e3) => ({ action: w.LendingWithdraw, summary: `Withdraw ${e3.amount} ${e3.token}${e3.all ? ` (all)` : ``}${e3.protocol ? ` from ${e3.protocol}` : ``}` }), custom: (e3) => ({ action: w.Custom, summary: e3 }) };

// node_modules/@metamask/agent-sdk/dist/lib.esm/executions-BmM-p8C6.js
var ee = `balance`;
var te = `/v6/multiaccount/balances`;
var ne = { AccountIds: `accountIds`, Networks: `networks` };
var p3 = `btc.eth.ltc.bch.bnb.eos.xrp.xlm.link.dot.yfi.usd.aed.ars.aud.bdt.bhd.bmd.brl.cad.chf.clp.cny.czk.dkk.eur.gbp.gel.hkd.huf.idr.ils.inr.jpy.krw.kwd.lkr.mmk.mxn.myr.ngn.nok.nzd.php.pkr.pln.rub.sar.sek.sgd.thb.try.twd.uah.vef.vnd.zar.xdr.xag.xau.bits.sats.cop.kes.ron.dop.crc.hnl.zmw.svc.bam.pen.gtq.lbp.amd.sol.sei.sonic.trx.taiko.pepu.pol.mnt.nom.avax.mon.ape.hype.inj.usdt0.pathusd.zeta`.split(`.`);
var ie = new Set(p3);
var m2 = p3.join(`, `);
var oe2 = {};
function se(e3, t, n, r = []) {
  return e3.readContract({ address: t, abi: erc20Abi, functionName: n, args: r });
}
var le = class {
  #e = /* @__PURE__ */ new Map();
  #t;
  constructor(e3) {
    this.#t = e3;
  }
  get(e3) {
    let t = this.#e.get(e3);
    return t || (t = createPublicClient({ transport: http(`gateway` in this.#t ? d3(e3, this.#t.gateway) : this.#t.rpcUrlForChain(e3), { batch: true }) }), this.#e.set(e3, t)), t;
  }
};
var ue = (function(e3) {
  return e3.AccountsApi = `accounts-api`, e3.Rpc = `rpc`, e3;
})({});
function de(e3, t = []) {
  return x([...fe(e3, t), ...me(e3, t)]);
}
function fe(t, n = []) {
  let r = b3(t.chains);
  if (r.length === 0) return [];
  let i2 = h(t), a2 = [];
  for (let o3 of r) {
    let r2 = g(o3, i2);
    if (r2.kind !== `api`) {
      if (r2.kind === `invalid`) throw new e(`INVALID_CHAIN`, `"${o3}" is not a supported network. Run 'mm chains list' to see all available chains, then pass a valid chain name, numeric chain id, or CAIP-2 id (e.g. eip155:1).`);
      if (r2.kind === `missing_rpc_config`) {
        n.push(`${r2.caip2} is in the registry but has no RPC config. Add it via customEvmChains to read its balance.`);
        continue;
      }
      if (a2.push(r2.chain), !t.tokenContracts?.length) {
        let e3 = r2.chain.name ?? r2.chain.caip2;
        n.push(`${e3} is not indexed by the balance API; showing native balance only. Pass --token-contracts <addr,...> to include ERC-20 balances.`);
      }
    }
  }
  return x(a2);
}
function pe(t, i2 = []) {
  let a2 = y2(t.supportedNetworks), o3 = v(t.state.customEvmChains), s4 = new Map(o3.map((e3) => [e3.caip2, e3])), c3 = [...a2].map((e3) => y4(e3, s4)), l3 = b3(t.chains), u2 = _2(t.testnetChainIds).length > 0;
  if (l3.length > 0) {
    let n = h(t);
    return x(l3.flatMap((t2) => {
      let r = g(t2, n);
      if (r.kind === `invalid`) throw new e(`INVALID_CHAIN`, `"${t2}" is not a supported network. Run 'mm chains list' to see all available chains, then pass a valid chain name, numeric chain id, or CAIP-2 id (e.g. eip155:1).`);
      return r.kind === `api` ? [r.chain] : [];
    }));
  }
  if (u2) return [];
  let d5 = new Set(t.wallets.map(C2));
  return c3.filter((e3) => d5.has(e3.namespace === `eip155` ? K.Evm : K.Solana));
}
function me(t, i2 = []) {
  let a2 = _2(t.testnetChainIds);
  if (a2.length === 0) return [];
  let o3 = y2(t.supportedNetworks), s4 = new Map(v(t.state.customEvmChains).map((e3) => [e3.chainId, e3]));
  return x(a2.map((t2) => {
    let n = s4.get(t2);
    if (!n) throw new e(`UNSUPPORTED_BALANCE_NETWORK`, `No configured chain for testnet chain id ${t2}. Run chains:list or add the chain to customEvmChains.`);
    if (o3.has(n.caip2)) throw new e(`UNSUPPORTED_BALANCE_NETWORK`, `Chain id ${t2} is indexed by the Accounts API. Use --chain instead of --testnet-chain-id.`);
    return v2(n);
  })).map((e3) => {
    if (!t.tokenContracts?.length) {
      let t2 = e3.name ?? e3.caip2;
      i2.push(`${t2} is not indexed by the balance API; showing native balance only. Pass --token-contracts <addr,...> to include ERC-20 balances.`);
    }
    return e3;
  });
}
function h(e3) {
  let i2 = y2(e3.supportedNetworks), a2 = v(e3.state.customEvmChains), o3 = new Map(a2.map((e4) => [e4.caip2, e4])), s4 = new Map(a2.map((e4) => [e4.chainId, e4])), c3 = _(e3.supportedNetworks);
  return { fullySupportedCaip2: i2, knownChainsByCaip2: o3, evmChainsById: s4, registryChainIds: new Set(c3.map((e4) => e4.chainId)), registryByChainId: new Map(c3.map((e4) => [e4.chainId, e4])), supportedChains: [...i2].map((e4) => y4(e4, o3)) };
}
function g(e3, t) {
  let n = e3.trim().toLowerCase(), r = /^\d+$/u.test(n) ? `eip155:${n}` : n, i2 = t.supportedChains.find((e4) => e4.caip2.toLowerCase() === r || e4.key?.toLowerCase() === n);
  if (i2) return { kind: `api`, chain: i2 };
  let a2 = [...t.evmChainsById.values()].find((e4) => e4.key?.toLowerCase() === n)?.chainId;
  if (a2 !== void 0 && t.registryChainIds.has(a2)) {
    let e4 = t.evmChainsById.get(a2);
    return e4 ? t.fullySupportedCaip2.has(e4.caip2) ? { kind: `api`, chain: y4(e4.caip2, t.knownChainsByCaip2) } : { kind: `rpc`, chain: v2(e4, t.registryByChainId.get(a2)?.name) } : { kind: `missing_rpc_config`, caip2: `eip155:${a2}` };
  }
  if (t.fullySupportedCaip2.has(r)) return { kind: `api`, chain: y4(r, t.knownChainsByCaip2) };
  let o3 = he(r);
  if (o3 === null || !t.registryChainIds.has(o3)) return { kind: `invalid` };
  let s4 = t.evmChainsById.get(o3);
  return s4 ? { kind: `rpc`, chain: v2(s4, t.registryByChainId.get(o3)?.name) } : { kind: `missing_rpc_config`, caip2: r };
}
function he(e3) {
  if (!e3.startsWith(`eip155:`)) return null;
  let t = Number.parseInt(e3.slice(7), 10);
  return Number.isInteger(t) && t > 0 ? t : null;
}
function _2(t) {
  if (!t?.length) return [];
  let n = /* @__PURE__ */ new Set(), r = [];
  for (let i2 of t) {
    if (!Number.isInteger(i2) || i2 <= 0) throw new e(`INVALID_TESTNET_CHAIN_ID`, `Testnet chain id must be a positive integer. Received ${i2}.`);
    n.has(i2) || (n.add(i2), r.push(i2));
  }
  return r;
}
function v2(e3, t) {
  let n = t ?? e3.name;
  return { caip2: e3.caip2, ...e3.key ? { key: e3.key } : {}, ...n ? { name: n } : {}, namespace: `eip155` };
}
function y4(e3, t) {
  let n = t.get(e3), r = e3.startsWith(`solana:`) ? `solana` : `eip155`;
  return { caip2: e3, ...n?.key ? { key: n.key } : {}, ...n?.name ? { name: n.name } : {}, namespace: r };
}
function b3(e3) {
  return Q((e3 ?? []).flatMap((e4) => e4.split(`,`)).map((e4) => e4.trim()).filter(Boolean));
}
function x(e3) {
  let t = /* @__PURE__ */ new Set(), n = [];
  for (let r of e3) t.has(r.caip2) || (t.add(r.caip2), n.push(r));
  return n;
}
function ge(e3, t) {
  let n = [], r = t.some((e4) => e4.namespace === `eip155`), i2 = t.filter((e4) => e4.namespace === `solana`);
  for (let t2 of e3) {
    let e4 = S3(C2(t2));
    if (e4 === `eip155` && r && n.push(`eip155:0:${t2.address}`), e4 === `solana`) for (let e5 of i2) n.push(`${e5.caip2}:${t2.address}`);
  }
  return Q(n);
}
function _e(e3, t) {
  let n = S3(C2(e3));
  return n === null ? [] : t.filter((e4) => e4.namespace === n);
}
function S3(e3) {
  return e3 === K.Evm ? `eip155` : e3 === K.Solana ? `solana` : null;
}
function C2(e3) {
  return e3.namespace ?? K.Evm;
}
function ve(e3, t) {
  if (Array.isArray(e3.accounts)) {
    let n = [];
    for (let r of e3.accounts) {
      if (!V(r)) {
        t.push(`Skipped a malformed accounts entry.`);
        continue;
      }
      n.push(...ye(r, t));
    }
    return n;
  }
  if (Array.isArray(e3.balances)) {
    let n = [];
    for (let r of e3.balances) {
      if (!V(r)) {
        t.push(`Skipped a malformed balance entry.`);
        continue;
      }
      let e4 = H(r.accountId);
      if (!e4) {
        t.push(`Skipped a flat balance entry with a missing accountId.`);
        continue;
      }
      let i2 = w2(e4, r);
      if (!i2) {
        t.push(`Skipped a balance entry with missing required fields.`);
        continue;
      }
      let a2 = I3(i2.assetId);
      a2 ? n.push(a2 === i2.assetId ? i2 : { ...i2, assetId: a2 }) : t.push(`Unmapped CAIP-2 asset ID "${i2.assetId}" \u2014 skipped for pricing.`);
    }
    return n;
  }
  return [];
}
function ye(e3, t) {
  let n = H(e3.accountId);
  if (!n) return t.push(`Skipped an accounts entry with a missing accountId.`), [];
  if (!Array.isArray(e3.balances)) return [];
  let r = [];
  for (let i2 of e3.balances) {
    if (!V(i2)) {
      t.push(`Skipped a malformed balance entry.`);
      continue;
    }
    let e4 = w2(n, i2);
    if (!e4) {
      t.push(`Skipped a balance entry with missing required fields.`);
      continue;
    }
    let a2 = I3(e4.assetId);
    a2 ? r.push(a2 === e4.assetId ? e4 : { ...e4, assetId: a2 }) : t.push(`Unmapped CAIP-2 asset ID "${e4.assetId}" \u2014 skipped for pricing.`);
  }
  return r;
}
function be(e3) {
  let t = /* @__PURE__ */ new Set(), n = [];
  for (let r of e3) {
    let e4 = ke(r);
    t.has(e4) || (t.add(e4), n.push(r));
  }
  return n;
}
function xe(e3, t) {
  let n = new Set(t.map((e4) => e4.caip2));
  return e3.filter((e4) => {
    let t2 = R2(e4.assetId) ?? L2(e4.accountId);
    return t2 !== null && n.has(t2);
  });
}
function w2(e3, t) {
  let n = H(t.assetId), r = W(t.balance), i2 = Ae(t.decimals), a2 = H(t.name), o3 = H(t.symbol), s4 = H(t.category) ?? H(t.type);
  return !n || !r || i2 === null || !a2 || !o3 || !s4 ? null : { accountId: e3, assetId: n, balance: r, decimals: i2, name: a2, source: `accounts-api`, symbol: o3, type: T3(n, s4), ...typeof t.canonicalHead == `string` ? { canonicalHead: t.canonicalHead } : {}, ...Array.isArray(t.labels) ? { labels: U(t.labels) } : {} };
}
function T3(e3, t) {
  return e3.includes(`/slip44:`) ? `native` : e3.includes(`/erc20:`) ? `erc20` : t;
}
function E(e3, t) {
  return { walletByAddress: new Map(e3.map((e4) => [z(e4.address, C2(e4)), e4])), chainByCaip2: new Map(t.map((e4) => [e4.caip2, e4])) };
}
function D2(e3, t, n, r) {
  let i2 = R2(e3.assetId) ?? L2(e3.accountId) ?? `unknown`, a2 = n.chainByCaip2.get(i2), o3 = Oe(i2), s4 = De(e3.accountId), c3 = n.walletByAddress.get(z(s4, o3)), l3 = t.get(e3.assetId) ?? null, u2 = l3 === null ? null : Ne(e3.balance, l3);
  return { accountId: e3.accountId, wallet: { address: s4, namespace: o3, ...c3?.name ? { name: c3.name } : {} }, chain: { caip2: i2, ...a2?.key ? { key: a2.key } : {}, ...a2?.name ? { name: a2.name } : {} }, assetId: e3.assetId, type: e3.type, symbol: e3.symbol, name: e3.name, balance: e3.balance, decimals: e3.decimals, price: l3, value: u2, currency: r, source: e3.source, ...e3.canonicalHead ? { canonicalHead: e3.canonicalHead } : {}, ...e3.labels ? { labels: e3.labels } : {} };
}
function O(e3, t) {
  let n = /* @__PURE__ */ new Map();
  for (let t2 of e3) n.set(z(t2.address, C2(t2)), { address: t2.address, namespace: C2(t2), ...t2.name ? { name: t2.name } : {}, totalValue: `0`, balanceCount: 0, chains: [] });
  for (let e4 of t) {
    let t2 = z(e4.wallet.address, e4.wallet.namespace), r = n.get(t2) ?? { address: e4.wallet.address, namespace: e4.wallet.namespace, ...e4.wallet.name ? { name: e4.wallet.name } : {}, totalValue: `0`, balanceCount: 0, chains: [] };
    r.balanceCount += 1, e4.value !== null && (r.totalValue = G(r.totalValue, e4.value)), r.chains = Q([...r.chains, e4.chain.caip2]), n.set(t2, r);
  }
  return [...n.values()].sort(Fe);
}
function k(e3) {
  let t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map();
  for (let r of e3) {
    let e4 = n.get(r.chain.caip2) ?? /* @__PURE__ */ new Set(), i2 = `${r.accountId}:${r.assetId}`;
    if (e4.has(i2)) continue;
    e4.add(i2), n.set(r.chain.caip2, e4);
    let a2 = t.get(r.chain.caip2) ?? { ...r.chain, totalValue: `0`, balanceCount: 0, assets: [] };
    a2.balanceCount += 1, r.value !== null && (a2.totalValue = G(a2.totalValue, r.value)), a2.assets = [...a2.assets, r].sort(Le), t.set(r.chain.caip2, a2);
  }
  return [...t.values()].sort(Ie);
}
function A2(e3) {
  return e3.reduce((e4, t) => t.value === null ? e4 : G(e4, t.value), `0`);
}
function we(e3, t) {
  return V(e3) ? W(e3[t]) || W(e3.price) : null;
}
function P(t) {
  let n = (t ?? `usd`).trim().toLowerCase();
  if (!n) throw new e(`INVALID_BALANCE_CURRENCY`, `Balance currency cannot be empty.`);
  if (!F(n)) throw new e(`UNSUPPORTED_BALANCE_CURRENCY`, `Unsupported balance currency "${n}". Supported currencies: ${m2}`);
  return n;
}
function F(e3) {
  return ie.has(e3.trim().toLowerCase());
}
function Te(e3, t) {
  let n = e3.endsWith(`/`) ? e3 : `${e3}/`, r = t.replace(/^\/+/u, ``);
  return new URL(r, n);
}
var Ee = { eip155: `60`, solana: `501` };
function I3(e3) {
  if (e3.includes(`/`)) return e3;
  let t = e3.indexOf(`:`);
  if (t < 1) return null;
  let n = Ee[e3.slice(0, t)];
  return n ? `${e3}/slip44:${n}` : null;
}
function L2(e3) {
  let t = e3.split(`:`);
  return t.length >= 3 ? `${t[0]}:${t[1]}` : null;
}
function R2(e3) {
  let t = e3.indexOf(`/`);
  return t > 0 ? e3.slice(0, t) : null;
}
function De(e3) {
  return e3.split(`:`).slice(2).join(`:`);
}
function Oe(e3) {
  return e3.startsWith(`solana:`) ? K.Solana : K.Evm;
}
function z(e3, t) {
  return `${t}:${t === K.Evm ? e3.toLowerCase() : e3}`;
}
function ke(e3) {
  return `${B(e3.accountId)}:${B(e3.assetId)}`;
}
function B(e3) {
  return (L2(e3) ?? R2(e3))?.startsWith(`eip155:`) ? e3.toLowerCase() : e3;
}
function V(e3) {
  return typeof e3 == `object` && !!e3;
}
function H(e3) {
  return typeof e3 == `string` && e3.trim() ? e3.trim() : null;
}
function Ae(e3) {
  return typeof e3 == `number` && Number.isSafeInteger(e3) ? e3 : null;
}
function U(e3) {
  return Array.isArray(e3) ? e3.filter((e4) => typeof e4 == `string` && e4.trim().length > 0) : [];
}
function je(t, n) {
  if (!Number.isSafeInteger(n) || n <= 0) throw new e(`INVALID_BALANCE_CHUNK_SIZE`, `Balance chunk size must be a positive integer.`);
  let r = [];
  for (let e3 = 0; e3 < t.length; e3 += n) r.push(t.slice(e3, e3 + n));
  return r;
}
function Me(e3) {
  if (e3?.aborted) throw typeof DOMException == `function` ? new DOMException(`Aborted`, `AbortError`) : Object.assign(Error(`Aborted`), { name: `AbortError` });
}
function W(e3) {
  let t = K2(e3);
  return t === null ? null : Y2(q(t));
}
function Ne(e3, t) {
  let n = q(e3), r = q(t);
  return Y2({ units: n.units * r.units, scale: n.scale + r.scale });
}
function G(e3, t) {
  let n = q(e3), r = q(t), i2 = Math.max(n.scale, r.scale);
  return Y2({ units: J(n, i2) + J(r, i2), scale: i2 });
}
function K2(e3) {
  if (typeof e3 == `number`) return Number.isFinite(e3) ? K2(e3.toString()) : null;
  if (typeof e3 != `string` || !e3.trim()) return null;
  let t = e3.trim();
  return /e/iu.test(t) ? Pe(t) : t;
}
function Pe(e3) {
  let t = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/u.exec(e3);
  if (!t) return null;
  let [, n, r, i2 = ``, a2] = t, o3 = Number.parseInt(a2, 10), s4 = `${r}${i2}`, c3 = r.length + o3;
  return c3 <= 0 ? `${n}0.${`0`.repeat(Math.abs(c3))}${s4}` : c3 >= s4.length ? `${n}${s4}${`0`.repeat(c3 - s4.length)}` : `${n}${s4.slice(0, c3)}.${s4.slice(c3)}`;
}
function q(t) {
  let n = t.startsWith(`-`) ? -1n : 1n, r = t.replace(/^[+-]/u, ``);
  if (!/^\d+(\.\d+)?$/u.test(r)) throw new e(`INVALID_BALANCE_AMOUNT`, `Invalid balance amount "${t}".`);
  let [i2, a2 = ``] = r.split(`.`), o3 = a2.replace(/0+$/u, ``);
  return { units: n * BigInt(`${i2 || `0`}${o3}`), scale: o3.length };
}
function J(e3, t) {
  return e3.units * 10n ** BigInt(t - e3.scale);
}
function Y2(e3) {
  let t = e3.units < 0n ? `-` : ``, n = e3.units < 0n ? -e3.units : e3.units;
  if (e3.scale === 0) return `${t}${n}`;
  let r = n.toString().padStart(e3.scale + 1, `0`), i2 = r.slice(0, -e3.scale) || `0`, a2 = r.slice(-e3.scale).replace(/0+$/u, ``);
  return a2 ? `${t}${i2}.${a2}` : `${t}${i2}`;
}
function Fe(e3, t) {
  return Z2(e3.namespace, t.namespace) || Z2(e3.address.toLowerCase(), t.address.toLowerCase());
}
function Ie(e3, t) {
  return X2(t.totalValue, e3.totalValue) || Z2(e3.caip2, t.caip2);
}
function Le(e3, t) {
  return e3.value === null && t.value !== null ? 1 : e3.value !== null && t.value === null ? -1 : (e3.value !== null && t.value !== null ? X2(t.value, e3.value) : 0) || Z2(e3.symbol, t.symbol) || Z2(e3.assetId, t.assetId);
}
function X2(e3, t) {
  let n = q(e3), r = q(t), i2 = Math.max(n.scale, r.scale), a2 = J(n, i2), o3 = J(r, i2);
  return a2 < o3 ? -1 : +(a2 > o3);
}
function Z2(e3, t) {
  return e3 < t ? -1 : +(e3 > t);
}
function Q(e3) {
  return [...new Set(e3)];
}
function $(e3, t, n) {
  return { target: getAddress(e3), value: t, callData: n };
}
function Re(e3, t, n) {
  return $(e3, 0n, encodeFunctionData({ abi: Z, functionName: `transfer`, args: [t, n] }));
}

// node_modules/@metamask/agent-sdk/dist/lib.esm/walletExecutor-CwB8p4-C.js
function d4(t, n) {
  let r = t.trim();
  if (!isAddress(r)) throw new e(`INVALID_EVM_ADDRESS`, `${n} must be a hex EVM address.`);
  return r;
}
function f3(e3) {
  return isHex(e3, { strict: true }) ? e3 : stringToHex(e3);
}

// node_modules/@metamask/keyring-api/dist/btc/constants.mjs
var BtcScope;
(function(BtcScope2) {
  BtcScope2["Mainnet"] = "bip122:000000000019d6689c085ae165831e93";
  BtcScope2["Testnet"] = "bip122:000000000933ea01ad0ee984209779ba";
  BtcScope2["Testnet4"] = "bip122:00000000da84f2bafbbc53dee25a72ae";
  BtcScope2["Signet"] = "bip122:00000008819873e925422c1ff0f99f7c";
  BtcScope2["Regtest"] = "bip122:regtest";
})(BtcScope || (BtcScope = {}));

// node_modules/@metamask/keyring-api/dist/sol/constants.mjs
var SolScope;
(function(SolScope2) {
  SolScope2["Devnet"] = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
  SolScope2["Mainnet"] = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  SolScope2["Testnet"] = "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z";
})(SolScope || (SolScope = {}));

// node_modules/@metamask/keyring-api/dist/trx/constants.mjs
var TrxScope;
(function(TrxScope2) {
  TrxScope2["Mainnet"] = "tron:728126428";
  TrxScope2["Nile"] = "tron:3448148188";
  TrxScope2["Shasta"] = "tron:2494104990";
})(TrxScope || (TrxScope = {}));

// node_modules/@metamask/keyring-api/dist/xlm/constants.mjs
var XlmScope;
(function(XlmScope2) {
  XlmScope2["Pubnet"] = "stellar:pubnet";
  XlmScope2["Testnet"] = "stellar:testnet";
})(XlmScope || (XlmScope = {}));

// node_modules/@metamask/bridge-controller/dist/constants/chains.mjs
var CHAIN_IDS = {
  MAINNET: "0x1",
  GOERLI: "0x5",
  LOCALHOST: "0x539",
  BSC: "0x38",
  BSC_TESTNET: "0x61",
  OPTIMISM: "0xa",
  OPTIMISM_TESTNET: "0xaa37dc",
  OPTIMISM_GOERLI: "0x1a4",
  BASE: "0x2105",
  BASE_TESTNET: "0x14a33",
  OPBNB: "0xcc",
  OPBNB_TESTNET: "0x15eb",
  POLYGON: "0x89",
  POLYGON_TESTNET: "0x13881",
  AVALANCHE: "0xa86a",
  AVALANCHE_TESTNET: "0xa869",
  FANTOM: "0xfa",
  FANTOM_TESTNET: "0xfa2",
  CELO: "0xa4ec",
  ARBITRUM: "0xa4b1",
  HARMONY: "0x63564c40",
  PALM: "0x2a15c308d",
  SEPOLIA: "0xaa36a7",
  HOLESKY: "0x4268",
  LINEA_GOERLI: "0xe704",
  LINEA_SEPOLIA: "0xe705",
  AMOY: "0x13882",
  BASE_SEPOLIA: "0x14a34",
  BLAST_SEPOLIA: "0xa0c71fd",
  OPTIMISM_SEPOLIA: "0xaa37dc",
  PALM_TESTNET: "0x2a15c3083",
  CELO_TESTNET: "0xaef3",
  ZK_SYNC_ERA_TESTNET: "0x12c",
  MANTA_SEPOLIA: "0x138b",
  UNICHAIN_SEPOLIA: "0x515",
  LINEA_MAINNET: "0xe708",
  AURORA: "0x4e454152",
  MOONBEAM: "0x504",
  MOONBEAM_TESTNET: "0x507",
  MOONRIVER: "0x505",
  CRONOS: "0x19",
  GNOSIS: "0x64",
  ZKSYNC_ERA: "0x144",
  TEST_ETH: "0x539",
  ARBITRUM_GOERLI: "0x66eed",
  BLAST: "0x13e31",
  FILECOIN: "0x13a",
  POLYGON_ZKEVM: "0x44d",
  SCROLL: "0x82750",
  SCROLL_SEPOLIA: "0x8274f",
  WETHIO: "0x4e",
  CHZ: "0x15b38",
  NUMBERS: "0x290b",
  SEI: "0x531",
  APE_TESTNET: "0x8157",
  APE_MAINNET: "0x8173",
  BERACHAIN: "0x138d5",
  METACHAIN_ONE: "0x1b6e6",
  ARBITRUM_SEPOLIA: "0x66eee",
  NEAR: "0x18d",
  NEAR_TESTNET: "0x18e",
  B3: "0x208d",
  B3_TESTNET: "0x7c9",
  GRAVITY_ALPHA_MAINNET: "0x659",
  GRAVITY_ALPHA_TESTNET_SEPOLIA: "0x34c1",
  LISK: "0x46f",
  LISK_SEPOLIA: "0x106a",
  INK_SEPOLIA: "0xba5eD",
  INK: "0xdef1",
  MODE_SEPOLIA: "0x397",
  MODE: "0x868b",
  MONAD: "0x8f",
  HYPEREVM: "0x3e7",
  MEGAETH: "0x10e6",
  ARC: "0x13b2",
  ROBINHOOD: "0x1237"
};
var NETWORK_TYPES = {
  GOERLI: "goerli",
  LOCALHOST: "localhost",
  MAINNET: "mainnet",
  SEPOLIA: "sepolia",
  LINEA_GOERLI: "linea-goerli",
  LINEA_SEPOLIA: "linea-sepolia",
  LINEA_MAINNET: "linea-mainnet"
};
var MAINNET_DISPLAY_NAME = "Ethereum Mainnet";
var GOERLI_DISPLAY_NAME = "Goerli";
var SEPOLIA_DISPLAY_NAME = "Sepolia";
var LINEA_GOERLI_DISPLAY_NAME = "Linea Goerli";
var LINEA_SEPOLIA_DISPLAY_NAME = "Linea Sepolia";
var LINEA_MAINNET_DISPLAY_NAME = "Linea Mainnet";
var LOCALHOST_DISPLAY_NAME = "Localhost 8545";
var BSC_DISPLAY_NAME = "Binance Smart Chain";
var POLYGON_DISPLAY_NAME = "Polygon";
var AVALANCHE_DISPLAY_NAME = "Avalanche Network C-Chain";
var ARBITRUM_DISPLAY_NAME = "Arbitrum One";
var OPTIMISM_DISPLAY_NAME = "OP Mainnet";
var ZK_SYNC_ERA_DISPLAY_NAME = "zkSync Era Mainnet";
var BASE_DISPLAY_NAME = "Base Mainnet";
var SCROLL_DISPLAY_NAME = "Scroll";
var SCROLL_SEPOLIA_DISPLAY_NAME = "Scroll Sepolia";
var OP_BNB_DISPLAY_NAME = "opBNB";
var BERACHAIN_DISPLAY_NAME = "Berachain Artio";
var METACHAIN_ONE_DISPLAY_NAME = "Metachain One Mainnet";
var LISK_DISPLAY_NAME = "Lisk";
var LISK_SEPOLIA_DISPLAY_NAME = "Lisk Sepolia";
var SEI_DISPLAY_NAME = "Sei Network";
var MONAD_DISPLAY_NAME = "Monad";
var HYPEREVM_DISPLAY_NAME = "HyperEVM";
var MEGAETH_DISPLAY_NAME = "MegaETH";
var ARC_DISPLAY_NAME = "Arc";
var ROBINHOOD_DISPLAY_NAME = "Robinhood Chain";
var NETWORK_TO_NAME_MAP = {
  [NETWORK_TYPES.GOERLI]: GOERLI_DISPLAY_NAME,
  [NETWORK_TYPES.MAINNET]: MAINNET_DISPLAY_NAME,
  [NETWORK_TYPES.LINEA_GOERLI]: LINEA_GOERLI_DISPLAY_NAME,
  [NETWORK_TYPES.LINEA_SEPOLIA]: LINEA_SEPOLIA_DISPLAY_NAME,
  [NETWORK_TYPES.LINEA_MAINNET]: LINEA_MAINNET_DISPLAY_NAME,
  [NETWORK_TYPES.LOCALHOST]: LOCALHOST_DISPLAY_NAME,
  [NETWORK_TYPES.SEPOLIA]: SEPOLIA_DISPLAY_NAME,
  [CHAIN_IDS.ARBITRUM]: ARBITRUM_DISPLAY_NAME,
  [CHAIN_IDS.AVALANCHE]: AVALANCHE_DISPLAY_NAME,
  [CHAIN_IDS.BSC]: BSC_DISPLAY_NAME,
  [CHAIN_IDS.BASE]: BASE_DISPLAY_NAME,
  [CHAIN_IDS.GOERLI]: GOERLI_DISPLAY_NAME,
  [CHAIN_IDS.MAINNET]: MAINNET_DISPLAY_NAME,
  [CHAIN_IDS.LINEA_GOERLI]: LINEA_GOERLI_DISPLAY_NAME,
  [CHAIN_IDS.LINEA_MAINNET]: LINEA_MAINNET_DISPLAY_NAME,
  [CHAIN_IDS.LINEA_SEPOLIA]: LINEA_SEPOLIA_DISPLAY_NAME,
  [CHAIN_IDS.LOCALHOST]: LOCALHOST_DISPLAY_NAME,
  [CHAIN_IDS.OPTIMISM]: OPTIMISM_DISPLAY_NAME,
  [CHAIN_IDS.POLYGON]: POLYGON_DISPLAY_NAME,
  [CHAIN_IDS.SCROLL]: SCROLL_DISPLAY_NAME,
  [CHAIN_IDS.SCROLL_SEPOLIA]: SCROLL_SEPOLIA_DISPLAY_NAME,
  [CHAIN_IDS.SEPOLIA]: SEPOLIA_DISPLAY_NAME,
  [CHAIN_IDS.OPBNB]: OP_BNB_DISPLAY_NAME,
  [CHAIN_IDS.ZKSYNC_ERA]: ZK_SYNC_ERA_DISPLAY_NAME,
  [CHAIN_IDS.BERACHAIN]: BERACHAIN_DISPLAY_NAME,
  [CHAIN_IDS.METACHAIN_ONE]: METACHAIN_ONE_DISPLAY_NAME,
  [CHAIN_IDS.LISK]: LISK_DISPLAY_NAME,
  [CHAIN_IDS.LISK_SEPOLIA]: LISK_SEPOLIA_DISPLAY_NAME,
  [CHAIN_IDS.SEI]: SEI_DISPLAY_NAME,
  [CHAIN_IDS.MONAD]: MONAD_DISPLAY_NAME,
  [CHAIN_IDS.HYPEREVM]: HYPEREVM_DISPLAY_NAME,
  [CHAIN_IDS.MEGAETH]: MEGAETH_DISPLAY_NAME,
  [CHAIN_IDS.ARC]: ARC_DISPLAY_NAME,
  [CHAIN_IDS.ROBINHOOD]: ROBINHOOD_DISPLAY_NAME
};

// node_modules/@metamask/bridge-controller/dist/types.mjs
var AssetType;
(function(AssetType2) {
  AssetType2["native"] = "NATIVE";
  AssetType2["token"] = "TOKEN";
  AssetType2["NFT"] = "NFT";
  AssetType2["unknown"] = "UNKNOWN";
})(AssetType || (AssetType = {}));
var SortOrder;
(function(SortOrder2) {
  SortOrder2["COST_ASC"] = "cost_ascending";
  SortOrder2["ETA_ASC"] = "time_descending";
})(SortOrder || (SortOrder = {}));
var StatusTypes;
(function(StatusTypes2) {
  StatusTypes2["SUBMITTED"] = "SUBMITTED";
  StatusTypes2["UNKNOWN"] = "UNKNOWN";
  StatusTypes2["FAILED"] = "FAILED";
  StatusTypes2["PENDING"] = "PENDING";
  StatusTypes2["COMPLETE"] = "COMPLETE";
})(StatusTypes || (StatusTypes = {}));
var ChainId;
(function(ChainId2) {
  ChainId2[ChainId2["ETH"] = 1] = "ETH";
  ChainId2[ChainId2["OPTIMISM"] = 10] = "OPTIMISM";
  ChainId2[ChainId2["BSC"] = 56] = "BSC";
  ChainId2[ChainId2["POLYGON"] = 137] = "POLYGON";
  ChainId2[ChainId2["ZKSYNC"] = 324] = "ZKSYNC";
  ChainId2[ChainId2["BASE"] = 8453] = "BASE";
  ChainId2[ChainId2["ARBITRUM"] = 42161] = "ARBITRUM";
  ChainId2[ChainId2["AVALANCHE"] = 43114] = "AVALANCHE";
  ChainId2[ChainId2["LINEA"] = 59144] = "LINEA";
  ChainId2[ChainId2["SOLANA"] = 1151111081099710] = "SOLANA";
  ChainId2[ChainId2["BTC"] = 20000000000001] = "BTC";
  ChainId2[ChainId2["STELLAR"] = 20000000000002] = "STELLAR";
  ChainId2[ChainId2["TRON"] = 728126428] = "TRON";
  ChainId2[ChainId2["SEI"] = 1329] = "SEI";
  ChainId2[ChainId2["MONAD"] = 143] = "MONAD";
  ChainId2[ChainId2["HYPEREVM"] = 999] = "HYPEREVM";
  ChainId2[ChainId2["MEGAETH"] = 4326] = "MEGAETH";
  ChainId2[ChainId2["ARC"] = 5042] = "ARC";
  ChainId2[ChainId2["ROBINHOOD"] = 4663] = "ROBINHOOD";
})(ChainId || (ChainId = {}));
var RequestStatus;
(function(RequestStatus2) {
  RequestStatus2[RequestStatus2["LOADING"] = 0] = "LOADING";
  RequestStatus2[RequestStatus2["FETCHED"] = 1] = "FETCHED";
  RequestStatus2[RequestStatus2["ERROR"] = 2] = "ERROR";
})(RequestStatus || (RequestStatus = {}));

// node_modules/@metamask/bridge-controller/dist/utils/bridge.mjs
init_lib();
var import_metamask_eth_abis = __toESM(require_dist(), 1);

// node_modules/@metamask/bridge-controller/dist/constants/tokens.mjs
var DEFAULT_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";
var CURRENCY_SYMBOLS = {
  ARBITRUM: "ETH",
  AVALANCHE: "AVAX",
  BNB: "BNB",
  BUSD: "BUSD",
  CELO: "CELO",
  DAI: "DAI",
  GNOSIS: "XDAI",
  ETH: "ETH",
  FANTOM: "FTM",
  HARMONY: "ONE",
  PALM: "PALM",
  MATIC: "MATIC",
  POL: "POL",
  TEST_ETH: "TESTETH",
  USDC: "USDC",
  USDT: "USDT",
  WETH: "WETH",
  OPTIMISM: "ETH",
  CRONOS: "CRO",
  GLIMMER: "GLMR",
  MOONRIVER: "MOVR",
  ONE: "ONE",
  SOL: "SOL",
  SEI: "SEI",
  BTC: "BTC",
  TRX: "TRX",
  MON: "MON",
  HYPE: "HYPE",
  MEGAETH: "ETH",
  XLM: "XLM",
  ARC: "USDC",
  ROBINHOOD: "ETH"
};
var ETH_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.ETH,
  name: "Ether",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 18,
  iconUrl: ""
};
var BNB_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.BNB,
  name: "Binance Coin",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 18,
  iconUrl: ""
};
var MATIC_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.POL,
  name: "Polygon",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 18,
  iconUrl: ""
};
var AVAX_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.AVALANCHE,
  name: "Avalanche",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 18,
  iconUrl: ""
};
var TEST_ETH_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.TEST_ETH,
  name: "Test Ether",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 18,
  iconUrl: ""
};
var GOERLI_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.ETH,
  name: "Ether",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 18,
  iconUrl: ""
};
var SEPOLIA_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.ETH,
  name: "Ether",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 18,
  iconUrl: ""
};
var ARBITRUM_SWAPS_TOKEN_OBJECT = {
  ...ETH_SWAPS_TOKEN_OBJECT
};
var OPTIMISM_SWAPS_TOKEN_OBJECT = {
  ...ETH_SWAPS_TOKEN_OBJECT
};
var ZKSYNC_ERA_SWAPS_TOKEN_OBJECT = {
  ...ETH_SWAPS_TOKEN_OBJECT
};
var LINEA_SWAPS_TOKEN_OBJECT = {
  ...ETH_SWAPS_TOKEN_OBJECT
};
var BASE_SWAPS_TOKEN_OBJECT = {
  ...ETH_SWAPS_TOKEN_OBJECT
};
var SOLANA_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.SOL,
  name: "Solana",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 9,
  iconUrl: ""
};
var BTC_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.BTC,
  name: "Bitcoin",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 8,
  iconUrl: ""
};
var SEI_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.SEI,
  name: "Sei",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 18,
  iconUrl: ""
};
var TRX_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.TRX,
  name: "Tron",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 6,
  iconUrl: ""
};
var XLM_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.XLM,
  name: "Stellar Lumens",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 7,
  iconUrl: ""
};
var MONAD_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.MON,
  name: "Mon",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 18,
  iconUrl: ""
};
var HYPEREVM_SWAPS_TOKEN_OBJECT = {
  symbol: CURRENCY_SYMBOLS.HYPE,
  name: "Hyperliquid",
  address: DEFAULT_TOKEN_ADDRESS,
  decimals: 18,
  iconUrl: ""
};
var MEGAETH_SWAPS_TOKEN_OBJECT = {
  ...ETH_SWAPS_TOKEN_OBJECT
};
var ROBINHOOD_SWAPS_TOKEN_OBJECT = {
  ...ETH_SWAPS_TOKEN_OBJECT
};
var ARC_SWAPS_TOKEN_OBJECT = {
  symbol: "USDC",
  name: "USDC",
  address: "0x0000000000000000000000000000000000000000",
  decimals: 18,
  iconUrl: ""
};
var SWAPS_CHAINID_DEFAULT_TOKEN_MAP = {
  [CHAIN_IDS.MAINNET]: ETH_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.LOCALHOST]: TEST_ETH_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.BSC]: BNB_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.POLYGON]: MATIC_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.GOERLI]: GOERLI_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.SEPOLIA]: SEPOLIA_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.AVALANCHE]: AVAX_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.OPTIMISM]: OPTIMISM_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.ARBITRUM]: ARBITRUM_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.ZKSYNC_ERA]: ZKSYNC_ERA_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.LINEA_MAINNET]: LINEA_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.BASE]: BASE_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.SEI]: SEI_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.MONAD]: MONAD_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.HYPEREVM]: HYPEREVM_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.MEGAETH]: MEGAETH_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.ARC]: ARC_SWAPS_TOKEN_OBJECT,
  [CHAIN_IDS.ROBINHOOD]: ROBINHOOD_SWAPS_TOKEN_OBJECT,
  [SolScope.Mainnet]: SOLANA_SWAPS_TOKEN_OBJECT,
  [SolScope.Devnet]: SOLANA_SWAPS_TOKEN_OBJECT,
  [BtcScope.Mainnet]: BTC_SWAPS_TOKEN_OBJECT,
  [TrxScope.Mainnet]: TRX_SWAPS_TOKEN_OBJECT,
  [XlmScope.Pubnet]: XLM_SWAPS_TOKEN_OBJECT
};
var SYMBOL_TO_SLIP44_MAP = {
  SOL: "slip44:501",
  BTC: "slip44:0",
  ETH: "slip44:60",
  POL: "slip44:966",
  BNB: "slip44:714",
  AVAX: "slip44:9005",
  TESTETH: "slip44:60",
  SEI: "slip44:19000118",
  TRX: "slip44:195",
  XLM: "slip44:148",
  MON: "slip44:268435779",
  HYPE: "slip44:2457",
  // It won't be displayed - hidden on UI client side
  USDC: "erc20:0x0000000000000000000000000000000000000000"
};

// node_modules/@metamask/controller-utils/dist/util.mjs
var import_ethjs_unit = __toESM(require_lib(), 1);
var import_bn = __toESM(require_bn(), 1);
var import_eth_ens_namehash = __toESM(require_eth_ens_namehash(), 1);
var import_fast_deep_equal = __toESM(require_fast_deep_equal(), 1);
var import_lodash = __toESM(require_lodash(), 1);
function $importDefault(module) {
  if (module?.__esModule) {
    return module.default;
  }
  return module;
}
var BN = $importDefault(import_bn.default);
var ensNamehash = $importDefault(import_eth_ens_namehash.default);
var deepEqual = $importDefault(import_fast_deep_equal.default);
var { memoize } = import_lodash.default;
var TIMEOUT_ERROR = new Error("timeout");
function toChecksumHexAddressUnmemoized(address) {
  if (typeof address !== "string") {
    return address;
  }
  const hexPrefixed = add0x(address);
  if (!isHexString(hexPrefixed)) {
    return hexPrefixed;
  }
  try {
    return getChecksumAddress(hexPrefixed);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid hex address.") {
      return hexPrefixed;
    }
    throw error;
  }
}
var toChecksumHexAddress = memoize(toChecksumHexAddressUnmemoized);
function isValidHexAddressUnmemoized(possibleAddress, { allowNonPrefixed = true } = {}) {
  const addressToCheck = allowNonPrefixed ? add0x(possibleAddress) : possibleAddress;
  if (!isStrictHexString(addressToCheck)) {
    return false;
  }
  return isHexChecksumAddress(addressToCheck);
}
var isValidHexAddress = memoize(isValidHexAddressUnmemoized, (possibleAddress, { allowNonPrefixed = true } = {}) => `${possibleAddress}-${allowNonPrefixed}`);
var convertHexToDecimal = (value = "0x0") => {
  if (isStrictHexString(value)) {
    return parseInt(value, 16);
  }
  return Number(value) ? Number(value) : 0;
};

// node_modules/@metamask/multichain-network-controller/dist/utils.mjs
var toEvmCaipChainId = (chainId) => toCaipChainId(KnownCaipNamespace.Eip155, hexToNumber(chainId).toString());

// node_modules/@metamask/bridge-controller/dist/utils/caip-formatters.mjs
var formatChainIdToCaip = (chainId) => {
  if (isCaipChainId(chainId)) {
    return chainId;
  }
  if (isStrictHexString(chainId)) {
    return toEvmCaipChainId(chainId);
  }
  if (isSolanaChainId(chainId)) {
    return SolScope.Mainnet;
  }
  if (isBitcoinChainId(chainId)) {
    return BtcScope.Mainnet;
  }
  if (isTronChainId(chainId)) {
    return TrxScope.Mainnet;
  }
  if (isStellarChainId(chainId)) {
    if (chainId === XlmScope.Testnet) {
      return XlmScope.Testnet;
    }
    return XlmScope.Pubnet;
  }
  return toEvmCaipChainId(numberToHex(Number(chainId)));
};
var formatChainIdToDec = (chainId) => {
  if (isStrictHexString(chainId)) {
    return convertHexToDecimal(chainId);
  }
  if (chainId === SolScope.Mainnet) {
    return ChainId.SOLANA;
  }
  if (chainId === BtcScope.Mainnet) {
    return ChainId.BTC;
  }
  if (chainId === TrxScope.Mainnet) {
    return ChainId.TRON;
  }
  if (isStellarChainId(chainId)) {
    return ChainId.STELLAR;
  }
  if (isCaipChainId(chainId)) {
    return Number(chainId.split(":").at(-1));
  }
  if (typeof chainId === "string") {
    return parseInt(chainId, 10);
  }
  return chainId;
};
var formatChainIdToHex = (chainId) => {
  if (isStrictHexString(chainId)) {
    return chainId;
  }
  if (typeof chainId === "number" || parseInt(chainId, 10)) {
    return numberToHex(Number(chainId));
  }
  if (isCaipChainId(chainId)) {
    const { reference } = parseCaipChainId(chainId);
    if (isCaipReference(reference) && !isNaN(Number(reference))) {
      return numberToHex(Number(reference));
    }
  }
  throw new Error(`Invalid cross-chain swaps chainId: ${chainId}`);
};
var formatAddressToAssetId = (addressOrAssetId, chainId) => {
  if (isCaipAssetType(addressOrAssetId)) {
    return addressOrAssetId;
  }
  if (!chainId) {
    return void 0;
  }
  const chainIdCaip = formatChainIdToCaip(chainId);
  if (isNativeAddress(addressOrAssetId)) {
    return getNativeAssetForChainId(chainIdCaip).assetId;
  }
  if (chainIdCaip === SolScope.Mainnet) {
    return CaipAssetTypeStruct.create(`${chainIdCaip}/token:${addressOrAssetId}`);
  }
  if (chainIdCaip === TrxScope.Mainnet) {
    return CaipAssetTypeStruct.create(`${chainIdCaip}/trc20:${addressOrAssetId}`);
  }
  if (!isStrictHexString(addressOrAssetId)) {
    return void 0;
  }
  const checksummedAddress = toChecksumHexAddress(addressOrAssetId);
  return CaipAssetTypeStruct.create(`${chainIdCaip}/erc20:${checksummedAddress}`);
};

// node_modules/@metamask/bridge-controller/dist/utils/bridge.mjs
var getNativeAssetCaipAssetType = (chainId, nativeCurrencySymbol) => {
  return `${formatChainIdToCaip(chainId)}/${SYMBOL_TO_SLIP44_MAP[nativeCurrencySymbol]}`;
};
var getNativeAssetForChainId = (chainId) => {
  const chainIdInCaip = formatChainIdToCaip(chainId);
  const nativeToken = SWAPS_CHAINID_DEFAULT_TOKEN_MAP[formatChainIdToCaip(chainId)] ?? SWAPS_CHAINID_DEFAULT_TOKEN_MAP[formatChainIdToHex(chainId)];
  if (!nativeToken) {
    throw new Error(`No XChain Swaps native asset found for chainId: ${chainId}`);
  }
  return {
    ...nativeToken,
    chainId: formatChainIdToDec(chainId),
    assetId: getNativeAssetCaipAssetType(chainIdInCaip, nativeToken.symbol)
  };
};
var isNativeAddress = (address) => address === AddressZero || // bridge and swap apis set the native asset address to zero
address === "" || // assets controllers set the native asset address to an empty string
!address || !isStrictHexString(address) && Object.values(SYMBOL_TO_SLIP44_MAP).some(
  // check if it matches any supported SLIP44 references
  (reference) => address.includes(reference) || reference.endsWith(address)
);
var isSolanaChainId = (chainId) => {
  if (isCaipChainId(chainId)) {
    return chainId === SolScope.Mainnet.toString();
  }
  return chainId.toString() === ChainId.SOLANA.toString();
};
var isBitcoinChainId = (chainId) => {
  if (isCaipChainId(chainId)) {
    return chainId === BtcScope.Mainnet.toString();
  }
  return chainId.toString() === ChainId.BTC.toString();
};
var isTronChainId = (chainId) => {
  if (isCaipChainId(chainId)) {
    return chainId === TrxScope.Mainnet.toString();
  }
  return chainId.toString() === ChainId.TRON.toString();
};
var isStellarChainId = (chainId) => {
  if (isCaipChainId(chainId)) {
    return chainId === XlmScope.Pubnet.toString() || chainId === XlmScope.Testnet.toString();
  }
  return chainId.toString() === ChainId.STELLAR.toString();
};

// node_modules/@metamask/agent-sdk/dist/lib.esm/service-INnBDPbQ.js
function Ve(e3) {
  return oe2[e3] ?? `0xcA11bde05977b3631167028862bE2a173976CA11`;
}
function He(e3) {
  return true;
}
async function Ue(e3, t, n, r) {
  let i2 = await We(e3, r, [{ address: r, abi: multicall3Abi, functionName: `getEthBalance`, args: [t] }, ...n.flatMap((e4) => [{ address: e4, abi: erc20Abi, functionName: `balanceOf`, args: [t] }, { address: e4, abi: erc20Abi, functionName: `decimals` }, { address: e4, abi: erc20Abi, functionName: `symbol` }, { address: e4, abi: erc20Abi, functionName: `name` }])]), a2 = [];
  return n.forEach((e4, t2) => {
    let n2 = 1 + t2 * 4, r2 = V2(i2[n2]);
    if (r2 === 0n) return;
    let o3 = H2(i2[n2 + 2]) || Ge(e4);
    a2.push({ contract: e4, amount: r2, decimals: Number(B2(i2[n2 + 1]) ?? 0), symbol: o3, name: H2(i2[n2 + 3]) || o3 });
  }), { nativeBalance: V2(i2[0]), tokens: a2 };
}
async function We(e3, t, n) {
  return e3.multicall({ multicallAddress: t, allowFailure: true, contracts: n });
}
function B2(e3) {
  return e3?.status === `success` ? e3.result : void 0;
}
function V2(e3) {
  let t = B2(e3);
  return typeof t == `bigint` ? t : 0n;
}
function H2(e3) {
  let t = B2(e3);
  return typeof t == `string` ? t.trim() : ``;
}
function Ge(e3) {
  return `${e3.slice(0, 6)}\u2026${e3.slice(-4)}`;
}
function Ke(e3, t) {
  return formatUnits(e3, t);
}
async function qe(e3) {
  let t = v(e3.customEvmChains), n = new Map(t.map((e4) => [e4.caip2, e4])), r = new Map(t.map((e4) => [e4.chainId, e4])), i2 = e3.tokenContracts ?? [], a2 = [], o3 = Ye(e3.warnings), s4 = new le({ rpcUrlForChain: (t2) => {
    let n2 = r.get(t2);
    if (!n2) throw Error(`No EVM chain configured for chain id ${t2}`);
    return C(n2, { projectId: e3.projectId ?? null, baseUrl: e3.infuraRpcBaseUrl }).rpcTarget;
  } });
  for (let t2 of e3.wallets) {
    Me(e3.signal);
    let r2 = _e(t2, e3.chains).filter((e4) => e4.namespace === `eip155`);
    for (let c3 of r2) {
      Me(e3.signal);
      let r3 = n.get(c3.caip2);
      if (!r3) continue;
      let l3 = s4.get(r3.chainId), u2 = t2.address, d5 = `eip155:0:${u2}`, f4 = o3.limitTokenContracts(i2);
      if (He(r3.chainId)) {
        o3.recordCall();
        let { nativeBalance: e4, tokens: t3 } = await Ue(l3, u2, f4, Ve(r3.chainId));
        a2.push(U2(c3.caip2, d5, e4, r3));
        for (let e5 of t3) a2.push({ accountId: d5, assetId: `${c3.caip2}/erc20:${e5.contract.toLowerCase()}`, balance: formatUnits(e5.amount, e5.decimals), decimals: e5.decimals, name: e5.name, symbol: e5.symbol, type: `erc20`, source: `rpc` });
        continue;
      }
      if (o3.recordCall()) {
        let e4 = await l3.getBalance({ address: u2 });
        a2.push(U2(c3.caip2, d5, e4, r3));
      }
      await Xe(f4, 10, async (t3) => {
        if (Me(e3.signal), !o3.reserveCalls(4)) return;
        let n2 = await Je(l3, u2, t3);
        n2 !== null && a2.push({ accountId: d5, assetId: `${c3.caip2}/erc20:${t3.toLowerCase()}`, balance: formatUnits(n2.amount, n2.decimals), decimals: n2.decimals, name: n2.name, symbol: n2.symbol, type: `erc20`, source: `rpc` });
      });
    }
  }
  return a2;
}
function U2(e3, t, n, r) {
  let i2 = r.nativeCurrency, a2 = typeof i2?.decimals == `number` ? i2.decimals : 18, o3 = typeof i2?.symbol == `string` && i2.symbol.trim() ? i2.symbol : `ETH`, s4 = typeof i2?.name == `string` && i2.name.trim() ? i2.name : r.name ?? `Ether`;
  return { accountId: t, assetId: `${e3}/slip44:60`, balance: Ke(n, a2), decimals: a2, name: s4, symbol: o3, type: `native`, source: `rpc` };
}
async function Je(e3, t, n) {
  let [r, i2, a2, o3] = await Promise.all([se(e3, n, `balanceOf`, [t]), se(e3, n, `decimals`), se(e3, n, `symbol`), se(e3, n, `name`)]);
  if (typeof r != `bigint` || r === 0n) return null;
  let s4 = typeof a2 == `string` && a2.trim() ? a2 : Ze(n);
  return { amount: r, decimals: Number(i2), symbol: s4, name: typeof o3 == `string` && o3.trim() ? o3 : s4 };
}
function Ye(e3) {
  let t = 0, n = false, r = () => {
    n || (n = true, e3?.push(`RPC balance fetch truncated after 50 calls. Narrow --chain or --token-contracts to fetch more.`));
  }, i2 = (e4) => t + e4 > 50 ? (r(), false) : (t += e4, true);
  return { recordCall: () => i2(1), reserveCalls: i2, limitTokenContracts(e4) {
    let n2 = 50 - t;
    if (n2 <= 1) return [];
    let i3 = Math.max(0, Math.floor((n2 - 1) / 4));
    return e4.length <= i3 ? [...e4] : (r(), e4.slice(0, i3));
  } };
}
async function Xe(e3, t, n) {
  if (e3.length === 0) return;
  let r = 0, i2 = Array.from({ length: Math.min(t, e3.length) }, async () => {
    for (; r < e3.length; ) {
      let t2 = e3[r];
      if (r += 1, t2 === void 0) return;
      await n(t2);
    }
  });
  await Promise.all(i2);
}
function Ze(e3) {
  return `${e3.slice(0, 6)}\u2026${e3.slice(-4)}`;
}
function Qe(e3, t) {
  return t.length === 0 ? false : e3.some((e4) => C2(e4) === K.Evm && _e(e4, t).length > 0);
}
var W2 = class {
  #e;
  #t;
  #n;
  #r;
  #i;
  constructor(e3) {
    this.#e = e3.accountsApiBaseUrl, this.#t = e3.priceService, this.#n = e3.infuraRpcBaseUrl, this.#r = new s3({ apiName: ee, getAuthTokenFn: e3.getAuthTokenFn }), this.#i = e3.useAuthToken ?? true;
  }
  async getBalance(e3) {
    let t = P(e3.currency), n = [], r = pe(e3, n), i2 = de(e3, n), a2 = x([...r, ...i2]), o3 = ge(e3.wallets, r), s4 = Qe(e3.wallets, i2);
    if (o3.length === 0 && !s4) throw new e(`NO_BALANCE_ACCOUNTS`, `No wallets are compatible with the requested balance networks.`);
    let c3 = o3.length > 0 ? await this.#a(o3, r, e3.signal) : void 0;
    Me(e3.signal);
    let l3 = i2.length > 0 ? await qe({ wallets: e3.wallets, chains: i2, tokenContracts: e3.tokenContracts, customEvmChains: e3.state.customEvmChains, projectId: e3.projectId, infuraRpcBaseUrl: this.#n, signal: e3.signal, warnings: n }) : [], d5 = xe(be([...c3 ? ve(c3, n) : [], ...l3]), a2), f4 = Q(d5.map((e4) => e4.assetId)), p4 = /* @__PURE__ */ new Map();
    if (f4.length > 0) try {
      p4 = await this.#o(f4, t, n, e3.signal);
    } catch (e4) {
      if (G2(e4)) throw e4;
      n.push(`Price lookup failed: ${K3(e4)}`);
    }
    Me(e3.signal);
    let m3 = E(e3.wallets, a2), h2 = d5.map((e4) => D2(e4, p4, m3, t)), g2 = Q(c3 ? U(c3.unprocessedNetworks) : []), _3 = Q(h2.filter((e4) => e4.price === null).map((e4) => e4.assetId));
    return { currency: t, totalValue: A2(h2), wallets: O(e3.wallets, h2), chains: k(h2), balances: h2, unprocessedNetworks: g2, unpricedAssetIds: _3, warnings: n };
  }
  async #a(e3, t, n) {
    let r = Te(this.#e, te);
    return r.searchParams.set(ne.AccountIds, e3.join(`,`)), r.searchParams.set(ne.Networks, t.map((e4) => e4.caip2).join(`,`)), this.#s(r, `Accounts balances`, n);
  }
  async #o(e3, t, n, r) {
    let i2 = /* @__PURE__ */ new Map();
    for (let a2 of je(e3, 100)) {
      Me(r);
      try {
        let e4 = await this.#t.getSpotPrices({ assetIds: a2, vsCurrency: t, signal: r });
        for (let n2 of a2) {
          let r2 = we(e4[n2], t);
          r2 !== null && i2.set(n2, r2);
        }
      } catch (e4) {
        if (G2(e4)) throw e4;
        n.push(`Spot price lookup failed for ${a2.length} asset(s): ${K3(e4)}`);
      }
    }
    return i2;
  }
  async #s(e3, t, n) {
    return this.#r.fetchJson(e3, { label: t, signal: n, useAuthToken: this.#i });
  }
};
function G2(e3) {
  return e3 instanceof Error && e3.name === `AbortError`;
}
function K3(e3) {
  return e3 instanceof Error ? e3.message : String(e3);
}
async function $e(e3) {
  if (e3.executions.length < 2) return false;
  try {
    let { isSupported: t } = await getIsEip7702UpgradeSupported(e3.walletAddress, toHex(e3.chainId), e3.getEthCode);
    return t;
  } catch {
    return false;
  }
}
function et(e3, t) {
  let n = e3?.trim() ?? ``;
  return !n || n.toLowerCase() === `native` || n.toUpperCase() === t.nativeCurrency.symbol.toUpperCase();
}
function q2(e3, t, n) {
  if (et(e3, t)) return;
  let r = e3.trim();
  if (!isAddress(r)) throw new e(`INVALID_TOKEN`, `Token must be a contract address (got "${r}"). Resolve symbols before calling the wallet service.`);
  return d4(r, n);
}
function tt(e3, t) {
  let n = q2(e3, t, `gas token`);
  if (!n) throw new e(`GASLESS_NATIVE_UNSUPPORTED`, `Gasless relay fees require an ERC-20 gas token.`);
  return n;
}
function nt(e3) {
  if (e3.currency.trim().toLowerCase() === `usd`) return I2(Number(e3.totalValue));
}
function rt(e3) {
  return I2(e3);
}
function it(e3) {
  return { kind: e2.BYOK, getWallets(t) {
    return t ? e3.filter((e4) => e4.namespace === t) : [...e3];
  }, getWallet(t) {
    return pt(e3, t);
  }, snapshot() {
    return [...e3];
  } };
}
var J2 = class {
  keyring;
  signingReady = false;
  unlockPromise;
  constructor(e3) {
    this.config = e3;
  }
  get mode() {
    return this.config.mode;
  }
  async getKeyring() {
    return this.keyring ||= await this.bootKeyring(), this.keyring;
  }
  async createWallet(e3) {
    return this.track(p.WALLET_CREATE_WALLET, async () => {
      if (e3.namespace !== K.Evm) throw new I(e3.namespace);
      let t = await this.getSigningKeyring();
      return t.kind === e2.BYOK ? t.createWallet({ namespace: e3.namespace, name: e3.name ?? void 0 }) : t.createWallet({ namespace: e3.namespace, name: e3.name ?? void 0, deviceInfo: e3.deviceInfo ?? void 0 });
    });
  }
  async listWallets(e3) {
    return this.track(p.WALLET_LIST_WALLETS, async () => {
      let t = (await this.getKeyring()).getWallets();
      return e3 ? t.filter((t2) => t2.namespace === e3) : t;
    });
  }
  async fetchRemoteWallets(e3) {
    return this.track(p.WALLET_FETCH_REMOTE_WALLETS, async () => {
      if (this.config.mode !== e2.Server) throw new e(`LOCAL_JOB_UNSUPPORTED`, `Server-side wallet fetch requires server-wallet mode.`);
      let t = await this.getKeyring(), n;
      try {
        n = await t.listWalletsRemote();
      } catch (e4) {
        if (ft(e4)) return [];
        throw e4;
      }
      let r = n.map(dt);
      return e3 ? r.filter((t2) => (t2.namespace ?? K.Evm) === e3) : r;
    });
  }
  async getWallet(e3) {
    let t = await this.getKeyring();
    if (t.kind === e2.BYOK || !(`id` in e3)) return t.getWallet(e3);
  }
  async getSelectedWallet(e3, t) {
    let n = await this.getKeyring(), r = e3.selectedWallet;
    if (r?.mode === this.config.mode && r.namespace === t) {
      let e4 = await this.getWallet(r.ref);
      if (e4) {
        if (e4.namespace !== t) throw new L(t, e4.namespace);
        return e4;
      }
    }
    try {
      return lt2(n, t);
    } catch (e4) {
      if (e4 instanceof R && this.config.mode === e2.BYOK) return lt2(await this.getSigningKeyring(), t);
      throw e4;
    }
  }
  async snapshotWallets() {
    return (await this.getKeyring()).snapshot();
  }
  async bootstrapByokRoster() {
    let e3 = await this.snapshotWallets();
    return e3.length > 0 || this.config.mode !== e2.BYOK ? e3 : (await this.getSigningKeyring()).snapshot();
  }
  async registerByokWallets(e3 = []) {
    if (this.config.mode !== e2.BYOK) return { registered: [], failed: [] };
    let t = await this.getSigningKeyring();
    if (t.kind !== e2.BYOK) return { registered: [], failed: [] };
    let n = new Set(e3.map((e4) => e4.toLowerCase())), r = [], i2 = [];
    for (let e4 of t.getWallets(K.Evm)) if (!n.has(e4.address.toLowerCase())) try {
      await t.registerWallet(e4.address), r.push(e4.address.toLowerCase());
    } catch (t2) {
      i2.push(e4.address.toLowerCase()), this.config.logger?.warn(`BYOK wallet registration failed for ${e4.address}: ${t2 instanceof Error ? t2.message : String(t2)}`);
    }
    return { registered: r, failed: i2 };
  }
  async getBalance(e3) {
    return this.track(p.WALLET_GET_BALANCE, async () => {
      let t = await this.config.networkRegistry.getSnapshot(e3.signal);
      return new W2({ accountsApiBaseUrl: this.config.accountsApiBaseUrl, priceService: this.config.priceService, infuraRpcBaseUrl: this.config.infuraRpcBaseUrl, getAuthTokenFn: this.config.getAuthTokenFn, useAuthToken: e3.useAuthToken }).getBalance({ ...e3, projectId: this.config.projectId, testnetChainIds: e3.testnetChainIds, tokenContracts: e3.tokenContracts, wallets: [await this.resolveBalanceWallet(e3.state, e3.address)], supportedNetworks: t });
    }, { successProperties: nt });
  }
  createSelectedWallet(e3, t, n) {
    return { mode: this.config.mode, namespace: t, ref: ut(e3, n) };
  }
  async buildEvmClient(e3, t) {
    if (e3.namespace !== K.Evm) throw new L(K.Evm, e3.namespace);
    return new Ct({ stack: wt({ keyring: await this.getSigningKeyring(), address: e3.address, rpcUrl: t.rpcTarget, chainId: t.chainId, gasApiEndpoints: l(t.chainId) }), chain: { type: K.Evm, id: t.chainId, name: t.name ?? `evm:${t.chainId}`, nativeCurrency: t.nativeCurrency } });
  }
  async signEvmMessage(e3) {
    return this.track(p.WALLET_SIGN_MESSAGE, async () => {
      let { wallet: t, chain: n, client: r } = await this.buildSelectedEvmClient(e3), i2 = f3(e3.message), a2 = e3.intent?.summary;
      try {
        if (e3.wait === true) {
          let o4 = await r.signMessage(i2, a2, Z3(e3.signal));
          return { mode: this.config.mode, wallet: t, chain: n, status: c.SIGNED, ...o4 };
        }
        let o3 = await r.submitPersonalSign(i2, a2);
        return this.createPendingSignatureResult({ wallet: t, chain: n, job: o3 });
      } finally {
        r.dispose();
      }
    });
  }
  async signEvmTypedData(e3) {
    return this.track(p.WALLET_SIGN_TYPED_DATA, async () => {
      e3.allowDomainChainIdMismatch || _t(e3.typedData, e3.chainId);
      let t;
      if (e3.allowDomainChainIdMismatch) {
        let n2 = vt(e3.typedData.domain?.chainId);
        n2 !== void 0 && n2 !== e3.chainId && (t = n2);
      }
      let { wallet: n, chain: r, client: i2 } = await this.buildSelectedEvmClient(e3, { signingChainId: t }), a2 = gt(e3);
      try {
        if (e3.wait === true) {
          let t3 = await i2.signTypedData(e3.typedData, a2, Z3(e3.signal));
          return { mode: this.config.mode, wallet: n, chain: r, ...t3, status: c.SIGNED, failureReason: `` };
        }
        let t2 = await i2.submitSignTypedData(e3.typedData, a2);
        return this.createPendingSignatureResult({ wallet: n, chain: r, job: t2 });
      } finally {
        i2.dispose();
      }
    });
  }
  async submitEvmTransaction(e3) {
    return this.track(p.WALLET_SUBMIT_TRANSACTION, async () => {
      let { wallet: t, chain: n, client: r } = await this.buildSelectedEvmClient(e3);
      this.config.logger?.debug(`submitEvmTransaction chainId=${e3.chainId} wait=${e3.wait} waitForReceipt=${e3.waitForReceipt} mode=${this.config.mode}`);
      let i2 = e3.intent?.summary;
      try {
        if (e3.wait === true) {
          let { hash: a3, status: o3 } = await r.sendTransaction(e3.transaction, i2, { ...Z3(e3.signal), ...e3.bridgeQuoteId ? { bridgeQuoteId: e3.bridgeQuoteId } : {} });
          if (this.config.logger?.debug(`submitEvmTransaction hash=${a3} status=${o3}`), e3.waitForReceipt && (await r.waitForReceipt(a3, { pollingInterval: 5e3 })).status === `reverted`) throw new e(`TX_REVERTED`, `Transaction ${a3} reverted on chain ${e3.chainId}.`);
          return { mode: this.config.mode, wallet: t, chain: n, hash: a3, status: o3 };
        }
        let a2 = e3.bridgeQuoteId ? await r.submitTransaction(e3.transaction, i2, void 0, e3.bridgeQuoteId) : await r.submitTransaction(e3.transaction, i2);
        return X3(a2), this.createPendingTransactionResult({ wallet: t, chain: n, job: a2 });
      } finally {
        r.dispose();
      }
    });
  }
  async waitForEvmReceipt(e3) {
    return this.track(p.WALLET_WAIT_FOR_RECEIPT, async () => {
      let { client: t } = await this.buildSelectedEvmClient(e3);
      try {
        if ((await t.waitForReceipt(e3.hash, { pollingInterval: 5e3 })).status === `reverted`) throw new e(`TX_REVERTED`, `Transaction ${e3.hash} reverted on chain ${e3.chainId}.`);
      } finally {
        t.dispose();
      }
    });
  }
  async transferEvmToken(e3) {
    let t;
    return this.track(p.WALLET_TRANSFER, async () => {
      let { wallet: n, chain: r, client: i2 } = await this.buildSelectedEvmClient(e3);
      try {
        let a2 = await this.resolveEvmTransfer(i2, r, e3), o3 = this.#e(r.chainId, a2.tokenAddress, e3.amount, e3.signal);
        await this.assertTransferAmountBalance(i2, n.address, r, a2, e3.amount);
        let s4 = e3.wait === true, c3;
        if (s4) {
          let { hash: t2 } = await i2.sendTransaction(a2.transaction, void 0, Z3(e3.signal));
          c3 = { mode: this.config.mode, wallet: n, chain: r, hash: t2, status: s.CONFIRMED };
        } else {
          let e4 = await i2.submitTransaction(a2.transaction, void 0);
          X3(e4), c3 = this.createPendingTransactionResult({ wallet: n, chain: r, job: e4 });
        }
        return t = await o3, c3;
      } finally {
        i2.dispose();
      }
    }, { successProperties: () => rt(t) });
  }
  async prepareEvmTransfer(e3) {
    let { wallet: t, chain: n, client: r } = await this.buildSelectedEvmClient(e3);
    try {
      let i2 = await this.resolveEvmTransfer(r, n, e3);
      return await this.assertTransferAmountBalance(r, t.address, n, i2, e3.amount), { chainId: n.chainId, transaction: i2.transaction };
    } finally {
      r.dispose();
    }
  }
  async readEvmFundingBalances(e3) {
    let { wallet: t, client: n } = await this.buildSelectedEvmClient(e3);
    try {
      let [r, i2] = await Promise.all([n.getNativeBalance(), n.read({ address: e3.tokenAddress, abi: Z, functionName: `balanceOf`, args: [t.address] })]);
      return { address: t.address, nativeWei: r, tokenBaseUnits: typeof i2.value == `bigint` ? i2.value : 0n };
    } finally {
      n.dispose();
    }
  }
  async isGaslessRelaySupported(e3) {
    let t = await this.config.networkRegistry.getSnapshot();
    return A(e3.relay, e3.chainId, t);
  }
  async shouldRouteToGasless(e3) {
    let { client: t } = await this.buildSelectedEvmClient(e3);
    try {
      return await t.getNativeBalance() === 0n ? true : !await t.isNativeBalanceSufficient(e3.transaction);
    } catch {
      return true;
    } finally {
      t.dispose();
    }
  }
  async quoteGaslessTransfer(e3) {
    let { wallet: t, chain: n, client: r } = await this.buildSelectedEvmClient(e3);
    try {
      let i2 = d4(e3.recipient, `recipient`), a2 = q2(e3.token, n, `token`);
      if (!a2) throw new e(`GASLESS_NATIVE_UNSUPPORTED`, `Gasless transfer requires an ERC-20 token.`);
      let o3 = e3.gasToken ? tt(e3.gasToken, n) : void 0, s4 = BigInt(await r.convertToBaseUnits({ amount: e3.amount, tokenAddress: a2 })), c3 = Re(a2, i2, s4), d5 = await j(e3.relay, { chainId: e3.chainId, from: t.address, executions: [c3], feeToken: o3 }), f4 = e3.chainId === 1 ? d5.feeAmount * 105n / 100n : d5.feeAmount;
      await this.assertGaslessFundingBalances(r, t.address, { transferToken: a2, transferAmount: s4, feeToken: d5.feeToken, feeAmount: f4, feeTokenSymbol: d5.feeTokenSymbol });
      let p4 = Re(d5.feeToken, d5.feeRecipient, f4);
      return { ...d5, feeAmount: f4, token: a2, recipient: i2, amount: s4, executions: [c3, p4] };
    } finally {
      r.dispose();
    }
  }
  async transferGasless(e3) {
    return this.submitGaslessBatch({ state: e3.state, chainId: e3.chainId, executions: e3.quote.executions, intent: e3.intent ?? D.transfer(e3.amount, e3.token?.trim() || e3.quote.token, e3.recipient), ...e3.wait === void 0 ? {} : { wait: e3.wait }, signal: e3.signal, ...e3.onUpdate ? { onUpdate: e3.onUpdate } : {}, ...e3.timeoutMs === void 0 ? {} : { timeoutMs: e3.timeoutMs } });
  }
  async submitGaslessBatch(e3) {
    return this.track(p.WALLET_SUBMIT_TRANSACTION, async () => {
      let { client: t } = await this.buildSelectedEvmClient({ state: e3.state, chainId: e3.chainId });
      try {
        let n = await t.submitGaslessRelay(e3.executions, { intent: e3.intent?.summary, autoUpgrade: e3.autoUpgrade, ...e3.bridgeQuoteId ? { bridgeQuoteId: e3.bridgeQuoteId } : {} });
        if (y(n) && !o2(n)) throw a(n);
        if (e3.wait === false) return e3.onUpdate && await e3.onUpdate(n), this.createTxJobSubmitResult(n);
        let r;
        try {
          y(n) ? r = n : (e3.onUpdate && await e3.onUpdate(n), r = await this.awaitGaslessRelayJob(t, { pollingId: n.requestId, kind: n.kind }, { ...e3.signal ? { signal: e3.signal } : {}, ...e3.onUpdate ? { onUpdate: e3.onUpdate } : {}, ...e3.timeoutMs === void 0 ? {} : { timeoutMs: e3.timeoutMs } }));
        } catch (e4) {
          throw s2(e4, n.requestId);
        }
        if (!o2(r)) throw a(r);
        return this.createTxJobSubmitResult(r);
      } finally {
        t.dispose();
      }
    });
  }
  async isErc7821BatchEligible(e3) {
    if (e3.executions.length < 2) return false;
    let { wallet: t, client: n } = await this.buildSelectedEvmClient({ state: e3.state, chainId: e3.chainId });
    try {
      return await $e({ chainId: e3.chainId, executions: e3.executions, walletAddress: t.address, getEthCode: n.getEthCode() });
    } finally {
      n.dispose();
    }
  }
  async submitErc7821Batch(e3) {
    return this.track(p.WALLET_SUBMIT_TRANSACTION, async () => {
      let { client: t } = await this.buildSelectedEvmClient({ state: e3.state, chainId: e3.chainId });
      try {
        let n = await t.submitErc7821Batch(e3.executions, { intent: e3.intent?.summary, autoUpgrade: e3.autoUpgrade, ...e3.bridgeQuoteId ? { bridgeQuoteId: e3.bridgeQuoteId } : {} });
        if (y(n) && !o2(n)) throw a(n);
        if (e3.wait === false) return e3.onUpdate && await e3.onUpdate(n), this.createTxJobSubmitResult(n);
        let r;
        try {
          y(n) ? r = n : (e3.onUpdate && await e3.onUpdate(n), r = await this.awaitGaslessRelayJob(t, { pollingId: n.requestId, kind: n.kind }, { ...e3.signal ? { signal: e3.signal } : {}, ...e3.onUpdate ? { onUpdate: e3.onUpdate } : {}, ...e3.timeoutMs === void 0 ? {} : { timeoutMs: e3.timeoutMs } }));
        } catch (e4) {
          throw s2(e4, n.requestId);
        }
        if (!o2(r)) throw a(r);
        return this.createTxJobSubmitResult(r);
      } finally {
        t.dispose();
      }
    });
  }
  async buildSolanaClient(e3, t = {}) {
    throw t.rpcTarget ? new e(`SOLANA_CLIENT_UNSUPPORTED`, `Solana wallet client construction is gated on stable Fox Solana keyring adapters.`) : new l2(e3.key);
  }
  async awaitJob(n, r, o3) {
    let s4 = new d2(), c3 = (e3) => e3 === o.AWAITING_MFA ? f(p.WALLET_AWAIT_JOB, e3, { api_name: `wallet` }) : void 0;
    return this.track(p.WALLET_AWAIT_JOB, async () => {
      let e3 = await this.getEvmJobAdapter(n), t = async (t2, r2) => {
        try {
          return await e3.getJobStatus({ pollingId: t2, kind: r2 });
        } catch (i3) {
          if (this.isUnauthorizedError(i3) && this.config.refreshAuthToken) return this.config.logger?.debug(`Auth token expired during polling \u2014 refreshing and retrying...`), await this.refreshTokenAndInvalidateKeyring(), e3 = await this.getEvmJobAdapter(n), e3.getJobStatus({ pollingId: t2, kind: r2 });
          throw i3;
        }
      };
      if (!o3?.onUpdate) {
        let e4 = await T(async (e5) => t(e5, r.kind), r.pollingId, o3);
        return await s4.observeJobStatus(e4.status, c3), e4;
      }
      let { onUpdate: i2, ...a2 } = o3, l3, u2 = await T(async (e4) => {
        let n2 = await t(e4, r.kind), a3 = l3 && `txHash` in l3 ? l3.txHash : void 0, o4 = `txHash` in n2 ? n2.txHash : void 0;
        return (!l3 || n2.status !== l3.status || o4 !== a3) && (await s4.observeJobStatus(n2.status, c3), await i2(n2), l3 = n2), n2;
      }, r.pollingId, a2);
      return await s4.observeJobStatus(u2.status, c3), u2;
    }, { mfaTracker: s4 });
  }
  async getJobStatus(e3, t) {
    return this.track(p.WALLET_GET_JOB_STATUS, async () => (await this.getEvmJobAdapter(e3)).getJobStatus(t));
  }
  async awaitGaslessRelayJob(n, r, o3) {
    let s4 = new d2(), c3 = (e3) => e3 === o.AWAITING_MFA ? f(p.WALLET_AWAIT_JOB, e3, { api_name: `wallet` }) : void 0;
    return this.track(p.WALLET_AWAIT_JOB, async () => {
      let e3 = async () => n.getGaslessRelayJobStatus(r);
      if (!o3?.onUpdate) {
        let t2 = await T(e3, r.pollingId, o3);
        return await s4.observeJobStatus(t2.status, c3), t2;
      }
      let { onUpdate: t, ...i2 } = o3, a2, l3 = await T(async () => {
        let n2 = await e3(), r2 = a2?.txHash;
        return (!a2 || n2.status !== a2.status || n2.txHash !== r2) && (await s4.observeJobStatus(n2.status, c3), await t(n2), a2 = n2), n2;
      }, r.pollingId, i2);
      return await s4.observeJobStatus(l3.status, c3), l3;
    }, { mfaTracker: s4 });
  }
  async resolveEvmTransfer(e3, t, n) {
    let r = d4(n.recipient, `recipient`), i2 = q2(n.token, t, `token`), a2 = await e3.convertToBaseUnits({ amount: n.amount, ...i2 ? { tokenAddress: i2 } : {} }), o3 = BigInt(a2);
    return { transaction: bt({ recipient: r, amountInBaseUnits: a2, tokenAddress: i2 }), tokenAddress: i2, amountBaseUnits: o3 };
  }
  async assertTransferAmountBalance(e3, t, n, r, i2) {
    if (!r.tokenAddress) {
      let t2 = await e3.getNativeBalance();
      if (t2 < r.amountBaseUnits) throw Q2(`${n.nativeCurrency.symbol}`, t2, r.amountBaseUnits, `for transfer of ${i2}`);
      return;
    }
    await this.assertErc20BalanceSufficient(e3, t, r.tokenAddress, r.amountBaseUnits, `transfer token`);
  }
  async assertGaslessFundingBalances(e3, t, n) {
    if (n.transferToken.toLowerCase() === n.feeToken.toLowerCase()) {
      await this.assertErc20BalanceSufficient(e3, t, n.transferToken, n.transferAmount + n.feeAmount, `transfer and gas token`);
      return;
    }
    let [r, i2] = await Promise.all([this.readErc20Balance(e3, t, n.transferToken), this.readErc20Balance(e3, t, n.feeToken)]);
    if (r < n.transferAmount) throw Q2(`token`, r, n.transferAmount);
    if (i2 < n.feeAmount) throw Q2(`gas token (${n.feeTokenSymbol})`, i2, n.feeAmount);
  }
  async readErc20Balance(e3, t, n) {
    let r = await e3.read({ address: n, abi: Z, functionName: `balanceOf`, args: [t] });
    return typeof r.value == `bigint` ? r.value : 0n;
  }
  async assertErc20BalanceSufficient(e3, t, n, r, i2) {
    let a2 = await this.readErc20Balance(e3, t, n);
    if (a2 < r) throw Q2(i2, a2, r);
  }
  async getSigningKeyring() {
    let e3 = await this.getKeyring();
    return this.config.mode !== e2.BYOK || this.signingReady ? e3 : (this.unlockPromise ??= this.unlockKeyring(), await this.unlockPromise, this.keyring);
  }
  async unlockKeyring() {
    if (this.config.mode !== e2.BYOK) return;
    let e3 = await this.config.resolveMnemonic(), t = this.config.serverWalletBaseUrl?.trim(), n = this.config.authToken?.trim();
    if (!t) throw new e(`NO_SIGNING_URL`, `BYOK wallet unlock requires a Mimir signing base URL.`);
    if (!n) throw new e(`NO_AUTH_TOKEN`, `BYOK wallet unlock requires an auth token.`);
    let { keyring: r } = await re({ mode: N.BYOK, input: { mnemonic: e3, wallets: this.config.wallets }, defaultNamespace: this.config.defaultNamespace ?? K.Evm, adapters: [(e4) => new ct(e4)], registration: { baseUrl: t, authToken: n, projectId: this.config.projectId } });
    this.keyring = r, this.signingReady = true;
  }
  isUnauthorizedError(e3) {
    return e3 instanceof S && e3.code === d.UNAUTHORIZED;
  }
  async refreshTokenAndInvalidateKeyring() {
    if (!this.config.refreshAuthToken) throw new e(`NO_REFRESH_CALLBACK`, `Cannot refresh auth token \u2014 no refreshAuthToken callback configured.`);
    let e3 = await this.config.refreshAuthToken();
    return this.config.authToken = e3, this.config.getAuthTokenFn && (this.config.getAuthTokenFn = () => e3), this.keyring = void 0, this.signingReady = false, this.unlockPromise = void 0, e3;
  }
  async bootKeyring() {
    if (this.config.mode === e2.BYOK) return it(this.config.wallets);
    let e3 = this.config.serverWalletBaseUrl;
    if (!e3.trim()) throw new e(`NO_SIGNING_URL`, `Server wallet mode requires a signing base URL.`);
    if (!this.config.authToken.trim()) throw new e(`NO_AUTH_TOKEN`, `Server wallet mode requires an auth token.`);
    if (!this.config.projectId.trim()) throw new e(`NO_PROJECT_ID`, `Server wallet mode requires a project id.`);
    let { keyring: t } = await re({ mode: N.SERVER, input: { baseUrl: e3, authToken: this.config.authToken, projectId: this.config.projectId, wallets: this.config.wallets.map(dt) }, adapters: [(e4) => new lt(e4)] });
    return t;
  }
  async getEvmJobAdapter(e3) {
    if (e3 !== K.Evm) throw new I(e3);
    if (this.config.mode === e2.Server) return X(await this.getKeyring());
    if (this.config.mode === e2.BYOK) return Y(await this.getSigningKeyring());
    throw new e(`LOCAL_JOB_UNSUPPORTED`, "Pending-job polling (`mm watch`) requires server-wallet or server-backed BYOK mode.");
  }
  async getEvmRpcConfig(e3) {
    let t = v(e3.state.customEvmChains).find((t2) => t2.chainId === e3.chainId);
    if (t) return C(t, { projectId: this.config.projectId, baseUrl: this.config.infuraRpcBaseUrl });
    let n = _(await this.config.networkRegistry.getSnapshot()).find((t2) => t2.chainId === e3.chainId);
    if (n) {
      let t2 = { projectId: this.config.projectId, baseUrl: this.config.infuraRpcBaseUrl };
      return S2({ key: `registry-${e3.chainId}`, chainId: e3.chainId, caip2: `eip155:${e3.chainId}`, name: n.name, nativeCurrency: { name: `Ether`, symbol: `ETH`, decimals: 18 } }, d3(e3.chainId, t2));
    }
    throw new e(`UNSUPPORTED_EVM_CHAIN`, `No EVM chain configured for chainId ${e3.chainId}.`);
  }
  async buildSelectedEvmClient(e3, t) {
    let n = await this.getSelectedWallet(e3.state, K.Evm), r = await this.getEvmRpcConfig(e3), i2 = t?.signingChainId !== void 0 && t.signingChainId !== r.chainId ? { ...r, chainId: t.signingChainId } : r;
    return { wallet: n, chain: r, client: await this.buildEvmClient(n, i2) };
  }
  createPendingSignatureResult(e3) {
    let t = y(e3.job) ? void 0 : oe(e3.job, K.Evm);
    return { mode: this.config.mode, wallet: e3.wallet, chain: e3.chain, status: e3.job.status, ...e3.job.failureDescription ? { failureReason: e3.job.failureDescription } : {}, ...e3.job.signature ? { signature: e3.job.signature } : {}, ...t ? { pendingJob: t } : {}, ...e3.job.approval ? { approval: { id: e3.job.approval.approvalId } } : {}, job: e3.job };
  }
  createPendingTransactionResult(e3) {
    let t = y(e3.job) ? void 0 : oe(e3.job, K.Evm);
    return { mode: this.config.mode, wallet: e3.wallet, chain: e3.chain, status: e3.job.status, ...e3.job.failureDescription ? { failureReason: e3.job.failureDescription } : {}, ...e3.job.txHash ? { hash: e3.job.txHash } : {}, ...t ? { pendingJob: t } : {}, ...e3.job.approval ? { approval: { id: e3.job.approval.approvalId } } : {}, job: e3.job };
  }
  createTxJobSubmitResult(e3) {
    let t = y(e3) ? void 0 : oe(e3, K.Evm);
    return { uuid: e3.requestId, status: e3.status, ...e3.failureDescription ? { failureReason: e3.failureDescription } : {}, ...e3.txHash ? { hash: e3.txHash } : {}, ...t ? { pendingJob: t } : {}, job: e3 };
  }
  track(t, n, i2 = {}) {
    let a2 = i2.mfaTracker ?? new d2();
    return T2(t, async () => {
      let e3 = await n();
      return e3 && typeof e3 == `object` && `status` in e3 && typeof e3.status == `string` && await a2.observeJobStatus(e3.status, () => void 0), e3;
    }, { api_name: `wallet` }, { mfaTracker: a2, successProperties: i2.successProperties });
  }
  async resolveBalanceWallet(e3, t) {
    if (this.config.mode === e2.BYOK) {
      if (t) {
        let e4 = await this.getWallet({ address: t });
        if (!e4) throw new R({ address: t });
        return e4;
      }
      let n2 = e3.selectedWallet?.mode === this.config.mode ? e3.selectedWallet.namespace : K.Evm;
      return this.getSelectedWallet(e3, n2);
    }
    let n = this.config.wallets;
    if (t) {
      let e4 = n.find((e5) => e5.address.toLowerCase() === t.toLowerCase());
      if (!e4) throw new R({ address: t });
      return e4;
    }
    let r = e3.selectedWallet;
    if (r?.mode === this.config.mode) {
      let e4 = mt(n, r.ref);
      if (e4) return e4;
    }
    let i2 = r?.namespace ?? K.Evm, a2 = n.find((e4) => ht(e4) === i2) ?? n[0];
    if (!a2) throw new R({ name: `balance wallet` });
    return a2;
  }
  async #e(e3, t, n, r) {
    let i2 = this.config.priceService;
    if (i2) try {
      let a2 = formatAddressToAssetId(t ?? zeroAddress, e3);
      if (!a2) return;
      let o3 = await i2.getSpotPrices({ assetIds: [a2], vsCurrency: `usd`, ...r ? { signal: r } : {} }), s4 = we(o3[a2] ?? o3[a2.toLowerCase()], `usd`);
      if (!s4) return;
      let c3 = Number(s4);
      if (!Number.isFinite(c3) || c3 <= 0) return;
      let l3 = Number(n);
      if (!Number.isFinite(l3) || l3 <= 0) return;
      let u2 = l3 * c3;
      return !Number.isFinite(u2) || u2 <= 0 ? void 0 : u2;
    } catch {
      return;
    }
  }
};
function Y3(e3) {
  return new J2(e3);
}
function lt2(e3, t) {
  let n = (e3.kind === e2.BYOK ? e3.getWallets(t) : e3.getWallets().filter((e4) => e4.namespace === t))[0];
  if (!n) throw new R({ name: `default ${t} wallet` });
  return n;
}
function ut(e3, t) {
  return `id` in e3 && e3.id ? { id: e3.id } : e3.address ? { address: e3.address } : e3.name ? { name: e3.name } : t;
}
function dt(e3) {
  return { ...e3, namespace: e3.namespace ?? K.Evm };
}
function ft(e3) {
  if (!e3 || typeof e3 != `object`) return false;
  let t = e3;
  return t.code === d.NOT_FOUND && t.status === 404;
}
function pt(e3, t) {
  return `id` in t ? e3.find((e4) => e4.id === t.id) : `address` in t ? e3.find((e4) => e4.address.toLowerCase() === t.address.toLowerCase()) : e3.find((e4) => e4.name === t.name);
}
function mt(e3, t) {
  return `id` in t ? e3.find((e4) => `id` in e4 && e4.id === t.id) : `address` in t ? e3.find((e4) => e4.address.toLowerCase() === t.address.toLowerCase()) : e3.find((e4) => e4.name === t.name);
}
function ht(e3) {
  return e3.namespace ?? K.Evm;
}
function X3(e3) {
  if (!y(e3) || e3.status === s.CONFIRMED) return;
  let t = e3.failureCode ? ` (${e3.failureCode})` : ``;
  throw new e(`TRANSACTION_REQUEST_FAILED`, e3.failureDescription ?? `Transaction request ${e3.requestId} ended in status ${e3.status}${t}.`, e3.requestId, e3.status, e3.failureCode);
}
function gt(e3) {
  let t = e3.intent?.summary;
  if (!(t === void 0 && e3.protocol === void 0 && e3.protocolPayload === void 0)) return { ...t === void 0 ? {} : { intent: t }, ...e3.protocol === void 0 ? {} : { protocol: e3.protocol }, ...e3.protocolPayload === void 0 ? {} : { protocolPayload: e3.protocolPayload } };
}
function _t(e3, t) {
  let n = e3.domain, r = vt(n?.chainId);
  if (r !== void 0 && r !== t) throw new e(`CHAIN_ID_MISMATCH`, `Typed-data domain chainId ${r} does not match EVM chain ${t}.`);
}
function vt(e3) {
  if (e3 != null) {
    if (typeof e3 == `number` && Number.isSafeInteger(e3)) return e3;
    if (typeof e3 == `bigint`) return yt(e3);
    if (typeof e3 == `string` && /^(0x[0-9a-f]+|\d+)$/iu.test(e3)) return yt(BigInt(e3));
    throw new e(`INVALID_TYPED_DATA`, `Typed-data domain.chainId must be a safe integer, decimal string, or 0x-prefixed string.`);
  }
}
function yt(e3) {
  if (e3 < 0n || e3 > BigInt(2 ** 53 - 1)) throw new e(`INVALID_TYPED_DATA`, `Typed-data domain.chainId must be a safe non-negative integer.`);
  return Number(e3);
}
function Z3(e3) {
  return e3 ? { signal: e3 } : void 0;
}
function Q2(e3, t, n, r) {
  return new e(`INSUFFICIENT_BALANCE`, `Insufficient ${e3} balance${r ? ` ${r}` : ` for this transfer`}. Balance=${t.toString()} RequiredBalance=${n.toString()}.`);
}
function bt(e3) {
  let t = BigInt(e3.amountInBaseUnits);
  return e3.tokenAddress ? { to: e3.tokenAddress, abi: Z, functionName: `transfer`, args: [e3.recipient, t] } : { to: e3.recipient, value: t };
}
function $2(e3) {
  return e3?.walletMode ?? null;
}
function xt(e3) {
  let t = e3.session?.cliToken, n = e3.session?.projectId;
  if (!t) throw new e(`NO_AUTH_TOKEN`, `Wallet service requires an auth token.`);
  if (!n) throw new e(`NO_PROJECT_ID`, `Wallet service requires a project id.`);
  if ($2(e3.session) === M.Byok) {
    if (!e3.serverWalletBaseUrl?.trim()) throw new e(`NO_SIGNING_URL`, `Server-backed BYOK requires a signing base URL.`);
    return Y3({ mode: e2.BYOK, authToken: t, projectId: n, serverWalletBaseUrl: e3.serverWalletBaseUrl, resolveMnemonic: e3.resolveMnemonic, wallets: e3.walletState.byokWallets, defaultNamespace: e3.defaultNamespace, accountsApiBaseUrl: e3.accountsApiBaseUrl, infuraRpcBaseUrl: e3.infuraRpcBaseUrl, priceService: e3.priceService, getAuthTokenFn: () => t, networkRegistry: e3.networkRegistry, logger: e3.logger, ...e3.refreshAuthToken ? { refreshAuthToken: e3.refreshAuthToken } : {} });
  }
  if (!e3.serverWalletBaseUrl?.trim()) throw new e(`NO_SIGNING_URL`, `Server wallet mode requires a signing base URL.`);
  return Y3({ mode: e2.Server, authToken: t, projectId: n, serverWalletBaseUrl: e3.serverWalletBaseUrl, wallets: e3.walletState.remoteWallets, accountsApiBaseUrl: e3.accountsApiBaseUrl, infuraRpcBaseUrl: e3.infuraRpcBaseUrl, priceService: e3.priceService, getAuthTokenFn: () => t, networkRegistry: e3.networkRegistry, logger: e3.logger, ...e3.refreshAuthToken ? { refreshAuthToken: e3.refreshAuthToken } : {} });
}

export {
  v,
  S2 as S,
  xt
};
