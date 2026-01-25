# PR Review System: Path to 99% Trust

**Date**: 2025-01-25
**Status**: Architecture specification for implementation
**Goal**: Reduce false positive rate from ~57% to <5%

**Related Documents**:
- [LSP_INTEGRATION_SPEC.md](./LSP_INTEGRATION_SPEC.md) - Language Server Protocol integration (Enhancement)
- [MCP_IMPROVEMENT.md](./MCP_IMPROVEMENT.md) - Dynamic MCP discovery system (Enhancement)

---

## Executive Summary

This document specifies how to build a world-class AI PR review system that developers can trust.

### The Core Problem

AI generates findings without verifying they're real. It sees a diff, makes assumptions, and reports issues that don't actually exist.

### The Solution: Three Core Principles

1. **Understand Intent First** - Know what the PR is trying to accomplish before judging
2. **Evidence-Based Verification** - Every finding must prove it exists with actual code
3. **Diff = What to Investigate** - The diff tells you what to look at, not what to conclude

### What This Document Covers

| Section | Purpose |
|---------|---------|
| Core Fixes | Changes to prompts and output schemas that fix the fundamental problem |
| Current Architecture | Understanding the existing system |
| Implementation Plan | Specific changes to make |
| Enhancements (LSP/MCP) | Future improvements that make the system better, but aren't required to fix it |

---

## The Problem

**Observed**: PR review produces 7 findings, but 4 are invalid when verified (~57% false positive rate).

**Root Cause**: AI makes claims without verification.

The AI receives a diff with code inline. It analyzes what's in front of it and reports "issues" based on:
- Assumptions about what's missing (without checking if it exists elsewhere)
- Line numbers it didn't verify (sometimes hallucinated)
- Claims without actual code evidence

### Why This Happens

The current prompts say "verify before reporting" but:
1. The output schema doesn't REQUIRE proof of verification
2. The diff is inline, so AI thinks it already has the code
3. There's no structured evidence field that forces the AI to show its work

**The fix is not more programmatic filters. The fix is better prompts and structured output that forces verification.**

---

## The Three Core Principles

### Principle 1: Understand Intent First

Before looking for problems, understand what the PR is trying to do.

**Current behavior**: AI jumps straight to fault-finding.

**Correct behavior**:
1. Read PR title and description
2. Understand the goal: "This PR is trying to [X]"
3. Evaluate: "Did they accomplish [X] correctly and safely?"

This shifts from "what's wrong with this code" to "did they achieve their goal correctly."

A senior developer doesn't just nitpick code. They evaluate whether the solution accomplishes what it's supposed to.

### Principle 2: Evidence-Based Verification

Every finding must include actual code from the file, proving the AI read it.

**Current behavior**: AI can report findings without proving it verified them.

**Correct behavior**: Structured output that REQUIRES:
- `code_examined`: Actual code snippet from the file (copy-pasted)
- `line_range`: Where the code was read from
- `verification_reasoning`: Why this code proves the issue exists

If the AI has to fill in `code_examined` with actual code, it HAS to Read the file. You can't fake actual code.

### Principle 3: Diff = What to Investigate, Not What to Conclude

The diff shows you what changed. It does NOT show you:
- The full function context
- Who calls this code
- What validation exists elsewhere
- Whether this is actually a problem

**Current behavior**: AI analyzes the diff inline and makes conclusions.

**Correct behavior**: AI uses the diff to identify what to investigate, then uses tools (Read, Grep) to actually verify.

---

## Current Architecture

Understanding what exists before changing it.

```
┌─────────────────────────────────────────────────────────────────┐
│                    PARALLEL ORCHESTRATOR                         │
│  - Analyzes PR to determine which specialists to invoke         │
│  - Dispatches to specialist agents in parallel                  │
│  - Collects and cross-validates findings                        │
│  - Invokes Finding Validator for each finding                   │
│  - Applies confidence routing                                   │
│  - Generates final verdict                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
     ┌──────────┐      ┌──────────┐      ┌──────────┐
     │ SECURITY │      │ QUALITY  │      │  LOGIC   │  (+ codebase-fit, ai-triage)
     │  AGENT   │      │  AGENT   │      │  AGENT   │
     └──────────┘      └──────────┘      └──────────┘
            │                 │                 │
            └─────────────────┼─────────────────┘
                              ▼
                    Raw findings returned
                              │
                              ▼
                   ┌─────────────────────┐
                   │  FINDING VALIDATOR  │
                   │  (Re-verifies each) │
                   └─────────────────────┘
                              │
                              ▼
                       Final Output
```

