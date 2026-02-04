#!/usr/bin/env python3
"""
Command-line interface for Agent Drift.
"""

import sys
import os
import json
import argparse
from datetime import datetime
from pathlib import Path

from .shim import AgentShim
from .baseline import BaselineManager
from .detector import DriftDetector
from .vectorizer import BehaviorVectorizer
from .canary import CanaryInjector


# Optional dashboard import (requires flask)
try:
    from .dashboard import DriftDashboard
    DASHBOARD_AVAILABLE = True
except ImportError:
    DASHBOARD_AVAILABLE = False


def get_storage_dir() -> Path:
    """Get the storage directory."""
    return Path(os.environ.get(
        "AGENT_DRIFT_DIR",
        os.path.expanduser("~/.agent-drift")
    ))


def cmd_wrap(args):
    """Wrap and monitor an agent command."""
    storage_dir = get_storage_dir()
    
    # Initialize components
    shim = AgentShim(storage_dir=str(storage_dir))
    baseline_mgr = BaselineManager(storage_dir=str(storage_dir))
    detector = DriftDetector(baseline_manager=baseline_mgr)
    
    # Start canary if requested
    canary = None
    if args.canary:
        canary = CanaryInjector(storage_dir=str(storage_dir))
        canary.start_background_canaries(
            callback=lambda r: print(f"\n⚠️  Canary alert: {r.task_type} - {r.details}")
        )
    
    print(f"🔍 Agent Drift wrapping: {args.command}")
    print(f"   Storage: {storage_dir}")
    
    if not baseline_mgr.has_baseline():
        print("   📝 First run - will create baseline")
    
    print("-" * 60)
    
    try:
        # Execute wrapped command
        trace = shim.wrap_command(" ".join(args.command))
        
        print("-" * 60)
        
        # Detect drift
        report = detector.detect(trace)
        
        # Print report
        print_drift_report(report)
        
        # Return appropriate exit code
        if report.alert_level == "critical":
            sys.exit(2)
        elif report.alert_level == "warning":
            sys.exit(1)
        else:
            sys.exit(trace.exit_code)
            
    finally:
        if canary:
            canary.stop_background_canaries()


def cmd_status(args):
    """Show current drift detection status."""
    storage_dir = get_storage_dir()
    baseline_mgr = BaselineManager(storage_dir=str(storage_dir))
    
    print("🔍 Agent Drift Status")
    print("=" * 40)
    
    # Baseline info
    info = baseline_mgr.get_baseline_info()
    if info["exists"]:
        print(f"✅ Baseline: EXISTS")
        print(f"   Created: {info['created_at']}")
        print(f"   Updated: {info['updated_at']}")
        print(f"   Runs: {info['run_count']}")
        print(f"   Tools tracked: {info['tool_count']}")
        if info['tools']:
            print(f"   Tools: {', '.join(info['tools'][:10])}")
    else:
        print("❌ Baseline: NOT FOUND")
        print("   Run 'agent-drift wrap <command>' to create one")
    
    # Recent traces
    shim = AgentShim(storage_dir=str(storage_dir))
    traces = shim.get_recent_traces(limit=5)
    
    if traces:
        print(f"\n📊 Recent Traces: {len(traces)}")
        for t in traces[:3]:
            duration = (t.end_time - t.start_time)
            print(f"   - {t.run_id}: {len(t.tool_invocations)} tools, {duration:.2f}s")
    
    # Canary status
    canary = CanaryInjector(storage_dir=str(storage_dir))
    canary_status = canary.get_canary_status()
    
    if canary_status['baselines']:
        print(f"\n🐤 Canary Tasks: {len(canary_status['baselines'])}")
        for task_type, baseline in canary_status['baselines'].items():
            print(f"   - {task_type}: {baseline['run_count']} runs")


