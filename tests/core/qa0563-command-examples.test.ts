import assert from "node:assert/strict";
import test from "node:test";
import { bindArgv } from "../../src/command-binder.js";
import { COMMANDS } from "../../src/command-catalog.js";

// CLI-HELP-INCOMPLETE-EXAMPLES-063-001: a copied help example either asks for help or carries every
// required option, so it reaches the command's own checks instead of "Missing required --profile".
const EVM = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FILL: Readonly<Record<string, string>> = {
  "<operation-id>": "a".repeat(64), "<quote-hash>": "b".repeat(64), "<profile>": "default", "<source-profile>": "default",
  "<destination-gas-profile>": "gas", "<beneficiary-address>": EVM, "<account-address>": EVM, "<recipient-address>": EVM,
  "<usdc-usdt-or-wbtc-address>": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "<usdc-or-usdt-address>": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "<the-other-usdc-or-usdt-address>": "0xdAC17F958D2ee523a2206206994597C13D831ec7", "<destination-mint-transaction-hash>": `0x${"c".repeat(64)}`,
  "<unix-seconds-within-30-minutes>": "1900000000", "<unix-seconds-within-10-minutes>": "1900000000", "<unix-seconds>": "1900000000",
  "<tron-address>": TRON, "<same-tron-address>": TRON, "<solana-address>": SOLANA, "<solana-recipient-address>": SOLANA,
  "<solana-address-of-the-profile>": SOLANA,
};
const FAMILIES = ["circle evm", "swap ethereum uniswap", "swap ethereum uniswap-token", "swap tron sunswap", "swap solana jupiter", "swap solana orca"];
const inFamilies = (path: readonly string[]) => FAMILIES.some(family => path.join(" ").startsWith(`${family} `));
const filled = (example: string) => example.split(" ").slice(1).map(word => {
  if (!word.startsWith("<")) return word;
  const value = FILL[word]; assert.ok(value !== undefined, `no fixture for ${word}`); return value;
});

test("every help example is a --help discovery line or names every required option of its command", () => {
  let checked = 0;
  for (const command of COMMANDS) for (const example of command.examples) {
    const words = example.split(" ");
    assert.deepEqual(words.slice(0, command.path.length + 1), ["apn", ...command.path], example);
    if (words.at(-1) === "--help") continue;
    for (const option of command.options.filter(row => row.required)) assert.ok(words.includes(option.name), `${example} lacks ${option.name}`);
    checked++;
  }
  assert.ok(checked >= COMMANDS.length - 2, `${checked} of ${COMMANDS.length}`);
});

test("Circle, Uniswap, Uniswap token, SunSwap, Jupiter and Orca examples bind once their placeholders are filled", () => {
  const commands = COMMANDS.filter(command => inFamilies(command.path));
  assert.equal(commands.length, 43, "38 formerly path-only examples and five inventories");
  for (const command of commands) {
    const [example] = command.examples; assert.ok(example !== undefined);
    assert.doesNotThrow(() => bindArgv(filled(example)), example);
  }
});

test("dropping any required option from a filled example still refuses before binding", () => {
  let refusals = 0;
  for (const command of COMMANDS.filter(row => inFamilies(row.path))) {
    const words = filled(command.examples[0]!);
    for (const option of command.options.filter(row => row.required)) {
      const at = words.indexOf(option.name), without = [...words.slice(0, at), ...words.slice(at + 2)];
      assert.throws(() => bindArgv(without), { code: "APN_INVALID_INPUT", message: `Missing required ${option.name} option.` });
      refusals++;
    }
  }
  assert.ok(refusals >= 70, `${refusals} refusals`);
});
