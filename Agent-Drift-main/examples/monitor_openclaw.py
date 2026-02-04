#!/usr/bin/env python3
"""
Example: Monitoring OpenClaw agent with drift detection.

This example shows how to integrate Agent Drift Detector with OpenClaw
or any other AI agent that outputs tool calls to stdout.

Usage:
    # Direct wrapping
    python monitor_openclaw.py "openclaw chat 'summarize this file'"
    
    # Or use the CLI
    agent-drift wrap "openclaw chat 'summarize this file'"
"""

import sys
import os

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.shim import AgentShim
from src.baseline import BaselineManager
from src.detector import DriftDetector
from src.canary import CanaryInjector


def monitor_agent(command: str, enable_canary: bool = False):
    """
    Monitor an agent command for behavioral drift.
    
    Args:
        command: The command to execute
        enable_canary: Whether to enable canary task injection
    """
    # Initialize components
    shim = AgentShim()
    baseline_mgr = BaselineManager()
    detector = DriftDetector(baseline_manager=baseline_mgr)
    
    # Start canary monitoring if enabled
    canary = None
    if enable_canary:
        canary = CanaryInjector()
        canary.start_background_canaries(
            callback=lambda r: print(f"\n⚠️  Canary deviation: {r.task_type} ({r.deviation_score:.2f})")
        )
    
    print(f"🔍 Monitoring: {command}")
    print("-" * 60)
    
    try:
        # Execute and capture behavior
        trace = shim.wrap_command(command)
        
        print("-" * 60)
        print(f"\n📊 Behavior Summary:")
        print(f"   Duration: {(trace.end_time - trace.start_time):.2f}s")
        print(f"   Tools called: {len(trace.tool_invocations)}")
        print(f"   Decision cycles: {len(trace.decision_cycles)}")
        print(f"   Exit code: {trace.exit_code}")
        
        # Run drift detection
        report = detector.detect(trace)
        
        # Print drift report
        print(f"\n🎯 Drift Analysis:")
        print(f"   Overall score: {report.overall_drift_score:.3f}")
        print(f"   Alert level: {report.alert_level.upper()}")
        
        if report.anomalies:
            print(f"\n⚠️  Anomalies detected:")
            for anomaly in report.anomalies[:5]:
                print(f"   • {anomaly}")
        
        return report
        
    finally:
        if canary:
            canary.stop_background_canaries()


def main():
    if len(sys.argv) < 2:
        print("Usage: python monitor_openclaw.py <command>")
        print("Example: python monitor_openclaw.py \"openclaw chat 'hello'\"")
        sys.exit(1)
    
    command = " ".join(sys.argv[1:])
    report = monitor_agent(command, enable_canary=True)
    
    # Exit with appropriate code
    if report.alert_level == "critical":
        sys.exit(2)
    elif report.alert_level == "warning":
        sys.exit(1)


if __name__ == "__main__":
    main()
