"""
Agent Runner
============

Handles the execution of AI agents for the spec creation pipeline.
"""

from pathlib import Path

# Configure safe encoding before any output (fixes Windows encoding errors)
from ui.capabilities import configure_safe_encoding

configure_safe_encoding()

from debug import debug, debug_detailed, debug_error, debug_section, debug_success
from security.tool_input_validator import get_safe_tool_input
from task_logger import (
    LogEntryType,
    LogPhase,
    TaskLogger,
)

# Lazy import create_client to avoid circular import with core.client
# The import chain: spec.pipeline -> agent_runner -> core.client -> agents.tools_pkg -> spec.validate_pkg
# By deferring the import, we break the circular dependency.


class FileReadCache:
    """
    Session-level cache tracking which files have been read.

    This prevents agents from redundantly re-reading the same files multiple times
    during a planning session, improving efficiency.
    """

    def __init__(self):
        self.read_files: set[str] = set()
        self.read_count: dict[str, int] = {}  # Track how many times each file was read

    def track_read(self, file_path: str) -> bool:
        """
        Track a file read and return whether it was already read.

        Args:
            file_path: Path to the file being read

        Returns:
            True if this is a duplicate read, False if first read
        """
        # Normalize path for consistent tracking
        normalized = str(Path(file_path).resolve())
        is_duplicate = normalized in self.read_files
        self.read_files.add(normalized)
        self.read_count[normalized] = self.read_count.get(normalized, 0) + 1
        return is_duplicate

    def get_read_files_context(self) -> str:
        """
        Generate context string listing already-read files.

        Returns:
            Markdown-formatted list of files already read in this session
        """
        if not self.read_files:
            return ""

        duplicates = [f for f, count in self.read_count.items() if count > 1]
        if duplicates:
            lines = ["## Files Already Read (from cache)"]
            lines.append("The following files have already been read in this session.")
            lines.append("You can reference their contents without re-reading:\n")
            for f in sorted(self.read_files):
                count = self.read_count[f]
                if count > 1:
                    lines.append(f"- `{f}` (read {count}x - use cached content)")
                else:
                    lines.append(f"- `{f}`")
            return "\n".join(lines)
        return ""

    def get_stats(self) -> dict:
        """Get cache statistics."""
        total_reads = sum(self.read_count.values())
        unique_files = len(self.read_files)
        duplicate_reads = total_reads - unique_files
        return {
            "total_reads": total_reads,
            "unique_files": unique_files,
            "duplicate_reads": duplicate_reads,
            "cache_hit_rate": duplicate_reads / total_reads if total_reads > 0 else 0,
        }


