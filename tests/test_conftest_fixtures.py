#!/usr/bin/env python3
"""
Test Conftest Fixtures - Validate Mock Fixtures Match Real Modules
==================================================================

Tests to ensure mock fixtures in conftest.py stay in sync with the real modules
they mock. This catches drift when the real module changes but the mock is not updated.
"""

import sys
from pathlib import Path

# Add apps/backend to path so we can import real modules
backend_path = Path(__file__).parent.parent / "apps" / "backend"
if str(backend_path) not in sys.path:
    sys.path.insert(0, str(backend_path))


class TestMockIconsSync:
    """Tests to validate mock_ui_icons fixture matches real Icons class."""

    def test_mock_icons_has_all_real_icon_constants(self, mock_ui_icons):
        """
        Verify MockIcons has all the same icon constants as the real Icons class.

        This test catches when new icons are added to the real Icons class
        but the mock is not updated.
        """
        from ui.icons import Icons

        # Get all class attributes that are tuples (icon definitions)
        real_icons = {
            name: value
            for name, value in vars(Icons).items()
            if not name.startswith("_") and isinstance(value, tuple)
        }

        mock_icons = {
            name: value
            for name, value in vars(mock_ui_icons).items()
            if not name.startswith("_") and isinstance(value, tuple)
        }

        # Check for missing icons in mock
        missing_from_mock = set(real_icons.keys()) - set(mock_icons.keys())
        assert not missing_from_mock, (
            f"MockIcons is missing icons that exist in real Icons class: {missing_from_mock}. "
            f"Update the mock_ui_icons fixture in tests/conftest.py to include these icons."
        )

        # Check for extra icons in mock (shouldn't happen but good to catch)
        extra_in_mock = set(mock_icons.keys()) - set(real_icons.keys())
        assert not extra_in_mock, (
            f"MockIcons has icons that don't exist in real Icons class: {extra_in_mock}. "
            f"Remove these from the mock_ui_icons fixture in tests/conftest.py."
        )

    def test_mock_icons_values_match_real(self, mock_ui_icons):
        """
        Verify MockIcons icon values match the real Icons class.

        This test catches when icon tuples are changed in the real Icons class
        but the mock still has the old values.
        """
        from ui.icons import Icons

        # Get all class attributes that are tuples (icon definitions)
        real_icons = {
            name: value
            for name, value in vars(Icons).items()
            if not name.startswith("_") and isinstance(value, tuple)
        }

        mock_icons = {
            name: value
            for name, value in vars(mock_ui_icons).items()
            if not name.startswith("_") and isinstance(value, tuple)
        }

        # Compare values for icons that exist in both
        mismatches = []
        for name in real_icons:
            if name in mock_icons:
                if real_icons[name] != mock_icons[name]:
                    mismatches.append(
                        f"{name}: real={real_icons[name]}, mock={mock_icons[name]}"
                    )

        assert not mismatches, (
            f"MockIcons values don't match real Icons class:\n"
            + "\n".join(mismatches)
            + "\n\nUpdate the mock_ui_icons fixture in tests/conftest.py to match."
        )


class TestMockUIModuleFullSync:
    """Tests to validate mock_ui_module_full fixture matches real UI module."""

    def test_mock_ui_module_has_icons_class(self, mock_ui_module_full):
        """Verify mock UI module has Icons class."""
        assert hasattr(mock_ui_module_full, "Icons"), (
            "mock_ui_module_full is missing Icons class. "
            "Update the mock_ui_module_full fixture in tests/conftest.py."
        )

    def test_mock_ui_module_has_menu_option_class(self, mock_ui_module_full):
        """Verify mock UI module has MenuOption class."""
        assert hasattr(mock_ui_module_full, "MenuOption"), (
            "mock_ui_module_full is missing MenuOption class. "
            "Update the mock_ui_module_full fixture in tests/conftest.py."
        )

    def test_mock_ui_module_has_required_functions(self, mock_ui_module_full):
        """Verify mock UI module has all required functions."""
        required_functions = [
            "icon",
            "bold",
            "muted",
            "box",
            "print_status",
            "select_menu",
            "error",
            "success",
            "warning",
            "info",
            "highlight",
        ]

        missing = [fn for fn in required_functions if not hasattr(mock_ui_module_full, fn)]
        assert not missing, (
            f"mock_ui_module_full is missing functions: {missing}. "
            f"Update the mock_ui_module_full fixture in tests/conftest.py."
        )
