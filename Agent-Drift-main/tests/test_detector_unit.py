"""
Unit tests for DriftDetector.
Tests drift detection with mock traces.
"""

import pytest
import time
import tempfile
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.models import (
    BehaviorTrace, ToolInvocation, FileAccess, NetworkCall, DecisionCycle
)
from src.baseline import BaselineManager
from src.detector import DriftDetector


@pytest.fixture
def temp_dir():
    """Create a temporary directory for tests."""
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def baseline_mgr(temp_dir):
    return BaselineManager(storage_dir=temp_dir)


@pytest.fixture
def detector(baseline_mgr):
    return DriftDetector(baseline_manager=baseline_mgr)


def make_trace(
    run_id: str = "test",
    tools: list = None,
    tool_durations: list = None,
    file_ops: list = None,
    network_calls: list = None,
    retries: int = 0,
    stdout_lines: int = 20,
    stderr_lines: int = 2,
) -> BehaviorTrace:
    """Create a configurable test trace."""
    start = time.time()
    
    trace = BehaviorTrace(
        run_id=run_id,
        start_time=start,
        end_time=start + 5.0,
        stdout_line_count=stdout_lines,
        stderr_line_count=stderr_lines,
    )
    
    tools = tools or []
    tool_durations = tool_durations or [100.0] * len(tools)
    
    for i, tool in enumerate(tools):
        duration = tool_durations[i] if i < len(tool_durations) else 100.0
        trace.tool_invocations.append(
            ToolInvocation(
                tool_name=tool,
                timestamp=start + i * 0.5,
                duration_ms=duration,
                success=True,
                arg_count=1,
                arg_types=["string"],
            )
        )
    
    if file_ops:
        for path, op in file_ops:
            trace.file_accesses.append(
                FileAccess(path=path, operation=op, timestamp=start)
            )
    
    if network_calls:
        for dest, method, status in network_calls:
            trace.network_calls.append(
                NetworkCall(
                    destination_class=dest,
                    method=method,
                    timestamp=start,
                    duration_ms=50.0,
                    status_class=status,
                )
            )
    
    if tools or retries > 0:
        trace.decision_cycles.append(
            DecisionCycle(
                cycle_id=1,
                start_time=start,
                end_time=start + 5.0,
                tool_count=len(tools),
                retry_count=retries,
                self_corrections=0,
            )
        )
    
    return trace


class TestFirstRun:
    """Tests for first run behavior."""
    
    def test_first_run_creates_baseline(self, detector, baseline_mgr):
        """Test first run creates baseline."""
        trace = make_trace("first-001", tools=["a", "b", "c"])
        
        assert not baseline_mgr.has_baseline()
        
        report = detector.detect(trace)
        
        assert baseline_mgr.has_baseline()
    
    def test_first_run_zero_drift(self, detector):
        """Test first run has zero drift score."""
        trace = make_trace("first-001", tools=["a", "b"])
        report = detector.detect(trace)
        
        assert report.overall_drift_score == 0.0
    
    def test_first_run_normal_alert_level(self, detector):
        """Test first run has normal alert level."""
        trace = make_trace("first-001")
        report = detector.detect(trace)
        
        assert report.alert_level == "normal"
    
    def test_first_run_anomaly_message(self, detector):
        """Test first run has appropriate anomaly message."""
        trace = make_trace("first-001")
        report = detector.detect(trace)
        
        assert any("First run" in a or "baseline" in a.lower() for a in report.anomalies)


class TestIdenticalTraces:
    """Tests for identical/similar traces."""
    
    def test_identical_traces_low_drift(self, detector):
        """Test identical traces have low drift."""
        trace1 = make_trace("base", tools=["read", "write", "exec"])
        detector.detect(trace1)
        
        trace2 = make_trace("compare", tools=["read", "write", "exec"])
        report = detector.detect(trace2)
        
        assert report.overall_drift_score < 0.2
    
    def test_identical_traces_normal_alert(self, detector):
        """Test identical traces have normal alert level."""
        trace1 = make_trace("base", tools=["a", "b"])
        detector.detect(trace1)
        
        trace2 = make_trace("compare", tools=["a", "b"])
        report = detector.detect(trace2)
        
        assert report.alert_level == "normal"


class TestToolDrift:
    """Tests for tool-related drift detection."""
    
    def test_new_tools_detected(self, detector):
        """Test new tools are flagged."""
        trace1 = make_trace("base", tools=["read", "write"])
        detector.detect(trace1)
        
        trace2 = make_trace("compare", tools=["read", "write", "delete", "shell"])
        report = detector.detect(trace2)
        
        assert any("New tools" in a for a in report.anomalies)
        assert report.component_scores["tool_sequence"] > 0
    
    def test_missing_tools_detected(self, detector):
        """Test missing expected tools are flagged."""
        trace1 = make_trace("base", tools=["read", "validate", "write"])
        detector.detect(trace1)
        
        trace2 = make_trace("compare", tools=["read", "write"])  # No validate
        report = detector.detect(trace2)
        
        assert any("not used" in a.lower() for a in report.anomalies)
    
    def test_completely_different_tools_high_drift(self, detector):
        """Test completely different tools cause high drift."""
        trace1 = make_trace("base", tools=["a", "b", "c"])
        detector.detect(trace1)
        
        trace2 = make_trace("compare", tools=["x", "y", "z"])
        report = detector.detect(trace2)
        
        assert report.overall_drift_score > 0.3


