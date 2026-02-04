#!/usr/bin/env python3
"""
Agent Drift - Detect behavioral drift in AI agents.

Usage:
    agent-drift start              # Start monitor (agents POST tool events)
    agent-drift start "command"    # Wrap a command and monitor its output

Agents report tool usage by POSTing to http://localhost:5001/tool
"""

import os
import sys
import json
import time
import threading
import subprocess
import re
import webbrowser
from pathlib import Path
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional, List

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.models import BehaviorTrace, ToolInvocation, DecisionCycle, DriftReport
from src.baseline import BaselineManager
from src.detector import DriftDetector


class AgentMonitor:
    """Monitors agent behavior for drift detection."""
    
    def __init__(self, storage_dir: Optional[str] = None):
        self.storage_dir = Path(storage_dir or os.environ.get(
            "AGENT_DRIFT_DIR",
            os.path.expanduser("~/.agent-drift")
        ))
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        self.baseline_manager = BaselineManager(str(self.storage_dir))
        self.detector = DriftDetector(baseline_manager=self.baseline_manager)
        
        # Session state
        self.current_trace: Optional[BehaviorTrace] = None
        self.session_start: float = 0
        self.tool_count: int = 0
        
        # History
        self.reports: List[dict] = []
        self.recent_tools: List[dict] = []
        self.alerts: List[dict] = []
        self._lock = threading.Lock()
        
        self._load_reports()
    
    def _load_reports(self):
        """Load existing reports from disk, merging with any new ones."""
        reports_dir = self.storage_dir / "reports"
        if not reports_dir.exists():
            return
        
        # Track existing run_ids to avoid duplicates
        existing_ids = {r.get('run_id') for r in self.reports}
        
        for f in sorted(reports_dir.glob("*.json"))[-100:]:
            try:
                with open(f) as fp:
                    r = json.load(fp)
                    run_id = r.get('run_id')
                    
                    # Skip if we already have this report
                    if run_id in existing_ids:
                        continue
                    
                    ts = r.get('timestamp')
                    if isinstance(ts, str):
                        try:
                            r['timestamp'] = datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
                        except:
                            r['timestamp'] = f.stat().st_mtime
                    elif not ts:
                        r['timestamp'] = f.stat().st_mtime
                    
                    self.reports.append(r)
                    existing_ids.add(run_id)
                    
                    if r.get('alert_level') in ('warning', 'critical'):
                        # Check if alert already exists
                        if not any(a.get('id') == run_id for a in self.alerts):
                            self.alerts.append({
                                'id': run_id,
                                'level': r['alert_level'],
                                'score': r.get('overall_drift_score', 0),
                                'anomalies': r.get('anomalies', []),
                                'timestamp': r['timestamp'],
                            })
            except:
                pass
        
        # Sort by timestamp
        self.reports.sort(key=lambda r: r.get('timestamp', 0))
    
    def ensure_session(self):
        """Ensure a session is active."""
        with self._lock:
            if not self.current_trace:
                self.session_start = time.time()
                self.current_trace = BehaviorTrace(
                    run_id=f"session-{int(self.session_start)}",
                    start_time=self.session_start,
                    end_time=0,
                )
                self.tool_count = 0
    
    def track_tool(self, tool_name: str, success: bool = True, duration_ms: float = 100.0):
        """Track a tool call."""
        self.ensure_session()
        
        with self._lock:
            now = time.time()
            self.current_trace.tool_invocations.append(
                ToolInvocation(
                    tool_name=tool_name,
                    timestamp=now,
                    duration_ms=duration_ms,
                    success=success,
                    arg_count=0,
                    arg_types=[],
                )
            )
            
            self.recent_tools.append({
                'tool': tool_name,
                'time': now,
                'success': success,
            })
            if len(self.recent_tools) > 200:
                self.recent_tools = self.recent_tools[-200:]
            
            self.tool_count += 1
    
    def end_session(self) -> Optional[DriftReport]:
        """End session and detect drift."""
        with self._lock:
            if not self.current_trace:
                return None
            
            trace = self.current_trace
            trace.end_time = time.time()
            
            if trace.tool_invocations:
                trace.decision_cycles.append(
                    DecisionCycle(1, trace.start_time, trace.end_time, 
                                  len(trace.tool_invocations), 0, 0)
                )
            
            report = self.detector.detect(trace)
            report_dict = report.to_dict()
            report_dict['timestamp'] = time.time()
            self.reports.append(report_dict)
            
            if report.alert_level in ('warning', 'critical'):
                self.alerts.append({
                    'id': report.run_id,
                    'level': report.alert_level,
                    'score': report.overall_drift_score,
                    'anomalies': report.anomalies,
                    'timestamp': time.time(),
                })
            
            # Save
            reports_dir = self.storage_dir / "reports"
            reports_dir.mkdir(exist_ok=True)
            with open(reports_dir / f"{report.run_id}.json", 'w') as f:
                json.dump(report_dict, f, indent=2)
            
            self.current_trace = None
            return report
    
    def get_state(self) -> dict:
        """Get current state for dashboard."""
        # Reload reports from disk to pick up CLI runs
        self._load_reports()
        
        with self._lock:
            scores = [r.get('overall_drift_score', 0) for r in self.reports]
            latest_components = self.reports[-1].get('component_scores', {}) if self.reports else {}
            
            return {
                'monitoring': self.current_trace is not None,
                'session_duration': time.time() - self.session_start if self.current_trace else 0,
                'tool_count': self.tool_count,
                'reports': self.reports[-100:],
                'recent_tools': self.recent_tools[-50:],
                'alerts': self.alerts[-30:],
                'latest_components': latest_components,
                'stats': {
                    'total_sessions': len(self.reports),
                    'avg_score': sum(scores) / len(scores) if scores else 0,
                    'max_score': max(scores) if scores else 0,
                    'alerts': sum(1 for r in self.reports if r.get('alert_level') == 'critical'),
                    'warnings': sum(1 for r in self.reports if r.get('alert_level') == 'warning'),
                },
                'baseline': self.baseline_manager.get_baseline_info(),
            }


