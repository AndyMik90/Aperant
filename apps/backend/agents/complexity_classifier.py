"""
Complexity Classifier Agent
============================

Classifies tasks as SIMPLE, MEDIUM, or COMPLEX using Haiku for speed.
Used for adaptive task routing to optimize model selection and skip unnecessary QA.

Complexity Levels:
- SIMPLE: Quick fixes, single-file changes, minimal risk
- MEDIUM: Multi-file changes, moderate complexity, standard QA
- COMPLEX: Cross-system changes, integrations, high risk, full QA

Model routing based on complexity:
| Complexity | Planning | Coding | QA |
|------------|----------|--------|-----|
| SIMPLE     | Haiku    | Haiku  | Skip |
| MEDIUM     | Sonnet   | Sonnet | Haiku |
| COMPLEX    | Opus     | Sonnet | Sonnet |
"""

import json
import logging
from pathlib import Path
from typing import Literal

from core.client import create_client
from phase_config import resolve_model_id

logger = logging.getLogger(__name__)

TaskComplexity = Literal["SIMPLE", "MEDIUM", "COMPLEX"]


def classify_task_complexity(
    task_description: str,
    project_dir: Path,
    spec_dir: Path,
) -> tuple[TaskComplexity, str]:
    """
    Classify task complexity using Haiku for fast, cheap classification.

    Args:
        task_description: The task to classify
        project_dir: Root directory for the project
        spec_dir: Directory containing the spec

    Returns:
        Tuple of (complexity_level, reasoning)
    """
    # Emit phase start
    print("__EXEC_PHASE__:classifying")

    # Create Haiku client for fast classification
    model_id = resolve_model_id("haiku")

    try:
        client = create_client(
            project_dir=project_dir,
            spec_dir=spec_dir,
            model=model_id,
            agent_type="planner",  # Use planner permissions for read-only analysis
            max_thinking_tokens=None,  # No extended thinking needed for classification
        )

        classification_prompt = f"""You are a task complexity classifier. Analyze this task and classify it as SIMPLE, MEDIUM, or COMPLEX.

Task: {task_description}

Classification criteria:

SIMPLE:
- Single file changes or minor tweaks
- UI text/styling updates
- Simple bug fixes with clear scope
- No external integrations
- Low risk, easy to verify

MEDIUM:
- Multi-file changes (2-5 files)
- New features with moderate scope
- Standard CRUD operations
- Existing pattern replication
- Moderate risk, standard QA needed

COMPLEX:
- Cross-system changes (5+ files)
- New integrations or external dependencies
- Infrastructure/architecture changes
- High risk or security implications
- Complex testing requirements

Output EXACTLY in this format:
COMPLEXITY: [SIMPLE|MEDIUM|COMPLEX]
REASON: [One sentence explanation]

Example:
COMPLEXITY: SIMPLE
REASON: Single file UI text change with no logic modifications.
"""

        logger.info(f"Classifying task with Haiku: {task_description[:100]}...")

        response = client.create_agent_session(
            name="complexity-classifier",
            starting_message=classification_prompt,
        )

        # Parse response
        output = response.get("output", "")
        complexity, reason = _parse_classification_output(output)

        # Store in task_metadata.json
        _store_complexity(spec_dir, complexity, reason)

        # Print for UI parsing
        print(f"Task complexity: {complexity} - {reason}")

        logger.info(f"Task classified as {complexity}: {reason}")
        return complexity, reason

    except Exception as e:
        logger.warning(f"Classification failed: {e}. Defaulting to MEDIUM.")
        default_reason = "Classification failed, using default complexity"
        _store_complexity(spec_dir, "MEDIUM", default_reason)
        print(f"Task complexity: MEDIUM - {default_reason}")
        return "MEDIUM", default_reason


def _parse_classification_output(output: str) -> tuple[TaskComplexity, str]:
    """
    Parse the classification output from the agent.

    Expected format:
    COMPLEXITY: SIMPLE
    REASON: Single file change with minimal risk.

    Args:
        output: Raw agent output

    Returns:
        Tuple of (complexity, reason)
    """
    complexity: TaskComplexity = "MEDIUM"
    reason = "Could not parse classification output"

    lines = output.strip().split("\n")
    for line in lines:
        line = line.strip()
        if line.startswith("COMPLEXITY:"):
            level = line.replace("COMPLEXITY:", "").strip().upper()
            if level in ("SIMPLE", "MEDIUM", "COMPLEX"):
                complexity = level  # type: ignore
        elif line.startswith("REASON:"):
            reason = line.replace("REASON:", "").strip()

    return complexity, reason


def _store_complexity(spec_dir: Path, complexity: TaskComplexity, reason: str) -> None:
    """
    Store complexity classification in task_metadata.json.

    Args:
        spec_dir: Directory containing the spec
        complexity: Classified complexity level
        reason: Reasoning for the classification
    """
    metadata_path = spec_dir / "task_metadata.json"

    # Load existing metadata or create new
    metadata = {}
    if metadata_path.exists():
        try:
            with open(metadata_path) as f:
                metadata = json.load(f)
        except (json.JSONDecodeError, OSError):
            logger.warning("Could not load existing task_metadata.json")

    # Add complexity info
    metadata["complexity"] = complexity
    metadata["complexityReason"] = reason

    # Write back
    try:
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)
    except OSError as e:
        logger.error(f"Could not write task_metadata.json: {e}")


def get_task_complexity(spec_dir: Path) -> TaskComplexity:
    """
    Get the stored task complexity from task_metadata.json.

    Args:
        spec_dir: Directory containing the spec

    Returns:
        Task complexity level (defaults to MEDIUM if not found)
    """
    metadata_path = spec_dir / "task_metadata.json"

    if not metadata_path.exists():
        return "MEDIUM"

    try:
        with open(metadata_path) as f:
            metadata = json.load(f)
            complexity = metadata.get("complexity", "MEDIUM")
            if complexity in ("SIMPLE", "MEDIUM", "COMPLEX"):
                return complexity  # type: ignore
    except (json.JSONDecodeError, OSError):
        pass

    return "MEDIUM"
