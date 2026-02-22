#!/usr/bin/env python3
"""
Tests for spec.pipeline.agent_runner
"""

import pytest
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

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


class TestAgentRunnerErrorHandling:
    """Tests for exception handling and stderr surfacing."""

    @pytest.mark.asyncio
    async def test_run_agent_includes_process_stderr_in_error_output(
        self, tmp_path: Path, monkeypatch
    ):
        """run_agent should include ProcessError stderr text in returned error."""
        prompt_dir = Path(__file__).parent.parent / "apps" / "backend" / "prompts"
        prompt_file = "tmp_agent_runner_stderr_prompt.md"
        prompt_path = prompt_dir / prompt_file
        prompt_path.write_text("temporary prompt", encoding="utf-8")

        runner = AgentRunner(project_dir=tmp_path, spec_dir=tmp_path, model="sonnet")

        class ProcessError(Exception):
            def __init__(self, message: str, *, exit_code: int, stderr: str):
                super().__init__(
                    f"{message} (exit code: {exit_code})\n"
                    "Error output: Check stderr output for details"
                )
                self.exit_code = exit_code
                self.stderr = stderr

        class _FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def query(self, _prompt):
                raise ProcessError(
                    "Command failed with exit code 1",
                    exit_code=1,
                    stderr="fatal: synthetic stderr for test",
                )

            async def receive_response(self):
                if False:  # pragma: no cover
                    yield

        monkeypatch.setattr(
            AgentRunner,
            "_resolve_agent_type",
            classmethod(lambda cls, prompt, phase: "spec_writer"),
        )

        with patch("core.client.create_client", return_value=_FakeClient()):
            success, output = await runner.run_agent(prompt_file, phase_name="quick_spec")

        try:
            assert success is False
            assert "ProcessError:" in output
            assert "--- STDERR START ---" in output
            assert "fatal: synthetic stderr for test" in output
            assert "--- STDERR END ---" in output
            assert "[prompt=tmp_agent_runner_stderr_prompt.md]" in output
            assert "[phase=quick_spec]" in output
        finally:
            prompt_path.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_run_agent_uses_captured_cli_stderr_when_process_error_stderr_is_placeholder(
        self, tmp_path: Path, monkeypatch
    ):
        """run_agent should include captured CLI stderr when ProcessError stderr is generic."""
        prompt_dir = Path(__file__).parent.parent / "apps" / "backend" / "prompts"
        prompt_file = "tmp_agent_runner_stderr_capture_prompt.md"
        prompt_path = prompt_dir / prompt_file
        prompt_path.write_text("temporary prompt", encoding="utf-8")

        runner = AgentRunner(project_dir=tmp_path, spec_dir=tmp_path, model="sonnet")

        class ProcessError(Exception):
            def __init__(self, message: str, *, exit_code: int, stderr: str):
                super().__init__(
                    f"{message} (exit code: {exit_code})\n"
                    "Error output: Check stderr output for details"
                )
                self.exit_code = exit_code
                self.stderr = stderr

        def _fake_create_client(*args, **kwargs):
            stderr_cb = kwargs["stderr_callback"]
            stderr_cb("fatal: synthetic stderr line 1")
            stderr_cb("fatal: synthetic stderr line 2")

            class _FakeClient:
                async def __aenter__(self):
                    return self

                async def __aexit__(self, exc_type, exc, tb):
                    return False

                async def query(self, _prompt):
                    raise ProcessError(
                        "Command failed with exit code 1",
                        exit_code=1,
                        stderr="Check stderr output for details",
                    )

                async def receive_response(self):
                    if False:  # pragma: no cover
                        yield

            return _FakeClient()

        monkeypatch.setattr(
            AgentRunner,
            "_resolve_agent_type",
            classmethod(lambda cls, prompt, phase: "spec_writer"),
        )

        with patch("core.client.create_client", side_effect=_fake_create_client):
            success, output = await runner.run_agent(prompt_file, phase_name="quick_spec")

        try:
            assert success is False
            assert "ProcessError:" in output
            assert "--- STDERR START ---" in output
            assert "fatal: synthetic stderr line 1" in output
            assert "fatal: synthetic stderr line 2" in output
            assert "--- STDERR END ---" in output
            assert "[prompt=tmp_agent_runner_stderr_capture_prompt.md]" in output
            assert "[phase=quick_spec]" in output
        finally:
            prompt_path.unlink(missing_ok=True)
