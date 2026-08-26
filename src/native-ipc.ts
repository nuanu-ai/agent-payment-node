import { closeSync, createReadStream, writeSync } from "node:fs";
import type { Readable } from "node:stream";
import { exactKeys, isPlainRecord } from "./canonical.js";
import {
  MAX_IPC_FRAME_BYTES,
  NATIVE_IPC_VERSION,
  NATIVE_REQUEST_FD_ENV,
  NATIVE_RESPONSE_FD_ENV,
} from "./constants.js";
import { ApnError } from "./errors.js";
import type { NativePort, NativeRequest } from "./ports.js";

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERROR_CODE = /^[A-Z0-9_]{3,64}$/;

export function encodeFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length === 0 || payload.length > MAX_IPC_FRAME_BYTES) {
    throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC frame exceeds the size limit.");
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export function decodeSingleFrame(frame: Buffer): unknown {
  if (frame.length < 4) throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC frame is truncated.");
  const length = frame.readUInt32BE(0);
  if (length === 0 || length > MAX_IPC_FRAME_BYTES) {
    throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC frame length is invalid.");
  }
  if (frame.length !== length + 4) {
    throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC must contain exactly one frame.");
  }
  try {
    return JSON.parse(frame.subarray(4).toString("utf8")) as unknown;
  } catch {
    throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response is not valid JSON.");
  }
}

export class InheritedNativeIpc implements NativePort {
  readonly requestFd: number;
  readonly responseFd: number;
  readonly timeoutMs: number;
  private used = false;

  constructor(requestFd: number, responseFd: number, timeoutMs = 15 * 60 * 1000) {
    if (!Number.isSafeInteger(requestFd) || requestFd < 3 || !Number.isSafeInteger(responseFd) || responseFd < 3) {
      throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "A valid inherited native channel is required.");
    }
    if (requestFd === responseFd) {
      throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "Native request and response channels must be distinct.");
    }
    this.requestFd = requestFd;
    this.responseFd = responseFd;
    this.timeoutMs = timeoutMs;
  }

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): InheritedNativeIpc {
    const requestFd = parseInheritedFd(environment[NATIVE_REQUEST_FD_ENV]);
    const responseFd = parseInheritedFd(environment[NATIVE_RESPONSE_FD_ENV]);
    return new InheritedNativeIpc(requestFd, responseFd);
  }

  async request(request: NativeRequest): Promise<unknown> {
    if (this.used) throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC permits one request per child session.");
    this.used = true;
    validateRequest(request);
    const requestFrame = encodeFrame(request);
    let offset = 0;
    try {
      while (offset < requestFrame.length) offset += writeSync(this.requestFd, requestFrame, offset);
    } finally {
      closeSync(this.requestFd);
    }
    const response = validateResponse(await readFrame(this.responseFd, this.timeoutMs), request.requestId);
    if (!response.ok) {
      throw new ApnError("APN_NATIVE_REJECTED", "The native host rejected the bounded request.", {
        nativeCode: response.error.code,
      });
    }
    return response.result;
  }
}

function parseInheritedFd(value: string | undefined): number {
  if (value === undefined || !/^[0-9]+$/.test(value)) {
    throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "The signed native host must provide inherited IPC channels.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 3) {
    throw new ApnError("APN_NATIVE_CHANNEL_REQUIRED", "The signed native host provided an invalid IPC channel.");
  }
  return parsed;
}

function validateRequest(request: NativeRequest): void {
  if (
    request.version !== NATIVE_IPC_VERSION ||
    !REQUEST_ID.test(request.requestId) ||
    ![
      "wallet.describe",
      "wallet.ensure",
      "directTransfer.approveAndSign",
      "effectMaterial.get",
    ].includes(request.operation) ||
    !isPlainRecord(request.payload)
  ) throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC request violates the bounded schema.");
}

type NativeResponse =
  | { readonly version: "apn.native.v1"; readonly requestId: string; readonly ok: true; readonly result: unknown }
  | {
    readonly version: "apn.native.v1";
    readonly requestId: string;
    readonly ok: false;
    readonly error: { readonly code: string; readonly message: string };
  };

function validateResponse(value: unknown, requestId: string): NativeResponse {
  if (!isPlainRecord(value) || value.version !== NATIVE_IPC_VERSION || value.requestId !== requestId) {
    throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response identity is invalid.");
  }
  if (value.ok === true && exactKeys(value, ["version", "requestId", "ok", "result"])) {
    return value as unknown as NativeResponse;
  }
  if (
    value.ok === false &&
    exactKeys(value, ["version", "requestId", "ok", "error"]) &&
    isPlainRecord(value.error) &&
    exactKeys(value.error, ["code", "message"]) &&
    typeof value.error.code === "string" &&
    ERROR_CODE.test(value.error.code) &&
    typeof value.error.message === "string" &&
    value.error.message.length <= 256
  ) return value as unknown as NativeResponse;
  throw new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response violates the bounded schema.");
}

async function readFrame(fd: number, timeoutMs: number): Promise<unknown> {
  return await readFrameStream(createReadStream("", { fd, autoClose: true }), timeoutMs);
}

export async function readFrameStream(stream: Readable, timeoutMs = 15_000): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let expected: number | null = null;
    let settled = false;
    const timeout = setTimeout(() => finish(new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response timed out.")), timeoutMs);

    function finish(error?: Error, value?: unknown): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error !== undefined) stream.destroy();
      if (error !== undefined) reject(error);
      else resolve(value);
    }

    stream.on("data", (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      chunks.push(bytes);
      total += bytes.length;
      if (total > MAX_IPC_FRAME_BYTES + 4) {
        finish(new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response exceeds the size limit."));
        return;
      }
      const combined = Buffer.concat(chunks, total);
      if (expected === null && combined.length >= 4) {
        const length = combined.readUInt32BE(0);
        if (length === 0 || length > MAX_IPC_FRAME_BYTES) {
          finish(new ApnError("APN_NATIVE_PROTOCOL", "Native IPC frame length is invalid."));
          return;
        }
        expected = length + 4;
      }
      if (expected !== null && total > expected) {
        finish(new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response contains trailing data or a second frame."));
      }
    });
    stream.on("error", (error) => finish(error));
    stream.on("end", () => {
      if (expected === null || total !== expected) {
        finish(new ApnError("APN_NATIVE_PROTOCOL", "Native IPC response ended before one complete frame."));
        return;
      }
      try {
        finish(undefined, decodeSingleFrame(Buffer.concat(chunks, total)));
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Native IPC decode failure."));
      }
    });
  });
}
