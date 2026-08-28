import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { ApnError } from "./errors.js";

const SECURITY = "/usr/bin/security";
const SERVICE = "ai.nuanu.apn.wrapping-secret.v1";
const ACCOUNT = "default";
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

export class MacOSLoginKeychainSecret implements WrappingSecretPort {
  private readonly loginKeychain: string;
  private readonly security: SecurityRunner;

  constructor(options: MacOSLoginKeychainSecretOptions = {}) {
    const identity = options.identity ?? userInfo();
    this.loginKeychain = loginKeychainPath(identity.homedir);
    this.security = options.runSecurity ?? (async (args, input) => await runSecurity(args, identity, input));
  }

  async load(): Promise<Buffer | null> {
    const result = await this.security([
      "find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w", this.loginKeychain,
    ]);
    try {
      if (result.code === 44) return null;
      if (result.code !== 0) throw keychainUnavailable();
      const encoded = result.stdout.toString("utf8").trim();
      const secret = Buffer.from(encoded, "base64");
      if (secret.length !== 32 || secret.toString("base64") !== encoded) {
        secret.fill(0);
        throw keychainUnavailable();
      }
      return secret;
    } finally {
      result.stdout.fill(0);
    }
  }

  async create(): Promise<Buffer> {
    const current = await this.load();
    if (current !== null) return current;

    const generated = randomBytes(32);
    const encoded = generated.toString("base64");
    let result: SecurityResult;
    try {
      result = await this.security([
        "add-generic-password", "-a", ACCOUNT, "-s", SERVICE,
        "-l", "Nuanu APN wrapping secret", "-w", encoded, this.loginKeychain,
      ]);
    } catch (error) {
      generated.fill(0);
      throw error;
    }
    result.stdout.fill(0);
    if (result.code === 0) return generated;

    generated.fill(0);
    const raced = await this.load();
    if (raced !== null) return raced;
    throw keychainUnavailable();
  }
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
