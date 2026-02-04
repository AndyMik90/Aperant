"""
Agent Drift - Behavioral drift detection for AI agents.

Detects prompt injection, memory poisoning & behavioral drift
by comparing agent behavior vectors against a trusted baseline.
"""

from .models import (
    BehaviorTrace,
    BehaviorVector,
    ToolInvocation,
    FileAccess,
    NetworkCall,
    DecisionCycle,
    Baseline,
    DriftReport,
)
from .vectorizer import BehaviorVectorizer
from .baseline import BaselineManager
from .detector import DriftDetector
from .monitor import AgentMonitor

__all__ = [
    # Models
    "BehaviorTrace",
    "BehaviorVector",
    "ToolInvocation",
    "FileAccess",
    "NetworkCall",
    "DecisionCycle",
    "Baseline",
    "DriftReport",
    # Core classes
    "BehaviorVectorizer",
    "BaselineManager",
    "DriftDetector",
    "AgentMonitor",
]
