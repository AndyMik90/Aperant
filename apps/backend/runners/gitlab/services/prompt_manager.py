"""
Prompt Manager
==============

Centralized prompt template management for GitLab workflows.
Ported from GitHub with GitLab-specific adaptations.
"""

from __future__ import annotations

from pathlib import Path

try:
    from ..models import ReviewPass
except (ImportError, ValueError, SystemError):
    from models import ReviewPass


class PromptManager:
    """Manages all prompt templates for GitLab automation workflows."""

    def __init__(self, prompts_dir: Path | None = None):
        """
        Initialize PromptManager.

        Args:
            prompts_dir: Optional directory containing custom prompt files
        """
        self.prompts_dir = prompts_dir or (
            Path(__file__).parent.parent.parent.parent / "prompts" / "gitlab"
        )

    def get_review_pass_prompt(self, review_pass: ReviewPass) -> str:
        """Get the specialized prompt for each review pass.

        For now, falls back to the main MR review prompt. Pass-specific
        prompts can be added later by creating files named:
        - prompts/gitlab/review_pass_quick_scan.md
        - prompts/gitlab/review_pass_security.md
        - prompts/gitlab/review_pass_full.md

        The filename must match the enum value (review_pass.value), e.g.,
        "quick_scan", "security", "full", etc.
        """
        # Try pass-specific prompt file first
        # Use enum value (e.g., "quick_scan", "security") for filename
        pass_prompt_file = self.prompts_dir / f"review_pass_{review_pass.value}.md"
        if pass_prompt_file.exists():
            try:
                return pass_prompt_file.read_text(encoding="utf-8")
            except OSError:
                # Fall through to default MR prompt on read error
                pass

        # Fallback to main MR review prompt
        return self.get_mr_review_prompt()

    def get_mr_review_prompt(self) -> str:
        """Get the main MR review prompt."""
        prompt_file = self.prompts_dir / "mr_reviewer.md"
        if prompt_file.exists():
            return prompt_file.read_text(encoding="utf-8")
        return self._get_default_mr_review_prompt()

    def _get_default_mr_review_prompt(self) -> str:
        """Default MR review prompt if file doesn't exist."""
        return """# MR Review Agent

You are an AI code reviewer for GitLab. Analyze the provided merge request and identify:

1. **Security Issues** - vulnerabilities, injection risks, auth problems
2. **Code Quality** - complexity, duplication, error handling
3. **Style Issues** - naming, formatting, patterns
4. **Test Coverage** - missing tests, edge cases
5. **Documentation** - missing/outdated docs

For each finding, output a JSON array:

```json
[
  {
    "id": "finding-1",
    "severity": "critical|high|medium|low",
    "category": "security|quality|style|test|docs|pattern|performance",
    "title": "Brief issue title",
    "description": "Detailed explanation",
    "file": "path/to/file.ts",
    "line": 42,
    "suggested_fix": "Optional code or suggestion",
    "fixable": true
  }
]
```

Be specific and actionable. Focus on significant issues, not nitpicks.
"""

    def get_followup_review_prompt(self) -> str:
        """Get the follow-up MR review prompt."""
        prompt_file = self.prompts_dir / "mr_followup.md"
        if prompt_file.exists():
            return prompt_file.read_text(encoding="utf-8")
        return self._get_default_followup_review_prompt()

    def _get_default_followup_review_prompt(self) -> str:
        """Default follow-up review prompt if file doesn't exist."""
        return """# MR Follow-up Review Agent

You are performing a focused follow-up review of a merge request. The MR has already received an initial review.

Your tasks:
1. Check if previous findings have been resolved
2. Review only the NEW changes since last review
3. Determine merge readiness

For each previous finding, determine:
- RESOLVED: The issue was fixed
- UNRESOLVED: The issue remains

For new issues in the diff, report them with:
- severity: critical|high|medium|low
- category: security|quality|logic|test
- title, description, file, line, suggested_fix

Output JSON:
```json
{
  "finding_resolutions": [
    {"finding_id": "prev-1", "status": "resolved", "resolution_notes": "Fixed with parameterized query"}
  ],
  "new_findings": [
    {"id": "new-1", "severity": "high", "category": "security", "title": "...", "description": "...", "file": "...", "line": 42}
  ],
  "verdict": "READY_TO_MERGE|MERGE_WITH_CHANGES|NEEDS_REVISION|BLOCKED",
  "verdict_reasoning": "Explanation of the verdict"
}
```
"""

    def get_triage_prompt(self) -> str:
        """Get the issue triage prompt."""
        prompt_file = self.prompts_dir / "issue_triager.md"
        if prompt_file.exists():
            return prompt_file.read_text(encoding="utf-8")
        return self._get_default_triage_prompt()

    def _get_default_triage_prompt(self) -> str:
        """Default triage prompt if file doesn't exist."""
        return """# Issue Triage Agent

You are an issue triage assistant for GitLab. Analyze the GitLab issue and classify it.

Determine:
1. **Category**: bug, feature, question, duplicate, spam, invalid, wontfix
2. **Priority**: high, medium, low
3. **Is Duplicate?**: Check against potential duplicates list
4. **Is Spam?**: Check for promotional content, gibberish, abuse
5. **Is Feature Creep?**: Multiple unrelated features in one issue

Output JSON:

```json
{
  "category": "bug|feature|question|duplicate|spam|invalid|wontfix",
  "confidence": 0.0-1.0,
  "priority": "high|medium|low",
  "labels_to_add": ["type:bug", "priority:high"],
  "is_duplicate": false,
  "duplicate_of": null,
  "is_spam": false,
  "reasoning": "Brief explanation of your classification",
  "comment": "Optional bot comment"
}
```

Note on issue references:
- Use the issue `iid` (internal ID) for duplicates, not the database `id`
- For example: "duplicate_of": 123 refers to issue !123 in GitLab
"""
