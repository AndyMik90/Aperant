"""
Test Claude Agent SDK Structured Output functionality.

This test verifies how structured outputs work with the SDK.
"""

import asyncio
import os
import sys
from pathlib import Path
from pprint import pprint

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

# Add pydantic_models path
_pydantic_models_path = (
    Path(__file__).parent.parent
    / "apps"
    / "backend"
    / "runners"
    / "github"
    / "services"
)
sys.path.insert(0, str(_pydantic_models_path))

from typing import Literal

from pydantic import BaseModel, Field


# Simple test model
class SimpleReviewResponse(BaseModel):
    """A simple review response for testing."""

    verdict: Literal["PASS", "FAIL"] = Field(description="Review verdict")
    reason: str = Field(description="Reason for the verdict")
    score: int = Field(ge=0, le=100, description="Score from 0-100")


async def test_structured_output():
    """Test the SDK's structured output functionality."""

    # OAuth token must be set in environment (CLAUDE_CODE_OAUTH_TOKEN)
    if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        print("ERROR: CLAUDE_CODE_OAUTH_TOKEN environment variable not set")
        return

    from claude_agent_sdk import ClaudeAgentOptions, query

    # Generate JSON schema from Pydantic model
    schema = SimpleReviewResponse.model_json_schema()
    print("=== Schema ===")
    pprint(schema)
    print()

    prompt = """
Review this code and provide your assessment:

```python
def add(a, b):
    return a + b
```

Provide a verdict (PASS or FAIL), reason, and score.
"""

    print("=== Running query with output_format ===")
    print(f"Prompt: {prompt[:100]}...")
    print()

    message_count = 0
    async for message in query(
        prompt=prompt,
        options=ClaudeAgentOptions(
            model="claude-sonnet-4-5-20250929",
            system_prompt="You are a code reviewer. Provide structured feedback.",
            allowed_tools=[],
            max_turns=2,  # Need 2 turns for structured output tool call
            output_format={
                "type": "json_schema",
                "schema": schema,
            },
        ),
    ):
        message_count += 1
        msg_type = type(message).__name__
        print(f"\n=== Message {message_count}: {msg_type} ===")

        # Print all non-private attributes
        for attr in dir(message):
            if not attr.startswith("_"):
                try:
                    val = getattr(message, attr)
                    if not callable(val):
                        # Truncate long values
                        val_str = str(val)
                        if len(val_str) > 500:
                            val_str = val_str[:500] + "..."
                        print(f"  {attr}: {val_str}")
                except Exception as e:
                    print(f"  {attr}: <error: {e}>")

        # Check for StructuredOutput tool use in AssistantMessage
        if msg_type == "AssistantMessage":
            content = getattr(message, "content", [])
            for block in content:
                block_type = type(block).__name__
                if block_type == "ToolUseBlock":
                    tool_name = getattr(block, "name", "")
                    if tool_name == "StructuredOutput":
                        structured_data = getattr(block, "input", None)
                        print(f"\n  🎯 Found StructuredOutput tool use!")
                        print(f"     Data: {structured_data}")
                        if structured_data:
                            try:
                                validated = SimpleReviewResponse.model_validate(structured_data)
                                print(f"\n  ✅ Successfully validated StructuredOutput!")
                                print(f"     verdict: {validated.verdict}")
                                print(f"     reason: {validated.reason}")
                                print(f"     score: {validated.score}")
                            except Exception as e:
                                print(f"\n  ❌ Failed to validate: {e}")

        # Special handling for ResultMessage
        if msg_type == "ResultMessage":
            print("\n  --- ResultMessage Details ---")

            # Check structured_output
            so = getattr(message, "structured_output", None)
            print(f"  structured_output value: {so}")
            print(f"  structured_output type: {type(so)}")

            # Check result
            result = getattr(message, "result", None)
            print(f"  result value: {result}")
            print(f"  result type: {type(result)}")

            # If result is a string, try to parse as JSON
            if isinstance(result, str):
                import json
                try:
                    parsed = json.loads(result)
                    print(f"  result parsed as JSON: {parsed}")
                except:
                    print(f"  result is not JSON")

            # Try to validate with Pydantic if we got data
            if so:
                try:
                    validated = SimpleReviewResponse.model_validate(so)
                    print(f"\n  ✅ Successfully validated structured_output!")
                    print(f"     verdict: {validated.verdict}")
                    print(f"     reason: {validated.reason}")
                    print(f"     score: {validated.score}")
                except Exception as e:
                    print(f"\n  ❌ Failed to validate structured_output: {e}")

            if result and isinstance(result, (dict, str)):
                try:
                    data = result if isinstance(result, dict) else json.loads(result)
                    validated = SimpleReviewResponse.model_validate(data)
                    print(f"\n  ✅ Successfully validated result as structured output!")
                    print(f"     verdict: {validated.verdict}")
                    print(f"     reason: {validated.reason}")
                    print(f"     score: {validated.score}")
                except Exception as e:
                    print(f"\n  ❌ Failed to validate result: {e}")

    print(f"\n=== Total messages: {message_count} ===")


if __name__ == "__main__":
    asyncio.run(test_structured_output())
