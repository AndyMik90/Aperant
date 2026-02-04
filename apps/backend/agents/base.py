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

# Pause file constants for intelligent error recovery
# These files signal pause/resume between frontend and backend
RATE_LIMIT_PAUSE_FILE = "RATE_LIMIT_PAUSE"  # Created when rate limited
AUTH_FAILURE_PAUSE_FILE = "AUTH_PAUSE"  # Created when auth fails
RESUME_FILE = "RESUME"  # Created by frontend to signal resume

# Maximum time to wait for rate limit reset (2 hours)
# If reset time is beyond this, task should fail rather than wait indefinitely
MAX_RATE_LIMIT_WAIT_SECONDS = 7200

# Wait intervals for pause/resume checking
RATE_LIMIT_CHECK_INTERVAL_SECONDS = 30  # Check for RESUME file every 30 seconds during rate limit wait
AUTH_RESUME_CHECK_INTERVAL_SECONDS = 10  # Check for re-authentication every 10 seconds
AUTH_RESUME_MAX_WAIT_SECONDS = 86400  # Maximum wait for re-authentication (24 hours)
