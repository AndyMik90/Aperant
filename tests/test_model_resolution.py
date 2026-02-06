#!/usr/bin/env python3
"""
Tests for Model Resolution
===========================

Tests the model resolution functionality including:
- resolve_model_id() function from phase_config
- Environment variable overrides
- Model shorthand to full ID mapping
- Default model values in GitHub runner services

This ensures custom model configurations (e.g., ANTHROPIC_DEFAULT_SONNET_MODEL)
are properly respected instead of falling back to hardcoded values.

Note: Some tests use source code inspection to avoid complex import dependencies
while still verifying the critical implementation patterns that prevent regression
of the hardcoded fallback bug (ACS-294).
"""

import os
import sys
from collections.abc import Generator
from pathlib import Path
from unittest.mock import patch

import pytest

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from phase_config import MODEL_ID_MAP, resolve_model_id

# Common paths - extracted to avoid duplication and ease maintenance
GITHUB_RUNNER_DIR = (
    Path(__file__).parent.parent / "apps" / "backend" / "runners" / "github"
)
GITHUB_RUNNER_SERVICES_DIR = GITHUB_RUNNER_DIR / "services"


@pytest.fixture
def models_file() -> Path:
    """Path to models.py in GitHub runner directory."""
    return GITHUB_RUNNER_DIR / "models.py"


@pytest.fixture
def batch_validator_file() -> Path:
    """Path to batch_validator.py in GitHub runner directory."""
    return GITHUB_RUNNER_DIR / "batch_validator.py"


@pytest.fixture
def batch_issues_file() -> Path:
    """Path to batch_issues.py in GitHub runner directory."""
    return GITHUB_RUNNER_DIR / "batch_issues.py"


@pytest.fixture
def orchestrator_file() -> Path:
    """Path to parallel_orchestrator_reviewer.py in GitHub runner services."""
    return GITHUB_RUNNER_SERVICES_DIR / "parallel_orchestrator_reviewer.py"


@pytest.fixture
def followup_file() -> Path:
    """Path to parallel_followup_reviewer.py in GitHub runner services."""
    return GITHUB_RUNNER_SERVICES_DIR / "parallel_followup_reviewer.py"


@pytest.fixture
def clean_env() -> Generator[None, None, None]:
    """Fixture that provides a clean environment without model override variables.

    This fixture clears all ANTHROPIC_DEFAULT_*_MODEL environment variables
    before each test and restores them afterward. This ensures tests don't
    interfere with each other when the user has custom model mappings configured.

    Yields:
        None
    """
    # Clear any environment variables that might interfere
    env_vars = [
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    ]
    env_backup = {k: os.environ.pop(k, None) for k in env_vars}

    yield

    # Restore environment variables
    for k, v in env_backup.items():
        if v is not None:
            os.environ[k] = v


