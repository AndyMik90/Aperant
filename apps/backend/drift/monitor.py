"""
Agent Drift Monitor - In-process behavioral drift monitoring.

Simplified version for integration with Auto-Claude.
Tracks tool usage and provides drift detection without HTTP server.
"""

import os
import json
import time
import threading
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

from .models import BehaviorTrace, ToolInvocation, DecisionCycle, DriftReport
from .baseline import BaselineManager
from .detector import DriftDetector


class AgentMonitor:
    """
    Monitors agent behavior for drift detection.

    Simplified for in-process use - no HTTP server.
    Integrates directly with coder.py agent sessions.
    """

    def __init__(self, storage_dir: Optional[str] = None, run_id: Optional[str] = None):
        """
        Initialize the drift monitor.

        Args:
            storage_dir: Directory for storing baseline and reports.
                        Defaults to ~/.agent-drift or AGENT_DRIFT_DIR env var.
            run_id: Optional run ID for this session. If not provided,
                   one will be generated when the session starts.
        """
        self.storage_dir = Path(storage_dir or os.environ.get(
            "AGENT_DRIFT_DIR",
            os.path.expanduser("~/.agent-drift")
        ))
        self.storage_dir.mkdir(parents=True, exist_ok=True)

        self.baseline_manager = BaselineManager(str(self.storage_dir))
        self.detector = DriftDetector(baseline_manager=self.baseline_manager)

        # Session state
        self.current_trace: Optional[BehaviorTrace] = None
        self.session_start: float = 0
        self.tool_count: int = 0
        self._run_id = run_id

        # History for this session
        self.recent_tools: List[Dict[str, Any]] = []
        self._lock = threading.Lock()

    def start_session(self, run_id: Optional[str] = None) -> str:
        """
        Start a new monitoring session.

        Args:
            run_id: Optional run ID. If not provided, generates one.

        Returns:
            The run ID for this session.
        """
        with self._lock:
            self.session_start = time.time()
            session_id = run_id or self._run_id or f"session-{int(self.session_start)}"

            self.current_trace = BehaviorTrace(
                run_id=session_id,
                start_time=self.session_start,
                end_time=0,
            )
            self.tool_count = 0
            self.recent_tools = []

            return session_id

    def ensure_session(self) -> str:
        """
        Ensure a session is active, starting one if needed.

        Returns:
            The run ID for the current session.
        """
        with self._lock:
            if not self.current_trace:
                return self.start_session()
            return self.current_trace.run_id

    def track_tool(
        self,
        tool_name: str,
        success: bool = True,
        duration_ms: float = 100.0,
        arg_count: int = 0,
        arg_types: Optional[List[str]] = None,
    ) -> None:
        """
        Track a tool call.

        Args:
            tool_name: Name of the tool being called
            success: Whether the tool call succeeded
            duration_ms: Duration of the tool call in milliseconds
            arg_count: Number of arguments passed to the tool
            arg_types: List of argument type names
        """
        self.ensure_session()

        with self._lock:
            now = time.time()
            self.current_trace.tool_invocations.append(
                ToolInvocation(
                    tool_name=tool_name,
                    timestamp=now,
                    duration_ms=duration_ms,
                    success=success,
                    arg_count=arg_count,
                    arg_types=arg_types or [],
                )
            )

            self.recent_tools.append({
                'tool': tool_name,
                'time': now,
                'success': success,
                'duration_ms': duration_ms,
            })

            # Keep recent tools bounded
            if len(self.recent_tools) > 200:
                self.recent_tools = self.recent_tools[-200:]

            self.tool_count += 1

    def get_interim_report(self) -> Optional[Dict[str, Any]]:
        """
        Get an interim drift report without ending the session.

        This allows checking drift status mid-session for real-time
        monitoring in the UI.

        Returns:
            Dict with interim drift data, or None if no session active.
        """
        with self._lock:
            if not self.current_trace:
                return None

            # Create a copy of the trace for analysis
            trace = BehaviorTrace(
                run_id=self.current_trace.run_id,
                start_time=self.current_trace.start_time,
                end_time=time.time(),
                tool_invocations=list(self.current_trace.tool_invocations),
                file_accesses=list(self.current_trace.file_accesses),
                network_calls=list(self.current_trace.network_calls),
                decision_cycles=list(self.current_trace.decision_cycles),
                stdout_line_count=self.current_trace.stdout_line_count,
                stderr_line_count=self.current_trace.stderr_line_count,
                exit_code=self.current_trace.exit_code,
            )

            # Add a decision cycle if we have tools
            if trace.tool_invocations and not trace.decision_cycles:
                trace.decision_cycles.append(
                    DecisionCycle(
                        cycle_id=1,
                        start_time=trace.start_time,
                        end_time=trace.end_time,
                        tool_count=len(trace.tool_invocations),
                        retry_count=0,
                        self_corrections=0,
                    )
                )

            # Get interim report from detector (without updating baseline)
            vector = self.detector.vectorizer.vectorize(trace)

            # Calculate drift if baseline exists
            if self.baseline_manager.has_baseline():
                baseline_vector = self.baseline_manager.get_baseline_vector()
                variance_bounds = self.baseline_manager.get_variance_bounds()

                # Use detector's comparison methods for component scores
                component_scores = {}
                anomalies = []

                seq_score, seq_anomalies = self.detector._compare_tool_sequence(vector, baseline_vector)
                component_scores['tool_sequence'] = seq_score
                anomalies.extend(seq_anomalies)

                freq_score, freq_anomalies = self.detector._compare_tool_frequency(vector, baseline_vector)
                component_scores['tool_frequency'] = freq_score
                anomalies.extend(freq_anomalies)

                timing_score, timing_anomalies = self.detector._compare_timing(vector, baseline_vector, variance_bounds)
                component_scores['timing'] = timing_score
                anomalies.extend(timing_anomalies)

                decision_score, decision_anomalies = self.detector._compare_decision_patterns(vector, baseline_vector, variance_bounds)
                component_scores['decision'] = decision_score
                anomalies.extend(decision_anomalies)

                file_score, file_anomalies = self.detector._compare_file_access(vector, baseline_vector)
                component_scores['file_access'] = file_score
                anomalies.extend(file_anomalies)

                network_score, network_anomalies = self.detector._compare_network(vector, baseline_vector)
                component_scores['network'] = network_score
                anomalies.extend(network_anomalies)

                output_score, output_anomalies = self.detector._compare_output(vector, baseline_vector, variance_bounds)
                component_scores['output'] = output_score
                anomalies.extend(output_anomalies)

                # Calculate weighted overall score
                overall_score = sum(
                    component_scores.get(comp, 0) * weight
                    for comp, weight in self.detector.COMPONENT_WEIGHTS.items()
                )

                # Determine alert level
                if overall_score >= self.detector.alert_threshold:
                    alert_level = "critical"
                elif overall_score >= self.detector.warning_threshold:
                    alert_level = "warning"
                else:
                    alert_level = "normal"
            else:
                # No baseline - first run
                overall_score = 0.0
                component_scores = {}
                anomalies = ["No baseline yet - first run"]
                alert_level = "normal"

            return {
                'run_id': trace.run_id,
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'is_interim': True,
                'overall_drift_score': round(overall_score, 4),
                'component_scores': {k: round(v, 4) for k, v in component_scores.items()},
                'anomalies': anomalies,
                'alert_level': alert_level,
                'tool_count': self.tool_count,
                'session_duration_ms': (time.time() - self.session_start) * 1000,
                'recent_tools': self.recent_tools[-10:],
                'baseline_info': self.baseline_manager.get_baseline_info(),
            }

    def end_session(self) -> Optional[DriftReport]:
        """
        End the current session and get the final drift report.

        Returns:
            DriftReport with final scores and anomalies, or None if no session.
        """
        with self._lock:
            if not self.current_trace:
                return None

            trace = self.current_trace
            trace.end_time = time.time()

            # Add decision cycle if we have tools
            if trace.tool_invocations:
                trace.decision_cycles.append(
                    DecisionCycle(
                        cycle_id=1,
                        start_time=trace.start_time,
                        end_time=trace.end_time,
                        tool_count=len(trace.tool_invocations),
                        retry_count=0,
                        self_corrections=0,
                    )
                )

            # Detect drift (this also updates baseline if appropriate)
            report = self.detector.detect(trace)

            # Save report to disk
            report_dict = report.to_dict()
            report_dict['timestamp'] = time.time()

            reports_dir = self.storage_dir / "reports"
            reports_dir.mkdir(exist_ok=True)
            with open(reports_dir / f"{report.run_id}.json", 'w') as f:
                json.dump(report_dict, f, indent=2)

            # Clear session state
            self.current_trace = None

            return report

    def get_baseline_info(self) -> Dict[str, Any]:
        """Get information about the current baseline."""
        return self.baseline_manager.get_baseline_info()

    def reset_baseline(self) -> None:
        """Reset the baseline. Next session will create a new one."""
        self.baseline_manager.reset_baseline()

    def is_monitoring(self) -> bool:
        """Check if a session is currently active."""
        return self.current_trace is not None

    def get_session_stats(self) -> Dict[str, Any]:
        """
        Get statistics for the current session.

        Returns:
            Dict with session statistics.
        """
        with self._lock:
            if not self.current_trace:
                return {
                    'active': False,
                    'tool_count': 0,
                    'duration_ms': 0,
                }

            return {
                'active': True,
                'run_id': self.current_trace.run_id,
                'tool_count': self.tool_count,
                'duration_ms': (time.time() - self.session_start) * 1000,
                'recent_tools': [t['tool'] for t in self.recent_tools[-5:]],
            }
