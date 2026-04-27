// Global socket.io instance and state
let socket = null;
let statsCache = {
    walletTracking: 0,
    walletTotal: 0,
    entityTotal: 0
};
let availableEntities = [];
let availableChains = [];

// Session monitoring state
let sessionExpiresAt = null;
let sessionMonitorInterval = null;
const SESSION_CHECK_INTERVAL_MS = 30000;
const SESSION_WARNING_THRESHOLD_MS = 300000;

// Auth handling
function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'same-origin' // Important for session cookies
    })
        .then(res => {
            if (!res.ok) {
                throw new Error('Login failed');
            }
            return res.json();
        })
        .then(data => {
            if (data.success && data.data.token) {
                sessionStorage.setItem('jwt_token', data.data.token);

                if (data.data.expiresAt) {
                    sessionExpiresAt = data.data.expiresAt;
                }

                initializeSocketConnection(data.data.token);

                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('content').style.display = 'block';
                initializeApp();
                startSessionMonitor();
            } else {
                throw new Error(data.error || 'Login failed');
            }
        })
        .catch(err => {
            console.error('Login failed:', err);
            alert('Login failed. Please check your credentials.');
        });
}

function handleLogout() {
    stopSessionMonitor();

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    sessionStorage.removeItem('jwt_token');

    fetch('/logout', { method: 'POST' })
        .then(() => {
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('content').style.display = 'none';
        });
}

// Socket.IO connection initialization
function initializeSocketConnection(token) {
    if (socket && socket.connected) {
        console.log('[WebApp] Socket already connected');
        return;
    }

    // Initialize socket.io with JWT auth
    socket = io({
        auth: { token },
        reconnectionDelayMax: 10000,
        transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
        console.log('[WebApp] Socket.IO connected:', socket.id);
        updateConnectionStatus(true);

        // Request initial data via websocket
        socket.emit('walletTrackingGet');
        socket.emit('walletTotalGet');
        socket.emit('entityTotalGet');
        socket.emit('walletsGet');
        socket.emit('entityGet', { params: {} });
        socket.emit('chainGet', { params: {} });
    });

    socket.on('connect_error', (error) => {
        console.error('[WebApp] Socket.IO connection error:', error.message);
        updateConnectionStatus(false, error.message);
    });

    socket.on('disconnect', (reason) => {
        console.warn('[WebApp] Socket.IO disconnected:', reason);
        updateConnectionStatus(false, reason);
    });

    socket.on('reconnecting', (attemptNumber) => {
        console.log('[WebApp] Socket.IO reconnecting, attempt:', attemptNumber);
        updateConnectionStatus(false, `Reconnecting... (${attemptNumber})`);
    });

    // Listen for wallet tracking updates
    socket.on('walletTrackingUpdate', (data) => {
        console.log('[WebApp] Received walletTracking update:', data);
        if (data.success) {
            statsCache.walletTracking = data.data.walletTracking;
            updateStatsDisplay();
        }
    });

    // Listen for wallet total updates
    socket.on('walletTotalUpdate', (data) => {
        console.log('[WebApp] Received walletTotal update:', data);
        if (data.success) {
            statsCache.walletTotal = data.data.walletTotal;
            updateStatsDisplay();
        }
    });

    // Listen for entity total updates
    socket.on('entityTotalUpdate', (data) => {
        console.log('[WebApp] Received entityTotal update:', data);
        if (data.success) {
            statsCache.entityTotal = data.data.entityTotal;
            updateStatsDisplay();
        }
    });

    // Listen for wallets list updates
    socket.on('walletsUpdate', (data) => {
        console.log('[WebApp] Received wallets update:', data);
        if (data.success && window.dataTable) {
            updateWalletTable(data.data.labelledAddresses);
        }
    });

    // Listen for label updates from server
    socket.on('labelUpdate', (data) => {
        console.log('[WebApp] Received label update:', data);
        if (socket && socket.connected) {
            socket.emit('walletsGet');
            socket.emit('walletTrackingGet');
            socket.emit('walletTotalGet');
        }
    });

    // Listen for entity updates
    socket.on('entityUpdate', (data) => {
        console.log('[WebApp] Received entity update:', data);
        if (data.success && Array.isArray(data.data)) {
            availableEntities = data.data.map(e => e.name).sort();
        }
    });

    // Listen for chain updates
    socket.on('chainUpdate', (data) => {
        console.log('[WebApp] Received chain update:', data);
        if (data.success && Array.isArray(data.data)) {
            availableChains = data.data;
            updateBulkAddChainDropdowns();

            // Re-fetch wallets to apply newly loaded chain names to the table and filters
            if (window.dataTable) {
                socket.emit('walletsGet');
            }
        }
    });

    // Listen for errors
    socket.on('get_error', (data) => {
        console.error('[WebApp] Socket.IO error:', data.error);
    });
}

