import { domainHash } from "./canonical.js";
import { ApnError } from "./errors.js";
import type { PaidHttpResult } from "./x402-http.js";
import type { HttpObservation } from "./x402-model.js";

export function opaqueHttpResult(raw: HttpObservation): PaidHttpResult["result"] {
  if (raw.status < 200 || raw.status >= 300) return undefined;
  const contentTypes = raw.rawHeaderPairs.filter(([name]) => name.toLowerCase() === "content-type");
  if (contentTypes.length > 1) throw invalid("Seller returned duplicate Content-Type headers.");
  const contentType = contentTypes[0]?.[1] ?? "application/octet-stream";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType.length > 2048 || mediaType.length > 128 || !/^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/u.test(mediaType)) {
    throw invalid("Seller result media type is invalid.");
  }
  return {
    mediaType,
    bodyEncoding: "base64",
    bodyText: Buffer.from(raw.bodyBytes).toString("base64"),
    resultHash: domainHash("apn.x402.result-body.v1", raw.bodyBytes),
    byteLength: raw.bodyBytes.byteLength.toString(),
    responseStatus: raw.status.toString(),
  };
}

export function parseResultMediaType(value: string): string {
  if (Buffer.byteLength(value, "utf8") > 128) throw invalid("Seller result media type is unsupported or non-canonical.");
  const parts = value.split(";");
  const mediaType = parts[0];
  if (mediaType === undefined || (mediaType !== "application/json" && !/^text\/[a-z0-9!#$%&'*+.^_`|~-]+$/u.test(mediaType))) {
    throw invalid("Seller result media type is unsupported or non-canonical.");
  }
  const parameter = parts[1];
  if (parts.length > 2 || (parameter !== undefined && !/^[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8")[ \t]*$/iu.test(parameter))) {
    throw invalid("Seller result media type parameters are malformed or unsupported.");
  }
  return mediaType;
}

function invalid(message: string): ApnError {
  return new ApnError("APN_X402_RESULT_INVALID", message);
}
