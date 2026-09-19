---
type: Design
title: The integration contract
description: How repo-hygiene-action consumes @rmartz/repo-hygiene — the pinned npm dependency, the CLI invocation, and the action-path vs workspace split.
tags: [design, integration, cli]
---

# The integration contract

The check logic lives in [`@rmartz/repo-hygiene`](https://github.com/rmartz/repo-hygiene);
this repo is only the Action wrapper. The contract between them is deliberately
narrow so each side can evolve independently.

## The package and CLI

- **Package:** `@rmartz/repo-hygiene`, published to GitHub Packages
  (`https://npm.pkg.github.com`, scope `@rmartz`, public). Readable with the
  built-in `GITHUB_TOKEN` plus `packages: read` — no PAT.
- **CLI (bin):** `ai-repo-hygiene`. The action invokes it as
  `ai-repo-hygiene <checks> --check [--config <path>]`, where `<checks>` is the
  space-separated `checks` input (empty → the registry-derived default-on set).

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

The `@rmartz` scope is routed to GitHub Packages by the repo's
[`.npmrc`](../../.npmrc); every other (public, npmjs) dependency resolves normally.

## The action-path vs workspace split

A composite action runs in the **consumer's** checkout, but its own
`package.json` / lockfile live wherever GitHub places the action
(`$GITHUB_ACTION_PATH`). So the action:

1. runs `npm ci` with `working-directory: ${{ github.action_path }}` — installing
   the pinned CLI into the action's own `node_modules`, not the consumer's tree;
   and
2. runs the checks with `working-directory` set to the consumer workspace,
   invoking the CLI by absolute path
   (`${GITHUB_ACTION_PATH}/node_modules/.bin/ai-repo-hygiene`).

The CLI scans its working directory and reads `.repo-hygiene.yml` from it, so the
consumer's tree is what gets checked while the action supplies the runner. The
consumer is responsible for `actions/checkout` before the step; the action never
checks out anything itself.
