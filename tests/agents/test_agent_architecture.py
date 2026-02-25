#!/usr/bin/env python3
"""
Tests for Agent Architecture
============================

Verifies the agent architecture where:
- Python orchestrator runs a single Claude SDK session
- The agent itself decides when to spawn subagents (via Task tool)
- Parallel execution is handled internally by Claude Code, not Python

Key architectural constraints:
- No Python-level parallel orchestration (no coordinator.py, task_tool.py)
- No --parallel CLI flag (agent decides parallelism)
- Agent prompt includes subagent capability documentation
"""

import ast
import inspect
import sys
from pathlib import Path

import pytest

# Add apps/backend directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "apps" / "backend"))


class TestNoExternalParallelism:
    """Verify no Python-level parallel orchestration exists."""

    def test_no_coordinator_module(self):
        """No external coordinator module should exist."""
        coordinator_path = (
            Path(__file__).parent.parent.parent / "apps" / "backend" / "coordinator.py"
        )
        assert not coordinator_path.exists(), (
            "coordinator.py should not exist. Parallel orchestration is handled "
            "internally by the agent using Claude Code's Task tool."
        )

    def test_no_task_tool_module(self):
        """No task_tool wrapper module should exist."""
        task_tool_path = (
            Path(__file__).parent.parent.parent / "apps" / "backend" / "task_tool.py"
        )
        assert not task_tool_path.exists(), (
            "task_tool.py should not exist. The agent spawns subagents directly "
            "using Claude Code's built-in Task tool."
        )

    def test_no_subtask_worker_config(self):
        """No external subtask worker agent config should exist."""
        worker_config = (
            Path(__file__).parent.parent.parent / ".claude" / "agents" / "subtask-worker.md"
        )
        assert not worker_config.exists(), (
            "subtask-worker.md should not exist. Subagents use Claude Code's "
            "built-in agent types, not custom configs."
        )


class TestCLIInterface:
    """Verify CLI doesn't expose parallel orchestration options."""

    def test_no_parallel_flag(self):
        """CLI should not have --parallel argument."""
        run_py_path = Path(__file__).parent.parent.parent / "apps" / "backend" / "run.py"
        content = run_py_path.read_text(encoding="utf-8")

        # Check that --parallel is not defined as an argument
        assert '"--parallel"' not in content, (
            "CLI should not have --parallel flag. The agent decides when to "
            "use parallel execution via subagents."
        )
        assert "'--parallel'" not in content, (
            "CLI should not have --parallel flag. The agent decides when to "
            "use parallel execution via subagents."
        )

    def test_no_parallel_examples_in_docs(self):
        """CLI documentation should not mention parallel mode."""
        run_py_path = Path(__file__).parent.parent.parent / "apps" / "backend" / "run.py"
        content = run_py_path.read_text(encoding="utf-8")

        # The docstring should not have --parallel examples
        assert "--parallel" not in content[:2000], (
            "CLI docs should not contain --parallel examples."
        )


class TestAgentEntryPoint:
    """Verify the agent entry point function signature."""

    def test_no_parallel_parameters(self):
        """Agent entry point should not accept parallel configuration."""
        from agent import run_autonomous_agent

        sig = inspect.signature(run_autonomous_agent)
        param_names = list(sig.parameters.keys())

        assert "max_parallel_subtasks" not in param_names, (
            "Agent should not accept max_parallel_subtasks. "
            "Parallelism is decided by the agent itself."
        )
        assert "parallel" not in param_names, (
            "Agent should not accept a 'parallel' parameter."
        )

    def test_required_parameters(self):
        """Agent entry point has required parameters."""
        from agent import run_autonomous_agent

        sig = inspect.signature(run_autonomous_agent)
        param_names = list(sig.parameters.keys())

        expected = ["project_dir", "spec_dir", "model"]
        for param in expected:
            assert param in param_names, f"Expected parameter '{param}' not found"

    def test_is_async(self):
        """Agent entry point is async."""
        from agent import run_autonomous_agent

        assert inspect.iscoroutinefunction(run_autonomous_agent), (
            "run_autonomous_agent should be async"
        )


