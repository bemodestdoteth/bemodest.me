import { Labels } from '../shared/labels';
import { Entities } from '../shared/entities';
import { Chains } from '../shared/chains';
import { initializeGlobalChainManager } from '../services/chains/chain-manager';

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

// Initialize popup
window.addEventListener('load', async () => {
    console.log('Popup loaded');
    setupTabs();

    // Setup authentication handlers first (RULES Q-2005)
    await setupAuthHandlers();

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
    labels.updateChainOption();

    entities.setupEntityDropdownHandler();
    entities.updateOption();
    entities.setupEntityTextArea();
    entities.setupFormSubmitHandler();

    chains.setupFormHandlers();
    chains.renderChainList();

    // Initial labels list update
    labels.updateLabelsList();
});
