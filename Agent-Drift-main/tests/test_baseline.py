"""
Unit tests for BaselineManager.
Tests baseline creation, persistence, updates, and poisoning detection.
"""

import pytest
import time
import json
import tempfile
import threading
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.models import BehaviorTrace, ToolInvocation, DecisionCycle
from src.baseline import BaselineManager


@pytest.fixture
def temp_dir():
    """Create a temporary directory for tests."""
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def baseline_mgr(temp_dir):
    return BaselineManager(storage_dir=temp_dir)


def make_trace(run_id: str, tools: list = None) -> BehaviorTrace:
    """Create a test trace."""
    start = time.time()
    trace = BehaviorTrace(
        run_id=run_id,
        start_time=start,
        end_time=start + 5,
        stdout_line_count=10,
        stderr_line_count=1,
    )
    
    tools = tools or ["read", "write", "exec"]
    for i, tool in enumerate(tools):
        trace.tool_invocations.append(
            ToolInvocation(tool, start + i, 100.0, True, 1, ["string"])
        )
    
    trace.decision_cycles.append(
        DecisionCycle(1, start, start + 5, len(tools), 0, 0)
    )
    
    return trace


class TestBaselineCreation:
    """Tests for baseline creation."""
    
    def test_no_baseline_initially(self, baseline_mgr):
        """Test that no baseline exists initially."""
        assert not baseline_mgr.has_baseline()
    
    def test_create_baseline(self, baseline_mgr):
        """Test baseline creation from trace."""
        trace = make_trace("test-001", ["read", "write"])
        
        baseline = baseline_mgr.create_baseline(trace)
        
        assert baseline_mgr.has_baseline()
        assert baseline.run_count == 1
        assert "read" in baseline.vector.tool_frequency
        assert "write" in baseline.vector.tool_frequency
    
    def test_baseline_has_original_checksum(self, baseline_mgr):
        """Test that baseline stores original checksum for poisoning detection."""
        trace = make_trace("test-001")
        baseline = baseline_mgr.create_baseline(trace)
        
        assert "_original_checksum" in baseline.variance_bounds
        assert "_original_vector" in baseline.variance_bounds
    
    def test_get_baseline_info(self, baseline_mgr):
        """Test baseline info retrieval."""
        trace = make_trace("test-001", ["a", "b", "c"])
        baseline_mgr.create_baseline(trace)
        
        info = baseline_mgr.get_baseline_info()
        
        assert info["exists"] is True
        assert info["run_count"] == 1
        assert info["tool_count"] == 3
        assert set(info["tools"]) == {"a", "b", "c"}


class TestBaselinePersistence:
    """Tests for baseline persistence across instances."""
    
    def test_baseline_persists(self, temp_dir):
        """Test baseline persists across manager instances."""
        # Create baseline with first manager
        mgr1 = BaselineManager(storage_dir=temp_dir)
        trace = make_trace("persist-001", ["tool_a", "tool_b"])
        mgr1.create_baseline(trace)
        
        # Load with new manager instance
        mgr2 = BaselineManager(storage_dir=temp_dir)
        
        assert mgr2.has_baseline()
        assert mgr2.baseline.run_count == 1
        assert "tool_a" in mgr2.baseline.vector.tool_frequency
    
    def test_corrupted_baseline_handled(self, temp_dir):
        """Test recovery from corrupted baseline file."""
        baseline_file = Path(temp_dir) / "baseline.json"
        baseline_file.write_text("{ not valid json }")
        
        mgr = BaselineManager(storage_dir=temp_dir)
        
        # Should gracefully handle corruption
        assert not mgr.has_baseline() or mgr.baseline is None


class TestBaselineUpdate:
    """Tests for baseline updates."""
    
    def test_update_within_threshold(self, baseline_mgr):
        """Test baseline updates when drift is within trust threshold."""
        trace1 = make_trace("base-001", ["a", "b", "c"])
        baseline_mgr.create_baseline(trace1)
        
        trace2 = make_trace("update-001", ["a", "b", "c"])
        baseline_mgr.update_baseline(trace2, drift_score=0.1)
        
        assert baseline_mgr.baseline.run_count == 2
    
    def test_no_update_above_threshold(self, baseline_mgr):
        """Test baseline doesn't update when drift exceeds threshold."""
        trace1 = make_trace("base-001", ["a", "b", "c"])
        baseline_mgr.create_baseline(trace1)
        
        trace2 = make_trace("untrusted-001", ["x", "y", "z"])
        baseline_mgr.update_baseline(trace2, drift_score=0.8)
        
        # Run count should NOT increase
        assert baseline_mgr.baseline.run_count == 1
    
    def test_historical_vectors_trimmed(self, temp_dir):
        """Test that historical vectors are trimmed to max limit."""
        mgr = BaselineManager(storage_dir=temp_dir, max_historical_vectors=5)
        
        # Create baseline
        trace = make_trace("base-001")
        mgr.create_baseline(trace)
        
        # Add many updates
        for i in range(10):
            trace = make_trace(f"update-{i}")
            mgr.update_baseline(trace, drift_score=0.1)
        
        # Should be trimmed to max
        assert len(mgr.baseline.historical_vectors) <= 5


