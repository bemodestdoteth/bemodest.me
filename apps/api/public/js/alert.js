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
        const res = await fetch('/api/alert-rules', { credentials: 'same-origin' });
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
        const res = await fetch('/api/alerts/logs?limit=200', { credentials: 'same-origin' });
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

    $('#ruleAllTickers').change(function() {
        if ($(this).is(':checked')) {
            $('#tickerRow').hide();
            $('#ruleTicker').prop('required', false);
        } else {
            $('#tickerRow').show();
            $('#ruleTicker').prop('required', true);
        }
    });

    $('#ruleForm').submit(async (e) => {
        e.preventDefault();
        const id = $('#ruleId').val();
        const allTickers = $('#ruleAllTickers').is(':checked');
        const data = {
            label: $('#ruleLabel').val(),
            ticker: allTickers ? '*' : $('#ruleTicker').val().toUpperCase(),
            quote: allTickers ? '*' : deriveQuote(getSelectedExchanges()),
            condition: $('#ruleCondition').val(),
            value: parseFloat($('#ruleValue').val()),
            recovery_value: parseFloat($('#ruleValue').val()) * 0.95, // Simple recovery logic
            cooldown_secs: parseInt($('#ruleCooldown').val()),
            exchanges: getSelectedExchanges(),
            webhook_url: $('#ruleWebhook').val() || `${window.location.origin}/api/alerts/fired`,
            enabled: $('#ruleEnabled').is(':checked')
        };

        const method = id ? 'PATCH' : 'POST';
        const url = id ? `/api/alert-rules/${id}` : '/api/alert-rules';

        try {
            const res = await fetch(url, {
                method,
                credentials: 'same-origin',
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

function getSelectedExchanges() {
    return $('#exchangeGrid input[type="checkbox"]:checked').map(function() {
        return $(this).val();
    }).get();
}

function setSelectedExchanges(exchanges) {
    $('#exchangeGrid input[type="checkbox"]').prop('checked', false);
    exchanges.forEach(ex => {
        $(`#exchangeGrid input[value="${ex}"]`).prop('checked', true);
    });
}

function deriveQuote(exchanges) {
    const exSet = new Set(exchanges.map(e => e.toLowerCase()));
    const krwExchanges = new Set(['upbit', 'bithumb']);
    const allKrw = [...exSet].every(e => krwExchanges.has(e));
    if (allKrw && exSet.size > 0) return 'KRW';
    return 'USDT';
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
        $('#ruleCondition').val(rule.condition);
        $('#ruleValue').val(rule.value);
        $('#ruleCooldown').val(rule.cooldown_secs);
        setSelectedExchanges(rule.exchanges);
        $('#ruleWebhook').val(rule.webhook_url);
        $('#ruleEnabled').prop('checked', rule.enabled);

        const isWildcard = rule.ticker === '*';
        $('#ruleAllTickers').prop('checked', isWildcard).trigger('change');
        if (!isWildcard) {
            $('#ruleTicker').val(rule.ticker);
        }
    } else {
        $('#modalTitle').text('Add Alert Rule');
        $('#ruleForm')[0].reset();
        $('#ruleId').val('');
        $('#ruleWebhook').val(`${window.location.origin}/api/alerts/fired`);
        $('#ruleAllTickers').prop('checked', false).trigger('change');
        setSelectedExchanges([]);
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
        const res = await fetch(`/api/alert-rules/${id}`, { method: 'DELETE', credentials: 'same-origin' });
        const json = await res.json();
        if (json.success) loadRules();
    } catch (err) {
        console.error('Error deleting rule:', err);
    }
}

async function resetWebhook(id) {
    try {
        const res = await fetch(`/api/alert-rules/${id}/reset-webhook`, { method: 'PATCH', credentials: 'same-origin' });
        const json = await res.json();
        if (json.success) loadRules();
    } catch (err) {
        console.error('Error resetting webhook:', err);
    }
}
