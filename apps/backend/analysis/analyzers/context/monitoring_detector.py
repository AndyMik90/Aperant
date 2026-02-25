"""
Monitoring Detector Module
===========================

Detects monitoring and observability setup:
- Health check endpoints
- Prometheus metrics endpoints
- APM tools (Sentry, Datadog, New Relic)
- Logging infrastructure
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..base import BaseAnalyzer


class MonitoringDetector(BaseAnalyzer):
    """Detects monitoring and observability setup."""

    def __init__(self, path: Path, analysis: dict[str, Any]):
        super().__init__(path)
        self.analysis = analysis

    def detect(self) -> None:
        """
        Detect monitoring and observability setup.

        Detects: Health checks, metrics endpoints, APM tools, logging.
        """
        monitoring_info = {}

        # Detect health check endpoints from existing API analysis
        health_checks = self._detect_health_checks()
        if health_checks:
            monitoring_info["health_checks"] = health_checks

        # Detect Prometheus metrics
        metrics_info = self._detect_prometheus()
        if metrics_info:
            monitoring_info.update(metrics_info)

        # Reference APM tools from services analysis
        apm_tools = self._get_apm_tools()
        if apm_tools:
            monitoring_info["apm_tools"] = apm_tools

        if monitoring_info:
            self.analysis["monitoring"] = monitoring_info

    def _detect_health_checks(self) -> list[str] | None:
        """Detect health check endpoints from API routes."""
        if "api" not in self.analysis:
            return None

        routes = self.analysis["api"].get("routes", [])
        health_routes = [
            r["path"]
            for r in routes
            if "health" in r["path"].lower() or "ping" in r["path"].lower()
        ]

        return health_routes if health_routes else None

    def _detect_prometheus(self) -> dict[str, str] | None:
        """Detect Prometheus metrics endpoint."""
        # Look for actual Prometheus imports/usage, not just keywords
        all_files = (
            list(self.path.glob("**/*.py"))[:30] + list(self.path.glob("**/*.js"))[:30]
        )

        for file_path in all_files:
            # Skip analyzer files to avoid self-detection
            if "analyzers" in str(file_path) or "analyzer.py" in str(file_path):
                continue

            try:
                content = file_path.read_text(encoding="utf-8")
                # Look for actual Prometheus imports or usage patterns
                prometheus_patterns = [
                    "from prometheus_client import",
                    "import prometheus_client",
                    "prometheus_client.",
                    "@app.route('/metrics')",  # Flask
                    "app.get('/metrics'",  # Express/Fastify
                    "router.get('/metrics'",  # Express Router
                ]

                if any(pattern in content for pattern in prometheus_patterns):
                    return {
                        "metrics_endpoint": "/metrics",
                        "metrics_type": "prometheus",
                    }
            except (OSError, UnicodeDecodeError):
                continue

        return None

    def _get_apm_tools(self) -> list[str] | None:
        """Get APM tools from existing services analysis."""
        if (
            "services" not in self.analysis
            or "monitoring" not in self.analysis["services"]
        ):
            return None

        return [s["type"] for s in self.analysis["services"]["monitoring"]]
