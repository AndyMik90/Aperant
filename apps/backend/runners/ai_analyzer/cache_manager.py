"""
Cache management for AI analysis results.
"""

import json
import time
from pathlib import Path
from typing import Any


class CacheManager:
    """Manages caching of AI analysis results."""

    CACHE_VALIDITY_HOURS = 24

    def __init__(self, cache_dir: Path):
        """
        Initialize cache manager.

        Args:
            cache_dir: Directory to store cache files
        """
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_file = self.cache_dir / "ai_insights.json"

    def get_cached_result(self, skip_cache: bool = False) -> dict[str, Any] | None:
        """
        Retrieve cached analysis result if valid.

        Args:
            skip_cache: If True, always return None (force re-analysis)

        Returns:
            Cached analysis result or None if cache invalid/expired
        """
        if skip_cache:
            return None

        if not self.cache_file.exists():
            return None

        cache_age = time.time() - self.cache_file.stat().st_mtime
        hours_old = cache_age / 3600

        if hours_old >= self.CACHE_VALIDITY_HOURS:
            print(f"⚠️  Cache expired ({hours_old:.1f} hours old), re-analyzing...")
            return None

        print(f"✓ Using cached AI insights ({hours_old:.1f} hours old)")
        return json.loads(self.cache_file.read_text(encoding="utf-8"))

    def save_result(self, result: dict[str, Any]) -> None:
        """
        Save analysis result to cache.

        Args:
            result: Analysis result to cache
        """
        self.cache_file.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"\n✓ AI insights cached to: {self.cache_file}")
