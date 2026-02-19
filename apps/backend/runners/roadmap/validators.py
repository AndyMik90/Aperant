"""
Dependency validators for roadmap features.
"""

from dataclasses import dataclass

from .models import RoadmapFeature


@dataclass
class ValidationResult:
    """Result of dependency validation."""

    has_missing: bool
    has_circular: bool
    missing_ids: list[str]
    circular_paths: list[list[str]]
    reverse_deps_map: dict[str, list[str]]


class DependencyValidator:
    """Validates and enriches feature dependencies."""

    def validate_all(self, features: list[RoadmapFeature]) -> ValidationResult:
        """
        Validates all dependencies in the roadmap.

        Args:
            features: List of features to validate

        Returns:
            ValidationResult with validation metadata
        """
        # Find missing dependencies
        missing_ids = self._find_missing_deps(features)

        # Detect circular dependencies
        circular_paths = self._detect_circular_deps(features)

        # Calculate reverse dependencies
        reverse_deps_map = self._calculate_reverse_deps(features)

        return ValidationResult(
            has_missing=len(missing_ids) > 0,
            has_circular=len(circular_paths) > 0,
            missing_ids=missing_ids,
            circular_paths=circular_paths,
            reverse_deps_map=reverse_deps_map,
        )

    def _find_missing_deps(self, features: list[RoadmapFeature]) -> list[str]:
        """Find dependencies that reference non-existent features."""
        valid_ids = {f.id for f in features}
        missing = set()

        for feature in features:
            for dep_id in feature.dependencies:
                if dep_id not in valid_ids:
                    missing.add(dep_id)

        return sorted(missing)

    def _detect_circular_deps(self, features: list[RoadmapFeature]) -> list[list[str]]:
        """Detect circular dependencies using coloring-based DFS.

        Uses WHITE/GRAY/BLACK coloring for O(V+E) complexity instead of
        O(n²) from copying path/visited sets on each recursive call.
        """
        # Color constants for DFS traversal
        WHITE = 0  # Not visited
        GRAY = 1  # Currently in recursion stack (being explored)
        BLACK = 2  # Fully processed

        graph = {f.id: f.dependencies for f in features}
        colors = dict.fromkeys(graph, WHITE)
        circular_paths = []
        seen_cycles = set()  # Track normalized cycles

        def normalize_cycle(cycle: list[str]) -> str:
            """Rotate cycle to start from smallest ID for deduplication."""
            if not cycle:
                return ""
            # Find rotation that starts with minimal element (exclude last duplicate)
            cycle_without_dup = cycle[:-1]  # Remove last element (duplicate of first)
            if not cycle_without_dup:
                return ""
            min_idx = cycle_without_dup.index(min(cycle_without_dup))
            # Rotate to start from minimal element
            rotated = cycle_without_dup[min_idx:] + cycle_without_dup[:min_idx]
            return ",".join(rotated)

        def dfs(node: str, path: list[str]) -> None:
            """DFS with coloring to detect back edges (cycles).

            Args:
                node: Current node being visited
                path: Nodes in current recursion stack (excluding node)
            """
            colors[node] = GRAY
            current_path = path + [node]  # Include current node in path

            for neighbor in graph.get(node, []):
                if neighbor not in graph:
                    continue  # Skip non-existent nodes

                if colors[neighbor] == GRAY:
                    # Back edge found - cycle detected
                    # Find where the neighbor is in our path
                    if neighbor in current_path:
                        cycle_start = current_path.index(neighbor)
                        cycle = current_path[cycle_start:] + [neighbor]
                        normalized = normalize_cycle(cycle)
                        if normalized not in seen_cycles:
                            seen_cycles.add(normalized)
                            circular_paths.append(cycle)
                elif colors[neighbor] == WHITE:
                    dfs(neighbor, current_path)

            colors[node] = BLACK

        for feature_id in graph:
            if colors[feature_id] == WHITE:
                dfs(feature_id, [])

        return circular_paths

    def _calculate_reverse_deps(
        self, features: list[RoadmapFeature]
    ) -> dict[str, list[str]]:
        """Calculate which features depend on each feature."""
        reverse_deps: dict[str, set[str]] = {}

        # Initialize all features with empty set
        for feature in features:
            reverse_deps[feature.id] = set()

        # Build reverse dependency map (using sets to dedupe)
        for feature in features:
            for dep_id in feature.dependencies:
                if dep_id not in reverse_deps:
                    reverse_deps[dep_id] = set()
                reverse_deps[dep_id].add(feature.id)

        # Convert sets to sorted lists for consistent output
        return {k: sorted(v) for k, v in reverse_deps.items()}
