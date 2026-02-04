"""
Drift detection - compares behavior vectors against baseline.
Uses deterministic distance metrics for auditability.
"""

import os
import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from collections import Counter

from .models import BehaviorTrace, BehaviorVector, Baseline, DriftReport
from .baseline import BaselineManager
from .vectorizer import BehaviorVectorizer


class DriftDetector:
    """
    Detects behavioral drift by comparing vectors against baseline.
    Uses deterministic, auditable distance metrics.
    """
    
    # Component weights for overall score
    COMPONENT_WEIGHTS = {
        'tool_sequence': 0.25,
        'tool_frequency': 0.20,
        'timing': 0.15,
        'decision': 0.15,
        'file_access': 0.10,
        'network': 0.10,
        'output': 0.05,
    }
    
    def __init__(
        self,
        baseline_manager: BaselineManager,
        alert_threshold: float = 0.5,
        warning_threshold: float = 0.3,
    ):
        self.baseline_manager = baseline_manager
        self.vectorizer = BehaviorVectorizer()
        self.alert_threshold = float(os.environ.get(
            'AGENT_DRIFT_ALERT_THRESHOLD',
            alert_threshold
        ))
        self.warning_threshold = warning_threshold
    
    def detect(self, trace: BehaviorTrace) -> DriftReport:
        """
        Detect drift in a behavior trace.
        
        Args:
            trace: The behavior trace to analyze
            
        Returns:
            DriftReport with scores and anomalies
        """
        current_vector = self.vectorizer.vectorize(trace)
        
        # Check if baseline exists
        if not self.baseline_manager.has_baseline():
            # First run - create baseline
            self.baseline_manager.create_baseline(trace)
            return DriftReport(
                run_id=trace.run_id,
                timestamp=datetime.now(timezone.utc).isoformat(),
                overall_drift_score=0.0,
                component_scores={},
                anomalies=["First run - baseline created"],
                alert_level="normal",
            )
        
        baseline_vector = self.baseline_manager.get_baseline_vector()
        variance_bounds = self.baseline_manager.get_variance_bounds()
        
        # Calculate component scores
        component_scores = {}
        anomalies = []
        
        # Tool sequence drift
        seq_score, seq_anomalies = self._compare_tool_sequence(
            current_vector, baseline_vector
        )
        component_scores['tool_sequence'] = seq_score
        anomalies.extend(seq_anomalies)
        
        # Tool frequency drift
        freq_score, freq_anomalies = self._compare_tool_frequency(
            current_vector, baseline_vector
        )
        component_scores['tool_frequency'] = freq_score
        anomalies.extend(freq_anomalies)
        
        # Timing drift
        timing_score, timing_anomalies = self._compare_timing(
            current_vector, baseline_vector, variance_bounds
        )
        component_scores['timing'] = timing_score
        anomalies.extend(timing_anomalies)
        
        # Decision pattern drift
        decision_score, decision_anomalies = self._compare_decision_patterns(
            current_vector, baseline_vector, variance_bounds
        )
        component_scores['decision'] = decision_score
        anomalies.extend(decision_anomalies)
        
        # File access drift
        file_score, file_anomalies = self._compare_file_access(
            current_vector, baseline_vector
        )
        component_scores['file_access'] = file_score
        anomalies.extend(file_anomalies)
        
        # Network drift
        network_score, network_anomalies = self._compare_network(
            current_vector, baseline_vector
        )
        component_scores['network'] = network_score
        anomalies.extend(network_anomalies)
        
        # Output drift
        output_score, output_anomalies = self._compare_output(
            current_vector, baseline_vector, variance_bounds
        )
        component_scores['output'] = output_score
        anomalies.extend(output_anomalies)
        
        # Calculate weighted overall score
        overall_score = sum(
            component_scores.get(comp, 0) * weight
            for comp, weight in self.COMPONENT_WEIGHTS.items()
        )
        
        # Determine alert level
        if overall_score >= self.alert_threshold:
            alert_level = "critical"
        elif overall_score >= self.warning_threshold:
            alert_level = "warning"
        else:
            alert_level = "normal"
        
        report = DriftReport(
            run_id=trace.run_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            overall_drift_score=round(overall_score, 4),
            component_scores={k: round(v, 4) for k, v in component_scores.items()},
            anomalies=anomalies,
            alert_level=alert_level,
        )
        
        # Update baseline if within trust threshold
        self.baseline_manager.update_baseline(trace, overall_score)
        
        return report
    
    def _compare_tool_sequence(
        self,
        current: BehaviorVector,
        baseline: BehaviorVector,
    ) -> Tuple[float, List[str]]:
        """Compare tool call sequences."""
        anomalies = []
        
        if not baseline.tool_sequence and not current.tool_sequence:
            return 0.0, anomalies
        
        if not baseline.tool_sequence:
            if current.tool_sequence:
                anomalies.append(f"New tool sequence appeared: {current.tool_sequence[:5]}...")
                return 0.8, anomalies
            return 0.0, anomalies
        
        if not current.tool_sequence:
            anomalies.append("No tools called (baseline has tools)")
            return 0.6, anomalies
        
        # Longest common subsequence similarity
        lcs_len = self._lcs_length(current.tool_sequence, baseline.tool_sequence)
        max_len = max(len(current.tool_sequence), len(baseline.tool_sequence))
        similarity = lcs_len / max_len if max_len > 0 else 1.0
        
        # Check for new tools
        current_tools = set(current.tool_sequence)
        baseline_tools = set(baseline.tool_sequence)
        new_tools = current_tools - baseline_tools
        missing_tools = baseline_tools - current_tools
        
        if new_tools:
            anomalies.append(f"New tools used: {new_tools}")
        if missing_tools:
            anomalies.append(f"Expected tools not used: {missing_tools}")
        
        # Convert similarity to drift score
        drift_score = 1.0 - similarity
        
        # Penalize new tools more heavily
        if new_tools:
            drift_score = min(1.0, drift_score + 0.2 * len(new_tools))
        
        return drift_score, anomalies
    
    def _compare_tool_frequency(
        self,
        current: BehaviorVector,
        baseline: BehaviorVector,
    ) -> Tuple[float, List[str]]:
        """Compare tool frequency distributions using KL divergence."""
        anomalies = []
        
        if not baseline.tool_frequency and not current.tool_frequency:
            return 0.0, anomalies
        
        # Get all tools
        all_tools = set(baseline.tool_frequency.keys()) | set(current.tool_frequency.keys())
        
        if not all_tools:
            return 0.0, anomalies
        
        # Normalize to probability distributions
        baseline_total = sum(baseline.tool_frequency.values()) or 1
        current_total = sum(current.tool_frequency.values()) or 1
        
        baseline_dist = {t: baseline.tool_frequency.get(t, 0) / baseline_total for t in all_tools}
        current_dist = {t: current.tool_frequency.get(t, 0) / current_total for t in all_tools}
        
        # KL divergence (with smoothing)
        epsilon = 1e-10
        kl_div = 0.0
        for t in all_tools:
            p = current_dist[t] + epsilon
            q = baseline_dist[t] + epsilon
            kl_div += p * math.log(p / q)
        
        # Check for frequency anomalies
        for tool in all_tools:
            baseline_pct = baseline_dist[tool] * 100
            current_pct = current_dist[tool] * 100
            
            if baseline_pct > 5 and current_pct < 1:
                anomalies.append(f"Tool '{tool}' frequency dropped: {baseline_pct:.1f}% -> {current_pct:.1f}%")
            elif current_pct > baseline_pct * 3 and current_pct > 10:
                anomalies.append(f"Tool '{tool}' frequency spiked: {baseline_pct:.1f}% -> {current_pct:.1f}%")
        
        # Normalize KL divergence to 0-1 range (using sigmoid-like transform)
        drift_score = min(1.0, kl_div / (1 + kl_div))
        
        return drift_score, anomalies
    
    def _compare_timing(
        self,
        current: BehaviorVector,
        baseline: BehaviorVector,
        variance_bounds: Dict,
    ) -> Tuple[float, List[str]]:
        """Compare timing features."""
        anomalies = []
        scores = []
        
        timing_features = [
            ('mean_tool_duration_ms', 'Tool duration'),
            ('mean_inter_tool_delay_ms', 'Inter-tool delay'),
            ('total_duration_ms', 'Total duration'),
        ]
        
        for feature, name in timing_features:
            current_val = getattr(current, feature)
            baseline_val = getattr(baseline, feature)
            
            if baseline_val == 0:
                if current_val > 0:
                    scores.append(0.3)
                continue
            
            # Check against variance bounds
            bounds = variance_bounds.get(feature, {})
            if bounds:
                if current_val < bounds['min'] or current_val > bounds['max']:
                    ratio = abs(current_val - bounds['mean']) / (bounds['std'] or 1)
                    if ratio > 3:
                        anomalies.append(f"{name} outside bounds: {current_val:.1f}ms (expected {bounds['min']:.1f}-{bounds['max']:.1f})")
            
            # Relative difference
            diff = abs(current_val - baseline_val) / baseline_val
            scores.append(min(1.0, diff))
        
        return sum(scores) / len(scores) if scores else 0.0, anomalies
    
    def _compare_decision_patterns(
        self,
        current: BehaviorVector,
        baseline: BehaviorVector,
        variance_bounds: Dict,
    ) -> Tuple[float, List[str]]:
        """Compare decision cycle patterns."""
        anomalies = []
        scores = []
        
        # Retry rate comparison
        if baseline.retry_rate > 0 or current.retry_rate > 0:
            diff = abs(current.retry_rate - baseline.retry_rate)
            if current.retry_rate > baseline.retry_rate * 2 and current.retry_rate > 0.3:
                anomalies.append(f"Retry rate increased significantly: {baseline.retry_rate:.2f} -> {current.retry_rate:.2f}")
            scores.append(min(1.0, diff))
        
        # Tools per cycle
        if baseline.mean_tools_per_cycle > 0:
            diff = abs(current.mean_tools_per_cycle - baseline.mean_tools_per_cycle)
            relative_diff = diff / baseline.mean_tools_per_cycle
            scores.append(min(1.0, relative_diff))
        
        # Self-correction rate
        baseline_correction_rate = baseline.total_self_corrections / max(baseline.total_cycles, 1)
        current_correction_rate = current.total_self_corrections / max(current.total_cycles, 1)
        
        if current_correction_rate > baseline_correction_rate * 2 and current_correction_rate > 0.2:
            anomalies.append(f"Self-correction rate spiked: {baseline_correction_rate:.2f} -> {current_correction_rate:.2f}")
            scores.append(0.5)
        
        return sum(scores) / len(scores) if scores else 0.0, anomalies
    
    def _compare_file_access(
        self,
        current: BehaviorVector,
        baseline: BehaviorVector,
    ) -> Tuple[float, List[str]]:
        """Compare file access patterns."""
        anomalies = []
        scores = []
        
        # Both have no file access - that's fine
        if not baseline.file_op_frequency and not current.file_op_frequency:
            return 0.0, anomalies
        
        # Baseline has file access but current doesn't
        if baseline.file_op_frequency and not current.file_op_frequency:
            anomalies.append("No file access (baseline has file operations)")
            return 0.3, anomalies
        
        # Current has file access but baseline doesn't - suspicious!
        if not baseline.file_op_frequency and current.file_op_frequency:
            anomalies.append(f"New file access pattern emerged: {current.unique_paths_accessed} paths")
            return 0.5, anomalies
        
        # Check for new operation types
        baseline_ops = set(baseline.file_op_frequency.keys())
        current_ops = set(current.file_op_frequency.keys())
        
        new_ops = current_ops - baseline_ops
        if new_ops:
            anomalies.append(f"New file operations: {new_ops}")
            scores.append(0.3 * len(new_ops))
        
        # Write ratio change
        if baseline.write_to_read_ratio > 0:
            ratio_diff = abs(current.write_to_read_ratio - baseline.write_to_read_ratio) / baseline.write_to_read_ratio
            if current.write_to_read_ratio > baseline.write_to_read_ratio * 2:
                anomalies.append(f"Write/read ratio increased: {baseline.write_to_read_ratio:.2f} -> {current.write_to_read_ratio:.2f}")
            scores.append(min(0.4, ratio_diff))
        elif current.write_to_read_ratio > 0:
            # Started writing when baseline only read
            anomalies.append("Write operations appeared (baseline was read-only)")
            scores.append(0.4)
        
        # Unique paths change - detect access scope creep
        if baseline.unique_paths_accessed > 0:
            path_ratio = current.unique_paths_accessed / baseline.unique_paths_accessed
            if path_ratio > 2:
                anomalies.append(f"Accessing many more paths: {baseline.unique_paths_accessed} -> {current.unique_paths_accessed}")
                scores.append(min(0.5, (path_ratio - 1) * 0.25))
            elif path_ratio < 0.3:
                # Accessing far fewer paths might also be suspicious
                scores.append(0.2)
        elif current.unique_paths_accessed > 0:
            # Started accessing paths when baseline didn't
            scores.append(0.3)
        
        # Total operation count change
        baseline_total = sum(baseline.file_op_frequency.values())
        current_total = sum(current.file_op_frequency.values())
        
        if baseline_total > 0 and current_total > 0:
            op_ratio = current_total / baseline_total
            if op_ratio > 3:
                anomalies.append(f"File operation count spiked: {baseline_total} -> {current_total}")
                scores.append(min(0.4, (op_ratio - 1) * 0.1))
        
        return min(1.0, sum(scores) / max(len(scores), 1)), anomalies
    
    def _compare_network(
        self,
        current: BehaviorVector,
        baseline: BehaviorVector,
    ) -> Tuple[float, List[str]]:
        """Compare network activity patterns."""
        anomalies = []
        
        if baseline.network_call_count == 0 and current.network_call_count == 0:
            return 0.0, anomalies
        
        scores = []
        
        # Network call count change
        if baseline.network_call_count > 0:
            count_ratio = current.network_call_count / baseline.network_call_count
            if count_ratio > 2:
                anomalies.append(f"Network calls increased: {baseline.network_call_count} -> {current.network_call_count}")
            scores.append(min(1.0, abs(count_ratio - 1)))
        elif current.network_call_count > 0:
            anomalies.append(f"New network activity: {current.network_call_count} calls")
            scores.append(0.5)
        
        # Destination class changes
        baseline_dests = set(baseline.destination_class_freq.keys())
        current_dests = set(current.destination_class_freq.keys())
        
        new_dests = current_dests - baseline_dests
        if new_dests:
            anomalies.append(f"New network destinations: {new_dests}")
            scores.append(0.4)
        
        # Error rate change
        if current.error_rate > baseline.error_rate * 2 and current.error_rate > 0.1:
            anomalies.append(f"Network error rate increased: {baseline.error_rate:.2%} -> {current.error_rate:.2%}")
            scores.append(0.3)
        
        return sum(scores) / len(scores) if scores else 0.0, anomalies
    
    def _compare_output(
        self,
        current: BehaviorVector,
        baseline: BehaviorVector,
        variance_bounds: Dict,
    ) -> Tuple[float, List[str]]:
        """Compare stdout/stderr patterns."""
        anomalies = []
        scores = []
        
        # Stderr ratio change
        if current.stderr_ratio > baseline.stderr_ratio * 2 and current.stderr_ratio > 0.2:
            anomalies.append(f"Stderr ratio increased: {baseline.stderr_ratio:.2%} -> {current.stderr_ratio:.2%}")
            scores.append(0.4)
        
        # Output volume change
        baseline_total = baseline.stdout_lines + baseline.stderr_lines
        current_total = current.stdout_lines + current.stderr_lines
        
        if baseline_total > 0:
            volume_ratio = current_total / baseline_total
            if volume_ratio > 3 or volume_ratio < 0.3:
                anomalies.append(f"Output volume changed significantly: {baseline_total} -> {current_total} lines")
                scores.append(min(1.0, abs(volume_ratio - 1) / 2))
        
        return sum(scores) / len(scores) if scores else 0.0, anomalies
    
    def _lcs_length(self, seq1: List[str], seq2: List[str], max_len: int = 200) -> int:
        """
        Calculate longest common subsequence length.
        
        Capped at max_len to avoid O(n*m) blowup on very long sequences.
        For sequences > max_len, we sample evenly to approximate.
        """
        # Cap sequences to avoid O(n*m) explosion
        if len(seq1) > max_len:
            step = len(seq1) // max_len
            seq1 = seq1[::step][:max_len]
        if len(seq2) > max_len:
            step = len(seq2) // max_len
            seq2 = seq2[::step][:max_len]
        
        m, n = len(seq1), len(seq2)
        dp = [[0] * (n + 1) for _ in range(m + 1)]
        
        for i in range(1, m + 1):
            for j in range(1, n + 1):
                if seq1[i-1] == seq2[j-1]:
                    dp[i][j] = dp[i-1][j-1] + 1
                else:
                    dp[i][j] = max(dp[i-1][j], dp[i][j-1])
        
        return dp[m][n]
