"""
Pytest configuration for backend tests.
"""

import sys
from pathlib import Path

# Add parent directory to path so we can import from agents, runners, etc.
sys.path.insert(0, str(Path(__file__).parent.parent))
