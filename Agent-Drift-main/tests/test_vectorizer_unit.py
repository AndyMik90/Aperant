"""
Unit tests for BehaviorVectorizer.
Tests feature extraction from traces.
"""

import pytest
import time
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.models import (
    BehaviorTrace, ToolInvocation, FileAccess, NetworkCall, DecisionCycle, BehaviorVector
)
from src.vectorizer import BehaviorVectorizer


@pytest.fixture
def vectorizer():
    return BehaviorVectorizer()


def make_trace(
    tools: list = None,
    tool_durations: list = None,
    file_ops: list = None,
    network_calls: list = None,
    retries: int = 0,
    corrections: int = 0,
    stdout_lines: int = 20,
    stderr_lines: int = 2,
) -> BehaviorTrace:
    """Create a configurable test trace."""
    start = time.time()
    
    trace = BehaviorTrace(
        run_id="test-trace",
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
                self_corrections=corrections,
            )
        )
    
    return trace


class TestToolFeatures:
    """Tests for tool-related feature extraction."""
    
    def test_empty_trace(self, vectorizer):
        """Test vectorizing trace with no tools."""
        trace = make_trace(tools=[])
        vector = vectorizer.vectorize(trace)
        
        assert vector.tool_sequence == []
        assert vector.tool_frequency == {}
    
    def test_tool_sequence(self, vectorizer):
        """Test tool sequence is extracted correctly."""
        trace = make_trace(tools=["read", "process", "write"])
        vector = vectorizer.vectorize(trace)
        
        assert vector.tool_sequence == ["read", "process", "write"]
    
    def test_tool_frequency(self, vectorizer):
        """Test tool frequency counting."""
        trace = make_trace(tools=["read", "read", "write", "read"])
        vector = vectorizer.vectorize(trace)
        
        assert vector.tool_frequency == {"read": 3, "write": 1}
    
    def test_tool_transitions(self, vectorizer):
        """Test tool transition matrix."""
        trace = make_trace(tools=["a", "b", "a", "c", "a"])
        vector = vectorizer.vectorize(trace)
        
        assert vector.tool_transitions["a"]["b"] == 1
        assert vector.tool_transitions["a"]["c"] == 1
        assert vector.tool_transitions["b"]["a"] == 1
        assert vector.tool_transitions["c"]["a"] == 1


class TestTimingFeatures:
    """Tests for timing feature extraction."""
    
    def test_tool_duration_mean(self, vectorizer):
        """Test mean tool duration calculation."""
        trace = make_trace(
            tools=["a", "b", "c"],
            tool_durations=[100.0, 200.0, 300.0],
        )
        vector = vectorizer.vectorize(trace)
        
        assert vector.mean_tool_duration_ms == 200.0
    
    def test_tool_duration_std(self, vectorizer):
        """Test standard deviation calculation."""
        trace = make_trace(
            tools=["a", "b", "c"],
            tool_durations=[100.0, 100.0, 100.0],
        )
        vector = vectorizer.vectorize(trace)
        
        # All same = zero std
        assert vector.std_tool_duration_ms == 0.0
    
    def test_total_duration(self, vectorizer):
        """Test total duration extraction."""
        start = time.time()
        trace = BehaviorTrace(
            run_id="test",
            start_time=start,
            end_time=start + 10.0,  # 10 second duration
        )
        
        vector = vectorizer.vectorize(trace)
        
        assert vector.total_duration_ms == 10000.0


