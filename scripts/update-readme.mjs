#!/usr/bin/env node
/**
 * Update README.md version badges and download links.
 *
 * Usage:
 *     node scripts/update-readme.mjs <version> [--prerelease]
 *
 * Examples:
 *     node scripts/update-readme.mjs 2.8.0              # Stable release
 *     node scripts/update-readme.mjs 2.8.0-beta.1 --prerelease  # Beta release
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { argv, stderr, exit } from 'node:process';

// Semver pattern: X.Y.Z or X.Y.Z-prerelease.N
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z]+\.\d+)?$/;

/**
 * Validate version string matches semver format.
 * @param {string} version
 * @returns {boolean}
 */
export function validateVersion(version) {
  return SEMVER_PATTERN.test(version);
}

/**
 * Escape a string for use in a RegExp.
 * @param {string} str
 * @returns {string}
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Update content between markers with given replacements.
 * @param {string} text
 * @param {string} startMarker
 * @param {string} endMarker
 * @param {Array<[string, string]>} replacements - [regexPattern, replacement] pairs
 * @returns {string}
 */
export function updateSection(text, startMarker, endMarker, replacements) {
  const pattern = new RegExp(
    `(${escapeRegExp(startMarker)})(.*?)(${escapeRegExp(endMarker)})`,
    's', // dotAll flag — equivalent to re.DOTALL
  );

  return text.replace(pattern, (_match, g1, section, g3) => {
    let updated = section;
    for (const [oldPattern, newValue] of replacements) {
      updated = updated.replace(new RegExp(oldPattern, 'g'), newValue);
    }
    return g1 + updated + g3;
  });
}

/**
 * Update README.md with new version.
 * @param {string} version - Version string (e.g., "2.8.0" or "2.8.0-beta.1")
 * @param {boolean} isPrerelease - Whether this is a prerelease version
 * @returns {boolean} True if changes were made, false otherwise
 */
export function updateReadme(version, isPrerelease) {
  // Shields.io escapes hyphens as --
  const versionBadge = version.replaceAll('-', '--');

  // Read README
  const originalContent = readFileSync('README.md', 'utf8');
  let content = originalContent;

  // Semver pattern: matches X.Y.Z or X.Y.Z-prerelease (e.g., 2.7.2, 2.7.2-beta.10)
  // Prerelease MUST contain a dot (beta.10, alpha.1, rc.1) to avoid matching platform suffixes (win32, darwin)
  const semver = String.raw`\d+\.\d+\.\d+(?:-[a-zA-Z]+\.[a-zA-Z0-9.]+)?`;
  // Shields.io escaped pattern (hyphens as --)
  const semverBadge = String.raw`\d+\.\d+\.\d+(?:--[a-zA-Z]+\.[a-zA-Z0-9.]+)?`;

  if (isPrerelease) {
    console.log(`Updating BETA section to ${version} (badge: ${versionBadge})`);

    // Update beta badge
    content = content.replace(
      new RegExp(`beta-${semverBadge}-orange`, 'g'),
      `beta-${versionBadge}-orange`,
    );

    // Update beta version badge link
    content = updateSection(
      content,
      '<!-- BETA_VERSION_BADGE -->',
      '<!-- BETA_VERSION_BADGE_END -->',
      [[`tag/v${semver}\\)`, `tag/v${version})`]],
    );

    // Update beta downloads
    content = updateSection(
      content,
      '<!-- BETA_DOWNLOADS -->',
      '<!-- BETA_DOWNLOADS_END -->',
      [
        [`Auto-Claude-${semver}`, `Auto-Claude-${version}`],
        [`download/v${semver}/`, `download/v${version}/`],
      ],
    );
  } else {
    console.log(`Updating STABLE section to ${version} (badge: ${versionBadge})`);

    // Update top version badge
    content = updateSection(
      content,
      '<!-- TOP_VERSION_BADGE -->',
      '<!-- TOP_VERSION_BADGE_END -->',
      [
        [`version-${semverBadge}-blue`, `version-${versionBadge}-blue`],
        [`tag/v${semver}\\)`, `tag/v${version})`],
      ],
    );

    // Update stable badge
    content = content.replace(
      new RegExp(`stable-${semverBadge}-blue`, 'g'),
      `stable-${versionBadge}-blue`,
    );

    // Update stable version badge link
    content = updateSection(
      content,
      '<!-- STABLE_VERSION_BADGE -->',
      '<!-- STABLE_VERSION_BADGE_END -->',
      [[`tag/v${semver}\\)`, `tag/v${version})`]],
    );

    // Update stable downloads
    content = updateSection(
      content,
      '<!-- STABLE_DOWNLOADS -->',
      '<!-- STABLE_DOWNLOADS_END -->',
      [
        [`Auto-Claude-${semver}`, `Auto-Claude-${version}`],
        [`download/v${semver}/`, `download/v${version}/`],
      ],
    );
  }

  // Check if changes were made
  if (content === originalContent) {
    console.log('No changes needed');
    return false;
  }

  // Write updated README
  writeFileSync('README.md', content, 'utf8');

  console.log(`README.md updated for ${version} (prerelease=${isPrerelease})`);
  return true;
}

function main() {
  const args = argv.slice(2);

  // Parse args: <version> [--prerelease]
  const versionArg = args.find((a) => !a.startsWith('--'));
  const isPrereleaseFlag = args.includes('--prerelease');

  if (!versionArg) {
    stderr.write('usage: node scripts/update-readme.mjs <version> [--prerelease]\n');
    exit(1);
  }

  // Validate version format
  if (!validateVersion(versionArg)) {
    stderr.write(`ERROR: Invalid version format: ${versionArg}\n`);
    stderr.write('Expected format: X.Y.Z or X.Y.Z-prerelease.N (e.g., 2.8.0 or 2.8.0-beta.1)\n');
    exit(1);
  }

  // Auto-detect prerelease if not explicitly set
  const isPrerelease = isPrereleaseFlag || versionArg.includes('-');

  try {
    updateReadme(versionArg, isPrerelease);
    exit(0);
  } catch (err) {
    if (err.code === 'ENOENT') {
      stderr.write('ERROR: README.md not found\n');
    } else {
      stderr.write(`ERROR: ${err.message}\n`);
    }
    exit(1);
  }
}

// Only run when invoked directly (not when imported by tests)
const isMain =
  argv[1] &&
  (await import('node:url')).fileURLToPath(import.meta.url) === argv[1];

if (isMain) {
  main();
}
