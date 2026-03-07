"""
Idea validation and prioritization.

Validates ideation output files and ensures they meet quality standards.
"""

import json
import sys
from pathlib import Path

# Add auto-claude to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from debug import (
    debug_detailed,
    debug_error,
    debug_success,
    debug_verbose,
    debug_warning,
)


class IdeaPrioritizer:
    """Validates and prioritizes generated ideas."""

    def __init__(self, output_dir: Path):
        self.output_dir = Path(output_dir)

    def validate_ideation_output(self, output_file: Path, ideation_type: str) -> dict:
        """Validate ideation output file and return validation result."""
        debug_detailed(
            "ideation_prioritizer",
            f"Validating output for {ideation_type}",
            output_file=str(output_file),
        )

        if not output_file.exists():
            debug_warning(
                "ideation_prioritizer",
                "Output file does not exist",
                output_file=str(output_file),
            )
            return {
                "success": False,
                "error": "Output file does not exist",
                "current_content": "",
                "count": 0,
            }

        try:
            content = output_file.read_text(encoding="utf-8")
            data = json.loads(content)
            debug_verbose(
                "ideation_prioritizer",
                "Parsed JSON successfully",
                keys=list(data.keys()),
            )

            # Check for correct key
            ideas = data.get(ideation_type, [])

            # Also check for common incorrect key "ideas"
            if not ideas and "ideas" in data:
                debug_warning(
                    "ideation_prioritizer",
                    "Wrong JSON key detected",
                    expected=ideation_type,
                    found="ideas",
                )
                return {
                    "success": False,
                    "error": f"Wrong JSON key: found 'ideas' but expected '{ideation_type}'",
                    "current_content": content,
                    "count": 0,
                }

            if len(ideas) >= 1:
                debug_success(
                    "ideation_prioritizer",
                    f"Validation passed for {ideation_type}",
                    ideas_count=len(ideas),
                )
                return {
                    "success": True,
                    "error": None,
                    "current_content": content,
                    "count": len(ideas),
                }
            else:
                debug_warning(
                    "ideation_prioritizer", f"No ideas found for {ideation_type}"
                )
                return {
                    "success": False,
                    "error": f"No {ideation_type} ideas found in output",
                    "current_content": content,
                    "count": 0,
                }

        except json.JSONDecodeError as e:
            debug_error("ideation_prioritizer", "JSON parse error", error=str(e))
            return {
                "success": False,
                "error": f"Invalid JSON: {e}",
                "current_content": output_file.read_text(encoding="utf-8")
                if output_file.exists()
                else "",
                "count": 0,
            }
