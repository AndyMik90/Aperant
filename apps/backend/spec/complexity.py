"""
Complexity Assessment Module
=============================

AI and heuristic-based task complexity analysis.
Determines which phases should run based on task scope.
"""

import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path


class Complexity(Enum):
    """Task complexity tiers that determine which phases to run."""

    SIMPLE = "simple"  # 1-2 files, single service, no integrations
    STANDARD = "standard"  # 3-10 files, 1-2 services, minimal integrations
    COMPLEX = "complex"  # 10+ files, multiple services, external integrations


@dataclass
class ComplexityAssessment:
    """Result of analyzing task complexity."""

    complexity: Complexity
    confidence: float  # 0.0 to 1.0
    signals: dict = field(default_factory=dict)
    reasoning: str = ""

    # Detected characteristics
    estimated_files: int = 1
    estimated_services: int = 1
    external_integrations: list = field(default_factory=list)
    infrastructure_changes: bool = False

    # AI-recommended phases (if using AI assessment)
    recommended_phases: list = field(default_factory=list)

    # Flags from AI assessment
    needs_research: bool = False
    needs_self_critique: bool = False

    def phases_to_run(self) -> list[str]:
        """Return list of phase names to run based on complexity."""
        # If AI provided recommended phases, use those
        if self.recommended_phases:
            return self.recommended_phases

        # Otherwise fall back to default phase sets
        # Note: historical_context runs early (after discovery) if Graphiti is enabled
        # It's included by default but gracefully skips if not configured
        if self.complexity == Complexity.SIMPLE:
            return ["discovery", "historical_context", "quick_spec", "validation"]
        elif self.complexity == Complexity.STANDARD:
            # Standard can optionally include research if flagged
            phases = ["discovery", "historical_context", "requirements"]
            if self.needs_research:
                phases.append("research")
            phases.extend(["context", "spec_writing", "planning", "validation"])
            return phases
        else:  # COMPLEX
            return [
                "discovery",
                "historical_context",
                "requirements",
                "research",
                "context",
                "spec_writing",
                "self_critique",
                "planning",
                "validation",
            ]


