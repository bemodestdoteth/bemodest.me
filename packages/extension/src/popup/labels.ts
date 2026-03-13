import { Labels } from '../shared/labels';
import { Entities } from '../shared/entities';
import { Chains } from '../shared/chains';
import { initializeGlobalChainManager } from '../services/chains/chain-manager';
import {
    WS_STATUS_CONNECTED,
    WS_STATUS_CONNECTING,
    WS_STATUS_DISCONNECTED,
    WS_STATUS_ERROR
} from '../shared/constants';
import { debounce } from '../utils/debounce';
import { ExtensionFormDraftSchema, type ExtensionFormDraft } from '../shared/draftSchemas';
import { getSelectedChainsFromUI, setSelectedChainsInUI } from '../shared/labels';

const API_URL = "http://localhost:25833"; // TODO: Make dynamic based on environment
const STORAGE_KEY_TOKEN = 'jwt_token';

/**
 * @name updateAuthUI
 * @desc Updates authentication UI based on login state (RULES Q-2002)
 * @param {boolean} isAuthenticated - Whether user is authenticated
 * @returns {void}
 */
function updateAuthUI(isAuthenticated: boolean): void {
    const instructions = document.getElementById('ext-auth-instructions');
    const authView = document.getElementById('ext-auth-view');

    if (instructions) instructions.style.display = isAuthenticated ? 'none' : 'block';
    if (authView) authView.style.display = isAuthenticated ? 'block' : 'none';
}

/**
 * @name fetchExtensionToken
 * @desc Fetches extension token from web app via content script message (RULES S-3006)
 * @returns {Promise<void>}
 */
async function fetchExtensionToken(): Promise<void> {
    const errorDiv = document.getElementById('ext-auth-error');
    const statusDiv = document.getElementById('ext-auth-status');

    try {
        if (statusDiv) {
            statusDiv.textContent = 'Waiting for token from web app...';
            statusDiv.style.display = 'block';
            statusDiv.style.color = '#666';
        }

        // Query active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab?.id) {
            throw new Error('No active tab found');
        }

        // Check if tab URL is the web app
        if (!tab.url?.includes('localhost:25833')) {
            throw new Error('Please open the web app (localhost:25833) and click "Extension Token" button');
        }

        // Token will be received via background script's message listener
        // The web app broadcasts the token via postMessage when user clicks "Extension Token" button

        // Check if token was already received
        const result = await chrome.storage.local.get([STORAGE_KEY_TOKEN]);
        if (result[STORAGE_KEY_TOKEN]) {
            updateAuthUI(true);
            if (statusDiv) {
                statusDiv.textContent = 'Token received successfully!';
                statusDiv.style.color = '#4CAF50';
            }
            if (errorDiv) errorDiv.style.display = 'none';

            // Notify background script
            chrome.runtime.sendMessage({ action: 'auth-update' });
        } else {
            if (statusDiv) {
                statusDiv.textContent = 'Please click "Extension Token" button in the web app';
                statusDiv.style.color = '#666';
            }
        }
    } catch (err: unknown) {
        if (errorDiv) {
            errorDiv.textContent = err instanceof Error ? err.message : 'Failed to get token';
            errorDiv.style.display = 'block';
        }
        if (statusDiv) statusDiv.style.display = 'none';
    }
}

/**
 * @name handleLogout
 * @desc Handles logout by removing token (RULES Q-2002)
 * @returns {Promise<void>}
 */
async function handleLogout(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEY_TOKEN);
    chrome.runtime.sendMessage({ action: 'auth-update' });
    updateAuthUI(false);
}

/**
 * @name setupAuthHandlers
 * @desc Sets up authentication event handlers (RULES Q-2002)
 * @returns {Promise<void>}
 */
