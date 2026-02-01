"""
Ollama Router
=============

API endpoints for Ollama model management.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

# Ensure parent directory is in path for imports
_PARENT_DIR = Path(__file__).parent.parent.parent
if str(_PARENT_DIR) not in sys.path:
    sys.path.insert(0, str(_PARENT_DIR))


from ..utils.security import get_secure_logger

router = APIRouter()
logger = get_secure_logger("auto-claude-api")

DEFAULT_OLLAMA_URL = "http://localhost:11434"


def get_ollama_url(base_url: str | None = None) -> str:
    """Get the Ollama base URL."""
    return base_url or os.environ.get("OLLAMA_BASE_URL", DEFAULT_OLLAMA_URL)


@router.get("/ollama/status")
async def check_ollama_status(baseUrl: str | None = None) -> dict:
    """Check if Ollama is running."""
    url = get_ollama_url(baseUrl)

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{url}/api/version")

            if response.status_code == 200:
                data = response.json()
                return {
                    "success": True,
                    "data": {
                        "running": True,
                        "url": url,
                        "version": data.get("version"),
                        "message": "Ollama is running",
                    },
                }
            else:
                return {
                    "success": True,
                    "data": {
                        "running": False,
                        "url": url,
                        "message": f"Ollama returned status {response.status_code}",
                    },
                }
    except httpx.ConnectError:
        return {
            "success": True,
            "data": {
                "running": False,
                "url": url,
                "message": "Cannot connect to Ollama - is it running?",
            },
        }
    except Exception as e:
        return {
            "success": True,
            "data": {"running": False, "url": url, "message": str(e)},
        }


@router.get("/ollama/installed")
async def check_ollama_installed() -> dict:
    """Check if Ollama is installed on the system."""
    ollama_path = shutil.which("ollama")

    if not ollama_path:
        return {
            "success": True,
            "data": {"installed": False, "path": None, "version": None},
        }

    # Get version
    try:
        result = subprocess.run(
            ["ollama", "--version"], capture_output=True, text=True, timeout=5
        )
        version = result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        version = None

    return {
        "success": True,
        "data": {"installed": True, "path": ollama_path, "version": version},
    }


@router.post("/ollama/install")
async def install_ollama() -> dict:
    """Return installation instructions for Ollama."""
    import platform

    system = platform.system().lower()

    if system == "darwin":
        command = "brew install ollama"
    elif system == "linux":
        command = "curl -fsSL https://ollama.com/install.sh | sh"
    elif system == "windows":
        command = "winget install Ollama.Ollama"
    else:
        command = "Visit https://ollama.com/download for installation instructions"

    return {"success": True, "data": {"command": command}}


@router.get("/ollama/models")
async def list_ollama_models(baseUrl: str | None = None) -> dict:
    """List all Ollama models."""
    url = get_ollama_url(baseUrl)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{url}/api/tags")

            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Failed to list models: {response.status_code}",
                }

            data = response.json()
            models = []

            for model in data.get("models", []):
                name = model.get("name", "")
                size_bytes = model.get("size", 0)

                # Detect if it's an embedding model
                is_embedding = any(
                    x in name.lower() for x in ["embed", "nomic", "minilm", "bge"]
                )

                models.append(
                    {
                        "name": name,
                        "size_bytes": size_bytes,
                        "size_gb": round(size_bytes / (1024**3), 2),
                        "modified_at": model.get("modified_at", ""),
                        "is_embedding": is_embedding,
                        "embedding_dim": None,
                        "description": model.get("details", {}).get("family", ""),
                    }
                )

            return {"success": True, "data": {"models": models, "count": len(models)}}
    except httpx.ConnectError:
        return {"success": False, "error": "Cannot connect to Ollama - is it running?"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/ollama/embedding-models")
async def list_ollama_embedding_models(baseUrl: str | None = None) -> dict:
    """List Ollama embedding models."""
    result = await list_ollama_models(baseUrl)

    if not result.get("success"):
        return result

    models = result.get("data", {}).get("models", [])
    embedding_models = [m for m in models if m.get("is_embedding")]

    # Also add common embedding models that might be available
    common_embedding_models = [
        {
            "name": "nomic-embed-text",
            "embedding_dim": 768,
            "description": "Nomic AI text embeddings",
        },
        {
            "name": "mxbai-embed-large",
            "embedding_dim": 1024,
            "description": "Mixedbread AI embeddings",
        },
        {
            "name": "all-minilm",
            "embedding_dim": 384,
            "description": "All-MiniLM sentence transformer",
        },
        {
            "name": "bge-base",
            "embedding_dim": 768,
            "description": "BAAI General Embeddings",
        },
    ]

    # Merge with detected models
    model_names = {m["name"] for m in embedding_models}
    for model in common_embedding_models:
        if model["name"] not in model_names:
            embedding_models.append(
                {
                    **model,
                    "size_bytes": 0,
                    "size_gb": 0,
                }
            )

    return {
        "success": True,
        "data": {"embedding_models": embedding_models, "count": len(embedding_models)},
    }


class PullModelRequest(BaseModel):
    """Request to pull a model."""

    modelName: str
    baseUrl: str | None = None


@router.post("/ollama/pull")
async def pull_ollama_model(request: PullModelRequest) -> dict:
    """Pull/download an Ollama model."""
    url = get_ollama_url(request.baseUrl)

    try:
        async with httpx.AsyncClient(timeout=600.0) as client:  # 10 min timeout
            response = await client.post(
                f"{url}/api/pull", json={"name": request.modelName, "stream": False}
            )

            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Failed to pull model: {response.text}",
                }

            return {
                "success": True,
                "data": {
                    "model": request.modelName,
                    "status": "completed",
                    "output": ["Model pulled successfully"],
                },
            }
    except httpx.ConnectError:
        return {"success": False, "error": "Cannot connect to Ollama"}
    except httpx.TimeoutException:
        return {"success": False, "error": "Model pull timed out - try again"}
    except Exception as e:
        return {"success": False, "error": str(e)}