class TestFileFeatures:
    """Tests for file access feature extraction."""
    
    def test_file_operations(self, vectorizer):
        """Test file operation frequency."""
        trace = make_trace(
            tools=["read"],
            file_ops=[
                ("~/a.txt", "read"),
                ("~/b.txt", "read"),
                ("~/c.txt", "write"),
            ],
        )
        vector = vectorizer.vectorize(trace)
        
        assert vector.file_op_frequency["read"] == 2
        assert vector.file_op_frequency["write"] == 1
    
    def test_unique_paths(self, vectorizer):
        """Test unique path counting."""
        trace = make_trace(
            tools=["read"],
            file_ops=[
                ("~/a.txt", "read"),
                ("~/a.txt", "write"),  # Same path
                ("~/b.txt", "read"),
            ],
        )
        vector = vectorizer.vectorize(trace)
        
        assert vector.unique_paths_accessed == 2
    
    def test_write_read_ratio(self, vectorizer):
        """Test write/read ratio calculation."""
        trace = make_trace(
            tools=["read"],
            file_ops=[
                ("~/a.txt", "read"),
                ("~/b.txt", "read"),
                ("~/c.txt", "write"),
                ("~/d.txt", "write"),
            ],
        )
        vector = vectorizer.vectorize(trace)
        
        assert vector.write_to_read_ratio == 1.0  # 2 writes / 2 reads
    
    def test_write_only_ratio(self, vectorizer):
        """Test write-only ratio uses sentinel value."""
        trace = make_trace(
            tools=["write"],
            file_ops=[
                ("~/a.txt", "write"),
                ("~/b.txt", "write"),
            ],
        )
        vector = vectorizer.vectorize(trace)
        
        # Should use sentinel value, not infinity
        assert vector.write_to_read_ratio == 999999.0


class TestNetworkFeatures:
    """Tests for network feature extraction."""
    
    def test_network_call_count(self, vectorizer):
        """Test network call counting."""
        trace = make_trace(
            tools=["fetch"],
            network_calls=[
                ("api", "GET", "2xx"),
                ("api", "POST", "2xx"),
                ("cdn", "GET", "2xx"),
            ],
        )
        vector = vectorizer.vectorize(trace)
        
        assert vector.network_call_count == 3
    
    def test_destination_distribution(self, vectorizer):
        """Test destination class distribution."""
        trace = make_trace(
            tools=["fetch"],
            network_calls=[
                ("api", "GET", "2xx"),
                ("api", "POST", "2xx"),
                ("cdn", "GET", "2xx"),
            ],
        )
        vector = vectorizer.vectorize(trace)
        
        assert vector.destination_class_freq["api"] == 2
        assert vector.destination_class_freq["cdn"] == 1
    
    def test_error_rate(self, vectorizer):
        """Test error rate calculation."""
        trace = make_trace(
            tools=["fetch"],
            network_calls=[
                ("api", "GET", "2xx"),
                ("api", "GET", "2xx"),
                ("api", "GET", "5xx"),
                ("api", "GET", "error"),
            ],
        )
        vector = vectorizer.vectorize(trace)
        
        assert vector.error_rate == 0.5  # 2 errors out of 4


class TestDecisionFeatures:
    """Tests for decision pattern feature extraction."""
    
    def test_retry_rate(self, vectorizer):
        """Test retry rate calculation."""
        trace = make_trace(tools=["a", "b"], retries=4)
        vector = vectorizer.vectorize(trace)
        
        assert vector.total_retries == 4
        assert vector.retry_rate == 4.0  # 4 retries / 1 cycle
    
    def test_self_corrections(self, vectorizer):
        """Test self-correction tracking."""
        trace = make_trace(tools=["a"], corrections=3)
        vector = vectorizer.vectorize(trace)
        
        assert vector.total_self_corrections == 3


class TestOutputFeatures:
    """Tests for output feature extraction."""
    
    def test_stderr_ratio(self, vectorizer):
        """Test stderr ratio calculation."""
        trace = make_trace(
            tools=[],
            stdout_lines=80,
            stderr_lines=20,
        )
        vector = vectorizer.vectorize(trace)
        
        assert vector.stdout_lines == 80
        assert vector.stderr_lines == 20
        assert vector.stderr_ratio == 0.2  # 20 / 100


