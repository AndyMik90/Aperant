"""
Prompt Loading Utilities
========================

Functions for loading agent prompts from markdown files.
Supports dynamic prompt assembly based on project type for context optimization.
"""

import json
import os
import re
import subprocess
from pathlib import Path

from .project_context import (
    detect_project_capabilities,
    get_mcp_tools_for_project,
    load_project_index,
)


def _validate_branch_name(branch: str | None) -> str | None:
    """
    Validate a git branch name for safety and correctness.

    Args:
        branch: The branch name to validate

    Returns:
        The validated branch name, or None if invalid
    """
    if not branch or not isinstance(branch, str):
        return None

    # Trim whitespace
    branch = branch.strip()

    # Reject empty or whitespace-only strings
    if not branch:
        return None

    # Enforce maximum length (git refs can be long, but 255 is reasonable)
    if len(branch) > 255:
        return None

    # Require at least one alphanumeric character
    if not any(c.isalnum() for c in branch):
        return None

    # Only allow common git-ref characters: letters, numbers, ., _, -, /
    # This prevents prompt injection and other security issues
    if not re.match(r"^[A-Za-z0-9._/-]+$", branch):
        return None

    # Reject suspicious patterns that could be prompt injection attempts
    # (newlines, control characters are already blocked by the regex above)

    return branch


def get_base_branch_from_metadata(spec_dir: Path) -> str | None:
    """
    Read baseBranch from task_metadata.json if it exists.

    Args:
        spec_dir: Directory containing the spec files

    Returns:
        The baseBranch from metadata, or None if not found or invalid
    """
    metadata_path = spec_dir / "task_metadata.json"
    if metadata_path.exists():
        try:
            with open(metadata_path, encoding="utf-8") as f:
                metadata = json.load(f)
                base_branch = metadata.get("baseBranch")
                # Validate the branch name before returning
                return _validate_branch_name(base_branch)
        except (json.JSONDecodeError, OSError):
            pass
    return None


def get_use_local_branch_from_metadata(spec_dir: Path) -> bool:
    """
    Read useLocalBranch from task_metadata.json if it exists.

    When True, the worktree should be created from the local branch directly
    instead of preferring origin/branch. This preserves gitignored files
    (.env, configs) that may not exist on the remote.

    Args:
        spec_dir: Directory containing the spec files

    Returns:
        True if useLocalBranch is set in metadata, False otherwise
    """
    metadata_path = spec_dir / "task_metadata.json"
    if metadata_path.exists():
        try:
            with open(metadata_path, encoding="utf-8") as f:
                metadata = json.load(f)
                return bool(metadata.get("useLocalBranch", False))
        except (json.JSONDecodeError, OSError):
            pass
    return False


# Alias for backwards compatibility (internal use)
_get_base_branch_from_metadata = get_base_branch_from_metadata


def _detect_base_branch(spec_dir: Path, project_dir: Path) -> str:
    """
    Detect the base branch for a project/task.

    Priority order:
    1. baseBranch from task_metadata.json (task-level override)
    2. DEFAULT_BRANCH environment variable
    3. Auto-detect main/master/develop (if they exist in git)
    4. Fall back to "main"

    Args:
        spec_dir: Directory containing the spec files
        project_dir: Project root directory

    Returns:
        The detected base branch name
    """
    # 1. Check task_metadata.json for task-specific baseBranch
    metadata_branch = _get_base_branch_from_metadata(spec_dir)
    if metadata_branch:
        return metadata_branch

    # 2. Check for DEFAULT_BRANCH env var
    env_branch = _validate_branch_name(os.getenv("DEFAULT_BRANCH"))
    if env_branch:
        # Verify the branch exists (with timeout to prevent hanging)
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--verify", env_branch],
                cwd=project_dir,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=3,
            )
            if result.returncode == 0:
                return env_branch
        except subprocess.TimeoutExpired:
            # Treat timeout as branch verification failure
            pass

    # 3. Auto-detect main/master/develop
    for branch in ["main", "master", "develop"]:
        try:
            result = subprocess.run(
                ["git", "rev-parse", "--verify", branch],
                cwd=project_dir,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=3,
            )
            if result.returncode == 0:
                return branch
        except subprocess.TimeoutExpired:
            # Treat timeout as branch verification failure, try next branch
            continue

    # 4. Fall back to "main"
    return "main"


