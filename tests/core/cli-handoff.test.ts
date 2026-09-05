import assert from "node:assert/strict";
import test from "node:test";
import { createCliHandoff } from "../../src/cli-handoff.js";
import { ApnError } from "../../src/errors.js";

test("foreground CLI handoff keeps argv canonical and renders printable shell syntax inertly", () => {
  const cases = [
    ["plain", "plain"],
    ["two words", "'two words'"],
    ["semi;colon", "'semi;colon'"],
    ["amp&ersand", "'amp&ersand'"],
    ["pipe|value", "'pipe|value'"],
    ["single'quote", "'single'\"'\"'quote'"],
    ['double"quote', `'double"quote'`],
    ["back`tick", "'back`tick'"],
    ["dollar$(marker)", "'dollar$(marker)'"],
    ["back\\slash", "'back\\slash'"],
    ["", "''"],
  ] as const;

  for (const [value, rendered] of cases) {
    const input = ["apn", "--value", value];
    const handoff = createCliHandoff(input);
    input[2] = "mutated-after-capture";
    assert.deepEqual(handoff.argv, ["apn", "--value", value]);
    assert.equal(handoff.shell, `apn --value ${rendered}`);
    assert.equal(Object.isFrozen(handoff), true);
    assert.equal(Object.isFrozen(handoff.argv), true);
  }
});

test("foreground CLI handoff rejects every C0 and DEL raw control without echoing it", () => {
  for (const codePoint of [...Array.from({ length: 32 }, (_, index) => index), 0x7f]) {
    assert.throws(
      () => createCliHandoff(["apn", "--value", `safe${String.fromCodePoint(codePoint)}suffix`]),
      (error: unknown) => (
        error instanceof ApnError &&
        error.code === "APN_INVALID_INPUT" &&
        error.message === "Foreground CLI handoff arguments cannot contain raw control characters."
      ),
      `U+${codePoint.toString(16).padStart(4, "0")}`,
    );
  }
});

test("foreground CLI handoff preserves compatible safe output exactly", () => {
  const handoff = createCliHandoff([
    "apn",
    "pay",
    "transfer",
    "approve",
    "--operation",
    "a".repeat(64),
    "--rpc-url",
    "https://rpc.example/",
  ]);
  assert.equal(
    handoff.shell,
    `apn pay transfer approve --operation ${"a".repeat(64)} --rpc-url https://rpc.example/`,
  );
});
