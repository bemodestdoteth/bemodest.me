let sessionExpiresAt = null;
let sessionMonitorInterval = null;
let snapshotInterval = null;

const SESSION_CHECK_INTERVAL_MS = 30000;
const SESSION_WARNING_THRESHOLD_MS = 300000;
const SNAPSHOT_INTERVAL_MS = 2000;

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
    stopSessionMonitor();
    stopSnapshotPolling();
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
    stopSnapshotPolling();
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('content').style.display = 'none';
}

function showContent() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    startSessionMonitor();
    startSnapshotPolling();
}

function formatPrice(value, currency) {
    if (!Number.isFinite(value)) return '--';
    const suffix = currency ? ` ${currency}` : '';
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}${suffix}`;
}

function formatPercent(value) {
    if (!Number.isFinite(value)) return '--';
    return `${value.toFixed(3)}%`;
}

function formatUsdFromKrw(quote, fxQuote) {
    if (quote?.status !== 'ok' || fxQuote?.status !== 'ok' || !Number.isFinite(quote.price) || !Number.isFinite(fxQuote.price) || fxQuote.price === 0) {
        return '--';
    }
    return formatPrice(quote.price / fxQuote.price, 'USD');
}

function statusReason(...items) {
    const issue = items.find(item => item?.status && item.status !== 'ok');
    return issue?.reason || issue?.detail || 'ok';
}

function spreadClass(spread) {
    if (spread?.status !== 'ok' || !Number.isFinite(spread.percent)) return 'muted';
    if (spread.percent > 0) return 'positive';
    if (spread.percent < 0) return 'negative';
    return '';
}

function recommendedActionForUsdtSpread(spread, referenceLabel) {
    if (spread?.status !== 'ok' || !Number.isFinite(spread.percent)) return null;
    if (spread.percent > 0) {
        return {
            status: 'short',
            label: 'Short Hyperliquid',
            detail: `${referenceLabel} USDT spread is positive, so Hyperliquid is richer than the KRW reference.`,
        };
    }
    if (spread.percent < 0) {
        return {
            status: 'long',
            label: 'Long Hyperliquid',
            detail: `${referenceLabel} USDT spread is negative, so Hyperliquid is cheaper than the KRW reference.`,
        };
    }
    return {
        status: 'neutral',
        label: 'Neutral/Wait',
        detail: `${referenceLabel} USDT spread is flat against Hyperliquid.`,
    };
}

function recommendedActionReference(snapshot) {
    const nxtSpread = snapshot.spreads.upbitUsdt?.nxt;
    if (nxtSpread?.status === 'ok') {
        return { label: 'NXT', spread: nxtSpread };
    }
    return { label: 'Regular market', spread: snapshot.spreads.upbitUsdt?.regularMarket };
}

function priceChangeDetail(snapshot) {
    return [
        `Hyperliquid: ${snapshot.prices.hyperliquid?.status === 'ok' ? formatPrice(snapshot.prices.hyperliquid.price, snapshot.prices.hyperliquid.currency) : '--'}`,
        `Regular: ${snapshot.prices.regularMarket?.status === 'ok' ? formatPrice(snapshot.prices.regularMarket.price, snapshot.prices.regularMarket.currency) : '--'}`,
        `NXT: ${snapshot.prices.nxt?.status === 'ok' ? formatPrice(snapshot.prices.nxt.price, snapshot.prices.nxt.currency) : '--'}`,
    ].join(' · ');
}

function formatTimestamp(value, fetchedAt) {
    const timestamp = value || fetchedAt;
    if (!timestamp) return 'timestamp unavailable';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return String(timestamp);
    return date.toLocaleString();
}

function quoteStatus(quote) {
    if (!quote) return 'missing';
    if (quote.status === 'ok') return formatTimestamp(quote.timestamp, quote.fetchedAt);
    return quote.reason || 'unavailable';
}

function renderQuote(prefix, quote) {
    const priceEl = document.getElementById(`${prefix}Price`);
    const metaEl = document.getElementById(`${prefix}Meta`);

    if (!quote || quote.status !== 'ok') {
        priceEl.textContent = '--';
        metaEl.textContent = quoteStatus(quote);
        return;
    }

    priceEl.textContent = formatPrice(quote.price, quote.currency);
    metaEl.textContent = quoteStatus(quote);
}

function setCell(id, value, className = '') {
    const cell = document.getElementById(id);
    cell.textContent = value;
    cell.className = className;
}

function renderRecommendedAction(snapshot) {
    const cardEl = document.getElementById('hynixRecommendedActionCard');
    const labelEl = document.getElementById('hynixRecommendedActionLabel');
    const spreadEl = document.getElementById('hynixRecommendedActionSpread');
    const detailEl = document.getElementById('hynixRecommendedActionDetail');
    const reference = recommendedActionReference(snapshot);
    const action = recommendedActionForUsdtSpread(reference.spread, reference.label);

    if (!action) {
        cardEl.hidden = true;
        cardEl.className = 'premium-action-card neutral';
        labelEl.textContent = 'Neutral/Wait';
        spreadEl.textContent = '--';
        detailEl.textContent = `USDT spread is unavailable. ${priceChangeDetail(snapshot)}.`;
        return;
    }

    cardEl.hidden = false;
    cardEl.className = `premium-action-card ${action.status}`;
    labelEl.textContent = action.label;
    spreadEl.textContent = formatPercent(reference.spread.percent);
    detailEl.textContent = `${action.detail} ${reference.label} USDT spread: ${formatPercent(reference.spread.percent)}. ${priceChangeDetail(snapshot)}.`;
}

function renderComparisonRow(prefix, quote, snapshot) {
    const currentForexSpread = snapshot.spreads.currentForex?.[prefix];
    const upbitUsdtSpread = snapshot.spreads.upbitUsdt?.[prefix];
    const hyperliquid = snapshot.prices.hyperliquid;

    setCell(`${prefix}KrwPrice`, quote?.status === 'ok' ? formatPrice(quote.price, quote.currency) : '--', quote?.status === 'ok' ? '' : 'muted');
    setCell(`${prefix}CurrentForexUsd`, formatUsdFromKrw(quote, snapshot.forex.current), quote?.status === 'ok' && snapshot.forex.current?.status === 'ok' ? '' : 'muted');
    setCell(`${prefix}UpbitUsdtUsd`, formatUsdFromKrw(quote, snapshot.forex.upbitUsdt), quote?.status === 'ok' && snapshot.forex.upbitUsdt?.status === 'ok' ? '' : 'muted');
    setCell(`${prefix}HyperliquidUsd`, hyperliquid?.status === 'ok' ? formatPrice(hyperliquid.price, hyperliquid.currency) : '--', hyperliquid?.status === 'ok' ? '' : 'muted');
    setCell(`${prefix}CurrentForexSpread`, currentForexSpread?.status === 'ok' ? formatPercent(currentForexSpread.percent) : '--', spreadClass(currentForexSpread));
    setCell(`${prefix}UpbitUsdtSpread`, upbitUsdtSpread?.status === 'ok' ? formatPercent(upbitUsdtSpread.percent) : '--', spreadClass(upbitUsdtSpread));
    setCell(`${prefix}ComparisonStatus`, statusReason(quote, hyperliquid, currentForexSpread, upbitUsdtSpread), statusReason(quote, hyperliquid, currentForexSpread, upbitUsdtSpread) === 'ok' ? '' : 'muted');
}

function etfMeta(quote, derivedQuote) {
    if (!quote || quote.status !== 'ok') return quoteStatus(quote);
    const nav = quote.raw?.nav;
    const derived = derivedQuote?.status === 'ok' ? `underlying-like ${formatPrice(derivedQuote.price, derivedQuote.currency)}` : quoteStatus(derivedQuote);
    return Number.isFinite(nav) ? `NAV ${formatPrice(nav, quote.currency)} · ${derived}` : derived;
}

function renderSnapshot(snapshot) {
    renderQuote('regular', snapshot.prices.regularMarket);
    renderQuote('nxt', snapshot.prices.nxt);
    renderQuote('etf', snapshot.prices.etf);
    document.getElementById('etfMeta').textContent = etfMeta(snapshot.prices.etf, snapshot.prices.etfUnderlyingLike);
    renderQuote('hyperliquid', snapshot.prices.hyperliquid);

    renderComparisonRow('regularMarket', snapshot.prices.regularMarket, snapshot);
    renderComparisonRow('nxt', snapshot.prices.nxt, snapshot);
    renderComparisonRow('etf', snapshot.prices.etfUnderlyingLike, snapshot);
    renderRecommendedAction(snapshot);

    document.getElementById('hynixStatus').textContent = `Last updated ${formatTimestamp(snapshot.fetchedAt)}`;
    document.getElementById('hynixStatus').classList.remove('error');
}

function loadSnapshot() {
    return fetch('/api/hynix/snapshot', { headers: getTokenHeaders() })
        .then(res => {
            if (!res.ok) throw new Error(`Snapshot failed: ${res.status}`);
            return res.json();
        })
        .then(payload => {
            if (!payload.success) throw new Error(payload.message || 'Snapshot failed');
            renderSnapshot(payload.data);
        })
        .catch(err => {
            console.error('Snapshot failed:', err);
            const status = document.getElementById('hynixStatus');
            status.textContent = err.message;
            status.classList.add('error');
        });
}

function startSnapshotPolling() {
    if (snapshotInterval) return;
    loadSnapshot();
    snapshotInterval = setInterval(loadSnapshot, SNAPSHOT_INTERVAL_MS);
}

function stopSnapshotPolling() {
    if (snapshotInterval) clearInterval(snapshotInterval);
    snapshotInterval = null;
}

function startSessionMonitor() {
    updateSessionStatus();
    if (sessionMonitorInterval) return;
    sessionMonitorInterval = setInterval(() => {
        updateSessionStatus();
        if (sessionExpiresAt) {
            const timeLeft = new Date(sessionExpiresAt).getTime() - Date.now();
            if (timeLeft <= 0) {
                handleSessionExpired(false);
            } else if (timeLeft <= SESSION_WARNING_THRESHOLD_MS) {
                showSessionWarningModal();
            }
        }
    }, SESSION_CHECK_INTERVAL_MS);
}

function stopSessionMonitor() {
    if (sessionMonitorInterval) clearInterval(sessionMonitorInterval);
    sessionMonitorInterval = null;
}

function updateSessionStatus() {
    const statusEl = document.getElementById('sessionStatus');
    const timeEl = statusEl.querySelector('.session-time');
    if (!sessionExpiresAt) {
        timeEl.textContent = 'active';
        return;
    }

    const timeLeft = new Date(sessionExpiresAt).getTime() - Date.now();
    if (timeLeft <= 0) {
        timeEl.textContent = 'expired';
        statusEl.className = 'session-status expired';
        return;
    }

    const minutes = Math.floor(timeLeft / 60000);
    timeEl.textContent = `${minutes}m`;
    statusEl.className = timeLeft <= SESSION_WARNING_THRESHOLD_MS
        ? 'session-status warning'
        : 'session-status active';
}

function showSessionWarningModal() {
    const modal = document.getElementById('sessionExpiryModal');
    const countdown = modal.querySelector('.expiry-countdown');
    if (sessionExpiresAt) {
        const timeLeft = Math.max(0, new Date(sessionExpiresAt).getTime() - Date.now());
        countdown.textContent = `${Math.ceil(timeLeft / 60000)} minutes`;
    }
    modal.style.display = 'flex';
}

function hideSessionWarningModal() {
    document.getElementById('sessionExpiryModal').style.display = 'none';
}

function handleSessionExpired(showModal) {
    stopSessionMonitor();
    stopSnapshotPolling();
    sessionStorage.removeItem('jwt_token');
    if (showModal) {
        document.getElementById('sessionExpiredModal').style.display = 'flex';
    } else {
        showLogin();
    }
}

function redirectToLogin() {
    document.getElementById('sessionExpiredModal').style.display = 'none';
    showLogin();
}

window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('login').addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    document.getElementById('refreshBtn').addEventListener('click', loadSnapshot);
    checkSession();
});
