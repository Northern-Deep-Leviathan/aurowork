/**
 * Pure helpers for the "draft session" workspace switch flow.
 *
 * When the user clicks a workspace tile, AuroWork unconditionally enters a
 * draft state for that workspace: the previously selected session, messages,
 * todos and permissions are cleared. A real opencode session is only
 * materialized when the user submits their first composer message.
 *
 * Extracting the decisions as pure functions lets us unit test the policy
 * without standing up the SolidJS reactive store.
 */

export type WorkspaceLandingDecision = {
  /**
   * Whether to clear `selectedSessionId` and the associated per-session
   * caches (messages, todos, permissions, session status). For the draft
   * flow this is always `true` — we never silently keep the previous
   * workspace's session selected.
   */
  clearSessionState: true;

  /**
   * Whether to fire a fresh `loadSessions(root)` for the workspace root so
   * downstream guards see an up-to-date scope. Returns the normalized root
   * to load when present, or `null` if there is no root to load (which only
   * happens for remote workspaces or invalid input).
   */
  loadSessionsRoot: string | null;
};

export function decideWorkspaceLanding(input: {
  workspaceRoot?: string | null;
  workspaceType?: "local" | "remote" | null;
}): WorkspaceLandingDecision {
  const root = (input.workspaceRoot ?? "").trim();
  const isRemote = input.workspaceType === "remote";
  return {
    clearSessionState: true,
    loadSessionsRoot: !isRemote && root.length > 0 ? root : null,
  };
}

/**
 * Decide whether a composer submit should materialize a brand-new session
 * before sending the first message.
 *
 * Returns `true` when the user is in the draft state (no session selected)
 * AND the workspace is ready to host a new session.
 */
export function shouldMaterializeOnSubmit(input: {
  selectedSessionId?: string | null;
  hasComposerContent: boolean;
  workspaceReady: boolean;
}): boolean {
  if (!input.hasComposerContent) return false;
  if (!input.workspaceReady) return false;
  const current = (input.selectedSessionId ?? "").trim();
  return current.length === 0;
}