# Directory containing prompt files
# prompts/ is a sibling directory of prompts_pkg/, so go up one level first
PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def get_planner_prompt(spec_dir: Path) -> str:
    """
    Load the planner agent prompt with spec path injected.
    The planner creates subtask-based implementation plans.

    Args:
        spec_dir: Directory containing the spec.md file

    Returns:
        The planner prompt content with spec path
    """
    prompt_file = PROMPTS_DIR / "planner.md"

    if not prompt_file.exists():
        raise FileNotFoundError(
            f"Planner prompt not found at {prompt_file}\n"
            "Make sure the auto-claude/prompts/planner.md file exists."
        )

    prompt = prompt_file.read_text(encoding="utf-8")

    # Inject spec directory information at the beginning
    spec_context = f"""## SPEC LOCATION

Your spec file is located at: `{spec_dir}/spec.md`

🚨 CRITICAL FILE CREATION INSTRUCTIONS 🚨

You MUST use the Write tool to create these files in the spec directory:
- `{spec_dir}/implementation_plan.json` - Subtask-based implementation plan (USE WRITE TOOL!)
- `{spec_dir}/build-progress.txt` - Progress notes (USE WRITE TOOL!)
- `{spec_dir}/init.sh` - Environment setup script (USE WRITE TOOL!)

DO NOT just describe what these files should contain. You MUST actually call the Write tool
with the file path and complete content to create them.

The project root is the parent of auto-claude/. Implement code in the project root, not in the spec directory.

---

"""
    return spec_context + prompt


def get_coding_prompt(spec_dir: Path) -> str:
    """
    Load the coding agent prompt with spec path injected.

    Args:
        spec_dir: Directory containing the spec.md and implementation_plan.json

    Returns:
        The coding agent prompt content with spec path
    """
    prompt_file = PROMPTS_DIR / "coder.md"

    if not prompt_file.exists():
        raise FileNotFoundError(
            f"Coding prompt not found at {prompt_file}\n"
            "Make sure the auto-claude/prompts/coder.md file exists."
        )

    prompt = prompt_file.read_text(encoding="utf-8")

    spec_context = f"""## SPEC LOCATION

Your spec and progress files are located at:
- Spec: `{spec_dir}/spec.md`
- Implementation plan: `{spec_dir}/implementation_plan.json`
- Progress notes: `{spec_dir}/build-progress.txt`
- Recovery context: `{spec_dir}/memory/attempt_history.json`

The project root is the parent of auto-claude/. All code goes in the project root, not in the spec directory.

---

"""

    # Check for recovery context (stuck subtasks, retry hints)
    recovery_context = _get_recovery_context(spec_dir)
    if recovery_context:
        spec_context += recovery_context

    # Check for human input file
    human_input_file = spec_dir / "HUMAN_INPUT.md"
    if human_input_file.exists():
        human_input = human_input_file.read_text(encoding="utf-8").strip()
        if human_input:
            spec_context += f"""## HUMAN INPUT (READ THIS FIRST!)

The human has left you instructions. READ AND FOLLOW THESE CAREFULLY:

{human_input}

After addressing this input, you may delete or clear the HUMAN_INPUT.md file.

---

"""

    return spec_context + prompt


