#!/usr/bin/env node
/**
 * Packaging script that downloads bundled Python, stages runtime modules,
 * and builds the Electron app for the requested platforms and architectures.
 *
 * Usage: node scripts/package-with-python.cjs [--mac|--win|--linux] [--x64|--arm64|--universal]
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isWindows, getCurrentPlatform, toNodePlatform } = require('../src/shared/platform.cjs');
const { downloadPython } = require('./download-python.cjs');

/**
 * Shell metacharacters that could enable command injection when shell: true is used on Windows.
 * These characters have special meaning in cmd.exe and could be used to inject arbitrary commands.
 *
 * Includes:
 * - Standard operators: & | > < ^ %
 * - Command separators: ;
 * - Variable expansion: $ %
 * - Command grouping: ( ) [ ] { }
 * - Delayed expansion: !
 * - Command substitution: `
 * - Quotes: "
 * - Line breaks: \n \r
 *
 * Note: Single quote (') is not included as cmd.exe does not treat it as a shell metacharacter.
 */
const SHELL_METACHARACTERS = Object.freeze(['&', '|', '>', '<', '^', '%', ';', '$', '(', ')', '[', ']', '{', '}', '!', '`', '"', '\n', '\r']);

/**
 * Validate that arguments don't contain shell metacharacters on Windows.
 * When shell: true is used, cmd.exe interprets metacharacters which could lead to command injection.
 *
 * @param {string[]} commandArgs - Arguments to validate
 * @throws {Error} If any argument contains dangerous shell metacharacters on Windows
 * @throws {TypeError} If any argument is not a string
 */
function validateArgs(commandArgs) {
  if (!isWindows()) return; // Only validate on Windows where shell: true is used

  for (const arg of commandArgs) {
    // Defensive check: skip non-string arguments to prevent TypeError
    if (typeof arg !== 'string') {
      throw new TypeError(
        `Security: Argument must be a string, got ${typeof arg}. ` +
        `This may indicate incorrect argument passing.`
      );
    }

    for (const char of SHELL_METACHARACTERS) {
      if (arg.includes(char)) {
        throw new Error(
          `Security: Argument contains shell metacharacter '${char}' which could enable command injection. ` +
          `Argument: "${arg}"`
        );
      }
    }
  }
}

const args = process.argv.slice(2);

const PLATFORM_FLAGS = new Map([
  ['--mac', 'mac'],
  ['--win', 'win'],
  ['--windows', 'win'],
  ['--linux', 'linux'],
]);

const ARCH_FLAGS = new Map([
  ['--x64', 'x64'],
  ['--arm64', 'arm64'],
  ['--universal', 'universal'],
]);

function mapHostPlatform(platform) {
  const map = { darwin: 'mac', win32: 'win', linux: 'linux' };
  return map[platform] || platform;
}

function resolvePlatforms() {
  const platforms = new Set();
  for (const arg of args) {
    const mapped = PLATFORM_FLAGS.get(arg);
    if (mapped) platforms.add(mapped);
  }

  if (platforms.size === 0) {
    platforms.add(mapHostPlatform(getCurrentPlatform()));
  }

  return [...platforms];
}

function resolveArchs() {
  const archs = new Set();
  let wantsUniversal = false;

  for (const arg of args) {
    const mapped = ARCH_FLAGS.get(arg);
    if (!mapped) continue;
    if (mapped === 'universal') {
      wantsUniversal = true;
    } else {
      archs.add(mapped);
    }
  }

  if (wantsUniversal) {
    archs.add('x64');
    archs.add('arm64');
  }

  if (archs.size === 0) {
    archs.add(os.arch());
  }

  for (const arch of archs) {
    if (!['x64', 'arm64'].includes(arch)) {
      throw new Error(
        `Host architecture '${arch}' is not supported for bundled Python. Please specify --x64 or --arm64 explicitly.`
      );
    }
  }

  return [...archs];
}

function buildEnv(frontendDir) {
  const binDir = path.join(frontendDir, 'node_modules', '.bin');
  const rootBinDir = path.join(frontendDir, '..', '..', 'node_modules', '.bin');
  const pathParts = [binDir, rootBinDir];
  const pathValue = process.env.PATH
    ? `${pathParts.join(path.delimiter)}${path.delimiter}${process.env.PATH}`
    : pathParts.join(path.delimiter);
  return { ...process.env, PATH: pathValue };
}

