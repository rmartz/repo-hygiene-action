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
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  statuses: write # post one commit status per check
  actions: write # report an inconclusive run as cancelled, not failed

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

- **`push` is limited to `main`.** `pull_request` already covers PR branches; an
  unfiltered `push` fires alongside it on every PR-branch push, running the job
  twice and posting two identical `hygiene` checks on the same commit.
- **Check out first.** The action scans the calling workspace, so the job must run
  `actions/checkout` before the `- uses:` step. The action does not check out
  anything itself. A plain checkout is enough — the checks are tree-based
  (`git ls-files` / file reads, no history), so **no `fetch-depth: 0`** is needed.
- **`statuses: write`.** The action posts one commit status per check —
  `repo-hygiene / okf`, `repo-hygiene / docs-links`, … — so a contributor sees
  which check failed straight from the PR's status list. Without the scope the
  action logs one warning and carries on; the job's own pass/fail still reports
  the overall result. Set `statuses: false` to opt out.
- **`actions: write`, in a workflow of its own.** When the run is
  [inconclusive](#inconclusive-runs), the action cancels its own workflow run.
  Without the scope it fails the step instead, with an annotation saying to
  re-run. Cancelling stops every job in the run, which is why the action gets a
  dedicated workflow; if you embed it in a shared one, set
  `on-inconclusive: fail`.
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
description. A check that couldn't reach a verdict (an inconclusive finding and
no error) posts state `error`, GitHub's "couldn't evaluate" state, described as
"Inconclusive — re-run". The status links to the workflow run, where the
annotations are.

- **They can be required checks.** Any of them can be marked required in branch
  protection, alongside or instead of the job itself. Only require checks that run
  on every commit: a check disabled in `.repo-hygiene.yml` (`enabled: false`) or
  dropped from `checks` posts no status, and a required status that never arrives
  blocks the PR.
- **Fork pull requests get none.** A fork PR's `GITHUB_TOKEN` is read-only, so the
  action skips posting there (with a notice) and only the job result shows. Don't
  make per-check statuses required if you accept fork PRs.

## Inconclusive runs

A failure means a check found an issue in the change that needs fixing. An
external transient error (a rate limit, a timeout, an unreachable network)
proves nothing about the change, so the CLI reports it as **inconclusive** and
exits `3` when no check found an error. A detected issue outranks it: if one
check errors while another is inconclusive, the run fails.

On an inconclusive run the action, after posting statuses:

| `on-inconclusive`  | `actions: write` | Result                                                             |
| ------------------ | ---------------- | ------------------------------------------------------------------ |
| `cancel` (default) | granted          | Cancels the workflow run; the conclusion is `cancelled`.           |
| `cancel` (default) | missing          | Fails the step with an `inconclusive` annotation saying to re-run. |
| `fail`             | either           | Fails the step with an `inconclusive` annotation saying to re-run. |

A cancelled required check still blocks the PR until it's re-run, which is the
intent: the verdict is missing, not negative.

## Path-filtering caveat

Because you own the job, you may add `on: pull_request: paths:` to run it only when
relevant files change. If you do, keep the job **out of required status checks**
(or add an always-reporting `detect-changes` shim), or a path-filtered required
check that never runs will hang the PR forever. Whole-tree checks such as
`okf-index` and `md-pairing` are structural invariants and should not be
path-scoped regardless.
