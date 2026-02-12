"""
Unit tests for GitLab prompt_manager.py

Tests the PromptManager class which handles:
- Loading prompt templates from files
- Providing default prompts when files don't exist
- Managing prompts for different workflow stages
"""

from pathlib import Path
from unittest.mock import mock_open, patch

import pytest
from runners.gitlab.models import ReviewPass
from runners.gitlab.services.prompt_manager import PromptManager


class TestPromptManager:
    """Tests for PromptManager class."""

    @pytest.fixture
    def prompts_dir(self, tmp_path):
        """Create a temporary prompts directory."""
        prompts_dir = tmp_path / "prompts" / "gitlab"
        prompts_dir.mkdir(parents=True)
        return prompts_dir

    @pytest.fixture
    def manager(self, prompts_dir):
        """Create a PromptManager with temp directory."""
        return PromptManager(prompts_dir=prompts_dir)

    @pytest.fixture
    def manager_with_prompts(self, prompts_dir):
        """Create a PromptManager with sample prompts."""
        # Create MR review prompt
        mr_prompt = prompts_dir / "mr_reviewer.md"
        mr_prompt.write_text(
            "# Custom MR Review Prompt\n\nThis is a custom prompt.", encoding="utf-8"
        )

        # Create followup prompt
        followup_prompt = prompts_dir / "mr_followup.md"
        followup_prompt.write_text(
            "# Custom Followup Prompt\n\nThis is a followup prompt.", encoding="utf-8"
        )

        # Create triage prompt
        triage_prompt = prompts_dir / "issue_triager.md"
        triage_prompt.write_text(
            "# Custom Triage Prompt\n\nThis is a triage prompt.", encoding="utf-8"
        )

        return PromptManager(prompts_dir=prompts_dir)

    def test_init_default_prompts_dir(self):
        """Test initialization with default prompts directory."""
        manager = PromptManager()

        # Should point to prompts/gitlab relative to the module
        assert "prompts" in str(manager.prompts_dir)
        assert "gitlab" in str(manager.prompts_dir)

    def test_init_custom_prompts_dir(self, prompts_dir):
        """Test initialization with custom prompts directory."""
        manager = PromptManager(prompts_dir=prompts_dir)

        assert manager.prompts_dir == prompts_dir

    def test_get_mr_review_prompt_from_file(self, manager_with_prompts):
        """Test loading MR review prompt from file."""
        prompt = manager_with_prompts.get_mr_review_prompt()

        assert "Custom MR Review Prompt" in prompt
        assert "This is a custom prompt." in prompt

    def test_get_mr_review_prompt_default(self, manager):
        """Test default MR review prompt when file doesn't exist."""
        prompt = manager.get_mr_review_prompt()

        assert "MR Review Agent" in prompt
        assert "Security Issues" in prompt
        assert "Code Quality" in prompt
        assert "JSON" in prompt

    def test_get_followup_review_prompt_from_file(self, manager_with_prompts):
        """Test loading followup review prompt from file."""
        prompt = manager_with_prompts.get_followup_review_prompt()

        assert "Custom Followup Prompt" in prompt

    def test_get_followup_review_prompt_default(self, manager):
        """Test default followup review prompt when file doesn't exist."""
        prompt = manager.get_followup_review_prompt()

        assert "Follow-up Review" in prompt
        assert "RESOLVED" in prompt
        assert "UNRESOLVED" in prompt
        assert "READY_TO_MERGE" in prompt

    def test_get_triage_prompt_from_file(self, manager_with_prompts):
        """Test loading triage prompt from file."""
        prompt = manager_with_prompts.get_triage_prompt()

        assert "Custom Triage Prompt" in prompt

    def test_get_triage_prompt_default(self, manager):
        """Test default triage prompt when file doesn't exist."""
        prompt = manager.get_triage_prompt()

        assert "Issue Triage" in prompt
        assert "category" in prompt.lower()
        assert "priority" in prompt.lower()
        assert "duplicate" in prompt.lower()

    def test_get_review_pass_prompt_quick_scan(self, manager):
        """Test getting quick scan review pass prompt."""
        # Falls back to default MR review prompt
        prompt = manager.get_review_pass_prompt(ReviewPass.QUICK_SCAN)

        assert "MR Review Agent" in prompt

    def test_get_review_pass_prompt_security(self, manager):
        """Test getting security review pass prompt."""
        prompt = manager.get_review_pass_prompt(ReviewPass.SECURITY)

        assert "MR Review Agent" in prompt

    def test_get_review_pass_prompt_deep_analysis(self, manager):
        """Test getting deep analysis review pass prompt."""
        prompt = manager.get_review_pass_prompt(ReviewPass.DEEP_ANALYSIS)

        assert "MR Review Agent" in prompt

    def test_get_review_pass_prompt_from_file(self, prompts_dir):
        """Test loading pass-specific prompt from file."""
        # Create pass-specific prompt file
        pass_prompt = prompts_dir / "review_pass_quick_scan.md"
        pass_prompt.write_text(
            "# Quick Scan Prompt\n\nQuick review instructions.", encoding="utf-8"
        )

        manager = PromptManager(prompts_dir=prompts_dir)
        prompt = manager.get_review_pass_prompt(ReviewPass.QUICK_SCAN)

        assert "Quick Scan Prompt" in prompt

    def test_get_review_pass_prompt_file_read_error(self, prompts_dir):
        """Test handling of file read errors."""
        # Create a file that will cause read error
        pass_prompt = prompts_dir / "review_pass_quick_scan.md"
        pass_prompt.write_text("Test", encoding="utf-8")

        manager = PromptManager(prompts_dir=prompts_dir)

        with patch.object(Path, "read_text", side_effect=OSError("Read error")):
            # Should fall back to default
            prompt = manager.get_review_pass_prompt(ReviewPass.QUICK_SCAN)

            assert "MR Review Agent" in prompt


