import { option } from "./command-catalog-builders.js";

const noDefault = { kind: "none" } as const;

/** The seller request beyond a plain GET: one shared definition for x402 inspect, x402 fetch prepare and x402 permit2 approve. */
export const X402_HTTP_OPTIONS = [
  option("--method", "string", false, noDefault, ["http_token_except_connect_and_trace", "default_GET"], "operator_input"),
  option("--headers-json", "string", false, noDefault, ["bounded_safe_header_object", "no_credentials_or_payment_headers"], "operator_input"),
  option("--body-base64", "base64", false, noDefault, ["maximum_65536_decoded_bytes", "empty_is_present_zero_bytes", "omission_is_absent"], "operator_input"),
];
export const X402_HTTP_SYNOPSIS = " [--method <method>] [--headers-json <json>] [--body-base64 <base64>]";
