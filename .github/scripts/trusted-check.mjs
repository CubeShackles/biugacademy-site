#!/usr/bin/env node
// Trusted artifact check.
//
// Usage: node <trusted>/.github/scripts/trusted-check.mjs --policy <trusted-root> --candidate <candidate-root>
//
// This script and the validator it calls are always loaded from the trusted
// policy checkout (the protected base commit). The candidate checkout is read
// as data only: nothing inside it is imported, executed or sourced.
//
// The check fails when:
//   1. any file under the candidate's .github/ differs from, is added to, or is
//      missing from the trusted policy's .github/ (policy changes must go
//      through a separately reviewed path, never through the PR being judged);
//   2. the candidate fails the trusted validator run with the trusted allowlist
//      (77-file public artifact boundary, no backend/private paths, no
//      credential patterns, no obsolete /biugacademy-site/ references,
//      all internal links resolve).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const real = (path) => (existsSync(path) ? realpathSync(path) : path);
const policyRoot = real(resolve(arg('--policy') ?? ''));
const candidateRoot = real(resolve(arg('--candidate') ?? ''));
const selfPath = real(fileURLToPath(import.meta.url));
const errors = [];

if (!arg('--policy') || !arg('--candidate')) {
  process.stderr.write('FAIL: usage: trusted-check.mjs --policy <trusted-root> --candidate <candidate-root>\n');
  process.exit(2);
}
if (!selfPath.startsWith(policyRoot + sep)) {
  errors.push(`trusted check must be loaded from the policy root (${policyRoot}), not ${selfPath}`);
}
if (candidateRoot === policyRoot || candidateRoot.startsWith(policyRoot + sep) || policyRoot.startsWith(candidateRoot + sep)) {
  errors.push('candidate and policy checkouts must be separate, non-nested directories');
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listTree(base, sub) {
  const start = join(base, sub);
  const out = new Map();
  if (!existsSync(start)) return out;
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const stat = lstatSync(absolute);
      const rel = relative(base, absolute).split(sep).join('/');
      if (stat.isSymbolicLink()) out.set(rel, 'symlink');
      else if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) out.set(rel, sha256File(absolute));
      else out.set(rel, 'special');
    }
  };
  walk(start);
  return out;
}

// 1. Policy files in the candidate must be byte-identical to the trusted policy.
const trustedPolicy = listTree(policyRoot, '.github');
const candidatePolicy = listTree(candidateRoot, '.github');
if (trustedPolicy.size === 0) errors.push('trusted policy checkout has no .github/ policy files');
for (const [path, digest] of trustedPolicy) {
  if (!candidatePolicy.has(path)) errors.push(`policy file removed by candidate: ${path}`);
  else if (candidatePolicy.get(path) !== digest) errors.push(`policy file modified by candidate: ${path}`);
}
for (const path of candidatePolicy.keys()) {
  if (!trustedPolicy.has(path)) errors.push(`policy file added by candidate: ${path}`);
}

// 2. Run the TRUSTED validator against the candidate data with the TRUSTED allowlist.
const validator = join(dirname(selfPath), 'validate-artifact.mjs');
const result = spawnSync(process.execPath, [validator, candidateRoot, '--policy-root', policyRoot], {
  encoding: 'utf8',
  timeout: 60000,
  env: { PATH: process.env.PATH ?? '', GITHUB_STEP_SUMMARY: process.env.GITHUB_STEP_SUMMARY ?? '' },
});
process.stdout.write(result.stdout ?? '');
if (result.error) errors.push(`trusted validator failed to run: ${result.error.message}`);
else if (result.status !== 0) {
  errors.push('candidate failed the trusted artifact validator:');
  for (const line of (result.stderr ?? '').split('\n').filter(Boolean)) errors.push(`  ${line}`);
}

const policyCommit = process.env.TRUSTED_POLICY_SHA ?? 'local';
if (errors.length) {
  process.stderr.write(`FAIL: trusted artifact check (policy ${policyCommit})\n`);
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`PASS: trusted artifact check (policy ${policyCommit}); .github/ unchanged (${trustedPolicy.size} files)\n`);
}
