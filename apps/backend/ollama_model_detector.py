#!/usr/bin/env python3
"""
Ollama Model Detector for ac-jerry-ui.

Queries the Ollama API to detect available models, specifically focusing on
embedding models for semantic search functionality.

Usage:
    python ollama_model_detector.py list-models [--base-url URL]
    python ollama_model_detector.py list-embedding-models [--base-url URL]
    python ollama_model_detector.py check-status [--base-url URL]

Output:
    JSON to stdout with structure: {"success": bool, "data": ..., "error": ...}
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from typing import Any

DEFAULT_OLLAMA_URL = "http://localhost:11434"

# Minimum Ollama version required for newer embedding models (qwen3-embedding, etc.)
# These models were added in Ollama 0.10.0
MIN_OLLAMA_VERSION_FOR_NEW_MODELS = "0.10.0"

# Known embedding models and their dimensions
# This list helps identify embedding models from the model name
KNOWN_EMBEDDING_MODELS = {
    "nomic-embed-text": {"dim": 768, "description": "Nomic AI text embeddings"},
    "embeddinggemma": {
        "dim": 768,
        "description": "Google EmbeddingGemma (lightweight)",
    },
    "qwen3-embedding": {
        "dim": 1024,
        "description": "Qwen3 Embedding (0.6B)",
        "min_version": "0.10.0",
    },
    "qwen3-embedding:0.6b": {
        "dim": 1024,
        "description": "Qwen3 Embedding 0.6B",
        "min_version": "0.10.0",
    },
    "qwen3-embedding:4b": {
        "dim": 2560,
        "description": "Qwen3 Embedding 4B",
        "min_version": "0.10.0",
    },
    "qwen3-embedding:8b": {
        "dim": 4096,
        "description": "Qwen3 Embedding 8B",
        "min_version": "0.10.0",
    },
    "bge-base-en": {"dim": 768, "description": "BAAI General Embedding - Base"},
    "bge-large-en": {"dim": 1024, "description": "BAAI General Embedding - Large"},
    "bge-small-en": {"dim": 384, "description": "BAAI General Embedding - Small"},
    "bge-m3": {"dim": 1024, "description": "BAAI General Embedding M3 (multilingual)"},
    "mxbai-embed-large": {
        "dim": 1024,
        "description": "MixedBread AI Embeddings - Large",
    },
    "all-minilm": {"dim": 384, "description": "All-MiniLM sentence embeddings"},
    "snowflake-arctic-embed": {"dim": 1024, "description": "Snowflake Arctic Embed"},
    "jina-embeddings-v2-base-en": {"dim": 768, "description": "Jina AI Embeddings V2"},
    "e5-small": {"dim": 384, "description": "E5 Small embeddings"},
    "e5-base": {"dim": 768, "description": "E5 Base embeddings"},
    "e5-large": {"dim": 1024, "description": "E5 Large embeddings"},
    "paraphrase-multilingual": {
        "dim": 768,
        "description": "Multilingual paraphrase model",
    },
}

# Recommended embedding models for download (shown in UI)
RECOMMENDED_EMBEDDING_MODELS = [
    {
        "name": "qwen3-embedding:4b",
        "description": "Qwen3 4B - Balanced quality and speed",
        "size_estimate": "3.1 GB",
        "dim": 2560,
        "badge": "recommended",
        "min_ollama_version": "0.10.0",
    },
    {
        "name": "qwen3-embedding:8b",
        "description": "Qwen3 8B - Best embedding quality",
        "size_estimate": "6.0 GB",
        "dim": 4096,
        "badge": "quality",
        "min_ollama_version": "0.10.0",
    },
    {
        "name": "qwen3-embedding:0.6b",
        "description": "Qwen3 0.6B - Smallest and fastest",
        "size_estimate": "494 MB",
        "dim": 1024,
        "badge": "fast",
        "min_ollama_version": "0.10.0",
    },
    {
        "name": "embeddinggemma",
        "description": "Google's lightweight embedding model (768 dim)",
        "size_estimate": "621 MB",
        "dim": 768,
    },
    {
        "name": "nomic-embed-text",
        "description": "Popular general-purpose embeddings (768 dim)",
        "size_estimate": "274 MB",
        "dim": 768,
    },
    {
        "name": "mxbai-embed-large",
        "description": "MixedBread AI large embeddings (1024 dim)",
        "size_estimate": "670 MB",
        "dim": 1024,
    },
]

# Patterns that indicate an embedding model
EMBEDDING_PATTERNS = [
    "embed",
    "embedding",
    "bge-",
    "e5-",
    "minilm",
    "arctic-embed",
    "jina-embed",
    "nomic-embed",
    "mxbai-embed",
]


def parse_version(version_str: str | None) -> tuple[int, ...]:
    """Parse a version string like '0.10.0' into a tuple for comparison."""
    if not version_str or not isinstance(version_str, str):
        return (0, 0, 0)
    # Extract just the numeric parts (handles versions like "0.10.0-rc1")
    match = re.match(r"(\d+)\.(\d+)\.(\d+)", version_str)
    if match:
        return tuple(int(x) for x in match.groups())
    return (0, 0, 0)


def version_gte(version: str | None, min_version: str | None) -> bool:
    """Check if version >= min_version."""
    return parse_version(version) >= parse_version(min_version)


def output_json(success: bool, data: Any = None, error: str | None = None) -> None:
    """Output JSON result to stdout and exit."""
    result = {"success": success}
    if data is not None:
        result["data"] = data
    if error:
        result["error"] = error
    print(json.dumps(result))
    sys.exit(0 if success else 1)


def output_error(message: str) -> None:
    """Output error JSON and exit with failure."""
    output_json(False, error=message)


def fetch_ollama_api(base_url: str, endpoint: str, timeout: int = 5) -> dict | None:
    """Fetch data from Ollama API."""
    url = f"{base_url.rstrip('/')}/{endpoint}"
    try:
        req = urllib.request.Request(url)
        req.add_header("Content-Type", "application/json")

        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode())
    except urllib.error.URLError as e:
        return None
    except json.JSONDecodeError:
        return None
    except Exception:
        return None


def get_ollama_version(base_url: str) -> str | None:
    """Get the Ollama server version."""
    result = fetch_ollama_api(base_url, "api/version")
    if result:
        return result.get("version")
    return None


def is_embedding_model(model_name: str) -> bool:
    """Check if a model name suggests it's an embedding model."""
    name_lower = model_name.lower()

    # Check if it matches any known embedding model
    for known_model in KNOWN_EMBEDDING_MODELS:
        if known_model in name_lower:
            return True

    # Check if it matches any embedding pattern
    for pattern in EMBEDDING_PATTERNS:
        if pattern in name_lower:
            return True

    return False


