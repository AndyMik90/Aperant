"""
Script execution utilities for ideation generation.

Provides functionality to run external Python scripts and capture their output.
"""

import subprocess
import sys
from pathlib import Path


class ScriptRunner:
    """Handles execution of external Python scripts."""

    def __init__(self, project_dir: Path):
        """Initialize the script runner.

        Args:
            project_dir: Project directory to use as working directory
        """
        self.project_dir = project_dir

    def run_script(
        self, script: str, args: list[str], timeout: int = 300
    ) -> tuple[bool, str]:
        """Run a Python script and return (success, output).

        Args:
            script: Relative path to script from ac-jerry directory
            args: Command line arguments for the script
            timeout: Maximum execution time in seconds (default: 300)

        Returns:
            Tuple of (success: bool, output: str)
        """
        script_path = Path(__file__).parent.parent / script

        if not script_path.exists():
            return False, f"Script not found: {script_path}"

        cmd = [sys.executable, str(script_path)] + args

        try:
            result = subprocess.run(
                cmd,
                cwd=self.project_dir,
                capture_output=True,
                text=True,
                timeout=timeout,
            )

            if result.returncode == 0:
                return True, result.stdout
            else:
                return False, result.stderr or result.stdout

        except subprocess.TimeoutExpired:
            return False, "Script timed out"
        except Exception as e:
            return False, str(e)