class ComplexityAnalyzer:
    """Analyzes task description and context to determine complexity."""

    # Keywords that suggest different complexity levels
    SIMPLE_KEYWORDS = [
        "fix",
        "typo",
        "update",
        "change",
        "rename",
        "remove",
        "delete",
        "adjust",
        "tweak",
        "correct",
        "modify",
        "style",
        "color",
        "text",
        "label",
        "button",
        "margin",
        "padding",
        "font",
        "size",
        "hide",
        "show",
    ]

    COMPLEX_KEYWORDS = [
        "integrate",
        "integration",
        "api",
        "sdk",
        "library",
        "package",
        "database",
        "migrate",
        "migration",
        "docker",
        "kubernetes",
        "deploy",
        "authentication",
        "oauth",
        "graphql",
        "websocket",
        "queue",
        "cache",
        "redis",
        "postgres",
        "mongo",
        "elasticsearch",
        "kafka",
        "rabbitmq",
        "microservice",
        "refactor",
        "architecture",
        "infrastructure",
    ]

    MULTI_SERVICE_KEYWORDS = [
        "backend",
        "frontend",
        "worker",
        "service",
        "api",
        "client",
        "server",
        "database",
        "queue",
        "cache",
        "proxy",
    ]

    def __init__(self, project_index: dict | None = None):
        self.project_index = project_index or {}

    def analyze(
        self, task_description: str, requirements: dict | None = None
    ) -> ComplexityAssessment:
        """Analyze task and return complexity assessment."""
        task_lower = task_description.lower()
        signals = {}

        # 1. Keyword analysis
        simple_matches = sum(1 for kw in self.SIMPLE_KEYWORDS if kw in task_lower)
        complex_matches = sum(1 for kw in self.COMPLEX_KEYWORDS if kw in task_lower)
        multi_service_matches = sum(
            1 for kw in self.MULTI_SERVICE_KEYWORDS if kw in task_lower
        )

        signals["simple_keywords"] = simple_matches
        signals["complex_keywords"] = complex_matches
        signals["multi_service_keywords"] = multi_service_matches

        # 2. External integrations detection
        integrations = self._detect_integrations(task_lower)
        signals["external_integrations"] = len(integrations)

        # 3. Infrastructure changes detection
        infra_changes = self._detect_infrastructure_changes(task_lower)
        signals["infrastructure_changes"] = infra_changes

        # 4. Estimate files and services
        estimated_files = self._estimate_files(task_lower, requirements)
        estimated_services = self._estimate_services(task_lower, requirements)
        signals["estimated_files"] = estimated_files
        signals["estimated_services"] = estimated_services

        # 5. Requirements-based signals (if available)
        if requirements:
            services_involved = requirements.get("services_involved", [])
            signals["explicit_services"] = len(services_involved)
            estimated_services = max(estimated_services, len(services_involved))

        # Determine complexity
        complexity, confidence, reasoning = self._calculate_complexity(
            signals, integrations, infra_changes, estimated_files, estimated_services
        )

        return ComplexityAssessment(
            complexity=complexity,
            confidence=confidence,
            signals=signals,
            reasoning=reasoning,
            estimated_files=estimated_files,
            estimated_services=estimated_services,
            external_integrations=integrations,
            infrastructure_changes=infra_changes,
        )

    def _detect_integrations(self, task_lower: str) -> list[str]:
        """Detect external integrations mentioned in task."""
        integration_patterns = [
            r"\b(graphiti|graphql|apollo)\b",
            r"\b(stripe|paypal|payment)\b",
            r"\b(auth0|okta|oauth|jwt)\b",
            r"\b(aws|gcp|azure|s3|lambda)\b",
            r"\b(redis|memcached|cache)\b",
            r"\b(postgres|mysql|mongodb|database)\b",
            r"\b(elasticsearch|algolia|search)\b",
            r"\b(kafka|rabbitmq|sqs|queue)\b",
            r"\b(docker|kubernetes|k8s)\b",
            r"\b(openai|anthropic|llm|ai)\b",
            r"\b(sendgrid|twilio|email|sms)\b",
        ]

        found = []
        for pattern in integration_patterns:
            matches = re.findall(pattern, task_lower)
            found.extend(matches)

        return list(set(found))

    def _detect_infrastructure_changes(self, task_lower: str) -> bool:
        """Detect if task involves infrastructure changes."""
        infra_patterns = [
            r"\bdocker\b",
            r"\bkubernetes\b",
            r"\bk8s\b",
            r"\bdeploy\b",
            r"\binfrastructure\b",
            r"\bci/cd\b",
            r"\benvironment\b",
            r"\bconfig\b",
            r"\b\.env\b",
            r"\bdatabase migration\b",
            r"\bschema\b",
        ]

        for pattern in infra_patterns:
            if re.search(pattern, task_lower):
                return True
        return False

    def _estimate_files(self, task_lower: str, requirements: dict | None) -> int:
        """Estimate number of files to be modified."""
        # Base estimate from task description
        if any(
            kw in task_lower
            for kw in ["single", "one file", "one component", "this file"]
        ):
            return 1

        # Check for explicit file mentions
        file_mentions = len(
            re.findall(r"\.(tsx?|jsx?|py|go|rs|java|rb|php|vue|svelte)\b", task_lower)
        )
        if file_mentions > 0:
            return max(1, file_mentions)

        # Heuristic based on task scope
        if any(kw in task_lower for kw in self.SIMPLE_KEYWORDS):
            return 2
        elif any(kw in task_lower for kw in ["feature", "add", "implement", "create"]):
            return 5
        elif any(kw in task_lower for kw in self.COMPLEX_KEYWORDS):
            return 15

        return 5  # Default estimate

    def _estimate_services(self, task_lower: str, requirements: dict | None) -> int:
        """Estimate number of services involved."""
        service_count = sum(1 for kw in self.MULTI_SERVICE_KEYWORDS if kw in task_lower)

        # If project is a monorepo, check project_index
        if self.project_index.get("project_type") == "monorepo":
            services = self.project_index.get("services", {})
            if services:
                # Check which services are mentioned
                mentioned = sum(1 for svc in services if svc.lower() in task_lower)
                if mentioned > 0:
                    return mentioned

        return max(1, min(service_count, 5))

    def _calculate_complexity(
        self,
        signals: dict,
        integrations: list,
        infra_changes: bool,
        estimated_files: int,
        estimated_services: int,
    ) -> tuple[Complexity, float, str]:
        """Calculate final complexity based on all signals."""

        reasons = []

        # Strong indicators for SIMPLE
        if (
            estimated_files <= 2
            and estimated_services == 1
            and len(integrations) == 0
            and not infra_changes
            and signals["simple_keywords"] > 0
            and signals["complex_keywords"] == 0
        ):
            reasons.append(
                f"Single service, {estimated_files} file(s), no integrations"
            )
            return Complexity.SIMPLE, 0.9, "; ".join(reasons)

        # Strong indicators for COMPLEX
        if (
            len(integrations) >= 2
            or infra_changes
            or estimated_services >= 3
            or estimated_files >= 10
            or signals["complex_keywords"] >= 3
        ):
            reasons.append(
                f"{len(integrations)} integrations, {estimated_services} services, {estimated_files} files"
            )
            if infra_changes:
                reasons.append("infrastructure changes detected")
            return Complexity.COMPLEX, 0.85, "; ".join(reasons)

        # Default to STANDARD
        reasons.append(f"{estimated_files} files, {estimated_services} service(s)")
        if len(integrations) > 0:
            reasons.append(f"{len(integrations)} integration(s)")

        return Complexity.STANDARD, 0.75, "; ".join(reasons)


