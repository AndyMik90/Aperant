"""
Baseline management - capture and storage of known-good behavior.
Zero-config: first run is trusted.

Thread-safe with file locking to prevent corruption from concurrent access.
"""

import os
import sys
import json
import hashlib
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List
from contextlib import contextmanager

from .models import BehaviorTrace, BehaviorVector, Baseline
from .vectorizer import BehaviorVectorizer

# File locking - platform specific
try:
    import fcntl
    HAS_FCNTL = True
except ImportError:
    HAS_FCNTL = False  # Windows


class BaselineManager:
    """
    Manages the behavioral baseline for drift detection.
    Zero-config: automatically creates baseline on first run.
    
    Thread-safe: uses locks for concurrent access.
    File-safe: uses flock to prevent corruption from multiple processes.
    Poisoning-resistant: tracks original baseline checksum.
    """
    
    def __init__(
        self,
        storage_dir: Optional[str] = None,
        max_historical_vectors: int = 100,
        max_baseline_drift: float = 0.6,  # Max drift from original before warning
    ):
        self.storage_dir = Path(storage_dir or os.environ.get(
            "AGENT_DRIFT_DIR",
            os.path.expanduser("~/.agent-drift")
        ))
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        self.baseline_file = self.storage_dir / "baseline.json"
        self.lock_file = self.storage_dir / "baseline.lock"
        self.max_historical = max_historical_vectors
        self.max_baseline_drift = max_baseline_drift
        self.vectorizer = BehaviorVectorizer()
        
        self._baseline: Optional[Baseline] = None
        self._lock = threading.RLock()  # Reentrant lock for thread safety
    
    @contextmanager
    def _file_lock(self, mode='r'):
        """
        Context manager for file locking.
        Uses fcntl.flock on Unix, fallback lock file on Windows.
        """
        if HAS_FCNTL:
            # Unix file locking
            lock_fd = os.open(str(self.lock_file), os.O_RDWR | os.O_CREAT)
            try:
                fcntl.flock(lock_fd, fcntl.LOCK_EX)
                yield
            finally:
                fcntl.flock(lock_fd, fcntl.LOCK_UN)
                os.close(lock_fd)
        else:
            # Windows fallback - simple lock file
            # Not as robust but prevents basic races
            lock_path = self.lock_file
            while lock_path.exists():
                import time
                time.sleep(0.01)
            
            try:
                lock_path.touch()
                yield
            finally:
                try:
                    lock_path.unlink()
                except FileNotFoundError:
                    pass
    
    @property
    def baseline(self) -> Optional[Baseline]:
        """Get current baseline, loading from disk if needed."""
        with self._lock:
            if self._baseline is None:
                self._baseline = self._load_baseline()
            return self._baseline
    
    def has_baseline(self) -> bool:
        """Check if a baseline exists."""
        return self.baseline_file.exists()
    
    def create_baseline(self, trace: BehaviorTrace) -> Baseline:
        """
        Create a new baseline from a behavior trace.
        Called automatically on first run.
        
        Args:
            trace: The behavior trace to use as baseline
            
        Returns:
            The created Baseline
        """
        with self._lock:
            vector = self.vectorizer.vectorize(trace)
            now = datetime.now(timezone.utc).isoformat()
            
            # Compute checksum of original vector for poisoning detection
            original_checksum = self._compute_vector_checksum(vector)
            
            baseline = Baseline(
                created_at=now,
                updated_at=now,
                run_count=1,
                vector=vector,
                historical_vectors=[vector.to_dict()],
                variance_bounds={},
            )
            
            # Store original checksum in variance_bounds (hacky but backwards compatible)
            baseline.variance_bounds['_original_checksum'] = {'value': original_checksum}
            baseline.variance_bounds['_original_vector'] = vector.to_dict()
            
            self._save_baseline(baseline)
            self._baseline = baseline
            
            return baseline
    
    def update_baseline(
        self,
        trace: BehaviorTrace,
        drift_score: float,
        trust_threshold: float = 0.3,
    ) -> Baseline:
        """
        Update baseline with a new trace if it's within trust threshold.
        
        Also checks for gradual poisoning by comparing against original baseline.
        
        Args:
            trace: New behavior trace
            drift_score: The drift score for this trace
            trust_threshold: Maximum drift score to trust
            
        Returns:
            Updated baseline
        """
        with self._lock:
            if not self.has_baseline():
                return self.create_baseline(trace)
            
            baseline = self.baseline
            vector = self.vectorizer.vectorize(trace)
            
            # Only update if within trust threshold
            if drift_score <= trust_threshold:
                # Check for gradual poisoning - compare current baseline to original
                if self._is_baseline_poisoned(baseline):
                    # Don't update - baseline has drifted too far from original
                    return baseline
                
                # Add to historical vectors
                baseline.historical_vectors.append(vector.to_dict())
                
                # Trim if exceeding max
                if len(baseline.historical_vectors) > self.max_historical:
                    baseline.historical_vectors = baseline.historical_vectors[-self.max_historical:]
                
                # Recompute merged vector
                historical = [
                    BehaviorVector.from_dict(v) 
                    for v in baseline.historical_vectors
                    if '_original_checksum' not in v  # Skip metadata
                ]
                baseline.vector = self.vectorizer.merge_vectors(historical)
                
                # Recompute variance bounds (preserve original checksum)
                original_checksum = baseline.variance_bounds.get('_original_checksum', {})
                original_vector = baseline.variance_bounds.get('_original_vector', {})
                
                baseline.variance_bounds = self.vectorizer.compute_variance_bounds(historical)
                
                # Restore original tracking
                if original_checksum:
                    baseline.variance_bounds['_original_checksum'] = original_checksum
                if original_vector:
                    baseline.variance_bounds['_original_vector'] = original_vector
                
                baseline.updated_at = datetime.now(timezone.utc).isoformat()
                baseline.run_count += 1
                
                self._save_baseline(baseline)
            
            return baseline
    
    def _is_baseline_poisoned(self, baseline: Baseline) -> bool:
        """
        Check if baseline has drifted too far from its original state.
        This detects gradual poisoning attacks.
        """
        original_vector_data = baseline.variance_bounds.get('_original_vector')
        if not original_vector_data:
            return False  # No original to compare against
        
        original_vector = BehaviorVector.from_dict(original_vector_data)
        current_vector = baseline.vector
        
        # Simple drift calculation between original and current baseline
        drift = self._calculate_baseline_drift(original_vector, current_vector)
        
        if drift > self.max_baseline_drift:
            # Log warning - baseline may be compromised
            import sys
            print(f"⚠️  WARNING: Baseline drift from original: {drift:.3f} > {self.max_baseline_drift}", 
                  file=sys.stderr)
            return True
        
        return False
    
    def _calculate_baseline_drift(self, original: BehaviorVector, current: BehaviorVector) -> float:
        """Calculate drift between two vectors (simplified)."""
        scores = []
        
        # Tool set similarity
        orig_tools = set(original.tool_frequency.keys())
        curr_tools = set(current.tool_frequency.keys())
        
        if orig_tools or curr_tools:
            jaccard = len(orig_tools & curr_tools) / len(orig_tools | curr_tools) if (orig_tools | curr_tools) else 1.0
            scores.append(1.0 - jaccard)
        
        # Timing drift
        if original.mean_tool_duration_ms > 0:
            timing_diff = abs(current.mean_tool_duration_ms - original.mean_tool_duration_ms) / original.mean_tool_duration_ms
            scores.append(min(1.0, timing_diff))
        
        # Retry rate drift
        if original.retry_rate > 0 or current.retry_rate > 0:
            scores.append(abs(current.retry_rate - original.retry_rate))
        
        return sum(scores) / len(scores) if scores else 0.0
    
    def _compute_vector_checksum(self, vector: BehaviorVector) -> str:
        """Compute a checksum of a vector for integrity verification."""
        # Use sorted JSON for deterministic hashing
        data = json.dumps(vector.to_dict(), sort_keys=True)
        return hashlib.sha256(data.encode()).hexdigest()[:16]
    
    def reset_baseline(self, trace: Optional[BehaviorTrace] = None) -> Optional[Baseline]:
        """
        Reset the baseline, optionally with a new trace.
        
        Args:
            trace: Optional new trace to use as baseline
            
        Returns:
            New baseline if trace provided, None otherwise
        """
        with self._lock:
            if self.baseline_file.exists():
                # Backup old baseline
                backup_file = self.storage_dir / f"baseline.{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}.bak.json"
                self.baseline_file.rename(backup_file)
            
            self._baseline = None
            
            if trace:
                return self.create_baseline(trace)
            
            return None
    
    def get_baseline_vector(self) -> Optional[BehaviorVector]:
        """Get the current baseline vector."""
        with self._lock:
            if self.baseline:
                return self.baseline.vector
            return None
    
    def get_variance_bounds(self):
        """Get variance bounds from baseline."""
        with self._lock:
            if self.baseline:
                # Filter out internal metadata
                return {
                    k: v for k, v in self.baseline.variance_bounds.items()
                    if not k.startswith('_')
                }
            return {}
    
    def get_baseline_info(self) -> dict:
        """Get summary information about the baseline."""
        with self._lock:
            if not self.has_baseline():
                return {"exists": False}
            
            baseline = self.baseline
            
            # Check poisoning status
            poisoned = self._is_baseline_poisoned(baseline) if baseline else False
            
            return {
                "exists": True,
                "created_at": baseline.created_at,
                "updated_at": baseline.updated_at,
                "run_count": baseline.run_count,
                "historical_count": len(baseline.historical_vectors),
                "tool_count": len(baseline.vector.tool_frequency),
                "tools": list(baseline.vector.tool_frequency.keys()),
                "poisoning_warning": poisoned,
            }
    
    def _save_baseline(self, baseline: Baseline):
        """Save baseline to disk with file locking."""
        with self._lock:
            with self._file_lock('w'):
                with open(self.baseline_file, "w") as f:
                    json.dump(baseline.to_dict(), f, indent=2)
    
    def _load_baseline(self) -> Optional[Baseline]:
        """Load baseline from disk with file locking."""
        if not self.baseline_file.exists():
            return None
        
        with self._file_lock('r'):
            try:
                with open(self.baseline_file) as f:
                    data = json.load(f)
                return Baseline.from_dict(data)
            except (json.JSONDecodeError, KeyError) as e:
                # Corrupted baseline - return None
                return None
    
    def export_baseline(self, path: str):
        """Export baseline to a file."""
        with self._lock:
            if not self.has_baseline():
                raise ValueError("No baseline to export")
            
            with open(path, "w") as f:
                json.dump(self.baseline.to_dict(), f, indent=2)
    
    def import_baseline(self, path: str):
        """Import baseline from a file."""
        with self._lock:
            with open(path) as f:
                data = json.load(f)
            
            baseline = Baseline.from_dict(data)
            self._save_baseline(baseline)
            self._baseline = baseline
    
    def verify_baseline_integrity(self) -> dict:
        """
        Verify baseline integrity and check for tampering.
        
        Returns:
            Dict with integrity status and any warnings
        """
        with self._lock:
            if not self.has_baseline():
                return {"valid": False, "error": "No baseline exists"}
            
            baseline = self.baseline
            
            # Check if original checksum exists
            original_checksum = baseline.variance_bounds.get('_original_checksum', {}).get('value')
            
            if not original_checksum:
                return {
                    "valid": True,
                    "warning": "No original checksum (old baseline format)",
                }
            
            # Check for poisoning
            poisoned = self._is_baseline_poisoned(baseline)
            
            return {
                "valid": not poisoned,
                "original_checksum": original_checksum,
                "run_count": baseline.run_count,
                "poisoning_detected": poisoned,
            }
