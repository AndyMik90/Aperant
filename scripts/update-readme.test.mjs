/**
 * Tests for update-readme.mjs
 * Run with: node --test scripts/update-readme.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chdir, cwd } from 'node:process';

import { validateVersion, updateSection, updateReadme } from './update-readme.mjs';

// ---------------------------------------------------------------------------
// validateVersion
// ---------------------------------------------------------------------------

test('validateVersion - accepts valid stable versions', () => {
  assert.equal(validateVersion('2.8.0'), true);
  assert.equal(validateVersion('1.0.0'), true);
  assert.equal(validateVersion('10.20.30'), true);
});

test('validateVersion - accepts valid prerelease versions', () => {
  assert.equal(validateVersion('2.8.0-beta.1'), true);
  assert.equal(validateVersion('2.8.0-alpha.10'), true);
  assert.equal(validateVersion('1.0.0-rc.3'), true);
});

test('validateVersion - rejects invalid versions', () => {
  assert.equal(validateVersion('2.8'), false);
  assert.equal(validateVersion('2.8.0.1'), false);
  assert.equal(validateVersion('v2.8.0'), false);
  assert.equal(validateVersion('2.8.0-beta'), false);   // missing .N
  assert.equal(validateVersion(''), false);
  assert.equal(validateVersion('abc'), false);
  assert.equal(validateVersion('2.8.0-win32'), false);  // no dot suffix
});

// ---------------------------------------------------------------------------
// updateSection
// ---------------------------------------------------------------------------

test('updateSection - replaces content between markers', () => {
  const content = [
    'before',
    '<!-- START -->',
    'tag/v2.7.0)',
    '<!-- END -->',
    'after',
  ].join('\n');

  const result = updateSection(
    content,
    '<!-- START -->',
    '<!-- END -->',
    [[String.raw`tag/v\d+\.\d+\.\d+\)`, 'tag/v2.8.0)']],
  );

  assert.ok(result.includes('tag/v2.8.0)'), 'should update the version inside the section');
  assert.ok(result.includes('before'), 'should keep content before markers');
  assert.ok(result.includes('after'), 'should keep content after markers');
});

test('updateSection - applies multiple replacements in order', () => {
  const content = [
    '<!-- S -->',
    'Auto-Claude-2.7.0-mac.dmg download/v2.7.0/file',
    '<!-- E -->',
  ].join('\n');

  const semver = String.raw`\d+\.\d+\.\d+(?:-[a-zA-Z]+\.[a-zA-Z0-9.]+)?`;
  const result = updateSection(content, '<!-- S -->', '<!-- E -->', [
    [`Auto-Claude-${semver}`, 'Auto-Claude-2.8.0'],
    [`download/v${semver}/`, 'download/v2.8.0/'],
  ]);

  assert.ok(result.includes('Auto-Claude-2.8.0'), 'should replace filename');
  assert.ok(result.includes('download/v2.8.0/'), 'should replace download path');
});

test('updateSection - handles multiline sections (dotAll)', () => {
  const content = '<!-- M -->\nline1\nline2\n<!-- M_END -->';
  const result = updateSection(content, '<!-- M -->', '<!-- M_END -->', [
    ['line1', 'replaced'],
  ]);
  assert.ok(result.includes('replaced'));
  assert.ok(result.includes('line2'));
});

test('updateSection - no markers leaves text unchanged', () => {
  const content = 'no markers here';
  const result = updateSection(content, '<!-- A -->', '<!-- B -->', [['x', 'y']]);
  assert.equal(result, content);
});

// ---------------------------------------------------------------------------
// updateReadme - stable release
// ---------------------------------------------------------------------------

/**
 * Build a minimal README with all section markers used by the script.
 *
 * Note: The download URL path (download/v${version}/) is what gets tested for
 * version replacement.  The filename after the version uses "-win" (no dot)
 * so the semver regex — which requires a dot inside any prerelease-like suffix
 * — does NOT greedily consume the platform suffix as part of the version.
 */