/**
 * @name updateConnectionStatus
 * @desc Update connection status indicator (RULES O-8001)
 * @param {boolean} connected - Connection state
 * @param {string} message - Optional status message
 * @returns {void}
 */
function updateConnectionStatus(connected, message = '') {
    const statusEl = document.getElementById('connectionStatus');
    const textEl = statusEl.querySelector('.status-text');

    if (connected) {
        statusEl.className = 'connection-status connected';
        textEl.textContent = 'Api';
    } else {
        statusEl.className = 'connection-status disconnected';
        textEl.textContent = message || 'Api';
    }
}

/**
 * @name updateStatsDisplay
 * @desc Update stats display from cache (RULES O-8004)
 * @returns {void}
 */

function updateStatsDisplay() {
    const trackingEl = document.getElementById('walletTracking');
    const totalEl = document.getElementById('walletTotal');
    const entityEl = document.getElementById('entityTotal');

    if (trackingEl) trackingEl.textContent = statsCache.walletTracking;
    if (totalEl) totalEl.textContent = statsCache.walletTotal;
    if (entityEl) entityEl.textContent = statsCache.entityTotal;
}


function checkSession() {
    fetch('/api/session')
        .then(res => res.json())
        .then(data => {
            if (data.authenticated) {
                const token = sessionStorage.getItem('jwt_token');
                if (token) {
                    initializeSocketConnection(token);
                }

                if (data.expiresAt) {
                    sessionExpiresAt = data.expiresAt;
                }

                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('content').style.display = 'block';
                initializeApp();
                startSessionMonitor();

                if (data.isExpiringSoon) {
                    showSessionWarningModal();
                }
            } else {
                if (data.reason === 'expired') {
                    handleSessionExpired(true);
                } else {
                    document.getElementById('loginForm').style.display = 'block';
                    document.getElementById('content').style.display = 'none';
                }
            }
        })
        .catch(err => {
            console.error('Session check failed:', err);
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('content').style.display = 'none';
        });
}

/**
 * @name loadStats
 * @desc Load stats via WebSocket (RULES D-6001, O-8001)
 * @returns {void}
 */
function loadStats() {
    if (socket && socket.connected) {
        socket.emit('walletTrackingGet');
        socket.emit('walletTotalGet');
        socket.emit('entityTotalGet');
    } else {
        console.warn('[WebApp] Socket not connected, cannot load stats');
    }
}

/**
 * @name updateWalletTable
 * @desc Update wallet table with new data (RULES D-6006)
 * @param {Object} labelledAddresses - Wallet addresses object
 * @returns {void}
 */
function updateWalletTable(labelledAddresses) {
    if (!window.dataTable || !labelledAddresses) {
        return;
    }

    const table = window.dataTable;
    const tableData = [];
    const chains = new Set();

    // Create a map for display names
    const chainDisplayMap = {};
    availableChains.forEach(c => {
        chainDisplayMap[c.caip2] = c.annotation?.code || c.code || c.caip2;
    });

    Object.entries(labelledAddresses).forEach(([address, wallet]) => {
        const displayChains = wallet.chains
            ? wallet.chains.map(c => chainDisplayMap[c] || c).join(', ')
            : '';

        tableData.push([
            '', // Placeholder for checkbox column
            address,
            displayChains,
            wallet.entity,
            wallet.entityImage || '',
            wallet.comment,
            wallet.label,
            wallet.tracking
        ]);
        if (Array.isArray(wallet.chains)) {
            wallet.chains.forEach(c => chains.add(c));
        } else if (wallet.chains) {
            chains.add(wallet.chains);
        }
    });

    // Clear and reload table
    table.clear();
    table.rows.add(tableData);
    table.draw();

    // Rebuild chain filter dropdown
    $('#chainFilter').empty().append('<option value="">All</option>');

    // Sort and append unique display chains
    const uniqueDisplayChains = new Set();
    chains.forEach(chain => {
        const displayText = chainDisplayMap[chain] || chain;
        uniqueDisplayChains.add(displayText);
    });

    Array.from(uniqueDisplayChains).sort().forEach(displayText => {
        $('#chainFilter').append($('<option>', {
            value: displayText,
            text: displayText
        }));
    });
}

