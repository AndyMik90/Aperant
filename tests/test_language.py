"""
Tests for language utilities used in AI-generated content localization.

Ensures that language instructions are correctly generated for different
languages and content types.
"""

import sys
from pathlib import Path

# Add auto-claude to path
sys.path.insert(0, str(Path(__file__).parent.parent / "apps" / "backend"))

from core.language import LANGUAGE_NAMES, get_language_instruction


class TestLanguageNames:
    """Test LANGUAGE_NAMES dictionary."""

    def test_contains_english(self):
        """Test that English is in the language names."""
        assert "en" in LANGUAGE_NAMES
        assert LANGUAGE_NAMES["en"] == "English"

    def test_contains_common_languages(self):
        """Test that common languages are included."""
        expected_languages = ["en", "fr", "zh-CN", "zh-TW", "ja", "ko", "es", "de", "pt", "ru"]
        for lang_code in expected_languages:
            assert lang_code in LANGUAGE_NAMES, f"Missing language: {lang_code}"

    def test_language_names_not_empty(self):
        """Test that all language names have non-empty values."""
        for code, name in LANGUAGE_NAMES.items():
            assert name, f"Empty name for language code: {code}"
            assert len(name) > 0

    def test_french_name_includes_native(self):
        """Test that French includes native script."""
        assert "Français" in LANGUAGE_NAMES["fr"]

    def test_chinese_simplified_name_includes_native(self):
        """Test that Simplified Chinese includes native script."""
        assert "简体中文" in LANGUAGE_NAMES["zh-CN"]

    def test_japanese_name_includes_native(self):
        """Test that Japanese includes native script."""
        assert "日本語" in LANGUAGE_NAMES["ja"]


class TestGetLanguageInstruction:
    """Test get_language_instruction function."""

    def test_english_returns_empty_string(self):
        """Test that English returns no instruction (empty string)."""
        result = get_language_instruction("en")
        assert result == ""

    def test_english_with_content_types_returns_empty(self):
        """Test that English returns empty even with content_types."""
        result = get_language_instruction("en", "titles, descriptions")
        assert result == ""

    def test_french_returns_instruction(self):
        """Test that French returns a non-empty instruction."""
        result = get_language_instruction("fr")
        assert result != ""
        assert "French" in result
        assert "Français" in result

    def test_chinese_returns_instruction(self):
        """Test that Simplified Chinese returns correct instruction."""
        result = get_language_instruction("zh-CN")
        assert result != ""
        assert "Chinese" in result
        assert "简体中文" in result

    def test_instruction_contains_output_language_header(self):
        """Test that instruction contains Output Language header."""
        result = get_language_instruction("fr")
        assert "**Output Language**:" in result

    def test_instruction_contains_critical_requirement(self):
        """Test that instruction contains CRITICAL LANGUAGE REQUIREMENT."""
        result = get_language_instruction("ja")
        assert "CRITICAL LANGUAGE REQUIREMENT" in result

    def test_instruction_mentions_json_keys_unchanged(self):
        """Test that instruction mentions JSON keys remain in English."""
        result = get_language_instruction("ko")
        assert "JSON keys remain in English" in result

    def test_instruction_mentions_technical_terms_unchanged(self):
        """Test that instruction mentions technical terms remain unchanged."""
        result = get_language_instruction("de")
        assert "Technical terms" in result or "technical" in result.lower()

    def test_default_content_types(self):
        """Test that default content types are used when not specified."""
        result = get_language_instruction("fr")
        assert "titles" in result
        assert "descriptions" in result
        assert "rationales" in result

    def test_custom_content_types(self):
        """Test that custom content types are included in instruction."""
        custom_types = "vision, roadmap phases, feature names"
        result = get_language_instruction("es", custom_types)
        assert custom_types in result

    def test_unknown_language_code_uses_code_as_name(self):
        """Test that unknown language codes use the code itself as the name."""
        result = get_language_instruction("xx-unknown")
        assert result != ""
        assert "xx-unknown" in result

    def test_instruction_not_translate_proper_nouns(self):
        """Test that instruction mentions not translating proper nouns."""
        result = get_language_instruction("pt")
        assert "proper nouns" in result.lower() or "library names" in result.lower()


class TestLanguageInstructionIntegration:
    """Integration tests for language instruction usage."""

    def test_all_supported_languages_return_instructions(self):
        """Test that all languages except English return instructions."""
        for lang_code in LANGUAGE_NAMES:
            result = get_language_instruction(lang_code)
            if lang_code == "en":
                assert result == "", f"English should return empty, got: {result[:50]}..."
            else:
                assert result != "", f"Language {lang_code} should return instruction"
                assert LANGUAGE_NAMES[lang_code] in result

    def test_instruction_format_consistency(self):
        """Test that all non-English instructions have consistent format."""
        for lang_code in LANGUAGE_NAMES:
            if lang_code == "en":
                continue
            result = get_language_instruction(lang_code)
            # All instructions should have these elements
            assert "**Output Language**:" in result
            assert "CRITICAL LANGUAGE REQUIREMENT" in result
            assert "JSON keys" in result
