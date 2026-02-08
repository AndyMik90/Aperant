"""
Base Module for Agent System
=============================

Shared imports, types, and constants used across agent modules.
"""

import logging

# Configure logging
logger = logging.getLogger(__name__)

# Configuration constants
AUTO_CONTINUE_DELAY_SECONDS = 0  # No delay — move to next subtask immediately
HUMAN_INTERVENTION_FILE = "PAUSE"