def _get_recovery_context(spec_dir: Path) -> str:
    """
    Get recovery context if there are failed attempts or stuck subtasks.

    Args:
        spec_dir: Spec directory containing memory/

    Returns:
        Recovery context string or empty string
    """
    import json

    attempt_history_file = spec_dir / "memory" / "attempt_history.json"

    if not attempt_history_file.exists():
        return ""

    try:
        with open(attempt_history_file, encoding="utf-8") as f:
            history = json.load(f)

        # Check for stuck subtasks
        stuck_subtasks = history.get("stuck_subtasks", [])
        if stuck_subtasks:
            context = """## ⚠️ RECOVERY ALERT - STUCK SUBTASKS DETECTED

Some subtasks have been attempted multiple times without success. These subtasks need:
- A COMPLETELY DIFFERENT approach
- Possibly simpler implementation
- Or escalation to human if infeasible

Stuck subtasks:
"""
            for stuck in stuck_subtasks:
                context += f"- {stuck['subtask_id']}: {stuck['reason']} ({stuck['attempt_count']} attempts)\n"

            context += "\nBefore working on any subtask, check memory/attempt_history.json for previous attempts!\n\n---\n\n"
            return context

        # Check for subtasks with multiple attempts
        subtasks_with_retries = []
        for subtask_id, subtask_data in history.get("subtasks", {}).items():
            attempts = subtask_data.get("attempts", [])
            if len(attempts) > 1 and subtask_data.get("status") != "completed":
                subtasks_with_retries.append((subtask_id, len(attempts)))

        if subtasks_with_retries:
            context = """## ⚠️ RECOVERY CONTEXT - RETRY AWARENESS

Some subtasks have been attempted before. When working on these:
1. READ memory/attempt_history.json for the specific subtask
2. See what approaches were tried
3. Use a DIFFERENT approach

Subtasks with previous attempts:
"""
            for subtask_id, attempt_count in subtasks_with_retries:
                context += f"- {subtask_id}: {attempt_count} attempts\n"

            context += "\n---\n\n"
            return context

        return ""

    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return ""


def get_followup_planner_prompt(spec_dir: Path) -> str:
    """
    Load the follow-up planner agent prompt with spec path and key files injected.
    The follow-up planner adds new subtasks to an existing completed implementation plan.

    Args:
        spec_dir: Directory containing the completed spec and implementation_plan.json

    Returns:
        The follow-up planner prompt content with paths injected
    """
    prompt_file = PROMPTS_DIR / "followup_planner.md"

    if not prompt_file.exists():
        raise FileNotFoundError(
            f"Follow-up planner prompt not found at {prompt_file}\n"
            "Make sure the auto-claude/prompts/followup_planner.md file exists."
        )

    prompt = prompt_file.read_text(encoding="utf-8")

    # Inject spec directory information at the beginning
    spec_context = f"""## SPEC LOCATION (FOLLOW-UP MODE)

You are adding follow-up work to a **completed** spec.

**Key files in this spec directory:**
- Spec: `{spec_dir}/spec.md`
- Follow-up request: `{spec_dir}/FOLLOWUP_REQUEST.md` (READ THIS FIRST!)
- Implementation plan: `{spec_dir}/implementation_plan.json` (APPEND to this, don't replace)
- Progress notes: `{spec_dir}/build-progress.txt`
- Context: `{spec_dir}/context.json`
- Memory: `{spec_dir}/memory/`

**Important paths:**
- Spec directory: `{spec_dir}`
- Project root: Parent of auto-claude/ (where code should be implemented)

**Your task:**
1. Read `{spec_dir}/FOLLOWUP_REQUEST.md` to understand what to add
2. Read `{spec_dir}/implementation_plan.json` to see existing phases/subtasks
3. ADD new phase(s) with pending subtasks to the existing plan
4. PRESERVE all existing subtasks and their statuses

---

"""
    return spec_context + prompt


def is_first_run(spec_dir: Path) -> bool:
    """
    Check if this is the first run (no valid implementation plan with subtasks exists yet).

    The spec runner may create a skeleton implementation_plan.json with empty phases.
    This function checks for actual phases with subtasks, not just file existence.

    Args:
        spec_dir: Directory containing spec files

    Returns:
        True if implementation_plan.json doesn't exist or has no subtasks
    """
    plan_file = spec_dir / "implementation_plan.json"

    if not plan_file.exists():
        return True

    try:
        with open(plan_file, encoding="utf-8") as f:
            plan = json.load(f)

        # Check if there are any phases with subtasks
        phases = plan.get("phases", [])
        if not phases:
            return True

        # Check if any phase has subtasks
        total_subtasks = sum(len(phase.get("subtasks", [])) for phase in phases)
        return total_subtasks == 0
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        # If we can't read the file, treat as first run
        return True


