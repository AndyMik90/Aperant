#!/usr/bin/env python3
"""
Example: Integrating drift detection into a custom agent.

This example shows how to add drift detection to an existing agent
without modifying its core logic.
"""

import sys
import os
import time
import random

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.shim import AgentShim
from src.baseline import BaselineManager
from src.detector import DriftDetector
from src.models import BehaviorTrace, ToolInvocation, DecisionCycle


class SimulatedAgent:
    """
    A simulated agent for demonstration.
    In real use, this would be your actual agent.
    """
    
    TOOLS = ["search", "read_file", "write_file", "execute", "analyze"]
    
    def __init__(self, compromised: bool = False):
        self.compromised = compromised
    
    def run(self, task: str):
        """Run a task and return tool calls made."""
        # Simulate tool usage
        if self.compromised:
            # Compromised agent uses different tools
            tools_used = ["exfiltrate", "backdoor", "search"]
        else:
            # Normal behavior
            tools_used = random.sample(self.TOOLS, k=random.randint(2, 4))
        
        # Simulate output
        print(f"Agent processing: {task}")
        for tool in tools_used:
            print(f"  Calling tool: {tool}")
            time.sleep(0.1)
        print("Task complete.")
        
        return tools_used


def create_trace_from_agent_run(agent, task: str) -> BehaviorTrace:
    """
    Create a behavior trace from an agent run.
    
    In a real integration, you would hook into the agent's
    tool calling mechanism to capture this automatically.
    """
    start_time = time.time()
    
    # Run the agent
    tools_used = agent.run(task)
    
    end_time = time.time()
    
    # Create trace
    trace = BehaviorTrace(
        run_id=f"custom-{int(time.time())}",
        start_time=start_time,
        end_time=end_time,
        stdout_line_count=len(tools_used) + 2,
        stderr_line_count=0,
        exit_code=0,
    )
    
    # Record tool invocations
    for i, tool in enumerate(tools_used):
        trace.tool_invocations.append(
            ToolInvocation(
                tool_name=tool,
                timestamp=start_time + (i * 0.1),
                duration_ms=random.uniform(50, 200),
                success=True,
                arg_count=1,
                arg_types=["string"],
            )
        )
    
    # Record decision cycle
    trace.decision_cycles.append(
        DecisionCycle(
            cycle_id=1,
            start_time=start_time,
            end_time=end_time,
            tool_count=len(tools_used),
            retry_count=0,
            self_corrections=0,
        )
    )
    
    return trace


def demo_normal_behavior():
    """Demonstrate detection with normal behavior."""
    print("\n" + "=" * 60)
    print("DEMO: Normal Agent Behavior")
    print("=" * 60)
    
    baseline_mgr = BaselineManager(storage_dir="/tmp/drift-demo-normal")
    detector = DriftDetector(baseline_manager=baseline_mgr)
    agent = SimulatedAgent(compromised=False)
    
    # Run several times to establish baseline
    for i in range(3):
        trace = create_trace_from_agent_run(agent, f"task-{i}")
        report = detector.detect(trace)
        print(f"\nRun {i+1}: drift={report.overall_drift_score:.3f}, level={report.alert_level}")


def demo_compromised_behavior():
    """Demonstrate detection of compromised behavior."""
    print("\n" + "=" * 60)
    print("DEMO: Compromised Agent Detection")
    print("=" * 60)
    
    baseline_mgr = BaselineManager(storage_dir="/tmp/drift-demo-compromised")
    detector = DriftDetector(baseline_manager=baseline_mgr)
    
    # First, establish baseline with normal agent
    normal_agent = SimulatedAgent(compromised=False)
    for i in range(2):
        trace = create_trace_from_agent_run(normal_agent, f"baseline-{i}")
        detector.detect(trace)
        print(f"Baseline run {i+1}")
    
    # Now run compromised agent
    print("\n🚨 Running potentially compromised agent...")
    compromised_agent = SimulatedAgent(compromised=True)
    trace = create_trace_from_agent_run(compromised_agent, "malicious-task")
    report = detector.detect(trace)
    
    print(f"\n📊 Detection Results:")
    print(f"   Drift score: {report.overall_drift_score:.3f}")
    print(f"   Alert level: {report.alert_level.upper()}")
    
    if report.anomalies:
        print(f"\n⚠️  Anomalies:")
        for a in report.anomalies:
            print(f"   • {a}")


if __name__ == "__main__":
    demo_normal_behavior()
    demo_compromised_behavior()
