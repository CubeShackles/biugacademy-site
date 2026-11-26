#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';

// Usage: validate-artifact.mjs <candidate-root> [--policy-root <trusted-root>]
// The candidate root is treated strictly as data. When --policy-root is given,
// the allowlist is read from the trusted policy checkout instead of the candidate.
const args = process.argv.slice(2);
const policyFlag = args.indexOf('--policy-root');
const policyRoot = policyFlag >= 0 ? resolve(args[policyFlag + 1] ?? '') : null;
const positional = args.filter((_, index) => policyFlag < 0 || (index !== policyFlag && index !== policyFlag + 1));
const root = resolve(positional[0] ?? process.cwd());
const allowlistFile = join(policyRoot ?? root, '.github/artifact-allowlist.txt');
const expectedMetadata = new Set([
  '.github/CODEOWNERS',
  '.github/artifact-allowlist.txt',
  '.github/scripts/test-artifact-policy.mjs',
  '.github/scripts/trusted-check.mjs',
  '.github/scripts/validate-artifact.mjs',
  '.github/workflows/artifact-integrity-trusted.yml',
  '.github/workflows/artifact-integrity.yml',
]);
const approvedExtensions = new Set(['.html', '.css', '.js', '.png', '.txt', '.xml']);
const errors = [];
const warnings = [];

