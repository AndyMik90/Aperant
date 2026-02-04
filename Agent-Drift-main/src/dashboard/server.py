"""
Dashboard server - Flask-based SIEM interface for drift monitoring.
Real-time WebSocket updates, tool tracking, and prompt injection detection.
"""

import os
import json
import time
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, List, Any
from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit
import threading

# Relative imports for when used as package
try:
    from ..baseline import BaselineManager
    from ..detector import DriftDetector
    from ..canary import CanaryInjector
    from ..models import DriftReport, BehaviorTrace, ToolInvocation, DecisionCycle
except ImportError:
    # Fallback for direct execution
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from baseline import BaselineManager
    from detector import DriftDetector
    from canary import CanaryInjector
    from models import DriftReport, BehaviorTrace, ToolInvocation, DecisionCycle


# ============================================================================
# PROMPT INJECTION DETECTION
# ============================================================================

INJECTION_PATTERNS = [
    {
        'name': 'Instruction Override',
        'pattern': r'(?i)(ignore|disregard|forget)\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|rules?|guidelines?)',
        'severity': 'critical',
        'description': 'Attempts to override system instructions by asking agent to ignore previous prompts',
    },
    {
        'name': 'Role Hijacking',
        'pattern': r'(?i)(you are now|act as|pretend to be|roleplay as|from now on you|your new (role|persona|identity))',
        'severity': 'critical', 
        'description': 'Attempts to change the agent\'s identity or role to bypass restrictions',
    },
    {
        'name': 'System Prompt Extraction',
        'pattern': r'(?i)(show|reveal|display|print|output|repeat|tell)\s+(me\s+)?(your|the)?\s*(system\s*prompt|instructions?|initial\s*prompt|hidden\s*prompt|secret\s*instructions?)',
        'severity': 'warning',
        'description': 'Attempts to extract the agent\'s system prompt or hidden instructions',
    },
    {
        'name': 'Jailbreak Attempt',
        'pattern': r'(?i)(DAN|do anything now|jailbreak|bypass|unlock|remove\s+(restrictions?|limits?|filters?)|no\s+restrictions?)',
        'severity': 'critical',
        'description': 'Known jailbreak techniques attempting to remove safety restrictions',
    },
    {
        'name': 'Delimiter Injection',
        'pattern': r'(\]\]|>>|---|```|<\/?system>|<\/?user>|<\/?assistant>|END\s*OF\s*PROMPT|BEGIN\s*NEW\s*CONVERSATION)',
        'severity': 'warning',
        'description': 'Uses delimiters or markers to trick the agent into treating injected text as system instructions',
    },
    {
        'name': 'Encoded Payload',
        'pattern': r'(?i)(base64|rot13|hex|decode|encrypt|eval|exec)\s*[:\(]|[A-Za-z0-9+/]{40,}={0,2}',
        'severity': 'critical',
        'description': 'Contains encoded content that may hide malicious instructions',
    },
    {
        'name': 'Privilege Escalation',
        'pattern': r'(?i)(admin|root|superuser|elevated|sudo|override\s+permissions?|bypass\s+auth)',
        'severity': 'warning',
        'description': 'Attempts to gain elevated privileges or bypass authentication',
    },
    {
        'name': 'Data Exfiltration',
        'pattern': r'(?i)(send|upload|post|transmit|exfil|leak)\s+.*?(to|via)\s+.*(email|url|webhook|api|server|external)',
        'severity': 'critical',
        'description': 'Attempts to exfiltrate data to external services',
    },
    {
        'name': 'Memory Poisoning',
        'pattern': r'(?i)(remember|store|save|record|memorize)\s+(forever|permanently|always|from now on)',
        'severity': 'critical',
        'description': 'Attempts to inject persistent malicious content into agent memory',
    },
    {
        'name': 'Indirect Injection Marker',
        'pattern': r'(?i)(AI:|Assistant:|System:|IMPORTANT:|URGENT:|NOTE TO AI:|HIDDEN INSTRUCTION:)',
        'severity': 'warning',
        'description': 'Markers commonly used in indirect prompt injection attacks via external content',
    },
]


