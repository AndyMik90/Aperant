"""
Base Module for Agent System
=============================

Shared imports, types, and constants used across agent modules.
"""

import logging

# Configure logging
logger = logging.getLogger(__name__)

# Configuration constants
AUTO_CONTINUE_DELAY_SECONDS = 3
HUMAN_INTERVENTION_FILE = "PAUSE"

# Concurrency retry constants
MAX_CONCURRENCY_RETRIES = 5
INITIAL_RETRY_DELAY_SECONDS = 2
MAX_RETRY_DELAY_SECONDS = 32