function fail(message) {
  errors.push(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function walk(directory, paths = []) {
  for (const name of readdirSync(directory).sort()) {
    if (directory === root && name === '.git') continue;
    const absolute = join(directory, name);
    const stat = lstatSync(absolute);
    const path = relative(root, absolute).split(sep).join('/');
    if (stat.isSymbolicLink()) {
      fail(`symbolic links are forbidden: ${path}`);
    } else if (stat.isDirectory()) {
      walk(absolute, paths);
    } else if (stat.isFile()) {
      paths.push(path);
    } else {
      fail(`non-regular filesystem entry is forbidden: ${path}`);
    }
  }
  return paths;
}

function readAllowlist() {
  const rows = readFileSync(allowlistFile, 'utf8').split(/\r?\n/).filter(Boolean);
  if (rows.length !== 77) fail(`allowlist must contain exactly 77 paths; found ${rows.length}`);
  if (new Set(rows).size !== rows.length) fail('allowlist contains duplicate paths');
  const sorted = [...rows].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (rows.some((path, index) => path !== sorted[index])) fail('allowlist is not sorted by UTF-8 path bytes');
  for (const path of rows) {
    if (path.startsWith('/') || path.split('/').includes('..') || path.includes('\\')) {
      fail(`unsafe allowlist path: ${path}`);
    }
    if (path.startsWith('.github/') || path.startsWith('backend/') || path.startsWith('docs/')) {
      fail(`non-public path in site allowlist: ${path}`);
    }
    if (path !== 'CNAME' && !approvedExtensions.has(extname(path).toLowerCase())) {
      fail(`unapproved file type in allowlist: ${path}`);
    }
  }
  return rows;
}

function checkInventory(sitePaths) {
  const expected = new Set([...sitePaths, ...expectedMetadata]);
  const found = new Set(walk(root));
  for (const path of expected) if (!found.has(path)) fail(`required file is missing: ${path}`);
  for (const path of found) if (!expected.has(path)) fail(`file is outside the artifact/validator allowlists: ${path}`);
  if (sitePaths.some((path) => path.startsWith('backend/') || path.startsWith('docs/'))) {
    fail('backend implementation or private documentation appears in the artifact allowlist');
  }
}

function checkContent(sitePaths, allPaths) {
  const credentialPatterns = [
    { label: 'private key material', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i },
    { label: 'GitHub access token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
    { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    { label: 'credential assignment', pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|database[_-]?url)\s*[:=]\s*["'][^"']{8,}["']/i },
  ];
  const forbiddenPathPattern = /(^|\/)(?:backend|docs|\.env(?:\.|$)|secrets?)(\/|$)/i;
  for (const path of allPaths) {
    if (forbiddenPathPattern.test(path)) fail(`forbidden sensitive path: ${path}`);
    const ext = extname(path).toLowerCase();
    if (sitePaths.includes(path) && path !== 'CNAME' && !approvedExtensions.has(ext)) fail(`unapproved file type: ${path}`);
    if (ext === '.png') continue;
    const content = readFileSync(join(root, path), 'utf8');
    for (const { label, pattern } of credentialPatterns) {
      if (pattern.test(content)) fail(`${label} pattern found in ${path}`);
    }
    if (sitePaths.includes(path)) {
      let decoded = content;
      try { decoded = decodeURIComponent(content.replace(/%(?![0-9a-f]{2})/gi, '%25')); } catch { /* keep raw */ }
      if (/\/biugacademy-site(?=[\/"'\s?#)\\]|$)/im.test(content) || /\/biugacademy-site(?=[\/"'\s?#)\\]|$)/im.test(decoded)) {
        fail(`obsolete GitHub project-page prefix text found in ${path}`);
      }
    }
    if (sitePaths.includes(path) && /\b(?:backend\/server\.js|node_modules\/|DATABASE_URL)\b/i.test(content)) {
      fail(`backend implementation/configuration marker found in ${path}`);
    }
  }
}

function normalizedPathname(raw, sourcePath) {
  const obsoleteProjectPrefix = '/biugacademy-site';
  if (raw.startsWith('//')) return null;
  if (!raw.startsWith('/')) {
    raw = new URL(raw, `https://artifact.invalid/${dirname(sourcePath).replaceAll('\\', '/')}/`).pathname;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
  } catch {
    fail(`invalid percent-encoding in link in ${sourcePath}: ${raw}`);
    return null;
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  const normalized = normalize(pathname).replaceAll('\\', '/');
  if (normalized === obsoleteProjectPrefix || normalized.startsWith(`${obsoleteProjectPrefix}/`)) {
    fail(`obsolete GitHub project-page prefix in ${sourcePath}: ${raw}`);
    return null;
  }
  return normalized;
}

function resolveSiteFile(pathname, siteSet) {
  const clean = pathname.replace(/^\/+/, '');
  const candidates = clean === ''
    ? ['index.html']
    : clean.endsWith('/')
      ? [`${clean}index.html`]
    : [clean, `${clean}/index.html`, `${clean}.html`];
  return candidates.some((candidate) => siteSet.has(candidate));
}

function checkReference(raw, sourcePath, siteSet) {
  const value = raw.trim().replaceAll('&amp;', '&');
  if (!value || value.startsWith('#') || /^(?:data|mailto|tel|javascript|blob):/i.test(value)) return;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    const url = new URL(value);
    if (['biugacademy.org', 'www.biugacademy.org'].includes(url.hostname)) {
      let pathname;
      try {
        pathname = normalize(decodeURIComponent(url.pathname)).replaceAll('\\', '/');
      } catch {
        fail(`invalid percent-encoding in canonical Academy route from ${sourcePath}: ${value}`);
        return;
      }
      if (pathname === '/biugacademy-site' || pathname.startsWith('/biugacademy-site/')) {
        fail(`obsolete GitHub project-page prefix in ${sourcePath}: ${value}`);
      } else if (!resolveSiteFile(pathname, siteSet)) {
        fail(`canonical Academy route does not exist in the artifact from ${sourcePath}: ${value}`);
      }
    }
    return;
  }
  if (value.startsWith('//')) return;
  const pathname = normalizedPathname(value, sourcePath);
  if (pathname === null) return;
  if (!resolveSiteFile(pathname, siteSet)) fail(`internal link/asset does not resolve from ${sourcePath}: ${raw}`);
}

function checkLinks(sitePaths) {
  const siteSet = new Set(sitePaths);
  for (const path of sitePaths) {
    const ext = extname(path).toLowerCase();
    if (ext === '.html') {
      const html = readFileSync(join(root, path), 'utf8');
      const attributes = /\b(?:href|src|poster)\s*=\s*(["'])(.*?)\1/gi;
      for (const match of html.matchAll(attributes)) checkReference(match[2], path, siteSet);
      const srcsets = /\bsrcset\s*=\s*(["'])(.*?)\1/gi;
      for (const match of html.matchAll(srcsets)) {
        for (const candidate of match[2].split(',')) checkReference(candidate.trim().split(/\s+/, 1)[0], path, siteSet);
      }
    } else if (ext === '.css') {
      const css = readFileSync(join(root, path), 'utf8');
      const urls = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
      for (const match of css.matchAll(urls)) checkReference(match[2], path, siteSet);
      const imports = /@import\s+(["'])(.*?)\1/gi;
      for (const match of css.matchAll(imports)) checkReference(match[2], path, siteSet);
    } else if (ext === '.xml' || ext === '.txt') {
      const content = readFileSync(join(root, path), 'utf8');
      for (const match of content.matchAll(/https?:\/\/[^\s<>"']+/gi)) checkReference(match[0], path, siteSet);
    }
  }
}

function manifestFor(sitePaths) {
  const sorted = [...sitePaths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const rows = sorted.map((path) => `${sha256(readFileSync(join(root, path)))}  ${path}\n`);
  return Buffer.from(rows.join(''), 'utf8');
}

function checkManifest(sitePaths) {
  const first = manifestFor(sitePaths);
  const second = manifestFor(sitePaths);
  if (!first.equals(second)) fail('two canonical SHA-256 manifest generations differ');
  const digest = sha256(first);
  const report = `Artifact integrity validation\n\n- Site files: ${sitePaths.length}\n- Canonical manifest SHA-256: \`${digest}\`\n- Manifest generation: reproducible\n- Metadata files excluded from the public site inventory: ${expectedMetadata.size}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  return { count: sitePaths.length, digest };
}

let manifest = null;
try {
  const sitePaths = readAllowlist();
  const allPaths = walk(root);
  checkInventory(sitePaths);
  checkContent(sitePaths, allPaths);
  checkLinks(sitePaths);
  manifest = checkManifest(sitePaths);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (errors.length) {
  process.stderr.write(`FAIL: ${errors.length} artifact policy violation(s)\n`);
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  for (const warning of warnings) process.stdout.write(`WARN: ${warning}\n`);
  process.stdout.write(`PASS: ${manifest.count} allowlisted files; reproducible manifest ${manifest.digest}\n`);
}