### What Currently Exists (Good)

1. **Specialist agent prompts** already say:
   - "USE the Read tool to examine actual code"
   - "Never report based on diff alone"
   - "Your evidence must prove ABSENCE — not just that you didn't see it"

2. **Finding Validator** re-investigates findings after specialists report

3. **Cross-validation** boosts confidence when multiple agents agree

4. **Tools available**: Read, Grep, Glob (agents CAN explore)

### What's Wrong (Gaps)

1. **No "Understand Intent" phase** - Agents jump straight to fault-finding

2. **Output schema doesn't enforce verification** - Agents can report findings without proving they verified

3. **Diff is inline** - Creates illusion that AI already has the code, reducing tool usage

4. **Finding Validator runs AFTER** - Catches false positives late instead of preventing them

5. **Context gathered but not passed** - `context_gatherer.py` collects 50 related files, import graphs, and reverse dependencies, but NONE of this is passed to the orchestrator or specialists. They must rediscover everything from scratch.

6. **No PR synthesis step** - Orchestrator immediately delegates without synthesizing all PR context (description + files + commits + comments) into a holistic understanding

---

## Core Fixes (Required)

These changes fix the fundamental problem. They're about prompts and structured output, not programmatic filters.

### Fix 0: Holistic PR Understanding (New)

**Problem**: The system gathers excellent context (50 related files, import analysis, reverse dependencies) but never passes it to the AI. Specialists must rediscover everything.

**Solution**: Add a PR synthesis step and pass gathered context.

**Location**: `parallel_orchestrator_reviewer.py` (prompt construction)

**Changes needed**:

1. **Add PR synthesis instruction to orchestrator prompt**:
```markdown
## PHASE 0: UNDERSTAND THE PR HOLISTICALLY

Before delegating to specialists, synthesize your understanding:

1. **What is this PR trying to accomplish?**
   - Read PR description, commit messages, and any discussion
   - Form a clear statement: "This PR is trying to [goal]"

2. **What is the scope of impact?**
   - Review the related files list below (files that import or are imported by changed files)
   - Understand how changes propagate through the codebase

3. **What should specialists focus on?**
   - Given the PR's goal and impact scope, what are the key concerns?

Only AFTER you understand the PR should you delegate to specialists.
```

2. **Pass related files to orchestrator prompt** (currently gathered but unused):
```python
# In _build_orchestrator_prompt():
related_files_section = f"""
## Related Files (Import/Export Relationships)

These files are connected to the changed files:

{format_related_files(context.related_files)}

Specialists should investigate these for potential impact.
"""
```

3. **Pass import graph summary**:
```python
import_graph_section = f"""
## Import Graph

{format_import_graph(context.import_analysis)}

Use this to understand how changes flow through the codebase.
"""
```

**Why this works**: Specialists receive pre-computed context instead of rediscovering it. They can focus on analysis, not exploration.

### Fix 1: Add "Understand Intent" Phase to All Agent Prompts

**Location**: All specialist prompts (`pr_security_agent.md`, `pr_logic_agent.md`, `pr_quality_agent.md`, `pr_codebase_fit_agent.md`)

**Add at the beginning of each prompt:**

```markdown
## PHASE 0: UNDERSTAND INTENT (DO THIS FIRST)

Before looking for ANY problems:

1. **Read the PR title and description**
   - What is the author trying to accomplish?
   - What problem are they solving?

2. **Read the commit messages**
   - What's the sequence of changes?
   - Do they explain any non-obvious decisions?

3. **Form your understanding**
   - "This PR is trying to: [goal]"
   - "The approach is: [how they're doing it]"

4. **Frame your review**
   - Your job is to evaluate: Did they accomplish [goal] correctly and safely?
   - NOT: What's wrong with this code in isolation?

DO NOT proceed to finding issues until you understand the intent.
```

