/**
 * Process Management Validators
 * ==============================
 *
 * Validators for process management commands (pkill, kill, killall).
 *
 * Security model: DENYLIST-based (consistent with the overall security system).
 * Instead of allowlisting known dev processes (which breaks for any new
 * framework/tool), we block killing system-critical processes that would crash
 * the OS, desktop environment, or the application itself.
 */

import type { ValidationResult } from '../bash-validator';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * System-critical process names that must NEVER be killed by autonomous agents.
 * These are stable OS/desktop/infrastructure processes — they don't change
 * with every new JS framework release.
 */
const BLOCKED_PROCESS_NAMES = new Set([
  // -- OS init / system --
  'systemd',
  'launchd',
  'init',
  'loginwindow',
  'kernel_task',
  'kerneltask',
  'containerd',
  'dockerd',

  // -- macOS desktop --
  'Finder',
  'Dock',
  'WindowServer',
  'SystemUIServer',
  'NotificationCenter',
  'Spotlight',
  'mds',
  'mds_stores',
  'coreaudiod',
  'corebrightnessd',
  'securityd',
  'opendirectoryd',
  'diskarbitrationd',

  // -- Linux desktop / display --
  'Xorg',
  'Xwayland',
  'gnome-shell',
  'kwin',
  'kwin_wayland',
  'kwin_x11',
  'plasmashell',
  'mutter',
  'gdm',
  'lightdm',
  'sddm',
  'pulseaudio',
  'pipewire',
  'wireplumber',
  'dbus-daemon',
  'polkitd',
  'networkmanager',
  'NetworkManager',
  'wpa_supplicant',

  // -- Windows critical (for cross-platform) --
  'explorer.exe',
  'dwm.exe',
  'csrss.exe',
  'winlogon.exe',
  'lsass.exe',
  'services.exe',
  'svchost.exe',
  'smss.exe',
  'wininit.exe',

  // -- Remote access --
  'sshd',
  'ssh-agent',

  // -- Self-protection (don't let the agent kill its own host) --
  'electron',
  'Electron',
  'auto-claude',
  'Aperant',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple shell-like tokenizer — splits on whitespace, respects single/double quotes.
 * Returns null if parsing fails (unclosed quotes, etc.).
 */
function shellSplit(input: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < input.length) {
    const ch = input[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === '\\' && i + 1 < input.length) {
        current += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      } else {
        current += ch;
      }
      i++;
      continue;
    }

    if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      i++;
      continue;
    }
    current += ch;
    i++;
  }

  if (inSingle || inDouble) {
    return null; // Unclosed quote
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Validate pkill commands — block killing system-critical processes.
 *
 * Uses a denylist model: any process can be killed UNLESS it's a known
 * system-critical process (OS daemons, desktop environment, remote access,
 * or the application itself). This is framework-agnostic — works with any
 * dev tooling without needing to maintain an allowlist.
 */
export function validatePkillCommand(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse pkill command'];
  }

  if (tokens.length === 0) {
    return [false, 'Empty pkill command'];
  }

  // Block dangerous flags that have broad blast radius
  const flags: string[] = [];
  const args: string[] = [];
  for (const token of tokens.slice(1)) {
    if (token.startsWith('-')) {
      flags.push(token);
    } else {
      args.push(token);
    }
  }

  // Block -u (kill by user — too broad, affects all processes for a user)
  for (const flag of flags) {
    if (flag === '-u' || flag.startsWith('-u') || flag === '--euid') {
      return [false, 'pkill -u (kill by user) is not allowed — too broad, affects all processes for a user'];
    }
  }

  if (args.length === 0) {
    return [false, 'pkill requires a process name'];
  }

  // The target is typically the last non-flag argument
  let target = args[args.length - 1];

  // For -f flag (full command line match), extract the first word
  if (target.includes(' ')) {
    target = target.split(' ')[0];
  }

  // Check against blocked system-critical processes
  if (BLOCKED_PROCESS_NAMES.has(target)) {
    return [
      false,
      `Cannot kill system-critical process '${target}'. ` +
        `Killing OS daemons, desktop environment, or remote access processes ` +
        `could crash the system or lock out the user.`,
    ];
  }

  return [true, ''];
}

/**
 * Validate kill commands — allow killing by PID (user must know the PID).
 *
 * Ported from: validate_kill_command()
 */
export function validateKillCommand(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse kill command'];
  }

  // Block kill -1 (kill all processes) and kill 0 / kill -0
  for (const token of tokens.slice(1)) {
    if (token === '-1' || token === '0' || token === '-0') {
      return [
        false,
        'kill -1 and kill 0 are not allowed (affects all processes)',
      ];
    }
  }

  return [true, ''];
}

/**
 * Validate killall commands — same rules as pkill.
 *
 * Ported from: validate_killall_command()
 */
export function validateKillallCommand(
  commandString: string,
): ValidationResult {
  return validatePkillCommand(commandString);
}
