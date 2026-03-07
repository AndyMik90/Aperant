"""
Phase Execution Utilities
==========================

Helper functions for phase execution.
"""

import subprocess
import sys
from pathlib import Path


def run_script(project_dir: Path, script: str, args: list[str]) -> tuple[bool, str]:
    """
    Run a Python script and return (success, output).

    Args:
        project_dir: Project root directory
        script: Name of the script to run
        args: Command-line arguments for the script

    Returns:
        Tuple of (success: bool, output: str)
    """
    script_path = project_dir / ".auto-claude" / script

    if not script_path.exists():
        return False, f"Script not found: {script_path}"

    cmd = [sys.executable, str(script_path)] + args

    try:
        result = subprocess.run(
            cmd,
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode == 0:
            return True, result.stdout
        else:
            return False, result.stderr or result.stdout

    except subprocess.TimeoutExpired:
        return False, "Script timed out"
    except Exception as e:
        return False, str(e)
