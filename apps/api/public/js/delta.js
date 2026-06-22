let sessionExpiresAt = null;
let sessionMonitorInterval = null;
let deltaTable = null;
let pollHandle = null;
let spotExchangeOptions = [];
const pendingSpotExchangeSelections = new Map();

const POLL_INTERVAL_MS = 2000;
const SESSION_CHECK_INTERVAL_MS = 30000;
const SESSION_WARNING_THRESHOLD_MS = 300000;

function getTokenHeaders() {
    const token = sessionStorage.getItem('jwt_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'same-origin',
    })
        .then(res => {
            if (!res.ok) throw new Error('Login failed');
            return res.json();
        })
        .then(data => {
            if (!data.success || !data.data.token) throw new Error(data.error || 'Login failed');

            sessionStorage.setItem('jwt_token', data.data.token);
            sessionExpiresAt = data.data.expiresAt || null;
            showContent();
        })
        .catch(err => {
            console.error('Login failed:', err);
            alert('Login failed. Please check your credentials.');
        });
}

function handleLogout() {
    stopPolling();
    stopSessionMonitor();
    sessionStorage.removeItem('jwt_token');
    fetch('/logout', { method: 'POST' }).then(() => showLogin());
}

function checkSession() {
    fetch('/api/session')
        .then(res => res.json())
        .then(data => {
            if (!data.authenticated) {
                if (data.reason === 'expired') {
                    handleSessionExpired(true);
                } else {
                    showLogin();
                }
                return;
            }

            sessionExpiresAt = data.expiresAt || null;
            showContent();

            if (data.isExpiringSoon) {
                showSessionWarningModal();
            }
        })
        .catch(err => {
            console.error('Session check failed:', err);
            showLogin();
        });
}

function showLogin() {
    stopPolling();
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('content').style.display = 'none';
}

function showContent() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    initTable();
    loadSpotExchanges().then(() => loadPositions()).catch(err => {
        console.error('Failed to load delta positions:', err);
        document.getElementById('deltaStatus').textContent = `Failed to load positions: ${err.message}`;
    });
    startPolling();
    startSessionMonitor();
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
    }[char]));
}

function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '';
}

function formatRisk(value) {
    const risk = Number(value);
    if (!Number.isFinite(risk)) return '';
    const pct = risk * 100;
    const cls = pct <= 10 ? 'risk-high' : pct <= 25 ? 'risk-medium' : 'risk-low';
    return `<span class="${cls}">${pct.toFixed(2)}%</span>`;
}

function formatPercent(value) {
    const ratio = Number(value);
    return Number.isFinite(ratio) ? `${(ratio * 100).toFixed(2)}%` : '';
}

function formatCurrency(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }) : '';
}

function ratioInput(row, field) {
    const value = row[field] ?? '';
    return `<input class="ratio-input" type="number" inputmode="decimal" min="0" step="0.0001" data-field="${field}" value="${escapeHtml(value)}">`;
}

