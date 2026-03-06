"""
Graph schema definitions and constants for Graphiti memory.

Defines episode types and data structures used across the memory system.
"""

import os

# Episode type constants
EPISODE_TYPE_SESSION_INSIGHT = "session_insight"
EPISODE_TYPE_CODEBASE_DISCOVERY = "codebase_discovery"
EPISODE_TYPE_PATTERN = "pattern"
EPISODE_TYPE_GOTCHA = "gotcha"
EPISODE_TYPE_TASK_OUTCOME = "task_outcome"
EPISODE_TYPE_QA_RESULT = "qa_result"
EPISODE_TYPE_HISTORICAL_CONTEXT = "historical_context"

ALL_EPISODE_TYPES = [
    EPISODE_TYPE_SESSION_INSIGHT,
    EPISODE_TYPE_CODEBASE_DISCOVERY,
    EPISODE_TYPE_PATTERN,
    EPISODE_TYPE_GOTCHA,
    EPISODE_TYPE_TASK_OUTCOME,
    EPISODE_TYPE_QA_RESULT,
    EPISODE_TYPE_HISTORICAL_CONTEXT,
]

# Maximum results to return for context queries (configurable via env var)
try:
    MAX_CONTEXT_RESULTS = int(os.getenv("GRAPHITI_MAX_RESULTS", "10"))
except ValueError:
    MAX_CONTEXT_RESULTS = 10

# Retry configuration
MAX_RETRIES = 2
RETRY_DELAY_SECONDS = 1


class GroupIdMode:
    """Group ID modes for Graphiti memory scoping."""

    SPEC = "spec"  # Each spec gets its own namespace
    PROJECT = "project"  # All specs share project-wide context
