if (process.env.DRIFT_MONITOR) {
    const http = require('http');
    const data = JSON.stringify({ 
        tool: toolCall.name, 
        success: !isError 
    });
    const req = http.request({
        hostname: 'localhost',
        port: process.env.DRIFT_MONITOR_PORT || 5001,
        path: '/tool',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, () => {});
    req.on('error', () => {}); // Silent fail
    req.write(data);
    req.end();
}
