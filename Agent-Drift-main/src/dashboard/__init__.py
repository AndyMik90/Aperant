"""
SIEM-like Dashboard for Agent Drift.
Real-time behavioral monitoring interface.
"""

from .server import DriftDashboard, create_app

__all__ = ["DriftDashboard", "create_app"]
