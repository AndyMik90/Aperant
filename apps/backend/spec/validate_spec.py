#!/usr/bin/env python3
"""
Spec Validation System - Entry Point
=====================================

Validates spec outputs at each checkpoint to ensure reliability.
This is the enforcement layer that catches errors before they propagate.

Usage:
    python auto-claude/validate_spec.py --spec-dir auto-claude/specs/001-feature/ --checkpoint prereqs
    python auto-claude/validate_spec.py --spec-dir auto-claude/specs/001-feature/ --checkpoint context
    python auto-claude/validate_spec.py --spec-dir auto-claude/specs/001-feature/ --checkpoint spec
    python auto-claude/validate_spec.py --spec-dir auto-claude/specs/001-feature/ --checkpoint plan
    python auto-claude/validate_spec.py --spec-dir auto-claude/specs/001-feature/ --checkpoint all
"""

import io
import sys

# Configure safe encoding on Windows to handle Unicode characters in output
# This is needed because this script prints checkmark symbols (✓, ✗)
if sys.platform == "win32":
    for _stream_name in ("stdout", "stderr"):
        _stream = getattr(sys, _stream_name)
        # Method 1: Try reconfigure (works for TTY)
        if hasattr(_stream, "reconfigure"):
            try:
                _stream.reconfigure(encoding="utf-8", errors="replace")
                continue
            except (
                AttributeError,
                io.UnsupportedOperation,
                OSError,
            ):  # Stream doesn't support reconfigure
                pass  # no-op
        # Method 2: Wrap with TextIOWrapper for piped output
        try:
            if hasattr(_stream, "buffer"):
                _new_stream = io.TextIOWrapper(
                    _stream.buffer,
                    encoding="utf-8",
                    errors="replace",
                    line_buffering=True,
                )
                setattr(sys, _stream_name, _new_stream)
        except (
            AttributeError,
            io.UnsupportedOperation,
            OSError,
        ):  # Stream doesn't support wrapper
            pass  # no-op
    # Clean up temporary variables
    del _stream_name, _stream
    # _new_stream is only defined in the except block, so check locals()
    if "_new_stream" in locals():
        del _new_stream

import argparse
import json
from pathlib import Path
from typing import Any

from validate_pkg import SpecValidator, auto_fix_plan


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Validate spec outputs at checkpoints")
    parser.add_argument(
        "--spec-dir",
        type=Path,
        required=True,
        help="Directory containing spec files",
    )
    parser.add_argument(
        "--checkpoint",
        choices=["prereqs", "context", "spec", "plan", "all"],
        default="all",
        help="Which checkpoint to validate",
    )
    parser.add_argument(
        "--auto-fix",
        action="store_true",
        help="Attempt to auto-fix common issues",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON",
    )

    args = parser.parse_args()

    validator = SpecValidator(args.spec_dir)

    if args.auto_fix:
        auto_fix_plan(args.spec_dir)

    # Run validations
    # Initialize empty list to be populated based on checkpoint
    results: list[Any] = []
    if args.checkpoint == "all":
        results = validator.validate_all()
    elif args.checkpoint == "prereqs":
        results = [validator.validate_prereqs()]
    elif args.checkpoint == "context":
        results = [validator.validate_context()]
    elif args.checkpoint == "spec":
        results = [validator.validate_spec_document()]
    elif args.checkpoint == "plan":
        results = [validator.validate_implementation_plan()]

    # Output
    all_valid = all(r.valid for r in results)

    if args.json:
        output = {
            "valid": all_valid,
            "results": [
                {
                    "checkpoint": r.checkpoint,
                    "valid": r.valid,
                    "errors": r.errors,
                    "warnings": r.warnings,
                    "fixes": r.fixes,
                }
                for r in results
            ],
        }
        print(json.dumps(output, indent=2))
    else:
        print("=" * 60)
        print("  SPEC VALIDATION REPORT")
        print("=" * 60)
        print()

        for result in results:
            print(result)
            print()

        print("=" * 60)
        if all_valid:
            print("  ✓ ALL CHECKPOINTS PASSED")
        else:
            print("  ✗ VALIDATION FAILED - See errors above")
        print("=" * 60)

    sys.exit(0 if all_valid else 1)


if __name__ == "__main__":
    main()