def _load_prompt_file(filename: str) -> str:
    """
    Load a prompt file from the prompts directory.

    Args:
        filename: Relative path to prompt file (e.g., "qa_reviewer.md" or "mcp_tools/electron_validation.md")

    Returns:
        Content of the prompt file

    Raises:
        FileNotFoundError: If prompt file doesn't exist
    """
    prompt_file = PROMPTS_DIR / filename
    if not prompt_file.exists():
        raise FileNotFoundError(f"Prompt file not found: {prompt_file}")
    return prompt_file.read_text(encoding="utf-8")


def get_qa_reviewer_prompt(spec_dir: Path, project_dir: Path) -> str:
    """
    Load the QA reviewer prompt with project-specific MCP tools dynamically injected.

    This function:
    1. Loads the base QA reviewer prompt
    2. Detects project capabilities from project_index.json
    3. Injects only relevant MCP tool documentation (Electron, Puppeteer, DB, API)
    4. Detects and injects the correct base branch for git comparisons

    This saves context window by excluding irrelevant tool docs.
    For example, a CLI Python project won't get Electron validation docs.

    Args:
        spec_dir: Directory containing the spec files
        project_dir: Root directory of the project

    Returns:
        The QA reviewer prompt with project-specific tools injected
    """
    # Detect the base branch for this task (from task_metadata.json or auto-detect)
    base_branch = _detect_base_branch(spec_dir, project_dir)

    # Load base QA reviewer prompt
    base_prompt = _load_prompt_file("qa_reviewer.md")

    # Replace {{BASE_BRANCH}} placeholder with the actual base branch
    base_prompt = base_prompt.replace("{{BASE_BRANCH}}", base_branch)

    # Load project index and detect capabilities
    project_index = load_project_index(project_dir)
    capabilities = detect_project_capabilities(project_index)

    # Get list of MCP tool doc files to include
    mcp_tool_files = get_mcp_tools_for_project(capabilities)

    # Load and assemble MCP tool sections
    mcp_sections = []
    for tool_file in mcp_tool_files:
        try:
            section = _load_prompt_file(tool_file)
            mcp_sections.append(section)
        except FileNotFoundError:
            # Skip missing files gracefully
            pass

    # Inject spec context at the beginning
    spec_context = f"""## SPEC LOCATION

Your spec and progress files are located at:
- Spec: `{spec_dir}/spec.md`
- Implementation plan: `{spec_dir}/implementation_plan.json`
- Progress notes: `{spec_dir}/build-progress.txt`
- QA report output: `{spec_dir}/qa_report.md`
- Fix request output: `{spec_dir}/QA_FIX_REQUEST.md`

The project root is: `{project_dir}`

## GIT BRANCH CONFIGURATION

**Base branch for comparison:** `{base_branch}`

When checking for unrelated changes, use three-dot diff syntax:
```bash
git diff {base_branch}...HEAD --name-status
```

This shows only changes made in the spec branch since it diverged from `{base_branch}`.

---

## PROJECT CAPABILITIES DETECTED

"""

    # Add capability summary as verification requirements table
    active_caps = [k for k, v in capabilities.items() if v]
    if active_caps:
        spec_context += "Based on project analysis, the following verification requirements apply:\n\n"
        spec_context += "| Capability | Detected | Verification Requirement |\n"
        spec_context += "|-----------|----------|-------------------------|\n"

        # NOTE: Keys must match those returned by detect_project_capabilities() in project_context.py.
        # If new capabilities are added there, update this dict to avoid silent omission.
        cap_requirements = {
            "is_electron": (
                "Electron Desktop App",
                "UI changes REQUIRE Electron MCP visual verification (screenshots)",
            ),
            "is_web_frontend": (
                "Web Frontend",
                "UI changes REQUIRE browser-based visual verification (screenshots)",
            ),
            "is_tauri": ("Tauri Desktop App", "UI changes REQUIRE visual verification"),
            "is_expo": (
                "Expo Mobile App",
                "UI changes require device/simulator verification",
            ),
            "is_react_native": (
                "React Native App",
                "UI changes require device/simulator verification",
            ),
            "is_nextjs": ("Next.js App", "Page changes require browser verification"),
            "is_nuxt": ("Nuxt App", "Page changes require browser verification"),
            "has_api": ("API Endpoints", "Endpoint changes require API testing"),
            "has_database": (
                "Database",
                "Schema changes require migration verification",
            ),
        }

        for cap_key in active_caps:
            if cap_key in cap_requirements:
                name, req = cap_requirements[cap_key]
                spec_context += f"| {name} | YES | {req} |\n"

        spec_context += "\n"

        # Inject startup commands from project_index services
        # Handle both dict format (services by name) and list format
        services = project_index.get("services", {})
        if isinstance(services, dict):
            services_iter = services.items()
        elif isinstance(services, list):
            services_iter = (
                (svc.get("name", f"service-{i}"), svc)
                for i, svc in enumerate(services)
                if isinstance(svc, dict)
            )
        else:
            services_iter = iter([])
        for svc_name, svc in services_iter:
            svc_scripts = svc.get("scripts", {})
            dev_cmd = svc.get("dev_command", "")
            if svc_scripts or dev_cmd:
                spec_context += f"**{svc_name} service commands:**\n"
                if dev_cmd:
                    spec_context += f"- Dev server: `{dev_cmd}`\n"
                # Surface debug/MCP scripts specifically
                debug_scripts = {
                    k: v
                    for k, v in svc_scripts.items()
                    if any(term in k for term in ("debug", "mcp", "test", "e2e"))
                }
                if debug_scripts:
                    pkg_mgr = svc.get("package_manager", "npm")
                    for script_name, script_cmd in debug_scripts.items():
                        spec_context += f"- {script_name}: `{pkg_mgr} run {script_name}` ({script_cmd})\n"
                spec_context += "\n"

        spec_context += "Match changed files from the git diff against these capabilities to determine which verification phases are MANDATORY.\n\n"
    else:
        spec_context += (
            "No special project capabilities detected. Using standard validation.\n\n"
        )

    spec_context += "---\n\n"

    # Find injection point in base prompt (after PHASE 4, before PHASE 5)
    injection_marker = (
        "<!-- PROJECT-SPECIFIC VALIDATION TOOLS WILL BE INJECTED HERE -->"
    )

    if mcp_sections and injection_marker in base_prompt:
        # Replace marker with actual MCP tool sections
        mcp_content = "\n\n---\n\n## PROJECT-SPECIFIC VALIDATION TOOLS\n\n"
        mcp_content += "The following validation tools are available based on your project type:\n\n"
        mcp_content += "\n\n---\n\n".join(mcp_sections)
        mcp_content += "\n\n---\n"

        # Replace the multi-line marker comment block
        marker_pattern = r"<!-- PROJECT-SPECIFIC VALIDATION TOOLS WILL BE INJECTED HERE -->.*?<!-- - API validation \(for projects with API endpoints\) -->"
        base_prompt = re.sub(marker_pattern, mcp_content, base_prompt, flags=re.DOTALL)
    elif mcp_sections:
        # Fallback: append at the end if marker not found
        base_prompt += "\n\n---\n\n## PROJECT-SPECIFIC VALIDATION TOOLS\n\n"
        base_prompt += "\n\n---\n\n".join(mcp_sections)

    return spec_context + base_prompt


def get_qa_fixer_prompt(spec_dir: Path, project_dir: Path) -> str:
    """
    Load the QA fixer prompt with spec paths injected.

    Args:
        spec_dir: Directory containing the spec files
        project_dir: Root directory of the project

    Returns:
        The QA fixer prompt content with paths injected
    """
    base_prompt = _load_prompt_file("qa_fixer.md")

    spec_context = f"""## SPEC LOCATION

Your spec and progress files are located at:
- Spec: `{spec_dir}/spec.md`
- Implementation plan: `{spec_dir}/implementation_plan.json`
- QA fix request: `{spec_dir}/QA_FIX_REQUEST.md` (READ THIS FIRST!)
- QA report: `{spec_dir}/qa_report.md`

The project root is: `{project_dir}`

---

"""
    return spec_context + base_prompt
