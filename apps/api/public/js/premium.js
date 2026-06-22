let sessionExpiresAt = null;
let sessionMonitorInterval = null;
let topChart = null;
let premiumChart = null;
let topSeries = {};
let premiumSeries = {};
let latestData = null;

const SESSION_CHECK_INTERVAL_MS = 30000;
const SESSION_WARNING_THRESHOLD_MS = 300000;
const SERIES_COLORS = {
    assetA: '#2196F3',
    assetB: '#F44336',
    premium: '#4CAF50',
};

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
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('content').style.display = 'none';
}

function showContent() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    requestAnimationFrame(() => {
        initializeCharts();
        resizeCharts();
    });
    startSessionMonitor();
}

function initializeCharts() {
    if (topChart || premiumChart) return;

    topChart = LightweightCharts.createChart(document.getElementById('topChart'), chartOptions());
    premiumChart = LightweightCharts.createChart(document.getElementById('premiumChart'), chartOptions());
    syncChartTimeScales();

    window.addEventListener('resize', resizeCharts);
}

function syncChartTimeScales() {
    let syncing = false;

    const syncRange = targetChart => range => {
        if (syncing || !range) return;
        syncing = true;
        targetChart.timeScale().setVisibleRange(range);
        syncing = false;
    };

    topChart.timeScale().subscribeVisibleTimeRangeChange(syncRange(premiumChart));
    premiumChart.timeScale().subscribeVisibleTimeRangeChange(syncRange(topChart));
}

function chartOptions() {
    return {
        layout: { background: { color: '#ffffff' }, textColor: '#333' },
        grid: { vertLines: { color: '#f0f0f0' }, horzLines: { color: '#f0f0f0' } },
        timeScale: { timeVisible: true, secondsVisible: false },
        leftPriceScale: { visible: true, borderVisible: false },
        rightPriceScale: { visible: true, borderVisible: false },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    };
}

function chartSize(element) {
    return {
        width: element.clientWidth || element.parentElement?.clientWidth || window.innerWidth,
        height: element.clientHeight || 360,
    };
}

function resizeCharts() {
    const topEl = document.getElementById('topChart');
    const premiumEl = document.getElementById('premiumChart');
    if (topChart) topChart.applyOptions(chartSize(topEl));
    if (premiumChart) premiumChart.applyOptions(chartSize(premiumEl));
}

function clearPremiumTargetLines() {
    if (premiumSeries.premium && premiumSeries.entryTarget) {
        premiumSeries.premium.removePriceLine(premiumSeries.entryTarget);
    }
    if (premiumSeries.premium && premiumSeries.exitTarget) {
        premiumSeries.premium.removePriceLine(premiumSeries.exitTarget);
    }
    if (premiumSeries.premium && premiumSeries.zeroLine) {
        premiumSeries.premium.removePriceLine(premiumSeries.zeroLine);
    }
}

function clearChartSeries() {
    for (const series of Object.values(topSeries)) topChart.removeSeries(series);
    clearPremiumTargetLines();
    if (premiumSeries.premium) premiumChart.removeSeries(premiumSeries.premium);
    topSeries = {};
    premiumSeries = {};
}

function visibleRangeWithPreviousCandle(data, range) {
    const previousCandle = data.premium.candles
        .filter(candle => candle.time < range.from)
        .at(-1);

    if (!previousCandle) return range;
    return { ...range, from: previousCandle.time };
}

function renderCharts(data, options = {}) {
    const { fitContent = true, visibleRange = null } = options;
    latestData = data;
    clearChartSeries();
    renderTargets();
    renderPremiumTitle();
    renderTopChart(document.querySelector('[data-chart="top"].active').dataset.mode);
    renderPremiumChart(document.querySelector('[data-chart="premium"].active').dataset.mode);

    if (fitContent) {
        topChart.timeScale().fitContent();
        premiumChart.timeScale().fitContent();
        return;
    }

    if (visibleRange) {
        const restoredRange = visibleRangeWithPreviousCandle(data, visibleRange);
        topChart.timeScale().setVisibleRange(restoredRange);
        premiumChart.timeScale().setVisibleRange(restoredRange);
    }
}

function visibleRangeError(message) {
    const statusEl = document.getElementById('premiumStatus');
    statusEl.classList.add('error');
    statusEl.textContent = message;
}

