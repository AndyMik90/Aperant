# Copyright (C) 2024-2026 Jerry Team
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Local LLM Integration
=====================

Provides a complete local LLM client that replaces the Claude Agent SDK
for environments that can only use locally-hosted models (air-gapped studios,
on-premise hardware, etc.).

The LocalLLMClient speaks the OpenAI-compatible API format, which is supported
by all major local LLM runners:
  - Ollama (recommended)
  - vLLM
  - LM Studio
  - llama.cpp server
  - text-generation-webui (with openai extension)
  - LocalAI

Key features:
  - Full agentic tool loop (Bash, Read, Write, Edit, Glob, Grep)
  - Security hooks (bash command allowlist validation)
  - Streaming support
  - Message format compatible with existing session.py
  - No cloud dependencies — runs entirely on local hardware

Usage:
    from core.local_llm import LocalLLMClient, LocalLLMConfig

    config = LocalLLMConfig(
        base_url="http://localhost:11434/v1",
        model="qwen2.5-coder:32b",
    )
    client = LocalLLMClient(config=config, project_dir=project_dir)

    async with client:
        await client.query("Implement the feature described in spec.md")
        async for msg in client.receive_response():
            # Compatible with existing session.py message handling
            ...
"""

from .client import LocalLLMClient
from .config import LocalLLMConfig
from .messages import AssistantMessage, TextBlock, ThinkingBlock, ToolResultBlock, ToolUseBlock, UserMessage

__all__ = [
    "LocalLLMClient",
    "LocalLLMConfig",
    "AssistantMessage",
    "TextBlock",
    "ThinkingBlock",
    "ToolUseBlock",
    "ToolResultBlock",
    "UserMessage",
]