_monitor: Optional[AgentMonitor] = None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    
    def _send(self, data, ctype='text/html', status=200):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data if isinstance(data, bytes) else data.encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_GET(self):
        if self.path == '/': self._send(DASHBOARD_HTML)
        elif self.path == '/api/state': self._send(json.dumps(_monitor.get_state()), 'application/json')
        elif self.path == '/health': self._send('{"ok":true}', 'application/json')
        else: self._send('Not found', status=404)
    
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length)) if length else {}
        except: data = {}
        
        if self.path in ('/tool', '/event', '/api/tool'):
            tool = data.get('tool') or data.get('name') or 'unknown'
            success = data.get('success', True)
            _monitor.track_tool(tool, success)
            print(f"  ✓ {tool}")
            self._send('{"ok":true}', 'application/json')
        elif self.path in ('/end', '/session/end', '/api/end'):
            report = _monitor.end_session()
            if report:
                icon = {'normal': '🟢', 'warning': '🟡', 'critical': '🔴'}.get(report.alert_level)
                print(f"  {icon} Session ended: {report.overall_drift_score:.3f} drift")
            self._send(json.dumps(report.to_dict() if report else {}), 'application/json')
        elif self.path in ('/reset', '/api/reset'):
            _monitor.baseline_manager.reset_baseline()
            print("  🔄 Baseline reset")
            self._send('{"ok":true}', 'application/json')
        else:
            self._send('{"error":"unknown"}', 'application/json', 404)