function currentAssetComparisonVisibleRange() {
    if (!topChart || !latestData) {
        visibleRangeError('Load candles before reloading the visible range.');
        return null;
    }

    const range = topChart.timeScale().getVisibleRange();
    const from = Number(range?.from);
    const to = Number(range?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
        visibleRangeError('Asset Comparison visible range is unavailable.');
        return null;
    }

    return { from, to };
}

function formatPercent(value) {
    return `${value.toFixed(2)}%`;
}

function renderTargets() {
    const entryEl = document.getElementById('entryTargetPct');
    const exitEl = document.getElementById('exitTargetDisplay');
    const { entryTargetPct, exitTargetPct } = latestData.targets;

    entryEl.textContent = Number.isFinite(entryTargetPct) ? formatPercent(entryTargetPct) : '--';
    exitEl.textContent = Number.isFinite(exitTargetPct) ? formatPercent(exitTargetPct) : 'Manual';
    renderRecommendedAction();
}

function renderRecommendedAction() {
    const cardEl = document.getElementById('recommendedActionCard');
    const labelEl = document.getElementById('recommendedActionLabel');
    const detailEl = document.getElementById('recommendedActionDetail');
    const action = latestData.targets.recommendedAction;

    if (!action) {
        cardEl.hidden = true;
        cardEl.className = 'premium-action-card neutral';
        labelEl.textContent = 'Neutral/Wait';
        detailEl.textContent = 'USDT spread or target is unavailable.';
        return;
    }

    const current = Number.isFinite(latestData.targets.currentUsdtSpreadPct)
        ? formatPercent(latestData.targets.currentUsdtSpreadPct)
        : '--';
    const target = Number.isFinite(latestData.targets.entryTargetPct)
        ? formatPercent(latestData.targets.entryTargetPct)
        : '--';
    const delta = Number.isFinite(action.deltaPct) ? formatPercent(action.deltaPct) : '--';

    cardEl.hidden = false;
    cardEl.className = `premium-action-card ${action.status}`;
    labelEl.textContent = action.label;
    detailEl.textContent = `${action.detail} Current: ${current}, target: ${target}, delta: ${delta}.`;
}

function renderPremiumTitle() {
    const titleEl = document.getElementById('premiumChartTitle');
    titleEl.textContent = latestData.request.foreignExchange === 'hyperliquid_f'
        ? 'USD Spread vs Hyperliquid'
        : 'Premium %';
}

function renderTopChart(mode) {
    for (const series of Object.values(topSeries)) topChart.removeSeries(series);
    topSeries = {};

    if (mode === 'line') {
        topSeries.assetA = topChart.addLineSeries({ color: SERIES_COLORS.assetA, title: 'Korean spot', priceScaleId: 'right' });
        topSeries.assetB = topChart.addLineSeries({ color: SERIES_COLORS.assetB, title: 'Foreign futures', priceScaleId: 'left' });
        topSeries.assetA.setData(latestData.top.assetA.map(c => ({ time: c.time, value: c.close })));
        topSeries.assetB.setData(latestData.top.assetB.map(c => ({ time: c.time, value: c.close })));
        return;
    }

    topSeries.assetA = topChart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', title: 'Korean spot', priceScaleId: 'right' });
    topSeries.assetB = topChart.addCandlestickSeries({ upColor: '#64b5f6', downColor: '#ffb74d', title: 'Foreign futures', priceScaleId: 'left' });
    topSeries.assetA.setData(latestData.top.assetA);
    topSeries.assetB.setData(latestData.top.assetB);
}

function renderPremiumChart(mode) {
    clearPremiumTargetLines();
    if (premiumSeries.premium) premiumChart.removeSeries(premiumSeries.premium);
    premiumSeries = {};

    const title = latestData.request.foreignExchange === 'hyperliquid_f' ? 'USD Spread vs Hyperliquid' : 'Premium %';

    if (mode === 'line') {
        premiumSeries.premium = premiumChart.addLineSeries({ color: SERIES_COLORS.premium, title });
        premiumSeries.premium.setData(latestData.premium.line);
    } else {
        premiumSeries.premium = premiumChart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', title });
        premiumSeries.premium.setData(latestData.premium.candles);
    }

    renderZeroLine();
    renderTargetLines();
}

function renderZeroLine() {
    if (!premiumSeries.premium) return;

    premiumSeries.zeroLine = premiumSeries.premium.createPriceLine({
        price: 0,
        color: '#777777',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        title: '0.00%',
    });
}

