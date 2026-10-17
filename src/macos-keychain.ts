import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { ApnError } from "./errors.js";

const SECURITY = "/usr/bin/security";
const SERVICE = "ai.nuanu.apn.wrapping-secret.v1";
const ACCOUNT = "default";
const LABEL = "Nuanu APN wrapping secret";
const MAX_OUTPUT_BYTES = 4 * 1024;
const SECURITY_TIMEOUT_MS = 15_000;

export interface WrappingSecretPort {
  load(): Promise<Buffer | null>;
  create(): Promise<Buffer>;
}

interface LocalIdentity {
  readonly homedir: string;
  readonly username: string;
}

export interface SecurityResult { readonly code: number; readonly stdout: Buffer }
export type SecurityRunner = (args: readonly string[], input?: Buffer) => Promise<SecurityResult>;

export interface MacOSLoginKeychainSecretOptions {
  readonly identity?: LocalIdentity;
  readonly runSecurity?: SecurityRunner;
}

/** Every cached secret still alive; the exit hook zeroes them, and a collected owner zeroes its own first. */
const cachedSecrets = new Set<Buffer>();
const releasedSecrets = new FinalizationRegistry<Buffer>((secret) => { secret.fill(0); cachedSecrets.delete(secret); });
let exitHookInstalled = false;

function privateCopy(secret: Buffer): Buffer {
  const copy = Buffer.alloc(secret.length);
  secret.copy(copy);
  return copy;
}

/**
 * The login-Keychain wrapping secret. One instance belongs to one command invocation: the first successful `load` or
 * `create` keeps a private in-memory copy for that instance, so every later read in the same command spawns no
 * `security` process. It is never written anywhere, callers still receive (and zero) their own copy, and the cached
 * copy is zeroed when the instance is collected or the process exits.
 */
export class MacOSLoginKeychainSecret implements WrappingSecretPort {
  private readonly loginKeychain: string;
  private readonly security: SecurityRunner;
  private cached: Buffer | undefined;

  constructor(options: MacOSLoginKeychainSecretOptions = {}) {
    const identity = options.identity ?? userInfo();
    this.loginKeychain = loginKeychainPath(identity.homedir);
    this.security = options.runSecurity ?? (async (args, input) => await runSecurity(args, identity, input));
  }

  async load(): Promise<Buffer | null> {
    if (this.cached !== undefined) return privateCopy(this.cached);
    const result = await this.security(this.findArgs());
    try {
      if (result.code === 44) return null;
      if (result.code !== 0) throw keychainUnavailable();
      const encoded = result.stdout.toString("utf8").trim();
      const secret = Buffer.from(encoded, "base64");
      if (secret.length !== 32 || secret.toString("base64") !== encoded) {
        secret.fill(0);
        throw keychainUnavailable();
      }
      this.remember(secret);
      return secret;
    } finally {
      result.stdout.fill(0);
    }
  }

  private remember(secret: Buffer): void {
    if (this.cached !== undefined) return;
    this.cached = privateCopy(secret);
    cachedSecrets.add(this.cached);
    releasedSecrets.register(this, this.cached);
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      process.once("exit", () => { for (const cached of cachedSecrets) cached.fill(0); cachedSecrets.clear(); });
    }
  }

  async create(): Promise<Buffer> {
    const current = await this.load();
    if (current !== null) return current;

    // The new secret reaches security(1) only on stdin, never its argv, where any same-user `ps` would see it. The
    // same interactive session reads the item back: only a read-back equal to the generated secret proves the add.
    const generated = randomBytes(32);
    const encoded = generated.toString("base64");
    let script: Buffer | undefined, result: SecurityResult;
    try {
      script = Buffer.from(`${securityLine(["add-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-l", LABEL, "-w", encoded,
        this.loginKeychain])}\n${securityLine(this.findArgs())}\n`, "utf8");
      result = await this.security(["-i"], script);
    } catch (error) {
      generated.fill(0);
      throw error;
    } finally { script?.fill(0); }
    const stored = result.stdout.toString("utf8").trim() === encoded;
    result.stdout.fill(0);
    if (stored) {
      this.remember(generated);
      return generated;
    }

    // Another process created the item first, or the add failed: the Keychain decides.
    generated.fill(0);
    const raced = await this.load();
    if (raced !== null) return raced;
    throw keychainUnavailable();
  }

  private findArgs(): readonly string[] {
    return ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w", this.loginKeychain];
  }
}

/** One `security -i` command line. Arguments are bare or double-quoted; anything that would need escaping is refused. */
function securityLine(args: readonly string[]): string {
  return args.map((arg) => {
    if (/^[A-Za-z0-9._/+=:@-]+$/u.test(arg)) return arg;
    if (/^[^"'\\\x00-\x1f\x7f]+$/u.test(arg)) return `"${arg}"`;
    throw keychainUnavailable();
  }).join(" ");
}

export function loginKeychainPath(homedir: string): string {
  if (!isAbsolute(homedir) || normalize(homedir) !== homedir || resolve(homedir) !== homedir || homedir === "/") {
    throw keychainUnavailable();
  }
  return join(homedir, "Library", "Keychains", "login.keychain-db");
}

async function runSecurity(args: readonly string[], identity: LocalIdentity, input?: Buffer): Promise<SecurityResult> {
  return await new Promise<SecurityResult>((resolve, reject) => {
    const child = spawn(SECURITY, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        HOME: identity.homedir,
        LOGNAME: identity.username,
        USER: identity.username,
        PATH: "/usr/bin:/bin",
        LANG: "C",
      },
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let oversized = false;
    let settled = false;
    const finish = (result?: SecurityResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (result === undefined) {
        for (const chunk of stdout) chunk.fill(0);
        reject(keychainUnavailable());
      } else resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish();
    }, SECURITY_TIMEOUT_MS);
    timeout.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        oversized = true;
        child.kill("SIGKILL");
      } else stdout.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        oversized = true;
        child.kill("SIGKILL");
      }
    });
    child.once("error", () => finish());
    child.once("close", (code) => {
      if (oversized || code === null) finish();
      else finish({ code, stdout: Buffer.concat(stdout) });
    });
    child.stdin.once("error", () => undefined);
    child.stdin.end(input);
  });
}

function keychainUnavailable(): ApnError {
  return new ApnError("APN_NATIVE_REJECTED", "The APN login-Keychain wrapping secret is unavailable.", {
    nativeCode: "APN_KEYCHAIN_UNAVAILABLE",
  });
}
