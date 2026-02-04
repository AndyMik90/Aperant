"""
Tests for canary task injection.
"""

import pytest
import tempfile
from pathlib import Path
from src.canary import (
    CanaryInjector,
    ClassificationCanary,
    ArithmeticCanary,
    SequenceCanary,
)


@pytest.fixture
def temp_dir():
    """Create a temporary directory for tests."""
    with tempfile.TemporaryDirectory() as d:
        yield d


@pytest.fixture
def canary(temp_dir):
    """Create a CanaryInjector with temp storage."""
    return CanaryInjector(storage_dir=temp_dir)


def test_classification_canary():
    """Test classification canary produces consistent output."""
    canary = ClassificationCanary()
    
    output1 = canary.execute()
    output2 = canary.execute()
    
    assert output1 == output2
    assert output1 == canary.expected_output


def test_arithmetic_canary():
    """Test arithmetic canary produces consistent output."""
    canary = ArithmeticCanary()
    
    output1 = canary.execute()
    output2 = canary.execute()
    
    assert output1 == output2
    assert output1 == canary.expected_output


def test_sequence_canary():
    """Test sequence canary produces consistent output."""
    canary = SequenceCanary()
    
    output1 = canary.execute()
    output2 = canary.execute()
    
    assert output1 == output2
    assert output1 == canary.expected_output


def test_canary_injector_first_run(canary):
    """Test canary creates baseline on first run."""
    result = canary.run_canary("classification")
    
    assert result.passed
    assert "Baseline created" in result.details


def test_canary_injector_subsequent_run(canary):
    """Test canary compares against baseline on subsequent runs."""
    # First run creates baseline
    canary.run_canary("classification")
    
    # Second run compares
    result = canary.run_canary("classification")
    
    assert result.passed
    assert result.deviation_score < 0.3


def test_canary_run_all(canary):
    """Test running all canary tasks."""
    results = canary.run_all_canaries()
    
    assert len(results) == 3
    assert all(r.passed for r in results)


def test_canary_status(canary):
    """Test canary status reporting."""
    canary.run_all_canaries()
    
    status = canary.get_canary_status()
    
    assert not status["running"]
    assert len(status["baselines"]) == 3


def test_canary_deviation_detection(temp_dir):
    """Test that deviation is detected when output changes."""
    # This test simulates what would happen if agent behavior changed
    canary = CanaryInjector(storage_dir=temp_dir)
    
    # Run to create baseline
    result1 = canary.run_canary("classification")
    assert result1.passed
    
    # Manually corrupt the baseline to simulate detection
    # (In real use, the agent's behavior would change)
    canary._baselines["classification"].expected_output_hash = "corrupted"
    
    # Run again - should detect deviation
    result2 = canary.run_canary("classification")
    
    assert result2.deviation_score > 0.3
    assert "Output hash mismatch" in result2.details
