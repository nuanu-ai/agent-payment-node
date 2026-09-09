import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { readFixture, respond, trace } from "./responses.mjs";

// External fixture boundary only. The actual archive, helper, SDK, journal,
// runtime factory, parser and approval implementation remain untouched.
const fixturePath = process.env.APN_MM_TEST_FIXTURE;
assert.ok(fixturePath, "this external preload requires an explicit fixture");
const initial = readFixture(fixturePath), require = createRequire(import.meta.url);
const os = require("node:os"), https = require("node:https"), http = require("node:http");
const dns = require("node:dns"), dnsPromises = require("node:dns/promises"), net = require("node:net"), tls = require("node:tls");
const childProcess = require("node:child_process"), actualSpawn = childProcess.spawn;
const preloadPath = fileURLToPath(import.meta.url);
const userInfo = os.userInfo();
os.homedir = () => initial.home;
os.userInfo = () => ({ ...userInfo, homedir: initial.home });

const NativeDate = Date;
globalThis.Date = class FixtureDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [NativeDate.now() + (readFixture(fixturePath).nowOffsetMs ?? 0)])); }
  static now() { return NativeDate.now() + (readFixture(fixturePath).nowOffsetMs ?? 0); }
};
function forbidden(surface) {
  trace(fixturePath, { kind: "forbidden-egress", surface }); throw new Error("offline fixture denied " + surface);
}
const allowedHosts = new Set([new URL(initial.rpcUrl).hostname,
  "agentic-mimir-service.api.cx.metamask.io", "agentic-proxy.workers.cx.metamask.io"]);
dnsPromises.lookup = async (hostname, options) => {
  if (!allowedHosts.has(hostname)) return forbidden("dns");
  trace(fixturePath, { kind: "dns", hostname });
  assert.equal(options.all, true);
  const address = readFixture(fixturePath).transportFault === "private-dns" ? "127.0.0.1" : "8.8.8.8";
  return [{ address, family: 4 }];
};
dns.lookup = () => forbidden("callback-dns");
for (const name of ["resolve", "resolve4", "resolve6", "resolveAny"]) {
  dns[name] = () => forbidden(name); dnsPromises[name] = async () => forbidden(name);
}
http.request = http.get = () => forbidden("http");
https.get = () => forbidden("https-get-bypass");
net.connect = net.createConnection = tls.connect = () => forbidden("socket");
globalThis.fetch = async () => forbidden("fetch-outside-helper-policy");

https.request = (urlInput, options, onResponse) => {
  const url = new URL(urlInput);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) return forbidden("https");
  assert.equal(options.agent, false); assert.equal(options.family, 4);
  assert.notEqual(options.rejectUnauthorized, false); assert.equal(options.checkServerIdentity, undefined);
  const req = new EventEmitter(); req.destroyed = false;
  req.destroy = () => { req.destroyed = true; return req; };
  req.end = bodyInput => {
    const body = bodyInput === undefined ? null : String(bodyInput);
    setImmediate(async () => {
      if (req.destroyed) return;
      const socket = new EventEmitter();
      socket.remoteAddress = readFixture(fixturePath).transportFault === "wrong-peer" ? "8.8.4.4" : "8.8.8.8";
      req.emit("socket", socket); socket.emit("connect");
      if (req.destroyed || readFixture(fixturePath).transportFault === "timeout") return;
      try {
        const result = await respond(fixturePath, url.href, options.method, options.headers, body);
        if (req.destroyed) return;
        const response = new EventEmitter(); response.statusCode = result.status;
        response.headers = result.headers ?? {}; response.destroyed = false;
        response.destroy = () => { response.destroyed = true; };
        onResponse(response);
        if (response.destroyed || req.destroyed) return;
        response.emit("data", result.bytes ?? Buffer.from(result.body, "utf8"));
        if (!response.destroyed && !req.destroyed) response.emit("end");
      } catch (error) {
        if (!String(error?.message).includes("synthetic lost response")) trace(fixturePath, {
          kind: "fixture-violation", error: error?.code ?? error?.name ?? "unknown",
          site: String(error?.stack).split("\n").find(line => line.includes("-fixtures/"))?.trim() ?? "response",
        });
        req.emit("error", new Error("offline fixture response failed"));
      }
    });
    return req;
  };
  return req;
};

childProcess.spawn = (executable, args, options) => {
  if (executable === "/usr/bin/lockf") {
    assert.deepEqual(args, ["-s", "-t", "0", "3"]); assert.equal(options.shell, false);
    return actualSpawn(executable, args, options);
  }
  if (executable !== process.execPath || args.length !== 1 || args[0] !==
    `${initial.packageRoot}/dist/metamask-gasless/client/helper-entry.js`) return forbidden("child-process");
  assert.equal(options.shell, false); assert.deepEqual(options.stdio, ["pipe", "pipe", "ignore"]);
  assert.ok(Object.keys(options.env).every(key => ["HOME", "TMPDIR", "LANG", "TZ"].includes(key) || /^LC_[A-Z_]+$/u.test(key)));
  const child = actualSpawn(executable, ["--import", preloadPath, ...args], { ...options,
    env: { ...options.env, APN_MM_TEST_FIXTURE: fixturePath } });
  const originalEnd = child.stdin.end.bind(child.stdin);
  child.stdin.end = (data, ...rest) => {
    const request = JSON.parse(String(data));
    trace(fixturePath, { kind: "helper", mode: request.mode });
    if (readFixture(fixturePath).killSubmitHelper && request.mode === "submit") {
      child.kill("SIGKILL"); return child.stdin;
    }
    return originalEnd(data, ...rest);
  };
  return child;
};
for (const method of ["exec", "execFile", "execSync", "execFileSync", "spawnSync", "fork"]) {
  childProcess[method] = () => forbidden("child-" + method);
}
syncBuiltinESMExports();