def cmd_baseline_show(args):
    """Show the current baseline."""
    storage_dir = get_storage_dir()
    baseline_mgr = BaselineManager(storage_dir=str(storage_dir))
    
    if not baseline_mgr.has_baseline():
        print("❌ No baseline exists")
        sys.exit(1)
    
    baseline = baseline_mgr.baseline
    
    if args.json:
        print(json.dumps(baseline.to_dict(), indent=2))
        return
    
    print("📊 Baseline Summary")
    print("=" * 40)
    print(f"Created: {baseline.created_at}")
    print(f"Updated: {baseline.updated_at}")
    print(f"Runs: {baseline.run_count}")
    print(f"Historical vectors: {len(baseline.historical_vectors)}")
    
    v = baseline.vector
    
    print(f"\n🔧 Tools:")
    for tool, count in sorted(v.tool_frequency.items(), key=lambda x: -x[1]):
        print(f"   {tool}: {count}")
    
    print(f"\n⏱️  Timing:")
    print(f"   Mean tool duration: {v.mean_tool_duration_ms:.2f}ms")
    print(f"   Mean inter-tool delay: {v.mean_inter_tool_delay_ms:.2f}ms")
    print(f"   Total duration: {v.total_duration_ms:.2f}ms")
    
    print(f"\n🔄 Decision Patterns:")
    print(f"   Total cycles: {v.total_cycles}")
    print(f"   Tools per cycle: {v.mean_tools_per_cycle:.2f}")
    print(f"   Retry rate: {v.retry_rate:.2%}")
    
    if v.file_op_frequency:
        print(f"\n📁 File Operations:")
        for op, count in v.file_op_frequency.items():
            print(f"   {op}: {count}")
    
    if v.network_call_count > 0:
        print(f"\n🌐 Network:")
        print(f"   Total calls: {v.network_call_count}")
        print(f"   Error rate: {v.error_rate:.2%}")


def cmd_baseline_reset(args):
    """Reset the baseline."""
    storage_dir = get_storage_dir()
    baseline_mgr = BaselineManager(storage_dir=str(storage_dir))
    
    if not baseline_mgr.has_baseline():
        print("❌ No baseline to reset")
        sys.exit(1)
    
    if not args.force:
        response = input("⚠️  This will delete the current baseline. Continue? [y/N] ")
        if response.lower() != 'y':
            print("Cancelled.")
            sys.exit(0)
    
    baseline_mgr.reset_baseline()
    print("✅ Baseline reset. Next run will create new baseline.")


def cmd_baseline_export(args):
    """Export baseline to file."""
    storage_dir = get_storage_dir()
    baseline_mgr = BaselineManager(storage_dir=str(storage_dir))
    
    if not baseline_mgr.has_baseline():
        print("❌ No baseline to export")
        sys.exit(1)
    
    baseline_mgr.export_baseline(args.output)
    print(f"✅ Baseline exported to: {args.output}")


def cmd_baseline_import(args):
    """Import baseline from file."""
    storage_dir = get_storage_dir()
    baseline_mgr = BaselineManager(storage_dir=str(storage_dir))
    
    if baseline_mgr.has_baseline() and not args.force:
        response = input("⚠️  This will overwrite the existing baseline. Continue? [y/N] ")
        if response.lower() != 'y':
            print("Cancelled.")
            sys.exit(0)
    
    baseline_mgr.import_baseline(args.input)
    print(f"✅ Baseline imported from: {args.input}")


def cmd_canary(args):
    """Run canary tasks."""
    storage_dir = get_storage_dir()
    canary = CanaryInjector(storage_dir=str(storage_dir))
    
    if args.task:
        results = [canary.run_canary(args.task)]
    else:
        results = canary.run_all_canaries()
    
    print("🐤 Canary Results")
    print("=" * 40)
    
    for r in results:
        status = "✅ PASS" if r.passed else "❌ FAIL"
        print(f"\n{r.task_type}:")
        print(f"   Status: {status}")
        print(f"   Duration: {r.duration_ms:.2f}ms")
        print(f"   Deviation: {r.deviation_score:.2f}")
        if r.details:
            print(f"   Details: {r.details}")


def cmd_history(args):
    """Show drift detection history."""
    storage_dir = get_storage_dir()
    
    # Load recent reports
    reports_dir = storage_dir / "reports"
    if not reports_dir.exists():
        print("No history available.")
        return
    
    report_files = sorted(reports_dir.glob("*.json"), reverse=True)[:args.limit]
    
    print("📜 Drift Detection History")
    print("=" * 60)
    
    for report_file in report_files:
        with open(report_file) as f:
            report = json.load(f)
        
        alert = report.get("alert_level", "unknown")
        score = report.get("overall_drift_score", 0)
        
        if alert == "critical":
            icon = "🔴"
        elif alert == "warning":
            icon = "🟡"
        else:
            icon = "🟢"
        
        print(f"{icon} {report.get('run_id', 'unknown')} | Score: {score:.3f} | {report.get('timestamp', 'unknown')}")
        
        anomalies = report.get("anomalies", [])
        if anomalies and args.verbose:
            for a in anomalies[:3]:
                print(f"     ⚠️  {a}")


