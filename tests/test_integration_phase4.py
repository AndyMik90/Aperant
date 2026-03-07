"""
Integration Tests for PR Review System - Phase 4+
==================================================

Tests validating key features:
- Phase 2: Import detection (path aliases, Python), reverse dependencies
- Phase 3: Multi-agent cross-validation
- Phase 5+: Scope filtering with is_impact_finding schema field

Note: ConfidenceTier and _validate_finding_evidence were removed in Phase 5
(Code Simplification). Evidence validation is now handled by schema enforcement
and the finding-validator agent.
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add the backend directory to path for imports
backend_path = Path(__file__).parent.parent / "apps" / "backend"
sys.path.insert(0, str(backend_path))

# Import directly to avoid loading the full runners module with its dependencies
import importlib.util

# Load file_lock first (models.py depends on it)
file_lock_spec = importlib.util.spec_from_file_location(
    "file_lock", backend_path / "runners" / "github" / "file_lock.py"
)
file_lock_module = importlib.util.module_from_spec(file_lock_spec)
sys.modules["file_lock"] = file_lock_module
file_lock_spec.loader.exec_module(file_lock_module)

# Load models next
models_spec = importlib.util.spec_from_file_location(
    "models", backend_path / "runners" / "github" / "models.py"
)
models_module = importlib.util.module_from_spec(models_spec)
sys.modules["models"] = models_module
models_spec.loader.exec_module(models_module)
PRReviewFinding = models_module.PRReviewFinding
PRReviewResult = models_module.PRReviewResult
ReviewSeverity = models_module.ReviewSeverity
ReviewCategory = models_module.ReviewCategory

# Load services module dependencies for parallel_orchestrator_reviewer
category_utils_spec = importlib.util.spec_from_file_location(
    "category_utils",
    backend_path / "runners" / "github" / "services" / "category_utils.py",
)
category_utils_module = importlib.util.module_from_spec(category_utils_spec)
sys.modules["services.category_utils"] = category_utils_module
category_utils_spec.loader.exec_module(category_utils_module)

# Load io_utils
io_utils_spec = importlib.util.spec_from_file_location(
    "io_utils", backend_path / "runners" / "github" / "services" / "io_utils.py"
)
io_utils_module = importlib.util.module_from_spec(io_utils_spec)
sys.modules["services.io_utils"] = io_utils_module
io_utils_spec.loader.exec_module(io_utils_module)

# Load pydantic_models (mock pydantic if not installed in test env)
_pydantic_was_mocked = False
try:
    import pydantic  # noqa: F401
except ImportError:
    pydantic_mock = MagicMock()
    sys.modules["pydantic"] = pydantic_mock
    _pydantic_was_mocked = True
pydantic_models_spec = importlib.util.spec_from_file_location(
    "pydantic_models",
    backend_path / "runners" / "github" / "services" / "pydantic_models.py",
)
pydantic_models_module = importlib.util.module_from_spec(pydantic_models_spec)
sys.modules["services.pydantic_models"] = pydantic_models_module
pydantic_models_spec.loader.exec_module(pydantic_models_module)
AgentAgreement = pydantic_models_module.AgentAgreement
# Restore sys.modules to avoid leaking the mock to other tests
if _pydantic_was_mocked:
    del sys.modules["pydantic"]

# Load agent_utils (shared utility for working directory injection)
agent_utils_spec = importlib.util.spec_from_file_location(
    "agent_utils", backend_path / "runners" / "github" / "services" / "agent_utils.py"
)
agent_utils_module = importlib.util.module_from_spec(agent_utils_spec)
sys.modules["services.agent_utils"] = agent_utils_module
agent_utils_spec.loader.exec_module(agent_utils_module)

# Load parallel_orchestrator_reviewer (contains _is_finding_in_scope and _cross_validate_findings)
orchestrator_spec = importlib.util.spec_from_file_location(
    "parallel_orchestrator_reviewer",
    backend_path
    / "runners"
    / "github"
    / "services"
    / "parallel_orchestrator_reviewer.py",
)
orchestrator_module = importlib.util.module_from_spec(orchestrator_spec)
# Register module in sys.modules BEFORE exec_module to allow @dataclass decorator to work
# Without this, dataclass fails on Windows with: AttributeError: 'NoneType' object has no attribute '__dict__'
sys.modules["parallel_orchestrator_reviewer"] = orchestrator_module
# Mock dependencies that aren't needed for unit testing
# IMPORTANT: Save and restore ALL mocked modules to avoid polluting sys.modules for other tests
_modules_to_mock = [
    "context_gatherer",
    "core.client",
    "gh_client",
    "phase_config",
    "services.pr_worktree_manager",
    "services.sdk_utils",
    "claude_agent_sdk",
]
_original_modules = {name: sys.modules.get(name) for name in _modules_to_mock}
for name in _modules_to_mock:
    sys.modules[name] = MagicMock()
# IMPORTANT: Register the module in sys.modules BEFORE exec_module
# This is required for dataclass decorators to find the module by name
sys.modules["parallel_orchestrator_reviewer"] = orchestrator_module
orchestrator_spec.loader.exec_module(orchestrator_module)
# Restore all mocked modules to avoid polluting other tests
for name in _modules_to_mock:
    if _original_modules[name] is not None:
        sys.modules[name] = _original_modules[name]
    elif name in sys.modules:
        del sys.modules[name]

# Import only functions that still exist after Phase 5
_is_finding_in_scope = orchestrator_module._is_finding_in_scope


# =============================================================================
# Phase 5+ Tests: Scope Filtering (Updated)
# =============================================================================


class TestScopeFiltering:
    """Test scope filtering logic (updated for Phase 5 - uses is_impact_finding schema field)."""

    @pytest.fixture
    def make_finding(self):
        """Factory fixture to create PRReviewFinding instances.

        Note: is_impact_finding is set as an attribute after creation because
        PRReviewFinding (dataclass) doesn't have this field - it's on the
        ParallelOrchestratorFinding Pydantic model. The actual code uses
        getattr(finding, 'is_impact_finding', False) to access it.
        """

        def _make_finding(
            file: str = "src/test.py",
            line: int = 10,
            is_impact_finding: bool = False,
            **kwargs,
        ):
            defaults = {
                "id": "TEST001",
                "severity": ReviewSeverity.MEDIUM,
                "category": ReviewCategory.QUALITY,
                "title": "Test Finding",
                "description": "Test description",
                "file": file,
                "line": line,
            }
            defaults.update(kwargs)
            finding = PRReviewFinding(**defaults)
            # Set is_impact_finding as attribute (accessed via getattr in _is_finding_in_scope)
            finding.is_impact_finding = is_impact_finding
            return finding

        return _make_finding

    def test_finding_in_changed_files_passes(self, make_finding):
        """Finding for a file in changed_files should pass."""
        changed_files = ["src/auth.py", "src/utils.py", "tests/test_auth.py"]
        finding = make_finding(file="src/auth.py", line=15)

        is_valid, reason = _is_finding_in_scope(finding, changed_files)
        assert is_valid, f"Failed: {reason}"

    def test_finding_outside_changed_files_filtered(self, make_finding):
        """Finding for a file NOT in changed_files should be filtered."""
        changed_files = ["src/auth.py", "src/utils.py"]
        finding = make_finding(
            file="src/database.py", line=10, description="This code has a bug"
        )

        is_valid, reason = _is_finding_in_scope(finding, changed_files)
        assert not is_valid
        assert "not in pr changed files" in reason.lower()

    def test_invalid_line_number_filtered(self, make_finding):
        """Finding with invalid line number (<=0) should be filtered."""
        changed_files = ["src/test.py"]

        # Zero line
        finding = make_finding(file="src/test.py", line=0)
        is_valid, reason = _is_finding_in_scope(finding, changed_files)
        assert not is_valid
        assert "invalid line" in reason.lower()

        # Negative line
        finding = make_finding(file="src/test.py", line=-5)
        is_valid, reason = _is_finding_in_scope(finding, changed_files)
        assert not is_valid

    def test_impact_finding_allowed_for_unchanged_files(self, make_finding):
        """Finding with is_impact_finding=True should be allowed for unchanged files."""
        changed_files = ["src/auth.py"]

        # Impact finding for unchanged file
        finding = make_finding(
            file="src/utils.py",
            line=10,
            is_impact_finding=True,  # Schema field replaces keyword detection
            description="This change breaks the helper function in utils.py",
        )
        is_valid, _ = _is_finding_in_scope(finding, changed_files)
        assert is_valid

    def test_non_impact_finding_filtered_for_unchanged_files(self, make_finding):
        """Finding with is_impact_finding=False should be filtered for unchanged files."""
        changed_files = ["src/auth.py"]

        # Non-impact finding for unchanged file
        finding = make_finding(
            file="src/database.py",
            line=20,
            is_impact_finding=False,
            description="database.py depends on modified auth module",
        )
        is_valid, reason = _is_finding_in_scope(finding, changed_files)
        assert not is_valid
        assert "not in pr changed files" in reason.lower()

    def test_no_file_specified_fails(self, make_finding):
        """Finding with no file specified should fail."""
        changed_files = ["src/test.py"]
        finding = make_finding(file="")
        is_valid, reason = _is_finding_in_scope(finding, changed_files)
        assert not is_valid
        assert "no file" in reason.lower()

    def test_none_line_number_passes(self, make_finding):
        """Finding with None line number should pass (general finding)."""
        changed_files = ["src/test.py"]
        finding = make_finding(file="src/test.py", line=None)
        # Line=None means general file-level finding
        finding.line = None  # Override since fixture sets it
        is_valid, _ = _is_finding_in_scope(finding, changed_files)
        assert is_valid


# =============================================================================
# Phase 2 Tests: Import Detection, Reverse Dependencies
# =============================================================================

# For Phase 2 tests, we need the real PRContextGatherer methods
# We'll test the functions directly by extracting the relevant logic
github_dir = backend_path / "runners" / "github"

# Load context_gatherer module directly using spec loader
# This avoids the complex package import chain
_cg_spec = importlib.util.spec_from_file_location(
    "context_gatherer_isolated", github_dir / "context_gatherer.py"
)
_cg_module = importlib.util.module_from_spec(_cg_spec)
# Set up minimal module environment
sys.modules["context_gatherer_isolated"] = _cg_module
# Mock only the gh_client dependency
_mock_gh = MagicMock()
sys.modules["gh_client"] = _mock_gh
_cg_spec.loader.exec_module(_cg_module)
PRContextGathererIsolated = _cg_module.PRContextGatherer


class TestImportDetection:
    """Test import detection logic (Phase 2)."""

    @pytest.fixture
    def temp_project(self, tmp_path):
        """Create a temporary project structure for import testing."""
        # Create src directory
        src_dir = tmp_path / "src"
        src_dir.mkdir()

        # Create utils.ts file
        (src_dir / "utils.ts").write_text("export const helper = () => {};")

        # Create config.ts file
        (src_dir / "config.ts").write_text("export const config = { debug: true };")

        # Create index.ts that re-exports
        (src_dir / "index.ts").write_text(
            "export * from './utils';\nexport { config } from './config';"
        )

        # Create shared directory
        shared_dir = src_dir / "shared"
        shared_dir.mkdir()
        (shared_dir / "types.ts").write_text("export type User = { id: string };")

        # Create Python module
        (src_dir / "python_module.py").write_text(
            "from .helpers import util_func\nimport os"
        )
        (src_dir / "helpers.py").write_text("def util_func(): pass")
        (src_dir / "__init__.py").write_text("")

        return tmp_path

    def test_path_alias_detection(self, temp_project):
        """Path alias imports (@/utils) should be detected and resolved."""
        import json

        # Create tsconfig.json with path aliases
        tsconfig = {
            "compilerOptions": {
                "paths": {"@/*": ["src/*"], "@shared/*": ["src/shared/*"]}
            }
        }
        (temp_project / "tsconfig.json").write_text(json.dumps(tsconfig))

        # Create the target file that the alias points to
        (temp_project / "src" / "utils.ts").write_text(
            "export const helper = () => {};"
        )

        # Test file with alias import
        test_content = "import { helper } from '@/utils';"
        source_path = Path("src/test.ts")

        gatherer = PRContextGathererIsolated(temp_project, pr_number=1)

        # Call _find_imports
        imports = gatherer._find_imports(test_content, source_path)

        # Should resolve @/utils to src/utils.ts
        assert isinstance(imports, set)
        # Normalize paths for cross-platform comparison (Windows uses backslashes)
        normalized_imports = {p.replace("\\", "/") for p in imports}
        assert "src/utils.ts" in normalized_imports, (
            f"Expected 'src/utils.ts' in imports, got: {imports}"
        )

    def test_commonjs_require_detection(self, temp_project):
        """CommonJS require('./utils') should be detected."""
        test_content = "const utils = require('./utils');"
        source_path = Path("src/test.ts")

        gatherer = PRContextGathererIsolated(temp_project, pr_number=1)
        imports = gatherer._find_imports(test_content, source_path)

        # Should detect relative require
        # Normalize paths for cross-platform comparison (Windows uses backslashes)
        normalized_imports = {p.replace("\\", "/") for p in imports}
        assert "src/utils.ts" in normalized_imports

    def test_reexport_detection(self, temp_project):
        """Re-exports (export * from './module') should be detected."""
        test_content = "export * from './utils';\nexport { config } from './config';"
        source_path = Path("src/index.ts")

        gatherer = PRContextGathererIsolated(temp_project, pr_number=1)
        imports = gatherer._find_imports(test_content, source_path)

        # Should detect re-export targets
        # Normalize paths for cross-platform comparison (Windows uses backslashes)
        normalized_imports = {p.replace("\\", "/") for p in imports}
        assert "src/utils.ts" in normalized_imports
        assert "src/config.ts" in normalized_imports

    def test_python_relative_import(self, temp_project):
        """Python relative imports (from .utils import) should be detected via AST."""
        test_content = "from .helpers import util_func"
        source_path = Path("src/python_module.py")

        gatherer = PRContextGathererIsolated(temp_project, pr_number=1)
        imports = gatherer._find_imports(test_content, source_path)

        # Should resolve relative Python import
        # Normalize paths for cross-platform comparison (Windows uses backslashes)
        normalized_imports = {p.replace("\\", "/") for p in imports}
        assert "src/helpers.py" in normalized_imports

    def test_python_absolute_import(self, temp_project):
        """Python absolute imports should be checked for project-internal modules."""
        # Create a project-internal module
        (temp_project / "myapp").mkdir()
        (temp_project / "myapp" / "__init__.py").write_text("")
        (temp_project / "myapp" / "config.py").write_text("DEBUG = True")

        test_content = "from myapp import config"
        source_path = Path("src/test.py")

        gatherer = PRContextGathererIsolated(temp_project, pr_number=1)
        imports = gatherer._find_imports(test_content, source_path)

        # Should resolve absolute import to project module
        # Normalize paths for cross-platform comparison (Windows uses backslashes)
        normalized_imports = {p.replace("\\", "/") for p in imports}
        assert any("myapp" in i for i in normalized_imports)


class TestReverseDepDetection:
    """Test reverse dependency detection (Phase 2).

    ARCHITECTURE NOTE (2025-01): These tests document that programmatic file scanning
    has been intentionally removed. The _find_dependents() method now returns an empty
    set because LLM agents handle file discovery via their tools (Glob, Grep, Read).

    This design change:
    - Removes the legacy 2000 file scan limit
    - Lets LLM agents use their judgment to find relevant files
    - Avoids pre-loading context that may not be needed
    - Scales better for large codebases
    """

    @pytest.fixture
    def temp_project_with_deps(self, tmp_path):
        """Create a project with files that import each other."""
        src_dir = tmp_path / "src"
        src_dir.mkdir()

        # Create a utility file with non-generic name
        (src_dir / "formatter.ts").write_text(
            "export function format(s: string) { return s; }"
        )

        # Create files that import formatter
        (src_dir / "auth.ts").write_text(
            "import { format } from './formatter';\nexport const login = () => {};"
        )
        (src_dir / "api.ts").write_text(
            "import { format } from './formatter';\nexport const fetch = () => {};"
        )

        return tmp_path

    def test_find_dependents_returns_empty_set(self, temp_project_with_deps):
        """_find_dependents() returns empty - LLM agents discover files via tools.

        This is intentional: programmatic file scanning was removed in favor of
        letting LLM agents use Glob/Grep/Read tools to discover relevant files
        based on the PR context they receive.
        """
        gatherer = PRContextGathererIsolated(temp_project_with_deps, pr_number=1)
        dependents = gatherer._find_dependents("src/formatter.ts", max_results=10)

        # Method now intentionally returns empty set
        assert dependents == set()

    def test_find_dependents_empty_for_any_file(self, tmp_path):
        """Verify _find_dependents() returns empty for any input.

        The LLM-driven architecture means agents decide what's relevant,
        not programmatic scanning.
        """
        src_dir = tmp_path / "src"
        src_dir.mkdir()

        (src_dir / "index.ts").write_text("export * from './utils';")
        (src_dir / "main.ts").write_text("import { x } from './index';")

        gatherer = PRContextGathererIsolated(tmp_path, pr_number=1)
        dependents = gatherer._find_dependents("src/index.ts")

        # Returns empty - LLM agents handle file discovery
        assert dependents == set()

    def test_find_dependents_returns_set_type(self, tmp_path):
        """Verify _find_dependents() returns correct type (set)."""
        src_dir = tmp_path / "src"
        src_dir.mkdir()
        (src_dir / "file.ts").write_text("export const x = 1;")

        gatherer = PRContextGathererIsolated(tmp_path, pr_number=1)
        dependents = gatherer._find_dependents("src/file.ts")

        # Should return a set (empty, but correct type)
        assert isinstance(dependents, set)


# =============================================================================
# Phase 3 Tests: Multi-Agent Cross-Validation
# =============================================================================

# Import the cross-validation function from orchestrator
ParallelOrchestratorReviewer = orchestrator_module.ParallelOrchestratorReviewer


class TestCrossValidation:
    """Test multi-agent cross-validation logic (Phase 3)."""

    @pytest.fixture
    def make_finding(self):
        """Factory fixture to create PRReviewFinding instances."""

        def _make_finding(
            id: str = "TEST001",
            file: str = "src/test.py",
            line: int = 10,
            category: ReviewCategory = ReviewCategory.SECURITY,
            severity: ReviewSeverity = ReviewSeverity.HIGH,
            confidence: float = 0.7,
            source_agents: list = None,
            **kwargs,
        ):
            return PRReviewFinding(
                id=id,
                severity=severity,
                category=category,
                title=kwargs.get("title", "Test Finding"),
                description=kwargs.get("description", "Test description"),
                file=file,
                line=line,
                confidence=confidence,
                source_agents=source_agents or [],
                **{
                    k: v for k, v in kwargs.items() if k not in ["title", "description"]
                },
            )

        return _make_finding

    @pytest.fixture
    def mock_reviewer(self, tmp_path):
        """Create a mock ParallelOrchestratorReviewer instance."""
        from models import GitHubRunnerConfig

        config = GitHubRunnerConfig(token="test-token", repo="test/repo")
        # Create minimal directory structure
        github_dir = tmp_path / ".auto-claude" / "github"
        github_dir.mkdir(parents=True)

        reviewer = ParallelOrchestratorReviewer(
            project_dir=tmp_path, github_dir=github_dir, config=config
        )
        return reviewer

    def test_multi_agent_agreement_boosts_confidence(self, make_finding, mock_reviewer):
        """When 2+ agents agree on same finding, confidence should increase by 0.15."""
        # Two findings from different agents on same (file, line, category)
        finding1 = make_finding(
            id="F1",
            file="src/auth.py",
            line=10,
            category=ReviewCategory.SECURITY,
            confidence=0.7,
            source_agents=["security-reviewer"],
            description="SQL injection risk",
        )
        finding2 = make_finding(
            id="F2",
            file="src/auth.py",
            line=10,
            category=ReviewCategory.SECURITY,
            confidence=0.6,
            source_agents=["quality-reviewer"],
            description="Input not sanitized",
        )

        validated, agreement = mock_reviewer._cross_validate_findings(
            [finding1, finding2]
        )

        # Should merge into one finding
        assert len(validated) == 1
        # Confidence should be boosted: max(0.7, 0.6) + 0.15 = 0.85
        assert validated[0].confidence == pytest.approx(0.85, rel=0.01)
        # Should have cross_validated flag set
        assert validated[0].cross_validated is True
        # Should track in agreement
        assert len(agreement.agreed_findings) == 1

    def test_confidence_boost_capped_at_095(self, make_finding, mock_reviewer):
        """Confidence boost should cap at 0.95, not exceed 1.0."""
        finding1 = make_finding(
            id="F1",
            file="src/auth.py",
            line=10,
            category=ReviewCategory.SECURITY,
            confidence=0.85,
            source_agents=["security-reviewer"],
        )
        finding2 = make_finding(
            id="F2",
            file="src/auth.py",
            line=10,
            category=ReviewCategory.SECURITY,
            confidence=0.90,
            source_agents=["logic-reviewer"],
        )

        validated, _ = mock_reviewer._cross_validate_findings([finding1, finding2])

        # 0.90 + 0.15 = 1.05, but should cap at 0.95
        assert validated[0].confidence == 0.95

    def test_merged_finding_has_cross_validated_true(self, make_finding, mock_reviewer):
        """Merged multi-agent findings should have cross_validated=True."""
        finding1 = make_finding(
            id="F1", file="src/test.py", line=5, source_agents=["agent1"]
        )
        finding2 = make_finding(
            id="F2", file="src/test.py", line=5, source_agents=["agent2"]
        )

        validated, _ = mock_reviewer._cross_validate_findings([finding1, finding2])

        assert validated[0].cross_validated is True

    def test_grouping_by_file_line_category(self, make_finding, mock_reviewer):
        """Findings should be grouped by (file, line, category) tuple."""
        # Same file+line but different category - should NOT merge
        finding1 = make_finding(
            id="F1",
            file="src/test.py",
            line=10,
            category=ReviewCategory.SECURITY,
        )
        finding2 = make_finding(
            id="F2",
            file="src/test.py",
            line=10,
            category=ReviewCategory.QUALITY,  # Different category
        )

        validated, _ = mock_reviewer._cross_validate_findings([finding1, finding2])

        # Should remain as 2 separate findings
        assert len(validated) == 2

        # Same category but different line - should NOT merge
        finding3 = make_finding(
            id="F3",
            file="src/test.py",
            line=10,
            category=ReviewCategory.SECURITY,
        )
        finding4 = make_finding(
            id="F4",
            file="src/test.py",
            line=20,  # Different line
            category=ReviewCategory.SECURITY,
        )

        validated2, _ = mock_reviewer._cross_validate_findings([finding3, finding4])
        assert len(validated2) == 2

    def test_merged_description_combines_sources(self, make_finding, mock_reviewer):
        """Merged findings should combine descriptions with ' | ' separator."""
        finding1 = make_finding(
            id="F1",
            file="src/auth.py",
            line=10,
            category=ReviewCategory.SECURITY,
            description="SQL injection vulnerability",
        )
        finding2 = make_finding(
            id="F2",
            file="src/auth.py",
            line=10,
            category=ReviewCategory.SECURITY,
            description="Unsanitized user input",
        )

        validated, _ = mock_reviewer._cross_validate_findings([finding1, finding2])

        # Should combine descriptions with ' | '
        assert " | " in validated[0].description
        assert "SQL injection vulnerability" in validated[0].description
        assert "Unsanitized user input" in validated[0].description

    def test_single_agent_finding_not_boosted(self, make_finding, mock_reviewer):
        """Single-agent findings should not have confidence boosted."""
        finding = make_finding(
            id="F1",
            file="src/test.py",
            line=10,
            confidence=0.7,
            source_agents=["security-reviewer"],
        )

        validated, agreement = mock_reviewer._cross_validate_findings([finding])

        # Confidence should remain unchanged
        assert validated[0].confidence == 0.7
        # Should not be marked as cross-validated
        assert validated[0].cross_validated is False
        # Should not be in agreed_findings
        assert len(agreement.agreed_findings) == 0

    def test_merged_finding_keeps_highest_severity(self, make_finding, mock_reviewer):
        """Merged findings should keep the highest severity."""
        finding1 = make_finding(
            id="F1",
            file="src/test.py",
            line=10,
            severity=ReviewSeverity.MEDIUM,
        )
        finding2 = make_finding(
            id="F2",
            file="src/test.py",
            line=10,
            severity=ReviewSeverity.CRITICAL,
        )

        validated, _ = mock_reviewer._cross_validate_findings([finding1, finding2])

        # Should keep CRITICAL (highest severity)
        assert validated[0].severity == ReviewSeverity.CRITICAL

    def test_empty_findings_handled(self, mock_reviewer):
        """Test that empty findings list is handled gracefully."""
        validated, agreement = mock_reviewer._cross_validate_findings([])

        assert len(validated) == 0
        assert len(agreement.agreed_findings) == 0
        assert len(agreement.conflicting_findings) == 0
