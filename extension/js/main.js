try {
    let objBrowser = chrome ? chrome : browser;
    const createExtensionInstance = () => new EtherAddressLookup(Web3);    

    window.addEventListener("load", function() {
        console.log(`main.js loaded`);
        createExtensionInstance();
    });

    // Add message listener
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        console.log("Received message:", request);
        if (request.message === "convertAddresses") {
            const eal = createExtensionInstance();
            eal.convertAddressToLink();
            sendResponse({status: "ok"});
        }
        return true;
    });
} catch(e) {
    console.log("Error in main.js: " + e);
}

// try {
//     objBrowser.runtime.onMessage.addListener(
//         function(request, sender, sendResponse) {
//             console.log("Received message:", request);
//             let objEtherAddressLookup = createExtensionInstance();
    
//             if(request.func === "getCompatibilityMode") {
//                 let mode = localStorage.getItem("ext-etheraddresslookup-compatibility_mode") || "1";
//                 console.log("Sending Compatibility mode: " + mode);
//                 sendResponse({compatibilityMode: mode});
//                 console.log("Sent response compatibilityMode: " + mode);
//                 return true;
//             }
    
//             // Handle other message types
//             if (typeof request.func !== "undefined") {
//                 if(typeof objEtherAddressLookup[request.func] == "function") {
//                     objEtherAddressLookup[request.func]();
//                     sendResponse({status: "ok"});
//                     return true;
//                 }
//             }
    
//             sendResponse({status: "fail"});
//             return false;
//         }
//     );
//     console.log("Background.js loaded");  
// } catch(e) {
//     console.log("Error in background.js: " + e);
// }