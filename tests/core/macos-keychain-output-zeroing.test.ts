/**
 * What `/usr/bin/security find-generic-password -w` prints is the wrapping secret. With node:child_process replaced by
 * an in-process fake child (no process is spawned and the Keychain is never touched), every stdout chunk the real
 * runSecurity receives must be zeroed on success, on a failing exit and on oversized output, and a transient load must
 * keep no cached copy behind.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

const SECRET = Buffer.from("7a".repeat(32), "hex").toString("base64");
let script: (child: FakeChild) => void = () => { throw new Error("TEST child has no script"); };
let spawned = 0;

class FakeStdin extends EventEmitter {
  constructor(private readonly child: FakeChild) { super(); }
  end(): void { setImmediate(() => script(this.child)); }
}

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin: FakeStdin = new FakeStdin(this);
  killed = false;
  kill(): boolean { this.killed = true; return true; }
}

mock.module("node:child_process", { namedExports: { spawn: () => { spawned += 1; return new FakeChild(); } } });
const { MacOSLoginKeychainSecret } = await import("../../src/macos-keychain.js");
const keychain = () => new MacOSLoginKeychainSecret({ identity: { homedir: "/Users/apn-test-user", username: "apn-test-user" } });

/** Each spawned child prints fresh chunks of `texts` on stdout, then closes with `code`; returns every chunk printed. */
function answer(texts: readonly string[], code: number | null): readonly Buffer[] {
  const printed: Buffer[] = [];
  script = (child) => {
    for (const text of texts) {
      const chunk = Buffer.from(text, "utf8");
      printed.push(chunk);
      child.stdout.emit("data", chunk);
    }
    child.emit("close", code);
  };
  return printed;
}

const zeroed = (chunks: readonly Buffer[]): boolean => chunks.every((chunk) => chunk.every((byte) => byte === 0));

test("a successful read zeroes every stdout chunk security printed", async () => {
  const chunks = answer([SECRET.slice(0, 20), `${SECRET.slice(20)}\n`], 0);
  const secret = await keychain().load("transient");
  assert.equal(secret?.toString("base64"), SECRET);
  secret?.fill(0);
  assert.equal(chunks.length, 2);
  assert.ok(zeroed(chunks), "the chunks that carried the secret were left in memory");
});

test("a failing exit and oversized output zero what security printed", async () => {
  const failed = answer([`${SECRET}\n`], 36);
  await assert.rejects(keychain().load("transient"), { code: "APN_NATIVE_REJECTED" });
  assert.equal(failed.length, 1);
  assert.ok(zeroed(failed));

  const oversized = answer(["A".repeat(5 * 1024)], null);
  await assert.rejects(keychain().load("transient"), { code: "APN_NATIVE_REJECTED" });
  assert.equal(oversized.length, 1);
  assert.ok(zeroed(oversized));
});

test("a transient load keeps no cached copy; an ordinary load caches for the rest of the command", async () => {
  const port = keychain();
  answer([`${SECRET}\n`], 0);
  const before = spawned;
  for (let read = 0; read < 2; read += 1) (await port.load("transient"))?.fill(0);
  assert.equal(spawned - before, 2, "each transient read asks security again");
  (await port.load())?.fill(0);
  (await port.load())?.fill(0);
  assert.equal(spawned - before, 3, "the ordinary read is cached");
});
