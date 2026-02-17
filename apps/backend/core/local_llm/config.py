# Copyright (C) 2024-2026 Jerry Team
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Local LLM Configuration
========================

Configuration dataclass for the local LLM client. Reads from environment
variables with sensible defaults for common setups (Ollama, vLLM, etc.).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# Default Ollama endpoint (OpenAI-compatible)
DEFAULT_BASE_URL = "http://localhost:11434/v1"

# Models known to have good tool/function calling support
RECOMMENDED_MODELS = {
    "qwen2.5-coder:32b": "Best balance of coding ability and tool calling",
    "qwen2.5-coder:14b": "Good coding, fits on 24GB VRAM",
    "qwen2.5-coder:7b": "Lightweight, fits on 16GB VRAM",
    "deepseek-coder-v2:16b": "Strong coding with tool support",
    "llama3.1:70b": "Excellent general + tool calling",
    "llama3.1:8b": "Lightweight general + tool calling",
    "mistral-large:latest": "Strong reasoning and tool use",
    "codestral:latest": "Mistral's dedicated coding model",
}

# Models that support native tool/function calling via OpenAI-compatible API
TOOL_CALLING_MODELS = {
    "qwen2.5",
    "llama3.1",
    "llama3.2",
    "llama3.3",
    "mistral",
    "mixtral",
    "codestral",
    "deepseek-coder-v2",
    "command-r",
    "firefunction",
    "hermes",
}


def _is_tool_calling_model(model: str) -> bool:
    """Check if a model is known to support native tool/function calling."""
    model_lower = model.lower()
    return any(family in model_lower for family in TOOL_CALLING_MODELS)


@dataclass
class LocalLLMConfig:
    """
    Configuration for the local LLM client.

    All settings can be overridden via environment variables prefixed with LOCAL_LLM_.

    Attributes:
        base_url: OpenAI-compatible API endpoint URL
        model: Model identifier (as known to the local server)
        api_key: API key (most local servers accept any value or "ollama")
        temperature: Sampling temperature (0.0 = deterministic)
        max_tokens: Maximum tokens in the response
        max_turns: Maximum agentic loop iterations (tool call rounds)
        system_prompt: System instructions for the agent
        project_dir: Working directory for tool execution
        tool_calling_mode: How to handle tool calling:
            - "native": Use OpenAI function calling API (requires model support)
            - "prompt": Inject tool schemas into prompt, parse XML/JSON tool calls
            - "auto": Auto-detect based on model name
        timeout: Request timeout in seconds
        enable_thinking: Whether to request chain-of-thought (if model supports it)
        allowed_tools: List of tool names the agent can use
        bash_security_hook: Optional callable for bash command validation
    """

    base_url: str = ""
    model: str = ""
    api_key: str = ""
    temperature: float = 0.0
    max_tokens: int = 16384
    max_turns: int = 100
    system_prompt: str = ""
    project_dir: Path | None = None
    tool_calling_mode: str = "auto"
    timeout: int = 300
    enable_thinking: bool = False
    allowed_tools: list[str] = field(default_factory=list)
    bash_security_hook: object | None = None  # Callable for bash command validation

    def __post_init__(self) -> None:
        """Resolve values from environment variables if not explicitly set."""
        if not self.base_url:
            self.base_url = os.environ.get("LOCAL_LLM_BASE_URL", DEFAULT_BASE_URL)

        if not self.model:
            self.model = os.environ.get("LOCAL_LLM_MODEL", "qwen2.5-coder:32b")

        if not self.api_key:
            # Most local servers don't need a real key
            self.api_key = os.environ.get("LOCAL_LLM_API_KEY", "local")

        # Parse numeric env vars
        if env_temp := os.environ.get("LOCAL_LLM_TEMPERATURE"):
            try:
                self.temperature = float(env_temp)
            except ValueError:
                logger.warning(f"Invalid LOCAL_LLM_TEMPERATURE: {env_temp}")

        if env_max_tokens := os.environ.get("LOCAL_LLM_MAX_TOKENS"):
            try:
                self.max_tokens = int(env_max_tokens)
            except ValueError:
                logger.warning(f"Invalid LOCAL_LLM_MAX_TOKENS: {env_max_tokens}")

        if env_timeout := os.environ.get("LOCAL_LLM_TIMEOUT"):
            try:
                self.timeout = int(env_timeout)
            except ValueError:
                logger.warning(f"Invalid LOCAL_LLM_TIMEOUT: {env_timeout}")

        if env_mode := os.environ.get("LOCAL_LLM_TOOL_MODE"):
            if env_mode in ("native", "prompt", "auto"):
                self.tool_calling_mode = env_mode

        # Auto-detect tool calling mode
        if self.tool_calling_mode == "auto":
            if _is_tool_calling_model(self.model):
                self.tool_calling_mode = "native"
                logger.info(f"Auto-detected native tool calling for model: {self.model}")
            else:
                self.tool_calling_mode = "prompt"
                logger.info(f"Using prompt-based tool calling for model: {self.model}")

    def validate(self) -> list[str]:
        """Validate configuration and return list of issues (empty = valid)."""
        issues = []
        if not self.base_url:
            issues.append("base_url is required (set LOCAL_LLM_BASE_URL)")
        if not self.model:
            issues.append("model is required (set LOCAL_LLM_MODEL)")
        if self.temperature < 0 or self.temperature > 2:
            issues.append(f"temperature must be 0-2, got {self.temperature}")
        if self.max_tokens < 1:
            issues.append(f"max_tokens must be positive, got {self.max_tokens}")
        if self.tool_calling_mode not in ("native", "prompt"):
            issues.append(f"tool_calling_mode must be 'native' or 'prompt' after resolution, got {self.tool_calling_mode}")
        return issues
