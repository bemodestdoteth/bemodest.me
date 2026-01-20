//Send message from the extension to here.
import { websocketService } from '../services/websocket';
import {
    WS_EVENT_LABEL_GET,
    WS_EVENT_LABEL_UPDATE,
    WS_EVENT_LABEL_INSERT,
    WS_EVENT_LABEL_DELETE,
    WS_EVENT_ENTITY_GET,
    WS_EVENT_ENTITY_UPDATE,
    WS_EVENT_CHAIN_GET,
    WS_EVENT_CHAIN_UPDATE,
    WS_EVENT_SUCCESS,
    WS_EVENT_FAILURE
} from '../shared/constants';

declare const objEtherAddressLookup: any;

// Storage key for JWT token
const STORAGE_KEY_TOKEN = 'jwt_token';

// Cache for chain data
let chainDataCache: any = null;

/**
 * @name getAuthToken
 * @desc Retrieves the JWT token from local storage (RULES S-3001)
 * @returns {Promise<string | null>}
 */
async function getAuthToken(): Promise<string | null> {
    return new Promise((resolve) => {
        chrome.storage.local.get([STORAGE_KEY_TOKEN], (result) => {
            resolve(result[STORAGE_KEY_TOKEN] || null);
        });
    });
}

/**
 * @name initializeWebSocket
 * @desc Initializes WebSocket connection on extension startup
 * @returns {Promise<void>}
 */
async function initializeWebSocket(): Promise<void> {
    try {
        console.log('[Background] Initializing WebSocket connection...');

        const token = await getAuthToken();

        if (!token) {
            console.warn('[Background] No auth token found. Please login via web interface.');
            chrome.runtime.sendMessage({ type: 'auth-status', status: 'unauthenticated' }).catch(() => { });
            return;
        }

        await websocketService.connect(token);
        console.log('[Background] WebSocket connection established');

        // Set up WebSocket event listeners
        setupWebSocketListeners();

        // Fetch initial data
        setTimeout(() => {
            console.log('[Background] Fetching initial data...');
            websocketService.emit(WS_EVENT_CHAIN_GET, { params: {}, headers: {} });
            websocketService.emit(WS_EVENT_LABEL_GET, { params: {}, headers: {} });
            websocketService.emit(WS_EVENT_ENTITY_GET, { params: {}, headers: {} });
        }, 1000);
    } catch (error) {
        console.error('[Background] Failed to initialize WebSocket:', error);
    }
}

/**
 * @name setupWebSocketListeners
 * @desc Sets up WebSocket event listeners to forward messages to popup/content scripts
 * @returns {void}
 */
function setupWebSocketListeners(): void {
    websocketService.on(WS_EVENT_CHAIN_UPDATE, (response: any) => {
        console.log('[Background] Received chainUpdate, caching and broadcasting to popup');
        chainDataCache = response;
        chrome.runtime.sendMessage({
            type: 'ws-event',
            event: 'chainUpdate',
            data: response
        }).catch(() => { });
    });

    websocketService.on(WS_EVENT_LABEL_UPDATE, (response: any) => {
        console.log('[Background] Received labelUpdate, broadcasting to popup');
        chrome.runtime.sendMessage({
            type: 'ws-event',
            event: WS_EVENT_LABEL_UPDATE,
            data: response
        }).catch(() => { });
    });

    websocketService.on(WS_EVENT_ENTITY_UPDATE, (response: any) => {
        console.log('[Background] Received entityUpdate, broadcasting to popup');
        chrome.runtime.sendMessage({
            type: 'ws-event',
            event: WS_EVENT_ENTITY_UPDATE,
            data: response
        }).catch(() => { });
    });

    websocketService.on(WS_EVENT_SUCCESS, (response: any) => {
        console.log('[Background] Success:', response.data);
        chrome.runtime.sendMessage({
            type: 'ws-event',
            event: WS_EVENT_SUCCESS,
            data: response
        }).catch(() => { });
    });

    websocketService.on(WS_EVENT_FAILURE, (response: any) => {
        console.error('[Background] Failure:', response.error);
        chrome.runtime.sendMessage({
            type: 'ws-event',
            event: WS_EVENT_FAILURE,
            data: response
        }).catch(() => { });
    });
}

try {
    console.log("Background listening for messages")

    // Initialize WebSocket connection on extension boot
    initializeWebSocket();

    chrome.runtime.onMessage.addListener(
        function (request: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
            console.log("Received message:", request);

            // Handle token storage from content script
            if (request.action === 'store-token') {
                chrome.storage.local.set({ [STORAGE_KEY_TOKEN]: request.token }, () => {
                    console.log('[Background] Token stored from web app');
                    // Reconnect with new token
                    if (websocketService.isConnected()) {
                        websocketService.disconnect();
                    }
                    initializeWebSocket();
                    sendResponse({ success: true });
                });
                return true;
            }

            // Handle WebSocket emit requests from popup/content
            if (request.action === 'ws-emit') {
                // Special handling for chainGet - return cached data if available
                if (request.event === WS_EVENT_CHAIN_GET && chainDataCache) {
                    console.log('[Background] Returning cached chain data');
                    sendResponse({ success: true });

                    // Send cached data to the runtime (Popup)
                    chrome.runtime.sendMessage({
                        type: 'ws-event',
                        event: 'chainUpdate',
                        data: chainDataCache
                    }).catch(() => { });

                    // Send cached data to tabs (Content Scripts)
                    chrome.tabs.query({}, (tabs) => {
                        tabs.forEach(tab => {
                            if (tab.id && sender.tab?.id === tab.id) {
                                chrome.tabs.sendMessage(tab.id, {
                                    type: 'ws-event',
                                    event: 'chainUpdate',
                                    data: chainDataCache
                                }).catch(() => { });
                            }
                        });
                    });
                    return true;
                }

                if (!websocketService.isConnected()) {
                    sendResponse({ success: false, error: 'WebSocket not connected' });
                    return true;
                }
                websocketService.emit(request.event, request.payload);
                sendResponse({ success: true });
                return true;
            }

            // Handle auth update (after login/logout)
            if (request.action === 'auth-update') {
                console.log('[Background] Auth update received, reconnecting...');
                if (websocketService.isConnected()) {
                    websocketService.disconnect();
                }
                initializeWebSocket();
                sendResponse({ success: true });
                return true;
            }

            // Handle WebSocket connection status request
            if (request.action === 'ws-status') {
                sendResponse({
                    isConnected: websocketService.isConnected()
                });
                return true;
            }

            // Handle other message types
            if (typeof request.func !== "undefined") {
                if (typeof objEtherAddressLookup[request.func] == "function") {
                    objEtherAddressLookup[request.func]();
                    sendResponse({ status: "ok" });
                }
            }

            // Default response if no function matches
            sendResponse({ status: "fail" });
            return true;
        }
    );
    console.log("Background.js loaded");

    // Click handler
    chrome.commands.onCommand.addListener((command) => {
        if (command === "convert_addresses") {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs: chrome.tabs.Tab[]) => {
                if (tabs[0] && tabs[0].id) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        message: "convertAddresses"
                    });
                }
            });
        }
    });

    console.log("Background script loaded successfully");
} catch (e) {
    console.log("Error in background.js: " + e);
}