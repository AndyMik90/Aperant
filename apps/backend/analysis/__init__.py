"""
Analysis Module
===============

Code analysis and project scanning tools.
"""

# Import from analyzers subpackage (these are the modular analyzers)

from __future__ import annotations

from .analyzers import (
    ProjectAnalyzer as ModularProjectAnalyzer,
)
from .analyzers import (
    ServiceAnalyzer,
    analyze_project,
    analyze_service,
)
from .ci_discovery import CIDiscovery

# Import from analysis module root (these are other analysis tools)
from .project_analyzer import ProjectAnalyzer
from .risk_classifier import RiskClassifier
from .security_scanner import SecurityScanner

# TestDiscovery was removed - tests are now co-located in their respective modules

# insight_extractor is a module with functions, not a class, so don't import it here
# Import it directly when needed: from analysis import insight_extractor

__all__ = [
    "ProjectAnalyzer",
    "ModularProjectAnalyzer",
    "ServiceAnalyzer",
    "analyze_project",
    "analyze_service",
    "RiskClassifier",
    "SecurityScanner",
    "CIDiscovery",
    # "TestDiscovery",  # Removed - tests now co-located in their modules
]
