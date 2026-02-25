"""
Semantic Duplicate Detection
============================

Uses embeddings-based similarity to detect duplicate issues:
- Replaces simple word overlap with semantic similarity
- Integrates with OpenAI/Voyage AI embeddings
- Caches embeddings with TTL
- Extracts entities (error codes, file paths, function names)
- Provides similarity breakdown by component
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Thresholds for duplicate detection
DUPLICATE_THRESHOLD = 0.85  # Cosine similarity for "definitely duplicate"
SIMILAR_THRESHOLD = 0.70  # Cosine similarity for "potentially related"
EMBEDDING_CACHE_TTL_HOURS = 24


@dataclass
class EntityExtraction:
    """Extracted entities from issue content."""

    error_codes: list[str] = field(default_factory=list)
    file_paths: list[str] = field(default_factory=list)
    function_names: list[str] = field(default_factory=list)
    urls: list[str] = field(default_factory=list)
    stack_traces: list[str] = field(default_factory=list)
    versions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, list[str]]:
        return {
            "error_codes": self.error_codes,
            "file_paths": self.file_paths,
            "function_names": self.function_names,
            "urls": self.urls,
            "stack_traces": self.stack_traces,
            "versions": self.versions,
        }

    def overlap_with(self, other: EntityExtraction) -> dict[str, float]:
        """Calculate overlap with another extraction."""

        def jaccard(a: list, b: list) -> float:
            if not a and not b:
                return 0.0
            set_a, set_b = set(a), set(b)
            intersection = len(set_a & set_b)
            union = len(set_a | set_b)
            return intersection / union if union > 0 else 0.0

        return {
            "error_codes": jaccard(self.error_codes, other.error_codes),
            "file_paths": jaccard(self.file_paths, other.file_paths),
            "function_names": jaccard(self.function_names, other.function_names),
            "urls": jaccard(self.urls, other.urls),
        }


@dataclass
class SimilarityResult:
    """Result of similarity comparison between two issues."""

    issue_a: int
    issue_b: int
    overall_score: float
    title_score: float
    body_score: float
    entity_scores: dict[str, float]
    is_duplicate: bool
    is_similar: bool
    explanation: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "issue_a": self.issue_a,
            "issue_b": self.issue_b,
            "overall_score": self.overall_score,
            "title_score": self.title_score,
            "body_score": self.body_score,
            "entity_scores": self.entity_scores,
            "is_duplicate": self.is_duplicate,
            "is_similar": self.is_similar,
            "explanation": self.explanation,
        }


@dataclass
class CachedEmbedding:
    """Cached embedding with metadata."""

    issue_number: int
    content_hash: str
    embedding: list[float]
    created_at: str
    expires_at: str

    def is_expired(self) -> bool:
        expires = datetime.fromisoformat(self.expires_at)
        return datetime.now(timezone.utc) > expires

    def to_dict(self) -> dict[str, Any]:
        return {
            "issue_number": self.issue_number,
            "content_hash": self.content_hash,
            "embedding": self.embedding,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CachedEmbedding:
        return cls(**data)


class EntityExtractor:
    """Extracts entities from issue content."""

    # Patterns for entity extraction
    ERROR_CODE_PATTERN = re.compile(
        r"\b(?:E|ERR|ERROR|WARN|WARNING|FATAL)[-_]?\d{3,5}\b"
        r"|\b[A-Z]{2,5}[-_]\d{3,5}\b"
        r"|\bError\s*:\s*[A-Z_]+\b",
        re.IGNORECASE,
    )

    FILE_PATH_PATTERN = re.compile(
        r"(?:^|\s|[\"'`])([a-zA-Z0-9_./\\-]+\.[a-zA-Z]{1,5})(?:\s|[\"'`]|$|:|\()"
        r"|(?:at\s+)([a-zA-Z0-9_./\\-]+\.[a-zA-Z]{1,5})(?::\d+)?",
        re.MULTILINE,
    )

    FUNCTION_NAME_PATTERN = re.compile(
        r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\("
        r"|\bfunction\s+([a-zA-Z_][a-zA-Z0-9_]*)"
        r"|\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)"
        r"|\basync\s+(?:function\s+)?([a-zA-Z_][a-zA-Z0-9_]*)",
    )

    URL_PATTERN = re.compile(
        r"https?://[^\s<>\"')\]]+",
        re.IGNORECASE,
    )

    VERSION_PATTERN = re.compile(
        r"\bv?\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.]+)?\b",
    )

    STACK_TRACE_PATTERN = re.compile(
        r"(?:at\s+[^\n]+\n)+|(?:File\s+\"[^\"]+\",\s+line\s+\d+)",
        re.MULTILINE,
    )

    def extract(self, content: str) -> EntityExtraction:
        """Extract entities from content."""
        extraction = EntityExtraction()

        # Extract error codes
        extraction.error_codes = list(set(self.ERROR_CODE_PATTERN.findall(content)))

        # Extract file paths
        path_matches = self.FILE_PATH_PATTERN.findall(content)
        paths = []
        for match in path_matches:
            path = match[0] or match[1]
            if path and len(path) > 3:  # Filter out short false positives
                paths.append(path)
        extraction.file_paths = list(set(paths))

        # Extract function names
        func_matches = self.FUNCTION_NAME_PATTERN.findall(content)
        funcs = []
        for match in func_matches:
            func = next((m for m in match if m), None)
            if func and len(func) > 2:
                funcs.append(func)
        extraction.function_names = list(set(funcs))[:20]  # Limit

        # Extract URLs
        extraction.urls = list(set(self.URL_PATTERN.findall(content)))[:10]

        # Extract versions
        extraction.versions = list(set(self.VERSION_PATTERN.findall(content)))[:10]

        # Extract stack traces (simplified)
        traces = self.STACK_TRACE_PATTERN.findall(content)
        extraction.stack_traces = traces[:3]  # Keep first 3

        return extraction


class EmbeddingProvider:
    """
    Abstract embedding provider.

    Supports multiple backends:
    - OpenAI (text-embedding-3-small)
    - Voyage AI (voyage-large-2)
    - Local (sentence-transformers)
    """

    def __init__(
        self,
        provider: str = "openai",
        api_key: str | None = None,
        model: str | None = None,
    ):
        self.provider = provider
        self.api_key = api_key
        self.model = model or self._default_model()

    def _default_model(self) -> str:
        defaults = {
            "openai": "text-embedding-3-small",
            "voyage": "voyage-large-2",
            "local": "all-MiniLM-L6-v2",
        }
        return defaults.get(self.provider, "text-embedding-3-small")

    async def get_embedding(self, text: str) -> list[float]:
        """Get embedding for text."""
        if self.provider == "openai":
            return await self._openai_embedding(text)
        elif self.provider == "voyage":
            return await self._voyage_embedding(text)
        else:
            return await self._local_embedding(text)

    async def _openai_embedding(self, text: str) -> list[float]:
        """Get embedding from OpenAI."""
        try:
            import openai

            client = openai.AsyncOpenAI(api_key=self.api_key)
            response = await client.embeddings.create(
                model=self.model,
                input=text[:8000],  # Limit input
            )
            return response.data[0].embedding
        except Exception as e:
            logger.error(f"OpenAI embedding error: {e}")
            raise Exception(
                f"OpenAI embeddings required but failed: {e}. Configure OPENAI_API_KEY or use 'local' provider."
            )

    async def _voyage_embedding(self, text: str) -> list[float]:
        """Get embedding from Voyage AI."""
        try:
            import httpx

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.voyageai.com/v1/embeddings",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={
                        "model": self.model,
                        "input": text[:8000],
                    },
                )
                data = response.json()
                return data["data"][0]["embedding"]
        except Exception as e:
            logger.error(f"Voyage embedding error: {e}")
            raise Exception(
                f"Voyage embeddings required but failed: {e}. Configure VOYAGE_API_KEY or use 'local' provider."
            )

    async def _local_embedding(self, text: str) -> list[float]:
        """Get embedding from local model."""
        try:
            from sentence_transformers import SentenceTransformer

            model = SentenceTransformer(self.model)
            embedding = model.encode(text[:8000])
            return embedding.tolist()
        except Exception as e:
            logger.error(f"Local embedding error: {e}")
            raise Exception(
                f"Local embeddings required but failed: {e}. Install sentence-transformers: pip install sentence-transformers"
            )


class DuplicateDetector:
    """
    Semantic duplicate detection for GitHub issues.

    Usage:
        detector = DuplicateDetector(
            cache_dir=Path(".auto-claude/github/embeddings"),
            embedding_provider="openai",
        )

        # Check for duplicates
        duplicates = await detector.find_duplicates(
            issue_number=123,
            title="Login fails with OAuth",
            body="When trying to login...",
            open_issues=all_issues,
        )
    """

    def __init__(
        self,
        cache_dir: Path,
        embedding_provider: str = "openai",
        api_key: str | None = None,
        duplicate_threshold: float = DUPLICATE_THRESHOLD,
        similar_threshold: float = SIMILAR_THRESHOLD,
        cache_ttl_hours: int = EMBEDDING_CACHE_TTL_HOURS,
    ):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.duplicate_threshold = duplicate_threshold
        self.similar_threshold = similar_threshold
        self.cache_ttl_hours = cache_ttl_hours

        self.embedding_provider = EmbeddingProvider(
            provider=embedding_provider,
            api_key=api_key,
        )
        self.entity_extractor = EntityExtractor()

    def _get_cache_file(self, repo: str) -> Path:
        safe_name = repo.replace("/", "_")
        return self.cache_dir / f"{safe_name}_embeddings.json"

    def _content_hash(self, title: str, body: str) -> str:
        """Generate hash of issue content."""
        content = f"{title}\n{body}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def _load_cache(self, repo: str) -> dict[int, CachedEmbedding]:
        """Load embedding cache for a repo."""
        cache_file = self._get_cache_file(repo)
        if not cache_file.exists():
            return {}

        with open(cache_file, encoding="utf-8") as f:
            data = json.load(f)

        cache = {}
        for item in data.get("embeddings", []):
            embedding = CachedEmbedding.from_dict(item)
            if not embedding.is_expired():
                cache[embedding.issue_number] = embedding

        return cache

    def _save_cache(self, repo: str, cache: dict[int, CachedEmbedding]) -> None:
        """Save embedding cache for a repo."""
        cache_file = self._get_cache_file(repo)
        data = {
            "embeddings": [e.to_dict() for e in cache.values()],
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(data, f)

    async def get_embedding(
        self,
        repo: str,
        issue_number: int,
        title: str,
        body: str,
    ) -> list[float]:
        """Get embedding for an issue, using cache if available."""
        cache = self._load_cache(repo)
        content_hash = self._content_hash(title, body)

        # Check cache
        if issue_number in cache:
            cached = cache[issue_number]
            if cached.content_hash == content_hash and not cached.is_expired():
                return cached.embedding

        # Generate new embedding
        content = f"{title}\n\n{body}"
        embedding = await self.embedding_provider.get_embedding(content)

        # Cache it
        now = datetime.now(timezone.utc)
        cache[issue_number] = CachedEmbedding(
            issue_number=issue_number,
            content_hash=content_hash,
            embedding=embedding,
            created_at=now.isoformat(),
            expires_at=(now + timedelta(hours=self.cache_ttl_hours)).isoformat(),
        )
        self._save_cache(repo, cache)

        return embedding

    def cosine_similarity(self, a: list[float], b: list[float]) -> float:
        """Calculate cosine similarity between two embeddings."""
        if len(a) != len(b):
            return 0.0

        dot_product = sum(x * y for x, y in zip(a, b))
        magnitude_a = sum(x * x for x in a) ** 0.5
        magnitude_b = sum(x * x for x in b) ** 0.5

        if magnitude_a == 0 or magnitude_b == 0:
            return 0.0

        return dot_product / (magnitude_a * magnitude_b)

    async def compare_issues(
        self,
        repo: str,
        issue_a: dict[str, Any],
        issue_b: dict[str, Any],
    ) -> SimilarityResult:
        """Compare two issues for similarity."""
        # Get embeddings
        embed_a = await self.get_embedding(
            repo,
            issue_a["number"],
            issue_a.get("title", ""),
            issue_a.get("body", ""),
        )
        embed_b = await self.get_embedding(
            repo,
            issue_b["number"],
            issue_b.get("title", ""),
            issue_b.get("body", ""),
        )

        # Calculate embedding similarity
        overall_score = self.cosine_similarity(embed_a, embed_b)

        # Get title-only embeddings
        title_embed_a = await self.embedding_provider.get_embedding(
            issue_a.get("title", "")
        )
        title_embed_b = await self.embedding_provider.get_embedding(
            issue_b.get("title", "")
        )
        title_score = self.cosine_similarity(title_embed_a, title_embed_b)

        # Get body-only score (if bodies exist)
        body_a = issue_a.get("body", "")
        body_b = issue_b.get("body", "")
        if body_a and body_b:
            body_embed_a = await self.embedding_provider.get_embedding(body_a)
            body_embed_b = await self.embedding_provider.get_embedding(body_b)
            body_score = self.cosine_similarity(body_embed_a, body_embed_b)
        else:
            body_score = 0.0

        # Extract and compare entities
        entities_a = self.entity_extractor.extract(
            f"{issue_a.get('title', '')} {issue_a.get('body', '')}"
        )
        entities_b = self.entity_extractor.extract(
            f"{issue_b.get('title', '')} {issue_b.get('body', '')}"
        )
        entity_scores = entities_a.overlap_with(entities_b)

        # Determine duplicate/similar status
        is_duplicate = overall_score >= self.duplicate_threshold
        is_similar = overall_score >= self.similar_threshold

        # Generate explanation
        explanation = self._generate_explanation(
            overall_score,
            title_score,
            body_score,
            entity_scores,
            is_duplicate,
        )

        return SimilarityResult(
            issue_a=issue_a["number"],
            issue_b=issue_b["number"],
            overall_score=overall_score,
            title_score=title_score,
            body_score=body_score,
            entity_scores=entity_scores,
            is_duplicate=is_duplicate,
            is_similar=is_similar,
            explanation=explanation,
        )

    def _generate_explanation(
        self,
        overall: float,
        title: float,
        body: float,
        entities: dict[str, float],
        is_duplicate: bool,
    ) -> str:
        """Generate human-readable explanation of similarity."""
        parts = []

        if is_duplicate:
            parts.append(f"High semantic similarity ({overall:.0%})")
        else:
            parts.append(f"Moderate similarity ({overall:.0%})")

        parts.append(f"Title: {title:.0%}")
        parts.append(f"Body: {body:.0%}")

        # Highlight matching entities
        for entity_type, score in entities.items():
            if score > 0:
                parts.append(f"{entity_type.replace('_', ' ').title()}: {score:.0%}")

        return " | ".join(parts)

    async def find_duplicates(
        self,
        repo: str,
        issue_number: int,
        title: str,
        body: str,
        open_issues: list[dict[str, Any]],
        limit: int = 5,
    ) -> list[SimilarityResult]:
        """
        Find potential duplicates for an issue.

        Args:
            repo: Repository in owner/repo format
            issue_number: Issue to find duplicates for
            title: Issue title
            body: Issue body
            open_issues: List of open issues to compare against
            limit: Maximum duplicates to return

        Returns:
            List of SimilarityResult sorted by similarity
        """
        target_issue = {
            "number": issue_number,
            "title": title,
            "body": body,
        }

        results = []
        for issue in open_issues:
            if issue.get("number") == issue_number:
                continue

            try:
                result = await self.compare_issues(repo, target_issue, issue)
                if result.is_similar:
                    results.append(result)
            except Exception as e:
                logger.error(f"Error comparing issues: {e}")

        # Sort by overall score, descending
        results.sort(key=lambda r: r.overall_score, reverse=True)
        return results[:limit]

    async def precompute_embeddings(
        self,
        repo: str,
        issues: list[dict[str, Any]],
    ) -> int:
        """
        Precompute embeddings for all issues.

        Args:
            repo: Repository
            issues: List of issues

        Returns:
            Number of embeddings computed
        """
        count = 0
        for issue in issues:
            try:
                await self.get_embedding(
                    repo,
                    issue["number"],
                    issue.get("title", ""),
                    issue.get("body", ""),
                )
                count += 1
            except Exception as e:
                logger.error(f"Error computing embedding for #{issue['number']}: {e}")

        return count

    def clear_cache(self, repo: str) -> None:
        """Clear embedding cache for a repo."""
        cache_file = self._get_cache_file(repo)
        if cache_file.exists():
            cache_file.unlink()
