"""
Context Builder
===============

Main builder class that orchestrates context building for tasks.
"""

import asyncio
import json
from dataclasses import asdict
from pathlib import Path

from .categorizer import FileCategorizer
from .graphiti_integration import fetch_graph_hints, is_graphiti_enabled
from .keyword_extractor import KeywordExtractor
from .models import FileMatch, TaskContext
from .pattern_discovery import PatternDiscoverer
from .search import CodeSearcher
from .service_matcher import ServiceMatcher


class ContextBuilder:
    """Builds task-specific context by searching the codebase."""

    def __init__(self, project_dir: Path, project_index: dict | None = None):
        self.project_dir = project_dir.resolve()
        self.project_index = project_index or self._load_project_index()

        # Initialize components
        self.searcher = CodeSearcher(self.project_dir)
        self.service_matcher = ServiceMatcher(self.project_index)
        self.keyword_extractor = KeywordExtractor()
        self.categorizer = FileCategorizer()
        self.pattern_discoverer = PatternDiscoverer(self.project_dir)

    def _load_project_index(self) -> dict:
        """Load project index from file or create new one (.auto-claude is the installed instance)."""
        index_file = self.project_dir / ".auto-claude" / "project_index.json"
        if index_file.exists():
            try:
                with open(index_file, encoding="utf-8") as f:
                    return json.load(f)
            except (OSError, json.JSONDecodeError, UnicodeDecodeError):
                # Corrupted or legacy-encoded file, regenerate
                pass

        # Try to create one
        from analyzer import analyze_project

        return analyze_project(self.project_dir)

    def build_context(
        self,
        task: str,
        services: list[str] | None = None,
        keywords: list[str] | None = None,
        include_graph_hints: bool = True,
    ) -> TaskContext:
        """
        Build context for a specific task.

        Args:
            task: Description of the task
            services: List of service names to search (None = auto-detect)
            keywords: Additional keywords to search for
            include_graph_hints: Whether to include historical hints from Graphiti

        Returns:
            TaskContext with relevant files and patterns
        """
        # Auto-detect services if not specified
        if not services:
            services = self.service_matcher.suggest_services(task)

        # Extract keywords from task if not provided
        if not keywords:
            keywords = self.keyword_extractor.extract_keywords(task)

        # Search each service
        all_matches: list[FileMatch] = []
        service_contexts = {}

        for service_name in services:
            service_info = self.project_index.get("services", {}).get(service_name)
            if not service_info:
                continue

            service_path = Path(service_info.get("path", service_name))
            if not service_path.is_absolute():
                service_path = self.project_dir / service_path

            # Search this service
            matches = self.searcher.search_service(service_path, service_name, keywords)
            all_matches.extend(matches)

            # Load or generate service context
            service_contexts[service_name] = self._get_service_context(
                service_path, service_name, service_info
            )

        # Categorize matches
        files_to_modify, files_to_reference = self.categorizer.categorize_matches(
            all_matches, task
        )

        # Discover patterns from reference files
        patterns = self.pattern_discoverer.discover_patterns(
            files_to_reference, keywords
        )

        # Get graph hints (synchronously wrap async call)
        graph_hints = []
        if include_graph_hints and is_graphiti_enabled():
            try:
                # Run the async function in a new event loop if necessary
                try:
                    loop = asyncio.get_running_loop()
                    # We're already in an async context - this shouldn't happen in CLI
                    # but handle it gracefully
                    graph_hints = []
                except RuntimeError:
                    # No event loop running - create one
                    graph_hints = asyncio.run(
                        fetch_graph_hints(task, str(self.project_dir))
                    )
            except Exception:
                # Graphiti is optional - fail gracefully
                graph_hints = []

        return TaskContext(
            task_description=task,
            scoped_services=services,
            files_to_modify=[
                asdict(f) if isinstance(f, FileMatch) else f for f in files_to_modify
            ],
            files_to_reference=[
                asdict(f) if isinstance(f, FileMatch) else f for f in files_to_reference
            ],
            patterns_discovered=patterns,
            service_contexts=service_contexts,
            graph_hints=graph_hints,
        )

    async def build_context_async(
        self,
        task: str,
        services: list[str] | None = None,
        keywords: list[str] | None = None,
        include_graph_hints: bool = True,
    ) -> TaskContext:
        """
        Build context for a specific task (async version).

        This version is preferred when called from async code as it can
        properly await the graph hints retrieval.

        Args:
            task: Description of the task
            services: List of service names to search (None = auto-detect)
            keywords: Additional keywords to search for
            include_graph_hints: Whether to include historical hints from Graphiti

        Returns:
            TaskContext with relevant files and patterns
        """
        # Auto-detect services if not specified
        if not services:
            services = self.service_matcher.suggest_services(task)

        # Extract keywords from task if not provided
        if not keywords:
            keywords = self.keyword_extractor.extract_keywords(task)

        # Search each service
        all_matches: list[FileMatch] = []
        service_contexts = {}

        for service_name in services:
            service_info = self.project_index.get("services", {}).get(service_name)
            if not service_info:
                continue

            service_path = Path(service_info.get("path", service_name))
            if not service_path.is_absolute():
                service_path = self.project_dir / service_path

            # Search this service
            matches = self.searcher.search_service(service_path, service_name, keywords)
            all_matches.extend(matches)

            # Load or generate service context
            service_contexts[service_name] = self._get_service_context(
                service_path, service_name, service_info
            )

        # Categorize matches
        files_to_modify, files_to_reference = self.categorizer.categorize_matches(
            all_matches, task
        )

        # Discover patterns from reference files
        patterns = self.pattern_discoverer.discover_patterns(
            files_to_reference, keywords
        )

        # Get graph hints asynchronously
        graph_hints = []
        if include_graph_hints:
            graph_hints = await fetch_graph_hints(task, str(self.project_dir))

        return TaskContext(
            task_description=task,
            scoped_services=services,
            files_to_modify=[
                asdict(f) if isinstance(f, FileMatch) else f for f in files_to_modify
            ],
            files_to_reference=[
                asdict(f) if isinstance(f, FileMatch) else f for f in files_to_reference
            ],
            patterns_discovered=patterns,
            service_contexts=service_contexts,
            graph_hints=graph_hints,
        )

    def _get_service_context(
        self,
        service_path: Path,
        service_name: str,
        service_info: dict,
    ) -> dict:
        """Get or generate context for a service."""
        # Check for SERVICE_CONTEXT.md
        context_file = service_path / "SERVICE_CONTEXT.md"
        if context_file.exists():
            return {
                "source": "SERVICE_CONTEXT.md",
                "content": context_file.read_text(encoding="utf-8")[
                    :2000
                ],  # First 2000 chars
            }

        # Generate basic context from service info
        return {
            "source": "generated",
            "language": service_info.get("language"),
            "framework": service_info.get("framework"),
            "type": service_info.get("type"),
            "entry_point": service_info.get("entry_point"),
            "key_directories": service_info.get("key_directories", {}),
        }
