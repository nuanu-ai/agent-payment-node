import { performance } from "node:perf_hooks";
import { nativeDeadlineRemaining, validateMetaMaskNativeDiagnostic, type MetaMaskNativeDeadlineInput, type MetaMaskNativeDiagnostic } from "./metamask-native-diagnostic.js";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { ApnError } from "./errors.js";
import { isPlainRecord, sha256 } from "./canonical.js";
import { classifyMetaMaskPendingNotices, parseMetaMaskProcessOutput } from "./metamask-process-output.js";
import type { Hex } from "./model.js";
import {
  METAMASK_FOREGROUND_TIMEOUT_MS,
  METAMASK_PROCESS_TIMEOUT_MS,
  resolveMetaMaskBin,
} from "./metamask-package.js";

const MAX_JSON_BYTES = 1024 * 1024;
interface NativeFailureIdentifiers {
  readonly requestId?: string;
  readonly transactionHash?: Hex;
  readonly sender?: string;
  readonly chainId?: number;
  readonly vendorProjectHash?: string;
}
const nativeFailureDiagnostics = new WeakMap<ApnError,MetaMaskNativeDiagnostic>();
export function takeMetaMaskNativeProcessFailureDiagnostic(error:unknown):MetaMaskNativeDiagnostic|undefined {
  if(!(error instanceof ApnError))return undefined;const value=nativeFailureDiagnostics.get(error);nativeFailureDiagnostics.delete(error);return value;
}
const nativeFailureIdentifiers = new WeakMap<ApnError, NativeFailureIdentifiers>();
/** Internal one-use observation of this runner's rejected invocation. Never exposes captured output or changes rejection. */
export function takeMetaMaskNativeProcessFailureIdentifiers(error: unknown): NativeFailureIdentifiers | undefined {
  if (!(error instanceof ApnError)) return undefined;
  const value = nativeFailureIdentifiers.get(error);
  nativeFailureIdentifiers.delete(error);
  return value;
}
function observeNativeFailure(bytes: Buffer): NativeFailureIdentifiers | undefined {
  let parsed = parseMetaMaskProcessOutput(bytes);
  if (parsed === null) {
    const text = bytes.toString("utf8"), boundary = text.lastIndexOf("\n");
    if (boundary < 0) return undefined;
    const tail = text.slice(boundary + 1).trim();
    if (!tail.startsWith("{")) return undefined;
    try {JSON.parse(tail); return undefined;}
    catch (error) {
      if (!(error instanceof SyntaxError)) return undefined;
      const atEnd = error.message === "Unexpected end of JSON input" ||
        / at position ([0-9]+) /u.exec(error.message)?.[1] === String(tail.length);
      if (!atEnd) return undefined;
    }
    const prefix = Buffer.from(text.slice(0, boundary), "utf8");
    try {parsed = parseMetaMaskProcessOutput(prefix);} finally {prefix.fill(0);}
    // Only complete normal notice frames before a cut final frame can supply IDs.
    if (parsed === null || parsed.envelope !== null || parsed.notices.length === 0) return undefined;
  }
  if (parsed === null) return undefined;
  const notice = classifyMetaMaskPendingNotices(parsed.notices);
  if (notice.disposition === "invalid") return undefined;
  const data = parsed.envelope?.data;
  if (parsed.envelope !== null && !isPlainRecord(data)) return undefined;
  if (isPlainRecord(data)) {
    if (data.mode !== "server" || typeof data.address !== "string" || !/^0x[a-fA-F0-9]{40}$/u.test(data.address)) return undefined;
    if (data.hash !== undefined && (typeof data.hash !== "string" || !/^0x[a-fA-F0-9]{64}$/u.test(data.hash))) return undefined;
    if (data.pollingId !== undefined && (typeof data.pollingId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(data.pollingId))) return undefined;
    if (data.chainId !== undefined && (typeof data.chainId !== "number" || !Number.isSafeInteger(data.chainId) || data.chainId < 1)) return undefined;
    if (data.projectId !== undefined && (typeof data.projectId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(data.projectId))) return undefined;
    if (notice.disposition === "pending" && data.pollingId !== undefined && data.pollingId !== notice.recoveryToken) return undefined;
  }
  const requestId = isPlainRecord(data) && typeof data.pollingId === "string" ? data.pollingId : notice.disposition === "pending" ? notice.recoveryToken : undefined;
  const transactionHash = isPlainRecord(data) && typeof data.hash === "string" ? data.hash.toLowerCase() as Hex : undefined;
  if (requestId === undefined && transactionHash === undefined) return undefined;
  return Object.freeze({...(requestId === undefined ? {} : {requestId}), ...(transactionHash === undefined ? {} : {transactionHash}),
    ...(isPlainRecord(data) ? {sender: (data.address as string).toLowerCase(),
      ...(typeof data.chainId === "number" ? {chainId: data.chainId} : {}),
      ...(typeof data.projectId === "string" ? {vendorProjectHash: sha256(data.projectId)} : {})} : {})});
}

