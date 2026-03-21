import { ChainManager } from '../services/chains/chain-manager';
import { BEGINNING_AND_END_CHARS_IN_ADDR_TO_SHOW } from '../shared/constants';

const EXT_PREFIX = 'ext-etheraddresslookup';
const DOM_LABELLED_ADDRESSES_KEY = "labelledAddresses";
const DOM_ENTITY_ADDRESSES_KEY = "entities";

export class EtherAddressLookup {
    private objWeb3: any;
    private scope: any;
    private strRpcDetails: string;
    private mutationTimeout: any;
    private blPerformAddressLookups: boolean;
    private intSettingsCount: number;
    private intSettingsTotalCount: number;

    // ===================================================
    // 1. Initialisation
    // ===================================================
    constructor(objWeb3: any, scope: any = chrome.storage.local) {
        this.objWeb3 = objWeb3;
        this.scope = scope;
        this.strRpcDetails = "";
        this.mutationTimeout = null;
        this.blPerformAddressLookups = true;
        this.intSettingsCount = 0;
        this.intSettingsTotalCount = 2;

        this.init();
    }

    /**
     * @name get
     * @desc Gets one or more items from storage.
     * @param {String | Array} key
     * @return {Promise}
     */
    get(key: string | string[]): Promise<any> {
        return new Promise((resolve, reject) => {
            this.scope.get(key, (items: any) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve(items);
            });
        });
    }

    async retrieve(): Promise<any[]> {
        const labels = await this.get(DOM_LABELLED_ADDRESSES_KEY) as Record<string, any>;
        if (labels[DOM_LABELLED_ADDRESSES_KEY] === undefined) {
            return [];
        } else {
            return Object.entries(labels[DOM_LABELLED_ADDRESSES_KEY]).map(([address, values]: [string, any]) => {
                return { address, ...values };
            });
        }
    }

    setDefaultExtensionSettings() {
        this.blPerformAddressLookups = true;

        this.intSettingsCount = 0;
        this.intSettingsTotalCount = 2;
    }

    /**
     * @name init
     * @desc Gets extension settings and applies DOM manipulation
     */
    init(): void {
        //Update the DOM once all settings have been received...
        setTimeout(() => {
            // Needs to happen after user settings have been collected
            // and in the context of init();
            this.manipulateDOM();
            this.setupMutationObserver();
        }, 10);
    }

    setupMutationObserver() {
        const observer = new MutationObserver((mutations) => {
            let shouldRun = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    shouldRun = true;
                    break;
                }
            }
            if (shouldRun) {
                if (this.mutationTimeout) {
                    clearTimeout(this.mutationTimeout);
                }
                this.mutationTimeout = setTimeout(() => {
                    this.convertAddressToLink();
                }, 1000); // 1s debounce to prevent performance issues
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    manipulateDOM() {
        const convertSync = (async () => {
            await this.convertAddressToLink()
        })();
    }

    async convertAddressToLink() {
        console.log(`Executing convertAddressToLink()`);
        const arrScannedTags = ["div", "code", "span", "p", "td", "li", "em", "i", "b", "strong", "small", "a", "h1", "h2", "h3"];

        let websiteHasIframe = false;
        const iframeWebsiteExceptions = [
            "https://etherscan.io",
            "https://goerli.etherscan.org",
            "https://sepolia.etherscan.io",
            "https://bscscan.com",
            "https://polygonscan.com",
            "https://snowscan.xyz",
            "https://arbiscan.io",
            "https://nova.arbiscan.io",
            "https://optimistic.etherscan.io",
            "https://ftmscan.com",
            "https://gnosisscan.io",
            "https://basescan.org",
            "https://goerli.basescan.org",
            "https://zkevm.polygonscan.com",
            "https://celoscan.io",
            "https://lineascan.build",
            "https://wemixscan.com",
            "https://cronoscan.com",
            "https://scrollscan.com",
            "https://kromascan.com",
            "https://era.zksync.network",
            "https://opbnb.bscscan.com",
            "https://explorer.zora.energy",
            "https://blastscan.io",
            "https://mantlescan.xyz",
            "https://taikoscan.io"
        ];

        for (const iframeWebsiteException of iframeWebsiteExceptions) {
            if (window.location.href.includes(iframeWebsiteException)) {
                websiteHasIframe = true;
            }
        }

        const retrievedAddresses = await this.retrieve();

        // Now deal with iframes
        if (websiteHasIframe) {
            const iframe = document.getElementsByTagName("iframe");
            for (let i = 0; i < iframe.length; i++) {
                //Get the scanned nodes
                for (let j = 0; j < arrScannedTags.length; j++) {
                    const contentDoc = iframe[i].contentWindow?.document;
                    if (!contentDoc) continue;
                    const objNodes = contentDoc.getElementsByTagName(arrScannedTags[j]);
                    //Loop through the scanned content
                    for (let x = 0; x < objNodes.length; x++) {
                        // if( this.hasIgnoreAttributes(objNodes[x]) ){ continue; }
                        this.convertAddresses(objNodes[x], retrievedAddresses);
                    }
                }
            }
        }

        // Get the scanned nodes
        for (let i = 0; i < arrScannedTags.length; i++) {
            const objNodes = document.getElementsByTagName(arrScannedTags[i]);
            //Loop through the scanned content
            for (let x = 0; x < objNodes.length; x++) {
                if ((objNodes[x] as HTMLElement).getAttribute('data-ext-processed') === 'true') { continue; }
                this.convertAddresses(objNodes[x], retrievedAddresses);
            }
        }
        // this.addHighlightStyle();
    }

    /**
     * @name Convert Addresses
     * @desc Takes a Node and checks if any of its children are textNodes. On success replace textNode with slot node
     * @desc slot node contains regex replaced content; see generateReplacementContent()
     * @param {Node} objNode
     */
    async convertAddresses(objNode: any, retrievedAddresses: any[]): Promise<void> {
        // Some nodes have non-textNode children
        const nodeTypeExceptions = [
            "https://tronscan.org/",
        ];
        let nodeType: number;
        if (window.location.href.includes(nodeTypeExceptions[0])) {
            nodeType = 1;
        } else {
            nodeType = 3;
        }

        // we need to ensure regex is applied only to text otherwise we will mess the html up
        for (let i = 0; i < objNode.childNodes.length; i++) {
            if (objNode.childNodes[i].nodeType == nodeType) { // nodeType 3 = a text node
                const child = objNode.childNodes[i];
                const childContent = child.textContent.trim();

                // Skip if the textNode is empty or too long
                if ((childContent.length < 5 && !(childContent.includes(".") || childContent.includes("-") || childContent.includes("–"))) || childContent.length > 70) { continue; }

                const label = await this.isLabelMatched(childContent, retrievedAddresses);
                // Only start replacing stuff if the we get a RegEx match.
                if (label !== undefined) {
                    const replacement = document.createElement('div');
                    replacement.setAttribute('class', 'ext-etheraddresslookup-temporary');
                    replacement.setAttribute('style', 'display: inline-block;');
                    replacement.innerHTML = this.generateReplacementContent(label);
                    objNode.replaceChild(replacement, child);
                    objNode.setAttribute('data-ext-processed', 'true');
                }
            }
        }
    }

    async isLabelMatched(childContent: string, retrievedAddresses: any[]): Promise<any> {
        const text = childContent.trim().toLowerCase();
        // Handle various abbreviations: 0x123...abcd, 0x123…abcd, etc.
        const segments = text.split(/\.\.\.|…/);

        for (const entry of retrievedAddresses) {
            const addr = entry.address.toLowerCase();

            // 1. Direct hex address match
            let matched = false;
            if (segments.length === 1) {
                if (addr === text) matched = true;
            } else if (segments.length >= 2) {
                const start = segments[0];
                const end = segments[segments.length - 1];
                if (start.length >= 2 && addr.startsWith(start) && addr.endsWith(end)) {
                    matched = true;
                }
            }

            // 2. Alias match (only for non-abbreviated text)
            if (!matched && segments.length === 1) {
                const hasAlias = entry.aliases?.some((a: any) => a.name.toLowerCase() === text);
                if (hasAlias) matched = true;
            }

            if (matched) return await this.buildLabel(entry);
        }
        return undefined;
    }

    private async buildLabel(entry: any): Promise<any> {
        const chainManager = ChainManager.getInstance();

        // Ensure ChainManager is initialized before accessing chains
        if (!chainManager.isInitialized()) {
            await chainManager.initialize();
        }

        // Support both legacy `chain` (string) and new `chains` (string[])
        const chainCodes: string[] = Array.isArray(entry.chains)
            ? entry.chains
            : (entry.chain ? [entry.chain] : []);

        const chains = chainCodes
            .map((code: string) => chainManager.getChainByCode(code))
            .filter(Boolean);

        if (chains.length === 0) {
            const availableChains = chainManager.getAllChains().map((c: any) => c.chain).join(', ');
            console.warn(`No valid chains found for: ${chainCodes.join(', ')}. Available: ${availableChains}`);
            return undefined;
        }

        return {
            address: entry.address,
            chains,
            primaryChain: chains[0],
            comment: entry.comment,
            entity: entry.entity,
            entityImage: entry.entityImage,
            label: entry.label,
            tracking: entry.tracking,
        };
    }

    /**
     * @name Generate Replacement Content
     * @desc Takes string and replaces any regex pattern matches with the associated replace patterns
     * @param {string} content
     * @returns {string}
     */
    generateReplacementContent(label: any): string {
        const imgTag = label.entityImage === '' ? '' :
            `<img class="ext-etheraddresslookup-label-img" src="${label.entityImage}" style="width:1.2em;height:auto;">`;

        // Build gradient from up to 4 chain colors
        const gradientColors = label.chains.slice(0, 4).map((c: any) => c.bgColor);
        const gradient = gradientColors.length === 1
            ? gradientColors[0]
            : `linear-gradient(var(--chain-angle,135deg), ${gradientColors.join(', ')})`;

        // One explorer link per chain
        const explorerLinks = label.chains.map((c: any) =>
            `<a href="${c.blockExplorerPrefix}${label.address}"
                target="_blank"
                style="display:block;color:${c.fontColor};font-size:10px;padding:1px 0;
                       text-decoration:none;white-space:nowrap;">
                ↳ View on ${c.name}
             </a>`
        ).join('');


        return imgTag +
            `<span class="ext-etheraddresslookup-link ext-multichain-label"
                   style="position:relative;display:inline-block;--chain-angle:135deg;">
                <a href="${label.primaryChain.blockExplorerPrefix}${label.address}"
                   target="_blank"
                   title="${label.label}"
                   style="padding:2px;background:${gradient};color:${label.primaryChain.fontColor}!important;
                          border:1px solid;border-radius:0.25rem;display:inline-block;text-decoration:none;">
                    ${label.label}
                </a>
                <span class="ext-chain-tooltip"
                      style="display:none;position:absolute;top:100%;left:0;background:#fff;
                             border:1px solid #ccc;border-radius:4px;padding:4px 8px;z-index:9999;
                             white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.12);">
                    ${explorerLinks}
                </span>
            </span>`;
    }

    /**
     * @name Has Ignore Attributes
     * @desc Checks if a node contains any attribute that we want to avoid manipulating
     * @param {Element} node
     * @returns {boolean}
     */
    hasIgnoreAttributes(node: Element): boolean {
        var ignoreAttributes = {
            "class": ["ng-binding"]
        };

        // Loop through all attributes we want to test for ignoring
        for (var attributeName in ignoreAttributes) {
            // Filter out the object's default properties
            if (ignoreAttributes.hasOwnProperty(attributeName)) {

                // Check this node has the attribute we are currently checking for
                if (node.hasAttribute(attributeName)) {

                    // This node's value for the attribute we are checking
                    var nodeAttributeValue = node.getAttribute(attributeName);
                    if (!nodeAttributeValue) continue;

                    // The values we want to ignore for this attribute
                    var badAttributeValueList = (ignoreAttributes as any)[attributeName];

                    // Loop through the attribute values we want to ignore
                    for (var i = 0; i < badAttributeValueList.length; i++) {
                        // If we find an indexOf, this value is present in the attribute
                        if (nodeAttributeValue.indexOf(badAttributeValueList[i]) !== -1) {
                            return true;
                        }
                    }

                }

            }
        }

        return false;
    }
}

// try {
//     chrome.browserAction.onClicked.addListener((tab) => {
//         objBrowser.tabs.executeScript({
//             "func": convertAddressToLink,
//             "allFrames" : true
//         });
//     });
// } catch(e) {
//     console.log("Error in DomManipulator.js: " + e);
// }