**Why this works**: Shifts from fault-finding to evaluation. The AI considers context before judging.

### Fix 2: Structured Evidence Output Schema

**Location**: `pydantic_models.py` - Update finding schemas

**Current schema** (simplified):
```python
class Finding(BaseModel):
    file: str
    line: int
    title: str
    description: str
    evidence: str | None  # OPTIONAL - can be skipped
    suggested_fix: str | None
```

**New schema** - Forces verification:
```python
class Finding(BaseModel):
    # What the finding claims
    file: str
    line: int
    title: str
    description: str

    # REQUIRED: Proof of verification
    verification: VerificationEvidence

    suggested_fix: str

class VerificationEvidence(BaseModel):
    """Proof that the AI actually verified this finding."""

    code_examined: str = Field(
        min_length=10,
        description=(
            "REQUIRED: The actual code you read from the file. "
            "Copy-paste the relevant lines. This proves you Read the file."
        )
    )

    line_range_examined: tuple[int, int] = Field(
        description="Start and end line numbers you examined (e.g., [40, 60] for ±10 lines context)"
    )

    verification_method: str = Field(
        description=(
            "How you verified this issue exists. Examples:\n"
            "- 'Read lines 40-60 of file.ts, confirmed no validation before SQL query'\n"
            "- 'Used Grep to search for sanitization, found none in this file or callers'\n"
            "- 'Read the full function, no try/catch around the async call'"
        )
    )

    checked_for_handling_elsewhere: bool = Field(
        description="Did you check if this is handled elsewhere (caller, middleware, framework)?"
    )

    where_checked: str | None = Field(
        default=None,
        description="If checked_for_handling_elsewhere is True, list where you looked"
    )

    is_impact_finding: bool = Field(
        default=False,
        description=(
            "True if this finding is about how changes IMPACT code outside the diff "
            "(e.g., breaking callers, affecting dependents). Impact findings are valid "
            "even when the file isn't in the PR diff."
        )
    )
```

**Why this works**: The AI MUST fill in `code_examined` with actual code. It cannot fake this without actually Reading the file.

### Fix 3: Update Agent Prompts to Reference New Schema

**Location**: All specialist prompts

**Add after the "Understand Intent" phase:**

```markdown
## EVIDENCE REQUIREMENTS

Your findings MUST include verification evidence. The schema requires:

### code_examined (REQUIRED)
Copy-paste the actual code from the file that shows the issue.
- Use the Read tool to get the file content
- Copy the relevant lines exactly as they appear
- This proves you actually read the file

### line_range_examined (REQUIRED)
What lines did you examine? Always read ±10 lines of context minimum.

### verification_method (REQUIRED)
Explain HOW you verified this issue exists:
- "I read lines X-Y and confirmed [issue] because [reason]"
- "I used Grep to search for [pattern] and found [result]"
- "I checked the caller at [location] and it does not validate"

### checked_for_handling_elsewhere (REQUIRED)
Before claiming something is MISSING (no validation, no error handling):
- You must search for it elsewhere
- Check callers, middleware, framework conventions
- If you only looked at the flagged line, you haven't verified absence

### REJECTION RULE
If you cannot fill in code_examined with actual code from the file,
DO NOT report the finding. No evidence = no finding.
```

### Fix 4: Reframe the Diff in Prompts

**Location**: Orchestrator prompt (`pr_parallel_orchestrator.md`)

**Current framing** (implicit):
> Here's the diff. Analyze it and find problems.

**New framing** (explicit):

```markdown
## WHAT THE DIFF IS FOR

The diff below shows WHAT CHANGED in this PR.

The diff tells you:
- Which files to investigate
- Which lines were modified
- What the changes look like

The diff does NOT tell you:
- Whether changes are correct (you must verify)
- What the full function context is (you must Read)
- Who calls this code (you must search)
- Whether validation exists elsewhere (you must check)

USE THE DIFF TO IDENTIFY WHAT TO INVESTIGATE.
USE YOUR TOOLS (Read, Grep) TO ACTUALLY VERIFY.

Do not conclude issues exist just because you see code in the diff.
Investigate first, conclude second.
```