/**
 * @name initializeDataTable
 * @desc Initialize DataTable and request wallet data via WebSocket (RULES D-6001)
 * @returns {void}
 */

function initializeDataTable() {
    // Check if table exists
    if (!$('#walletTable').length) {
        return;
    }

    // Check if DataTable is already initialized
    if ($.fn.DataTable.isDataTable('#walletTable')) {
        return;
    }


    // Initialize empty DataTable
    const table = $('#walletTable').DataTable({
        data: [],
        pageLength: 25,
        order: [[1, 'asc']],
        responsive: true,
        columnDefs: [
            {
                targets: 0,
                orderable: false,
                className: 'select-checkbox'
            },
            {
                targets: 4, // entityImage column
                render: function (data, type, row) {
                    if (data) {
                        return `<img src="${data}" style="width: 24px; height: 24px; border-radius: 4px;" alt="Entity">`;
                    }
                    return '';
                }
            }
        ],
        select: {
            style: 'multi',
            selector: 'td:first-child'
        }
    });

    window.dataTable = table;

    // Handle "Select All" checkbox to only select filtered rows
    $('#selectAll').on('click', function () {
        const filteredRows = table.rows({ search: 'applied' }).nodes();

        if (this.checked) {
            $(filteredRows).find('td:first-child').addClass('selected');
            table.rows({ search: 'applied' }).select();
        } else {
            $(filteredRows).find('td:first-child').removeClass('selected');
            table.rows({ search: 'applied' }).deselect();
        }
    });

    // Handle chain filter
    $('#chainFilter').on('change', function () {
        $('#selectAll').prop('checked', false);
        const selectedChain = $(this).val();
        table.column(2).search(selectedChain).draw();
    });

    // Show/Hide "Delete Selected" button
    table.on('select deselect', function () {
        const selectedRows = table.rows({ selected: true }).count();
        if (selectedRows > 0) {
            $('#bulkDeleteBtn').show();
        } else {
            $('#bulkDeleteBtn').hide();
        }
    });

    // Bulk delete handler
    $('#bulkDeleteBtn').on('click', async function () {
        const selectedData = table.rows({ selected: true }).data();
        const addresses = [];
        for (let i = 0; i < selectedData.length; i++) {
            addresses.push(selectedData[i][1]); // Address is in the second column
        }

        const requestBody = {
            address: addresses.length === 1 ? addresses[0] : addresses,
            key: 'label'
        };

        const token = sessionStorage.getItem('jwt_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        fetch('/api/removeFront', {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody)
        })
            .then(res => {
                if (!res.ok) {
                    throw new Error('Bulk delete failed');
                }
                return res.json();
            })
            .then(() => {
                table.rows({ selected: true }).remove().draw(false);
                $('#bulkDeleteBtn').hide();
                loadStats();
            })
            .catch(err => {
                console.error('Bulk delete error:', err);
                alert('Bulk delete failed.');
            });
    });

    // Request initial wallet data via WebSocket
    if (socket && socket.connected) {
        socket.emit('walletsGet');
    } else {
        // Fallback to REST API if socket not ready
        const token = sessionStorage.getItem('jwt_token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        fetch('/api/wallets', {
            headers
        })
            .then(res => {
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                }
                return res.json();
            })
            .then(data => {
                if (data.labelledAddresses) {
                    updateWalletTable(data.labelledAddresses);
                }
            })
            .catch(err => console.error('Error loading wallet data:', err));
    }
}

function initializeApp() {
    loadStats();
    initializeDataTable();
    initializeBulkAdd();
}

