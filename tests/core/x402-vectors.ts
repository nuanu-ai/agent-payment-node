import { BASE_USDC } from "../../src/constants.js";

export const X402_URL = "https://seller.example/resource?order=redacted";
export const X402_PAYEE = "0x2222222222222222222222222222222222222222";
export const X402_PAYER = "0x1111111111111111111111111111111111111111";
export const X402_SIGNATURE = `0x${"0".repeat(63)}1${"0".repeat(63)}1${"1b"}`;
export const X402_TRANSACTION = `0x${"c".repeat(64)}`;

export const PAYMENT_IDENTIFIER_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    required: { type: "boolean" },
    id: {
      type: "string",
      minLength: 16,
      maxLength: 128,
      pattern: "^[a-zA-Z0-9_-]+$",
    },
  },
  required: ["required"],
} as const;

export function paymentIdentifierDeclaration(required: boolean): Readonly<Record<string, unknown>> {
  return {
    info: { required },
    schema: PAYMENT_IDENTIFIER_SCHEMA,
  };
}

export const X402_REQUIREMENTS = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "1250000",
  asset: BASE_USDC,
  payTo: X402_PAYEE,
  maxTimeoutSeconds: 60,
  extra: {
    name: "USD Coin",
    version: "2",
  },
} as const;

export const X402_PAYMENT_REQUIRED = {
  x402Version: 2,
  resource: {
    url: X402_URL,
    description: "Bounded JSON result",
    mimeType: "application/json",
  },
  accepts: [X402_REQUIREMENTS],
} as const;

export const X402_PAYMENT_PAYLOAD = {
  x402Version: 2,
  resource: { ...X402_PAYMENT_REQUIRED.resource },
  accepted: {
    ...X402_REQUIREMENTS,
    extra: { ...X402_REQUIREMENTS.extra },
  },
  payload: {
    signature: X402_SIGNATURE,
    authorization: {
      from: X402_PAYER,
      to: X402_PAYEE,
      value: X402_REQUIREMENTS.amount,
      validAfter: "0",
      validBefore: "1760000000",
      nonce: `0x${"ab".repeat(32)}`,
    },
  },
};

export function canonicalPaymentRequiredHeader(value: unknown = X402_PAYMENT_REQUIRED): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function canonicalPaymentSignatureHeader(value: unknown = X402_PAYMENT_PAYLOAD): string {
  return Buffer.from(JSON.stringify(sortJsonMembers(value)), "utf8").toString("base64");
}

export function canonicalPaymentResponseHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function sortJsonMembers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonMembers);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortJsonMembers(record[key])]));
  }
  return value;
}
