"""
Language utilities for AI-generated content localization.

Provides language name mapping and prompt instruction generation
for localizing AI output to different languages.
"""

# Language code to display name mapping for AI prompts
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "fr": "French (Français)",
    "zh-CN": "Simplified Chinese (简体中文)",
    "zh-TW": "Traditional Chinese (繁體中文)",
    "ja": "Japanese (日本語)",
    "ko": "Korean (한국어)",
    "es": "Spanish (Español)",
    "de": "German (Deutsch)",
    "pt": "Portuguese (Português)",
    "ru": "Russian (Русский)",
}


def get_language_instruction(language: str, content_types: str = "") -> str:
    """Get the language instruction to inject into AI prompts.

    Args:
        language: Language code (e.g., "en", "zh-CN", "fr")
        content_types: Optional description of content types being generated
                      (e.g., "titles, descriptions, rationales")

    Returns:
        Empty string for English (default), otherwise returns
        a detailed instruction for the AI to generate content in the target language.
    """
    if language == "en":
        return ""

    lang_name = LANGUAGE_NAMES.get(language, language)

    # Default content types if not specified
    if not content_types:
        content_types = "titles, descriptions, rationales"

    return f"""
**Output Language**: {lang_name}

CRITICAL LANGUAGE REQUIREMENT:
- ALL generated content ({content_types}) MUST be in {lang_name}
- JSON keys remain in English (id, title, description, type, etc.)
- Only VALUES should be in {lang_name}
- Technical terms (file paths, code snippets, function names) remain unchanged
- Do NOT translate proper nouns, library names, or technical identifiers
"""