// Extension token modal
function showExtensionModal() {
    const modal = document.getElementById('extensionModal');
    const closeBtn = modal.querySelector('.close');

    modal.style.display = 'block';

    // Broadcast token to extension via postMessage
    const token = sessionStorage.getItem('jwt_token');
    if (token) {
        window.postMessage({
            type: 'WEB_APP_TOKEN',
            token: token,
            source: 'bemodest-web'
        }, '*');
        console.log('[WebApp] Token broadcasted to extension');
    }

    closeBtn.onclick = function () {
        modal.style.display = 'none';
    };

    window.onclick = function (event) {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };
}

// Event listeners
document.getElementById('login').addEventListener('submit', handleLogin);
document.getElementById('logoutBtn').addEventListener('click', handleLogout);
document.getElementById('extensionBtn').addEventListener('click', showExtensionModal);
document.addEventListener('DOMContentLoaded', checkSession);
/**
 * @name initializeBulkAdd
 * @desc Initialize Bulk Add UI and listeners
 * @returns {void}
 */

// Global flag for bulk add initialization
let bulkAddInitialized = false;

function initializeBulkAdd() {
    const btn = document.getElementById('bulkAddBtn');
    if (!btn || bulkAddInitialized) return;

    const container = document.getElementById('bulkAddContainer');

    const rowsContainer = document.getElementById('bulkAddRows');
    const statusDiv = document.getElementById('bulkAddStatus');

    // Handle "Bulk Add" button click
    document.getElementById('bulkAddBtn').addEventListener('click', () => {
        container.style.display = 'block';
        // Add one initial row if empty
        if (rowsContainer.children.length === 0) {
            addBulkRow();
        }
    });

    // Make duplicateRow global so it can be called from onclick
    window.duplicateRow = duplicateRow;

    // Handle "Cancel" button click
    document.getElementById('cancelBulkBtn').addEventListener('click', () => {
        container.style.display = 'none';
        rowsContainer.innerHTML = ''; // Clear rows
        statusDiv.textContent = '';
    });

    // Handle "Add Row" button click
    document.getElementById('addBulkRowBtn').addEventListener('click', () => {
        addBulkRow();
    });

    // Handle "Submit" button click
    document.getElementById('submitBulkBtn').addEventListener('click', () => {
        submitBulkAdd();
    });

    // Listen for bulk insert results
    if (socket) {
        socket.on('bulkInsertResult', (data) => {
            console.log('[WebApp] Received bulkInsertResult:', data);
            handleBulkInsertResult(data);
        });
    }

    bulkAddInitialized = true;
}

/**
 * @name addBulkRow
 * @desc Add a new row to the bulk add form
 * @param {Object} [data=null] - Optional data to prepopulate the row
 * @returns {void}
 */
function addBulkRow(data = null) {
    const rowsContainer = document.getElementById('bulkAddRows');
    const rowId = 'row-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

    // Get chains from availableChains or existing filter as fallback
    let chainOptions = '';
    if (availableChains.length > 0) {
        chainOptions = availableChains
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(c => {
                const code = c.annotation?.code || c.code || c.caip2;
                let displayText = `${c.name} (${code})`;
                if (c.status === 'deprecated') {
                    displayText += ' ⚠️ (DEPRECATED)';
                }
                return `<option value="${c.caip2}" ${data && data.chain === c.caip2 ? 'selected' : ''}>${displayText}</option>`;
            })
            .join('');
    } else {
        chainOptions = Array.from(document.getElementById('chainFilter').options)
            .filter(opt => opt.value !== '') // Exclude "All"
            .map(opt => `<option value="${opt.value}" ${data && data.chain === opt.value ? 'selected' : ''}>${opt.text}</option>`)
            .join('');
    }

    // Generate entity options
    const entityOptions = availableEntities.map(e => `<option value="${e}" ${data && data.entity === e ? 'selected' : ''}>${e}</option>`).join('');

    const rowHtml = `
        <div id="${rowId}" class="bulk-row" style="display: flex; gap: 10px; margin-bottom: 10px; align-items: start;">
            <div style="flex: 2;">
                <input type="text" name="addr" placeholder="Wallet Address" value="${data ? data.addr : ''}" style="width: 100%; padding: 5px;" required>
                <div class="error-msg" style="color: red; font-size: 12px; display: none;"></div>
            </div>
            <div style="flex: 1;">
                <select name="chain" style="width: 100%; padding: 5px;" required>
                    <option value="" disabled ${!data ? 'selected' : ''}>Chain</option>
                    ${chainOptions}
                </select>
            </div>
            <div style="flex: 1;">
                 <select name="entity" style="width: 100%; padding: 5px;">
                    <option value="" ${!data || !data.entity ? 'selected' : ''}>Entity (Optional)</option>
                    ${entityOptions}
                 </select>
            </div>
            <div style="flex: 1;">
                 <input type="text" name="label" placeholder="Label" value="${data ? data.label : ''}" style="width: 100%; padding: 5px;">
            </div>
             <div style="flex: 1;">
                 <input type="text" name="comment" placeholder="Comment" value="${data ? data.comment : ''}" style="width: 100%; padding: 5px;">
            </div>
            <div style="width: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
                 <label style="font-size: 10px; margin-bottom: 2px;">Tracking</label>
                 <input type="checkbox" name="tracking" style="cursor: pointer;" ${data && data.tracking ? 'checked' : ''}>
            </div>
            <div style="display: flex; gap: 5px; align-items: center; justify-content: center;">
                 <button type="button" onclick="duplicateRow('${rowId}')" style="background-color: #2196F3; color: white; border: none; padding: 2px 5px; border-radius: 3px; cursor: pointer; font-size: 11px;">Dup</button>
                 <button type="button" onclick="document.getElementById('${rowId}').remove()" style="background: none; border: none; color: #999; cursor: pointer; font-weight: bold; margin-left: 5px;">&times;</button>
            </div>
        </div>
    `;

    // Append html
    rowsContainer.insertAdjacentHTML('beforeend', rowHtml);
}

