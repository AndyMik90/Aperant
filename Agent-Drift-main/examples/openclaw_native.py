"""
Native OpenClaw Integration for Agent Drift Detector.

This module provides direct integration with OpenClaw's message loop,
tracking tool_use blocks from API responses rather than parsing stdout.

Usage:
    from agent_drift_detector.examples.openclaw_native import OpenClawDriftMonitor
    
    monitor = OpenClawDriftMonitor()
    monitor.start_session()
    
    # In your message loop:
    for content_block in response.content:
        if content_block.type == "tool_use":
            monitor.track_tool_call(
                tool_name=content_block.name,
                tool_id=content_block.id,
            )
    
    # After tool execution:
    monitor.track_tool_result(
        tool_id=content_block.id,
        success=True,
        duration_ms=elapsed_ms,
    )
    
    # When stop_reason == "tool_use":
    monitor.end_turn()
    
    # When conversation ends:
    report = monitor.end_session()
"""

import os
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List, Any
from dataclasses import dataclass, field

# Import from parent package
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.models import (
    BehaviorTrace, ToolInvocation, FileAccess, NetworkCall, DecisionCycle, DriftReport
)
from src.baseline import BaselineManager
from src.detector import DriftDetector
from src.canary import CanaryInjector


@dataclass
class PendingToolCall:
    """A tool call that has been started but not yet completed."""
    tool_name: str
    tool_id: str
    start_time: float


