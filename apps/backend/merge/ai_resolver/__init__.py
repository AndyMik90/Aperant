"""
AI Resolver Module
==================

AI-based conflict resolution for the AC Jerry merge system.

This module provides intelligent conflict resolution using AI with
minimal context to reduce token usage and cost.

Components:
- AIResolver: Main resolver class
- ConflictContext: Minimal context for AI prompts
- create_claude_resolver: Factory for Claude-based resolver

Usage:
    from merge.ai_resolver import AIResolver, create_claude_resolver

    # Create resolver with Claude integration
    resolver = create_claude_resolver()

    # Or create with custom AI function
    resolver = AIResolver(ai_call_fn=my_ai_function)

    # Resolve a conflict
    result = resolver.resolve_conflict(conflict, baseline_code, task_snapshots)
"""

from .claude_client import create_claude_resolver
from .context import ConflictContext
from .resolver import AIResolver

__all__ = [
    "AIResolver",
    "ConflictContext",
    "create_claude_resolver",
]
