---
type: Design
title: The integration contract
description: How repo-hygiene-action consumes @rmartz/repo-hygiene — the pinned npm dependency, the library API it calls, and the action-path vs workspace split.
tags: [design, integration]
---

# The integration contract

The check logic lives in [`@rmartz/repo-hygiene`](https://github.com/rmartz/repo-hygiene);
this repo is only the Action wrapper. The contract between them is deliberately
narrow so each side can evolve independently.

## The package and its API

- **Package:** `@rmartz/repo-hygiene`, published publicly to npmjs
  (`https://registry.npmjs.org/`, with provenance). Installs with no auth — no
  token or `packages: read` required. Versions up to 7.0.1 were also published to
  GitHub Packages, which older Action releases installed from.
- **Library API, not the CLI.** The action's runner,
  [`scripts/run-checks.mjs`](../../scripts/run-checks.mjs), imports
  `createRegistry`, `loadConfig`, and `runHygiene` from the package and does what
  `ai-repo-hygiene <checks> --check [--config <path>]` does: an empty `checks`
  input resolves to the registry's default-on set, and the annotations and exit
  code are identical. It calls the library rather than the bin because it needs
  each finding's `check` to post one commit status per check. All checks still run
  in one pass over one resolved file set. The CLI has no machine-readable output
  to recover that grouping from.
- **What this relies on.** The exported `Registry` (`get`, `defaultNames`),
  `loadConfig`, `runHygiene`, `formatFindings`, `formatFindingsGithub`,
  `resolveFormat`, and the `Finding` shape (`check`, `severity`). A package
  change to any of these — rename, removal, or signature change — breaks the
  runner, and the dogfood job catches it on the Dependabot bump PR.

## Version consumption — a pinned dependency, not an install string

The action holds `@rmartz/repo-hygiene` as a **pinned `package.json` dependency**
(exact `major.minor.patch`) with a committed `package-lock.json`, not as a
`npm install -g @rmartz/repo-hygiene@<literal>` string in a run step. This is the
crux of the design:

- A literal install string is invisible to Dependabot, which cannot bump a version
  buried in shell. A lockfile dependency **is** on Dependabot's npm channel.
- So the CLI version is bumped by Dependabot → auto-merged by bot-automerge → cut
  as a new Action release. See [the distribution pipeline](distribution-pipeline.md).
- The pinned version is therefore the single source of truth for "which checks this
  Action ref runs," which is why the Action has no `version` input.

The repo's [`.npmrc`](../../.npmrc) pins the `@rmartz` scope to npmjs. That keeps
a runner- or user-level `.npmrc` that maps `@rmartz` to GitHub Packages (other
`@rmartz` packages still live there) from redirecting the install.

## The action-path vs workspace split

A composite action runs in the **consumer's** checkout, but its own
`package.json` / lockfile live wherever GitHub places the action
(`$GITHUB_ACTION_PATH`). So the action:

1. runs `npm ci` with `working-directory: ${{ github.action_path }}` — installing
   the pinned CLI into the action's own `node_modules`, not the consumer's tree;
   and
2. runs `node ${GITHUB_ACTION_PATH}/scripts/run-checks.mjs` with
   `working-directory` set to the consumer workspace. Because the script lives in
   the action's directory, its `@rmartz/repo-hygiene` import resolves to the copy
   just installed there.

The engine scans its working directory and reads `.repo-hygiene.yml` from it, so the
consumer's tree is what gets checked while the action supplies the runner. The
consumer is responsible for `actions/checkout` before the step; the action never
checks out anything itself.
