import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  E,
  T2 as T
} from "./chunk-5SRSLBJ2.mjs";
import {
  require_dist,
  require_semver
} from "./chunk-XUIZAIKJ.mjs";
import {
  __commonJS,
  __toESM
} from "./chunk-UST3XQO6.mjs";

// node_modules/@metamask/browser-passworder/dist/index.js
var require_dist2 = __commonJS({
  "node_modules/@metamask/browser-passworder/dist/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.isVaultUpdated = exports.updateVaultWithDetail = exports.updateVault = exports.generateSalt = exports.serializeBufferForStorage = exports.serializeBufferFromStorage = exports.keyFromPassword = exports.exportKey = exports.importKey = exports.decryptWithKey = exports.decryptWithDetail = exports.decrypt = exports.encryptWithKey = exports.encryptWithDetail = exports.encrypt = void 0;
    var utils_1 = require_dist();
    var EXPORT_FORMAT = "jwk";
    var DERIVED_KEY_FORMAT = "AES-GCM";
    var STRING_ENCODING = "utf-8";
    var OLD_DERIVATION_PARAMS = {
      algorithm: "PBKDF2",
      params: {
        iterations: 1e4
      }
    };
    var DEFAULT_DERIVATION_PARAMS = {
      algorithm: "PBKDF2",
      params: {
        iterations: 9e5
      }
    };
    async function encrypt(password, dataObj, key, salt = generateSalt(), keyDerivationOptions = DEFAULT_DERIVATION_PARAMS) {
      const cryptoKey = key || await keyFromPassword(password, salt, false, keyDerivationOptions);
      const payload = await encryptWithKey(cryptoKey, dataObj);
      payload.salt = salt;
      return JSON.stringify(payload);
    }
    exports.encrypt = encrypt;
    async function encryptWithDetail(password, dataObj, salt = generateSalt(), keyDerivationOptions = DEFAULT_DERIVATION_PARAMS) {
      const key = await keyFromPassword(password, salt, true, keyDerivationOptions);
      const exportedKeyString = await exportKey(key);
      const vault = await encrypt(password, dataObj, key, salt);
      return {
        vault,
        exportedKeyString
      };
    }
    exports.encryptWithDetail = encryptWithDetail;
    async function encryptWithKey(encryptionKey, dataObj) {
      const data = JSON.stringify(dataObj);
      const dataBuffer = Buffer.from(data, STRING_ENCODING);
      const vector = globalThis.crypto.getRandomValues(new Uint8Array(16));
      const key = unwrapKey(encryptionKey);
      const buf = await globalThis.crypto.subtle.encrypt({
        name: DERIVED_KEY_FORMAT,
        iv: vector
      }, key, dataBuffer);
      const buffer = new Uint8Array(buf);
      const vectorStr = Buffer.from(vector).toString("base64");
      const vaultStr = Buffer.from(buffer).toString("base64");
      const encryptionResult = {
        data: vaultStr,
        iv: vectorStr
      };
      if (isEncryptionKey(encryptionKey)) {
        encryptionResult.keyMetadata = encryptionKey.derivationOptions;
      }
      return encryptionResult;
    }
    exports.encryptWithKey = encryptWithKey;
    async function decrypt(password, text, encryptionKey) {
      const payload = JSON.parse(text);
      const { salt, keyMetadata } = payload;
      const cryptoKey = unwrapKey(encryptionKey || await keyFromPassword(password, salt, false, keyMetadata));
      const result = await decryptWithKey(cryptoKey, payload);
      return result;
    }
    exports.decrypt = decrypt;
    async function decryptWithDetail(password, text) {
      const payload = JSON.parse(text);
      const { salt, keyMetadata } = payload;
      const key = await keyFromPassword(password, salt, true, keyMetadata);
      const exportedKeyString = await exportKey(key);
      const vault = await decrypt(password, text, key);
      return {
        exportedKeyString,
        vault,
        salt
      };
    }
    exports.decryptWithDetail = decryptWithDetail;
    async function decryptWithKey(encryptionKey, payload) {
      const encryptedData = Buffer.from(payload.data, "base64");
      const vector = Buffer.from(payload.iv, "base64");
      const key = unwrapKey(encryptionKey);
      let decryptedObj;
      try {
        const result = await crypto.subtle.decrypt({ name: DERIVED_KEY_FORMAT, iv: vector }, key, encryptedData);
        const decryptedData = new Uint8Array(result);
        const decryptedStr = Buffer.from(decryptedData).toString(STRING_ENCODING);
        decryptedObj = JSON.parse(decryptedStr);
      } catch (e2) {
        throw new Error("Incorrect password");
      }
      return decryptedObj;
    }
    exports.decryptWithKey = decryptWithKey;
    async function importKey(keyString) {
      const exportedEncryptionKey = JSON.parse(keyString);
      if (isExportedEncryptionKey(exportedEncryptionKey)) {
        return {
          key: await globalThis.crypto.subtle.importKey(EXPORT_FORMAT, exportedEncryptionKey.key, DERIVED_KEY_FORMAT, true, ["encrypt", "decrypt"]),
          derivationOptions: exportedEncryptionKey.derivationOptions
        };
      }
      return await globalThis.crypto.subtle.importKey(EXPORT_FORMAT, exportedEncryptionKey, DERIVED_KEY_FORMAT, true, ["encrypt", "decrypt"]);
    }
    exports.importKey = importKey;
    async function exportKey(encryptionKey) {
      if (isEncryptionKey(encryptionKey)) {
        return JSON.stringify({
          key: await globalThis.crypto.subtle.exportKey(EXPORT_FORMAT, encryptionKey.key),
          derivationOptions: encryptionKey.derivationOptions
        });
      }
      return JSON.stringify(await globalThis.crypto.subtle.exportKey(EXPORT_FORMAT, encryptionKey));
    }
    exports.exportKey = exportKey;
    async function keyFromPassword(password, salt, exportable = false, opts = OLD_DERIVATION_PARAMS) {
      const passBuffer = Buffer.from(password, STRING_ENCODING);
      const saltBuffer = Buffer.from(salt, "base64");
      const key = await globalThis.crypto.subtle.importKey("raw", passBuffer, { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
      const derivedKey = await globalThis.crypto.subtle.deriveKey({
        name: "PBKDF2",
        salt: saltBuffer,
        iterations: opts.params.iterations,
        hash: "SHA-256"
      }, key, { name: DERIVED_KEY_FORMAT, length: 256 }, exportable, ["encrypt", "decrypt"]);
      return opts ? {
        key: derivedKey,
        derivationOptions: opts
      } : derivedKey;
    }
    exports.keyFromPassword = keyFromPassword;
    function serializeBufferFromStorage(str) {
      const stripStr = str.slice(0, 2) === "0x" ? str.slice(2) : str;
      const buf = new Uint8Array(stripStr.length / 2);
      for (let i = 0; i < stripStr.length; i += 2) {
        const seg = stripStr.substr(i, 2);
        buf[i / 2] = parseInt(seg, 16);
      }
      return buf;
    }
    exports.serializeBufferFromStorage = serializeBufferFromStorage;
    function serializeBufferForStorage(buffer) {
      let result = "0x";
      buffer.forEach((value) => {
        result += unprefixedHex(value);
      });
      return result;
    }
    exports.serializeBufferForStorage = serializeBufferForStorage;
    function unprefixedHex(num) {
      let hex = num.toString(16);
      while (hex.length < 2) {
        hex = `0${hex}`;
      }
      return hex;
    }
    function generateSalt(byteCount = 32) {
      const view = new Uint8Array(byteCount);
      globalThis.crypto.getRandomValues(view);
      const b64encoded = btoa(String.fromCharCode.apply(null, view));
      return b64encoded;
    }
    exports.generateSalt = generateSalt;
    async function updateVault(vault, password, targetDerivationParams = DEFAULT_DERIVATION_PARAMS) {
      if (isVaultUpdated(vault, targetDerivationParams)) {
        return vault;
      }
      return encrypt(password, await decrypt(password, vault), void 0, void 0, targetDerivationParams);
    }
    exports.updateVault = updateVault;
    async function updateVaultWithDetail(encryptionResult, password, targetDerivationParams = DEFAULT_DERIVATION_PARAMS) {
      if (isVaultUpdated(encryptionResult.vault, targetDerivationParams)) {
        return encryptionResult;
      }
      return encryptWithDetail(password, await decrypt(password, encryptionResult.vault), void 0, targetDerivationParams);
    }
    exports.updateVaultWithDetail = updateVaultWithDetail;
    function isEncryptionKey(encryptionKey) {
      return (0, utils_1.isPlainObject)(encryptionKey) && (0, utils_1.hasProperty)(encryptionKey, "key") && (0, utils_1.hasProperty)(encryptionKey, "derivationOptions") && encryptionKey.key instanceof CryptoKey && isKeyDerivationOptions(encryptionKey.derivationOptions);
    }
    function isKeyDerivationOptions(derivationOptions) {
      return (0, utils_1.isPlainObject)(derivationOptions) && (0, utils_1.hasProperty)(derivationOptions, "algorithm") && (0, utils_1.hasProperty)(derivationOptions, "params");
    }
    function isExportedEncryptionKey(exportedKey) {
      return (0, utils_1.isPlainObject)(exportedKey) && (0, utils_1.hasProperty)(exportedKey, "key") && (0, utils_1.hasProperty)(exportedKey, "derivationOptions") && isKeyDerivationOptions(exportedKey.derivationOptions);
    }
    function unwrapKey(encryptionKey) {
      return isEncryptionKey(encryptionKey) ? encryptionKey.key : encryptionKey;
    }
    function isVaultUpdated(vault, targetDerivationParams = DEFAULT_DERIVATION_PARAMS) {
      const { keyMetadata } = JSON.parse(vault);
      return isKeyDerivationOptions(keyMetadata) && keyMetadata.algorithm === targetDerivationParams.algorithm && keyMetadata.params.iterations === targetDerivationParams.params.iterations;
    }
    exports.isVaultUpdated = isVaultUpdated;
  }
});

// node_modules/@metamask/agent-sdk/dist/lib.esm/VersionedStorageManager-C6Liy5yV.js
var import_semver = __toESM(require_semver(), 1);
var t = class {
  logger;
  storage;
  locker;
  config;
  constructor(e2) {
    this.logger = e2.logger, this.storage = e2.storage, this.locker = e2.locker, this.config = e2.config;
  }
  parseAndMigrate(t2) {
    let { noun: n, storageLabel: r, writerNoun: i, resetAdvice: a, currentVersion: o2, migrations: s, normalize: c } = this.config, l = a.charAt(0).toLowerCase() + a.slice(1);
    if (!t2) return this.logger.debug(`No ${n.toLowerCase()} found`), null;
    if (!t2.data || typeof t2.data != `object`) return this.logger.warn(`${n} at ${r} is unusable (missing data). ${a}.`), null;
    let u = typeof t2.schemaVersion == `string` ? import_semver.default.valid(t2.schemaVersion) : null;
    if (!u) return this.logger.warn(`${n} at ${r} has invalid schemaVersion "${String(t2.schemaVersion)}". ${a}.`), null;
    let d = import_semver.default.compare(u, o2);
    if (d === 0) return { data: c(t2.data), migrated: false, version: u };
    if (d > 0) return import_semver.default.major(u) === import_semver.default.major(o2) ? { data: c(t2.data), migrated: false, version: u } : (this.logger.warn(`${n} at ${r} was written by a newer incompatible ${i} (v${u}, this ${i} is v${o2}). Upgrade the ${i} or ${l}.`), null);
    let f = u, p = t2.data;
    for (; f !== o2; ) {
      let e2 = s.find((e3) => e3.from === f);
      if (!e2) return this.logger.warn(`${n} at ${r} has no migration path from v${f} to v${o2}. ${a}.`), null;
      try {
        p = e2.migrate(p), f = e2.to;
      } catch (t3) {
        let r2 = t3 instanceof Error ? t3.message : String(t3);
        return this.logger.warn(`${n} migration ${e2.from} -> ${e2.to} failed: ${r2}. ${a}.`), null;
      }
    }
    return { data: c(p), migrated: true, version: f };
  }
  writeVersion(t2) {
    let n = t2 ?? this.parseAndMigrate(this.storage.read())?.version;
    return n && import_semver.default.gt(n, this.config.currentVersion) && import_semver.default.major(n) === import_semver.default.major(this.config.currentVersion) ? n : this.config.currentVersion;
  }
  withLock(e2) {
    let t2 = this.locker.acquire();
    try {
      return e2();
    } finally {
      t2();
    }
  }
  async withLockAsync(e2, t2 = {}) {
    let n = await this.locker.acquireAsync({ stale: t2.staleMs });
    try {
      return await e2(n);
    } finally {
      await n();
    }
  }
};

// node_modules/@metamask/agent-sdk/dist/lib.esm/base-frfg-DLO.js
var import_browser_passworder = __toESM(require_dist2(), 1);
var T2 = `1.0.0`;
var Te = [{ from: `0.0.1`, to: `0.1.0`, migrate: (e2) => {
  let t2 = { ...e2 };
  return delete t2.privateKey, delete t2.solanaPrivateKey, t2;
} }, { from: `0.1.0`, to: `0.2.0`, migrate: (e2) => {
  let t2 = { ...e2 };
  return t2.tradingMode === `safe` ? t2.tradingMode = `guard` : t2.tradingMode === `yolo` && (t2.tradingMode = `beast`), t2;
} }, { from: `0.2.0`, to: `0.5.0`, migrate: (e2) => ({ ...e2 }) }, { from: `0.5.0`, to: `1.0.0`, migrate: (e2) => {
  let t2 = { ...e2 };
  return delete t2.ethAddress, delete t2.solAddress, t2;
} }];
var E2 = { cliToken: null, cliRefreshToken: null, projectId: null, chain: null, walletMode: null, tradingMode: null, authMethod: null, loginMethod: null, consent: null };
var Ee = class extends t {
  data = null;
  constructor(e2) {
    super({ logger: e2.logger, storage: e2.storage, locker: e2.locker, config: { currentVersion: T2, migrations: Te, storageLabel: e2.storageLabel ?? `session storage`, noun: `Session`, writerNoun: `CLI`, resetAdvice: "Run `mm reset` to clear it, then sign in again", normalize: (e3) => ({ ...E2, ...e3 ?? {} }) } });
  }
  load() {
    let e2 = this.parseAndMigrate(this.storage.read());
    return e2 ? (this.data = e2.data, e2.migrated && this.withLock(() => {
      let e3 = this.parseAndMigrate(this.storage.read());
      e3 && (e3.migrated && (this.storage.write({ schemaVersion: e3.version, data: e3.data }), this.logger.debug(`Session migrated to v${e3.version}`)), this.data = e3.data);
    }), this.logger.debug(`Session loaded`), this.data) : (this.data = null, null);
  }
  get(e2) {
    return this.data ? this.data[e2] : null;
  }
  save(e2) {
    this.withLock(() => {
      let t2 = this.parseAndMigrate(this.storage.read()), n = { ...t2?.data ?? {}, ...e2 };
      this.data = n, this.storage.write({ schemaVersion: this.writeVersion(t2?.version), data: n }), this.logger.debug(`Session saved`);
    });
  }
  update(e2) {
    this.withLock(() => {
      let t2 = this.parseAndMigrate(this.storage.read()), n = { ...t2?.data ?? E2, ...e2 };
      this.data = n, this.storage.write({ schemaVersion: this.writeVersion(t2?.version), data: n }), this.logger.debug(`Session saved`);
    });
  }
  clear() {
    this.withLock(() => {
      this.storage.delete(), this.data = null, this.logger.debug(`Session destroyed`);
    });
  }
  isLoaded() {
    return this.data !== null;
  }
  async withSessionAsync(e2, t2 = {}) {
    return this.withLockAsync(async () => {
      let t3 = this.parseAndMigrate(this.storage.read());
      return e2({ read: () => {
        t3 = this.parseAndMigrate(this.storage.read());
        let e3 = t3?.data ?? E2;
        return this.data = e3, e3;
      }, save: async (e3) => {
        let n = { ...t3?.data ?? E2, ...e3 }, r = this.writeVersion(t3?.version);
        this.storage.write({ schemaVersion: r, data: n }), this.data = n, t3 = { data: n, migrated: false, version: r }, this.logger.debug(`Session saved`);
      } });
    }, t2);
  }
};
var V = { trending: { vsCurrency: `usd`, blockRegion: `global`, sort: `h6_trending` }, popular: { blockRegion: `us`, sort: `h24_volume_usd_desc` }, topGainers: { sort: `h24_price_change_percentage_desc` }, search: { first: 10 } };
V.trending.vsCurrency, V.trending.blockRegion, V.trending.sort, V.popular.blockRegion, V.popular.sort, V.topGainers.sort, V.search.first;
var lt = class extends t {
  constructor(e2, t2, n, r = `wallet state storage`) {
    let a = {};
    super({ logger: e2, storage: t2, locker: n, config: { currentVersion: T, migrations: E, storageLabel: r, noun: `Wallet state`, writerNoun: `agentic SDK`, resetAdvice: `Reset it to clear it`, normalize: (e3) => a.normalize(e3) } }), a.normalize = (e3) => this.normalize(e3);
  }
  read() {
    let e2 = this.parseAndMigrate(this.storage.read());
    return e2 ? (e2.migrated && this.withLock(() => {
      let e3 = this.parseAndMigrate(this.storage.read());
      e3 && e3.migrated && (this.storage.write({ schemaVersion: e3.version, data: e3.data }), this.logger.debug(`Wallet state migrated to v${e3.version}`));
    }), e2.data) : this.normalize(null);
  }
  write(e2) {
    this.withLock(() => {
      let t2 = this.parseAndMigrate(this.storage.read());
      this.storage.write({ schemaVersion: this.writeVersion(t2?.version), data: this.normalize(e2) }), this.logger.debug(`Wallet state saved`);
    });
  }
  update(e2) {
    return this.updateWith(() => e2);
  }
  updateWith(e2) {
    return this.withLock(() => {
      let t2 = this.parseAndMigrate(this.storage.read()), n = t2?.data ?? this.normalize(null), r = this.normalize({ ...n, ...e2(n) });
      return this.storage.write({ schemaVersion: this.writeVersion(t2?.version), data: r }), this.logger.debug(`Wallet state saved`), r;
    });
  }
  clear() {
    this.withLock(() => {
      this.storage.delete(), this.logger.debug(`Wallet state destroyed`);
    });
  }
  normalize(e2) {
    let t2 = e2 ?? {};
    return { ...t2, byokWallets: Array.isArray(t2.byokWallets) ? t2.byokWallets : [], remoteWallets: Array.isArray(t2.remoteWallets) ? t2.remoteWallets : [], customEvmChains: Array.isArray(t2.customEvmChains) ? t2.customEvmChains : [], customSolanaChains: Array.isArray(t2.customSolanaChains) ? t2.customSolanaChains : [], selectedWallet: t2.selectedWallet, selectedChain: t2.selectedChain, pendingJobs: Array.isArray(t2.pendingJobs) ? t2.pendingJobs : [], byokRegisteredAddresses: Array.isArray(t2.byokRegisteredAddresses) ? t2.byokRegisteredAddresses : [] };
  }
};

export {
  Ee,
  lt
};
