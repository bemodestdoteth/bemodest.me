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
        if (data.success) {
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
    fetch('/logout', { method: 'POST' })
        .then(() => {
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('content').style.display = 'none';
        });
}

// Add this function at the start of main.js
function checkSession() {
    fetch('/api/session')
        .then(res => res.json())
        .then(data => {
            if (data.authenticated) {
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

// Data loading
function loadStats() {
    Promise.all([
        fetch('/api/walletTracking'),
        fetch('/api/walletTotal'),
        fetch('/api/entityTotal')
    ])
    .then(responses => Promise.all(responses.map(r => r.json())))
    .then(([tracking, total, entity]) => {
        document.getElementById('walletTracking').textContent = tracking.walletTracking;
        document.getElementById('walletTotal').textContent = total.walletTotal;
        document.getElementById('entityTotal').textContent = entity.entityTotal;
    })
    .catch(err => console.error('Error loading stats:', err));
}

function initializeDataTable() {
    fetch('/api/wallets')
        .then(res => res.json())
        .then(data => {
            const wallets = data.labelledAddresses;
            const tableData = [];
            const chains = new Set();

            Object.entries(wallets).forEach(([address, wallet]) => {
                tableData.push([
                    '', // Placeholder for checkbox column
                    address,
                    wallet.chain,
                    wallet.entity,
                    wallet.comment,
                    wallet.label,
                    wallet.tracking
                ]);
                chains.add(wallet.chain);
            });

            // Populate chain filter
            chains.forEach(chain => {
                $('#chainFilter').append($('<option>', {
                    value: chain,
                    text: chain
                }));
            });

            // Initialize DataTable with checkbox column
            const table = $('#walletTable').DataTable({
                data: tableData,
                pageLength: 25,
                order: [[1, 'asc']],
                responsive: true,
                columnDefs: [
                    {
                        targets: 0,
                        orderable: false,
                        className: 'select-checkbox'
                    }
                ],
                select: {
                    style: 'multi',
                    selector: 'td:first-child'
                }
            });

            // Handle "Select All" checkbox to only select filtered rows
            $('#selectAll').on('click', function() {
                // Get all rows that match current search/filter criteria
                const filteredRows = table.rows({ search: 'applied' }).nodes();
                
                // Update checkbox state for filtered rows only
                if (this.checked) {
                    $(filteredRows).find('td:first-child').addClass('selected');
                    table.rows({ search: 'applied' }).select();
                } else {
                    $(filteredRows).find('td:first-child').removeClass('selected');
                    table.rows({ search: 'applied' }).deselect();
                }
            });

            // Optional: Add handler to uncheck "Select All" when filter changes
            $('#chainFilter').on('change', function() {
                $('#selectAll').prop('checked', false);
                const selectedChain = $(this).val();
                table.column(2).search(selectedChain).draw();
            });
            
            // Show/Hide "Delete Selected" button
            table.on('select deselect', function() {
                const selectedRows = table.rows({ selected: true }).count();
                if (selectedRows > 0) {
                    $('#bulkDeleteBtn').show();
                } else {
                    $('#bulkDeleteBtn').hide();
                }
            });

            // Bulk delete handler
            $('#bulkDeleteBtn').on('click', async function() {
                const selectedData = table.rows({ selected: true }).data();
                const addresses = [];
                for (let i = 0; i < selectedData.length; i++) {
                    addresses.push(selectedData[i][1]); // Address is in the second column
                }

                // Prepare the request body
                const requestBody = {
                    address: addresses.length === 1 ? addresses[0] : addresses,
                    key: 'label'
                };

                fetch('/api/removeFront', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(requestBody)
                })
                .then(res => {
                    if (!res.ok) {
                        throw new Error('Bulk delete failed');
                    }
                    return res.json();
                })
                .then(() => {
                    // Remove deleted rows from the table
                    table.rows({ selected: true }).remove().draw(false);
                    $('#bulkDeleteBtn').hide();
                    loadStats();
                })
                .catch(err => {
                    console.error('Bulk delete error:', err);
                    alert('Bulk delete failed.');
                });
            });
        })
        .catch(err => console.error('Error loading wallet data:', err));
}

function initializeApp() {
    loadStats();
    initializeDataTable();
}

// Event listeners
document.getElementById('login').addEventListener('submit', handleLogin);
document.getElementById('logoutBtn').addEventListener('click', handleLogout);
document.addEventListener('DOMContentLoaded', checkSession);