# GitHub Issues Customization Guide

> Extend and customize the GitHub Issues integration for your specific needs

**Last updated:** 2026-02-20
**Audience:** Developers extending Auto Claude | **Prerequisites:** [Advanced AI Configuration](github-issues-advanced-ai-configuration.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Prompt System Architecture](#prompt-system-architecture)
3. [Context Injection System](#context-injection-system)
4. [Customizing Agent Prompts](#customizing-agent-prompts)
5. [Context Configuration](#context-configuration)
6. [Adding Custom Specialists](#adding-custom-specialists)
7. [Extending the Integration](#extending-the-integration)
8. [Examples & Recipes](#examples--recipes)

---

## Overview

This guide is for developers who want to extend, customize, or integrate with Auto Claude's GitHub Issues investigation system.

### Who This Guide Is For

- **Auto Claude contributors** adding new features to the GitHub integration
- **Internal teams** customizing investigations for their codebase
- **Integration developers** connecting Auto Claude to other systems
- **Prompt engineers** tuning agent behavior

### What You'll Learn

- How the prompt system works
- How context is built and injected into prompts
- How to modify specialist prompts
- How to add custom investigation specialists
- How to extend the integration

### Assumptions

- You're comfortable with Python and TypeScript
- You've read the [User Guide](github-issues-user-guide.md) and [Advanced AI Config](github-issues-advanced-ai-configuration.md)
- You're familiar with Auto Claude's architecture (see [CLAUDE.md](../CLAUDE.md))

---

## Prompt System Architecture

### Prompt Location

Investigation prompts are stored in:
```
apps/backend/prompts/github/
├── investigation_root_cause.md
├── investigation_impact.md
├── investigation_fix_advice.md
└── investigation_reproduction.md
```

### Prompt Structure

Each prompt uses XML tags (not markdown headers):

```xml
<role>
You are a [specialist name] specializing in [purpose].
</role>

<mission>
Your task is to [specific task description].
</mission>

<available_context>
You will receive:
- Issue details
- Repository context
- Code search results
- [specialist-specific context]
</available_context>

<investigation_process>
<step_1>
<title>[Step name]</title>
- [Instruction 1]
- [Instruction 2]
</step_1>
...
</investigation_process>

<output_format>
[Expected output format, often JSON or structured text]
</output_format>

<constraints>
- [Constraint 1]
- [Constraint 2]
</constraints>
```

### Prompt Building

Prompts are built by the orchestrator via `_build_specialist_prompt()` which:
1. Loads the prompt file
2. Appends working directory context
3. Appends issue context
4. Returns the complete prompt

No variable substitution occurs—context is appended as formatted text.

---

## Context Injection System

### Context Builder

**Location:** `apps/backend/runners/github/services/issue_investigation_orchestrator.py`

**Purpose:** Context is built via the `_build_issue_context()` method which:
1. Parses the issue
2. Searches codebase for relevant files
3. Extracts code snippets
4. Builds structured context object

### Context Flow

```mermaid
graph TD
    Issue[Issue Details from GitHub] --> CB[Context Builder]
    Repo[Repository Analysis] --> CB
    Code[Code Search Results] --> CB
    CB --> CO[Context Object]
    CO --> RCA[Root Cause Specialist]
    CO --> IA[Impact Specialist]
    CO --> FA[Fix Advisor Specialist]
    CO --> Rep[Reproducer Specialist]

    style Issue fill:#ffe1f5
    style Repo fill:#e1f5ff
    style Code fill:#fff4e1
    style CB fill:#f3e5f5
    style CO fill:#fff4e1
    style RCA fill:#e8f5e9
    style IA fill:#e8f5e9
    style FA fill:#e8f5e9
    style Rep fill:#e8f5e9
```

### Context Structure

```python
class InvestigationContext:
    """Context passed to each specialist."""

    issue: IssueDetails  # Title, description, comments
    repo: RepositoryContext  # Path, structure, main files
    code: List[CodeSnippet]  # Relevant code files
    specialist_config: SpecialistConfig  # Per-specialist settings

class IssueDetails:
    title: str
    description: str
    comments: List[Comment]
    labels: List[str]
    images: List[str]  # Image URLs extracted from markdown and HTML
    author: str
    created_at: datetime

class RepositoryContext:
    path: str
    structure: Dict[str, Any]  # Directory tree
    main_files: List[str]  # Key files (package.json, etc.)
    git_info: GitInfo

class CodeSnippet:
    file_path: str
    content: str
    language: str
    relevance_score: float  # How relevant to the issue
```

### Customizing Context

**1. Add Custom Context Sources**

Edit `issue_investigation_orchestrator.py`:

```python
def build_context(issue: Issue, repo_path: str) -> InvestigationContext:
    """Build investigation context."""
    context = InvestigationContext()

    # Standard context
    context.issue = parse_issue(issue)
    context.repo = analyze_repo(repo_path)
    context.code = search_relevant_code(issue, repo_path)

    # Custom context sources
    context.docs = search_documentation(issue, repo_path)
    context.tests = find_related_tests(issue, repo_path)
    context.similar_issues = find_similar_issues(issue)

    return context
```

**2. Filter Code Results**

```python
def search_relevant_code(
    issue: Issue,
    repo_path: str,
    max_files: int = 20
) -> List[CodeSnippet]:
    """Search for code relevant to the issue."""
    results = code_search.search(issue.keywords, repo_path)

    # Filter by relevance
    filtered = [r for r in results if r.relevance_score > 0.7]

    # Limit to top N files
    return sorted(filtered, key=lambda x: x.relevance_score)[:max_files]
```

**3. Add Specialist-Specific Context**

```python
def build_specialist_context(
    specialist: str,
    base_context: InvestigationContext
) -> dict:
    """Add specialist-specific context."""
    context = base_context.dict()

    if specialist == "root_cause":
        context["focus"] = "error_sources"
        context["include_tests"] = True

    elif specialist == "impact":
        context["focus"] = "api_surfaces"
        context["include_dependencies"] = True

    return context
```

---

## Customizing Agent Prompts

### Finding Prompt Files

Prompts are in `apps/backend/prompts/github/`:

```bash
$ ls apps/backend/prompts/github/
investigation_root_cause.md
investigation_impact.md
investigation_fix_advice.md
investigation_reproduction.md
```

### Prompt Context Reference

Context is appended to prompts (not substituted):

| Context | Type | Description |
|---------|------|-------------|
| Issue details | string | Issue title and body |
| Issue comments | list | All issue comments |
| **Images** | list | Image URLs extracted from markdown and HTML |
| Working directory | string | Repository path |
| Code context | string | Relevant code snippets |
| Token limit | int | Max tokens for this specialist |
| Model | string | Model name (e.g., "claude-opus-4-6") |

### Modifying a Prompt

**Example: Enhance Root Cause Analyzer**

Edit `apps/backend/prompts/github/investigation_root_cause.md`:

```xml
<role>
You are a root cause analysis specialist. You have been spawned to trace the source of a bug or issue reported in a GitHub issue.
</role>

<mission>
Identify the root cause of the reported issue by tracing through the codebase. Find the exact code path from entry point to the underlying problem.
</mission>

<available_context>
The issue context below includes:
- Issue title, description, labels, and comments
- Recent git commits (last 20 commits) - USE THESE to identify recent changes that may have introduced the bug
</available_context>

<image_analysis>
If the issue context includes an "Images" section with screenshot URLs:
- Treat these as PRIMARY EVIDENCE - screenshots often show the actual bug manifestation
- Use image URLs to understand visual bugs, UI issues, error messages, or crash screens
- When the issue description is vague but screenshots are provided, prioritize the visual evidence
- Describe what you see in the images in your evidence section (e.g., "Screenshot shows X component displaying incorrectly")
- If the screenshot shows an error message, trace that error in the codebase
</image_analysis>

<investigation_process>
<step_1>
<title>Understand the Issue</title>
- Check the Images section first - screenshots may show the actual bug
- Read the issue title and description carefully
- Identify the reported symptoms (error messages, unexpected behavior, crashes)
- Note any file paths, stack traces, or code references mentioned
- If screenshots are provided, describe the visual evidence you observe
</step_1>
...
</investigation_process>

<output_format>
Provide your analysis as structured output with:
- identified_root_cause: Clear description of what causes the issue
- code_paths: Ordered list of code locations from entry point to root cause
- confidence: Your confidence level (high/medium/low)
- evidence: Code snippets and traces supporting your analysis
- related_issues: Known issue patterns this matches
- likely_already_fixed: True if evidence suggests the issue is already resolved
</output_format>
```

### Testing Prompt Changes

1. **Save the modified prompt**
2. **Restart Auto Claude** (prompts are loaded at startup)
3. **Run an investigation** on a test issue
4. **Review the output** to verify changes work as expected

### Creating Custom Prompts

**Example: Security-Focused Root Cause Analyzer**

Create `apps/backend/prompts/github/investigation_security.md`:

```xml
<role>
You are a Security Specialist analyzing issues for security vulnerabilities.
</role>

<mission>
Identify security vulnerabilities including:
- SQL injection
- XSS attacks
- Authentication/authorization bypasses
- Sensitive data exposure
- Injection attacks
</mission>

<investigation_process>
<step_1>
<title>Security Analysis</title>
1. Prioritize security-relevant code
2. Check for OWASP Top 10 vulnerabilities
3. Analyze authentication and authorization flows
4. Review data handling and sanitization
5. Identify sensitive data exposure
</step_1>
</investigation_process>

<output_format>
{
  "security_findings": ["list of security issues"],
  "severity": "critical/high/medium/low",
  "cwe_ids": ["list of relevant CWE IDs"],
  "remediation": "security-focused fix recommendations"
}
</output_format>
```

---

## Context Configuration

### File Selection Patterns

Control which files are included in context via `issue_investigation_orchestrator.py`:

```python
# File selection patterns
FILE_PATTERNS = {
    "include": [
        "*.py",
        "*.ts",
        "*.tsx",
        "*.js",
        "*.json",
        "package.json",
        "requirements.txt",
    ],
    "exclude": [
        "*.test.*",
        "*.spec.*",
        "node_modules/**",
        ".venv/**",
        "__pycache__/**",
        "dist/**",
        "build/**",
    ]
}
```

**Customize for Your Project:**

```python
# In your project's .auto-claude/config.json
{
  "context": {
    "include_patterns": [
      "src/**/*.py",
      "apps/backend/**/*.py"
    ],
    "exclude_patterns": [
      "**/test_*.py",
      "**/*.test.ts",
      "node_modules/**"
    ],
    "max_files": 30,
    "max_file_size": 50000  # 50KB
  }
}
```

### Context Window Management

**Token Budgeting:**

```python
def allocate_context_tokens(total_tokens: int) -> dict:
    """Allocate tokens across context sources."""
    return {
        "issue": min(2000, total_tokens * 0.1),
        "code": min(10000, total_tokens * 0.5),
        "repo": min(3000, total_tokens * 0.15),
        "comments": min(2000, total_tokens * 0.1),
        "reserved": total_tokens * 0.15  # For output
    }
```

**Context Pruning:**

```python
def prune_context(context: dict, max_tokens: int) -> dict:
    """Prune context to fit token budget."""
    # Calculate current token count
    current_tokens = count_tokens(context)

    if current_tokens <= max_tokens:
        return context

    # Prune least relevant items
    context["code"] = context["code"][:int(len(context["code"]) * 0.7)]
    context["comments"] = context["comments"][:3]

    return context
```

### Repository Context Settings

**Auto-Discovery:**

```python
def discover_repo_structure(repo_path: str) -> dict:
    """Discover repository structure and key files."""
    return {
        "type": detect_project_type(repo_path),  # python, node, etc.
        "framework": detect_framework(repo_path),  # django, react, etc.
        "main_files": find_main_files(repo_path),
        "entry_points": find_entry_points(repo_path),
        "config_files": find_config_files(repo_path),
    }
```

**Custom Discovery Rules:**

```python
# In .auto-claude/config.json
{
  "repo": {
    "type": "python",
    "main_files": [
      "apps/backend/main.py",
      "apps/backend/cli.py"
    ],
    "entry_points": [
      "apps/backend/api/",
      "apps/backend/agents/"
    ],
    "test_dirs": [
      "tests/",
      "apps/backend/tests/"
    ]
  }
}
```

---

## Adding Custom Specialists

### Specialist Definition

Each specialist is defined in:

**Backend:** `apps/backend/runners/github/services/issue_investigation_orchestrator.py`
**Prompt:** `apps/backend/prompts/github/{specialist_name}.md`

### Step 1: Create the Prompt

Create `apps/backend/prompts/github/investigation_performance.md`:

```xml
<role>
You are a Performance Analyst specializing in software performance optimization.
</role>

<mission>
Analyze GitHub issues for performance problems and provide optimization recommendations.
</mission>

<available_context>
[Standard context variables]
</available_context>

<investigation_process>
<step_1>
<title>Performance Analysis</title>
1. Identify performance bottlenecks
2. Analyze algorithmic complexity
3. Check for N+1 queries
4. Review caching strategies
5. Suggest optimizations
</step_1>
</investigation_process>

<output_format>
{
  "performance_issues": ["list of issues"],
  "bottlenecks": ["identified bottlenecks"],
  "optimization_suggestions": [
    {
      "issue": "description",
      "solution": "recommended fix",
      "expected_improvement": "estimate"
    }
  ],
  "complexity_analysis": "algorithmic complexity assessment"
}
</output_format>
```

### Step 2: Register the Specialist

Edit `apps/backend/runners/github/services/issue_investigation_orchestrator.py`:

```python
# Add to SPECIALISTS dictionary
SPECIALISTS = {
    "root_cause": {
        "name": "Root Cause Analyzer",
        "prompt": "prompts/github/investigation_root_cause.md",
        "max_tokens": 63_999,
    },
    "impact": {
        "name": "Impact Assessor",
        "prompt": "prompts/github/investigation_impact.md",
        "max_tokens": 31_999,
    },
    # ... existing specialists ...

    # New specialist
    "performance": {
        "name": "Performance Analyzer",
        "prompt": "prompts/github/investigation_performance.md",
        "max_tokens": 31_999,
        "optional": True,  # Not run by default
    }
}
```

### Step 3: Register in the Orchestrator

Specialists are registered as `SpecialistConfig` objects and run via the SDK session infrastructure:

```python
# In issue_investigation_orchestrator.py
from .parallel_agent_base import SpecialistConfig

# Add to INVESTIGATION_SPECIALISTS list
INVESTIGATION_SPECIALISTS = [
    SpecialistConfig(
        name="root_cause",
        prompt_file="investigation_root_cause.md",
        tools=["Read", "Grep", "Glob"],
    ),
    # ... existing specialists ...
    SpecialistConfig(
        name="performance",
        prompt_file="investigation_performance.md",
        tools=["Read", "Grep", "Glob"],
    ),
]

# Add token limit
SPECIALIST_MAX_TOKENS["performance"] = 31_999
```

The orchestrator automatically handles SDK client creation, stream processing, and structured output extraction via `_run_specialist_session()` in `parallel_agent_base.py`.

### Step 4: Update Frontend (Optional)

If you want the specialist to appear in the UI:

Edit `apps/frontend/src/renderer/components/github-issues/InvestigationProgress.tsx`:

```typescript
const SPECIALIST_DISPLAY = {
  root_cause: { name: "Root Cause Analyzer", icon: "🔍" },
  impact: { name: "Impact Assessor", icon: "📊" },
  // ... existing specialists ...

  // New specialist
  performance: { name: "Performance Analyzer", icon: "⚡" },
};
```

---

## Extending the Integration

> **Note:** The investigation system currently runs via `issue_investigation_orchestrator.py`. Extension points are limited to modifying the orchestrator directly or creating new specialists.

### Modifying the Orchestrator

To extend investigations, edit `apps/backend/runners/github/services/issue_investigation_orchestrator.py`:

```python
# Add custom logic to _build_issue_context()
def _build_issue_context(self, issue: Issue) -> dict:
    context = base_context
    # Add your custom context here
    return context
```

---

## Examples & Recipes

> **Note:** All recipes below are example code showing how to extend the system. These are not built-in features—you would need to implement them yourself by modifying the orchestrator.

### Recipe 1: Add Project-Specific Context

**Goal:** Include project documentation in investigations

```python
# In issue_investigation_orchestrator.py
def _build_issue_context(self, issue: Issue) -> dict:
    """Build investigation context with project docs."""
    context = base_context

    # Add project-specific context
    context["docs"] = self._search_docs(issue)
    context["architecture"] = self._load_architecture_docs()
    context["contributing"] = self._load_contributing_guide()

    return context
```

### Recipe 2: Custom Severity Calculation

**Goal:** Calculate severity based on team-specific rules

```python
# In issue_investigation_orchestrator.py
def _calculate_severity(self, report: InvestigationReport) -> str:
    """Calculate severity based on custom rules."""
    score = 0

    # Impact score
    if report.impact.user_count > 1000:
        score += 3
    elif report.impact.user_count > 100:
        score += 2

    # Component criticality
    if report.impact.component in ["auth", "payment", "api"]:
        score += 3

    # Error type
    if "security" in report.root_cause.tags:
        score += 5

    if score >= 8:
        return "critical"
    elif score >= 5:
        return "high"
    elif score >= 3:
        return "medium"
    else:
        return "low"
```

### Recipe 3: Integrate with Issue Tracker

> **Note:** This is an example recipe showing how to extend the system. Jira/Linear integration is not built-in—you would need to implement this yourself.

**Goal:** Link investigations to external issue tracker (Jira, Linear)

```python
# In issue_investigation_orchestrator.py
def _post_to_jira(self, report: InvestigationReport):
    """Post investigation results to Jira."""
    import requests
    import os

    jira_url = os.getenv("JIRA_URL")
    issue_key = self._extract_jira_key(report.issue.title)

    # Post investigation summary as comment
    comment = f"""
    h2. Auto Claude Investigation

    *Root Cause:* {report.root_cause.summary}
    *Impact:* {report.impact.summary}

    [View Full Investigation|{report.url}]
    """

    requests.post(
        f"{jira_url}/rest/api/2/issue/{issue_key}/comment",
        json={"body": comment},
        auth=(os.getenv("JIRA_USER"), os.getenv("JIRA_TOKEN"))
    )

# Call this after investigation completes
def _run_investigation(self, issue: Issue) -> InvestigationReport:
    report = await self._run_all_specialists(issue)
    self._post_to_jira(report)
    return report
```

### Recipe 4: Custom Report Formatting

**Goal:** Generate custom report format for your team

```python
# In issue_investigation_orchestrator.py
def _format_custom_report(self, report: InvestigationReport) -> str:
    """Format investigation report for team consumption."""
    return f"""
# Investigation Report: {report.issue.title}

## Summary
{report.root_cause.summary}

## Root Cause
**Location:** {report.root_cause.location}
**Confidence:** {report.root_cause.confidence:.0%}

{report.root_cause.explanation}

## Impact
**Affected Users:** {report.impact.user_count:,}
**Severity:** {self._calculate_severity(report).upper()}

## Recommended Fix
{report.fix_advisor.recommendation}

## Next Steps
1. Assign to: {self._suggest_assignee(report)}
2. Estimate: {self._suggest_estimate(report)}
3. Priority: {self._suggest_priority(report)}

---
Generated by Auto Claude | {report.generated_at}
"""
```

---

## Next Steps

You now have everything you need to customize and extend the GitHub Issues integration.

**For contributors:** See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines.

**For architecture:** See [CLAUDE.md](../CLAUDE.md) for system architecture details.

---

**Need help?** Join the [Auto Claude community](https://github.com/AndyMik90/Auto-Claude/discussions) or report issues [on GitHub](https://github.com/AndyMik90/Auto-Claude/issues).
