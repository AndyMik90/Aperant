"""
Graphiti Integration Configuration
==================================

Constants, status mappings, and configuration helpers for Graphiti memory integration.
Follows the same patterns as linear_config.py for consistency.

Uses LadybugDB as the embedded graph database (no Docker required, requires Python 3.12+).

Multi-Provider Support (V2):
- LLM Providers: OpenAI, Anthropic, Azure OpenAI, Ollama, Google AI, OpenRouter
- Embedder Providers: OpenAI, Voyage AI, Azure OpenAI, Ollama, Google AI, OpenRouter

Environment Variables:
    # Core
    GRAPHITI_ENABLED: Set to "true" to enable Graphiti integration
    GRAPHITI_LLM_PROVIDER: openai|anthropic|azure_openai|ollama|google (default: openai)
    GRAPHITI_EMBEDDER_PROVIDER: openai|voyage|azure_openai|ollama|google (default: openai)

    # Database
    GRAPHITI_DATABASE: Graph database name (default: auto_claude_memory)
    GRAPHITI_DB_PATH: Database storage path (default: ~/.auto-claude/memories)

    # OpenAI
    OPENAI_API_KEY: Required for OpenAI provider
    OPENAI_MODEL: Model for LLM (default: gpt-5-mini)
    OPENAI_EMBEDDING_MODEL: Model for embeddings (default: text-embedding-3-small)

    # Anthropic (LLM only - needs separate embedder)
    ANTHROPIC_API_KEY: Required for Anthropic provider
    GRAPHITI_ANTHROPIC_MODEL: Model for LLM (default: claude-sonnet-4-5)

    # Azure OpenAI
    AZURE_OPENAI_API_KEY: Required for Azure provider
    AZURE_OPENAI_BASE_URL: Azure endpoint URL
    AZURE_OPENAI_LLM_DEPLOYMENT: Deployment name for LLM
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT: Deployment name for embeddings

    # Voyage AI (embeddings only - commonly used with Anthropic)
    VOYAGE_API_KEY: Required for Voyage embedder
    VOYAGE_EMBEDDING_MODEL: Model (default: voyage-3)

    # Google AI
    GOOGLE_API_KEY: Required for Google provider
    GOOGLE_LLM_MODEL: Model for LLM (default: gemini-2.0-flash)
    GOOGLE_EMBEDDING_MODEL: Model for embeddings (default: text-embedding-004)

    # Ollama (local)
    OLLAMA_BASE_URL: Ollama server URL (default: http://localhost:11434)
    OLLAMA_LLM_MODEL: Model for LLM (e.g., deepseek-r1:7b)
    OLLAMA_EMBEDDING_MODEL: Model for embeddings. Supported models with auto-detected dimensions:
        - embeddinggemma (768) - Google's lightweight embedding model
        - qwen3-embedding:0.6b (1024), :4b (2560), :8b (4096) - Qwen3 series
        - nomic-embed-text (768), mxbai-embed-large (1024), bge-large (1024)
    OLLAMA_EMBEDDING_DIM: Override dimension (optional if using known model)
"""

import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional

# Default configuration values
DEFAULT_DATABASE = "auto_claude_memory"
DEFAULT_DB_PATH = "~/.auto-claude/memories"
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"

# Graphiti state marker file (stores connection info and status)
GRAPHITI_STATE_MARKER = ".graphiti_state.json"

# Episode types for different memory categories
EPISODE_TYPE_SESSION_INSIGHT = "session_insight"
EPISODE_TYPE_CODEBASE_DISCOVERY = "codebase_discovery"
EPISODE_TYPE_PATTERN = "pattern"
EPISODE_TYPE_GOTCHA = "gotcha"
EPISODE_TYPE_TASK_OUTCOME = "task_outcome"
EPISODE_TYPE_QA_RESULT = "qa_result"
EPISODE_TYPE_HISTORICAL_CONTEXT = "historical_context"


class LLMProvider(str, Enum):
    """Supported LLM providers for Graphiti."""

    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    AZURE_OPENAI = "azure_openai"
    OLLAMA = "ollama"
    GOOGLE = "google"
    OPENROUTER = "openrouter"