def get_embedding_dim(model_name: str) -> int | None:
    """Get the embedding dimension for a known model."""
    name_lower = model_name.lower()

    for known_model, info in KNOWN_EMBEDDING_MODELS.items():
        if known_model in name_lower:
            return info["dim"]

    # Default dimensions for common patterns
    if "large" in name_lower:
        return 1024
    elif "base" in name_lower:
        return 768
    elif "small" in name_lower or "mini" in name_lower:
        return 384

    return None


def get_embedding_description(model_name: str) -> str:
    """Get a description for an embedding model."""
    name_lower = model_name.lower()

    for known_model, info in KNOWN_EMBEDDING_MODELS.items():
        if known_model in name_lower:
            return info["description"]

    return "Embedding model"


def get_model_min_version(model_name: str) -> str | None:
    """Get the minimum Ollama version required for a model."""
    name_lower = model_name.lower()

    # Sort keys by length descending to match more specific names first
    # e.g., "qwen3-embedding:8b" before "qwen3-embedding"
    for known_model in sorted(KNOWN_EMBEDDING_MODELS.keys(), key=len, reverse=True):
        if known_model in name_lower:
            return KNOWN_EMBEDDING_MODELS[known_model].get("min_version")

    return None


def cmd_check_status(args) -> None:
    """Check if Ollama is running and accessible."""
    base_url = args.base_url or DEFAULT_OLLAMA_URL

    # Try to get the version/health endpoint
    result = fetch_ollama_api(base_url, "api/version")

    if result:
        version = result.get("version", "unknown")
        output_json(
            True,
            data={
                "running": True,
                "url": base_url,
                "version": version,
                "supports_new_models": version_gte(
                    version, MIN_OLLAMA_VERSION_FOR_NEW_MODELS
                )
                if version != "unknown"
                else None,
            },
        )
    else:
        # Try alternative endpoint
        tags = fetch_ollama_api(base_url, "api/tags")
        if tags:
            output_json(
                True,
                data={
                    "running": True,
                    "url": base_url,
                    "version": "unknown",
                },
            )
        else:
            output_json(
                True,
                data={
                    "running": False,
                    "url": base_url,
                    "message": "Ollama is not running or not accessible",
                },
            )


