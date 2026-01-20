import { LABELLED_ADDRESSES_KEY, ENTITY_ADDRESSES_KEY, FORM_NAME_SELECTOR, FORM_ADDRESS_SELECTOR, FORM_COMMENT_SELECTOR, FORM_TRACK_SELECTOR, FORM_CHAIN_SELECTOR, FORM_ENTITY_SELECTOR, WS_EVENT_LABEL_GET, WS_EVENT_LABEL_UPDATE, WS_EVENT_LABEL_INSERT, WS_EVENT_LABEL_DELETE, WS_EVENT_SUCCESS, WS_EVENT_FAILURE } from './constants';

export class Labels {
    private scope: chrome.storage.LocalStorageArea;

    constructor(scope = chrome.storage.local) {
        this.scope = scope;
        this.setupMessageListener();
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
                    chain: item.chain || '',
                    comment: item.comment || '',
                    entity: item.entity || '',
                    entityImage: item.entityImage || '',
                    label: item.label || '',
                    tracking: item.tracking === '1' || item.tracking === 'true' || item.tracking === true
                };
            }
        });

        await this.set({ [LABELLED_ADDRESSES_KEY]: labelMap });
        console.log(`[Labels] Synced ${Object.keys(labelMap).length} labels to local storage`);
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
     * @name fetchDataFromServer
     * @desc Fetch label data from server via WebSocket
     * @returns {Promise<void>}
     */
    async fetchDataFromServer(): Promise<void> {
        try {
            console.log('[Labels] Requesting labels from server via WebSocket');
            const success = await this.emitWebSocketEvent(WS_EVENT_LABEL_GET, {
                params: {},
                headers: {}
            });

            if (!success) {
                console.warn('[Labels] Failed to request labels - WebSocket may not be ready');
            }
        } catch (err) {
            console.error('[Labels] Error fetching data:', err);
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
                    chain: labelData.chain,
                    entity: labelData.entity,
                    tracking: labelData.tracking ? '1' : '',
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
                const target = event.target as HTMLElement;
                const address = target?.getAttribute('data-ext-etheraddresslookup-label-id');
                if (!address) return;

                const response = await this.deleteDataToServer(address);
                if (response !== undefined) {
                    await this.remove(address);
                    alert(`Address ${address} successfully deleted.`);
                }
            });
        });

        const FILL_LABEL_INPUT_ATTRIBUTE = 'data-fill-label-input';
        document.querySelectorAll(`[${FILL_LABEL_INPUT_ATTRIBUTE}]`).forEach(element => {
            element.addEventListener('click', async (event: Event) => {
                const target = event.target as HTMLElement;
                const address = target?.getAttribute(FILL_LABEL_INPUT_ATTRIBUTE);
                if (!address) return;

                const localData: any = await this.get(LABELLED_ADDRESSES_KEY);
                const addrVals = localData[LABELLED_ADDRESSES_KEY][address];

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

                const chain = chainManager.getChainByName(addrVals.chain);

                if (chain) {
                    let chainElement = document.querySelector("#label-dropdown-value") as HTMLElement;
                    if (chainElement) {
                        chainElement.textContent = chain.name;
                        chainElement.style.background = chain.bgColor;
                        chainElement.style.color = chain.fontColor;
                    }
                }

                let entityElement = document.querySelector(FORM_ENTITY_SELECTOR) as HTMLSelectElement;
                if (entityElement && entityElement.options) {
                    entityElement.options[entityElement.selectedIndex].textContent = addrVals.entity;
                }
            });
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
        const localData: any = await this.get(LABELLED_ADDRESSES_KEY);
        if (localData[LABELLED_ADDRESSES_KEY] === undefined) {
            console.log("No data in local storage.");
            return;
        }

        let retrievedLabels = Object.entries(localData[LABELLED_ADDRESSES_KEY]).map(([address, values]: [string, any]) => {
            return { address, ...values };
        });

        if (query !== "") {
            retrievedLabels = retrievedLabels.filter((label: any) =>
                label.label && label.label.toLowerCase().includes(query.toLowerCase())
            );
        }

        // Sort labels in ascending order by label name
        retrievedLabels.sort((a: any, b: any) => a.label.localeCompare(b.label));

        const countEl = document.getElementById('label-count');
        if (countEl) {
            countEl.textContent = retrievedLabels.length.toString();
        }

        let HTMLLabels = '';
        for (const labelData of retrievedLabels) {
            HTMLLabels += this.getExtendedTemplate(labelData);
        }

        const labelsContainer = document.getElementById('ext-etheraddresslookup-current-labels');
        if (labelsContainer) {
            labelsContainer.innerHTML = HTMLLabels;
        }
        this.addLabelsListEvents();
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
                    return [
                        key.trim(),
                        data['labelledAddresses'][key].label.trim(),
                        data['labelledAddresses'][key].chain.trim(),
                        data['labelledAddresses'][key].comment.trim(),
                        data['labelledAddresses'][key].entity.trim(),
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
        if (!chainManager) {
            console.warn('[Labels] chainManager not initialized');
            return '';
        }

        const chain = chainManager.getChainByCode(body.chain);

        if (!chain) {
            console.warn(`Chain not found: ${body.chain}`);
            return '';
        }

        return `<div class="label-row" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; width: 100%;">
            <div style="display: flex; align-items: center; overflow: hidden; flex-grow: 1; margin-right: 10px;">
                <img class="ext-etheraddresslookup-label-img" src="${body.entityImage}" style="flex-shrink: 0; margin-right: 5px; width: 16px; height: 16px; border-radius: 4px; display: ${body.entityImage ? 'block' : 'none'}"/>
                <span class='ext-etheraddresslookup-label' data-fill-label-input="${body.address}"
                title="${body.label}&#013;${body.address}&#013;${body.entity}&#013;${body.comment}"
                style="color:${chain.fontColor};background:${chain.bgColor};font-size:11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${shortenText(body.label, 18)} ${chain.name}
                </span>
            </div>
            <div style="display: flex; align-items: center; flex-shrink: 0;">
                <input type="checkbox" class="track-this-wallet" value="${body.address}" style="margin-right: 8px; cursor: pointer; vertical-align: middle;" ${trackingChecked} disabled>
                <span style="cursor:pointer; font-weight: bold; padding: 2px 5px; vertical-align: middle;" class="ext-etheraddresslookup-label-delete" data-ext-etheraddresslookup-label-id="${body.address}">x</span>
            </div>
        </div>`;
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

            const chainDropdown = document.querySelector("#label-dropdown-value");
            const chainName = chainDropdown?.textContent || '';

            const chainManager = (window as any).chainManager;
            if (!chainManager) {
                alert('Chain manager not initialized. Please refresh the extension.');
                return;
            }

            const chain = chainManager.getChainByName(chainName);

            if (!chain) {
                alert(`Chain not found: ${chainName}`);
                return;
            }

            const addressInput = document.querySelector(FORM_ADDRESS_SELECTOR) as HTMLInputElement;
            const addressValue = addressInput?.value || '';
            const address = chain.addrCaseSensitive ? addressValue : addressValue.toLowerCase();

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
            const isValidAddress = matchAnyRegex(address, chain.addrRegexPatterns);

            if (!isValidAddress) {
                alert('Please make sure that "Address" is in the correct format.');
            } else if (!label || !address || !chain) {
                alert('Please make sure that "Name", "Address", and "Chain" is filled.');
            } else {
                const body = {
                    [address]: {
                        "chain": chain.chain,
                        "comment": comment,
                        "entity": entity,
                        "entityImage": entityImage,
                        "label": label,
                        "tracking": tracking
                    }
                };
                const response = await this.addDataToServer(body);
                if (response !== undefined) {
                    // Update local state optimistically, but let the WebSocket event handle the success message
                    await this.add(body);
                    this.updateStatus('Sending request to server...', 'pending');
                }
            }
        });
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
     * @desc Update the chain option in the form Using custom dropdown
     * @return {void}
     */
    updateChainOption(): void {
        const dropdown = document.querySelector(FORM_CHAIN_SELECTOR) as HTMLElement;
        if (!dropdown) return;

        const chainManager = (window as any).chainManager;
        if (!chainManager) {
            console.error('[Labels] chainManager not initialized');
            return;
        }
        const chains = chainManager.getAllChains();

        const generateChainOption = (chain: any): HTMLDivElement => {
            let option = document.createElement('div');
            option.className = 'custom-option';
            option.style.background = chain.bgColor;
            option.style.color = chain.fontColor;
            option.setAttribute('data-value', chain.bgColor);
            option.textContent = chain.name;
            option.onclick = function () {
                const dropdownValue = document.getElementById('label-dropdown-value') as HTMLElement;
                if (dropdownValue) {
                    dropdownValue.textContent = chain.name;
                    dropdownValue.setAttribute('data-selected-value', chain.bgColor);
                    dropdownValue.style.background = chain.bgColor;
                    dropdownValue.style.color = chain.fontColor;
                }
                dropdown.classList.remove('open');
            };
            return option;
        }

        let dropdownValue = document.createElement('div');
        dropdownValue.id = 'label-dropdown-value';
        dropdownValue.onclick = function () {
            dropdown.classList.toggle('open');
        };
        dropdown.appendChild(dropdownValue);

        // Create options container
        let optionsContainer = document.createElement('div');
        optionsContainer.className = 'ext-etheraddresslookup-dropdown-options';
        dropdown.appendChild(optionsContainer);

        let isFirst = true;
        chains.forEach((chain: any) => {
            const option = generateChainOption(chain);
            optionsContainer.appendChild(option);
            if (isFirst) {
                dropdownValue.textContent = chain.name;
                dropdownValue.setAttribute('data-selected-value', chain.bgColor);
                dropdownValue.style.background = chain.bgColor;
                dropdownValue.style.color = chain.fontColor;
                isFirst = false;
            }
        });
    }
}