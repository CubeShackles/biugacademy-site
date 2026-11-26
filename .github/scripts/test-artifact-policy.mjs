#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repositoryRoot = resolve(process.argv[2] ?? process.cwd());
const allowlist = readFileSync(join(repositoryRoot, '.github/artifact-allowlist.txt'), 'utf8')
  .split(/\r?\n/)
  .filter(Boolean);
const metadata = [
  '.github/CODEOWNERS',
  '.github/artifact-allowlist.txt',
  '.github/scripts/test-artifact-policy.mjs',
  '.github/scripts/trusted-check.mjs',
  '.github/scripts/validate-artifact.mjs',
  '.github/workflows/artifact-integrity-trusted.yml',
  '.github/workflows/artifact-integrity.yml',
];
const validator = join(repositoryRoot, '.github/scripts/validate-artifact.mjs');
const trustedCheck = join(repositoryRoot, '.github/scripts/trusted-check.mjs');
const cases = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'academy-artifact-policy-'));
  for (const path of [...allowlist, ...metadata]) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repositoryRoot, path), target);
  }
  return root;
}

function validate(root) {
  return spawnSync(process.execPath, [validator, root], { encoding: 'utf8', timeout: 20000 });
}

function runCase(name, prepare, expected) {
  const root = fixture();
  try {
    prepare(root);
    const result = validate(root);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.error, undefined, `${name}: validator process failed to run`);
    assert.equal(result.status === 0, expected === 'pass', `${name}: unexpected validator result\n${output}`);
    if (expected !== 'pass') assert.ok(output.includes(expected), `${name}: expected diagnostic missing\n${output}`);
    cases.push(name);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

runCase('accept root-relative custom-domain paths', () => {}, 'pass');
runCase('reject the obsolete GitHub project-page prefix', (root) => {
  const path = join(root, 'index.html');
  const html = readFileSync(path, 'utf8');
  assert.ok(html.includes('href="/"'), 'root navigation fixture is missing');
  writeFileSync(path, html.replace('href="/"', 'href="/biugacademy-site/"'));
}, 'obsolete GitHub project-page prefix');
runCase('reject unresolved internal routes', (root) => {
  const path = join(root, 'index.html');
  const html = readFileSync(path, 'utf8');
  writeFileSync(path, html.replace('href="/"', 'href="/missing-test-route/"'));
}, 'does not resolve');
runCase('reject credential-like content', (root) => {
  const path = join(root, 'index.html');
  const html = readFileSync(path, 'utf8');
  const key = ['pass', 'word'].join('');
  writeFileSync(path, html.replace('<head>', `<head><meta name="synthetic" content="${key}=\"not-a-real-value\"">`));
}, 'credential assignment pattern found');
runCase('reject backend implementation paths', (root) => {
  const path = join(root, 'backend/server.js');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, '// synthetic negative control\n');
}, 'backend/server.js');

function prefixCase(name, mutate) {
  runCase(name, (root) => {
    const path = join(root, 'index.html');
    const html = readFileSync(path, 'utf8');
    assert.ok(html.includes('</head>'), 'head fixture is missing');
    writeFileSync(path, mutate(html));
  }, 'obsolete GitHub project-page prefix');
}
prefixCase('reject percent-encoded obsolete prefix', (html) => html.replace('href="/"', 'href="/biugacademy%2Dsite/"'));
prefixCase('reject canonical-domain obsolete prefix', (html) => html.replace('href="/"', 'href="https://biugacademy.org/biugacademy-site/"'));
prefixCase('reject relative obsolete prefix', (html) => html.replace('href="/"', 'href="./biugacademy-site/css/styles.css"'));
prefixCase('reject obsolete prefix inside inline style or script text', (html) => html.replace('</head>', '<style>.x{background:url(/biugacademy-site/assets/x.png)}</style><script>var p="/biugacademy-site/js/script.js"</script></head>'));

