#!/usr/bin/env node

/**
 * Version Bump Script
 *
 * Bumps the version in package.json files. When this commit is merged to main,
 * GitHub Actions will automatically create the tag and trigger the release.
 *
 * Usage:
 *   node scripts/bump-version.js <major|minor|patch|x.y.z>
 *
 * Examples:
 *   node scripts/bump-version.js patch   # 2.5.5 -> 2.5.6
 *   node scripts/bump-version.js minor   # 2.5.5 -> 2.6.0
 *   node scripts/bump-version.js major   # 2.5.5 -> 3.0.0
 *   node scripts/bump-version.js 2.6.0   # Set to specific version
 *
 * Release Flow:
 *   1. Run this script on develop branch
 *   2. Push to develop
 *   3. Create PR: develop → main
 *   4. Merge PR
 *   5. GitHub Actions automatically:
 *      - Creates git tag
 *      - Builds binaries
 *      - Creates GitHub release
 *      - Updates README
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function error(message) {
  log(`❌ Error: ${message}`, colors.red);
  process.exit(1);
}

function success(message) {
  log(`✅ ${message}`, colors.green);
}

function info(message) {
  log(`ℹ️  ${message}`, colors.cyan);
}

function warning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

// Parse semver version (supports optional pre-release suffix like -beta.1)
function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-[a-zA-Z0-9.]+)?$/);
  if (!match) {
    error(`Invalid version format: ${version}. Expected format: x.y.z or x.y.z-prerelease`);
  }
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    prerelease: match[4] || null,
  };
}

// Bump version based on type
function bumpVersion(currentVersion, bumpType) {
  const version = parseVersion(currentVersion);

  switch (bumpType) {
    case 'major':
      return `${version.major + 1}.0.0`;
    case 'minor':
      return `${version.major}.${version.minor + 1}.0`;
    case 'patch':
      return `${version.major}.${version.minor}.${version.patch + 1}`;
    default:
      // Assume it's a specific version (including pre-release like 2.7.6-beta.1)
      parseVersion(bumpType); // Validate format
      return bumpType;
  }
}

// Execute shell command
function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe', ...options }).trim();
  } catch (err) {
    error(`Command failed: ${command}\n${err.message}`);
  }
}

// Check if git working directory is clean
function checkGitStatus() {
  const status = exec('git status --porcelain');
  if (status) {
    error('Git working directory is not clean. Please commit or stash changes first.');
  }
}

// Update package.json version
function updatePackageJson(newVersion) {
  const frontendPath = path.join(__dirname, '..', 'apps', 'frontend', 'package.json');
  const rootPath = path.join(__dirname, '..', 'package.json');

  if (!fs.existsSync(frontendPath)) {
    error(`package.json not found at ${frontendPath}`);
  }

  // Update frontend package.json
  const frontendJson = JSON.parse(fs.readFileSync(frontendPath, 'utf8'));
  const oldVersion = frontendJson.version;
  frontendJson.version = newVersion;
  fs.writeFileSync(frontendPath, JSON.stringify(frontendJson, null, 2) + '\n');

  // Update root package.json if it exists
  if (fs.existsSync(rootPath)) {
    const rootJson = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
    rootJson.version = newVersion;
    fs.writeFileSync(rootPath, JSON.stringify(rootJson, null, 2) + '\n');
  }

  return { oldVersion, packagePath: frontendPath };
}

// Update apps/backend/__init__.py version
function updateBackendInit(newVersion) {
  const initPath = path.join(__dirname, '..', 'apps', 'backend', '__init__.py');

  if (!fs.existsSync(initPath)) {
    warning(`Backend __init__.py not found at ${initPath}, skipping`);
    return false;
  }

  let content = fs.readFileSync(initPath, 'utf8');
  content = content.replace(/__version__\s*=\s*"[^"]*"/, `__version__ = "${newVersion}"`);
  fs.writeFileSync(initPath, content);
  return true;
}

// Check if CHANGELOG.md has an entry for the version
function checkChangelogEntry(version) {
  const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');

  if (!fs.existsSync(changelogPath)) {
    warning('CHANGELOG.md not found - you will need to create it before releasing');
    return false;
  }

  const content = fs.readFileSync(changelogPath, 'utf8');

  // Look for "## X.Y.Z" or "## X.Y.Z -" header using string matching
  // This avoids regex injection concerns from user-provided version strings
  const lines = content.split('\n');
  const versionHeaderPrefix = `## ${version}`;

  for (const line of lines) {
    // Check if line starts with "## X.Y.Z" followed by whitespace, dash, or end of line
    if (line.startsWith(versionHeaderPrefix)) {
      const afterVersion = line.slice(versionHeaderPrefix.length);
      // Valid if nothing follows, or whitespace/dash follows
      if (afterVersion === '' || afterVersion[0] === ' ' || afterVersion[0] === '-' || afterVersion[0] === '\t') {
        return true;
      }
    }
  }

  return false;
}

// Main function
function main() {
  const bumpType = process.argv[2];

  if (!bumpType) {
    error('Please specify version bump type or version number.\n' +
          'Usage: node scripts/bump-version.js <major|minor|patch|x.y.z>');
  }

  log('\n🚀 Auto Claude Version Bump\n', colors.cyan);

  // 1. Check git status
  info('Checking git status...');
  checkGitStatus();
  success('Git working directory is clean');

  // 2. Read current version
  const packagePath = path.join(__dirname, '..', 'apps', 'frontend', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const currentVersion = packageJson.version;
  info(`Current version: ${currentVersion}`);

  // 3. Calculate new version
  const newVersion = bumpVersion(currentVersion, bumpType);
  info(`New version: ${newVersion}`);

  if (currentVersion === newVersion) {
    error('New version is the same as current version');
  }

  // 4. Validate release (check for branch/tag conflicts)
  info('Validating release...');
  exec(`node ${path.join(__dirname, 'validate-release.js')} v${newVersion}`);
  success('Release validation passed');

  // 5. Update all version files
  info('Updating package.json files...');
  updatePackageJson(newVersion);
  success('Updated package.json files');

  info('Updating apps/backend/__init__.py...');
  if (updateBackendInit(newVersion)) {
    success('Updated apps/backend/__init__.py');
  }

  // Note: README.md is NOT updated here - it gets updated by the release workflow
  // after the GitHub release is successfully published. This prevents version
  // mismatches where README shows a version that doesn't exist yet.

  // 6. Check if CHANGELOG.md has entry for this version
  info('Checking CHANGELOG.md...');
  const hasChangelogEntry = checkChangelogEntry(newVersion);

  if (hasChangelogEntry) {
    success(`CHANGELOG.md already has entry for ${newVersion}`);
  } else {
    log('');
    warning('═══════════════════════════════════════════════════════════════════════');
    warning('  CHANGELOG.md does not have an entry for version ' + newVersion);
    warning('═══════════════════════════════════════════════════════════════════════');
    warning('');
    warning('  The release workflow will FAIL if CHANGELOG.md is not updated!');
    warning('');
    warning('  Please add an entry to CHANGELOG.md before creating your PR:');
    warning('');
    log(`    ## ${newVersion} - Your Release Title`, colors.cyan);
    log('', colors.cyan);
    log('    ### ✨ New Features', colors.cyan);
    log('    - Feature description', colors.cyan);
    log('', colors.cyan);
    log('    ### 🐛 Bug Fixes', colors.cyan);
    log('    - Fix description', colors.cyan);
    warning('');
    warning('═══════════════════════════════════════════════════════════════════════');
    log('');
  }

  // 7. Create git commit
  info('Creating git commit...');
  exec('git add apps/frontend/package.json package.json apps/backend/__init__.py');
  exec(`git commit -m "chore: bump version to ${newVersion}"`);
  success(`Created commit: "chore: bump version to ${newVersion}"`);

  // Note: Tags are NOT created here anymore. GitHub Actions will create the tag
  // when this commit is merged to main, ensuring releases only happen after
  // successful builds.

  // 8. Instructions
  log('\n📋 Next steps:', colors.yellow);
  if (!hasChangelogEntry) {
    log(`   1. UPDATE CHANGELOG.md with release notes for ${newVersion}`, colors.red);
    log(`   2. Commit the changelog: git add CHANGELOG.md && git commit --amend --no-edit`, colors.yellow);
    log(`   3. Push to your branch: git push origin <branch-name>`, colors.yellow);
  } else {
    log(`   1. Review the changes: git log -1`, colors.yellow);
    log(`   2. Push to your branch: git push origin <branch-name>`, colors.yellow);
  }
  log(`   ${hasChangelogEntry ? '3' : '4'}. Create PR to main (or merge develop → main)`, colors.yellow);
  log(`   ${hasChangelogEntry ? '4' : '5'}. When merged, GitHub Actions will automatically:`, colors.yellow);
  log(`      - Validate CHANGELOG.md has entry for v${newVersion}`, colors.yellow);
  log(`      - Create tag v${newVersion}`, colors.yellow);
  log(`      - Build binaries for all platforms`, colors.yellow);
  log(`      - Create GitHub release with changelog from CHANGELOG.md`, colors.yellow);
  log(`      - Update README with new version\n`, colors.yellow);

  warning('Note: The commit has been created locally but NOT pushed.');
  if (!hasChangelogEntry) {
    warning('IMPORTANT: Update CHANGELOG.md before pushing or the release will fail!');
  }
  info('Tags are created automatically by GitHub Actions when merged to main.');

  log('\n✨ Version bump complete!\n', colors.green);
}

// Run
main();
