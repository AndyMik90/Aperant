import json
import sys
import time
from pathlib import Path

import pytest

# Ensure local apps/backend is in path
sys.path.insert(0, str(Path(__file__).parents[1] / "apps" / "backend"))

from project.analyzer import ProjectAnalyzer
from project.models import SecurityProfile
from security.profile import get_security_profile, reset_profile_cache


@pytest.fixture
def mock_project_dir(tmp_path):
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    return project_dir

@pytest.fixture
def mock_profile_path(mock_project_dir):
    return mock_project_dir / ".auto-claude-security.json"

def create_valid_profile_json(commands, project_hash=""):
    """Helper to create a valid SecurityProfile JSON structure."""
    return json.dumps({
        "base_commands": commands,
        "stack_commands": [],
        "script_commands": [],
        "custom_commands": [],
        "detected_stack": {
            "languages": [],
            "package_managers": [],
            "frameworks": [],
            "databases": [],
            "infrastructure": [],
            "cloud_providers": [],
            "code_quality_tools": [],
            "version_managers": []
        },
        "custom_scripts": {
            "npm_scripts": [],
            "make_targets": [],
            "poetry_scripts": [],
            "cargo_aliases": [],
            "shell_scripts": []
        },
        "project_dir": "",
        "created_at": "",
        "project_hash": project_hash
    })

def get_dir_hash(project_dir):
    return ProjectAnalyzer(project_dir).compute_project_hash()

def test_cache_invalidation_on_file_creation(mock_project_dir, mock_profile_path):
    reset_profile_cache()

    # Compute hash first, before any files are created
    # This hash will be used in the profile we create later
    current_hash = get_dir_hash(mock_project_dir)

    # 1. First call - file doesn't exist, analyzer will create one with BASE_COMMANDS
    profile1 = get_security_profile(mock_project_dir)
    assert "unique_cmd_A" not in profile1.get_all_allowed_commands()

    # 2. Wait to ensure filesystem mtime has different second
    # (some filesystems have 1-second resolution)
    time.sleep(1.0)

    # 3. Overwrite the file with our custom content
    # Use the SAME hash we computed before (directory structure hasn't changed)
    mock_profile_path.write_text(create_valid_profile_json(["unique_cmd_A"], current_hash))

    # 4. Second call - should detect file modification and reload
    profile2 = get_security_profile(mock_project_dir)
    assert "unique_cmd_A" in profile2.get_all_allowed_commands()

def test_cache_invalidation_on_file_modification(mock_project_dir, mock_profile_path):
    reset_profile_cache()

    # 1. Create initial file
    current_hash = get_dir_hash(mock_project_dir)
    mock_profile_path.write_text(create_valid_profile_json(["unique_cmd_A"], current_hash))

    # 2. Load initial profile
    profile1 = get_security_profile(mock_project_dir)
    assert "unique_cmd_A" in profile1.get_all_allowed_commands()

    # Wait to ensure mtime changes (some filesystems have 1-second resolution)
    time.sleep(1.0)

    # 3. Modify the file
    mock_profile_path.write_text(create_valid_profile_json(["unique_cmd_B"], current_hash))

    # 4. Call again - should detect modification
    profile2 = get_security_profile(mock_project_dir)
    assert "unique_cmd_B" in profile2.get_all_allowed_commands()

def test_cache_invalidation_on_file_deletion(mock_project_dir, mock_profile_path):
    reset_profile_cache()

    # 1. Create file
    current_hash = get_dir_hash(mock_project_dir)
    mock_profile_path.write_text(create_valid_profile_json(["unique_cmd_A"], current_hash))

    # 2. Load profile
    profile1 = get_security_profile(mock_project_dir)
    assert "unique_cmd_A" in profile1.get_all_allowed_commands()

    # 3. Delete file
    mock_profile_path.unlink()

    # 4. Call again - should handle deletion gracefully and fallback to fresh analysis
    profile2 = get_security_profile(mock_project_dir)
    assert "unique_cmd_A" not in profile2.get_all_allowed_commands()