def detect_prompt_injection(text: str) -> List[Dict]:
    """Detect prompt injection attempts in text."""
    if not text:
        return []
    
    detections = []
    for pattern_info in INJECTION_PATTERNS:
        matches = re.findall(pattern_info['pattern'], text)
        if matches:
            detections.append({
                'name': pattern_info['name'],
                'severity': pattern_info['severity'],
                'description': pattern_info['description'],
                'matches': [m if isinstance(m, str) else m[0] for m in matches[:3]],  # First 3 matches
                'timestamp': time.time(),
            })
    
    return detections


class DriftDashboard:
    """
    SIEM-like dashboard for monitoring agent behavioral drift.
    
    Features:
    - Real-time drift score monitoring via WebSocket
    - Tool event tracking with live updates
    - Prompt injection detection and alerts
    - Historical trend visualization
    - Component breakdown analysis
    - Anomaly feed
    - Alert management
    - Canary task status
    """
    
    def __init__(
        self,
        storage_dir: Optional[str] = None,
        host: str = "0.0.0.0",
        port: int = 5000,
    ):
        self.storage_dir = Path(storage_dir or os.environ.get(
            "AGENT_DRIFT_DIR",
            os.path.expanduser("~/.agent-drift")
        ))
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        self.host = host
        self.port = port
        
        # Initialize components
        self.baseline_manager = BaselineManager(str(self.storage_dir))
        self.detector = DriftDetector(self.baseline_manager)
        self.canary_injector = CanaryInjector(str(self.storage_dir))
        
        # Data stores
        self.drift_history: List[Dict] = []
        self.alerts: List[Dict] = []
        self.max_history = 1000
        
        # Real-time tracking
        self.current_trace: Optional[BehaviorTrace] = None
        self.session_start: float = 0
        self.tool_count: int = 0
        self.recent_tools: List[Dict] = []
        self.injection_detections: List[Dict] = []
        self._lock = threading.Lock()
        
        # Load historical data
        self._load_history()
        
        # Create Flask app
        self.app = create_app(self)
        self.socketio = SocketIO(self.app, cors_allowed_origins="*", async_mode='threading')
        
        self._setup_socketio()
    
    def _setup_socketio(self):
        """Setup WebSocket handlers."""
        
        @self.socketio.on('connect')
        def handle_connect():
            emit('connected', {'status': 'ok'})
            emit('full_state', self.get_full_state())
        
        @self.socketio.on('request_update')
        def handle_update_request():
            emit('full_state', self.get_full_state())
    
    def broadcast(self, event: str, data: dict):
        """Broadcast event to all connected clients."""
        self.socketio.emit(event, data)
    
    # ========================================================================
    # REAL-TIME TOOL TRACKING
    # ========================================================================
    
    def ensure_session(self):
        """Ensure a monitoring session is active."""
        with self._lock:
            if not self.current_trace:
                self.session_start = time.time()
                self.current_trace = BehaviorTrace(
                    run_id=f"session-{int(self.session_start)}",
                    start_time=self.session_start,
                    end_time=0,
                )
                self.tool_count = 0
                print(f"  📍 New session: {self.current_trace.run_id}")
    
    def track_tool(self, tool_name: str, success: bool = True, duration_ms: float = 100.0,
                   args: dict = None, output: str = None):
        """Track a tool call and broadcast update."""
        self.ensure_session()
        
        with self._lock:
            now = time.time()
            
            # Add to trace
            self.current_trace.tool_invocations.append(
                ToolInvocation(
                    tool_name=tool_name,
                    timestamp=now,
                    duration_ms=duration_ms,
                    success=success,
                    arg_count=len(args) if args else 0,
                    arg_types=list(args.keys()) if args else [],
                )
            )
            
            # Track recent
            tool_event = {
                'tool': tool_name,
                'time': now,
                'success': success,
                'duration_ms': duration_ms,
            }
            self.recent_tools.append(tool_event)
            if len(self.recent_tools) > 200:
                self.recent_tools = self.recent_tools[-200:]
            
            self.tool_count += 1
            
            # Check for injection in args/output
            injections = []
            if args:
                for key, val in args.items():
                    if isinstance(val, str):
                        injections.extend(detect_prompt_injection(val))
            if output and isinstance(output, str):
                injections.extend(detect_prompt_injection(output))
            
            if injections:
                for inj in injections:
                    inj['tool'] = tool_name
                    self.injection_detections.append(inj)
                    # Create alert for critical injections
                    if inj['severity'] == 'critical':
                        self.alerts.append({
                            'id': f"injection-{int(now * 1000)}",
                            'level': 'critical',
                            'type': 'injection',
                            'run_id': self.current_trace.run_id if self.current_trace else 'unknown',
                            'injection': inj,
                            'timestamp': now,
                            'acknowledged': False,
                        })
        
        # Broadcast tool event
        self.broadcast('tool_event', {
            'tool': tool_event,
            'tool_count': self.tool_count,
            'injections': injections if injections else None,
        })
        
        print(f"  ✓ {tool_name}" + (f" ⚠️ {len(injections)} injection(s) detected!" if injections else ""))
    
    def check_content(self, content: str, source: str = "unknown") -> List[Dict]:
        """Check content for prompt injection without tracking as tool."""
        injections = detect_prompt_injection(content)
        
        if injections:
            now = time.time()
            for inj in injections:
                inj['source'] = source
                self.injection_detections.append(inj)
                
                if inj['severity'] == 'critical':
                    self.alerts.append({
                        'id': f"injection-{int(now * 1000)}",
                        'level': 'critical',
                        'type': 'injection',
                        'source': source,
                        'injection': inj,
                        'timestamp': now,
                        'acknowledged': False,
                    })
            
            # Broadcast injection alert
            self.broadcast('injection_detected', {
                'source': source,
                'injections': injections,
            })
        
        return injections
    
    def end_session(self) -> Optional[DriftReport]:
        """End monitoring session and generate drift report."""
        with self._lock:
            if not self.current_trace:
                return None
            
            trace = self.current_trace
            trace.end_time = time.time()
            
            # Create decision cycle from tools
            if trace.tool_invocations:
                trace.decision_cycles.append(
                    DecisionCycle(1, trace.start_time, trace.end_time,
                                  len(trace.tool_invocations), 0, 0)
                )
            
            # Detect drift
            report = self.detector.detect(trace)
            self.add_drift_report(report)
            
            self.current_trace = None
            return report
    
    # ========================================================================
    # STATE MANAGEMENT
    # ========================================================================
    
    def get_full_state(self) -> Dict[str, Any]:
        """Get complete dashboard state."""
        # Reload from disk
        self._load_history()
        
        return {
            'drift_history': self.drift_history[-100:],
            'alerts': self.alerts[-50:],
            'baseline': self.baseline_manager.get_baseline_info(),
            'canary': self.canary_injector.get_canary_status(),
            'stats': self._calculate_stats(),
            'timestamp': time.time(),
            # Real-time state
            'monitoring': self.current_trace is not None,
            'session_duration': time.time() - self.session_start if self.current_trace else 0,
            'tool_count': self.tool_count,
            'recent_tools': self.recent_tools[-50:],
            'injection_detections': self.injection_detections[-30:],
        }
    
    def _calculate_stats(self) -> Dict[str, Any]:
        """Calculate summary statistics."""
        if not self.drift_history:
            return {
                'total_runs': 0,
                'avg_drift_score': 0,
                'alert_count': 0,
                'warning_count': 0,
                'last_24h_runs': 0,
                'injection_count': len(self.injection_detections),
            }
        
        now = time.time()
        day_ago = now - 86400
        
        recent = [h for h in self.drift_history if h.get('timestamp', 0) > day_ago]
        
        all_scores = [h['overall_drift_score'] for h in self.drift_history]
        recent_scores = [h['overall_drift_score'] for h in recent]
        
        return {
            'total_runs': len(self.drift_history),
            'avg_drift_score': sum(all_scores) / len(all_scores) if all_scores else 0,
            'recent_avg_drift': sum(recent_scores) / len(recent_scores) if recent_scores else 0,
            'alert_count': sum(1 for h in self.drift_history if h.get('alert_level') == 'critical'),
            'warning_count': sum(1 for h in self.drift_history if h.get('alert_level') == 'warning'),
            'last_24h_runs': len(recent),
            'max_drift_score': max(all_scores) if all_scores else 0,
            'min_drift_score': min(all_scores) if all_scores else 0,
            'injection_count': len(self.injection_detections),
            'critical_injections': sum(1 for i in self.injection_detections if i.get('severity') == 'critical'),
        }
    
    def add_drift_report(self, report: DriftReport):
        """Add a new drift report and broadcast update."""
        report_dict = report.to_dict()
        report_dict['timestamp'] = time.time()
        
        self.drift_history.append(report_dict)
        
        # Trim history
        if len(self.drift_history) > self.max_history:
            self.drift_history = self.drift_history[-self.max_history:]
        
        # Check for alerts
        if report.alert_level in ('warning', 'critical'):
            alert = {
                'id': f"alert-{int(time.time() * 1000)}",
                'level': report.alert_level,
                'type': 'drift',
                'run_id': report.run_id,
                'score': report.overall_drift_score,
                'anomalies': report.anomalies,
                'timestamp': time.time(),
                'acknowledged': False,
            }
            self.alerts.append(alert)
        
        # Save to disk
        self._save_history()
        self._save_report(report_dict)
        
        # Broadcast update
        self.broadcast('drift_update', {
            'report': report_dict,
            'stats': self._calculate_stats(),
        })
    
    def _save_report(self, report_dict: dict):
        """Save report to disk."""
        reports_dir = self.storage_dir / "reports"
        reports_dir.mkdir(exist_ok=True)
        with open(reports_dir / f"{report_dict.get('run_id', 'unknown')}.json", 'w') as f:
            json.dump(report_dict, f, indent=2)
    
    def acknowledge_alert(self, alert_id: str) -> bool:
        """Acknowledge an alert."""
        for alert in self.alerts:
            if alert['id'] == alert_id:
                alert['acknowledged'] = True
                self.broadcast('alert_acked', {'id': alert_id})
                return True
        return False
    
    def _load_history(self):
        """Load historical data from disk."""
        # Track what we already have
        seen_ids = {h.get('run_id') for h in self.drift_history}
        
        # Load from CLI reports directory
        reports_dir = self.storage_dir / "reports"
        if reports_dir.exists():
            for report_file in sorted(reports_dir.glob("*.json")):
                try:
                    with open(report_file) as f:
                        report = json.load(f)
                    
                    run_id = report.get('run_id')
                    if run_id and run_id not in seen_ids:
                        # Add timestamp if missing
                        if 'timestamp' not in report:
                            report['timestamp'] = report_file.stat().st_mtime
                        elif isinstance(report['timestamp'], str):
                            try:
                                dt = datetime.fromisoformat(report['timestamp'].replace('Z', '+00:00'))
                                report['timestamp'] = dt.timestamp()
                            except:
                                report['timestamp'] = report_file.stat().st_mtime
                        
                        self.drift_history.append(report)
                        seen_ids.add(run_id)
                        
                        # Create alerts for warning/critical
                        if report.get('alert_level') in ('warning', 'critical'):
                            if not any(a.get('run_id') == run_id for a in self.alerts):
                                self.alerts.append({
                                    'id': f"alert-{run_id}",
                                    'level': report['alert_level'],
                                    'type': 'drift',
                                    'run_id': run_id,
                                    'score': report.get('overall_drift_score', 0),
                                    'anomalies': report.get('anomalies', []),
                                    'timestamp': report['timestamp'],
                                    'acknowledged': False,
                                })
                except (json.JSONDecodeError, KeyError):
                    continue
        
        # Sort by timestamp
        self.drift_history.sort(key=lambda h: h.get('timestamp', 0))
    
    def _save_history(self):
        """Save historical data to disk."""
        history_file = self.storage_dir / "dashboard_history.json"
        with open(history_file, 'w') as f:
            json.dump({
                'drift_history': self.drift_history[-500:],
                'alerts': self.alerts[-200:],
            }, f)
    
    def run(self, debug: bool = False):
        """Run the dashboard server."""
        print()
        print("  🛡️  Agent Drift - SIEM Dashboard")
        print("  " + "=" * 50)
        print(f"  Dashboard:  http://{self.host}:{self.port}")
        print()
        print("  Agent Integration:")
        print(f"    POST /tool     - Track tool usage")
        print(f"    POST /check    - Check content for injection")
        print(f"    POST /end      - End session, get drift report")
        print()
        print("  Example:")
        print(f"    curl -X POST localhost:{self.port}/tool -d '{{\"tool\":\"exec\"}}'")
        print("  " + "=" * 50)
        print()
        
        self.socketio.run(self.app, host=self.host, port=self.port, debug=debug, allow_unsafe_werkzeug=True)