class EmbedderProvider(str, Enum):
    """Supported embedder providers for Graphiti."""

    OPENAI = "openai"
    VOYAGE = "voyage"
    AZURE_OPENAI = "azure_openai"
    OLLAMA = "ollama"
    GOOGLE = "google"
    OPENROUTER = "openrouter"


@dataclass
class GraphitiConfig:
    """Configuration for Graphiti memory integration with multi-provider support.

    Uses LadybugDB as the embedded graph database (no Docker required, requires Python 3.12+).
    """

    # Core settings
    enabled: bool = False
    llm_provider: str = "openai"
    embedder_provider: str = "openai"

    # Database settings (LadybugDB - embedded, no Docker required)
    database: str = DEFAULT_DATABASE
    db_path: str = DEFAULT_DB_PATH

    # OpenAI settings
    openai_api_key: str = ""
    openai_model: str = "gpt-5-mini"
    openai_embedding_model: str = "text-embedding-3-small"

    # Anthropic settings (LLM only)
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-5"

    # Azure OpenAI settings
    azure_openai_api_key: str = ""
    azure_openai_base_url: str = ""
    azure_openai_llm_deployment: str = ""
    azure_openai_embedding_deployment: str = ""

    # Voyage AI settings (embeddings only)
    voyage_api_key: str = ""
    voyage_embedding_model: str = "voyage-3"

    # Google AI settings (LLM and embeddings)
    google_api_key: str = ""
    google_llm_model: str = "gemini-2.0-flash"
    google_embedding_model: str = "text-embedding-004"

    # OpenRouter settings (multi-provider aggregator)
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api"
    openrouter_llm_model: str = "anthropic/claude-sonnet-4"
    openrouter_embedding_model: str = "openai/text-embedding-3-small"

    # Ollama settings (local)
    ollama_base_url: str = DEFAULT_OLLAMA_BASE_URL
    ollama_llm_model: str = ""
    ollama_embedding_model: str = ""
    ollama_embedding_dim: int = 0  # Required for Ollama embeddings

    @classmethod
    def from_env(cls) -> "GraphitiConfig":
        """Create config from environment variables."""
        # Check if Graphiti is explicitly enabled
        enabled_str = os.environ.get("GRAPHITI_ENABLED", "").lower()
        enabled = enabled_str in ("true", "1", "yes")

        # Provider selection
        llm_provider = os.environ.get("GRAPHITI_LLM_PROVIDER", "openai").lower()
        embedder_provider = os.environ.get(
            "GRAPHITI_EMBEDDER_PROVIDER", "openai"
        ).lower()

        # Database settings (LadybugDB - embedded)
        database = os.environ.get("GRAPHITI_DATABASE", DEFAULT_DATABASE)
        db_path = os.environ.get("GRAPHITI_DB_PATH", DEFAULT_DB_PATH)

        # OpenAI settings
        openai_api_key = os.environ.get("OPENAI_API_KEY", "")
        openai_model = os.environ.get("OPENAI_MODEL", "gpt-5-mini")
        openai_embedding_model = os.environ.get(
            "OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"
        )

        # Anthropic settings
        anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        anthropic_model = os.environ.get(
            "GRAPHITI_ANTHROPIC_MODEL", "claude-sonnet-4-5"
        )

        # Azure OpenAI settings
        azure_openai_api_key = os.environ.get("AZURE_OPENAI_API_KEY", "")
        azure_openai_base_url = os.environ.get("AZURE_OPENAI_BASE_URL", "")
        azure_openai_llm_deployment = os.environ.get("AZURE_OPENAI_LLM_DEPLOYMENT", "")
        azure_openai_embedding_deployment = os.environ.get(
            "AZURE_OPENAI_EMBEDDING_DEPLOYMENT", ""
        )

        # Voyage AI settings
        voyage_api_key = os.environ.get("VOYAGE_API_KEY", "")
        voyage_embedding_model = os.environ.get("VOYAGE_EMBEDDING_MODEL", "voyage-3")

        # Google AI settings
        google_api_key = os.environ.get("GOOGLE_API_KEY", "")
        google_llm_model = os.environ.get("GOOGLE_LLM_MODEL", "gemini-2.0-flash")
        google_embedding_model = os.environ.get(
            "GOOGLE_EMBEDDING_MODEL", "text-embedding-004"
        )

        # OpenRouter settings
        openrouter_api_key = os.environ.get("OPENROUTER_API_KEY", "")
        openrouter_base_url = os.environ.get(
            "OPENROUTER_BASE_URL", "https://openrouter.ai/api"
        )
        openrouter_llm_model = os.environ.get(
            "OPENROUTER_LLM_MODEL", "anthropic/claude-sonnet-4"
        )
        openrouter_embedding_model = os.environ.get(
            "OPENROUTER_EMBEDDING_MODEL", "openai/text-embedding-3-small"
        )

        # Ollama settings
        ollama_base_url = os.environ.get("OLLAMA_BASE_URL", DEFAULT_OLLAMA_BASE_URL)
        ollama_llm_model = os.environ.get("OLLAMA_LLM_MODEL", "")
        ollama_embedding_model = os.environ.get("OLLAMA_EMBEDDING_MODEL", "")

        # Ollama embedding dimension (required for Ollama)
        try:
            ollama_embedding_dim = int(os.environ.get("OLLAMA_EMBEDDING_DIM", "0"))
        except ValueError:
            ollama_embedding_dim = 0

        return cls(
            enabled=enabled,
            llm_provider=llm_provider,
            embedder_provider=embedder_provider,
            database=database,
            db_path=db_path,
            openai_api_key=openai_api_key,
            openai_model=openai_model,
            openai_embedding_model=openai_embedding_model,
            anthropic_api_key=anthropic_api_key,
            anthropic_model=anthropic_model,
            azure_openai_api_key=azure_openai_api_key,
            azure_openai_base_url=azure_openai_base_url,
            azure_openai_llm_deployment=azure_openai_llm_deployment,
            azure_openai_embedding_deployment=azure_openai_embedding_deployment,
            voyage_api_key=voyage_api_key,
            voyage_embedding_model=voyage_embedding_model,
            google_api_key=google_api_key,
            google_llm_model=google_llm_model,
            google_embedding_model=google_embedding_model,
            openrouter_api_key=openrouter_api_key,
            openrouter_base_url=openrouter_base_url,
            openrouter_llm_model=openrouter_llm_model,
            openrouter_embedding_model=openrouter_embedding_model,
            ollama_base_url=ollama_base_url,
            ollama_llm_model=ollama_llm_model,
            ollama_embedding_model=ollama_embedding_model,
            ollama_embedding_dim=ollama_embedding_dim,
        )

    def is_valid(self) -> bool:
        """
        Check if config has minimum required values for operation.

        Returns True if:
        - GRAPHITI_ENABLED is true
        - Embedder provider is configured (optional - keyword search works without)

        Note: LLM provider is no longer required - Claude Agent SDK handles RAG queries.
        """
        if not self.enabled:
            return False

        # Embedder validation is optional - memory works with keyword search fallback
        # Return True if enabled, embedder config is a bonus for semantic search
        return True

    def _validate_embedder_provider(self) -> bool:
        """Validate embedder provider configuration."""
        if self.embedder_provider == "openai":
            return bool(self.openai_api_key)
        elif self.embedder_provider == "voyage":
            return bool(self.voyage_api_key)
        elif self.embedder_provider == "azure_openai":
            return bool(
                self.azure_openai_api_key
                and self.azure_openai_base_url
                and self.azure_openai_embedding_deployment
            )
        elif self.embedder_provider == "ollama":
            # Only require model - dimension is auto-detected for known models
            return bool(self.ollama_embedding_model)
        elif self.embedder_provider == "google":
            return bool(self.google_api_key)
        elif self.embedder_provider == "openrouter":
            return bool(self.openrouter_api_key)
        return False

    def get_validation_errors(self) -> list[str]:
        """Get list of validation errors for current configuration."""
        errors = []

        if not self.enabled:
            errors.append("GRAPHITI_ENABLED must be set to true")
            return errors

        # Note: LLM provider validation removed - Claude Agent SDK handles RAG queries
        # Memory works with keyword search even without embedder, so embedder errors are warnings

        # Embedder provider validation (optional - keyword search works without)
        if self.embedder_provider == "openai":
            if not self.openai_api_key:
                errors.append("OpenAI embedder provider requires OPENAI_API_KEY")
        elif self.embedder_provider == "voyage":
            if not self.voyage_api_key:
                errors.append("Voyage embedder provider requires VOYAGE_API_KEY")
        elif self.embedder_provider == "azure_openai":
            if not self.azure_openai_api_key:
                errors.append(
                    "Azure OpenAI embedder provider requires AZURE_OPENAI_API_KEY"
                )
            if not self.azure_openai_base_url:
                errors.append(
                    "Azure OpenAI embedder provider requires AZURE_OPENAI_BASE_URL"
                )
            if not self.azure_openai_embedding_deployment:
                errors.append(
                    "Azure OpenAI embedder provider requires AZURE_OPENAI_EMBEDDING_DEPLOYMENT"
                )
        elif self.embedder_provider == "ollama":
            if not self.ollama_embedding_model:
                errors.append(
                    "Ollama embedder provider requires OLLAMA_EMBEDDING_MODEL"
                )
            # Note: OLLAMA_EMBEDDING_DIM is optional - auto-detected for known models
        elif self.embedder_provider == "google":
            if not self.google_api_key:
                errors.append("Google embedder provider requires GOOGLE_API_KEY")
        elif self.embedder_provider == "openrouter":
            if not self.openrouter_api_key:
                errors.append(
                    "OpenRouter embedder provider requires OPENROUTER_API_KEY"
                )
        else:
            errors.append(f"Unknown embedder provider: {self.embedder_provider}")

        return errors

    def get_db_path(self) -> Path:
        """
        Get the resolved database path.

        Expands ~ to home directory and appends the database name.
        Creates the parent directory if it doesn't exist (not the final
        database file/directory itself, which is created by the driver).
        """
        base_path = Path(self.db_path).expanduser()
        full_path = base_path / self.database
        full_path.parent.mkdir(parents=True, exist_ok=True)
        return full_path

    def get_provider_summary(self) -> str:
        """Get a summary of configured providers."""
        return f"LLM: {self.llm_provider}, Embedder: {self.embedder_provider}"

    def get_embedding_dimension(self) -> int:
        """
        Get the embedding dimension for the current embedder provider.

        Returns:
            Embedding dimension (e.g., 768, 1024, 1536)
        """
        if self.embedder_provider == "ollama":
            if self.ollama_embedding_dim > 0:
                return self.ollama_embedding_dim
            # Auto-detect for known models
            model = self.ollama_embedding_model.lower()
            if "embeddinggemma" in model or "nomic-embed-text" in model:
                return 768
            elif "mxbai" in model or "bge-large" in model:
                return 1024
            elif "qwen3" in model:
                if "0.6b" in model:
                    return 1024
                elif "4b" in model:
                    return 2560
                elif "8b" in model:
                    return 4096
            return 768  # Default fallback
        elif self.embedder_provider == "openai":
            # OpenAI text-embedding-3-small default is 1536
            return 1536
        elif self.embedder_provider == "voyage":
            # Voyage-3 uses 1024 dimensions
            return 1024
        elif self.embedder_provider == "google":
            # Google text-embedding-004 uses 768 dimensions
            return 768
        elif self.embedder_provider == "azure_openai":
            # Depends on the deployment, default to 1536
            return 1536
        elif self.embedder_provider == "openrouter":
            # OpenRouter uses provider/model format
            # Extract underlying provider to determine dimension
            model = self.openrouter_embedding_model.lower()
            if model.startswith("openai/"):
                return 1536  # OpenAI text-embedding-3-small
            elif model.startswith("voyage/"):
                return 1024  # Voyage-3
            elif model.startswith("google/"):
                return 768  # Google text-embedding-004
            # Add more providers as needed
            return 1536  # Default for unknown OpenRouter models
        return 768  # Safe default

    def get_provider_signature(self) -> str:
        """
        Get a unique signature for the current embedding provider configuration.

        Used to generate provider-specific database names to prevent mixing
        incompatible embeddings.

        Returns:
            Provider signature string (e.g., "openai_1536", "ollama_768")
        """
        provider = self.embedder_provider
        dim = self.get_embedding_dimension()

        if provider == "ollama":
            # Include model name for Ollama
            model = self.ollama_embedding_model.replace(":", "_").replace(".", "_")
            return f"ollama_{model}_{dim}"
        else:
            return f"{provider}_{dim}"

    def get_provider_specific_database_name(self, base_name: str = None) -> str:
        """
        Get a provider-specific database name to prevent embedding dimension mismatches.

        Args:
            base_name: Base database name (default: from config)

        Returns:
            Database name with provider signature (e.g., "auto_claude_memory_ollama_768")
        """
        if base_name is None:
            base_name = self.database

        # Remove existing provider suffix if present
        for provider in [
            "openai",
            "ollama",
            "voyage",
            "google",
            "azure_openai",
            "openrouter",
        ]:
            if f"_{provider}_" in base_name:
                base_name = base_name.split(f"_{provider}_")[0]
                break

        signature = self.get_provider_signature()
        return f"{base_name}_{signature}"


