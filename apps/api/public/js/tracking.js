/**
 * Constellation Tracking View Manager
 * Handles WebSocket connections, real-time data processing, and visualization rendering.
 */
(function () {
    // State
    let ws = null;
    let isConnecting = false;
    let selectedSymbol = 'BTC';

    // D/W Server Status Tracker
    let dwStatusTimeout = null;
    let hotBalanceInterval = null;
    let socket = null;

    // D/W Status cache: { 'exchange:network': status }
    const dwStatusCache = {};

    // Hot Wallet Balance cache: { 'exchange:network': aggregatedUsdBalance }
    const hotBalanceCache = {};

    const STATUS_EMOJI = {
        'both': '✅',
        'deposit_only': '⬅️',
        'withdraw_only': '➡️',
        'suspended': '🚫',
    };

    // Data Store: { 'BTC': { 'Binance': { price: 100, volume: 10 }, 'Upbit': { ... } } }
    const marketData = {};
    let marketMetadata = {};
    let marketCaipMap = {};
    let currentPinlist = [];

    // Track active deep dive
    let isDeepDiveActive = false;
    const activeDeepDiveExchanges = new Set(); // exchanges currently in the active task

    const sourcePrettyNames = {
        'binance': 'Binance',
        'binance_f': 'Binance Futures',
        'upbit': 'Upbit',
        'bithumb': 'Bithumb',
        'bybit': 'Bybit',
        'bybit_f': 'Bybit Futures',
        'gateio': 'Gate.io',
        'bitget': 'Bitget',
        'bitget_f': 'Bitget Futures',
        'coinbase': 'Coinbase',
        'kraken': 'Kraken',
        'kucoin': 'KuCoin',
        'okx': 'OKX',
        'okx_f': 'OKX Futures'
    };

    function getPrettyName(name) {
        if (name.startsWith('dex_')) {
            const net = name.replace('dex_', '');
            return net.charAt(0).toUpperCase() + net.slice(1) + ' (DEX)';
        }
        return sourcePrettyNames[name.toLowerCase()] || name;
    }

    // UI Config
    const centerX = 300;
    const centerY = 250;
    const radiusX = 240;
    const radiusY = 180;

    /**
     * Normalize symbol from different exchanges
     * e.g. BTCUSDT -> BTC, KRW-BTC -> BTC
     */
    function normalizeSymbol(rawSymbol) {
        if (!rawSymbol) return 'UNKNOWN';
        let s = rawSymbol.toUpperCase();
        s = s.replace('USDT', '').replace('KRW-', '').replace('BTC-', '').replace('_KRW', ''); // Handle various pairs
        return s;

    }

    // --- Visualization Functions ---

    // --- Sorting Logic ---
    function sortMarketWatch() {
        const coinList = document.getElementById('coinList');
        const sortSelect = document.getElementById('marketSortSelect');
        if (!coinList || !sortSelect) return;

        const sortMethod = sortSelect.value;
        const items = Array.from(coinList.querySelectorAll('.coin-item'));

        items.sort((a, b) => {
            const symbolA = a.dataset.symbol.toUpperCase();
            const symbolB = b.dataset.symbol.toUpperCase();

            // Pinned items always come first
            const isApinned = currentPinlist.includes(symbolA);
            const isBpinned = currentPinlist.includes(symbolB);

            if (isApinned && !isBpinned) return -1;
            if (!isApinned && isBpinned) return 1;

            // Extract change % text, default to 0 if parsing fails
            const changeSpanA = a.querySelector('.coin-change');
            const changeSpanB = b.querySelector('.coin-change');

            const changeA = changeSpanA ? parseFloat(changeSpanA.textContent.replace(/[+%]/g, '')) || 0 : 0;
            const changeB = changeSpanB ? parseFloat(changeSpanB.textContent.replace(/[+%]/g, '')) || 0 : 0;

            switch (sortMethod) {
                case 'name_asc':
                    return symbolA.localeCompare(symbolB);
                case 'name_desc':
                    return symbolB.localeCompare(symbolA);
                case 'change_desc':
                    return changeB - changeA;
                case 'change_asc':
                    return changeA - changeB;
                default:
                    return 0;
            }
        });

        // Re-append to DOM in new order
        items.forEach(item => coinList.appendChild(item));
    }

    // --- Helpers ---
    function toSuperscript(num) {
        const superscripts = {
            '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
            '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹'
        };
        return num.toString().split('').map(c => superscripts[c] || c).join('');
    }

    function formatPrice(p) {
        if (!p) return '0.00';
        p = parseFloat(p);

        if (p < 0.01 && p > 0) {
            let str = p.toFixed(20);
            let match = str.match(/0\.0+/);
            if (match) {
                let zerosCount = match[0].length - 2;
                if (zerosCount >= 2) {
                    let val = Math.round(p * Math.pow(10, zerosCount + 4));
                    let significant = val.toString().slice(0, 4).padEnd(4, '0');
                    return '0.0' + toSuperscript(zerosCount) + significant;
                }
            }
        }

        if (p < 0.0001) return p.toFixed(8);
        if (p < 0.1) return p.toFixed(5);
        if (p < 1) return p.toFixed(4);
        if (p < 10) return p.toFixed(3);
        if (p > 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
        return p.toFixed(2);
    }

    function formatKrwPrice(p) {
        if (!p) return '0';
        p = parseFloat(p);
        if (p < 1) return p.toFixed(4);
        if (p < 10) return p.toFixed(3);
        if (p < 100) return p.toFixed(2);
        return Math.round(p).toLocaleString();
    }

    function formatVolume(vol) {
        if (!vol) return '0';
        const v = parseFloat(vol);
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(2) + 'k';
        return v.toFixed(2);
    }

    function _renderDwForNode(source) {
        if (!source) return '';
        const lower = source.toLowerCase();
        const matches = Object.entries(dwStatusCache)
            .filter(([key]) => key.toLowerCase().startsWith(lower + ':'))
            .map(([key, status]) => {
                const parts = key.split(':');
                const network = parts.slice(1).join(':'); // Handle CAIP-2 correctly
                
                // Normalize for mapping lookup (slash to colon, common in payloads)
                const normalizedNetwork = network.replace(/\//g, ':');
                const displayNetwork = marketCaipMap[normalizedNetwork] || network;
                
                // Check if it's CAIP-2 format (namespace:reference). 
                // We allow either colon or slash since both occur in our data pipe.
                const isCaip2 = /^[a-z0-9]+[:/][a-z0-9-]+$/i.test(network);
                
                const balance = hotBalanceCache[`${lower}:${network}`] || 0;
                const balanceStr = balance > 0 ? ` $${formatVolume(balance)}` : ' $0';
                
                let networkHtml = displayNetwork;
                if (!isCaip2) {
                    networkHtml = `<span style="color: var(--neon-red); text-decoration: underline;">${displayNetwork}</span>`;
                }

                return `${STATUS_EMOJI[status] || '❓'} ${networkHtml}${balanceStr}`;
            });
        return matches.length ? matches.join(' · ') : '';
    }

    async function fetchDwStatus(ticker) {
        try {
            const resp = await fetch(`/api/dw-status?ticker=${encodeURIComponent(ticker)}`);
            if (!resp.ok) return;
            const json = await resp.json();
            if (!json.success || !Array.isArray(json.data)) return;

            for (const { exchange, network, status } of json.data) {
                dwStatusCache[`${exchange}:${network}`] = status;
            }

            // If we got any data, show D/W status as "Live" in the header
            if (json.data.length > 0) {
                const statusIndicator = document.getElementById('dwServerStatus');
                const statusText = document.getElementById('dwServerStatusText');
                const statusDot = statusIndicator?.querySelector('.status-dot');
                if (statusIndicator && statusText) {
                    statusIndicator.style.display = 'flex';
                    statusText.textContent = 'Live';
                    if (statusDot) statusDot.style.backgroundColor = 'var(--neon-green)';
                }
            }

            renderConstellation(selectedSymbol);
        } catch (e) {
            console.warn('[DW] fetchDwStatus error:', e);
        }
    }

    async function fetchHotBalances(ticker, exchanges) {
        if (!isDeepDiveActive) return;
        try {
            const token = sessionStorage.getItem('jwt_token');
            const exchangesCsv = Array.from(exchanges).join(',');
            const resp = await fetch(`/api/deep-dive/balance?ticker=${encodeURIComponent(ticker)}&exchanges=${encodeURIComponent(exchangesCsv)}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!resp.ok || !isDeepDiveActive) return;
            const json = await resp.json();
            if (!json.success || !Array.isArray(json.data) || !isDeepDiveActive) return;

            const newExchangeBalances = {};
            for (const exData of json.data) {
                if (!exData.chains) continue;
                const exLower = exData.exchange.toLowerCase();
                for (const chainEntry of exData.chains) {
                    const network = chainEntry.chain;
                    const key = `${exLower}:${network}`;
                    newExchangeBalances[key] = (newExchangeBalances[key] || 0) + (chainEntry.usdBalance || 0);
                }
            }

            Object.keys(newExchangeBalances).forEach(key => {
                hotBalanceCache[key] = newExchangeBalances[key];
            });

            renderConstellation(selectedSymbol);
        } catch (e) {
            console.warn('[DeepDive] fetchHotBalances error:', e);
        }
    }

    function updateNodeDwStatus(exchange, network, status) {
        dwStatusCache[`${exchange}:${network}`] = status;
        const el = document.getElementById(`dw_${exchange.toLowerCase()}`);
        if (el) el.innerHTML = _renderDwForNode(exchange.toLowerCase());
    }

    function renderConstellation(symbol) {
        const data = marketData[symbol];
        if (!data) return;

        const constellation = document.getElementById('constellation');
        const svg = document.getElementById('connections');
        if (!constellation || !svg) return;

        // Clear nodes (keep SVG container)
        constellation.querySelectorAll('.exchange-node, .center-node').forEach(n => n.remove());

        // Calculate average price for diff fallback
        const prices = Object.values(data).map(d => parseFloat(d.price)).filter(p => !isNaN(p));
        const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

        const sources = Object.keys(data);
        let linesHTML = '';

        // Find leader volume for relative line thickness and center node
        const validLeaderSources = sources.filter(s => {
            const lower = s.toLowerCase();
            return lower !== 'binance_f' && lower !== 'bybit_f' && lower !== 'bitget_f' && lower !== 'okx_f' && lower !== 'upbit' && lower !== 'bithumb' && !lower.startsWith('dex_');
        });

        let leaderVol = 0;
        let actualLeaderSource = '';
        if (validLeaderSources.length > 0) {
            actualLeaderSource = validLeaderSources.reduce((a, b) => (parseFloat(data[a].volume) > parseFloat(data[b].volume) ? a : b));
            leaderVol = data[actualLeaderSource].volume;
        }
        if (leaderVol === 0 && sources.length > 0) {
            // fallback if no valid leaders
            leaderVol = Math.max(1, ...sources.map(s => data[s].volume || 0));
        }

        // Setup Center Node
        let leaderPrice = 0;
        let centerInnerHtml = `
            <span class="symbol">${symbol}</span>
            <span class="label">Aggregated</span>
        `;
        if (actualLeaderSource) {
            leaderPrice = parseFloat(data[actualLeaderSource].price);

            let centerKrwHtml = '';
            if ((actualLeaderSource.toLowerCase() === 'upbit' || actualLeaderSource.toLowerCase() === 'bithumb') && data[actualLeaderSource].krwPrice) {
                centerKrwHtml = `<span class="price krw-price" style="font-family: 'D2Coding', Courier, monospace; margin-top: 2px;">₩${formatKrwPrice(data[actualLeaderSource].krwPrice)}</span>`;
            }

            centerInnerHtml = `
                <span class="name" style="font-weight: 700; font-family: 'D2Coding', monospace; font-size: 0.85rem; margin-bottom: 2px;">${getPrettyName(actualLeaderSource)}</span>
                <span class="price" style="font-weight: 700; font-family: 'D2Coding', Courier, monospace; font-size: 1.1rem; color: var(--neon-cyan);">$${formatPrice(leaderPrice)}</span>
                ${centerKrwHtml}
                <span class="label" style="font-size: 0.65rem; font-weight: bold; color: var(--neon-cyan); margin-top: 4px;">$${formatVolume(leaderVol)}</span>
                <span id="dw_${actualLeaderSource.toLowerCase()}" style="font-size: 0.65rem; color: var(--text-dim); margin-top: 3px; display: block; font-weight: normal;">${_renderDwForNode(actualLeaderSource)}</span>
            `;
        }

        // Create Center Node
        const centerNode = document.createElement('div');
        centerNode.className = 'center-node';
        // Force explicit positioning to match the lines' origin
        centerNode.style.left = `${centerX}px`;
        centerNode.style.top = `${centerY}px`;
        centerNode.innerHTML = centerInnerHtml;
        constellation.appendChild(centerNode);

        // Orbiting sources (exclude the center leader)
        let orbitingSources = sources.filter(s => s !== actualLeaderSource);

        // Sort by volume descending
        orbitingSources.sort((a, b) => {
            const volA = parseFloat(data[a].volume) || 0;
            const volB = parseFloat(data[b].volume) || 0;
            return volB - volA;
        });

        orbitingSources.forEach((source, i) => {
            const ex = data[source];
            const angle = (i / orbitingSources.length) * 2 * Math.PI - (Math.PI / 2);
            const pos = {
                x: centerX + Math.cos(angle) * radiusX,
                y: centerY + Math.sin(angle) * radiusY
            };

            const price = parseFloat(ex.price);
            const diffPriceBase = leaderPrice > 0 ? leaderPrice : avgPrice;
            const diff = diffPriceBase > 0 ? ((price - diffPriceBase) / diffPriceBase) * 100 : 0;
            const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(2) + '%';
            const color = diff >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
            const diffClass = diff > 0 ? 'positive' : (diff < 0 ? 'negative' : 'neutral');

            // Line width scaling relative to leader vol
            const volRatio = (ex.volume || 0) / leaderVol;
            const lineWidth = Math.max(2, Math.min(12, 2 + (volRatio * 8)));

            // Line
            const midX = (centerX + pos.x) / 2;
            const midY = (centerY + pos.y) / 2;

            let textLabelHTML = `<text x="${midX}" y="${midY}" fill="#333" font-size="13" text-anchor="middle" dy="-5" font-family="'D2Coding', monospace" style="font-weight: bold;">$${formatVolume(ex.volume)}</text>`;
            if (source.toLowerCase().startsWith('dex_')) {
                const liq = ex.liquidity ? formatVolume(ex.liquidity) : '0';
                textLabelHTML = `
                    <text x="${midX}" y="${midY}" fill="#333" font-size="13" text-anchor="middle" font-family="'D2Coding', monospace" style="font-weight: bold;">
                        <tspan x="${midX}" dy="-12">v:$${formatVolume(ex.volume)}</tspan>
                        <tspan x="${midX}" dy="16">l:$${liq}</tspan>
                    </text>
                `;
            }

            linesHTML += `
                <g>
                    <line class="connection-line" 
                          x1="${centerX}" y1="${centerY}" 
                          x2="${pos.x}" y2="${pos.y}"
                          stroke="${color}" 
                          stroke-width="${lineWidth}"
                          opacity="0.6"/>
                    ${textLabelHTML}
                </g>
            `;

            // Node
            const node = document.createElement('div');
            const srcLower = source.toLowerCase();
            const isFutures = srcLower.endsWith('_f');
            const isDex = srcLower.startsWith('dex_');
            const isKorean = srcLower === 'upbit' || srcLower === 'bithumb';
            const nodeType = isFutures ? 'futures' : isDex ? 'dex' : isKorean ? 'korean' : '';
            node.className = `exchange-node ${nodeType}`;
            node.style.cssText = `
                left: ${pos.x}px; 
                top: ${pos.y}px; 
                transform: translate(-50%, -50%);
                --node-color: ${color};
                border: 1px solid ${color}40;
            `;

            let krwHtml = '';
            if ((source.toLowerCase() === 'upbit' || source.toLowerCase() === 'bithumb') && ex.krwPrice) {
                krwHtml = `<span class="price krw-price" style="font-family: 'D2Coding', Courier, monospace;">₩${formatKrwPrice(ex.krwPrice)}</span>`;
            }

            node.innerHTML = `
                <span class="name">${getPrettyName(source)}</span>
                <span class="price" style="color: #333; font-weight: 600;">$${formatPrice(price)}</span>
                ${krwHtml}
                <span class="diff ${diffClass}">${diffStr}</span>
                <span id="dw_${source.toLowerCase()}" style="font-size: 0.65rem; color: var(--text-dim); margin-top: 3px; display: block;">${_renderDwForNode(source)}</span>
            `;
            constellation.appendChild(node);
        });

        svg.innerHTML = linesHTML;

        updateStats(symbol, prices, avgPrice, sources.length);
    }

    function updateStats(symbol, prices, avgPrice, sourceCount) {
        if (!marketData[symbol]) return;
        const data = marketData[symbol];
        const allSources = Object.keys(data);
        if (allSources.length === 0) return;

        // Minimum volume required to be included in spread calculations
        const MIN_VOLUME_USD = 30000;

        // Non-futures spread
        const nonFuturesSources = allSources.filter(s => {
            const lower = s.toLowerCase();
            const vol = parseFloat(data[s].volume) || 0;
            return lower !== 'binance_f' && lower !== 'bybit_f' && lower !== 'bitget_f' && lower !== 'okx_f' && vol > MIN_VOLUME_USD;
        });
        const nonFuturesPrices = nonFuturesSources.map(s => parseFloat(data[s].price)).filter(p => !isNaN(p));

        if (nonFuturesPrices.length > 0) {
            const maxNF = Math.max(...nonFuturesPrices);
            const minNF = Math.min(...nonFuturesPrices);
            const spreadNF = minNF > 0 ? ((maxNF - minNF) / minNF) * 100 : 0;

            const maxExNF = getPrettyName(nonFuturesSources.find(s => parseFloat(data[s].price) === maxNF) || '--');
            const minExNF = getPrettyName(nonFuturesSources.find(s => parseFloat(data[s].price) === minNF) || '--');

            document.getElementById('statSpread').textContent = spreadNF.toFixed(2) + '%';
            document.getElementById('statSpreadValue').textContent = `${minExNF} - ${maxExNF}`;
        } else {
            document.getElementById('statSpread').textContent = '0.00%';
            document.getElementById('statSpreadValue').textContent = '-- - --';
        }

        // All sources spread (Futures included)
        const spreadFilteredSources = allSources.filter(s => {
            const vol = parseFloat(data[s].volume) || 0;
            return vol > MIN_VOLUME_USD;
        });
        const allPrices = spreadFilteredSources.map(s => parseFloat(data[s].price)).filter(p => !isNaN(p));

        if (allPrices.length > 0) {
            const maxAll = Math.max(...allPrices);
            const minAll = Math.min(...allPrices);
            const spreadAll = minAll > 0 ? ((maxAll - minAll) / minAll) * 100 : 0;

            const maxExAll = getPrettyName(spreadFilteredSources.find(s => parseFloat(data[s].price) === maxAll) || '--');
            const minExAll = getPrettyName(spreadFilteredSources.find(s => parseFloat(data[s].price) === minAll) || '--');

            document.getElementById('statArb').textContent = spreadAll.toFixed(2) + '%';
            const statArbValue = document.getElementById('statArbValue');
            if (statArbValue) statArbValue.textContent = `${minExAll} - ${maxExAll}`;
        } else {
            document.getElementById('statArb').textContent = '0.00%';
            const statArbValue = document.getElementById('statArbValue');
            if (statArbValue) statArbValue.textContent = '-- - --';
        }

        document.getElementById('statExchanges').textContent = sourceCount;

        // Leader based on exact rules: max volume rejecting futures/upbit/bithumb/dex.
        const validSources = allSources.filter(s => {
            const lower = s.toLowerCase();
            return lower !== 'binance_f' && lower !== 'bybit_f' && lower !== 'bitget_f' && lower !== 'okx_f' && lower !== 'upbit' && lower !== 'bithumb' && !lower.startsWith('dex_');
        });

        let leader = '--';
        let leaderVol = 0;

        if (validSources.length > 0) {
            leader = validSources.reduce((a, b) => (parseFloat(data[a].volume) > parseFloat(data[b].volume) ? a : b));
            leaderVol = data[leader].volume;
        }

        document.getElementById('statLeader').textContent = getPrettyName(leader);
        const statLeaderVolume = document.getElementById('statLeaderVolume');
        if (statLeaderVolume) {
            statLeaderVolume.textContent = '$' + formatVolume(leaderVol);
        }
    }

    function updateListDisplay() {
        // Update changes in the list
        Object.keys(marketData).forEach(sym => {
            const el = document.getElementById(`list_${sym}_change`);
            if (el) {
                // We need a 'change' metric. Using the first source's change or calculating 24h change?
                // The WebSocket Ticker usually provides 24h change.
                // We'll take the first available source's change.
                const sources = Object.values(marketData[sym]);
                if (sources.length > 0 && sources[0].change !== undefined) {
                    const chg = parseFloat(sources[0].change);
                    el.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
                    el.className = `coin-change ${chg >= 0 ? 'positive' : 'negative'}`;
                }
            }
        });

        // Update selected header
        const sources = Object.values(marketData[selectedSymbol]);
        if (sources.length > 0 && sources[0].change !== undefined) {
            const chg = parseFloat(sources[0].change);
            const badge = document.getElementById('selectedChange');
            if (badge) {
                badge.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
                badge.className = `badge ${chg >= 0 ? 'positive' : 'negative'}`;
            }
        }
    }

    // Initialize Timeline (Visuals only for now)
    function renderTimeline() {
        const bars = document.getElementById('timelineBars');
        if (!bars) return;
        // Mock data or simple random movement
        if (bars.children.length === 0) {
            const heights = Array.from({ length: 24 }, () => Math.random() * 100);
            bars.innerHTML = heights.map(h => `
                <div class="timeline-bar" style="height: ${Math.max(10, h)}%"></div>
            `).join('');
        } else {
            // Animate one bar occasionally
            const i = Math.floor(Math.random() * 24);
            const bar = bars.children[i];
            if (bar) bar.style.height = (Math.random() * 100) + '%';
        }
    }

    // --- WebSocket Logic ---

    function updateSidecarConnectionStatus(connected, message = '') {
        const statusEl = document.getElementById('sidecarConnectionStatus');
        if (!statusEl) return;
        const textEl = statusEl.querySelector('.status-text');

        if (connected) {
            statusEl.className = 'connection-status connected';
            textEl.textContent = 'Sidecar'; // Or 'Sidecar: OK' but kept simple
        } else {
            statusEl.className = 'connection-status disconnected';
            textEl.textContent = message || 'Sidecar';
        }
        updateExchangeWarning();
    }

    function updateExchangeStatus(source, connected) {
        const id = `${source.toLowerCase()}ConnectionStatus`;
        const el = document.getElementById(id);
        if (el) {
            if (connected) {
                el.className = 'connection-status connected';

                // If deep dive is active, check this is a new exchange and notify Python
                if (isDeepDiveActive && !source.toLowerCase().endsWith('_f') && !source.toLowerCase().startsWith('dex_')) {
                    const exName = source.toLowerCase();
                    if (!activeDeepDiveExchanges.has(exName)) {
                        // New exchange joined during an active deep dive - add it
                        console.log(`[DeepDive] New exchange connected during active session: ${exName}. Sending start task.`);
                        sendDeepDiveTask('start', selectedSymbol, [exName]);
                        activeDeepDiveExchanges.add(exName);
                    }
                }
            } else {
                el.className = 'connection-status disconnected';
            }
            updateExchangeWarning();
        }
    }

    function updateExchangeWarning() {
        const dropdown = document.querySelector('.exchanges-dropdown');
        const sidecarStatusEl = document.getElementById('sidecarConnectionStatus');
        if (!dropdown || !sidecarStatusEl) return;

        const total = dropdown.querySelectorAll('.connection-status').length;
        const connectedCount = dropdown.querySelectorAll('.connection-status.connected').length;

        let warningSpan = sidecarStatusEl.querySelector('.exchange-warning');
        if (!warningSpan) {
            warningSpan = document.createElement('span');
            warningSpan.className = 'exchange-warning';
            warningSpan.style.color = '#f44336'; // Standard red warning color
            warningSpan.style.fontFamily = "'D2Coding', monospace";
            warningSpan.style.fontWeight = 'bold';
            sidecarStatusEl.appendChild(warningSpan);
        }

        if (connectedCount < total && sidecarStatusEl.classList.contains('connected')) {
            warningSpan.textContent = `(${connectedCount}/${total})`;
            warningSpan.style.display = 'inline';
        } else {
            warningSpan.style.display = 'none';
        }
    }

    // ── Deep Dive Task Helpers ────────────────────────────────────────────────

    async function sendDeepDiveTask(action, ticker, exchanges) {
        const token = sessionStorage.getItem('jwt_token');
        if (!token || !ticker || exchanges.length === 0) return false;
        try {
            const res = await fetch(`/api/deep-dive/${action}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ ticker, exchanges })
            });
            return res.ok;
        } catch (e) {
            console.error(`[DeepDive] Failed to send ${action} task:`, e);
            return false;
        }
    }

    function getActiveSpotExchanges() {
        // Returns a deduplicated list of non-futures, non-DEX exchange names
        // that have live data for the currently selected symbol.
        const sources = marketData[selectedSymbol] ? Object.keys(marketData[selectedSymbol]) : [];
        return Array.from(new Set(sources.map(s => {
            const name = s.toLowerCase();
            if (name.endsWith('_f') || name.startsWith('dex_')) return null;
            return name;
        }).filter(Boolean)));
    }

    async function stopDeepDiveUI() {
        if (!isDeepDiveActive) return;

        const exchangesToStop = Array.from(activeDeepDiveExchanges);
        await sendDeepDiveTask('stop', selectedSymbol, exchangesToStop);

        if (hotBalanceInterval) {
            clearInterval(hotBalanceInterval);
            hotBalanceInterval = null;
        }

        activeDeepDiveExchanges.clear();
        isDeepDiveActive = false;

        const ddBtn = document.getElementById('deepDiveBtn');
        if (ddBtn) {
            ddBtn.textContent = '→ Deep Dive Analysis';
            ddBtn.style.backgroundColor = '';
        }

        const dws = document.getElementById('dwServerStatus');
        if (dws) dws.style.display = 'none';

        for (const key in dwStatusCache) delete dwStatusCache[key];
        for (const key in hotBalanceCache) delete hotBalanceCache[key];
        renderConstellation(selectedSymbol);
    }

    async function initSidecar() {
        if (ws || isConnecting) return;
        isConnecting = true;

        try {
            const res = await fetch('/api/extension/token', {
                headers: { 'Accept': 'application/json' }
            });

            if (!res.ok) throw new Error('Failed to get token');
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'API Error');

            connect(data.data.sidecarUrl, data.data.token);

        } catch (err) {
            isConnecting = false;
            console.error('[Sidecar] Init Error:', err.message);
            updateSidecarConnectionStatus(false, 'Sidecar: Error');
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
                updateSidecarConnectionStatus(true);
            } else if (msg === 'AUTH_FAILED') {
                updateSidecarConnectionStatus(false, 'Auth Failed');
                ws.close();
            } else {
                try {
                    const data = JSON.parse(msg);

                    if (data.type === 'status') {
                        updateExchangeStatus(data.source, data.connected);
                    }
                    else if (data.type === 'shard_status') {
                        updateExchangeStatus(data.source, data.connected > 0);
                        const id = `${data.source.toLowerCase()}ConnectionStatus`;
                        const el = document.getElementById(id);
                        if (el) {
                            const textEl = el.querySelector('.status-text');
                            if (textEl) {
                                textEl.textContent = `Spot (${data.connected}/${data.total})`;
                            }
                        }
                    }
                    else if (data.type === 'batch' && Array.isArray(data.data)) {
                        for (const item of data.data) {
                            processTickerPayload(item);
                        }
                    }
                    else if (data.type === 'normalized_ticker') {
                        processTickerPayload(data);
                    }

                    function processTickerPayload(data) {
                        // Unified NormalizedTicker format from sidecar
                        // Fields: exchange, base, quote, o, h, l, c, v_base, v_quote, timestamp_ms
                        const d = data.data;
                        if (!d || !d.base) return;

                        const symbol = d.base; // Already normalized (e.g. "BTC")
                        const price = d.c;     // Close price (USD for KRW pairs)
                        const volume = d.v_quote;
                        const liquidity = d.liquidity;
                        // Derive 24h change from open/close: (c - o) / o * 100
                        const open = parseFloat(d.o);
                        const close = parseFloat(d.c);
                        const change = (open > 0) ? ((close - open) / open * 100).toFixed(4) : '0';

                        if (!marketData[symbol]) {
                            marketData[symbol] = {};

                            // Dynamically add to the UI list if it doesn't exist
                            let listEl = document.querySelector(`.coin-item[data-symbol="${symbol}"]`);
                            const coinList = document.getElementById('coinList');
                            if (!listEl && coinList) {
                                const rank = marketMetadata[symbol]?.market_cap_rank || '-';
                                const mcap = marketMetadata[symbol]?.market_cap ? '$' + formatVolume(marketMetadata[symbol].market_cap) : '';

                                listEl = document.createElement('li');
                                const isPinned = currentPinlist.includes(symbol);
                                listEl.className = `coin-item ${isPinned ? 'pinned' : ''}`;
                                if (Object.keys(marketData).length === 1) {
                                    listEl.classList.add('active'); // First item becomes active
                                    selectedSymbol = symbol;
                                    document.getElementById('selectedSymbol').textContent = symbol;
                                }
                                listEl.setAttribute('data-symbol', symbol);
                                listEl.innerHTML = `
                                    <span class="coin-rank">${rank}</span>
                                    <div class="coin-info">
                                        <div class="coin-symbol">${symbol}</div>
                                        <div class="coin-name" style="color: var(--text-dim); font-size: 0.75rem; margin-top: 2px;">${mcap}</div>
                                    </div>
                                    <span class="coin-change neutral" id="list_${symbol}_change">--%</span>
                                `;

                                // Attach click listener specifically to new item
                                listEl.addEventListener('click', () => {
                                    document.querySelectorAll('.coin-item').forEach(i => i.classList.remove('active'));
                                    listEl.classList.add('active');

                                    // AUTO-STOP Deep Dive on coin switch
                                    if (isDeepDiveActive && selectedSymbol !== symbol) {
                                        console.log(`[DeepDive] Auto-stopping session for ${selectedSymbol} due to coin switch to ${symbol}`);
                                        stopDeepDiveUI();
                                    }

                                    selectedSymbol = symbol;
                                    document.getElementById('selectedSymbol').textContent = selectedSymbol;
                                    renderConstellation(selectedSymbol);
                                });
                                // Apply current search filter if active
                                const searchInput = document.getElementById('coinSearchInput');
                                if (searchInput && searchInput.value) {
                                    const term = searchInput.value.toLowerCase();
                                    if (!symbol.toLowerCase().includes(term)) {
                                        listEl.style.display = 'none';
                                    }
                                }

                                coinList.appendChild(listEl);
                                requestAnimationFrame(sortMarketWatch); // Enqueue sorting after append
                            }
                        }

                        if (marketData[symbol] !== undefined) {
                            marketData[symbol][data.source] = {
                                price: price,
                                volume: volume,
                                liquidity: liquidity,
                                krwPrice: d.c_krw,
                                change: change,
                                name: data.source
                            };

                            if (symbol === selectedSymbol) {
                                renderConstellation(selectedSymbol);
                            }
                            updateListDisplay();
                        }

                        // Debug: Update Raw View (show normalized data)
                        let debugEl = document.getElementById(`debug_${data.source.toLowerCase()}`);
                        if (!debugEl) {
                            const debugContainer = document.getElementById('debugContent');
                            if (debugContainer) {
                                const card = document.createElement('div');
                                card.className = 'debug-card';
                                card.style.cssText = 'background: rgba(0,0,0,0.2); padding: 10px; border-radius: 4px;';
                                card.innerHTML = `
                                    <h4 style="color: var(--text-dim); margin-bottom: 5px;">${getPrettyName(data.source)}</h4>
                                    <pre id="debug_${data.source.toLowerCase()}" style="font-family: 'D2Coding', monospace; font-size: 11px; color: #fff; overflow-x: auto;"></pre>
                                `;
                                debugContainer.appendChild(card);
                                debugEl = document.getElementById(`debug_${data.source.toLowerCase()}`);
                            }
                        }

                        if (debugEl) {
                            debugEl.textContent = JSON.stringify(d, null, 2);
                            debugEl.style.color = '#fff';
                            setTimeout(() => {
                                let color = '#fff';
                                switch (data.source.toLowerCase()) {
                                    case 'binance': color = 'var(--neon-green)'; break;
                                    case 'binance_f': color = 'var(--neon-purple)'; break;
                                    case 'upbit': color = 'var(--neon-blue)'; break;
                                    case 'bithumb': color = 'var(--neon-pink)'; break;
                                    case 'bybit': color = 'var(--neon-yellow, #ffe600)'; break;
                                    case 'bybit_f': color = '#ffeb3b'; break;
                                    case 'gateio': color = '#00d1b2'; break;
                                    case 'bitget': color = '#00e5ff'; break;
                                    case 'bitget_f': color = '#00bfa5'; break;
                                    case 'coinbase': color = '#0052ff'; break;
                                    case 'kraken': color = '#5741d9'; break;
                                    case 'kucoin': color = '#00c8aa'; break;
                                    case 'okx': color = '#0078ff'; break;
                                    case 'okx_f': color = '#5296ff'; break;
                                    default:
                                        if (data.source.startsWith('dex_')) color = 'var(--neon-cyan)';
                                        break;
                                }
                                debugEl.style.color = color;
                            }, 100);
                        }
                    }

                    if (data.type === 'ticker') {
                        // Legacy raw ticker — kept for backward compat, only used for initial debug display
                        const debugEl = document.getElementById(`debug_${data.source.toLowerCase()}`);
                        if (debugEl && debugEl.textContent === 'Waiting...') {
                            // Only show raw if normalized hasn't arrived yet
                            debugEl.textContent = JSON.stringify(data.data, null, 2);
                        }
                    }
                } catch (e) {
                    console.warn('Parse error', e);
                }
            }
        };


        ws.onclose = (e) => {
            console.warn('[Sidecar] Closed');
            updateSidecarConnectionStatus(false);
            ws = null;
            isConnecting = false;
            setTimeout(initSidecar, 3000);
        };
    }

    // --- Interaction ---

    function initUI() {
        // Search Filter
        const searchInput = document.getElementById('coinSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                const items = document.querySelectorAll('.coin-item');
                items.forEach(item => {
                    const symbol = item.getAttribute('data-symbol').toLowerCase();
                    if (symbol.includes(term)) {
                        item.style.display = '';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        }

        // List Click Handlers (For any statically rendered items, if any)
        document.querySelectorAll('.coin-item').forEach(item => {
            // Already handled in dynamic creation, but keep for safety if HTML has pre-rendered items
            item.addEventListener('click', () => {
                document.querySelectorAll('.coin-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                selectedSymbol = item.dataset.symbol;
                document.getElementById('selectedSymbol').textContent = selectedSymbol;
                renderConstellation(selectedSymbol);
            });
        });

        // Market Watch Sorting
        const sortSelect = document.getElementById('marketSortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', sortMarketWatch);
        }

        // Deep Dive
        const ddBtn = document.getElementById('deepDiveBtn');
        if (ddBtn) {
            ddBtn.addEventListener('click', async (e) => {
                e.preventDefault();

                if (!isDeepDiveActive) {
                    // Enter Deep Dive
                    const activeExchanges = getActiveSpotExchanges();

                    if (activeExchanges.length === 0) {
                        alert(`No connected exchanges to analyze for ${selectedSymbol}`);
                        return;
                    }
                    if (!sessionStorage.getItem('jwt_token')) {
                        alert('You must be logged in to use Deep Dive Analysis.');
                        return;
                    }

                    const ok = await sendDeepDiveTask('start', selectedSymbol, activeExchanges);
                    if (!ok) {
                        alert('Failed to start Deep Dive. Check your connection.');
                        return;
                    }

                    // Track which exchanges are now in the session
                    activeDeepDiveExchanges.clear();
                    activeExchanges.forEach(ex => activeDeepDiveExchanges.add(ex));

                    isDeepDiveActive = true;
                    // Clear stale data from any previous session before fetching fresh state
                    for (const key in dwStatusCache) delete dwStatusCache[key];
                    for (const key in hotBalanceCache) delete hotBalanceCache[key];
                    ddBtn.textContent = '← Exit Deep Dive';
                    ddBtn.style.backgroundColor = 'var(--neon-red)';
                    document.getElementById('dwServerStatus').style.display = 'flex';
                    fetchDwStatus(selectedSymbol);
                    fetchHotBalances(selectedSymbol, activeExchanges);

                    if (hotBalanceInterval) clearInterval(hotBalanceInterval);
                    hotBalanceInterval = setInterval(() => {
                        if (isDeepDiveActive) {
                            fetchHotBalances(selectedSymbol, Array.from(activeDeepDiveExchanges));
                        }
                    }, 30000);

                } else {
                    // Exit Deep Dive
                    await stopDeepDiveUI();
                }
            });
        }

        // Handle page close — send stop via beacon to ensure reliable delivery
        window.addEventListener('beforeunload', () => {
            if (isDeepDiveActive) {
                const token = sessionStorage.getItem('jwt_token');
                const exchangesToStop = Array.from(activeDeepDiveExchanges);
                if (token && exchangesToStop.length > 0) {
                    navigator.sendBeacon(
                        '/api/deep-dive/stop',
                        new Blob([JSON.stringify({ ticker: selectedSymbol, exchanges: exchangesToStop })], { type: 'application/json' })
                    );
                }
            }
        });

        // Initial Render
        renderConstellation(selectedSymbol);
        setInterval(renderTimeline, 2000); // Animate timeline slightly

        // Debug Toggle
        const toggleDebugBtn = document.getElementById('toggleDebugBtn');
        const debugContent = document.getElementById('debugContent');
        if (toggleDebugBtn && debugContent) {
            toggleDebugBtn.addEventListener('click', () => {
                if (debugContent.style.display === 'none') {
                    debugContent.style.display = 'grid';
                    toggleDebugBtn.textContent = 'Hide Debug';
                } else {
                    debugContent.style.display = 'none';
                    toggleDebugBtn.textContent = 'Show Debug';
                }
            });
        }

        // --- Excludelist Configuration UI ---
        const toggleExcludelistBtn = document.getElementById('toggleExcludelistBtn');
        const excludelistContent = document.getElementById('excludelistContent');
        const excludelistInput = document.getElementById('excludelistInput');
        const excludelistAddBtn = document.getElementById('excludelistAddBtn');
        const excludelistRefreshBtn = document.getElementById('excludelistRefreshBtn');
        const excludelistTags = document.getElementById('excludelistTags');

        if (toggleExcludelistBtn && excludelistContent) {
            toggleExcludelistBtn.addEventListener('click', () => {
                const isHidden = excludelistContent.style.display === 'none';
                excludelistContent.style.display = isHidden ? 'block' : 'none';
                toggleExcludelistBtn.textContent = isHidden ? 'Hide View' : 'Toggle View';
                if (isHidden) fetchExcludelist();
            });
        }

        const renderExcludelist = (list) => {
            excludelistTags.innerHTML = '';
            if (!list || list.length === 0) {
                excludelistTags.innerHTML = '<span style="color: var(--text-dim); font-size: 0.9rem; font-style: italic;">No exclusions configured.</span>';
                return;
            }

            list.sort().forEach(sym => {
                const tag = document.createElement('div');
                tag.style.cssText = 'display: flex; align-items: center; background: rgba(0, 255, 204, 0.1); border: 1px solid var(--neon-cyan); color: var(--neon-cyan); padding: 2px 8px; border-radius: 12px; font-size: 0.85rem; font-weight: bold; font-family: "D2Coding", monospace;';

                const text = document.createElement('span');
                text.textContent = sym;

                const delBtn = document.createElement('button');
                delBtn.textContent = '×';
                delBtn.style.cssText = 'background: transparent; border: none; color: var(--neon-cyan); margin-left: 6px; cursor: pointer; font-size: 1.1rem; padding: 0 2px; line-height: 1;';
                delBtn.onclick = () => updateExcludelist({ remove: [sym] });

                tag.appendChild(text);
                tag.appendChild(delBtn);
                excludelistTags.appendChild(tag);
            });
        };

        const fetchExcludelist = async () => {
            try {
                excludelistTags.innerHTML = '<span style="color: var(--text-dim); font-size: 0.9rem; font-style: italic;">Loading...</span>';
                const token = sessionStorage.getItem('jwt_token');
                if (!token) {
                    excludelistTags.innerHTML = '<span style="color: var(--neon-red); font-size: 0.9rem;">Not authenticated.</span>';
                    return;
                }

                const res = await fetch('/api/config/excludelist', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) {
                    excludelistTags.innerHTML = `<span style="color: var(--neon-red); font-size: 0.9rem;">API error ${res.status}.</span>`;
                    return;
                }
                const data = await res.json();
                if (data.success) {
                    renderExcludelist(data.data);
                } else {
                    excludelistTags.innerHTML = '<span style="color: var(--neon-red); font-size: 0.9rem;">Failed to load.</span>';
                }

            } catch (e) {
                console.error('Failed to fetch excludelist:', e);
                excludelistTags.innerHTML = '<span style="color: var(--neon-red); font-size: 0.9rem;">Error connecting to API.</span>';
            }
        };

        const updateExcludelist = async (payload) => {
            try {
                const token = sessionStorage.getItem('jwt_token');
                if (!token) return;

                const res = await fetch('/api/config/excludelist', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.success) {
                    renderExcludelist(data.data);
                    excludelistInput.value = '';
                } else {
                    alert('Failed to update excludelist: ' + (data.message || 'Unknown error'));
                }
            } catch (e) {
                console.error('Failed to update excludelist:', e);
                alert('Connection error while updating excludelist.');
            }
        };

        if (excludelistRefreshBtn) {
            excludelistRefreshBtn.addEventListener('click', fetchExcludelist);
        }

        if (excludelistAddBtn && excludelistInput) {
            const handleAdd = () => {
                const val = excludelistInput.value.trim();
                if (!val) return;
                const items = val.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
                if (items.length > 0) {
                    excludelistAddBtn.disabled = true;
                    excludelistAddBtn.textContent = '...';
                    updateExcludelist({ add: items }).finally(() => {
                        excludelistAddBtn.disabled = false;
                        excludelistAddBtn.textContent = 'Add';
                    });
                }
            };

            excludelistAddBtn.addEventListener('click', handleAdd);
            excludelistInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleAdd();
            });
        }

        // --- Pinlist Configuration UI ---
        const togglePinlistBtn = document.getElementById('togglePinlistBtn');
        const pinlistContent = document.getElementById('pinlistContent');
        const pinlistInput = document.getElementById('pinlistInput');
        const pinlistAddBtn = document.getElementById('pinlistAddBtn');
        const pinlistRefreshBtn = document.getElementById('pinlistRefreshBtn');
        const pinlistTags = document.getElementById('pinlistTags');

        if (togglePinlistBtn && pinlistContent) {
            togglePinlistBtn.addEventListener('click', () => {
                const isHidden = pinlistContent.style.display === 'none';
                pinlistContent.style.display = isHidden ? 'block' : 'none';
                togglePinlistBtn.textContent = isHidden ? 'Hide View' : 'Toggle View';
                if (isHidden) fetchPinlist();
            });
        }

        const renderPinlist = (list) => {
            pinlistTags.innerHTML = '';
            if (!list || list.length === 0) {
                pinlistTags.innerHTML = '<span style="color: var(--text-dim); font-size: 0.9rem; font-style: italic;">No pins configured.</span>';
                return;
            }

            list.sort().forEach(sym => {
                const tag = document.createElement('div');
                tag.style.cssText = 'display: flex; align-items: center; background: rgba(255, 235, 59, 0.1); border: 1px solid var(--neon-yellow, #ffe600); color: var(--neon-yellow, #ffe600); padding: 2px 8px; border-radius: 12px; font-size: 0.85rem; font-weight: bold; font-family: "D2Coding", monospace;';

                const text = document.createElement('span');
                text.textContent = sym;

                const delBtn = document.createElement('button');
                delBtn.textContent = '×';
                delBtn.style.cssText = 'background: transparent; border: none; color: inherit; margin-left: 6px; cursor: pointer; font-size: 1.1rem; padding: 0 2px; line-height: 1;';
                delBtn.onclick = () => updatePinlist({ remove: [sym] });

                tag.appendChild(text);
                tag.appendChild(delBtn);
                pinlistTags.appendChild(tag);
            });
        };

        const fetchPinlist = async () => {
            try {
                pinlistTags.innerHTML = '<span style="color: var(--text-dim); font-size: 0.9rem; font-style: italic;">Loading...</span>';
                const token = sessionStorage.getItem('jwt_token');
                if (!token) {
                    pinlistTags.innerHTML = '<span style="color: var(--neon-red); font-size: 0.9rem;">Not authenticated.</span>';
                    return;
                }

                const res = await fetch('/api/config/pinlist', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) {
                    pinlistTags.innerHTML = `<span style="color: var(--neon-red); font-size: 0.9rem;">API error ${res.status}.</span>`;
                    return;
                }
                const data = await res.json();
                if (data.success) {
                    renderPinlist(data.data);
                } else {
                    pinlistTags.innerHTML = '<span style="color: var(--neon-red); font-size: 0.9rem;">Failed to load.</span>';
                }

            } catch (e) {
                console.error('Failed to fetch pinlist:', e);
                pinlistTags.innerHTML = '<span style="color: var(--neon-red); font-size: 0.9rem;">Error connecting to API.</span>';
            }
        };

        const updatePinlist = async (payload) => {
            try {
                const token = sessionStorage.getItem('jwt_token');
                if (!token) return;

                const res = await fetch('/api/config/pinlist', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data.success) {
                    currentPinlist = data.data; // Update local state for rendering checks
                    renderPinlist(data.data);
                    sortMarketWatch(); // Force immediate re-sort and re-render of pins
                    pinlistInput.value = '';
                } else {
                    alert('Failed to update pinlist: ' + (data.message || 'Unknown error'));
                }
            } catch (e) {
                console.error('Failed to update pinlist:', e);
                alert('Connection error while updating pinlist.');
            }
        };

        if (pinlistRefreshBtn) {
            pinlistRefreshBtn.addEventListener('click', fetchPinlist);
        }

        if (pinlistAddBtn && pinlistInput) {
            const handleAdd = () => {
                const val = pinlistInput.value.trim();
                if (!val) return;
                const items = val.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
                if (items.length > 0) {
                    pinlistAddBtn.disabled = true;
                    pinlistAddBtn.textContent = '...';
                    updatePinlist({ add: items }).finally(() => {
                        pinlistAddBtn.disabled = false;
                        pinlistAddBtn.textContent = 'Add';
                    });
                }
            };

            pinlistAddBtn.addEventListener('click', handleAdd);
            pinlistInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleAdd();
            });
        }

        // --- D/W Server Status Socket.IO Listener ---
        if (!socket) {
            const token = sessionStorage.getItem('jwt_token');
            socket = io({
                auth: { token }
            });

            socket.on('dwStatusUpdate', (payload) => {
                const statusIndicator = document.getElementById('dwServerStatus');
                const statusText = document.getElementById('dwServerStatusText');
                const statusDot = statusIndicator?.querySelector('.status-dot');

                if (statusIndicator) {
                    statusIndicator.style.display = 'flex';
                    statusText.textContent = 'Live';
                    if (statusDot) statusDot.style.backgroundColor = 'var(--neon-green)';

                    if (dwStatusTimeout) clearTimeout(dwStatusTimeout);
                    dwStatusTimeout = setTimeout(() => {
                        statusText.textContent = 'Stale';
                        if (statusDot) statusDot.style.backgroundColor = 'var(--neon-red)';
                    }, 15000);
                }

                // Update constellation node if ticker matches current view
                if (payload.ticker === selectedSymbol) {
                    updateNodeDwStatus(payload.exchange, payload.network, payload.status);
                }
            });
        }
    }

    const fetchMarketMetadata = async () => {
        try {
            const res = await fetch('/api/market/metadata');
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    marketMetadata = data.data;
                    if (data.caipMap) Object.assign(marketCaipMap, data.caipMap);
                }
            }
        } catch (e) {
            console.error('Failed to fetch market metadata', e);
        }
    };

    const fetchPinlistData = async () => {
        try {
            const res = await fetch('/api/config/pinlist');
            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.data)) {
                    currentPinlist = data.data.map(sym => sym.toUpperCase());
                    sortMarketWatch();
                }
            }
        } catch (e) {
            console.error('Failed to fetch pinlist sorting data', e);
        }
    };

    // Wait for Dashboard Activation
    const checkInterval = setInterval(async () => {
        const contentEl = document.getElementById('content');
        if (!contentEl) return;

        // Check if visible (style block removed or display not none)
        // note: main.js might toggle separate views.
        if (contentEl.style.display !== 'none') {
            clearInterval(checkInterval);
            console.log('[Constellation] View active. Initializing...');
            await fetchMarketMetadata();
            await fetchPinlistData();
            initUI();
            initSidecar();
        }
    }, 1000);

})();
