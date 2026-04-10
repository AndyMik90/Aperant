/**
 * Register the ESM electron mock loader.
 * Used with: node --import ./register-loader.mjs
 *
 * CRITICAL: Sets process.versions.electron BEFORE any modules load,
 * because @sentry/electron reads it at module evaluation time.
 */
if (!process.versions.electron) {
  process.versions.electron = '30.0.0';
}
process.env.MCP_STANDALONE = 'true';

const mcpBootstrapDiagnostics = {
  phase: 'register-loader',
  stdoutWriteCount: 0,
};

globalThis.__AUTO_CLAUDE_MCP_BOOT = mcpBootstrapDiagnostics;

function writeBootstrapLog(message) {
  try {
    process.stderr.write(`[MCP bootstrap] ${message}\n`);
  } catch {
    // Ignore stderr write failures during bootstrap diagnostics
  }
}

writeBootstrapLog(`register-loader start pid=${process.pid} cwd=${process.cwd()}`);
writeBootstrapLog(`execPath=${process.execPath}`);
writeBootstrapLog(`argv=${JSON.stringify(process.argv)}`);

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function patchedStdoutWrite(...args) {
  try {
    const diagnostics = globalThis.__AUTO_CLAUDE_MCP_BOOT;
    const phase = diagnostics?.phase || 'unknown';

    if (phase !== 'connected') {
      diagnostics.stdoutWriteCount = (diagnostics.stdoutWriteCount || 0) + 1;
      const [chunk] = args;
      const preview = typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk);

      writeBootstrapLog(
        `stdout write detected before MCP connect phase=${phase} count=${diagnostics.stdoutWriteCount} preview=${JSON.stringify(preview.slice(0, 200))}`
      );
      writeBootstrapLog(new Error('stdout write stack').stack || 'stdout write stack unavailable');
    }
  } catch (error) {
    writeBootstrapLog(`failed to inspect stdout write: ${error instanceof Error ? (error.stack || error.message) : String(error)}`);
  }

  return originalStdoutWrite(...args);
};

process.on('uncaughtExceptionMonitor', (error) => {
  writeBootstrapLog(`uncaughtExceptionMonitor: ${error?.stack || error}`);
});

process.on('unhandledRejection', (reason) => {
  writeBootstrapLog(`unhandledRejection: ${reason instanceof Error ? (reason.stack || reason.message) : String(reason)}`);
});

import { register } from 'node:module';
register('./electron-loader.mjs', import.meta.url);
