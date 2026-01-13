"""
Tests for Agent Memory Manager
==============================

Tests for agents/memory_manager.py which handles session memory storage
using dual-layer approach:
- PRIMARY: Graphiti (when enabled) - semantic search, cross-session context
- FALLBACK: File-based memory - zero dependencies, always available
"""

import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch


class TestDebugMemorySystemStatus:
    """Tests for debug_memory_system_status function."""

    def test_skips_when_debug_disabled(self, capsys):
        """Should not print anything when DEBUG is not enabled."""
        from agents.memory_manager import debug_memory_system_status

        with patch("agents.memory_manager.is_debug_enabled", return_value=False):
            debug_memory_system_status()

        captured = capsys.readouterr()
        assert captured.out == ""

    def test_prints_status_when_debug_enabled(self, capsys):
        """Should print memory system status when DEBUG is enabled."""
        from agents.memory_manager import debug_memory_system_status

        mock_status = {
            "enabled": True,
            "available": True,
            "host": "localhost",
            "port": 5432,
            "database": "graphiti",
            "llm_provider": "openai",
            "embedder_provider": "openai",
        }

        with patch("agents.memory_manager.is_debug_enabled", return_value=True):
            with patch("agents.memory_manager.get_graphiti_status", return_value=mock_status):
                with patch("agents.memory_manager.debug_section"):
                    with patch("agents.memory_manager.debug"):
                        with patch("agents.memory_manager.debug_detailed"):
                            with patch("agents.memory_manager.debug_success"):
                                debug_memory_system_status()


class TestGetGraphitiContext:
    """Tests for get_graphiti_context function."""

    @pytest.mark.asyncio
    async def test_returns_none_when_graphiti_disabled(self, temp_dir):
        """Should return None when Graphiti is not enabled."""
        from agents.memory_manager import get_graphiti_context

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()
        project_dir = temp_dir / "project"
        project_dir.mkdir()

        with patch("agents.memory_manager.is_graphiti_enabled", return_value=False):
            result = await get_graphiti_context(
                spec_dir,
                project_dir,
                {"id": "subtask-1", "description": "Test subtask"},
            )

        assert result is None


class TestSaveSessionMemory:
    """Tests for save_session_memory function."""

    @pytest.mark.asyncio
    async def test_falls_back_to_file_when_graphiti_disabled(self, temp_dir):
        """Should save to file-based memory when Graphiti is disabled."""
        from agents.memory_manager import save_session_memory

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()
        project_dir = temp_dir / "project"
        project_dir.mkdir()

        with patch("agents.memory_manager.is_graphiti_enabled", return_value=False):
            with patch("agents.memory_manager.save_file_based_memory") as mock_file_save:
                with patch("agents.memory_manager.is_debug_enabled", return_value=False):
                    success, storage_type = await save_session_memory(
                        spec_dir=spec_dir,
                        project_dir=project_dir,
                        subtask_id="subtask-1",
                        session_num=1,
                        success=True,
                        subtasks_completed=["subtask-1"],
                    )

        assert success is True
        assert storage_type == "file"
        mock_file_save.assert_called_once()

    @pytest.mark.asyncio
    async def test_returns_none_when_both_fail(self, temp_dir):
        """Should return (False, 'none') when both storage methods fail."""
        from agents.memory_manager import save_session_memory

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()
        project_dir = temp_dir / "project"
        project_dir.mkdir()

        with patch("agents.memory_manager.is_graphiti_enabled", return_value=False):
            with patch("agents.memory_manager.save_file_based_memory", side_effect=Exception("File error")):
                with patch("agents.memory_manager.is_debug_enabled", return_value=False):
                    success, storage_type = await save_session_memory(
                        spec_dir=spec_dir,
                        project_dir=project_dir,
                        subtask_id="subtask-1",
                        session_num=1,
                        success=True,
                        subtasks_completed=["subtask-1"],
                    )

        assert success is False
        assert storage_type == "none"

    @pytest.mark.asyncio
    async def test_builds_correct_insights_structure(self, temp_dir):
        """Should build correct insights structure for both success and failure."""
        from agents.memory_manager import save_session_memory

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()
        project_dir = temp_dir / "project"
        project_dir.mkdir()

        captured_insights = None

        def capture_insights(spec, session, insights):
            nonlocal captured_insights
            captured_insights = insights

        with patch("agents.memory_manager.is_graphiti_enabled", return_value=False):
            with patch("agents.memory_manager.save_file_based_memory", side_effect=capture_insights):
                with patch("agents.memory_manager.is_debug_enabled", return_value=False):
                    # Test successful session
                    await save_session_memory(
                        spec_dir=spec_dir,
                        project_dir=project_dir,
                        subtask_id="subtask-1",
                        session_num=1,
                        success=True,
                        subtasks_completed=["subtask-1"],
                    )

        assert captured_insights is not None
        assert "subtask-1" in captured_insights["subtasks_completed"]
        assert "Implemented subtask: subtask-1" in captured_insights["what_worked"]
        assert captured_insights["what_failed"] == []


class TestSaveSessionToGraphiti:
    """Tests for the backwards-compatible save_session_to_graphiti wrapper."""

    @pytest.mark.asyncio
    async def test_wrapper_calls_save_session_memory(self, temp_dir):
        """Should delegate to save_session_memory and return only success boolean."""
        from agents.memory_manager import save_session_to_graphiti

        spec_dir = temp_dir / "spec"
        spec_dir.mkdir()
        project_dir = temp_dir / "project"
        project_dir.mkdir()

        with patch("agents.memory_manager.is_graphiti_enabled", return_value=False):
            with patch("agents.memory_manager.save_file_based_memory"):
                with patch("agents.memory_manager.is_debug_enabled", return_value=False):
                    result = await save_session_to_graphiti(
                        spec_dir=spec_dir,
                        project_dir=project_dir,
                        subtask_id="subtask-1",
                        session_num=1,
                        success=True,
                        subtasks_completed=["subtask-1"],
                    )

        assert isinstance(result, bool)
        assert result is True
