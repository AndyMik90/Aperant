#!/usr/bin/env python3
"""
Simple HTTP listener for agent drift monitoring.

Any agent can POST tool events here. No code changes needed if the agent
supports webhooks or callbacks.

Usage:
    agent-drift listen              # Start listener on port 5001
    agent-drift listen --port 8080  # Custom port

Agents POST to:
    POST /tool/call    {"session": "xxx", "tool": "read", "tool_id": "123"}
    POST /tool/result  {"session": "xxx", "tool_id": "123", "success": true, "duration_ms": 50}
    POST /session/end  {"session": "xxx"}

Or simple mode (auto-manages sessions):
    POST /event  {"tool": "read", "success": true}
"""

import os
import json
import time
import threading
from pathlib import Path
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional, Dict

# Add parent to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.models import BehaviorTrace, ToolInvocation, DecisionCycle, DriftReport
from src.baseline import BaselineManager
from src.detector import DriftDetector


class DriftListener:
    """
    HTTP listener that receives tool events from agents.
    Automatically manages sessions and drift detection.
    """
    
    def __init__(self, storage_dir: Optional[str] = None, auto_session_timeout: float = 300.0):
        self.storage_dir = Path(storage_dir or os.environ.get(
            "AGENT_DRIFT_DIR",
            os.path.expanduser("~/.agent-drift")
        ))
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        self.baseline_manager = BaselineManager(str(self.storage_dir))
        self.detector = DriftDetector(baseline_manager=self.baseline_manager)
        
        self.sessions: Dict[str, dict] = {}
        self.auto_session_timeout = auto_session_timeout
        self.default_session = "default"
        
        self._lock = threading.Lock()
        
        # Alert callback
        self.on_alert = None
    
    def handle_tool_call(self, session_id: str, tool_name: str, tool_id: str):
        """Record a tool call."""
        with self._lock:
            session = self._get_or_create_session(session_id)
            session['pending_tools'][tool_id] = {
                'tool_name': tool_name,
                'start_time': time.time(),
            }
            session['last_activity'] = time.time()
    
    def handle_tool_result(self, session_id: str, tool_id: str, success: bool = True, duration_ms: Optional[float] = None):
        """Record a tool result."""
        with self._lock:
            session = self._get_or_create_session(session_id)
            
            pending = session['pending_tools'].pop(tool_id, None)
            if pending:
                if duration_ms is None:
                    duration_ms = (time.time() - pending['start_time']) * 1000
                
                session['trace'].tool_invocations.append(
                    ToolInvocation(
                        tool_name=pending['tool_name'],
                        timestamp=pending['start_time'],
                        duration_ms=duration_ms,
                        success=success,
                        arg_count=0,
                        arg_types=[],
                    )
                )
            
            session['last_activity'] = time.time()
    
    def handle_simple_event(self, tool_name: str, success: bool = True, duration_ms: float = 100.0):
        """Simple mode - just track tool usage without explicit sessions."""
        session_id = self.default_session
        tool_id = f"auto-{int(time.time()*1000)}"
        
        self.handle_tool_call(session_id, tool_name, tool_id)
        self.handle_tool_result(session_id, tool_id, success, duration_ms)
    
    def end_session(self, session_id: str) -> Optional[DriftReport]:
        """End a session and get drift report."""
        with self._lock:
            if session_id not in self.sessions:
                return None
            
            session = self.sessions.pop(session_id)
            trace = session['trace']
            trace.end_time = time.time()
            
            # Add decision cycle
            if trace.tool_invocations:
                trace.decision_cycles.append(
                    DecisionCycle(
                        cycle_id=1,
                        start_time=trace.start_time,
                        end_time=trace.end_time,
                        tool_count=len(trace.tool_invocations),
                        retry_count=0,
                        self_corrections=0,
                    )
                )
            
            # Detect drift
            report = self.detector.detect(trace)
            
            # Save report
            self._save_report(report)
            
            # Fire alert callback
            if self.on_alert and report.alert_level in ('warning', 'critical'):
                try:
                    self.on_alert(report)
                except:
                    pass
            
            return report
    
    def _get_or_create_session(self, session_id: str) -> dict:
        """Get or create a session."""
        if session_id not in self.sessions:
            self.sessions[session_id] = {
                'trace': BehaviorTrace(
                    run_id=f"listen-{session_id}-{int(time.time())}",
                    start_time=time.time(),
                    end_time=0,
                ),
                'pending_tools': {},
                'last_activity': time.time(),
            }
        return self.sessions[session_id]
    
    def _save_report(self, report: DriftReport):
        """Save report to disk."""
        reports_dir = self.storage_dir / "reports"
        reports_dir.mkdir(exist_ok=True)
        
        report_file = reports_dir / f"{report.run_id}.json"
        with open(report_file, 'w') as f:
            json.dump(report.to_dict(), f, indent=2)
    
    def cleanup_stale_sessions(self):
        """End sessions that have been idle too long."""
        with self._lock:
            now = time.time()
            stale = [
                sid for sid, session in self.sessions.items()
                if now - session['last_activity'] > self.auto_session_timeout
            ]
        
        for sid in stale:
            print(f"Auto-ending stale session: {sid}")
            self.end_session(sid)