async function setupAuthHandlers(): Promise<void> {
    // Check initial auth state
    const result = await chrome.storage.local.get([STORAGE_KEY_TOKEN]);
    updateAuthUI(!!result[STORAGE_KEY_TOKEN]);

    // Get token button
    const getTokenBtn = document.getElementById('ext-get-token-btn');
    if (getTokenBtn) {
        getTokenBtn.addEventListener('click', fetchExtensionToken);
    }

    // Logout button
    const logoutBtn = document.getElementById('ext-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
}

/**
 * @name setupConnectionHandlers
 * @desc Sets up connection environment handlers
 * @returns {Promise<void>}
 */
async function setupConnectionHandlers(): Promise<void> {
    const ENV_STORAGE_KEY = 'websocket_env';
    const DEFAULT_ENV = 'dev';
    const statusDiv = document.getElementById('ext-connection-status');

    // Get radio buttons
    const devRadio = document.querySelector('input[name="environment"][value="dev"]') as HTMLInputElement;
    const prodRadio = document.querySelector('input[name="environment"][value="prod"]') as HTMLInputElement;
    const radios = document.querySelectorAll('input[name="environment"]');

    if (!devRadio || !prodRadio) return;

    // Load initial state
    try {
        const result = await chrome.storage.sync.get({ [ENV_STORAGE_KEY]: DEFAULT_ENV });
        const currentEnv = result[ENV_STORAGE_KEY];

        if (currentEnv === 'prod') {
            prodRadio.checked = true;
        } else {
            devRadio.checked = true;
        }
    } catch (error) {
        console.error('Failed to load connection settings:', error);
    }

    // Handle changes
    radios.forEach(radio => {
        radio.addEventListener('change', async (e) => {
            const target = e.target as HTMLInputElement;
            if (!target.checked) return;

            const newEnv = target.value;

            try {
                await chrome.storage.sync.set({ [ENV_STORAGE_KEY]: newEnv });
                // Background script will detect change and reconnect
            } catch (error) {
                console.error('Failed to save connection settings:', error);
                if (statusDiv) {
                    statusDiv.textContent = 'Failed to save settings';
                    statusDiv.style.color = 'red';
                }
            }
        });
    });
}

/**
 * @name setupWebSocketStatusHandler
 * @desc Sets up handler for WebSocket connection status
 * @returns {void}
 */
function setupWebSocketStatusHandler(): void {
    const statusBadge = document.getElementById('ws-status-badge');
    const statusText = statusBadge?.querySelector('.status-text');

    if (!statusBadge || !statusText) return;

    const updateStatus = (data: any) => {
        const isConnected = data.connected;
        const status = data.status; // connecting, connected, disconnected, error
        const errorMsg = data.error;

        const settingsStatusDiv = document.getElementById('ext-connection-status');

        // Reset classes
        statusBadge.classList.remove('connected', 'disconnected', 'connecting', 'error');
        if (settingsStatusDiv) settingsStatusDiv.textContent = '';

        if (status === WS_STATUS_CONNECTING) {
            statusBadge.classList.add('connecting');
            statusText.textContent = 'Connecting...';
            // Optional: Add spinner via CSS class 'connecting'
            if (settingsStatusDiv) {
                settingsStatusDiv.textContent = 'Connecting to server...';
                settingsStatusDiv.style.color = 'orange';
            }
        } else if (status === WS_STATUS_CONNECTED || isConnected) {
            statusBadge.classList.add('connected');
            statusText.textContent = 'Connected';
            if (settingsStatusDiv) {
                settingsStatusDiv.textContent = 'Connected successfully';
                settingsStatusDiv.style.color = 'green';
                setTimeout(() => { settingsStatusDiv.textContent = ''; }, 3000);
            }
        } else if (status === WS_STATUS_ERROR) {
            statusBadge.classList.add('error');
            statusText.textContent = 'Error';
            if (settingsStatusDiv) {
                settingsStatusDiv.textContent = errorMsg || 'Connection failed';
                settingsStatusDiv.style.color = 'red';
            }
        } else {
            statusBadge.classList.add('disconnected');
            statusText.textContent = 'Disconnected';
        }
    };

    // Set initial state to connecting to avoid "Disconnected" flash
    if (statusBadge && statusText) {
        statusBadge.classList.remove('connected', 'disconnected', 'error');
        statusBadge.classList.add('connecting');
        statusText.textContent = 'Connecting...';

        const settingsStatusDiv = document.getElementById('ext-connection-status');
        if (settingsStatusDiv) {
            settingsStatusDiv.textContent = 'Connecting...';
            settingsStatusDiv.style.color = 'orange';
        }
    }

    // Query initial status
    chrome.runtime.sendMessage({ action: 'ws-status' }, (response) => {
        if (response) {
            updateStatus(response);
        }
    });

    // Listen for status changes
    chrome.runtime.onMessage.addListener((request) => {
        if (request.type === 'ws-event' && request.event === 'statusChange') {
            updateStatus(request.data);
        }
    });

    // Also listen for re-connect attempts to show connecting state? 
    // For now simple connected/disconnected is fine as per requirement.
}

// Tab switching logic
function setupTabs() {
    const navLinks = document.querySelectorAll('.ext-etheraddresslookup-nav-link');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = link.getAttribute('data-tab');

            if (!targetTab) return;

            // Update links
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Update panes
            document.querySelectorAll('.ext-etheraddresslookup-tab-pane').forEach((pane) => {
                pane.classList.remove('active', 'show');
                // Use type assertion for style property
                (pane as HTMLElement).style.display = 'none';
            });

            const targetPane = document.getElementById('ext-etheraddresslookup-' + targetTab);
            if (targetPane) {
                targetPane.classList.add('active', 'show');
                targetPane.style.display = 'block';
            }
        });
    });

    // Initial visibility state
    document.querySelectorAll('.ext-etheraddresslookup-tab-pane').forEach((pane) => {
        (pane as HTMLElement).style.display = pane.classList.contains('active') ? 'block' : 'none';
    });
}

