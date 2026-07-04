import assert from "node:assert/strict";

import {
  decideWorkspaceLanding,
  shouldMaterializeOnSubmit,
} from "../src/app/lib/workspace-draft.ts";

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

try {
  await step("clears session state on every workspace switch (local)", () => {
    assert.deepEqual(
      decideWorkspaceLanding({
        workspaceRoot: "/Users/me/AuroWork/starter",
      }),
      {
        clearSessionState: true,
        loadSessionsRoot: "/Users/me/AuroWork/starter",
      },
    );
  });

  await step("clears session state even when re-selecting same workspace", () => {
    // The store layer is responsible for calling decideWorkspaceLanding on
    // every click; this helper itself does not de-duplicate. Two consecutive
    // calls with the same input must return identical decisions so the store
    // never silently keeps stale session state.
    const a = decideWorkspaceLanding({
      workspaceRoot: "/Users/me/AuroWork/starter",
    });
    const b = decideWorkspaceLanding({
      workspaceRoot: "/Users/me/AuroWork/starter",
    });
    assert.deepEqual(a, b);
    assert.equal(a.clearSessionState, true);
  });

  await step("missing or blank root yields null loadSessionsRoot", () => {
    assert.equal(
      decideWorkspaceLanding({ workspaceRoot: "" }).loadSessionsRoot,
      null,
    );
    assert.equal(
      decideWorkspaceLanding({ workspaceRoot: "   " }).loadSessionsRoot,
      null,
    );
    assert.equal(
      decideWorkspaceLanding({ workspaceRoot: null }).loadSessionsRoot,
      null,
    );
    assert.equal(
      decideWorkspaceLanding({ workspaceRoot: undefined }).loadSessionsRoot,
      null,
    );
  });

  await step("materializes session when in draft state with content", () => {
    assert.equal(
      shouldMaterializeOnSubmit({
        selectedSessionId: null,
        hasComposerContent: true,
        workspaceReady: true,
      }),
      true,
    );
    assert.equal(
      shouldMaterializeOnSubmit({
        selectedSessionId: "",
        hasComposerContent: true,
        workspaceReady: true,
      }),
      true,
    );
    assert.equal(
      shouldMaterializeOnSubmit({
        selectedSessionId: "   ",
        hasComposerContent: true,
        workspaceReady: true,
      }),
      true,
    );
  });

  await step("does not materialize when a session is already selected", () => {
    assert.equal(
      shouldMaterializeOnSubmit({
        selectedSessionId: "ses_abc123",
        hasComposerContent: true,
        workspaceReady: true,
      }),
      false,
    );
  });

  await step("does not materialize when composer is empty", () => {
    assert.equal(
      shouldMaterializeOnSubmit({
        selectedSessionId: null,
        hasComposerContent: false,
        workspaceReady: true,
      }),
      false,
    );
  });

  await step("does not materialize when workspace runtime is not ready", () => {
    assert.equal(
      shouldMaterializeOnSubmit({
        selectedSessionId: null,
        hasComposerContent: true,
        workspaceReady: false,
      }),
      false,
    );
  });

  await step("regression: repeated draft submissions stay deterministic", () => {
    // Simulate the steady-state of an idle draft tab. Without composer
    // content we should never materialize, no matter how many idle ticks
    // happen.
    for (let i = 0; i < 100; i += 1) {
      assert.equal(
        shouldMaterializeOnSubmit({
          selectedSessionId: null,
          hasComposerContent: false,
          workspaceReady: true,
        }),
        false,
      );
    }
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
