#!/usr/bin/env python3
"""
Tests for Fast Mode Configuration
===================================

Tests the get_fast_mode() function from phase_config which reads
the fastMode flag from task_metadata.json.
"""

import json
import sys
from pathlib import Path

import pytest

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from phase_config import get_fast_mode


class TestGetFastMode:
    """Tests for get_fast_mode() function."""

    def test_fast_mode_enabled(self, tmp_path):
        """Returns True when fastMode is true in task_metadata.json."""
        metadata = {"fastMode": True, "model": "opus"}
        metadata_path = tmp_path / "task_metadata.json"
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")

        assert get_fast_mode(tmp_path) is True

    def test_fast_mode_disabled(self, tmp_path):
        """Returns False when fastMode is false in task_metadata.json."""
        metadata = {"fastMode": False, "model": "opus"}
        metadata_path = tmp_path / "task_metadata.json"
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")

        assert get_fast_mode(tmp_path) is False

    def test_fast_mode_missing_field(self, tmp_path):
        """Returns False when fastMode field is absent from task_metadata.json."""
        metadata = {"model": "opus", "thinkingLevel": "high"}
        metadata_path = tmp_path / "task_metadata.json"
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")

        assert get_fast_mode(tmp_path) is False

    def test_fast_mode_no_metadata(self, tmp_path):
        """Returns False when task_metadata.json doesn't exist."""
        assert get_fast_mode(tmp_path) is False

    def test_fast_mode_truthy_value(self, tmp_path):
        """Returns True for truthy non-boolean values (e.g., 1)."""
        metadata = {"fastMode": 1}
        metadata_path = tmp_path / "task_metadata.json"
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")

        assert get_fast_mode(tmp_path) is True

    def test_fast_mode_falsy_value(self, tmp_path):
        """Returns False for falsy non-boolean values (e.g., 0, null)."""
        metadata = {"fastMode": 0}
        metadata_path = tmp_path / "task_metadata.json"
        metadata_path.write_text(json.dumps(metadata), encoding="utf-8")

        assert get_fast_mode(tmp_path) is False

    def test_fast_mode_invalid_json(self, tmp_path):
        """Returns False when task_metadata.json contains invalid JSON."""
        metadata_path = tmp_path / "task_metadata.json"
        metadata_path.write_text("not valid json {{{", encoding="utf-8")

        assert get_fast_mode(tmp_path) is False
