import { describe, expect, test } from "bun:test";

import { inheritWorkspaceAuroConnection, resolveWorkspaceAuroConnection } from "./auro-connection.js";

describe("resolveWorkspaceAuroConnection", () => {
  test("falls back to server-level OpenCode settings when a workspace entry is missing them", () => {
    const connection = resolveWorkspaceAuroConnection(
      {
        auroBaseUrl: "http://127.0.0.1:54235",
        auroUsername: "user",
        auroPassword: "pass",
      },
      {
        id: "ws_test",
        name: "Test",
        path: "/tmp/test",
        preset: "starter",
        workspaceType: "local",
      },
    );

    expect(connection.baseUrl).toBe("http://127.0.0.1:54235");
    expect(connection.authHeader).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
  });

  test("prefers workspace-specific settings when present", () => {
    const connection = resolveWorkspaceAuroConnection(
      {
        auroBaseUrl: "http://127.0.0.1:54235",
        auroUsername: "user",
        auroPassword: "pass",
      },
      {
        id: "ws_test",
        name: "Test",
        path: "/tmp/test",
        preset: "starter",
        workspaceType: "local",
        baseUrl: "http://127.0.0.1:6000",
        auroUsername: "local-user",
        auroPassword: "local-pass",
      },
    );

    expect(connection.baseUrl).toBe("http://127.0.0.1:6000");
    expect(connection.authHeader).toBe(`Basic ${Buffer.from("local-user:local-pass").toString("base64")}`);
  });
});

describe("inheritWorkspaceAuroConnection", () => {
  test("copies server-level OpenCode connection into new local workspaces", () => {
    expect(
      inheritWorkspaceAuroConnection({
        auroBaseUrl: "http://127.0.0.1:54235",
        auroUsername: "user",
        auroPassword: "pass",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:54235",
      auroUsername: "user",
      auroPassword: "pass",
    });
  });
});
