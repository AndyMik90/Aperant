"""
Graph query operations for Graphiti memory.

Handles episode storage, retrieval, and filtering operations.
"""

import json
import logging
from datetime import datetime, timezone

from core.sentry import capture_exception

from .schema import (
    EPISODE_TYPE_CODEBASE_DISCOVERY,
    EPISODE_TYPE_GOTCHA,
    EPISODE_TYPE_PATTERN,
    EPISODE_TYPE_SESSION_INSIGHT,
    EPISODE_TYPE_TASK_OUTCOME,
)

logger = logging.getLogger(__name__)


class GraphitiQueries:
    """
    Manages episode storage and retrieval operations.

    Provides high-level methods for adding different types of episodes
    to the knowledge graph.
    """

    def __init__(self, client, group_id: str, spec_context_id: str):
        """
        Initialize query manager.

        Args:
            client: GraphitiClient instance
            group_id: Group ID for memory namespace
            spec_context_id: Spec-specific context ID
        """
        self.client = client
        self.group_id = group_id
        self.spec_context_id = spec_context_id

    async def add_session_insight(
        self,
        session_num: int,
        insights: dict,
    ) -> bool:
        """
        Save session insights as a Graphiti episode.

        Args:
            session_num: Session number (1-indexed)
            insights: Dictionary containing session learnings

        Returns:
            True if saved successfully
        """
        try:
            from graphiti_core.nodes import EpisodeType

            episode_content = {
                "type": EPISODE_TYPE_SESSION_INSIGHT,
                "spec_id": self.spec_context_id,
                "session_number": session_num,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **insights,
            }

            await self.client.graphiti.add_episode(
                name=f"session_{session_num:03d}_{self.spec_context_id}",
                episode_body=json.dumps(episode_content),
                source=EpisodeType.text,
                source_description=f"Auto-build session insight for {self.spec_context_id}",
                reference_time=datetime.now(timezone.utc),
                group_id=self.group_id,
            )

            logger.info(
                f"Saved session {session_num} insights to Graphiti (group: {self.group_id})"
            )
            return True

        except Exception as e:
            logger.warning(f"Failed to save session insights: {e}")
            capture_exception(
                e,
                operation="add_session_insight",
                group_id=self.group_id,
                spec_id=self.spec_context_id,
                session_number=session_num,
            )
            return False

    async def add_codebase_discoveries(
        self,
        discoveries: dict[str, str],
    ) -> bool:
        """
        Save codebase discoveries to the knowledge graph.

        Args:
            discoveries: Dictionary mapping file paths to their purposes

        Returns:
            True if saved successfully
        """
        if not discoveries:
            return True

        try:
            from graphiti_core.nodes import EpisodeType

            episode_content = {
                "type": EPISODE_TYPE_CODEBASE_DISCOVERY,
                "spec_id": self.spec_context_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "files": discoveries,
            }

            await self.client.graphiti.add_episode(
                name=f"codebase_discovery_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
                episode_body=json.dumps(episode_content),
                source=EpisodeType.text,
                source_description=f"Codebase file discoveries for {self.group_id}",
                reference_time=datetime.now(timezone.utc),
                group_id=self.group_id,
            )

            logger.info(f"Saved {len(discoveries)} codebase discoveries to Graphiti")
            return True

        except Exception as e:
            logger.warning(f"Failed to save codebase discoveries: {e}")
            capture_exception(
                e,
                operation="add_codebase_discoveries",
                group_id=self.group_id,
                spec_id=self.spec_context_id,
                discovery_count=len(discoveries),
            )
            return False

    async def add_pattern(self, pattern: str) -> bool:
        """
        Save a code pattern to the knowledge graph.

        Args:
            pattern: Description of the code pattern

        Returns:
            True if saved successfully
        """
        try:
            from graphiti_core.nodes import EpisodeType

            episode_content = {
                "type": EPISODE_TYPE_PATTERN,
                "spec_id": self.spec_context_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "pattern": pattern,
            }

            await self.client.graphiti.add_episode(
                name=f"pattern_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
                episode_body=json.dumps(episode_content),
                source=EpisodeType.text,
                source_description=f"Code pattern for {self.group_id}",
                reference_time=datetime.now(timezone.utc),
                group_id=self.group_id,
            )

            logger.info(f"Saved pattern to Graphiti: {pattern[:50]}...")
            return True

        except Exception as e:
            logger.warning(f"Failed to save pattern: {e}")
            capture_exception(
                e,
                operation="add_pattern",
                group_id=self.group_id,
                spec_id=self.spec_context_id,
                content_summary=pattern[:100] if pattern else "",
            )
            return False

    async def add_gotcha(self, gotcha: str) -> bool:
        """
        Save a gotcha (pitfall) to the knowledge graph.

        Args:
            gotcha: Description of the pitfall to avoid

        Returns:
            True if saved successfully
        """
        try:
            from graphiti_core.nodes import EpisodeType

            episode_content = {
                "type": EPISODE_TYPE_GOTCHA,
                "spec_id": self.spec_context_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "gotcha": gotcha,
            }

            await self.client.graphiti.add_episode(
                name=f"gotcha_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
                episode_body=json.dumps(episode_content),
                source=EpisodeType.text,
                source_description=f"Gotcha/pitfall for {self.group_id}",
                reference_time=datetime.now(timezone.utc),
                group_id=self.group_id,
            )

            logger.info(f"Saved gotcha to Graphiti: {gotcha[:50]}...")
            return True

        except Exception as e:
            logger.warning(f"Failed to save gotcha: {e}")
            capture_exception(
                e,
                operation="add_gotcha",
                group_id=self.group_id,
                spec_id=self.spec_context_id,
                content_summary=gotcha[:100] if gotcha else "",
            )
            return False

    async def add_task_outcome(
        self,
        task_id: str,
        success: bool,
        outcome: str,
        metadata: dict | None = None,
    ) -> bool:
        """
        Save a task outcome for learning from past successes/failures.

        Args:
            task_id: Unique identifier for the task
            success: Whether the task succeeded
            outcome: Description of what happened
            metadata: Optional additional context

        Returns:
            True if saved successfully
        """
        try:
            from graphiti_core.nodes import EpisodeType

            episode_content = {
                "type": EPISODE_TYPE_TASK_OUTCOME,
                "spec_id": self.spec_context_id,
                "task_id": task_id,
                "success": success,
                "outcome": outcome,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **(metadata or {}),
            }

            await self.client.graphiti.add_episode(
                name=f"task_outcome_{task_id}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
                episode_body=json.dumps(episode_content),
                source=EpisodeType.text,
                source_description=f"Task outcome for {task_id}",
                reference_time=datetime.now(timezone.utc),
                group_id=self.group_id,
            )

            status = "succeeded" if success else "failed"
            logger.info(f"Saved task outcome to Graphiti: {task_id} {status}")
            return True

        except Exception as e:
            logger.warning(f"Failed to save task outcome: {e}")
            capture_exception(
                e,
                operation="add_task_outcome",
                group_id=self.group_id,
                spec_id=self.spec_context_id,
                task_id=task_id,
                success=success,
                content_summary=outcome[:100] if outcome else "",
            )
            return False

    async def add_structured_insights(self, insights: dict) -> bool:
        """
        Save extracted insights as multiple focused episodes.

        Args:
            insights: Dictionary from insight_extractor with structured data

        Returns:
            True if saved successfully (or partially)
        """
        if not insights:
            return True

        saved_count = 0
        total_count = 0

        try:
            from graphiti_core.nodes import EpisodeType

            # 1. Save file insights
            for file_insight in insights.get("file_insights", []):
                total_count += 1
                try:
                    episode_content = {
                        "type": EPISODE_TYPE_CODEBASE_DISCOVERY,
                        "spec_id": self.spec_context_id,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "file_path": file_insight.get("path", "unknown"),
                        "purpose": file_insight.get("purpose", ""),
                        "changes_made": file_insight.get("changes_made", ""),
                        "patterns_used": file_insight.get("patterns_used", []),
                        "gotchas": file_insight.get("gotchas", []),
                    }

                    await self.client.graphiti.add_episode(
                        name=f"file_insight_{file_insight.get('path', 'unknown').replace('/', '_')}",
                        episode_body=json.dumps(episode_content),
                        source=EpisodeType.text,
                        source_description=f"File insight: {file_insight.get('path', 'unknown')}",
                        reference_time=datetime.now(timezone.utc),
                        group_id=self.group_id,
                    )
                    saved_count += 1
                except Exception as e:
                    if "duplicate_facts" in str(e):
                        logger.debug(f"Graphiti deduplication warning (non-fatal): {e}")
                        saved_count += 1
                    else:
                        logger.debug(f"Failed to save file insight: {e}")

            # 2. Save patterns
            for pattern in insights.get("patterns_discovered", []):
                total_count += 1
                try:
                    pattern_text = (
                        pattern.get("pattern", "")
                        if isinstance(pattern, dict)
                        else str(pattern)
                    )
                    applies_to = (
                        pattern.get("applies_to", "")
                        if isinstance(pattern, dict)
                        else ""
                    )
                    example = (
                        pattern.get("example", "") if isinstance(pattern, dict) else ""
                    )

                    episode_content = {
                        "type": EPISODE_TYPE_PATTERN,
                        "spec_id": self.spec_context_id,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "pattern": pattern_text,
                        "applies_to": applies_to,
                        "example": example,
                    }

                    await self.client.graphiti.add_episode(
                        name=f"pattern_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S%f')}",
                        episode_body=json.dumps(episode_content),
                        source=EpisodeType.text,
                        source_description=f"Pattern: {pattern_text[:50]}...",
                        reference_time=datetime.now(timezone.utc),
                        group_id=self.group_id,
                    )
                    saved_count += 1
                except Exception as e:
                    if "duplicate_facts" in str(e):
                        logger.debug(f"Graphiti deduplication warning (non-fatal): {e}")
                        saved_count += 1
                    else:
                        logger.debug(f"Failed to save pattern: {e}")

            # 3. Save gotchas
            for gotcha in insights.get("gotchas_discovered", []):
                total_count += 1
                try:
                    gotcha_text = (
                        gotcha.get("gotcha", "")
                        if isinstance(gotcha, dict)
                        else str(gotcha)
                    )
                    trigger = (
                        gotcha.get("trigger", "") if isinstance(gotcha, dict) else ""
                    )
                    solution = (
                        gotcha.get("solution", "") if isinstance(gotcha, dict) else ""
                    )

                    episode_content = {
                        "type": EPISODE_TYPE_GOTCHA,
                        "spec_id": self.spec_context_id,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "gotcha": gotcha_text,
                        "trigger": trigger,
                        "solution": solution,
                    }

                    await self.client.graphiti.add_episode(
                        name=f"gotcha_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S%f')}",
                        episode_body=json.dumps(episode_content),
                        source=EpisodeType.text,
                        source_description=f"Gotcha: {gotcha_text[:50]}...",
                        reference_time=datetime.now(timezone.utc),
                        group_id=self.group_id,
                    )
                    saved_count += 1
                except Exception as e:
                    if "duplicate_facts" in str(e):
                        logger.debug(f"Graphiti deduplication warning (non-fatal): {e}")
                        saved_count += 1
                    else:
                        logger.debug(f"Failed to save gotcha: {e}")

            # 4. Save approach outcome
            outcome = insights.get("approach_outcome", {})
            if outcome:
                total_count += 1
                try:
                    subtask_id = insights.get("subtask_id", "unknown")
                    success = outcome.get("success", insights.get("success", False))

                    episode_content = {
                        "type": EPISODE_TYPE_TASK_OUTCOME,
                        "spec_id": self.spec_context_id,
                        "task_id": subtask_id,
                        "success": success,
                        "outcome": outcome.get("approach_used", ""),
                        "why_worked": outcome.get("why_it_worked"),
                        "why_failed": outcome.get("why_it_failed"),
                        "alternatives_tried": outcome.get("alternatives_tried", []),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "changed_files": insights.get("changed_files", []),
                    }

                    await self.client.graphiti.add_episode(
                        name=f"task_outcome_{subtask_id}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
                        episode_body=json.dumps(episode_content),
                        source=EpisodeType.text,
                        source_description=f"Task outcome: {subtask_id} {'succeeded' if success else 'failed'}",
                        reference_time=datetime.now(timezone.utc),
                        group_id=self.group_id,
                    )
                    saved_count += 1
                except Exception as e:
                    # Graphiti deduplication can fail with "invalid duplicate_facts idx"
                    # This is a known issue in graphiti-core - episode is still partially saved
                    if "duplicate_facts" in str(e):
                        logger.debug(f"Graphiti deduplication warning (non-fatal): {e}")
                        saved_count += 1  # Episode likely saved, just dedup failed
                    else:
                        logger.debug(f"Failed to save task outcome: {e}")

            # 5. Save recommendations
            recommendations = insights.get("recommendations", [])
            if recommendations:
                total_count += 1
                try:
                    episode_content = {
                        "type": EPISODE_TYPE_SESSION_INSIGHT,
                        "spec_id": self.spec_context_id,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "subtask_id": insights.get("subtask_id", "unknown"),
                        "session_number": insights.get("session_num", 0),
                        "recommendations": recommendations,
                        "success": insights.get("success", False),
                    }

                    await self.client.graphiti.add_episode(
                        name=f"recommendations_{insights.get('subtask_id', 'unknown')}",
                        episode_body=json.dumps(episode_content),
                        source=EpisodeType.text,
                        source_description=f"Recommendations for {insights.get('subtask_id', 'unknown')}",
                        reference_time=datetime.now(timezone.utc),
                        group_id=self.group_id,
                    )
                    saved_count += 1
                except Exception as e:
                    if "duplicate_facts" in str(e):
                        logger.debug(f"Graphiti deduplication warning (non-fatal): {e}")
                        saved_count += 1
                    else:
                        logger.debug(f"Failed to save recommendations: {e}")

            logger.info(
                f"Saved {saved_count}/{total_count} structured insights to Graphiti "
                f"(group: {self.group_id})"
            )
            return saved_count > 0

        except Exception as e:
            logger.warning(f"Failed to save structured insights: {e}")
            # Build content summary of insight types
            insight_types = []
            if insights.get("file_insights"):
                insight_types.append(f"files:{len(insights['file_insights'])}")
            if insights.get("patterns_discovered"):
                insight_types.append(f"patterns:{len(insights['patterns_discovered'])}")
            if insights.get("gotchas_discovered"):
                insight_types.append(f"gotchas:{len(insights['gotchas_discovered'])}")
            if insights.get("approach_outcome"):
                insight_types.append("outcome:1")
            if insights.get("recommendations"):
                insight_types.append(
                    f"recommendations:{len(insights['recommendations'])}"
                )

            capture_exception(
                e,
                operation="add_structured_insights",
                group_id=self.group_id,
                spec_id=self.spec_context_id,
                content_summary=", ".join(insight_types) if insight_types else "empty",
            )
            return False
