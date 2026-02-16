"""
Streaming log capture for agent sessions.
"""

from .ansi import strip_ansi_codes
from .logger import TaskLogger
from .models import LogPhase


class StreamingLogCapture:
    """
    Context manager to capture streaming output and log it.

    Usage:
        with StreamingLogCapture(logger, phase) as capture:
            # Run agent session
            async for msg in client.receive_response():
                capture.process_message(msg)
    """

    def __init__(self, logger: TaskLogger, phase: LogPhase | None = None):
        self.logger = logger
        self.phase = phase
        self.current_tool: str | None = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # End any active tool
        if self.current_tool:
            self.logger.tool_end(
                self.current_tool, success=exc_type is None, phase=self.phase
            )
            self.current_tool = None
        return False

    def process_text(self, text: str) -> None:
        """Process text output from the agent."""
        # Remove ANSI escape codes before logging
        sanitized_text = strip_ansi_codes(text)
        if sanitized_text.strip():
            self.logger.log(sanitized_text, phase=self.phase)

    def process_tool_start(self, tool_name: str, tool_input: str | None = None) -> None:
        """Process tool start."""
        # End previous tool if any
        if self.current_tool:
            self.logger.tool_end(self.current_tool, success=True, phase=self.phase)

        self.current_tool = tool_name
        self.logger.tool_start(tool_name, tool_input, phase=self.phase)

    def process_tool_end(
        self,
        tool_name: str,
        success: bool = True,
        result: str | None = None,
        detail: str | None = None,
    ) -> None:
        """Process tool end."""
        self.logger.tool_end(
            tool_name, success, result, detail=detail, phase=self.phase
        )
        if self.current_tool == tool_name:
            self.current_tool = None

    def process_message(
        self, msg, verbose: bool = False, capture_detail: bool = True
    ) -> None:
        """
        Process a message from the Claude SDK stream.

        Args:
            msg: Message from client.receive_response()
            verbose: Whether to show detailed tool results
            capture_detail: Whether to capture full tool output for expandable detail view
        """
        msg_type = type(msg).__name__

        if msg_type == "AssistantMessage" and hasattr(msg, "content"):
            for block in msg.content:
                block_type = type(block).__name__

                if block_type == "TextBlock" and hasattr(block, "text"):
                    # Text is already logged by the agent session
                    pass
                elif block_type == "ToolUseBlock" and hasattr(block, "name"):
                    tool_input = None
                    if hasattr(block, "input") and block.input:
                        inp = block.input
                        if isinstance(inp, dict):
                            # Extract meaningful input description
                            # Increased limits to avoid hiding critical information
                            if "pattern" in inp:
                                tool_input = f"pattern: {inp['pattern']}"
                            elif "file_path" in inp:
                                fp = inp["file_path"]
                                # Show last 200 chars for paths (enough for most file paths)
                                if len(fp) > 200:
                                    fp = "..." + fp[-197:]
                                tool_input = fp
                            elif "command" in inp:
                                cmd = inp["command"]
                                # Show first 300 chars for commands (enough for most commands)
                                if len(cmd) > 300:
                                    cmd = cmd[:297] + "..."
                                tool_input = cmd
                            elif "path" in inp:
                                tool_input = inp["path"]
                    self.process_tool_start(block.name, tool_input)

        elif msg_type == "UserMessage" and hasattr(msg, "content"):
            for block in msg.content:
                block_type = type(block).__name__

                if block_type == "ToolResultBlock":
                    is_error = getattr(block, "is_error", False)
                    result_content = getattr(block, "content", "")

                    if self.current_tool:
                        result_str = None
                        if verbose and result_content:
                            result_str = str(result_content)[:100]

                        # Capture full detail for expandable view
                        detail_content = None
                        if capture_detail and self.current_tool in (
                            "Read",
                            "Grep",
                            "Bash",
                            "Edit",
                            "Write",
                        ):
                            full_result = str(result_content)
                            if len(full_result) < 50000:  # 50KB max
                                detail_content = full_result

                        self.process_tool_end(
                            self.current_tool,
                            success=not is_error,
                            result=result_str,
                            detail=detail_content,
                        )
