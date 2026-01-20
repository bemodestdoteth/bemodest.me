import { ENTITY_ADDRESSES_KEY, ENTITY_NAME_SELECTOR, ENTITY_IMAGE_SELECTOR, ENTITY_COMMENT_SELECTOR, ENTITY_TRACK_SELECTOR, LABELLED_ADDRESSES_KEY, WS_EVENT_ENTITY_GET, WS_EVENT_ENTITY_UPDATE, WS_EVENT_SUCCESS, WS_EVENT_FAILURE } from './constants';

export class Entities {
    private scope: chrome.storage.LocalStorageArea;

    constructor(scope = chrome.storage.local) {
        this.scope = scope;
        this.setupMessageListener();
        this.setupFilterHandler();
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
            case WS_EVENT_ENTITY_UPDATE:
                if (data.success && data.data) {
                    console.log('[Entities] Received entity update from server');
                    this.updateStatus('Entities synced successfully', 'success');
                    await this.syncEntitiesFromServer(data.data);
                    await this.setupEntityDropdownHandler();
                    await this.renderEntityList();
                    await this.setupImageGridHandler();
                }
                break;
            case WS_EVENT_SUCCESS:
                console.log('[Entities] Success:', data.data);
                this.updateStatus(`Success: ${data.data}`, 'success');
                break;
            case WS_EVENT_FAILURE:
                console.error('[Entities] Failure:', data.error);
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
        const form = document.getElementById('form-add-entities');
        if (!form) return;

        let statusEl = document.getElementById('ext-etheraddresslookup-entity-form-status');
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'ext-etheraddresslookup-entity-form-status';
            statusEl.style.marginTop = '10px';
            statusEl.style.fontSize = '12px';
            statusEl.style.fontWeight = '500';
            form.appendChild(statusEl);
        }

