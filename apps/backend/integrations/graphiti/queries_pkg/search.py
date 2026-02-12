"""
Semantic search operations for Graphiti memory.

Handles context retrieval, history queries, and similarity searches.
"""

import hashlib
import json
import logging
from pathlib import Path

from core.sentry import capture_exception

from .schema import (
    EPISODE_TYPE_GOTCHA,
    EPISODE_TYPE_PATTERN,
    EPISODE_TYPE_SESSION_INSIGHT,
    EPISODE_TYPE_TASK_OUTCOME,
    MAX_CONTEXT_RESULTS,
    GroupIdMode,
)

logger = logging.getLogger(__name__)


class GraphitiSearch:
    """
    Manages semantic search and context retrieval operations.

    Provides methods for finding relevant knowledge from the graph.
    """

    def __init__(
        self,
        client,
        group_id: str,
        spec_context_id: str,
        group_id_mode: str,
        project_dir: Path,
    ):
        """
        Initialize search manager.

        Args:
            client: GraphitiClient instance
            group_id: Group ID for memory namespace
            spec_context_id: Spec-specific context ID
            group_id_mode: "spec" or "project" mode
            project_dir: Project root directory
        """
        self.client = client
        self.group_id = group_id
        self.spec_context_id = spec_context_id
        self.group_id_mode = group_id_mode
        self.project_dir = project_dir

    async def get_relevant_context(
        self,
        query: str,
        num_results: int = MAX_CONTEXT_RESULTS,
        include_project_context: bool = True,
        min_score: float = 0.0,
    ) -> list[dict]:
        """
        Search for relevant context based on a query.

        Args:
            query: Search query
            num_results: Maximum number of results to return
            include_project_context: If True and in SPEC mode, also search project-wide
            min_score: Minimum relevance score threshold (0.0 to 1.0)

        Returns:
            List of relevant context items with content, score, and type
        """
        try:
            # Determine which group IDs to search
            group_ids = [self.group_id]

            # In spec mode, optionally include project context too
            if self.group_id_mode == GroupIdMode.SPEC and include_project_context:
                project_name = self.project_dir.name
                path_hash = hashlib.md5(
                    str(self.project_dir.resolve()).encode(), usedforsecurity=False
                ).hexdigest()[:8]
                project_group_id = f"project_{project_name}_{path_hash}"
                if project_group_id != self.group_id:
                    group_ids.append(project_group_id)

            results = await self.client.graphiti.search(
                query=query,
                group_ids=group_ids,
                num_results=min(num_results, MAX_CONTEXT_RESULTS),
            )

            context_items = []
            for result in results:
                # Extract content from result
                content = (
                    getattr(result, "content", None)
                    or getattr(result, "fact", None)
                    or str(result)
                )

                # Normalize score to float, treating None as 0.0
                raw_score = getattr(result, "score", None)
                score = raw_score if raw_score is not None else 0.0

                context_items.append(
                    {
                        "content": content,
                        "score": score,
                        "type": getattr(result, "type", "unknown"),
                    }
                )

            # Filter by minimum score if specified
            if min_score > 0:
                context_items = [
                    item
                    for item in context_items
                    if (item.get("score", 0.0)) >= min_score
                ]

            logger.info(
                f"Found {len(context_items)} relevant context items for: {query[:50]}..."
            )
            return context_items

        except Exception as e:
            logger.warning(f"Failed to search context: {e}")
            capture_exception(
                e,
                query_summary=query[:100] if query else "",
                group_id=self.group_id,
                operation="get_relevant_context",
            )
            return []

    async def get_session_history(
        self,
        limit: int = 5,
        spec_only: bool = True,
    ) -> list[dict]:
        """
        Get recent session insights from the knowledge graph.

        Args:
            limit: Maximum number of sessions to return
            spec_only: If True, only return sessions from this spec

        Returns:
            List of session insight summaries
        """
        try:
            results = await self.client.graphiti.search(
                query="session insight completed subtasks recommendations",
                group_ids=[self.group_id],
                num_results=limit * 2,  # Get more to filter
            )

            sessions = []
            for result in results:
                content = getattr(result, "content", None) or getattr(
                    result, "fact", None
                )
                if content and EPISODE_TYPE_SESSION_INSIGHT in str(content):
                    try:
                        data = (
                            json.loads(content) if isinstance(content, str) else content
                        )
                        # Ensure data is a dict before processing (fixes ACS-215)
                        if not isinstance(data, dict):
                            continue
                        if data.get("type") == EPISODE_TYPE_SESSION_INSIGHT:
                            # Filter by spec if requested
                            if (
                                spec_only
                                and data.get("spec_id") != self.spec_context_id
                            ):
                                continue
                            sessions.append(data)
                    except (json.JSONDecodeError, TypeError, AttributeError):
                        continue

            # Sort by session number and return latest
            sessions.sort(key=lambda x: x.get("session_number", 0), reverse=True)
            return sessions[:limit]

        except Exception as e:
            logger.warning(f"Failed to get session history: {e}")
            capture_exception(
                e,
                group_id=self.group_id,
                operation="get_session_history",
            )
            return []

    async def get_similar_task_outcomes(
        self,
        task_description: str,
        limit: int = 5,
    ) -> list[dict]:
        """
        Find similar past task outcomes to learn from.

        Args:
            task_description: Description of the current task
            limit: Maximum number of results

        Returns:
            List of similar task outcomes with success/failure info
        """
        try:
            results = await self.client.graphiti.search(
                query=f"task outcome: {task_description}",
                group_ids=[self.group_id],
                num_results=limit * 2,
            )

            outcomes = []
            for result in results:
                content = getattr(result, "content", None) or getattr(
                    result, "fact", None
                )
                if content and EPISODE_TYPE_TASK_OUTCOME in str(content):
                    try:
                        data = (
                            json.loads(content) if isinstance(content, str) else content
                        )
                        # Ensure data is a dict before processing (fixes ACS-215)
                        if not isinstance(data, dict):
                            continue
                        if data.get("type") == EPISODE_TYPE_TASK_OUTCOME:
                            raw_score = getattr(result, "score", None)
                            score = raw_score if raw_score is not None else 0.0
                            outcomes.append(
                                {
                                    "task_id": data.get("task_id"),
                                    "success": data.get("success"),
                                    "outcome": data.get("outcome"),
                                    "score": score,
                                }
                            )
                    except (json.JSONDecodeError, TypeError, AttributeError):
                        continue

            return outcomes[:limit]

        except Exception as e:
            logger.warning(f"Failed to get similar task outcomes: {e}")
            capture_exception(
                e,
                query_summary=task_description[:100] if task_description else "",
                group_id=self.group_id,
                operation="get_similar_task_outcomes",
            )
            return []

    async def get_patterns_and_gotchas(
        self,
        query: str,
        num_results: int = 5,
        min_score: float = 0.5,
    ) -> tuple[list[dict], list[dict]]:
        """
        Retrieve patterns and gotchas relevant to the current task.

        Unlike get_relevant_context(), this specifically filters for
        EPISODE_TYPE_PATTERN and EPISODE_TYPE_GOTCHA episodes to enable
        cross-session learning.

        Args:
            query: Search query (task description)
            num_results: Max results per type
            min_score: Minimum relevance score (0.0-1.0)

        Returns:
            Tuple of (patterns, gotchas) lists
        """
        patterns = []
        gotchas = []

        try:
            # Search with query focused on patterns
            pattern_results = await self.client.graphiti.search(
                query=f"pattern: {query}",
                group_ids=[self.group_id],
                num_results=num_results * 2,
            )

            for result in pattern_results:
                content = getattr(result, "content", None) or getattr(
                    result, "fact", None
                )
                raw_score = getattr(result, "score", None)
                score = raw_score if raw_score is not None else 0.0

                if score < min_score:
                    continue

                if content and EPISODE_TYPE_PATTERN in str(content):
                    try:
                        data = (
                            json.loads(content) if isinstance(content, str) else content
                        )
                        # Ensure data is a dict before processing (fixes ACS-215)
                        if not isinstance(data, dict):
                            continue
                        if data.get("type") == EPISODE_TYPE_PATTERN:
                            patterns.append(
                                {
                                    "pattern": data.get("pattern", ""),
                                    "applies_to": data.get("applies_to", ""),
                                    "example": data.get("example", ""),
                                    "score": score,
                                }
                            )
                    except (json.JSONDecodeError, TypeError, AttributeError):
                        continue

            # Search with query focused on gotchas
            gotcha_results = await self.client.graphiti.search(
                query=f"gotcha pitfall avoid: {query}",
                group_ids=[self.group_id],
                num_results=num_results * 2,
            )

            for result in gotcha_results:
                content = getattr(result, "content", None) or getattr(
                    result, "fact", None
                )
                raw_score = getattr(result, "score", None)
                score = raw_score if raw_score is not None else 0.0

                if score < min_score:
                    continue

                if content and EPISODE_TYPE_GOTCHA in str(content):
                    try:
                        data = (
                            json.loads(content) if isinstance(content, str) else content
                        )
                        # Ensure data is a dict before processing (fixes ACS-215)
                        if not isinstance(data, dict):
                            continue
                        if data.get("type") == EPISODE_TYPE_GOTCHA:
                            gotchas.append(
                                {
                                    "gotcha": data.get("gotcha", ""),
                                    "trigger": data.get("trigger", ""),
                                    "solution": data.get("solution", ""),
                                    "score": score,
                                }
                            )
                    except (json.JSONDecodeError, TypeError, AttributeError):
                        continue

            # Sort by score and limit
            patterns.sort(key=lambda x: x.get("score", 0), reverse=True)
            gotchas.sort(key=lambda x: x.get("score", 0), reverse=True)

            logger.info(
                f"Found {len(patterns)} patterns and {len(gotchas)} gotchas for: {query[:50]}..."
            )
            return patterns[:num_results], gotchas[:num_results]

        except Exception as e:
            logger.warning(f"Failed to get patterns/gotchas: {e}")
            capture_exception(
                e,
                query_summary=query[:100] if query else "",
                group_id=self.group_id,
                operation="get_patterns_and_gotchas",
            )
            return [], []