def cmd_list_models(args) -> None:
    """List all available Ollama models."""
    base_url = args.base_url or DEFAULT_OLLAMA_URL

    result = fetch_ollama_api(base_url, "api/tags")

    if not result:
        output_error(f"Could not connect to Ollama at {base_url}")
        return

    models = result.get("models", [])

    model_list = []
    for model in models:
        name = model.get("name", "")
        size = model.get("size", 0)
        modified = model.get("modified_at", "")

        model_info = {
            "name": name,
            "size_bytes": size,
            "size_gb": round(size / (1024**3), 2) if size else 0,
            "modified_at": modified,
            "is_embedding": is_embedding_model(name),
        }

        if model_info["is_embedding"]:
            model_info["embedding_dim"] = get_embedding_dim(name)
            model_info["description"] = get_embedding_description(name)

        model_list.append(model_info)

    output_json(
        True,
        data={
            "models": model_list,
            "count": len(model_list),
            "url": base_url,
        },
    )


def cmd_list_embedding_models(args) -> None:
    """List only embedding models from Ollama."""
    base_url = args.base_url or DEFAULT_OLLAMA_URL

    result = fetch_ollama_api(base_url, "api/tags")

    if not result:
        output_error(f"Could not connect to Ollama at {base_url}")
        return

    models = result.get("models", [])

    embedding_models = []
    for model in models:
        name = model.get("name", "")

        if is_embedding_model(name):
            embedding_dim = get_embedding_dim(name)

            embedding_models.append(
                {
                    "name": name,
                    "embedding_dim": embedding_dim,
                    "description": get_embedding_description(name),
                    "size_bytes": model.get("size", 0),
                    "size_gb": round(model.get("size", 0) / (1024**3), 2),
                }
            )

    # Sort by name
    embedding_models.sort(key=lambda x: x["name"])

    output_json(
        True,
        data={
            "embedding_models": embedding_models,
            "count": len(embedding_models),
            "url": base_url,
        },
    )


def cmd_get_recommended_models(args) -> None:
    """Get recommended embedding models with install status."""
    base_url = args.base_url or DEFAULT_OLLAMA_URL

    # Get Ollama version for compatibility checking
    ollama_version = get_ollama_version(base_url)

    # Get currently installed models
    result = fetch_ollama_api(base_url, "api/tags")
    installed_names = set()
    if result:
        for model in result.get("models", []):
            name = model.get("name", "")
            # Normalize name (remove :latest suffix for comparison)
            base_name = name.split(":")[0] if ":" in name else name
            installed_names.add(name)
            installed_names.add(base_name)

    # Build recommended list with install status and compatibility
    recommended = []
    for model in RECOMMENDED_EMBEDDING_MODELS:
        name = model["name"]
        base_name = name.split(":")[0] if ":" in name else name
        is_installed = name in installed_names or base_name in installed_names

        # Check version compatibility
        min_version = model.get("min_ollama_version")
        is_compatible = True
        compatibility_note = None
        if min_version and ollama_version:
            is_compatible = version_gte(ollama_version, min_version)
            if not is_compatible:
                compatibility_note = f"Requires Ollama {min_version}+"
        elif min_version and not ollama_version:
            compatibility_note = "Version compatibility could not be verified"

        recommended.append(
            {
                **model,
                "installed": is_installed,
                "compatible": is_compatible,
                "compatibility_note": compatibility_note,
            }
        )

    output_json(
        True,
        data={
            "recommended": recommended,
            "count": len(recommended),
            "url": base_url,
            "ollama_version": ollama_version,
        },
    )


