---
okf_version: 0.2
---

# Documentation

Documentation for `repo-hygiene-action`, the composite GitHub Action that runs the
[`@rmartz/repo-hygiene`](https://github.com/rmartz/repo-hygiene) checks in a
consuming repo's CI. Written in [Open Knowledge Format](okf-format.md).

- [What repo-hygiene-action is](overview.md) — what the action does, its inputs,
  and how it differs from the reusable workflow it replaces.
- [Using it in a consuming repo](consuming.md) — the caller job to add, the
  permissions it needs, and how the pin stays current.
- [The OKF documentation format](okf-format.md) — how these pages are structured
  and validated in this repo.
- [Design & distribution](design/index.md) — how the action wraps the CLI and how
  new versions reach consumers automatically.
