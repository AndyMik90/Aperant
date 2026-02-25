"""
Prompt Manager
==============

Centralized prompt template management for GitHub workflows.
"""

from __future__ import annotations

from pathlib import Path

try:
    from ..models import ReviewPass
except (ImportError, ValueError, SystemError):
    from models import ReviewPass


class PromptManager:
    """Manages all prompt templates for GitHub automation workflows."""

    def __init__(self, prompts_dir: Path | None = None):
        """
        Initialize PromptManager.

        Args:
            prompts_dir: Optional directory containing custom prompt files
        """
        self.prompts_dir = prompts_dir or (
            Path(__file__).parent.parent.parent.parent / "prompts" / "github"
        )

    def get_review_pass_prompt(self, review_pass: ReviewPass) -> str:
        """Get the specialized prompt for each review pass."""
        prompts = {
            ReviewPass.QUICK_SCAN: """
Quickly scan this PR with PRELIMINARY VERIFICATION:

1. **What is the claimed purpose?** (from PR title/description)
2. **Does the code match the claimed purpose?**
   - If it claims to fix a bug, does it address the root cause?
   - If it adds a feature, is that feature actually implemented?
   - If it claims to add a file path, does that path appear to be valid?
3. **Are there obvious red flags?**
   - Adding paths that may not exist
   - Adding dependencies without using them
   - Duplicate code/logic already in the codebase
   - Claims without evidence (no tests, no demonstration)
4. **Which areas need careful review?** (security-sensitive, complex logic, external integrations)

Output a brief JSON summary:
```json
{
    "purpose": "Brief description of what this PR claims to do",
    "actual_changes": "Brief description of what the code actually does",
    "purpose_match": true|false,
    "purpose_match_note": "Explanation if purpose doesn't match actual changes",
    "risk_areas": ["Area 1", "Area 2"],
    "red_flags": ["Flag 1", "Flag 2"],
    "requires_deep_verification": true|false,
    "complexity": "low|medium|high"
}
```

**Example with Red Flags**:
```json
{
    "purpose": "Fix FileNotFoundError for claude command",
    "actual_changes": "Adds new file path to search array",
    "purpose_match": false,
    "purpose_match_note": "PR adds path '~/.claude/local/claude' but doesn't provide evidence this path exists or is documented. Existing correct path already present at line 75.",
    "risk_areas": ["File path validation", "CLI detection"],
    "red_flags": [
        "Undocumented file path added without verification",
        "Possible duplicate of existing path logic",
        "No test or evidence that this path is valid"
    ],
    "requires_deep_verification": true,
    "complexity": "low"
}
```
""",
            ReviewPass.SECURITY: """
You are a security specialist. Focus ONLY on security issues:
- Injection vulnerabilities (SQL, XSS, command injection)
- Authentication/authorization flaws
- Sensitive data exposure
- SSRF, CSRF, path traversal
- Insecure deserialization
- Cryptographic weaknesses
- Hardcoded secrets or credentials
- Unsafe file operations

Only report HIGH CONFIDENCE security findings.

Output JSON array of findings:
```json
[
  {
    "id": "finding-1",
    "severity": "critical|high|medium|low",
    "category": "security",
    "title": "Brief issue title",
    "description": "Detailed explanation of the security risk",
    "file": "path/to/file.ts",
    "line": 42,
    "suggested_fix": "How to fix this vulnerability",
    "fixable": true
  }
]
```
""",
            ReviewPass.QUALITY: """
You are a code quality expert. Focus on quality issues with REDUNDANCY DETECTION:

**CRITICAL: REDUNDANCY & DUPLICATION CHECKS**
Before analyzing quality, check for redundant code:
1. **Is this code already present elsewhere?**
   - Similar logic in other files/functions
   - Duplicate paths, imports, or configurations
   - Re-implementation of existing utilities
2. **Does this duplicate existing functionality?**
   - Check if the same problem is already solved
   - Look for similar patterns in the codebase
   - Verify this isn't adding a second solution to the same problem

**QUALITY ANALYSIS**
After redundancy checks, analyze:
- Code complexity and maintainability
- Error handling completeness
- Test coverage for new code
- Pattern adherence and consistency
- Resource management (leaks, cleanup)
- Code duplication within the PR itself
- Performance anti-patterns

Only report issues that meaningfully impact quality.

**CRITICAL**: If you find redundant code that duplicates existing functionality, mark severity as "high" with category "redundancy".

Output JSON array of findings:
```json
[
  {
    "id": "finding-1",
    "severity": "high|medium|low",
    "category": "redundancy|quality|test|performance|pattern",
    "title": "Brief issue title",
    "description": "Detailed explanation",
    "file": "path/to/file.ts",
    "line": 42,
    "suggested_fix": "Optional code or suggestion",
    "fixable": false,
    "redundant_with": "Optional: path/to/existing/code.ts:75 if redundant"
  }
]
```

**Example Redundancy Finding**:
```json
{
  "id": "redundancy-1",
  "severity": "high",
  "category": "redundancy",
  "title": "Duplicate path already exists in codebase",
  "description": "Adding path '~/.claude/local/claude' but similar path '~/.local/bin/claude' already exists at line 75 of the same file",
  "file": "changelog-service.ts",
  "line": 76,
  "suggested_fix": "Remove duplicate path. Use existing path at line 75 instead.",
  "fixable": true,
  "redundant_with": "changelog-service.ts:75"
}
```
""",
            ReviewPass.DEEP_ANALYSIS: """
You are an expert software architect. Perform deep analysis with CRITICAL VERIFICATION FIRST:

**PHASE 1: REQUIREMENT VERIFICATION (CRITICAL - DO NOT SKIP)**
If this is a bug fix or feature PR, answer these questions:
1. **Does this PR actually solve the stated problem?**
   - For bug fixes: Would removing this change cause the bug to return?
   - For features: Does this implement the requested functionality?
2. **Is there evidence the solution works?**
   - Are there tests that verify the fix/feature?
   - Does the PR description demonstrate the solution?
3. **Are there redundant or duplicate implementations?**
   - Does similar code already exist elsewhere in the codebase?
   - Is this PR adding duplicate paths, imports, or logic?

**PHASE 2: PATH & DEPENDENCY VALIDATION**
4. **Do all referenced paths actually exist?**
   - File paths in code (especially for CLIs, configs, binaries)
   - Import statements and module references
   - External dependencies and packages
5. **Are new dependencies necessary and legitimate?**
   - Do they come from official sources?
   - Are they actually used in the code?

**PHASE 3: DEEP ANALYSIS**
Continue with traditional deep analysis:
- Business logic correctness
- Edge cases and error scenarios
- Integration with existing systems
- Potential race conditions
- State management issues
- Data flow integrity
- Architectural consistency

**CRITICAL**: If you cannot verify requirements (Phase 1) or paths (Phase 2), mark severity as "critical" with category "verification_failed".

Output JSON array of findings:
```json
[
  {
    "id": "finding-1",
    "severity": "critical|high|medium|low",
    "category": "verification_failed|redundancy|quality|pattern|performance",
    "confidence": 0.0-1.0,
    "title": "Brief issue title",
    "description": "Detailed explanation of the issue",
    "file": "path/to/file.ts",
    "line": 42,
    "suggested_fix": "How to address this",
    "fixable": false,
    "verification_note": "What evidence is missing or what could not be verified"
  }
]
```

**Example Critical Finding**:
```json
{
  "id": "verify-1",
  "severity": "critical",
  "category": "verification_failed",
  "confidence": 0.95,
  "title": "Cannot verify file path exists",
  "description": "PR adds path '~/.claude/local/claude' but this path is not documented in official Claude installation and may not exist on user systems",
  "file": "path/to/file.ts",
  "line": 75,
  "suggested_fix": "Verify path exists on target systems before adding. Check official documentation.",
  "fixable": true,
  "verification_note": "No evidence provided that this path is valid. Existing code already has correct path at line 75."
}
```
""",
            ReviewPass.STRUCTURAL: """
You are a senior software architect reviewing this PR for STRUCTURAL issues.

Focus on:
1. **Feature Creep**: Does the PR do more than its title/description claims?
2. **Scope Coherence**: Are all changes working toward the same goal?
3. **Architecture Alignment**: Does this follow established codebase patterns?
4. **PR Structure**: Is this appropriately sized? Should it be split?

Output JSON array of structural issues:
```json
[
  {
    "id": "struct-1",
    "issue_type": "feature_creep|scope_creep|architecture_violation|poor_structure",
    "severity": "critical|high|medium|low",
    "title": "Brief issue title (max 80 chars)",
    "description": "What the structural problem is",
    "impact": "Why this matters (maintenance, review quality, risk)",
    "suggestion": "How to address this"
  }
]
```
""",
            ReviewPass.AI_COMMENT_TRIAGE: """
You are triaging comments from other AI code review tools (CodeRabbit, Gemini Code Assist, Cursor, Greptile, etc).

**CRITICAL: TIMELINE AWARENESS**
AI comments were made at specific points in time. The current code may have FIXED issues that AI tools correctly identified.
- If an AI flagged an issue that was LATER FIXED by a commit, use ADDRESSED (not FALSE_POSITIVE)
- FALSE_POSITIVE means the AI was WRONG - the issue never existed
- ADDRESSED means the AI was RIGHT - the issue existed but was fixed

For each AI comment, determine:
- CRITICAL: Genuine issue that must be addressed before merge
- IMPORTANT: Valid issue that should be addressed
- NICE_TO_HAVE: Valid but optional improvement
- TRIVIAL: Style preference, can be ignored
- ADDRESSED: Valid issue that was fixed in a subsequent commit
- FALSE_POSITIVE: The AI is wrong about this (issue never existed)

Output JSON array:
```json
[
  {
    "comment_id": 12345678,
    "tool_name": "CodeRabbit",
    "original_summary": "Brief summary of what AI flagged (max 100 chars)",
    "verdict": "critical|important|nice_to_have|trivial|addressed|false_positive",
    "reasoning": "2-3 sentence explanation of your verdict",
    "response_comment": "Concise reply to post on GitHub"
  }
]
```
""",
        }
        return prompts.get(review_pass, "")

    def get_pr_review_prompt(self) -> str:
        """Get the main PR review prompt."""
        prompt_file = self.prompts_dir / "pr_reviewer.md"
        if prompt_file.exists():
            return prompt_file.read_text(encoding="utf-8")
        return self._get_default_pr_review_prompt()

    def _get_default_pr_review_prompt(self) -> str:
        """Default PR review prompt if file doesn't exist."""
        return """# PR Review Agent

You are an AI code reviewer. Analyze the provided pull request and identify:

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
        """Get the follow-up PR review prompt."""
        prompt_file = self.prompts_dir / "pr_followup.md"
        if prompt_file.exists():
            return prompt_file.read_text(encoding="utf-8")
        return self._get_default_followup_review_prompt()

    def _get_default_followup_review_prompt(self) -> str:
        """Default follow-up review prompt if file doesn't exist."""
        return """# PR Follow-up Review Agent

You are performing a focused follow-up review of a pull request. The PR has already received an initial review.

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

You are an issue triage assistant. Analyze the GitHub issue and classify it.

Determine:
1. **Category**: bug, feature, documentation, question, duplicate, spam, feature_creep
2. **Priority**: high, medium, low
3. **Is Duplicate?**: Check against potential duplicates list
4. **Is Spam?**: Check for promotional content, gibberish, abuse
5. **Is Feature Creep?**: Multiple unrelated features in one issue

Output JSON:

```json
{
  "category": "bug|feature|documentation|question|duplicate|spam|feature_creep",
  "confidence": 0.0-1.0,
  "priority": "high|medium|low",
  "labels_to_add": ["type:bug", "priority:high"],
  "labels_to_remove": [],
  "is_duplicate": false,
  "duplicate_of": null,
  "is_spam": false,
  "is_feature_creep": false,
  "suggested_breakdown": ["Suggested issue 1", "Suggested issue 2"],
  "comment": "Optional bot comment"
}
```
"""
