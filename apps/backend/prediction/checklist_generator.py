"""
Checklist generation logic for pre-implementation planning.
"""

from .models import PreImplementationChecklist
from .patterns import detect_work_type


class ChecklistGenerator:
    """Generates pre-implementation checklists from analyzed risks."""

    def generate_checklist(
        self,
        subtask: dict,
        predicted_issues: list,
        known_patterns: list[str],
        known_gotchas: list[str],
    ) -> PreImplementationChecklist:
        """
        Generate a complete pre-implementation checklist for a subtask.

        Args:
            subtask: Subtask dictionary from implementation_plan.json
            predicted_issues: List of PredictedIssue objects
            known_patterns: List of known successful patterns
            known_gotchas: List of known gotchas/mistakes

        Returns:
            PreImplementationChecklist ready for formatting
        """
        checklist = PreImplementationChecklist(
            subtask_id=subtask.get("id", "unknown"),
            subtask_description=subtask.get("description", ""),
        )

        # Add predicted issues
        checklist.predicted_issues = predicted_issues

        # Filter to most relevant patterns
        work_types = detect_work_type(subtask)
        relevant_patterns = self._filter_relevant_patterns(
            known_patterns, work_types, subtask
        )
        checklist.patterns_to_follow = relevant_patterns[:5]  # Top 5

        # Files to reference (from subtask's patterns_from)
        checklist.files_to_reference = subtask.get("patterns_from", [])

        # Filter to relevant gotchas
        relevant_gotchas = self._filter_relevant_gotchas(
            known_gotchas, work_types, subtask
        )
        checklist.common_mistakes = relevant_gotchas[:5]  # Top 5

        # Add verification reminders
        checklist.verification_reminders = self._generate_verification_reminders(
            subtask
        )

        return checklist

    def _filter_relevant_patterns(
        self,
        patterns: list[str],
        work_types: list[str],
        subtask: dict,
    ) -> list[str]:
        """
        Filter patterns to those most relevant to the current subtask.

        Args:
            patterns: All known patterns
            work_types: Detected work types for this subtask
            subtask: The subtask being analyzed

        Returns:
            Filtered list of relevant patterns
        """
        relevant_patterns = []
        for pattern in patterns:
            pattern_lower = pattern.lower()
            # Check if pattern mentions any work type
            if any(wt.replace("_", " ") in pattern_lower for wt in work_types):
                relevant_patterns.append(pattern)
            # Or if it mentions any file being modified
            elif any(
                f.split("/")[-1] in pattern_lower
                for f in subtask.get("files_to_modify", [])
            ):
                relevant_patterns.append(pattern)

        return relevant_patterns

    def _filter_relevant_gotchas(
        self,
        gotchas: list[str],
        work_types: list[str],
        subtask: dict,
    ) -> list[str]:
        """
        Filter gotchas to those most relevant to the current subtask.

        Args:
            gotchas: All known gotchas
            work_types: Detected work types for this subtask
            subtask: The subtask being analyzed

        Returns:
            Filtered list of relevant gotchas
        """
        relevant_gotchas = []
        subtask_description_lower = subtask.get("description", "").lower()

        for gotcha in gotchas:
            gotcha_lower = gotcha.lower()
            # Check relevance to current subtask
            if any(kw in gotcha_lower for kw in subtask_description_lower.split()):
                relevant_gotchas.append(gotcha)
            elif any(wt.replace("_", " ") in gotcha_lower for wt in work_types):
                relevant_gotchas.append(gotcha)

        return relevant_gotchas

    def _generate_verification_reminders(self, subtask: dict) -> list[str]:
        """
        Generate verification reminders based on subtask verification config.

        Args:
            subtask: The subtask being analyzed

        Returns:
            List of verification reminder strings
        """
        reminders = []
        verification = subtask.get("verification", {})

        if verification:
            ver_type = verification.get("type")
            if ver_type == "api":
                reminders.append(
                    f"Test API endpoint: {verification.get('method', 'GET')} "
                    f"{verification.get('url', '')}"
                )
            elif ver_type == "browser":
                reminders.append(
                    f"Test in browser: {verification.get('scenario', 'Check functionality')}"
                )
            elif ver_type == "command":
                reminders.append(
                    f"Run command: {verification.get('run', verification.get('command', ''))}"
                )
            elif ver_type == "e2e":
                steps = verification.get("steps", [])
                if steps:
                    reminders.append(
                        f"E2E verification: {len(steps)} steps to complete"
                    )
                else:
                    reminders.append("E2E verification required")
            elif ver_type == "manual":
                reminders.append(
                    f"Manual check: {verification.get('instructions', 'Verify manually')}"
                )
            elif ver_type == "none":
                pass  # No reminder needed

        return reminders
