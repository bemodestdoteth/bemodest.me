// Global socket.io instance and state
let socket = null;
let statsCache = {
    walletTracking: 0,
    walletTotal: 0,
    entityTotal: 0
};
let availableEntities = [];

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
                // Store token for socket.io connection
                sessionStorage.setItem('jwt_token', data.data.token);

                // Initialize socket.io connection with JWT token
                initializeSocketConnection(data.data.token);

                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('content').style.display = 'block';
                initializeApp();
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
    // Disconnect socket.io
    if (socket) {
        socket.disconnect();
        socket = null;
    }

    // Clear stored token
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
        textEl.textContent = 'Connected';
    } else {
        statusEl.className = 'connection-status disconnected';
        textEl.textContent = message || 'Disconnected';
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


// Add this function at the start of main.js
function checkSession() {
    fetch('/api/session')
        .then(res => res.json())
        .then(data => {
            if (data.authenticated) {
                // Get token from session storage or fetch new one
                const token = sessionStorage.getItem('jwt_token');
                if (token) {
                    initializeSocketConnection(token);
                }

                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('content').style.display = 'block';
                initializeApp();
            } else {
                document.getElementById('loginForm').style.display = 'block';
                document.getElementById('content').style.display = 'none';
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

    Object.entries(labelledAddresses).forEach(([address, wallet]) => {
        tableData.push([
            '', // Placeholder for checkbox column
            address,
            wallet.chain,
            wallet.entity,
            wallet.entityImage || '',
            wallet.comment,
            wallet.label,
            wallet.tracking
        ]);
        chains.add(wallet.chain);
    });

    // Clear and reload table
    table.clear();
    table.rows.add(tableData);
    table.draw();

    // Update chain filter if new chains added
    const existingChains = Array.from($('#chainFilter option').map((i, el) => el.value));
    chains.forEach(chain => {
        if (!existingChains.includes(chain)) {
            $('#chainFilter').append($('<option>', {
                value: chain,
                text: chain
            }));
        }
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
        fetch('/api/removeFront', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
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
        fetch('/api/wallets', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
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

function initializeBulkAdd() {
    const btn = document.getElementById('bulkAddBtn');
    if (!btn) return;

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
}

/**
 * @name addBulkRow
 * @desc Add a new row to the bulk add form
 * @returns {void}
 */
function addBulkRow() {
    const rowsContainer = document.getElementById('bulkAddRows');
    const rowId = 'row-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

    // Get chains from existing filter or default
    const chainOptions = Array.from(document.getElementById('chainFilter').options)
        .filter(opt => opt.value !== '') // Exclude "All"
        .map(opt => `<option value="${opt.value}">${opt.text}</option>`)
        .join('');

    // Generate entity options
    const entityOptions = availableEntities.map(e => `<option value="${e}">${e}</option>`).join('');

    const rowHtml = `
        <div id="${rowId}" class="bulk-row" style="display: flex; gap: 10px; margin-bottom: 10px; align-items: start;">
            <div style="flex: 2;">
                <input type="text" name="addr" placeholder="Wallet Address" style="width: 100%; padding: 5px;" required>
                <div class="error-msg" style="color: red; font-size: 12px; display: none;"></div>
            </div>
            <div style="flex: 1;">
                <select name="chain" style="width: 100%; padding: 5px;" required>
                    <option value="" disabled selected>Chain</option>
                    ${chainOptions}
                </select>
            </div>
            <div style="flex: 1;">
                 <select name="entity" style="width: 100%; padding: 5px;">
                    <option value="" selected>Entity (Optional)</option>
                    ${entityOptions}
                 </select>
            </div>
            <div style="flex: 1;">
                 <input type="text" name="label" placeholder="Label" style="width: 100%; padding: 5px;">
            </div>
             <div style="flex: 1;">
                 <input type="text" name="comment" placeholder="Comment" style="width: 100%; padding: 5px;">
            </div>
            <div style="width: 30px; display: flex; align-items: center; justify-content: center;">
                 <button type="button" onclick="document.getElementById('${rowId}').remove()" style="background: none; border: none; color: #999; cursor: pointer; font-weight: bold;">&times;</button>
            </div>
        </div>
    `;

    // Append html
    rowsContainer.insertAdjacentHTML('beforeend', rowHtml);
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
            chain,
            entity,
            label, // field name in db is 'label' according to walletList: item.label
            comment,
            tracking: true // Default to tracking? Or add checkbox? Existing UI table has 'Tracking'. Assuming true or default.
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

    // Process individual results
    const rows = document.querySelectorAll('.bulk-row');
    let successCount = 0;

    if (data.results) {
        data.results.forEach(res => {
            if (res.index < rows.length) {
                const row = rows[res.index];
                if (res.success) {
                    row.remove(); // Remove successful rows? Or mark them?
                    // Removing seems cleaner to show remaining "todo"
                    successCount++;
                } else {
                    const errEl = row.querySelector('.error-msg');
                    if (errEl) {
                        errEl.textContent = res.error || 'Unknown error';
                        errEl.style.display = 'block';
                        // Highlight row
                        row.style.backgroundColor = '#fff0f0';
                    }
                }
            }
        });
    }

    if (successCount > 0) {
        statusDiv.textContent = `Successfully added ${successCount} addresses.`;
        statusDiv.style.color = 'green';

        // If all successful, maybe clear/hide form after short delay?
        // For now keep open if there are remaining (failed) rows, or just show status.
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
