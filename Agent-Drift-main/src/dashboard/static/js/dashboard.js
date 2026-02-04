/**
 * Agent Drift Detector - SIEM Dashboard JavaScript
 */

// State
let socket = null;
let driftTimelineChart = null;
let componentChart = null;
let state = {
    drift_history: [],
    alerts: [],
    baseline: {},
    canary: {},
    stats: {}
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    initWebSocket();
    fetchInitialState();
});

// Initialize Charts
function initCharts() {
    // Drift Timeline Chart
    const timelineCtx = document.getElementById('drift-timeline-chart').getContext('2d');
    driftTimelineChart = new Chart(timelineCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Drift Score',
                data: [],
                borderColor: '#58a6ff',
                backgroundColor: 'rgba(88, 166, 255, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointHoverRadius: 6,
            }, {
                label: 'Alert Threshold',
                data: [],
                borderColor: '#f85149',
                borderDash: [5, 5],
                pointRadius: 0,
                fill: false,
            }, {
                label: 'Warning Threshold',
                data: [],
                borderColor: '#d29922',
                borderDash: [5, 5],
                pointRadius: 0,
                fill: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            scales: {
                y: {
                    min: 0,
                    max: 1,
                    grid: { color: '#30363d' },
                    ticks: { color: '#8b949e' }
                },
                x: {
                    grid: { color: '#30363d' },
                    ticks: { color: '#8b949e', maxTicksLimit: 10 }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#c9d1d9' }
                }
            }
        }
    });

    // Component Breakdown Chart
    const componentCtx = document.getElementById('component-chart').getContext('2d');
    componentChart = new Chart(componentCtx, {
        type: 'radar',
        data: {
            labels: ['Tool Seq', 'Tool Freq', 'Timing', 'Decision', 'File', 'Network', 'Output'],
            datasets: [{
                label: 'Latest',
                data: [0, 0, 0, 0, 0, 0, 0],
                borderColor: '#58a6ff',
                backgroundColor: 'rgba(88, 166, 255, 0.2)',
            }, {
                label: 'Average',
                data: [0, 0, 0, 0, 0, 0, 0],
                borderColor: '#3fb950',
                backgroundColor: 'rgba(63, 185, 80, 0.1)',
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    min: 0,
                    max: 1,
                    ticks: { color: '#8b949e', backdropColor: 'transparent' },
                    grid: { color: '#30363d' },
                    pointLabels: { color: '#c9d1d9' }
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#c9d1d9' }
                }
            }
        }
    });
}

// WebSocket Connection
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = io();

    socket.on('connect', () => {
        updateConnectionStatus(true);
        console.log('WebSocket connected');
    });

    socket.on('disconnect', () => {
        updateConnectionStatus(false);
        console.log('WebSocket disconnected');
    });

    socket.on('connected', (data) => {
        console.log('Server acknowledged connection:', data);
    });

    socket.on('full_state', (data) => {
        state = data;
        updateUI();
    });

    socket.on('drift_update', (data) => {
        // Add new report to history
        if (data.report) {
            state.drift_history.push(data.report);
            if (state.drift_history.length > 100) {
                state.drift_history = state.drift_history.slice(-100);
            }
        }
        if (data.stats) {
            state.stats = data.stats;
        }
        updateUI();
    });
}

function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connection-status');
    const dotEl = statusEl.querySelector('.status-dot');
    const textEl = statusEl.querySelector('.status-text');
    
    if (connected) {
        dotEl.classList.remove('disconnected');
        dotEl.classList.add('connected');
        textEl.textContent = 'Connected';
    } else {
        dotEl.classList.remove('connected');
        dotEl.classList.add('disconnected');
        textEl.textContent = 'Disconnected';
    }
}

// Fetch initial state via REST
async function fetchInitialState() {
    try {
        const response = await fetch('/api/state');
        const data = await response.json();
        state = data;
        updateUI();
    } catch (err) {
        console.error('Failed to fetch initial state:', err);
    }
}