function runCommand(command, commandArgs, cwd, env) {
  // Validate arguments to prevent command injection via shell metacharacters.
  // Note: validateArgs only validates on Windows because shell: true is only used on Windows.
  // On non-Windows platforms, .cmd files are not used and shell: false, so no injection risk.
  validateArgs(commandArgs);

  const bin = isWindows() ? `${command}.cmd` : command;
  const result = spawnSync(bin, commandArgs, {
    cwd,
    env,
    stdio: 'inherit',
    shell: isWindows(),
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const code = result.status ?? 1;
    throw new Error(`Command "${command}" failed with exit code ${code}.`);
  }
}

function resolvePackageDir(baseDir, pkgName) {
  return path.join(baseDir, 'node_modules', ...pkgName.split('/'));
}

function copyPackage(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) {
    throw new Error(`Required package not found: ${fromDir}`);
  }

  if (fs.existsSync(toDir)) {
    fs.rmSync(toDir, { recursive: true, force: true });
  }

  fs.mkdirSync(path.dirname(toDir), { recursive: true });
  fs.cpSync(fromDir, toDir, { recursive: true, dereference: true });
}

function readPackageJson(pkgDir) {
  const pkgPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
}

function stageRuntimePackages(frontendDir, platform, arch) {
  const rootDir = path.join(frontendDir, '..', '..');
  const nodePlatform = toNodePlatform(platform);
  const packages = [
    '@lydell/node-pty',
    `@lydell/node-pty-${nodePlatform}-${arch}`,
    'minimatch',
  ];
  const outMainDir = path.join(frontendDir, 'out', 'main');
  const outModulesDir = path.join(outMainDir, 'node_modules');

  if (!fs.existsSync(outMainDir)) {
    throw new Error('Missing build output. Run electron-vite build before staging node-pty.');
  }

  fs.mkdirSync(outModulesDir, { recursive: true });

  const staged = new Set();

  function stagePackage(pkgName) {
    if (staged.has(pkgName)) return;
    staged.add(pkgName);

    const rootDirPath = resolvePackageDir(rootDir, pkgName);
    if (!fs.existsSync(rootDirPath)) {
      throw new Error(`Missing ${pkgName} in workspace. Run npm install before packaging.`);
    }

    const localDir = path.join(outModulesDir, ...pkgName.split('/'));
    console.log(`[package] Staging ${pkgName} into build output...`);
    copyPackage(rootDirPath, localDir);

    const pkgJson = readPackageJson(rootDirPath);
    if (!pkgJson) return;

    const deps = pkgJson.dependencies || {};
    const optionalDeps = pkgJson.optionalDependencies || {};

    for (const depName of Object.keys(deps)) {
      stagePackage(depName);
    }

    for (const depName of Object.keys(optionalDeps)) {
      const optionalPath = resolvePackageDir(rootDir, depName);
      if (fs.existsSync(optionalPath)) {
        stagePackage(depName);
      } else {
        console.log(`[package] Skipping optional dependency not installed: ${depName}`);
      }
    }
  }

  for (const pkgName of packages) {
    stagePackage(pkgName);
  }
}

async function main() {
  const frontendDir = path.join(__dirname, '..');
  const env = buildEnv(frontendDir);

  const platforms = resolvePlatforms();
  const archs = resolveArchs();

  for (const platform of platforms) {
    for (const arch of archs) {
      await downloadPython(platform, arch);
    }
  }

  runCommand('electron-vite', ['build'], frontendDir, env);

  for (const platform of platforms) {
    for (const arch of archs) {
      stageRuntimePackages(frontendDir, platform, arch);
    }
  }

  const builderArgs = [...args];
  const hasPublishFlag = builderArgs.some((arg) => arg === '--publish' || arg.startsWith('--publish='));
  if (!hasPublishFlag) {
    builderArgs.push('--publish', 'never');
  }

  runCommand('electron-builder', builderArgs, frontendDir, env);
}

// Run main() only when this file is executed directly (not when imported for testing)
if (require.main === module) {
  main().catch((err) => {
    console.error(`[package] Error: ${err.message}`);
    process.exitCode = 1;
  });
}

// Export for testing
module.exports = { validateArgs, SHELL_METACHARACTERS };
