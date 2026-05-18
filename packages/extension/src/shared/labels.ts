import { LABELLED_ADDRESSES_KEY, ENTITY_ADDRESSES_KEY, FORM_NAME_SELECTOR, FORM_ADDRESS_SELECTOR, FORM_COMMENT_SELECTOR, FORM_TRACK_SELECTOR, FORM_CHAIN_SELECTOR, FORM_ENTITY_SELECTOR, WS_EVENT_LABEL_GET, WS_EVENT_LABEL_UPDATE, WS_EVENT_LABEL_INSERT, WS_EVENT_LABEL_DELETE, WS_EVENT_SUCCESS, WS_EVENT_FAILURE } from './constants';
import { ChainManager } from '../services/chains/chain-manager';

// Alias Panel Selectors
const ALIAS_ROWS_SELECTOR = '#alias-rows';
const ALIAS_ADD_BTN_SELECTOR = '#btn-add-alias';

export class Labels {
    private scope: chrome.storage.LocalStorageArea;
    /** In-memory sorted label cache — rebuilt on load/sync, filtered on search */
    private labelCache: Array<{ address: string;[key: string]: any }> = [];

    constructor(scope = chrome.storage.local) {
        this.scope = scope;
        this.setupMessageListener();
        this.setupAliasButtons();
    }

    /**
     * @name setupMessageListener
     * @desc Sets up message listener for WebSocket events from background script
     * @returns {void}
     */
    private setupMessageListener(): void {
        chrome.runtime.onMessage.addListener((message: any) => {
            if (message.type === 'ws-event') {
                this.handleWebSocketEvent(message.event, message.data);
            }
        });
    }

    /**
     * @name handleWebSocketEvent
     * @desc Handles WebSocket events forwarded from background script
     * @param {string} event - Event name
     * @param {any} data - Event data
     * @returns {void}
     */
    private async handleWebSocketEvent(event: string, data: any): Promise<void> {
        switch (event) {
            case WS_EVENT_LABEL_UPDATE:
                if (data.success && data.data) {
                    console.log('[Labels] Received label update from server');
                    this.updateStatus('Labels synced successfully', 'success');
                    await this.syncLabelsFromServer(data.data);
                    await this.updateLabelsList();
                }
                break;
            case WS_EVENT_SUCCESS:
                console.log('[Labels] Success:', data.data);
                this.updateStatus(`Success: ${data.data}`, 'success');
                break;
            case WS_EVENT_FAILURE:
                console.error('[Labels] Failure:', data.error);
                this.updateStatus(`Failure: ${data.error}`, 'error');
                this.toggleLoading(false);
                break;
        }
    }

    /**
     * @name updateStatus
     * @desc Updates the status message in the UI
     * @param {string} message - Message to display
     * @param {string} type - Type of message (pending, success, error)
     * @returns {void}
     */
    private updateStatus(message: string, type: 'pending' | 'success' | 'error' = 'pending'): void {
        const form = document.getElementById('ext-etheraddresslookup-new-label-form');
        if (!form) return;

        let statusEl = document.getElementById('ext-etheraddresslookup-form-status');
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'ext-etheraddresslookup-form-status';
            statusEl.style.marginTop = '10px';
            statusEl.style.fontSize = '12px';
            statusEl.style.fontWeight = '500';
            form.appendChild(statusEl);
        }

        statusEl.textContent = `[Labels] ${message}`;

