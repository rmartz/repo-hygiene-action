# Design & distribution

How the composite action is put together, and how a new version of the check logic
reaches consumers with no per-repo work.

- [The integration contract](integration-contract.md) — how this action consumes
  `@rmartz/repo-hygiene`, the CLI invocation, and the workspace/action-path split.
- [The distribution pipeline](distribution-pipeline.md) — the CLI bump →
  bot-automerge → release → consumer Dependabot chain that ships new versions
  automatically.