function buildSampleReadme(stableVersion, betaVersion) {
  const sv = stableVersion;
  const bv = betaVersion;
  // Shields.io badge format uses -- for hyphens
  const svBadge = sv.replaceAll('-', '--');
  const bvBadge = bv.replaceAll('-', '--');

  return [
    `<!-- TOP_VERSION_BADGE -->`,
    `[![version](https://img.shields.io/badge/version-${svBadge}-blue)](https://github.com/example/releases/tag/v${sv})`,
    `<!-- TOP_VERSION_BADGE_END -->`,
    ``,
    `[![stable](https://img.shields.io/badge/stable-${svBadge}-blue)](https://example.com)`,
    ``,
    `<!-- STABLE_VERSION_BADGE -->`,
    `[v${sv}](https://github.com/example/releases/tag/v${sv})`,
    `<!-- STABLE_VERSION_BADGE_END -->`,
    ``,
    `<!-- STABLE_DOWNLOADS -->`,
    `https://example.com/download/v${sv}/Auto-Claude-${sv}-win`,
    `<!-- STABLE_DOWNLOADS_END -->`,
    ``,
    `[![beta](https://img.shields.io/badge/beta-${bvBadge}-orange)](https://example.com)`,
    ``,
    `<!-- BETA_VERSION_BADGE -->`,
    `[v${bv}](https://github.com/example/releases/tag/v${bv})`,
    `<!-- BETA_VERSION_BADGE_END -->`,
    ``,
    `<!-- BETA_DOWNLOADS -->`,
    `https://example.com/download/v${bv}/Auto-Claude-${bv}-win`,
    `<!-- BETA_DOWNLOADS_END -->`,
  ].join('\n');
}

/** Run updateReadme in a temp directory with a fixture README.md. */
function withTempReadme(readmeContent, fn) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'update-readme-test-'));
  const original = cwd();
  try {
    writeFileSync(join(tmpDir, 'README.md'), readmeContent, 'utf8');
    chdir(tmpDir);
    fn(tmpDir);
  } finally {
    chdir(original);
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('updateReadme - stable release updates TOP_VERSION_BADGE, STABLE_VERSION_BADGE, STABLE_DOWNLOADS', () => {
  const readme = buildSampleReadme('2.7.0', '2.8.0-beta.1');

  withTempReadme(readme, (dir) => {
    const changed = updateReadme('2.8.0', false);
    assert.equal(changed, true, 'should report changes made');

    const result = readFileSync(join(dir, 'README.md'), 'utf8');

    // TOP_VERSION_BADGE section updated
    assert.ok(result.includes('version-2.8.0-blue'), 'top badge version updated');
    assert.ok(result.includes('tag/v2.8.0)'), 'top badge link updated');

    // Stable badge outside section updated
    assert.ok(result.includes('stable-2.8.0-blue'), 'standalone stable badge updated');

    // STABLE_VERSION_BADGE section updated
    assert.ok(result.includes('tag/v2.8.0)'), 'stable version link updated');

    // STABLE_DOWNLOADS section updated
    assert.ok(result.includes('download/v2.8.0/'), 'stable download path updated');
    assert.ok(result.includes('Auto-Claude-2.8.0'), 'stable download filename updated');

    // Beta section NOT modified
    assert.ok(result.includes('beta-2.8.0--beta.1-orange'), 'beta badge unchanged');
    assert.ok(result.includes('download/v2.8.0-beta.1/'), 'beta download unchanged');
  });
});

test('updateReadme - stable release returns false when no changes needed', () => {
  const readme = buildSampleReadme('2.8.0', '2.8.0-beta.1');

  withTempReadme(readme, () => {
    const changed = updateReadme('2.8.0', false);
    assert.equal(changed, false, 'should report no changes when already up to date');
  });
});

// ---------------------------------------------------------------------------
// updateReadme - prerelease
// ---------------------------------------------------------------------------

test('updateReadme - prerelease updates BETA_VERSION_BADGE and BETA_DOWNLOADS', () => {
  const readme = buildSampleReadme('2.7.0', '2.7.0-beta.5');

  withTempReadme(readme, (dir) => {
    const changed = updateReadme('2.8.0-beta.1', true);
    assert.equal(changed, true, 'should report changes made');

    const result = readFileSync(join(dir, 'README.md'), 'utf8');

    // Beta badge updated (-- escaped)
    assert.ok(result.includes('beta-2.8.0--beta.1-orange'), 'beta badge updated');

    // BETA_VERSION_BADGE section updated
    assert.ok(result.includes('tag/v2.8.0-beta.1)'), 'beta version link updated');

    // BETA_DOWNLOADS section updated
    assert.ok(result.includes('download/v2.8.0-beta.1/'), 'beta download path updated');
    assert.ok(result.includes('Auto-Claude-2.8.0-beta.1'), 'beta download filename updated');

    // Stable section NOT modified
    assert.ok(result.includes('stable-2.7.0-blue'), 'stable badge unchanged');
    assert.ok(result.includes('download/v2.7.0/'), 'stable download unchanged');
  });
});

test('updateReadme - prerelease returns false when no changes needed', () => {
  const readme = buildSampleReadme('2.7.0', '2.8.0-beta.1');

  withTempReadme(readme, () => {
    const changed = updateReadme('2.8.0-beta.1', true);
    assert.equal(changed, false, 'should report no changes when already up to date');
  });
});