---

## What NOT to Add (Over-Engineering)

Based on our discussion, these are things that sound good but add complexity without solving the core problem:

### Don't Add: Heavy Programmatic Keyword Filters

The old approach tried to filter findings programmatically:
- Check if line is in diff (±3 tolerance)
- Check if evidence contains certain patterns
- Reject "vague" language

**Why this is wrong**: If the prompts are good, the AI won't produce bad findings. Programmatic filters are band-aids that add complexity.

**Better approach**: Fix the prompts so the AI produces good findings in the first place.

### Don't Add: Complex Exploration Decision Trees

The old document had elaborate decision trees:
- "If function signature changed → find ALL callers"
- "If type changed → find ALL usages"

**Why this is wrong**: Over-prescriptive. A good AI can figure out what to explore if told to understand before judging.

**Better approach**: "Understand the code before making claims. Use Read and Grep as needed."

### Don't Add: Extensive Confidence Scoring Logic

Complex confidence tiers and thresholds add cognitive load without improving quality.

**Better approach**: Evidence-based. Either you have proof or you don't. The `verification` schema is binary - you either filled it in properly or you didn't.

---

## Implementation Plan

### Phase 1: Holistic PR Understanding (New - Highest Impact)

| Task | File | What to Do |
|------|------|------------|
| Add PR synthesis instruction | `pr_parallel_orchestrator.md` | Add "Understand the PR Holistically" phase before delegation |
| Pass related files to orchestrator | `parallel_orchestrator_reviewer.py` | Include `context.related_files` in orchestrator prompt |
| Pass import graph to orchestrator | `parallel_orchestrator_reviewer.py` | Include import analysis summary in prompt |
| Add "files to investigate" for specialists | `parallel_orchestrator_reviewer.py` | Pass related files list when invoking specialists |

**Expected outcome**: AI understands the full PR context before reviewing. Catches cross-file impacts.

### Phase 2: Core Schema & Prompt Fixes

| Task | File | What to Do |
|------|------|------------|
| Add "Understand Intent" phase | `pr_security_agent.md`, `pr_logic_agent.md`, `pr_quality_agent.md`, `pr_codebase_fit_agent.md` | Add Phase 0 section at start of each prompt |
| Update finding schema | `pydantic_models.py` | Add `VerificationEvidence` class, make it required in findings |
| Add evidence instructions | All specialist prompts | Add "Evidence Requirements" section explaining the new schema |
| Reframe diff usage | `pr_parallel_orchestrator.md` | Add "What the Diff Is For" section |
| Update orchestrator schema | `pydantic_models.py` | Update `ParallelOrchestratorFinding` to require verification |

**Expected outcome**: Findings now include proof of verification. False positives drop because AI must actually read files.

### Phase 3: Simplify Validation Pipeline

| Task | File | What to Do |
|------|------|------------|
| Remove `_validate_finding_evidence()` | `parallel_orchestrator_reviewer.py` (lines 104-158) | Remove pattern-based evidence quality check - schema enforces this now |
| Remove evidence filter calls | `parallel_orchestrator_reviewer.py` (lines 839-845) | Remove the call to evidence validation |
| Remove `_apply_confidence_routing()` | `parallel_orchestrator_reviewer.py` (lines 1235-1286) | Remove confidence tier filtering - evidence is binary, not tiered |
| Remove `VAGUE_PATTERNS` and `GENERIC_PATTERNS` | `output_validator.py` (lines 26-47) | Remove keyword lists |
| Remove `_is_false_positive()` | `output_validator.py` (lines 297-340) | Remove keyword-based FP detection |
| Simplify `_is_finding_in_scope()` | `parallel_orchestrator_reviewer.py` (lines 161-195) | Keep file-in-diff check, add explicit `is_impact_finding` field to schema instead of keyword detection |
| Keep cross-validation | `parallel_orchestrator_reviewer.py` | Multi-agent agreement is valuable, keep it |
| Keep Finding Validator | `parallel_followup_reviewer.py` | Defense-in-depth for follow-up reviews |

