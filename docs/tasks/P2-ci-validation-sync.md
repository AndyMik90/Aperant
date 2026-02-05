# Task: P2 CI Validation - Prompt/Validator Sync Test

## Overview

Add a CI test that verifies prompt templates (spec_writer.md, spec_quick.md) include all required sections defined in schemas.py. This prevents future drift between what the validator expects and what the prompts tell agents to create.

## Task Scope

### In Scope
- Create pytest test that validates prompt templates
- Verify spec_writer.md has all SPEC_REQUIRED_SECTIONS
- Verify spec_quick.md has all SPEC_REQUIRED_SECTIONS
- Add to existing test suite

### Out of Scope
- Changes to prompts or validators (those are P0)
- CI pipeline configuration changes
- Testing other prompt files

## Success Criteria

- [ ] Test file exists at appropriate location in test suite
- [ ] Test reads SPEC_REQUIRED_SECTIONS from schemas.py
- [ ] Test verifies each required section exists in spec_writer.md
- [ ] Test verifies each required section exists in spec_quick.md
- [ ] Test fails with clear message if section is missing
- [ ] Test passes after P0 fixes are applied

## Workflow Type

**Type**: feature

---

## EXECUTION RULES (READ BEFORE STARTING)

**You are NOT ALLOWED to stop until ALL steps below are complete and the final promise is output.**

1. Complete each step in order
2. Output the step promise IMMEDIATELY after completing each step
3. **DO NOT** write progress summaries between steps - just continue
4. After each step promise, continue to the next step WITHOUT stopping
5. Only stop after outputting the FINAL `<promise>TASK_P2_COMPLETE</promise>`

---

## Implementation Steps

**Total Steps: 2** (You must complete ALL steps)

### Step 1 of 2: Find Test Location and Patterns

**Files:**
- `apps/backend/tests/` - Find existing test structure
- `apps/backend/spec/validate_pkg/schemas.py` - Source of truth for required sections

**What:**
1. Find where spec-related tests live
2. Understand the test patterns used (pytest fixtures, etc.)
3. Identify where to add the new sync test

**Exit:** Know the test location and patterns to follow

**After completing this step:**
1. Output: `<promise>STEP_1_COMPLETE</promise>`
2. Say: **NEXT: Step 2 - Create Sync Test**
3. DO NOT stop. Continue immediately.

---

### Step 2 of 2: Create Prompt/Validator Sync Test

**Files:** `apps/backend/tests/spec/test_prompt_validator_sync.py` (or appropriate location)

**What:** Create a test file that validates prompt templates match validator requirements:

```python
"""
Test that prompt templates include all sections required by the spec validator.

This prevents drift between:
- schemas.py SPEC_REQUIRED_SECTIONS (what validator checks)
- spec_writer.md template (what agent follows)
- spec_quick.md template (what agent follows for simple tasks)
"""

import re
from pathlib import Path

import pytest

from spec.validate_pkg.schemas import SPEC_REQUIRED_SECTIONS


PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"


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
        assert spec_writer.exists(), "spec_writer.md not found"

        content = spec_writer.read_text()

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
        assert spec_quick.exists(), "spec_quick.md not found"

        content = spec_quick.read_text()

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
```

**Exit:** Test file created and validates prompt/validator sync

**After completing this step:**
1. Output: `<promise>STEP_2_COMPLETE</promise>`
2. Say: **NEXT: Final Verification**
3. DO NOT stop. Continue immediately.

---

## Files to Modify

| File | What to Change |
|------|---------------|
| `apps/backend/tests/spec/test_prompt_validator_sync.py` | CREATE - New test file |

## Files to Reference

| File | Pattern to Copy |
|------|----------------|
| `apps/backend/spec/validate_pkg/schemas.py` | SPEC_REQUIRED_SECTIONS definition |
| `apps/backend/tests/` | Existing test patterns |

---

## Final Verification Checklist

Before outputting the completion promise, verify:

- [ ] Test file created
- [ ] Test imports SPEC_REQUIRED_SECTIONS from schemas.py
- [ ] Test checks spec_writer.md
- [ ] Test checks spec_quick.md
- [ ] Test has clear error messages

## Completion Promise

**ONLY output this after ALL steps are complete and verified:**

<promise>TASK_P2_COMPLETE</promise>