interface CapturedStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

interface CapturedChild {
  readonly stdout: CapturedStream;
  readonly stderr: CapturedStream;
  once(event: "error", listener: () => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  removeListener(event: "error", listener: () => void): unknown;
  removeListener(event: "close", listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

interface ForegroundChild {
  once(event: "error", listener: () => void): unknown;
  once(event: "close", listener: (code: number | null) => void): unknown;
  removeListener(event: "error", listener: () => void): unknown;
  removeListener(event: "close", listener: (code: number | null) => void): unknown;
  kill(): unknown;
}

export type MetaMaskCapturedLaunchPort = (
  executable: string,
  args: readonly string[],
  options: { readonly shell: false; readonly stdio: readonly ["ignore", "pipe", "pipe"] },
) => CapturedChild;

export type MetaMaskForegroundLaunchPort = (
  executable: string,
  args: readonly string[],
  options: { readonly shell: false; readonly stdio: readonly [number, number, number] },
) => ForegroundChild;

export interface MetaMaskProcessResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly nativeDiagnostic?: MetaMaskNativeDiagnostic;
}

export interface MetaMaskProcessRunnerPort {
  runJson(argv: readonly string[], timeoutMs?: number, absoluteDeadline?: MetaMaskNativeDeadlineInput): Promise<MetaMaskProcessResult>;
  runForeground(argv: readonly string[]): Promise<number>;
}

export class NodeMetaMaskProcessRunner implements MetaMaskProcessRunnerPort {
  constructor(
    private readonly binResolver: () => Promise<string> = resolveMetaMaskBin,
    private readonly capturedLaunch: MetaMaskCapturedLaunchPort = defaultCapturedLaunch,
    private readonly foregroundLaunch: MetaMaskForegroundLaunchPort = defaultForegroundLaunch,
    private readonly jsonTimeoutMs: number = METAMASK_PROCESS_TIMEOUT_MS,
    private readonly foregroundTimeoutMs: number = METAMASK_FOREGROUND_TIMEOUT_MS,
    private readonly openTerminal: () => number = defaultOpenTerminal,
    private readonly closeTerminal: (fd: number) => void = closeSync,
  ) {}

  async runJson(argv: readonly string[], timeoutMs = this.jsonTimeoutMs, absoluteDeadline?:MetaMaskNativeDeadlineInput): Promise<MetaMaskProcessResult> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 305_000) throw providerProtocol();
    const started=performance.now();
    if(absoluteDeadline!==undefined)nativeDeadlineRemaining(absoluteDeadline);
    const utc=absoluteDeadline===undefined?undefined:typeof absoluteDeadline==="string"?absoluteDeadline:absoluteDeadline.utcExpiresAt;
    const monotonicEnd=absoluteDeadline===undefined?undefined:typeof absoluteDeadline==="string"?started+nativeDeadlineRemaining(absoluteDeadline):absoluteDeadline.monotonicDeadlineMs;
    const rawRemaining=()=>absoluteDeadline===undefined?0:Math.min(Date.parse(utc!)-Date.now(),monotonicEnd!-performance.now());
    const remaining=()=>Math.max(0,Math.min(60000,Math.floor(rawRemaining())));
    const diagnostic=(stage:MetaMaskNativeDiagnostic["stage"],code:MetaMaskNativeDiagnostic["code"],exitCode:number|null=null,signal:MetaMaskNativeDiagnostic["signal"]=null,stderrClass:MetaMaskNativeDiagnostic["stderrClass"]="none",providerCode:MetaMaskNativeDiagnostic["providerCode"]="none")=>validateMetaMaskNativeDiagnostic({stage,code,exitCode,signal,durationMs:Math.min(86400000,Math.max(0,Math.floor(performance.now()-started))),remainingMs:remaining(),stderrClass,providerCode});
    const beforeLaunch=()=>{if(absoluteDeadline!==undefined&&remaining()<1){const error=providerUnavailable("Native SDK deadline reached before launch.");nativeFailureDiagnostics.set(error,diagnostic("sdk_resolver","deadline"));throw error;}};
    beforeLaunch();
    let script:string;
    let resolverTimer:ReturnType<typeof setTimeout>|undefined;
    let resolverDeadlineFailure:ApnError|undefined;
    try {
      script=absoluteDeadline===undefined?await this.binResolver():await Promise.race([this.binResolver(),new Promise<never>((_,reject)=>{
        const expire=()=>{
          const left=rawRemaining();
          if(left>0){resolverTimer=setTimeout(expire,Math.max(1,Math.ceil(left)));return;}
          resolverDeadlineFailure=providerUnavailable("Native SDK resolver deadline reached.");
          reject(resolverDeadlineFailure);
        };
        resolverTimer=setTimeout(expire,Math.max(1,Math.ceil(rawRemaining())));
      })]);
    }catch(error){if(error instanceof ApnError)nativeFailureDiagnostics.set(error,diagnostic("sdk_resolver",error===resolverDeadlineFailure||absoluteDeadline!==undefined&&rawRemaining()<=0?"deadline":"refused"));throw error;}
    finally {if(resolverTimer!==undefined)clearTimeout(resolverTimer);}
    beforeLaunch();
    return await new Promise<MetaMaskProcessResult>((resolveResult, reject) => {
      let child: CapturedChild;
      try {
        beforeLaunch();
        child = this.capturedLaunch(process.execPath, [script, ...argv], {
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        if(error instanceof ApnError){reject(error);return;}
        const failure=providerUnavailable("The MetaMask Agent Wallet process could not start.");nativeFailureDiagnostics.set(failure,diagnostic("sdk_resolver","start"));
        reject(failure);
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const stderrChunks:Buffer[]=[];let stderrSize=0,stderrOverflow=false;
      const stage=argv[0]==="wallet"&&argv[1]==="send-transaction"?"sdk_send":"sdk_read";
      const stderrObservation=():{stderrClass:MetaMaskNativeDiagnostic["stderrClass"];providerCode:MetaMaskNativeDiagnostic["providerCode"]}=>{
        if(stderrSize===0)return {stderrClass:"none",providerCode:"none"};if(stderrOverflow)return {stderrClass:"unclassified",providerCode:"other"};
        const bytes=Buffer.concat(stderrChunks);try {const parsed=JSON.parse(bytes.toString("utf8"));const error=isPlainRecord(parsed)?(isPlainRecord(parsed.error)?parsed.error:isPlainRecord(parsed._error)?parsed._error:null):null;
          if(error===null)return {stderrClass:"unclassified",providerCode:"other"};const code=typeof error.code==="string"?error.code:"";
          const providerCode=code==="POLICY_VIOLATION"||code==="POLICY_REJECTED"?"policy":code==="MFA_REQUIRED"?"mfa":code==="UNAUTHORIZED"||code==="AUTH_REQUIRED"?"auth":code==="INSUFFICIENT_FUNDS"?"funds":code==="RATE_LIMITED"?"rate_limit":"other";return {stderrClass:"json_error",providerCode};
        }catch{return {stderrClass:"unclassified",providerCode:"other"};}finally{bytes.fill(0);}
      };
      let settled = false;
      const zero = (): void => { for (const chunk of [...chunks,...stderrChunks]) chunk.fill(0); };
      const cleanup = (): void => {
        clearTimeout(timeout);
        child.stdout.removeListener("data", onStdout);
        child.stderr.removeListener("data", onStderr);
        child.removeListener("error", onError);
        child.removeListener("close", onClose);
      };
      const fail = (error: ApnError, observeIdentifiers = false): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (observeIdentifiers) {
          const bytes = Buffer.concat(chunks);
          try {
            const observation = observeNativeFailure(bytes);
            if (observation !== undefined) nativeFailureIdentifiers.set(error, observation);
          } finally {bytes.fill(0);}
        }
        const stderr=stderrObservation();nativeFailureDiagnostics.set(error,diagnostic(stage,absoluteDeadline!==undefined&&remaining()<1?"deadline":error.message.includes("timed out")?"timeout":error.code==="APN_PROVIDER_PROTOCOL"?"protocol":"start",null,null,stderr.stderrClass,stderr.providerCode));
        zero();
        reject(error);
      };
      const onStdout = (chunk: Buffer | string): void => {
        const bytes = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, "utf8");
        if (Buffer.isBuffer(chunk)) chunk.fill(0);
        size += bytes.length;
        if (size > MAX_JSON_BYTES) {
          bytes.fill(0);
          fail(providerProtocol());
          child.kill();
          return;
        }
        chunks.push(bytes);
      };
      const onStderr = (chunk: Buffer | string): void => {
        const bytes=Buffer.isBuffer(chunk)?Buffer.from(chunk):Buffer.from(chunk,"utf8");if(Buffer.isBuffer(chunk))chunk.fill(0);
        stderrSize+=bytes.length;if(stderrSize<=4096)stderrChunks.push(bytes);else {stderrOverflow=true;bytes.fill(0);}
      };
      const onError = (): void => fail(providerUnavailable("The MetaMask Agent Wallet process could not start."), true);
      const onClose = (code: number | null,rawSignal?:string): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const stdout = Buffer.concat(chunks);
        const signal=["SIGTERM","SIGKILL","SIGINT","SIGHUP","SIGABRT","SIGSEGV","SIGPIPE"].includes(rawSignal??"")?rawSignal as MetaMaskNativeDiagnostic["signal"]:null;
        const stderr=stderrObservation(),nativeDiagnostic=diagnostic(stage,signal!==null?"signal":code===0?"ok":"exit",code,signal,stderr.stderrClass,stderr.providerCode);
        zero();
        resolveResult({ exitCode: code ?? 1, stdout, ...(absoluteDeadline === undefined ? {} : { nativeDiagnostic }) });
      };
      const timeout = setTimeout(() => {
        fail(providerUnavailable("The MetaMask Agent Wallet process timed out safely."), true);
        child.kill();
      }, absoluteDeadline===undefined?timeoutMs:Math.max(1,Math.min(timeoutMs,remaining())));
      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      child.once("error", onError);
      child.once("close", onClose);
    });
  }

