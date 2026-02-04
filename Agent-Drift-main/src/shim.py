"""
Runtime shim for intercepting agent behavior.
Wraps agent execution at the process boundary.
"""

import os
import sys
import time
import uuid
import subprocess
import threading
import re
import json
from typing import Optional, List, Dict, Any, Callable
from pathlib import Path
from dataclasses import dataclass, field

from .models import (
    BehaviorTrace,
    ToolInvocation,
    FileAccess,
    NetworkCall,
    DecisionCycle,
)


# Patterns for detecting tool invocations in agent output
# These work with common agent frameworks (LangChain, OpenClaw, AutoGPT, etc.)
TOOL_PATTERNS = [
    # OpenClaw/Claude format
    r'<invoke name="([^"]+)"',
    r'<function_calls>.*?name="([^"]+)"',
    # LangChain format
    r'Action:\s*(\w+)',
    r'Tool:\s*(\w+)',
    r'> Entering new (\w+) chain',
    # Generic function call patterns
    r'Calling tool:\s*(\w+)',
    r'Invoking:\s*(\w+)',
    r'tool_call.*?"name":\s*"([^"]+)"',
    r'"function":\s*\{\s*"name":\s*"([^"]+)"',
    # AutoGPT format
    r'COMMAND:\s*(\w+)',
]

# Patterns for detecting decision cycles
CYCLE_PATTERNS = [
    r'Thought:',
    r'Reasoning:',
    r'Step \d+',
    r'Iteration \d+',
    r'---',  # Common separator
    r'^\s*$',  # Empty line (potential boundary)
]

# Patterns for detecting retries/self-corrections
RETRY_PATTERNS = [
    r'retry',
    r'trying again',
    r'correction',
    r'let me try',
    r'wait,',
    r'actually,',
    r'error.*trying',
    r'failed.*attempt',
]

# Network destination classification
DESTINATION_CLASSES = {
    'api': [r'api\.', r'/v\d/', r'graphql', r'rest'],
    'cdn': [r'cdn\.', r'static\.', r'assets\.', r'\.cloudfront\.', r'\.akamai\.'],
    'internal': [r'localhost', r'127\.0\.0\.1', r'192\.168\.', r'10\.', r'172\.(1[6-9]|2[0-9]|3[01])\.'],
    'external': [r'.*'],  # Fallback
}


class OutputCapture:
    """Captures stdout/stderr while passing through to real streams."""
    
    def __init__(self, real_stream, callback: Callable[[str], None]):
        self.real_stream = real_stream
        self.callback = callback
        self.lines: List[str] = []
        
    def write(self, data: str):
        self.real_stream.write(data)
        if data:
            self.callback(data)
            self.lines.extend(data.splitlines())
            
    def flush(self):
        self.real_stream.flush()
        
    @property
    def line_count(self) -> int:
        return len([l for l in self.lines if l.strip()])