// Update UI
function updateUI() {
    updateStats();
    updateDriftTimeline();
    updateComponentChart();
    updateAlerts();
    updateAnomalies();
    updateBaseline();
    updateCanary();
    updateTimestamp();
}

function updateStats() {
    const stats = state.stats || {};
    document.getElementById('stat-total-runs').textContent = stats.total_runs || 0;
    document.getElementById('stat-avg-drift').textContent = (stats.avg_drift_score || 0).toFixed(2);
    document.getElementById('stat-alerts').textContent = stats.alert_count || 0;
    document.getElementById('stat-warnings').textContent = stats.warning_count || 0;
    document.getElementById('stat-24h-runs').textContent = stats.last_24h_runs || 0;
}

function updateDriftTimeline() {
    const history = state.drift_history || [];
    if (history.length === 0) return;

    const labels = history.map((h, i) => {
        if (h.timestamp) {
            const d = new Date(h.timestamp * 1000);
            return d.toLocaleTimeString();
        }
        return `Run ${i + 1}`;
    });

    const scores = history.map(h => h.overall_drift_score || 0);
    const alertLine = history.map(() => 0.5);
    const warningLine = history.map(() => 0.3);

    driftTimelineChart.data.labels = labels;
    driftTimelineChart.data.datasets[0].data = scores;
    driftTimelineChart.data.datasets[1].data = alertLine;
    driftTimelineChart.data.datasets[2].data = warningLine;
    driftTimelineChart.update('none');
}

function updateComponentChart() {
    const history = state.drift_history || [];
    if (history.length === 0) return;

    const latest = history[history.length - 1];
    const components = ['tool_sequence', 'tool_frequency', 'timing', 'decision', 'file_access', 'network', 'output'];

    // Latest values
    const latestValues = components.map(c => (latest.component_scores || {})[c] || 0);

    // Average values
    const avgValues = components.map(c => {
        const vals = history.map(h => (h.component_scores || {})[c] || 0).filter(v => v > 0);
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    });

    componentChart.data.datasets[0].data = latestValues;
    componentChart.data.datasets[1].data = avgValues;
    componentChart.update('none');
}

function updateAlerts() {
    const alerts = state.alerts || [];
    const listEl = document.getElementById('alert-list');
    const unackedEl = document.getElementById('unacked-count');

    const unackedCount = alerts.filter(a => !a.acknowledged).length;
    unackedEl.textContent = unackedCount;

    if (alerts.length === 0) {
        listEl.innerHTML = '<div class="empty-state">No alerts yet</div>';
        return;
    }

    // Show most recent first
    const sorted = [...alerts].reverse();
    
    listEl.innerHTML = sorted.map(alert => `
        <div class="alert-item ${alert.level} ${alert.acknowledged ? 'acknowledged' : ''}">
            <div class="alert-header">
                <span class="alert-level ${alert.level}">${alert.level}</span>
                <span class="alert-time">${formatTime(alert.timestamp)}</span>
            </div>
            <div class="alert-score">Score: ${alert.score.toFixed(3)}</div>
            <div class="alert-anomalies">${(alert.anomalies || []).slice(0, 3).join('<br>')}</div>
            ${!alert.acknowledged ? `
                <div class="alert-actions">
                    <button onclick="acknowledgeAlert('${alert.id}')">Acknowledge</button>
                </div>
            ` : ''}
        </div>
    `).join('');
}

function updateAnomalies() {
    const history = state.drift_history || [];
    const listEl = document.getElementById('anomaly-list');

    // Collect all anomalies from history
    const anomalies = [];
    history.forEach(h => {
        (h.anomalies || []).forEach(a => {
            if (!a.includes('First run') && !a.includes('Baseline created')) {
                anomalies.push({
                    run_id: h.run_id,
                    message: a,
                    timestamp: h.timestamp
                });
            }
        });
    });

    if (anomalies.length === 0) {
        listEl.innerHTML = '<div class="empty-state">No anomalies detected</div>';
        return;
    }

    // Show most recent first
    const sorted = [...anomalies].reverse().slice(0, 20);

    listEl.innerHTML = sorted.map(a => `
        <div class="anomaly-item">
            <div class="run-id">${a.run_id}</div>
            <div class="message">${a.message}</div>
            <div class="time">${formatTime(a.timestamp)}</div>
        </div>
    `).join('');
}