function spotExchangeSelect(row) {
    const key = `${row.exchange}:${row.symbol}`;
    const value = pendingSpotExchangeSelections.has(key)
        ? pendingSpotExchangeSelections.get(key)
        : (row.spot_exchange ?? '');
    const options = ['', ...spotExchangeOptions];
    return `<select class="spot-exchange-select">${options.map(option => {
        const label = option || 'Select';
        const selected = option === value ? ' selected' : '';
        return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(label)}</option>`;
    }).join('')}</select>`;
}

function initTable() {
    if (deltaTable) return;
    deltaTable = $('#deltaTable').DataTable({
        order: [[10, 'asc'], [1, 'asc']],
        columns: [
            { data: 'exchange', render: data => escapeHtml(data) },
            { data: 'symbol', render: data => escapeHtml(data) },
            { data: 'short_position_amount', render: data => formatNumber(data) },
            { data: 'short_position_value', render: data => formatCurrency(data) },
            { data: null, orderable: false, render: row => spotExchangeSelect(row) },
            { data: 'spot_balance', render: data => formatNumber(data) },
            { data: 'spot_balance_value', render: data => formatCurrency(data) },
            { data: 'spot_coverage_ratio', render: data => formatPercent(data) },
            { data: 'mark_price', render: data => formatNumber(data) },
            { data: 'liq_price', render: data => formatNumber(data) },
            { data: 'liquidation_risk', render: data => formatRisk(data) },
            { data: null, orderable: false, render: row => ratioInput(row, 'danger_ratio') },
            { data: null, orderable: false, render: row => ratioInput(row, 'target_liq_ratio') },
            { data: null, orderable: false, render: row => ratioInput(row, 'reduce_ratio') },
            { data: 'ratio_updated_by', render: (data, type, row) => escapeHtml(data ? `${data} ${row.ratio_updated_at || ''}` : '') },
            { data: null, orderable: false, render: row => `<button class="save-spot-exchange" data-exchange="${escapeHtml(row.exchange)}" data-symbol="${escapeHtml(row.symbol)}">Save Spot</button> <button class="save-ratios" data-exchange="${escapeHtml(row.exchange)}" data-symbol="${escapeHtml(row.symbol)}">Save Ratios</button>` },
        ],
    });
}

async function loadSpotExchanges() {
    const res = await fetch('/api/delta/spot-exchanges', { credentials: 'same-origin', headers: getTokenHeaders() });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || json.message || 'Failed to load spot exchanges');
    spotExchangeOptions = json.data;
}

function captureSpotExchangeSelections() {
    $('#deltaTable tbody tr').each((_, row) => {
        const select = $(row).find('.spot-exchange-select');
        const button = $(row).find('.save-spot-exchange');
        if (select.length === 0 || button.length === 0) return;
        pendingSpotExchangeSelections.set(`${button.data('exchange')}:${button.data('symbol')}`, select.val());
    });
}

async function loadPositions({ preserveSpotSelections = true } = {}) {
    if (!deltaTable) return;
    if (preserveSpotSelections) captureSpotExchangeSelections();
    if (spotExchangeOptions.length === 0) await loadSpotExchanges();
    const res = await fetch('/api/delta/positions', { credentials: 'same-origin', headers: getTokenHeaders() });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || json.message || 'Failed to load positions');
    deltaTable.clear().rows.add(json.data).draw(false);
    document.getElementById('deltaStatus').textContent = `Loaded ${json.data.length} active shorts. Auto-refresh: 2s.`;
}

function rowRatios(button) {
    const row = $(button).closest('tr');
    const body = {};
    row.find('.ratio-input').each((_, input) => {
        body[$(input).data('field')] = $(input).val();
    });
    return body;
}

function rowSpotExchange(button) {
    return { spot_exchange: $(button).closest('tr').find('.spot-exchange-select').val() };
}


async function saveSpotExchange(button) {
    const exchange = $(button).data('exchange');
    const symbol = $(button).data('symbol');
    $(button).prop('disabled', true).text('Saving Spot...');
    try {
        const res = await fetch(`/api/delta/positions/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/spot-exchange`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: getTokenHeaders(),
            body: JSON.stringify(rowSpotExchange(button)),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || json.message || 'Save failed');
        pendingSpotExchangeSelections.delete(`${exchange}:${symbol}`);
        await loadPositions({ preserveSpotSelections: false });
    } catch (error) {
        alert(`Save failed: ${error.message}`);
    } finally {
        $(button).prop('disabled', false).text('Save Spot');
    }
}

async function saveRatios(button) {
    const exchange = $(button).data('exchange');
    const symbol = $(button).data('symbol');
    $(button).prop('disabled', true).text('Saving...');
    try {
        const res = await fetch(`/api/delta/positions/${encodeURIComponent(exchange)}/${encodeURIComponent(symbol)}/ratios`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: getTokenHeaders(),
            body: JSON.stringify(rowRatios(button)),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || json.message || 'Save failed');
        pendingSpotExchangeSelections.delete(`${exchange}:${symbol}`);
        await loadPositions();
    } catch (error) {
        alert(`Save failed: ${error.message}`);
    } finally {
        $(button).prop('disabled', false).text('Save');
    }
}

function spotExchangeSelectIsActive() {
    return document.activeElement?.classList?.contains('spot-exchange-select') === true;
}

function startPolling() {
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = setInterval(() => {
        if (spotExchangeSelectIsActive()) return;
        loadPositions().catch(err => console.error('Failed to refresh delta positions:', err));
    }, POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
    }
}

function startSessionMonitor() {
    if (sessionMonitorInterval) clearInterval(sessionMonitorInterval);
    updateSessionStatusDisplay();
    sessionMonitorInterval = setInterval(checkSessionStatus, SESSION_CHECK_INTERVAL_MS);
}

function stopSessionMonitor() {
    if (sessionMonitorInterval) {
        clearInterval(sessionMonitorInterval);
        sessionMonitorInterval = null;
    }
    sessionExpiresAt = null;
}

function checkSessionStatus() {
    fetch('/api/session')
        .then(res => res.json())
        .then(data => {
            if (!data.authenticated) {
                handleSessionExpired(data.reason === 'expired');
                return;
            }

            sessionExpiresAt = data.expiresAt;
            updateSessionStatusDisplay();

            if (data.isExpiringSoon) showSessionWarningModal();
        })
        .catch(err => console.error('Session check failed:', err));
}

function updateSessionStatusDisplay() {
    const statusEl = document.getElementById('sessionStatus');
    if (!statusEl || !sessionExpiresAt) return;

    const remainingMs = sessionExpiresAt - Date.now();
    const statusText = statusEl.querySelector('.session-time');

    if (remainingMs <= 0) {
        handleSessionExpired(true);
        return;
    }

    statusText.textContent = formatTimeRemaining(remainingMs);
    statusEl.classList.toggle('warning', remainingMs < SESSION_WARNING_THRESHOLD_MS);
    statusEl.classList.toggle('active', remainingMs >= SESSION_WARNING_THRESHOLD_MS);
}

function formatTimeRemaining(ms) {
    if (ms <= 0) return 'Expired';

    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function showSessionWarningModal() {
    const modal = document.getElementById('sessionExpiryModal');
    if (!modal || modal.style.display === 'block') return;

    modal.style.display = 'block';
    const countdownEl = modal.querySelector('.expiry-countdown');
    if (!countdownEl || !sessionExpiresAt) return;

    const updateCountdown = () => {
        const remaining = sessionExpiresAt - Date.now();
        if (remaining <= 0) {
            handleSessionExpired(true);
            return;
        }
        countdownEl.textContent = formatTimeRemaining(remaining);
    };

    updateCountdown();
    const countdownInterval = setInterval(() => {
        if (modal.style.display !== 'block') {
            clearInterval(countdownInterval);
            return;
        }
        updateCountdown();
    }, 1000);
}

function hideSessionWarningModal() {
    const modal = document.getElementById('sessionExpiryModal');
    if (modal) modal.style.display = 'none';
}

function handleSessionExpired(wasExpired) {
    stopPolling();
    stopSessionMonitor();
    sessionStorage.removeItem('jwt_token');

    const modal = document.getElementById('sessionExpiredModal');
    if (modal) {
        const messageEl = modal.querySelector('.expiry-message');
        if (messageEl) {
            messageEl.textContent = wasExpired
                ? 'Your session has expired. Please log in again to continue.'
                : 'Your session is no longer valid. Please log in again.';
        }
        modal.style.display = 'block';
    }
}

function redirectToLogin() {
    hideSessionWarningModal();
    const expiredModal = document.getElementById('sessionExpiredModal');
    if (expiredModal) expiredModal.style.display = 'none';
    showLogin();
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login').addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('refreshDeltaBtn').addEventListener('click', () => loadPositions().catch(err => alert(err.message)));
    $('#deltaTable').on('change', '.spot-exchange-select', function () {
        const row = $(this).closest('tr');
        const button = row.find('.save-spot-exchange');
        pendingSpotExchangeSelections.set(`${button.data('exchange')}:${button.data('symbol')}`, $(this).val());
    });
    $('#deltaTable').on('click', '.save-spot-exchange', function () { saveSpotExchange(this); });
    $('#deltaTable').on('click', '.save-ratios', function () { saveRatios(this); });
    checkSession();
});