def cmd_dashboard(args):
    """Launch the SIEM-like dashboard."""
    if not DASHBOARD_AVAILABLE:
        print("❌ Dashboard requires additional dependencies.")
        print("   Install with: pip install agent-drift-detector[dashboard]")
        print("   Or: pip install flask flask-socketio")
        sys.exit(1)
    
    storage_dir = get_storage_dir()
    
    print("🛡️  Agent Drift - SIEM Dashboard")
    print("=" * 50)
    print(f"   Storage: {storage_dir}")
    print(f"   URL: http://{args.host}:{args.port}")
    print()
    print("Features:")
    print("   • Real-time drift score monitoring")
    print("   • Historical trend visualization")
    print("   • Component breakdown analysis")
    print("   • Anomaly feed & alerts")
    print("   • Canary task status")
    print()
    print("Press Ctrl+C to stop")
    print("=" * 50)
    
    dashboard = DriftDashboard(
        storage_dir=str(storage_dir),
        host=args.host,
        port=args.port,
    )
    dashboard.run(debug=args.debug)


def cmd_listen(args):
    """Start HTTP listener for agent events."""
    from .listener import run_listener
    run_listener(port=args.port, storage_dir=str(get_storage_dir()))


def cmd_setup(args):
    """Setup OpenClaw integration."""
    import subprocess
    setup_script = Path(__file__).parent.parent / "setup-openclaw.py"
    if setup_script.exists():
        subprocess.run([sys.executable, str(setup_script)])
    else:
        print("Setup script not found. Manual setup required.")
        print("See: https://github.com/openclaw/agent-drift-detector#openclaw-setup")


def cmd_start(args):
    """Start drift monitor with SIEM dashboard."""
    import webbrowser
    import threading
    
    if not DASHBOARD_AVAILABLE:
        print("❌ Dashboard requires additional dependencies.")
        print("   Install with: pip install agent-drift-detector[dashboard]")
        print("   Or: pip install flask flask-socketio")
        sys.exit(1)
    
    storage_dir = get_storage_dir()
    
    # Open browser after short delay
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(f'http://localhost:{args.port}')).start()
    
    # Start the SIEM dashboard (includes tool tracking endpoints)
    dashboard = DriftDashboard(
        storage_dir=str(storage_dir),
        host='0.0.0.0',
        port=args.port,
    )
    dashboard.run(debug=False)


def cmd_simulate(args):
    """Run attack simulations to test detection."""
    storage_dir = get_storage_dir()
    
    print("🎯 Attack Simulation Mode")
    print("=" * 50)
    print("This will run simulated attacks against the detector")
    print("to verify it can catch various compromise patterns.")
    print()
    
    if not args.yes:
        response = input("Continue? [y/N] ")
        if response.lower() != 'y':
            print("Cancelled.")
            sys.exit(0)
    
    # Import test module
    import subprocess
    
    # Run the attack simulation tests
    test_file = Path(__file__).parent.parent / "tests" / "test_comprehensive.py"
    
    if test_file.exists():
        print(f"\n🧪 Running attack simulations from {test_file}")
        print("-" * 50)
        
        result = subprocess.run(
            ["python", "-m", "pytest", str(test_file), "-v", "-k", "attack", "--tb=short"],
            cwd=str(test_file.parent.parent),
        )
        
        if result.returncode == 0:
            print("\n✅ All attack simulations passed - detector is working!")
        else:
            print("\n⚠️  Some simulations failed - review output above")
        
        sys.exit(result.returncode)
    else:
        print("❌ Test file not found. Run from package directory.")
        sys.exit(1)


def print_drift_report(report):
    """Print a drift report in a readable format."""
    # Header
    if report.alert_level == "critical":
        print("\n🔴 CRITICAL: Significant behavioral drift detected!")
    elif report.alert_level == "warning":
        print("\n🟡 WARNING: Behavioral drift detected")
    else:
        print("\n🟢 NORMAL: Behavior within expected bounds")
    
    print(f"\n📊 Drift Score: {report.overall_drift_score:.3f}")
    print("-" * 40)
    
    # Component scores
    print("Component Scores:")
    for comp, score in sorted(report.component_scores.items(), key=lambda x: -x[1]):
        bar = "█" * int(score * 20)
        print(f"   {comp:20} [{bar:20}] {score:.3f}")
    
    # Anomalies
    if report.anomalies:
        print(f"\n⚠️  Anomalies ({len(report.anomalies)}):")
        for anomaly in report.anomalies:
            print(f"   • {anomaly}")
    
    # Save report
    storage_dir = get_storage_dir()
    reports_dir = storage_dir / "reports"
    reports_dir.mkdir(exist_ok=True)
    
    report_file = reports_dir / f"{report.run_id}.json"
    with open(report_file, "w") as f:
        json.dump(report.to_dict(), f, indent=2)


