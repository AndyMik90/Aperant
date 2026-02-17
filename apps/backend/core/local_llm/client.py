# Copyright (C) 2024-2026 Jerry Team
# SPDX-License-Identifier: AGPL-3.0-or-later

"""
Local LLM Client
=================

A complete agentic client for locally-hosted LLMs that implements the same
interface as the Claude Agent SDK's ClaudeSDKClient. Speaks the OpenAI-compatible
API format supported by Ollama, vLLM, LM Studio, llama.cpp, and others.

The client implements a full agentic tool loop:
  1. Send prompt + tool definitions to the local LLM
  2. Parse the response for tool calls
  3. Execute tools locally (Bash, Read, Write, Edit, Glob, Grep)
  4. Feed tool results back to the model
  5. Repeat until the model stops calling tools or max_turns is reached

This is the complete replacement for the Claude Agent SDK when running in
local-only mode. No cloud dependencies.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any, AsyncIterator

from .config import LocalLLMConfig
from .messages import (
    AssistantMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from .tools import ToolExecutor, get_tool_schemas, parse_prompt_tool_calls, TOOL_PROMPT_SECTION

logger = logging.getLogger(__name__)


class LocalLLMClient:
    """
    Agentic client for local LLMs with OpenAI-compatible API.

    Implements the same async context manager + query/receive_response interface
    as ClaudeSDKClient so it can be used as a drop-in replacement in session.py.

    Usage:
        config = LocalLLMConfig(model="qwen2.5-coder:32b")
        client = LocalLLMClient(config=config, project_dir=project_dir)

        async with client:
            await client.query("Implement the feature")
            async for msg in client.receive_response():
                # Process messages (same types as Claude SDK)
                ...
    """

    def __init__(
        self,
        config: LocalLLMConfig,
        project_dir: Path | None = None,
    ) -> None:
        self.config = config
        self.project_dir = (project_dir or config.project_dir or Path.cwd()).resolve()
        self.tool_executor = ToolExecutor(
            project_dir=self.project_dir,
            bash_security_hook=config.bash_security_hook,
        )

        # Conversation history (OpenAI format)
        self._messages: list[dict[str, Any]] = []

        # Pending query (set by query(), consumed by receive_response())
        self._pending_query: str | None = None

        # OpenAI client (initialized in __aenter__)
        self._openai_client: Any = None

        # Tool schemas for this session
        self._tool_schemas = get_tool_schemas(
            config.allowed_tools if config.allowed_tools else None
        )

    async def __aenter__(self) -> "LocalLLMClient":
        """Initialize the OpenAI-compatible HTTP client."""
        try:
            from openai import AsyncOpenAI
        except ImportError:
            raise ImportError(
                "The 'openai' package is required for local LLM support. "
                "Install it with: pip install openai"
            )

        self._openai_client = AsyncOpenAI(
            base_url=self.config.base_url,
            api_key=self.config.api_key,
            timeout=self.config.timeout,
        )

        # Initialize conversation with system prompt
        system_prompt = self.config.system_prompt
        if self.config.tool_calling_mode == "prompt":
            # For models without native tool calling, inject tool descriptions into prompt
            system_prompt = f"{system_prompt}\n\n{TOOL_PROMPT_SECTION}"

        self._messages = [{"role": "system", "content": system_prompt}]

        logger.info(
            f"LocalLLMClient initialized: model={self.config.model}, "
            f"base_url={self.config.base_url}, "
            f"tool_mode={self.config.tool_calling_mode}"
        )
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Clean up the HTTP client."""
        if self._openai_client:
            await self._openai_client.close()
            self._openai_client = None

    async def query(self, message: str) -> None:
        """
        Queue a message for processing.

        This mirrors ClaudeSDKClient.query() — it stores the message and
        the actual LLM interaction happens in receive_response().
        """
        self._pending_query = message

    async def receive_response(self) -> AsyncIterator[AssistantMessage | UserMessage]:
        """
        Run the agentic loop and yield messages as they are produced.

        This is the core of the local LLM client. It:
          1. Sends the pending query to the local LLM
          2. Parses the response for text and tool calls
          3. Executes tool calls locally
          4. Feeds results back and repeats
          5. Yields AssistantMessage and UserMessage objects compatible with session.py

        Yields:
            AssistantMessage (with TextBlock, ThinkingBlock, ToolUseBlock)
            UserMessage (with ToolResultBlock)
        """
        if self._pending_query is None:
            return

        # Add user message to conversation
        self._messages.append({"role": "user", "content": self._pending_query})
        self._pending_query = None

        turns = 0

        while turns < self.config.max_turns:
            turns += 1

            # Call the local LLM
            response = await self._call_llm()

            if response is None:
                # LLM call failed
                yield AssistantMessage(content=[
                    TextBlock(text="[Error: Failed to get response from local LLM]")
                ])
                return

            # Parse the response into blocks
            assistant_msg, tool_calls = self._parse_response(response)

            # Yield the assistant message (text + any tool use blocks)
            if assistant_msg.content:
                yield assistant_msg

            # If no tool calls, we're done
            if not tool_calls:
                return

            # Execute tool calls and collect results
            tool_results: list[ToolResultBlock] = []
            tool_messages_for_api: list[dict[str, Any]] = []

            for tool_call in tool_calls:
                tool_name = tool_call["name"]
                tool_args = tool_call["arguments"]
                tool_id = tool_call.get("id", f"call_{uuid.uuid4().hex[:8]}")

                logger.debug(f"Executing tool: {tool_name}({tool_args})")

                result_text, is_error = await self.tool_executor.execute(
                    tool_name, tool_args
                )

                tool_results.append(ToolResultBlock(
                    content=result_text,
                    is_error=is_error,
                    tool_use_id=tool_id,
                ))

                # Build API-format tool result for conversation history
                tool_messages_for_api.append({
                    "role": "tool",
                    "tool_call_id": tool_id,
                    "content": result_text,
                })

            # Yield tool results as UserMessage
            yield UserMessage(content=tool_results)

            # Add assistant response and tool results to conversation history
            if self.config.tool_calling_mode == "native":
                # For native tool calling, add the full assistant message with tool_calls
                self._messages.append(response.choices[0].message.model_dump())
                # Add tool results
                self._messages.extend(tool_messages_for_api)
            else:
                # For prompt-based, add the raw text response and results as user message
                raw_text = response.choices[0].message.content or ""
                self._messages.append({"role": "assistant", "content": raw_text})

                # Format tool results as user message
                result_parts = []
                for tc, tr in zip(tool_calls, tool_results):
                    error_attr = 'error="true" ' if tr.is_error else ""
                    part = f'<tool_result name="{tc["name"]}" {error_attr}>\n{tr.content}\n</tool_result>'
                    result_parts.append(part)
                results_text = "\n\n".join(result_parts)
                self._messages.append({"role": "user", "content": results_text})

        # Hit max turns
        yield AssistantMessage(content=[
            TextBlock(text=f"\n[Reached maximum of {self.config.max_turns} tool-use turns]")
        ])

    async def _call_llm(self) -> Any:
        """
        Make a single call to the local LLM API.

        Returns the raw OpenAI-format response, or None on error.
        """
        if not self._openai_client:
            logger.error("OpenAI client not initialized. Use 'async with' context manager.")
            return None

        try:
            kwargs: dict[str, Any] = {
                "model": self.config.model,
                "messages": self._messages,
                "temperature": self.config.temperature,
                "max_tokens": self.config.max_tokens,
            }

            # Add tool schemas for native tool calling
            if self.config.tool_calling_mode == "native" and self._tool_schemas:
                kwargs["tools"] = self._tool_schemas
                kwargs["tool_choice"] = "auto"

            response = await self._openai_client.chat.completions.create(**kwargs)
            return response

        except Exception as e:
            logger.error(f"LLM API call failed: {type(e).__name__}: {e}")
            return None

    def _parse_response(
        self, response: Any
    ) -> tuple[AssistantMessage, list[dict[str, Any]]]:
        """
        Parse an OpenAI-format response into our message types.

        Returns:
            Tuple of (AssistantMessage, list_of_tool_calls)
        """
        choice = response.choices[0]
        message = choice.message
        blocks: list[TextBlock | ThinkingBlock | ToolUseBlock] = []
        tool_calls: list[dict[str, Any]] = []

        if self.config.tool_calling_mode == "native":
            # Native tool calling: text content + tool_calls field
            if message.content:
                # Check for thinking/reasoning content
                # Some models (DeepSeek-R1) emit <think>...</think> blocks
                text = message.content
                thinking_match = None

                # Try to extract thinking blocks
                import re
                thinking_pattern = r"<think>(.*?)</think>"
                thinking_matches = re.findall(thinking_pattern, text, re.DOTALL)
                if thinking_matches:
                    for think_text in thinking_matches:
                        blocks.append(ThinkingBlock(thinking=think_text.strip()))
                    # Remove thinking blocks from visible text
                    text = re.sub(thinking_pattern, "", text, flags=re.DOTALL).strip()

                if text:
                    blocks.append(TextBlock(text=text))

            if message.tool_calls:
                for tc in message.tool_calls:
                    tool_id = tc.id
                    tool_name = tc.function.name
                    try:
                        tool_args = json.loads(tc.function.arguments)
                    except json.JSONDecodeError:
                        tool_args = {"raw": tc.function.arguments}

                    blocks.append(ToolUseBlock(
                        name=tool_name,
                        id=tool_id,
                        input=tool_args,
                    ))
                    tool_calls.append({
                        "name": tool_name,
                        "arguments": tool_args,
                        "id": tool_id,
                    })

        else:
            # Prompt-based tool calling: parse XML tags from text
            text = message.content or ""

            # Check for thinking blocks
            import re
            thinking_pattern = r"<think>(.*?)</think>"
            thinking_matches = re.findall(thinking_pattern, text, re.DOTALL)
            if thinking_matches:
                for think_text in thinking_matches:
                    blocks.append(ThinkingBlock(thinking=think_text.strip()))
                text = re.sub(thinking_pattern, "", text, flags=re.DOTALL)

            # Parse tool calls from text
            parsed_calls = parse_prompt_tool_calls(text)

            if parsed_calls:
                # Remove tool_call blocks from visible text
                clean_text = re.sub(
                    r"<tool_call>.*?</tool_call>", "", text, flags=re.DOTALL
                ).strip()
                if clean_text:
                    blocks.append(TextBlock(text=clean_text))

                for tc in parsed_calls:
                    tool_id = f"call_{uuid.uuid4().hex[:8]}"
                    blocks.append(ToolUseBlock(
                        name=tc["name"],
                        id=tool_id,
                        input=tc["arguments"],
                    ))
                    tool_calls.append({
                        "name": tc["name"],
                        "arguments": tc["arguments"],
                        "id": tool_id,
                    })
            else:
                # No tool calls, just text
                if text.strip():
                    blocks.append(TextBlock(text=text.strip()))

        return AssistantMessage(content=blocks), tool_calls