class TestAgentPrompt:
    """Verify the agent prompt documents subagent capability."""

    def test_mentions_subagents(self):
        """Agent prompt mentions subagent capability."""
        coder_prompt_path = (
            Path(__file__).parent.parent.parent / "apps" / "backend" / "prompts" / "coder.md"
        )
        content = coder_prompt_path.read_text(encoding="utf-8")

        assert "subagent" in content.lower(), (
            "Agent prompt should document subagent capability for parallel work."
        )

    def test_mentions_parallel_capability(self):
        """Agent prompt mentions parallel/concurrent capability."""
        coder_prompt_path = (
            Path(__file__).parent.parent.parent / "apps" / "backend" / "prompts" / "coder.md"
        )
        content = coder_prompt_path.read_text(encoding="utf-8")

        has_task_tool = "task tool" in content.lower() or "Task tool" in content
        has_parallel = "parallel" in content.lower()
        has_concurrent = (
            "concurrent" in content.lower() or "simultaneously" in content.lower()
        )

        assert has_task_tool or has_parallel or has_concurrent, (
            "Agent prompt should mention parallel/concurrent work capability."
        )


class TestModuleIntegrity:
    """Verify core modules work correctly."""

    def test_agent_module_imports(self):
        """Agent module imports without errors."""
        try:
            import agent
        except ImportError as e:
            pytest.fail(f"agent.py failed to import: {e}")

    def test_run_module_valid_syntax(self):
        """Run module has valid Python syntax."""
        run_py_path = Path(__file__).parent.parent.parent / "apps" / "backend" / "run.py"
        content = run_py_path.read_text(encoding="utf-8")

        try:
            ast.parse(content)
        except SyntaxError as e:
            pytest.fail(f"run.py has syntax error: {e}")

    def test_no_coordinator_imports(self):
        """Core modules don't import coordinator."""
        for filename in ["run.py", "core/agent.py"]:
            filepath = Path(__file__).parent.parent.parent / "apps" / "backend" / filename
            content = filepath.read_text(encoding="utf-8")

            assert "from coordinator import" not in content, (
                f"{filename} should not import coordinator"
            )
            assert "import coordinator" not in content, (
                f"{filename} should not import coordinator"
            )

    def test_no_task_tool_imports(self):
        """Core modules don't import task_tool."""
        for filename in ["run.py", "core/agent.py"]:
            filepath = Path(__file__).parent.parent.parent / "apps" / "backend" / filename
            content = filepath.read_text(encoding="utf-8")

            assert "from task_tool import" not in content, (
                f"{filename} should not import task_tool"
            )
            assert "import task_tool" not in content, (
                f"{filename} should not import task_tool"
            )


class TestProjectDocumentation:
    """Verify project documentation is accurate."""

    def test_no_parallel_cli_documented(self):
        """CLAUDE.md doesn't document --parallel flag."""
        claude_md_path = Path(__file__).parent.parent.parent / "CLAUDE.md"
        content = claude_md_path.read_text(encoding="utf-8")

        assert "--parallel 2" not in content, (
            "CLAUDE.md should not document --parallel flag"
        )

    def test_subagent_architecture_documented(self):
        """CLAUDE.md documents subagent-based architecture."""
        claude_md_path = Path(__file__).parent.parent.parent / "CLAUDE.md"
        content = claude_md_path.read_text(encoding="utf-8")

        has_subagent = "subagent" in content.lower()
        has_task_tool = "task tool" in content.lower()

        assert has_subagent or has_task_tool, (
            "CLAUDE.md should document subagent-based parallel work"
        )