async def run_ai_complexity_assessment(
    spec_dir: Path,
    task_description: str,
    run_agent_fn,
) -> ComplexityAssessment | None:
    """Run AI agent to assess complexity. Returns None if it fails.

    Args:
        spec_dir: Path to spec directory
        task_description: Task description string
        run_agent_fn: Async function to run the agent with prompt
    """
    assessment_file = spec_dir / "complexity_assessment.json"

    # Prepare context for the AI
    context = f"""
**Project Directory**: {spec_dir.parent.parent}
**Spec Directory**: {spec_dir}
"""

    # Load requirements if available
    requirements_file = spec_dir / "requirements.json"
    if requirements_file.exists():
        with open(requirements_file, encoding="utf-8") as f:
            req = json.load(f)
            context += f"""
## Requirements (from user)
**Task Description**: {req.get("task_description", "Not provided")}
**Workflow Type**: {req.get("workflow_type", "Not specified")}
**Services Involved**: {", ".join(req.get("services_involved", []))}
**User Requirements**:
{chr(10).join(f"- {r}" for r in req.get("user_requirements", []))}
**Acceptance Criteria**:
{chr(10).join(f"- {c}" for c in req.get("acceptance_criteria", []))}
**Constraints**:
{chr(10).join(f"- {c}" for c in req.get("constraints", []))}
"""
    else:
        context += f"\n**Task Description**: {task_description or 'Not provided'}\n"

    # Add project index if available
    auto_build_index = spec_dir.parent.parent / "project_index.json"
    if auto_build_index.exists():
        context += f"\n**Project Index**: Available at {auto_build_index}\n"

    # Point to requirements file for detailed reading
    if requirements_file.exists():
        context += f"\n**Requirements File**: {requirements_file} (read this for full details)\n"

    try:
        success, output = await run_agent_fn(
            "complexity_assessor.md",
            additional_context=context,
        )

        if success and assessment_file.exists():
            with open(assessment_file, encoding="utf-8") as f:
                data = json.load(f)

            # Parse AI assessment into ComplexityAssessment
            complexity_str = data.get("complexity", "standard").lower()
            complexity = Complexity(complexity_str)

            # Extract flags
            flags = data.get("flags", {})

            return ComplexityAssessment(
                complexity=complexity,
                confidence=data.get("confidence", 0.75),
                reasoning=data.get("reasoning", "AI assessment"),
                signals=data.get("analysis", {}),
                estimated_files=data.get("analysis", {})
                .get("scope", {})
                .get("estimated_files", 5),
                estimated_services=data.get("analysis", {})
                .get("scope", {})
                .get("estimated_services", 1),
                external_integrations=data.get("analysis", {})
                .get("integrations", {})
                .get("external_services", []),
                infrastructure_changes=data.get("analysis", {})
                .get("infrastructure", {})
                .get("docker_changes", False),
                recommended_phases=data.get("recommended_phases", []),
                needs_research=flags.get("needs_research", False),
                needs_self_critique=flags.get("needs_self_critique", False),
            )

        return None

    except Exception:
        return None


def save_assessment(spec_dir: Path, assessment: ComplexityAssessment) -> Path:
    """Save complexity assessment to file."""
    assessment_file = spec_dir / "complexity_assessment.json"
    phases = assessment.phases_to_run()

    with open(assessment_file, "w", encoding="utf-8") as f:
        json.dump(
            {
                "complexity": assessment.complexity.value,
                "confidence": assessment.confidence,
                "reasoning": assessment.reasoning,
                "signals": assessment.signals,
                "estimated_files": assessment.estimated_files,
                "estimated_services": assessment.estimated_services,
                "external_integrations": assessment.external_integrations,
                "infrastructure_changes": assessment.infrastructure_changes,
                "phases_to_run": phases,
                "needs_research": assessment.needs_research,
                "needs_self_critique": assessment.needs_self_critique,
                "created_at": datetime.now().isoformat(),
            },
            f,
            indent=2,
        )

    return assessment_file
