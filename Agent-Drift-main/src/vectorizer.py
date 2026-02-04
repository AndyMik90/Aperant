"""
Behavior vectorization - converts traces into structural vectors.
No content inspection, only structural features.
"""

import math
from typing import List, Dict, Optional, Tuple
from collections import defaultdict

from .models import BehaviorTrace, BehaviorVector, ToolInvocation


class BehaviorVectorizer:
    """
    Converts behavioral traces into structural vectors for comparison.
    Operates on structure only - never inspects content.
    """
    
    def __init__(self):
        pass
    
    def vectorize(self, trace: BehaviorTrace) -> BehaviorVector:
        """
        Convert a behavior trace into a structural vector.
        
        Args:
            trace: The behavior trace to vectorize
            
        Returns:
            BehaviorVector with structural features
        """
        vector = BehaviorVector()
        
        # Tool sequence features
        self._extract_tool_features(trace, vector)
        
        # Timing features
        self._extract_timing_features(trace, vector)
        
        # Decision cycle features
        self._extract_decision_features(trace, vector)
        
        # File access features
        self._extract_file_features(trace, vector)
        
        # Network features
        self._extract_network_features(trace, vector)
        
        # Output features
        self._extract_output_features(trace, vector)
        
        return vector
    
    def _extract_tool_features(self, trace: BehaviorTrace, vector: BehaviorVector):
        """Extract features from tool invocations."""
        tools = trace.tool_invocations
        
        if not tools:
            return
        
        # Tool sequence (ordered list of tool names)
        vector.tool_sequence = [t.tool_name for t in tools]
        
        # Tool frequency distribution
        freq = defaultdict(int)
        for t in tools:
            freq[t.tool_name] += 1
        vector.tool_frequency = dict(freq)
        
        # Tool transitions (Markov chain of tool calls)
        transitions = defaultdict(lambda: defaultdict(int))
        for i in range(len(tools) - 1):
            current = tools[i].tool_name
            next_tool = tools[i + 1].tool_name
            transitions[current][next_tool] += 1
        vector.tool_transitions = {k: dict(v) for k, v in transitions.items()}
    
    def _extract_timing_features(self, trace: BehaviorTrace, vector: BehaviorVector):
        """Extract timing-related features."""
        tools = trace.tool_invocations
        
        vector.total_duration_ms = (trace.end_time - trace.start_time) * 1000
        
        if not tools:
            return
        
        # Tool duration statistics
        durations = [t.duration_ms for t in tools]
        vector.mean_tool_duration_ms = self._mean(durations)
        vector.std_tool_duration_ms = self._std(durations)
        
        # Inter-tool delay (time between consecutive tools)
        if len(tools) > 1:
            delays = []
            for i in range(1, len(tools)):
                delay = (tools[i].timestamp - tools[i-1].timestamp) * 1000
                delay -= tools[i-1].duration_ms  # Subtract execution time
                delays.append(max(0, delay))
            
            vector.mean_inter_tool_delay_ms = self._mean(delays)
            vector.std_inter_tool_delay_ms = self._std(delays)
    
    def _extract_decision_features(self, trace: BehaviorTrace, vector: BehaviorVector):
        """Extract features from decision cycles."""
        cycles = trace.decision_cycles
        
        vector.total_cycles = len(cycles)
        
        if not cycles:
            return
        
        # Tools per cycle
        tools_per_cycle = [c.tool_count for c in cycles]
        vector.mean_tools_per_cycle = self._mean(tools_per_cycle)
        
        # Retry and correction metrics
        vector.total_retries = sum(c.retry_count for c in cycles)
        vector.total_self_corrections = sum(c.self_corrections for c in cycles)
        
        # Retry rate (retries per cycle)
        if vector.total_cycles > 0:
            vector.retry_rate = vector.total_retries / vector.total_cycles
    
    def _extract_file_features(self, trace: BehaviorTrace, vector: BehaviorVector):
        """Extract features from file access patterns."""
        accesses = trace.file_accesses
        
        if not accesses:
            return
        
        # Operation frequency
        op_freq = defaultdict(int)
        for a in accesses:
            op_freq[a.operation] += 1
        vector.file_op_frequency = dict(op_freq)
        
        # Unique paths
        unique_paths = set(a.path for a in accesses)
        vector.unique_paths_accessed = len(unique_paths)
        
        # Write to read ratio
        # Use large sentinel (999999) instead of float('inf') for JSON compatibility
        reads = op_freq.get("read", 0)
        writes = op_freq.get("write", 0) + op_freq.get("create", 0)
        if reads > 0:
            vector.write_to_read_ratio = writes / reads
        elif writes > 0:
            vector.write_to_read_ratio = 999999.0  # Sentinel for "all writes, no reads"
    
    def _extract_network_features(self, trace: BehaviorTrace, vector: BehaviorVector):
        """Extract features from network activity."""
        calls = trace.network_calls
        
        vector.network_call_count = len(calls)
        
        if not calls:
            return
        
        # Destination class distribution
        dest_freq = defaultdict(int)
        for c in calls:
            dest_freq[c.destination_class] += 1
        vector.destination_class_freq = dict(dest_freq)
        
        # Error rate
        errors = sum(1 for c in calls if c.status_class in ['4xx', '5xx', 'error', 'timeout'])
        vector.error_rate = errors / len(calls)
    
    def _extract_output_features(self, trace: BehaviorTrace, vector: BehaviorVector):
        """Extract features from stdout/stderr."""
        vector.stdout_lines = trace.stdout_line_count
        vector.stderr_lines = trace.stderr_line_count
        
        total_lines = vector.stdout_lines + vector.stderr_lines
        if total_lines > 0:
            vector.stderr_ratio = vector.stderr_lines / total_lines
    
    def _mean(self, values: List[float]) -> float:
        """Calculate mean of values."""
        if not values:
            return 0.0
        return sum(values) / len(values)
    
    def _std(self, values: List[float]) -> float:
        """Calculate standard deviation of values."""
        if len(values) < 2:
            return 0.0
        mean = self._mean(values)
        variance = sum((x - mean) ** 2 for x in values) / len(values)
        return math.sqrt(variance)
    
    def merge_vectors(self, vectors: List[BehaviorVector]) -> BehaviorVector:
        """
        Merge multiple vectors into a single representative vector.
        Used for baseline creation from multiple runs.
        
        Args:
            vectors: List of vectors to merge
            
        Returns:
            Merged representative vector
        """
        if not vectors:
            return BehaviorVector()
        
        if len(vectors) == 1:
            return vectors[0]
        
        merged = BehaviorVector()
        
        # For sequences, use the most common pattern
        # (simplified: use the longest sequence as representative)
        longest_seq = max(vectors, key=lambda v: len(v.tool_sequence))
        merged.tool_sequence = longest_seq.tool_sequence
        
        # Merge frequency distributions
        merged.tool_frequency = self._merge_frequencies(
            [v.tool_frequency for v in vectors]
        )
        
        # Merge transitions
        all_transitions = defaultdict(lambda: defaultdict(list))
        for v in vectors:
            for tool, nexts in v.tool_transitions.items():
                for next_tool, count in nexts.items():
                    all_transitions[tool][next_tool].append(count)
        
        merged.tool_transitions = {
            tool: {nt: int(self._mean(counts)) for nt, counts in nexts.items()}
            for tool, nexts in all_transitions.items()
        }
        
        # Average numeric features
        merged.mean_tool_duration_ms = self._mean([v.mean_tool_duration_ms for v in vectors])
        merged.std_tool_duration_ms = self._mean([v.std_tool_duration_ms for v in vectors])
        merged.mean_inter_tool_delay_ms = self._mean([v.mean_inter_tool_delay_ms for v in vectors])
        merged.std_inter_tool_delay_ms = self._mean([v.std_inter_tool_delay_ms for v in vectors])
        merged.total_duration_ms = self._mean([v.total_duration_ms for v in vectors])
        
        merged.total_cycles = int(self._mean([v.total_cycles for v in vectors]))
        merged.mean_tools_per_cycle = self._mean([v.mean_tools_per_cycle for v in vectors])
        merged.total_retries = int(self._mean([v.total_retries for v in vectors]))
        merged.total_self_corrections = int(self._mean([v.total_self_corrections for v in vectors]))
        merged.retry_rate = self._mean([v.retry_rate for v in vectors])
        
        merged.file_op_frequency = self._merge_frequencies(
            [v.file_op_frequency for v in vectors]
        )
        merged.unique_paths_accessed = int(self._mean([v.unique_paths_accessed for v in vectors]))
        merged.write_to_read_ratio = self._mean([
            v.write_to_read_ratio for v in vectors 
            if v.write_to_read_ratio < 999999.0  # Exclude sentinel values
        ] or [0])
        
        merged.network_call_count = int(self._mean([v.network_call_count for v in vectors]))
        merged.destination_class_freq = self._merge_frequencies(
            [v.destination_class_freq for v in vectors]
        )
        merged.error_rate = self._mean([v.error_rate for v in vectors])
        
        merged.stdout_lines = int(self._mean([v.stdout_lines for v in vectors]))
        merged.stderr_lines = int(self._mean([v.stderr_lines for v in vectors]))
        merged.stderr_ratio = self._mean([v.stderr_ratio for v in vectors])
        
        return merged
    
    def _merge_frequencies(self, freq_dicts: List[Dict[str, int]]) -> Dict[str, int]:
        """Merge frequency dictionaries by averaging."""
        all_keys = set()
        for d in freq_dicts:
            all_keys.update(d.keys())
        
        merged = {}
        for key in all_keys:
            values = [d.get(key, 0) for d in freq_dicts]
            merged[key] = int(self._mean(values))
        
        return merged
    
    def compute_variance_bounds(
        self, 
        vectors: List[BehaviorVector],
        sigma_multiplier: float = 2.0,
    ) -> Dict[str, Dict[str, float]]:
        """
        Compute variance bounds for each feature based on historical vectors.
        
        Args:
            vectors: Historical vectors
            sigma_multiplier: Number of standard deviations for bounds
            
        Returns:
            Dictionary of feature -> {min, max, mean, std}
        """
        if len(vectors) < 2:
            return {}
        
        bounds = {}
        
        # Numeric features to track
        numeric_features = [
            'mean_tool_duration_ms',
            'std_tool_duration_ms',
            'mean_inter_tool_delay_ms',
            'std_inter_tool_delay_ms',
            'total_duration_ms',
            'total_cycles',
            'mean_tools_per_cycle',
            'total_retries',
            'retry_rate',
            'unique_paths_accessed',
            'write_to_read_ratio',
            'network_call_count',
            'error_rate',
            'stdout_lines',
            'stderr_lines',
            'stderr_ratio',
        ]
        
        for feature in numeric_features:
            values = [getattr(v, feature) for v in vectors]
            values = [v for v in values if v != float('inf')]  # Filter infinities
            
            if not values:
                continue
                
            mean = self._mean(values)
            std = self._std(values)
            
            bounds[feature] = {
                'min': mean - sigma_multiplier * std,
                'max': mean + sigma_multiplier * std,
                'mean': mean,
                'std': std,
            }
        
        return bounds