function renderTargetLines() {
    if (!premiumSeries.premium) return;

    const { entryTargetPct, exitTargetPct } = latestData.targets;
    if (Number.isFinite(entryTargetPct)) {
        premiumSeries.entryTarget = premiumSeries.premium.createPriceLine({
            price: entryTargetPct,
            color: '#2196F3',
            lineWidth: 2,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'Entry target',
        });
    }
    if (Number.isFinite(exitTargetPct)) {
        premiumSeries.exitTarget = premiumSeries.premium.createPriceLine({
            price: exitTargetPct,
            color: '#F44336',
            lineWidth: 2,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'Exit target',
        });
    }
}

function premiumRequestLabel(body) {
    return `${body.symbol} ${body.interval} ${body.koreanExchange}/${body.foreignExchange} lookback=${body.lookbackBars}`;
}

async function parsePremiumResponse(response) {
    const responseText = await response.text();
    let payload = null;
    if (responseText) {
        try {
            payload = JSON.parse(responseText);
        } catch {
            payload = null;
        }
    }
    return { payload, responseText };
}

function formatPremiumErrorDetail(value) {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    if (value instanceof Error) return value.message;
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function premiumErrorMessage(error, body) {
    return `Failed to load premium candles (${premiumRequestLabel(body)}): ${error.message}`;
}

function buildPremiumRequestBody() {
    const exitTargetRaw = document.getElementById('exitTargetPct').value;
    return {
        koreanExchange: document.getElementById('koreanExchange').value,
        foreignExchange: document.getElementById('foreignExchange').value,
        symbol: document.getElementById('symbol').value.trim().toUpperCase(),
        interval: document.getElementById('interval').value,
        lookbackBars: Number(document.getElementById('lookbackBars').value),
        exitTargetPct: exitTargetRaw === '' ? null : Number(exitTargetRaw),
    };
}

function requestPremiumCandles(body, options = {}) {
    const { visibleRange = null } = options;
    const statusEl = document.getElementById('premiumStatus');
    statusEl.classList.remove('error');
    statusEl.textContent = visibleRange ? 'Reloading visible premium candles...' : 'Loading premium candles...';

    fetch('/api/premium/candles', {
        method: 'POST',
        headers: getTokenHeaders(),
        body: JSON.stringify(body),
    })
        .then(async response => {
            const { payload, responseText } = await parsePremiumResponse(response);
            return { response, payload, responseText };
        })
        .then(({ response, payload, responseText }) => {
            if (!response.ok) {
                const rawMessage = payload?.message ?? payload?.error ?? responseText ?? response.statusText ?? 'HTTP request failed';
                const message = formatPremiumErrorDetail(rawMessage) || 'HTTP request failed';
                throw new Error(`HTTP ${response.status}: ${message}`);
            }
            if (!payload?.success) {
                const rawMessage = payload?.message ?? payload?.error ?? 'Premium candle request failed';
                const message = formatPremiumErrorDetail(rawMessage) || 'Premium candle request failed';
                throw new Error(message);
            }

            renderCharts(payload.data, { fitContent: !visibleRange, visibleRange });
            statusEl.textContent = visibleRange
                ? `Reloaded ${payload.data.meta.alignedBars} aligned bars and preserved visible range`
                : `Loaded ${payload.data.meta.alignedBars} aligned bars`;
        })
        .catch(err => {
            const message = premiumErrorMessage(err, body);
            console.error('Premium candle load failed', { message, error: err, request: body });
            statusEl.classList.add('error');
            statusEl.textContent = message;
        });
}

function loadPremiumCandles() {
    requestPremiumCandles(buildPremiumRequestBody());
}

function reloadPremiumCandlesFromVisibleRange() {
    const visibleRange = currentAssetComparisonVisibleRange();
    if (!visibleRange) return;

    requestPremiumCandles({
        ...buildPremiumRequestBody(),
        toTime: Math.ceil(visibleRange.to),
    }, { visibleRange });
}

function setToggleActive(button) {
    document
        .querySelectorAll(`[data-chart="${button.dataset.chart}"]`)
        .forEach(el => el.classList.toggle('active', el === button));
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
    document.getElementById('loadPremiumBtn').addEventListener('click', loadPremiumCandles);
    document.getElementById('reloadPremiumBtn').addEventListener('click', reloadPremiumCandlesFromVisibleRange);

    document.querySelectorAll('.chart-toggle').forEach(button => {
        button.addEventListener('click', () => {
            if (!latestData) return;
            setToggleActive(button);
            if (button.dataset.chart === 'top') {
                renderTopChart(button.dataset.mode);
            } else {
                renderPremiumChart(button.dataset.mode);
            }
        });
    });

    checkSession();
});
