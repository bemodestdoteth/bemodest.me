import { EtherAddressLookup } from "./dom-manipulator";
import { initializeGlobalChainManager } from "../services/chains";
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
        if (request.message === "convertAddresses") {
            const eal = createExtensionInstance();
            eal.convertAddressToLink();
            sendResponse({ status: "ok" });
        }
        return true;
    });
} catch (e) {
    console.log("Error in main.js: " + e);
}
