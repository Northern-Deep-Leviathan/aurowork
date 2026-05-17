# build-desktop.yml PR-based bump + setup-auro-git — Implementation Plan (Part 3 of 3)

> Continuation of `2026-05-17-build-desktop-pr-bump-part-2.md`. See Part 1 for goal, architecture, and file structure.

**Task in this part:**
- Task 5: Refactor `.github/workflows/build-desktop.yml` to adopt `setup-auro-git` in all three jobs and replace the inline direct-push bump with the new release-PR script.

This task has no unit-test harness — workflow YAML is validated by (a) syntax (`actionlint` or `yamllint` if available), (b) dry inspection of the diff against the spec, and (c) the first real `workflow_dispatch` run after merge. Because the workflow can only be exercised end-to-end on GitHub, we lean on careful step-by-step edits with verification commands at each stage.

---

## Task 5: Refactor `.github/workflows/build-desktop.yml`

**Files:**
- Modify: `.github/workflows/build-desktop.yml`

The workflow has three jobs: `prepare`, `create-release`, `build`. All three need the App token from `setup-auro-git`; `prepare` additionally restructures its bump step to call the new release script.

- [ ] **Step 1: Read the current workflow to anchor the edits**

```bash
sed -n '1,40p' .github/workflows/build-desktop.yml
```
This is for context only — no changes yet.

- [ ] **Step 2: Edit the `prepare` job — drop `RELEASE_PUSH_TOKEN` from checkout**

Find this block (around lines 42–47):

```yaml
      - name: Checkout (full history + tags)
        uses: actions/checkout@v4
        with:
          ref: ${{ github.sha }}
          fetch-depth: 0
          token: ${{ secrets.RELEASE_PUSH_TOKEN || github.token }}
```

Replace with:

```yaml
      - name: Checkout (full history + tags)
        uses: actions/checkout@v4
        with:
          ref: ${{ github.sha }}
          fetch-depth: 0
```

(`setup-auro-git` rewrites `origin` to use the App token after checkout, so the checkout-time token only needs read access — the default `github.token` is sufficient.)

- [ ] **Step 3: Replace the inline `Configure git identity` step with `Setup Auro Git`**

Find the `Configure git identity` step (around lines 59–64):

```yaml
      - name: Configure git identity
        shell: bash
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
```

Replace with:

```yaml
      - name: Setup Auro Git
        id: gitsetup
        uses: ./.github/actions/setup-auro-git
        with:
          auro-app-id: ${{ vars.AURO_APP_ID }}
          auro-app-key: ${{ secrets.AURO_APP_KEY }}
```

- [ ] **Step 4: Replace the `Bump, commit, tag, push` step with the PR-based flow**

Find the entire `Bump, commit, tag, push` step (`id: bump`, approximately lines 65–152, ending with the closing `} >> "$GITHUB_OUTPUT"` and a blank line before `Forward prerelease flag`).

Replace the entire step with:

```yaml
      - name: Bump on PR branch, merge, tag
        id: bump
        shell: bash
        env:
          BUMP_TYPE: ${{ inputs.bump }}
          GH_TOKEN: ${{ steps.gitsetup.outputs.token }}
          ACTOR: ${{ github.actor }}
        run: |
          set -euo pipefail

          # Sanity: must be on a branch (refs/heads/*) — refuse to run on a tag/PR.
          if [[ "${GITHUB_REF}" != refs/heads/* ]]; then
            echo "::error::This workflow must be dispatched from a branch (got: ${GITHUB_REF})."
            exit 1
          fi
          BRANCH="${GITHUB_REF#refs/heads/}"
          echo "Branch: $BRANCH"

          # bump-version.mjs has no runtime deps, but `pnpm bump:<type>` resolves
          # the script through pnpm's workspace filter, which needs the package
          # graph. Do NOT use --frozen-lockfile here: this job's whole purpose
          # is to mutate the lockfile, and main may already carry a lockfile
          # that's out of sync (e.g. left over from a failed previous run).
          pnpm install --no-frozen-lockfile --prefer-offline

          # Read current version BEFORE bumping.
          CUR_VER="$(node -p "require('./apps/app/package.json').version")"
          echo "Current version: $CUR_VER"

          # Run the bump script. It mutates 7 files in-place.
          pnpm bump:"$BUMP_TYPE"

          NEW_VER="$(node -p "require('./apps/app/package.json').version")"
          NEW_TAG="v${NEW_VER}"
          echo "New version: $NEW_VER"
          echo "New tag:     $NEW_TAG"

          # bump-version.mjs updates apps/orchestrator/package.json's
          # `aurowork-server` workspace dependency to the new version, which
          # invalidates pnpm-lock.yaml. Refresh the lockfile so the downstream
          # `pnpm install --frozen-lockfile` in the build job succeeds.
          pnpm install --lockfile-only

          # Guard 1: new version must differ from old.
          if [ "$CUR_VER" = "$NEW_VER" ]; then
            echo "::error::Bump produced the same version ($CUR_VER). Aborting."
            exit 1
          fi

          # Guard 2: new tag must not already exist on remote.
          if git ls-remote --tags origin "refs/tags/${NEW_TAG}" | grep -q .; then
            echo "::error::Tag ${NEW_TAG} already exists on origin. Aborting."
            exit 1
          fi

          # Guard 3: new version must be strictly greater than the largest existing v* tag.
          LARGEST="$(git tag --list 'v*' --sort=-v:refname | head -n1 || true)"
          if [ -n "$LARGEST" ]; then
            HIGHEST="$(printf '%s\n%s\n' "$LARGEST" "$NEW_TAG" | sort -V | tail -n1)"
            if [ "$HIGHEST" != "$NEW_TAG" ] || [ "$LARGEST" = "$NEW_TAG" ]; then
              echo "::error::New tag ${NEW_TAG} is not strictly greater than existing ${LARGEST}."
              exit 1
            fi
          fi

          # Stage everything bump-version.mjs touched. The release script will
          # commit them on the PR branch.
          git add -A
          if git diff --cached --quiet; then
            echo "::error::No changes to commit after bump — bump-version.mjs did nothing."
            exit 1
          fi

          # Hand off: branch + commit + push + open PR + watch checks +
          # admin-squash-merge + tag merge SHA + push tag + emit outputs.
          BASE_BRANCH="$BRANCH" \
          NEW_VER="$NEW_VER" \
          NEW_TAG="$NEW_TAG" \
            bash scripts/release/open-merge-release-pr.sh
```

(`ACTOR` and `GH_TOKEN` come from the step `env:` block; `BASE_BRANCH`, `NEW_VER`, `NEW_TAG` are exported inline at hand-off.)

The `Forward prerelease flag` step immediately below is unchanged.

- [ ] **Step 5: Edit the `create-release` job — add `setup-auro-git`, switch token**

Find the `create-release` job (around lines 163–199). It currently has a single step:

```yaml
  create-release:
    name: Create Release
    needs: prepare
    runs-on: ubuntu-latest
    steps:
      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          ...
```

Replace the `steps:` body with a checkout + setup-auro-git + the release step using the App token:

```yaml
  create-release:
    name: Create Release
    needs: prepare
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ needs.prepare.outputs.release_sha }}

      - name: Setup Auro Git
        id: gitsetup
        uses: ./.github/actions/setup-auro-git
        with:
          auro-app-id: ${{ vars.AURO_APP_ID }}
          auro-app-key: ${{ secrets.AURO_APP_KEY }}

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ steps.gitsetup.outputs.token }}
        shell: bash
        run: |
          set -euo pipefail

          TAG="${{ needs.prepare.outputs.release_tag }}"
          NAME="${{ needs.prepare.outputs.release_name }}"
          TARGET_SHA="${{ needs.prepare.outputs.release_sha }}"

          echo "Release tag:    $TAG"
          echo "Release name:   $NAME"
          echo "Target commit:  $TARGET_SHA"

          # Check if release already exists (e.g. previous run partially succeeded)
          if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
            echo "Release $TAG already exists — skipping."
            exit 0
          fi

          flags=()
          if [ "${{ needs.prepare.outputs.prerelease }}" = "true" ]; then
            flags+=( --prerelease )
          fi

          gh release create "$TAG" \
            --repo "$GITHUB_REPOSITORY" \
            --title "$NAME" \
            --notes "Desktop build for $TAG" \
            --target "$TARGET_SHA" \
            "${flags[@]}"
```

The checkout is needed so the `uses: ./.github/actions/setup-auro-git` reference can resolve a local action.

- [ ] **Step 6: Edit the `build` job — add `setup-auro-git`, switch all release tokens**

In the `build` job, immediately after the existing `Checkout bumped commit` and `Enable long paths` steps (around line 236), insert a `Setup Auro Git` step **before** the toolchain setup so its token is available to every later step that uploads to the release:

```yaml
      - name: Setup Auro Git
        id: gitsetup
        uses: ./.github/actions/setup-auro-git
        with:
          auro-app-id: ${{ vars.AURO_APP_ID }}
          auro-app-key: ${{ secrets.AURO_APP_KEY }}
```

Then swap two token references later in the same job:

**6a.** In the `Build + publish to release` step (around lines 365–380), change:

```yaml
        env:
          CI: true
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

to:

```yaml
        env:
          CI: true
          GITHUB_TOKEN: ${{ steps.gitsetup.outputs.token }}
```

**6b.** In the `Upload signature + latest.json` step (around lines 385–425), change:

```yaml
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

to:

```yaml
        env:
          GH_TOKEN: ${{ steps.gitsetup.outputs.token }}
```

No other changes in `build`.

- [ ] **Step 7: Confirm the file still parses as YAML**

Run:
```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build-desktop.yml')); print('ok')"
```
Expected: `ok`.

(If `actionlint` is available locally, run it too — it will catch more issues than `yaml.safe_load`. `actionlint` is optional.)

- [ ] **Step 8: Grep for stragglers — `RELEASE_PUSH_TOKEN` should be gone from this workflow**

```bash
grep -n "RELEASE_PUSH_TOKEN" .github/workflows/build-desktop.yml || echo "clean"
```
Expected: `clean`.

- [ ] **Step 9: Grep for stragglers — every `gh`/`git push` in this workflow now uses the App token**

```bash
grep -n -E "github\.token|secrets\.GITHUB_TOKEN" .github/workflows/build-desktop.yml || echo "clean"
```
Expected: `clean`. Every release-side token reference should now be `${{ steps.gitsetup.outputs.token }}` (in `prepare`, `create-release`, `build`).

If `grep` reports a match inside the `actions/checkout@v4` of `prepare` (we left that one as the default), that's fine — checkout's implicit `github.token` doesn't need to be explicit. But you should NOT see any explicit `github.token` or `secrets.GITHUB_TOKEN` reference in your edits.

- [ ] **Step 10: Diff the workflow against `main` and walk through it**

```bash
git diff --stat .github/workflows/build-desktop.yml
git diff .github/workflows/build-desktop.yml | head -200
```

Verify, against the spec:
- `prepare`: `Setup Auro Git` step appears, inline `git config` step is gone, `Bump…` step now ends in `bash scripts/release/open-merge-release-pr.sh` instead of inline `git commit / git tag / git push`.
- `create-release`: has `Checkout` + `Setup Auro Git` + `Create GitHub Release` (token from `gitsetup`).
- `build`: `Setup Auro Git` appears after `Enable long paths`; the tauri-action env's `GITHUB_TOKEN` and the upload step's `GH_TOKEN` both reference `steps.gitsetup.outputs.token`.

- [ ] **Step 11: Commit**

```bash
git add .github/workflows/build-desktop.yml
git commit -m "ci(build-desktop): PR-based version bump via setup-auro-git"
```

---

## Post-implementation verification

After all five tasks land, before merging:

- [ ] **Final tree state**

```bash
ls scripts/common/ scripts/release/
```
Expected:
```
scripts/common/:
open-merge-pr-common.sh
test-open-merge-pr-common.sh

scripts/release/:
generate-latest-json.mjs        (preexisting)
open-merge-release-pr.sh
test-open-merge-release-pr.sh
```

- [ ] **All test suites green**

```bash
bash scripts/common/test-open-merge-pr-common.sh \
  && bash scripts/publish/test-open-merge-auro-pr.sh \
  && bash scripts/release/test-open-merge-release-pr.sh \
  && echo "ALL GREEN"
```
Expected: `ALL GREEN`.

- [ ] **Workflow parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-desktop.yml')); print('ok')"
```
Expected: `ok`.

- [ ] **Repo secrets/vars sanity** (manual, in GitHub UI before first dispatch)

Confirm:
- Repository variable `AURO_APP_ID` is set.
- Repository secret `AURO_APP_KEY` is set.
- The GitHub App has `contents: write` and `pull-requests: write` permissions, plus repo access for `aurowork`, plus ruleset-bypass for protected branch `main` (so `gh pr merge --admin` works).
- `RELEASE_PUSH_TOKEN` is no longer required by this workflow (can be left in place but is unused).

- [ ] **First end-to-end run** (after merging the PR for this implementation)

Dispatch `Build Desktop` with `bump=patch`, `prerelease=true`, from a low-traffic branch. Confirm in the run logs that:
1. `prepare` opens a PR titled `chore: release vX.Y.Z`, watches checks, admin-merges it.
2. The tag `vX.Y.Z` appears on `main` pointing at the squashed merge commit.
3. `create-release` creates the release object targeting the same SHA.
4. `build` produces the MSI, signature, and `latest.json`, all uploaded under the same tag.

If any step fails, the failure-mode table in the spec tells you which side-effects to clean up manually.

---

**End of Part 3 — plan complete.**