/**
 * @name duplicateRow
 * @desc Duplicate a bulk add row
 * @param {string} rowId - The ID of the row to duplicate
 * @returns {void}
 */
function duplicateRow(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;

    const addr = row.querySelector('input[name="addr"]').value;
    const chain = row.querySelector('select[name="chain"]').value;
    const entity = row.querySelector('[name="entity"]').value;
    const label = row.querySelector('input[name="label"]').value;
    const comment = row.querySelector('input[name="comment"]').value;
    const tracking = row.querySelector('input[name="tracking"]').checked;

    addBulkRow({
        addr,
        chain,
        entity,
        label,
        comment,
        tracking
    });
}

/**
 * @name updateBulkAddChainDropdowns
 * @desc Update all chain dropdowns in bulk add rows
 * @returns {void}
 */
function updateBulkAddChainDropdowns() {
    const rows = document.querySelectorAll('.bulk-row');
    rows.forEach(row => {
        const select = row.querySelector('select[name="chain"]');
        const currentValue = select.value;

        let optionsHtml = '<option value="" disabled>Chain</option>';
        if (availableChains.length > 0) {
            const sortedChains = [...availableChains].sort((a, b) => a.name.localeCompare(b.name));
            sortedChains.forEach(c => {
                const code = c.annotation?.code || c.code || c.caip2;
                const displayText = `${c.name} (${code})`;
                optionsHtml += `<option value="${c.caip2}" ${currentValue === c.caip2 ? 'selected' : ''}>${displayText}</option>`;
            });
        } else {
            // Fallback
            const existingOpts = Array.from(document.getElementById('chainFilter').options).filter(o => o.value !== '');
            existingOpts.forEach(opt => {
                optionsHtml += `<option value="${opt.value}" ${currentValue === opt.value ? 'selected' : ''}>${opt.text}</option>`;
            });
        }

        select.innerHTML = optionsHtml;
        if (currentValue) select.value = currentValue;
    });
}

/**
 * @name submitBulkAdd
 * @desc Collect data and emit bulk insert event
 * @returns {void}
 */
