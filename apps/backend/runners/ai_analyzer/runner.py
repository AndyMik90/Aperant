"""
Main orchestrator for AI-powered project analysis.
"""

import time
from datetime import datetime
from pathlib import Path
from typing import Any

from .analyzers import AnalyzerFactory
from .cache_manager import CacheManager
from .claude_client import CLAUDE_SDK_AVAILABLE, ClaudeAnalysisClient
from .cost_estimator import CostEstimator
from .models import AnalyzerType
from .result_parser import ResultParser
from .summary_printer import SummaryPrinter


class AIAnalyzerRunner:
    """Orchestrates AI-powered project analysis."""

    def __init__(self, project_dir: Path, project_index: dict[str, Any]):
        """
        Initialize AI analyzer.

        Args:
            project_dir: Root directory of project
            project_index: Output from programmatic analyzer (analyzer.py)
        """
        self.project_dir = project_dir
        self.project_index = project_index
        self.cache_manager = CacheManager(project_dir / ".ac.jerry" / "ai_cache")
        self.cost_estimator = CostEstimator(project_dir, project_index)
        self.result_parser = ResultParser()
        self.summary_printer = SummaryPrinter()

    async def run_full_analysis(
        self, skip_cache: bool = False, selected_analyzers: list[str] | None = None
    ) -> dict[str, Any]:
        """
        Run all AI analyzers.

        Args:
            skip_cache: If True, ignore cached results
            selected_analyzers: If provided, only run these analyzers

        Returns:
            Complete AI insights
        """
        self._print_header()

        # Check for cached analysis
        cached_result = self.cache_manager.get_cached_result(skip_cache)
        if cached_result:
            return cached_result

        if not CLAUDE_SDK_AVAILABLE:
            print("✗ Claude Agent SDK not available. Cannot run AI analysis.")
            return {"error": "Claude SDK not installed"}

        # Estimate cost before running
        cost_estimate = self.cost_estimator.estimate_cost()
        self.summary_printer.print_cost_estimate(cost_estimate.__dict__)

        # Initialize results
        insights = {
            "analysis_timestamp": datetime.now().isoformat(),
            "project_dir": str(self.project_dir),
            "cost_estimate": cost_estimate.__dict__,
        }

        # Determine which analyzers to run
        analyzers_to_run = self._get_analyzers_to_run(selected_analyzers)

        # Run each analyzer
        await self._run_analyzers(analyzers_to_run, insights)

        # Calculate overall score
        insights["overall_score"] = self._calculate_overall_score(
            analyzers_to_run, insights
        )

        # Cache results
        self.cache_manager.save_result(insights)
        print(f"\n📊 Overall Score: {insights['overall_score']}/100")

        return insights

    def _print_header(self) -> None:
        """Print analysis header."""
        print("\n" + "=" * 60)
        print("  AI-ENHANCED PROJECT ANALYSIS")
        print("=" * 60 + "\n")

    def _get_analyzers_to_run(self, selected_analyzers: list[str] | None) -> list[str]:
        """
        Determine which analyzers to run.

        Args:
            selected_analyzers: User-selected analyzers or None for all

        Returns:
            List of analyzer names to run
        """
        if selected_analyzers:
            # Validate selected analyzers
            valid_analyzers = []
            for name in selected_analyzers:
                if name not in AnalyzerType.all_analyzers():
                    print(f"⚠️  Unknown analyzer: {name}, skipping...")
                else:
                    valid_analyzers.append(name)
            return valid_analyzers

        return AnalyzerType.all_analyzers()

    async def _run_analyzers(
        self, analyzers_to_run: list[str], insights: dict[str, Any]
    ) -> None:
        """
        Run all specified analyzers.

        Args:
            analyzers_to_run: List of analyzer names to run
            insights: Dictionary to store results
        """
        for analyzer_name in analyzers_to_run:
            print(f"\n🤖 Running {analyzer_name.replace('_', ' ').title()} Analyzer...")
            start_time = time.time()

            try:
                result = await self._run_single_analyzer(analyzer_name)
                insights[analyzer_name] = result

                duration = time.time() - start_time
                score = result.get("score", 0)
                print(f"   ✓ Completed in {duration:.1f}s (score: {score}/100)")

            except Exception as e:
                print(f"   ✗ Error: {e}")
                insights[analyzer_name] = {"error": str(e)}

    async def _run_single_analyzer(self, analyzer_name: str) -> dict[str, Any]:
        """
        Run a specific AI analyzer.

        Args:
            analyzer_name: Name of the analyzer to run

        Returns:
            Analysis result dictionary
        """
        # Create analyzer instance
        analyzer = AnalyzerFactory.create(analyzer_name, self.project_index)

        # Get prompt and default result
        prompt = analyzer.get_prompt()
        default_result = analyzer.get_default_result()

        # Run Claude query
        client = ClaudeAnalysisClient(self.project_dir)
        response = await client.run_analysis_query(prompt)

        # Parse and return result
        return self.result_parser.parse_json_response(response, default_result)

    def _calculate_overall_score(
        self, analyzers_to_run: list[str], insights: dict[str, Any]
    ) -> int:
        """
        Calculate overall score from individual analyzer scores.

        Args:
            analyzers_to_run: List of analyzers that were run
            insights: Analysis results

        Returns:
            Overall score (0-100)
        """
        scores = [
            insights[name].get("score", 0)
            for name in analyzers_to_run
            if name in insights and "error" not in insights[name]
        ]

        return sum(scores) // len(scores) if scores else 0

    def print_summary(self, insights: dict[str, Any]) -> None:
        """
        Print a summary of the AI insights.

        Args:
            insights: Analysis results dictionary
        """
        self.summary_printer.print_summary(insights)
