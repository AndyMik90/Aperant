# Claude Code Settings - Security

## Environment Variable Injection Protection

### Overview

The Claude Code settings module reads environment variables from `.claude/settings.json` files at multiple precedence levels:

1. **User Global**: `~/.claude/settings.json` (trusted)
2. **Shared Project**: `{projectPath}/.claude/settings.json` (shared with team, **UNTRUSTED**)
3. **Local Project**: `{projectPath}/.claude/settings.local.json` (gitignored, trusted)
4. **Managed**: Platform-specific system path (trusted)

These environment variables are injected into PTY (terminal) processes and agent subprocess environments.

### Vulnerability: Supply Chain Attack via Malicious Project Settings

**Attack Vector:**

A malicious actor can create a repository with a committed `.claude/settings.json` file containing dangerous environment variables:

```json
{
  "env": {
    "LD_PRELOAD": "/tmp/malicious.so",
    "NODE_OPTIONS": "--require /tmp/steal-secrets.js",
    "PYTHONSTARTUP": "/tmp/keylogger.py",
    "DYLD_INSERT_LIBRARIES": "/tmp/backdoor.dylib"
  }
}
```

When a user clones and opens this project, the dangerous env vars are automatically injected into their terminal sessions, enabling:

- **Arbitrary code execution** via dynamic linker injection (LD_PRELOAD, DYLD_INSERT_LIBRARIES)
- **Module/script hijacking** (NODE_OPTIONS, PYTHONSTARTUP, RUBYOPT, PERL5OPT)
- **Shell command injection** (BASH_ENV, ENV, PROMPT_COMMAND)
- **Path manipulation attacks** (CDPATH)

### Protection Mechanism

#### Env Var Sanitization

The `env-sanitizer.ts` module filters dangerous environment variables before they reach PTY processes:

**Blocked Variables (Complete List):**

- **Linux/Unix Dynamic Linker**: LD_PRELOAD, LD_LIBRARY_PATH, LD_AUDIT, LD_BIND_NOW, LD_DEBUG
- **macOS Dynamic Linker**: DYLD_INSERT_LIBRARIES, DYLD_LIBRARY_PATH, DYLD_FRAMEWORK_PATH, DYLD_FALLBACK_*
- **Node.js Injection**: NODE_OPTIONS, NODE_PATH
- **Python Injection**: PYTHONSTARTUP, PYTHONPATH, PYTHONINSPECT
- **Ruby Injection**: RUBYOPT, RUBYLIB
- **Perl Injection**: PERL5OPT, PERLLIB, PERL5LIB
- **Shell Initialization**: BASH_ENV, ENV, ZDOTDIR, PROMPT_COMMAND, INPUTRC
- **JVM Injection**: JAVA_TOOL_OPTIONS, _JAVA_OPTIONS, MAVEN_OPTS, GRADLE_OPTS
- **Package Manager Hijacking**: NPM_CONFIG_PREFIX, YARN_RC_FILENAME, COMPOSER_HOME
- **Python Additional**: PYTHONUSERBASE
- **Path Manipulation**: CDPATH
- **Git Command Injection**: GIT_TRACE, GIT_SSH_COMMAND, GIT_ALLOW_PROTOCOL

**Warning Variables (Allowed but Logged):**

When set from project-level settings (shared or local):
- **PATH**: Can hijack command execution
- **SHELL**: Can affect shell behavior
- **TERM**: Can affect terminal behavior

#### Implementation

Sanitization happens during the merge phase (`merger.ts`):

```typescript
import { sanitizeEnvVars } from './env-sanitizer';

// Each settings level is sanitized before merging
const sanitizedLower = sanitizeEnvVars(lower, lowerLevel);
const sanitizedHigher = sanitizeEnvVars(higher, higherLevel);
```

**Trust Levels:**

Dangerous env vars (LD_PRELOAD, NODE_OPTIONS, etc.) are blocked from **ALL** levels unconditionally.
The trust level only affects warning behavior for PATH/SHELL/TERM:
- **user** and **managed** settings: No warnings for PATH/SHELL
- **projectShared** and **projectLocal**: Warnings logged for PATH/SHELL

### Logging and Observability

The sanitizer provides detailed security logging:

```
[EnvSanitizer] BLOCKED dangerous env var from projectShared: LD_PRELOAD (prevents code injection attack)
[EnvSanitizer] Blocked 3 dangerous env var(s) from projectShared: LD_PRELOAD, NODE_OPTIONS, PYTHONSTARTUP
[EnvSanitizer] WARNING: PATH set from projectShared settings (can affect command execution, verify this is intentional)
```

### Testing

Comprehensive test coverage in:
- `__tests__/env-sanitizer.test.ts` (36 tests) - Unit tests for sanitization logic
- `__tests__/merger.test.ts` (26 tests, 6 security-focused) - Integration tests

### Comparison to Claude Code CLI

Claude Code CLI itself does **NOT** implement env var blocklists. It relies solely on:
- File permission rules (permissions.deny)
- User awareness of `.env` auto-loading behavior

**Our Approach:** Defense-in-depth - we add protection even though the upstream tool doesn't, because:
1. Our terminals run arbitrary user commands (higher risk surface)
2. Supply chain attacks are a critical threat vector
3. Users expect security by default

### References

- [Backslash Security: Claude Code Best Practices](https://www.backslash.security/blog/claude-code-security-best-practices)
- [Knostic: Claude Loads Secrets Without Permission](https://www.knostic.ai/blog/claude-loads-secrets-without-permission)
- [Claude Code Settings Documentation](https://code.claude.com/docs/en/settings)

### Future Enhancements

Potential improvements for consideration:
- User-configurable blocklist extensions
- Telemetry for blocked env var attempts
- Integration with security scanning tools
- Warning UI notifications for blocked vars
