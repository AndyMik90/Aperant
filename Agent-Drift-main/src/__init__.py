"""
Agent Drift - Runtime behavioral monitoring for AI agents.
Detects silent compromise through behavioral drift analysis.
"""

__version__ = "0.1.0"
__author__ = "Buster"

from .shim import AgentShim
from .baseline import BaselineManager
from .vectorizer import BehaviorVectorizer
from .detector import DriftDetector
from .canary import CanaryInjector

__all__ = [
    "AgentShim",
    "BaselineManager", 
    "BehaviorVectorizer",
    "DriftDetector",
    "CanaryInjector",
]
