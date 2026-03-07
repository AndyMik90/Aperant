#!/usr/bin/env node
/**
 * Verify Python bundling configuration is correct.
 * Run this before packaging to ensure Python will be properly bundled.
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const FRONTEND_DIR = path.resolve(__dirname, '..');
const PYTHON_RUNTIME_DIR = path.join(FRONTEND_DIR, 'python-runtime');

console.log('=== Python Bundling Verification ===\n');

// Check 1: Python runtime downloaded?
console.log('1. Checking if Python runtime is downloaded...');
const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
const arch = process.arch;
const runtimePath = path.join(PYTHON_RUNTIME_DIR, `${platform}-${arch}`, 'python');

if (fs.existsSync(runtimePath)) {
  const pythonExe = process.platform === 'win32'
    ? path.join(runtimePath, 'python.exe')
    : path.join(runtimePath, 'bin', 'python3');

  if (fs.existsSync(pythonExe)) {
    console.log(`   ✓ Found bundled Python at: ${pythonExe}`);

    // Test version
    try {
      const version = execSync(`"${pythonExe}" --version`, { encoding: 'utf8' }).trim();
      console.log(`   ✓ Version: ${version}`);
    } catch (e) {
      console.log(`   ✗ Failed to get version: ${e.message}`);
    }
  } else {
    console.log(`   ✗ Python executable not found at: ${pythonExe}`);
  }
} else {
  console.log(`   ✗ Python runtime not downloaded. Run: npm run python:download`);
}

// Check 2: package.json extraResources configured?
console.log('\n2. Checking package.json extraResources configuration...');
const packageJson = require(path.join(FRONTEND_DIR, 'package.json'));
const extraResources = packageJson.build?.extraResources || [];

const pythonResource = extraResources.find(r =>
  (typeof r === 'string' && r.includes('python')) ||
  (typeof r === 'object' && r.from?.includes('python'))
);

if (pythonResource) {
  console.log('   ✓ Python is configured in extraResources:');
  console.log(`     ${JSON.stringify(pythonResource)}`);
} else {
  console.log('   ✗ Python not found in extraResources configuration');
}

// Check 3: Test venv creation simulation
console.log('\n3. Checking venv creation capability...');
try {
  // Find system Python for testing
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  const result = spawnSync(pythonCmd, ['-m', 'venv', '--help'], { encoding: 'utf8' });
  if (result.status === 0) {
    console.log(`   ✓ venv module is available`);
  } else {
    console.log(`   ✗ venv module not available: ${result.stderr}`);
  }
} catch (e) {
  console.log(`   ✗ Failed to check venv: ${e.message}`);
}

// Check 4: Verify requirements.txt exists
console.log('\n4. Checking requirements.txt...');
const backendDir = path.join(FRONTEND_DIR, '..', 'backend');
const requirementsPath = path.join(backendDir, 'requirements.txt');

if (fs.existsSync(requirementsPath)) {
  const content = fs.readFileSync(requirementsPath, 'utf8');
  const hasDotenv = content.includes('python-dotenv');
  const hasSDK = content.includes('claude-agent-sdk');

  console.log(`   ✓ requirements.txt found`);
  console.log(`   ${hasDotenv ? '✓' : '✗'} python-dotenv: ${hasDotenv ? 'present' : 'MISSING!'}`);
  console.log(`   ${hasSDK ? '✓' : '✗'} claude-agent-sdk: ${hasSDK ? 'present' : 'MISSING!'}`);
} else {
  console.log(`   ✗ requirements.txt not found at: ${requirementsPath}`);
}

// Summary
console.log('\n=== Summary ===');
console.log('To fully test Python bundling:');
console.log('1. Run: npm run python:download');
console.log('2. Run: npm run package:win (or :mac/:linux)');
console.log('3. Launch the packaged app and check Dev Tools console for:');
console.log('   - "[Python] Found bundled Python at: ..."');
console.log('   - "[PythonEnvManager] Ready with Python path: ..."');
console.log('4. Try creating and running a task - should work without dotenv errors');