class OpenClawDriftMonitor:
    """
    Native drift monitor for OpenClaw integration.
    
    Tracks tool calls directly from API response structures instead of
    parsing stdout with regex. More reliable and efficient.
    
    Thread-safe for use in async contexts.
    """
    
    def __init__(
        self,
        storage_dir: Optional[str] = None,
        alert_threshold: float = 0.5,
        enable_canaries: bool = False,
        canary_interval: float = 300.0,  # 5 minutes
    ):
        """
        Initialize the drift monitor.
        
        Args:
            storage_dir: Directory for baseline storage (default: ~/.agent-drift)
            alert_threshold: Drift score threshold for alerts
            enable_canaries: Whether to run background canary tasks
            canary_interval: Interval between canary runs (seconds)
        """
        self.storage_dir = Path(storage_dir or os.environ.get(
            "AGENT_DRIFT_DIR",
            os.path.expanduser("~/.agent-drift")
        ))
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize components
        self.baseline_manager = BaselineManager(str(self.storage_dir))
        self.detector = DriftDetector(
            baseline_manager=self.baseline_manager,
            alert_threshold=alert_threshold,
        )
        
        # Canary injection (optional)
        self.enable_canaries = enable_canaries
        self.canary_injector: Optional[CanaryInjector] = None
        if enable_canaries:
            self.canary_injector = CanaryInjector(
                storage_dir=str(self.storage_dir),
                interval_seconds=canary_interval,
            )
        
        # Session state
        self._current_trace: Optional[BehaviorTrace] = None
        self._pending_tools: Dict[str, PendingToolCall] = {}
        self._current_cycle_id: int = 0
        self._cycle_start_time: float = 0
        self._cycle_tool_count: int = 0
        self._cycle_retries: int = 0
        self._cycle_corrections: int = 0
        
        # Callbacks
        self._alert_callback: Optional[callable] = None
    
    def set_alert_callback(self, callback: callable):
        """
        Set a callback function for drift alerts.
        
        The callback receives (report: DriftReport) when drift exceeds threshold.
        """
        self._alert_callback = callback
    
    def start_session(self, session_id: Optional[str] = None) -> str:
        """
        Start a new monitoring session.
        
        Call this at the beginning of an agent conversation/task.
        
        Args:
            session_id: Optional custom session ID
            
        Returns:
            The session ID (run_id)
        """
        run_id = session_id or f"oc-{uuid.uuid4().hex[:8]}"
        start_time = time.time()
        
        self._current_trace = BehaviorTrace(
            run_id=run_id,
            start_time=start_time,
            end_time=0,  # Set on end_session
        )
        
        self._pending_tools = {}
        self._current_cycle_id = 0
        self._cycle_start_time = start_time
        self._cycle_tool_count = 0
        self._cycle_retries = 0
        self._cycle_corrections = 0
        
        # Start background canaries if enabled
        if self.canary_injector:
            self.canary_injector.start_background_canaries(
                callback=self._on_canary_alert
            )
        
        return run_id
    
    def track_tool_call(
        self,
        tool_name: str,
        tool_id: str,
        arg_count: int = 0,
        arg_types: Optional[List[str]] = None,
    ):
        """
        Track a tool call from the API response.
        
        Call this when you encounter a tool_use content block.
        
        Args:
            tool_name: Name of the tool being called
            tool_id: Unique ID of this tool call (from API)
            arg_count: Number of arguments (optional)
            arg_types: Types of arguments (optional)
        """
        if not self._current_trace:
            raise RuntimeError("No active session. Call start_session() first.")
        
        # Record pending call
        self._pending_tools[tool_id] = PendingToolCall(
            tool_name=tool_name,
            tool_id=tool_id,
            start_time=time.time(),
        )
        
        self._cycle_tool_count += 1
    
    def track_tool_result(
        self,
        tool_id: str,
        success: bool = True,
        duration_ms: Optional[float] = None,
        is_retry: bool = False,
        is_correction: bool = False,
    ):
        """
        Track the completion of a tool call.
        
        Call this when you receive the result of a tool execution.
        
        Args:
            tool_id: The tool_id from the original call
            success: Whether the tool succeeded
            duration_ms: Execution time (auto-calculated if not provided)
            is_retry: Whether this was a retry of a previous call
            is_correction: Whether the agent corrected itself
        """
        if not self._current_trace:
            raise RuntimeError("No active session. Call start_session() first.")
        
        pending = self._pending_tools.pop(tool_id, None)
        
        if pending is None:
            # Tool result without matching call - might be from a different source
            return
        
        # Calculate duration
        if duration_ms is None:
            duration_ms = (time.time() - pending.start_time) * 1000
        
        # Create invocation record
        invocation = ToolInvocation(
            tool_name=pending.tool_name,
            timestamp=pending.start_time,
            duration_ms=duration_ms,
            success=success,
            arg_count=0,
            arg_types=[],
        )
        
        self._current_trace.tool_invocations.append(invocation)
        
        # Track retries and corrections
        if is_retry:
            self._cycle_retries += 1
        if is_correction:
            self._cycle_corrections += 1
    
    def track_file_access(
        self,
        path: str,
        operation: str,  # 'read', 'write', 'delete', 'create'
        size_bytes: Optional[int] = None,
    ):
        """
        Track a file access event.
        
        Call this when tools access the filesystem.
        """
        if not self._current_trace:
            return
        
        # Sanitize path (remove home directory for privacy)
        home = os.path.expanduser("~")
        if path.startswith(home):
            path = "~" + path[len(home):]
        
        self._current_trace.file_accesses.append(
            FileAccess(
                path=path,
                operation=operation,
                timestamp=time.time(),
                size_bytes=size_bytes,
            )
        )
    
    def track_network_call(
        self,
        destination_class: str,  # 'api', 'cdn', 'internal', 'external'
        method: str,  # 'GET', 'POST', etc.
        status_class: str,  # '2xx', '4xx', '5xx', 'error'
        duration_ms: float,
    ):
        """
        Track a network call event.
        
        Call this when tools make HTTP requests.
        """
        if not self._current_trace:
            return
        
        self._current_trace.network_calls.append(
            NetworkCall(
                destination_class=destination_class,
                method=method.upper(),
                timestamp=time.time(),
                duration_ms=duration_ms,
                status_class=status_class,
            )
        )
    
    def end_turn(self):
        """
        End the current decision turn.
        
        Call this when stop_reason == "tool_use" (agent is yielding for tool results).
        This marks a decision cycle boundary.
        """
        if not self._current_trace:
            return
        
        current_time = time.time()
        
        # Record the completed cycle
        if self._cycle_tool_count > 0 or self._cycle_retries > 0:
            cycle = DecisionCycle(
                cycle_id=self._current_cycle_id,
                start_time=self._cycle_start_time,
                end_time=current_time,
                tool_count=self._cycle_tool_count,
                retry_count=self._cycle_retries,
                self_corrections=self._cycle_corrections,
            )
            self._current_trace.decision_cycles.append(cycle)
        
        # Start new cycle
        self._current_cycle_id += 1
        self._cycle_start_time = current_time
        self._cycle_tool_count = 0
        self._cycle_retries = 0
        self._cycle_corrections = 0
    
    def end_session(
        self,
        stdout_lines: int = 0,
        stderr_lines: int = 0,
        exit_code: int = 0,
    ) -> DriftReport:
        """
        End the monitoring session and get the drift report.
        
        Call this when the agent conversation/task completes.
        
        Args:
            stdout_lines: Total stdout line count (if available)
            stderr_lines: Total stderr line count (if available)
            exit_code: Exit code (0 for success)
            
        Returns:
            DriftReport with detection results
        """
        if not self._current_trace:
            raise RuntimeError("No active session. Call start_session() first.")
        
        # Finalize trace
        self._current_trace.end_time = time.time()
        self._current_trace.stdout_line_count = stdout_lines
        self._current_trace.stderr_line_count = stderr_lines
        self._current_trace.exit_code = exit_code
        
        # End any pending cycle
        if self._cycle_tool_count > 0:
            self.end_turn()
        
        # Stop canaries
        if self.canary_injector:
            self.canary_injector.stop_background_canaries()
        
        # Detect drift
        report = self.detector.detect(self._current_trace)
        
        # Fire alert callback if needed
        if self._alert_callback and report.alert_level in ('warning', 'critical'):
            try:
                self._alert_callback(report)
            except Exception:
                pass  # Don't let callback errors break the flow
        
        # Save trace for history
        self._save_trace(self._current_trace)
        
        # Clear session state
        trace = self._current_trace
        self._current_trace = None
        
        return report
    
    def get_current_session_stats(self) -> Dict[str, Any]:
        """
        Get statistics for the current session (while it's running).
        
        Returns:
            Dict with current session metrics
        """
        if not self._current_trace:
            return {"active": False}
        
        trace = self._current_trace
        elapsed = time.time() - trace.start_time
        
        return {
            "active": True,
            "run_id": trace.run_id,
            "elapsed_seconds": elapsed,
            "tool_calls": len(trace.tool_invocations),
            "pending_tools": len(self._pending_tools),
            "decision_cycles": len(trace.decision_cycles),
            "current_cycle_tools": self._cycle_tool_count,
            "file_accesses": len(trace.file_accesses),
            "network_calls": len(trace.network_calls),
        }
    
    def _save_trace(self, trace: BehaviorTrace):
        """Save trace to disk for history."""
        import json
        
        traces_dir = self.storage_dir / "traces"
        traces_dir.mkdir(exist_ok=True)
        
        trace_file = traces_dir / f"{trace.run_id}.json"
        with open(trace_file, "w") as f:
            json.dump(trace.to_dict(), f, indent=2)
    
    def _on_canary_alert(self, result):
        """Handle canary task alerts."""
        if self._alert_callback:
            # Create a synthetic report for the canary alert
            report = DriftReport(
                run_id=f"canary-{result.task_id}",
                timestamp=datetime.utcnow().isoformat(),
                overall_drift_score=result.deviation_score,
                component_scores={"canary": result.deviation_score},
                anomalies=[f"Canary task failed: {result.task_type} - {result.details}"],
                alert_level="warning" if result.deviation_score < 0.7 else "critical",
            )
            try:
                self._alert_callback(report)
            except Exception:
                pass


