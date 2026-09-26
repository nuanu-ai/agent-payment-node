import type { JupiterRawInstruction } from "./codec.js";
import { canonicalAddress, invalid, JUPITER_V6_PROGRAM } from "./catalog.js";

/** Expected identities are supplied by an independent caller, never inferred from the instruction. */
export interface RouteV2FixedAccounts {
  readonly userTransferAuthority: string;
  readonly userSourceTokenAccount: string;
  readonly userDestinationTokenAccount: string;
  readonly sourceMint: string;
  readonly destinationMint: string;
  readonly sourceTokenProgram: string;
  readonly destinationTokenProgram: string;
  readonly destinationTokenAccount: string | null;
  readonly eventAuthority: string;
}

export interface OfflineRouteV2 {
  readonly signable: false;
  readonly inAmount: string;
  readonly quotedOutAmount: string;
  readonly slippageBps: number;
  readonly platformFeeBps: number;
  readonly positiveSlippageBps: number;
  readonly routePlan: readonly {
    readonly swap: "Quantum";
    readonly side: 0 | 1;
    readonly bps: number;
    readonly inputIndex: number;
    readonly outputIndex: number;
  }[];
  readonly remainingAccountCount: number;
}

/** Offline decode of the captured Quantum route_v2 variant. Remaining account roles are unknown. */
export function decodeQuantumRouteV2Offline(instruction: JupiterRawInstruction, expected: RouteV2FixedAccounts): OfflineRouteV2 {
  if (instruction.programId !== JUPITER_V6_PROGRAM || instruction.accounts.length < 10) invalid("Jupiter route_v2 program or fixed account count is invalid.");
  const roles = [
    [expected.userTransferAuthority, false, true],
    [expected.userSourceTokenAccount, true, false],
    [expected.userDestinationTokenAccount, true, false],
    [expected.sourceMint, false, false],
    [expected.destinationMint, false, false],
    [expected.sourceTokenProgram, false, false],
    [expected.destinationTokenProgram, false, false],
    [expected.destinationTokenAccount ?? JUPITER_V6_PROGRAM, expected.destinationTokenAccount !== null, false],
    [expected.eventAuthority, false, false],
    [JUPITER_V6_PROGRAM, false, false],
  ] as const;
  roles.forEach(([address, writable, signer], index) => {
    const account = instruction.accounts[index]!;
    if (account.pubkey !== canonicalAddress(address) || account.isWritable !== writable || account.isSigner !== signer) {
      invalid(`Jupiter route_v2 fixed account ${index} is invalid.`);
    }
  });

  if (typeof instruction.data !== "string" || Buffer.from(instruction.data, "base64").toString("base64") !== instruction.data) {
    invalid("Jupiter route_v2 data is not canonical base64.");
  }
  const data = Buffer.from(instruction.data, "base64");
  if (data.length < 34 || data.subarray(0, 8).toString("hex") !== "bb64facc31c4af14") invalid("Jupiter route_v2 discriminator or length is invalid.");
  const count = data.readUInt32LE(30);
  // The known Quantum { side: Side } variant uses six bytes per RoutePlanStepV2.
  if (count < 1 || count > 16 || data.length !== 34 + count * 6) invalid("Jupiter route_v2 Quantum route length is invalid.");
  const routePlan: OfflineRouteV2["routePlan"][number][] = [];
  for (let index = 0; index < count; index++) {
    const offset = 34 + index * 6;
    const side = data[offset + 1];
    const bps = data.readUInt16LE(offset + 2);
    if (data[offset] !== 125 || side !== 0 && side !== 1 || bps < 1 || bps > 10_000) {
      invalid("Jupiter route_v2 contains an unsupported or invalid Quantum step.");
    }
    routePlan.push(Object.freeze({ swap: "Quantum", side, bps, inputIndex: data[offset + 4]!, outputIndex: data[offset + 5]! }));
  }
  return Object.freeze({ signable: false, inAmount: data.readBigUInt64LE(8).toString(), quotedOutAmount: data.readBigUInt64LE(16).toString(),
    slippageBps: data.readUInt16LE(24), platformFeeBps: data.readUInt16LE(26), positiveSlippageBps: data.readUInt16LE(28),
    routePlan: Object.freeze(routePlan), remainingAccountCount: instruction.accounts.length - 10 });
}