// Trusted-check cases: the policy comes from an untouched copy (the "base"),
// the candidate is a separate copy that the pull request controls.
function trustedCase(name, prepare, expected) {
  const policy = fixture();
  const candidate = fixture();
  try {
    prepare(candidate);
    const result = spawnSync(process.execPath, [join(policy, '.github/scripts/trusted-check.mjs'), '--policy', policy, '--candidate', candidate], { encoding: 'utf8', timeout: 60000 });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.error, undefined, `${name}: trusted check failed to run`);
    assert.equal(result.status === 0, expected.length === 0, `${name}: unexpected trusted-check result\n${output}`);
    for (const diagnostic of expected) assert.ok(output.includes(diagnostic), `${name}: expected diagnostic missing: ${diagnostic}\n${output}`);
    cases.push(name);
  } finally {
    rmSync(policy, { recursive: true, force: true });
    rmSync(candidate, { recursive: true, force: true });
  }
}
trustedCase('trusted check accepts an unmodified candidate', () => {}, []);
trustedCase('trusted check fails when the candidate replaces the validator and adds backend/server.js', (root) => {
  writeFileSync(join(root, '.github/scripts/validate-artifact.mjs'), "process.stdout.write('PASS\\n'); process.exit(0);\n");
  mkdirSync(join(root, 'backend'), { recursive: true });
  writeFileSync(join(root, 'backend/server.js'), '// synthetic negative control\n');
}, ['policy file modified by candidate: .github/scripts/validate-artifact.mjs', 'backend/server.js']);
trustedCase('trusted check fails when the candidate widens the allowlist', (root) => {
  const allow = join(root, '.github/artifact-allowlist.txt');
  writeFileSync(allow, readFileSync(allow, 'utf8') + 'backend/server.js\n');
  mkdirSync(join(root, 'backend'), { recursive: true });
  writeFileSync(join(root, 'backend/server.js'), '// synthetic negative control\n');
}, ['policy file modified by candidate: .github/artifact-allowlist.txt', 'file is outside the artifact/validator allowlists: backend/server.js']);
trustedCase('trusted check fails when the candidate adds a workflow', (root) => {
  writeFileSync(join(root, '.github/workflows/spoof.yml'), 'name: spoof\n');
}, ['policy file added by candidate: .github/workflows/spoof.yml']);
trustedCase('trusted check fails on obsolete prefix in candidate content', (root) => {
  const path = join(root, 'index.html');
  writeFileSync(path, readFileSync(path, 'utf8').replace('href="/"', 'href="/biugacademy-site/"'));
}, ['obsolete GitHub project-page prefix']);
trustedCase('trusted check fails on a 78th public file', (root) => {
  writeFileSync(join(root, 'extra.html'), '<!doctype html><title>x</title>\n');
}, ['file is outside the artifact/validator allowlists: extra.html']);

const publicCopy = allowlist
  .filter((path) => /\.(?:html|css|js)$/i.test(path))
  .map((path) => readFileSync(join(repositoryRoot, path), 'utf8'))
  .join('\n');
const retiredLabels = [
  /AI-native/i,
  /intelig[eê]ncia artificial no backend/i,
  /<h3>IA e Dados<\/h3>/i,
  /<h2>Learning demo<\/h2>|Open learning demo/i,
  /Démonstration d’apprentissage|Abrir demonstração|Demonstração com dados sintéticos/i,
  /Demo with synthetic data|Démonstration avec des données fictives/i,
  /class:\s*["']demo-note["']|\.demo-note\s*\{/i,
];
for (const label of retiredLabels) {
  assert.doesNotMatch(publicCopy, label, `preproduction copy still contains retired label: ${label}`);
}
cases.push('remove visible AI/demo labels while retaining sandbox disclosures');

process.stdout.write(`PASS: ${cases.length}/${cases.length} artifact-policy regression cases\n`);
for (const name of cases) process.stdout.write(`- ${name}\n`);
