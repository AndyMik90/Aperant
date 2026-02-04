#!/usr/bin/env python3
"""
Agent Drift Detector - OpenClaw Integration Setup

This patches OpenClaw to report tool usage to the drift monitor.
Run once after installing agent-drift-detector.
"""

import os
import sys
import shutil
import subprocess
import re
from pathlib import Path

# Patch code for legacy steerable-agent-loop.js (pre-2026.1.30)
PATCH_LEGACY = '''
        // === Drift Monitor Hook ===
        if (process.env.DRIFT_MONITOR) {
            const http = require("http");
            const req = http.request({
                hostname: "localhost",
                port: process.env.DRIFT_MONITOR_PORT || 5001,
                path: "/tool",
                method: "POST",
                headers: { "Content-Type": "application/json" }
            }, () => {});
            req.on("error", () => {});
            req.write(JSON.stringify({ tool: toolCall.name, success: !isError }));
            req.end();
        }
        // === End Drift Monitor Hook ==='''

# Patch code for pi-embedded-subscribe.handlers.tools.js (2026.1.30+)
# Uses toolName and isToolError from handleToolExecutionEnd scope
PATCH_HANDLERS = '''
    // === Drift Monitor Hook ===
    if (process.env.DRIFT_MONITOR) {
        const http = require("http");
        const req = http.request({
            hostname: "localhost",
            port: process.env.DRIFT_MONITOR_PORT || 5001,
            path: "/tool",
            method: "POST",
            headers: { "Content-Type": "application/json" }
        }, () => {});
        req.on("error", () => {});
        req.write(JSON.stringify({ tool: toolName, success: !isToolError }));
        req.end();
    }
    // === End Drift Monitor Hook ===
'''

# Target configs: (relative_path, marker_to_find, patch_code, description)
TARGETS = [
    (
        'dist/agents/pi-embedded-subscribe.handlers.tools.js',
        'ctx.log.debug(`embedded run tool end:',
        PATCH_HANDLERS,
        'handlers.tools (2026.1.30+)'
    ),
    (
        'dist/agents/steerable-agent-loop.js',
        'type: "tool_execution_end"',
        PATCH_LEGACY,
        'steerable-agent-loop (legacy)'
    ),
]


def find_openclaw():
    """Find OpenClaw installation path."""
    # Try global npm
    try:
        result = subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True)
        global_path = Path(result.stdout.strip()) / 'openclaw'
        if global_path.exists():
            return global_path
    except:
        pass
    
    # Try local npm
    try:
        result = subprocess.run(['npm', 'root'], capture_output=True, text=True)
        local_path = Path(result.stdout.strip()) / 'openclaw'
        if local_path.exists():
            return local_path
    except:
        pass
    
    # Common paths
    common = [
        Path.home() / '.npm-global/lib/node_modules/openclaw',
        Path('/usr/local/lib/node_modules/openclaw'),
        Path('/usr/lib/node_modules/openclaw'),
    ]
    for p in common:
        if p.exists():
            return p
    
    return None


def get_openclaw_version(openclaw_path: Path) -> str:
    """Get OpenClaw version from package.json."""
    try:
        import json
        pkg = openclaw_path / 'package.json'
        if pkg.exists():
            data = json.loads(pkg.read_text())
            return data.get('version', 'unknown')
    except:
        pass
    return 'unknown'


def find_target_file(openclaw_path: Path):
    """Find the correct file to patch based on OpenClaw version."""
    for rel_path, marker, patch_code, desc in TARGETS:
        target = openclaw_path / rel_path
        if target.exists():
            content = target.read_text()
            if marker in content:
                return target, marker, patch_code, desc
            else:
                print(f" Found {rel_path} but marker missing")
    return None, None, None, None


def patch_file(target: Path, marker: str, patch_code: str) -> bool:
    """Apply the drift monitor patch to the target file."""
    content = target.read_text()
    
    # Already patched?
    if 'Drift Monitor Hook' in content:
        print("  Already patched!")
        return True
    
    # Create backup
    backup = target.with_suffix('.js.backup')
    if not backup.exists():
        shutil.copy(target, backup)
        print(f"  Backup: {backup.name}")
    
    # Find marker position
    pos = content.find(marker)
    if pos == -1:
        print(f"  Marker not found")
        return False
    
    # Find end of the line containing the marker
    line_end = content.find('\n', pos)
    if line_end == -1:
        line_end = len(content)
    
    # Insert patch after the marker line
    insert_pos = line_end + 1
    new_content = content[:insert_pos] + patch_code + content[insert_pos:]
    
    target.write_text(new_content)
    print("  ✅ Patched!")
    return True


def main():
    print()
    print("  🛡️  Agent Drift Detector - OpenClaw Setup")
    print("  " + "=" * 45)
    print()
    
    openclaw = find_openclaw()
    
    if not openclaw:
        print("  Could not find OpenClaw installation")
        print()
        print("  Make sure OpenClaw is installed:")
        print("    npm install -g openclaw")
        print()
        sys.exit(1)
    
    print(f"  OpenClaw: {openclaw}")
    
    version = get_openclaw_version(openclaw)
    print(f"  Version: {version}")
    print()
    
    target, marker, patch_code, desc = find_target_file(openclaw)
    
    if not target:
        print("  No compatible target file found")
        print()
        print("  Searched:")
        for rel_path, _, _, _ in TARGETS:
            full = openclaw / rel_path
            status = "exists" if full.exists() else "missing"
            print(f"    • {rel_path} [{status}]")
        print()
        print("  Your OpenClaw version may not be supported yet.")
        print()
        print("  Report this issue with your version:")
        print("    https://github.com/lukehebe/agent-drift-detector/issues")
        print()
        sys.exit(1)
    
    print(f"  Target: {target.name} ({desc})")
    
    if patch_file(target, marker, patch_code):
        print()
        print("  " + "=" * 45)
        print("  Setup complete!")
        print()
        print("  Usage:")
        print("    Terminal 1:  agent-drift start")
        print("    Terminal 2:  DRIFT_MONITOR=1 openclaw gateway")
        print()
        print("  Always-on (add to ~/.bashrc):")
        print("    export DRIFT_MONITOR=1")
        print("  " + "=" * 45)
        print()
    else:
        sys.exit(1)


if __name__ == '__main__':
    main()
