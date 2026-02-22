#!/usr/bin/env python3
"""
Tests for spec.pipeline.agent_runner
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock

# Add auto-claude backend to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from spec.pipeline.agent_runner import AgentRunner


class TestAgentRunnerResolveAgentType:
    """Tests for AgentRunner._resolve_agent_type."""

    @pytest.mark.parametrize(
        "prompt_file,phase_name,expected",
        [
            ("spec_quick.md", None, "spec_writer"),
            ("unknown.md", "quick_spec", "spec_writer"),
            ("unknown.md", "planning", "planner"),
            ("unknown.md", "validation", "spec_validation"),
            ("unknown.md", "historical_context", "spec_gatherer"),
            ("unknown.md", None, "spec_writer"),
        ],
    )
    def test_resolve_agent_type(self, prompt_file: str, phase_name: str | None, expected: str):
        """Resolves agent type by prompt first, then phase, then default."""
        assert AgentRunner._resolve_agent_type(prompt_file, phase_name) == expected


class TestAgentRunnerUnknownAgent:
    """Tests behavior for unknown resolved agent type."""

    @pytest.mark.asyncio
    async def test_run_agent_returns_error_on_unknown_agent_type(self, tmp_path: Path, monkeypatch):
        """run_agent should fail early when resolved agent type is not configured."""
        prompt_dir = Path(__file__).parent.parent / "apps" / "backend" / "prompts"
        prompt_file = "tmp_agent_runner_test_prompt.md"
        prompt_path = prompt_dir / prompt_file
        prompt_path.write_text("temporary prompt", encoding="utf-8")

        runner = AgentRunner(project_dir=tmp_path, spec_dir=tmp_path, model="sonnet")

        monkeypatch.setattr(
            AgentRunner,
            "_resolve_agent_type",
            classmethod(lambda cls, prompt, phase: "not_a_real_agent"),
        )

        try:
            success, output = await runner.run_agent(prompt_file, phase_name="quick_spec")
            assert success is False
            assert "Unknown spec agent type 'not_a_real_agent'" in output
            assert prompt_file in output
            assert "phase: quick_spec" in output
        finally:
            prompt_path.unlink(missing_ok=True)