class AgentShim:
    """
    Runtime wrapper that monitors agent behavior without modification.
    Operates at the process boundary - sees what the agent does, not why.
    """
    
    def __init__(
        self,
        storage_dir: Optional[str] = None,
        enable_network_monitoring: bool = True,
        enable_file_monitoring: bool = True,
    ):
        self.storage_dir = Path(storage_dir or os.environ.get(
            "AGENT_DRIFT_DIR", 
            os.path.expanduser("~/.agent-drift")
        ))
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        self.enable_network = enable_network_monitoring
        self.enable_file = enable_file_monitoring
        
        # Current trace being built
        self.current_trace: Optional[BehaviorTrace] = None
        
        # Compiled patterns
        self._tool_patterns = [re.compile(p, re.IGNORECASE) for p in TOOL_PATTERNS]
        self._cycle_patterns = [re.compile(p, re.IGNORECASE) for p in CYCLE_PATTERNS]
        self._retry_patterns = [re.compile(p, re.IGNORECASE) for p in RETRY_PATTERNS]
        
        # State tracking
        self._last_tool_time: float = 0
        self._current_cycle_id: int = 0
        self._cycle_tool_count: int = 0
        self._cycle_start_time: float = 0
        self._cycle_retries: int = 0
        self._cycle_corrections: int = 0
        
    def wrap_command(self, command: str, shell: bool = True) -> BehaviorTrace:
        """
        Wrap a command and capture behavioral trace.
        
        Args:
            command: The command to execute
            shell: Whether to use shell execution
            
        Returns:
            BehaviorTrace containing all captured behavior
        """
        run_id = str(uuid.uuid4())[:8]
        start_time = time.time()
        
        self.current_trace = BehaviorTrace(
            run_id=run_id,
            start_time=start_time,
            end_time=0,  # Will be set on completion
        )
        
        # Reset state
        self._last_tool_time = start_time
        self._current_cycle_id = 0
        self._cycle_tool_count = 0
        self._cycle_start_time = start_time
        self._cycle_retries = 0
        self._cycle_corrections = 0
        
        # Start a new cycle
        self._start_new_cycle()
        
        stdout_lines = []
        stderr_lines = []
        
        try:
            # Execute with output capture
            process = subprocess.Popen(
                command,
                shell=shell,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
            
            # Read output in threads
            def read_stdout():
                for line in process.stdout:
                    stdout_lines.append(line)
                    self._process_output_line(line, is_stderr=False)
                    sys.stdout.write(line)
                    sys.stdout.flush()
                    
            def read_stderr():
                for line in process.stderr:
                    stderr_lines.append(line)
                    self._process_output_line(line, is_stderr=True)
                    sys.stderr.write(line)
                    sys.stderr.flush()
            
            stdout_thread = threading.Thread(target=read_stdout)
            stderr_thread = threading.Thread(target=read_stderr)
            
            stdout_thread.start()
            stderr_thread.start()
            
            # Wait for completion
            process.wait()
            stdout_thread.join()
            stderr_thread.join()
            
            exit_code = process.returncode
            
        except Exception as e:
            # Capture the error but don't prevent trace completion
            stderr_lines.append(f"Shim error: {str(e)}")
            exit_code = -1
            
        # Finalize trace
        end_time = time.time()
        self._end_current_cycle(end_time)
        
        self.current_trace.end_time = end_time
        self.current_trace.stdout_line_count = len([l for l in stdout_lines if l.strip()])
        self.current_trace.stderr_line_count = len([l for l in stderr_lines if l.strip()])
        self.current_trace.exit_code = exit_code
        
        # Save trace
        self._save_trace(self.current_trace)
        
        return self.current_trace
    
    def _process_output_line(self, line: str, is_stderr: bool = False):
        """Process a single line of output for behavioral signals."""
        current_time = time.time()
        
        # Check for tool invocations
        for pattern in self._tool_patterns:
            match = pattern.search(line)
            if match:
                tool_name = match.group(1)
                duration = (current_time - self._last_tool_time) * 1000
                
                invocation = ToolInvocation(
                    tool_name=tool_name,
                    timestamp=current_time,
                    duration_ms=duration,
                    success=not is_stderr,
                    arg_count=self._count_args_in_line(line),
                    arg_types=self._extract_arg_types(line),
                )
                self.current_trace.tool_invocations.append(invocation)
                
                self._last_tool_time = current_time
                self._cycle_tool_count += 1
                break
        
        # Check for cycle boundaries
        for pattern in self._cycle_patterns:
            if pattern.search(line):
                self._end_current_cycle(current_time)
                self._start_new_cycle()
                break
        
        # Check for retries
        for pattern in self._retry_patterns:
            if pattern.search(line):
                self._cycle_retries += 1
                break
        
        # Check for self-corrections (heuristic: "actually", "wait", etc.)
        if re.search(r'\b(actually|wait|no,|correction)\b', line, re.IGNORECASE):
            self._cycle_corrections += 1
    
    def _start_new_cycle(self):
        """Start a new decision cycle."""
        self._current_cycle_id += 1
        self._cycle_start_time = time.time()
        self._cycle_tool_count = 0
        self._cycle_retries = 0
        self._cycle_corrections = 0
    
    def _end_current_cycle(self, end_time: float):
        """End the current decision cycle and record it."""
        if self._cycle_tool_count > 0 or self._cycle_retries > 0:
            cycle = DecisionCycle(
                cycle_id=self._current_cycle_id,
                start_time=self._cycle_start_time,
                end_time=end_time,
                tool_count=self._cycle_tool_count,
                retry_count=self._cycle_retries,
                self_corrections=self._cycle_corrections,
            )
            self.current_trace.decision_cycles.append(cycle)
    
    def _count_args_in_line(self, line: str) -> int:
        """Count apparent arguments in a tool call line (structural only)."""
        # Count parameter patterns
        param_count = len(re.findall(r'<parameter|":\s*["{[]|=', line))
        return param_count
    
    def _extract_arg_types(self, line: str) -> List[str]:
        """Extract argument types without values (structural only)."""
        types = []
        
        # Look for type hints
        if '"type"' in line:
            type_matches = re.findall(r'"type":\s*"(\w+)"', line)
            types.extend(type_matches)
        
        # Infer from structure
        if re.search(r'"\w+":\s*\[', line):
            types.append("array")
        if re.search(r'"\w+":\s*\{', line):
            types.append("object")
        if re.search(r'"\w+":\s*\d+', line):
            types.append("number")
        if re.search(r'"\w+":\s*"[^"]*"', line):
            types.append("string")
        if re.search(r'"\w+":\s*(true|false)', line):
            types.append("boolean")
            
        return list(set(types))
    
    def _save_trace(self, trace: BehaviorTrace):
        """Save trace to storage directory."""
        traces_dir = self.storage_dir / "traces"
        traces_dir.mkdir(exist_ok=True)
        
        trace_file = traces_dir / f"{trace.run_id}.json"
        with open(trace_file, "w") as f:
            json.dump(trace.to_dict(), f, indent=2)
    
    def add_file_access(self, path: str, operation: str, size_bytes: Optional[int] = None):
        """Manually record a file access event."""
        if self.current_trace and self.enable_file:
            access = FileAccess(
                path=self._sanitize_path(path),
                operation=operation,
                timestamp=time.time(),
                size_bytes=size_bytes,
            )
            self.current_trace.file_accesses.append(access)
    
    def add_network_call(
        self,
        destination: str,
        method: str,
        status_code: int,
        duration_ms: float,
    ):
        """Manually record a network call event."""
        if self.current_trace and self.enable_network:
            call = NetworkCall(
                destination_class=self._classify_destination(destination),
                method=method.upper(),
                timestamp=time.time(),
                duration_ms=duration_ms,
                status_class=self._classify_status(status_code),
            )
            self.current_trace.network_calls.append(call)
    
    def _sanitize_path(self, path: str) -> str:
        """Sanitize path to remove sensitive info but keep structure."""
        # Replace home directory with ~
        home = os.path.expanduser("~")
        if path.startswith(home):
            path = "~" + path[len(home):]
        
        # Keep directory structure but could hash filenames if needed
        return path
    
    def _classify_destination(self, destination: str) -> str:
        """Classify network destination without storing actual URL."""
        destination = destination.lower()
        
        for class_name, patterns in DESTINATION_CLASSES.items():
            for pattern in patterns:
                if re.search(pattern, destination):
                    return class_name
        
        return "unknown"
    
    def _classify_status(self, status_code: int) -> str:
        """Classify HTTP status code."""
        if status_code == 0:
            return "error"
        elif status_code < 0:
            return "timeout"
        elif 200 <= status_code < 300:
            return "2xx"
        elif 300 <= status_code < 400:
            return "3xx"
        elif 400 <= status_code < 500:
            return "4xx"
        elif 500 <= status_code < 600:
            return "5xx"
        else:
            return "unknown"
    
    def get_recent_traces(self, limit: int = 10) -> List[BehaviorTrace]:
        """Get recent traces from storage."""
        traces_dir = self.storage_dir / "traces"
        if not traces_dir.exists():
            return []
        
        trace_files = sorted(
            traces_dir.glob("*.json"),
            key=lambda f: f.stat().st_mtime,
            reverse=True,
        )[:limit]
        
        traces = []
        for trace_file in trace_files:
            with open(trace_file) as f:
                data = json.load(f)
                traces.append(BehaviorTrace.from_dict(data))
        
        return traces
