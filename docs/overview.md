---
type: Reference
title: What repo-hygiene-action is
description: The composite Action that wraps the @rmartz/repo-hygiene CLI, its inputs, and why a version-pinned Action replaces the reusable workflow.
tags: [action, overview, ci]
---

# What repo-hygiene-action is

`repo-hygiene-action` is a **composite GitHub Action** that runs the
[`@rmartz/repo-hygiene`](https://github.com/rmartz/repo-hygiene) suite of low-cost
CI checks (conflict markers, GitHub Actions SHA pins, package pins, Markdown link
integrity, OKF frontmatter, file-size caps, and more) against the repository that
calls it. A consumer references it as a single step:

```yaml
- uses: rmartz/repo-hygiene-action@<sha> # vX.Y.Z
```

It is the Action-shaped successor to `@rmartz/repo-hygiene`'s reusable workflow
(`hygiene.yml`). The check _logic_ still lives in `@rmartz/repo-hygiene`; this repo
only wraps its CLI in a step consumers can drop into their own job. See
[the integration contract](design/integration-contract.md).

## What it does at run time

1. Sets up Node.js and points npm at GitHub Packages for the `@rmartz` scope.
2. Runs `npm ci` **in the action's own directory** to install the exact
   `@rmartz/repo-hygiene` version pinned in this repo's `package-lock.json`.
3. Invokes `ai-repo-hygiene <checks> --check [--config <path>]` against the
   consumer's checked-out workspace, emitting `::error` / `::warning` annotations
   inline on the PR diff.

The consumer checks out its own repository before the step; the action never checks
out anything itself.

## Inputs

| Input               | Default               | Meaning                                                                |
| ------------------- | --------------------- | ---------------------------------------------------------------------- |
| `checks`            | `''`                  | Space-separated check names. Empty runs the registry's default-on set. |
| `config`            | `''`                  | Path to `.repo-hygiene.yml`, relative to `working-directory`.          |
| `node-version`      | `'22'`                | Node.js version the checks run under.                                  |
| `working-directory` | `'.'`                 | Directory to scan (the repo root by default).                          |
| `token`             | `${{ github.token }}` | Token used to read the public package from GitHub Packages.            |

There is deliberately **no `version` input** (unlike the reusable workflow): the
installed CLI version is the one pinned in this Action's lockfile, bumped by
Dependabot and shipped as a new Action release. See
[the distribution pipeline](design/distribution-pipeline.md).

## Choosing checks

Omit `checks` to run the default-on set (`conflict-markers`, `action-pins`); a
newly-added default-on check auto-joins on your next Dependabot bump of this
Action. To opt into more checks, name them explicitly — this becomes the exact run
list, so include the defaults you still want — and point `config` at your
`.repo-hygiene.yml`. Per-check configuration is documented in the
[`@rmartz/repo-hygiene` checks reference](https://github.com/rmartz/repo-hygiene/blob/main/docs/checks/index.md).
