"""
Codex CLI Client Adapter
========================

Bridges the Codex CLI JSON event stream into the minimal message contract used
throughout the backend's Claude-oriented session loops.

This lets the existing planner/coder/QA orchestration keep working with
`query()` + `receive_response()` while the underlying provider is OpenAI/Codex.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from core.platform import build_windows_command, requires_shell

logger = logging.getLogger(__name__)


@dataclass
class TextBlock:
    text: str


@dataclass
class ToolUseBlock:
    name: str
    input: dict[str, Any]
    id: str | None = None


@dataclass
class ToolResultBlock:
    content: str
    is_error: bool = False
    tool_use_id: str | None = None


@dataclass
class AssistantMessage:
    content: list[Any]


@dataclass
class UserMessage:
    content: list[Any]


@dataclass
class ResultMessage:
    structured_output: dict[str, Any] | None = None
    subtype: str | None = None


def resolve_codex_model(model: str) -> str:
    """
    Translate Claude-family shorthand/full IDs into the OpenAI runtime equivalents
    requested by the frontend mapping.
    """
    normalized = (model or "").strip()
    model_lower = normalized.lower()

    if not normalized:
        return "gpt-5.3-codex"

    if model_lower in {"haiku", "gpt-5.4-mini"}:
        return "gpt-5.4-mini"
    if model_lower in {"sonnet", "default", "gpt-5.3-codex"}:
        return "gpt-5.3-codex"
    if model_lower in {"opus", "opus-1m", "opus-4.5", "gpt-5.4"}:
        return "gpt-5.4"

    if model_lower.startswith("claude-haiku") or "haiku" in model_lower:
        return "gpt-5.4-mini"
    if model_lower.startswith("claude-sonnet") or "sonnet" in model_lower:
        return "gpt-5.3-codex"
    if model_lower.startswith("claude-opus") or "opus" in model_lower:
        return "gpt-5.4"

    return normalized


class CodexCLIClient:
    """
    Minimal async client wrapper around `codex exec --json`.

    The backend only relies on a narrow SDK-like surface:
    - async context manager support
    - `await client.query(prompt)`
    - `async for message in client.receive_response()`
    """

    def __init__(
        self,
        *,
        project_dir: Path,
        spec_dir: Path | None = None,
        model: str,
        system_prompt: str | None = None,
        output_format: dict[str, Any] | None = None,
        cwd: str | Path | None = None,
        reasoning_effort: str | None = None,
    ) -> None:
        self.project_dir = Path(project_dir).resolve()
        self.spec_dir = Path(spec_dir).resolve() if spec_dir else None
        self.cwd = Path(cwd).resolve() if cwd else self.project_dir
        self.model = resolve_codex_model(model)
        self.system_prompt = (system_prompt or "").strip()
        self.output_format = output_format
        self.reasoning_effort = (reasoning_effort or "").strip() or None
        self._pending_prompt: str | None = None

    async def __aenter__(self) -> "CodexCLIClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    async def query(self, message: str) -> None:
        self._pending_prompt = message

    def _build_prompt(self, user_prompt: str) -> str:
        sections: list[str] = []

        if self.system_prompt:
            sections.append(f"# System Instructions\n\n{self.system_prompt}")

        sections.append(f"# User Task\n\n{user_prompt.strip()}")

        sections.append(
            "# Execution Notes\n\n"
            f"- Work inside this repository: {self.project_dir}\n"
            "- Finish the requested task end-to-end.\n"
            "- Use shell/file operations directly when needed.\n"
            "- Keep your final answer concise."
        )

        if self.output_format:
            sections.append(
                "# Final Response Format\n\n"
                "Return the final response as valid JSON matching this schema:\n\n"
                f"{json.dumps(self.output_format, indent=2)}"
            )

        return "\n\n---\n\n".join(sections)

    def _build_command(self) -> list[str]:
        cli_path = os.environ.get("APERANT_CODEX_CLI_PATH", "codex").strip().strip('"')
        if not cli_path:
            raise RuntimeError(
                "OpenAI Codex CLI path is not configured. Please sign in to Codex and try again."
            )

        args = [
            "--dangerously-bypass-approvals-and-sandbox",
            "exec",
            "--ephemeral",
            "--json",
            "--skip-git-repo-check",
            "-C",
            str(self.cwd),
            "-m",
            self.model,
            "-",
        ]
        if self.reasoning_effort:
            args.extend(["-c", f"model_reasoning_effort={self.reasoning_effort}"])

        return build_windows_command(cli_path, args)

    async def _drain_stderr(
        self, stream: asyncio.StreamReader | None, sink: list[str]
    ) -> None:
        if stream is None:
            return

        while True:
            raw_line = await stream.readline()
            if not raw_line:
                break

            decoded = raw_line.decode("utf-8", errors="replace").rstrip()
            if decoded:
                sink.append(decoded)

    def _summarize_failure(
        self,
        stderr_lines: list[str],
        stdout_noise: list[str],
        assistant_texts: list[str],
    ) -> str:
        meaningful_lines = [
            line
            for line in stderr_lines
            if line
            and "<html>" not in line.lower()
            and "plugins::manifest" not in line
            and "failed to warm featured plugin ids cache" not in line
            and "startup remote plugin sync failed" not in line
            and "shell snapshot not supported yet for powershell" not in line.lower()
        ]

        for line in meaningful_lines:
            lowered = line.lower()
            if any(
                pattern in lowered
                for pattern in (
                    "not logged in",
                    "login",
                    "missing_codex_entitlement",
                    "token_invalidated",
                    "refresh_token_expired",
                    "unauthorized",
                    "forbidden",
                    "auth",
                )
            ):
                return line

        if meaningful_lines:
            return "\n".join(meaningful_lines[-5:])

        if stdout_noise:
            return "\n".join(stdout_noise[-5:])

        if assistant_texts:
            return assistant_texts[-1][:500]

        return "Codex CLI exited without a usable error message."

    async def receive_response(self):
        if self._pending_prompt is None:
            raise RuntimeError("No pending prompt. Call query() before receive_response().")

        prompt = self._build_prompt(self._pending_prompt)
        self._pending_prompt = None

        command_parts = self._build_command()
        cli_path = os.environ.get("APERANT_CODEX_CLI_PATH", "codex").strip().strip('"')
        logger.info(
            "Starting Codex CLI session with model %s in %s (cli=%s, shell_wrap=%s, reasoning_effort=%s, provider_account=%s)",
            self.model,
            self.cwd,
            cli_path,
            requires_shell(cli_path),
            self.reasoning_effort or "(default)",
            os.environ.get("APERANT_PROVIDER_ACCOUNT_ID", "(unknown)"),
        )

        try:
            process = await asyncio.create_subprocess_exec(
                *command_parts,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=os.environ.copy(),
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                f"OpenAI Codex CLI was not found or is not runnable: {cli_path}"
            ) from exc
        except OSError as exc:
            raise RuntimeError(
                f"OpenAI Codex CLI could not be started: {exc}"
            ) from exc

        if process.stdin:
            process.stdin.write(prompt.encode("utf-8"))
            await process.stdin.drain()
            process.stdin.close()

        stderr_lines: list[str] = []
        stdout_noise: list[str] = []
        assistant_texts: list[str] = []
        last_text_message: str | None = None

        stderr_task = asyncio.create_task(self._drain_stderr(process.stderr, stderr_lines))

        try:
            if process.stdout is None:
                raise RuntimeError("Codex CLI did not expose stdout.")

            while True:
                raw_line = await process.stdout.readline()
                if not raw_line:
                    break

                decoded = raw_line.decode("utf-8", errors="replace").strip()
                if not decoded:
                    continue

                try:
                    event = json.loads(decoded)
                except json.JSONDecodeError:
                    stdout_noise.append(decoded)
                    continue

                event_type = event.get("type")
                item = event.get("item") or {}
                item_type = item.get("type")

                if event_type == "item.completed" and item_type == "agent_message":
                    text = str(item.get("text") or "").strip()
                    if text:
                        assistant_texts.append(text)
                        last_text_message = text
                        yield AssistantMessage(content=[TextBlock(text=text)])
                    continue

                if event_type == "item.started" and item_type == "command_execution":
                    command_text = str(item.get("command") or "").strip()
                    yield AssistantMessage(
                        content=[
                            ToolUseBlock(
                                name="Bash",
                                input={"command": command_text},
                                id=item.get("id"),
                            )
                        ]
                    )
                    continue

                if event_type == "item.completed" and item_type == "command_execution":
                    output = str(item.get("aggregated_output") or "")
                    exit_code = item.get("exit_code")
                    is_error = isinstance(exit_code, int) and exit_code != 0
                    yield UserMessage(
                        content=[
                            ToolResultBlock(
                                content=output,
                                is_error=is_error,
                                tool_use_id=item.get("id"),
                            )
                        ]
                    )
                    continue

            return_code = await process.wait()
            await stderr_task

            if return_code != 0:
                error_message = self._summarize_failure(
                    stderr_lines, stdout_noise, assistant_texts
                )
                raise RuntimeError(error_message)

            if self.output_format and last_text_message:
                try:
                    structured_output = json.loads(last_text_message)
                except json.JSONDecodeError:
                    logger.debug(
                        "Codex final message was not valid JSON for structured output parsing."
                    )
                else:
                    yield ResultMessage(structured_output=structured_output)
        finally:
            if not stderr_task.done():
                stderr_task.cancel()
                try:
                    await stderr_task
                except asyncio.CancelledError:
                    pass
