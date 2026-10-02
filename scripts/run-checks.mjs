// Runs the @rmartz/repo-hygiene checks against the consumer workspace (the
// process cwd) and posts one commit status per check, so the PR's status list
// shows exactly which check failed. The engine is called through the package's
// library API rather than its CLI so every check runs in a single pass over one
// resolved file set, and findings can be grouped by the check that produced
// them. Exit code and annotations match `repo-hygiene --check`.
//
// An inconclusive run (CLI exit 3: an external transient error such as a rate
// limit or timeout, with no error finding) is not a failure, since there is
// nothing to fix in the change. By default the runner cancels its own workflow
// run so the conclusion reads `cancelled`, not `failure`; see cancelRun below.
//
// Inputs arrive as INPUT_* env vars set by action.yml. See
// docs/design/integration-contract.md.

import { readFileSync } from 'node:fs';
import {
  createRegistry,
  formatFindings,
  formatFindingsGithub,
  loadConfig,
  resolveFormat,
  runHygiene,
} from '@rmartz/repo-hygiene';

const env = process.env;

// The CLI's exit-code contract (src/outcome.ts in @rmartz/repo-hygiene).
const EXIT_INCONCLUSIVE = 3;
// How long to wait for a requested cancellation to stop this step before
// falling back to a non-zero exit.
const CANCEL_WAIT_MS = 120_000;

const registry = createRegistry();
const requested = (env.INPUT_CHECKS ?? '').split(/\s+/).filter(Boolean);
const names = requested.length > 0 ? requested : registry.defaultNames();
const unknown = names.filter((name) => !registry.get(name));
if (unknown.length > 0) {
  console.error(`unknown check: ${unknown.join(', ')}`);
  process.exit(2);
}

const config = loadConfig({ path: env.INPUT_CONFIG || undefined });
// The engine silently skips a check disabled in config; it gets no status either.
const enabled = names.filter((name) => config.checks[name]?.enabled !== false);

const result = await runHygiene(registry, { mode: '--check', only: enabled, config });

if (result.findings.length > 0) {
  if (resolveFormat(undefined, env) === 'github') {
    console.log(formatFindingsGithub(result.findings));
  } else {
    console.error(formatFindings(result.findings));
  }
}

if (env.INPUT_STATUSES === 'true') {
  await postStatuses(enabled, result.findings);
}

if (result.exitCode === EXIT_INCONCLUSIVE) await handleInconclusive();

process.exit(result.exitCode);

// Report an inconclusive run as cancelled rather than failed: request
// cancellation of this workflow run and wait for it to stop the step. If the
// cancel is disabled or refused (no `actions: write`), fall through to the
// non-zero exit with an annotation that says to re-run, not to fix the change.
async function handleInconclusive() {
  const rerun =
    'An external transient error (rate limit, timeout, or network) kept a check from ' +
    'reaching a verdict. Nothing in the change needs fixing; re-run the job.';
  if (env.INPUT_ON_INCONCLUSIVE !== 'cancel') {
    console.log(`::error title=repo-hygiene (inconclusive)::${rerun}`);
    return;
  }
  const refused = await cancelRun();
  if (refused) {
    console.log(
      `::error title=repo-hygiene (inconclusive)::${rerun} Could not cancel the run instead ` +
        `(${refused}); grant the job \`actions: write\` to report this as cancelled.`,
    );
    return;
  }
  console.log(`::warning title=repo-hygiene (inconclusive)::${rerun} Cancelling this run.`);
  await new Promise((resolve) => setTimeout(resolve, CANCEL_WAIT_MS));
  console.log(
    `::error title=repo-hygiene (inconclusive)::${rerun} The run was not cancelled within ` +
      `${CANCEL_WAIT_MS / 1000}s.`,
  );
}

/** Request cancellation of this workflow run; returns why it failed, or undefined. */
async function cancelRun() {
  const repo = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  if (!repo || !runId || !env.INPUT_TOKEN) return 'no repository, run id, or token';
  try {
    const response = await fetch(
      `${env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${repo}/actions/runs/${runId}/cancel`,
      { method: 'POST', headers: apiHeaders() },
    );
    return response.ok ? undefined : `HTTP ${response.status}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function apiHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${env.INPUT_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function postStatuses(checks, findings) {
  const repo = env.GITHUB_REPOSITORY;
  const sha = env.INPUT_SHA;
  if (!repo || !sha || !env.INPUT_TOKEN) {
    console.log(
      '::notice title=repo-hygiene::Not posting per-check statuses: no repository, SHA, or token.',
    );
    return;
  }
  // A fork PR's GITHUB_TOKEN is read-only, so posting would 403 on every run.
  if (isForkPullRequest(repo)) {
    console.log(
      '::notice title=repo-hygiene::Not posting per-check statuses on a fork pull request (read-only token).',
    );
    return;
  }

  const serverUrl = env.GITHUB_SERVER_URL ?? 'https://github.com';
  const targetUrl = `${serverUrl}/${repo}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT ?? 1}`;
  const prefix = env.INPUT_STATUS_CONTEXT || 'repo-hygiene';

  for (const check of checks) {
    const own = findings.filter((f) => f.check === check);
    const count = (severity) => own.filter((f) => f.severity === severity).length;
    const counts = {
      errors: count('error'),
      inconclusive: count('inconclusive'),
      warnings: count('warn'),
    };
    let failure;
    try {
      const response = await fetch(
        `${env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${repo}/statuses/${sha}`,
        {
          method: 'POST',
          headers: apiHeaders(),
          body: JSON.stringify({
            state: stateOf(counts),
            context: `${prefix} / ${check}`,
            description: describe(counts),
            target_url: targetUrl,
          }),
        },
      );
      if (!response.ok) failure = `HTTP ${response.status}`;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    if (failure) {
      // Most often a job without `statuses: write`. Warn once and stop; the job's
      // own pass/fail still reports the overall result.
      console.log(
        `::warning title=repo-hygiene::Could not post per-check statuses (${failure}). ` +
          'Grant the job `statuses: write`, or set `statuses: false` to silence this.',
      );
      return;
    }
  }
}

// A detected issue is `failure`. A check that couldn't reach a verdict is
// `error`, GitHub's "couldn't evaluate" state, not a judgement of the change.
function stateOf({ errors, inconclusive }) {
  if (errors > 0) return 'failure';
  if (inconclusive > 0) return 'error';
  return 'success';
}

function describe({ errors, inconclusive, warnings }) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (errors > 0) parts.push(plural(errors, 'error'));
  if (warnings > 0) parts.push(plural(warnings, 'warning'));
  if (errors === 0 && inconclusive > 0) parts.unshift('Inconclusive — re-run');
  return parts.length > 0 ? parts.join(', ') : 'Passed';
}

function isForkPullRequest(repo) {
  if (!env.GITHUB_EVENT_PATH) return false;
  try {
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    const head = event.pull_request?.head?.repo?.full_name;
    return head !== undefined && head !== repo;
  } catch {
    return false;
  }
}
