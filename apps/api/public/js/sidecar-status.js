/**
 * Sidecar API Status Client
 * Connects to the Sidecar WebSocket using the API extension token
 * and sends Phase 4 commands.
 */
(async function () {
    let ws = null;
    let isConnecting = false;

    const wsStatusEl = document.getElementById('wsStatus');
    const outStats = document.getElementById('outStats');
    const outSnapshot = document.getElementById('outSnapshot');
    const outCompare = document.getElementById('outCompare');
    const outTicker = document.getElementById('outTicker');
    const lvcCount = document.getElementById('lvcEntriesCount');

    function updateStatus(connected, text) {
        if (connected) {
            wsStatusEl.className = 'status-badge status-connected';
            wsStatusEl.textContent = text || 'Connected';
        } else {
            wsStatusEl.className = 'status-badge status-disconnected';
            wsStatusEl.textContent = text || 'Disconnected';
        }
    }

    async function initSidecar() {
        if (ws || isConnecting) return;
        isConnecting = true;
        updateStatus(false, 'Fetching Token...');

        try {
            const res = await fetch('/api/extension/token', {
                headers: { 'Accept': 'application/json' }
            });

            if (!res.ok) {
                // If unauthorized or error, maybe we are not logged in matching main site
                if (res.status === 401 || res.status === 403) {
                    document.getElementById('loginForm').style.display = 'block';
                    document.getElementById('content').style.display = 'none';
                }
                throw new Error('Failed to get token');
            }

            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'API Error');

            connect(data.data.sidecarUrl, data.data.token);

        } catch (err) {
            isConnecting = false;
            console.error('[Sidecar] Init Error:', err.message);
            updateStatus(false, 'Init Error');
            setTimeout(initSidecar, 5000);
        }
    }

    function connect(url, token) {
        let wsUrl = url;
        if (!wsUrl.startsWith('ws')) wsUrl = wsUrl.replace(/^http/, 'ws');

        console.log(`[Sidecar] Connecting to ${wsUrl}...`);
        try {
            ws = new WebSocket(wsUrl);
        } catch (e) {
            isConnecting = false;
            return;
        }

        ws.onopen = () => {
            console.log('[Sidecar] Sending Auth...');
            ws.send('Bearer ' + token);
        };

        ws.onmessage = (event) => {
            const msg = event.data;
            if (msg === 'AUTH_OK') {
                console.log('[Sidecar] Auth OK');
                updateStatus(true, 'Connected (Auth OK)');
                isConnecting = false;

                // Fetch initial stats
                sendCommand({ cmd: "stats" });

            } else if (msg === 'AUTH_FAILED') {
                updateStatus(false, 'Auth Failed');
                ws.close();
            } else {
                try {
                    const data = JSON.parse(msg);

                    // Handle API responses
                    if (data.type === 'api') {
                        const formatted = JSON.stringify(data.data, null, 2);
                        if (data.cmd === 'stats') {
                            outStats.textContent = formatted;
                            if (data.data && data.data.lvc_entries !== undefined) {
                                lvcCount.textContent = data.data.lvc_entries;
                            }
                        } else if (data.cmd === 'compare') {
                            outCompare.textContent = formatted;
                        } else if (data.cmd === 'ticker') {
                            outTicker.textContent = formatted;
                        } else if (data.cmd === 'snapshot') {
                            outSnapshot.textContent = formatted;
                        }
                    } else if (data.type === 'api_error') {
                        const errText = `ERROR: ${data.error}`;
                        if (data.cmd === 'stats') outStats.textContent = errText;
                        else if (data.cmd === 'compare') outCompare.textContent = errText;
                        else if (data.cmd === 'ticker') outTicker.textContent = errText;
                        else if (data.cmd === 'snapshot') outSnapshot.textContent = errText;
                        else alert(errText);
                    }
                } catch (e) {
                    // Ignore broadcast stream parsing here to avoid log spam
                    // We only care about API responses in this dashboard
                }
            }
        };

        ws.onclose = (e) => {
            console.warn('[Sidecar] Closed');
            updateStatus(false, 'Disconnected');
            ws = null;
            isConnecting = false;
            setTimeout(initSidecar, 3000);
        };
    }

    function sendCommand(payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            alert("WebSocket is not connected!");
            return;
        }
        ws.send(JSON.stringify(payload));
    }

    // UI Listeners
    document.getElementById('btnStats').addEventListener('click', () => {
        outStats.textContent = "Loading...";
        sendCommand({ cmd: "stats" });
    });

    document.getElementById('btnSnapshot').addEventListener('click', () => {
        outSnapshot.textContent = "Loading...";
        sendCommand({ cmd: "snapshot" });
    });

    document.getElementById('btnCompare').addEventListener('click', () => {
        outCompare.textContent = "Loading...";
        sendCommand({
            cmd: "compare",
            base: document.getElementById('compBase').value.toUpperCase(),
            quote: document.getElementById('compQuote').value.toUpperCase()
        });
    });

    document.getElementById('btnTicker').addEventListener('click', () => {
        outTicker.textContent = "Loading...";
        sendCommand({
            cmd: "ticker",
            exchange: document.getElementById('tickExch').value.toLowerCase(),
            base: document.getElementById('tickBase').value.toUpperCase(),
            quote: document.getElementById('tickQuote').value.toUpperCase()
        });
    });

    // Start
    initSidecar();

})();