**No tests will break**: Investigation confirmed no unit tests exist for the filter functions being removed.

**Expected outcome**: Simpler validation pipeline. Quality comes from prompts, not filters.

### Phase 4: Measure and Iterate

| Task | What to Do |
|------|------------|
| Run 5 PRs with new prompts | Manually review findings for false positives |
| Track FP rate | Count how many findings are invalid |
| Identify patterns | What types of false positives still occur? |
| Iterate on prompts | Refine based on data |

**Target**: <15% false positive rate after Phase 1+2.

---

## Enhancements (After Core Fixes)

These make the system better but aren't required to fix the core problem.

### Enhancement 1: LSP Integration

**What it adds**: Semantic code understanding (find references, go to definition, type info)

**Why it helps**: Currently agents use Grep which has false positives (matches strings/comments). LSP finds actual code references.

**When to implement**: After core fixes are working. LSP makes verification more powerful, but doesn't fix the verification discipline problem.

**See**: [LSP_INTEGRATION_SPEC.md](./LSP_INTEGRATION_SPEC.md)

### Enhancement 2: Dynamic MCP Discovery

**What it adds**: AI discovers available tools dynamically instead of static tool lists

**Why it helps**: Reduces context overhead, allows project-aware tool selection

**When to implement**: After core fixes. This is about efficiency, not correctness.

**See**: [MCP_IMPROVEMENT.md](./MCP_IMPROVEMENT.md)

### Enhancement 3: Diff-Scope Validation

**What it adds**: Programmatic filter rejecting findings on unchanged lines

**Why it might help**: Catches AI claiming issues on code that wasn't modified

**When to implement**: Only if Phase 1 data shows this is a common problem. Don't add complexity preemptively.

---

## Success Metrics

### Primary: False Positive Rate

| Phase | Target | How to Measure |
|-------|--------|----------------|
| Current | ~57% | Baseline from past reviews |
| After Core Fixes | <15% | Review 5 PRs, count invalid findings |
| With Enhancements | <5% | Future milestone (LSP/MCP) |

### Secondary: Evidence Quality

| Metric | Target |
|--------|--------|
| Findings with valid `code_examined` | 100% (schema enforces) |
| Findings where code matches actual file | >95% |
| Findings with `checked_for_handling_elsewhere: true` for "missing X" claims | 100% |

### What We're NOT Measuring (Yet)

- Recall (finding real issues) - Focus on precision first
- Review latency - Accept some slowdown for accuracy
- Agent-specific rates - Aggregate first, drill down later

---

## Summary: What Changes

### Prompts (Add)

1. "Understand Intent" phase at start of all specialist prompts
2. "Evidence Requirements" section explaining verification schema
3. "What the Diff Is For" reframing in orchestrator prompt

### Schema (Change)

1. Add `VerificationEvidence` class with required fields
2. Make `verification` required in all finding types
3. Remove optional `evidence` field (replaced by structured verification)

### Code (Simplify)

1. Remove `_validate_finding_evidence()` - pattern-based evidence validation (schema handles it)
2. Remove `_apply_confidence_routing()` - confidence tiers replaced by binary evidence
3. Remove `_is_false_positive()` - keyword-based FP detection
4. Simplify `_is_finding_in_scope()` - keep file check, replace keyword detection with explicit schema field
5. Keep: cross-validation, finding validator

### Mindset (Shift)

From: "Add more filters to catch bad findings"
To: "Fix prompts so AI produces good findings"

---

## Conclusion

The path to 99% trust is not more programmatic filters. It's better prompts that force the AI to:

1. **Understand before judging** - Know the PR's intent first
2. **Prove verification** - Show the actual code examined
3. **Investigate, don't assume** - Use the diff as a starting point, not a conclusion

The structured output schema is the enforcement mechanism. If the AI must provide `code_examined` with actual code, it must Read the file. That's the fix.

**Expected outcome**: 57% → <15% false positive rate with core fixes alone.