const DRAFT_STORAGE_KEY = 'extensionFormDraft';

/**
 * Saves the current state of all forms to local storage.
 */
function saveDraftState(labels: Labels, entities: Entities, chains: Chains) {
    const activeTab = document.querySelector('.ext-etheraddresslookup-nav-link.active')?.getAttribute('data-tab') || 'options';

    const draft: ExtensionFormDraft = {
        activeTab,
        labels: {
            name: (document.getElementById('label-name') as HTMLInputElement)?.value,
            address: (document.getElementById('label-address') as HTMLInputElement)?.value,
            comment: (document.getElementById('label-comment') as HTMLInputElement)?.value,
            entity: (document.getElementById('label-entity') as HTMLSelectElement)?.value,
            track: (document.getElementById('label-track') as HTMLInputElement)?.checked,
            chains: getSelectedChainsFromUI(),
            aliases: labels.getAliasesFromUI(),
            editingAddr: (document.getElementById('ext-etheraddresslookup-new-label-form') as HTMLElement)?.dataset.editingAddr
        },
        entities: {
            name: (document.getElementById('entity-name') as HTMLInputElement)?.value,
            comment: (document.getElementById('entity-comment') as HTMLInputElement)?.value,
            track: (document.getElementById('entity-track') as HTMLInputElement)?.checked,
            image: (document.getElementById('entity-image') as HTMLInputElement)?.value,
            imageFilename: (document.getElementById('entity-image-filename') as HTMLInputElement)?.value,
            editingId: (document.getElementById('form-add-entities') as HTMLElement)?.dataset.editingId
        },
        chains: {
            name: (document.getElementById('chain-name') as HTMLInputElement)?.value,
            namespace: (document.getElementById('chain-namespace') as HTMLSelectElement)?.value,
            reference: (document.getElementById('chain-reference') as HTMLInputElement)?.value,
            symbol: (document.getElementById('chain-symbol') as HTMLInputElement)?.value,
            isTestnet: (document.getElementById('chain-is-testnet') as HTMLInputElement)?.checked,
            gasPrice: (document.getElementById('chain-gas-price') as HTMLInputElement)?.value,
            explorerPrefix: (document.getElementById('chain-explorer-prefix') as HTMLInputElement)?.value,
            status: (document.getElementById('chain-status') as HTMLSelectElement)?.value,
            supersededBy: (document.getElementById('chain-superseded-by') as HTMLInputElement)?.value,
            bgType: (document.querySelector('input[name="bgType"]:checked') as HTMLInputElement)?.value,
            bgColorStart: (document.getElementById('chain-bgcolor-start') as HTMLInputElement)?.value,
            bgColorMid: (document.getElementById('chain-bgcolor-mid') as HTMLInputElement)?.value,
            bgColorEnd: (document.getElementById('chain-bgcolor-end') as HTMLInputElement)?.value,
            fontColor: (document.getElementById('chain-font-color') as HTMLSelectElement)?.value,
            regex: (document.getElementById('chain-regex') as HTMLTextAreaElement)?.value,
            caseSensitive: (document.getElementById('chain-case-sensitive') as HTMLInputElement)?.checked,
            editingId: (document.getElementById('form-add-chains') as HTMLElement)?.dataset.editingId,
            ...chains.getInternalState()
        }
    };

    chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: draft });
}