        switch (type) {
            case 'success':
                statusEl.style.color = '#2e7d32'; // Green
                setTimeout(() => {
                    if (statusEl) statusEl.textContent = '';
                }, 5000);
                break;
            case 'error':
                statusEl.style.color = '#d32f2f'; // Red
                break;
            case 'pending':
                statusEl.style.color = '#1976d2'; // Blue
                break;
        }
    }

    /**
     * @name syncLabelsFromServer
     * @desc Syncs label data received from server to local storage
     * @param {any[]} data - Array of label objects from MongoDB
     * @returns {Promise<void>}
     */
    private async syncLabelsFromServer(data: any[]): Promise<void> {
        if (!Array.isArray(data)) {
            console.error('[Labels] Invalid data format received from server');
            return;
        }

        const labelMap: any = {};
        data.forEach((item: any) => {
            if (item.addr) {
                labelMap[item.addr] = {
                    chains: Array.isArray(item.chains) ? item.chains : (item.chain ? [item.chain] : []),
                    comment: item.comment || '',
                    entity: item.entity || '',
                    entityImage: item.entityImage || '',
                    label: item.label || '',
                    aliases: Array.isArray(item.aliases) ? item.aliases : [],
                    tracking: item.tracking === '1' || item.tracking === 'true' || item.tracking === true
                };
            }
        });

        await this.set({ [LABELLED_ADDRESSES_KEY]: labelMap });
        console.log(`[Labels] Synced ${Object.keys(labelMap).length} labels to local storage`);
        await this.buildCache();
    }

    /**
     * @name emitWebSocketEvent
     * @desc Sends WebSocket event request to background script
     * @param {string} event - Event name
     * @param {any} payload - Event payload
     * @returns {Promise<boolean>}
     */
    private async emitWebSocketEvent(event: string, payload: any): Promise<boolean> {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'ws-emit',
                event,
                payload
            }, (response: any) => {
                if (chrome.runtime.lastError) {
                    console.error('[Labels] Error emitting event:', chrome.runtime.lastError);
                    resolve(false);
                } else {
                    resolve(response?.success || false);
                }
            });
        });
    }

    /**
     * @name get
     * @desc Gets one or more items from storage.
     * @param {String | Array} key
     * @return {Promise}
     */
    get(key: string | string[]): Promise<any> {
        return new Promise((resolve, reject) => {
            this.scope.get(key, (items) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve(items);
            });
        });
    }

    /**
     * @name set
     * @desc Sets multiple items.
     * @param {Object} dataObject
     * @return {Promise}
     */
    async set(dataObject: any): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.scope.set(dataObject, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * @name add
     * @desc Adds one or more items to local storage.
     * @param {any} body - Label data to add
     * @returns {Promise<void>}
     */
    async add(body: any): Promise<void> {
        const localData: any = await this.get(LABELLED_ADDRESSES_KEY);
        localData[LABELLED_ADDRESSES_KEY] = { ...localData[LABELLED_ADDRESSES_KEY], ...body };
        await this.set(localData);
        await this.buildCache();
    }

    /**
     * @name remove
     * @desc Removes one or more items from local storage.
     * @param {string} address - Address to remove
     * @returns {Promise<void>}
     */
    async remove(address: string): Promise<void> {
        const localData: any = await this.get(LABELLED_ADDRESSES_KEY);
        delete localData[LABELLED_ADDRESSES_KEY][address];
        await this.set(localData);
        await this.buildCache();
    }

    /**
     * @name clear
     * @desc Clears local storage.
     * @returns {Promise<void>}
     */
    clear(): Promise<void> {
        return new Promise<void>((resolve) => {
            this.scope.clear(() => {
                if (chrome.runtime.lastError) {
                    console.log(chrome.runtime.lastError);
                }
                else {
                    resolve();
                }
            });
        });
    }


    /**
     * @name compareKeys
     * @desc Compare key between two objects
     * @param {object} obj1 - Object 1 to compare
     * @param {object} obj2 - Object 2 to compare
     * @returns {boolean} True if keys of two objests match
     */
    compareKeys(obj1: any, obj2: any): boolean {
        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);

        if (keys1.length !== keys2.length) {
            return false; // They have different number of keys
        }

        for (let key of keys1) {
            if (!obj2.hasOwnProperty(key)) {
                return false; // Key in obj1 is not present in obj2
            }
        }

        return true;
    }

    /**
     * @name toggleLoading
     * @desc Toggles the loading overlay visibility
     * @param {boolean} show - Whether to show or hide
     */
    toggleLoading(show: boolean): void {
        const loader = document.getElementById('labels-loading-overlay');
        if (loader) {
            loader.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * @name buildCache
     * @desc Reads labels from storage once and stores sorted array in memory.
     * @returns {Promise<void>}
     */
    private async buildCache(): Promise<void> {
        const localData: any = await this.get(LABELLED_ADDRESSES_KEY);
        const raw = localData[LABELLED_ADDRESSES_KEY];
        if (!raw) { this.labelCache = []; return; }
        this.labelCache = Object.entries(raw)
            .map(([address, values]: [string, any]) => ({ address, ...values }))
            .sort((a: any, b: any) => (a.label || '').localeCompare(b.label || ''));
    }

    /**
     * @name fetchDataFromServer
     * @desc Fetch label data from server via WebSocket
     * @returns {Promise<void>}
     */
    async fetchDataFromServer(): Promise<void> {
        try {
            // Only show loader if we don't have local data
            const localData: any = await this.get(LABELLED_ADDRESSES_KEY);
            if (!localData[LABELLED_ADDRESSES_KEY] || Object.keys(localData[LABELLED_ADDRESSES_KEY]).length === 0) {
                this.toggleLoading(true);
            }

            console.log('[Labels] Requesting labels from server via WebSocket');
            const success = await this.emitWebSocketEvent(WS_EVENT_LABEL_GET, {
                params: {},
                headers: {}
            });

            if (!success) {
                console.warn('[Labels] Failed to request labels - WebSocket may not be ready');
                this.toggleLoading(false);
            }
        } catch (err) {
            console.error('[Labels] Error fetching data:', err);
            this.toggleLoading(false);
        }
    }

    /**
     * @name addDataToServer
     * @desc Send label data to server via WebSocket
     * @param {any} body - Label data to insert
     * @returns {Promise<string | undefined>}
     */
    async addDataToServer(body: any): Promise<string | undefined> {
        try {
            const address = Object.keys(body)[0];
            const labelData = body[address];

            const payload = {
                body: {
                    addr: address,
                    label: labelData.label,
                    chains: labelData.chains,
                    aliases: labelData.aliases,
                    entity: labelData.entity,
                    tracking: labelData.tracking,
                    comment: labelData.comment
                },
                headers: {}
            };

            console.log('[Labels] Inserting label via WebSocket:', payload);
            const success = await this.emitWebSocketEvent(WS_EVENT_LABEL_INSERT, payload);

            if (!success) {
                alert('WebSocket connection not available');
                return;
            }

            return 'Label insert request sent';
        } catch (err) {
            console.error('[Labels] Error adding data:', err);
        }
    }

    /**
     * @name deleteDataToServer
     * @desc Send delete request to server via WebSocket
     * @param {string} address - Address to delete
     * @returns {Promise<string | undefined>}
     */
    async deleteDataToServer(address: string): Promise<string | undefined> {
        try {
            const payload = {
                body: { addr: address },
                headers: {}
            };

            console.log('[Labels] Deleting label via WebSocket:', payload);
            const success = await this.emitWebSocketEvent(WS_EVENT_LABEL_DELETE, payload);

            if (!success) {
                alert('WebSocket connection not available');
                return;
            }

            return 'Label delete request sent';
        } catch (err) {
            console.error('[Labels] Error deleting data:', err);
        }
    }

    /**
     * @name addLabelsListEvents
     * @desc Add HTML elements and events to the labels list
     * @return {void}
     */
    addLabelsListEvents(): void {
        const labelsDeleteElements = document.getElementsByClassName("ext-etheraddresslookup-label-delete");

        Array.from(labelsDeleteElements).forEach((element) => {
            element.addEventListener('click', async (event: Event) => {
                event.stopPropagation(); // Stop propagation to row click
                const target = event.target as HTMLElement;
                const address = target?.getAttribute('data-ext-etheraddresslookup-label-id');
                if (!address) return;

                if (confirm(`Are you sure you want to delete the label for ${address}?`)) {
                    const response = await this.deleteDataToServer(address);
                    if (response !== undefined) {
                        await chrome.storage.local.remove('extensionFormDraft');
                        await this.remove(address);
                        await this.updateLabelsList(); // Refresh list to remove item
                        alert(`Address ${address} successfully deleted.`);
                        this.resetFormState();
                    }
                }
            });
        });

        const FILL_LABEL_INPUT_ATTRIBUTE = 'data-fill-label-input';
        document.querySelectorAll(`[${FILL_LABEL_INPUT_ATTRIBUTE}]`).forEach(element => {
            // The span is inside a div, better to listener on the row or make sure click target is correct
            // The original code had listener on the span
            const row = element.closest('.label-row') as HTMLElement;
            if (row) {
                row.style.cursor = 'pointer';
                row.onclick = async () => {
                    const address = element.getAttribute(FILL_LABEL_INPUT_ATTRIBUTE);
                    if (!address) return;

                    const addrVals = this.labelCache.find(l => l.address === address);
                    if (!addrVals) return;

                    const nameEl = document.querySelector(FORM_NAME_SELECTOR) as HTMLInputElement;
                    const addrEl = document.querySelector(FORM_ADDRESS_SELECTOR) as HTMLInputElement;
                    const commentEl = document.querySelector(FORM_COMMENT_SELECTOR) as HTMLTextAreaElement;
                    const trackEl = document.querySelector(FORM_TRACK_SELECTOR) as HTMLInputElement;

                    if (nameEl) nameEl.value = addrVals.label;
                    if (addrEl) addrEl.value = address;
                    if (commentEl) commentEl.value = addrVals.comment;
                    if (trackEl) trackEl.checked = addrVals.tracking;

                    const chainManager = (window as any).chainManager;
                    if (!chainManager) return;

                    // Populate multi-select chain picker from stored chains array
                    const existingChains: string[] = Array.isArray(addrVals.chains)
                        ? addrVals.chains
                        : (addrVals.chain ? [addrVals.chain] : []);
                    setSelectedChainsInUI(existingChains);

                    // Populate aliases
                    const existingAliases: { name: string; chain: string }[] = Array.isArray(addrVals.aliases)
                        ? addrVals.aliases
                        : [];
                    this.renderAliasRows(existingAliases);

                    let entityElement = document.querySelector(FORM_ENTITY_SELECTOR) as HTMLSelectElement;
                    if (entityElement && entityElement.options) {
                        // Find option by text content matching entity name
                        for (let i = 0; i < entityElement.options.length; i++) {
                            if (entityElement.options[i].text === (addrVals.entity || "Entity (Optional)")) {
                                entityElement.selectedIndex = i;
                                break;
                            }
                        }
                    }

                    // Set edit mode
                    const form = document.getElementById('ext-etheraddresslookup-new-label-form');
                    if (form) {
                        form.dataset.editingAddr = address;
                        const submitBtn = form.querySelector('button[type="submit"]');
                        if (submitBtn) submitBtn.textContent = 'Update Label';

                        // Add Cancel button
                        let cancelBtn = document.getElementById('btn-cancel-edit-label');
                        if (!cancelBtn) {
                            cancelBtn = document.createElement('button');
                            cancelBtn.id = 'btn-cancel-edit-label';
                            cancelBtn.textContent = 'Cancel';
                            (cancelBtn as HTMLButtonElement).type = 'button';
                            cancelBtn.className = 'btn-secondary'; // Assuming class exists or style it
                            cancelBtn.style.marginLeft = '10px';
                            cancelBtn.style.padding = '8px 16px';
                            cancelBtn.style.background = '#f5f5f5';
                            cancelBtn.style.border = '1px solid #ddd';
                            cancelBtn.style.borderRadius = '4px';
                            cancelBtn.style.cursor = 'pointer';
                            cancelBtn.onclick = () => {
                                this.resetFormState();
                            };
                            submitBtn?.parentNode?.appendChild(cancelBtn);
                        }
                    }

                    // Visual feedback
                    document.querySelectorAll('.label-row').forEach(r => (r as HTMLElement).style.backgroundColor = 'transparent');
                    row.style.backgroundColor = '#f0f9ff';
                };
            }
        });
    }

    /**
     * @name setupFilterHandler
     * @desc Setup the filter handler
     * @return {void}
     */
    setupFilterHandler(): void {
        const searchForm = document.getElementById('form-label-search');
        if (!searchForm) return;

        searchForm.addEventListener('submit', async (event: Event) => {
            event.preventDefault();
        });

        const searchInput = document.getElementById('ext-etheraddresslookup-search-label') as HTMLInputElement;
        if (searchInput) {
            searchInput.addEventListener('input', async () => {
                const query = searchInput.value || '';
                await this.updateLabelsList(query);
            });
        }
    }

    /**
     * @name updateLabelsList
     * @desc Update the labels list
     * @param {string} query - Search query in case of filter
     * @return {void}
     */
    async updateLabelsList(query: string = ""): Promise<void> {
        // Populate cache on first call or if empty (e.g. initial load).
        if (this.labelCache.length === 0) {
            await this.buildCache();
        }
        const q = query.toLowerCase();
        const filtered = q
            ? this.labelCache.filter((label: any) => {
                const inLabel = label.label?.toLowerCase().includes(q);
                const inAlias = label.aliases?.some((a: any) => a.name?.toLowerCase().includes(q));
                return inLabel || inAlias;
            })
            : this.labelCache;

        const countEl = document.getElementById('label-count');
        if (countEl) countEl.textContent = filtered.length.toString();

        let HTMLLabels = '';
        for (const labelData of filtered) {
            HTMLLabels += this.getExtendedTemplate(labelData);
        }

        const labelsContainer = document.getElementById('ext-etheraddresslookup-current-labels');
        if (labelsContainer) labelsContainer.innerHTML = HTMLLabels;
        this.addLabelsListEvents();
        this.toggleLoading(false);
    }

    /**
     * @name setupDownloadHandler
     * @desc Setup the download button handler
     * @return {void}
     */
    setupDownloadHandler(): void {
        const downloadBtn = document.getElementById('download-csv');
        if (!downloadBtn) return;

        downloadBtn.addEventListener('click', async () => {
            chrome.storage.local.get(null, (data: any) => {
                // Convert data to CSV
                const csvHeader = '\uFEFF' + "Address,Label,Code,Comment,Entity\n"; // UTF-8 BOM + header
                const csvContent = Object.keys(data['labelledAddresses']).map((key: string) => {
                    const entry = data['labelledAddresses'][key];
                    const chainCode = (Array.isArray(entry.chains)
                        ? entry.chains.join(',')
                        : (entry.chain ?? '')
                    ).trim();
                    return [
                        key.trim(),
                        entry.label.trim(),
                        chainCode,
                        entry.comment.trim(),
                        entry.entity.trim(),
                    ].join(',') + '\n';
                }).join('');

                const csv = csvHeader + csvContent;

                // Create a Blob from the CSV string
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

                // Create a download link
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(blob);
                downloadLink.download = 'data.csv';

                // Append the link to the DOM, trigger the download, and remove the link
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
            });
        });
    }

    /**
     * @name getExtendedTemplate
     * @desc Get the HTML template for a label
     * @param {object} body - Label data
     * @returns {string} HTML template string
     */
    getExtendedTemplate(body: any): string {
        const trackingChecked = body.tracking ? "checked" : "";
        const shortenText = (text: string, maxLength: number): string => {
            return text ? text.length > maxLength ? text.substring(0, maxLength - 3) + "..." : text : ''
        }

        const chainManager = (window as any).chainManager;

        // Support both legacy `chain` (string) and new `chains` (string[])
        const chainCodes: string[] = Array.isArray(body.chains)
            ? body.chains
            : (body.chain ? [body.chain] : []);

        const chains = chainManager
            ? chainCodes.map((code: string) => chainManager.getChainByCode(code)).filter(Boolean).slice(0, 4)
            : [];

        if (!chainManager) {
            console.warn('[Labels] chainManager not initialized, rendering without chain data');
        }

        const gradient = chains.length > 0
            ? (chains.length === 1
                ? (chains[0] as any).bgColor
                : `linear-gradient(var(--chain-angle, 135deg), ${chains.map((c: any) => c.bgColor).join(', ')})`)
            : '#444';
        const fontColor = chains.length > 0 ? (chains[0] as any).fontColor : '#fff';
        const chainNames = chains.length > 0
            ? chains.map((c: any) => c.annotation?.code || c.name).join(', ')
            : chainCodes.join(', ');

        return `<div class="label-row" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; width: 100%;">
            <div style="display: flex; align-items: center; overflow: hidden; flex-grow: 1; margin-right: 10px;">
                <img class="ext-etheraddresslookup-label-img" src="${body.entityImage}" style="flex-shrink: 0; margin-right: 5px; width: 16px; height: 16px; border-radius: 4px; display: ${body.entityImage ? 'block' : 'none'}"/>
                <span class='ext-etheraddresslookup-label' data-fill-label-input="${body.address}"
                title="${body.label}&#013;${body.address}&#013;${body.entity}&#013;${body.comment}"
                style="color:${fontColor};background:${gradient};--chain-angle:135deg;font-size:11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${shortenText(body.label, 18)} ${chainNames}
                </span>
                ${body.aliases?.length ? `<span style="font-size:9px;color:#888;margin-left:4px;">${body.aliases[0].name}</span>` : ''}
            </div>
            <div style="display: flex; align-items: center; flex-shrink: 0;">
                <input type="checkbox" class="track-this-wallet" value="${body.address}" style="margin-right: 8px; cursor: pointer; vertical-align: middle;" ${trackingChecked} disabled>
                <span style="cursor:pointer; font-weight: bold; padding: 2px 5px; vertical-align: middle;" class="ext-etheraddresslookup-label-delete" data-ext-etheraddresslookup-label-id="${body.address}">x</span>
            </div>
        </div>`;
    }

    async updateDataToServer(body: any, originalAddr: string): Promise<string | undefined> {
        try {
            const address = Object.keys(body)[0];
            const labelData = body[address];

            const payload = {
                body: {
                    originalAddr: originalAddr,
                    addr: address,
                    label: labelData.label,
                    chains: labelData.chains,
                    entity: labelData.entity,
                    tracking: labelData.tracking,
                    comment: labelData.comment
                },
                headers: {}
            };

            console.log('[Labels] Updating label via WebSocket:', payload);
            const success = await this.emitWebSocketEvent(WS_EVENT_LABEL_UPDATE, payload);

            if (!success) {
                alert('WebSocket connection not available');
                return;
            }

            return 'Label update request sent';
        } catch (err) {
            console.error('[Labels] Error updating data:', err);
        }
    }

    /**
     * @name setupFormSubmitHandler
     * @desc Setup the form submit button handler
     * @return {void}
     */
    setupFormSubmitHandler(): void {
        const form = document.getElementById('ext-etheraddresslookup-new-label-form');
        if (!form) return;

        form.addEventListener('submit', async (event: Event) => {
            event.preventDefault();
            const localEntity: any = await this.get(ENTITY_ADDRESSES_KEY);

            const labelInput = document.querySelector(FORM_NAME_SELECTOR) as HTMLInputElement;
            const label = labelInput?.value || '';

            const chainManager = (window as any).chainManager;
            if (!chainManager) {
                alert('Chain manager not initialized. Please refresh the extension.');
                return;
            }

            // Read ordered chain selection from the multi-select UI
            const selectedChainCodes = getSelectedChainsFromUI();
            if (selectedChainCodes.length === 0) {
                alert('Please select at least one chain.');
                return;
            }

            const selectedChains = selectedChainCodes
                .map((code: string) => chainManager.getChainByCode(code))
                .filter(Boolean);

            if (selectedChains.length === 0) {
                alert('No valid chains selected.');
                return;
            }

            // Use first (primary) chain for address format validation
            // All chains share the same regex pattern (enforced by the picker)
            const primaryChain = selectedChains[0];

            const addressInput = document.querySelector(FORM_ADDRESS_SELECTOR) as HTMLInputElement;
            const addressValue = addressInput?.value || '';
            const address = primaryChain.addrCaseSensitive ? addressValue : addressValue.toLowerCase();

            const entitySelect = document.querySelector(FORM_ENTITY_SELECTOR) as HTMLSelectElement;
            let entity = entitySelect?.options[entitySelect.selectedIndex]?.textContent || '';
            let entityImage;
            if (entity === "Entity (Optional)" || entity === "") {
                entity = "";
                entityImage = "";
            } else {
                entityImage = localEntity[ENTITY_ADDRESSES_KEY]?.[entity]?.image || '';
            }

            const commentInput = document.querySelector(FORM_COMMENT_SELECTOR) as HTMLTextAreaElement;
            const comment = commentInput?.value || '';

            const trackInput = document.querySelector(FORM_TRACK_SELECTOR) as HTMLInputElement;
            const tracking = trackInput?.checked || false;

            // Check if the address is in the correct format
            const matchAnyRegex = (string: string, patterns: RegExp[]): boolean => {
                return patterns.some((pattern: RegExp) => pattern.test(string));
            }
            const isValidAddress = matchAnyRegex(address, primaryChain.addrRegexPatterns);

            if (!isValidAddress) {
                alert('Please make sure that "Address" is in the correct format.');
            } else if (!label || !address) {
                alert('Please make sure that "Name" and "Address" are filled.');
            } else {
                const body = {
                    [address]: {
                        "chains": selectedChainCodes,
                        "comment": comment,
                        "entity": entity,
                        "entityImage": entityImage,
                        "label": label,
                        "aliases": this.getAliasesFromUI(),
                        "tracking": tracking
                    }
                };

                const editingAddr = form.dataset.editingAddr;

                if (editingAddr) {
                    const response = await this.updateDataToServer(body, editingAddr);
                    if (response !== undefined) {
                        await chrome.storage.local.remove('extensionFormDraft');
                        // Remove old key if address changed, add new key
                        if (editingAddr !== address) {
                            await this.remove(editingAddr);
                        }
                        await this.add(body);
                        await this.updateLabelsList();
                        this.updateStatus('Updating label...', 'pending');
                        this.resetFormState();
                    }
                } else {
                    // Check local duplicate before sending (optimistic check)
                    // The backend handles the real check, but good for UI
                    const localData: any = await this.get(LABELLED_ADDRESSES_KEY);
                    if (localData[LABELLED_ADDRESSES_KEY][address]) {
                        alert(`Label for address ${address} already exists. Please edit the existing label instead.`);
                        return;
                    }

                    const response = await this.addDataToServer(body);
                    if (response !== undefined) {
                        await chrome.storage.local.remove('extensionFormDraft');
                        await this.add(body);
                        await this.updateLabelsList();
                        this.updateStatus('Adding label...', 'pending');
                        this.resetFormState();
                    }
                }
            }
        });
    }

    resetFormState(): void {
        const form = document.getElementById('ext-etheraddresslookup-new-label-form') as HTMLFormElement;
        if (!form) return;

        delete form.dataset.editingAddr;
        form.reset();

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.textContent = 'Add Label';

        const cancelBtn = document.getElementById('btn-cancel-edit-label');
        if (cancelBtn) cancelBtn.remove();

        this.renderAliasRows([]);

        // Reset chain dropdown logic if needed, or kept as last selected
    }

    /**
     * @name setupResetHandler
     * @desc Setup the reset button handler
     * @return {void}
     */
    setupResetHandler(): void {
        const resetBtn = document.getElementById('ext-etheraddresslookup-reset');
        if (!resetBtn) return;

        resetBtn.addEventListener('click', async (event: Event) => {
            event.preventDefault();
            if (confirm("Are you sure you want to reset? This will clear all saved data.")) {
                await this.clear();
                await this.updateLabelsList();
                alert("Data has been successfully reset.");
            } else { return; }
        });
    }

    /**
     * @name updateChainOption
     * @desc Builds the multi-select chain picker with drag-to-reorder inside #label-chain.
     * @return {Promise<void>}
     */
    async updateChainOption(): Promise<void> {
        const container = document.querySelector(FORM_CHAIN_SELECTOR) as HTMLElement;
        if (!container) return;

        const chainManager = (window as any).chainManager;
        if (!chainManager) {
            console.error('[Labels] chainManager not initialized');
            return;
        }
        let allChains = chainManager.getAllChains();

        try {
            const labelsData = this.labelCache;
            const chainCounts: Record<string, number> = {};
            labelsData.forEach((lbl: any) => {
                const chains = Array.isArray(lbl.chains) ? lbl.chains : (lbl.chain ? [lbl.chain] : []);
                chains.forEach((c: string) => {
                    chainCounts[c] = (chainCounts[c] || 0) + 1;
                });
            });

            allChains.sort((a: any, b: any) => {
                const countA = chainCounts[a.caip2] || 0;
                const countB = chainCounts[b.caip2] || 0;
                if (countB === countA) {
                    return a.name.localeCompare(b.name);
                }
                return countB - countA;
            });
        } catch (error) {
            console.warn('[Labels] Failed to fetch usage counts for sorting chains', error);
        }

        // ── Clear any previous content ──────────────────────────────────────────
        container.innerHTML = '';

        // ── Error message area ──────────────────────────────────────────────────
        const errorEl = document.createElement('div');
        errorEl.id = 'chain-picker-error';
        errorEl.className = 'chain-error-msg';
        errorEl.style.display = 'none';
        container.appendChild(errorEl);

        // ── Selected chips (drag-to-reorder area) ───────────────────────────────
        const selectedArea = document.createElement('div');
        selectedArea.id = 'chain-selected-chips';
        selectedArea.className = 'chain-selected-chips';
        container.appendChild(selectedArea);

        // ── Search Input ────────────────────────────────────────────────────────
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search chains by name...';
        searchInput.className = 'form-control';
        searchInput.style.marginBottom = '10px';
        container.appendChild(searchInput);

        // ── Scrollable checkbox list ─────────────────────────────────────────────
        const listEl = document.createElement('div');
        listEl.className = 'chain-checkbox-list';
        container.appendChild(listEl);

        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase();
            const items = listEl.querySelectorAll('.chain-checkbox-item');
            items.forEach((item: Element) => {
                const nameSpan = item.querySelector('.chain-name-span');
                if (nameSpan && nameSpan.textContent?.toLowerCase().includes(query)) {
                    (item as HTMLElement).style.display = 'flex';
                } else {
                    (item as HTMLElement).style.display = 'none';
                }
            });
        });

        // ── Helpers ──────────────────────────────────────────────────────────────

        /** Returns true when all selected chain codes share compatible address formats */
        const allShareSameRegex = (codes: string[]): boolean => {
            const chainsForCodes = codes
                .map((c: string) => chainManager.getChainByCode(c))
                .filter(Boolean);
            if (chainsForCodes.length < 2) return true;

            // Short-circuit: All EVM chains (eip155 namespace) are mutually compatible
            const allAreEVM = chainsForCodes.every(c => c.caip2?.startsWith('eip155:'));
            if (allAreEVM) return true;

            // Robust comparison for other chains via regex pattern sources
            const getFingerprint = (ch: any) => {
                const patterns = ch.addrRegexPatterns ?? [];
                return JSON.stringify(patterns.map((r: any) => r instanceof RegExp ? r.source : String(r)).sort());
            };

            const baseline = getFingerprint(chainsForCodes[0]);
            return chainsForCodes.every((c: any) => getFingerprint(c) === baseline);
        };

        /** Re-render the selected chips (ordered list with drag handles) */
        (window as any).renderChainChips = () => {
            const codes = getSelectedChainsFromUI();
            selectedArea.innerHTML = '';
            if (codes.length === 0) return;

            codes.forEach((code: string, idx: number) => {
                const ch = chainManager.getChainByCode(code);
                if (!ch) return;

                const chip = document.createElement('div');
                chip.className = 'chain-chip';
                chip.draggable = true;
                chip.dataset.chainCode = code;
                chip.dataset.idx = String(idx);
                chip.style.cssText = `display:inline-flex;align-items:center;gap:4px;margin:2px;
                    padding:2px 6px;border-radius:3px;font-size:12px;
                    background:${ch.bgColor};color:${ch.fontColor};cursor:default;`;

                const handle = document.createElement('span');
                handle.className = 'chain-drag-handle';
                handle.textContent = '⠿';
                handle.title = 'Drag to reorder';
                handle.style.cursor = 'grab';

                const nameSpan = document.createElement('span');
                nameSpan.textContent = ch.name;

                chip.appendChild(handle);
                chip.appendChild(nameSpan);
                selectedArea.appendChild(chip);

                // ── Drag-and-drop reorder ──────────────────────────────────────
                chip.addEventListener('dragstart', (e: DragEvent) => {
                    e.dataTransfer!.setData('text/plain', String(idx));
                    chip.style.opacity = '0.5';
                });
                chip.addEventListener('dragend', () => { chip.style.opacity = '1'; });
                chip.addEventListener('dragover', (e: DragEvent) => { e.preventDefault(); });
                chip.addEventListener('drop', (e: DragEvent) => {
                    e.preventDefault();
                    const fromIdx = Number(e.dataTransfer!.getData('text/plain'));
                    const toIdx = idx;
                    if (fromIdx === toIdx) return;
                    const order = getSelectedChainsFromUI();
                    const [moved] = order.splice(fromIdx, 1);
                    order.splice(toIdx, 0, moved);
                    setSelectedChainsInUI(order);
                });
            });
        };

        // ── Build the checkbox list ───────────────────────────────────────────────
        allChains.forEach((chain: any) => {
            const row = document.createElement('label');
            row.className = 'chain-checkbox-item';
            row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 4px;cursor:pointer;font-size:13px;';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = chain.caip2;     // Using CAIP-2 as the primary identifier
            // We use attribute selector in setSelectedChainsInUI instead of ID to avoid colon issues
            checkbox.className = 'chain-picker-checkbox';

            const colorChip = document.createElement('span');
            colorChip.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:2px;
                background:${chain.bgColor};flex-shrink:0;`;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'chain-name-span';
            nameSpan.textContent = chain.name;

            row.appendChild(checkbox);
            row.appendChild(colorChip);
            row.appendChild(nameSpan);
            listEl.appendChild(row);

            checkbox.addEventListener('change', () => {
                const checkedCodes = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked'))
                    .map(cb => (cb as HTMLInputElement).value);

                if (checkbox.checked) {
                    // Check compatibility before adding
                    if (!allShareSameRegex(checkedCodes)) {
                        checkbox.checked = false;
                        errorEl.textContent =
                            'All selected chains must share the same address format. ' +
                            'You cannot combine EVM chains with Solana, for example.';
                        errorEl.style.display = 'block';
                        return;
                    }
                }

                errorEl.style.display = 'none';
                (window as any).renderChainChips();
            });
        });

        // Initial chip render
        (window as any).renderChainChips();
    }

    private setupAliasButtons(): void {
        const addBtn = document.querySelector(ALIAS_ADD_BTN_SELECTOR);
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this.addAliasRow();
            });
        }
    }

    private addAliasRow(name: string = '', chain: string = ''): void {
        const container = document.querySelector(ALIAS_ROWS_SELECTOR);
        if (!container) return;

        const row = document.createElement('div');
        row.className = 'alias-row';
        row.style.display = 'flex';
        row.style.flexDirection = 'column';
        row.style.gap = '4px';
        row.style.marginBottom = '8px';
        row.style.paddingBottom = '8px';
        row.style.borderBottom = '1px dashed #ccc';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'form-control alias-name-input';
        nameInput.placeholder = 'name.eth';
        nameInput.value = name;
        nameInput.style.width = '100%';
        nameInput.style.fontSize = '11px';

        const line2 = document.createElement('div');
        line2.style.display = 'flex';
        line2.style.gap = '4px';
        line2.style.alignItems = 'center';

        const chainSelect = document.createElement('select');
        chainSelect.className = 'form-control alias-chain-select';
        chainSelect.style.flex = '9';
        chainSelect.style.fontSize = '11px';
        chainSelect.style.color = 'var(--foreground, #000)';
        chainSelect.style.backgroundColor = 'var(--background, #fff)';

        const chainManager = (window as any).chainManager;
        const suffixInfo = document.createElement('div');
        suffixInfo.style.fontSize = '10px';
        suffixInfo.style.color = '#666';
        suffixInfo.style.marginTop = '2px';
        suffixInfo.style.paddingLeft = '2px';

        const updateSuffixes = (caip2: string) => {
            const selectedChain = chainManager?.getAllChains().find((c: any) => c.caip2 === caip2);
            if (selectedChain) {
                const suffixes = this.extractSuffixes(selectedChain);
                suffixInfo.textContent = suffixes.length > 0 ? `Available: ${suffixes.join(', ')}` : '';
            } else {
                suffixInfo.textContent = '';
            }
        };

        if (chainManager) {
            // Filter chains to only those that have a regex with a dot (alias chains)
            const allChains = [...chainManager.getAllChains()];
            const chains = allChains.filter((c: any) => {
                const patterns = c.addrRegexPatterns || [];
                return patterns.some((p: any) => {
                    const patternStr = typeof p === 'string' ? p : (p.source || p.toString());
                    return /\\\.[a-z0-9]+/i.test(patternStr);
                });
            });

            const chainCounts: Record<string, number> = {};
            this.labelCache.forEach((lbl: any) => {
                const chainArr = Array.isArray(lbl.chains) ? lbl.chains : (lbl.chain ? [lbl.chain] : []);
                chainArr.forEach((c: string) => {
                    chainCounts[c] = (chainCounts[c] || 0) + 1;
                });
            });

            chains.sort((a: any, b: any) => {
                const countA = chainCounts[a.caip2] || 0;
                const countB = chainCounts[b.caip2] || 0;
                if (countB === countA) {
                    return a.name.localeCompare(b.name);
                }
                return countB - countA;
            });

            chains.forEach((c: any) => {
                const opt = document.createElement('option');
                opt.value = c.caip2;
                opt.textContent = c.annotation?.code || c.name;
                opt.style.color = 'var(--foreground, #000)';
                opt.style.backgroundColor = 'var(--background, #fff)';
                if (c.caip2 === chain) opt.selected = true;
                chainSelect.appendChild(opt);
            });

            // Initial suffix update
            if (chainSelect.value) {
                updateSuffixes(chainSelect.value);
            }
        }

        chainSelect.onchange = () => updateSuffixes(chainSelect.value);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.className = 'btn btn-sm btn-error';
        removeBtn.style.flex = '1';
        removeBtn.style.padding = '4px 0';
        removeBtn.style.display = 'flex';
        removeBtn.style.justifyContent = 'center';
        removeBtn.style.alignItems = 'center';
        removeBtn.onclick = () => row.remove();

        line2.appendChild(chainSelect);
        line2.appendChild(removeBtn);

        row.appendChild(nameInput);
        row.appendChild(line2);
        row.appendChild(suffixInfo);
        container.appendChild(row);
    }

    private extractSuffixes(chain: any): string[] {
        const patterns = chain.addrRegexPatterns || [];
        const suffixes: string[] = [];
        patterns.forEach((p: any) => {
            const patternStr = typeof p === 'string' ? p : (p.source || p.toString());
            const matches = patternStr.matchAll(/\\\.([a-z0-9]+)/gi);
            for (const m of matches) {
                if (m[1]) {
                    suffixes.push(`.${m[1]}`);
                }
            }
        });
        return [...new Set(suffixes)];
    }

    renderAliasRows(aliases: { name: string; chain: string }[]): void {
        const container = document.querySelector(ALIAS_ROWS_SELECTOR);
        if (!container) return;
        container.innerHTML = '';
        aliases.forEach(a => this.addAliasRow(a.name, a.chain));
    }

    getAliasesFromUI(): { name: string; chain: string }[] {
        const rows = document.querySelectorAll('.alias-row');
        const aliases: { name: string; chain: string }[] = [];
        rows.forEach(row => {
            const nameInput = row.querySelector('.alias-name-input') as HTMLInputElement;
            const chainSelect = row.querySelector('.alias-chain-select') as HTMLSelectElement;
            if (nameInput?.value && chainSelect?.value) {
                aliases.push({ name: nameInput.value, chain: chainSelect.value });
            }
        });
        return aliases;
    }
}

/**
 * Returns the ordered list of selected chain codes from the multi-select picker.
 * Order follows the chip order (chips can be drag-reordered and store
 * their order via data-chain-code attributes in DOM order).
 */
export function getSelectedChainsFromUI(): string[] {
    const listEl = document.querySelector('.chain-checkbox-list');
    if (!listEl) return [];

    // Get all currently checked identifiers from checkboxes
    const checked = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => (cb as HTMLInputElement).value);

    // derive order from chips, but only include those that are still checked
    const chipArea = document.getElementById('chain-selected-chips');
    if (chipArea) {
        const chipOrder = Array.from(chipArea.querySelectorAll('[data-chain-code]'))
            .map(c => (c as HTMLElement).dataset.chainCode as string);

        const ordered = chipOrder.filter(code => checked.includes(code));
        const newlyAdded = checked.filter(code => !ordered.includes(code));
        return [...ordered, ...newlyAdded];
    }

    return checked;
}

/**
 * Programmatically sets the checked state of checkboxes and re-renders chips
 * to match the supplied ordered chain codes array. Used when filling the form
 * for an existing label.
 */
export function setSelectedChainsInUI(codes: string[]): void {
    const listEl = document.querySelector('.chain-checkbox-list');
    if (!listEl) return;

    // Reset all checkboxes
    listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        (cb as HTMLInputElement).checked = false;
    });

    // Check the ones in `codes`
    codes.forEach(code => {
        // Use value attribute selector to handle potential special characters like colons in CAIP-2
        const cb = listEl.querySelector(`input[type="checkbox"][value="${code}"]`) as HTMLInputElement | null;
        if (cb) cb.checked = true;
    });

    // Re-render chips to match current checkbox state + supplied order
    if (typeof (window as any).renderChainChips === 'function') {
        (window as any).renderChainChips();
    }
}