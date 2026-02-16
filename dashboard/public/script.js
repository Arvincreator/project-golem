const socket = io();

// DOM Elements
const connStatus = document.getElementById('conn-status');
const uptimeEl = document.getElementById('uptime');
const memBar = document.getElementById('mem-bar');
const memVal = document.getElementById('mem-val');
const cpuBar = document.getElementById('cpu-bar'); // Placeholder, simulating activity
const cpuVal = document.getElementById('cpu-val');
const queueCountEl = document.getElementById('queue-count');
const lastScheduleEl = document.getElementById('last-schedule');
const modelSelect = document.getElementById('model-select');

const logContainers = {
    global: document.getElementById('global-log'),
    chronos: document.getElementById('chronos-log'),
    queue: document.getElementById('queue-log')
};

// Utils
function appendLog(container, data) {
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'log-entry';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = `[${data.time}]`;

    const msgSpan = document.createElement('span');
    msgSpan.className = `log-msg ${data.type || ''}`;

    // Simple HTML escaping to prevent XSS (though internal tool)
    // But allowing colors if we parsed them. For now simple text.
    msgSpan.textContent = data.msg;

    div.appendChild(timeSpan);
    div.appendChild(msgSpan);

    container.appendChild(div);

    // Auto scroll
    container.scrollTop = container.scrollHeight;

    // Limit log entries to prevent memory leak
    if (container.childNodes.length > 500) {
        container.removeChild(container.firstChild);
    }
}

// Model Selection
modelSelect.addEventListener('change', (e) => {
    const newModel = e.target.value;
    // Disable temporarily
    modelSelect.disabled = true;

    socket.emit('set_model', newModel, (response) => {
        modelSelect.disabled = false;
        if (!response.success) {
            alert('Switch failed: ' + response.msg);
            // Revert selection if failed (simple retrieval)
            socket.emit('get_model', (data) => {
                if (data.model) modelSelect.value = data.model;
            });
        }
    });
});

// Socket Events
socket.on('connect', () => {
    connStatus.classList.add('connected');
    connStatus.querySelector('.label').textContent = 'CONNECTED';
});

socket.on('disconnect', () => {
    connStatus.classList.remove('connected');
    connStatus.querySelector('.label').textContent = 'DISCONNECTED';
});

socket.on('init', (data) => {
    queueCountEl.textContent = data.queueCount;
    lastScheduleEl.textContent = data.lastSchedule;
    if (data.model) modelSelect.value = data.model;
});

socket.on('model_update', (data) => {
    if (data.model) modelSelect.value = data.model;
});

socket.on('heartbeat', (data) => {
    // System Core Update
    uptimeEl.textContent = data.uptime;

    const memUsage = parseFloat(data.memUsage);
    memVal.textContent = memUsage.toFixed(1) + ' MB';
    // Assume 1GB max for progress bar visualization
    const memPercent = Math.min((memUsage / 1024) * 100, 100);
    memBar.style.width = `${memPercent}%`;

    // CPU sim
    cpuVal.textContent = 'Active';
    cpuBar.style.width = `${Math.random() * 50 + 20}%`; // Fake oscillation for liveliness
});

socket.on('state_update', (data) => {
    if (data.queueCount !== undefined) queueCountEl.textContent = data.queueCount;
    if (data.lastSchedule !== undefined) lastScheduleEl.textContent = data.lastSchedule;
});

socket.on('log', (data) => {
    // 1. Add to Global Log
    appendLog(logContainers.global, data);

    // 2. Add to Specific Logs
    if (data.type === 'chronos') {
        appendLog(logContainers.chronos, data);
    } else if (data.type === 'queue') {
        appendLog(logContainers.queue, data);
    }
});