DASHBOARD_HTML = '''<!DOCTYPE html>
<html>
<head>
    <title>Agent Drift</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        :root{--bg:#0d1117;--bg2:#161b22;--bg3:#21262d;--border:#30363d;--text:#c9d1d9;--dim:#8b949e;--green:#3fb950;--yellow:#d29922;--red:#f85149;--blue:#58a6ff}
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);padding:20px;min-height:100vh}
        .header{display:flex;justify-content:space-between;align-items:center;padding-bottom:20px;border-bottom:1px solid var(--border);margin-bottom:20px}
        h1{font-size:1.4em}
        .subtitle{color:var(--dim);font-size:.85em;margin-top:4px}
        .status{display:flex;align-items:center;gap:10px}
        .dot{width:12px;height:12px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        
        .alert-banner{background:linear-gradient(90deg,rgba(248,81,73,.1),transparent);border:1px solid var(--red);border-radius:8px;padding:15px 20px;margin-bottom:20px;display:none}
        .alert-banner.show{display:block}
        .alert-banner h3{color:var(--red);margin-bottom:5px}
        
        .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:15px;margin-bottom:20px}
        .stat{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:20px;text-align:center}
        .stat.alert{border-color:var(--red)}.stat.warn{border-color:var(--yellow)}
        .stat-val{font-size:2em;font-weight:700}
        .stat.alert .stat-val{color:var(--red)}.stat.warn .stat-val{color:var(--yellow)}
        .stat-lbl{color:var(--dim);font-size:.85em;margin-top:5px}
        
        .grid{display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:20px}
        .panel{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:20px}
        .panel h2{font-size:1em;padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--border)}
        .chart-box{height:250px}
        
        .lower{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}
        .scroll{max-height:350px;overflow-y:auto}
        
        .alert-item{background:var(--bg3);padding:12px;border-radius:6px;margin-bottom:10px;border-left:3px solid var(--red)}
        .alert-item.warning{border-color:var(--yellow)}
        .alert-head{display:flex;justify-content:space-between;margin-bottom:6px}
        .alert-lvl{font-weight:600;text-transform:uppercase;font-size:.8em}
        .alert-lvl.critical{color:var(--red)}.alert-lvl.warning{color:var(--yellow)}
        .alert-score{font-weight:700;font-size:1.1em}
        .alert-txt{color:var(--dim);font-size:.85em}
        .alert-time{color:var(--dim);font-size:.75em}
        
        .tool{padding:10px 12px;border-left:3px solid var(--green);margin-bottom:8px;font-family:monospace;background:var(--bg3);border-radius:0 6px 6px 0}
        .tool.fail{border-color:var(--red)}
        .tool-time{color:var(--dim);font-size:.75em;float:right}
        
        .baseline div{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)}
        .baseline div:last-child{border:none}
        .bl-lbl{color:var(--dim)}
        
        .empty{color:var(--dim);text-align:center;padding:30px;font-style:italic}
        .btn{background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:8px 16px;border-radius:6px;cursor:pointer;margin-right:8px}
        .btn:hover{background:var(--border)}
        .btn.danger{border-color:var(--red);color:var(--red)}
        
        .how{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:20px;margin-bottom:20px}
        .how h3{margin-bottom:10px}
        .how code{background:var(--bg3);padding:2px 6px;border-radius:4px;font-size:.9em}
        .how pre{background:var(--bg);padding:12px;border-radius:6px;margin-top:10px;overflow-x:auto;font-size:.85em}
        
        @media(max-width:1000px){.stats{grid-template-columns:repeat(3,1fr)}.grid,.lower{grid-template-columns:1fr}}
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>🛡️ Agent Drift</h1>
            <div class="subtitle">Detecting prompt injection, memory poisoning & behavioral drift</div>
        </div>
        <div class="status"><div class="dot"></div><span>Monitoring</span></div>
    </div>
    
    <div class="alert-banner" id="alertBanner">
        <h3>⚠️ Behavioral Drift Detected</h3>
        <p id="alertMsg">Agent behavior has changed significantly from baseline.</p>
    </div>
    
    <div class="stats">
        <div class="stat"><div class="stat-val" id="sessions">0</div><div class="stat-lbl">Sessions</div></div>
        <div class="stat"><div class="stat-val" id="avgDrift">0.00</div><div class="stat-lbl">Avg Drift</div></div>
        <div class="stat"><div class="stat-val" id="tools">0</div><div class="stat-lbl">Tools Tracked</div></div>
        <div class="stat alert"><div class="stat-val" id="alerts">0</div><div class="stat-lbl">Critical</div></div>
        <div class="stat warn"><div class="stat-val" id="warnings">0</div><div class="stat-lbl">Warnings</div></div>
    </div>
    
    <div class="grid">
        <div class="panel">
            <h2>📈 Drift Score Over Time</h2>
            <div class="chart-box"><canvas id="chart1"></canvas></div>
        </div>
        <div class="panel">
            <h2>🧩 Behavior Components</h2>
            <div class="chart-box"><canvas id="chart2"></canvas></div>
        </div>
    </div>
    
    <div class="lower">
        <div class="panel">
            <h2>🚨 Drift Alerts</h2>
            <div class="scroll" id="alertList"><div class="empty">No alerts - agent behavior is normal</div></div>
        </div>
        <div class="panel">
            <h2>🔧 Tool Activity</h2>
            <div class="scroll" id="toolList"><div class="empty">No tools tracked yet</div></div>
        </div>
        <div class="panel">
            <h2>📊 Baseline</h2>
            <div class="baseline" id="baseline"></div>
            <br>
            <button class="btn danger" onclick="reset()">Reset Baseline</button>
            <button class="btn" onclick="endSession()">End Session</button>
        </div>
    </div>
    
    <div class="how">
        <h3>🔌 Integration</h3>
        <p>Your agent should POST to this monitor when using tools:</p>
        <pre>curl -X POST http://localhost:5001/tool -H "Content-Type: application/json" -d '{"tool":"exec"}'

# End session to get drift report:
curl -X POST http://localhost:5001/end</pre>
    </div>

    <script>
    let c1,c2;
    function init(){
        c1=new Chart(document.getElementById('chart1'),{type:'line',data:{labels:[],datasets:[
            {label:'Drift Score',data:[],borderColor:'#58a6ff',backgroundColor:'rgba(88,166,255,.1)',fill:true,tension:.4},
            {label:'Alert (0.5)',data:[],borderColor:'#f85149',borderDash:[5,5],pointRadius:0},
            {label:'Warning (0.3)',data:[],borderColor:'#d29922',borderDash:[5,5],pointRadius:0}
        ]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:1,grid:{color:'#30363d'},ticks:{color:'#8b949e'}},x:{grid:{color:'#30363d'},ticks:{color:'#8b949e',maxTicksLimit:8}}},plugins:{legend:{labels:{color:'#c9d1d9'}}}}});
        c2=new Chart(document.getElementById('chart2'),{type:'radar',data:{labels:['Tool Seq','Frequency','Timing','Decision','Files','Network','Output'],datasets:[{label:'Current',data:[0,0,0,0,0,0,0],borderColor:'#58a6ff',backgroundColor:'rgba(88,166,255,.2)'}]},options:{responsive:true,maintainAspectRatio:false,scales:{r:{min:0,max:1,ticks:{color:'#8b949e',backdropColor:'transparent'},grid:{color:'#30363d'},pointLabels:{color:'#c9d1d9'}}},plugins:{legend:{display:false}}}});
    }
    function fmt(t){return new Date(t*1000).toLocaleTimeString()}
    function update(){
        fetch('/api/state').then(r=>r.json()).then(d=>{
            document.getElementById('sessions').textContent=d.stats.total_sessions;
            document.getElementById('avgDrift').textContent=d.stats.avg_score.toFixed(2);
            document.getElementById('tools').textContent=d.recent_tools.length;
            document.getElementById('alerts').textContent=d.stats.alerts;
            document.getElementById('warnings').textContent=d.stats.warnings;
            
            // Alert banner
            const hasAlert=d.stats.alerts>0||d.stats.warnings>0;
            document.getElementById('alertBanner').className='alert-banner'+(hasAlert?' show':'');
            
            // Timeline
            if(d.reports.length){
                c1.data.labels=d.reports.slice(-30).map(r=>fmt(r.timestamp));
                c1.data.datasets[0].data=d.reports.slice(-30).map(r=>r.overall_drift_score||0);
                c1.data.datasets[1].data=d.reports.slice(-30).map(()=>0.5);
                c1.data.datasets[2].data=d.reports.slice(-30).map(()=>0.3);
                c1.update('none');
            }
            
            // Radar
            const comp=d.latest_components;
            if(comp&&Object.keys(comp).length){
                c2.data.datasets[0].data=[comp.tool_sequence||0,comp.tool_frequency||0,comp.timing||0,comp.decision||0,comp.file_access||0,comp.network||0,comp.output||0];
                c2.update('none');
            }
            
            // Alerts
            const al=document.getElementById('alertList');
            al.innerHTML=d.alerts.length?d.alerts.slice(-10).reverse().map(a=>`<div class="alert-item ${a.level}"><div class="alert-head"><span class="alert-lvl ${a.level}">${a.level}</span><span class="alert-time">${fmt(a.timestamp)}</span></div><div class="alert-score">${a.score.toFixed(3)}</div><div class="alert-txt">${(a.anomalies||[]).slice(0,2).join('; ')||'Behavioral drift detected'}</div></div>`).join(''):'<div class="empty">No alerts - agent behavior is normal</div>';
            
            // Tools
            const tl=document.getElementById('toolList');
            tl.innerHTML=d.recent_tools.length?d.recent_tools.slice(-20).reverse().map(t=>`<div class="tool ${t.success?'':'fail'}">${t.tool}<span class="tool-time">${fmt(t.time)}</span></div>`).join(''):'<div class="empty">No tools tracked yet</div>';
            
            // Baseline
            const b=d.baseline;
            document.getElementById('baseline').innerHTML=b.exists?`<div><span class="bl-lbl">Status</span><span>✅ Active</span></div><div><span class="bl-lbl">Sessions</span><span>${b.run_count}</span></div><div><span class="bl-lbl">Tools</span><span>${b.tool_count}</span></div><div><span class="bl-lbl">Known</span><span>${(b.tools||[]).slice(0,4).join(', ')||'-'}</span></div>`:'<div><span class="bl-lbl">Status</span><span>❌ None yet</span></div>';
        });
    }
    function reset(){if(confirm('Reset baseline? Next session will create new baseline.'))fetch('/api/reset',{method:'POST'}).then(update)}
    function endSession(){fetch('/api/end',{method:'POST'}).then(update)}
    init();update();setInterval(update,1000);
    </script>
</body>
</html>'''


