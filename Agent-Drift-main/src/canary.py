"""
Canary task injection - constant trivial tasks for drift detection.
Provides high-signal indication of compromise even when workloads vary.
"""

import os
import time
import json
import hashlib
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, List, Callable, Any
from dataclasses import dataclass, field


@dataclass
class CanaryResult:
    """Result of a canary task execution."""
    task_id: str
    task_type: str
    timestamp: float
    duration_ms: float
    expected_output_hash: str
    actual_output_hash: str
    passed: bool
    deviation_score: float = 0.0
    details: str = ""


@dataclass
class CanaryBaseline:
    """Baseline for canary task behavior."""
    task_type: str
    expected_output_hash: str
    mean_duration_ms: float
    std_duration_ms: float
    run_count: int
    created_at: str
    updated_at: str
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_type": self.task_type,
            "expected_output_hash": self.expected_output_hash,
            "mean_duration_ms": self.mean_duration_ms,
            "std_duration_ms": self.std_duration_ms,
            "run_count": self.run_count,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CanaryBaseline":
        return cls(**data)


class CanaryTask:
    """Base class for canary tasks."""
    
    task_type: str = "base"
    
    def execute(self) -> str:
        """Execute the canary task and return output."""
        raise NotImplementedError
    
    @property
    def expected_output(self) -> str:
        """The expected output for this task."""
        raise NotImplementedError


class ClassificationCanary(CanaryTask):
    """
    Simple classification canary.
    "Classify this fixed input" - always produces same output.
    """
    
    task_type = "classification"
    
    # Fixed input that never changes
    FIXED_INPUT = "The quick brown fox jumps over the lazy dog."
    
    # Expected classification (deterministic)
    EXPECTED_CLASSIFICATION = {
        "category": "sentence",
        "language": "english",
        "sentiment": "neutral",
        "contains_animals": True,
        "word_count": 9,
    }
    
    def execute(self) -> str:
        """Execute classification on fixed input."""
        # This is a deterministic classification - no LLM needed
        result = self.EXPECTED_CLASSIFICATION.copy()
        return json.dumps(result, sort_keys=True)
    
    @property
    def expected_output(self) -> str:
        return json.dumps(self.EXPECTED_CLASSIFICATION, sort_keys=True)


class ArithmeticCanary(CanaryTask):
    """
    Simple arithmetic canary.
    Tests basic computation ability.
    """
    
    task_type = "arithmetic"
    
    # Fixed arithmetic problems
    PROBLEMS = [
        (17, 23, 40),  # a + b = c
        (100, 37, 63),  # a - b = c
        (12, 8, 96),    # a * b = c
    ]
    
    def execute(self) -> str:
        """Execute arithmetic checks."""
        results = []
        for a, b, expected in self.PROBLEMS:
            # Test addition
            if expected == a + b:
                results.append(f"{a}+{b}={expected}")
            elif expected == a - b:
                results.append(f"{a}-{b}={expected}")
            elif expected == a * b:
                results.append(f"{a}*{b}={expected}")
        return "|".join(results)
    
    @property
    def expected_output(self) -> str:
        return "17+23=40|100-37=63|12*8=96"


class SequenceCanary(CanaryTask):
    """
    Sequence completion canary.
    Tests pattern recognition stability.
    """
    
    task_type = "sequence"
    
    SEQUENCE = [1, 1, 2, 3, 5, 8, 13]
    NEXT_VALUES = [21, 34]  # Fibonacci continuation
    
    def execute(self) -> str:
        """Execute sequence completion."""
        # Simple Fibonacci check
        next_vals = []
        a, b = self.SEQUENCE[-2], self.SEQUENCE[-1]
        for _ in range(2):
            c = a + b
            next_vals.append(c)
            a, b = b, c
        return json.dumps({"sequence": self.SEQUENCE, "next": next_vals})
    
    @property
    def expected_output(self) -> str:
        return json.dumps({"sequence": self.SEQUENCE, "next": self.NEXT_VALUES})