# Convenience function for simple usage
def create_monitor(**kwargs) -> OpenClawDriftMonitor:
    """Create a drift monitor with default settings."""
    return OpenClawDriftMonitor(**kwargs)


# Example integration code
if __name__ == "__main__":
    print("OpenClaw Native Drift Monitor")
    print("=" * 40)
    print()
    print("Example usage in your OpenClaw integration:")
    print()
    print("""
    from examples.openclaw_native import OpenClawDriftMonitor
    
    # Initialize once at startup
    monitor = OpenClawDriftMonitor(
        alert_threshold=0.5,
        enable_canaries=True,
    )
    
    # Set alert handler
    def on_drift_alert(report):
        print(f"⚠️ Drift detected! Score: {report.overall_drift_score}")
        for anomaly in report.anomalies:
            print(f"  - {anomaly}")
    
    monitor.set_alert_callback(on_drift_alert)
    
    # In your message handler:
    async def handle_conversation(messages):
        session_id = monitor.start_session()
        
        while True:
            response = await anthropic.messages.create(...)
            
            for block in response.content:
                if block.type == "tool_use":
                    monitor.track_tool_call(
                        tool_name=block.name,
                        tool_id=block.id,
                    )
            
            if response.stop_reason == "tool_use":
                # Execute tools
                for tool_call in get_tool_calls(response):
                    start = time.time()
                    result = await execute_tool(tool_call)
                    duration_ms = (time.time() - start) * 1000
                    
                    monitor.track_tool_result(
                        tool_id=tool_call.id,
                        success=result.success,
                        duration_ms=duration_ms,
                    )
                
                monitor.end_turn()
            else:
                # Conversation complete
                break
        
        report = monitor.end_session()
        return report
    """)