class TestVectorMerging:
    """Tests for vector merging."""
    
    def test_merge_single_vector(self, vectorizer):
        """Test merging single vector returns same vector."""
        vector = BehaviorVector(
            tool_sequence=["a", "b"],
            tool_frequency={"a": 1, "b": 1},
        )
        
        merged = vectorizer.merge_vectors([vector])
        
        assert merged.tool_sequence == vector.tool_sequence
    
    def test_merge_averages_frequencies(self, vectorizer):
        """Test merging averages tool frequencies."""
        v1 = BehaviorVector(tool_frequency={"a": 10, "b": 2})
        v2 = BehaviorVector(tool_frequency={"a": 20, "b": 4})
        
        merged = vectorizer.merge_vectors([v1, v2])
        
        assert merged.tool_frequency["a"] == 15  # avg of 10 and 20
        assert merged.tool_frequency["b"] == 3   # avg of 2 and 4
    
    def test_merge_averages_timing(self, vectorizer):
        """Test merging averages timing features."""
        v1 = BehaviorVector(mean_tool_duration_ms=100.0)
        v2 = BehaviorVector(mean_tool_duration_ms=200.0)
        
        merged = vectorizer.merge_vectors([v1, v2])
        
        assert merged.mean_tool_duration_ms == 150.0


class TestVarianceBounds:
    """Tests for variance bounds calculation."""
    
    def test_variance_bounds_structure(self, vectorizer):
        """Test variance bounds have correct structure."""
        vectors = [
            BehaviorVector(mean_tool_duration_ms=100.0),
            BehaviorVector(mean_tool_duration_ms=120.0),
            BehaviorVector(mean_tool_duration_ms=110.0),
        ]
        
        bounds = vectorizer.compute_variance_bounds(vectors)
        
        assert "mean_tool_duration_ms" in bounds
        assert "min" in bounds["mean_tool_duration_ms"]
        assert "max" in bounds["mean_tool_duration_ms"]
        assert "mean" in bounds["mean_tool_duration_ms"]
        assert "std" in bounds["mean_tool_duration_ms"]
    
    def test_variance_needs_multiple_vectors(self, vectorizer):
        """Test variance calculation needs multiple vectors."""
        vectors = [BehaviorVector(mean_tool_duration_ms=100.0)]
        
        bounds = vectorizer.compute_variance_bounds(vectors)
        
        # Should return empty or minimal bounds with single vector
        assert len(bounds) == 0 or all(b.get("std", 0) == 0 for b in bounds.values())


class TestDecisionFeatures:
    """Tests for decision feature extraction."""
    
    def test_retry_rate(self, vectorizer):
        """Test retry rate calculation."""
        trace = BehaviorTrace(run_id="t", start_time=0, end_time=1)
        trace.decision_cycles = [
            DecisionCycle(1, 0, 0.5, 2, 1, 0),
            DecisionCycle(2, 0.5, 1, 2, 1, 0),
        ]
        
        vector = vectorizer.vectorize(trace)
        
        assert vector.total_cycles == 2
        assert vector.total_retries == 2
        assert vector.retry_rate == 1.0
    
    def test_self_corrections(self, vectorizer):
        """Test self-correction tracking."""
        trace = BehaviorTrace(run_id="t", start_time=0, end_time=1)
        trace.decision_cycles = [
            DecisionCycle(1, 0, 1, 3, 0, 2),
        ]
        
        vector = vectorizer.vectorize(trace)
        
        assert vector.total_self_corrections == 2


class TestFullVectorization:
    """Tests for complete vectorization with all features."""
    
    def test_output_features(self, vectorizer):
        """Test output feature extraction."""
        trace = BehaviorTrace(
            run_id="t",
            start_time=0,
            end_time=1,
            stdout_line_count=50,
            stderr_line_count=5,
        )
        
        vector = vectorizer.vectorize(trace)
        
        assert vector.stdout_lines == 50
        assert vector.stderr_lines == 5
        assert 0 < vector.stderr_ratio < 1
    
    def test_file_op_frequency(self, vectorizer):
        """Test file operation frequency tracking."""
        trace = BehaviorTrace(run_id="t", start_time=0, end_time=1)
        trace.file_accesses = [
            FileAccess("a.txt", "read", 0),
            FileAccess("b.txt", "write", 0),
            FileAccess("c.txt", "read", 0),
        ]
        
        vector = vectorizer.vectorize(trace)
        
        assert vector.file_op_frequency == {"read": 2, "write": 1}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
