"""
Comprehensive test suite for Agent Drift Detector.
Includes unit tests, integration tests, edge cases, and attack simulations.
"""

import pytest
import time
import json
import tempfile
import math
from pathlib import Path
from typing import List
from src.models import (
    BehaviorTrace, ToolInvocation, FileAccess, NetworkCall, 
    DecisionCycle, BehaviorVector, Baseline, DriftReport
)
from src.baseline import BaselineManager
from src.detector import DriftDetector
from src.vectorizer import BehaviorVectorizer
from src.canary import CanaryInjector, ClassificationCanary, ArithmeticCanary, SequenceCanary


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def temp_dir():
    """Create a temporary directory for tests."""
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def vectorizer():
    return BehaviorVectorizer()


@pytest.fixture
def baseline_mgr(temp_dir):
    return BaselineManager(storage_dir=temp_dir)


@pytest.fixture
def detector(baseline_mgr):
    return DriftDetector(baseline_manager=baseline_mgr)


@pytest.fixture
def canary_injector(temp_dir):
    return CanaryInjector(storage_dir=temp_dir)


# =============================================================================
# HELPERS
# =============================================================================

def create_trace(
    run_id: str = None,
    tools: List[str] = None,
    tool_durations: List[float] = None,
    retries: int = 0,
    self_corrections: int = 0,
    file_ops: List[tuple] = None,  # [(path, op), ...]
    network_calls: List[tuple] = None,  # [(dest_class, method, status), ...]
    stdout_lines: int = 20,
    stderr_lines: int = 2,
    duration_seconds: float = 5.0,
) -> BehaviorTrace:
    """Helper to create configurable test traces."""
    run_id = run_id or f"test-{int(time.time() * 1000)}"
    start = time.time()
    
    trace = BehaviorTrace(
        run_id=run_id,
        start_time=start,
        end_time=start + duration_seconds,
        stdout_line_count=stdout_lines,
        stderr_line_count=stderr_lines,
    )
    
    if tools is None:
        tools = ["read", "write", "exec"]
    
    if tool_durations is None:
        tool_durations = [100.0] * len(tools)
    
    for i, tool in enumerate(tools):
        duration = tool_durations[i] if i < len(tool_durations) else 100.0
        trace.tool_invocations.append(
            ToolInvocation(
                tool_name=tool,
                timestamp=start + i * 0.5,
                duration_ms=duration,
                success=True,
                arg_count=2,
                arg_types=["string", "object"],
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
    
    trace.decision_cycles.append(
        DecisionCycle(
            cycle_id=1,
            start_time=start,
            end_time=start + duration_seconds,
            tool_count=len(tools),
            retry_count=retries,
            self_corrections=self_corrections,
        )
    )
    
    return trace


# =============================================================================
# UNIT TESTS - MODELS
# =============================================================================

class TestModels:
    """Unit tests for data models."""
    
    def test_behavior_trace_serialization(self):
        """Test trace serialization round-trip."""
        trace = create_trace(
            run_id="ser-001",
            tools=["read", "write"],
            file_ops=[("~/test.txt", "write")],
            network_calls=[("api", "GET", "2xx")],
        )
        
        # Serialize
        data = trace.to_dict()
        assert data["run_id"] == "ser-001"
        assert len(data["tool_invocations"]) == 2
        assert len(data["file_accesses"]) == 1
        assert len(data["network_calls"]) == 1
        
        # Deserialize
        restored = BehaviorTrace.from_dict(data)
        assert restored.run_id == trace.run_id
        assert len(restored.tool_invocations) == 2
        assert restored.tool_invocations[0].tool_name == "read"
    
    def test_behavior_vector_serialization(self):
        """Test vector serialization round-trip."""
        vector = BehaviorVector(
            tool_sequence=["a", "b", "c"],
            tool_frequency={"a": 5, "b": 3, "c": 2},
            mean_tool_duration_ms=150.0,
            total_cycles=3,
            retry_rate=0.2,
        )
        
        data = vector.to_dict()
        restored = BehaviorVector.from_dict(data)
        
        assert restored.tool_sequence == vector.tool_sequence
        assert restored.tool_frequency == vector.tool_frequency
        assert restored.mean_tool_duration_ms == vector.mean_tool_duration_ms
    
    def test_drift_report_to_dict(self):
        """Test DriftReport serialization."""
        report = DriftReport(
            run_id="report-001",
            timestamp="2024-01-01T00:00:00",
            overall_drift_score=0.45,
            component_scores={"tool_sequence": 0.3, "timing": 0.5},
            anomalies=["New tools detected"],
            alert_level="warning",
        )
        
        data = report.to_dict()
        assert data["overall_drift_score"] == 0.45
        assert data["alert_level"] == "warning"


# =============================================================================
# UNIT TESTS - VECTORIZER
# =============================================================================

class TestVectorizer:
    """Unit tests for behavior vectorization."""
    
    def test_empty_trace_vectorization(self, vectorizer):
        """Test vectorizing an empty trace."""
        trace = BehaviorTrace(
            run_id="empty-001",
            start_time=time.time(),
            end_time=time.time() + 1,
        )
        
        vector = vectorizer.vectorize(trace)
        
        assert vector.tool_sequence == []
        assert vector.tool_frequency == {}
        assert vector.total_cycles == 0
    
    def test_tool_sequence_extraction(self, vectorizer):
        """Test tool sequence is correctly extracted."""
        trace = create_trace(tools=["read", "exec", "write", "read"])
        vector = vectorizer.vectorize(trace)
        
        assert vector.tool_sequence == ["read", "exec", "write", "read"]
        assert vector.tool_frequency == {"read": 2, "exec": 1, "write": 1}
    
    def test_tool_transitions(self, vectorizer):
        """Test tool transition matrix."""
        trace = create_trace(tools=["a", "b", "a", "c", "a", "b"])
        vector = vectorizer.vectorize(trace)
        
        assert "a" in vector.tool_transitions
        assert vector.tool_transitions["a"]["b"] == 2
        assert vector.tool_transitions["a"]["c"] == 1
    
    def test_timing_features(self, vectorizer):
        """Test timing feature extraction."""
        trace = create_trace(
            tools=["a", "b", "c"],
            tool_durations=[100.0, 200.0, 150.0],
            duration_seconds=10.0,
        )
        vector = vectorizer.vectorize(trace)
        
        assert vector.mean_tool_duration_ms == 150.0  # (100+200+150)/3
        assert vector.total_duration_ms == 10000.0
    
    def test_file_access_features(self, vectorizer):
        """Test file access feature extraction."""
        trace = create_trace(
            tools=["read"],
            file_ops=[
                ("~/a.txt", "read"),
                ("~/b.txt", "read"),
                ("~/c.txt", "write"),
                ("~/d.txt", "read"),
            ],
        )
        vector = vectorizer.vectorize(trace)
        
        assert vector.file_op_frequency["read"] == 3
        assert vector.file_op_frequency["write"] == 1
        assert vector.unique_paths_accessed == 4
        assert abs(vector.write_to_read_ratio - (1/3)) < 0.01
    
    def test_network_features(self, vectorizer):
        """Test network feature extraction."""
        trace = create_trace(
            tools=["fetch"],
            network_calls=[
                ("api", "GET", "2xx"),
                ("api", "POST", "2xx"),
                ("cdn", "GET", "2xx"),
                ("api", "GET", "5xx"),
            ],
        )
        vector = vectorizer.vectorize(trace)
        
        assert vector.network_call_count == 4
        assert vector.destination_class_freq["api"] == 3
        assert vector.destination_class_freq["cdn"] == 1
        assert vector.error_rate == 0.25  # 1 error out of 4
    
    def test_vector_merging(self, vectorizer):
        """Test merging multiple vectors."""
        vectors = [
            BehaviorVector(
                tool_sequence=["a", "b"],
                tool_frequency={"a": 2, "b": 2},
                mean_tool_duration_ms=100.0,
                total_cycles=2,
            ),
            BehaviorVector(
                tool_sequence=["a", "b", "c"],
                tool_frequency={"a": 3, "b": 1, "c": 1},
                mean_tool_duration_ms=200.0,
                total_cycles=3,
            ),
        ]
        
        merged = vectorizer.merge_vectors(vectors)
        
        # Uses longest sequence
        assert len(merged.tool_sequence) == 3
        # Averages frequencies
        assert merged.tool_frequency["a"] == 2  # avg of 2 and 3 -> 2.5 -> 2
        # Averages timing
        assert merged.mean_tool_duration_ms == 150.0
    
    def test_variance_bounds_calculation(self, vectorizer):
        """Test variance bounds calculation."""
        vectors = [
            BehaviorVector(mean_tool_duration_ms=100.0),
            BehaviorVector(mean_tool_duration_ms=120.0),
            BehaviorVector(mean_tool_duration_ms=110.0),
            BehaviorVector(mean_tool_duration_ms=90.0),
            BehaviorVector(mean_tool_duration_ms=130.0),
        ]
        
        bounds = vectorizer.compute_variance_bounds(vectors)
        
        assert "mean_tool_duration_ms" in bounds
        assert bounds["mean_tool_duration_ms"]["mean"] == 110.0
        assert bounds["mean_tool_duration_ms"]["min"] < 110.0
        assert bounds["mean_tool_duration_ms"]["max"] > 110.0


# =============================================================================
# UNIT TESTS - BASELINE
# =============================================================================

class TestBaseline:
    """Unit tests for baseline management."""
    
    def test_baseline_creation(self, baseline_mgr):
        """Test baseline is created on first trace."""
        trace = create_trace(run_id="baseline-001")
        
        assert not baseline_mgr.has_baseline()
        
        baseline = baseline_mgr.create_baseline(trace)
        
        assert baseline_mgr.has_baseline()
        assert baseline.run_count == 1
        assert len(baseline.historical_vectors) == 1
    
    def test_baseline_persistence(self, temp_dir):
        """Test baseline persists across manager instances."""
        mgr1 = BaselineManager(storage_dir=temp_dir)
        trace = create_trace(tools=["read", "write"])
        mgr1.create_baseline(trace)
        
        # Create new manager instance
        mgr2 = BaselineManager(storage_dir=temp_dir)
        
        assert mgr2.has_baseline()
        assert mgr2.baseline.run_count == 1
        info = mgr2.get_baseline_info()
        assert "read" in info["tools"]
        assert "write" in info["tools"]
    
    def test_baseline_update_trusted(self, baseline_mgr):
        """Test baseline updates when drift is within trust threshold."""
        trace1 = create_trace(run_id="base-001")
        baseline_mgr.create_baseline(trace1)
        
        initial_count = baseline_mgr.baseline.run_count
        
        trace2 = create_trace(run_id="trusted-001")
        baseline_mgr.update_baseline(trace2, drift_score=0.1)
        
        assert baseline_mgr.baseline.run_count == initial_count + 1
    
    def test_baseline_no_update_untrusted(self, baseline_mgr):
        """Test baseline doesn't update when drift exceeds threshold."""
        trace1 = create_trace(run_id="base-001")
        baseline_mgr.create_baseline(trace1)
        
        initial_count = baseline_mgr.baseline.run_count
        
        trace2 = create_trace(run_id="untrusted-001")
        baseline_mgr.update_baseline(trace2, drift_score=0.8)
        
        # Run count should not increase
        assert baseline_mgr.baseline.run_count == initial_count
    
    def test_baseline_reset(self, baseline_mgr):
        """Test baseline reset."""
        trace = create_trace()
        baseline_mgr.create_baseline(trace)
        
        assert baseline_mgr.has_baseline()
        
        baseline_mgr.reset_baseline()
        
        assert not baseline_mgr.has_baseline()
    
    def test_baseline_export_import(self, baseline_mgr, temp_dir):
        """Test baseline export and import."""
        trace = create_trace(tools=["a", "b", "c"])
        baseline_mgr.create_baseline(trace)
        
        export_path = Path(temp_dir) / "exported_baseline.json"
        baseline_mgr.export_baseline(str(export_path))
        
        # Reset and import
        baseline_mgr.reset_baseline()
        baseline_mgr.import_baseline(str(export_path))
        
        assert baseline_mgr.has_baseline()
        assert set(baseline_mgr.baseline.vector.tool_sequence) == {"a", "b", "c"}


# =============================================================================
# UNIT TESTS - DETECTOR
# =============================================================================

class TestDetector:
    """Unit tests for drift detection."""
    
    def test_first_run_creates_baseline(self, detector, baseline_mgr):
        """Test first run creates baseline with zero drift."""
        trace = create_trace(run_id="first-001")
        
        report = detector.detect(trace)
        
        assert baseline_mgr.has_baseline()
        assert report.overall_drift_score == 0.0
        assert report.alert_level == "normal"
        assert "First run" in report.anomalies[0]
    
    def test_identical_trace_low_drift(self, detector):
        """Test identical traces produce minimal drift."""
        trace1 = create_trace(tools=["a", "b", "c"])
        detector.detect(trace1)
        
        trace2 = create_trace(tools=["a", "b", "c"])
        report = detector.detect(trace2)
        
        assert report.overall_drift_score < 0.2
        assert report.alert_level == "normal"
    
    def test_different_tools_high_drift(self, detector):
        """Test completely different tools produce high drift."""
        trace1 = create_trace(tools=["read", "write", "exec"])
        detector.detect(trace1)
        
        trace2 = create_trace(tools=["delete", "network", "unknown"])
        report = detector.detect(trace2)
        
        assert report.overall_drift_score > 0.3
        assert any("New tools" in a for a in report.anomalies)
    
    def test_alert_threshold_critical(self, detector):
        """Test critical alert level at high drift."""
        trace1 = create_trace(tools=["a"])
        detector.detect(trace1)
        
        # Very different trace
        trace2 = create_trace(
            tools=["x", "y", "z", "w", "v"],
            network_calls=[("external", "POST", "5xx")] * 5,
            file_ops=[("~/sensitive", "delete")] * 3,
        )
        report = detector.detect(trace2)
        
        # Should trigger at least warning
        assert report.alert_level in ["warning", "critical"]
    
    def test_all_component_scores_present(self, detector):
        """Test all component scores are calculated."""
        trace1 = create_trace()
        detector.detect(trace1)
        
        trace2 = create_trace()
        report = detector.detect(trace2)
        
        expected = ['tool_sequence', 'tool_frequency', 'timing', 
                   'decision', 'file_access', 'network', 'output']
        
        for comp in expected:
            assert comp in report.component_scores
    
    def test_timing_drift_detection(self, detector):
        """Test timing changes are detected."""
        trace1 = create_trace(tool_durations=[100.0, 100.0, 100.0])
        detector.detect(trace1)
        
        # Much slower execution
        trace2 = create_trace(tool_durations=[1000.0, 1000.0, 1000.0])
        report = detector.detect(trace2)
        
        assert report.component_scores["timing"] > 0
    
    def test_retry_increase_detected(self, detector):
        """Test increased retries are detected."""
        trace1 = create_trace(retries=0)
        detector.detect(trace1)
        
        trace2 = create_trace(retries=10)
        report = detector.detect(trace2)
        
        assert report.component_scores["decision"] > 0


# =============================================================================
# UNIT TESTS - CANARY
# =============================================================================

class TestCanary:
    """Unit tests for canary tasks."""
    
    def test_classification_canary_deterministic(self):
        """Test classification canary produces deterministic output."""
        canary = ClassificationCanary()
        
        output1 = canary.execute()
        output2 = canary.execute()
        
        assert output1 == output2
        assert output1 == canary.expected_output
    
    def test_arithmetic_canary_deterministic(self):
        """Test arithmetic canary produces deterministic output."""
        canary = ArithmeticCanary()
        
        output = canary.execute()
        
        assert output == canary.expected_output
        assert "17+23=40" in output
    
    def test_sequence_canary_deterministic(self):
        """Test sequence canary produces deterministic output."""
        canary = SequenceCanary()
        
        output = canary.execute()
        
        assert output == canary.expected_output
        assert "21" in output
        assert "34" in output
    
    def test_canary_injector_first_run(self, canary_injector):
        """Test canary creates baseline on first run."""
        result = canary_injector.run_canary("classification")
        
        assert result.passed
        assert "Baseline created" in result.details
    
    def test_canary_injector_repeated_run(self, canary_injector):
        """Test canary passes on repeated identical runs."""
        canary_injector.run_canary("classification")
        result = canary_injector.run_canary("classification")
        
        assert result.passed
        assert result.deviation_score < 0.3
    
    def test_run_all_canaries(self, canary_injector):
        """Test running all canary tasks."""
        results = canary_injector.run_all_canaries()
        
        assert len(results) == 3
        assert all(r.passed for r in results)


# =============================================================================
# INTEGRATION TESTS
# =============================================================================

class TestIntegration:
    """Integration tests for the full detection pipeline."""
    
    def test_full_pipeline_normal_operation(self, temp_dir):
        """Test normal operation through full pipeline."""
        baseline_mgr = BaselineManager(storage_dir=temp_dir)
        detector = DriftDetector(baseline_manager=baseline_mgr)
        
        # Simulate 5 normal runs
        reports = []
        for i in range(5):
            trace = create_trace(
                run_id=f"normal-{i}",
                tools=["read", "analyze", "write"],
                retries=0,
            )
            reports.append(detector.detect(trace))
        
        # All should be normal
        assert all(r.alert_level == "normal" for r in reports[1:])
        # Baseline should have updated
        assert baseline_mgr.baseline.run_count >= 4
    
    def test_full_pipeline_gradual_drift(self, temp_dir):
        """Test gradual drift is eventually detected."""
        baseline_mgr = BaselineManager(storage_dir=temp_dir)
        detector = DriftDetector(baseline_manager=baseline_mgr)
        
        # Normal baseline
        trace = create_trace(tools=["a", "b", "c"])
        detector.detect(trace)
        
        # Gradually add new tools
        tools_progression = [
            ["a", "b", "c"],           # Same
            ["a", "b", "c", "d"],       # +1
            ["a", "b", "c", "d", "e"],  # +2
            ["a", "d", "e", "f", "g"],  # Major shift
        ]
        
        scores = []
        for tools in tools_progression:
            trace = create_trace(tools=tools)
            report = detector.detect(trace)
            scores.append(report.overall_drift_score)
        
        # Scores should generally increase
        assert scores[-1] > scores[0]
    
    def test_canary_integration(self, temp_dir):
        """Test canary tasks integrate with main detector."""
        canary = CanaryInjector(storage_dir=temp_dir)
        
        # Run canaries multiple times
        all_passed = True
        for _ in range(10):
            results = canary.run_all_canaries()
            if not all(r.passed for r in results):
                all_passed = False
                break
        
        assert all_passed
        
        # Check status
        status = canary.get_canary_status()
        assert len(status["baselines"]) == 3


# =============================================================================
# ATTACK SIMULATION TESTS
# =============================================================================

class TestAttackSimulations:
    """
    Simulated attack scenarios to verify detection capabilities.
    These tests verify the detector catches various compromise patterns.
    """
    
    def test_attack_tool_injection(self, detector):
        """
        ATTACK: Tool Injection
        Attacker injects unauthorized tools into the agent's toolchain.
        """
        # Establish normal behavior
        for _ in range(3):
            trace = create_trace(tools=["read", "write", "validate"])
            detector.detect(trace)
        
        # Attack: inject dangerous tools
        attack_trace = create_trace(
            run_id="attack-tool-injection",
            tools=["read", "write", "validate", "shell_exec", "network_exfil"]
        )
        report = detector.detect(attack_trace)
        
        assert any("New tools" in a for a in report.anomalies)
        assert report.overall_drift_score > 0.2
    
    def test_attack_validation_bypass(self, detector):
        """
        ATTACK: Validation Bypass
        Attacker causes the agent to skip validation steps.
        """
        # Normal: always validates
        for _ in range(3):
            trace = create_trace(tools=["read", "process", "validate", "write"])
            detector.detect(trace)
        
        # Attack: skip validation
        attack_trace = create_trace(
            run_id="attack-bypass",
            tools=["read", "process", "write"]  # No validation!
        )
        report = detector.detect(attack_trace)
        
        assert any("not used" in a.lower() for a in report.anomalies)
    
    def test_attack_tool_preference_hijack(self, detector):
        """
        ATTACK: Tool Preference Hijacking
        Attacker shifts agent away from safe tools to dangerous alternatives.
        """
        # Normal: prefers safe_exec
        for _ in range(5):
            trace = create_trace(
                tools=["safe_exec", "safe_exec", "log", "safe_exec"]
            )
            detector.detect(trace)
        
        # Attack: shift to unsafe tools
        attack_trace = create_trace(
            run_id="attack-hijack",
            tools=["raw_shell", "raw_shell", "raw_shell", "raw_shell"]
        )
        report = detector.detect(attack_trace)
        
        assert report.component_scores["tool_frequency"] > 0.3
        assert report.overall_drift_score > 0.3
    
    def test_attack_data_exfiltration_pattern(self, detector):
        """
        ATTACK: Data Exfiltration
        Agent suddenly starts making many external network calls.
        """
        # Normal: minimal network
        for _ in range(3):
            trace = create_trace(
                tools=["read", "process"],
                network_calls=[("internal", "GET", "2xx")],
            )
            detector.detect(trace)
        
        # Attack: massive external calls
        attack_trace = create_trace(
            run_id="attack-exfil",
            tools=["read", "read", "read"],
            network_calls=[("external", "POST", "2xx")] * 20,
        )
        report = detector.detect(attack_trace)
        
        assert report.component_scores["network"] > 0.3
        assert any("Network" in a for a in report.anomalies)
    
    def test_attack_file_access_escalation(self, detector):
        """
        ATTACK: File Access Escalation
        Agent starts accessing sensitive paths outside normal scope.
        """
        # Normal: limited file access
        for _ in range(3):
            trace = create_trace(
                tools=["read"],
                file_ops=[
                    ("~/project/data.txt", "read"),
                    ("~/project/config.json", "read"),
                ],
            )
            detector.detect(trace)
        
        # Attack: access sensitive files (more paths than baseline)
        attack_trace = create_trace(
            run_id="attack-escalation",
            tools=["read"],
            file_ops=[
                ("/etc/passwd", "read"),
                ("/etc/shadow", "read"),
                ("~/.ssh/id_rsa", "read"),
                ("~/.aws/credentials", "read"),
                ("/var/log/auth.log", "read"),
                ("~/.bash_history", "read"),
            ],
        )
        report = detector.detect(attack_trace)
        
        # Should detect path count increase or overall drift
        assert report.component_scores["file_access"] > 0 or report.overall_drift_score > 0
    
    def test_attack_timing_anomaly(self, detector):
        """
        ATTACK: Timing Side-Channel
        Agent behavior timing changes dramatically (may indicate
        additional hidden operations).
        """
        # Normal: consistent timing
        for _ in range(3):
            trace = create_trace(
                tools=["quick_op"] * 5,
                tool_durations=[50.0] * 5,
            )
            detector.detect(trace)
        
        # Attack: operations take much longer (doing something hidden?)
        attack_trace = create_trace(
            run_id="attack-timing",
            tools=["quick_op"] * 5,
            tool_durations=[5000.0] * 5,  # 100x slower
        )
        report = detector.detect(attack_trace)
        
        assert report.component_scores["timing"] > 0.3
    
    def test_attack_retry_flood(self, detector):
        """
        ATTACK: Retry Flood
        Agent enters confused state with excessive retries
        (may indicate prompt injection confusion).
        """
        # Normal: minimal retries
        for _ in range(3):
            trace = create_trace(
                tools=["process"],
                retries=0,
                self_corrections=0,
            )
            detector.detect(trace)
        
        # Attack: confused agent with many retries
        attack_trace = create_trace(
            run_id="attack-retry",
            tools=["process"],
            retries=15,
            self_corrections=10,
        )
        report = detector.detect(attack_trace)
        
        assert report.component_scores["decision"] > 0.2
    
    def test_attack_output_flood(self, detector):
        """
        ATTACK: Output Manipulation
        Agent suddenly produces massive output (potential info leak
        or prompt injection feedback loop).
        """
        # Normal: moderate output
        for _ in range(3):
            trace = create_trace(
                tools=["respond"],
                stdout_lines=50,
                stderr_lines=2,
            )
            detector.detect(trace)
        
        # Attack: massive output
        attack_trace = create_trace(
            run_id="attack-output",
            tools=["respond"],
            stdout_lines=10000,
            stderr_lines=500,
        )
        report = detector.detect(attack_trace)
        
        assert report.component_scores["output"] > 0.2
    
    def test_attack_gradual_manipulation(self, detector):
        """
        ATTACK: Gradual Behavioral Manipulation
        Attacker slowly shifts behavior to avoid sudden drift detection.
        """
        # Phase 1: Establish baseline
        baseline_trace = create_trace(
            tools=["safe_a", "safe_b", "safe_c"],
            network_calls=[("internal", "GET", "2xx")],
        )
        detector.detect(baseline_trace)
        
        # Phase 2: Gradual shift (should still be detected eventually)
        shifts = [
            # Small changes each step
            (["safe_a", "safe_b", "safe_c", "new_d"], 1),
            (["safe_a", "safe_b", "new_d", "new_e"], 2),
            (["safe_a", "new_d", "new_e", "new_f"], 3),
            (["new_d", "new_e", "new_f", "danger_g"], 5),
        ]
        
        final_report = None
        for tools, net_count in shifts:
            trace = create_trace(
                tools=tools,
                network_calls=[("external", "POST", "2xx")] * net_count,
            )
            final_report = detector.detect(trace)
        
        # Final state should show significant drift
        assert final_report.overall_drift_score > 0.3
    
    def test_attack_canary_tampering(self, canary_injector):
        """
        ATTACK: Canary Task Manipulation
        Attacker attempts to tamper with canary task outputs.
        
        Note: This tests the canary detection system itself.
        In a real attack, a compromised agent might try to
        produce wrong answers to canary tasks.
        """
        # Run normal canaries first
        canary_injector.run_all_canaries()
        
        # Simulate a "tampered" result by checking deviation detection
        # (In reality, this would come from a compromised execution)
        
        # The canary system should detect if outputs don't match
        # We can't easily simulate wrong output without modifying internals,
        # but we verify the detection mechanism exists
        
        status = canary_injector.get_canary_status()
        assert "baselines" in status
        assert all(
            "expected_output_hash" in b 
            for b in status["baselines"].values()
        )


# =============================================================================
# EDGE CASE TESTS  
# =============================================================================

class TestEdgeCases:
    """Edge case and boundary condition tests."""
    
    def test_empty_trace(self, detector, baseline_mgr):
        """Test handling of trace with no tools."""
        trace = BehaviorTrace(
            run_id="empty-001",
            start_time=time.time(),
            end_time=time.time() + 1,
        )
        
        report = detector.detect(trace)
        
        # Should still create baseline
        assert baseline_mgr.has_baseline()
        assert report.overall_drift_score == 0.0
    
    def test_single_tool_trace(self, detector):
        """Test trace with single tool."""
        trace1 = create_trace(tools=["only_one"])
        detector.detect(trace1)
        
        trace2 = create_trace(tools=["only_one"])
        report = detector.detect(trace2)
        
        assert report.overall_drift_score < 0.2
    
    def test_very_long_tool_sequence(self, detector):
        """Test very long tool sequences."""
        tools = ["tool"] * 1000
        trace1 = create_trace(tools=tools)
        detector.detect(trace1)
        
        trace2 = create_trace(tools=tools)
        report = detector.detect(trace2)
        
        # Allow small drift due to LCS sampling on long sequences
        assert report.overall_drift_score <= 0.25
    
    def test_unicode_tool_names(self, detector):
        """Test tools with unicode names."""
        trace1 = create_trace(tools=["読む", "書く", "実行"])
        detector.detect(trace1)
        
        trace2 = create_trace(tools=["読む", "書く", "実行"])
        report = detector.detect(trace2)
        
        assert report.overall_drift_score < 0.2
    
    def test_rapid_successive_runs(self, detector):
        """Test many rapid successive runs."""
        reports = []
        for i in range(50):
            trace = create_trace(
                run_id=f"rapid-{i}",
                tools=["a", "b", "c"],
            )
            reports.append(detector.detect(trace))
        
        # Should stabilize
        assert all(r.alert_level == "normal" for r in reports[-10:])
    
    def test_baseline_recovery_from_corruption(self, temp_dir):
        """Test recovery from corrupted baseline file."""
        baseline_file = Path(temp_dir) / "baseline.json"
        
        # Write corrupted data
        baseline_file.write_text("{ invalid json }")
        
        # Should handle gracefully
        mgr = BaselineManager(storage_dir=temp_dir)
        
        # File exists but content is invalid - baseline property returns None
        assert mgr.baseline is None
        
        # Should be able to create new baseline
        trace = create_trace()
        mgr.create_baseline(trace)
        assert mgr.has_baseline()
        assert mgr.baseline is not None
    
    def test_zero_duration_trace(self, detector):
        """Test trace with zero duration."""
        start = time.time()
        trace = BehaviorTrace(
            run_id="zero-001",
            start_time=start,
            end_time=start,  # Same time
        )
        trace.tool_invocations.append(
            ToolInvocation("instant", start, 0.0, True)
        )
        
        # Should not crash
        report = detector.detect(trace)
        assert report is not None


# =============================================================================
# PERFORMANCE TESTS
# =============================================================================

class TestPerformance:
    """Performance and stress tests."""
    
    def test_vectorization_performance(self, vectorizer):
        """Test vectorization performance with large trace."""
        # Create large trace
        trace = create_trace(
            tools=["tool"] * 10000,
            file_ops=[("~/file", "read")] * 1000,
            network_calls=[("api", "GET", "2xx")] * 1000,
        )
        
        start = time.time()
        vector = vectorizer.vectorize(trace)
        elapsed = time.time() - start
        
        # Should complete in reasonable time
        assert elapsed < 5.0  # 5 seconds max
        assert vector.tool_sequence is not None
    
    def test_detection_performance(self, temp_dir):
        """Test detection performance over many runs."""
        baseline_mgr = BaselineManager(storage_dir=temp_dir)
        detector = DriftDetector(baseline_manager=baseline_mgr)
        
        # Create baseline
        trace = create_trace(tools=["a", "b", "c"])
        detector.detect(trace)
        
        start = time.time()
        for i in range(100):
            trace = create_trace(run_id=f"perf-{i}", tools=["a", "b", "c"])
            detector.detect(trace)
        elapsed = time.time() - start
        
        # 100 detections should complete quickly
        assert elapsed < 10.0  # 10 seconds max
        avg_time = elapsed / 100
        assert avg_time < 0.1  # Each detection under 100ms


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