@dataclass
class GraphitiState:
    """State of Graphiti integration for an auto-claude spec."""

    initialized: bool = False
    database: str | None = None
    indices_built: bool = False
    created_at: str | None = None
    last_session: int | None = None
    episode_count: int = 0
    error_log: list = field(default_factory=list)
    # V2 additions
    llm_provider: str | None = None
    embedder_provider: str | None = None

    def to_dict(self) -> dict:
        return {
            "initialized": self.initialized,
            "database": self.database,
            "indices_built": self.indices_built,
            "created_at": self.created_at,
            "last_session": self.last_session,
            "episode_count": self.episode_count,
            "error_log": self.error_log[-10:],  # Keep last 10 errors
            "llm_provider": self.llm_provider,
            "embedder_provider": self.embedder_provider,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "GraphitiState":
        return cls(
            initialized=data.get("initialized", False),
            database=data.get("database"),
            indices_built=data.get("indices_built", False),
            created_at=data.get("created_at"),
            last_session=data.get("last_session"),
            episode_count=data.get("episode_count", 0),
            error_log=data.get("error_log", []),
            llm_provider=data.get("llm_provider"),
            embedder_provider=data.get("embedder_provider"),
        )

    def save(self, spec_dir: Path) -> None:
        """Save state to the spec directory."""
        marker_file = spec_dir / GRAPHITI_STATE_MARKER
        with open(marker_file, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load(cls, spec_dir: Path) -> Optional["GraphitiState"]:
        """Load state from the spec directory."""
        marker_file = spec_dir / GRAPHITI_STATE_MARKER
        if not marker_file.exists():
            return None

        try:
            with open(marker_file, encoding="utf-8") as f:
                return cls.from_dict(json.load(f))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            return None

    def record_error(self, error_msg: str) -> None:
        """Record an error in the state."""
        self.error_log.append(
            {
                "timestamp": datetime.now().isoformat(),
                "error": error_msg[:500],  # Limit error message length
            }
        )
        # Keep only last 10 errors
        self.error_log = self.error_log[-10:]

    def has_provider_changed(self, config: GraphitiConfig) -> bool:
        """
        Check if the embedding provider has changed since initialization.

        Args:
            config: Current GraphitiConfig

        Returns:
            True if provider has changed (requiring migration)
        """
        if not self.initialized or not self.embedder_provider:
            return False

        return self.embedder_provider != config.embedder_provider

    def get_migration_info(self, config: GraphitiConfig) -> dict:
        """
        Get information about provider migration needs.

        Args:
            config: Current GraphitiConfig

        Returns:
            Dict with migration details or None if no migration needed
        """
        if not self.has_provider_changed(config):
            return None

        return {
            "old_provider": self.embedder_provider,
            "new_provider": config.embedder_provider,
            "old_database": self.database,
            "new_database": config.get_provider_specific_database_name(),
            "episode_count": self.episode_count,
            "requires_migration": True,
        }


def is_graphiti_enabled() -> bool:
    """
    Quick check if Graphiti integration is available.

    Returns True if:
    - GRAPHITI_ENABLED is set to true/1/yes
    - Required provider credentials are configured
    """
    config = GraphitiConfig.from_env()
    return config.is_valid()


def get_graphiti_status() -> dict:
    """
    Get the current Graphiti integration status.

    Returns:
        Dict with status information:
            - enabled: bool
            - available: bool (has required dependencies)
            - database: str
            - db_path: str
            - llm_provider: str
            - embedder_provider: str
            - reason: str (why unavailable if not available)
            - errors: list (validation errors if any)
    """
    config = GraphitiConfig.from_env()

    status = {
        "enabled": config.enabled,
        "available": False,
        "database": config.database,
        "db_path": config.db_path,
        "llm_provider": config.llm_provider,
        "embedder_provider": config.embedder_provider,
        "reason": "",
        "errors": [],
    }

    if not config.enabled:
        status["reason"] = "GRAPHITI_ENABLED not set to true"
        return status

    # Get validation errors (these are warnings, not blockers)
    errors = config.get_validation_errors()
    if errors:
        status["errors"] = errors
        # Errors are informational - embedder is optional (keyword search fallback)

    # CRITICAL FIX: Actually verify packages are importable before reporting available
    # Don't just check config.is_valid() - actually try to import the module
    # Note: This branch is currently unreachable because is_valid() returns True
    # whenever enabled is True. Kept for defensive purposes in case is_valid()
    # logic changes in the future.
    if not config.is_valid():  # pragma: no cover
        status["reason"] = errors[0] if errors else "Configuration invalid"
        return status

    # Try importing the required Graphiti packages
    try:
        # Attempt to import the main graphiti_memory module
        import graphiti_core  # noqa: F401

        # Try LadybugDB first (preferred for Python 3.12+), fall back to kuzu
        try:
            import real_ladybug  # noqa: F401
        except ImportError:
            try:
                import kuzu  # noqa: F401
            except ImportError:
                status["available"] = False
                status["reason"] = (
                    "Graph database backend not installed (need real_ladybug or kuzu)"
                )
                return status
        status["available"] = True
    except ImportError as e:
        status["available"] = False
        status["reason"] = f"Graphiti packages not installed: {e}"

    return status


def get_available_providers() -> dict:
    """
    Get list of available providers based on current environment.

    Returns:
        Dict with lists of available LLM and embedder providers
    """
    config = GraphitiConfig.from_env()

    available_llm = []
    available_embedder = []

    # Check OpenAI
    if config.openai_api_key:
        available_llm.append("openai")
        available_embedder.append("openai")

    # Check Anthropic
    if config.anthropic_api_key:
        available_llm.append("anthropic")

    # Check Azure OpenAI
    if config.azure_openai_api_key and config.azure_openai_base_url:
        if config.azure_openai_llm_deployment:
            available_llm.append("azure_openai")
        if config.azure_openai_embedding_deployment:
            available_embedder.append("azure_openai")

    # Check Voyage
    if config.voyage_api_key:
        available_embedder.append("voyage")

    # Check Google AI
    if config.google_api_key:
        available_llm.append("google")
        available_embedder.append("google")

    # Check OpenRouter
    if config.openrouter_api_key:
        available_llm.append("openrouter")
        available_embedder.append("openrouter")

    # Check Ollama
    if config.ollama_llm_model:
        available_llm.append("ollama")
    if config.ollama_embedding_model and config.ollama_embedding_dim:
        available_embedder.append("ollama")

    return {
        "llm_providers": available_llm,
        "embedder_providers": available_embedder,
    }


def validate_graphiti_config() -> tuple[bool, list[str]]:
    """
    Validate Graphiti configuration from environment.

    Returns:
        Tuple of (is_valid, error_messages)
        - is_valid: True if configuration is valid
        - error_messages: List of validation error messages (empty if valid)
    """
    config = GraphitiConfig.from_env()

    if not config.is_valid():
        errors = config.get_validation_errors()
        return False, errors

    return True, []
