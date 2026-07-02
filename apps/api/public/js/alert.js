let rulesTable, logsTable, destinationsTable;
let socket;
let alertDestinations = [];

$(document).ready(async () => {
    initTables();
    await loadDestinations();
    await loadRules();
    await loadLogs();
    initSocket();
    initEventListeners();
});

const BUILTIN_ALERT_DESTINATION_ID = 'builtin-api-ingest';
const ALERT_TYPES = ['normal', 'urgent'];
const DEFAULT_OPERATORS = {
    normal: 'gt',
    urgent: 'gt',
};

function destinationById(id) {
    return alertDestinations.find(destination => destination._id === id || destination.id === id);
}

function destinationId(destination) {
    return destination._id || destination.id;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
    })[char]);
}

function jsString(value) {
    return JSON.stringify(String(value ?? ''));
}

function getTokenHeaders() {
    const token = sessionStorage.getItem('jwt_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

function getAssignments(rule) {
    return rule.destination_assignments || [];
}

function assignmentDestination(assignment) {
    return destinationById(assignment.destination_id) || assignment.destination || { _id: assignment.destination_id, label: assignment.destination_id };
}

function hasDeadDestination(rule) {
    return getAssignments(rule).some(assignment => assignment.dead);
}

function destinationStatus(rule) {
    const assignments = getAssignments(rule);
    const active = assignments.filter(assignment => assignment.enabled && !assignment.dead).length;
    const dead = assignments.filter(assignment => assignment.dead).length;
    const summary = `${active}/${assignments.length} destinations active`;
    if (dead > 0) return `<span class="status-badge status-dead">${summary}, ${dead} dead</span>`;
    return rule.enabled ? `<span class="status-badge status-enabled">${summary}</span>` : '<span class="status-badge status-disabled">Disabled</span>';
}

function possibleAlertTypes(rule) {
    const types = (rule.alert_type_rules || []).map(alertRule => alertRule.alert_type);
    return types.length > 0 ? types.join(', ') : 'none';
}

function nodePolicyBadge(destination) {
    const allowed = destination.url_allowed_by_node_policy;
    const label = allowed ? 'Node allowed' : 'Node blocked';
    const className = allowed ? 'status-node-allowed' : 'status-node-blocked';
    const reason = destination.node_policy_reason ? ` title="${escapeHtml(destination.node_policy_reason)}"` : '';
    return `<span class="status-badge ${className}"${reason}>${label}</span>`;
}

function assignmentSummary(rule) {
    return getAssignments(rule).map(assignment => {
        const destination = assignmentDestination(assignment);
        const status = assignment.dead ? 'dead' : assignment.enabled ? 'active' : 'disabled';
        const deadAt = assignment.last_failed_at ? ` since ${new Date(assignment.last_failed_at).toLocaleString()}` : '';
        const nodeStatus = destination.url_allowed_by_node_policy === false
            ? `, node blocked: ${destination.node_policy_reason}`
            : ', node allowed';
        return `${escapeHtml(destination.label || assignment.destination_id)} (${escapeHtml(status)}${escapeHtml(deadAt)}${escapeHtml(nodeStatus)})`;
    }).join(', ') || 'none';
}

function buildAlertTypeRules() {
    return ALERT_TYPES.flatMap(alertType => {
        if (!$(`#${alertType}RuleEnabled`).is(':checked')) return [];
        return [{
            alert_type: alertType,
            operator: $(`#${alertType}RuleOperator`).val(),
            value: parseFloat($(`#${alertType}RuleValue`).val()),
        }];
    });
}

function normalAlertTypeRule(alertTypeRules) {
    return alertTypeRules.find(alertRule => alertRule.alert_type === 'normal');
}

function alertTypeRulesSummary(rule) {
    return (rule.alert_type_rules || [])
        .map(alertRule => `${escapeHtml(alertRule.alert_type)} ${escapeHtml(alertRule.operator)} ${Number(alertRule.value).toFixed(4)}`)
        .join('<br>') || '-';
}

function metricValueLabel(row) {
    const value = Number(row.value).toFixed(4);
    return row.condition === 'spread_pct' && row.premium_adjustment_pct != null
        ? `${value} adjusted`
        : value;
}

function spreadLogDetails(row) {
    const route = `High: ${escapeHtml(row.highest_exchange)} (${Number(row.price_high).toFixed(4)}), Low: ${escapeHtml(row.lowest_exchange)} (${Number(row.price_low).toFixed(4)})`;
    if (row.premium_adjustment_pct == null) return `${route}<br><small>Raw spread; no Korean premium adjustment.</small>`;

    const adjustment = Number(row.premium_adjustment_pct);
    const direction = adjustment < 0 ? 'subtracted' : 'added';
    return `${route}<br><small>${escapeHtml(row.premium_exchange)} premium ${direction}: ${adjustment.toFixed(4)}%</small>`;
}

function buildDestinationAssignments(rule) {
    const currentAssignments = new Map(getAssignments(rule || {}).map(assignment => [assignment.destination_id, assignment]));
    const assignments = [];
    $('#destinationAssignments input[type="checkbox"]').each(function() {
        const destinationIdValue = $(this).val();
        if (!$(this).is(':checked') && destinationIdValue !== BUILTIN_ALERT_DESTINATION_ID) return;
        const current = currentAssignments.get(destinationIdValue);
        assignments.push({
            destination_id: destinationIdValue,
            enabled: current?.enabled ?? true,
            dead: current?.dead ?? false,
            ...(current?.last_failed_at ? { last_failed_at: current.last_failed_at } : {}),
        });
    });
    return assignments;
}

function initTables() {
    rulesTable = $('#rulesTable').DataTable({
        columns: [
            { data: 'label', render: (data) => escapeHtml(data) },
            { data: 'ticker', render: (data, type, row) => `${escapeHtml(data)}/${escapeHtml(row.quote)}` },
            {
                data: null,
                render: (data, type, row) => `${escapeHtml(row.condition)}<br><small>${escapeHtml(possibleAlertTypes(row))}</small>`
            },
            { data: null, render: (data, type, row) => alertTypeRulesSummary(row) },
            { data: 'exchanges', render: (data) => data && data.length > 0 ? escapeHtml(data.join(', ')) : 'All' },
            {
                data: 'enabled',
                render: (data, type, row) => `${destinationStatus(row)}<br><small>${assignmentSummary(row)}</small>`
            },
            {
                data: null,
                orderable: false,
                render: (data, type, row) => {
                    let html = `<button class="action-btn edit-btn" data-action="edit-rule" data-rule-id="${escapeHtml(row._id)}">Edit</button>`;
                    html += `<button class="action-btn delete-btn" data-action="delete-rule" data-rule-id="${escapeHtml(row._id)}">Delete</button>`;
                    for (const assignment of getAssignments(row).filter(assignment => assignment.dead)) {
                        const destination = assignmentDestination(assignment);
                        html += `<button class="action-btn reset-btn" data-action="reset-destination" data-rule-id="${escapeHtml(row._id)}" data-destination-id="${escapeHtml(assignment.destination_id)}">Reset ${escapeHtml(destination.label || assignment.destination_id)}</button>`;
                    }
                    return html;
                }
            }
        ]
    });

    destinationsTable = $('#destinationsTable').DataTable({
        columns: [
            { data: 'label', render: (data) => escapeHtml(data) },
            { data: 'kind', render: (data) => escapeHtml(data) },
            { data: 'url', render: (data) => escapeHtml(data) },
            { data: 'supported_alert_types', render: (data) => escapeHtml((data || []).join(', ')) },
            {
                data: null,
                render: (data, type, row) => {
                    const status = row.enabled ? 'enabled' : 'globally disabled';
                    const protectedText = row.protected ? ', protected' : '';
                    return `<span class="status-badge ${row.enabled ? 'status-enabled' : 'status-disabled'}">${escapeHtml(status)}${escapeHtml(protectedText)}</span><br>${nodePolicyBadge(row)}<br><small>${escapeHtml(row.node_policy_reason || '')}</small>`;
                }
            },
            {
                data: null,
                orderable: false,
                render: (data, type, row) => row.protected
                    ? '<span class="helper-text">Read-only</span>'
                    : `<button class="action-btn edit-btn" data-action="edit-destination" data-destination-id="${escapeHtml(destinationId(row))}">Edit</button><button class="action-btn delete-btn" data-action="delete-destination" data-destination-id="${escapeHtml(destinationId(row))}">Delete</button>`
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
            { data: 'label', render: (data) => escapeHtml(data) },
            { data: 'ticker', render: (data, type, row) => `${escapeHtml(data)}/${escapeHtml(row.quote)}` },
            { data: null, render: (data, type, row) => metricValueLabel(row) },
            { data: 'alert_type', render: (data) => escapeHtml(data || 'normal') },
            {
                data: 'delivery_destination',
                render: (data, type, row) => escapeHtml(data?.label || row.destination_id || '-')
            },
            {
                data: null,
                render: (data, type, row) => {
                    if (row.condition === 'spread_pct') {
                        return spreadLogDetails(row);
                    }
                    return escapeHtml(row.condition);
                }
            }
        ]
    });
}

async function loadDestinations() {
    try {
        const res = await fetch('/api/alert-destinations', { credentials: 'same-origin' });
        const json = await res.json();
        if (json.success) {
            alertDestinations = json.data;
            destinationsTable?.clear().rows.add(alertDestinations).draw();
        }
    } catch (err) {
        console.error('Failed to load alert destinations:', err);
    }
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
    socket.on('alertrules_updated', async () => {
        await loadDestinations();
        await loadRules();
    });
    socket.on('alertDestinationDead', () => {
        loadRules();
    });
}

function handleLogout() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    sessionStorage.removeItem('jwt_token');
    fetch('/logout', { method: 'POST' }).then(() => {
        window.location.href = '/';
    });
}

function initEventListeners() {
    $('#logoutBtn').click(handleLogout);
    $('#addRuleBtn').click(() => showModal());
    $('#addDestinationBtn').click(() => showDestinationPrompt());
    $('#cancelRule, #closeModal').click(() => hideModal());
    $('#rulesTable').on('click', 'button[data-action]', function() {
        const action = $(this).data('action');
        const ruleId = $(this).data('rule-id');
        const destinationIdValue = $(this).data('destination-id');
        if (action === 'edit-rule') editRule(ruleId);
        if (action === 'delete-rule') deleteRule(ruleId);
        if (action === 'reset-destination') resetDestination(ruleId, destinationIdValue);
    });
    $('#destinationsTable').on('click', 'button[data-action]', function() {
        const action = $(this).data('action');
        const destinationIdValue = $(this).data('destination-id');
        if (action === 'edit-destination') editDestination(destinationIdValue);
        if (action === 'delete-destination') deleteDestination(destinationIdValue);
    });

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
        const rule = currentRule();
        const alertTypeRules = buildAlertTypeRules();
        const normalRule = normalAlertTypeRule(alertTypeRules);
        if (!normalRule || Number.isNaN(normalRule.value)) {
            alert('Normal severity threshold is required.');
            return;
        }
        const data = {
            label: $('#ruleLabel').val(),
            ticker: allTickers ? '*' : $('#ruleTicker').val().toUpperCase(),
            quote: allTickers ? '*' : deriveQuote(getSelectedExchanges()),
            condition: $('#ruleCondition').val(),
            value: normalRule.value,
            recovery_value: normalRule.value * 0.95,
            cooldown_secs: parseInt($('#ruleCooldown').val()),
            exchanges: getSelectedExchanges(),
            alert_type_rules: alertTypeRules,
            destination_assignments: buildDestinationAssignments(rule),
            enabled: $('#ruleEnabled').is(':checked')
        };

        const method = id ? 'PATCH' : 'POST';
        const url = id ? `/api/alert-rules/${id}` : '/api/alert-rules';

        try {
            const res = await fetch(url, {
                method,
                credentials: 'same-origin',
                headers: getTokenHeaders(),
                body: JSON.stringify(data)
            });
            const json = await res.json();
            if (json.success) {
                hideModal();
                await loadRules();
            } else {
                alert('Save failed: ' + (json.error || json.message));
            }
        } catch (err) {
            console.error('Error saving rule:', err);
        }
    });

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

function currentRule() {
    const id = $('#ruleId').val();
    return id ? rulesTable.rows().data().toArray().find(rule => rule._id === id) : null;
}

function setAlertTypeRuleInputs(rule) {
    const rules = new Map((rule?.alert_type_rules || []).map(alertRule => [alertRule.alert_type, alertRule]));
    for (const alertType of ALERT_TYPES) {
        const alertRule = rules.get(alertType);
        $(`#${alertType}RuleEnabled`).prop('checked', Boolean(alertRule) || (!rule && alertType === 'normal'));
        $(`#${alertType}RuleOperator`).val(alertRule?.operator || DEFAULT_OPERATORS[alertType]);
        $(`#${alertType}RuleValue`).val(alertRule?.value ?? (alertType === 'normal' ? $('#ruleValue').val() : ''));
    }
}

function renderDestinationAssignments(rule) {
    const assignments = new Map(getAssignments(rule || {}).map(assignment => [assignment.destination_id, assignment]));
    const rows = alertDestinations.map(destination => {
        const id = destinationId(destination);
        const assignment = assignments.get(id);
        const isBuiltin = id === BUILTIN_ALERT_DESTINATION_ID;
        const disabledReason = destination.enabled ? '' : ' — globally disabled';
        const checked = isBuiltin || Boolean(assignment);
        const disabled = isBuiltin ? 'disabled' : '';
        return `<label class="destination-assignment-row ${destination.enabled ? '' : 'inactive'}">
            <input type="checkbox" value="${escapeHtml(id)}" ${checked ? 'checked' : ''} ${disabled}>
            <span><strong>${escapeHtml(destination.label)}</strong> <small>${escapeHtml((destination.supported_alert_types || []).join(', '))}${escapeHtml(disabledReason)}</small></span>
        </label>`;
    }).join('');
    $('#destinationAssignments').html(rows || '<p class="helper-text">No destinations configured.</p>');
}

function showModal(rule = null) {
    if (rule) {
        $('#modalTitle').text('Edit Alert Rule');
        $('#ruleId').val(rule._id);
        $('#ruleLabel').val(rule.label);
        $('#ruleCondition').val(rule.condition);
        $('#ruleValue').val(rule.value);
        $('#ruleCooldown').val(rule.cooldown_secs);
        setSelectedExchanges(rule.exchanges || []);
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
        $('#ruleAllTickers').prop('checked', false).trigger('change');
        setSelectedExchanges([]);
        $('#ruleEnabled').prop('checked', true);
    }
    setAlertTypeRuleInputs(rule);
    renderDestinationAssignments(rule);
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
        const res = await fetch(`/api/alert-rules/${id}`, { method: 'DELETE', credentials: 'same-origin', headers: getTokenHeaders() });
        const json = await res.json();
        if (json.success) loadRules();
    } catch (err) {
        console.error('Error deleting rule:', err);
    }
}