function submitBulkAdd() {
    const rows = document.querySelectorAll('.bulk-row');
    const labels = [];
    let hasError = false;

    // Clear previous errors
    document.querySelectorAll('.error-msg').forEach(el => {
        el.style.display = 'none';
        el.textContent = '';
    });
    document.getElementById('bulkAddStatus').textContent = 'Submitting...';

    rows.forEach((row, index) => {
        const addr = row.querySelector('input[name="addr"]').value.trim();
        const chain = row.querySelector('select[name="chain"]').value;
        const entity = row.querySelector('[name="entity"]').value.trim(); // Changed to support input or select
        const label = row.querySelector('input[name="label"]').value.trim();
        const comment = row.querySelector('input[name="comment"]').value.trim();
        const tracking = row.querySelector('input[name="tracking"]').checked;

        if (!addr) {
            const errEl = row.querySelector('.error-msg');
            errEl.textContent = 'Address is required';
            errEl.style.display = 'block';
            hasError = true;
            return;
        }
        if (!chain) {
            const errEl = row.querySelector('.error-msg');
            errEl.textContent = 'Chain is required';
            errEl.style.display = 'block';
            hasError = true;
            return;
        }
        if (!label) {
            const errEl = row.querySelector('.error-msg');
            errEl.textContent = 'Label is required';
            errEl.style.display = 'block';
            hasError = true;
            return;
        }

        labels.push({
            addr,
            chains: [chain],
            entity,
            label, // field name in db is 'label' according to walletList: item.label
            comment,
            tracking: tracking
        });
    });

    if (hasError) {
        document.getElementById('bulkAddStatus').textContent = 'Please fix errors above.';
        return;
    }

    if (labels.length === 0) {
        document.getElementById('bulkAddStatus').textContent = 'No data to submit.';
        return;
    }

    if (socket && socket.connected) {
        socket.emit('labelInsertBulk', { body: labels });
    } else {
        document.getElementById('bulkAddStatus').textContent = 'Error: Socket not connected.';
    }
}

/**
 * @name handleBulkInsertResult
 * @desc Handle result from server
 * @param {Object} data - Result object
 * @returns {void}
 */
function handleBulkInsertResult(data) {
    const statusDiv = document.getElementById('bulkAddStatus');
    if (!data.success && data.error) {
        statusDiv.textContent = 'Error: ' + data.error;
        return;
    }

    const rows = document.querySelectorAll('.bulk-row');
    let successCount = 0;

    if (data.results) {
        data.results.forEach(res => {
            if (res.index < rows.length) {
                const row = rows[res.index];
                if (res.success) {
                    row.remove();
                    successCount++;
                } else {
                    const errEl = row.querySelector('.error-msg');
                    if (errEl) {
                        errEl.textContent = res.error || 'Unknown error';
                        errEl.style.display = 'block';
                        row.style.backgroundColor = '#fff0f0';
                    }
                }
            }
        });
    }

    if (successCount > 0) {
        statusDiv.textContent = `Successfully added ${successCount} addresses.`;
        statusDiv.style.color = 'green';

        if (document.querySelectorAll('.bulk-row').length === 0) {
            setTimeout(() => {
                document.getElementById('bulkAddContainer').style.display = 'none';
                statusDiv.textContent = '';
            }, 2000);
        }
    } else {
        statusDiv.textContent = 'No addresses added.';
        statusDiv.style.color = 'red';
    }
}

function startSessionMonitor() {
    if (sessionMonitorInterval) {
        clearInterval(sessionMonitorInterval);
    }

    updateSessionStatusDisplay();

    sessionMonitorInterval = setInterval(() => {
        checkSessionStatus();
    }, SESSION_CHECK_INTERVAL_MS);
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

            if (data.isExpiringSoon) {
                showSessionWarningModal();
            }
        })
        .catch(err => {
            console.error('Session check failed:', err);
        });
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

    if (remainingMs < SESSION_WARNING_THRESHOLD_MS) {
        statusEl.classList.add('warning');
        statusEl.classList.remove('active');
    } else {
        statusEl.classList.add('active');
        statusEl.classList.remove('warning');
    }
}

function formatTimeRemaining(ms) {
    if (ms <= 0) return 'Expired';

    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) {
        return `${days}d ${hours}h`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

function showSessionWarningModal() {
    const modal = document.getElementById('sessionExpiryModal');
    if (!modal || modal.style.display === 'block') return;

    modal.style.display = 'block';

    const countdownEl = modal.querySelector('.expiry-countdown');
    if (countdownEl && sessionExpiresAt) {
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
}

function hideSessionWarningModal() {
    const modal = document.getElementById('sessionExpiryModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function handleSessionExpired(wasExpired) {
    stopSessionMonitor();

    if (socket) {
        socket.disconnect();
        socket = null;
    }

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
    if (expiredModal) {
        expiredModal.style.display = 'none';
    }

    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('content').style.display = 'none';
}