def cmd_pull_model(args) -> None:
    """Pull (download) an Ollama model using the HTTP API for progress tracking."""
    model_name = args.model
    base_url = getattr(args, "base_url", None) or DEFAULT_OLLAMA_URL

    if not model_name:
        output_error("Model name is required")
        return

    # Check Ollama version compatibility before attempting pull
    ollama_version = get_ollama_version(base_url)
    min_version = get_model_min_version(model_name)

    if min_version and ollama_version:
        if not version_gte(ollama_version, min_version):
            output_error(
                f"Model '{model_name}' requires Ollama {min_version} or newer. "
                f"Your version is {ollama_version}. "
                f"Please upgrade Ollama: https://ollama.com/download"
            )
            return

    try:
        url = f"{base_url.rstrip('/')}/api/pull"
        data = json.dumps({"name": model_name}).encode("utf-8")

        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")

        with urllib.request.urlopen(req, timeout=600) as response:
            # Ollama streams NDJSON (newline-delimited JSON) progress
            for line in response:
                try:
                    progress = json.loads(line.decode("utf-8"))

                    # Check for error in the streaming response
                    # This handles cases like "requires newer version of Ollama"
                    if "error" in progress:
                        error_msg = progress["error"]
                        # Clean up the error message (remove extra whitespace/newlines)
                        error_msg = " ".join(error_msg.split())
                        # Check if it's a version-related error
                        if "newer version" in error_msg.lower():
                            error_msg = (
                                f"Model '{model_name}' requires a newer version of Ollama. "
                                f"Your version: {ollama_version or 'unknown'}. "
                                f"Please upgrade: https://ollama.com/download"
                            )
                        output_error(error_msg)
                        return

                    # Emit progress as NDJSON to stderr for main process to parse
                    if "completed" in progress and "total" in progress:
                        print(
                            json.dumps(
                                {
                                    "status": progress.get("status", "downloading"),
                                    "completed": progress.get("completed", 0),
                                    "total": progress.get("total", 0),
                                }
                            ),
                            file=sys.stderr,
                            flush=True,
                        )
                    elif progress.get("status") == "success":
                        # Download complete
                        pass
                except json.JSONDecodeError:
                    continue

        output_json(
            True,
            data={
                "model": model_name,
                "status": "completed",
                "output": ["Download completed successfully"],
            },
        )

    except urllib.error.URLError as e:
        output_error(f"Failed to connect to Ollama: {str(e)}")
    except urllib.error.HTTPError as e:
        output_error(f"Ollama API error: {e.code} - {e.reason}")
    except Exception as e:
        output_error(f"Failed to pull model: {str(e)}")


def main():
    parser = argparse.ArgumentParser(
        description="Detect and list Ollama models for ac-jerry-ui"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # check-status command
    status_parser = subparsers.add_parser(
        "check-status", help="Check if Ollama is running"
    )
    status_parser.add_argument(
        "--base-url", help=f"Ollama server URL (default: {DEFAULT_OLLAMA_URL})"
    )

    # list-models command
    list_parser = subparsers.add_parser("list-models", help="List all Ollama models")
    list_parser.add_argument(
        "--base-url", help=f"Ollama server URL (default: {DEFAULT_OLLAMA_URL})"
    )

    # list-embedding-models command
    embed_parser = subparsers.add_parser(
        "list-embedding-models", help="List Ollama embedding models"
    )
    embed_parser.add_argument(
        "--base-url", help=f"Ollama server URL (default: {DEFAULT_OLLAMA_URL})"
    )

    # get-recommended-models command
    recommend_parser = subparsers.add_parser(
        "get-recommended-models",
        help="Get recommended embedding models with install status",
    )
    recommend_parser.add_argument(
        "--base-url", help=f"Ollama server URL (default: {DEFAULT_OLLAMA_URL})"
    )

    # pull-model command
    pull_parser = subparsers.add_parser(
        "pull-model", help="Pull (download) an Ollama model"
    )
    pull_parser.add_argument("model", help="Model name to pull (e.g., embeddinggemma)")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        output_error("No command specified")
        return

    commands = {
        "check-status": cmd_check_status,
        "list-models": cmd_list_models,
        "list-embedding-models": cmd_list_embedding_models,
        "get-recommended-models": cmd_get_recommended_models,
        "pull-model": cmd_pull_model,
    }

    handler = commands.get(args.command)
    if handler:
        handler(args)
    else:
        output_error(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