async function resetDestination(id, destinationId) {
    try {
        const res = await fetch(`/api/alert-rules/${id}/destinations/${destinationId}/reset`, { method: 'PATCH', credentials: 'same-origin', headers: getTokenHeaders() });
        const json = await res.json();
        if (json.success) loadRules();
    } catch (err) {
        console.error('Error resetting destination:', err);
    }
}

async function showDestinationPrompt(destination = null) {
    const label = prompt('Destination label', destination?.label || 'External webhook');
    if (!label) return;
    const url = prompt('Destination URL', destination?.url || 'http://dev.bemodest.me:25832/hooks/price-spike');
    if (!url) return;
    const normal = confirm('Deliver normal alerts to this destination?');
    const urgent = confirm('Deliver urgent alerts to this destination?');
    const supported = [normal ? 'normal' : null, urgent ? 'urgent' : null].filter(Boolean);
    if (supported.length === 0) {
        alert('Select at least one alert type.');
        return;
    }

    const payload = {
        label,
        kind: 'external_webhook',
        url,
        enabled: true,
        supported_alert_types: supported,
    };
    const id = destination ? destinationId(destination) : '';
    const method = destination ? 'PATCH' : 'POST';
    const endpoint = destination ? `/api/alert-destinations/${id}` : '/api/alert-destinations';
    try {
        const res = await fetch(endpoint, {
            method,
            credentials: 'same-origin',
            headers: getTokenHeaders(),
            body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.success) {
            await loadDestinations();
            await loadRules();
        } else {
            alert('Destination save failed: ' + (json.error || json.message));
        }
    } catch (err) {
        console.error('Error saving destination:', err);
    }
}

function editDestination(id) {
    const destination = destinationById(id);
    if (destination && !destination.protected) showDestinationPrompt(destination);
}

async function deleteDestination(id) {
    if (!confirm('Delete this alert destination? Referenced destinations will be rejected by the API.')) return;
    try {
        const res = await fetch(`/api/alert-destinations/${id}`, { method: 'DELETE', credentials: 'same-origin', headers: getTokenHeaders() });
        const json = await res.json();
        if (json.success) {
            await loadDestinations();
            await loadRules();
        } else {
            alert('Delete failed: ' + (json.error || json.message));
        }
    } catch (err) {
        console.error('Error deleting destination:', err);
    }
}