  async runForeground(argv: readonly string[]): Promise<number> {
    const script = await this.binResolver();
    let ttyFd: number;
    try { ttyFd = this.openTerminal(); }
    catch { throw new ApnError("APN_FOREGROUND_AUTH_REQUIRED", "A foreground terminal is required for MetaMask login."); }
    try {
      return await new Promise<number>((resolveResult, reject) => {
        let child: ForegroundChild;
        try {
          child = this.foregroundLaunch(process.execPath, [script, ...argv], {
            shell: false,
            stdio: [ttyFd, ttyFd, ttyFd],
          });
        } catch {
          reject(providerUnavailable("The MetaMask Agent Wallet foreground process could not start."));
          return;
        }
        let settled = false;
        const cleanup = (): void => {
          clearTimeout(timeout);
          child.removeListener("error", onError);
          child.removeListener("close", onClose);
        };
        const onError = (): void => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(providerUnavailable("The MetaMask Agent Wallet foreground process was lost."));
        };
        const onClose = (code: number | null): void => {
          if (settled) return;
          settled = true;
          cleanup();
          resolveResult(code ?? 1);
        };
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          child.kill();
          reject(providerUnavailable("MetaMask foreground login timed out safely."));
        }, this.foregroundTimeoutMs);
        child.once("error", onError);
        child.once("close", onClose);
      });
    } finally {
      this.closeTerminal(ttyFd);
    }
  }
}

const defaultCapturedLaunch: MetaMaskCapturedLaunchPort = (executable, args, options) => spawn(executable, [...args], {
  shell: options.shell,
  stdio: [...options.stdio],
}) as CapturedChild;

const defaultForegroundLaunch: MetaMaskForegroundLaunchPort = (executable, args, options) => spawn(executable, [...args], {
  shell: options.shell,
  stdio: [...options.stdio],
}) as ForegroundChild;

function defaultOpenTerminal(): number {
  return openSync("/dev/tty", "r+");
}

function providerProtocol(): ApnError {
  return new ApnError("APN_PROVIDER_PROTOCOL", "The MetaMask Agent Wallet response exceeded its accepted contract.", { retryable: false });
}

function providerUnavailable(message: string): ApnError {
  return new ApnError("APN_PROVIDER_UNAVAILABLE", message, { retryable: true });
}