class TestResolveModelId:
    """Tests for resolve_model_id function - behavioral tests."""

    def test_resolves_sonnet_shorthand_to_full_id(self, clean_env):
        """Sonnet shorthand resolves to full model ID."""
        result = resolve_model_id("sonnet")
        assert result == MODEL_ID_MAP["sonnet"]

    def test_resolves_opus_shorthand_to_full_id(self, clean_env):
        """Opus shorthand resolves to full model ID."""
        result = resolve_model_id("opus")
        assert result == MODEL_ID_MAP["opus"]

    def test_resolves_haiku_shorthand_to_full_id(self, clean_env):
        """Haiku shorthand resolves to full model ID."""
        result = resolve_model_id("haiku")
        assert result == MODEL_ID_MAP["haiku"]

    def test_passes_through_full_model_id(self):
        """Full model IDs are passed through unchanged."""
        custom_model = "glm-4.7"
        result = resolve_model_id(custom_model)
        assert result == custom_model

    def test_passes_through_unknown_shorthand(self):
        """Unknown shorthands are passed through unchanged."""
        unknown = "unknown-model"
        result = resolve_model_id(unknown)
        assert result == unknown

    def test_environment_variable_override_sonnet(self):
        """ANTHROPIC_DEFAULT_SONNET_MODEL overrides sonnet shorthand."""
        custom_model = "glm-4.7"
        with patch.dict(os.environ, {"ANTHROPIC_DEFAULT_SONNET_MODEL": custom_model}):
            result = resolve_model_id("sonnet")
            assert result == custom_model

    def test_environment_variable_override_opus(self):
        """ANTHROPIC_DEFAULT_OPUS_MODEL overrides opus shorthand."""
        custom_model = "glm-4.7"
        with patch.dict(os.environ, {"ANTHROPIC_DEFAULT_OPUS_MODEL": custom_model}):
            result = resolve_model_id("opus")
            assert result == custom_model

    def test_environment_variable_override_haiku(self):
        """ANTHROPIC_DEFAULT_HAIKU_MODEL overrides haiku shorthand."""
        custom_model = "glm-4.7"
        with patch.dict(os.environ, {"ANTHROPIC_DEFAULT_HAIKU_MODEL": custom_model}):
            result = resolve_model_id("haiku")
            assert result == custom_model

    def test_environment_variable_takes_precedence_over_hardcoded_map(self):
        """Environment variable overrides take precedence over MODEL_ID_MAP."""
        custom_model = "custom-sonnet-model"
        with patch.dict(os.environ, {"ANTHROPIC_DEFAULT_SONNET_MODEL": custom_model}):
            result = resolve_model_id("sonnet")
            assert result == custom_model
            assert result != MODEL_ID_MAP["sonnet"]

    def test_empty_environment_variable_is_ignored(self):
        """Empty environment variable is ignored, falls back to MODEL_ID_MAP."""
        with patch.dict(os.environ, {"ANTHROPIC_DEFAULT_SONNET_MODEL": ""}):
            result = resolve_model_id("sonnet")
            assert result == MODEL_ID_MAP["sonnet"]

    def test_full_model_id_not_affected_by_environment_variable(self):
        """Full model IDs are not affected by environment variables."""
        custom_model = "my-custom-model-123"
        with patch.dict(os.environ, {"ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-4.7"}):
            result = resolve_model_id(custom_model)
            assert result == custom_model


class TestGitHubRunnerConfigModelDefaults:
    """Tests for GitHubRunnerConfig default model values.

    Uses source inspection to avoid complex import dependencies while
    verifying the critical pattern: default is shorthand "sonnet", not a
    hardcoded full model ID.
    """

    def test_default_model_is_shorthand(self, models_file: Path):
        """GitHubRunnerConfig default model uses shorthand 'sonnet'."""
        # Explicit UTF-8 encoding required for Windows compatibility (default encoding varies by platform)
        content = models_file.read_text(encoding="utf-8")
        # Verify the default is "sonnet" (shorthand), not a hardcoded full model ID
        assert 'model: str = "sonnet"' in content
        # Verify the old hardcoded fallback is NOT present
        assert 'model: str = "claude-sonnet-4-5-20250929"' not in content

    def test_load_settings_default_model_is_shorthand(self, models_file: Path):
        """GitHubRunnerConfig.load_settings() uses shorthand 'sonnet' as default."""
        content = models_file.read_text(encoding="utf-8")
        # Verify load_settings uses "sonnet" (shorthand) as fallback
        assert 'model=settings.get("model", "sonnet")' in content


class TestBatchValidatorModelResolution:
    """Tests for BatchValidator model resolution.

    Tests verify the try/except import pattern (matching the established
    codebase convention) and that the shorthand "sonnet" is used as default.
    """

    def test_default_model_is_shorthand(self, batch_validator_file: Path):
        """BatchValidator DEFAULT_MODEL uses shorthand 'sonnet'."""
        content = batch_validator_file.read_text(encoding="utf-8")
        # Verify DEFAULT_MODEL is "sonnet" (shorthand)
        assert 'DEFAULT_MODEL = "sonnet"' in content

    def test_uses_try_except_import_pattern(self, batch_validator_file: Path):
        """BatchValidator uses try/except import pattern (established codebase convention).

        This is an implementation-detail test that guards against import patterns
        causing circular dependencies. The try/except pattern (relative imports
        falling back to absolute imports) is the established convention across
        runners/github/ and ensures proper module caching in sys.modules.

        Note: batch_validator.py is in runners/github/ (not services/), so it uses
        ..phase_config (2 dots) to reach apps/backend/phase_config.py.
        """
        content = batch_validator_file.read_text(encoding="utf-8")
        # Verify the try/except pattern IS present (relative import first)
        assert "from ..phase_config import resolve_model_id" in content
        # Verify fallback to absolute import is present
        assert "except (ImportError, ValueError, SystemError):" in content
        assert 'from phase_config import resolve_model_id' in content
        # Verify debug logging is present for error diagnosis
        assert "logger.debug" in content

    def test_has_resolve_model_method(self, batch_validator_file: Path):
        """BatchValidator has _resolve_model method that resolves models."""
        content = batch_validator_file.read_text(encoding="utf-8")
        # Verify _resolve_model method exists
        assert "def _resolve_model(self, model: str)" in content
        # Verify it calls resolve_model_id
        assert "return resolve_model_id(model)" in content

    def test_init_calls_resolve_model(self, batch_validator_file: Path):
        """BatchValidator.__init__ calls _resolve_model to resolve the model."""
        content = batch_validator_file.read_text(encoding="utf-8")
        # Verify __init__ resolves the model
        assert "self.model = self._resolve_model(model)" in content