/**
 * Loads and validates the draft state from local storage.
 */
async function loadDraftState(labels: Labels, entities: Entities, chains: Chains) {
    const result = await chrome.storage.local.get([DRAFT_STORAGE_KEY]);
    const draftData = result[DRAFT_STORAGE_KEY];
    if (!draftData) return;

    const parsed = ExtensionFormDraftSchema.safeParse(draftData);
    if (!parsed.success) {
        console.warn('[Draft] Invalid draft data found, clearing:', parsed.error);
        chrome.storage.local.remove(DRAFT_STORAGE_KEY);
        return;
    }

    const draft = parsed.data;

    // Restore Labels Form
    if (draft.labels) {
        const l = draft.labels;
        if (l.name !== undefined) (document.getElementById('label-name') as HTMLInputElement).value = l.name;
        if (l.address !== undefined) (document.getElementById('label-address') as HTMLInputElement).value = l.address;
        if (l.comment !== undefined) (document.getElementById('label-comment') as HTMLInputElement).value = l.comment;
        if (l.entity !== undefined) (document.getElementById('label-entity') as HTMLSelectElement).value = l.entity;
        if (l.track !== undefined) (document.getElementById('label-track') as HTMLInputElement).checked = l.track;
        if (l.chains) setSelectedChainsInUI(l.chains);
        if (l.aliases) labels.renderAliasRows(l.aliases);
        if (l.editingAddr) {
            const form = document.getElementById('ext-etheraddresslookup-new-label-form');
            if (form) {
                form.dataset.editingAddr = l.editingAddr;
                const submitBtn = form.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.textContent = 'Update Label';
            }
        }
    }

    // Restore Entities Form
    if (draft.entities) {
        const e = draft.entities;
        if (e.name !== undefined) (document.getElementById('entity-name') as HTMLInputElement).value = e.name;
        if (e.comment !== undefined) (document.getElementById('entity-comment') as HTMLInputElement).value = e.comment;
        if (e.track !== undefined) (document.getElementById('entity-track') as HTMLInputElement).checked = e.track;
        if (e.image !== undefined) (document.getElementById('entity-image') as HTMLInputElement).value = e.image;
        if (e.imageFilename !== undefined) (document.getElementById('entity-image-filename') as HTMLInputElement).value = e.imageFilename;
        if (e.editingId) (document.getElementById('form-add-entities') as HTMLElement).dataset.editingId = e.editingId;
    }

    // Restore Chains Form
    if (draft.chains) {
        const c = draft.chains;
        if (c.name !== undefined) (document.getElementById('chain-name') as HTMLInputElement).value = c.name;
        if (c.namespace !== undefined) (document.getElementById('chain-namespace') as HTMLSelectElement).value = c.namespace;
        if (c.reference !== undefined) (document.getElementById('chain-reference') as HTMLInputElement).value = c.reference;
        if (c.symbol !== undefined) (document.getElementById('chain-symbol') as HTMLInputElement).value = c.symbol;
        if (c.isTestnet !== undefined) (document.getElementById('chain-is-testnet') as HTMLInputElement).checked = c.isTestnet;
        if (c.gasPrice !== undefined) (document.getElementById('chain-gas-price') as HTMLInputElement).value = c.gasPrice;
        if (c.explorerPrefix !== undefined) (document.getElementById('chain-explorer-prefix') as HTMLInputElement).value = c.explorerPrefix;
        if (c.status !== undefined) (document.getElementById('chain-status') as HTMLSelectElement).value = c.status;
        if (c.supersededBy !== undefined) (document.getElementById('chain-superseded-by') as HTMLInputElement).value = c.supersededBy;
        if (c.bgType !== undefined) {
            const radio = document.querySelector(`input[name="bgType"][value="${c.bgType}"]`) as HTMLInputElement;
            if (radio) radio.checked = true;
        }
        if (c.bgColorStart !== undefined) (document.getElementById('chain-bgcolor-start') as HTMLInputElement).value = c.bgColorStart;
        if (c.bgColorMid !== undefined) (document.getElementById('chain-bgcolor-mid') as HTMLInputElement).value = c.bgColorMid;
        if (c.bgColorEnd !== undefined) (document.getElementById('chain-bgcolor-end') as HTMLInputElement).value = c.bgColorEnd;
        if (c.fontColor !== undefined) (document.getElementById('chain-font-color') as HTMLSelectElement).value = c.fontColor;
        if (c.regex !== undefined) (document.getElementById('chain-regex') as HTMLTextAreaElement).value = c.regex;
        if (c.caseSensitive !== undefined) (document.getElementById('chain-case-sensitive') as HTMLInputElement).checked = c.caseSensitive;
        if (c.editingId) (document.getElementById('form-add-chains') as HTMLElement).dataset.editingId = c.editingId;

        chains.setInternalState({
            annotations: c.annotations,
            rpcs: c.rpcs,
            wsRpcs: c.wsRpcs
        });

        // Trigger UI updates for color preview and namespace helper
        document.getElementById('chain-bgcolor-start')?.dispatchEvent(new Event('input'));
        document.getElementById('chain-namespace')?.dispatchEvent(new Event('change'));
    }

    // Restore Active Tab
    if (draft.activeTab) {
        const tabLink = document.querySelector(`.ext-etheraddresslookup-nav-link[data-tab="${draft.activeTab}"]`) as HTMLElement;
        if (tabLink) tabLink.click();
    }
}