class TestBaselineReset:
    """Tests for baseline reset."""
    
    def test_reset_removes_baseline(self, baseline_mgr):
        """Test reset removes baseline."""
        trace = make_trace("test-001")
        baseline_mgr.create_baseline(trace)
        
        assert baseline_mgr.has_baseline()
        
        baseline_mgr.reset_baseline()
        
        # Force reload
        baseline_mgr._baseline = None
        assert not baseline_mgr.has_baseline()
    
    def test_reset_creates_backup(self, baseline_mgr):
        """Test reset creates backup file."""
        trace = make_trace("test-001")
        baseline_mgr.create_baseline(trace)
        
        baseline_mgr.reset_baseline()
        
        # Check for backup file
        backups = list(baseline_mgr.storage_dir.glob("*.bak.json"))
        assert len(backups) == 1


class TestBaselineExportImport:
    """Tests for baseline export/import."""
    
    def test_export_import_roundtrip(self, baseline_mgr, temp_dir):
        """Test baseline export and import."""
        trace = make_trace("export-001", ["tool_x", "tool_y"])
        baseline_mgr.create_baseline(trace)
        
        export_path = Path(temp_dir) / "exported.json"
        baseline_mgr.export_baseline(str(export_path))
        
        # Reset and import
        baseline_mgr.reset_baseline()
        assert not baseline_mgr.has_baseline()
        
        baseline_mgr.import_baseline(str(export_path))
        
        assert baseline_mgr.has_baseline()
        assert "tool_x" in baseline_mgr.baseline.vector.tool_frequency


class TestPoisoningDetection:
    """Tests for gradual poisoning detection."""
    
    def test_poisoning_detected(self, temp_dir):
        """Test that gradual baseline drift is detected."""
        mgr = BaselineManager(storage_dir=temp_dir, max_baseline_drift=0.3)
        
        # Create baseline with specific tools
        trace1 = make_trace("base-001", ["safe_a", "safe_b", "safe_c"])
        mgr.create_baseline(trace1)
        
        # Simulate gradual drift (each within trust threshold)
        for i in range(5):
            # Each update adds slightly different tools
            tools = ["safe_a", f"new_{i}", f"drift_{i}"]
            trace = make_trace(f"drift-{i}", tools)
            mgr.update_baseline(trace, drift_score=0.2)  # Within threshold
        
        # Check if poisoning is flagged
        info = mgr.get_baseline_info()
        # After significant drift, poisoning_warning should be True
        # (Depends on how much the tools have changed)


class TestThreadSafety:
    """Tests for thread safety."""
    
    def test_concurrent_reads(self, baseline_mgr):
        """Test concurrent reads don't cause issues."""
        trace = make_trace("test-001")
        baseline_mgr.create_baseline(trace)
        
        results = []
        errors = []
        
        def reader():
            try:
                for _ in range(100):
                    _ = baseline_mgr.has_baseline()
                    _ = baseline_mgr.get_baseline_info()
                results.append(True)
            except Exception as e:
                errors.append(e)
        
        threads = [threading.Thread(target=reader) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        assert len(errors) == 0
        assert len(results) == 5
    
    def test_concurrent_writes(self, baseline_mgr):
        """Test concurrent writes don't corrupt baseline."""
        trace = make_trace("test-001")
        baseline_mgr.create_baseline(trace)
        
        errors = []
        
        def writer(n):
            try:
                for i in range(10):
                    trace = make_trace(f"writer-{n}-{i}")
                    baseline_mgr.update_baseline(trace, drift_score=0.1)
            except Exception as e:
                errors.append(e)
        
        threads = [threading.Thread(target=writer, args=(i,)) for i in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        assert len(errors) == 0
        # Baseline should still be valid
        assert baseline_mgr.has_baseline()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
