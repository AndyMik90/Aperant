"""
Retry Utilities
===============

Provides retry logic with exponential backoff for handling transient failures.
Use for API calls and other operations that may fail temporarily.

Example usage:
    from core.retry import retry_async, RetryConfig

    # Simple usage with defaults
    result = await retry_async(lambda: api.call())

    # Custom configuration
    config = RetryConfig(max_retries=5, base_delay=2.0)
    result = await retry_async(
        lambda: api.call(),
        config=config,
        retryable_exceptions=(RateLimitError, TimeoutError)
    )
"""

import asyncio
import logging
import random
from dataclasses import dataclass, field
from typing import Awaitable, Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""

    max_retries: int = 3
    """Maximum number of retry attempts (not counting initial attempt)."""

    base_delay: float = 1.0
    """Initial delay in seconds before first retry."""

    max_delay: float = 30.0
    """Maximum delay in seconds between retries."""

    exponential_base: float = 2.0
    """Base for exponential backoff calculation."""

    jitter: bool = True
    """Add random jitter to delay to prevent thundering herd."""

    jitter_factor: float = 0.1
    """Maximum jitter as fraction of delay (0.1 = ±10%)."""


# Default configuration
DEFAULT_RETRY_CONFIG = RetryConfig()

# Default exceptions that should trigger retry
DEFAULT_RETRYABLE_EXCEPTIONS: tuple[type[Exception], ...] = (
    IOError,
    TimeoutError,
    ConnectionError,
    ConnectionResetError,
    ConnectionRefusedError,
)


def calculate_delay(
    attempt: int,
    config: RetryConfig,
) -> float:
    """
    Calculate delay for a retry attempt using exponential backoff.

    Args:
        attempt: Current attempt number (0-indexed)
        config: Retry configuration

    Returns:
        Delay in seconds
    """
    # Exponential backoff: base_delay * (exponential_base ^ attempt)
    delay = config.base_delay * (config.exponential_base**attempt)

    # Cap at max_delay
    delay = min(delay, config.max_delay)

    # Add jitter if enabled
    if config.jitter:
        jitter_range = delay * config.jitter_factor
        delay += random.uniform(-jitter_range, jitter_range)
        # Ensure delay doesn't go negative
        delay = max(0.1, delay)

    return delay


async def retry_async(
    func: Callable[[], Awaitable[T]],
    config: RetryConfig | None = None,
    retryable_exceptions: tuple[type[Exception], ...] | None = None,
    operation_name: str = "operation",
) -> T:
    """
    Retry an async function with exponential backoff.

    Args:
        func: Async callable to retry (no arguments, use lambda to capture)
        config: Retry configuration (uses DEFAULT_RETRY_CONFIG if None)
        retryable_exceptions: Tuple of exception types that should trigger retry.
                             Uses DEFAULT_RETRYABLE_EXCEPTIONS if None.
        operation_name: Name of operation for logging

    Returns:
        Result of the function call

    Raises:
        The last exception if all retries are exhausted,
        or any non-retryable exception immediately.

    Example:
        # Retry an API call up to 3 times
        result = await retry_async(
            lambda: api.fetch_data(id),
            retryable_exceptions=(RateLimitError, TimeoutError)
        )
    """
    if config is None:
        config = DEFAULT_RETRY_CONFIG

    if retryable_exceptions is None:
        retryable_exceptions = DEFAULT_RETRYABLE_EXCEPTIONS

    last_exception: Exception | None = None

    for attempt in range(config.max_retries + 1):
        try:
            return await func()

        except asyncio.CancelledError:
            # Never retry on cancellation - propagate immediately
            logger.debug("Retry cancelled for %s", operation_name)
            raise

        except retryable_exceptions as e:
            last_exception = e

            if attempt < config.max_retries:
                delay = calculate_delay(attempt, config)
                logger.warning(
                    "%s failed (attempt %d/%d), retrying in %.1fs: %s",
                    operation_name,
                    attempt + 1,
                    config.max_retries + 1,
                    delay,
                    e,
                )
                await asyncio.sleep(delay)
            else:
                logger.error(
                    "%s failed after %d attempts: %s",
                    operation_name,
                    config.max_retries + 1,
                    e,
                    exc_info=True,
                )

        except Exception:
            # Non-retryable exception - propagate immediately
            logger.error(
                "%s failed with non-retryable error",
                operation_name,
                exc_info=True,
            )
            raise

    # All retries exhausted
    if last_exception is not None:
        raise last_exception

    # Should never reach here, but satisfy type checker
    raise RuntimeError(f"{operation_name} failed with no exception captured")


def retry_sync(
    func: Callable[[], T],
    config: RetryConfig | None = None,
    retryable_exceptions: tuple[type[Exception], ...] | None = None,
    operation_name: str = "operation",
) -> T:
    """
    Retry a synchronous function with exponential backoff.

    Args:
        func: Callable to retry (no arguments, use lambda to capture)
        config: Retry configuration (uses DEFAULT_RETRY_CONFIG if None)
        retryable_exceptions: Tuple of exception types that should trigger retry.
                             Uses DEFAULT_RETRYABLE_EXCEPTIONS if None.
        operation_name: Name of operation for logging

    Returns:
        Result of the function call

    Raises:
        The last exception if all retries are exhausted,
        or any non-retryable exception immediately.

    Example:
        # Retry a file operation up to 3 times
        result = retry_sync(
            lambda: read_file(path),
            retryable_exceptions=(IOError, PermissionError)
        )
    """
    import time

    if config is None:
        config = DEFAULT_RETRY_CONFIG

    if retryable_exceptions is None:
        retryable_exceptions = DEFAULT_RETRYABLE_EXCEPTIONS

    last_exception: Exception | None = None

    for attempt in range(config.max_retries + 1):
        try:
            return func()

        except retryable_exceptions as e:
            last_exception = e

            if attempt < config.max_retries:
                delay = calculate_delay(attempt, config)
                logger.warning(
                    "%s failed (attempt %d/%d), retrying in %.1fs: %s",
                    operation_name,
                    attempt + 1,
                    config.max_retries + 1,
                    delay,
                    e,
                )
                time.sleep(delay)
            else:
                logger.error(
                    "%s failed after %d attempts: %s",
                    operation_name,
                    config.max_retries + 1,
                    e,
                    exc_info=True,
                )

        except Exception:
            # Non-retryable exception - propagate immediately
            logger.error(
                "%s failed with non-retryable error",
                operation_name,
                exc_info=True,
            )
            raise

    # All retries exhausted
    if last_exception is not None:
        raise last_exception

    # Should never reach here, but satisfy type checker
    raise RuntimeError(f"{operation_name} failed with no exception captured")
