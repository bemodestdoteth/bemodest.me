import { EtherAddressLookup } from "./dom-manipulator";
import { ChainManager, initializeGlobalChainManager } from "../services/chains/chain-manager";
import "../popup/styles.css";

try {
    const createExtensionInstance = () => new EtherAddressLookup(window.Web3);

    window.addEventListener("load", async function () {
        console.log(`main.js loaded`);

        // Initialize chain manager from MongoDB
        try {
            await initializeGlobalChainManager();
            console.log(`Chain manager initialized`);
            createExtensionInstance();
        } catch (error) {
            console.error(`Failed to initialize chain manager:`, error);
        }
    });

    // Listen for token from web app via postMessage
    window.addEventListener("message", (event) => {
        // Verify message origin and type
        if (event.data.type === "WEB_APP_TOKEN" && event.data.source === "bemodest-web") {
            console.log("[Content] Received token from web app");

            // Forward token to background script for storage
            chrome.runtime.sendMessage({
                action: "store-token",
                token: event.data.token
            }, (response) => {
                if (response?.success) {
                    console.log("[Content] Token stored successfully");
                } else {
                    console.error("[Content] Failed to store token");
                }
            });
        }
    });

    // Add message listener
    chrome.runtime.onMessage.addListener((request: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
        console.log("Received message:", request);

        // Handle labelUpdate events from background script
        if (request.type === "ws-event" && request.event === "labelUpdate") {
            console.log("[Content] Label update detected, re-converting addresses");
            (async () => {
                try {
                    const chainManager = ChainManager.getInstance();
                    if (!chainManager.isInitialized()) {
                        console.log("[Content] Initializing ChainManager for labelUpdate");
                        await chainManager.initialize();
                    }

                    const eal = createExtensionInstance();
                    await eal.convertAddressToLink();
                    sendResponse({ status: "ok" });
                } catch (error) {
                    console.error("[Content] Failed to re-convert addresses:", error);
                    sendResponse({ status: "error", error: String(error) });
                }
            })();
            return true;
        }

        if (request.message === "convertAddresses") {
            // Wrap in async IIFE to ensure chain initialization before execution
            (async () => {
                try {
                    const chainManager = ChainManager.getInstance();
                    if (!chainManager.isInitialized()) {
                        console.log("[Content] Initializing ChainManager for message handler");
                        await chainManager.initialize();
                    }

                    const eal = createExtensionInstance();
                    await eal.convertAddressToLink();
                    sendResponse({ status: "ok" });
                } catch (error) {
                    console.error("[Content] Failed to convert addresses:", error);
                    sendResponse({ status: "error", error: String(error) });
                }
            })();
            return true; // Keep message channel open for async response
        }
        return true;
    });
} catch (e) {
    console.log("Error in main.js: " + e);
}
