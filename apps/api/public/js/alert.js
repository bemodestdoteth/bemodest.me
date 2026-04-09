let rulesTable, logsTable;
let socket;

$(document).ready(async () => {
    initTables();
    await loadRules();
    await loadLogs();
    initSocket();
    initEventListeners();
});

function initTables() {
    rulesTable = $('#rulesTable').DataTable({
        columns: [
            { data: 'label' },
            { data: 'ticker', render: (data, type, row) => `${data}/${row.quote}` },
            { data: 'condition' },
            { data: 'value' },
            { data: 'exchanges', render: (data) => data && data.length > 0 ? data.join(', ') : 'All' },
            {
                data: 'enabled',
                render: (data, type, row) => {
                    if (row.webhook_dead) return '<span class="status-badge status-dead">Dead</span>';
                    return data ? '<span class="status-badge status-enabled">Enabled</span>' : '<span class="status-badge status-disabled">Disabled</span>';
                }
            },
            {
                data: null,
                orderable: false,
                render: (data, type, row) => {
                    let html = `<button class="action-btn edit-btn" onclick="editRule('${row._id}')">Edit</button>`;
                    html += `<button class="action-btn delete-btn" onclick="deleteRule('${row._id}')">Delete</button>`;
                    if (row.webhook_dead) {
                        html += `<button class="action-btn reset-btn" onclick="resetWebhook('${row._id}')">Reset Webhook</button>`;
                    }
                    return html;
                }
            }
        ]
    });

    logsTable = $('#logsTable').DataTable({
        order: [[0, 'desc']],
        columns: [
            {
                data: 'received_at',
                render: (data) => new Date(data).toLocaleString()
            },
            { data: 'label' },
            { data: 'ticker', render: (data, type, row) => `${data}/${row.quote}` },
            { data: 'value', render: (data) => parseFloat(data).toFixed(4) },
            {
                data: null,
                render: (data, type, row) => {
                    if (row.condition === 'spread_pct') {
                        return `High: ${row.highest_exchange} (${row.price_high.toFixed(4)}), Low: ${row.lowest_exchange} (${row.price_low.toFixed(4)})`;
                    }
                    return row.condition;
                }
            }
        ]
    });
}

async function loadRules() {
    try {
        const res = await fetch('/api/alert-rules');
        const json = await res.json();
        if (json.success) {
            rulesTable.clear().rows.add(json.data).draw();
        }
    } catch (err) {
        console.error('Failed to load rules:', err);
    }
}

async function loadLogs() {
    try {
        const res = await fetch('/api/alerts/logs?limit=200');
        const json = await res.json();
        if (json.success) {
            logsTable.clear().rows.add(json.data).draw();
        }
    } catch (err) {
        console.error('Failed to load logs:', err);
    }
}

function initSocket() {
    socket = io();
    socket.on('alertFired', (log) => {
        logsTable.row.add(log).draw(false);
    });
    socket.on('alertrules_updated', () => {
        loadRules();
    });
    socket.on('alertRuleWebhookDead', () => {
        loadRules();
    });
}

function initEventListeners() {
    $('#addRuleBtn').click(() => showModal());
    $('#cancelRule, #closeModal').click(() => hideModal());

    $('#ruleForm').submit(async (e) => {
        e.preventDefault();
        const id = $('#ruleId').val();
        const data = {
            label: $('#ruleLabel').val(),
            ticker: $('#ruleTicker').val().toUpperCase(),
            quote: $('#ruleQuote').val().toUpperCase(),
            condition: $('#ruleCondition').val(),
            value: parseFloat($('#ruleValue').val()),
            recovery_value: parseFloat($('#ruleValue').val()) * 0.95, // Simple recovery logic
            cooldown_secs: parseInt($('#ruleCooldown').val()),
            exchanges: $('#ruleExchanges').val() ? $('#ruleExchanges').val().split(',').map(s => s.trim()) : [],
            webhook_url: $('#ruleWebhook').val() || `${window.location.origin}/api/alerts/fired`,
            enabled: $('#ruleEnabled').is(':checked')
        };

        const method = id ? 'PATCH' : 'POST';
        const url = id ? `/api/alert-rules/${id}` : '/api/alert-rules';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const json = await res.json();
            if (json.success) {
                hideModal();
                loadRules();
            } else {
                alert('Save failed: ' + (json.error || json.message));
            }
        } catch (err) {
            console.error('Error saving rule:', err);
        }
    });

    // Close modal on outside click
    window.onclick = (event) => {
        if (event.target == document.getElementById('ruleModal')) {
            hideModal();
        }
    };
}

function switchTab(tab) {
    $('.tab-button').removeClass('active');
    $('.tab-content').removeClass('active');
    $(`.tab-button[onclick="switchTab('${tab}')"]`).addClass('active');
    $(`#${tab}-tab`).addClass('active');
}

function showModal(rule = null) {
    if (rule) {
        $('#modalTitle').text('Edit Alert Rule');
        $('#ruleId').val(rule._id);
        $('#ruleLabel').val(rule.label);
        $('#ruleTicker').val(rule.ticker);
        $('#ruleQuote').val(rule.quote);
        $('#ruleCondition').val(rule.condition);
        $('#ruleValue').val(rule.value);
        $('#ruleCooldown').val(rule.cooldown_secs);
        $('#ruleExchanges').val(rule.exchanges.join(', '));
        $('#ruleWebhook').val(rule.webhook_url);
        $('#ruleEnabled').prop('checked', rule.enabled);
    } else {
        $('#modalTitle').text('Add Alert Rule');
        $('#ruleForm')[0].reset();
        $('#ruleId').val('');
        $('#ruleWebhook').val(`${window.location.origin}/api/alerts/fired`);
    }
    $('#ruleModal').show();
}

function hideModal() {
    $('#ruleModal').hide();
}

function editRule(id) {
    const rule = rulesTable.rows().data().toArray().find(r => r._id === id);
    if (rule) showModal(rule);
}

async function deleteRule(id) {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    try {
        const res = await fetch(`/api/alert-rules/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.success) loadRules();
    } catch (err) {
        console.error('Error deleting rule:', err);
    }
}

async function resetWebhook(id) {
    try {
        const res = await fetch(`/api/alert-rules/${id}/reset-webhook`, { method: 'PATCH' });
        const json = await res.json();
        if (json.success) loadRules();
    } catch (err) {
        console.error('Error resetting webhook:', err);
    }
}
