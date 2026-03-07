#!/usr/bin/env python3
"""
Test script for Self-Critique System Integration

Verifies that:
1. Critique module works correctly
2. Implementation plan supports critique_result field
3. Complete workflow integration functions properly
"""

import json
import sys
from pathlib import Path

# Add auto-claude directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from critique import (
    generate_critique_prompt,
    parse_critique_response,
    should_proceed,
    format_critique_summary,
    CritiqueResult,
)
from implementation_plan import Subtask, SubtaskStatus, Verification, VerificationType


def test_critique_data_structures():
    """Test CritiqueResult data structure."""
    print("Testing CritiqueResult data structure...")

    result = CritiqueResult(
        passes=True,
        issues=["Issue 1", "Issue 2"],
        improvements_made=["Fixed issue 1", "Fixed issue 2"],
        recommendations=["Consider adding tests"],
    )

    # Test to_dict
    data = result.to_dict()
    assert data["passes"] == True
    assert len(data["issues"]) == 2
    assert len(data["improvements_made"]) == 2

    # Test from_dict
    result2 = CritiqueResult.from_dict(data)
    assert result2.passes == result.passes
    assert result2.issues == result.issues

    print("✓ CritiqueResult data structure works correctly")


def test_critique_prompt_generation():
    """Test critique prompt generation."""
    print("\nTesting critique prompt generation...")

    chunk = {
        "id": "test-chunk",
        "description": "Add authentication middleware",
        "service": "backend",
        "files_to_modify": ["app/middleware/auth.py"],
        "files_to_create": ["app/tests/test_auth.py"],
        "patterns_from": ["app/middleware/cors.py"],
    }

    files_modified = ["app/middleware/auth.py", "app/tests/test_auth.py"]

    prompt = generate_critique_prompt(chunk, files_modified, chunk["patterns_from"])

    # Verify prompt contains key elements
    assert "test-chunk" in prompt
    assert "Add authentication middleware" in prompt
    assert "app/middleware/auth.py" in prompt
    assert "STEP 1: Code Quality Checklist" in prompt
    assert "STEP 5: Final Verdict" in prompt

    print("✓ Critique prompt generation works correctly")


def test_critique_response_parsing():
    """Test parsing of critique responses."""
    print("\nTesting critique response parsing...")

    # Test successful critique
    response_pass = """
### STEP 3: Potential Issues Analysis

1. None identified

### STEP 4: Improvements Made

1. Added error handling for edge cases
2. Improved code documentation

### STEP 5: Final Verdict

**PROCEED:** YES

**REASON:** All checks passed, ready for verification

**CONFIDENCE:** High
"""

    result = parse_critique_response(response_pass)
    assert result.passes == True
    assert len(result.improvements_made) == 2

    # Test failed critique
    response_fail = """
### STEP 3: Potential Issues Analysis

1. Missing error handling in auth flow
2. No input validation for tokens

### STEP 4: Improvements Made

1. No fixes needed

### STEP 5: Final Verdict

**PROCEED:** NO

**REASON:** Critical issues need to be addressed

**CONFIDENCE:** Medium
"""

    result2 = parse_critique_response(response_fail)
    assert result2.passes == False
    assert len(result2.issues) == 2
    assert not should_proceed(result2)

    print("✓ Critique response parsing works correctly")


def test_implementation_plan_integration():
    """Test integration with implementation_plan.py Subtask class."""
    print("\nTesting implementation plan integration...")

    # Create a chunk with critique result
    chunk = Subtask(
        id="test-chunk",
        description="Test chunk with critique",
        status=SubtaskStatus.PENDING,
        service="backend",
        files_to_modify=["app/test.py"],
    )

    # Add critique result
    critique_data = {
        "passes": True,
        "issues": [],
        "improvements_made": ["Fixed error handling"],
        "recommendations": [],
    }
    chunk.critique_result = critique_data

    # Test serialization
    chunk_dict = chunk.to_dict()
    assert "critique_result" in chunk_dict
    assert chunk_dict["critique_result"]["passes"] == True

    # Test deserialization
    chunk2 = Subtask.from_dict(chunk_dict)
    assert chunk2.critique_result is not None
    assert chunk2.critique_result["passes"] == True
    assert len(chunk2.critique_result["improvements_made"]) == 1

    print("✓ Implementation plan integration works correctly")


def test_complete_workflow():
    """Test complete critique workflow."""
    print("\nTesting complete workflow...")

    # 1. Create chunk
    chunk = {
        "id": "workflow-test",
        "description": "Test complete workflow",
        "service": "backend",
        "files_to_modify": ["app/workflow.py"],
        "patterns_from": ["app/example.py"],
    }

    # 2. Generate critique prompt
    prompt = generate_critique_prompt(chunk, ["app/workflow.py"], chunk["patterns_from"])
    assert len(prompt) > 0

    # 3. Simulate agent response
    agent_response = """
### STEP 3: Potential Issues Analysis

1. None identified

### STEP 4: Improvements Made

1. Added comprehensive error handling
2. Updated imports to match pattern files
3. Added documentation comments

### STEP 5: Final Verdict

**PROCEED:** YES
**REASON:** All quality checks passed
**CONFIDENCE:** High
"""

    # 4. Parse response
    result = parse_critique_response(agent_response)

    # 5. Check if should proceed
    can_proceed = should_proceed(result)
    assert can_proceed == True

    # 6. Format summary
    summary = format_critique_summary(result)
    assert "PASSED ✓" in summary
    assert "Subtask is ready to be marked complete" in summary

    # 7. Store in chunk
    chunk_obj = Subtask(
        id=chunk["id"],
        description=chunk["description"],
        service=chunk["service"],
        files_to_modify=chunk["files_to_modify"],
        critique_result=result.to_dict(),
    )

    # 8. Verify storage
    assert chunk_obj.critique_result is not None
    assert chunk_obj.critique_result["passes"] == True

    print("✓ Complete workflow works correctly")


def test_summary_formatting():
    """Test critique summary formatting."""
    print("\nTesting summary formatting...")

    result = CritiqueResult(
        passes=True,
        issues=[],
        improvements_made=["Fixed error handling", "Updated tests"],
        recommendations=["Consider adding more edge case tests"],
    )

    summary = format_critique_summary(result)
    assert "PASSED ✓" in summary
    assert "Fixed error handling" in summary
    assert "Subtask is ready to be marked complete" in summary

    # Test failed critique summary
    result_fail = CritiqueResult(
        passes=False,
        issues=["Missing validation", "No error handling"],
        improvements_made=[],
        recommendations=["Add input validation first"],
    )

    summary_fail = format_critique_summary(result_fail)
    assert "FAILED ✗" in summary_fail
    assert "Missing validation" in summary_fail
    assert "Subtask needs more work" in summary_fail

    print("✓ Summary formatting works correctly")


def main():
    """Run all tests."""
    print("="*70)
    print("Self-Critique System Integration Tests")
    print("="*70)

    try:
        test_critique_data_structures()
        test_critique_prompt_generation()
        test_critique_response_parsing()
        test_implementation_plan_integration()
        test_complete_workflow()
        test_summary_formatting()

        print("\n" + "="*70)
        print("All tests passed! ✓")
        print("="*70)
        print("\nSelf-Critique System is ready for use.")
        print("\nKey components:")
        print("  - critique.py: Core critique logic")
        print("  - prompts/coder.md: Updated with STEP 6.5 (mandatory critique)")
        print("  - implementation_plan.py: Subtask.critique_result field added")

    except AssertionError as e:
        print(f"\n✗ Test failed: {e}")
        return 1
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
