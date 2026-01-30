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

# Retry configuration for 400 tool concurrency errors
MAX_CONCURRENCY_RETRIES = 5  # Maximum number of retries for tool concurrency errors
INITIAL_RETRY_DELAY_SECONDS = (
    2  # Initial retry delay (doubles each retry: 2s, 4s, 8s, 16s, 32s)
)
MAX_RETRY_DELAY_SECONDS = 32  # Cap retry delay at 32 seconds
