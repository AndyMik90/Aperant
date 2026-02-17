# Copyright (C) 2024-2026 Jerry Team
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Message Types for Local LLM Client
===================================

Dataclass-based message types that are compatible with the Claude Agent SDK's
message format. The existing session.py checks `type(msg).__name__` and
`hasattr(msg, ...)`, so these classes must match those contracts exactly.

SDK Message Contract (from session.py):
  - AssistantMessage: has `.content` list of blocks
    - TextBlock: has `.text`
    - ThinkingBlock: has `.thinking`, optional `.signature`
    - ToolUseBlock: has `.name`, `.id`, `.input`
  - UserMessage: has `.content` list of blocks
    - ToolResultBlock: has `.content`, `.is_error`, `.tool_use_id`
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class TextBlock:
    """A block of text output from the assistant."""
    text: str


@dataclass
class ThinkingBlock:
    """A thinking/reasoning block (for models that support chain-of-thought)."""
    thinking: str
    signature: str = ""


@dataclass
class ToolUseBlock:
    """A tool invocation request from the assistant."""
    name: str
    id: str
    input: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolResultBlock:
    """Result of a tool execution."""
    content: str
    is_error: bool = False
    tool_use_id: str = ""


@dataclass
class AssistantMessage:
    """Message from the assistant containing text, thinking, and/or tool use blocks."""
    content: list[TextBlock | ThinkingBlock | ToolUseBlock] = field(default_factory=list)


@dataclass
class UserMessage:
    """Message from the user / tool results fed back to the model."""
    content: list[ToolResultBlock] = field(default_factory=list)