// Initialize popup
window.addEventListener('load', async () => {
    console.log('Popup loaded');
    setupTabs();

    // Setup authentication handlers first (RULES Q-2005)
    await setupAuthHandlers();

    // Setup connection handlers
    await setupConnectionHandlers();

    // Setup WebSocket status handler
    setupWebSocketStatusHandler();

    // Initialize chain manager first
    try {
        await initializeGlobalChainManager();
        console.log('Chain manager initialized');
    } catch (error) {
        console.error('Failed to initialize chain manager:', error);
    }

    // Initialize logic classes
    const labels = new Labels();
    const entities = new Entities();
    const chains = new Chains();

    // Fetch data from server
    labels.fetchDataFromServer();
    entities.fetchDataFromServer();
    chains.fetchDataFromServer();

    // Setup UI handlers
    labels.setupFormSubmitHandler();
    labels.setupDownloadHandler();
    labels.setupFilterHandler();
    labels.setupResetHandler();
    await labels.updateChainOption();

    entities.setupEntityDropdownHandler();
    entities.updateOption();
    entities.setupEntityTextArea();
    entities.setupFormSubmitHandler();

    chains.setupFormHandlers();
    chains.renderChainList(window.chainManager.getAllChains());

    // Initial labels list update
    labels.updateLabelsList();

    // Load draft state
    await loadDraftState(labels, entities, chains);

    // Setup auto-save
    const debouncedSave = debounce(() => saveDraftState(labels, entities, chains), 200);
    const forms = ['ext-etheraddresslookup-new-label-form', 'form-add-entities', 'form-add-chains'];
    forms.forEach(id => {
        const form = document.getElementById(id);
        if (form) {
            form.addEventListener('input', debouncedSave);
            form.addEventListener('change', debouncedSave);
        }
    });
    // Also internal state changes in Chains (annotations, RPCs) trigger list re-renders, 
    // but the inputs themselves will trigger save. 
    // We should also hook into the add buttons for RPCs/Annotations.
    ['btn-add-annotation', 'btn-add-rpc', 'btn-add-ws-rpc', 'btn-toggle-image-grid'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', debouncedSave);
    });
});
