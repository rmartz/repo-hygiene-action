// Runs the @rmartz/repo-hygiene checks against the consumer workspace (the
// process cwd) and posts one commit status per check, so the PR's status list
// shows exactly which check failed. The engine is called through the package's
// library API rather than its CLI so every check runs in a single pass over one
// resolved file set, and findings can be grouped by the check that produced
// them. Exit code and annotations match `ai-repo-hygiene --check`.
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

process.exit(result.exitCode);

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
    const errors = own.filter((f) => f.severity === 'error').length;
    const warnings = own.length - errors;
    let failure;
    try {
      const response = await fetch(
        `${env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${repo}/statuses/${sha}`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${env.INPUT_TOKEN}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({
            state: errors > 0 ? 'failure' : 'success',
            context: `${prefix} / ${check}`,
            description: describe(errors, warnings),
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

function describe(errors, warnings) {
  if (errors === 0 && warnings === 0) return 'Passed';
  const parts = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return parts.join(', ');
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