class AgentRunner:
    """Manages agent execution with logging and error handling."""

    def __init__(
        self,
        project_dir: Path,
        spec_dir: Path,
        model: str,
        task_logger: TaskLogger | None = None,
    ):
        """Initialize the agent runner.

        Args:
            project_dir: The project root directory
            spec_dir: The spec directory
            model: The model to use for agent execution
            task_logger: Optional task logger for tracking progress
        """
        self.project_dir = project_dir
        self.spec_dir = spec_dir
        self.model = model
        self.task_logger = task_logger
        # Session-level file read cache to prevent duplicate reads
        self.file_cache = FileReadCache()

    async def run_agent(
        self,
        prompt_file: str,
        additional_context: str = "",
        interactive: bool = False,
        thinking_budget: int | None = None,
        prior_phase_summaries: str | None = None,
    ) -> tuple[bool, str]:
        """Run an agent with the given prompt.

        Args:
            prompt_file: The prompt file to use (relative to prompts directory)
            additional_context: Additional context to add to the prompt
            interactive: Whether to run in interactive mode
            thinking_budget: Token budget for extended thinking (None = disabled)
            prior_phase_summaries: Summaries from previous phases for context

        Returns:
            Tuple of (success, response_text)
        """
        debug_section("agent_runner", f"Spec Agent - {prompt_file}")
        debug(
            "agent_runner",
            "Running spec creation agent",
            prompt_file=prompt_file,
            spec_dir=str(self.spec_dir),
            model=self.model,
            interactive=interactive,
        )

        prompt_path = Path(__file__).parent.parent.parent / "prompts" / prompt_file

        if not prompt_path.exists():
            debug_error("agent_runner", f"Prompt file not found: {prompt_path}")
            return False, f"Prompt not found: {prompt_path}"

        # Load prompt
        prompt = prompt_path.read_text()
        debug_detailed(
            "agent_runner",
            "Loaded prompt file",
            prompt_length=len(prompt),
        )

        # Add context
        prompt += f"\n\n---\n\n**Spec Directory**: {self.spec_dir}\n"
        prompt += f"**Project Directory**: {self.project_dir}\n"

        # Add summaries from previous phases (compaction)
        if prior_phase_summaries:
            prompt += f"\n{prior_phase_summaries}\n"
            debug_detailed(
                "agent_runner",
                "Added prior phase summaries",
                summaries_length=len(prior_phase_summaries),
            )

        if additional_context:
            prompt += f"\n{additional_context}\n"
            debug_detailed(
                "agent_runner",
                "Added additional context",
                context_length=len(additional_context),
            )

        # Add file cache context to prevent duplicate reads
        cache_context = self.file_cache.get_read_files_context()
        if cache_context:
            prompt += f"\n{cache_context}\n"
            debug_detailed(
                "agent_runner",
                "Added file cache context",
                cached_files=len(self.file_cache.read_files),
            )

        # Create client with thinking budget
        debug(
            "agent_runner",
            "Creating Claude SDK client...",
            thinking_budget=thinking_budget,
        )
        # Lazy import to avoid circular import with core.client
        from core.client import create_client

        client = create_client(
            self.project_dir,
            self.spec_dir,
            self.model,
            max_thinking_tokens=thinking_budget,
        )

        current_tool = None
        message_count = 0
        tool_count = 0

        try:
            async with client:
                debug("agent_runner", "Sending query to Claude SDK...")
                await client.query(prompt)
                debug_success("agent_runner", "Query sent successfully")

                response_text = ""
                debug("agent_runner", "Starting to receive response stream...")
                async for msg in client.receive_response():
                    msg_type = type(msg).__name__
                    message_count += 1
                    debug_detailed(
                        "agent_runner",
                        f"Received message #{message_count}",
                        msg_type=msg_type,
                    )

                    if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                        for block in msg.content:
                            block_type = type(block).__name__
                            if block_type == "TextBlock" and hasattr(block, "text"):
                                response_text += block.text
                                print(block.text, end="", flush=True)
                                if self.task_logger and block.text.strip():
                                    self.task_logger.log(
                                        block.text,
                                        LogEntryType.TEXT,
                                        LogPhase.PLANNING,
                                        print_to_console=False,
                                    )
                            elif block_type == "ToolUseBlock" and hasattr(
                                block, "name"
                            ):
                                tool_name = block.name
                                tool_count += 1

                                # Safely extract tool input (handles None, non-dict, etc.)
                                inp = get_safe_tool_input(block)
                                tool_input_display = self._extract_tool_input_display(
                                    inp
                                )

                                debug(
                                    "agent_runner",
                                    f"Tool call #{tool_count}: {tool_name}",
                                    tool_input=tool_input_display,
                                )

                                # Track file reads for caching
                                if tool_name == "Read" and isinstance(inp, dict):
                                    file_path = inp.get("file_path", "")
                                    if file_path:
                                        is_duplicate = self.file_cache.track_read(
                                            file_path
                                        )
                                        if is_duplicate:
                                            debug(
                                                "agent_runner",
                                                f"Cache HIT: {file_path} already read",
                                            )

                                if self.task_logger:
                                    self.task_logger.tool_start(
                                        tool_name,
                                        tool_input_display,
                                        LogPhase.PLANNING,
                                        print_to_console=True,
                                    )
                                else:
                                    print(f"\n[Tool: {tool_name}]", flush=True)
                                current_tool = tool_name

                    elif msg_type == "UserMessage" and hasattr(msg, "content"):
                        for block in msg.content:
                            block_type = type(block).__name__
                            if block_type == "ToolResultBlock":
                                is_error = getattr(block, "is_error", False)
                                result_content = getattr(block, "content", "")
                                if is_error:
                                    debug_error(
                                        "agent_runner",
                                        f"Tool error: {current_tool}",
                                        error=str(result_content)[:200],
                                    )
                                else:
                                    debug_detailed(
                                        "agent_runner",
                                        f"Tool success: {current_tool}",
                                        result_length=len(str(result_content)),
                                    )
                                if self.task_logger and current_tool:
                                    detail_content = self._get_tool_detail_content(
                                        current_tool, result_content
                                    )
                                    self.task_logger.tool_end(
                                        current_tool,
                                        success=not is_error,
                                        detail=detail_content,
                                        phase=LogPhase.PLANNING,
                                    )
                                current_tool = None

                print()

                # Log file cache statistics
                cache_stats = self.file_cache.get_stats()
                if cache_stats["total_reads"] > 0:
                    debug(
                        "agent_runner",
                        "File cache stats",
                        total_reads=cache_stats["total_reads"],
                        unique_files=cache_stats["unique_files"],
                        duplicate_reads=cache_stats["duplicate_reads"],
                        cache_hit_rate=f"{cache_stats['cache_hit_rate']:.1%}",
                    )

                debug_success(
                    "agent_runner",
                    "Agent session completed successfully",
                    message_count=message_count,
                    tool_count=tool_count,
                    response_length=len(response_text),
                )
                return True, response_text

        except Exception as e:
            debug_error(
                "agent_runner",
                f"Agent session error: {e}",
                exception_type=type(e).__name__,
            )
            if self.task_logger:
                self.task_logger.log_error(f"Agent error: {e}", LogPhase.PLANNING)
            return False, str(e)

    @staticmethod
    def _extract_tool_input_display(inp: dict) -> str | None:
        """Extract meaningful tool input for display.

        Args:
            inp: The tool input dictionary

        Returns:
            A formatted string for display, or None
        """
        if not isinstance(inp, dict):
            return None

        if "pattern" in inp:
            return f"pattern: {inp['pattern']}"
        elif "file_path" in inp:
            fp = inp["file_path"]
            if len(fp) > 50:
                fp = "..." + fp[-47:]
            return fp
        elif "command" in inp:
            cmd = inp["command"]
            if len(cmd) > 50:
                cmd = cmd[:47] + "..."
            return cmd
        elif "path" in inp:
            return inp["path"]

        return None

    @staticmethod
    def _get_tool_detail_content(tool_name: str, result_content: str) -> str | None:
        """Get detail content for specific tools.

        Args:
            tool_name: The name of the tool
            result_content: The result content from the tool

        Returns:
            Detail content if relevant, otherwise None
        """
        if tool_name not in ("Read", "Grep", "Bash", "Edit", "Write"):
            return None

        result_str = str(result_content)
        if len(result_str) < 50000:
            return result_str

        return None
