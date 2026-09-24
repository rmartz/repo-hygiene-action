# repo-hygiene-action

A composite GitHub Action that runs the
[`@rmartz/repo-hygiene`](https://github.com/rmartz/repo-hygiene) suite of low-cost
CI checks (conflict markers, GitHub Actions SHA pins, package pins, Markdown link
integrity, OKF frontmatter, file-size caps, and more) against the repository that
calls it — packaged so that:

1. **Updates propagate automatically.** Consuming repos pin this Action by version;
   Dependabot's `github-actions` ecosystem opens PRs to bump that pin on its normal
   schedule.
2. **New checks are low-friction.** New checks ship inside the pinned
   `@rmartz/repo-hygiene` CLI; consumers pick them up on the next Dependabot bump
   with no per-repo YAML edits.

The check _logic_ lives in `@rmartz/repo-hygiene`. This repo only wraps its CLI in
an Action step, holds the CLI as a pinned dependency, and re-releases itself
whenever Dependabot bumps that pin — so the whole chain from a new check to a
consumer's CI runs itself.

## Using it in a consuming repo

```yaml
# .github/workflows/repo-hygiene.yml
name: Repo Hygiene
on: [pull_request, push]

permissions:
  contents: read

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

Check out your repository first (the Action scans the calling workspace) and add a
Dependabot `github-actions` entry so the pin stays current. No token or
`packages: read` permission is needed: the Action installs the public
`@rmartz/repo-hygiene` package from npmjs. See the
[consumer setup guide](docs/consuming.md) for the full walkthrough and the
path-filtering caveat.

### Inputs

| Input               | Default | Meaning                                                       |
| ------------------- | ------- | ------------------------------------------------------------- |
| `checks`            | `''`    | Space-separated check names. Empty runs the default-on set.   |
| `config`            | `''`    | Path to `.repo-hygiene.yml`, relative to `working-directory`. |
| `node-version`      | `'22'`  | Node.js version the checks run under.                         |
| `working-directory` | `'.'`   | Directory to scan (the repo root by default).                 |
| `token`             | `''`    | Deprecated and ignored; removed in the next major version.    |

Omit `checks` to run the default-on set (`conflict-markers`, `action-pins`); name
checks to opt into more (this becomes the exact run list). There is no `version`
input — the CLI version is the one pinned in this Action's lockfile.

## How it relates to `@rmartz/repo-hygiene`

This Action is the successor to that package's reusable workflow (`hygiene.yml`).
See [the integration contract](docs/design/integration-contract.md) and
[the distribution pipeline](docs/design/distribution-pipeline.md).

## Documentation

Full docs, written in [Open Knowledge Format](docs/okf-format.md), start at
[docs/index.md](docs/index.md).

## Releases

Versioned by [semantic-release](https://semantic-release.gitbook.io/): a merge to
`main` cuts the tag + GitHub Release. It publishes no package and commits nothing
back. A Dependabot `fix(deps)` bump of `@rmartz/repo-hygiene` cuts a patch
release, which is how new check logic reaches consumers.

---

🤖 Created by Claude Opus 4.8
