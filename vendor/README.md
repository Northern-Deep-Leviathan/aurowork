# vendor/

External source mirrors for self-reference (not built, not shipped).

## opencode/ (gitignored)

Local mirror of the upstream OpenCode repo. Used by the
`opencode-mirror` and `aurowork-core` skills as a read-only reference
when answering questions about OpenCode internals.

### First-time setup

```bash
git clone https://github.com/anomalyco/opencode vendor/opencode
```

### Update

```bash
git -C vendor/opencode pull --ff-only
```

### Why gitignored

`vendor/opencode/` is excluded via `.gitignore` (`vendor/opencode/`).
We never commit the upstream tree — it's a developer convenience only.