class TestBatchIssuesModelResolution:
    """Tests for batch_issues.py validation_model default.

    Uses source inspection to verify shorthand "sonnet" is used as default.
    """

    def test_validation_model_default_is_shorthand(self, batch_issues_file: Path):
        """IssueBatcher validation_model default uses shorthand 'sonnet'."""
        content = batch_issues_file.read_text(encoding="utf-8")
        # Verify validation_model default is "sonnet" (shorthand)
        assert 'validation_model: str = "sonnet"' in content


class TestClaudeBatchAnalyzerModelResolution:
    """Tests for ClaudeBatchAnalyzer model resolution in batch_issues.py.

    Verifies that the hardcoded model ID in analyze_and_batch_issues()
    has been replaced with resolve_model_id() pattern.
    """

    def test_batch_analyzer_resolves_model(self, batch_issues_file: Path):
        """ClaudeBatchAnalyzer uses resolve_model_id() instead of hardcoded model ID."""
        content = batch_issues_file.read_text(encoding="utf-8")

        # Verify the old hardcoded model is NOT present
        assert 'model="claude-sonnet-4-5-20250929"' not in content
        assert 'model = "claude-sonnet-4-5-20250929"' not in content

        # Verify resolve_model_id is imported and used
        assert "from phase_config import resolve_model_id" in content
        assert "model = resolve_model_id" in content

    def test_batch_analyzer_uses_sonnet_shorthand(self, batch_issues_file: Path):
        """ClaudeBatchAnalyzer uses 'sonnet' shorthand, not full model ID."""
        content = batch_issues_file.read_text(encoding="utf-8")

        # Verify the pattern: model = resolve_model_id("sonnet")
        assert 'model = resolve_model_id("sonnet")' in content


class TestParallelReviewerImportResolution:
    """Tests that parallel reviewers use proper model resolution patterns.

    Includes both behavioral tests (simulating the pattern) and source
    inspection tests (to verify hardcoded fallbacks are not present).
    """

    def test_parallel_reviewers_resolve_models(self, clean_env):
        """Parallel reviewers correctly resolve model shorthands using resolve_model_id pattern."""
        # Simulate the pattern used in parallel reviewers
        config_model = None
        model_shorthand = config_model or "sonnet"
        model = resolve_model_id(model_shorthand)

        # Should resolve to the full model ID
        assert model == MODEL_ID_MAP["sonnet"]

    def test_parallel_reviewers_respect_environment_variables(self):
        """Parallel reviewers respect environment variable overrides."""
        custom_model = "glm-4.7"
        with patch.dict(os.environ, {"ANTHROPIC_DEFAULT_SONNET_MODEL": custom_model}):
            config_model = None
            model_shorthand = config_model or "sonnet"
            model = resolve_model_id(model_shorthand)

            assert model == custom_model

    def test_parallel_reviewers_use_sonnet_fallback(self, orchestrator_file: Path, followup_file: Path):
        """Parallel reviewers use 'sonnet' shorthand as fallback, not hardcoded model IDs."""
        orchestrator_content = orchestrator_file.read_text(encoding="utf-8")
        followup_content = followup_file.read_text(encoding="utf-8")

        # Verify the old hardcoded fallback is NOT present (negative assertion)
        assert 'or "claude-sonnet-4-5-20250929"' not in orchestrator_content
        assert 'or "claude-sonnet-4-5-20250929"' not in followup_content

        # Verify the new pattern IS present (shorthand fallback)
        assert 'model_shorthand = self.config.model or "sonnet"' in orchestrator_content
        assert 'model_shorthand = self.config.model or "sonnet"' in followup_content

        # Verify resolve_model_id is imported and used
        assert "resolve_model_id" in orchestrator_content
        assert "resolve_model_id" in followup_content
