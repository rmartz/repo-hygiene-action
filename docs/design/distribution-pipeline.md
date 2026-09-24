---
type: Design
title: The distribution pipeline
description: The automatic chain that ships new check logic to consumers — CLI bump, bot-automerge, semantic-release tag, and the consumer's own Dependabot pick-up.
tags: [design, releases, dependabot, automerge]
---

# The distribution pipeline

New versions of the check logic reach consumers with no manual step at any hop.
The chain has two halves: producing a new Action release here, and consumers
picking it up.

## Producing a release (this repo)

1. **CLI bump.** `@rmartz/repo-hygiene` publishes a new version to npmjs.
   Dependabot's npm ecosystem ([`dependabot.yml`](../../.github/dependabot.yml),
   no registry auth needed) checks **daily** and opens a PR
   bumping the pinned dependency + lockfile, titled
   `fix(deps): bump @rmartz/repo-hygiene …`. The daily interval bounds how long a
   CLI release waits before it can become an Action release.
2. **Auto-merge.** The
   [`bot-automerge`](https://github.com/rmartz/bot-automerge) caller classifies it
   as a trusted Dependabot patch/minor bump and enables native auto-merge. It lands
   once the required checks pass — CI plus the
   [`merge-safety`](https://github.com/rmartz/merge-safety) verdict — so nothing
   merges ahead of green.
3. **Release.** On merge to `main`, [`release.yml`](../../.github/workflows/release.yml)
   runs semantic-release. [`.releaserc.json`](../../.releaserc.json) maps `fix:` →
   **patch** (the stock Conventional-Commits default), so the CLI bump cuts a new
   tag + GitHub Release. The
   release publishes nothing to a registry and commits nothing back (no
   `@semantic-release/npm`, no `@semantic-release/git`), so the built-in
   `GITHUB_TOKEN` suffices — no PAT. Because this step only runs post-merge, a
   `Release dry-run` job in [`ci.yml`](../../.github/workflows/ci.yml) exercises
   the semantic-release config (that the changelog toolchain renders) on every
   PR, so a broken release setup fails the PR instead of the post-merge run — the
   pre-merge guard for the exact class of preset breakage seen in #1/#2.

The Action **mirrors the CLI's semver bump type** into its own release type: a CLI
minor becomes a `feat(deps):` (Action minor) and a CLI major a `feat(deps)!:` +
`breaking change` (Action major), while a patch stays `fix(deps):`. A **major** CLI
bump also falls out of the auto-merge set into its own PR for a human to review — a
CLI major is the strongest signal of consumer-facing breakage, so the breaking
mapping is the **default**, not the last word: the reviewer downgrades it (removes the
`!` and label) only when they confirm the break is invisible to Action consumers.
That mapping is a manual reviewer step here today; it is enforced automatically in
[`bot-automerge-action`](https://github.com/rmartz/bot-automerge-action) and will
arrive here as a shared action. The full rule, including how a breaking change is
propagated even when it reaches this repo only as a dependency bump, is the
[versioning policy](versioning.md).

## Picking it up (consumers)

4. **Consumer Dependabot.** Each consumer pins this Action by SHA
   (`uses: rmartz/repo-hygiene-action@<sha> # vX.Y.Z`) and runs Dependabot's
   `github-actions` ecosystem, which opens a PR bumping that pin to the new release.
5. **New checks auto-join.** A newly-added **default-on** check ships inside the CLI
   version this release pins, so it starts running the moment the consumer merges
   the bump — no edit to their caller. An opt-in check ships dormant until named in
   the consumer's `checks` input.

## Why an Action, not a reusable workflow

The predecessor shipped as a reusable workflow (`hygiene.yml`) that consumers
called at the job level. A composite Action lets the consumer own the job — its
triggers, checkout, and permissions — which sidesteps the reusable-workflow
constraint that a `workflow_call` cannot path-filter, and lets a consumer drop the
step into an existing job. The fleet cutover from the reusable workflow to this
Action is a coordinated, breaking migration driven through the
[`@rmartz/bootstrap`](https://github.com/rmartz/ai-tools) golden config.