class ListenerHandler(BaseHTTPRequestHandler):
    """HTTP request handler for drift listener."""
    
    listener: DriftListener = None  # Set by server
    
    def log_message(self, format, *args):
        # Quieter logging
        pass
    
    def _send_json(self, data: dict, status: int = 200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def _read_json(self) -> dict:
        length = int(self.headers.get('Content-Length', 0))
        if length:
            return json.loads(self.rfile.read(length))
        return {}
    
    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_GET(self):
        if self.path == '/health':
            self._send_json({'status': 'ok', 'sessions': len(self.listener.sessions)})
        elif self.path == '/status':
            baseline_info = self.listener.baseline_manager.get_baseline_info()
            self._send_json({
                'status': 'ok',
                'sessions': len(self.listener.sessions),
                'baseline': baseline_info,
            })
        else:
            self._send_json({'error': 'Not found'}, 404)
    
    def do_POST(self):
        try:
            data = self._read_json()
            
            if self.path == '/event':
                # Simple mode
                tool = data.get('tool', 'unknown')
                success = data.get('success', True)
                duration = data.get('duration_ms', 100)
                
                self.listener.handle_simple_event(tool, success, duration)
                print(f"📥 Tool: {tool} ({'✓' if success else '✗'})")
                self._send_json({'status': 'ok'})
            
            elif self.path == '/tool/call':
                session = data.get('session', 'default')
                tool = data.get('tool')
                tool_id = data.get('tool_id', f"auto-{int(time.time()*1000)}")
                
                self.listener.handle_tool_call(session, tool, tool_id)
                print(f"📥 [{session}] Tool call: {tool}")
                self._send_json({'status': 'ok', 'tool_id': tool_id})
            
            elif self.path == '/tool/result':
                session = data.get('session', 'default')
                tool_id = data.get('tool_id')
                success = data.get('success', True)
                duration = data.get('duration_ms')
                
                self.listener.handle_tool_result(session, tool_id, success, duration)
                print(f"📥 [{session}] Tool result: {tool_id} ({'✓' if success else '✗'})")
                self._send_json({'status': 'ok'})
            
            elif self.path == '/session/end':
                session = data.get('session', 'default')
                report = self.listener.end_session(session)
                
                if report:
                    level_icon = {'normal': '🟢', 'warning': '🟡', 'critical': '🔴'}
                    print(f"{level_icon.get(report.alert_level, '⚪')} [{session}] Session ended - Drift: {report.overall_drift_score:.3f}")
                    self._send_json({
                        'status': 'ok',
                        'drift_score': report.overall_drift_score,
                        'alert_level': report.alert_level,
                        'anomalies': report.anomalies,
                    })
                else:
                    self._send_json({'status': 'ok', 'message': 'No session found'})
            
            else:
                self._send_json({'error': 'Unknown endpoint'}, 404)
                
        except Exception as e:
            self._send_json({'error': str(e)}, 500)


def run_listener(port: int = 5001, storage_dir: Optional[str] = None):
    """Run the HTTP listener."""
    listener = DriftListener(storage_dir=storage_dir)
    
    def on_alert(report):
        print(f"\n🚨 ALERT: Drift score {report.overall_drift_score:.3f} ({report.alert_level})")
        for anomaly in report.anomalies:
            print(f"   ⚠️  {anomaly}")
        print()
    
    listener.on_alert = on_alert
    
    ListenerHandler.listener = listener
    
    server = HTTPServer(('0.0.0.0', port), ListenerHandler)
    
    # Cleanup thread
    def cleanup_loop():
        while True:
            time.sleep(60)
            listener.cleanup_stale_sessions()
    
    cleanup_thread = threading.Thread(target=cleanup_loop, daemon=True)
    cleanup_thread.start()
    
    print(f"🛡️  Agent Drift - Listener Mode")
    print(f"=" * 50)
    print(f"Listening on http://0.0.0.0:{port}")
    print()
    print("Endpoints:")
    print(f"  POST /event           - Simple: {{\"tool\": \"read\", \"success\": true}}")
    print(f"  POST /tool/call       - {{\"session\": \"x\", \"tool\": \"read\", \"tool_id\": \"1\"}}")
    print(f"  POST /tool/result     - {{\"session\": \"x\", \"tool_id\": \"1\", \"success\": true}}")
    print(f"  POST /session/end     - {{\"session\": \"x\"}}")
    print(f"  GET  /status          - Check status")
    print()
    print("Waiting for events... (Ctrl+C to stop)")
    print("=" * 50)
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5001)
    parser.add_argument('--storage-dir')
    args = parser.parse_args()
    
    run_listener(port=args.port, storage_dir=args.storage_dir)
