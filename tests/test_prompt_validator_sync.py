#!/usr/bin/env python3
"""
Test that prompt templates include all sections required by the spec validator.

This prevents drift between:
- schemas.py SPEC_REQUIRED_SECTIONS (what validator checks)
- spec_writer.md template (what agent follows)
- spec_quick.md template (what agent follows for simple tasks)

If this test fails, it means the validator expects sections that the prompt
templates don't teach agents to create. Fix by updating the prompt templates
to include the missing sections.
"""

import re
from pathlib import Path

import pytest

from spec.validate_pkg.schemas import SPEC_REQUIRED_SECTIONS


# Path to prompts directory relative to test file
PROMPTS_DIR = Path(__file__).parent.parent / "apps" / "backend" / "prompts"


def extract_markdown_sections(content: str) -> list[str]:
    """Extract all ## and # section headers from markdown content."""
    pattern = r'^##?\s+(.+)$'
    matches = re.findall(pattern, content, re.MULTILINE)
    return [m.strip() for m in matches]


class TestPromptValidatorSync:
    """Ensure prompt templates stay in sync with validator requirements."""

    def test_spec_writer_has_required_sections(self):
        """spec_writer.md must include all SPEC_REQUIRED_SECTIONS."""
        spec_writer = PROMPTS_DIR / "spec_writer.md"
        assert spec_writer.exists(), f"spec_writer.md not found at {spec_writer}"

        content = spec_writer.read_text(encoding="utf-8")

        for section in SPEC_REQUIRED_SECTIONS:
            # Check for ## Section or # Section (case-insensitive)
            pattern = rf'^##?\s+{re.escape(section)}'
            assert re.search(pattern, content, re.MULTILINE | re.IGNORECASE), (
                f"spec_writer.md missing required section: '{section}'\n"
                f"Add '## {section}' to the template.\n"
                f"Required sections: {SPEC_REQUIRED_SECTIONS}"
            )

    def test_spec_quick_has_required_sections(self):
        """spec_quick.md must include all SPEC_REQUIRED_SECTIONS."""
        spec_quick = PROMPTS_DIR / "spec_quick.md"
        assert spec_quick.exists(), f"spec_quick.md not found at {spec_quick}"

        content = spec_quick.read_text(encoding="utf-8")

        for section in SPEC_REQUIRED_SECTIONS:
            pattern = rf'^##?\s+{re.escape(section)}'
            assert re.search(pattern, content, re.MULTILINE | re.IGNORECASE), (
                f"spec_quick.md missing required section: '{section}'\n"
                f"Add '## {section}' to the template.\n"
                f"Required sections: {SPEC_REQUIRED_SECTIONS}"
            )

    def test_required_sections_list_not_empty(self):
        """Sanity check that SPEC_REQUIRED_SECTIONS is defined."""
        assert len(SPEC_REQUIRED_SECTIONS) > 0, "SPEC_REQUIRED_SECTIONS is empty"
        assert "Overview" in SPEC_REQUIRED_SECTIONS
        assert "Task Scope" in SPEC_REQUIRED_SECTIONS

    def test_spec_writer_sections_discoverable(self):
        """Verify we can extract sections from spec_writer.md."""
        spec_writer = PROMPTS_DIR / "spec_writer.md"
        content = spec_writer.read_text(encoding="utf-8")
        sections = extract_markdown_sections(content)

        # Should have multiple sections
        assert len(sections) > 5, f"Too few sections found: {sections}"

        # Should include some expected headers (from the template)
        section_names_lower = [s.lower() for s in sections]
        assert any("overview" in s for s in section_names_lower), (
            f"Expected 'Overview' section in spec_writer.md, found: {sections}"
        )

    def test_spec_quick_sections_discoverable(self):
        """Verify we can extract sections from spec_quick.md."""
        spec_quick = PROMPTS_DIR / "spec_quick.md"
        content = spec_quick.read_text(encoding="utf-8")
        sections = extract_markdown_sections(content)

        # Should have multiple sections
        assert len(sections) > 3, f"Too few sections found: {sections}"

        # Should include some expected headers
        section_names_lower = [s.lower() for s in sections]
        assert any("overview" in s for s in section_names_lower), (
            f"Expected 'Overview' section in spec_quick.md, found: {sections}"
        )
