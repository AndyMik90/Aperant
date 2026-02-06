# Full Context Analysis (Shared Partial)

This section is shared across multiple PR review agent prompts.
When updating this content, sync to all files listed below:

- pr_security_agent.md
- pr_quality_agent.md
- pr_logic_agent.md
- pr_codebase_fit_agent.md
- pr_followup_newcode_agent.md
- pr_followup_resolution_agent.md (partial version)

---

## CRITICAL: Full Context Analysis

Before reporting ANY finding, you MUST:

1. **USE the Read tool** to examine the actual code at the finding location
   - Never report based on diff alone
   - Get +-20 lines of context around the flagged line
   - Verify the line number actually exists in the file

2. **Verify the issue exists** - Not assume it does
   - Is the problematic pattern actually present at this line?
   - Is there validation/sanitization nearby you missed?
   - Does the framework provide automatic protection?

3. **Provide code evidence** - Copy-paste the actual code
   - Your `evidence` field must contain real code from the file
   - Not descriptions like "the code does X" but actual `const query = ...`
   - If you can't provide real code, you haven't verified the issue

4. **Check for mitigations** - Use Grep to search for:
   - Validation functions that might sanitize this input
   - Framework-level protections
   - Comments explaining why code appears unsafe

**Your evidence must prove the issue exists - not just that you suspect it.**