class TestPromptManagerDefaultPrompts:
    """Tests for default prompt content."""

    @pytest.fixture
    def manager(self, tmp_path):
        """Create a PromptManager with empty directory."""
        return PromptManager(prompts_dir=tmp_path)

    def test_default_mr_review_prompt_structure(self, manager):
        """Test structure of default MR review prompt."""
        prompt = manager._get_default_mr_review_prompt()

        # Should have sections
        assert "Security Issues" in prompt
        assert "Code Quality" in prompt
        assert "Style Issues" in prompt
        assert "Test Coverage" in prompt
        assert "Documentation" in prompt

        # Should have JSON structure
        assert '"id"' in prompt
        assert '"severity"' in prompt
        assert '"category"' in prompt
        assert '"title"' in prompt
        assert '"description"' in prompt

    def test_default_mr_review_prompt_severity_values(self, manager):
        """Test that severity values are present in prompt."""
        prompt = manager._get_default_mr_review_prompt()

        assert "critical" in prompt
        assert "high" in prompt
        assert "medium" in prompt
        assert "low" in prompt

    def test_default_mr_review_prompt_categories(self, manager):
        """Test that category values are present in prompt."""
        prompt = manager._get_default_mr_review_prompt()

        assert "security" in prompt
        assert "quality" in prompt
        assert "style" in prompt
        assert "test" in prompt
        assert "docs" in prompt

    def test_default_followup_prompt_structure(self, manager):
        """Test structure of default followup prompt."""
        prompt = manager._get_default_followup_review_prompt()

        assert "finding_resolutions" in prompt
        assert "new_findings" in prompt
        assert "verdict" in prompt
        assert "verdict_reasoning" in prompt

    def test_default_followup_prompt_verdict_values(self, manager):
        """Test that verdict values are present in prompt."""
        prompt = manager._get_default_followup_review_prompt()

        assert "READY_TO_MERGE" in prompt
        assert "MERGE_WITH_CHANGES" in prompt
        assert "NEEDS_REVISION" in prompt
        assert "BLOCKED" in prompt

    def test_default_triage_prompt_structure(self, manager):
        """Test structure of default triage prompt."""
        prompt = manager._get_default_triage_prompt()

        assert "Category" in prompt
        assert "Priority" in prompt
        assert "Is Duplicate" in prompt
        assert "Is Spam" in prompt

    def test_default_triage_prompt_category_values(self, manager):
        """Test that category values are present in triage prompt."""
        prompt = manager._get_default_triage_prompt()

        assert "bug" in prompt
        assert "feature" in prompt
        assert "question" in prompt
        assert "duplicate" in prompt
        assert "spam" in prompt

    def test_default_triage_prompt_iid_note(self, manager):
        """Test that triage prompt notes about issue iid."""
        prompt = manager._get_default_triage_prompt()

        # Should mention iid for duplicates
        assert "iid" in prompt


class TestPromptManagerFileHandling:
    """Tests for file handling in PromptManager."""

    def test_nonexistent_prompts_dir(self, tmp_path):
        """Test handling of nonexistent prompts directory."""
        nonexistent = tmp_path / "nonexistent"
        manager = PromptManager(prompts_dir=nonexistent)

        # Should still work with default prompts
        prompt = manager.get_mr_review_prompt()
        assert "MR Review Agent" in prompt

    def test_prompts_dir_is_file(self, tmp_path):
        """Test handling when prompts path is a file."""
        file_path = tmp_path / "prompts"
        file_path.write_text("not a directory", encoding="utf-8")

        manager = PromptManager(prompts_dir=file_path)

        # Should still work with default prompts
        prompt = manager.get_mr_review_prompt()
        assert "MR Review Agent" in prompt
