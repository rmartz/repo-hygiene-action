---
type: Guidance
title: Using repo-hygiene-action in a consuming repo
description: The caller job to add, the checkout + permissions it requires, how to select checks, and how Dependabot keeps the pin current.
tags: [consumer, setup, ci]
---

# Using repo-hygiene-action in a consuming repo

Add one workflow. Unlike the reusable workflow it replaces, this is a normal
Action step, so the consumer owns the job — its triggers, its checkout, and its
permissions.

```yaml
# .github/workflows/repo-hygiene.yml
name: Repo Hygiene
on: [pull_request, push]

permissions:
  contents: read
  statuses: write # post one commit status per check

jobs:
  hygiene:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@<sha> # v7.0.1
      - uses: rmartz/repo-hygiene-action@<sha> # vX.Y.Z
        with:
          checks: conflict-markers action-pins docs-links okf
          config: .repo-hygiene.yml
```

Why each piece is there:

- **Check out first.** The action scans the calling workspace, so the job must run
  `actions/checkout` before the `- uses:` step. The action does not check out
  anything itself. A plain checkout is enough — the checks are tree-based
  (`git ls-files` / file reads, no history), so **no `fetch-depth: 0`** is needed.
- **`statuses: write`.** The action posts one commit status per check —
  `repo-hygiene / okf`, `repo-hygiene / docs-links`, … — so a contributor sees
  which check failed straight from the PR's status list. Without the scope the
  action logs one warning and carries on; the job's own pass/fail still reports
  the overall result. Set `statuses: false` to opt out.
- **No `packages: read` needed.** The install pulls `@rmartz/repo-hygiene` from
  npmjs with no auth — no token or `packages: read` required.
- **`checks` is the exact run list.** Omit it to run the default-on set; name
  checks to opt in (include the defaults you still want).
- **`config`** points at the repo's `.repo-hygiene.yml`, resolved relative to
  `working-directory` (the repo root by default).

## Keep the pin current

Pin the action by commit SHA with a plain `# vX.Y.Z` comment and run Dependabot's
`github-actions` ecosystem — the same channel every Action consumer uses:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

Dependabot opens a PR bumping the SHA + comment to each new release. A newly-added
default-on check ships inside that release and starts running with no edit to your
caller — see [the distribution pipeline](design/distribution-pipeline.md).

## Per-check statuses

Each selected check gets a status named `<status-context> / <check>`
(`status-context` defaults to `repo-hygiene`; give each invocation its own value
if a workflow runs the action more than once). A check fails its status only on an
`error` finding; a `warn`-only check passes with the warning count in its
description. The status links to the workflow run, where the annotations are.

- **They can be required checks.** Any of them can be marked required in branch
  protection, alongside or instead of the job itself. Only require checks that run
  on every commit: a check disabled in `.repo-hygiene.yml` (`enabled: false`) or
  dropped from `checks` posts no status, and a required status that never arrives
  blocks the PR.
- **Fork pull requests get none.** A fork PR's `GITHUB_TOKEN` is read-only, so the
  action skips posting there (with a notice) and only the job result shows. Don't
  make per-check statuses required if you accept fork PRs.

## Path-filtering caveat

Because you own the job, you may add `on: pull_request: paths:` to run it only when
relevant files change. If you do, keep the job **out of required status checks**
(or add an always-reporting `detect-changes` shim), or a path-filtered required
check that never runs will hang the PR forever. Whole-tree checks such as
`okf-index` and `md-pairing` are structural invariants and should not be
path-scoped regardless.