class TestElectronToolScoping:
    """Verify Electron MCP tools are scoped to QA agents only."""

    def test_qa_reviewer_has_electron_tools_when_enabled(self, monkeypatch):
        """QA reviewer gets Electron tools when ELECTRON_MCP_ENABLED=true and project is Electron."""
        monkeypatch.setenv("ELECTRON_MCP_ENABLED", "true")

        # Re-import to pick up env change
        from auto_claude_tools import ELECTRON_TOOLS, get_allowed_tools

        # Must pass is_electron=True for Electron tools to be included
        # This is the new phase-aware behavior
        qa_tools = get_allowed_tools(
            "qa_reviewer", project_capabilities={"is_electron": True}
        )

        # At least one Electron tool should be present
        has_electron = any("electron" in tool.lower() for tool in qa_tools)
        assert has_electron, (
            "QA reviewer should have Electron tools when ELECTRON_MCP_ENABLED=true and is_electron=True. "
            f"Got tools: {qa_tools}"
        )

        # Verify specific tools are included
        for tool in ELECTRON_TOOLS:
            assert tool in qa_tools, f"Expected {tool} in qa_reviewer tools"

    def test_qa_fixer_has_electron_tools_when_enabled(self, monkeypatch):
        """QA fixer gets Electron tools when ELECTRON_MCP_ENABLED=true and project is Electron."""
        monkeypatch.setenv("ELECTRON_MCP_ENABLED", "true")

        from auto_claude_tools import ELECTRON_TOOLS, get_allowed_tools

        # Must pass is_electron=True for Electron tools to be included
        qa_fixer_tools = get_allowed_tools(
            "qa_fixer", project_capabilities={"is_electron": True}
        )

        has_electron = any("electron" in tool.lower() for tool in qa_fixer_tools)
        assert has_electron, (
            "QA fixer should have Electron tools when ELECTRON_MCP_ENABLED=true and is_electron=True. "
            f"Got tools: {qa_fixer_tools}"
        )

        for tool in ELECTRON_TOOLS:
            assert tool in qa_fixer_tools, f"Expected {tool} in qa_fixer tools"

    def test_coder_no_electron_tools(self, monkeypatch):
        """Coder should NOT get Electron tools even when enabled and project is Electron."""
        monkeypatch.setenv("ELECTRON_MCP_ENABLED", "true")

        from auto_claude_tools import get_allowed_tools

        # Even with is_electron=True, coder should not get Electron tools
        coder_tools = get_allowed_tools(
            "coder", project_capabilities={"is_electron": True}
        )

        has_electron = any("electron" in tool.lower() for tool in coder_tools)
        assert not has_electron, (
            "Coder should NOT have Electron tools - they are scoped to QA agents only. "
            "This prevents context token bloat for agents that don't need desktop automation."
        )

    def test_planner_no_electron_tools(self, monkeypatch):
        """Planner should NOT get Electron tools even when enabled and project is Electron."""
        monkeypatch.setenv("ELECTRON_MCP_ENABLED", "true")

        from auto_claude_tools import get_allowed_tools

        # Even with is_electron=True, planner should not get Electron tools
        planner_tools = get_allowed_tools(
            "planner", project_capabilities={"is_electron": True}
        )

        has_electron = any("electron" in tool.lower() for tool in planner_tools)
        assert not has_electron, (
            "Planner should NOT have Electron tools - they are scoped to QA agents only. "
            "This prevents context token bloat for agents that don't need desktop automation."
        )

    def test_no_electron_tools_when_disabled(self, monkeypatch):
        """No agent gets Electron tools when ELECTRON_MCP_ENABLED is not set."""
        monkeypatch.delenv("ELECTRON_MCP_ENABLED", raising=False)

        from auto_claude_tools import get_allowed_tools

        for agent_type in ["planner", "coder", "qa_reviewer", "qa_fixer"]:
            # Even with is_electron=True, no tools without env var
            tools = get_allowed_tools(
                agent_type, project_capabilities={"is_electron": True}
            )
            has_electron = any("electron" in tool.lower() for tool in tools)
            assert not has_electron, (
                f"{agent_type} should NOT have Electron tools when ELECTRON_MCP_ENABLED is not set"
            )


class TestSubtaskTerminology:
    """Verify subtask terminology is used consistently."""

    def test_progress_uses_subtask_terminology(self):
        """Progress module uses subtask terminology."""
        progress_path = (
            Path(__file__).parent.parent.parent / "apps" / "backend" / "core" / "progress.py"
        )
        content = progress_path.read_text(encoding="utf-8")

        assert "subtask" in content.lower(), (
            "core/progress.py should use subtask terminology"
        )


def run_tests():
    """Run all tests when executed directly."""
    print("\nTesting Agent Architecture")
    print("=" * 60)

    test_classes = [
        TestNoExternalParallelism,
        TestCLIInterface,
        TestAgentEntryPoint,
        TestAgentPrompt,
        TestModuleIntegrity,
        TestProjectDocumentation,
        TestElectronToolScoping,  # Note: requires pytest (uses monkeypatch)
        TestSubtaskTerminology,
    ]

    passed = 0
    failed = 0

    for test_class in test_classes:
        print(f"\n{test_class.__name__}:")
        instance = test_class()

        for method_name in dir(instance):
            if method_name.startswith("test_"):
                method = getattr(instance, method_name)
                try:
                    method()
                    print(f"  ✓ {method_name}")
                    passed += 1
                except AssertionError as e:
                    print(f"  ✗ {method_name}: {e}")
                    failed += 1
                except Exception as e:
                    print(f"  ✗ {method_name}: Unexpected error: {e}")
                    failed += 1

    print("\n" + "=" * 60)
    print(f"Results: {passed} passed, {failed} failed")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(run_tests())
