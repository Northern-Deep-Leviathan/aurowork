import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";

import { buildDebugReport, redact } from "./report.mjs";

test("debug report includes setup doctor payload", () => {
  const report = buildDebugReport({
    setupDoctor: {
      ok: true,
      summary: { pass: 1, warn: 0, fail: 0 },
      checks: [{ id: "fixture", status: "pass", details: "ok" }],
    },
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.productScope, "local-desktop");
  assert.equal(report.setupDoctor.ok, true);
  assert.equal(report.setupDoctor.checks[0].id, "fixture");
});

test("redact removes secret-shaped keys, auth headers, tokens, and home paths", () => {
  const redacted = redact({
    token: "plain-token",
    nested: {
      Authorization: "Bearer abc.def.ghi",
      url: "https://user:pass@example.com/path",
      path: `${homedir()}/Library/Application Support/AuroWork/config.json`,
      text: "npm token ghp_abcdefghijklmnopqrstuvwxyz123456",
      apiKey: "sk-abcdefghijklmnopqrstuvwxyz123456",
    },
  });

  assert.equal(redacted.token, "[redacted]");
  assert.equal(redacted.nested.Authorization, "[redacted]");
  assert.equal(redacted.nested.apiKey, "[redacted]");
  assert.match(redacted.nested.url, /\[redacted\]/);
  assert.doesNotMatch(redacted.nested.path, new RegExp(escapeRegExp(homedir())));
  assert.match(redacted.nested.path, /^~/);
  assert.doesNotMatch(JSON.stringify(redacted), /ghp_abcdefghijklmnopqrstuvwxyz123456/);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
