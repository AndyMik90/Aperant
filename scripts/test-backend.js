#!/usr/bin/env node
/**
 * Cross-platform backend test runner script
 * Runs pytest using the correct virtual environment path for Windows/Mac/Linux
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const isWindows = os.platform() === 'win32';
const rootDir = path.join(__dirname, '..');
const backendDir = path.join(rootDir, 'apps', 'backend');
const testsDir = path.join(rootDir, 'tests');
const venvDir = path.join(backendDir, '.venv');

// Get pytest path based on platform
const pytestPath = isWindows
  ? path.join(venvDir, 'Scripts', 'pytest.exe')
  : path.join(venvDir, 'bin', 'pytest');

// Check if venv exists
if (!fs.existsSync(venvDir)) {
  console.error('Error: Virtual environment not found.');
  console.error('Run "npm run install:backend" first.');
  process.exit(1);
}

// Check if pytest is installed
if (!fs.existsSync(pytestPath)) {
  console.error('Error: pytest not found in virtual environment.');
  console.error('Install test dependencies:');
  const pipPath = isWindows
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip');
  console.error(`  "${pipPath}" install -r tests/requirements-test.txt`);
  process.exit(1);
}

// Get any additional args passed to the script
// Process args to properly handle -m flag with spaces
const args = process.argv.slice(2);
let testArgs = '';

if (args.length > 0) {
  // Reconstruct args, joining -m with its value if separated
  const processedArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-m' && i + 1 < args.length) {
      // Join -m with its value and quote it
      processedArgs.push(`-m "${args[i + 1]}"`);
      i++; // Skip next arg since we consumed it
    } else {
      processedArgs.push(args[i]);
    }
  }
  testArgs = processedArgs.join(' ');
} else {
  testArgs = '-v';
}

// Run pytest
const cmd = `"${pytestPath}" "${testsDir}" ${testArgs}`;
console.log(`> ${cmd}\n`);

try {
  execSync(cmd, { stdio: 'inherit', cwd: rootDir });
} catch (error) {
  process.exit(error.status || 1);
}