def main():
    parser = argparse.ArgumentParser(
        prog="agent-drift",
        description="Agent Drift - Runtime behavioral monitoring for AI agents"
    )
    
    subparsers = parser.add_subparsers(dest="command", help="Commands")
    
    # wrap command
    wrap_parser = subparsers.add_parser("wrap", help="Wrap and monitor an agent command")
    wrap_parser.add_argument("command", nargs="+", help="Command to execute")
    wrap_parser.add_argument("--canary", action="store_true", help="Enable canary task injection")
    wrap_parser.set_defaults(func=cmd_wrap)
    
    # status command
    status_parser = subparsers.add_parser("status", help="Show current status")
    status_parser.set_defaults(func=cmd_status)
    
    # baseline subcommands
    baseline_parser = subparsers.add_parser("baseline", help="Baseline management")
    baseline_sub = baseline_parser.add_subparsers(dest="baseline_cmd")
    
    show_parser = baseline_sub.add_parser("show", help="Show baseline")
    show_parser.add_argument("--json", action="store_true", help="Output as JSON")
    show_parser.set_defaults(func=cmd_baseline_show)
    
    reset_parser = baseline_sub.add_parser("reset", help="Reset baseline")
    reset_parser.add_argument("-f", "--force", action="store_true", help="Skip confirmation")
    reset_parser.set_defaults(func=cmd_baseline_reset)
    
    export_parser = baseline_sub.add_parser("export", help="Export baseline")
    export_parser.add_argument("output", help="Output file path")
    export_parser.set_defaults(func=cmd_baseline_export)
    
    import_parser = baseline_sub.add_parser("import", help="Import baseline")
    import_parser.add_argument("input", help="Input file path")
    import_parser.add_argument("-f", "--force", action="store_true", help="Skip confirmation")
    import_parser.set_defaults(func=cmd_baseline_import)
    
    # canary command
    canary_parser = subparsers.add_parser("canary", help="Run canary tasks")
    canary_parser.add_argument("--task", choices=["classification", "arithmetic", "sequence"], 
                               help="Specific task to run")
    canary_parser.set_defaults(func=cmd_canary)
    
    # history command
    history_parser = subparsers.add_parser("history", help="Show detection history")
    history_parser.add_argument("-n", "--limit", type=int, default=10, help="Number of entries")
    history_parser.add_argument("-v", "--verbose", action="store_true", help="Show anomaly details")
    history_parser.set_defaults(func=cmd_history)
    
    # dashboard command
    dashboard_parser = subparsers.add_parser("dashboard", help="Launch SIEM dashboard")
    dashboard_parser.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    dashboard_parser.add_argument("--port", type=int, default=5000, help="Port to bind to")
    dashboard_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    dashboard_parser.set_defaults(func=cmd_dashboard)
    
    # simulate command
    simulate_parser = subparsers.add_parser("simulate", help="Run attack simulations")
    simulate_parser.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")
    simulate_parser.set_defaults(func=cmd_simulate)
    
    # listen command
    listen_parser = subparsers.add_parser("listen", help="Start HTTP listener for agent events")
    listen_parser.add_argument("--port", type=int, default=5001, help="Port to listen on")
    listen_parser.set_defaults(func=cmd_listen)
    
    # setup command
    setup_parser = subparsers.add_parser("setup", help="Setup OpenClaw integration (one-time)")
    setup_parser.set_defaults(func=cmd_setup)
    
    # start command (all-in-one)
    start_parser = subparsers.add_parser("start", help="Start drift monitor (agents POST tool events)")
    start_parser.add_argument("wrap_cmd", nargs="*", help="Optional: command to wrap")
    start_parser.add_argument("--port", type=int, default=5001, help="Dashboard port")
    start_parser.add_argument("--no-browser", action="store_true", help="Don't open browser")
    start_parser.set_defaults(func=cmd_start)
    
    args = parser.parse_args()
    
    if hasattr(args, 'func'):
        args.func(args)
    elif len(sys.argv) == 1:
        parser.print_help()
        sys.exit(0)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