        statusEl.textContent = `[Entities] ${message}`;

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
     * @name syncEntitiesFromServer
     * @desc Syncs entity data received from server to local storage
     * @param {any[]} data - Array of entity objects from MongoDB
     * @returns {Promise<void>}
     */
    private async syncEntitiesFromServer(data: any[]): Promise<void> {
        if (!Array.isArray(data)) {
            console.error('[Entities] Invalid data format received from server');
            return;
        }

        const entityMap: any = {};
        data.forEach((item: any) => {
            if (item.name) {
                entityMap[item.name] = {
                    code: item.name.toLowerCase().replace(/\./g, ''),
                    image: item.image || '',
                    comment: item.comment || '',
                    tracking: item.tracking || false
                };
            }
        });

        await this.set({ [ENTITY_ADDRESSES_KEY]: entityMap });
        console.log(`[Entities] Synced ${Object.keys(entityMap).length} entities to local storage`);
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
                    console.error('[Entities] Error emitting event:', chrome.runtime.lastError);
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
     * @param {any} body - Entity data to add
     * @returns {Promise<void>}
     */
    async add(body: any): Promise<void> {
        let result: any = await this.get(ENTITY_ADDRESSES_KEY);
        result = { ...result[ENTITY_ADDRESSES_KEY], ...body };
        await this.set(result);
    }

    /**
     * @name remove
     * @desc Removes one or more items from local storage.
     * @param {string} name - Entity name to remove
     * @returns {Promise<void>}
     */
    async remove(name: string): Promise<void> {
        const result: any = await this.get(ENTITY_ADDRESSES_KEY);
        delete result[ENTITY_ADDRESSES_KEY][name];
        await this.set(result);
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
     * @name hashString
     * @desc Hash a string using SHA-256
     * @param {string} input - String to hash
     * @returns {Promise<string>} Hashed string
     */
    async hashString(input: string): Promise<string> {
        const textBuffer = new TextEncoder().encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', textBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
            return false;
        }

        for (let key of keys1) {
            if (!obj2.hasOwnProperty(key)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @name fetchDataFromServer
     * @desc Fetch entity data from server via WebSocket
     * @returns {Promise<void>}
     */
    async fetchDataFromServer(): Promise<void> {
        try {
            console.log('[Entities] Requesting entities from server via WebSocket');
            const success = await this.emitWebSocketEvent(WS_EVENT_ENTITY_GET, {
                params: {},
                headers: {}
            });

            if (!success) {
                console.warn('[Entities] Failed to request entities - WebSocket may not be ready');
            }
        } catch (err) {
            console.error('[Entities] Error fetching data:', err);
        }
    }

    compareArrays(arr1: any[], arr2: any[]): boolean {
        if (arr1.length !== arr2.length) {
            return false;
        }

        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i] !== arr2[i]) {
                return false;
            }
        }

        return true;
    }

    /**
     * @name addDataToServer
     * @desc Send entity data to server via WebSocket
     * @param {any} body - Entity data
     * @returns {Promise<string | undefined>}
     */
    async addDataToServer(body: any): Promise<string | undefined> {
        try {
            console.log('[Entities] Sending entityInsert via WebSocket:', body);
            const success = await this.emitWebSocketEvent('entityInsert', {
                body: body,
                headers: {}
            });

            if (!success) {
                alert('WebSocket connection not available');
                return;
            }

            return 'Entity insert request sent';
        } catch (err) {
            console.error('[Entities] Error adding data:', err);
            return;
        }
    }

    /**
     * @name deleteDataToServer
     * @desc Delete entity from server via WebSocket
     * @param {string} name - Entity name to delete
     * @returns {Promise<string | undefined>}
     */
    async deleteDataToServer(name: string): Promise<string | undefined> {
        try {
            console.log('[Entities] Sending entityDelete via WebSocket for:', name);
            const success = await this.emitWebSocketEvent('entityDelete', {
                body: { name: name },
                headers: {}
            });

            if (!success) {
                alert('WebSocket connection not available');
                return;
            }

            return 'Entity delete request sent';
        } catch (err) {
            console.error('[Entities] Error deleting data:', err);
            return;
        }
    }

    /**
     * @name updateDataToServer
     * @desc Update entity data on server via WebSocket
     * @param {any} body - Entity data to update
     * @returns {Promise<string | undefined>}
     */
    async updateDataToServer(body: any): Promise<string | undefined> {
        try {
            console.log('[Entities] Sending entityUpdate via WebSocket:', body);
            const success = await this.emitWebSocketEvent('entityUpdate', {
                body: body,
                headers: {}
            });

            if (!success) {
                alert('WebSocket connection not available');
                return;
            }

            return 'Entity update request sent';
        } catch (err) {
            console.error('[Entities] Error updating data:', err);
            return;
        }
    }

    /**
     * @name updateOption
     * @desc (Legacy) Kept for compatibility
     * @return {void}
     */
    updateOption(): void {
        // No-op
    }

    /**
     * @name setupEntityDropdownHandler
     * @desc Update the labels entity dropdown
     * @return {void}
     */
    async setupEntityDropdownHandler(): Promise<void> {
        const entities: any = await this.get(ENTITY_ADDRESSES_KEY);
        const entityDropdown = document.getElementById('label-entity');
        if (!entityDropdown || !entities[ENTITY_ADDRESSES_KEY]) return;

        entityDropdown.innerHTML = '<option value="" style="color: #AFAFAF;" disabled selected hidden>Entity (Optional)</option>';

        // Add "No Entity" option
        let noEntityOption = document.createElement('option');
        noEntityOption.value = "";
        noEntityOption.textContent = "No Entity";
        noEntityOption.style.color = "#000000";
        entityDropdown.appendChild(noEntityOption);

        Object.keys(entities[ENTITY_ADDRESSES_KEY]).forEach((entity: string) => {
            let option = document.createElement('option');
            option.value = entity;
            option.textContent = entity;
            option.style.color = '#000000';
            entityDropdown.appendChild(option);
        });
    }

    /**
     * @name setupEntityTextArea (Renamed/Refactored to renderEntityList)
     * @desc Renders the entity list with images and delete buttons
     * @return {void}
     */
    async setupEntityTextArea(): Promise<void> {
        await this.renderEntityList();
        await this.setupImageGridHandler();
    }

    /**
     * @name renderEntityList
     * @desc Renders the list of entities in the popup
     */
    async renderEntityList(query: string = ""): Promise<void> {
        const entitiesData: any = await this.get(ENTITY_ADDRESSES_KEY);
        const container = document.getElementById('ext-etheraddresslookup-current-entities');

        if (!container || !entitiesData[ENTITY_ADDRESSES_KEY]) return;

        container.innerHTML = '';
        const entities = entitiesData[ENTITY_ADDRESSES_KEY];

        let sortedNames = Object.keys(entities).sort((a, b) => a.localeCompare(b));

        if (query !== "") {
            sortedNames = sortedNames.filter(name => name.toLowerCase().includes(query.toLowerCase()));
        }

        const countEl = document.getElementById('entity-count');
        if (countEl) {
            countEl.textContent = sortedNames.length.toString();
        }

        for (const name of sortedNames) {
            const entity = entities[name];
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.padding = '5px 0';
            row.style.borderBottom = '1px solid #eee';

            const leftDiv = document.createElement('div');
            leftDiv.style.display = 'flex';
            leftDiv.style.alignItems = 'center';

            const img = document.createElement('img');
            img.src = entity.image || '';
            img.style.width = '20px';
            img.style.height = '20px';
            img.style.marginRight = '8px';
            img.style.borderRadius = '3px';
            img.style.border = '1px solid #ccc';
            if (!entity.image) img.style.display = 'none';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = name;
            nameSpan.style.fontSize = '12px';
            nameSpan.title = entity.comment || '';

            leftDiv.appendChild(img);
            leftDiv.appendChild(nameSpan);

            const rightDiv = document.createElement('div');

            const delBtn = document.createElement('button');
            delBtn.textContent = 'x';
            delBtn.className = 'btn btn-sm btn-error';
            delBtn.style.padding = '0px 6px';
            delBtn.style.marginLeft = '5px';
            delBtn.title = 'Delete Entity';
            delBtn.onclick = async () => {
                if (confirm(`Are you sure you want to delete entity "${name}"?`)) {
                    await this.deleteDataToServer(name);
                }
            };

            rightDiv.appendChild(delBtn);

            row.appendChild(leftDiv);
            rightDiv.appendChild(delBtn);

            row.appendChild(leftDiv);
            row.appendChild(rightDiv);

            // Make row clickable for editing
            row.style.cursor = 'pointer';
            row.onclick = () => {
                this.populateForm(name);
                // Visual feedback
                Array.from(container.children).forEach(r => (r as HTMLElement).style.backgroundColor = '#fff');
                row.style.backgroundColor = '#f0f9ff';
            };
            // Prevent delete button propagation
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete entity "${name}"?`)) {
                    await this.deleteDataToServer(name);
                }
            };

            container.appendChild(row);
        }
    }

    populateForm(entityName: string): void {
        const form = document.getElementById('form-add-entities') as HTMLFormElement;
        if (!form) return;

        this.get(ENTITY_ADDRESSES_KEY).then((data: any) => {
            const entity = data[ENTITY_ADDRESSES_KEY][entityName];
            if (!entity) return;

            form.dataset.editingId = entityName;

            (document.getElementById('entity-name') as HTMLInputElement).value = entityName;
            (document.getElementById('entity-comment') as HTMLTextAreaElement).value = entity.comment || '';
            (document.getElementById('entity-track') as HTMLInputElement).checked = entity.tracking || false;
            (document.getElementById('entity-image') as HTMLInputElement).value = entity.image || '';

            // Image preview
            if (entity.image) {
                const previewDiv = document.getElementById('selected-image-preview');
                const previewImg = document.getElementById('preview-img') as HTMLImageElement;
                if (previewDiv && previewImg) {
                    previewImg.src = entity.image;
                    previewDiv.style.display = 'block';
                }
            }

            // Update button text
            const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
            if (submitBtn) {
                submitBtn.textContent = 'Update Entity';
            }

            // Add cancel button
            let cancelBtn = document.getElementById('btn-cancel-entity-edit');
            if (!cancelBtn) {
                cancelBtn = document.createElement('button');
                cancelBtn.id = 'btn-cancel-entity-edit';
                cancelBtn.textContent = 'Cancel';
                cancelBtn.className = 'btn btn-sm btn-ghost ml-2';
                cancelBtn.onclick = (e) => {
                    e.preventDefault();
                    this.resetForm();
                };
                submitBtn.parentElement?.appendChild(cancelBtn);
            }
        });
    }

    resetForm(): void {
        const form = document.getElementById('form-add-entities') as HTMLFormElement;
        if (!form) return;

        delete form.dataset.editingId;
        form.reset();

        (document.getElementById('entity-image') as HTMLInputElement).value = '';
        const previewDiv = document.getElementById('selected-image-preview');
        if (previewDiv) previewDiv.style.display = 'none';

        const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
        if (submitBtn) {
            submitBtn.textContent = 'Add Entity';
        }

        const cancelBtn = document.getElementById('btn-cancel-entity-edit');
        if (cancelBtn) cancelBtn.remove();

        const container = document.getElementById('ext-etheraddresslookup-current-entities');
        if (container) {
            Array.from(container.children).forEach(r => (r as HTMLElement).style.backgroundColor = '#fff');
        }
    }

    /**
     * @name setupImageGridHandler
     * @desc Populates the grid of existing entity images for selection
     */
    async setupImageGridHandler(): Promise<void> {
        const toggleBtn = document.getElementById('btn-toggle-image-grid');
        const grid = document.getElementById('entity-image-grid');
        const hiddenInput = document.getElementById('entity-image') as HTMLInputElement;
        const previewDiv = document.getElementById('selected-image-preview');
        const previewImg = document.getElementById('preview-img') as HTMLImageElement;

        if (!toggleBtn || !grid) return;

        toggleBtn.onclick = async () => {
            if (grid.style.display === 'none') {
                const entitiesData: any = await this.get(ENTITY_ADDRESSES_KEY);
                const entities = entitiesData[ENTITY_ADDRESSES_KEY] || {};

                const uniqueImages = new Set<string>();
                Object.values(entities).forEach((e: any) => {
                    if (e.image && e.image.startsWith('data:image')) {
                        uniqueImages.add(e.image);
                    }
                });

                grid.innerHTML = '';

                // Add "No Image" option
                const noImgDiv = document.createElement('div');
                noImgDiv.style.cursor = 'pointer';
                noImgDiv.style.border = '1px solid #ddd';
                noImgDiv.style.padding = '4px';
                noImgDiv.style.borderRadius = '3px';
                noImgDiv.style.fontSize = '10px';
                noImgDiv.style.display = 'flex';
                noImgDiv.style.alignItems = 'center';
                noImgDiv.style.justifyContent = 'center';
                noImgDiv.style.width = '24px';
                noImgDiv.style.height = '24px';
                noImgDiv.style.backgroundColor = '#eee';
                noImgDiv.title = 'No Image';
                noImgDiv.textContent = 'None';

                noImgDiv.onclick = () => {
                    hiddenInput.value = '';
                    previewImg.src = '';
                    if (previewDiv) previewDiv.style.display = 'none';
                    grid.style.display = 'none';
                    const fileInput = document.getElementById('entity-image-file') as HTMLInputElement;
                    if (fileInput) fileInput.value = '';
                }
                grid.appendChild(noImgDiv);

                if (uniqueImages.size === 0) {
                    grid.textContent = "No existing images found.";
                } else {
                    uniqueImages.forEach(imgSrc => {
                        const imgDiv = document.createElement('div');
                        imgDiv.style.cursor = 'pointer';
                        imgDiv.style.border = '1px solid #ddd';
                        imgDiv.style.padding = '2px';
                        imgDiv.style.borderRadius = '3px';

                        const img = document.createElement('img');
                        img.src = imgSrc;
                        img.style.width = '24px';
                        img.style.height = '24px';

                        imgDiv.appendChild(img);
                        imgDiv.onclick = () => {
                            hiddenInput.value = imgSrc;
                            previewImg.src = imgSrc;
                            if (previewDiv) previewDiv.style.display = 'block';
                            grid.style.display = 'none';
                            const fileInput = document.getElementById('entity-image-file') as HTMLInputElement;
                            if (fileInput) fileInput.value = '';
                        }
                        grid.appendChild(imgDiv);
                    });
                }
                grid.style.display = 'flex';
            } else {
                grid.style.display = 'none';
            }
        };

        const fileInput = document.getElementById('entity-image-file') as HTMLInputElement;
        const filenameInput = document.getElementById('entity-image-filename') as HTMLInputElement;
        if (fileInput) {
            fileInput.addEventListener('change', () => {
                if (fileInput.files && fileInput.files.length > 0) {
                    hiddenInput.value = '';
                    if (previewDiv) previewDiv.style.display = 'none';
                    if (filenameInput) {
                        filenameInput.value = fileInput.files[0].name;
                    }
                }
            });
        }
    }

    /**
     * @name setupFormSubmitHandler
     * @desc Setup the form submit button handler
     * @return {void}
     */
    setupFormSubmitHandler(): void {
        const form = document.getElementById('form-add-entities');
        if (!form) return;

        form.addEventListener('submit', async (event: Event) => {
            event.preventDefault();

            const nameInput = document.getElementById('entity-name') as HTMLInputElement;
            const name = nameInput?.value?.trim() || '';



            const fileInput = document.getElementById('entity-image-file') as HTMLInputElement;
            const hiddenInput = document.getElementById('entity-image') as HTMLInputElement;

            const commentInput = document.getElementById('entity-comment') as HTMLTextAreaElement;
            const comment = commentInput?.value || '';

            const trackInput = document.getElementById('entity-track') as HTMLInputElement;
            const tracking = trackInput?.checked || false;

            if (!name) {
                alert('Please enter an Entity Name.');
                return;
            }

            let imageBase64 = hiddenInput.value;

            if (fileInput.files && fileInput.files.length > 0) {
                const file = fileInput.files[0];

                if (file.size > 1024 * 1024) {
                    alert('Image file is too large (max 1MB).');
                    return;
                }

                try {
                    imageBase64 = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result as string);
                        reader.onerror = error => reject(error);
                        reader.readAsDataURL(file);
                    });
                } catch (e) {
                    console.error('Error reading file:', e);
                    alert('Failed to read image file.');
                    return;
                }
            }

            if (!imageBase64) {
                if (!confirm("No image selected. Create entity without an image?")) {
                    return;
                }
            }



            if (form.dataset.editingId) {
                // Update mode
                const body = {
                    originalName: form.dataset.editingId,
                    name: name,
                    image: imageBase64 ? (imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64) : '',
                    comment: comment,
                    tracking: tracking,
                    imageFilename: undefined as string | undefined
                };

                // Add image filename if present
                const filenameInput = document.getElementById('entity-image-filename') as HTMLInputElement;
                // Only require filename if a NEW file is selected
                if (fileInput.files && fileInput.files.length > 0) {
                    if (filenameInput && filenameInput.value) {
                        body.imageFilename = filenameInput.value;
                    } else {
                        alert('Please provide an Image Filename for the new image.');
                        return;
                    }
                }

                const response = await this.updateDataToServer(body);
                if (response) {
                    this.resetForm();
                    this.updateStatus('Sending update request...', 'pending');
                }

            } else {
                // Insert mode
                const body = {
                    [name]: {
                        "image": imageBase64,
                        "comment": comment,
                        "tracking": tracking
                    }
                };

                if (imageBase64 && imageBase64.includes(',')) {
                    body[name].image = imageBase64.split(',')[1];
                }

                // Add image filename if present
                const filenameInput = document.getElementById('entity-image-filename') as HTMLInputElement;
                if (filenameInput && filenameInput.value) {
                    (body[name] as any).imageFilename = filenameInput.value;
                } else if (fileInput.files && fileInput.files.length > 0) {
                    alert('Please provide an Image Filename.');
                    return;
                }

                const response = await this.addDataToServer(body);
                if (response) {
                    nameInput.value = '';
                    fileInput.value = '';
                    hiddenInput.value = '';
                    commentInput.value = '';
                    trackInput.checked = false;
                    const previewDiv = document.getElementById('selected-image-preview');
                    if (previewDiv) previewDiv.style.display = 'none';

                    this.updateStatus('Sending request to server...', 'pending');
                }
            }
        });
    }
    setupFilterHandler(): void {
        const searchForm = document.getElementById('form-entity-search');
        if (!searchForm) return;

        searchForm.addEventListener('submit', async (event: Event) => {
            event.preventDefault();
        });

        const searchInput = document.getElementById('ext-etheraddresslookup-search-entity') as HTMLInputElement;
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const query = searchInput.value || '';
                this.renderEntityList(query);
            });
        }
    }
}