def run_monitor(command: str = None, port: int = 5001, no_browser: bool = False):
    """Run the drift monitor."""
    global _monitor
    _monitor = AgentMonitor()
    
    server = HTTPServer(('0.0.0.0', port), Handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    
    print()
    print("  🛡️  Agent Drift")
    print("  " + "=" * 50)
    print(f"  Dashboard:  http://localhost:{port}")
    print()
    print("  Agents POST tool usage to:")
    print(f"    curl -X POST localhost:{port}/tool -d '{{\"tool\":\"name\"}}'")
    print()
    print("  End session for drift report:")
    print(f"    curl -X POST localhost:{port}/end")
    print("  " + "=" * 50)
    print()
    
    if not no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(f'http://localhost:{port}')).start()
    
    if command:
        print(f"  Wrapping: {command}")
        print("  " + "-" * 50)
        _monitor.ensure_session()
        
        try:
            process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, 
                                       stderr=subprocess.PIPE, text=True, bufsize=1)
            
            def read_out():
                for line in process.stdout:
                    print(line, end='')
            def read_err():
                for line in process.stderr:
                    print(line, end='', file=sys.stderr)
            
            threading.Thread(target=read_out, daemon=True).start()
            threading.Thread(target=read_err, daemon=True).start()
            process.wait()
        except KeyboardInterrupt:
            print("\n  Stopping...")
            process.terminate()
        
        report = _monitor.end_session()
        if report:
            icon = {'normal':'🟢','warning':'🟡','critical':'🔴'}.get(report.alert_level,'⚪')
            print(f"\n  {icon} Drift: {report.overall_drift_score:.3f} ({report.alert_level})")
    
    print("\n  Listening for tool events... (Ctrl+C to exit)")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n  Goodbye!")
        server.shutdown()


if __name__ == '__main__':
    cmd = ' '.join(sys.argv[1:]) if len(sys.argv) > 1 else None
    run_monitor(cmd)