def create_app(dashboard: Optional[DriftDashboard] = None) -> Flask:
    """Create Flask application."""
    
    template_dir = Path(__file__).parent / "templates"
    static_dir = Path(__file__).parent / "static"
    
    app = Flask(
        __name__,
        template_folder=str(template_dir),
        static_folder=str(static_dir),
    )
    app.config['SECRET_KEY'] = os.environ.get('DRIFT_SECRET_KEY', 'agent-drift-dev-key')
    
    # Store dashboard reference
    app.dashboard = dashboard
    
    @app.route('/')
    def index():
        """Main dashboard page."""
        return render_template('dashboard.html')
    
    # ========================================================================
    # TOOL TRACKING API (Real-time)
    # ========================================================================
    
    @app.route('/tool', methods=['POST', 'OPTIONS'])
    @app.route('/api/tool', methods=['POST', 'OPTIONS'])
    @app.route('/event', methods=['POST', 'OPTIONS'])
    def api_track_tool():
        """Track a tool invocation."""
        if request.method == 'OPTIONS':
            return _cors_response()
        
        data = request.get_json(silent=True) or {}
        tool = data.get('tool') or data.get('name') or 'unknown'
        success = data.get('success', True)
        duration = data.get('duration_ms', 100.0)
        args = data.get('args')
        output = data.get('output')
        
        if app.dashboard:
            app.dashboard.track_tool(tool, success, duration, args, output)
        
        return jsonify({'ok': True})
    
    @app.route('/check', methods=['POST', 'OPTIONS'])
    @app.route('/api/check', methods=['POST', 'OPTIONS'])
    def api_check_content():
        """Check content for prompt injection."""
        if request.method == 'OPTIONS':
            return _cors_response()
        
        data = request.get_json(silent=True) or {}
        content = data.get('content') or data.get('text') or ''
        source = data.get('source', 'api')
        
        injections = []
        if app.dashboard:
            injections = app.dashboard.check_content(content, source)
        
        return jsonify({
            'ok': True,
            'injections': injections,
            'has_injection': len(injections) > 0,
            'critical': any(i.get('severity') == 'critical' for i in injections),
        })
    
    @app.route('/end', methods=['POST', 'OPTIONS'])
    @app.route('/api/end', methods=['POST', 'OPTIONS'])
    @app.route('/session/end', methods=['POST', 'OPTIONS'])
    def api_end_session():
        """End monitoring session and get drift report."""
        if request.method == 'OPTIONS':
            return _cors_response()
        
        if app.dashboard:
            report = app.dashboard.end_session()
            if report:
                return jsonify(report.to_dict())
        
        return jsonify({'ok': True, 'message': 'No active session'})
    
    @app.route('/reset', methods=['POST', 'OPTIONS'])
    @app.route('/api/reset', methods=['POST', 'OPTIONS'])
    def api_reset_baseline():
        """Reset baseline."""
        if request.method == 'OPTIONS':
            return _cors_response()
        
        if app.dashboard:
            app.dashboard.baseline_manager.reset_baseline()
            print("  🔄 Baseline reset")
        
        return jsonify({'ok': True, 'message': 'Baseline reset'})
    
    # ========================================================================
    # STATE API
    # ========================================================================
    
    @app.route('/api/state')
    def api_state():
        """Get full dashboard state."""
        if app.dashboard:
            return jsonify(app.dashboard.get_full_state())
        return jsonify({'error': 'Dashboard not initialized'}), 500
    
    @app.route('/api/history')
    def api_history():
        """Get drift history."""
        limit = request.args.get('limit', 100, type=int)
        if app.dashboard:
            app.dashboard._load_history()
            return jsonify(app.dashboard.drift_history[-limit:])
        return jsonify([])
    
    @app.route('/api/alerts')
    def api_alerts():
        """Get alerts."""
        unacked_only = request.args.get('unacked', 'false').lower() == 'true'
        if app.dashboard:
            alerts = app.dashboard.alerts
            if unacked_only:
                alerts = [a for a in alerts if not a.get('acknowledged')]
            return jsonify(alerts[-50:])
        return jsonify([])
    
    @app.route('/api/alerts/<alert_id>/ack', methods=['POST'])
    def api_ack_alert(alert_id):
        """Acknowledge an alert."""
        if app.dashboard:
            if app.dashboard.acknowledge_alert(alert_id):
                return jsonify({'ok': True})
            return jsonify({'error': 'Alert not found'}), 404
        return jsonify({'error': 'Dashboard not initialized'}), 500
    
    @app.route('/api/injections')
    def api_injections():
        """Get prompt injection detections."""
        if app.dashboard:
            return jsonify(app.dashboard.injection_detections[-50:])
        return jsonify([])
    
    @app.route('/api/baseline')
    def api_baseline():
        """Get baseline info."""
        if app.dashboard:
            return jsonify(app.dashboard.baseline_manager.get_baseline_info())
        return jsonify({'exists': False})
    
    @app.route('/api/canary')
    def api_canary():
        """Get canary status."""
        if app.dashboard:
            return jsonify(app.dashboard.canary_injector.get_canary_status())
        return jsonify({})
    
    @app.route('/api/canary/run', methods=['POST'])
    def api_run_canary():
        """Run canary tasks."""
        if app.dashboard:
            results = app.dashboard.canary_injector.run_all_canaries()
            return jsonify([{
                'task_type': r.task_type,
                'passed': r.passed,
                'deviation_score': r.deviation_score,
                'details': r.details,
            } for r in results])
        return jsonify({'error': 'Dashboard not initialized'}), 500
    
    @app.route('/api/stats')
    def api_stats():
        """Get summary statistics."""
        if app.dashboard:
            return jsonify(app.dashboard._calculate_stats())
        return jsonify({})
    
    @app.route('/health')
    def health():
        """Health check endpoint."""
        return jsonify({'ok': True})
    
    def _cors_response():
        """Return CORS preflight response."""
        response = app.make_response('')
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return response
    
    @app.after_request
    def add_cors(response):
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    
    return app


# CLI entry point
def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Agent Drift Dashboard')
    parser.add_argument('--host', default='0.0.0.0', help='Host to bind to')
    parser.add_argument('--port', type=int, default=5000, help='Port to bind to')
    parser.add_argument('--debug', action='store_true', help='Enable debug mode')
    parser.add_argument('--storage-dir', help='Data storage directory')
    
    args = parser.parse_args()
    
    dashboard = DriftDashboard(
        storage_dir=args.storage_dir,
        host=args.host,
        port=args.port,
    )
    dashboard.run(debug=args.debug)


if __name__ == '__main__':
    main()
