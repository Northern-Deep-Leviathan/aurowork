import assert from "node:assert/strict";

import { resolveRefreshedConnectedIds } from "../src/app/utils/providers.ts";

const results = {
  ok: true,
  steps: [] as Array<Record<string, unknown>>,
};

async function step(name: string, fn: () => void | Promise<void>) {
  results.steps.push({ name, status: "running" });
  const index = results.steps.length - 1;

  try {
    await fn();
    results.steps[index] = { name, status: "ok" };
  } catch (error) {
    results.ok = false;
    results.steps[index] = {
      name,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
    throw error;
  }
}

const all = [
  { id: "anthropic" },
  { id: "openai" },
  { id: "opencode" },
];

try {
  await step("trusts a non-empty incoming connected list", () => {
    assert.deepEqual(
      resolveRefreshedConnectedIds(["anthropic", "openai"], ["opencode"], all),
      ["anthropic", "openai"],
    );
  });

  await step("preserves previous connected when incoming is empty (reload transient)", () => {
    // Simulates the happy-path race where provider.list() returns connected=[]
    // because opencode has not finished probing providers after reload.
    assert.deepEqual(
      resolveRefreshedConnectedIds([], ["anthropic", "openai"], all),
      ["anthropic", "openai"],
    );
  });

  await step("preserves previous connected when incoming is undefined (fallback path)", () => {
    // Simulates the fallback path where provider.list() threw and we are
    // rebuilding state from config.providers() which has no connected info.
    assert.deepEqual(
      resolveRefreshedConnectedIds(undefined, ["anthropic"], all),
      ["anthropic"],
    );
  });

  await step("drops previous connected ids that no longer exist in `all`", () => {
    assert.deepEqual(
      resolveRefreshedConnectedIds(undefined, ["anthropic", "stale-provider"], all),
      ["anthropic"],
    );
  });

  await step("returns empty array when both incoming and previous are empty", () => {
    assert.deepEqual(resolveRefreshedConnectedIds([], [], all), []);
    assert.deepEqual(resolveRefreshedConnectedIds(undefined, undefined, all), []);
    assert.deepEqual(resolveRefreshedConnectedIds(null, null, all), []);
  });

  await step("handles missing `all` gracefully", () => {
    // If the new provider list is missing, we cannot safely keep stale ids.
    assert.deepEqual(resolveRefreshedConnectedIds(undefined, ["anthropic"], undefined), []);
    assert.deepEqual(resolveRefreshedConnectedIds(undefined, ["anthropic"], null), []);
    assert.deepEqual(resolveRefreshedConnectedIds(undefined, ["anthropic"], []), []);
  });

  await step("regression: empty incoming on reload does not clobber the selected provider", () => {
    // Repeated reloads should not progressively shrink the connected list.
    let connected = ["anthropic", "openai"];
    for (let i = 0; i < 50; i += 1) {
      connected = resolveRefreshedConnectedIds([], connected, all);
    }
    assert.deepEqual(connected, ["anthropic", "openai"]);
  });

  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  results.ok = false;
  console.error(
    JSON.stringify(
      {
        ...results,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