function updateBaseline() {
    const baseline = state.baseline || {};
    
    document.getElementById('baseline-status').textContent = baseline.exists ? '✅ Active' : '❌ None';
    document.getElementById('baseline-runs').textContent = baseline.run_count || 0;
    document.getElementById('baseline-created').textContent = baseline.created_at ? formatDate(baseline.created_at) : '--';
    document.getElementById('baseline-updated').textContent = baseline.updated_at ? formatDate(baseline.updated_at) : '--';
    document.getElementById('baseline-tools').textContent = (baseline.tools || []).join(', ') || '--';
}

function updateCanary() {
    const canary = state.canary || {};
    const results = canary.recent_results || [];

    ['classification', 'arithmetic', 'sequence'].forEach(type => {
        const card = document.getElementById(`canary-${type}`);
        const statusEl = document.getElementById(`canary-${type}-status`);
        
        const result = results.find(r => r.task_type === type);
        
        card.classList.remove('passed', 'failed');
        
        if (result) {
            if (result.passed) {
                card.classList.add('passed');
                statusEl.textContent = '✓ Passed';
            } else {
                card.classList.add('failed');
                statusEl.textContent = '✗ Failed';
            }
        } else {
            statusEl.textContent = 'Not run';
        }
    });
}

function updateTimestamp() {
    const el = document.getElementById('last-update');
    el.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
}

// Actions
async function acknowledgeAlert(alertId) {
    try {
        await fetch(`/api/alerts/${alertId}/ack`, { method: 'POST' });
        // Update local state
        const alert = state.alerts.find(a => a.id === alertId);
        if (alert) alert.acknowledged = true;
        updateAlerts();
    } catch (err) {
        console.error('Failed to acknowledge alert:', err);
    }
}

async function resetBaseline() {
    if (!confirm('Are you sure you want to reset the baseline? The next run will become the new baseline.')) {
        return;
    }
    
    try {
        await fetch('/api/baseline/reset', { method: 'POST' });
        fetchInitialState();
    } catch (err) {
        console.error('Failed to reset baseline:', err);
    }
}

async function runCanaries() {
    try {
        const response = await fetch('/api/canary/run', { method: 'POST' });
        const results = await response.json();
        
        // Update canary display
        results.forEach(result => {
            const card = document.getElementById(`canary-${result.task_type}`);
            const statusEl = document.getElementById(`canary-${result.task_type}-status`);
            
            card.classList.remove('passed', 'failed');
            
            if (result.passed) {
                card.classList.add('passed');
                statusEl.textContent = '✓ Passed';
            } else {
                card.classList.add('failed');
                statusEl.textContent = `✗ Failed (${result.deviation_score.toFixed(2)})`;
            }
        });
    } catch (err) {
        console.error('Failed to run canaries:', err);
    }
}

async function refreshHistory() {
    try {
        const response = await fetch('/api/history?limit=100');
        state.drift_history = await response.json();
        updateDriftTimeline();
        updateComponentChart();
        updateAnomalies();
    } catch (err) {
        console.error('Failed to refresh history:', err);
    }
}

// Utility functions
function formatTime(timestamp) {
    if (!timestamp) return '--';
    const d = new Date(timestamp * 1000);
    return d.toLocaleTimeString();
}

function formatDate(isoString) {
    if (!isoString) return '--';
    const d = new Date(isoString);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

// Periodic refresh - always reload to pick up CLI runs
setInterval(() => {
    fetchInitialState();
}, 5000);  // Every 5 seconds