class CanaryInjector:
    """
    Manages canary task injection and result tracking.
    """
    
    # Available canary tasks
    CANARY_TASKS = {
        "classification": ClassificationCanary,
        "arithmetic": ArithmeticCanary,
        "sequence": SequenceCanary,
    }
    
    def __init__(
        self,
        storage_dir: Optional[str] = None,
        interval_seconds: float = 60.0,
    ):
        self.storage_dir = Path(storage_dir or os.environ.get(
            "AGENT_DRIFT_DIR",
            os.path.expanduser("~/.agent-drift")
        ))
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        self.canary_file = self.storage_dir / "canary_baseline.json"
        self.results_file = self.storage_dir / "canary_results.jsonl"
        
        self.interval = float(os.environ.get(
            "AGENT_DRIFT_CANARY_INTERVAL",
            interval_seconds
        ))
        
        self._baselines: Dict[str, CanaryBaseline] = {}
        self._load_baselines()
        
        self._running = False
        self._thread: Optional[threading.Thread] = None
    
    def run_canary(self, task_type: str = "classification") -> CanaryResult:
        """
        Run a single canary task and compare against baseline.
        
        Args:
            task_type: Type of canary task to run
            
        Returns:
            CanaryResult with pass/fail status
        """
        if task_type not in self.CANARY_TASKS:
            raise ValueError(f"Unknown canary task type: {task_type}")
        
        task = self.CANARY_TASKS[task_type]()
        
        # Execute and time
        start = time.time()
        output = task.execute()
        duration_ms = (time.time() - start) * 1000
        
        # Hash outputs for comparison
        expected_hash = self._hash(task.expected_output)
        actual_hash = self._hash(output)
        
        passed = expected_hash == actual_hash
        
        # Calculate deviation score
        deviation_score = 0.0
        details = ""
        
        if task_type in self._baselines:
            baseline = self._baselines[task_type]
            
            # Check output hash
            if actual_hash != baseline.expected_output_hash:
                deviation_score += 0.5
                details += "Output hash mismatch. "
            
            # Check timing (allow 3 sigma)
            if baseline.std_duration_ms > 0:
                z_score = abs(duration_ms - baseline.mean_duration_ms) / baseline.std_duration_ms
                if z_score > 3:
                    deviation_score += min(0.3, z_score / 10)
                    details += f"Timing anomaly (z={z_score:.2f}). "
        else:
            # First run - create baseline
            self._create_baseline(task_type, actual_hash, duration_ms)
            details = "Baseline created. "
        
        if not passed:
            deviation_score = max(deviation_score, 0.8)
            details += "Output mismatch! "
        
        result = CanaryResult(
            task_id=f"{task_type}-{int(time.time())}",
            task_type=task_type,
            timestamp=time.time(),
            duration_ms=duration_ms,
            expected_output_hash=expected_hash,
            actual_output_hash=actual_hash,
            passed=passed,
            deviation_score=deviation_score,
            details=details.strip(),
        )
        
        # Save result
        self._save_result(result)
        
        # Update baseline if passed
        if passed and task_type in self._baselines:
            self._update_baseline(task_type, duration_ms)
        
        return result
    
    def run_all_canaries(self) -> List[CanaryResult]:
        """Run all canary tasks."""
        results = []
        for task_type in self.CANARY_TASKS:
            results.append(self.run_canary(task_type))
        return results
    
    def start_background_canaries(self, callback: Optional[Callable[[CanaryResult], None]] = None):
        """Start background canary execution."""
        if self._running:
            return
        
        self._running = True
        
        def run_loop():
            while self._running:
                for task_type in self.CANARY_TASKS:
                    if not self._running:
                        break
                    
                    result = self.run_canary(task_type)
                    
                    if callback and result.deviation_score > 0.3:
                        callback(result)
                    
                    time.sleep(self.interval / len(self.CANARY_TASKS))
        
        self._thread = threading.Thread(target=run_loop, daemon=True)
        self._thread.start()
    
    def stop_background_canaries(self):
        """Stop background canary execution."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5.0)
            self._thread = None
    
    def get_canary_status(self) -> Dict[str, Any]:
        """Get current canary status and recent results."""
        recent_results = self._get_recent_results(limit=10)
        
        return {
            "running": self._running,
            "interval_seconds": self.interval,
            "baselines": {k: v.to_dict() for k, v in self._baselines.items()},
            "recent_results": [
                {
                    "task_id": r.task_id,
                    "task_type": r.task_type,
                    "passed": r.passed,
                    "deviation_score": r.deviation_score,
                    "timestamp": r.timestamp,
                }
                for r in recent_results
            ],
        }
    
    def _hash(self, content: str) -> str:
        """Create deterministic hash of content."""
        return hashlib.sha256(content.encode()).hexdigest()[:16]
    
    def _create_baseline(self, task_type: str, output_hash: str, duration_ms: float):
        """Create baseline for a canary task."""
        now = datetime.now(timezone.utc).isoformat()
        
        baseline = CanaryBaseline(
            task_type=task_type,
            expected_output_hash=output_hash,
            mean_duration_ms=duration_ms,
            std_duration_ms=0.0,
            run_count=1,
            created_at=now,
            updated_at=now,
        )
        
        self._baselines[task_type] = baseline
        self._save_baselines()
    
    def _update_baseline(self, task_type: str, duration_ms: float):
        """Update baseline with new timing data."""
        baseline = self._baselines[task_type]
        
        # Update running statistics (Welford's algorithm)
        n = baseline.run_count + 1
        delta = duration_ms - baseline.mean_duration_ms
        new_mean = baseline.mean_duration_ms + delta / n
        delta2 = duration_ms - new_mean
        new_variance = (baseline.std_duration_ms ** 2 * baseline.run_count + delta * delta2) / n
        
        baseline.mean_duration_ms = new_mean
        baseline.std_duration_ms = new_variance ** 0.5
        baseline.run_count = n
        baseline.updated_at = datetime.now(timezone.utc).isoformat()
        
        self._save_baselines()
    
    def _save_baselines(self):
        """Save baselines to disk."""
        data = {k: v.to_dict() for k, v in self._baselines.items()}
        with open(self.canary_file, "w") as f:
            json.dump(data, f, indent=2)
    
    def _load_baselines(self):
        """Load baselines from disk."""
        if not self.canary_file.exists():
            return
        
        try:
            with open(self.canary_file) as f:
                data = json.load(f)
            self._baselines = {
                k: CanaryBaseline.from_dict(v) 
                for k, v in data.items()
            }
        except (json.JSONDecodeError, KeyError):
            self._baselines = {}
    
    def _save_result(self, result: CanaryResult):
        """Append result to results file."""
        with open(self.results_file, "a") as f:
            f.write(json.dumps({
                "task_id": result.task_id,
                "task_type": result.task_type,
                "timestamp": result.timestamp,
                "duration_ms": result.duration_ms,
                "passed": result.passed,
                "deviation_score": result.deviation_score,
                "details": result.details,
            }) + "\n")
    
    def _get_recent_results(self, limit: int = 10) -> List[CanaryResult]:
        """Get recent canary results."""
        if not self.results_file.exists():
            return []
        
        results = []
        with open(self.results_file) as f:
            lines = f.readlines()
        
        for line in lines[-limit:]:
            try:
                data = json.loads(line)
                results.append(CanaryResult(
                    task_id=data["task_id"],
                    task_type=data["task_type"],
                    timestamp=data["timestamp"],
                    duration_ms=data["duration_ms"],
                    expected_output_hash="",
                    actual_output_hash="",
                    passed=data["passed"],
                    deviation_score=data["deviation_score"],
                    details=data.get("details", ""),
                ))
            except (json.JSONDecodeError, KeyError):
                continue
        
        return results