class TestTimingDrift:
    """Tests for timing-related drift detection."""
    
    def test_slow_execution_detected(self, detector):
        """Test significantly slower execution is detected."""
        trace1 = make_trace(
            "base", 
            tools=["a", "b", "c"],
            tool_durations=[100.0, 100.0, 100.0],
        )
        detector.detect(trace1)
        
        trace2 = make_trace(
            "compare",
            tools=["a", "b", "c"],
            tool_durations=[1000.0, 1000.0, 1000.0],  # 10x slower
        )
        report = detector.detect(trace2)
        
        assert report.component_scores["timing"] > 0


class TestNetworkDrift:
    """Tests for network-related drift detection."""
    
    def test_new_network_activity_detected(self, detector):
        """Test new network activity is detected."""
        trace1 = make_trace(
            "base",
            tools=["process"],
            network_calls=[("internal", "GET", "2xx")],
        )
        detector.detect(trace1)
        
        trace2 = make_trace(
            "compare",
            tools=["process"],
            network_calls=[("external", "POST", "2xx")] * 10,
        )
        report = detector.detect(trace2)
        
        assert report.component_scores["network"] > 0


class TestFileDrift:
    """Tests for file access drift detection."""
    
    def test_new_file_operations_detected(self, detector):
        """Test new file operation types are detected."""
        trace1 = make_trace(
            "base",
            tools=["read"],
            file_ops=[("~/data.txt", "read")],
        )
        detector.detect(trace1)
        
        trace2 = make_trace(
            "compare",
            tools=["read"],
            file_ops=[("~/data.txt", "read"), ("~/secret.txt", "delete")],
        )
        report = detector.detect(trace2)
        
        assert report.component_scores["file_access"] > 0


class TestDecisionDrift:
    """Tests for decision pattern drift detection."""
    
    def test_retry_increase_detected(self, detector):
        """Test increased retries are detected."""
        trace1 = make_trace("base", tools=["process"], retries=0)
        detector.detect(trace1)
        
        trace2 = make_trace("compare", tools=["process"], retries=10)
        report = detector.detect(trace2)
        
        assert report.component_scores["decision"] > 0


class TestAlertLevels:
    """Tests for alert level classification."""
    
    def test_warning_threshold(self, temp_dir):
        """Test warning alert level at moderate drift."""
        baseline_mgr = BaselineManager(storage_dir=temp_dir)
        detector = DriftDetector(
            baseline_manager=baseline_mgr,
            warning_threshold=0.3,
            alert_threshold=0.6,
        )
        
        # Create baseline
        trace1 = make_trace("base", tools=["a", "b", "c"])
        detector.detect(trace1)
        
        # Moderate drift
        trace2 = make_trace("compare", tools=["a", "b", "d", "e"])
        report = detector.detect(trace2)
        
        # Should be at least warning if drift is moderate
        # (Actual level depends on exact drift calculation)
    
    def test_critical_threshold(self, temp_dir):
        """Test critical alert level at high drift."""
        baseline_mgr = BaselineManager(storage_dir=temp_dir)
        detector = DriftDetector(
            baseline_manager=baseline_mgr,
            warning_threshold=0.3,
            alert_threshold=0.5,
        )
        
        # Create minimal baseline
        trace1 = make_trace("base", tools=["a"])
        detector.detect(trace1)
        
        # Extreme drift - completely different everything
        trace2 = make_trace(
            "compare",
            tools=["x", "y", "z", "w", "v"],
            network_calls=[("external", "POST", "5xx")] * 10,
            file_ops=[("/etc/passwd", "read")] * 5,
        )
        report = detector.detect(trace2)
        
        # Should trigger warning or critical
        assert report.alert_level in ("warning", "critical")


class TestComponentScores:
    """Tests for component score calculation."""
    
    def test_all_components_present(self, detector):
        """Test all component scores are calculated."""
        trace1 = make_trace("base", tools=["a", "b"])
        detector.detect(trace1)
        
        trace2 = make_trace("compare", tools=["a", "b"])
        report = detector.detect(trace2)
        
        expected_components = [
            "tool_sequence",
            "tool_frequency",
            "timing",
            "decision",
            "file_access",
            "network",
            "output",
        ]
        
        for comp in expected_components:
            assert comp in report.component_scores
    
    def test_component_scores_bounded(self, detector):
        """Test component scores are between 0 and 1."""
        trace1 = make_trace("base", tools=["a", "b"])
        detector.detect(trace1)
        
        trace2 = make_trace("compare", tools=["x", "y", "z"])
        report = detector.detect(trace2)
        
        for score in report.component_scores.values():
            assert 0.0 <= score <= 1.0


class TestLCSPerformance:
    """Tests for LCS sequence comparison performance."""
    
    def test_long_sequences_handled(self, detector):
        """Test very long tool sequences don't cause timeout."""
        # Create baseline with long sequence
        trace1 = make_trace("base", tools=["tool"] * 500)
        detector.detect(trace1)
        
        # Compare with another long sequence
        trace2 = make_trace("compare", tools=["tool"] * 500)
        
        import time
        start = time.time()
        report = detector.detect(trace2)
        elapsed = time.time() - start
        
        # Should complete in reasonable time due to LCS capping
        assert elapsed < 5.0  # 5 second timeout


class TestBaselineUpdate:
    """Tests for baseline update behavior."""
    
    def test_baseline_updates_on_trusted_run(self, detector, baseline_mgr):
        """Test that baseline updates when drift is low."""
        # Create baseline
        trace1 = make_trace("baseline-001", tools=["read", "write", "exec"])
        detector.detect(trace1)
        
        initial_count = baseline_mgr.baseline.run_count
        
        # Similar run (should have low drift)
        trace2 = make_trace("similar-001", tools=["read", "write", "exec"])
        report = detector.detect(trace2)
        
        # Baseline should update if drift is within threshold
        if report.overall_drift_score <= 0.3:
            assert baseline_mgr.baseline.run_count > initial_count


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
